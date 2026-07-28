# GStack Guide — AI-Governance monorepo

GStack is a role-based, multi-agent workflow for building features safely in this repo. Instead of one assistant doing everything, work is split across specialized agents, with human review at the design gate and hard gates before any commit or deploy.

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
| `devops-engineer` | Owns the gated commit + deploy flow. Never auto-approves. |

## The workflows (`.claude/workflows/`)
- **new-feature.yaml** — full pipeline: design → implement → test → security audit → code review → docs → gated ship.
- **bug-fix.yaml** — reproduce → fix → verify → targeted review → gated ship.
- **deployment.yaml** — the gated release flow itself (two-step commit gate, three-step deploy gate).

## When does GStack kick in?
Routing lives in `CLAUDE.md` → **Workflow Selection (GStack vs Direct)**. Short version:
- Feature / risky change (auth, storage, PII, forwarding, extension) → GStack.
- Trivial change → direct.
- `use gstack` forces the pipeline; `quick fix` skips it. Commit/deploy gates always apply.

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
5. **Ship:** say `Commit and deploy.` → `devops-engineer` commits + pushes to `main`, then asks **one** question: *"Do you want to deploy to the server now?"* Say **yes** and it runs `npm run deploy` (Docker: server + connect-ui) — live at `http://<host>:8787` and `http://<host>:3000/CloudFuze`.

### Deploy setup (one-time)
- `docker-compose.yml` (repo root) runs `server` + `connect-ui`; `npm run deploy` builds + brings them up and health-checks.
- Copy `.env.example` → `.env` and set `JWT_SECRET` before the first deploy.
- Local Docker by default; for a remote host run `export DOCKER_HOST=ssh://user@host` first.

## Quick fixes
`quick fix — <bug>` skips the pipeline for trivial changes. The commit/deploy gates still apply.

## Data-sensitivity note
This is a governance/DLP product handling captured prompts and PII. Agents are instructed never to log, forward, or persist raw prompt content beyond what a design authorizes, and to reuse the repo's existing redaction/hashing patterns. Keep that bar when working directly too.
