#!/usr/bin/env bash
# Remove CloudFuze server-monitor from macOS. Run with sudo.
# --purge also removes the enrollment token + CA on disk.

set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Must be run with sudo." >&2; exit 1
fi

PURGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

PLIST_PATH="/Library/LaunchDaemons/com.cloudfuze.server-monitor.plist"
INSTALL_DIR="/usr/local/cloudfuze/server-monitor"
TOKEN_DIR="/etc/cloudfuze"
CA_DIR="/var/root/.cloudfuze-aigov"

launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"

# Remove CloudFuze certs from the System keychain.
security find-certificate -a -c "CloudFuze AI Governance Root CA" -Z /Library/Keychains/System.keychain 2>/dev/null \
  | awk '/SHA-1 hash/{print $NF}' \
  | while read -r hash; do
      security delete-certificate -Z "$hash" /Library/Keychains/System.keychain 2>/dev/null || true
    done

launchctl unsetenv HTTPS_PROXY 2>/dev/null || true
launchctl unsetenv HTTP_PROXY  2>/dev/null || true
launchctl unsetenv NO_PROXY    2>/dev/null || true

# Strip persisted lines from /etc/zshenv and /etc/bashrc.
for f in /etc/zshenv /etc/bashrc; do
  if [[ -f "$f" ]] && grep -q "CloudFuze AI Governance — server-monitor proxy" "$f"; then
    # Delete the comment line + the next 3 export lines.
    sed -i.cloudfuze-bak '/CloudFuze AI Governance — server-monitor proxy/,+3d' "$f"
  fi
done

rm -rf "$INSTALL_DIR"

if [[ $PURGE -eq 1 ]]; then
  rm -rf "$TOKEN_DIR" "$CA_DIR"
  echo "Purged enrollment + CA."
fi

echo "OK Uninstall complete."
echo "    Existing processes may still be using the proxy until they restart."
