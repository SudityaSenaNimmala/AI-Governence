// SPDX-License-Identifier: GPL-2.0
//
// Userspace loader for ssl_capture.bpf.c.
//
// What it does:
//   1. Loads + attaches the eBPF program to OpenSSL symbols in libssl.so.3.
//      (libssl.so.1.1 fallback path included.)
//   2. Polls the ring buffer for ssl_event records.
//   3. Emits one JSON line per event on stdout. The Node daemon consumes this
//      via spawn() and forwards to the cost-parser + attribution pipeline.
//
// Run as root (uprobes + bpf() syscall require CAP_BPF + CAP_PERFMON; root
// is the simple option). Built and shipped as `cloudfuze-ssl-capture` next
// to the main daemon binary.

#include <argp.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>
#include <bpf/libbpf.h>
#include "ssl_capture.skel.h"

#define MAX_BUF 16384
struct ssl_event {
    unsigned long long ts_ns;
    unsigned int pid, tid, uid;
    int len;
    unsigned char is_read, truncated;
    unsigned char _pad[2];
    char comm[16];
    char buf[MAX_BUF];
};

static volatile sig_atomic_t exiting = 0;
static void sig_handler(int sig) { (void)sig; exiting = 1; }

static int libbpf_print(enum libbpf_print_level level, const char *fmt, va_list args) {
    if (level > LIBBPF_INFO) return 0;
    return vfprintf(stderr, fmt, args);
}

// Default lib paths — try in order. Override with --libssl=/path.
static const char *DEFAULT_LIBSSL[] = {
    "/usr/lib/x86_64-linux-gnu/libssl.so.3",
    "/usr/lib64/libssl.so.3",
    "/usr/lib/x86_64-linux-gnu/libssl.so.1.1",
    "/usr/lib64/libssl.so.1.1",
    NULL,
};

static const char *libssl_path = NULL;

static struct argp_option opts[] = {
    {"libssl", 'l', "PATH", 0, "Path to libssl.so (default: auto-detect)", 0},
    {0},
};
static error_t parse_arg(int key, char *arg, struct argp_state *state) {
    if (key == 'l') libssl_path = arg;
    return 0;
}

// Escape a buffer for JSON output. Keeps ASCII as-is, escapes control chars
// and \ and ". Output written to fp.
static void json_escape_print(FILE *fp, const char *buf, int len) {
    fputc('"', fp);
    for (int i = 0; i < len; i++) {
        unsigned char c = (unsigned char)buf[i];
        if (c == '"' || c == '\\') { fputc('\\', fp); fputc(c, fp); }
        else if (c == '\n') fputs("\\n", fp);
        else if (c == '\r') fputs("\\r", fp);
        else if (c == '\t') fputs("\\t", fp);
        else if (c < 0x20) fprintf(fp, "\\u%04x", c);
        else fputc(c, fp);
    }
    fputc('"', fp);
}

static int handle_event(void *ctx, void *data, size_t data_sz) {
    (void)ctx; (void)data_sz;
    const struct ssl_event *e = (const struct ssl_event *)data;
    // One JSON line per event. Node reads line-by-line.
    fprintf(stdout,
        "{\"ts_ns\":%llu,\"pid\":%u,\"tid\":%u,\"uid\":%u,\"is_read\":%u,"
        "\"truncated\":%u,\"len\":%d,\"comm\":\"%.*s\",\"data\":",
        e->ts_ns, e->pid, e->tid, e->uid, e->is_read,
        e->truncated, e->len, (int)sizeof(e->comm), e->comm);
    json_escape_print(stdout, e->buf, e->len);
    fputs("}\n", stdout);
    fflush(stdout);
    return 0;
}

static const char *resolve_libssl(void) {
    if (libssl_path) return libssl_path;
    for (int i = 0; DEFAULT_LIBSSL[i]; i++) {
        if (access(DEFAULT_LIBSSL[i], R_OK) == 0) return DEFAULT_LIBSSL[i];
    }
    return NULL;
}

int main(int argc, char **argv) {
    static struct argp argp = { opts, parse_arg, NULL, NULL, NULL, NULL, NULL };
    argp_parse(&argp, argc, argv, 0, NULL, NULL);

    libbpf_set_print(libbpf_print);
    signal(SIGINT, sig_handler);
    signal(SIGTERM, sig_handler);

    const char *lib = resolve_libssl();
    if (!lib) {
        fprintf(stderr, "ssl-capture: could not find libssl.so.3 or .so.1.1. Use --libssl=PATH.\n");
        return 1;
    }
    fprintf(stderr, "ssl-capture: attaching to %s\n", lib);

    struct ssl_capture_bpf *skel = ssl_capture_bpf__open_and_load();
    if (!skel) { fprintf(stderr, "ssl-capture: skeleton load failed\n"); return 1; }

    // Attach each uprobe. Some symbols may not exist in older libssl —
    // attaching is best-effort; we report each result.
    struct bpf_program *progs[] = {
        skel->progs.probe_ssl_write_entry,
        skel->progs.probe_ssl_write_exit,
        skel->progs.probe_ssl_read_entry,
        skel->progs.probe_ssl_read_exit,
        skel->progs.probe_ssl_write_ex_entry,
        skel->progs.probe_ssl_read_ex_exit,
        NULL,
    };
    const char *funcs[] = {
        "SSL_write", "SSL_write", "SSL_read", "SSL_read",
        "SSL_write_ex", "SSL_read_ex", NULL,
    };
    int attached = 0;
    for (int i = 0; progs[i]; i++) {
        struct bpf_link *link = bpf_program__attach_uprobe(progs[i],
            (i % 2 == 1) ? true : false,    // retprobe for *_exit progs
            -1, lib, 0);
        if (!link) {
            fprintf(stderr, "ssl-capture: attach %s (idx %d) failed (ignored)\n", funcs[i], i);
        } else attached++;
    }
    if (attached == 0) {
        fprintf(stderr, "ssl-capture: no uprobes attached — is libssl symbol-stripped?\n");
        ssl_capture_bpf__destroy(skel);
        return 1;
    }
    fprintf(stderr, "ssl-capture: %d uprobes attached, polling events…\n", attached);

    struct ring_buffer *rb = ring_buffer__new(bpf_map__fd(skel->maps.events), handle_event, NULL, NULL);
    if (!rb) { fprintf(stderr, "ssl-capture: ringbuf failed\n"); return 1; }

    while (!exiting) {
        int n = ring_buffer__poll(rb, 200 /* ms */);
        if (n < 0 && n != -4 /* EINTR */) {
            fprintf(stderr, "ssl-capture: poll error %d\n", n);
            break;
        }
    }
    ring_buffer__free(rb);
    ssl_capture_bpf__destroy(skel);
    return 0;
}
