#!/usr/bin/env bash
# Install CloudFuze server-monitor daemon on macOS.
#
# What this does:
#   1. Drops the bundled daemon binary under /usr/local/cloudfuze/server-monitor
#   2. Generates the CA on first run, then installs it into the System keychain
#      (trusted for SSL by every user on the box).
#   3. Sets HTTPS_PROXY system-wide via launchctl setenv + /etc/zshenv + /etc/bashrc.
#   4. Installs the LaunchDaemon plist and loads it.
#
# Run with sudo.
#
# macOS has stricter signing requirements than Linux. The bundled binary should
# ideally be signed + notarized; for v1 the installer warns if it isn't.

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
  echo "Usage: sudo $0 --server URL --enroll-secret SECRET --binary PATH" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Must be run with sudo." >&2; exit 1
fi

INSTALL_DIR="/usr/local/cloudfuze/server-monitor"
TOKEN_DIR="/etc/cloudfuze"
CA_PATH="/var/root/.cloudfuze-aigov/ca/ca.crt"
PLIST_PATH="/Library/LaunchDaemons/com.cloudfuze.server-monitor.plist"
SERVICE_LABEL="com.cloudfuze.server-monitor"
SHELLENV_FILE="/etc/zshenv"            # zsh is the default since macOS 10.15
BASHENV_FILE="/etc/bashrc"

echo "[1/5] Installing daemon to $INSTALL_DIR..."
install -d -m 755 "$INSTALL_DIR"
install -d -m 755 "$TOKEN_DIR"
install -m 755 "$BINARY" "$INSTALL_DIR/ai-gov-server-monitor"

# Quick check: is the binary signed? If not, macOS will refuse to launch it
# without a Gatekeeper override. We warn rather than fail so dev installs work.
if ! codesign -dv "$INSTALL_DIR/ai-gov-server-monitor" 2>/dev/null; then
  echo "    WARN: binary is not codesigned. On end-user macOS Gatekeeper may"
  echo "    block it. For production, sign + notarize with a Developer ID."
fi

echo "[2/5] First-run: generating CA + enrolling..."
sudo -H GOV_SERVER_URL="$SERVER" \
        GOV_ENROLL_SECRET="$ENROLL" \
        PROXY_LISTEN_HOST="$LISTEN_HOST" \
        PROXY_LISTEN_PORT="$LISTEN_PORT" \
        TOKEN_FILE="$TOKEN_DIR/server-monitor.token.json" \
  "$INSTALL_DIR/ai-gov-server-monitor" &
PID=$!
sleep 4
kill -TERM $PID 2>/dev/null || true
wait $PID 2>/dev/null || true

if [[ ! -f "$CA_PATH" ]]; then
  echo "ERROR: CA was not generated at $CA_PATH. Aborting." >&2
  exit 1
fi

echo "[3/5] Trusting CA in the System keychain..."
# Adds the cert with SSL-trust scoped to LocalRootCA. -d = add to admin/system
# domain rather than user. SIP doesn't block this — System.keychain is writable
# by admin auth.
security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CA_PATH"

echo "[4/5] Setting HTTPS_PROXY system-wide..."
PROXY_URL="http://$LISTEN_HOST:$LISTEN_PORT"

# launchctl setenv injects into the launchd environment, picked up by any
# subsequently-started LaunchAgent / LaunchDaemon (including GUI app launches).
launchctl setenv HTTPS_PROXY "$PROXY_URL"
launchctl setenv HTTP_PROXY  "$PROXY_URL"
# NO_PROXY intentionally excludes only the proxy itself, NOT localhost,
# so Tier 2 localhost intercept catches ollama / vLLM / llama.cpp.
# Non-LLM localhost traffic bridges untouched at the socket layer.
launchctl setenv NO_PROXY    "$LISTEN_HOST:$LISTEN_PORT"

# Persist across reboots via /etc/zshenv (zsh) and /etc/bashrc (bash 3.x).
# zshenv is sourced for every zsh invocation type incl. non-interactive.
for f in "$SHELLENV_FILE" "$BASHENV_FILE"; do
  touch "$f"
  if ! grep -q "CloudFuze AI Governance — server-monitor proxy" "$f" 2>/dev/null; then
    cat >> "$f" <<EOF

# CloudFuze AI Governance — server-monitor proxy
export HTTPS_PROXY="$PROXY_URL"
export HTTP_PROXY="$PROXY_URL"
export NO_PROXY="$LISTEN_HOST:$LISTEN_PORT"
EOF
  fi
done

echo "[5/5] Installing LaunchDaemon..."
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SERVICE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_DIR/ai-gov-server-monitor</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GOV_SERVER_URL</key>     <string>$SERVER</string>
    <key>GOV_ENROLL_SECRET</key>  <string>$ENROLL</string>
    <key>PROXY_LISTEN_HOST</key>  <string>$LISTEN_HOST</string>
    <key>PROXY_LISTEN_PORT</key>  <string>$LISTEN_PORT</string>
    <key>TOKEN_FILE</key>         <string>$TOKEN_DIR/server-monitor.token.json</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/cloudfuze-server-monitor.log</string>
  <key>StandardErrorPath</key><string>/var/log/cloudfuze-server-monitor.err</string>
  <key>UserName</key><string>root</string>
</dict>
</plist>
EOF
chmod 644 "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"

# Unload any previous instance, then load fresh.
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo
echo "OK Installation complete."
echo "    Status:    sudo launchctl list | grep $SERVICE_LABEL"
echo "    Logs:      tail -f /var/log/cloudfuze-server-monitor.log"
echo "    Proxy:     $LISTEN_HOST:$LISTEN_PORT (HTTPS_PROXY set system-wide)"
echo "    Dashboard: $SERVER  ->  Server agents"
echo
echo "    IMPORTANT: existing processes (GUI apps already open, agents already"
echo "    running, signed-in user sessions) will NOT pick up the new HTTPS_PROXY"
echo "    until they restart. Log out + back in, or reboot, for full coverage."
