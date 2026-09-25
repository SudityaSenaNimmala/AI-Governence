# Desktop egress guardrails — Outlook mail and OneDrive/SharePoint sync

**Catalog:** `agent/src/os_monitor/ai-processes.js` — `EGRESS_SURFACES`, `EGRESS_SYNC_ROOTS`, `EGRESS_SEND_CHORDS`
**Helpers:** `attachment-watcher.ps1`, `file-dialog-watcher.ps1`, `prompt-watcher.ps1`, `sync-watcher.ps1` / `sync-watcher.js`, `enforcer-win.ps1` (all in `agent/src/os_monitor/`)
**Policy file:** `~/.cloudfuze-aigov/egress-surfaces.json`, written by `blocked-agents-sync.js`
**Admin UI:** `connect-ui/src/Components/App/AIHub/AIHubPage.jsx` — Inventory → AI Systems → expand a row → *Guardrail policy*
**Tests:** `agent/tests/os-monitor-egress.test.mjs`, `agent/tests/os-monitor-egress-qa.test.mjs`, `agent/tests/ai-processes.test.mjs`, `agent/tests/os-monitor-safety.test.mjs`

> **Status: SHIPS INERT.** Every catalog entry in both lists carries
> `enforce: false, verified: false`. Nothing in this feature observes a mail
> window, opens a directory handle, reads a compose body or swallows a keystroke
> until a human live-probes a real installation, fills in the measured UIA
> signatures, and flips both flags on a specific entry — **and** an admin
> separately opts a host into the `desktop` (or `all`) enforcement surface.
> Read §1 before anything else; it is the part that decides whether this feature
> does anything at all.

---

## 0. What this is, and what it is not

Every other watcher in `os_monitor/` answers "where is the user talking to a
model". This layer answers a different question: **which non-AI channel is
company data leaving through** — a mail send, or a folder that uploads itself.

`EGRESS_SURFACES` is a **fourth catalog**, deliberately not a member of
`AI_PROCESSES`, `IDE_PROCESSES`, `AI_PANELS` or `AGENT_SURFACES`. Membership
here unlocks nothing passive: an egress process never appears in
`watcherProcessNames()` (the clipboard poller, the UIA watchers,
`CFAI_AI_PROCESSES`), never in `processForHost()`/`processesForHost()` (so an
Inventory host toggle cannot synthesize a whole-app block for a mail client),
and never in `PLATFORM_PROCS`. `agent/tests/ai-processes.test.mjs` asserts all
four exclusions; `agent/tests/os-monitor-egress.test.mjs` asserts the
behavioural consequences.

The existing Teams/Copilot enforcement paths were not modified. This is a new
set of call sites onto existing mechanisms (`buildFileUploadEvent`,
`#armAttachHold`/`#releaseAttachHold`, `Match-PanelSignature`,
`Resolve-GovernedProcess`), not a new mechanism, and not a change to an old one.

| Path | What it can do today | What it can never do |
|---|---|---|
| Outlook attachment | Report the attached file; hold `Ctrl+Enter` / `Alt+S` **only** under `capture_mode: hold` | Swallow bare Enter; block a mouse click on Send; detach a file |
| Outlook compose body | Report the body text once, at the send transition | Block the send (the capture fires at/after the send) |
| OneDrive / SharePoint sync root | Report a file that appeared and looks locally authored | Quarantine, move, rename, delete or change permissions on anything |

---

## 1. The gates — why this ships doing nothing

Four independent conditions. **All** of them must hold before a single UIA read
or directory handle happens, and the fourth is required on top for anything to
be held.

| # | Gate | Where it lives | Default |
|---|---|---|---|
| 1 | `verified === true` **and** `enforce === true` on the catalog entry | `EGRESS_SURFACES` / `EGRESS_SYNC_ROOTS`, re-checked in every `.ps1` loader and in `enforcer-win.ps1` | **both false** for every entry |
| 2 | A governed `ai_platforms` row exists for one of the entry's `policyHosts` | `governedHostSet()` → `synthesizeEgressSurfaces()` | no row → nothing armed |
| 3 | That row's `surface` is `desktop` or `all` | `governedHostSet()` | server default is `browser` |
| 4 | That row's `capture_mode` is `hold` — required for a send hold only | `captureModeFor()`, enforced in `UpdateEgressPolicy()` | server default is `observe` |

**Gate 1** is the same `enforce`/`verified` discipline `AI_PANELS` and
`AGENT_SURFACES` use, and the reason it exists is specific: a UIA signature
nobody has measured is a guess, and a guess that swallows a keystroke in a mail
client is a user who cannot send email. Every unmeasured field on the two
Outlook entries carries a `// TODO(live-probe):` marker, and the loaders check
the flag **types** as well as their values
(`($s.verified -isnot [bool]) -or ($s.verified -ne $true) -or …`) so a
string `"false"` — which PowerShell would otherwise coerce to truthy — cannot
arm a surface.

**Gate 3 is not redundant with gate 2.** `outlook.office.com` and
`sharepoint.com` are *already* governed rows on existing deployments: they are
seeded at server startup for the pre-existing browser Copilot-panel governance
feature, with `surface: 'browser'`. Reading `governed` alone would mean that the
moment somebody live-probed the catalog and flipped gate 1, desktop mail and
OneDrive observation would arm fleet-wide with no admin having opted a single
host into desktop monitoring. The `surface` selector in connect-ui (§6) is that
opt-in, and `governedHostSet()` is where it is actually enforced rather than
merely displayed.

**What "nothing armed" concretely means** (asserted behaviourally in
`agent/tests/os-monitor-egress.test.mjs`):

- `attachment-watcher.ps1` never adds the process to `$EgressProcs`, so no UIA
  read of a mail window happens at all;
- `file-dialog-watcher.ps1` never recognises its file picker;
- `prompt-watcher.ps1` never reads a compose body;
- `sync-watcher.js` **refuses to spawn** — no PowerShell process, no
  `FileSystemWatcher`, no directory handle, no `stat` of the user's Documents
  folder;
- `enforcer-win.ps1` leaves `_egressHoldProcs` empty, so no chord is swallowed.

A missing, empty or unparseable `egress-surfaces.json` produces the same result
in every consumer: nothing armed.

---

## 2. The Outlook catalog

Two entries, both inert. Fields marked *(unmeasured)* are `null` and carry a
live-probe TODO in the source.

| Field | `outlook_classic` | `outlook_new` |
|---|---|---|
| `product` | Microsoft Outlook | Microsoft Outlook (new) |
| `procs` | `OUTLOOK` (i.e. `OUTLOOK.exe`) | `olk` (i.e. `olk.exe`) |
| `host` / `policyHosts` | `outlook.office.com` | `outlook.office.com` |
| `detect` | `file_dialog` | `file_dialog` |
| `scopeWindow` (compose window) | *(unmeasured)* | *(unmeasured)* |
| `bodySig` (compose body) | *(unmeasured)* | *(unmeasured)* |
| `recipientSig` (To/Cc) | *(unmeasured)* | *(unmeasured)* |
| `sendKeys` | `ctrl_enter`, `alt_s` | `ctrl_enter`, `alt_s` |
| `captureBody` / `captureOn` | `full` / `send` | `full` / `send` |
| `enforce` / `verified` | `false` / `false` | `false` / `false` |

Classic Outlook's Attach dialog is a plain `#32770` owned by `OUTLOOK.exe`
directly. New Outlook is a WebView2 shell, so its picker is owned by
`msedgewebview2.exe` — exactly the case
`file-dialog-watcher.ps1`'s existing `Resolve-GovernedProcess` owner/parent walk
already handles for Teams and M365Copilot. **No new walk logic was added.**

### Bare Enter is refused at load, not merely unused

In an Outlook compose body, plain Enter inserts a newline. Swallowing it would
not block a send — it would make composing email impossible with no visible
cause. So `EGRESS_SEND_CHORDS` is `['ctrl_enter', 'alt_s']` and
`normalizeEgressSendKeys()` returns `null` — dropping the **whole** entry from
every consumer — if a `sendKeys` list names any unrecognised chord or any
spelling of bare Enter (`enter`, `return`, `vk_return`, `newline`, `send`).
All-or-nothing on purpose: silently dropping one bad chord would arm a surface
with a chord set nobody authored.

---

## 3. Attachment detection — two routes

**Route A — the file dialog** (`detect: 'file_dialog'`). The reliable one, and
the one that needs no measured signature: a picker only opens because the user
clicked Attach, so there is no "compose window or reading pane?" question.
Emits `egress_file_dialog_pick` → `via: 'email_attach_dialog'`.

**Route B — the compose-scoped chip diff.** `attachment-watcher.ps1` diffs
attachment-chip names **inside the resolved `scopeWindow` only**. If
`scopeWindow` cannot be resolved, the diff reports **nothing** rather than
falling back to the whole app window — Outlook's message list and reading pane
are full of filename-shaped text (subject lines, received attachments) that are
not uploads. Emits `egress_attachment_appeared` /
`egress_attachment_disappeared` → `via: 'email_attachment_chip'`. A chip name
that resolves to no file on disk is logged and dropped, not reported.

Both routes land on `#reportEgressFile()` in `os_monitor/index.js`, which builds
an ordinary `file_upload` event via the existing `buildFileUploadEvent` with
`windowTitle: ''` — **always empty**, because an Outlook window title is the
message subject line plus, in a reply, the recipient's display name.

### Unscannable and unverifiable attachments fail OPEN

The AI/host-app attachment path has a fail-**closed** rule, but it is scoped to
`inGovernedConversation` — a condition an egress surface can never satisfy,
because a mail client is not a host app and no govstate names it. There is no
`unverified`/`failClosed` term anywhere in `#reportEgressFile`, by design. So an
encrypted archive, a legacy `.doc`, or anything else the classifier cannot read
is **reported and never held**. Escalating on "we could not read it" in a mail
client would mean blocking routine business mail.

---

## 4. The send hold — only under `capture_mode: hold`

`UpdateEgressPolicy()` in `enforcer-win.ps1` rebuilds `_egressHoldProcs` on the
same 10s cadence as the blocked-agents check, and requires all three of: the
catalog contributed a chord set (verified + enforcing), the policy file names
the surface, and that surface's `capture_mode` is `hold`. `observe` and
`block_critical` swallow nothing. An unrecognised mode falls back to `observe`.
A missing or unreadable policy file leaves the hold set empty.

The armed surface id is mapped back to processes **through the catalog**, never
through the policy file's own `procs` list, so a tampered policy file cannot
name an arbitrary process.

### The toast copy is mode-aware, and that is deliberate

`#reportEgressFile` computes `reallyHeld = hold && capture_mode === 'hold'` from
the same policy tick that arms the sync watcher, and picks its message from it:

| Situation | What the toast says |
|---|---|
| Mail route, `capture_mode: hold` | The two chords are held, **and** that clicking Send with the mouse is not covered, **and** that Ctrl+Enter-to-send is a user preference some people switch off — so remove the attachment to be sure |
| Mail route, `observe` / `block_critical` | "DETECTED AND REPORTED only — the send was not held" |
| Sync-root route | "DETECTED AND REPORTED only — nothing was blocked, moved or removed, and the file may already have synced" |

A swallowed chord also produces an `enforcement_block` event with
`blocked_for: 'file_upload'`, `mechanism: 'attachment_hold'`,
`blocked_by: 'egress_send_chord'`, `source: 'os_monitor_egress'`. There is no
override hotkey and no Tokenize & Send offer on this path (masking text cannot
detach a file), and no Request Access offer (an egress block is not "the org
disallowed this app").

Two limits worth stating to anyone evaluating this as a control: **the mouse is
not covered** (`UpdateSendRect` caches no rectangle for a non-AI surface, so the
mouse hook has nothing to swallow a click in), and a draft with an attachment is
autosaved to the mailbox, so a hold stops the **send**, not the upload.

---

## 5. Compose-body capture, and the OneDrive path

### 5.1 Body capture — once per email, at the send transition

`prompt-watcher.ps1` holds the body between ticks and emits a single
`egress_body` line at the send transition (body going non-empty → empty, or the
compose window closing while it still held text). Emitting per poll tick would
produce roughly a hundred growing-prefix copies of every email, each carrying
its full text.

What the event carries (`kind: 'egress_body'`, `source: 'os_monitor_egress'`,
`via: 'outlook_compose'`):

- `content_text` — the body, capped at `$MaxChars` = 16000 characters
  (unchanged; deliberately not raised for email). `body_truncated: true` when
  the cap was hit, so a prefix is never presented as the whole message.
- `recipient_domains` — **bare `@domain` tokens only**.
  `Get-EgressRecipientDomains` reduces the recipient field to domains in the
  same expression that reads it, so a full address exists only as a local inside
  that one function; `index.js` re-validates the shape against
  `/^@[a-z0-9.-]+\.[a-z]{2,}$/` and keeps at most 8. Never a full address, never
  a display name.
- `window_title: ''`, always. **There is no subject-line field on this event, by
  construction** — no path in this feature reads the subject.
- `matches` / `highest_severity` from the existing pattern scanner.

**Only sensitive bodies are recorded.** If `scan(text)` returns no matches the
event is dropped entirely — an ordinary email is never stored. The toast on a
high/critical body says the message was detected and reported and explicitly
**not** blocked, because the capture fires at the send transition: the mail has
already gone.

### 5.2 OneDrive / SharePoint sync roots — observe and report only

`EGRESS_SYNC_ROOTS` has one entry, `onedrive_sharepoint`, with
`policyHosts: ['onedrive.live.com', 'onedrive.com', 'sharepoint.com']`,
`enforce: false, verified: false`.

**There is no quarantine, no move, no rename, no delete and no permission change
anywhere in this path, and no release flow — that is a confirmed product
decision, not an unfinished piece.** A governance agent that silently relocates
a user's files in a synced folder is a data-loss incident waiting to happen.

Roots come from `discoverSyncRoots()`, which reuses the existing OneDrive
resolution in `agent/src/util/paths.js` (it already handles
`OneDriveCommercial` / `OneDrive` / `OneDriveConsumer` and Known Folder Move).
It watches the `Documents` and `Desktop` subfolders of the root, falling back to
the root itself only when neither exists. Absent folders are skipped, never
created — this feature writes nothing to the filesystem. Root **paths** are
never logged (under Known Folder Move they carry the tenant and the user's
display name); only ids and counts are.

`sync-watcher.ps1` classifies every newly-seen file **before anything else
happens to it**, reading Windows' cloud-placeholder attribute bits at first
sight (`FILE_ATTRIBUTE_OFFLINE` 0x1000, `FILE_ATTRIBUTE_RECALL_ON_OPEN`
0x40000, `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` 0x400000) — before our own code
opens the file, because opening a placeholder makes Windows hydrate it and clear
the very bits being tested — plus a foreground-process check and the create/
write pattern.

| Verdict | Meaning | Reported? |
|---|---|---|
| `sync_down` | A cloud-placeholder bit was set at first sight — the cloud materialised this file | **No. Dropped entirely** — not flagged, not logged, not scanned, not opened |
| `local_new` | No placeholder bit, no sync client in the foreground, and it was Created and written | Yes, with `origin: 'local_new'` |
| `unknown` | Everything else, including a small file written before the watcher saw its Create | Yes, with `origin: 'unknown'` — the ambiguity is preserved rather than upgraded |

`sync_down` is dropped because reporting a download as an upload would be a
false governance record: it would name this user as the person who exfiltrated a
file they never touched. `index.js` re-checks the label case-insensitively on its
side too, and clamps anything it does not recognise to `unknown`.

Two more honest-reporting behaviours here:

- **The extension gate is single-sourced.** `sync-watcher.ps1` extracts
  `$FilenameRegex` out of `attachment-watcher.ps1`'s source at startup rather
  than keeping a second copy that would drift. If the extraction fails it
  **fails closed** — reports nothing — and says so on its `ready` line
  (`ext_gate: false`), which the Node wrapper logs as "EXTENSION GATE
  UNAVAILABLE — nothing will be reported". The two helpers are always staged
  together (`PS1_HELPERS` in `agent/scripts/build-claude-tracker.mjs`).
- **Dropped notifications are recorded, not swallowed.** A `FileSystemWatcher`
  buffer overflow (or the helper's own per-minute ceiling) emits an `overflow`
  line, which becomes a `coverage_gap` event — the honest thing to say about a
  window we did not observe is that we did not observe it.

Withdrawing the policy stops the watcher immediately (`setArmedRoots([])` →
`stop()`), rather than at some later restart.

---

## 6. Admin UI (connect-ui) and the server

### Guardrail policy control

Inventory → **AI Systems** → expand a row → **Guardrail policy**. Two selects,
*Enforcement surface* (`browser` / `desktop` / `cli` / `all`) and *Capture mode*
(`observe` / `block_critical` / `hold`), whose option lists mirror the server's
`VALID_SURFACE` / `VALID_CAPTURE_MODE` in
`server/src/routes/ai-platforms.js`. Changing either issues a real
`PATCH /api/v1/ai-platforms/:host`; endpoints pick the change up on their next
sync. This control is what closes the "nothing in the admin UI ever writes
`surface`" gap — before it existed, every row sat on the server's `browser`
default and the desktop guardrails could not be turned on for a host from
anywhere in the product.

The block states two consequences inline, because both are real: a host moved
off `browser`/`all` **drops off the list the browser extension polls**
(`/ai-platforms?surface=…` answers with the requested surface plus `all`), and
on an **ungoverned** row the capture mode is stored but never applied, because
endpoints only read `capture_mode` from governed rows.

### Server-side change

Exactly one line: `'egress_body'` was added to `USER_KINDS` in
`server/src/routes/dlp.js`, so the new body capture role-attributes as a **user**
turn (the human put that content in front of a system that carried it out of the
company). No schema change, no migration. `content_text` goes to `dlp_content`
like every other captured body and, like every other one, is **not** in
`server/src/lib/cef.js`'s SIEM allowlist — so a message body never reaches the
syslog feed.

### Auth, stated plainly

`GET`, `POST`, `PATCH` and `DELETE` on `/api/v1/ai-platforms` are mounted with
**no authentication middleware** today (`mountAiPlatforms` in
`server/src/routes/ai-platforms.js`). That is pre-existing and unrelated to this
feature, but it is the route the new `surface`/`capture_mode` opt-in is written
through — see §8.

---

## 7. Delivery — policy and code

**Policy** rides the existing 10s poll in `blocked-agents-sync.js`.
`refreshEgressSurfaces()` consumes the `/api/v1/ai-platforms` payload
`refreshBlockedAgents()` already fetched that tick — **no new HTTP request** —
and writes `~/.cloudfuze-aigov/egress-surfaces.json`:

```json
{"surfaces":[{"id":"outlook_classic","procs":["OUTLOOK"],"policyHosts":["outlook.office.com"],
  "policy_host":"outlook.office.com","capture_mode":"observe","enforce":false,"verified":false, "...":"..."}],
 "sync_roots":[]}
```

It is a **third, separate** file from `blocked-agents.json` and
`governed-agents.json` on purpose: merging them would let one bad parse arm a
mail client off an agent policy, or disarm an agent block off a mail policy. It
is an **object**, not a bare array — `enforcer-win.ps1` parses it with
`JavaScriptSerializer`, not the hand-rolled array splitter the other two files
use. Only ids and counts are logged, never a path, filename or recipient.
Consumers re-read it on their own cadence (`attachment-watcher.ps1` every 12
ticks, `file-dialog-watcher.ps1` every 25, `enforcer-win.ps1` every 10s), and
each swallows its own read failures into "nothing armed".

**Code** rides the existing hourly `agent/src/auto-updater.js`, which downloads
and extracts the agent **source** zip and restarts. Note the consequence: a
packaged SEA install (the Windows Claude Usage Tracker `.exe`) does **not** pick
up new source this way. That binary is still rebuilt separately with
`npm run deploy` from Windows — see `docs/AUTO_DEPLOY.md` and
`docs/INTUNE_SILENT_DEPLOY.md`.

---

## 8. Arming this for real — the checklist

Nothing below has been done. In order:

1. **Live-probe with a read-only UIA inspector** against a real Outlook install
   and fill in the measured `scopeWindow`, `bodySig` and `recipientSig`
   signatures, and confirm the process names with `tasklist`. A signature with a
   control type and nothing else is refused by `egressSignature()` (in a mail
   client it would match the whole window).
2. **Flip `verified` then `enforce`** on the specific entry — not on the catalog
   as a whole.
3. **Set `surface` to `desktop` or `all`** on the intended `ai_platforms` row in
   Inventory → AI Systems → Guardrail policy. Until this is done, gate 3 keeps
   the surface inert even with the flags flipped. Remember that this removes the
   host from the browser extension's list unless you choose `all`.
4. **Leave `capture_mode` on `observe` first.** Run it as report-only and check
   the events before considering `hold`.
5. **Before using `capture_mode: hold` in production, resolve the shared
   attach-hold slot** (§9, second item). This is an open defect, not a
   configuration note.
6. **Paperwork.** `docs/EMPLOYEE_DISCLOSURE.md` currently tells employees the
   agent does not collect the content of their messages, and `README.md` states
   that any expansion of collection scope must re-trigger legal review. Arming
   compose-body capture or sync-root observation is such an expansion. Both
   documents need HR/Legal review and updating before this is enabled on a real
   fleet; neither has been changed by this delivery.

---

## 9. Known gaps — open, not resolved

1. **Pre-existing, unrelated server auth gaps that this raises the stakes on.**
   The DLP content-read route and the `ai-platforms` write routes are
   unauthenticated (§6). This feature did not create either, and neither was
   fixed as part of it. They are flagged separately for a product decision.
   Relevant here because `surface`/`capture_mode` — the opt-in that arms desktop
   mail monitoring — is written through one of them.
2. **The attach-hold slot is shared and single-occupancy.** `#armAttachHold`
   clears all existing holds when a different process's attachment arrives,
   because the helper has one slot. Once `capture_mode: 'hold'` is enabled for a
   real deployment, an Outlook attachment could therefore interfere with an
   active Teams/Copilot hold. **Not yet fixed** — must be resolved before that
   configuration is used in production.
3. **The `data_egress` event-kind filter in connect-ui has no producer.** The
   filter, badge and "N of M" counter in the DLP events view read
   `metadata.surface_kind`, and **nothing in the agent or the server ever sets
   `surface_kind` on an event**. The control renders and filters, but will read
   "0 of N" until a producer is wired up. Do not treat it as working end to end.
4. **Several egress fields are dropped at ingestion.** `egress_surface`,
   `origin`, `recipient_domains` and `body_truncated` are computed by the agent
   but are not in the metadata allowlists in `server/src/routes/dlp.js`, so they
   do not reach `metadata_json` today. The agent-side values are correct; the
   server does not keep them yet.
5. **Possible under-reporting on rapid sends.** The body path's dedup key is
   `egress|<surface>|<sorted pattern names>` with a 10s TTL
   (`FIRE_DEDUP_TTL_MS`), so two sensitive emails sent inside the same ~10s
   window with the same pattern signature collide and only the first is
   recorded. Flagged for a design decision; **not yet fixed.**
6. **Coverage the OneDrive path structurally does not have.** A
   `FileSystemWatcher` overflow is a real gap (reported as `coverage_gap`, §5.2);
   only `Documents` and `Desktop` under the OneDrive root are watched; and
   `unknown`-origin files are an honest admission of ambiguity, not a
   confident upload record.

---

## 10. Verification performed

- Full agent suite: **673 passing**, with only the 3 pre-existing unrelated
  failures this repo's `CLAUDE.md` documents as known-failing and which CI does
  not run.
- Security review found and fixed: an arming-gate gap, a false "held" toast, a
  missing `surface` opt-in check, and a PowerShell type-coercion loophole on the
  two flags.
- Code-quality review found and fixed a JSON-parsing bug in the C# enforcer:
  `UpdateEgressPolicy` was parsing the object-shaped policy file with the
  bare-array splitter, which would have silently prevented `outlook_new` (and
  most other surfaces) from ever entering the hold set.
- The additive-only claim — that no existing Teams/Copilot code path, condition
  or regex was modified — was verified independently by two reviewers reading
  the full diff.
