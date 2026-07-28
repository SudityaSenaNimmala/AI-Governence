# Project rules

## Workflow Selection (GStack vs Direct)

This repo has a **GStack** multi-agent pipeline in `.claude/agents/` and `.claude/workflows/`. Use it or work directly based on **size and risk** — not on how the request is phrased.

### Default routing (by size/risk)
- **GStack (full pipeline)** — new features, cross-subproject changes, anything touching auth (`JWT_SECRET`), storage schema/migrations, PII/data capture, SIEM/OTel forwarding, or the browser extension. Route through the `new-feature` workflow (design → implement → test → security audit → code review → docs → gated ship).
- **GStack (bug-fix pipeline)** — real defects that need reproduction and a regression test. Route through `bug-fix`.
- **Direct** — trivial, low-risk changes: typos, copy, a one-line fix, a config tweak, a comment. Just do it; no pipeline.

### Overrides (explicit user intent wins over the default)
- **"use gstack"** — force the full pipeline even for a small change.
- **"quick fix"** — skip the pipeline and make the change directly, even if it looks medium-sized. (Still respect the commit/deploy gates below.)

### Design gate
For GStack features, the **architect** presents a design and STOPS. Do not implement until the human replies **"Proceed"** (or requests changes). Never rubber-stamp your own design.

### Ship flow: commit → push → ONE deploy question → live
The deploy model for this repo is: **commit, push to `main`, then exactly one question.** `devops-engineer` owns it.

1. **Commit + push.** When the user says to commit/push/ship, stage the intended files (not blind `git add -A`), commit (message ends with the required Co-Authored-By line), and `git push origin main`. The user's instruction to commit-and-push is the authorization — no separate commit-gate questions.
2. **Single deploy question:** **"Do you want to deploy to the server now?"**
   - **No** → stop; changes are on `main`, not deployed.
   - **Yes** → run `npm run deploy` (docker compose build + up on the Docker host: `server` + `connect-ui`). Live at `http://<host>:8787` and `http://<host>:3000/CloudFuze`.

Rules: ask ONLY the one deploy question — do not re-introduce branch / dev-vs-prod prompts. Verify changed subprojects build/test green before deploying; refuse on a red build or a failed health check and say why. If `DOCKER_HOST` targets production (or is ambiguous), confirm the host once before shipping. Never report "live" unless the deploy health check passed.

## Roadmap auto-update (ask-then-edit)

When a response surfaces a **real future enhancement** — something you'd write down as a maintainer, not just descriptive prose — do this BEFORE ending the turn:

1. Identify the items (one short title per item — keep titles under ~80 chars).
2. Call `AskUserQuestion` with one question per item (max 4 per call). For each:
   - Question: `Add to ROADMAP.md: <item title>?`
   - Header: `Roadmap` (or a 1–3 word tag of the item topic)
   - Options: `P0`, `P1`, `P2`, `P3`, `P4`, `Skip` — each with a one-line description of what that tier means in this project (P0 = blocks prod, P1 = blocks expansion, P2 = blocks bigger deals, P3 = nice-to-have, P4 = paperwork).
3. For each item the user assigned a tier:
   - Open `ROADMAP.md`.
   - Append `- [ ] **<item title>**\n  <one-line context if useful>` at the END of that tier's bullet list, immediately before the next `---` separator or next `##` header.
   - Preserve the existing item format and never reorder existing items.
4. For items the user marked `Skip` → do nothing, do not store anywhere.

### What counts as a "real future enhancement"

An item qualifies ONLY if ALL THREE are true:
1. **Not implemented** — verify by reading the relevant code (grep / file read) before asking. If it already exists in the codebase, do NOT ask.
2. **Not in ROADMAP.md** — read `ROADMAP.md` and check every tier including `Done`. If it's there in any form, do NOT ask.
3. **Not the user's current request** — anything the user just asked you to do is a task, not a roadmap item. Even if it's a big feature, don't ask "should I add this to the roadmap?" — they're already telling you to build it.

If any of the three fails, stay silent. Do not ask.

Examples:
- User asks "add WebSocket scanning" → it's their request (#3 fails) → don't ask. Just build it.
- While building WebSocket scanning, you notice binary frames also need handling, no code exists for it, not in ROADMAP.md → ask.
- You read a file and see a `// TODO: handle X` comment → that's an existing TODO in code (#1 fails — it's already tracked there) → don't ask unless the user explicitly wants it promoted.
- You think "we could also add OCR for PDFs" → check: is it implemented? (grep tesseract / pdf-parse). Is it in ROADMAP.md? (yes — P3 "Multimodal: OCR images"). #2 fails → don't ask.

### Rules

- If you find ZERO real enhancements in a response, do NOT call AskUserQuestion. Silence is the default. Only ask when there is something concrete worth capturing.
- If you find MORE than 4 enhancements, ask about the top 4 by importance; mention the others in plain text and let the user prompt for them.
- Do NOT use the `[ROADMAP]` tag syntax anymore — the old Stop-hook capture system is retired.
- Do NOT modify `ROADMAP.md` without asking first. The ask-then-edit flow is the only path.
- Read `ROADMAP.md` once at the start of a session if roadmap work is in scope, so you can avoid duplicate proposals.
