// `blocked_agents.platform` — the field without which a block enforces NOTHING.
//
// THE BUG THIS EXISTS TO FIX. Both write paths stored `platform: platform || null`
// straight from the request body, and the dashboard's PUT does not send one. A row
// with platform:null is INERT on both enforcement surfaces:
//
//   * the desktop enforcer keys PLATFORM_PROCS on it and drops a row with an empty
//     platform at parse time (blocked-agents-sync.js / enforcer-win.ps1), and
//   * the browser extension cannot map a null platform to any host, so
//     isBlockedAgentActive() never matches.
//
// So the row looked blocked in AI Systems and stopped the agent nowhere.
//
// The fix is server-side and has two halves, both of them here so the two write
// paths (PUT /api/v1/registry/:id/status and POST /api/lifecycle/block) cannot
// drift apart:
//
//   1. DERIVE the platform from `discovered_agents` when the caller omits it —
//      the same document the caller's own request already matched.
//   2. When it genuinely cannot be derived, SAY SO. The row is still written,
//      because refusing the write (or deleting the row later) would silently lift
//      a block an admin deliberately applied — the wrong failure mode in a
//      governance product. What changes is that the response stops claiming
//      `enforced: true`, and the read path marks the row `unenforceable` so the
//      gap is visible instead of silent.

/** Trims to a usable platform key, or null. '' and '   ' are as absent as undefined. */
export function normalizePlatform(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s.length > 0 ? s : null;
}

/**
 * The platform recorded on the `discovered_agents` document this request matches.
 *
 * Takes the filter rather than an id: each write path already has the filter it
 * uses to identify the agent (the registry route's `$or` over id/botId/appId/name,
 * lifecycle's over id/agent_key), and deriving from a DIFFERENT filter than the
 * one the caller matched is how the two paths would start disagreeing about which
 * agent they are talking about.
 *
 * Returns null — never throws and never guesses — when nothing matches or the
 * matched document has no platform of its own.
 */
export async function derivePlatform(db, filter) {
  const doc = await db.collection('discovered_agents').findOne(filter);
  return normalizePlatform(doc?.platform);
}

/**
 * True when a `blocked_agents` row cannot be enforced on either surface because
 * it has no platform.
 *
 * @deprecated SUPERSEDED by `unenforceableReason` in ./agent-platforms.js, which
 * answers this same question and two more ("a platform is set but no surface
 * knows it", "the platform names a product, not a per-agent-matchable value").
 * Zero production callers remain — both routes that used it now call
 * `unenforceableReason`. Retained only as the ANCHOR for the superset assertion
 * in ../../tests/agent-platforms.test.mjs: every row this predicate flagged must
 * still be flagged by the wider one, with the reason it always had. Delete it
 * together with that assertion, not before.
 */
export function isUnenforceableBlock(row) {
  return normalizePlatform(row?.platform) === null;
}
