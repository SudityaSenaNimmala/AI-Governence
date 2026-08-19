# Agents Reference — AI-Governance monorepo

Detailed reference for the GStack agents in `.claude/agents/`. See `GSTACK-GUIDE.md` for the overview and `CLAUDE.md` → *Workflow Selection* for routing rules.

Invoke an agent explicitly with `@<name>` (e.g. `@backend-engineer implement based on the approved design`). Kick off the full pipeline with `use gstack — implement <feature>`.

---

## architect
**Does:** Produces a design — subprojects touched, storage choice (SQLite/Mongo/Postgres), API surface, capture path, edge cases, sequencing, open questions. **Stops for human review; writes no production code.**
**Use when:** starting any non-trivial feature or cross-cutting change.
**Output gate:** "Review this design. Reply 'Proceed' to implement, or tell me what to change."

## backend-engineer
**Does:** Implements `server/` (Express routes, JWT auth, storage in `src/db.js`, risk/integration/SIEM/OTel) and `agent/` (CLI scanner, text extraction). Adds `node --test` coverage.
**Use when:** backend work after design approval, or backend-only changes.
**Won't:** commit/push/merge/deploy.

## frontend-engineer
**Does:** Implements `connect-ui/` (React 18 + Vite, axios, charts, reactflow, react-router) and `dashboard/`. Keeps build + eslint (`--max-warnings 0`) green. Respects `/CloudFuze` base and `/api` proxy.
**Use when:** UI work after design approval, or frontend-only changes.
**Won't:** commit/push/merge/deploy.

## qa-engineer
**Does:** Tests happy path, error cases, edge cases, regression. Drives the running app/CLI (ports 8787 / 3000) and reports PASS/FAIL honestly with real output. Adds tests for gaps.
**Use when:** after implementation, and to reproduce/verify bug fixes.
**Won't:** commit/push/merge/deploy.

## security-reviewer
**Does:** Audits auth/JWT, PII/data handling (logging, persistence, SIEM/OTel forwarding), SQL/NoSQL injection, file-parsing DoS/path traversal, MV3 extension surface, CORS/secrets. Ranks Critical→Low with `file:line` and exploit scenario.
**Use when:** before commit/deploy on anything touching auth, storage, capture, forwarding, or the extension.
**Won't:** fix unless asked; commit/push/merge/deploy.

## code-reviewer
**Does:** Reviews correctness, consistency with repo conventions, readability, resource handling, test quality, cross-backend coupling. Ranks Must/Should/Nice with `file:line`.
**Use when:** before commit.
**Won't:** rewrite unless asked; commit/push/merge/deploy.

## documentation-engineer
**Does:** Updates README / `docs/` / API + CLI notes to match the implemented code. Precise about auth and data handling.
**Use when:** after a feature is implemented and reviewed.
**Won't:** edit `ROADMAP.md` outside the ask-then-edit flow; commit/push/merge/deploy.

## devops-engineer
**Does:** Owns commit + push. Verifies the suites are green, stages the intended files, commits, and pushes to `main` — which **is** the deploy: GitHub Actions runs CI and ships to the host on green. Then watches the run and reports the real outcome.
**Use when:** after review passes and the human is ready to ship.
**Never:** asks a deploy question (the deploy has already started by then); reports "live" without a passed health check; treats a queued run as deployed.

---

### Guardrail summary
Only `devops-engineer` touches git, and only through the CLAUDE.md ship flow. Every other agent stops short of commit — which matters more now that a push to `main` deploys itself. All agents treat captured prompt content / PII as sensitive and reuse existing redaction/hashing patterns.
