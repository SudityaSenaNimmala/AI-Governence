
# CloudFuze AI Governance — Roadmap

Snapshot as of 2026-05-19, after the HTTPS proxy PoC went live and was tested
against Claude Desktop, Store ChatGPT, and Chrome.

Three coverage layers exist today:
- **asar hook** (Claude Desktop, Cursor when injectable) — DOM-level, shows centered modal
- **browser extension** (Chrome, Edge on chatgpt.com / claude.ai / gemini / etc.) — same modal
- **HTTPS proxy** (universal on Windows) — network-level 451 block
- **OS monitor** (universal on Windows) — detect + log + toast

Work through this top-to-bottom. P0 = blocks production. P1 = blocks customer
expansion. P2 = blocks bigger deals. P3 = nice-to-have. P4 = paperwork.

---

## P0 — blockers for any production rollout

- [ ] **Persist JWT_SECRET on server**
  Today: `server/src/auth.js` regenerates the signing key on every restart, so
  every existing agent token is invalidated. We hit this once already today.
  Fix: set `JWT_SECRET` via `.env` (and document it as required for any
  non-dev deployment). Add a startup warning if it's still using a random
  value.

- [ ] **`ADMIN_TOKEN` defaults to a hardcoded literal (`'dev-admin-token'`) with no override**
  `server/src/auth.js:39` — when `ADMIN_TOKEN` isn't set in `.env`, `requireAdminAuth`
  accepts this well-known string from source as a valid admin credential. Confirmed
  exploitable while debugging the M365 feature: a subagent used it to authenticate
  and write directly to the live database. Fine for local dev; must not reach
  production. Fix: refuse to start (or hard-fail every admin route) if
  `ADMIN_TOKEN` is unset and `NODE_ENV`/an equivalent isn't `development`, same
  spirit as the `JWT_SECRET` fix above. Related to, but distinct from, the
  "real admin session/login for connect-ui" item further down — that one is
  about the frontend having no login flow; this one is about the server
  accepting a public default when no token is configured at all.

- [ ] **MSI installer for the agent**
  Today: install = `git clone` + `npm install`. Not customer-shippable. Need a
  signed MSI that drops the agent, installs the CA, and registers the Windows
  service. Likely tools: WiX or Inno Setup with `electron-builder`-style
  packaging.

- [ ] **Cert-pinning fallback per app**
  Today: if an app pins its cert chain (won't trust our CA), the request just
  fails with no block message — the user sees a generic network error. Need:
  a config of "known-pinning hosts" that the proxy bridges instead of
  intercepting, plus a graceful "report-only" mode that still logs the event
  even though the body wasn't scanned.

- [ ] **Verify dashboard renders `proxy_block` events correctly**
  Today: events are emitted with `mechanism: proxy_block` but the dashboard
  was built before that field existed. Confirm the event timeline shows them
  with the right icon/label and distinguishes them from `enforcement_block`
  from the hook/extension.

- [ ] **Scan captured AI responses for sensitive data**
  Session Replay (Phase 3) now captures the AI's reply text on ChatGPT,
  Claude, and the OpenAI/Google APIs, but nothing scans it — if a model
  echoes back a secret or PII from context, it's stored with `matches: []`
  and never raises severity. Reuse the existing pattern-scan engine on
  `ai_response` content the same way it already runs on prompts.

- [ ] **Per-process attach-hold isolation (Outlook can silently clear a Teams/Copilot send-hold)**
  The desktop agent's attach-hold mechanism (`#armAttachHold`/`this.attachHolds`
  in `os_monitor/index.js`) has one shared slot bound to a single process. Once
  the new Outlook egress surface's `capture_mode:'hold'` is actually enabled for
  a real deployment, attaching any scannable file in Outlook while a Teams/
  Copilot hold is active for a different sensitive file clears that hold —
  silently unblocking a send the org meant to keep blocked. Must be fixed
  before `capture_mode:'hold'` is used in production for any egress surface.

- [ ] **Legal/HR review of employee disclosure before compose-body capture or OneDrive observation is armed**
  The new Outlook egress surface can capture full email body text, and the new
  OneDrive/SharePoint sync-root watcher observes files landing in a user's
  synced folders — both currently ship inert (`verified:false`), but
  `docs/EMPLOYEE_DISCLOSURE.md` and the README's own claims currently tell
  employees message content is not collected. That documentation needs
  legal/HR sign-off and an update before either capability is armed on a real
  fleet, independent of the technical live-probe pass.

- [x] **Require authentication on `POST /api/lifecycle/block` and `/unblock`**
  Both routes are now gated with `requireAdminAuth`, alongside `PUT
  /api/v1/registry/:id/status` and `PATCH /api/v1/ai-platforms/:host` (found
  to have the same exposure while auditing the M365 per-agent blocking
  feature). `GET /api/lifecycle/blocked-agents` stays public on purpose (the
  extension polls it without a token). connect-ui's write call sites were
  updated to send the admin credential so the dashboard's Block/Approve
  buttons keep working.

- [ ] **`POST /api/lifecycle/dlp-monitor` has the same untyped `agent_id` and is still unauthenticated**
  Same class of bug as the block/unblock routes just fixed: `agent_id` is
  checked only for truthiness before flowing into a Mongo filter (NoSQL
  injection risk — a crafted object can match/overwrite an unrelated row),
  and the route has no auth middleware. Its helper lives in
  `server/src/governance/dlp-monitor.ts`. Found auditing the M365 per-agent
  blocking feature; not fixed there because that file was mid-edit by other
  in-progress work at the time.

- [ ] **`POST` and `DELETE /api/v1/ai-platforms` are still unauthenticated**
  Only `PATCH /api/v1/ai-platforms/:host` was gated when the sibling write
  routes were fixed. `DELETE` removes a governed/blocked host outright — a
  block-lifting action by another name — with no auth check today.

- [ ] **An agent blocked before the registry→`blocked_agents` mirror existed has no enforcement row, and the UI can't self-heal it**
  Hit live while testing the M365 feature: "IT Help Desk Agent" shows
  `status:"blocked"` in AI Systems (from `sanctions`), but never got a
  `blocked_agents` row — `GET /api/lifecycle/blocked-agents` doesn't list it
  and the desktop agent's local `blocked-agents.json` confirms it's absent,
  so the agent is fully usable despite the UI. Root cause: the row's blocked
  status predates the mirror-write logic in `PUT /api/v1/registry/:id/status`
  (`server/src/routes/registry.js`), which only fires on a write that carries
  `category`/`source`/`platform`. `RegistryToggle`
  (`connect-ui/AIHubPage.jsx:4073`) is a binary switch — when status is
  already `"blocked"`, clicking it sends `'approved'` (the opposite state),
  so there is no "reconfirm current status" action to trigger the mirror
  write without first un-blocking. Workaround: toggle to Allowed, then back
  to Blocked. Needs either a server-side reconciliation job (find
  `sanctions.status:'blocked'` / agent rows with no matching `blocked_agents`
  row and backfill them) or a UI "re-apply" action that resends the current
  status. Related to, but distinct from, the `platform:null` backfill item
  below — that one has a row with bad data; this one has no row at all.

- [ ] **Browser extension feature flags are read from a page-writable DOM attribute**
  `content.js` publishes flag state to `document.documentElement`'s
  `data-cfai-features` attribute and then reads it back on every check,
  preferring it over the extension's own cached copy — but `documentElement`
  is shared with the page's main world, so any script on any visited page can
  overwrite it (e.g. `setAttribute('data-cfai-features','{"dlp":{"status":
  "disabled"}}')`) and silently disable DLP scanning, guardrails, or other
  flags for that tab. Found auditing the M365 per-agent blocking feature; the
  fix is to stop trusting that attribute as an input and read flags only from
  the extension's own `chrome.storage.local`-backed cache.

---

## P1 — broader OS / browser coverage

- [ ] **macOS proxy**
  Mirror Windows: CA install into the macOS keychain via `security
  add-trusted-cert`, system proxy via `networksetup -setwebproxy /
  -setsecurewebproxy`, agent as a LaunchAgent.

- [ ] **Linux proxy**
  CA install into `/etc/ssl/certs` (Debian/Ubuntu) and `update-ca-trust`
  (RHEL/Fedora). System proxy via `gsettings`/`environment.d`. Agent as a
  systemd unit.

- [ ] **Firefox CA install path**
  Firefox uses its own NSS-based trust store, not the OS one. Need a small
  routine that walks Firefox profile dirs and installs the CA via `certutil`
  (NSS, different from Windows `certutil`).

- [ ] **Cursor injection — alternative bundling**
  Cursor's install has `node_modules.asar` but no `app.asar` at the expected
  path. Need to inspect Cursor's actual main-process layout and write a
  Cursor-specific injection path. Until then Cursor is proxy-only.

- [ ] **Block the mouse-click send button in desktop AI apps**
  The OS-monitor keystroke enforcer swallows Enter + Ctrl+V, but a user can
  still click the send arrow to bypass the block. Need a WH_MOUSE_LL hook that
  locates the send control (UIA hit-test at cursor) and swallows the click
  when the prompt holds a blocked pattern.

- [ ] **First-class staged-enforcement switch (observe → hold → block_critical) across all surfaces**
  `capture_mode` (observe / block_critical / hold, default observe) is modeled on each AI
  platform and drives the hold flow, but the browser extension / OS monitor / proxy clients
  currently enforce off severity + the platform `blocked` flag rather than reading
  `capture_mode` uniformly. Wire all client surfaces to honor the same mode so an admin gets
  one monitor-then-enforce rollout control (read-only → approval → block) per platform.

- [ ] **Fix MCP filesystem target extractor mis-parsing npx package name as a directory**
  `mcp_inspection.js` filesystem rule treats the `@modelcontextprotocol/server-filesystem`
  arg as a directory target (its path regex matches the `/`), polluting data-flow
  targets with a false directory. Skip the package/spec arg before extracting dirs.

- [ ] **Real admin session/login for connect-ui, replacing the build-time VITE_ADMIN_TOKEN**
  Admin-only routes (Access Requests approve/reject, SDK projects, tracing observations,
  session-replay media) are gated server-side by `requireAdminAuth`, but connect-ui's
  `adminFetch` only ever sends a bearer sourced from `import.meta.env.VITE_ADMIN_TOKEN` at
  build time — there is no login flow and no server-set session cookie. A production build
  without that env var baked in has every admin-gated view (including the new desktop
  Request Access queue) permanently non-functional, with no in-product way to fix it short
  of a rebuild.

- [ ] **Endpoint enforcement for MCP servers (quarantine blocked MCP servers from config)**
  Today MCP handling is discovery-only — a server can be sanctioned `blocked` in the
  catalog but nothing acts on it; the proxy/hook/OS-monitor only cover prompt/file
  flows to AI services, not local stdio MCP subprocesses. Add agent-side remediation
  that neutralizes a blocked server's config entry (move to a quarantined block / mark
  disabled) so the host app never launches it, and record the action as a finding.

- [ ] **Content-level MCP DLP — stdio guard shim (block sensitive payloads, keep server running)**
  Analog of the HTTPS proxy but for MCP's JSON-RPC-over-stdio. Rewrite the config launch
  command to wrap the server (`cfai-mcp-guard <real command>`); the shim pass-throughs the
  `initialize`/`tools/list` handshake, scans `tools/call` arguments (and optionally redacts
  results) with the existing `os_monitor/classifier.js` pattern engine, and returns a
  JSON-RPC error for calls carrying sensitive data instead of forwarding them — selective
  content blocking, not a kill switch. Remote (HTTP/SSE) MCP servers can reuse the existing
  proxy by whitelisting the endpoint and scanning JSON-RPC bodies.

- [ ] **Fix streamed AI responses with no usage block being dropped entirely**
  `cost-parser.js` returns `null` for any API call with no token-usage data,
  which silently discards the already-reassembled response text along with
  it — a real data-loss bug in Session Replay's response capture (Phase 3),
  not just a cost-accounting gap.

- [ ] **Capture AI responses from Microsoft Copilot and Poe**
  Session Replay (Phase 3) can't capture replies from these today — both use
  transports (SignalR / GraphQL-over-WebSocket) that bypass the fetch/XHR
  interception the current capture approach relies on. Copilot in particular
  is widely used in enterprise M365 environments.

- [ ] **Add missing index for the Session Replay list sort**
  `GET /api/v1/sessions` sorts `ai_sessions` by `last_activity_at`, but no
  index backs that field — today it's an unindexed in-memory sort, which
  MongoDB hard-errors on past 32MB of sorted data. Add
  `createIndex({ last_activity_at: -1 })` in `applyInitialSchema`.

- [ ] **Audit log for video recording playback**
  Session Replay's video recordings (screen captures of employee AI usage)
  can currently be played back via the admin-authenticated media routes with
  no record of who watched what, when. For data this sensitive, an access
  log (who, which recording_id, timestamp) should be close to a baseline
  requirement, not a follow-up.

- [ ] **Browser extension: "Stop recording" doesn't survive a full page reload**
  Session Replay's stop latch lives in the content-script instance; a full page
  reload creates a new instance while the underlying engagement/session
  survives, so recording silently resumes mid-engagement after a user
  explicitly stopped it.

- [x] **Execute policyEngine actions (suspend/escalate/notify) instead of only recording them**
  Today `policyEngine` templates advertise `suspend`/`escalate`/`notify` actions, but
  `policies.ts` only writes `action_taken: actionRecommended` — a string of what *should*
  happen. Nothing suspends an agent, routes an escalation, or sends a notification. Wire
  the recommended actions to real effects (Graph disable/suspend, escalation queue, email/webhook).

- [ ] **Fix routing-toast notification building HTML from page-controlled text**
  Today: `showRoutingToast` in `browser-extension/content/content.js` builds `innerHTML`
  from the currently-selected model button's text, which is page DOM content — a hostile
  AI-site page could inject markup into our own model-routing toast. Fix: build the
  page-derived model name with `textContent`, not string-concatenated `innerHTML`.

- [ ] **Tracker heartbeat so "Last seen" reflects liveness, not enrolment time**
  `POST /api/v1/dlp` never touches `machines.last_seen` — only enrol, identity, otel and
  scan-report paths do. A tracker-only machine therefore shows its enrolment timestamp
  forever, so an install that died seconds after enrolling is indistinguishable from a
  healthy one that has simply been idle.

- [ ] **Include tracker source in the installer freshness stamp**
  `stampFor()` in `server/src/lib/tracker-build.js` hashes only serverUrl, enrollSecret,
  target and node version. A change to the tracker's own source does not move the stamp, so
  a container that already holds a `.built-with` marker keeps serving an installer built
  from older code — and logs `installer already built` while doing it. Hash the tracker
  sources (or the bundle) into the stamp as well.

- [ ] **Surface unattributed enrolments in the Claude Usage UI so hidden prompts are re-linkable**
  `GET /api/v1/claude-usage` already returns `unattributed_rows` / `unattributed_prompts`
  for enrolments whose hostname is a browser user agent, but `ClaudeUsageView` renders
  neither. Prompts that reached the server vanish from the page with nothing saying they
  exist; add a visible row and a way to claim it to a person.

- [ ] **Fix substring false-positives in detectModelInfo's tier keyword matching**
  `detectModelInfo` (browser-extension/content/content.js) matches provider/tier keywords
  via plain substring `.includes()`, so "Gemini" contains "mini" (misdetected as OpenAI
  economy tier, checked before the Google rules ever run) and "prompt"/"professional"/etc.
  contain "pro" (misdetected as Google premium tier). Found while porting this logic to the
  desktop model router (agent/src/os_monitor/enforcer-win.ps1), which faithfully replicates
  the same bug for parity — fixing it here should be mirrored there too. Needs word-boundary
  matching or a stricter token check instead of raw substring search.

- [ ] **Desktop enforcement doesn't detect/block terminal-based CLI AI tools (e.g. Claude Code CLI)**
  The OS-monitor's `AI_PROCESSES`/`IDE_PROCESSES`/`AI_PANELS` catalogs only recognize
  GUI-hosted surfaces (standalone chat apps, IDE extension composer panels) — a terminal
  emulator running a CLI-based agent (e.g. the Claude Code CLI) is never in the foreground-
  process catalog at all, so it gets zero platform-block enforcement. Anyone blocked from an
  AI platform on desktop can bypass it entirely by using that platform's CLI in a terminal.

- [ ] **Browser extension's blocked-agent enforcement doesn't cover file uploads**
  `enforceBlockedAgent()` in `content.js` only disables text composer elements (`textarea`,
  `[contenteditable]`, `[role="textbox"]`) and blocks Enter + clicks inside the composer's
  container. Drag-and-drop (`emitFileUpload(f, 'drop')`) and clipboard-paste-of-a-file
  (`emitFileUpload(f, 'clipboard')`) run independently and never check agent-block state, and
  the `input[type="file"]` element itself is never disabled — a blocked agent can still
  receive a file through any of these three paths even though typed prompts are correctly
  stopped.

- [ ] **Wire egress_surface/origin/recipient_domains/body_truncated into DLP storage**
  The new Outlook/OneDrive egress feature computes these fields on every event
  (`os_monitor/index.js`), but `server/src/routes/dlp.js`'s metadata builders
  drop all four at ingestion — neither the file-upload branch nor the generic
  branch has a key for them. `origin` (local-write vs. ambiguous) and
  `recipient_domains` (did a flagged attachment leave the tenant, to where) are
  described in the code as the main governance value of those records, and
  neither reaches storage today.

- [ ] **Backfill existing `platform:null` blocked-agent rows**
  Both `PUT /api/v1/registry/:id/status` and `POST /lifecycle/block` now derive
  a missing `platform` from `discovered_agents` at write time (fixed while
  building Microsoft-workspace agent blocking), but historical rows written
  before that fix are only marked `unenforceable` on read — they stay
  unenforced everywhere until an admin happens to re-block them. A one-shot
  migration (derive from `discovered_agents`, leave genuinely underivable rows
  marked) would close the gap without touching the annotate-never-drop rule.

- [ ] **Server-wide DNS resolver override affects more than MongoDB**
  `server/src/db/mongodb.js` calls `dns.setServers(['8.8.8.8','1.1.1.1'])` at
  module scope, which replaces the resolver for the entire Node process — not
  just the Mongo driver's SRV lookup. That means SIEM forwarding and
  customer-configured webhook destinations also resolve against Google/
  Cloudflare instead of the customer's own (possibly split-horizon/internal)
  DNS, leaking internal hostnames to third-party resolvers and bypassing any
  DNS-based egress control on the customer's network. Fix: use a
  driver-scoped `Resolver` instance for the Mongo lookup only, or make the
  override opt-in via env var, defaulting to system DNS.

- [ ] **Attribute M365 Copilot agents on DLP events when the org has only governed (not blocked) rows**
  The desktop enforcer reads the open agent's name only when a blocked agent-scoped row exists for the platform, so orgs with only governed rows get `agent_src: "none"` on block/redact events.

- [ ] **"Copy masked text" fallback in the CLI Tokenize popup (`toast-helper.ps1`)**
  Phase 0 added the fallback to the Electron block dialog only; a failed rewrite from the CLI popup still leaves the user with no masked text to paste.

- [ ] **ML-based prompt-injection/jailbreak detection (incl. indirect injection in files/tool outputs)**
  Today it is 24 regex guardrail patterns; CrowdStrike Falcon AIDR/Guardian claims 200+ techniques with a trained detector (competitive gap, 2026-09-25).

- [ ] **Inline guardrail API/SDK + AI gateway plugins (LiteLLM, Kong, Portkey) for homegrown AI apps**
  Our SDK only traces; apps and gateways cannot call us to block/redact inline before the model sees the prompt.

- [ ] **Agent runtime guardrails — Claude Code hooks + Copilot Studio external threat-detection (tool-call allow/block)**
  Claude tracker is observe-only and Copilot Studio agents are only discovered/suspended; neither gets a pre-execution allow/block on prompts or tool calls.

- [ ] **Malicious URL/IP/domain detection in prompts & responses with threat intel + defang**
  No detector exists for malicious entities today; would report, defang or block them.

- [ ] **Agent action tracing — link a prompt to the processes/files/network calls the agent then made**
  We detect agent frameworks and MCP configs but never trace what an agent does after a prompt (Falcon Guardian "see what AI agents actually do").

- [ ] **Endpoint agent allow-list — stop unapproved agent processes from running (with Request access)**
  The 24 detected agent frameworks are reported only; reuse the existing access-request flow to gate unapproved ones.

- [ ] **AI incident reconstruction + one-click containment (kill agent, quarantine MCP, suspend/revoke)**
  Builds on agent action tracing; ties existing suspend/delete and the planned MCP quarantine into one incident view.

- [ ] **Format-preserving (reversible) encryption option alongside redact in Tokenize & Send**
  Today desktop masking is fixed labels; the proxy token vault is reversible but not format-preserving.

---

## P2 — enterprise distribution

- [ ] **Support recording multiple browser tabs concurrently**
  Session Replay's video capture currently allows only one armed/recording
  tab at a time — a second tab is refused loudly rather than silently
  failing, but this limits power users with multiple AI conversations open
  at once. Would require multiplexing through the single offscreen document
  (only one may exist per extension) rather than one document per tab.

- [ ] **More durable offline video buffering**
  Session Replay's video capture buffers unsent segments in-memory only
  (capped at 8 segments / 32MB) when the server is unreachable — the buffer
  dies with the offscreen document and old segments are dropped past the
  cap. An IndexedDB-backed buffer would survive longer outages and document
  restarts.

- [ ] **Admin UI for video recording policy**
  Session Replay's recording policy (fps, bitrate, resolution, max duration,
  retention days) is currently hardcoded server-side defaults with no way
  to configure per-tenant without a code change. Needs a settings screen.

- [ ] **Group Policy / Intune playbook for CA + agent distribution**
  One-pager IT can hand to a sysadmin: how to deploy the CA via GPO Trusted
  Root policy, how to push the MSI via Intune, sample policies.

- [ ] **Windows Service mode (tamper resistance)**
  Today the agent runs as a user-mode Node process — `taskkill` ends it.
  Wrap with `node-windows` or use a Go/Rust supervisor that restarts the
  agent if killed, with restricted ACL so non-admin users can't stop it.

- [ ] **One-pager for customer IT (sales enablement)**
  Plain-English explanation of: what we install, what we decrypt, where data
  goes, performance impact, uninstall path.

- [ ] **`JWT_SECRET` rotation procedure**
  Even when persisted, need a documented "rotate without breaking everyone"
  procedure. Probably: dual-key (accept old + new for 7 days) then switch.

- [ ] **Onboarding flow that auto-enrolls against the customer's CloudFuze tenant**
  Today: agent needs `--enroll-secret` on first run. Customers don't want
  per-laptop manual steps. Wire onboarding so the agent reads tenant ID +
  pre-provisioned auth from a deployment-time config file the MSI drops.

- [ ] **Desktop hook binary file content extraction (PDF/docx/xlsx/zip) parity with browser extension**
  The injected desktop hook scans uploads as UTF-8 text only; the browser
  extension extracts PDF/docx/xlsx and recurses into zips via bundled vendor
  libs. Enterprises expect identical file coverage across surfaces.

- [ ] **Capture AI responses from consumer Google Gemini (gemini.google.com)**
  Session Replay (Phase 3) supports the Google API/AI Studio surface but not
  consumer Gemini — it uses an internal `batchexecute` wire format (length-
  delimited nested arrays, no stable text path) that the current parser
  approach can't reliably read.

- [ ] **Paginate Session Replay's single-session message view**
  `GET /api/v1/sessions/:session_id` silently caps at 2000 messages
  (`messages_truncated` flag set past that). Add cursor pagination on
  `client_seq` for very long conversations.

- [ ] **Browser extension options page: validate serverUrl is https:// at input time**
  The options page's server-URL field accepts any URL (`type="url"`, no scheme
  check). A wrong or insecure URL currently only fails later, silently-ish, at
  the Session Replay gate rather than being caught when the admin configures it.

- [x] **Native SIEM/CEF/syslog export of decision + evidence records**
  Today external systems can only pull via REST or receive signed webhooks. Regulated
  buyers expect push into a SIEM/audit pipeline. Add a CEF/syslog (and/or scheduled
  audit-bundle) exporter for `dlp_events`, `approval_requests`, and `policy_violations`.

- [ ] **Make model-routing complexity lexicon admin-configurable**
  Today: `browser-extension/content/complexity.js`'s signal categories and weights
  (what counts as a "simple" vs "complex" prompt for Smart Model Router) are hardcoded
  in the extension. Needs a settings screen so an admin can tune routing behavior
  per tenant without a code change.


- [ ] **Stamp a correlation id on OS-monitor enforcement events**
  Today the enforcer and the keystroke prompt capture never learn each other's event
  ids, so the Activity table pairs a prompt with the block it triggered by a
  time/machine/pattern heuristic — 43 of 85 blocks pair, the rest stay on their own
  rows. An agent-side id would make the join exact, as it already is for the browser
  extension.

- [ ] **Broaden the complexity classifier's negative signals (factual lookups)**
  Today an unmatched prompt scores 0 and falls to `moderate` by design (never silently
  downgrade the user's chosen model), so cost savings only trigger on the ~30 negative
  terms or the arithmetic rule: `capital of France`, `what time is it in Tokyo` and
  `who wrote Hamlet` all bill at the standard tier. Needs terms that cannot misfire —
  "who is responsible for our GDPR compliance" must not become simple.

- [x] **Tokenize & Send support for IDE apps (Cursor/VSCode/Copilot)**
  Already works — `PanelUiaOk()` in `enforcer-win.ps1` now offers Tier B while an
  enforcing IDE panel has focus. This item was stale; found and corrected while
  designing Microsoft-workspace tokenization support.

- [x] **Tokenize & Send support for multi-line prompts**
  Fixed while building Microsoft-workspace tokenization support: masked
  multi-line text is now typed with a catalog-declared newline combo
  (Shift+Enter by default) between segments instead of being rejected.

- [ ] **Populate `ai_platforms.surface` from the admin UI**
  The field is schema'd and validated server-side (`browser`/`desktop`/`cli`/`all`)
  but no admin UI ever sets it — every row defaults to `browser`. The desktop
  agent's Inventory-block bridge (`monitor-runner.mjs`'s `synthesizePlatformBlocks`)
  has to route around this by filtering on the process catalog instead of
  `surface`. A settings control to set this properly would let desktop enforcement
  filter on the intended field directly.

- [ ] **Desktop host-block enforcement for IDE surfaces (Cursor, GitHub Copilot)**
  The Inventory-block bridge deliberately excludes any host resolving to a
  process with `useAttachmentWatcher:false` (currently Cursor + GitHub Copilot),
  since blocking Enter in an IDE has a much larger blast radius than a chat app.
  Blocking `cursor.com`/`github.com` from Inventory today has zero desktop effect.
  Needs its own design for how much of the IDE to actually block.

- [ ] **Require authentication on `GET /api/v1/ai-platforms`**
  Currently public/unauthenticated. The desktop agent already sends a bearer
  token on this route that the server ignores; the browser extension's own use
  of this endpoint would need checking before tightening it.

- [ ] **Notify the employee on access-request approval or expiry**
  Today the desktop's blocked-agents-sync only logs "agent X unblocked on this
  device" — nothing user-facing tells the employee their Request Access ask was
  approved, or that a temporary grant just expired and the agent is blocked
  again. Add a toast on both transitions, on desktop and (once it has the same
  exception polling) the browser extension.

- [ ] **Browser extension DLP coverage for Teams' native Chat-list agent conversations**
  `EMBEDDED_AI_FLOOR['teams.microsoft.com']` only matches Copilot-labelled
  containers, so a Copilot Studio agent reached through Teams' Chat list (not
  the embedded Copilot tab) gets no DLP scan and no Tokenize & Send in the
  browser — the mirror image of the desktop gap fixed by Microsoft-workspace
  tokenization support.

- [ ] **Warn the admin when blocking an agent whose name can never enforce**
  A blocklist row whose name is generic (matches `genericNames`, e.g. "Copilot",
  "Chat") or looks like a Teams group-chat participant list can never arm on the
  desktop enforcer — the block silently does nothing there. AI Hub has no
  indication of this today; surfacing it at block time (or in the inventory)
  would save an admin from assuming a block is enforcing when it isn't.

- [ ] **`data_egress` DLP filter/badge has no producer**
  connect-ui's DLP events view (`AIHubPage.jsx`) added an "Event kind" filter
  and a "Data egress captured" counter keyed on `metadata.surface_kind ===
  'data_egress'`, but nothing in the agent or server ever sets `surface_kind`
  on an event — the filter/counter permanently reads "0 of N", and once
  Outlook/OneDrive events do arrive they'll be mislabelled "AI service" instead
  of filtered out. Needs a real producer (e.g. derived server-side from
  `source === 'os_monitor_egress'`) before this control is meaningful.

- [x] **Surface the `orphaned` and `unenforceable` block markers in AI Hub**
  Done as part of the M365 per-agent blocking feature: AI Hub now shows a
  per-row enforcement-coverage badge (browser/desktop, from
  `unenforceable`/`unenforceable_reason` plus a hand-curated
  platform→surface map) and an "⚠ Possibly re-published" marker for
  `orphaned` rows (suppressed for manually-added blocks, which can never
  appear in a tenant scan by construction).

- [ ] **Desktop agent's `ui-helper` launcher can race its own cleanup**
  `agent/src/os_monitor/index.js`'s `_ensureUiHelper()` writes a temporary
  `.vbs` file to `~/.cloudfuze-aigov/`, spawns `wscript.exe` on it, then
  deletes the `.vbs` unconditionally after a fixed 5-second timeout. If
  `wscript.exe` is slow to actually start (e.g. under heavy system load), the
  file can be deleted before it's read, producing a visible Windows Script
  Host "Can not find script file" error dialog on the employee's desktop.
  Harmless (no data touched) but looks broken/unprofessional on a deployed
  governance agent. Fix: wait for `wscript.exe` to actually launch (or use a
  longer/adaptive delay, or delete on the helper's own exit) instead of a
  fixed timer race.

---

## P3 — coverage expansion

- [ ] **WebSocket body scanning in the proxy**
  Currently passed through transparently inside intercepted TLS tunnels.
  Add WebSocket frame parser + per-frame scan for text frames. Only matters
  when an AI vendor moves prompting to WebSocket (Claude doesn't today).

- [ ] **Multimodal: OCR images in file uploads + proxy multipart bodies**
  Patterns are text-only. A screenshot of an API key isn't caught.
  Hook the file upload path through tesseract.js (already a dep — used in
  the browser extension) to OCR images before pattern scan.

- [ ] **Mobile coverage**
  Phones / iPads on the corporate WiFi don't route through `127.0.0.1`.
  Options: network-side transparent proxy on the corporate gateway, or
  MDM-pushed proxy + CA to mobile devices. Network-side is the right answer
  for v2.

- [ ] **Persistent file/text content storage size policies**
  Today the proxy doesn't store the request body content beyond the
  governance event (which only has pattern names, not raw text). The OS
  monitor + extension + hook DO store full text (per the 2026-05-18 content
  storage decision). Decide whether proxy_block events should also include
  full text and align with the same retention policy.

- [x] **Wire the declared `policy.violation` webhook**
  `policy.violation` is listed in `WEBHOOK_EVENTS` but no `emitWebhook` call ever fires it,
  so subscribers can't receive Layer-B policy violations. Emit it from the policy-evaluation
  path (`policies.ts`) alongside the existing enforcement/approval webhooks.

- [ ] **Broaden model-routing classifier's stack-trace / error-label pattern coverage**
  Today: `complexity.js`'s structural detectors miss some real-world formats — labels
  like `TypeError:`/`ValueError:` (only bare `Error:` matches), Node's `at async fn (...)`
  stack frames, and bare Java frames pasted without the `Exception in thread` header.
  Common cases already work; this improves accuracy on the less common ones.

- [ ] **Batch `risk_score_high` webhooks into one digest per compute run**
  `POST /risk-scores/compute` fires one notification per high/critical profile per
  enabled hook. Harmless at current scale (2 high-risk people × 2 hooks = 4 messages),
  but it grows linearly with headcount — a 500-person org at 15% high/critical would
  send ~150 per click, and a flooded channel is a channel someone disables.

---

## P4 — legal / policy (non-code)

- [ ] **Update privacy policy / DPA to disclose proxy decryption**
  The proxy decrypts every outbound AI request in plaintext on the user's
  machine. The general AI-monitoring sign-off probably doesn't cover this
  specifically. Get legal to add a line: *"The CloudFuze AI Governance
  agent decrypts outbound AI vendor traffic locally for pattern scanning.
  Decrypted content does not leave the user's machine unless a sensitive
  pattern matches, in which case the matched event (not the full prompt)
  is reported to the governance backend."*

- [ ] **Employee handbook — AI monitoring disclosure**
  Standard "your AI use is monitored for sensitive data leakage" notice.
  Some EU jurisdictions require explicit works-council approval before
  enabling.

- [ ] **Customer-facing security whitepaper**
  How the proxy works, what we see / don't see, how we secure the local CA
  private key, SOC 2 / ISO scope, etc. Required for sale into regulated
  customers (finance, healthcare, defense).

---

## Done — 2026-05-19

- [x] OS monitor: removed clipboard scrubbing (block-on-send model only)
- [x] OS monitor: keeps Windows toast notifications for all AI apps
- [x] Desktop hook v0.5.0: rewrote to use intercept-on-send + centered modal popup (no DOM mutation of host app)
- [x] Desktop hook: split renderer into `hook-renderer.js` so single-level escaping works (was previously broken in production)
- [x] Desktop hook: bridge stub now pushes to `__cfaiRendererQueue` so events actually reach the governance backend
- [x] HTTPS proxy: full implementation under `agent/src/proxy/`
  - [x] CA generation (RSA-2048, 10-year root, persisted)
  - [x] Leaf cert minting on the fly per host with SAN, RSA-2048, 90-day
  - [x] Trust-store install into `Cert:\CurrentUser\Root` (no admin needed)
  - [x] MITM proxy server: HTTP + HTTPS-CONNECT, intercept-or-bridge by whitelist
  - [x] Body scan + 451 block with full match info, governance event with `mechanism: proxy_block`
  - [x] System proxy registration (HKCU) with full save/restore + crash-safe recovery
  - [x] CLI: `--proxy`, `--proxy-port`, `--proxy --uninstall`
  - [x] Smoke tests: CA verify (`scripts/proxy-ca-smoke.mjs`), full E2E round-trip (`scripts/proxy-roundtrip-smoke.mjs`)
- [x] Tested live against Claude Desktop + Store ChatGPT + Chrome

## Done — 2026-09-22

- [x] **Per-agent blocking extended to Microsoft 365 Copilot agents**
  Copilot Studio agents, personal/declarative agents, SharePoint-embedded
  agents, Teams apps, and ISV-store agents are now blockable by name across
  Teams, Word, Excel, PowerPoint, OneNote, Outlook web, SharePoint, and
  microsoft365.com, on both the browser extension and the Windows desktop
  agent — matching how blocking already worked for Claude/ChatGPT. AI Hub
  now shows, per blocked agent, which surface(s) actually enforce it
  (`unenforceable`/`unenforceable_reason` from the server, rendered as a
  Browser/Desktop coverage badge), and admins can manually block an agent
  the tenant scan never found. The Word/Excel/PowerPoint/OneNote Copilot
  pane's agent-identification and the browser's panel-scoped DOM
  agent-label reader both ship inert (`enforce:false`/an unregistered
  feature flag) pending a live verification pass against a real M365
  tenant; Outlook desktop is deferred (conflicts with an existing
  egress/panel-surface safety invariant). Security review of this feature
  also found and fixed: unauthenticated writes on
  `POST /api/lifecycle/block`/`/unblock`, `PUT /api/v1/registry/:id/status`,
  and `PATCH /api/v1/ai-platforms/:host` (now admin-auth-gated); an untyped
  `agent_id` NoSQL-injection risk on the same routes; an XSS via an
  unescaped blocked-agent name in the extension's toast; an over-broad
  substring name-match that the widened host list would otherwise have
  turned into a false-positive risk; and a live-data-observed access-exception
  regression where the browser extension's `subtractAccessExceptions` reused
  the widened block-lookup host list to decide whether an approval applies,
  so a grant on one host could silently lift a block on ten others (fixed by
  giving exceptions their own narrower, desktop-derived host map —
  `PLATFORM_EXCEPTION_HOST_PATTERNS` in `browser-extension/lib/blocked-agents.js`).
