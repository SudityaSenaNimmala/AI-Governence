#!/usr/bin/env bash
# GitHub Actions self-hosted runner — one-command installer for the deploy host.
#
# Run this ON the deploy host (as root), once. After it finishes, every push to
# `main` deploys automatically via .github/workflows/deploy.yml.
#
# Usage:
#   sudo bash install-github-runner.sh --token <REGISTRATION_TOKEN>
#
# Get the token from (it expires after ~1 hour, so copy it right before running):
#   https://github.com/SudityaSenaNimmala/AI-Governence/settings/actions/runners/new
#   → pick Linux / x64 → copy the value after `--token` in the ./config.sh line.
#
# Optional flags:
#   --name <label>     runner name in the GitHub UI      (default ai-gov-prod)
#   --labels <csv>     EXTRA labels beyond ai-gov        (default none)
#   --deploy-dir <p>   dir the runner must own           (default /opt/ai-gov)
#   --user <name>      unprivileged account to run as    (default ghrunner)
#   --version <x.y.z>  pin the runner version            (default: latest)
#
# WHY A SELF-HOSTED RUNNER AT ALL
#   sshd on this host is not reachable from the internet — verified from a
#   CloudFuze workstation: of ports 22, 2222, 2022, 22022, 443 and 8787 only 443
#   and 8787 answer, and both are nginx/the API. (Outbound 22 from that
#   workstation is open — github.com:22 completes a handshake — so the block is
#   here, not there.) A runner installed on this box dials OUT to GitHub instead:
#   no inbound port, no firewall change, and no SSH private key in repository
#   secrets. See docs/AUTO_DEPLOY.md.
#
# Re-running this script is safe: it skips whatever is already in place and only
# re-registers the runner if it is not already configured.
#
# To remove the runner later:
#   cd ~ghrunner/actions-runner && ./svc.sh stop && ./svc.sh uninstall \
#     && sudo -u ghrunner ./config.sh remove --token <NEW_REMOVAL_TOKEN>

set -euo pipefail

REPO_URL="https://github.com/SudityaSenaNimmala/AI-Governence"
RUNNER_NAME="ai-gov-prod"
EXTRA_LABELS=""
DEPLOY_DIR="/opt/ai-gov"
RUNNER_USER="ghrunner"
RUNNER_VERSION=""
TOKEN=""

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "• $*"; }
ok()   { echo "  ✓ $*"; }

# ── Parse args ────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --token)      TOKEN="${2:-}";          shift 2 ;;
    --name)       RUNNER_NAME="${2:-}";    shift 2 ;;
    --labels)     EXTRA_LABELS="${2:-}";   shift 2 ;;
    --deploy-dir) DEPLOY_DIR="${2:-}";     shift 2 ;;
    --user)       RUNNER_USER="${2:-}";    shift 2 ;;
    --version)    RUNNER_VERSION="${2:-}"; shift 2 ;;
    -h|--help)    sed -n '2,36p' "$0"; exit 0 ;;
    *)            die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" = "0" ] || die "run as root (sudo bash $0 --token ...)"
[ -n "$TOKEN" ] || die "--token is required. Get one at ${REPO_URL}/settings/actions/runners/new (expires in ~1 hour)."

# `ai-gov` is not optional — .github/workflows/deploy.yml targets
# runs-on: [self-hosted, linux, ai-gov], so a runner without it is never picked
# and the deploy job would queue forever with no explanation.
LABELS="ai-gov${EXTRA_LABELS:+,$EXTRA_LABELS}"

echo
echo "▶ Installing GitHub Actions runner"
echo "    repo        ${REPO_URL}"
echo "    runner      ${RUNNER_NAME}  (labels: ${LABELS})"
echo "    as user     ${RUNNER_USER}"
echo "    deploy dir  ${DEPLOY_DIR}"
echo

# ── 1. Preflight: the things the deploy itself needs ──────────────────────
info "Checking docker…"
command -v docker >/dev/null || die "docker is not installed on this host — the deploy needs it"
docker compose version >/dev/null 2>&1 || die "the 'docker compose' plugin is missing (v2). Install it before continuing."
ok "docker $(docker --version | sed 's/Docker version //;s/,.*//') + compose plugin"

info "Checking ${DEPLOY_DIR}/.env (the secrets the deploy never ships)…"
if [ ! -f "${DEPLOY_DIR}/.env" ]; then
  die "No ${DEPLOY_DIR}/.env. Create it ONCE by hand with JWT_SECRET, MONGODB_URI,
    ENCRYPTION_KEY and ENROLL_SECRET (see .env.example in the repo). No app or
    database secret is ever stored in GitHub, and no deploy path overwrites this
    file — so it has to exist before the first automated deploy."
fi
ok "present (left untouched)"

for tool in curl tar openssl; do
  command -v "$tool" >/dev/null || die "$tool is required but not installed"
done

# ── 2. Unprivileged account ───────────────────────────────────────────────
# config.sh refuses to run as root, hence a separate account rather than just
# using root's home.
info "Ensuring user '${RUNNER_USER}'…"
if id "$RUNNER_USER" >/dev/null 2>&1; then
  ok "already exists"
else
  useradd -m -s /bin/bash "$RUNNER_USER"
  ok "created"
fi

info "Granting docker access…"
if getent group docker >/dev/null; then
  usermod -aG docker "$RUNNER_USER"
  ok "added to the docker group"
else
  die "there is no 'docker' group on this host — cannot give ${RUNNER_USER} docker access"
fi

RUNNER_HOME="$(getent passwd "$RUNNER_USER" | cut -d: -f6)"
RUNNER_DIR="${RUNNER_HOME}/actions-runner"

# ── 3. Deploy dir ownership ───────────────────────────────────────────────
# The workflow wipes and repopulates this directory (preserving .env), so the
# runner's account has to own it.
info "Giving ${RUNNER_USER} ownership of ${DEPLOY_DIR}…"
chown -R "${RUNNER_USER}:${RUNNER_USER}" "$DEPLOY_DIR"
ok "done (.env contents unchanged — only its owner)"

# ── 4. Download the runner ────────────────────────────────────────────────
if [ -z "$RUNNER_VERSION" ]; then
  info "Resolving the latest runner version…"
  # Fetched into a variable first, deliberately. Piping curl straight into
  # `grep -m1` makes grep close the pipe as soon as it matches, curl dies of
  # SIGPIPE with exit 23, and `set -o pipefail` then aborts this script before
  # the error message below can explain anything. Consuming the body fully
  # avoids that.
  LATEST_JSON="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)" \
    || die "could not reach the GitHub API to find the latest runner version — pass --version x.y.z"
  RUNNER_VERSION="$(printf '%s' "$LATEST_JSON" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"v\([^"]*\)".*/\1/p' | head -n1 || true)"
  [ -n "$RUNNER_VERSION" ] || die "could not parse a version out of the GitHub API response — pass --version x.y.z"
  ok "v${RUNNER_VERSION}"
fi

TARBALL="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
if [ -x "${RUNNER_DIR}/config.sh" ]; then
  info "Runner already unpacked at ${RUNNER_DIR} — skipping download"
else
  info "Downloading and unpacking runner v${RUNNER_VERSION}…"
  install -d -o "$RUNNER_USER" -g "$RUNNER_USER" "$RUNNER_DIR"
  curl -fsSL -o "/tmp/${TARBALL}" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL}"
  tar xzf "/tmp/${TARBALL}" -C "$RUNNER_DIR"
  rm -f "/tmp/${TARBALL}"
  chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_DIR"
  ok "unpacked into ${RUNNER_DIR}"
fi

# Runner dependencies (libicu etc). Best-effort: the script ships one, and it is
# a no-op on a host that already has them.
if [ -x "${RUNNER_DIR}/bin/installdependencies.sh" ]; then
  info "Installing runner OS dependencies…"
  "${RUNNER_DIR}/bin/installdependencies.sh" >/dev/null 2>&1 && ok "done" \
    || echo "  ⚠ installdependencies.sh reported a problem — continuing; the runner may still work"
fi

# ── 5. Register with GitHub ───────────────────────────────────────────────
if [ -f "${RUNNER_DIR}/.runner" ]; then
  info "Runner is already registered — leaving the existing registration alone"
  ok "config kept"
else
  info "Registering with ${REPO_URL}…"
  # --unattended so it never prompts; --replace so a stale runner of the same
  # name (from a rebuilt box) is taken over rather than causing a name clash.
  sudo -u "$RUNNER_USER" -H bash -c "cd '${RUNNER_DIR}' && ./config.sh \
    --url '${REPO_URL}' \
    --token '${TOKEN}' \
    --name '${RUNNER_NAME}' \
    --labels '${LABELS}' \
    --work _work \
    --unattended --replace" \
    || die "registration failed. The most common cause is an EXPIRED token — they last about an hour. Grab a fresh one from ${REPO_URL}/settings/actions/runners/new and re-run."
  ok "registered as '${RUNNER_NAME}'"
fi

# ── 6. Run it as a service, so it survives a reboot ───────────────────────
info "Installing the systemd service…"
cd "$RUNNER_DIR"
if ./svc.sh status >/dev/null 2>&1; then
  ok "service already installed"
else
  ./svc.sh install "$RUNNER_USER" >/dev/null
  ok "installed"
fi
./svc.sh start >/dev/null 2>&1 || true
sleep 3
./svc.sh status || true

# ── 7. Verify the things that actually break ──────────────────────────────
echo
info "Verifying the runner account can do what the deploy needs…"
FAIL=0
sudo -u "$RUNNER_USER" docker ps >/dev/null 2>&1 \
  && ok "docker ps works as ${RUNNER_USER}" \
  || { echo "  ✗ ${RUNNER_USER} cannot talk to docker."; echo "    Group membership only applies to NEW sessions — restart the service:"; echo "      cd ${RUNNER_DIR} && ./svc.sh stop && ./svc.sh start"; FAIL=1; }
sudo -u "$RUNNER_USER" docker compose version >/dev/null 2>&1 \
  && ok "docker compose works as ${RUNNER_USER}" || { echo "  ✗ compose plugin not usable as ${RUNNER_USER}"; FAIL=1; }
sudo -u "$RUNNER_USER" test -w "$DEPLOY_DIR" \
  && ok "${DEPLOY_DIR} is writable by ${RUNNER_USER}" || { echo "  ✗ ${DEPLOY_DIR} is not writable by ${RUNNER_USER}"; FAIL=1; }

echo
if [ "$FAIL" = "0" ]; then
  echo "✓ Runner installed and online."
  echo
  echo "  Confirm it shows as Idle:   ${REPO_URL}/settings/actions/runners"
  echo "  Then deploy without a new commit:"
  echo "      ${REPO_URL}/actions/workflows/deploy.yml  →  Run workflow"
  echo
  echo "  A run that stays QUEUED means this runner is offline or is missing the"
  echo "  'ai-gov' label. Logs:  journalctl -u actions.runner.* -f"
else
  echo "⚠ Runner installed, but a check above FAILED. Fix it before relying on a"
  echo "  push to deploy — the job will start and then fail partway through,"
  echo "  which on the ship step can leave ${DEPLOY_DIR} half-populated."
  exit 1
fi
