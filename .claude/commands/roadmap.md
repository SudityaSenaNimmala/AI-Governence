---
description: Read the CloudFuze AI Governance roadmap. Args: (none) summary, p0-p4/done/<keyword> filter. Inbox/promote are legacy.
argument-hint: [p0|p1|p2|p3|p4|done|<keyword>]
allowed-tools: Read, Edit, Write, Glob, Grep, AskUserQuestion
---

You are running the `/roadmap` command. Argument: `$ARGUMENTS`

Source of truth: `ROADMAP.md` (curated, tier-ordered P0–P4 + Done). New items are added live via the ask-then-edit flow described in `CLAUDE.md` — not via an inbox.

Dispatch on `$ARGUMENTS`:

## (empty) → summary of ROADMAP.md

1. Read `ROADMAP.md` from the project root.
2. Print:
   - The "Snapshot as of …" line at the top.
   - For each tier (P0, P1, P2, P3, P4), list the bolded item titles (`**...**` lines) as bullets. Skip prose unless asked.
   - One-line count of items in `Done`.
3. If `ROADMAP_INBOX.md` exists and has uncompleted items (`- [ ]` lines), note at the bottom: `Legacy inbox has N untriaged item(s) — run /roadmap promote to clear.`

## `p0` / `p1` / `p2` / `p3` / `p4` → tier detail

Print the full content of that tier verbatim (titles + prose), no other tiers.

## `done` → completed work

Print the `Done` section verbatim.

## `inbox` → show untriaged captures

1. Read `ROADMAP_INBOX.md`. If missing, say "Inbox empty." and stop.
2. Print each `- [ ]` line with a 1-based index. Skip `- [x]` (already triaged).
3. End with: `Run /roadmap promote to move items into ROADMAP.md.`

## `promote` → interactive triage

For each unchecked (`- [ ]`) item in `ROADMAP_INBOX.md`, in order:

1. Show the item text.
2. Ask the user via AskUserQuestion which tier it belongs in: `P0`, `P1`, `P2`, `P3`, `P4`, `Skip`, `Delete`.
3. Based on the answer:
   - **P0–P4**: append `- [ ] **<item text>**` as a new bullet at the bottom of that tier's section in `ROADMAP.md`. Then mark the inbox line as `- [x]` (don't delete — keeps audit trail).
   - **Skip**: leave the inbox line untouched. Move to next.
   - **Delete**: remove the line from `ROADMAP_INBOX.md` entirely.
4. After all items, report: `Promoted N · Skipped M · Deleted K`.

When editing `ROADMAP.md`:
- Insert at the END of the tier's bullet list, before the next `---` separator or next `##` header.
- Preserve existing item format (`- [ ] **Title**\n  prose…`). If the inbox item has no prose, just write the title line.
- Never reorder existing items.

## `<any other string>` → keyword filter

Case-insensitive keyword match; show every ROADMAP.md item (title + prose) whose body matches, with its tier label.

## Rules

- Only `promote` and `inbox` modes may modify files. Others are read-only.
- If `ROADMAP.md` is missing, say so plainly and stop — do not guess from memory.
- Never re-rank items in output; the file order is the priority order.
