
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
