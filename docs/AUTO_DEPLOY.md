# Auto-deploy: push to `main` → live

Two workflows in `.github/workflows/`:

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | push to any branch except `main`, every PR, and called by `deploy.yml` | Runs the four test suites, builds `connect-ui/dist`, uploads it as an artifact. Lint and the known-failing tests run too, but advisory only. |
| `deploy.yml` | push to `main`, or **Run workflow** | Calls `ci.yml`, waits for it to pass, then ships the checkout to the host and rebuilds the stack. |

A push to `main` therefore runs CI **once** and only deploys if it is green. `ci.yml`
deliberately does not trigger on `main` itself, or every push would run CI twice.

## Why a self-hosted runner

sshd on the deploy host is not reachable from the internet. Of ports 22, 2222,
2022, 22022, 443 and 8787, only 443 and 8787 answer — and both are nginx / the
API, not SSH. That is why the earlier SSH-based workflow was deleted in `cc18c68`:
it produced a red run on every push and could never have connected. Allowing
GitHub-hosted runners through a firewall is not a fix either — their IPs are a
large rotating range, so allowing them means allowing the internet.

A **self-hosted runner installed on the deploy host** dials *out* to GitHub. No
inbound port, no firewall change, and no SSH private key stored in repository
secrets.

The Vite build still runs on a GitHub-hosted runner and travels to the host as an
artifact, because it needs more RAM than this ~1 GB box has. That is the same
split `scripts/deploy.mjs` uses.

## One-time setup

### 1. Install the runner on the deploy host

On the host (`root@208.70.248.68`), get the registration token from
**GitHub → repo → Settings → Actions → Runners → New self-hosted runner → Linux**,
then:

```bash
useradd -m -s /bin/bash ghrunner || true
usermod -aG docker ghrunner          # needs docker without sudo
mkdir -p /home/ghrunner/actions-runner && cd /home/ghrunner/actions-runner
curl -o actions-runner.tar.gz -L \
  https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz
tar xzf actions-runner.tar.gz
chown -R ghrunner:ghrunner /home/ghrunner/actions-runner

sudo -u ghrunner ./config.sh \
  --url https://github.com/SudityaSenaNimmala/AI-Governence \
  --token <REGISTRATION_TOKEN> \
  --name ai-gov-prod \
  --labels ai-gov \
  --unattended

./svc.sh install ghrunner    # run as a service so it survives reboots
./svc.sh start
./svc.sh status
```

The `ai-gov` label matters: `deploy.yml` targets
`runs-on: [self-hosted, linux, ai-gov]`, so a runner without it is never picked.

`config.sh` refuses to run as root, hence the separate `ghrunner` user.

### 2. Give the runner write access to the deploy dir

```bash
chown -R ghrunner:ghrunner /opt/ai-gov
```

`/opt/ai-gov/.env` must already exist and hold `JWT_SECRET`, `MONGODB_URI`,
`ENCRYPTION_KEY` and `ENROLL_SECRET`. **The deploy never ships or overwrites it** —
no app or database secret is stored in GitHub. `ADMIN_TOKEN` and `ENROLL_SECRET`
are the one exception to "by hand": the workflow generates them *into that file*
if missing, never overwriting an existing value.

### 3. Confirm the runner can use docker

```bash
sudo -u ghrunner docker ps
sudo -u ghrunner docker compose version
```

Both must work without a password prompt.

### 4. Optional repository variables

`deploy.yml` hardcodes today's production values as defaults. Override them under
**Settings → Secrets and variables → Actions → Variables** (variables, not
secrets — none of these is sensitive):

| Variable | Default | Why it exists |
|---|---|---|
| `DEPLOY_DIR` | `/opt/ai-gov` | Where the stack lives on the host. |
| `CONNECT_UI_PORT` | `34441` | Port 3000 is already taken on this box; nginx fronts 34441 on 443. |
| `PUBLIC_SERVER_URL` | `https://agentgovernence.cftools.live` | The origin users and installers actually reach. Unset, the server bakes `http://<host>:8787` into every installer — a port that speaks plain HTTP. |

### 5. Try it

Use **Actions → Deploy to server → Run workflow** before relying on a push. It
runs the identical path.

## What a deploy does on the host

Mirrors `scripts/deploy.mjs` exactly, minus the SSH hop:

1. Verify `$DEPLOY_DIR/.env` exists; fail loudly if not.
2. Generate `ADMIN_TOKEN` / `ENROLL_SECRET` into it if absent (once, never printed).
3. Stash `agent/prebuilt/` (see below), wipe everything in `$DEPLOY_DIR` except
   `.env`, unpack this checkout plus the downloaded `connect-ui/dist`, restore the
   stash if the incoming build had none.
4. `docker compose build server`, then `build connect-ui`, then `up -d` —
   sequential, because building both at once has run this box out of memory.
5. Health check `${PUBLIC_SERVER_URL}/api/v1/health`, 20 attempts, 3s apart.
   Checking the *proxied* origin exercises nginx, TLS and the route into the
   container, so a stack that is up but unreachable fails the deploy.

## Two things this does NOT do

**It does not rebuild the Claude Usage Tracker `.exe` or the NSIS installer.**
Node SEA only builds for the platform it runs on, so a Windows machine running
`npm run deploy` is still the only way to produce a *new* tracker binary. The
binary already on the host is stashed and restored across every auto-deploy, so
a push to `main` will not silently break the download.

**It does not gate on lint, or on three known-failing tests.** Both are reported
in every run and neither blocks a deploy:

- `connect-ui` lint has 4,173 pre-existing errors under `--max-warnings 0`.
  Gating on it would block every deploy indefinitely.
- Three agent tests fail on `main` today and are named in a skip pattern in
  `ci.yml`, with the reason for each. The `known-failing tests (advisory)` job
  runs them *without* the skip pattern, so they stay visible — that job going
  green is the signal to delete the skip pattern.

Everything else is a hard gate: 215 server tests, 59 agent tests, 16 sdk-js
tests, 352 browser-extension tests, and the `connect-ui` production build,
including a check that no bearer-token literal was baked into the bundle.

## `npm run deploy` still works

Unchanged, and still the right tool for a deploy from a machine that can reach
the host — and the only one that also builds the tracker `.exe`.
