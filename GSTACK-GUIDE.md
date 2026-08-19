# GStack Guide — AI-Governance monorepo

GStack is a role-based, multi-agent workflow for building features safely in this repo. Instead of one assistant doing everything, work is split across specialized agents, with human review at the design gate and only `devops-engineer` allowed to touch git. Shipping is CI-gated rather than question-gated: a push to `main` deploys itself once the tests and the frontend build pass.

## The agents (`.claude/agents/`)

| Agent | Role |
|-------|------|
| `architect` | Designs the approach before code is written. Stops for your review. |
| `backend-engineer` | Implements `server/` and `agent/` (Express, JWT, storage, scanner). |
| `frontend-engineer` | Implements `connect-ui/` and `dashboard/` (React 18 + Vite). |
| `qa-engineer` | Tests happy path / errors / edge cases; drives the running app. |
| `security-reviewer` | Audits auth, PII handling, storage queries, parsing, extension. |
| `code-reviewer` | Reviews correctness, consistency, maintainability. |
| `documentation-engineer` | Updates README / docs / API notes. |
| `devops-engineer` | Owns commit + push. Pushing to `main` auto-deploys; this agent verifies the run. |

## The workflows (`.claude/workflows/`)
- **new-feature.yaml** — full pipeline: design → implement → test → security audit → code review → docs → CI-gated ship.
- **bug-fix.yaml** — reproduce → fix → verify → targeted review → CI-gated ship.
- **deployment.yaml** — the release flow itself: commit + push to `main`, then verify the automatic deploy. CI is the only gate.

## When does GStack kick in?
Routing lives in `CLAUDE.md` → **Workflow Selection (GStack vs Direct)**. Short version:
- Feature / risky change (auth, storage, PII, forwarding, extension) → GStack.
- Trivial change → direct.
- `use gstack` forces the pipeline; `quick fix` skips it. Either way, a push to `main` deploys.

## This project's stack (what the agents are tuned to)
| Subproject | Stack | Run | Port |
|---|---|---|---|
| `server/` | Node 20 ESM, Express 4 (`tsx`), JWT auth, SQLite/Mongo/Postgres | `npm run dev:server` | 8787 |
| `agent/` | Node CLI scanner — pdf-parse, tesseract OCR, mammoth, xlsx | `npm run scan` | — |
| `connect-ui/` | React 18 + Vite 5, axios, highcharts/reactflow | `npm --prefix connect-ui run dev` | 3000 (`/api`→8787) |
| `dashboard/` | Secondary React UI | — | — |
| `browser-extension/` | MV3 DLP extension | — | — |

Tests: `node --test` under `server/tests/` and `agent/tests/`.

## How to use it (typical feature)
1. **Kick off:** `use gstack — implement <feature>` + requirements/constraints/integration points.
2. **Review the design** the architect returns. Push back on edge cases; when satisfied say **Proceed**.
3. **Implementation** runs (backend/frontend) against the approved design.
4. **Test / audit / review / docs:** `@qa-engineer`, `@security-reviewer`, `@code-reviewer`, `@documentation-engineer`.
5. **Ship:** say `Commit and deploy.` → `devops-engineer` commits and pushes to `main`. **That push IS the deploy** — GitHub Actions runs the test suites and the `connect-ui` build, then ships to the host and health-checks it. No question is asked. The agent watches the run and reports the outcome; live at `https://agentgovernence.cftools.live/api/v1/health` and `https://agentgovernence.cftools.live/CloudFuze/`.

### Auto-deploy
- `.github/workflows/deploy.yml` — push to `main` → `ci.yml` → ship + health check. Setup, what is gated, and why it uses a self-hosted runner rather than SSH: **`docs/AUTO_DEPLOY.md`**.
- Hard gates: the four test suites and the `connect-ui` production build. Advisory only: `connect-ui` lint and three known-failing agent tests.
- Secrets live only in the host's own `/opt/ai-gov/.env` — none are stored in GitHub, and the deploy never overwrites that file.
- A run stuck in **queued** means the self-hosted runner on the host is offline. That is not deployed.
- `npm run deploy` still works for an out-of-band deploy from a machine that can reach the host (`DEPLOY_SSH` in `.env`, **not** `DOCKER_HOST`), and is the only path that rebuilds the Windows tracker `.exe` — the Actions runner is Linux and Node SEA is platform-bound.

## Quick fixes
`quick fix — <bug>` skips the pipeline for trivial changes. It does not skip the deploy: pushing to `main` still ships.

## Data-sensitivity note
This is a governance/DLP product handling captured prompts and PII. Agents are instructed never to log, forward, or persist raw prompt content beyond what a design authorizes, and to reuse the repo's existing redaction/hashing patterns. Keep that bar when working directly too.
