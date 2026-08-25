# Silent, zero-touch deployment via Intune / Azure

Goal: push the **desktop agent (`.exe`)** and the **browser extension** to every managed
machine through the portal, with **no user interaction**, and have them **auto-connect**
so all Claude / AI usage is captured and attributed to the right person — in **both Edge
and Chrome**.

There are three capture surfaces. Each is deployed differently, but all end up in the
`dlp_events` collection and the **AI Usage** dashboard.

| Surface | Catches | Silent deploy mechanism |
|---|---|---|
| Desktop agent `.exe` | Desktop apps (Claude Desktop, ChatGPT Desktop, Cursor…) incl. sealed apps | Intune **Win32 app**, SYSTEM context |
| Browser extension | claude.ai + other AI sites, in Edge & Chrome | Browser **force-install policy** + **managed config** |
| Claude Code CLI | Terminal/CLI usage | Intune **device env vars** (OTel) |

## How the auto-connect works (already built)

- **Identity beacon** — the agent runs a localhost-only HTTP server on
  `127.0.0.1:19532-19536` serving `GET /cfai/identity` → `{hostname, user, machineId}`
  (`agent/src/identity-beacon.js`). On startup the extension probes those ports
  (`background/service-worker.js` → `fetchBeacon`) and re-enrolls as
  `<HOSTNAME>-browser-extension`, which the server maps back to that machine's user.
  Result: **browser usage attributes to the same person as the desktop agent**, with no
  browser sign-in and no per-user config.
- **Managed config** — the extension reads `serverUrl` + `enrollSecret` from
  `chrome.storage.managed` (populated by Intune/GPO) and **auto-enrolls on install** and
  whenever the policy changes. Managed policy overrides any local settings and locks the
  options page. Schema: `browser-extension/managed_schema.json`.

The **extension ID** is **assigned by the store** when you first publish (no signing key
needed). Chrome and Edge assign **different IDs** to the same extension, so record both:

- Chrome Web Store ID → `chrome://extensions` (Developer mode) or the item's Web Store URL.
- Edge Add-ons ID → `edge://extensions` or the item's Edge Add-ons URL.

Both the force-install list and the managed-config policy target that ID (per browser).

---

## Part A — Desktop agent `.exe` (Intune Win32 app, zero clicks)

The agent has a dedicated **silent, all-users** install mode so nobody double-clicks
anything. `--install-system` copies it to `%ProgramData%\CloudFuze\ClaudeTracker` and
registers **one Scheduled Task that starts it at logon for every user, in that user's
interactive session** (which is the only place keystroke/UIA capture works). It needs
admin — which the Intune SYSTEM context already has — and prints to the Intune log, no
window.

1. Build the binary (Windows only — Node SEA is platform-bound):
   `npm run build:claude-tracker` from `AI-Governence/agent/`. Keep
   `CloudFuzeClaudeTracker.exe` and `prompt-watcher.ps1` **together**.
2. Wrap both files with the **Microsoft Win32 Content Prep Tool**
   (`IntuneWinAppUtil.exe`) → `.intunewin`.
3. Intune → **Apps → Windows → Add → Windows app (Win32)**:
   - **Install command:** `CloudFuzeClaudeTracker.exe --install-system`
   - **Uninstall command:** `CloudFuzeClaudeTracker.exe --uninstall-system`
   - **Install behavior:** **System**.
   - **Detection rule:** file exists →
     `%ProgramData%\CloudFuze\ClaudeTracker\CloudFuzeClaudeTracker.exe`.
   - Assign to device groups as **Required**.

No user click, no console, no per-user setup. Anyone who logs in gets the agent running
in their session, and its identity beacon comes up automatically for the extension to
link to. (The old double-click path — per-user `HKCU` + a console window — still exists
for manual one-off installs, but is **not** used for Intune.)

## Part B — Browser extension (Edge **and** Chrome)

Chosen route: **store-published + managed config** (no signing key).

### Step 1 — Publish (one-time)

Upload the extension to the **Chrome Web Store** and **Edge Add-ons** (both support
**unlisted / private** visibility for internal-only distribution). Record the ID each store
assigns — they differ per browser.

### Step 2 — Push two policies per browser

**force-install** puts it on every machine, un-removable; **managed config** hands it
`serverUrl` + `enrollSecret` so it self-enrolls.

#### Option 1 (recommended): one PowerShell script

Deploy **`scripts/intune-provision-extension.ps1`** as an Intune **Platform script**
(device context) or a Win32 app. Edit its CONFIG block first: `$ChromeExtensionId`,
`$EdgeExtensionId`, `$ServerUrl`, `$EnrollSecret`. It writes, for each browser:

- `…\ExtensionInstallForcelist\1 = "<store-id>;<store-update-url>"`
- `…\3rdparty\extensions\<store-id>\policy\serverUrl`
- `…\3rdparty\extensions\<store-id>\policy\enrollSecret`

(Registry roots: `HKLM\SOFTWARE\Policies\Microsoft\Edge` and
`HKLM\SOFTWARE\Policies\Google\Chrome`. Store update URLs are the script defaults.)

#### Option 2: Intune Settings Catalog (ADMX-backed)

Ingest the **Edge** and **Google Chrome** ADMX, then set:
- **Control which extensions are installed silently** → add the store ID + update URL.
- Managed config goes through the `3rdparty\extensions\<id>\policy` node — use a
  **Custom OMA-URI** or the script above for `serverUrl`/`enrollSecret`.

> The extension reads managed config on install/startup and on policy change, so once the
> policy lands the user just needs to (re)start the browser — no options page, ever.

---

## Part B2 — Browser-only rollout (extension force-installed, **no** desktop agent)

Valid deployment, but identity works differently and the difference is silent, so
read this before choosing it.

### What you get with zero user action

Everything enforcement-related works with no identity at all: blocking AI apps and
Copilot agents, sensitive-prompt and file blocking, Tokenize & Send, model routing,
access requests, and tool discovery. `content.js` never consults a user identity —
policy is per host and org-wide, and access approvals are keyed on `machine_id`.

What you lose without identity is only the answer to *"which employee did this"*.
Rows read `Browser User (…)`. That id is a UUID persisted in the browser profile, so
it is stable per browser and still usable for "this browser has 40 blocked prompts".

### Getting the username **deterministically**

Without the agent there is no identity beacon, so the extension falls back to the
signed-in browser profile (`chrome.identity.getProfileUserInfo`, `accountStatus:
'ANY'` so it does not require sync). That is only reliable if profile sign-in is
**enforced by policy** — which is another admin policy, not user action, pushed the
same way as the force-install:

| Browser | Policy | Value |
|---|---|---|
| Edge | `HKLM\SOFTWARE\Policies\Microsoft\Edge\BrowserSignin` | `2` (force sign-in) |
| Chrome | `HKLM\SOFTWARE\Policies\Google\Chrome\BrowserSignin` | `2` (force sign-in) |
| both | `RestrictSigninToPattern` | e.g. `.*@yourcompany\.com` — stops a personal account being the identity |

**The browser you pick decides whether this works.** Edge signs in with the
Entra/AAD work account, which on an Entra-joined Windows machine is automatic and
is the corporate email — so on an M365 estate, Edge gives a guaranteed username with
nobody doing anything. Chrome signs in with a **Google** account, so forcing Chrome
sign-in only produces a corporate email if the company has Google Workspace. An
M365-only shop that force-installs on Chrome will get `Browser User (…)` no matter
what policy is set.

Also set, alongside `serverUrl` and `enrollSecret`:

- `…\3rdparty\extensions\<store-id>\policy\browserOnly = 1`

Without it the extension waits five minutes on every machine for an agent beacon
that will never arrive (`ENROLL_BEACON_GRACE_MS`), leaving newly provisioned
machines ungoverned for that window. With it, enrollment happens on install.

Do **not** try to push `computerName` per machine: one policy value is the same
string for every device it targets, so it cannot carry a real hostname.

### Confirming it worked — the one test that matters

Enrollment now records **where** the identity came from, so this is a fact on the
record rather than something to infer from a blank column. On one pilot machine,
after the policy lands and the browser restarts:

```
GET /api/v1/machines        # find this machine by its id
```

`identity_source` will be one of:

| Value | Meaning |
|---|---|
| `agent_beacon` | desktop agent named the OS user (best) |
| `managed_policy` | admin pushed `userEmail` |
| `browser_profile` | signed-in browser profile — **the browser-only success case** |
| `none` | nothing to attribute to; sign-in is **not** enforced, or the user is signed out |

`none` across a fleet that was supposed to be attributed means the `BrowserSignin`
policy did not apply — that is the whole point of recording it. Check this on one
machine before rolling out to everyone; it decides whether you need the agent.

## Part C — Claude Code CLI (OTel)

Push these as **device environment variables** (Intune Settings Catalog → *Environment
variables*, or a small script setting machine-level env vars):

```
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_EXPORTER_OTLP_ENDPOINT=https://agentgovernence.cftools.live/api/v1/otel
```

CLI prompts/tokens then flow to `POST /api/v1/otel/v1/logs` and attribute per user email.

---

## Verification

1. **Agent**: on a test box, browse to `http://127.0.0.1:19532/cfai/identity` — you should
   get `{hostname,user,machineId}`.
2. **Extension**: `edge://extensions` / `chrome://extensions` shows the extension
   **Installed by your organization** and non-removable. Its options page shows
   *"Configured by your organization (managed policy)."*
3. **End-to-end**: send a prompt on claude.ai and in Claude Desktop, then open the
   **AI Usage** dashboard — both should appear under the same real user within a minute.

## Notes / limits

- The store-assigned IDs are permanent per browser; put both in the policy.
- Managed config takes precedence over anything a user typed and locks the options fields.
- Removing the policy does **not** wipe the last-known config from `storage.local`; the
  extension keeps working offline until re-provisioned. Reset via the options **Reset**
  button or by clearing extension storage.
