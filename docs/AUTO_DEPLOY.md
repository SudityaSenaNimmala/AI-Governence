# Auto-deploy: push to `main` → live

**`deploy.yml` is the only workflow file in `.github/workflows/`.** It used to
call a separate `ci.yml` (with `advisory.yml` running lint and known-failing
tests alongside, never gating anything) as a reusable workflow, but both were
folded directly into `deploy.yml` and deleted — this repo intentionally runs
one workflow, not several, so there is nothing else to reason about.

| Job (all in `deploy.yml`) | What it does |
|---|---|
| `test` | The four test suites (server, agent, sdk-js, browser-extension), matrixed. Blocking. |
| `frontend` | Builds `connect-ui/dist` and uploads it as an artifact for `deploy` to consume. Blocking. |
| `deploy` | Waits on `test` and `frontend`, then ships the checkout to the host and rebuilds the stack. |

Triggered by push to `main`, or **Run workflow**. `connect-ui` lint and the
three known-failing agent tests that `advisory.yml` used to report no longer
run anywhere — they never gated a deploy, so nothing here replaces them. Run
`npm run lint` (in `connect-ui`) or `npm test` (in `agent`) by hand if you want
that signal back.

## Why a self-hosted runner

sshd on the deploy host is not reachable from the internet. Of ports 22, 2222,
2022, 22022, 443 and 8787, only 443 and 8787 answer — and both are nginx / the
API, not SSH. The block is confirmed to be host-side, not CloudFuze egress:
outbound 22 from a CloudFuze workstation is open (`github.com:22` completes an SSH
handshake from the same machine that times out against the host). That is why the
earlier SSH-based workflow was deleted in `cc18c68` — it produced a red run on
every push and could never have connected. Allowing GitHub-hosted runners through
a firewall is not a fix either: their IPs are a large rotating range, so allowing
them means allowing the internet.

A **self-hosted runner installed on the deploy host** dials *out* to GitHub. No
inbound port, no firewall change, and no SSH private key stored in repository
secrets.

The Vite build still runs on a GitHub-hosted runner and travels to the host as an
artifact, because it needs more RAM than this ~1 GB box has. That is the same
split `scripts/deploy.mjs` uses.

## One-time setup

### 1. Install the runner on the deploy host

**This step can only be done from the host itself.** sshd here is not reachable
from a CloudFuze workstation, which is the whole reason for the runner — so use
the provider's web console, or any machine that does have shell access.

`scripts/install-github-runner.sh` does all of it. Grab a registration token from
[Settings → Actions → Runners → New self-hosted runner](https://github.com/SudityaSenaNimmala/AI-Governence/settings/actions/runners/new)
(pick Linux / x64; **the token expires in about an hour**, so copy it immediately
before running), then on the host:

```bash
curl -fsSL https://raw.githubusercontent.com/SudityaSenaNimmala/AI-Governence/main/scripts/install-github-runner.sh \
  -o /tmp/install-github-runner.sh
sudo bash /tmp/install-github-runner.sh --token <REGISTRATION_TOKEN>
```

Or, if the repo is already checked out on the host:
`sudo bash scripts/install-github-runner.sh --token <REGISTRATION_TOKEN>`

What it does, and why each part matters:

| Step | Why |
|---|---|
| Refuses to start unless `docker`, the compose v2 plugin, and `/opt/ai-gov/.env` are all present | These are what the deploy needs. Failing here costs seconds; failing mid-deploy can leave `/opt/ai-gov` half-populated. |
| Creates an unprivileged `ghrunner` user and adds it to the `docker` group | `config.sh` refuses to run as root. |
| `chown -R ghrunner /opt/ai-gov` | The workflow wipes and repopulates that directory. Contents of `.env` are untouched — only its owner changes. |
| Registers with the label **`ai-gov`** | `deploy.yml` targets `runs-on: [self-hosted, linux, ai-gov]`. A runner without that label is never picked and the job queues forever with no explanation. |
| Installs it as a systemd service | Survives a reboot. |
| Verifies `docker ps`, `docker compose version` and write access **as `ghrunner`** | Group membership only applies to new sessions, so this is the check that actually catches a broken install. |

Re-running it is safe — it skips whatever is already in place. Pass `--help` for
the flags (`--name`, `--labels`, `--deploy-dir`, `--user`, `--version`).

`/opt/ai-gov/.env` must already exist and hold `JWT_SECRET`, `MONGODB_URI`,
`ENCRYPTION_KEY` and `ENROLL_SECRET`. **The deploy never ships or overwrites it** —
no app or database secret is stored in GitHub. `ADMIN_TOKEN` and `ENROLL_SECRET`
are the one exception to "by hand": the workflow generates them *into that file*
if missing, never overwriting an existing value.

### 2. Optional repository variables

`deploy.yml` hardcodes today's production values as defaults. Override them under
**Settings → Secrets and variables → Actions → Variables** (variables, not
secrets — none of these is sensitive):

| Variable | Default | Why it exists |
|---|---|---|
| `DEPLOY_DIR` | `/opt/ai-gov` | Where the stack lives on the host. |
| `CONNECT_UI_PORT` | `34441` | Port 3000 is already taken on this box; nginx fronts 34441 on 443. |
| `PUBLIC_SERVER_URL` | `https://agentgovernence.cftools.live` | The origin users and installers actually reach. Unset, the server bakes `http://<host>:8787` into every installer — a port that speaks plain HTTP. |

### 3. Try it

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

## Automatic failure recovery

One layer, automatic — no manual step is required to keep production up:

- **Image rollback (seconds).** Before building the new images, the deploy job
  tags the currently running `server`/`connect-ui` images as `:previous`. If
  the build, the swap, or the health check then fails, it retags `:previous`
  back to `:latest` and runs `docker compose up -d` again, restoring the exact
  containers that were live before this push. This never touches git — `main`
  is left exactly as pushed, and a human pushes the fix.

  (An earlier version of this workflow also auto-reverted the failed commits
  on `main` via a `git push`. That layer was removed for least privilege — the
  workflow no longer needs `contents: write` at all. If a deploy fails, check
  the run's logs and push a fix by hand.)

**Not handled:** a database migration that partially applied before a later
step failed. Rolling back the container image does not undo that — check the
database by hand in that case.

Also backed up: a pre-deploy MongoDB dump (`mongodump --archive --gzip
--db=aigov`, no credentials needed — this stack runs mongo with no auth
configured) is written to `$DEPLOY_DIR/backups/pre-deploy-<sha>.archive.gz`
before the build step, and the deploy refuses to proceed if the resulting file
is under 100 bytes.

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
  `ci.yml`, with the reason for each. The `known-failing tests` job in
  `advisory.yml` runs them *without* the skip pattern, so they stay visible —
  that job going green is the signal to delete the skip pattern.

Everything else is a hard gate: 207 server tests, 59 agent tests, 16 sdk-js
tests, 352 browser-extension tests, and the `connect-ui` production build,
including a check that no bearer-token literal was baked into the bundle.
(Counts as of the commit that added this file — they are here to show the scale
of the gate, not as figures to keep updated.)

## `npm run deploy` still works

Unchanged, and still the right tool for a deploy from a machine that can reach
the host — and the only one that also builds the tracker `.exe`.
