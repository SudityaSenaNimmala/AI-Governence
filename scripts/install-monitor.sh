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

# ── Clear any leftover proxy from a previous install ─────────────────────
# A prior CloudFuze install sets HTTPS_PROXY pointing to the local proxy.
# If the proxy service is stopped/broken, every outbound HTTPS call (including
# git clone below) fails. Clear it before doing anything networked.
unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy NO_PROXY no_proxy 2>/dev/null || true
export HTTPS_PROXY="" HTTP_PROXY="" https_proxy="" http_proxy=""

# ── Defaults ──────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/cloudfuze-monitor"
DATA_DIR="/etc/cloudfuze"
PROXY_PORT=8443
PROXY_HOST="0.0.0.0"
REMOTE_MODE=false
SERVICE_NAME="cloudfuze-monitor"
ENROLL_TOKEN=""
GOV_SERVER=""
ALLOWED_IPS=""
REFRESH_CLI_ONLY=false

# ── Parse args ────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)   ENROLL_TOKEN="$2"; shift 2;;
    --server)  GOV_SERVER="$2"; shift 2;;
    --port)    PROXY_PORT="$2"; shift 2;;
    --refresh-cli) REFRESH_CLI_ONLY=true; shift;;
    --remote)  REMOTE_MODE=true; shift;;
    --allow)   ALLOWED_IPS="$2"; shift 2;;
    ,*) ALLOWED_IPS="${ALLOWED_IPS}${1}"; shift;;
    [0-9]*) if [[ -n "$ALLOWED_IPS" ]]; then ALLOWED_IPS="${ALLOWED_IPS},${1}"; else ALLOWED_IPS="$1"; fi; shift;;
    uninstall) exec "$0" --do-uninstall; exit;;
    --do-uninstall)
      echo "Uninstalling CloudFuze Server Monitor..."
      echo ""

      # Step 1: Ungovernable all governed containers
      echo "  [1/6] Removing governance from Docker containers..."
      if command -v docker &>/dev/null; then
        # Find all containers that have our env vars
        for CID in $(docker ps -aq 2>/dev/null); do
          HAS_CFZ=$(docker inspect --format '{{range .Config.Env}}{{.}} {{end}}' "$CID" 2>/dev/null | grep -c "NODE_EXTRA_CA_CERTS=/certs/cloudfuze.crt" || true)
          if [[ "$HAS_CFZ" -gt 0 ]]; then
            CNAME=$(docker inspect --format '{{.Name}}' "$CID" 2>/dev/null | sed 's|^/||')
            echo "    Cleaning $CNAME..."
            CONFIG="/var/lib/docker/containers/$CID/config.v2.json"
            docker stop "$CNAME" >/dev/null 2>&1
            python3 -c "
import json
remove = {'HTTPS_PROXY', 'https_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'}
with open('$CONFIG') as f: c=json.load(f)
c['Config']['Env']=[e for e in c['Config']['Env'] if e.split('=')[0] not in remove]
with open('$CONFIG','w') as f: json.dump(c,f)
" 2>/dev/null
            docker start "$CNAME" >/dev/null 2>&1
            echo "    [OK] $CNAME restored"
          fi
        done
      fi

      # Step 2: Remove ALL iptables DNAT/REDIRECT rules we created
      echo "  [2/6] Removing iptables rules..."
      # Get proxy port from service file before we delete it
      PPORT=$(grep PROXY_LISTEN_PORT /etc/systemd/system/cloudfuze-monitor.service 2>/dev/null | head -1 | sed 's/.*=//' || echo "")
      if [[ -n "$PPORT" ]]; then
        iptables -t nat -S PREROUTING 2>/dev/null | grep "$PPORT" | while read -r rule; do
          iptables -t nat $(echo "$rule" | sed 's/^-A/-D/') 2>/dev/null || true
        done
      fi
      # Also clean any rules mentioning cloudfuze
      iptables -t nat -S PREROUTING 2>/dev/null | grep -i "cloudfuze" | while read -r rule; do
        iptables -t nat $(echo "$rule" | sed 's/^-A/-D/') 2>/dev/null || true
      done

      # Step 3: Remove UFW rule
      echo "  [3/6] Removing firewall rules..."
      if command -v ufw &>/dev/null && [[ -n "$PPORT" ]]; then
        ufw delete allow from 172.16.0.0/12 to any port "$PPORT" 2>/dev/null || true
      fi

      # Step 4: Stop and remove service
      echo "  [4/6] Removing service..."
      systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      systemctl disable "$SERVICE_NAME" 2>/dev/null || true
      rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
      systemctl daemon-reload 2>/dev/null || true

      # Step 5: Remove CA from trust store + proxy env vars
      echo "  [5/6] Removing CA and proxy config..."
      rm -f /usr/local/share/ca-certificates/cloudfuze-monitor.crt
      update-ca-certificates 2>/dev/null || true
      sed -i '/cloudfuze-monitor/d' /etc/environment 2>/dev/null || true
      sed -i '/HTTPS_PROXY/d' /etc/environment 2>/dev/null || true
      sed -i '/https_proxy/d' /etc/environment 2>/dev/null || true
      rm -f /etc/profile.d/cloudfuze-proxy.sh 2>/dev/null

      # Step 6: Remove all files
      echo "  [6/6] Removing files..."
      rm -rf "$INSTALL_DIR" "$DATA_DIR" /root/.cloudfuze-aigov
      rm -f /usr/local/bin/cloudfuze-monitor

      echo ""
      echo "  CloudFuze Server Monitor completely uninstalled."
      echo "  All containers restored. All rules removed. Server is clean."
      exit 0;;
    *) echo "Unknown arg: $1"; exit 1;;
  esac
done

# ── Refresh CLI only mode (called by update script) ──────────────────────
if [[ "$REFRESH_CLI_ONLY" == "true" ]]; then
  # Skip the entire install — just jump to writing the CLI wrapper and exit.
  # We use a trick: set a var and let the script fall through past all the
  # guarded sections (they check ENROLL_TOKEN which is empty, so they exit).
  # Instead, just grep+source won't work with heredocs, so we take a
  # different approach: the update script copies install-monitor.sh to the
  # server, then runs it with --refresh-cli. We simply need to write the
  # wrapper file. Rather than extracting from self, we have the update
  # script handle it directly. Exit here — the update script does the work.
  exit 0
fi

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
ExecStartPost=/bin/bash -c 'sleep 2 && cp /root/.cloudfuze-aigov/ca/ca.crt /usr/local/share/ca-certificates/cloudfuze-monitor.crt 2>/dev/null && update-ca-certificates 2>/dev/null || true'

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

# Wait for startup + CA generation
sleep 3

# ── Open firewall for Docker containers to reach proxy ────────────────────
if command -v ufw &>/dev/null; then
  ufw allow from 172.16.0.0/12 to any port "$PROXY_PORT" comment "cloudfuze-monitor" 2>/dev/null || true
fi

# ── Create CLI tool ──────────────────────────────────────────────────────
cat > /usr/local/bin/cloudfuze-monitor << 'WRAPPER'
#!/bin/bash
DATA_DIR="/etc/cloudfuze"
SERVICE="cloudfuze-monitor"
CA_CERT="/root/.cloudfuze-aigov/ca/ca.crt"
DOCKER_CA="/etc/cloudfuze/docker-ca.crt"

case "$1" in
  status)
    systemctl status $SERVICE
    ;;
  logs)
    journalctl -u $SERVICE -f
    ;;
  restart)
    systemctl restart $SERVICE
    echo "Service restarted."
    ;;
  update)
    echo "Fetching update script..."
    GOV_URL=$(grep GOV_SERVER_URL /etc/systemd/system/$SERVICE.service 2>/dev/null | head -1 | sed 's/.*=//')
    if [[ -n "$GOV_URL" ]]; then
      curl -sSL "$GOV_URL/update-monitor.sh" | bash
    else
      echo "ERROR: Could not determine governance server URL."
    fi
    ;;
  govern)
    if [[ $EUID -ne 0 ]]; then echo "Must run as root (use sudo)"; exit 1; fi
    if ! command -v docker &>/dev/null; then echo "Docker not found."; exit 1; fi

    PROXY_PORT=$(grep PROXY_LISTEN_PORT /etc/systemd/system/$SERVICE.service 2>/dev/null | head -1 | sed 's/.*=//' || echo "8443")

    while true; do
      echo ""
      read -p "  Enter container name (or 'done'): " INPUT
      [[ "$INPUT" == "done" || "$INPUT" == "q" || -z "$INPUT" ]] && break

      # Exact match first
      TARGET=""
      if docker inspect --format '{{.Name}}' "$INPUT" &>/dev/null; then
        TARGET="$INPUT"
      else
        # Fuzzy match
        MATCHES=()
        IL=$(echo "$INPUT" | tr '[:upper:]' '[:lower:]')
        while IFS= read -r c; do
          CL=$(echo "$c" | tr '[:upper:]' '[:lower:]')
          [[ "$CL" == *"$IL"* ]] && MATCHES+=("$c")
        done < <(docker ps --format '{{.Names}}' 2>/dev/null)

        if [[ ${#MATCHES[@]} -eq 0 ]]; then
          echo "  No container matching '$INPUT' found."
          continue
        elif [[ ${#MATCHES[@]} -eq 1 ]]; then
          TARGET="${MATCHES[0]}"
          echo "  Found: $TARGET"
        else
          echo ""
          echo "  Did you mean:"
          for i in "${!MATCHES[@]}"; do
            echo "    $((i+1)). ${MATCHES[$i]}"
          done
          read -p "  Select number: " MN
          if [[ "$MN" =~ ^[0-9]+$ ]] && (( MN >= 1 && MN <= ${#MATCHES[@]} )); then
            TARGET="${MATCHES[$((MN-1))]}"
          else
            echo "  Invalid selection."; continue
          fi
        fi
      fi

      # Get container's internal IP
      CONTAINER_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$TARGET" 2>/dev/null)
      if [[ -z "$CONTAINER_IP" ]]; then
        echo "  [!] Could not find IP for $TARGET. Is it running?"
        continue
      fi

      # Find docker-compose project dir and service name
      COMPOSE_DIR=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$TARGET" 2>/dev/null)
      COMPOSE_SVC=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$TARGET" 2>/dev/null)

      echo ""
      echo "  Container: $TARGET"
      echo "  IP:        $CONTAINER_IP"

      CA_FILE="/root/.cloudfuze-aigov/ca/ca.crt"
      if [[ ! -f "$CA_FILE" ]]; then
        echo "  [!] CA cert not found at $CA_FILE. Is the monitor running?"
        continue
      fi

      # Get gateway IP for DNAT target
      GW_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}' "$TARGET" 2>/dev/null)
      if [[ -z "$GW_IP" ]]; then GW_IP="172.17.0.1"; fi

      echo "  Gateway:   $GW_IP"
      echo ""

      # Step 1: Copy CA cert into running container
      echo "  [1/4] Copying CA cert..."
      docker exec "$TARGET" mkdir -p /certs 2>/dev/null || true
      # Use tar pipe to handle "device busy" edge case
      tar -cf - -C "$(dirname "$CA_FILE")" "$(basename "$CA_FILE")" 2>/dev/null | docker exec -i "$TARGET" tar -xf - -C /certs/ 2>/dev/null
      docker exec "$TARGET" mv /certs/ca.crt /certs/cloudfuze.crt 2>/dev/null || true
      echo "  [OK] CA cert at /certs/cloudfuze.crt"

      # Step 2: Stop container, add env vars to config
      echo "  [2/4] Adding env vars..."
      CID=$(docker inspect --format '{{.Id}}' "$TARGET" 2>/dev/null)
      CONFIG_FILE="/var/lib/docker/containers/$CID/config.v2.json"

      docker stop "$TARGET" >/dev/null 2>&1

      python3 -c "
import json
cfg_path = '$CONFIG_FILE'
proxy = 'HTTPS_PROXY=http://${GW_IP}:${PROXY_PORT}'
proxy_lower = 'https_proxy=http://${GW_IP}:${PROXY_PORT}'
extra = [proxy, proxy_lower, 'NODE_EXTRA_CA_CERTS=/certs/cloudfuze.crt', 'SSL_CERT_FILE=/certs/cloudfuze.crt', 'REQUESTS_CA_BUNDLE=/certs/cloudfuze.crt']
remove = {'HTTPS_PROXY', 'https_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'}
with open(cfg_path, 'r') as f:
    cfg = json.load(f)
env = cfg.get('Config', {}).get('Env', []) or []
env = [e for e in env if e.split('=')[0] not in remove]
env.extend(extra)
cfg['Config']['Env'] = env
with open(cfg_path, 'w') as f:
    json.dump(cfg, f)
print('OK')
" 2>/dev/null
      echo "  [OK] Env vars added"

      # Step 3: Start container
      echo "  [3/4] Starting container..."
      docker start "$TARGET" >/dev/null 2>&1
      sleep 3

      if ! docker inspect --format '{{.State.Running}}' "$TARGET" 2>/dev/null | grep -q true; then
        echo "  [!] Container failed to start. Check: docker logs $TARGET"
        echo "  Reverting env vars..."
        docker stop "$TARGET" >/dev/null 2>&1
        python3 -c "
import json
cfg_path = '$CONFIG_FILE'
remove = {'HTTPS_PROXY', 'https_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'}
with open(cfg_path, 'r') as f:
    cfg = json.load(f)
env = cfg.get('Config', {}).get('Env', []) or []
env = [e for e in env if e.split('=')[0] not in remove]
cfg['Config']['Env'] = env
with open(cfg_path, 'w') as f:
    json.dump(cfg, f)
" 2>/dev/null
        docker start "$TARGET" >/dev/null 2>&1
        echo "  Reverted. Container restored."
        continue
      fi

      # Step 4: Add DNAT iptables rule for this container only
      echo "  [4/4] Adding network rule..."
      NEW_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$TARGET" 2>/dev/null)
      RULE_IP="${NEW_IP:-$CONTAINER_IP}"
      iptables -t nat -D PREROUTING -s "$RULE_IP" -p tcp --dport 443 -j DNAT --to-destination "${GW_IP}:${PROXY_PORT}" 2>/dev/null || true
      iptables -t nat -A PREROUTING -s "$RULE_IP" -p tcp --dport 443 -j DNAT --to-destination "${GW_IP}:${PROXY_PORT}" 2>/dev/null

      # Register with governance server
      TOKEN_FILE="$DATA_DIR/monitor-token.json"
      GOV_URL=$(grep GOV_SERVER_URL /etc/systemd/system/$SERVICE.service 2>/dev/null | head -1 | sed 's/.*=//')
      if [[ -f "$TOKEN_FILE" && -n "$GOV_URL" ]]; then
        TOKEN=$(python3 -c "import json; print(json.load(open('$TOKEN_FILE'))['token'])" 2>/dev/null)
        if [[ -n "$TOKEN" ]]; then
          curl -s -X POST "$GOV_URL/api/v1/monitor/governed" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"container_name\":\"$TARGET\",\"container_ip\":\"$RULE_IP\",\"gateway_ip\":\"$GW_IP\"}" >/dev/null 2>&1
        fi
      fi

      echo ""
      echo "  [OK] $TARGET -- fully governed"
      echo "       Provider, model, tokens, cost, prompt, response -- all tracked."
      echo ""
      echo "  To remove: sudo cloudfuze-monitor ungovernable $TARGET"

      echo ""
      echo "  To remove governance:"
      echo "    sudo cloudfuze-monitor ungovernable $TARGET"

      echo ""
      read -p "  Govern another container? (y/n): " MORE
      [[ ! "$MORE" =~ ^[Yy] ]] && break
    done
    echo ""
    ;;
  ungovernable)
    if [[ $EUID -ne 0 ]]; then echo "Must run as root (use sudo)"; exit 1; fi
    if [[ -z "$2" ]]; then echo "Usage: cloudfuze-monitor ungovernable <container_name>"; exit 1; fi

    TARGET="$2"
    CONTAINER_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$TARGET" 2>/dev/null)
    PROXY_PORT=$(grep PROXY_LISTEN_PORT /etc/systemd/system/$SERVICE.service 2>/dev/null | head -1 | sed 's/.*=//' || echo "8443")

    # Remove all DNAT rules for this container's IP
    if [[ -n "$CONTAINER_IP" ]]; then
      iptables -t nat -S PREROUTING 2>/dev/null | grep "$CONTAINER_IP" | while read -r rule; do
        iptables -t nat $(echo "$rule" | sed 's/^-A/-D/') 2>/dev/null || true
      done
      echo "  [OK] Network rules removed"
    fi

    # Remove env vars from container config and restart
    CID=$(docker inspect --format '{{.Id}}' "$TARGET" 2>/dev/null)
    CONFIG_FILE="/var/lib/docker/containers/$CID/config.v2.json"

    if [[ -f "$CONFIG_FILE" ]]; then
      echo "  Removing governance env vars..."
      docker stop "$TARGET" >/dev/null 2>&1
      python3 -c "
import json
cfg_path = '$CONFIG_FILE'
remove = {'HTTPS_PROXY', 'https_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'}
with open(cfg_path, 'r') as f:
    cfg = json.load(f)
env = cfg.get('Config', {}).get('Env', []) or []
env = [e for e in env if e.split('=')[0] not in remove]
cfg['Config']['Env'] = env
with open(cfg_path, 'w') as f:
    json.dump(cfg, f)
print('OK')
" 2>/dev/null
      docker start "$TARGET" >/dev/null 2>&1
      sleep 2
    fi

    # Deregister from governance server
    TOKEN_FILE="$DATA_DIR/monitor-token.json"
    GOV_URL=$(grep GOV_SERVER_URL /etc/systemd/system/$SERVICE.service 2>/dev/null | head -1 | sed 's/.*=//')
    if [[ -f "$TOKEN_FILE" && -n "$GOV_URL" ]]; then
      TOKEN=$(python3 -c "import json; print(json.load(open('$TOKEN_FILE'))['token'])" 2>/dev/null)
      if [[ -n "$TOKEN" ]]; then
        curl -s -X DELETE "$GOV_URL/api/v1/monitor/governed/$TARGET" \
          -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1
      fi
    fi

    echo "  [OK] $TARGET -- governance removed. Container restored."
    ;;
  uninstall)
    exec /opt/cloudfuze-monitor/scripts/install-monitor.sh --do-uninstall
    ;;
  help|"")
    echo ""
    echo "  CloudFuze Server Monitor -- Commands"
    echo "  ======================================"
    echo ""
    echo "  cloudfuze-monitor status                  Show service status"
    echo "  cloudfuze-monitor logs                    Stream live logs"
    echo "  cloudfuze-monitor restart                 Restart the monitor"
    echo "  cloudfuze-monitor update                  Update to latest version"
    echo "  cloudfuze-monitor govern                  Track a Docker container's AI calls"
    echo "  cloudfuze-monitor ungovernable <name>     Stop tracking a container"
    echo "  cloudfuze-monitor uninstall               Remove completely"
    echo "  cloudfuze-monitor help                    Show this help"
    echo ""
    echo "  Run on the server where the monitor is installed."
    echo "  Most commands require sudo."
    echo ""
    ;;
  *)
    echo "Unknown command: $1"
    echo "Run 'cloudfuze-monitor help' for available commands."
    ;;
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

  # ── Docker: inform about per-container governance ────────────────────
  if command -v docker &>/dev/null && [[ "$REMOTE_MODE" != "true" ]]; then
    DOCKER_CONTAINERS=$(docker ps -q 2>/dev/null | wc -l)
    if [[ "$DOCKER_CONTAINERS" -gt 0 ]]; then
      echo ""
      echo "  Docker detected: $DOCKER_CONTAINERS container(s) running."
      echo "  Host processes are governed automatically."
      echo "  To govern AI calls from Docker containers:"
      echo ""
      echo "    sudo cloudfuze-monitor govern"
      echo ""
      echo "  This injects a CA cert, adds proxy config, and sets up"
      echo "  network routing for that container. Container restarts once."
      echo "  Full tracing: provider, model, tokens, cost, prompt, response."
      echo ""
    fi
  fi
else
  echo ""
  echo "  WARNING: Service failed to start. Check logs:"
  echo "    journalctl -u $SERVICE_NAME -n 50"
  echo ""
  exit 1
fi
