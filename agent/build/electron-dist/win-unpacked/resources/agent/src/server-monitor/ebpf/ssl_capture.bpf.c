// SPDX-License-Identifier: GPL-2.0
//
// eBPF program: uprobe OpenSSL SSL_write / SSL_read entry to capture
// plaintext *before* TLS encryption (or *after* decryption). This defeats
// agents that pin certificates and refuse our MITM CA — the kernel sees the
// plaintext regardless.
//
// Build:  see Makefile in the same directory. Requires clang, libbpf-dev,
//         linux kernel headers ≥ 5.8 (BPF ring buffer).
//
// Runtime targets:
//   - libssl.so.3 / libssl.so.1.1 — OpenSSL
//   - libssl-1_1-x64.dll loaded into Windows? No: this is Linux only.
//
// Limitations (documented honestly):
//   - Symbol offsets in libssl differ across versions. v1 hard-codes "SSL_write"
//     / "SSL_read" / "SSL_write_ex" / "SSL_read_ex" by name; libbpf's uprobe
//     resolves them via the symbol table. Some hardened distros strip symbols
//     from /usr/lib/x86_64-linux-gnu/libssl.so.3 — those builds need a
//     `dbgsym` package or fall through to the proxy path.
//   - GnuTLS, NSS, BoringSSL all use different symbols. v1 is OpenSSL only.
//     gnutls_record_send / nss_send / SSL_write (BoringSSL keeps the name)
//     are TODO.
//   - We capture up to MAX_BUF bytes per call. Larger payloads get truncated;
//     userspace marks them as truncated so the operator knows.

#include <vmlinux.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define MAX_BUF 16384      // 16 KB per capture — covers ~99% of LLM API JSON

// Event shape sent to userspace via ring buffer.
struct ssl_event {
    __u64 ts_ns;
    __u32 pid;
    __u32 tid;
    __u32 uid;
    __s32 len;             // bytes captured (may be < buf size if truncated)
    __u8  is_read;         // 0 = write (outbound plaintext), 1 = read (inbound plaintext)
    __u8  truncated;
    __u8  _pad[2];
    char  comm[16];
    char  buf[MAX_BUF];
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} events SEC(".maps");

// On entry we just remember the (ssl, buf, len). The data is in userspace
// memory and may not be readable from kernel until the syscall has copied it
// in (it's the caller's buffer, so it IS in userspace already at entry).
struct write_args_t {
    void *buf;
    __s32 num;
};
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key, __u64);            // pid_tgid
    __type(value, struct write_args_t);
} write_args SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 4096);
    __type(key, __u64);
    __type(value, struct write_args_t);
} read_args SEC(".maps");

static __always_inline int emit_event(void *buf, __s32 len, __u8 is_read)
{
    if (!buf || len <= 0) return 0;

    struct ssl_event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    if (!e) return 0;

    e->ts_ns = bpf_ktime_get_ns();
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    e->pid = pid_tgid >> 32;
    e->tid = (__u32)pid_tgid;
    e->uid = (__u32)bpf_get_current_uid_gid();
    e->is_read = is_read;
    e->_pad[0] = e->_pad[1] = 0;
    bpf_get_current_comm(&e->comm, sizeof(e->comm));

    __s32 to_copy = len;
    if (to_copy > MAX_BUF) { to_copy = MAX_BUF; e->truncated = 1; }
    else                   { e->truncated = 0; }
    e->len = to_copy;

    long ret = bpf_probe_read_user(e->buf, to_copy, buf);
    if (ret < 0) {
        bpf_ringbuf_discard(e, 0);
        return 0;
    }
    bpf_ringbuf_submit(e, 0);
    return 0;
}

// --- SSL_write(SSL *ssl, const void *buf, int num) ---
SEC("uprobe/SSL_write")
int BPF_KPROBE(probe_ssl_write_entry, void *ssl, void *buf, __s32 num)
{
    __u64 key = bpf_get_current_pid_tgid();
    struct write_args_t v = { .buf = buf, .num = num };
    bpf_map_update_elem(&write_args, &key, &v, BPF_ANY);
    return 0;
}
SEC("uretprobe/SSL_write")
int BPF_KRETPROBE(probe_ssl_write_exit, __s32 retval)
{
    __u64 key = bpf_get_current_pid_tgid();
    struct write_args_t *v = bpf_map_lookup_elem(&write_args, &key);
    if (!v) return 0;
    if (retval > 0) emit_event(v->buf, retval, 0);
    bpf_map_delete_elem(&write_args, &key);
    return 0;
}

// --- SSL_read(SSL *ssl, void *buf, int num) — capture on EXIT so we see the
//     bytes that were just decrypted into the caller's buffer. ---
SEC("uprobe/SSL_read")
int BPF_KPROBE(probe_ssl_read_entry, void *ssl, void *buf, __s32 num)
{
    __u64 key = bpf_get_current_pid_tgid();
    struct write_args_t v = { .buf = buf, .num = num };
    bpf_map_update_elem(&read_args, &key, &v, BPF_ANY);
    return 0;
}
SEC("uretprobe/SSL_read")
int BPF_KRETPROBE(probe_ssl_read_exit, __s32 retval)
{
    __u64 key = bpf_get_current_pid_tgid();
    struct write_args_t *v = bpf_map_lookup_elem(&read_args, &key);
    if (!v) return 0;
    if (retval > 0) emit_event(v->buf, retval, 1);
    bpf_map_delete_elem(&read_args, &key);
    return 0;
}

// --- SSL_write_ex(SSL *ssl, const void *buf, size_t num, size_t *written) ---
// The "_ex" variants return 1 on success and put the byte count through the
// written pointer. We capture on entry using `num` as the upper bound; some
// truncation possible if the actual write was shorter.
SEC("uprobe/SSL_write_ex")
int BPF_KPROBE(probe_ssl_write_ex_entry, void *ssl, void *buf, size_t num)
{
    emit_event(buf, (__s32)(num > MAX_BUF ? MAX_BUF : num), 0);
    return 0;
}
SEC("uprobe/SSL_read_ex")
int BPF_KRETPROBE(probe_ssl_read_ex_exit, __s32 retval)
{
    // For _ex read we'd need to read *readbytes_ptr on return. v1 skips this;
    // most apps use SSL_read.
    return 0;
}

char LICENSE[] SEC("license") = "GPL";
