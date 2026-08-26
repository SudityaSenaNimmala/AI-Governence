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
];

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
export const PLATFORM_PROCS = Object.freeze({
  copilot_studio:    ['Copilot', 'M365Copilot'],
  personal_agent:    ['Copilot', 'M365Copilot'],
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
export function processForHost(host) {
  const target = String(host || '').trim().toLowerCase();
  if (!target) return null;
  for (const entry of AI_PROCESSES) {
    if (String(entry.host || '').trim().toLowerCase() !== target) continue;
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
    if (entry.useAttachmentWatcher === false) continue;
    const name = processNameForEntry(entry);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
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
export function filterBlockedAgents(list, exceptions, logger) {
  if (!Array.isArray(list) || !Array.isArray(exceptions) || exceptions.length === 0) return list;
  const allowed = new Set(exceptions.map((e) => String(e?.tool_host || '').toLowerCase()).filter(Boolean));
  if (allowed.size === 0) return list;
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
    const hit = candidates.find((h) => allowed.has(h));
    if (hit) logger?.info(`access-exceptions: ${row.host || row.platform} unblocked on this device (exception for ${hit})`);
    return !hit;
  });
}
