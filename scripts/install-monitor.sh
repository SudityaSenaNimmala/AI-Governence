#!/usr/bin/env bash
# CloudFuze Server Monitor — One-command installer
#
# Usage:
#   curl -sSL https://YOUR_INSTANCE/install-monitor.sh | sudo bash -s -- --token TOKEN
#
# What this does:
#   1. Installs Node.js 20+ if not present
#   2. Downloads the CloudFuze server-monitor
#   3. Generates a local CA certificate
#   4. Installs CA into the system trust store
#   5. Sets HTTPS_PROXY system-wide so all AI API calls are intercepted
#   6. Creates a systemd service (auto-starts on boot)
#   7. Enrolls with your CloudFuze governance instance
#
# To uninstall:
#   sudo cloudfuze-monitor uninstall

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/cloudfuze-monitor"
DATA_DIR="/etc/cloudfuze"
PROXY_PORT=8443
PROXY_HOST="127.0.0.1"
REMOTE_MODE=false
SERVICE_NAME="cloudfuze-monitor"
ENROLL_TOKEN=""
GOV_SERVER=""
ALLOWED_IPS=""

# ── Parse args ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   ENROLL_TOKEN="$2"; shift 2;;
    --server)  GOV_SERVER="$2"; shift 2;;
    --port)    PROXY_PORT="$2"; shift 2;;
    --remote)  REMOTE_MODE=true; shift;;
    --allow)   ALLOWED_IPS="$2"; shift 2;;
    uninstall) exec "$0" --do-uninstall; exit;;
    --do-uninstall)
      echo "Uninstalling CloudFuze Server Monitor..."
      systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      systemctl disable "$SERVICE_NAME" 2>/dev/null || true
      rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
      systemctl daemon-reload 2>/dev/null || true
      # Remove CA from trust store
      rm -f /usr/local/share/ca-certificates/cloudfuze-monitor.crt
      update-ca-certificates 2>/dev/null || true
      # Remove HTTPS_PROXY from /etc/environment
      sed -i '/cloudfuze-monitor/d' /etc/environment 2>/dev/null || true
      sed -i '/HTTPS_PROXY.*8443/d' /etc/environment 2>/dev/null || true
      # Remove firewall rules
      iptables -S INPUT 2>/dev/null | grep "cloudfuze-monitor" | while read -r rule; do
        iptables $(echo "$rule" | sed 's/^-A/-D/') 2>/dev/null || true
      done
      # Remove install dir
      rm -rf "$INSTALL_DIR" "$DATA_DIR"
      rm -f /usr/local/bin/cloudfuze-monitor
      echo "CloudFuze Server Monitor uninstalled."
      exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

if [[ -z "$ENROLL_TOKEN" ]]; then
  echo "ERROR: --token is required. Get it from your CloudFuze dashboard."
  echo "Usage: curl -sSL https://YOUR_INSTANCE/install-monitor.sh | sudo bash -s -- --token TOKEN"
  exit 1
fi

# ── Extract server URL from token ─────────────────────────────────────────
# Token format: cfm_BASE64(serverUrl|secret)
# If --server not provided, decode from token
if [[ -z "$GOV_SERVER" ]]; then
  # Try to decode token (format: cfm_base64payload)
  PAYLOAD="${ENROLL_TOKEN#cfm_}"
  DECODED=$(echo "$PAYLOAD" | base64 -d 2>/dev/null || true)
  if [[ "$DECODED" == *"|"* ]]; then
    GOV_SERVER="${DECODED%%|*}"
    ENROLL_SECRET="${DECODED#*|}"
  else
    echo "ERROR: Could not extract server URL from token. Use --server URL"
    exit 1
  fi
fi

# ── Remote mode: collect allowed IPs ──────────────────────────────────
if [[ "$REMOTE_MODE" == "true" ]]; then
  PROXY_HOST="0.0.0.0"
  if [[ -z "$ALLOWED_IPS" ]]; then
    echo ""
    echo "  ERROR: --remote requires --allow to specify which IPs can connect."
    echo ""
    echo "  Usage:"
    echo "    curl -sSL .../install-monitor.sh | sudo bash -s -- --token TOKEN --remote --allow 10.0.1.5,10.0.1.6"
    echo ""
    echo "  You can allow multiple IPs (comma-separated) or a subnet:"
    echo "    --allow 10.0.1.5,10.0.1.6,10.0.2.0/24"
    echo ""
    exit 1
  fi
fi

echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   CloudFuze Server Monitor — Installing...   ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""
echo "  Instance:  $GOV_SERVER"
echo "  Proxy:     $PROXY_HOST:$PROXY_PORT"
echo ""

# ── Check root ────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: This script must be run as root (sudo)."
  exit 1
fi

# ── Install Node.js if missing ────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  echo "[1/7] Installing Node.js 20..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  else
    echo "ERROR: Could not install Node.js. Install Node.js 20+ manually."
    exit 1
  fi
else
  echo "[1/7] Node.js $(node -v) found"
fi

# ── Download server-monitor ───────────────────────────────────────────────
echo "[2/7] Downloading CloudFuze server-monitor..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR"

REPO_TMP=$(mktemp -d)
echo "  Cloning repository..."
if ! git clone --depth 1 https://github.com/SudityaSenaNimmala/AI-Governence.git "$REPO_TMP/repo" 2>&1; then
  echo "  ERROR: git clone failed. Ensure git is installed and the server has internet access."
  rm -rf "$REPO_TMP"
  exit 1
fi

# Find the agent directory — could be at root or under "agent team/"
AGENT_SRC=""
for candidate in "$REPO_TMP/repo/agent" "$REPO_TMP/repo/agent team/agent"; do
  if [[ -d "$candidate/src/server-monitor" ]]; then
    AGENT_SRC="$candidate"
    break
  fi
done
if [[ -z "$AGENT_SRC" ]]; then
  echo "  ERROR: server-monitor not found in cloned repo."
  ls -la "$REPO_TMP/repo/" 2>/dev/null || true
  rm -rf "$REPO_TMP"
  exit 1
fi

cp -r "$AGENT_SRC/"* "$INSTALL_DIR/"
rm -rf "$REPO_TMP"
echo "  Files installed to $INSTALL_DIR"

# Install npm deps — skip optional native modules (better-sqlite3, tesseract)
# that need g++ but aren't used by the server-monitor (it uses MongoDB)
if [[ -f "$INSTALL_DIR/package.json" ]]; then
  echo "  Installing dependencies..."
  cd "$INSTALL_DIR"
  npm install --omit=dev --no-audit --no-fund --ignore-scripts 2>&1 || true
  # Rebuild only pure-JS native deps (node-forge for CA generation)
  npm rebuild node-forge 2>/dev/null || true
  echo "  Dependencies installed"
fi

# ── Generate CA ───────────────────────────────────────────────────────────
echo "[3/7] Generating CA certificate..."
export CFAI_DATA_DIR="$DATA_DIR"
# The CA is auto-generated on first run by the proxy engine

# ── Install CA into system trust store ────────────────────────────────────
echo "[4/7] Installing CA into system trust store..."
# CA will be generated on first run; we'll copy it after first start
# For now, create a post-start hook

# ── Set HTTPS_PROXY system-wide ───────────────────────────────────────────
if [[ "$REMOTE_MODE" == "true" ]]; then
  echo "[5/7] Remote mode — skipping system proxy config (set HTTPS_PROXY on target servers instead)"
else
  echo "[5/7] Configuring system-wide HTTPS proxy..."
  sed -i '/cloudfuze-monitor/d' /etc/environment 2>/dev/null || true
  sed -i '/HTTPS_PROXY.*'"$PROXY_PORT"'/d' /etc/environment 2>/dev/null || true
  echo "# cloudfuze-monitor — AI API governance proxy" >> /etc/environment
  echo "HTTPS_PROXY=http://${PROXY_HOST}:${PROXY_PORT}" >> /etc/environment
  echo "https_proxy=http://${PROXY_HOST}:${PROXY_PORT}" >> /etc/environment
  export HTTPS_PROXY="http://${PROXY_HOST}:${PROXY_PORT}"
fi

# ── Create systemd service ────────────────────────────────────────────────
echo "[6/7] Creating systemd service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << UNIT
[Unit]
Description=CloudFuze Server Monitor — AI API governance proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=GOV_SERVER_URL=$GOV_SERVER
Environment=GOV_ENROLL_SECRET=$ENROLL_SECRET
Environment=PROXY_LISTEN_HOST=$PROXY_HOST
Environment=PROXY_LISTEN_PORT=$PROXY_PORT
Environment=CFAI_DATA_DIR=$DATA_DIR
Environment=TOKEN_FILE=$DATA_DIR/monitor-token.json
ExecStart=$(which node) src/server-monitor/index.js
Restart=always
RestartSec=5

# Post-start: install CA into system trust store
ExecStartPost=/bin/bash -c 'sleep 2 && cp $DATA_DIR/ca/ca.crt /usr/local/share/ca-certificates/cloudfuze-monitor.crt 2>/dev/null && update-ca-certificates 2>/dev/null || true'

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

# ── Firewall: restrict proxy port to allowed IPs only ─────────────────
if [[ "$REMOTE_MODE" == "true" && -n "$ALLOWED_IPS" ]]; then
  echo "[6.5/7] Configuring firewall — only allowing: $ALLOWED_IPS"
  # Use iptables (available on all Linux distros)
  # First remove any existing cloudfuze rules
  iptables -D INPUT -p tcp --dport "$PROXY_PORT" -j DROP 2>/dev/null || true
  iptables -S INPUT 2>/dev/null | grep "cloudfuze-monitor" | while read -r rule; do
    iptables $(echo "$rule" | sed 's/^-A/-D/') 2>/dev/null || true
  done

  # Allow each specified IP
  IFS=',' read -ra IPS <<< "$ALLOWED_IPS"
  for ip in "${IPS[@]}"; do
    ip=$(echo "$ip" | xargs)  # trim whitespace
    if [[ -n "$ip" ]]; then
      iptables -A INPUT -p tcp --dport "$PROXY_PORT" -s "$ip" -m comment --comment "cloudfuze-monitor" -j ACCEPT
      echo "  ✓ Allowed: $ip"
    fi
  done
  # Allow localhost always
  iptables -A INPUT -p tcp --dport "$PROXY_PORT" -s 127.0.0.1 -m comment --comment "cloudfuze-monitor" -j ACCEPT
  # Drop everything else to this port
  iptables -A INPUT -p tcp --dport "$PROXY_PORT" -m comment --comment "cloudfuze-monitor" -j DROP
  echo "  ✓ All other IPs blocked on port $PROXY_PORT"

  # Persist iptables rules across reboots
  if command -v netfilter-persistent &>/dev/null; then
    netfilter-persistent save 2>/dev/null || true
  elif command -v iptables-save &>/dev/null; then
    iptables-save > /etc/iptables.rules 2>/dev/null || true
  fi
fi

# Wait for startup
sleep 3

# ── Create uninstall command ──────────────────────────────────────────────
cat > /usr/local/bin/cloudfuze-monitor << 'WRAPPER'
#!/bin/bash
case "$1" in
  uninstall) exec /opt/cloudfuze-monitor/scripts/install-monitor.sh --do-uninstall;;
  status)    systemctl status cloudfuze-monitor;;
  logs)      journalctl -u cloudfuze-monitor -f;;
  restart)   systemctl restart cloudfuze-monitor;;
  *) echo "Usage: cloudfuze-monitor {status|logs|restart|uninstall}";;
esac
WRAPPER
chmod +x /usr/local/bin/cloudfuze-monitor

# ── Enroll and verify ─────────────────────────────────────────────────────
echo "[7/7] Enrolling with governance server..."
sleep 2

# Check if service is running
if systemctl is-active --quiet "$SERVICE_NAME"; then
  # Get machine ID from the enrollment
  MACHINE_ID=$(cat "$DATA_DIR/monitor-token.json" 2>/dev/null | grep -o '"machineId":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  SERVER_ID="srv-$(echo "$MACHINE_ID" | head -c 8)"

  MONITOR_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "$PROXY_HOST")
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║   CloudFuze Server Monitor — Installed Successfully!    ║"
  echo "  ╠══════════════════════════════════════════════════════════╣"
  echo "  ║                                                        ║"
  echo "  ║   Server ID:   $SERVER_ID"
  echo "  ║   Status:      Active"
  echo "  ║   Proxy:       $PROXY_HOST:$PROXY_PORT"
  echo "  ║   Instance:    $GOV_SERVER"
  echo "  ║                                                        ║"
  if [[ "$REMOTE_MODE" == "true" ]]; then
  echo "  ║   REMOTE MODE — monitoring remote servers              ║"
  echo "  ║   Allowed IPs: $ALLOWED_IPS"
  echo "  ║                                                        ║"
  echo "  ║   On each allowed server, run:                         ║"
  echo "  ║     export HTTPS_PROXY=http://${MONITOR_IP}:${PROXY_PORT}"
  echo "  ║                                                        ║"
  echo "  ║   That's it. One env var, nothing else installed.      ║"
  else
  echo "  ║   All AI API calls from this server are now monitored. ║"
  fi
  echo "  ║                                                        ║"
  echo "  ║   View traces: Dashboard → AI Hub → Server Monitor     ║"
  echo "  ║                                                        ║"
  echo "  ║   Commands:                                            ║"
  echo "  ║     cloudfuze-monitor status    — check service status  ║"
  echo "  ║     cloudfuze-monitor logs      — view live logs        ║"
  echo "  ║     cloudfuze-monitor restart   — restart the service   ║"
  echo "  ║     cloudfuze-monitor uninstall — remove completely     ║"
  echo "  ║                                                        ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo ""
else
  echo ""
  echo "  WARNING: Service failed to start. Check logs:"
  echo "    journalctl -u $SERVICE_NAME -n 50"
  echo ""
  exit 1
fi
