#!/usr/bin/env bash
# Install CloudFuze AI Governance Agent on Linux (systemd-based distros).
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
RUN_DAILY="09:00"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)         SERVER="$2"; shift 2 ;;
    --enroll-secret)  ENROLL="$2"; shift 2 ;;
    --binary)         BINARY="$2"; shift 2 ;;
    --time)           RUN_DAILY="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SERVER" || -z "$ENROLL" || -z "$BINARY" ]]; then
  echo "Usage: $0 --server URL --enroll-secret SECRET --binary PATH" >&2
  exit 1
fi

INSTALL_DIR="/opt/cloudfuze/aigov"
UNIT_DIR="/etc/systemd/system"

echo "Installing to $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo cp "$BINARY" "$INSTALL_DIR/ai-gov-agent"
sudo chmod 755 "$INSTALL_DIR/ai-gov-agent"

echo "Performing first-time enrollment..."
"$INSTALL_DIR/ai-gov-agent" --server "$SERVER" --enroll-secret "$ENROLL" --dry-run

echo "Writing systemd service + timer..."
sudo tee "$UNIT_DIR/cloudfuze-aigov.service" > /dev/null <<EOF
[Unit]
Description=CloudFuze AI Governance Agent — daily scan

[Service]
Type=oneshot
ExecStart=$INSTALL_DIR/ai-gov-agent --server $SERVER
EOF

sudo tee "$UNIT_DIR/cloudfuze-aigov.timer" > /dev/null <<EOF
[Unit]
Description=Run CloudFuze AI Governance Agent daily

[Timer]
OnCalendar=*-*-* $RUN_DAILY:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudfuze-aigov.timer

echo "Installation complete."
sudo systemctl list-timers | grep cloudfuze-aigov || true
