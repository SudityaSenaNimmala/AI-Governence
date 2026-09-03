// Blocked-agent policy math — the WORKER half.
//
// Imported by background/service-worker.js (an ESM MV3 worker). Everything here
// is PURE: no chrome.*, no DOM, no fetch, no clock. That is what lets `node
// --test` drive the exception-subtraction rule directly instead of asserting on
// source text (see tests/blocked-agent-exceptions.test.mjs).
//
// WHY THE HOST MAP IS DUPLICATED. content/content.js has its own copy of the
// platform → host map as the `PLATFORM_TO_HOSTS` literal mid-IIFE, because
// content scripts are classic scripts and this repo has no bundler — the same
// reason lib/recording.js's header gives for content/replay.js existing. The two
// copies MUST agree: content.js's decides which hosts a blocked agent is even
// looked for on, and this one decides which blocked rows an approved host-scoped
// exception lifts. A platform added to one and not the other either
// under-enforces in the page or refuses to lift an approval in the worker.
// tests/blocked-agent-exceptions.test.mjs asserts they are character-identical,
// so drift fails the build rather than shipping.

// Regex SOURCES rather than literals, so the sync test above can compare them to
// content.js's `/.../` literals character for character.
export const PLATFORM_HOST_PATTERNS = Object.freeze({
  copilot_studio:     ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft', 'powerva\\.ms', 'copilotstudio', 'teams\\.microsoft', 'outlook\\.office', 'outlook\\.live', 'sharepoint\\.com', '(^|\\.)office\\.com', 'office365\\.com', 'microsoft365\\.com'],
  personal_agent:     ['copilot\\.microsoft', 'm365\\.cloud\\.microsoft'],
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
      if (platformMatchesHost(row?.platform, exc.tool_host)) return false;
    }
    if (isAgentScopedRow(row)) {
      for (const exc of perAgent) {
        if (!platformMatchesHost(row?.platform, exc.tool_host)) continue;
        if (agentIdentityMatches(row, exc)) return false;
      }
    }
    return true;
  });
}
