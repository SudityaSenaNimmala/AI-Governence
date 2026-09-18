# Build the eBPF SSL capture binary.
#
# Requirements on the build host (Linux only):
#   apt:  clang llvm libbpf-dev bpftool linux-headers-$(uname -r)  libelf-dev
#   yum:  clang llvm libbpf-devel bpftool kernel-headers           elfutils-libelf-devel
#
# Output: ./cloudfuze-ssl-capture (single statically-linked-ish binary).
# Install the binary to /opt/cloudfuze/server-monitor/.
#
# Cross-compile: not supported. The vmlinux.h header is generated from the
# running kernel via bpftool — build on a host that matches the target.

CLANG       ?= clang
BPFTOOL     ?= bpftool
ARCH        := $(shell uname -m | sed 's/x86_64/x86/' | sed 's/aarch64/arm64/')
LIBBPF_CFLAGS := $(shell pkg-config --cflags libbpf 2>/dev/null)
LIBBPF_LIBS   := $(shell pkg-config --libs libbpf 2>/dev/null || echo "-lbpf -lelf -lz")

CFLAGS  := -O2 -g -Wall $(LIBBPF_CFLAGS)
BPF_CFLAGS := -O2 -g -target bpf -D__TARGET_ARCH_$(ARCH) -I. \
              -Wno-unused-value -Wno-pointer-sign -Wno-compare-distinct-pointer-types \
              -Wno-gnu-variable-sized-type-not-at-end -Wno-address-of-packed-member \
              -Wno-tautological-compare -Wno-unknown-warning-option

all: cloudfuze-ssl-capture

vmlinux.h:
	$(BPFTOOL) btf dump file /sys/kernel/btf/vmlinux format c > $@

ssl_capture.bpf.o: ssl_capture.bpf.c vmlinux.h
	$(CLANG) $(BPF_CFLAGS) -c $< -o $@

ssl_capture.skel.h: ssl_capture.bpf.o
	$(BPFTOOL) gen skeleton $< > $@

ssl_capture.o: ssl_capture.c ssl_capture.skel.h
	$(CC) $(CFLAGS) -c $< -o $@

cloudfuze-ssl-capture: ssl_capture.o
	$(CC) $(CFLAGS) $< -o $@ $(LIBBPF_LIBS)

clean:
	rm -f ssl_capture.bpf.o ssl_capture.skel.h ssl_capture.o cloudfuze-ssl-capture vmlinux.h

.PHONY: all clean
