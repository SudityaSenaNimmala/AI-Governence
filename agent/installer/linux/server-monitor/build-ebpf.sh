#!/usr/bin/env bash
# Build + install the Tier 2 L2 eBPF SSL capture helper.
#
# Separated from the main installer because eBPF requires extra build deps
# and a kernel that supports BPF + uprobes (Linux ≥ 4.18 in practice, with
# ring-buffer needing ≥ 5.8). Run this AFTER the main install.sh succeeded.
#
# Requirements (apt):
#   clang llvm libbpf-dev bpftool libelf-dev linux-headers-$(uname -r)
# (yum/dnf):
#   clang llvm libbpf-devel bpftool elfutils-libelf-devel kernel-headers
#
# Output: /opt/cloudfuze/server-monitor/cloudfuze-ssl-capture
# Then restart the daemon: systemctl restart cloudfuze-server-monitor
#
# On hardened kernels (some cloud distros lock down BPF) this build is fine
# but the runtime attach may fail. The daemon will log and continue serving
# Tier 1 + Tier 2 localhost + Tier 3 signals.

set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "must be run as root" >&2; exit 1
fi

INSTALL_DIR="/opt/cloudfuze/server-monitor"
SRC_DIR="$(dirname "$0")/../../../src/server-monitor/ebpf"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "[1/4] Checking build dependencies…"
MISSING=()
for cmd in clang bpftool make; do
  command -v "$cmd" >/dev/null 2>&1 || MISSING+=("$cmd")
done
# headers check via pkg-config
if ! pkg-config --exists libbpf 2>/dev/null; then
  if [[ ! -f /usr/include/bpf/libbpf.h ]]; then
    MISSING+=("libbpf-dev")
  fi
fi
if (( ${#MISSING[@]} > 0 )); then
  echo "    missing: ${MISSING[*]}"
  echo "    Debian/Ubuntu: apt install clang llvm libbpf-dev bpftool libelf-dev linux-headers-\$(uname -r)"
  echo "    RHEL/Fedora:   yum install clang llvm libbpf-devel bpftool elfutils-libelf-devel kernel-headers"
  exit 1
fi

echo "[2/4] Verifying kernel BTF…"
if [[ ! -f /sys/kernel/btf/vmlinux ]]; then
  echo "    /sys/kernel/btf/vmlinux missing — this kernel was built without CONFIG_DEBUG_INFO_BTF."
  echo "    eBPF capture is not supported on this kernel. The daemon will still work without it (Tier 1 + L3-L5)."
  exit 2
fi

echo "[3/4] Building helper from $SRC_DIR…"
cp -r "$SRC_DIR"/* "$WORK_DIR/"
( cd "$WORK_DIR" && make )

echo "[4/4] Installing to $INSTALL_DIR/cloudfuze-ssl-capture…"
install -m 755 "$WORK_DIR/cloudfuze-ssl-capture" "$INSTALL_DIR/cloudfuze-ssl-capture"

echo
echo "OK eBPF helper installed."
echo "    To activate: systemctl restart cloudfuze-server-monitor"
echo "    Then watch:  journalctl -u cloudfuze-server-monitor -f | grep ebpf-capture"
