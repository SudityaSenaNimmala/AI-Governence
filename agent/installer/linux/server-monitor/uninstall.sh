#!/usr/bin/env bash
# Remove CloudFuze server-monitor from a Linux server.
#
# Tries to be conservative: removes the daemon + systemd unit + the CA from the
# trust store + the /etc/profile.d hook + the /etc/environment lines we added.
# Leaves the enrollment token in /etc/cloudfuze/ unless --purge is passed.

set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "must be run as root (use sudo)" >&2
  exit 1
fi

PURGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

systemctl disable --now cloudfuze-server-monitor.service 2>/dev/null || true
rm -f /etc/systemd/system/cloudfuze-server-monitor.service
systemctl daemon-reload

rm -f /usr/local/share/ca-certificates/cloudfuze-aigov.crt
update-ca-certificates --fresh

rm -f /etc/profile.d/cloudfuze-proxy.sh

# Strip the lines we added to /etc/environment.
if [[ -f /etc/environment ]]; then
  sed -i.cloudfuze-bak '/HTTPS_PROXY="http:\/\/127\.0\.0\.1:8443"/d;/HTTP_PROXY="http:\/\/127\.0\.0\.1:8443"/d;/^NO_PROXY="localhost,127\.0\.0\.0\/8,::1"$/d' /etc/environment
fi

rm -rf /opt/cloudfuze/server-monitor

if [[ $PURGE -eq 1 ]]; then
  rm -rf /etc/cloudfuze /root/.cloudfuze-aigov
fi

echo "✓ Uninstall complete."
echo "  Existing processes may still be using the proxy until they restart."
[[ $PURGE -eq 1 ]] && echo "  --purge: removed enrollment + CA."
