// `blocked_agents.dlp_monitor` — GOVERNED, but NOT blocked.
//
// THE STATE THIS ADDS. A `blocked_agents` row has only ever answered one
// question: is this agent blocked (`blocked: true`) or not. That is the right
// answer for a dedicated AI app, but it leaves Microsoft Teams with no usable
// setting at all:
//
//   * Teams is a HOST APP for ordinary human chat, so the desktop enforcer
//     excludes it from capture wholesale rather than recording every DM;
//   * and when a named agent inside Teams IS blocked, tokenization is
//     deliberately switched off — masking one value does not help when the whole
//     conversation is disallowed, and "Request Access" is the correct remedy.
//
// So the org could either see nothing, or block outright. `dlp_monitor` is the
// missing middle: scan prompts for this named agent and offer "Tokenize & Send"
// when something sensitive is typed, while letting the conversation happen.
//
// INDEPENDENT OF `blocked`, DELIBERATELY. The two flags live on the same row but
// neither implies the other — an agent can be monitored and not blocked (the new
// state), blocked and not monitored (today's behaviour, unchanged), or carry both
// (an admin who blocked something that was previously only monitored). Where both
// are set, BLOCKED WINS: the enforcing surface must never offer to tokenize a
// prompt for an agent it is meant to refuse outright. That precedence is applied
// agent-side, but it is also enforced here at the data level — see
// GOVERNED_AGENTS_FILTER — so the blocked list and the governed list are honestly
// disjoint and no consumer has to remember the rule to be safe.
//
// ABSENCE MEANS FALSE. The field is additive and optional; every row written
// before it existed is unaffected and reads as not-monitored. There is no
// migration, and none is needed.
//
// Kept in its own module rather than inline in the route, for the same reason as
// agent-scope.ts: the filter, the projection and the toggle's write shape are
// then testable without a Mongo connection, and each has exactly one definition.

import { normalizeAgentScope, type AgentScope } from "./agent-scope.js";

// The narrowest possible structural view of the Mongo `Db` handle these helpers
// need, so they can also run against the in-memory fake the tests use.
export interface DbLike {
  collection(name: string): any;
}

// Rows the enforcing surfaces should DLP-monitor. `blocked: { $ne: true }` — not
// `blocked: false` — because a row can be governed-only and have no `blocked`
// field at all; `$ne: true` covers absent, null and false in one clause, and is
// the half of the blocked-wins rule that lives at the data level.
export const GOVERNED_AGENTS_FILTER = { dlp_monitor: true, blocked: { $ne: true } } as const;

// The same identity + ENFORCEMENT fields GET /blocked-agents projects, field for
// field, so a client that already parses that payload can parse this one with the
// same code. agent_scope is included for the reason it is included there: it is
// what tells the enforcer whether this row means one named agent or the whole
// host app, and a row whose scope never reaches the enforcer is a row that
// governs far more than the admin asked for.
//
// `blocked_at` is the one field deliberately NOT carried over: by construction
// every row in this list is not blocked, and a block timestamp left over from an
// earlier, since-lifted block would read as "blocked since then". The monitoring
// timestamp takes its place.
export const GOVERNED_AGENTS_PROJECTION = {
  _id: 0,
  agent_id: 1,
  agent_name: 1,
  platform: 1,
  reason: 1,
  oauth_key_id: 1,
  agent_scope: 1,
  // Returned raw rather than implied by membership of the list, so the agent-side
  // blocked-wins precedence has the actual field to reason about.
  dlp_monitor: 1,
  dlp_monitor_at: 1,
} as const;

// Strict booleans only. An absent or mistyped value is REFUSED rather than
// defaulted, on the same argument as normalizeAgentScope: defaulting a missing
// flag to true would let an empty body silently start monitoring an agent, and
// defaulting it to false would let a typo silently stop monitoring one. The
// caller turns undefined into a 400.
export function normalizeDlpMonitor(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export interface SetDlpMonitorInput {
  agent_id: string;
  dlp_monitor: boolean;
  // Optional identity, used only when this toggle has to CREATE the row — see
  // setDlpMonitor's upsert note.
  agent_name?: string | null;
  platform?: string | null;
  reason?: string | null;
  oauth_key_id?: string | null;
  agent_scope?: AgentScope | null;
}

/**
 * Turn `dlp_monitor` on or off for one agent, touching nothing else on the row.
 *
 * UPSERT ON THE WAY ON, never on the way off — mirroring POST /block and
 * POST /unblock exactly:
 *
 *   * enabling upserts, because an agent an admin wants monitored has usually
 *     only ever been seen in `discovered_agents` and has no `blocked_agents` row
 *     yet. Requiring it to be blocked first to become monitored would make the
 *     governed-not-blocked state unreachable, which is the whole point of it.
 *   * disabling only ever relaxes an EXISTING row. Creating a row to record that
 *     an agent is not monitored would fill the collection with rows asserting
 *     nothing.
 *
 * `blocked` is never in the $set, so toggling monitoring cannot change whether an
 * agent is blocked. It appears in $setOnInsert only, so a row this toggle brings
 * into existence starts out explicitly not-blocked rather than merely missing the
 * field. The reverse direction holds without any change here: POST /block,
 * POST /unblock and registry.js's mirror all write fixed field lists that do not
 * mention dlp_monitor, so a block or an unblock leaves monitoring exactly as it
 * was.
 */
export async function setDlpMonitor(db: DbLike, input: SetDlpMonitorInput) {
  const { agent_id, dlp_monitor } = input;
  const now = new Date();

  if (!dlp_monitor) {
    const res = await db.collection("blocked_agents").updateOne(
      { agent_id },
      { $set: { dlp_monitor: false, dlp_monitor_off_at: now } },
    );
    return { matched: res.matchedCount ?? 0, created: false };
  }

  // Only the fields the caller actually supplied go in $set. Writing the full
  // row the way POST /block does would blank agent_name / platform / agent_scope
  // on an existing row whenever the toggle was called without them — this is a
  // narrow toggle, and it must not quietly rewrite identity it was not given.
  const set: Record<string, unknown> = {
    agent_id,
    dlp_monitor: true,
    dlp_monitor_at: now,
    dlp_monitor_off_at: null,
  };
  const setOnInsert: Record<string, unknown> = { blocked: false };

  for (const field of ["agent_name", "platform", "reason", "oauth_key_id", "agent_scope"] as const) {
    const value = input[field];
    if (value === undefined) setOnInsert[field] = null;
    else set[field] = value === "" ? null : value;
  }

  const res = await db.collection("blocked_agents").updateOne(
    { agent_id },
    { $set: set, $setOnInsert: setOnInsert },
    { upsert: true },
  );
  return { matched: res.matchedCount ?? 0, created: (res.upsertedCount ?? 0) > 0 };
}

/**
 * The agents to DLP-monitor. Shaped like GET /blocked-agents' payload, including
 * its `orphaned` marker: a governed agent whose row no longer appears in any scan
 * is FLAGGED, never dropped, because silently removing it would lift a governance
 * decision an admin deliberately made.
 */
export async function listGovernedAgents(db: DbLike) {
  const list = await db.collection("blocked_agents")
    .find(GOVERNED_AGENTS_FILTER)
    .project(GOVERNED_AGENTS_PROJECTION)
    .toArray();

  const ids = list.map((a: any) => a.agent_id).filter(Boolean);
  const known = new Set<string>();
  if (ids.length > 0) {
    const rows = await db.collection("discovered_agents")
      .find({ $or: [{ id: { $in: ids } }, { agent_key: { $in: ids } }] })
      .project({ _id: 0, id: 1, agent_key: 1 })
      .toArray();
    for (const r of rows) {
      if (r.id) known.add(String(r.id));
      if (r.agent_key) known.add(String(r.agent_key));
    }
  }

  return list.map((a: any) => ({ ...a, orphaned: !known.has(String(a.agent_id)) }));
}

// Re-exported so a caller validating a dlp-monitor request has one import, and so
// the scope enum keeps its single definition.
export { normalizeAgentScope };
