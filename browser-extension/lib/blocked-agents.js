// Blocked-agent policy math — the WORKER half.
//
// Imported by background/service-worker.js (an ESM MV3 worker). Everything here
// is PURE: no chrome.*, no DOM, no fetch, no clock. That is what lets `node
// --test` drive the exception-subtraction rule directly instead of asserting on
// source text (see tests/blocked-agent-exceptions.test.mjs).
//
// WHY THE HOST MAP IS DUPLICATED. content/content.js has its own copy of
// PLATFORM_HOST_PATTERNS as the `PLATFORM_TO_HOSTS` literal mid-IIFE, because
// content scripts are classic scripts and this repo has no bundler — the same
// reason lib/recording.js's header gives for content/replay.js existing. The two
// copies MUST agree on which hosts a blocked agent is even looked for on.
// tests/blocked-agent-exceptions.test.mjs asserts they are character-identical,
// so drift fails the build rather than shipping.
//
// EXCEPTIONS ARE NOT DECIDED FROM THAT MAP. Which blocked rows an approved
// exception lifts is decided by exceptionHostMatchesPlatform() below, against
// the deliberately narrower PLATFORM_EXCEPTION_HOST_PATTERNS — see the comment
// there for why reusing the wide lookup map for exceptions was a bug, not a
// simplification. This half has no counterpart in content.js: exception
// subtraction runs once, here, in the background worker, before the filtered
// list is cached and broadcast — content.js only ever sees the result.

// Regex SOURCES rather than literals, so the sync test above can compare them to
// content.js's `/.../` literals character for character.
// Every Microsoft 365 Copilot agent TYPE is reachable on the whole Microsoft
// suite, not just the standalone Copilot chat surfaces. personal_agent
// (declarative agents) used to list only copilot.microsoft and
// m365.cloud.microsoft, so a blocked personal agent went unenforced the moment
// the user opened it from Teams, Outlook, SharePoint or Office — and
// sharepoint_embedded, teams_app and isv_store, which the server already emits
// as platforms, mapped to NOTHING at all, so those blocks enforced nowhere in
// the browser. All four now carry the same host list copilot_studio has.
export const PLATFORM_HOST_PATTERNS = Object.freeze({
  copilot_studio:     ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'powerva\\.ms', 'copilotstudio', 'teams\\.microsoft', 'outlook\\.office', 'outlook\\.live', 'sharepoint\\.com', '(^|\\.)office\\.com', 'office365\\.com', 'microsoft365\\.com'],
  personal_agent:     ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'powerva\\.ms', 'copilotstudio', 'teams\\.microsoft', 'outlook\\.office', 'outlook\\.live', 'sharepoint\\.com', '(^|\\.)office\\.com', 'office365\\.com', 'microsoft365\\.com'],
  sharepoint_embedded:['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'powerva\\.ms', 'copilotstudio', 'teams\\.microsoft', 'outlook\\.office', 'outlook\\.live', 'sharepoint\\.com', '(^|\\.)office\\.com', 'office365\\.com', 'microsoft365\\.com'],
  teams_app:          ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'powerva\\.ms', 'copilotstudio', 'teams\\.microsoft', 'outlook\\.office', 'outlook\\.live', 'sharepoint\\.com', '(^|\\.)office\\.com', 'office365\\.com', 'microsoft365\\.com'],
  isv_store:          ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'powerva\\.ms', 'copilotstudio', 'teams\\.microsoft', 'outlook\\.office', 'outlook\\.live', 'sharepoint\\.com', '(^|\\.)office\\.com', 'office365\\.com', 'microsoft365\\.com'],
  teams_chat_agent:   ['teams\\.microsoft'],
  openai_assistant:   ['chatgpt\\.com', 'chat\\.openai\\.com'],
  custom_gpt:         ['chatgpt\\.com', 'chat\\.openai\\.com'],
  claude_ai_project:  ['claude\\.ai'],
  gemini:             ['gemini\\.google', 'aistudio\\.google'],
  gemini_enterprise:  ['gemini\\.google', 'discoveryengine'],
  vertex_ai:          ['console\\.cloud\\.google'],
  azure_foundry:      ['portal\\.azure', 'ai\\.azure'],
});

const _compiled = new Map();
function rx(source) {
  let re = _compiled.get(source);
  if (!re) { re = new RegExp(source); _compiled.set(source, re); }
  return re;
}

/** Is `host` one of the hostnames the given blocked-agent platform is reachable
 *  at in a browser? An UNKNOWN platform yields false, which callers must read as
 *  "no exception can apply to this row" — never as "unblock it". */
export function platformMatchesHost(platform, host) {
  const key = String(platform ?? '').trim().toLowerCase();
  const h = String(host ?? '').trim().toLowerCase();
  if (!key || !h) return false;
  const patterns = PLATFORM_HOST_PATTERNS[key];
  if (!patterns) return false;
  return patterns.some((source) => rx(source).test(h));
}

// Narrow, desktop-derived host set for the M365 agent-scoped platforms — used
// ONLY to decide whether an access exception applies, never to decide whether
// to look for a block. PLATFORM_HOST_PATTERNS above is deliberately wide (a
// block must be looked for everywhere the platform is reachable), but reusing
// that same wide list for exceptions meant an approval granted on ONE host
// (e.g. an admin approving "IT Help Desk Agent" on m365.cloud.microsoft only,
// having explicitly REJECTED it on teams.microsoft.com) silently lifted the
// block on every other host the platform maps to — the admin's "no" on Teams
// became unrepresentable. Mirrors hostsForPlatform() in
// agent/src/os_monitor/ai-processes.js (PLATFORM_PROCS resolved through
// AI_PROCESSES' `host` field: 'Copilot'→copilot.microsoft.com,
// 'M365Copilot'→m365.cloud.microsoft, 'ms-teams'→teams.microsoft.com; Office
// process names carry no host there, by design), so the browser's exception
// blast-radius matches the already-reviewed desktop behaviour instead of the
// wider block-lookup list. teams_app/isv_store have no PLATFORM_PROCS entry
// at all, so — exactly like on desktop — no host can except them yet.
export const PLATFORM_EXCEPTION_HOST_PATTERNS = Object.freeze({
  copilot_studio:      ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'teams\\.microsoft'],
  personal_agent:      ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'teams\\.microsoft'],
  sharepoint_embedded: ['m365\\.cloud\\.microsoft'],
  teams_app:           [],
  isv_store:           [],
  teams_chat_agent:    ['teams\\.microsoft'],
});

/** Same contract as platformMatchesHost(), but for deciding whether an access
 *  exception applies. Narrower for the M365 agent platforms above (see the
 *  comment there); every other platform falls through to the normal wide
 *  check, unchanged from before this function existed. */
export function exceptionHostMatchesPlatform(platform, host) {
  const key = String(platform ?? '').trim().toLowerCase();
  const h = String(host ?? '').trim().toLowerCase();
  if (!key || !h) return false;
  if (Object.prototype.hasOwnProperty.call(PLATFORM_EXCEPTION_HOST_PATTERNS, key)) {
    return PLATFORM_EXCEPTION_HOST_PATTERNS[key].some((source) => rx(source).test(h));
  }
  return platformMatchesHost(key, h);
}

/** Agent display names are admin-typed free text, so they are compared
 *  case-insensitively and trimmed — the same normalisation the server applies in
 *  access-requests.js so both ends agree on what "the same agent" means. */
export function normalizeAgentName(name) {
  return String(name ?? '').trim().toLowerCase();
}

/** Does an agent-scoped exception name the SAME agent as this blocklist row?
 *
 *  Mirrors the server's agentMatches() (server/src/routes/access-requests.js):
 *  ids win when both sides have one, otherwise normalised names, and nothing
 *  else. A row and an exception that share NEITHER an id nor a name do not
 *  match — an agent-scoped grant with no agent identity must never lift
 *  anything, or it becomes a host-wide grant wearing a narrow label. */
export function agentIdentityMatches(row, exception) {
  const rowId = String(row?.agent_id ?? '').trim();
  const excId = String(exception?.agent_id ?? '').trim();
  if (rowId && excId) return rowId === excId;

  const rowName = normalizeAgentName(row?.agent_name);
  const excName = normalizeAgentName(exception?.agent_name);
  if (rowName && excName) return rowName === excName;

  return false;
}

/** Is this blocklist row itself narrowed to one named agent?
 *
 *  `agent_scope` comes straight from GET /api/lifecycle/blocked-agents (see
 *  server/src/governance/agent-scope.ts): 'agent' means the admin blocked one
 *  named agent, and 'platform' / null / absent means the whole app. Only the
 *  first kind may be lifted by an agent-scoped exception. */
export function isAgentScopedRow(row) {
  return String(row?.agent_scope ?? '').trim().toLowerCase() === 'agent';
}

/** Subtract admin-approved access exceptions from GET /api/lifecycle/blocked-agents.
 *
 *  `exceptions` is the GET /api/v1/access-exceptions/mine payload: already
 *  scoped to this machine and already filtered to live, unexpired grants by the
 *  server, so nothing here re-checks expiry (there is no second source of truth
 *  for it).
 *
 *  Two rules, and the asymmetry between them is the whole point:
 *
 *    scope 'host' (or missing, which is every legacy row) — lifts EVERY blocked
 *      row for that host, agent-scoped rows included. "Host wins broadly" is the
 *      same precedence GET /api/v1/access-exceptions/check applies.
 *    scope 'agent' — lifts ONLY rows that are themselves agent-scoped AND name
 *      the same agent. A whole-platform block is never lifted by it, because the
 *      admin who approved "this one bot" did not approve the app.
 *
 *  FAIL CLOSED is the caller's job, not this function's: an empty list
 *  legitimately means "no exceptions", so a caller that could not REACH the
 *  server must skip this call entirely rather than pass []. Same contract as the
 *  desktop enforcer's filterBlockedAgents(). */
export function subtractAccessExceptions(list, exceptions) {
  if (!Array.isArray(list) || list.length === 0) return Array.isArray(list) ? list : [];
  if (!Array.isArray(exceptions) || exceptions.length === 0) return list;

  const hostWide = [];
  const perAgent = [];
  for (const exc of exceptions) {
    if (!exc || !String(exc.tool_host ?? '').trim()) continue;
    if (String(exc.scope ?? '').trim().toLowerCase() === 'agent') perAgent.push(exc);
    else hostWide.push(exc);   // 'host', '', null, absent — all mean the whole app
  }
  if (hostWide.length === 0 && perAgent.length === 0) return list;

  return list.filter((row) => {
    for (const exc of hostWide) {
      if (exceptionHostMatchesPlatform(row?.platform, exc.tool_host)) return false;
    }
    if (isAgentScopedRow(row)) {
      for (const exc of perAgent) {
        if (!exceptionHostMatchesPlatform(row?.platform, exc.tool_host)) continue;
        if (agentIdentityMatches(row, exc)) return false;
      }
    }
    return true;
  });
}
