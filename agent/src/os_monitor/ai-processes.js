// Catalog of process names we treat as AI surfaces. When one of these is the
// foreground window AND the clipboard changes (or a file is opened), we capture
// the event. This is the universal layer — works for every install method
// (Microsoft Store, regular .exe, portable, snap, flatpak) because we only
// match on the running process name, never on install path or binary signature.
//
// Names are matched case-insensitive against the process name (without .exe).

// `useAttachmentWatcher`: should the UIA attachment-chip watcher (the
// drag-drop detector in attachment-watcher.ps1) treat this app's UI tree
// as a source of attachment filenames?
//
//   true  — pure chat apps where filenames in the accessibility tree only
//           appear when something is genuinely attached (ChatGPT Store,
//           Comet, Gemini, etc.)
//   false — apps that expose filenames continuously as part of their
//           normal UI (Cursor's tab strip, IDEs in general). Setting
//           false avoids spurious "attachment_appeared" events for files
//           the user is just editing.
//
// NOTE: do not set this false on the assumption that "the asar-injected
// hook handles it instead" — confirmed live (2026-08) that ASAR integrity
// enforcement on current desktop builds of Claude blocks that injection
// entirely, so the hook never runs. Only Cursor (genuine continuous file
// exposure via its IDE UI) and GitHub Copilot (runs as a VS Code plugin, not
// a standalone window this catalog can even key on) have a real reason to
// stay false; each needs its own investigation before flipping, not a blind
// flip — an IDE's tab-strip/file-tree filenames are NOT "genuinely attached
// to an AI prompt," and firing attachment_appeared for every file a user
// opens while coding would be a false positive, not a coverage improvement.
// `unhookableSandbox`: should the OS monitor scrub the clipboard for this
// app when a high/critical pattern is detected?
//
// We only scrub for apps where NO OTHER LAYER can block the prompt:
//   - asar injection is impossible (Microsoft Store / sandboxed install) AND
//   - the proxy cannot MITM the app (vendor pins TLS certs)
//
// Apps covered by asar hook (Claude, Cursor) or proxy (CLIs hitting api.*)
// stay unhooked here so we don't pollute the clipboard for users who already
// have a better-UX block from the modal / extension / network 451.
//
// This is the deliberately narrow re-enable of the clipboard scrub feature
// that was disabled blanket-wide on 2026-05-18. See ROADMAP.md.
//
// `host`: the canonical vendor hostname for this app — the key an access
// exception is granted against.
//
// The server stores an exception as { machine_id, tool_host }, and the browser
// extension's tool_host is literally window.location.hostname of the blocked
// tab. Desktop apps have no URL, so this field is what lets ONE approval cover
// both surfaces: the admin grants claude.ai, the extension unblocks the tab and
// monitor-runner.mjs drops Claude Desktop out of blocked-agents.json. Keeping
// the mapping here (rather than in the Electron layer) means the process-name →
// host relationship has exactly one definition.
//
// Pick the host a user would actually type to reach the same product, matching
// the extension's manifest host_permissions — not an API endpoint, and not a
// marketing site.
//
// `hostApp`: this process is NOT an AI app.
//
// Every other entry in this array means "whenever this process is in the
// foreground, treat it as an AI surface" — scan the clipboard, watch its file
// dialogs and attachment chips, read its typed prompts. `hostApp: true` means
// the exact opposite: a GENERAL-PURPOSE application (Microsoft Teams) that only
// becomes AI-relevant inside ONE specific conversation, which is gated
// independently by AGENT_SURFACES + AI_PANELS and by an agent-scoped blocklist
// row. Nothing about the app at large is ever watched, scanned or captured.
//
// A host-app entry exists here for exactly three passive reasons:
//   * hostForProcess()   — so the process resolves to a canonical vendor host
//   * hostsForPlatform() — so an admin's approved teams.microsoft.com exception
//                          can lift a Teams-related agent block via
//                          filterBlockedAgents()
//   * identifyAiProcess() — product/vendor attribution on an event that some
//                          OTHER, narrowly-scoped mechanism already produced
// It unlocks NOTHING passive. Every consumer of AI_PROCESSES that assumes "in
// this list == always scan/watch/capture" must check `!hostApp` first:
//   * index.js's aiProcNames (clipboard poller + file-dialog / attachment /
//     prompt watchers + CFAI_AI_PROCESSES for the enforcer)
//   * processForHost / processesForHost — an Inventory host-block toggle on
//     teams.microsoft.com must NEVER synthesize a process_name:'ms-teams'
//     app-scoped block row, because that is "disable all of Teams".
// agent/tests/ai-processes.test.mjs and os-monitor-safety.test.mjs assert both.
//
// Undefined (i.e. falsy) on every other entry — their behaviour is unchanged.
export const AI_PROCESSES = [
  // ChatGPT Desktop (Microsoft Store) — sandboxed, no asar injection possible,
  // and pins TLS certs (confirmed 2026-05-20 via ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN).
  // unhookableSandbox only gates the (now-removed) clipboard-scrub path — the
  // keyboard-hook enforcer still applies to this app, since it intercepts input
  // at the OS level regardless of app-level sandboxing.
  { match: /^chatgpt$/i,          product: 'ChatGPT',           vendor: 'OpenAI',     host: 'chatgpt.com',               useAttachmentWatcher: true,  unhookableSandbox: true  },
  // Some installs of the same app run under the process name "ChatGPT Classic"
  // instead of "ChatGPT" (confirmed 2026-08-13 via tasklist) — index.js turns
  // each `match` regex into one literal process name for an exact-match
  // HashSet downstream (enforcer-win.ps1), so name variants need their own
  // entry rather than a regex alternation.
  { match: /^chatgpt classic$/i,  product: 'ChatGPT',           vendor: 'OpenAI',     host: 'chatgpt.com',               useAttachmentWatcher: true,  unhookableSandbox: true  },

  // Claude Desktop — a pure chat app (no continuously-visible file list the
  // way an IDE has), so it fits the `useAttachmentWatcher: true` case same as
  // ChatGPT/Comet/Gemini below. Previously false on the assumption that the
  // asar-injected desktop hook covers file uploads via DOM events instead —
  // confirmed live (2026-08) that ASAR integrity enforcement on current
  // Claude Desktop builds blocks that injection entirely, so the hook never
  // actually runs. Leaving this false meant Claude Desktop file uploads got
  // NO content scanning at all — neither path was active. No scrub (below):
  // scrub is for apps with no other way to block a paste; the keystroke
  // enforcer already covers Claude at the OS level regardless of this flag.
  { match: /^claude$/i,          product: 'Claude',            vendor: 'Anthropic',  host: 'claude.ai',                 useAttachmentWatcher: true,  unhookableSandbox: false },

  // Cursor IDE — asar-targeted (different bundling but coverable via proxy
  // for API calls). No scrub.
  { match: /^cursor$/i,          product: 'Cursor',            vendor: 'Anysphere',  host: 'cursor.com',                useAttachmentWatcher: false, unhookableSandbox: false },

  // Microsoft Copilot standalone — Store-distributed, pins TLS. Scrub.
  { match: /^copilot$/i,         product: 'Microsoft Copilot', vendor: 'Microsoft',  host: 'copilot.microsoft.com',     useAttachmentWatcher: true,  unhookableSandbox: true  },

  // Microsoft 365 Copilot — M365 app variant, same behavior.
  { match: /^m365copilot$/i,     product: 'Microsoft Copilot', vendor: 'Microsoft',  host: 'm365.cloud.microsoft',      useAttachmentWatcher: true,  unhookableSandbox: true  },

  // Perplexity Comet — browser-style desktop, mostly bridges. Comet doesn't
  // pin our CA in observed traffic. Skip scrub.
  { match: /^comet$/i,           product: 'Perplexity Comet',  vendor: 'Perplexity', host: 'perplexity.ai',             useAttachmentWatcher: true,  unhookableSandbox: false },

  // Gemini desktop, when it ships — Google ecosystem, expected to pin.
  { match: /^gemini$/i,          product: 'Gemini',            vendor: 'Google',     host: 'gemini.google.com',         useAttachmentWatcher: true,  unhookableSandbox: true  },

  // Poe — Store-distributed wrapper, treat as unhookable.
  { match: /^poe$/i,             product: 'Poe',               vendor: 'Quora',      host: 'poe.com',                   useAttachmentWatcher: true,  unhookableSandbox: true  },

  // GitHub Copilot Chat — IDE plugin, not standalone. No scrub.
  { match: /^github copilot$/i,  product: 'GitHub Copilot',    vendor: 'GitHub',     host: 'github.com',                useAttachmentWatcher: false, unhookableSandbox: false },

  // Microsoft Teams (new Teams, MSIX — process name "ms-teams"). A HOST APP,
  // not an AI app: see the `hostApp` note above. It is here ONLY so a Teams
  // agent conversation resolves to a host for the access-exception chain and so
  // an event some narrower mechanism already produced can be attributed to a
  // product/vendor. It is excluded from every passive watcher and from
  // host-keyed process blocking. Blocking a company's chat client because one
  // Copilot Studio agent inside it is blocked is not an option this product has.
  { match: /^ms-teams$/i,        product: 'Microsoft Teams',   vendor: 'Microsoft',  host: 'teams.microsoft.com',       useAttachmentWatcher: false, unhookableSandbox: false, hostApp: true },
];

// ── IDE-hosted AI panels ────────────────────────────────────────────────────
//
// An IDE is not an AI app, but it HOSTS them: Claude Code and GitHub Copilot
// Chat as VS Code extensions, and Cursor's own AI composer. Enforcement has to
// follow the focused ELEMENT here, not the process — swallowing Enter for every
// keystroke in a code editor or a terminal would be a catastrophic false
// positive, and (until now) VS Code's process name was simply absent from every
// catalog, so nothing in an IDE was scanned at all.
//
// This is a SEPARATE catalog from AI_PROCESSES on purpose. Do NOT add "Code"
// (or a second "Cursor") to AI_PROCESSES to get IDE coverage: that array also
// drives index.js's aiProcNames, which is handed to the clipboard poller and to
// the attachment-chip / file-dialog / prompt-text UIA watchers. Adding an IDE
// there would silently turn on clipboard scanning and attachment-chip watching
// across the WHOLE editor — reporting every file you open while coding as an AI
// file upload. That is a far bigger privacy expansion than the keystroke
// scoping this feature is about. agent/tests/ai-processes.test.mjs asserts the
// separation.
//
// `panelFallback`: when the foreground is this IDE process but NO panel
// signature matches the focused element, should the process still be treated as
// a whole-app AI surface?
//
// Both false: explicit user decision (2026-08-25) to scope Cursor down to its
// AI composer only, matching Claude Code's precision, even though Cursor was
// already in AI_PROCESSES and had whole-app keystroke coverage before this
// change. Typing in Cursor's editor or terminal is no longer scanned at all —
// only `aislash-editor-input` is. If a future Cursor build renames that class
// and the fallback is ever wanted back as a safety net, set this back to true;
// UpdateForeground's `_ideFallbackProcs.Contains(proc) && _aiProcs.Contains(proc)`
// branch already exists to support it, and Cursor's continued AI_PROCESSES
// membership below is what that branch would use.
export const IDE_PROCESSES = [
  { match: /^code$/i,   product: 'Visual Studio Code', vendor: 'Microsoft', panelFallback: false },
  { match: /^cursor$/i, product: 'Cursor',             vendor: 'Anysphere', panelFallback: false },
];

// Signatures for the AI composer inside each IDE, matched against the focused
// UIA element's { ControlType, Name, ClassName }.
//
// Every signature below except vscode_chat was verified by live UIA probing
// against a real installation (2026-08). Notes on the fields, because the
// wrong choice here is either a miss or a false block:
//
//   claude_code      — Name "Message input" is ARIA-label driven and stable.
//                      ClassName is a CSS-module build hash ("messageInput_cKsPxg"),
//                      so only its PREFIX may be matched: the suffix changes on
//                      every extension build.
//   cursor_composer  — Name is EMPTY (no ARIA label), so ClassName is the only
//                      signal: exact "aislash-editor-input". Cursor also has a
//                      near-identically-shaped Edit with ClassName
//                      "agent-sidebar-search-input" / Name "Search Agents…" —
//                      that is the agent-history SEARCH box, and filtering past
//                      sessions is not sending a prompt. Matching on ClassName
//                      exactly is what keeps them apart. "Exactly" means exactly
//                      one CLASS, not the whole class attribute — see
//                      classRuleMatches: a web-hosted element's UIA ClassName is
//                      the DOM class attribute and can hold several, and this is
//                      the only entry with no second signal to fall back on.
//   vscode_chat      — NOT verified live (Copilot Chat was not installed during
//                      probing); inferred from VS Code's generic Chat UI. Its
//                      observed ClassName was "native-edit-context", which is a
//                      GENERIC VS Code internal class shared with the Find
//                      widget, quick-open, search and rename inputs — matching
//                      it would blanket-block ordinary editor UI, so it is
//                      deliberately absent here. Name prefix only.
//
// `enforce: false` means DETECTION-ONLY: the signature is matched (so the panel
// is identified for telemetry and the whole bridge is exercised), but no
// guardrail/PII block and no platform block may ever fire from it. This is the
// deliberate safety gate for vscode_chat, whose signature is unverified.
// Flipping it to true requires a live verification pass against a real GitHub
// Copilot Chat installation — confirm the real ControlType/Name of its composer
// and confirm no non-chat VS Code input shares that Name prefix. Matching and
// enforcing are separate concerns: matchPanelSignature() must keep matching a
// detection-only panel, the ENFORCEMENT paths are what consult `enforce`.
//
// ── `dlpMatch` — what a HOST APP needs to prove before this composer is
//    DLP-governed (scanned + Tokenize-&-Send eligible) ─────────────────────────
// Absent/'agent' is the default and the strict answer: the open conversation
// must ALSO be named by an entry in governed-agents.json (or blocked-agents.json
// for the block path). That is required for teams_composer, because ONE element
// serves every Teams conversation — a DM, a channel post and an agent chat all
// focus the same shape — so a panel match there says nothing about whether the
// thing being typed is a message to a colleague.
// 'panel' means the panel match ALONE is sufficient for DLP governance, because
// the composer has no non-AI use at all (Teams' embedded Copilot tab: every
// conversation in it is with an assistant). It NEVER widens BLOCKING — a block
// still needs a named blocked-agents.json row, and enforcer-win.ps1's
// CheckFgBlocked excludes a host app from all three coarse arms regardless.
//
// ── `newlineKeys` — which key combination inserts a LINE BREAK in this
//    composer without submitting the message ────────────────────────────────────
// Read only by Tier B's rewrite (mask-and-send): the masked text is typed with
// synthetic keystrokes, and typing a literal "\n" into a chat composer submits
// the message half-written. So a multi-line rewrite types each line and sends
// this combo between the segments instead. Absent means DEFAULT_NEWLINE_KEYS
// ('shift_enter'), which is what every composer probed so far uses; it is a
// per-entry field rather than a constant in the .ps1 so an app that needs
// something else is a data change, not a code change. An UNRECOGNISED value
// means "no safe newline key for this surface", and Tier B then refuses to
// offer itself for multi-line text there at all (fail closed — it never
// guesses).
//
// ── `postSendVerifyMs` — how long to keep confirming that a mask-and-send
//    actually submitted, for this composer ───────────────────────────────────
// Read only by Tier B's rewrite. After typing the masked text the enforcer
// synthesizes an Enter and then reads the composer back: if it STILL holds
// exactly the masked text, the send did not land and the rewrite is reported
// failed ("not_submitted") rather than claimed as sent. That read used to be a
// single shot at +200ms, which is all a native composer needs.
//
// It is not enough for a composer rendered in a WebView2 CHILD PROCESS. Measured
// live 2026-09 against Microsoft Teams: the masked message was genuinely in the
// conversation and the rewrite was still reported failed, because "the composer
// is empty now" has to cross a Chromium accessibility serialization before UIA
// can report it. The visible outcome of that false failure was a GOVERNANCE GAP,
// not a cosmetic one — index.js's 'rewrite' handler returns early on any
// non-'ok' result, so no enforcement_redact audit event was recorded for a
// governed send that really happened.
//
// So the check polls, and this field is how long for. Absent means
// DEFAULT_POST_SEND_VERIFY_MS (200ms), i.e. the single read that shipped before
// this field existed — every non-Teams surface is unchanged. enforcer-win.ps1
// CLAMPS the value into [200, 1500] at load time, because the rewrite's whole
// time budget is reasoned about against the 16s at which the block dialog closes
// itself; a longer window here would leave the user with no answer at all.
export const AI_PANELS = [
  {
    id: 'claude_code', product: 'Claude Code', vendor: 'Anthropic', host: 'claude.ai',
    procs: ['Code', 'Cursor'], controlType: 'Edit',
    nameEquals: 'Message input', classPrefix: 'messageInput_',
    enforce: true, verified: true,
  },
  {
    id: 'vscode_chat', product: 'GitHub Copilot Chat', vendor: 'GitHub', host: 'github.com',
    procs: ['Code', 'Cursor'], controlType: 'Edit',
    namePrefix: 'Chat Input',
    enforce: false, verified: false,
  },
  {
    id: 'cursor_composer', product: 'Cursor', vendor: 'Anysphere', host: 'cursor.com',
    procs: ['Cursor'], controlType: 'Edit',
    classEquals: 'aislash-editor-input',
    enforce: true, verified: true,
  },
  // Microsoft Teams' message composer (new Teams, MSIX). ONE composer element
  // serves every conversation in the app — a DM, a channel post, an agent chat
  // and the Teams-generic Copilot panel all focus the same shape of element —
  // so this signature alone says NOTHING about which conversation is open. That
  // question is answered separately by the `teams_desktop` AGENT_SURFACES entry
  // (which reads the WINDOW TITLE), and only both together ever gate anything.
  //
  // Measured live 2026-08 by a read-only UIA probe of a real new-Teams window:
  //   Name        — ALWAYS the literal "Type a message", identical in a DM, a
  //                 group chat, an agent conversation and the Copilot panel. It
  //                 carries no conversation identity at all, which is exactly
  //                 why it is NOT used as a signal here.
  //   AutomationId— "new-message-<uuid>", the uuid differing per conversation
  //                 instance. Stable in shape, but there is no AutomationId rule
  //                 in this schema and adding one would be new plumbing for a
  //                 second signal we do not need.
  //   ClassName   — a long space-separated token list mixing stable CKEditor
  //                 semantic classes with Fluent-UI build hashes ("___1czdayc",
  //                 "f1poobt0", …). `ck-editor__editable` is the semantic
  //                 CKEditor marker in that list, so it is the token matched;
  //                 the hashed utility classes are deliberately untouched
  //                 because they look build-specific.
  //
  // `classEquals` is TOKEN matching, not whole-string — see classRuleMatches,
  // which already splits on whitespace and compares each token, exactly as the
  // Cursor/VS Code entries rely on. No new matching logic, just a data entry.
  //
  // `host: null` IS LOAD-BEARING. panelForHost('teams.microsoft.com') must
  // return null for this entry, so an Inventory host-block toggle can never
  // synthesize a panel-level block row against it. Such a row would disable
  // this composer in EVERY Teams conversation — DMs, channels, everyone — i.e.
  // "disable all of Teams", which is precisely what this whole feature exists
  // to avoid. The panel is reachable ONLY through the agent-scoped path in
  // enforcer-win.ps1, never through a host toggle.
  //
  // LIVE-VERIFIED and ENFORCING (both flags true). The verification pass ran
  // 2026-08-30 against a real Microsoft Teams desktop install with a real
  // blocked agent ("IT Help Desk Agent", a Copilot Studio agent): sending in
  // that agent's conversation was swallowed, while a 1:1 DM, the "alex, max"
  // group chat, and a channel post all sent normally, and switching away from
  // the blocked agent and back correctly released then re-armed the block.
  {
    id: 'teams_composer', product: 'Microsoft Teams', vendor: 'Microsoft', host: null,
    procs: ['ms-teams'], controlType: 'Edit',
    classEquals: 'ck-editor__editable',
    enforce: true, verified: true,
    // The STRICT default, stated explicitly on the one entry where getting it
    // wrong would capture a colleague conversation: this composer is shared by
    // every Teams conversation, so DLP governance here requires the open
    // conversation to be NAMED by a governed-agents.json row.
    dlpMatch: 'agent',
    // Shift+Enter inserts a newline in the Teams composer; plain Enter sends.
    // Measured behaviour of the shipping client, and the reason Tier B cannot
    // type a literal newline into it.
    newlineKeys: 'shift_enter',
    // A LONGER post-send confirmation window than the 200ms default, because
    // this composer is CKEditor inside Teams' WebView2 child process: the
    // cleared composer only becomes visible to UIA after Chromium serializes
    // its accessibility tree across that hop. With the default single read, a
    // mask-and-send that genuinely landed in the conversation was reported
    // "not_submitted" and its enforcement_redact audit event was lost.
    postSendVerifyMs: 1500,
  },
  // Microsoft Teams' OTHER composer: the one inside the embedded "Copilot" tab,
  // which is a DIFFERENT composer implementation from the Chat-list route's
  // CKEditor above — confirmed live, not assumed. Measured 2026-09 against a
  // real new-Teams install with a real Copilot Studio agent open in that tab:
  //
  //   ClassName    — "fai-EditorInput__input r18fti29 r18aquq2 ___10kbave
  //                  f1pha7fy f1immsc2 f1mk8lai". No `ck-editor__editable`
  //                  anywhere in it, so `teams_composer` does NOT match this
  //                  element and never could: the Chat-list route and the
  //                  Copilot tab genuinely ship two different editors.
  //   AutomationId — "m365-chat-editor-target-element". Stable-looking, but
  //                  there is no AutomationId rule in this schema and adding one
  //                  would be new plumbing for a second signal we do not need.
  //   Name         — GENERIC and deliberately unused. "Message Copilot" with no
  //                  agent selected, and observed transiently carrying
  //                  agent-ish text otherwise. It is not a reliable identity
  //                  signal and nothing here reads it.
  //
  // `classEquals` is TOKEN matching (see classRuleMatches), so the SEMANTIC
  // token `fai-EditorInput__input` is what is matched and the Fluent-UI build
  // hashes beside it ("r18fti29", "___10kbave", …) are deliberately untouched —
  // exactly the reasoning already applied to teams_composer's
  // `ck-editor__editable` choice.
  //
  // `host: null` for the IDENTICAL, load-bearing reason teams_composer carries
  // it: panelForHost('teams.microsoft.com') must return null, so an Inventory
  // host-block toggle can never synthesize a panel-level row against this entry
  // either. Such a row would disable this composer in every Copilot-tab
  // conversation — reached by a second route to the same "disable all of Teams"
  // outcome this whole feature exists to avoid.
  //
  // LIVE-VERIFIED and ENFORCING (both flags true). The verification pass ran
  // 2026-09-02 against a real Microsoft Teams desktop install with a real
  // blocked agent ("IT Help Desk Agent", a Copilot Studio agent): reaching it
  // through the Copilot tab specifically (not the Chat list) and sending was
  // blocked, while re-confirming the same agent via the Chat list, M365Copilot,
  // a DM, and a different/generic agent all continued to behave correctly
  // (blocked where expected, sent normally everywhere else). Paired with
  // teams_desktop's `fallbackRead` block below, which is separately gated by
  // its OWN enforce/verified pair — both pairs were flipped together after
  // this same pass.
  {
    id: 'teams_copilot_composer', product: 'Microsoft Teams', vendor: 'Microsoft', host: null,
    procs: ['ms-teams'], controlType: 'Edit',
    classEquals: 'fai-EditorInput__input',
    enforce: true, verified: true,
    // DLP governance by PANEL MATCH ALONE — the one entry that carries this, and
    // the reason it can: this composer exists ONLY inside the embedded Copilot
    // tab, where every conversation is with an assistant. There is no DM, no
    // channel and no meeting chat behind it, so "the caret is in this element"
    // already means "the user is typing at an AI". The Chat-list route
    // (teams_composer above) cannot say that and keeps the strict 'agent' rule.
    //
    // Scope of what this widens, exactly: prompt scanning and the Tokenize &
    // Send offer for the tab's own composer. It adds NO block of any kind — a
    // block still requires a named blocked-agents.json row read through
    // teams_desktop, and CheckFgBlocked bars a host app from every coarse arm.
    dlpMatch: 'panel',
    // Shift+Enter, same as the Chat-list composer (both are Teams message
    // composers where plain Enter sends).
    newlineKeys: 'shift_enter',
    // Same longer post-send window, for the same reason, and stated on this
    // entry independently rather than inherited: this is a DIFFERENT editor
    // (Fluent's fai-EditorInput__input, not CKEditor), but it is rendered in the
    // same WebView2 child process, so it is behind the same accessibility hop.
    postSendVerifyMs: 1500,
  },
];

// What `newlineKeys` means when an AI_PANELS entry does not state one.
//
// Shift+Enter is near-universal across chat composers (measured in Teams both
// routes; the same combo is what Claude Desktop, ChatGPT and the IDE composers
// use), so it is the default rather than a required field on every entry. It
// lives HERE, next to the catalog, and is mirrored by exactly one C# constant in
// enforcer-win.ps1 (NEWLINE_KEYS_DEFAULT) which
// agent/tests/os-monitor-safety.test.mjs holds in lockstep with this value —
// same discipline PLATFORM_PROCS is kept under.
export const DEFAULT_NEWLINE_KEYS = 'shift_enter';

// The `newlineKeys` values the enforcer knows how to synthesize. Anything else
// (including a typo in a future entry) is treated as "no safe newline key here",
// which makes Tier B refuse multi-line text on that surface rather than guess a
// combination that might submit the message.
export const NEWLINE_KEY_COMBOS = ['shift_enter', 'ctrl_enter'];

// What `postSendVerifyMs` means when an AI_PANELS entry does not state one, and
// the ceiling any entry is clamped to.
//
// The DEFAULT is the single post-send read that shipped before the field
// existed, so an entry saying nothing keeps exactly the old behaviour. Both
// values live HERE, next to the catalog, and are mirrored by exactly two C#
// constants in enforcer-win.ps1 (REWRITE_POST_SEND_MS and
// REWRITE_POST_SEND_MAX_MS) which agent/tests holds in lockstep with them —
// the same discipline DEFAULT_NEWLINE_KEYS and PLATFORM_PROCS are kept under.
//
// The MAX is not a taste knob. The rewrite's time budget is reasoned about
// backwards from the 16s at which block-dialog.js closes itself: 2.5s waiting
// for the confirm chord to be released + 9s of writing + 0.4s verify poll +
// 0.3s settle + this. At 1500ms the worst case lands at ~13.8s, inside both the
// dialog's timeout and the 15s pin TTL.
export const DEFAULT_POST_SEND_VERIFY_MS = 200;
export const MAX_POST_SEND_VERIFY_MS = 1500;

// ── Agent surfaces: one named agent INSIDE one AI app ───────────────────────
//
// A THIRD catalog, separate from AI_PANELS (fixed element signatures) and
// PLATFORM_PROCS (platform id → process names), because it answers a third
// question: not "which app is this" and not "which composer is focused", but
// "WHICH AGENT is currently open inside this app".
//
// The problem it exists for. A `blocked_agents` row written by the governance
// lifecycle route names ONE agent — { agent_name: "AI Learning Advisor",
// platform: "personal_agent" } — but the desktop enforcer matches that row
// against the whole PROCESS set from PLATFORM_PROCS and uses agent_name only as
// display text. Blocking one agent therefore disabled the entire M365Copilot
// app: generic Copilot chat and every other agent in it included.
//
// The read signal, confirmed live (2026-08) by a read-only UIA probe:
//   * M365Copilot with no specific agent open → composer Edit's Name is
//     "Message Copilot"
//   * with "AI Learning Advisor" open        → "Message AI Learning Advisor"
// The WINDOW TITLE is useless — it is the static "Microsoft 365 Copilot" in both
// cases — so it is deliberately not used anywhere here.
//
// So: strip a known composer prefix off the focused element's Name; if what is
// left is a `genericNames` entry, no specific agent is open; otherwise the
// remainder IS the agent's exact display name.
//
// `composerNamePrefixes` is DATA, not code, precisely because "Message " is
// English-UI-only. A non-English UI simply never matches a prefix, every read
// lands in the NotComposer outcome, and an agent-scoped row enforces nothing on
// the desktop (the browser extension still covers the web surface). That is an
// accepted, deliberate fail-open; adding a locale is adding an array element.
//
// `enforce` / `verified` are the same two-flag safety gate AI_PANELS uses.
//
// The M365Copilot entry is LIVE-VERIFIED and ENFORCING (both flags true). The
// verification pass ran 2026-08-27 against a real Microsoft 365 Copilot install
// with a real added agent ("AI Learning Advisor"): blocking that agent blocked
// only that agent — Enter swallowed with the composer text preserved, the
// Request Access modal naming the agent rather than the whole app — while
// generic Copilot chat and a different agent kept sending normally, including
// immediately after switching away from the blocked one. The composer-name read
// was stable across a 5s idle window (17/17 ticks). One accepted gap: the
// mouse-click send path was not separately verified (its send-button element
// could not be located live); it rides the same `_blockedByElement` flag Enter
// uses, which the IDE-panel work already proved.
//
// The gate still applies to every FUTURE entry added here. A new surface ships
// with BOTH FALSE — matched and unit-tested, so the whole bridge is exercised,
// but arming nothing — until a human runs its own live pass and flips them.
// While they are false an agent-scoped row behaves exactly as it did before this
// feature existed: a whole-app block. enforcer-win.ps1's EnforcingAgentSurface()
// is the single place that reads both flags, and
// tests/enforcer-panel-block.test.mjs asserts the mechanism behaviourally
// against a still-unverified surface.
//
// `read`: WHICH signal names the open agent. Absent/undefined — the case for
// m365_copilot and for every entry that existed before Microsoft Teams — means
// 'composer_name', the original behaviour above, completely unchanged. The one
// alternative is 'window_title', added for Teams and explained on that entry.
export const AGENT_SURFACES = [
  {
    id: 'm365_copilot',
    procs: ['M365Copilot'],
    controlType: 'Edit',
    composerNamePrefixes: ['Message '],
    genericNames: ['Copilot'],
    enforce: true,
    verified: true,
  },
  // Microsoft Teams (new Teams, MSIX). A HOST APP surface — see AI_PROCESSES'
  // `hostApp` note — and the first entry here that reads the WINDOW TITLE.
  //
  // WHY THE TITLE. Measured live 2026-08 against a real Copilot Studio agent
  // ("IT Help Desk Agent") added to Teams: the composer's UIA Name is ALWAYS the
  // literal "Type a message", byte-identical in a DM, a group chat, an agent
  // conversation and the Teams-generic Copilot panel. Unlike M365Copilot — where
  // the composer label changes per agent and IS the signal — Teams' composer
  // carries no conversation identity whatsoever. The window title does:
  //
  //   Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams
  //   Chat | alex, max | filefuze | erik@filefuze.co | Microsoft Teams
  //   Sruthi Chimata | CloudFuze, Inc | p@cloudfuze.com | Microsoft Teams
  //   Copilot | filefuze | erik@filefuze.co | Microsoft Teams
  //   Teams and Channels | <channel> | General | filefuze | e@f.co | Microsoft Teams
  //   Activity | Workflows | filefuze | erik@filefuze.co | Microsoft Teams
  //
  // All six verbatim. Note the plain 1:1 DM has NO leading kind segment at all —
  // that is what `titleKinds` keys on, and why a DM correctly reads as "no
  // evidence" rather than as an agent named after a colleague.
  //
  // NOT confirmed live, and deliberately not guessed at: the unread-count
  // prefix format (extractAgentNameFromTitle strips a leading "(3) "
  // defensively — a hypothesis, not a measurement), a popped-out chat window's
  // title shape, and a personal M365 Copilot agent's title shape when opened
  // inside Teams' Copilot panel. Each is an open question for the live pass that
  // has to happen before either flag here is flipped.
  //
  // `hostApp: true` INVERTS the fail direction, and this is the single most
  // important line in the entry. For m365_copilot, "cannot tell which agent is
  // open → block the whole app" is a safe fail-CLOSED fallback, because the
  // whole app IS an AI product. For teams_desktop the same fallback would
  // disable a company's general communications client — chats with colleagues,
  // channels, meeting chat, everything — because one agent inside it is blocked.
  // That is never acceptable, at any confidence level. So a host-app surface
  // NEVER falls back to a whole-app block: "cannot tell" means NO BLOCK AT ALL.
  // The correct fail direction here is OPEN, and enforcer-win.ps1's CheckFgBlocked
  // enforces that by excluding a host-app surface from all three coarse arms.
  //
  // LIVE-VERIFIED and ENFORCING (both flags true). The verification pass ran
  // 2026-08-30 against a real Microsoft Teams desktop install with a real
  // blocked agent ("IT Help Desk Agent", a Copilot Studio agent): blocking it
  // via AI Hub swallowed sends only in that agent's own conversation, while a
  // 1:1 DM, the default-named "alex, max" group chat, and a channel post all
  // sent normally — confirming the naming-collision path never triggers on
  // Teams' own default group-chat naming. Switching away from the blocked
  // agent released the block, and switching back re-armed it. One accepted
  // gap, found during this same pass and tracked separately: the
  // enforcement_block event this produces was not observed reaching the
  // server's DLP log, even though the enforcer's own EmitBlock call site is
  // identical to the one every other Enter-swallow already uses — the send
  // itself is genuinely blocked either way, so this affects audit visibility,
  // not enforcement, but it needs its own investigation.
  //
  // `fallbackRead` — THE SECOND UI ROUTE (Teams' embedded "Copilot" tab).
  //
  // WHY IT IS NESTED ON THIS ENTRY rather than being a second AGENT_SURFACES
  // entry. agentSurfaceForProcess() is FIRST-MATCH-WINS per process name: it
  // returns the first entry whose `procs` contains the process and stops. A
  // second entry with procs:['ms-teams'] would therefore be permanently
  // shadowed by this one and could never be reached, on either side of the port
  // (enforcer-win.ps1's MatchAgentSurface has the identical first-match loop).
  // A nested block is not a style choice — it is the only shape that works.
  //
  // WHY IT HAS ITS OWN enforce/verified PAIR. This entry's own pair is
  // true/true (the Chat-list route passed its live pass 2026-08-30). Hanging the
  // new route off THAT pair would have shipped it live-armed on day one, against
  // a route nobody had verified end-to-end — which is precisely what the
  // two-flag discipline exists to prevent. So it shipped FALSE/FALSE and stayed
  // completely inert (enforcer-win.ps1 reaches the fallback only when BOTH are
  // true: no tree walk, no extra read, no state) until this route got a live
  // pass of its own. That pass ran 2026-09-02 — recorded on the `fallbackRead`
  // block below and on the `teams_copilot_composer` AI_PANELS entry above — and
  // BOTH flags here are now true, so the fallback is live. The separate pair is
  // still the right shape: each UI route arms only on its own evidence, and a
  // future third route added here starts at false/false again regardless of
  // what these two say.
  //
  // WHY `paneKinds` IS NOT `titleKinds`. Measured live 2026-09: the Copilot tab
  // keeps a GENERIC, CONSTANT window title no matter which agent is open —
  // "Copilot | filefuze | erik@filefuze.co | Microsoft Teams" — and it never
  // becomes "Chat | <agent> | …" (that shape is exclusive to the Chat-list
  // route). Note the SECOND segment there is the TENANT ("filefuze"), not a
  // conversation name. So adding 'Copilot' to `titleKinds` would make the
  // primary title parse read the ORG NAME as the open agent's name. These are
  // two genuinely different questions that happen to look alike:
  //   titleKinds — "this title's kind segment introduces a conversation whose
  //                NAME is in segment 1"; used to EXTRACT a name.
  //   paneKinds  — "this title's kind segment says we are in a view where the
  //                heading fallback is worth attempting at all"; used only to
  //                GATE, never to extract.
  // titleKindOf() is the one function that answers "which Teams view is this",
  // and both consult it.
  //
  // THE SIGNAL, all measured verbatim 2026-09 against the real blocked agent
  // "IT Help Desk Agent":
  //   * before any message is sent, a Text control whose Name is
  //     "IT Help Desk Agent Created by Your developer name" — hence
  //     `landingInfix`, and hence "everything before the infix".
  //   * once messages exist, per-message headings ACCUMULATE (confirmed: the
  //     first message's heading was still present after a second was sent).
  //     The AGENT's heading carries the class token
  //     `fai-CopilotMessage__accessibleHeading` and the Name
  //     "IT Help Desk Agent said:" — hence `headingSuffix`.
  //   * the USER's own heading is a DIFFERENT class
  //     (`fai-UserMessage__accessibleHeading`, Name "You said:"), confirmed
  //     live, so filtering on the agent's class alone can never read a human's
  //     own message as the agent. "You" is in `genericNames` anyway, as a second
  //     line of defence rather than the primary one.
  //   * the AutomationId on those headings ("copilot-message-r7f-title" /
  //     "copilot-message-r8j-title") DIFFERS between two messages in the same
  //     session, so it is NOT a stable match target and is deliberately unused.
  //     ClassName is the only reliable one.
  //   * a plain bare-name Text control ("IT Help Desk Agent", no distinguishing
  //     ClassName, no AutomationId) also appears near each response. It exists,
  //     but nothing here keys on it: a text node with no distinguishing
  //     attribute is not a match target, it is a coincidence waiting to happen.
  {
    id: 'teams_desktop',
    procs: ['ms-teams'],
    controlType: 'Edit',
    read: 'window_title',
    titleSeparator: ' | ',
    titleSuffix: 'Microsoft Teams',
    titleKinds: ['Chat'],
    genericNames: ['Copilot', 'Chat', 'Microsoft Teams', 'Meeting chat'],
    hostApp: true,
    enforce: true, verified: true,
    fallbackRead: {
      mode: 'message_heading',
      paneKinds: ['Copilot'],              // gates the attempt; never used to extract a name
      headingClass: 'fai-CopilotMessage__accessibleHeading',
      headingSuffix: ' said:',             // "<Agent> said:" -> everything before this suffix
      landingInfix: ' Created by ',        // "<Agent> Created by <author>" -> everything before this
      genericNames: ['Copilot', 'Microsoft 365 Copilot', 'You'],
      // LIVE-VERIFIED and ENFORCING. Pass ran 2026-09-02 with a real blocked
      // agent reached specifically through the Copilot tab: send blocked;
      // re-confirmed in the same pass that the Chat-list route, M365Copilot,
      // a DM, and a different/generic agent all still behaved correctly.
      enforce: true, verified: true,
    },
  },
];

// Sentinels returned by extractAgentName() for the two non-Named outcomes.
//
// They are wrapped in BRACES, which sanitizeForPs1 strips from every value that
// can ever reach blocked-agents.json — so no admin-typed agent_name can ever
// collide with one, and agentNameMatches() rejects them by identity anyway
// rather than by hoping a real name never looks like a sentinel.
export const AGENT_NAME_GENERIC = '{generic}';
export const AGENT_NAME_NOT_COMPOSER = '{not_composer}';

// Trim + collapse internal whitespace. Applied to BOTH sides of every agent-name
// comparison: a UIA Name can arrive with a non-breaking space or a doubled space
// that the admin's typed name does not have, and that is not a different agent.
// Case is preserved here — the case-insensitive part is the comparison itself.
function normalizeAgentName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// Which AGENT_SURFACES entry hosts this process name, or null.
export function agentSurfaceForProcess(processName) {
  const proc = String(processName ?? '').replace(/\.exe$/i, '').trim().toLowerCase();
  if (!proc) return null;
  for (const surface of AGENT_SURFACES) {
    if (surface.procs.some((p) => String(p).toLowerCase() === proc)) return surface;
  }
  return null;
}

// The name of the agent currently open in this app, extracted from the focused
// element. PURE and side-effect free, same as matchPanelSignature and for the
// same reason: it is unit-testable without a live UI, and the C# port in
// enforcer-win.ps1 (ExtractAgentName) can be held in lockstep with it.
//
// Takes { process, controlType, name } and returns one of:
//   AGENT_NAME_NOT_COMPOSER — this element is not a composer we can read an
//                             agent name off (wrong process, wrong control type,
//                             no recognised prefix, nothing after the prefix).
//                             NO EVIDENCE either way.
//   AGENT_NAME_GENERIC      — a composer, and what follows the prefix is a
//                             generic app name ("Copilot"). AUTHORITATIVE: no
//                             specific agent is open.
//   any other string        — AUTHORITATIVE: that named agent is open.
//
// The "Unreadable" outcome of the live read (FocusedElement threw/was null, or
// the element belongs to another process) is NOT this function's business — it
// is decided at the read site, which is the only place that knows.
//
// Never throws: every input comes from another process's accessibility tree and
// can be null, empty or garbage.
export function extractAgentName(focused) {
  const { process: processName, controlType, name, title } = focused || {};
  const surface = agentSurfaceForProcess(processName);
  if (!surface) return AGENT_NAME_NOT_COMPOSER;
  // DISPATCH on how this surface names its agent. An absent `read` — every
  // entry that existed before Microsoft Teams, m365_copilot included — takes
  // the composer-Name path below, byte-for-byte unchanged.
  //
  // A window-title surface reads `title`, falling back to `name` so the same
  // one-string-in contract holds on both sides of the C# port: ExtractAgentName
  // in enforcer-win.ps1 has a single string parameter and the read site puts
  // the title in it.
  if (surface.read === 'window_title') {
    return extractAgentNameFromTitle(surface, title ?? name);
  }
  const ct = String(controlType ?? '').trim().toLowerCase();
  if (!ct || ct !== String(surface.controlType).toLowerCase()) return AGENT_NAME_NOT_COMPOSER;
  const nm = String(name ?? '').trim();
  if (!nm) return AGENT_NAME_NOT_COMPOSER;
  for (const prefix of surface.composerNamePrefixes || []) {
    const pre = String(prefix ?? '');
    if (!pre) continue;
    if (nm.length <= pre.length) continue;
    if (nm.slice(0, pre.length).toLowerCase() !== pre.toLowerCase()) continue;
    const remainder = normalizeAgentName(nm.slice(pre.length));
    if (!remainder) return AGENT_NAME_NOT_COMPOSER;
    // The Generic filter runs BEFORE any matching, so an agent literally named
    // "Copilot" can never be matched by this mechanism. Deliberate: "block all
    // of Copilot" is what a platform-scoped row is for.
    for (const generic of surface.genericNames || []) {
      if (normalizeAgentName(generic).toLowerCase() === remainder.toLowerCase()) return AGENT_NAME_GENERIC;
    }
    return remainder;
  }
  return AGENT_NAME_NOT_COMPOSER;
}

// ── Window-title agent reads (host apps) ────────────────────────────────────

// Does this string look like Microsoft Teams' OWN default name for a
// multi-person group chat — the participants' display names, comma+space
// joined ("alex, max"; "Alex Morgan, Max Chen")?
//
// WHAT IT IS FOR. A Teams group chat and a Teams agent conversation produce
// title bars of the IDENTICAL shape — "Chat | <name> | <org> | <email> |
// Microsoft Teams" — so the kind segment alone cannot tell them apart. Without
// this check, a group chat whose auto-generated name happened to collide with a
// blocked agent's name would be silently blocked. This recognises the
// no-deliberate-intent case: Teams named the chat, nobody chose that string.
//
// WHAT IT IS NOT. It does NOT stop a DELIBERATE rename of a group chat (or a DM
// with a person whose display name matches) to a non-comma string that happens
// to equal a real blocked agent's name exactly. That residual risk is
// explicitly ACCEPTED, not solved. This is a defence-in-depth layer, not a
// complete fix — and its failure direction is the safe one, since a false
// positive here only means "do not block", never "block something else".
//
// The letter test uses the Unicode letter CATEGORY so accented and non-Latin
// display names are treated as names, matching the C# port's char.IsLetter
// exactly. (JS exposes no non-regex equivalent of char.IsLetter; the C# side —
// where a Regex would need REGEX_TIMEOUT and is banned outright in the agent
// path — is a plain character loop. That is the only difference between them.)
const PARTICIPANT_SEP = ', ';
const PARTICIPANT_MAX_SEGMENT = 40;
const PARTICIPANT_MAX_WORD = 20;
const PARTICIPANT_MAX_WORDS = 3;
const LETTER_RE = /\p{L}/u;

function isNameChar(ch) {
  if (ch >= '0' && ch <= '9') return false;              // any digit disqualifies
  if (ch === ' ' || ch === '\t') return true;
  if (ch === "'" || ch === '\u2019') return true;        // O'Brien, O’Brien
  if (ch === '-' || ch === '.') return true;             // Smith-Jones, J. Doe
  return LETTER_RE.test(ch);
}

export function looksLikeParticipantList(name) {
  const value = String(name ?? '');
  // No comma+space anywhere → not Teams' joined form. One segment is a name,
  // not a list.
  if (!value.includes(PARTICIPANT_SEP)) return false;
  const segments = value.split(PARTICIPANT_SEP);
  let nonEmpty = 0;
  for (const segment of segments) if (segment.trim().length > 0) nonEmpty += 1;
  if (nonEmpty < 2) return false;
  for (const segment of segments) {
    if (segment.length > PARTICIPANT_MAX_SEGMENT) return false;
    let words = 0;
    let wordLen = 0;
    for (let i = 0; i <= segment.length; i += 1) {
      const ch = i < segment.length ? segment[i] : ' ';
      if (i < segment.length && !isNameChar(ch)) return false;
      if (ch === ' ' || ch === '\t') {
        if (wordLen > 0) { words += 1; if (wordLen > PARTICIPANT_MAX_WORD) return false; }
        wordLen = 0;
      } else {
        wordLen += 1;
      }
    }
    if (words < 1 || words > PARTICIPANT_MAX_WORDS) return false;
  }
  return true;
}

// The agent name a WINDOW TITLE names, for a `read: 'window_title'` surface.
//
// Same three-outcome contract as extractAgentName, and for the same reason —
// the caller must be able to tell "no evidence" apart from the authoritative
// "no agent is open":
//   AGENT_NAME_NOT_COMPOSER — no evidence. Not a Teams title at all, or a title
//                             shape this catalog cannot name a conversation
//                             from (a DM, a channel, the Activity tab, the
//                             generic Copilot panel).
//   AGENT_NAME_GENERIC      — AUTHORITATIVE: a nameable conversation is open and
//                             it is definitely not a specific agent (Teams' own
//                             group-chat naming, or a generic app label).
//   any other string        — AUTHORITATIVE: that named conversation is open.
//
// PURE and side-effect free, like extractAgentName/matchPanelSignature, so it is
// unit-testable with no live UI and the C# port in enforcer-win.ps1 can be held
// in lockstep with it. NEVER throws and never retains the title: the string
// comes from another process's window and is compared against the blocklist and
// nothing else.
// Split a window title into its normalized segments, or null when the string is
// not this surface's title at all.
//
// Extracted so that "how a Teams title is taken apart" is written down exactly
// ONCE, and both consumers — titleKindOf and extractAgentNameFromTitle — share
// it. Returns null (rather than an empty array) for every non-title, so a caller
// cannot accidentally treat "unparseable" as "parsed into nothing".
function titleSegments(surface, title) {
  if (!surface) return null;
  let raw = String(title ?? '');
  if (!raw) return null;
  // Bound the work. A title is attacker-influenceable in the sense that any app
  // can set one; 512 chars is well past the longest measured Teams title.
  raw = raw.slice(0, 512);
  // Strip a leading unread-count decoration, e.g. "(3) Chat | …". HYPOTHESISED,
  // not live-measured — implemented defensively because it costs nothing if it
  // never triggers, and a missed strip would silently disable the whole read.
  if (raw.charAt(0) === '(') {
    let i = 1;
    while (i < raw.length && raw[i] >= '0' && raw[i] <= '9') i += 1;
    if (i > 1 && raw.charAt(i) === ')') {
      i += 1;
      while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i += 1;
      raw = raw.slice(i);
    }
  }
  const normalized = normalizeAgentName(raw);
  if (!normalized) return null;
  const sep = String(surface.titleSeparator ?? '');
  const suffix = normalizeAgentName(surface.titleSuffix);
  if (!sep || !suffix) return null;
  const parts = normalized.split(sep);
  // The LAST segment must be the app's own suffix, exactly. This is what stops
  // any other window in any other app from ever being parsed as a Teams title.
  if (normalizeAgentName(parts[parts.length - 1]).toLowerCase() !== suffix.toLowerCase()) return null;
  // Fewer than three segments cannot name anything: there is no room for a kind,
  // a name and the app suffix.
  if (parts.length < 3) return null;
  return parts;
}

// WHICH VIEW of this app the title says is open — its first ("kind") segment,
// normalized, or '' when the string is not this surface's title at all.
//
// THE single definition of "which Teams view is this", deliberately, because
// there are now two consumers that must never disagree:
//   * extractAgentNameFromTitle's primary parse, which requires the kind to be
//     one of `titleKinds` before it will read a conversation NAME out of
//     segment 1;
//   * the Copilot-tab heading fallback's gate, which requires the kind to be one
//     of `fallbackRead.paneKinds` before it will attempt anything at all.
// Those are different lists on purpose — see the fallbackRead comment on
// teams_desktop — but "what kind is this title" must be one answer.
//
// Note this returns the raw first segment: for a 1:1 DM (measured: no kind
// segment at all, segment 0 IS the colleague's display name) it returns that
// name. That is correct and harmless — the value is only ever COMPARED against
// a catalog list, never used as a name, and never retained.
//
// PURE, never throws, and ported to C# as TitleKindOf.
export function titleKindOf(surface, title) {
  const parts = titleSegments(surface, title);
  if (!parts) return '';
  return normalizeAgentName(parts[0]);
}

export function extractAgentNameFromTitle(surface, title) {
  if (!surface) return AGENT_NAME_NOT_COMPOSER;
  const parts = titleSegments(surface, title);
  if (!parts) return AGENT_NAME_NOT_COMPOSER;
  // The FIRST segment must be a kind that introduces a NAMEABLE conversation. A
  // plain 1:1 DM has no kind segment at all (measured: "Sruthi Chimata |
  // CloudFuze, Inc | … | Microsoft Teams"), so it lands here and correctly reads
  // as no evidence rather than as an agent named after a colleague. So do a
  // channel view ("Teams and Channels"), the Activity tab ("Activity") and the
  // generic Copilot panel ("Copilot", whose second segment is the TENANT, not a
  // conversation name — which is exactly why 'Copilot' must never be added to
  // titleKinds, and why the Copilot tab needs the separate heading fallback).
  const kind = titleKindOf(surface, title).toLowerCase();
  const kinds = surface.titleKinds || [];
  let kindOk = false;
  for (const k of kinds) if (normalizeAgentName(k).toLowerCase() === kind) { kindOk = true; break; }
  if (!kindOk) return AGENT_NAME_NOT_COMPOSER;
  // The conversation name is the SECOND segment. Everything between it and the
  // suffix (org, tenant, signed-in email) is ignored — it identifies the USER,
  // never the conversation, and is never retained.
  const name = normalizeAgentName(parts[1]);
  if (!name) return AGENT_NAME_NOT_COMPOSER;
  // Teams' own multi-person naming is AUTHORITATIVE "not an agent" — see
  // looksLikeParticipantList for exactly what that does and does not cover.
  if (looksLikeParticipantList(name)) return AGENT_NAME_GENERIC;
  for (const generic of surface.genericNames || []) {
    if (normalizeAgentName(generic).toLowerCase() === name.toLowerCase()) return AGENT_NAME_GENERIC;
  }
  return name;
}

// ── Copilot-tab heading reads (the SECOND Teams UI route) ───────────────────

// The agent name a set of already-collected pane HEADINGS names, for a surface
// carrying a `fallbackRead` block.
//
// WHY THIS EXISTS. Teams' embedded Copilot tab keeps a generic, constant window
// title regardless of which agent is open (measured: "Copilot | filefuze |
// erik@filefuze.co | Microsoft Teams"), so extractAgentNameFromTitle correctly
// returns NO EVIDENCE there and the Chat-list route's mechanism simply cannot
// see this route at all. The agent's name is in the PANE instead: either the
// landing heading of a fresh conversation, or the accessible heading on each of
// the agent's own messages.
//
// PURE and side-effect free, exactly like extractAgentNameFromTitle: it takes
// candidates that have ALREADY been collected and does no walking, no reading
// and no I/O of its own. `headings` is an array of { className, name } pairs.
// Same three-outcome contract, and it matters for the same reason — the caller
// must be able to tell "no evidence" from the authoritative "no agent open":
//   AGENT_NAME_NOT_COMPOSER — no evidence. Nothing matched, or the candidates
//                             DISAGREE about which agent this is.
//   AGENT_NAME_GENERIC      — AUTHORITATIVE: a heading was read and it names a
//                             generic label ("Copilot", "You"), not an agent.
//   any other string        — AUTHORITATIVE: that named agent is open.
//
// AMBIGUITY IS NO EVIDENCE, NOT A BLOCK. If two message headings disagree — a
// mixed or stale transcript, a pane that re-rendered mid-walk — this returns
// NOT_COMPOSER. For a HOST APP the fail direction is inverted (see the
// teams_desktop entry): "cannot tell which agent is open" must never mean
// "block anyway" when the app is a company's communications client.
//
// Never throws: every input comes from another process's accessibility tree and
// can be null, empty or garbage.
export function extractAgentNameFromHeading(surface, headings) {
  const fb = surface?.fallbackRead;
  if (!fb || fb.mode !== 'message_heading') return AGENT_NAME_NOT_COMPOSER;
  if (!Array.isArray(headings) || headings.length === 0) return AGENT_NAME_NOT_COMPOSER;
  const headingClass = String(fb.headingClass ?? '').toLowerCase();
  const suffix = String(fb.headingSuffix ?? '');
  const infix = String(fb.landingInfix ?? '');

  let found = '';
  let conflict = false;
  const offer = (candidate) => {
    if (!candidate) return;
    if (!found) found = candidate;
    else if (found.toLowerCase() !== candidate.toLowerCase()) conflict = true;
  };

  // 1+2. The agent's OWN message headings, identified by CLASS. The user's own
  // headings carry a different class (measured: fai-UserMessage__accessibleHeading
  // vs fai-CopilotMessage__accessibleHeading), so this filter is what makes it
  // impossible to read a human's message as the agent's. Token matching is the
  // existing classRuleMatches — a web-hosted element's ClassName is the DOM class
  // ATTRIBUTE and carries build hashes alongside the semantic token.
  if (headingClass && suffix) {
    for (const heading of headings) {
      const cls = String(heading?.className ?? '').trim().toLowerCase();
      if (!cls || !classRuleMatches(cls, headingClass, false)) continue;
      const nm = normalizeAgentName(heading?.name);
      if (nm.length <= suffix.length) continue;
      if (nm.slice(nm.length - suffix.length).toLowerCase() !== suffix.toLowerCase()) continue;
      offer(normalizeAgentName(nm.slice(0, nm.length - suffix.length)));
    }
  }

  // 3. Only when NO message heading matched at all: the landing heading of a
  // freshly-opened conversation ("<Agent> Created by <author>"). Deliberately NOT
  // class-filtered — it is a different element entirely (measured class token
  // `fui-Title1`, i.e. a generic Fluent heading style shared with other titles),
  // so the infix is the whole signal. Confirmed live that re-opening an agent's
  // Copilot-tab conversation resets it to empty, which makes this the common
  // state immediately after opening one.
  if (!found && !conflict && infix) {
    for (const heading of headings) {
      const nm = normalizeAgentName(heading?.name);
      const at = nm.toLowerCase().indexOf(infix.toLowerCase());
      if (at <= 0) continue;
      offer(normalizeAgentName(nm.slice(0, at)));
    }
  }

  if (conflict) return AGENT_NAME_NOT_COMPOSER;   // cannot tell → no evidence
  if (!found) return AGENT_NAME_NOT_COMPOSER;
  // Same ordering as every other reader here: the Generic filter runs BEFORE any
  // matching, so an agent literally named "Copilot" can never be matched through
  // this mechanism either.
  for (const generic of fb.genericNames || []) {
    if (normalizeAgentName(generic).toLowerCase() === found.toLowerCase()) return AGENT_NAME_GENERIC;
  }
  return found;
}

// Does the extracted agent name identify the agent a blocklist row names?
//
// WHOLE-STRING equality after normalisation, NOT the substring test the browser
// extension's enforceBlockedAgent() uses. That looseness is right for the
// extension's much messier signal (an agent name found somewhere in a page
// header); here the signal is clean — an exact composer label — so a substring
// test would only add false positives, e.g. a row for "Advisor" silently
// blocking "AI Learning Advisor".
//
// A sentinel outcome never matches anything.
export function agentNameMatches(extracted, blockedName) {
  if (extracted === AGENT_NAME_GENERIC || extracted === AGENT_NAME_NOT_COMPOSER) return false;
  const a = normalizeAgentName(extracted);
  const b = normalizeAgentName(blockedName);
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

// The single source of truth for "is this focused element an AI panel".
//
// Pure and side-effect free so it can be unit tested without a live UI, and
// serialized (see buildAiPanelConfig) rather than re-implemented for the C#
// side — the same JSON-over-env-var mechanism CFAI_MODEL_ROUTER_CONFIG uses.
// The C# port in enforcer-win.ps1 (MatchPanelSignature) must stay in lockstep
// with the comparison order below.
//
// Returns the matching AI_PANELS entry, or null. Never throws: the inputs come
// from another process's accessibility tree and can be null, empty, or garbage.
// A className rule is matched against the whole string AND against each
// whitespace-separated TOKEN of it, the way a CSS selector would.
//
// For a web-hosted element the UIA ClassName IS the DOM class ATTRIBUTE, which
// routinely holds more than one class: Cursor's own Monaco editor input reports
// "inputarea monaco-mouse-cursor-text", measured. `cursor_composer` is the one
// signature here with nothing to fall back on — empty Name, no namePrefix, no
// classPrefix, just the exact ClassName — so a whole-string compare stops
// matching a genuinely focused, genuinely stable composer the moment Cursor
// carries a second class on it, and a readable NON-match is what tears an
// IDE-panel platform block down in enforcer-win.ps1. claude_code never showed
// this because its ARIA-driven Name matches independently of any class.
//
// Deliberately NOT a substring test: "xx-messageInput_abc" must not satisfy the
// "messageInput_" prefix. Ported to C# as ClassRuleMatches in enforcer-win.ps1;
// the two must stay in lockstep.
function classRuleMatches(cls, want, prefix) {
  if (!want || !cls) return false;
  if (prefix ? cls.startsWith(want) : cls === want) return true;
  if (!/\s/.test(cls)) return false;
  return cls.split(/\s+/).some((tok) => tok.length > 0 && (prefix ? tok.startsWith(want) : tok === want));
}

export function matchPanelSignature(focused) {
  // Destructuring in the signature is not enough: a default only applies to
  // `undefined`, so an explicit null (a perfectly ordinary "nothing is focused"
  // answer) would throw. This function is on the poll path and must never do
  // that.
  const { process: processName, controlType, name, className } = focused || {};
  const proc = String(processName ?? '').replace(/\.exe$/i, '').trim().toLowerCase();
  if (!proc) return null;
  const ct = String(controlType ?? '').trim().toLowerCase();
  if (!ct) return null;
  const nm = String(name ?? '').trim().toLowerCase();
  const cls = String(className ?? '').trim().toLowerCase();
  for (const panel of AI_PANELS) {
    if (String(panel.controlType).toLowerCase() !== ct) continue;
    if (!panel.procs.some((p) => String(p).toLowerCase() === proc)) continue;
    // Any ONE of the fields the entry defines is enough — that is what lets
    // claude_code survive a CSS-module hash change via its Name alone. An
    // absent field never matches, and an empty read never satisfies a
    // non-empty rule (so a blank Name cannot prefix-match "Chat Input").
    const nameEq = !!panel.nameEquals && nm.length > 0 && nm === panel.nameEquals.toLowerCase();
    const namePre = !!panel.namePrefix && nm.length > 0 && nm.startsWith(panel.namePrefix.toLowerCase());
    const classEq = !!panel.classEquals && cls.length > 0 && classRuleMatches(cls, panel.classEquals.toLowerCase(), false);
    const classPre = !!panel.classPrefix && cls.length > 0 && classRuleMatches(cls, panel.classPrefix.toLowerCase(), true);
    if (nameEq || namePre || classEq || classPre) return panel;
  }
  return null;
}

// Mirrors identifyAiProcess, for a panel id reported on an enforcer event.
export function identifyAiPanel(panelId) {
  const id = String(panelId || '').trim();
  if (!id) return null;
  for (const panel of AI_PANELS) {
    if (panel.id === id) return { product: panel.product, vendor: panel.vendor };
  }
  return null;
}

// Mirrors hostForProcess: the access-exception key for a panel block.
export function hostForPanel(panelId) {
  const id = String(panelId || '').trim();
  if (!id) return null;
  for (const panel of AI_PANELS) {
    if (panel.id === id) return panel.host || null;
  }
  return null;
}

// Reverse of hostForPanel — the platform-block bridge's lookup, mirroring
// processForHost. Exact + case-insensitive for the same reason that one is:
// ai_platforms.host is already normalized server-side, and guessing at
// subdomains could block a panel off an unrelated row.
//
// Unlike processForHost this does NOT exclude the IDE surfaces: excluding them
// there is about never swallowing input process-wide in a code editor, and a
// panel match is by construction scoped to the AI composer element only.
export function panelForHost(host) {
  const target = String(host || '').trim().toLowerCase();
  if (!target) return null;
  for (const panel of AI_PANELS) {
    if (String(panel.host || '').trim().toLowerCase() === target) return panel.id;
  }
  return null;
}

// Returns true if clipboard scrub is the ONLY block mechanism available
// for the given process — the OS monitor uses this to decide whether to
// overwrite the clipboard contents when a high/critical pattern is detected.
export function shouldScrubClipboardFor(processName) {
  if (!processName) return false;
  const base = processName.replace(/\.exe$/i, '').trim();
  for (const e of AI_PROCESSES) {
    if (e.match.test(base)) return e.unhookableSandbox === true;
  }
  return false;
}

export function isAttachmentWatcherEligible(processName) {
  if (!processName) return false;
  const base = processName.replace(/\.exe$/i, '').trim();
  for (const e of AI_PROCESSES) {
    if (e.match.test(base)) return e.useAttachmentWatcher !== false;
  }
  return false;
}

// Returns { product, vendor } if the process matches, else null.
export function identifyAiProcess(processName) {
  if (!processName) return null;
  const base = processName.replace(/\.exe$/i, '').trim();
  for (const entry of AI_PROCESSES) {
    if (entry.match.test(base)) return { product: entry.product, vendor: entry.vendor };
  }
  return null;
}

// ── Access-exception keys ────────────────────────────────────────────────────

// Platform id (as written into `blocked_agents` by the governance lifecycle
// route, and as it appears in blocked-agents.json) → the desktop process names
// that platform is reached through.
//
// DUPLICATED, deliberately and unavoidably: enforcer-win.ps1 holds the same map
// as a C# Dictionary because it is a standalone PowerShell process that reads
// blocked-agents.json itself and cannot import ESM. This copy is the one the
// Node side uses to answer "which host does this blocked row correspond to", so
// an approved exception can be subtracted from the file before the enforcer
// sees it. The two must agree — agent/tests/os-monitor-safety.test.mjs parses
// the .ps1 and fails if they drift.
//
// 'ms-teams' appears under THREE keys. A Copilot Studio agent and a personal
// M365 agent are both reachable INSIDE Microsoft Teams as well as in the two
// standalone Copilot builds, and teams_chat_agent is the platform id for an
// agent that only ever lives in Teams. Membership here is what lets an
// agent-scoped row cover the Teams process at all — and, via hostsForPlatform,
// what lets an approved teams.microsoft.com exception lift such a row. It does
// NOT make Teams an AI app: see AI_PROCESSES' `hostApp` note, and note that
// enforcer-win.ps1 never produces a whole-app block for a host-app process.
export const PLATFORM_PROCS = Object.freeze({
  copilot_studio:    ['Copilot', 'M365Copilot', 'ms-teams'],
  personal_agent:    ['Copilot', 'M365Copilot', 'ms-teams'],
  teams_chat_agent:  ['ms-teams'],
  openai_assistant:  ['ChatGPT'],
  custom_gpt:        ['ChatGPT'],
  claude_ai_project: ['Claude'],
  gemini:            ['Gemini'],
  vertex_ai:         ['Gemini'],
});

// The canonical vendor host for a process name, or null if it isn't a known AI
// app. This is the access-exception key for a desktop block.
export function hostForProcess(processName) {
  if (!processName) return null;
  const base = processName.replace(/\.exe$/i, '').trim();
  for (const entry of AI_PROCESSES) {
    if (entry.match.test(base)) return entry.host || null;
  }
  return null;
}

// ── Admin "Inventory" platform blocks → desktop enforcement ─────────────────
//
// The admin Inventory page toggles `ai_platforms.blocked`, which is keyed by
// HOST and, until now, only ever enforced by the browser extension. The desktop
// enforcer knows nothing about hosts: it reads blocked-agents.json (keyed by
// agent_id, matched via PLATFORM_PROCS) and compares against the foreground
// PROCESS name. These helpers bridge the two by synthesising extra
// blocked-agents.json rows for host-keyed platform blocks.
//
// The synthesised rows carry a SENTINEL platform id that is deliberately not a
// PLATFORM_PROCS key, plus a `process_name` field the .ps1 matches directly.
// That keeps PLATFORM_PROCS (and its duplicated C# copy) untouched: a
// host→process mapping already exists in this catalog and does not need to be
// restated as a platform→process one.
export const PLATFORM_BLOCK_SENTINEL = 'ai_platform';

// The literal process name a catalog entry's `match` regex is anchored on.
// Same derivation index.js uses to build CFAI_AI_PROCESSES for the helper
// scripts, so the value here is exactly the form those already compare against.
// Case does not have to match the real OS process name: every consumer
// (PLATFORM_PROCS' HashSet, the new process_name branch in enforcer-win.ps1,
// the watchers' own name sets) compares case-insensitively.
function processNameForEntry(entry) {
  const literal = String(entry?.match?.source || '')
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/[\\\/]i?$/, '');
  return literal || null;
}

// Reverse of hostForProcess: the desktop process a vendor host is reached
// through, or null if this catalog has no desktop app for it.
//
// Returns null for entries with `useAttachmentWatcher === false` — today Cursor
// and GitHub Copilot. Those are excluded from host-keyed platform blocking on
// purpose: an IDE (and an IDE plugin with no standalone window at all) is not a
// chat surface an "is this host blocked" toggle was authored about, and fully
// swallowing input in a code editor because someone blocked cursor.com in the
// browser inventory would be a catastrophic false positive. The flag is used
// rather than a hardcoded name list so the exclusion tracks the catalog.
//
// Matching is exact and case-insensitive. ai_platforms.host values are already
// run through the server's normalizeHost(), so no subdomain/URL handling is
// needed here — and guessing at it would risk blocking a whole vendor's desktop
// app off an unrelated subdomain row.
// A HOST APP (`hostApp: true` — Microsoft Teams) is excluded too, and this is
// the stronger of the two exclusions: an Inventory toggle on
// teams.microsoft.com must never synthesize a process_name:'ms-teams' row,
// because that row is matched process-WIDE by enforcer-win.ps1 and would
// swallow Enter in every DM, channel and meeting chat in the company's comms
// client. Stated as its own guard rather than leaning on the flag above, so
// that flipping useAttachmentWatcher on a host app later cannot quietly
// re-enable whole-app blocking for it.
export function processForHost(host) {
  const target = String(host || '').trim().toLowerCase();
  if (!target) return null;
  for (const entry of AI_PROCESSES) {
    if (String(entry.host || '').trim().toLowerCase() !== target) continue;
    if (entry.hostApp === true) return null;
    if (entry.useAttachmentWatcher === false) return null;
    return processNameForEntry(entry);
  }
  return null;
}

// Like processForHost, but returns EVERY process name that reaches this host,
// not just the first. Some vendors ship more than one process name for the
// same app — ChatGPT Desktop runs as "ChatGPT" on most installs but as
// "ChatGPT Classic" on others (confirmed 2026-08-13 via tasklist), and both
// entries carry host:'chatgpt.com'. processForHost's single-value contract
// (relied on elsewhere, e.g. the access-exception host key) stops at the
// first match, which is correct for that use but silently dropped every
// variant past the first when reused for host-keyed platform blocking — an
// admin blocking chatgpt.com only ever produced a row for "chatgpt", so a
// "ChatGPT Classic" install was never actually enforced. This is the
// multi-entry-aware version synthesizePlatformBlocks needs.
export function processesForHost(host) {
  const target = String(host || '').trim().toLowerCase();
  if (!target) return [];
  const names = [];
  for (const entry of AI_PROCESSES) {
    if (String(entry.host || '').trim().toLowerCase() !== target) continue;
    // Same two exclusions, same reasons, as processForHost — this is the
    // function synthesizePlatformBlocks actually calls, so the host-app guard
    // here is the one that stops an Inventory toggle from producing a
    // whole-app Teams block row.
    if (entry.hostApp === true) continue;
    if (entry.useAttachmentWatcher === false) continue;
    const name = processNameForEntry(entry);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// The process names the PASSIVE watchers may key on — the clipboard poller and
// the file-dialog / attachment-chip / prompt-text UIA watchers in index.js,
// plus CFAI_AI_PROCESSES for the keystroke enforcer.
//
// Excludes `hostApp: true` entries, and that exclusion IS the privacy property
// of the host-app feature: Microsoft Teams' presence in AI_PROCESSES must never
// turn on clipboard scanning, attachment watching or prompt reading across a
// company's whole communications client. Only the narrow, independently-gated
// agent-conversation path in enforcer-win.ps1 may ever look at Teams, and it is
// gated on a blocked agent actually being open.
export function watcherProcessNames() {
  return AI_PROCESSES
    .filter((entry) => entry.hostApp !== true)
    .map((entry) => processNameForEntry(entry))
    .filter(Boolean);
}

// ── Helper env payloads (CFAI_IDE_PROCESSES / CFAI_AI_PANELS) ───────────────
//
// Serialized as JSON and deserialized on the C# side with JavaScriptSerializer,
// mirroring CFAI_MODEL_ROUTER_CONFIG exactly, rather than being restated as
// literals inside enforcer-win.ps1. The point is that AI_PANELS above is the
// only place a signature is ever written down: the .ps1 owns the comparison
// code (MatchPanelSignature), never the data.
//
// TWO consumers, for opposite reasons:
//   enforcer.js         → enforcer-win.ps1 scopes keystroke scanning/blocking to
//                         a focused panel instead of the whole IDE process.
//   prompt-watcher.js   → prompt-watcher.ps1 refuses to READ the focused
//                         element's text at all unless it matches a panel.
//                         Without it, Cursor's AI_PROCESSES membership (needed
//                         for host/exception resolution) meant that watcher read
//                         and reported source code as a typed prompt.
// Neither payload ever widens which PROCESSES are watched — that stays
// AI_PROCESSES' job, via CFAI_AI_PROCESSES.

// The IDE process-name list, with each entry's whole-app fallback flag.
export function buildIdeProcessConfig() {
  return IDE_PROCESSES.map((entry) => ({
    name: processNameForEntry(entry),
    panelFallback: entry.panelFallback === true,
  })).filter((e) => e.name);
}

// The panel signature table. `enforce` travels with each entry so the C# side
// knows which panels are live and which are detection-only; `product`/`vendor`
// do not (nothing on that side displays them — index.js resolves those from the
// panel id via identifyAiPanel), and `host` does not either (blocked-agents.json
// rows already carry their own host).
// Absent, non-numeric and out-of-range all resolve into
// [DEFAULT_POST_SEND_VERIFY_MS, MAX_POST_SEND_VERIFY_MS]. The lower bound is the
// default rather than 0 on purpose: an entry may only ever LENGTHEN the
// confirmation window, never shorten the read that native composers rely on.
export function clampPostSendVerifyMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_POST_SEND_VERIFY_MS;
  return Math.min(MAX_POST_SEND_VERIFY_MS, Math.max(DEFAULT_POST_SEND_VERIFY_MS, Math.round(n)));
}

export function buildAiPanelConfig() {
  return AI_PANELS.map((panel) => ({
    id: panel.id,
    procs: panel.procs.slice(),
    controlType: panel.controlType,
    nameEquals: panel.nameEquals || '',
    namePrefix: panel.namePrefix || '',
    classEquals: panel.classEquals || '',
    classPrefix: panel.classPrefix || '',
    enforce: panel.enforce === true,
    // 'agent' is stated explicitly for an absent dlpMatch rather than shipped
    // as "", so the JS default and the C# default are the same word in the same
    // place and cannot drift apart silently — the same convention `read` uses on
    // the agent-surface payload. Only 'panel' opts into panel-alone DLP
    // governance; every other value, including a typo, lands on the strict side.
    dlpMatch: panel.dlpMatch === 'panel' ? 'panel' : 'agent',
    // The per-entry newline combo, resolved here so the C# side never has to
    // distinguish missing from empty. An unrecognised value travels VERBATIM
    // (not silently rewritten to the default): the enforcer must be able to tell
    // "this surface declares a combo I cannot synthesize" — which refuses
    // multi-line Tier B there — from "this surface said nothing", which gets the
    // default.
    newlineKeys: panel.newlineKeys === undefined ? DEFAULT_NEWLINE_KEYS : String(panel.newlineKeys),
    // The per-entry post-send confirmation window, resolved to a NUMBER here so
    // the C# side never has to distinguish missing from empty, and clamped on
    // BOTH sides: here so the payload is already sane, and again in
    // enforcer-win.ps1's LoadAiPanels because that side must not trust an env
    // var it did not build. Clamping (rather than dropping a bad value) keeps a
    // typo from silently reverting a surface to the single read this field
    // exists to replace.
    postSendVerifyMs: clampPostSendVerifyMs(panel.postSendVerifyMs),
  }));
}

// The agent-surface catalog, for the CFAI_AGENT_SURFACES env-var handoff.
//
// BOTH flags travel: the C# side narrows a block only when a surface is
// `verified` AND `enforce`, so dropping either here would silently change which
// side of that gate the surface lands on. `product`/`vendor`/`host` do not — the
// .ps1 displays nothing and a blocked row carries its own identity fields.
// The title-mode fields travel alongside the composer-mode ones rather than
// replacing them: LoadAgentSurfaces branches on `read`, so an entry that does
// not set it (m365_copilot) ships exactly the payload it always did, with the
// title fields present and empty and read by nothing.
export function buildAgentSurfaceConfig() {
  return AGENT_SURFACES.map((surface) => ({
    id: surface.id,
    procs: surface.procs.slice(),
    controlType: surface.controlType,
    composerNamePrefixes: (surface.composerNamePrefixes || []).slice(),
    genericNames: (surface.genericNames || []).slice(),
    // 'composer_name' is stated explicitly for an absent `read` rather than
    // shipped as "", so the C# default and the JS default are the same word in
    // the same place and cannot drift apart silently.
    read: surface.read === 'window_title' ? 'window_title' : 'composer_name',
    titleSeparator: surface.titleSeparator || '',
    titleSuffix: surface.titleSuffix || '',
    titleKinds: (surface.titleKinds || []).slice(),
    hostApp: surface.hostApp === true,
    enforce: surface.enforce === true,
    verified: surface.verified === true,
    // The nested SECOND-ROUTE block, present only on an entry that declares one.
    // OMITTED entirely otherwise, so m365_copilot's payload is byte-for-byte the
    // one it has always shipped — LoadAgentSurfaces treats an absent block as
    // "no fallback configured" and leaves every field null/empty/false.
    //
    // Both flags travel for the same reason the entry's own pair does: the C#
    // side reaches the fallback only when it is verified AND enforcing, so
    // dropping either here would silently move the route to the wrong side of
    // its own gate.
    ...(surface.fallbackRead ? {
      fallbackRead: {
        mode: surface.fallbackRead.mode === 'message_heading' ? 'message_heading' : '',
        paneKinds: (surface.fallbackRead.paneKinds || []).slice(),
        headingClass: surface.fallbackRead.headingClass || '',
        headingSuffix: surface.fallbackRead.headingSuffix || '',
        landingInfix: surface.fallbackRead.landingInfix || '',
        genericNames: (surface.fallbackRead.genericNames || []).slice(),
        enforce: surface.fallbackRead.enforce === true,
        verified: surface.fallbackRead.verified === true,
      },
    } : {}),
  }));
}

// enforcer-win.ps1 parses blocked-agents.json with a hand-rolled extractor:
// ExtractJsonString stops at the first `"` after the value starts, and
// SplitJsonArray splits rows on brace depth. Both are fooled by a quote, a
// backslash or a brace inside a value — and a single corrupted value derails
// parsing of the WHOLE file, not just its own row, which would silently drop
// every other block too. Admin-typed fields (product/vendor) therefore get
// these characters removed, not escaped, before they are written.
const PS1_UNSAFE_CHARS = /["\\{}\u0000-\u001f\u007f]/g;
const PS1_FIELD_MAX = 200;

function sanitizeForPs1(value) {
  return String(value ?? '').replace(PS1_UNSAFE_CHARS, '').trim().slice(0, PS1_FIELD_MAX);
}

// The `agent_scope` values the enforcer understands. Anything else — including
// an absent field — means today's whole-process behaviour.
const AGENT_SCOPES = ['agent', 'platform'];

// Sanitise the SERVER's per-agent blocked_agents rows before they are written to
// blocked-agents.json.
//
// synthesizePlatformBlocks() has always run its admin-typed fields through
// sanitizeForPs1, for the reason documented above it: the .ps1's hand-rolled
// parser derails on the whole FILE for one stray quote/backslash/brace in one
// value, silently dropping every other block too. The server's per-agent rows
// were sent RAW. Until now that only risked corrupting a display string; with
// agent_scope:'agent' the agent_name becomes the MATCHING KEY, and Agent Store
// display names are free text nobody necessarily typed carefully.
//
// Two things happen per row:
//   1. every STRING value is sanitised. Non-strings (bool/number/null) are left
//      alone — they cannot carry a character the parser chokes on, and coercing
//      them would change the file's shape for no benefit. Anything structured
//      (an object/array, which WOULD serialise braces into the file) is
//      flattened through sanitizeForPs1 as a last line of defence.
//   2. an 'agent'-scoped row whose agent_name did not survive the transport
//      intact is DOWNGRADED to platform scope. A name the enforcer can never
//      match would mean an agent-scoped block that silently enforces nothing;
//      falling back to today's whole-app block is the fail-closed answer. The
//      comparison normalises whitespace on both sides so an ordinary doubled
//      space is not mistaken for character loss, and a sanitised name under 2
//      characters is treated as lost regardless.
export function normalizeAgentRows(agentRows, logger) {
  if (!Array.isArray(agentRows)) return [];
  const out = [];
  for (const row of agentRows) {
    if (!row || typeof row !== 'object') continue;
    const clean = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string') clean[key] = sanitizeForPs1(value);
      else if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') clean[key] = value;
      else clean[key] = sanitizeForPs1(value);
    }
    const scope = String(row.agent_scope ?? '').trim().toLowerCase();
    clean.agent_scope = AGENT_SCOPES.includes(scope) ? scope : null;
    if (clean.agent_scope === 'agent') {
      const rawName = normalizeAgentName(row.agent_name);
      const cleanName = normalizeAgentName(clean.agent_name);
      if (cleanName.length < 2 || cleanName !== rawName) {
        logger?.warn(
          `blocked-agents: agent-scoped row ${row.agent_id || '(no id)'} downgraded to platform scope — `
          + 'its agent name cannot survive the enforcer transport intact',
        );
        clean.agent_scope = null;
      }
    }
    out.push(clean);
  }
  return out;
}

// GET /api/v1/ai-platforms rows → extra blocked-agents.json rows.
//
// Fetched UNFILTERED by the caller: `surface` is not consulted at all, because
// no admin UI has ever set it (every row defaults to 'browser'), so filtering on
// it would return nothing. The real desktop-relevance test is whether the host
// resolves to a process — or, now, an IDE-hosted PANEL — this catalog carries.
//
// A host can resolve to BOTH, and then both rows are emitted:
//   claude.ai  → the Claude Desktop process AND the Claude Code panel in VS Code
//   github.com → (no standalone process; GitHub Copilot is excluded there) AND
//                the Copilot Chat panel — this is the linkage that makes ONE
//                Inventory toggle cover the website and the in-IDE panel
//   cursor.com → the Cursor composer panel only; the Cursor PROCESS is
//                deliberately excluded by processForHost, because blocking a
//                whole code editor off a browser-inventory toggle would be a
//                catastrophic false positive. The panel row is safe precisely
//                because it is scoped to the composer element.
//
// A panel row carries `panel` and NOT `process_name`: process_name matching in
// enforcer-win.ps1 is process-WIDE, so keying the Claude Code panel on
// process_name:"Code" would also block the Copilot Chat panel and plain editing.
// A detection-only panel (enforce:false) still gets its row — the enforce gate
// lives in the .ps1, so the wiring is real and flipping the flag is all that is
// needed later.
//
// Only the `blocked` boolean is read. capture_mode (observe/block_critical/hold)
// is deliberately NOT wired up here — that is separate, tracked work.
export function synthesizePlatformBlocks(platformRows) {
  if (!Array.isArray(platformRows)) return [];
  const rows = [];
  const seen = new Set();
  for (const row of platformRows) {
    if (row?.blocked !== true) continue;
    const agentName = sanitizeForPs1(row.product || row.vendor || row.host);
    const host = sanitizeForPs1(row.host);
    // ALL process names for this host, not just the first — a vendor can ship
    // more than one process name for the same app (ChatGPT Desktop runs as
    // "ChatGPT" on most installs, "ChatGPT Classic" on others). Using only
    // processForHost's first match here left every later variant unblocked
    // even though the admin's toggle said otherwise. Two hosts can still
    // legitimately resolve to one app (e.g. a second Perplexity domain also
    // reaching Comet); the `seen` set is what dedupes THAT case, not this one.
    for (const proc of processesForHost(row.host)) {
      if (seen.has(`proc:${proc.toLowerCase()}`)) continue;
      seen.add(`proc:${proc.toLowerCase()}`);
      rows.push({
        platform: PLATFORM_BLOCK_SENTINEL,
        process_name: sanitizeForPs1(proc),
        agent_name: agentName,
        agent_id: '',
        host,
        reason: 'Blocked by organization policy',
      });
    }
    const panel = panelForHost(row.host);
    if (panel && !seen.has(`panel:${panel}`)) {
      seen.add(`panel:${panel}`);
      rows.push({
        platform: PLATFORM_BLOCK_SENTINEL,
        panel,
        agent_name: agentName,
        agent_id: '',
        host,
        reason: 'Blocked by organization policy',
      });
    }
  }
  return rows;
}

// GET /api/lifecycle/governed-agents rows → governed-agents.json rows.
//
// Same sanitiser as the blocked list, for the same reason: the enforcer parses
// both files with the same hand-rolled extractor, where one stray quote,
// backslash or brace derails the WHOLE file rather than its own row. Running the
// rows through normalizeAgentRows also means the two files carry the SAME shape
// — identical field names, agent_scope normalised to 'agent' | 'platform' | null
// — so the enforcer-side parser can be shared instead of learning a second
// convention.
//
// ONE deliberate difference from the blocked list. normalizeAgentRows DOWNGRADES
// an 'agent'-scoped row whose agent_name cannot survive that transport to
// platform scope, because for a BLOCK that widening is the fail-closed answer
// (a whole-app block instead of an agent-scoped block that matches nothing).
// For a GOVERNED row the same widening is the wrong direction: it would turn
// "DLP-monitor this one named agent" into "DLP-monitor everything typed in this
// app", i.e. capture far more prompt content than the admin asked for. Such a
// row is DROPPED instead — monitoring nothing is recoverable on the next tick,
// over-collecting is not.
//
// The object pre-filter is what keeps the two arrays index-aligned:
// normalizeAgentRows skips non-object entries and nothing else.
export function normalizeGovernedRows(governedRows, logger) {
  const rows = Array.isArray(governedRows) ? governedRows.filter((r) => r && typeof r === 'object') : [];
  // logger deliberately not passed: its downgrade warning is worded for the
  // blocked list, and a downgrade here is reported as a drop below instead.
  const normalized = normalizeAgentRows(rows, null);
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const asked = String(rows[i].agent_scope ?? '').trim().toLowerCase();
    if (asked === 'agent' && normalized[i].agent_scope !== 'agent') {
      logger?.warn(
        `governed-agents: agent-scoped row ${rows[i].agent_id || '(no id)'} dropped — its agent name cannot `
        + 'survive the enforcer transport intact, and widening it to whole-app monitoring would capture more '
        + 'than was asked for',
      );
      continue;
    }
    out.push(normalized[i]);
  }
  return out;
}

// BLOCKED WINS: subtract the blocked list from the governed (DLP-monitor) list.
//
// The enforcer reads blocked-agents.json and governed-agents.json independently,
// and the same agent must never appear in both — offering "Tokenize & Send" for
// an agent the org refuses outright is precisely the outcome this precedence
// exists to prevent.
//
// The SERVER already guarantees the two payloads are disjoint (its governed
// query excludes blocked rows). This is not redundant with that: the agent
// fetches the two lists with two separate GETs a fraction of a second apart, so
// an admin flipping a block in between — or either list being one poll cycle
// stale relative to the other — can hand this process two lists that overlap
// even though neither response was wrong when it was generated. Filtering here,
// where both lists are in hand, makes the overlap structurally impossible on
// disk regardless of any timing race or any future server-side regression.
//
// Matching mirrors filterBlockedAgents' agent-scoped branch exactly: an
// agent_id present on BOTH sides is decisive (a name collision cannot widen it),
// otherwise the whitespace-normalised, case-insensitive agent_name is the
// fallback for rows carrying no id on one side. `platform` is deliberately NOT
// part of the key — if a blocked row and a governed row disagree about the
// platform, they still collide and blocked still wins.
export function filterGovernedAgents(list, blockedRows, logger) {
  if (!Array.isArray(list)) return [];
  if (!Array.isArray(blockedRows) || blockedRows.length === 0 || list.length === 0) return list;
  const blocked = [];
  for (const row of blockedRows) {
    const id = String(row?.agent_id ?? '').trim();
    const name = normalizeAgentName(row?.agent_name).toLowerCase();
    if (!id && !name) continue;   // names nothing — can match nothing
    blocked.push({ id, name });
  }
  if (blocked.length === 0) return list;
  return list.filter((row) => {
    const id = String(row?.agent_id ?? '').trim();
    const name = normalizeAgentName(row?.agent_name).toLowerCase();
    const hit = blocked.find((b) => ((b.id && id)
      ? b.id === id
      : Boolean(b.name && name) && b.name === name));
    if (hit) {
      logger?.info(
        `governed-agents: "${row?.agent_name || row?.agent_id}" is also BLOCKED — dropped from the `
        + 'governed list (blocked wins)',
      );
      return false;
    }
    return true;
  });
}

// Every host a blocked platform can be reached at on the desktop. More than one
// is normal (copilot_studio covers both Copilot builds); an unknown platform
// yields an empty list, which callers must read as "no exception can apply" —
// never as "unblock it".
export function hostsForPlatform(platform) {
  const procs = PLATFORM_PROCS[String(platform || '').toLowerCase()] || [];
  const hosts = [];
  for (const proc of procs) {
    const host = hostForProcess(proc);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

// Subtract admin-approved access exceptions from the server's blocked-agents
// list. This is what makes an approval actually unblock a desktop app:
// monitor-runner.mjs runs the result through here before writing
// blocked-agents.json, and enforcer-win.ps1 re-reads that file every 10s with
// no knowledge of exceptions at all.
//
// `exceptions` is the /api/v1/access-exceptions/mine payload — already scoped to
// this machine and already filtered to live, unexpired grants by the server, so
// nothing here re-checks expiry (there is no second source of truth for it).
//
// FAIL CLOSED is the caller's job, not this function's: passing an empty list
// legitimately means "no exceptions", so a caller that could not REACH the
// server must skip this call entirely rather than pass [].
//
// SCOPE-AWARE since agent-level blocks exist. /access-exceptions/mine now
// carries `scope` ('host' | 'agent'), `agent_id` and `agent_name` per row, and
// the two scopes subtract completely differently:
//
//   scope:'host' — and a row with NO scope at all, which is every exception
//     approved before agent scoping existed — lifts EVERY blocked row for every
//     platform mapping to that host. Byte-for-byte today's behaviour, and the
//     default, because that is what those grants meant when they were made.
//
//   scope:'agent' — lifts ONLY the row for that same agent, and only if the row
//     is itself agent-scoped (agent_scope:'agent'). Approving "the IT help-desk
//     bot in Teams" must leave every other blocked agent in Teams blocked, and
//     must never lift the synthesised whole-platform row for that host — that
//     row is "all of this app is disallowed", which is not what was approved.
//     This mirrors the server's own /access-exceptions/check, which answers
//     allowed:false for an agent it has no matching grant for even when a
//     DIFFERENT agent on the same host is approved.
export function filterBlockedAgents(list, exceptions, logger) {
  if (!Array.isArray(list) || !Array.isArray(exceptions) || exceptions.length === 0) return list;
  const hostAllowed = new Set();
  const agentAllowed = [];
  for (const ex of exceptions) {
    const host = String(ex?.tool_host || '').trim().toLowerCase();
    if (!host) continue;
    if (String(ex?.scope || '').trim().toLowerCase() !== 'agent') {
      // 'host', absent, null, or anything unrecognised. Unrecognised lands here
      // deliberately: 'host' is both the legacy meaning and the WIDER grant, so
      // a scope value this build does not know cannot silently narrow an
      // approval the admin already made into "nothing was lifted".
      hostAllowed.add(host);
      continue;
    }
    const id = String(ex?.agent_id ?? '').trim();
    const name = normalizeAgentName(ex?.agent_name).toLowerCase();
    // An agent-scoped grant that names no agent can match no agent, and must
    // NOT fall back to lifting the host — that fallback is exactly the widening
    // the server removed.
    if (!id && !name) continue;
    agentAllowed.push({ host, id, name });
  }
  if (hostAllowed.size === 0 && agentAllowed.length === 0) return list;
  return list.filter((row) => {
    // Two ways a row names the host an exception would be granted against:
    //
    //   row.host       — carried by the synthesised platform-block rows, whose
    //                    platform id is the PLATFORM_BLOCK_SENTINEL and so has no
    //                    PLATFORM_PROCS entry to map through at all. Without this
    //                    branch an approved exception could never lift one.
    //   row.platform   — the server's agent-block rows, which have no host field.
    //
    // Checked as a union rather than an either/or so neither shape regresses.
    // A platform this catalog has no desktop process for still can never be
    // excepted here: hostsForPlatform returns [] and the row stays. That is
    // deliberate — the same list is enforced browser-side, where the extension
    // does its own exception check against the real page host.
    const candidates = [];
    const own = String(row?.host || '').trim().toLowerCase();
    if (own) candidates.push(own);
    for (const h of hostsForPlatform(row?.platform)) if (!candidates.includes(h)) candidates.push(h);
    const hit = candidates.find((h) => hostAllowed.has(h));
    if (hit) {
      logger?.info(`access-exceptions: ${row.host || row.platform} unblocked on this device (exception for ${hit})`);
      return false;
    }
    // AGENT-scoped grants, checked only against an AGENT-scoped row. A
    // synthesised whole-platform row (agent_scope null, and normalizeAgentRows
    // also downgrades a row whose name cannot survive the enforcer transport)
    // can never be lifted here, no matter how well its agent_name matches: the
    // grant was for one agent, that row is for the whole app.
    if (String(row?.agent_scope || '').trim().toLowerCase() === 'agent') {
      const rowId = String(row?.agent_id ?? '').trim();
      const rowName = normalizeAgentName(row?.agent_name).toLowerCase();
      // Identity first, exactly as the server matches: when BOTH sides carry an
      // agent_id that IS the answer and a name collision cannot widen it. The
      // normalized, case-insensitive name is the fallback for the rows that have
      // no id on one side — the same allowance normalizeAgentName exists for.
      const agentHit = agentAllowed.find((ex) => candidates.includes(ex.host)
        && ((ex.id && rowId) ? ex.id === rowId : Boolean(ex.name && rowName) && ex.name === rowName));
      if (agentHit) {
        logger?.info(
          `access-exceptions: agent "${row.agent_name || row.agent_id}" unblocked on this device `
          + `(agent-scoped exception for ${agentHit.host})`,
        );
        return false;
      }
    }
    return true;
  });
}
