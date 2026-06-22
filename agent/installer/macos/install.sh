#!/usr/bin/env bash
# Install CloudFuze AI Governance Agent on macOS.
#
# Usage:
#   sudo ./install.sh \
#     --server https://aigov.cloudfuze.com \
#     --enroll-secret <secret> \
#     --binary ./ai-gov-agent

set -euo pipefail

SERVER=""
ENROLL=""
BINARY=""
RUN_DAILY_HOUR="9"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)         SERVER="$2"; shift 2 ;;
    --enroll-secret)  ENROLL="$2"; shift 2 ;;
    --binary)         BINARY="$2"; shift 2 ;;
    --hour)           RUN_DAILY_HOUR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SERVER" || -z "$ENROLL" || -z "$BINARY" ]]; then
  echo "Usage: $0 --server URL --enroll-secret SECRET --binary PATH" >&2
  exit 1
fi

INSTALL_DIR="/usr/local/cloudfuze/aigov"
PLIST_PATH="/Library/LaunchAgents/com.cloudfuze.aigov.plist"

echo "Installing to $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo cp "$BINARY" "$INSTALL_DIR/ai-gov-agent"
sudo chmod 755 "$INSTALL_DIR/ai-gov-agent"

echo "Performing first-time enrollment..."
"$INSTALL_DIR/ai-gov-agent" --server "$SERVER" --enroll-secret "$ENROLL" --dry-run

echo "Installing LaunchAgent..."
sudo tee "$PLIST_PATH" > /dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>com.cloudfuze.aigov</string>
  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_DIR/ai-gov-agent</string>
    <string>--server</string>
    <string>$SERVER</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>   <integer>$RUN_DAILY_HOUR</integer>
    <key>Minute</key> <integer>0</integer>
  </dict>
  <key>RunAtLoad</key> <false/>
  <key>StandardOutPath</key> <string>/var/log/cloudfuze-aigov.log</string>
  <key>StandardErrorPath</key> <string>/var/log/cloudfuze-aigov.log</string>
</dict>
</plist>
EOF

sudo chmod 644 "$PLIST_PATH"
sudo launchctl load -w "$PLIST_PATH" 2>/dev/null || true

echo "Installation complete."
