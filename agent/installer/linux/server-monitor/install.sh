#!/usr/bin/env bash
# Install CloudFuze server-monitor daemon on a Linux server.
#
# What this does:
#   1. Drops the bundled daemon binary under /opt/cloudfuze/server-monitor
#   2. Generates a CA on first run, then installs ca.crt into the system trust
#      store (/usr/local/share/ca-certificates/) and runs update-ca-certificates.
#   3. Writes /etc/profile.d/cloudfuze-proxy.sh so every new shell gets
#      HTTPS_PROXY set. (NB: existing long-running processes do NOT pick this
#      up — they must be restarted to be governed.)
#   4. Installs the systemd unit and starts the service.
#
# Usage:
#   sudo ./install.sh \
#     --server https://aigov.cloudfuze.com \
#     --enroll-secret <secret> \
#     --binary ./ai-gov-server-monitor

set -euo pipefail

SERVER=""
ENROLL=""
BINARY=""
LISTEN_HOST="127.0.0.1"
LISTEN_PORT="8443"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)         SERVER="$2"; shift 2 ;;
    --enroll-secret)  ENROLL="$2"; shift 2 ;;
    --binary)         BINARY="$2"; shift 2 ;;
    --listen-host)    LISTEN_HOST="$2"; shift 2 ;;
    --listen-port)    LISTEN_PORT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SERVER" || -z "$ENROLL" || -z "$BINARY" ]]; then
  echo "Usage: $0 --server URL --enroll-secret SECRET --binary PATH" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "must be run as root (use sudo)" >&2
  exit 1
fi

INSTALL_DIR="/opt/cloudfuze/server-monitor"
UNIT_DIR="/etc/systemd/system"
CA_DIR="/root/.cloudfuze-aigov/ca"
TRUSTED_CA="/usr/local/share/ca-certificates/cloudfuze-aigov.crt"
PROFILE_FILE="/etc/profile.d/cloudfuze-proxy.sh"

echo "[1/5] Installing daemon to $INSTALL_DIR…"
install -d -m 755 "$INSTALL_DIR"
install -m 755 "$BINARY" "$INSTALL_DIR/ai-gov-server-monitor"

echo "[2/5] First-run: generating CA + enrolling…"
# Boot the daemon briefly so it generates the CA and persists the enrollment
# token. We send SIGTERM after a short wait — it's clean shutdown for our daemon.
GOV_SERVER_URL="$SERVER" \
GOV_ENROLL_SECRET="$ENROLL" \
PROXY_LISTEN_HOST="$LISTEN_HOST" \
PROXY_LISTEN_PORT="$LISTEN_PORT" \
  "$INSTALL_DIR/ai-gov-server-monitor" &
PID=$!
sleep 3
kill -TERM $PID 2>/dev/null || true
wait $PID 2>/dev/null || true

if [[ ! -f "$CA_DIR/ca.crt" ]]; then
  echo "ERROR: CA was not generated. Aborting." >&2
  exit 1
fi

echo "[3/5] Installing CA into system trust store…"
install -m 644 "$CA_DIR/ca.crt" "$TRUSTED_CA"
update-ca-certificates

# Transparent port is proxy port + 1 (the daemon opens both automatically).
TRANSPARENT_PORT=$((LISTEN_PORT + 1))

echo "[4/6] Setting up iptables transparent redirect…"
# Redirect ALL outbound port-443 traffic through the transparent proxy.
# This captures every process on the server — already-running agents,
# new processes, cron jobs, Docker containers (host networking), everything.
# No HTTPS_PROXY env var needed. No process restart needed.
#
# --uid-owner 0: exclude root (the proxy daemon itself runs as root; without
# this exclusion the proxy's own outbound requests would loop back into itself).
# -d 127.0.0.0/8: exclude localhost (local model servers like ollama respond on
# 127.0.0.1, and we don't want to redirect their inbound traffic).

# Remove any old rules first (idempotent reinstall)
iptables -t nat -D OUTPUT -p tcp --dport 443 ! -d 127.0.0.0/8 -m owner ! --uid-owner 0 -j REDIRECT --to-port "$TRANSPARENT_PORT" 2>/dev/null || true

# Add the redirect rule
iptables -t nat -A OUTPUT -p tcp --dport 443 ! -d 127.0.0.0/8 -m owner ! --uid-owner 0 -j REDIRECT --to-port "$TRANSPARENT_PORT"

echo "    iptables: all port-443 traffic → localhost:$TRANSPARENT_PORT (transparent proxy)"

# Persist iptables rules across reboots
if command -v iptables-save >/dev/null 2>&1; then
  iptables-save > /etc/iptables.rules 2>/dev/null || true
  # Install restore-on-boot if not already present
  if [[ ! -f /etc/network/if-pre-up.d/iptables ]] && [[ -d /etc/network/if-pre-up.d ]]; then
    cat > /etc/network/if-pre-up.d/iptables <<'IPTEOF'
#!/bin/sh
iptables-restore < /etc/iptables.rules
IPTEOF
    chmod +x /etc/network/if-pre-up.d/iptables
  fi
fi

# Also set HTTPS_PROXY as fallback for processes that don't go through port 443
# directly (e.g. they use custom ports, or the OS doesn't support iptables).
echo "[5/6] Writing /etc/profile.d/cloudfuze-proxy.sh (fallback)…"
cat > "$PROFILE_FILE" <<EOF
# CloudFuze AI Governance — fallback for processes that bypass port 443.
# Primary interception is via iptables (transparent proxy), so this is backup.
export HTTPS_PROXY="http://$LISTEN_HOST:$LISTEN_PORT"
export HTTP_PROXY="http://$LISTEN_HOST:$LISTEN_PORT"
export NO_PROXY="$LISTEN_HOST:$LISTEN_PORT"
EOF
chmod 644 "$PROFILE_FILE"

if ! grep -q "^HTTPS_PROXY=" /etc/environment 2>/dev/null; then
  {
    echo "HTTPS_PROXY=\"http://$LISTEN_HOST:$LISTEN_PORT\""
    echo "HTTP_PROXY=\"http://$LISTEN_HOST:$LISTEN_PORT\""
    echo "NO_PROXY=\"$LISTEN_HOST:$LISTEN_PORT\""
  } >> /etc/environment
fi

echo "[6/6] Installing systemd unit…"
cat > "$UNIT_DIR/cloudfuze-server-monitor.service" <<EOF
[Unit]
Description=CloudFuze AI Governance — server-side agent monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# Must run as root to read /proc/<pid>/loginuid for processes owned by other
# users. /proc/<pid>/cmdline is world-readable but loginuid is not on hardened
# distros (mode 0400, owned by the process's uid).
User=root
Environment=GOV_SERVER_URL=$SERVER
Environment=GOV_ENROLL_SECRET=$ENROLL
Environment=PROXY_LISTEN_HOST=$LISTEN_HOST
Environment=PROXY_LISTEN_PORT=$LISTEN_PORT
ExecStart=$INSTALL_DIR/ai-gov-server-monitor
Restart=on-failure
RestartSec=10
# Tight security profile but still allows /proc reads + outbound network.
ProtectSystem=strict
ReadWritePaths=/etc/cloudfuze /root/.cloudfuze-aigov
ProtectHome=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cloudfuze-server-monitor.service

# [optional] auditd rules for model-file load signals (Tier 3 L5).
# We install + reload silently. If auditd isn't present we just skip — the
# daemon's audit watcher tolerates the missing log file.
if command -v augenrules >/dev/null 2>&1 && [[ -d /etc/audit/rules.d ]]; then
  install -m 640 "$(dirname "$0")/cloudfuze-aigov-models.rules" /etc/audit/rules.d/cloudfuze-aigov-models.rules
  augenrules --load >/dev/null 2>&1 || true
  systemctl restart auditd 2>/dev/null || service auditd restart 2>/dev/null || true
  echo "    Installed auditd rules for model-file load tracking."
else
  echo "    NOTE: auditd not installed — model-load signals (Tier 3) disabled."
  echo "    To enable: apt install auditd  (or)  yum install audit"
  echo "    Then re-run this installer."
fi

# [optional] Python in-process shim (Tier 3 L4).
# Drop sitecustomize.py + the package into a path that's added to PYTHONPATH
# in /etc/environment, so every new Python process auto-loads it.
SHIM_DIR="/usr/lib/cloudfuze-aigov"
PY_SHIM_SRC="$(dirname "$0")/py-shim"
if [[ -d "$PY_SHIM_SRC" ]]; then
  install -d -m 755 "$SHIM_DIR"
  cp -r "$PY_SHIM_SRC/cloudfuze_aigov_shim" "$SHIM_DIR/"
  install -m 644 "$PY_SHIM_SRC/sitecustomize.py" "$SHIM_DIR/sitecustomize.py"

  # Add SHIM_DIR to PYTHONPATH in /etc/environment.
  if ! grep -q "^PYTHONPATH=" /etc/environment 2>/dev/null; then
    echo "PYTHONPATH=\"$SHIM_DIR\"" >> /etc/environment
  elif ! grep -q "cloudfuze-aigov" /etc/environment 2>/dev/null; then
    sed -i.cloudfuze-bak "s|^PYTHONPATH=\"\\(.*\\)\"|PYTHONPATH=\"$SHIM_DIR:\\1\"|" /etc/environment
  fi
  echo "    Installed Python in-process shim at $SHIM_DIR (auto-loaded via PYTHONPATH)."
fi

echo
echo "✓ Installation complete."
echo "  Logs:        journalctl -u cloudfuze-server-monitor -f"
echo "  Status:      systemctl status cloudfuze-server-monitor"
echo "  Transparent: iptables REDIRECT port 443 → localhost:$TRANSPARENT_PORT"
echo "  Fallback:    HTTPS_PROXY=http://$LISTEN_HOST:$LISTEN_PORT"
echo "  Dashboard:   $SERVER  →  Server Monitor"
echo
echo "  ALL processes on this server (including already-running agents)"
echo "  are now governed via iptables. No restart needed."
