# Project rules

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
