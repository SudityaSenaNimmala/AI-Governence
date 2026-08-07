// Conversations — read API over the AI site's OWN chat threads.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// A `session` is an ENGAGEMENT: one continuous stretch of using one AI service
// in one browser tab. It deliberately survives chat switches, so one session can
// span "What is CloudFuze?" in chat A, "What is AI Governance?" in chat B and
// "What is Data Governance?" back in chat A. That is the right unit for "how
// much is this person using AI", and the wrong unit for "show me this
// conversation": a session view interleaves three chats into one transcript.
//
// This file groups the same stored data the other way — by the conversation id
// the AI SITE minted (ChatGPT /c/<id>, Claude /chat/<uuid>, …), which the
// browser extension now stamps on every event and on every replay run.
//
// ── THE GROUPING KEY IS TWO-PART: (machine_id, external_conv_id) ─────────────
// NOT three. `ai_service` is deliberately excluded, because the two collections
// spell it in DIFFERENT namespaces: session_recordings.ai_service is the
// engagement's canonical service_key ('openai'), while dlp_events.ai_service is
// a display label inferred on the client ('ChatGPT'). A three-part key would
// therefore fail to match a recording to its own messages. Both views are
// reported side by side instead of being conflated.
//
// machine_id IS part of the key: the conversation id is minted by the AI site,
// not by us, so two machines can legitimately hold the same id (a shared chat
// link). Merging those would attribute one person's turns to another.
//
// ── CONTENT DISCIPLINE ───────────────────────────────────────────────────────
// Same rule as routes/sessions.js: no prompt or response body is ever returned
// here. A message row says whether a body was captured (`has_content`) and the
// event id to fetch it with; the body itself is served only by the existing
// GET /api/v1/dlp/:id/content.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────
// requireAdminAuth on both routes — the same check that already guards
// GET /api/v1/replays/:replay_id. This view is the entry point to session
// replay, so it gets replay's auth posture, not the deliberately-open posture of
// GET /api/v1/sessions.

import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import { normalizeExternalConvId, severityRank, NO_SEVERITY_RANK } from './dlp.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// How many session documents the list route will look at. The grouping is done
// in memory ON PURPOSE rather than as an aggregation pipeline: the pipeline
// would need $unwind + $group + $lookup, which the in-memory test double does
// not implement, and this cap keeps the in-memory pass trivially cheap.
const MAX_SCANNED_SESSIONS = 500;

// …and how many recording runs the same route will look at when it decorates
// those groups. A page can carry up to MAX_SCANNED_SESSIONS conversations and a
// single conversation can hold many runs, so the session cap is far too tight to
// reuse here — one run per conversation would be all it bought. 2000 is the same
// order of magnitude as MAX_MESSAGES, this file's other large bounded scan, and
// leaves a realistic page's runs whole. The scan is newest-first so that a page
// that DOES hit the cap loses the oldest runs, never the one still recording.
const MAX_SCANNED_RUNS = 2000;

// Same per-conversation caps the session detail route uses, so the two routes
// truncate identically and a UI can share one "…and more" affordance.
const MAX_MESSAGES = 2000;
const MAX_REPLAYS = 50;
const MAX_SESSIONS_PER_CONVERSATION = 50;

// ── The opaque conversation key ──────────────────────────────────────────────
// A conversation is addressed by a two-part key, so it needs one URL-safe
// token. base64url of a tiny versioned JSON object.
//
// TREAT THE DECODER AS A SECURITY BOUNDARY, not as a convenience. It is the only
// thing standing between a URL segment and a Mongo filter, so it validates the
// SHAPE and the TYPE of every field and the route then builds the filter from
// those validated values one field at a time. The decoded object is never
// spread into a query — that is what stops `{"m":{"$ne":null}}` from becoming a
// query operator. Every failure is a 400; none is ever a 500.
const MAX_KEY_LEN = 1024;
const KEY_CHARSET = /^[A-Za-z0-9_-]+$/;
const MAX_MACHINE_ID_LEN = 200;
const MAX_EXTERNAL_CONV_ID_LEN = 200;
const KEY_VERSION = 1;

export function encodeConversationKey(machineId, externalConvId) {
  if (typeof machineId !== 'string' || !machineId) return null;
  if (typeof externalConvId !== 'string' || !externalConvId) return null;
  const json = JSON.stringify({ v: KEY_VERSION, m: machineId, c: externalConvId });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** { machineId, externalConvId } or null. NEVER throws, never returns anything
 * that has not been proved to be a bounded, non-empty string. */
export function decodeConversationKey(raw) {
  if (typeof raw !== 'string') return null;
  // Bound the input before decoding it — a megabyte of base64 must not be
  // parsed just to be rejected.
  if (!raw || raw.length > MAX_KEY_LEN) return null;
  if (!KEY_CHARSET.test(raw)) return null;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // An array is an object in JS; a JSON scalar is not what we encoded either.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.v !== KEY_VERSION) return null;

  // Strict string checks, before any trimming: an object, an array or a number
  // here is either a client bug or an injection attempt, and both are 400s.
  if (typeof parsed.m !== 'string' || typeof parsed.c !== 'string') return null;
  const machineId = parsed.m.trim();
  const externalConvId = parsed.c.trim();
  if (!machineId || machineId.length > MAX_MACHINE_ID_LEN) return null;
  if (!externalConvId || externalConvId.length > MAX_EXTERNAL_CONV_ID_LEN) return null;

  return { machineId, externalConvId };
}

export function mountConversations(app, db) {
  // ── List conversations ────────────────────────────────────────────────────
  // Query parameters mirror GET /api/v1/sessions exactly (machine_id,
  // ai_service, from, to, limit) so a dashboard can swap one for the other.
  app.get('/api/v1/conversations', requireAdminAuth, a(async (req, res) => {
    const { machine_id, ai_service, from, to } = req.query;

    const filter = {};
    if (machine_id) filter.machine_id = String(machine_id);
    if (ai_service) filter.ai_service = String(ai_service);

    const range = {};
    if (from) {
      const d = parseDate(from);
      if (!d) return res.status(400).json({ error: 'invalid `from` date' });
      range.$gte = d;
    }
    if (to) {
      const d = parseDate(to);
      if (!d) return res.status(400).json({ error: 'invalid `to` date' });
      range.$lte = d;
    }
    if (Object.keys(range).length) filter.started_at = range;

    // Bounded scan, newest activity first, so a truncated scan drops the OLDEST
    // sessions rather than an arbitrary slice.
    const sessions = await db.collection('ai_sessions')
      .find(filter)
      .sort({ last_activity_at: -1 })
      .limit(MAX_SCANNED_SESSIONS)
      .project({ _id: 0 })
      .toArray();

    const groups = groupSessions(sessions);

    // One lookup for every conversation on the page, rather than one per row —
    // and, like every other scan in this file, a BOUNDED and machine-scoped one.
    //
    // attachRunStats() keys a run by (machine_id, external_conv_id), so a row
    // belonging to some other machine was only ever fetched to be thrown away:
    // the conversation id is minted by the AI site, so a shared chat link really
    // does put the same id on several machines. Scoping the query by the machines
    // actually on this page is the same two-part key the rest of the file uses.
    // The `capture` filter is the one attachRunStats applies anyway, moved into
    // the query so the retired 'tab_video' tombstones cannot eat the scan budget.
    const convIds = [...new Set(groups.map((g) => g.external_conv_id).filter(Boolean))];
    const machineIds = [...new Set(groups.map((g) => g.machine_id).filter(Boolean))];
    const runs = convIds.length && machineIds.length
      ? await db.collection('session_recordings')
        .find({
          machine_id: { $in: machineIds },
          external_conv_id: { $in: convIds },
          capture: 'dom_events',
        })
        .sort({ started_at: -1 })
        .limit(MAX_SCANNED_RUNS)
        .project({ _id: 0, recording_id: 1, machine_id: 1, external_conv_id: 1, status: 1, capture: 1 })
        .toArray()
      : [];
    attachRunStats(groups, runs);

    // A just-used conversation sorts to the top for free: the group's
    // last_activity_at is the MAX over its sessions, so any activity in any of
    // them lifts the whole conversation. No special-casing needed.
    groups.sort((x, y) => dateMs(y.last_activity_at) - dateMs(x.last_activity_at));

    res.json(groups.slice(0, clampLimit(req.query.limit)));
  }));

  // ── One conversation: its turns, its visits and its replays ───────────────
  app.get('/api/v1/conversations/:key', requireAdminAuth, a(async (req, res) => {
    const decoded = decodeConversationKey(req.params.key);
    // Malformed is a 400 — "I cannot read this" — and is never allowed to become
    // a 500 or, worse, a query.
    if (!decoded) return res.status(400).json({ error: 'invalid conversation key' });
    const { machineId, externalConvId } = decoded;

    // Direct, indexed lookups. Each filter is built HERE from the two validated
    // strings; nothing decoded is ever spread into one.
    //
    // NONE of the COUNTS are measured off the pages below, and that is the fix
    // for a set of quiet lies: the replay page is capped at MAX_REPLAYS, so its
    // length reported the DISPLAYED count rather than the true total — and
    // because that page is ordered oldest-first, a run that is still recording
    // is precisely the one a cap drops, which silently turned `is_live` off for
    // exactly the busiest conversations. The visits and the turns had the same
    // problem: a conversation with more than MAX_SESSIONS_PER_CONVERSATION
    // sittings, or more than MAX_MESSAGES turns, under-reported both while the
    // exact `replay_count` sat next to them in the same object.
    //
    // Every one of these is a bounded count on a filter shape this file already
    // queries, so they ride the same indexes and the same round trip. The pages
    // themselves stay capped — that is display, and it is honest as long as the
    // `*_truncated` flags and the `*_total` counters say so.
    const messageFilter = { machine_id: machineId, external_conv_id: externalConvId };
    const visitFilter = { machine_id: machineId, external_conv_ids: externalConvId };
    const replayFilter = { ...messageFilter, capture: 'dom_events' };
    const [
      messageRows, replayRows, visitRows,
      replayTotal, liveTotal, visitTotal, messageTotal, userTotal, assistantTotal,
    ] = await Promise.all([
      db.collection('dlp_events')
        .find(messageFilter)
        // Both fields are already scoped to ONE conversation, so plain
        // (occurred_at, client_seq) ordering is enough — there is no
        // cross-session client_seq collision left to work around.
        .sort({ occurred_at: 1, client_seq: 1 })
        .limit(MAX_MESSAGES + 1)
        .project({ _id: 0 })
        .toArray(),
      db.collection('session_recordings')
        .find(replayFilter)
        .sort({ started_at: 1 })
        .limit(MAX_REPLAYS + 1)
        .project({
          _id: 0, recording_id: 1, capture: 1, started_at: 1, duration_ms: 1,
          status: 1, event_count: 1, chunk_count: 1,
        })
        .toArray(),
      db.collection('ai_sessions')
        .find(visitFilter)
        .sort({ started_at: 1 })
        // +1, like the two pages above: without it the page can never be one
        // longer than the cap, so `sessions_truncated` could never become true
        // and a conversation with more visits than the cap silently claimed to
        // have exactly the cap and no more.
        .limit(MAX_SESSIONS_PER_CONVERSATION + 1)
        .project({ _id: 0 })
        .toArray(),
      db.collection('session_recordings').countDocuments(replayFilter),
      db.collection('session_recordings').countDocuments({ ...replayFilter, status: 'recording' }),
      db.collection('ai_sessions').countDocuments(visitFilter),
      // The EXACT turn counts of this one conversation. `role` is derived on the
      // server from the event kind (routes/dlp.js), never taken from the client,
      // and it is an extra predicate on the same {machine_id, external_conv_id,
      // occurred_at} index prefix. Turns with no role — the enforcement records —
      // are counted in the total and in neither side, which is what the messages
      // page shows too.
      db.collection('dlp_events').countDocuments(messageFilter),
      db.collection('dlp_events').countDocuments({ ...messageFilter, role: 'user' }),
      db.collection('dlp_events').countDocuments({ ...messageFilter, role: 'assistant' }),
    ]);

    // A key that decodes cleanly but names nothing is a 404, not a 400: the
    // request was well formed, the conversation just is not here (or has aged
    // out of retention).
    if (!messageRows.length && !replayRows.length && !visitRows.length) {
      return res.status(404).json({ error: 'conversation not found' });
    }

    const messagesTruncated = messageRows.length > MAX_MESSAGES;
    if (messagesTruncated) messageRows.length = MAX_MESSAGES;
    const replaysTruncated = replayRows.length > MAX_REPLAYS;
    if (replaysTruncated) replayRows.length = MAX_REPLAYS;
    const visitsTruncated = visitRows.length > MAX_SESSIONS_PER_CONVERSATION;
    if (visitsTruncated) visitRows.length = MAX_SESSIONS_PER_CONVERSATION;

    // Same bulk "does this turn have a captured body" lookup the session detail
    // route does, rather than one query per message.
    //
    // Riding alongside it, and ONLY when it is needed: the sessions a
    // never-bound conversation's turns came from. summarizeFromMessages() counts
    // those off the message page, so its session_count has the same cap problem,
    // and there is no visit row to count instead — the events are the only place
    // that grouping exists. distinct() over one conversation on the same index
    // answers it exactly. A conversation that DOES have visits pays nothing.
    const [contentDocs, orphanSessionIds] = await Promise.all([
      db.collection('dlp_content')
        .find({ event_id: { $in: messageRows.map((r) => r.id) } })
        .project({ _id: 0, event_id: 1 })
        .toArray(),
      visitRows.length ? [] : db.collection('dlp_events').distinct('session_id', messageFilter),
    ]);
    const hasContentSet = new Set(contentDocs.map((c) => c.event_id));

    // The summary is built the same way the list row is, from the visits, so
    // the two agree. A conversation whose events were never bound to a session
    // (no session_bind ever landed) still gets a summary — derived from its own
    // messages — rather than a null one.
    const summary = visitRows.length
      ? summarize(machineId, externalConvId, visitRows)
      : summarizeFromMessages(machineId, externalConvId, messageRows);
    // The true totals, not the page lengths — see the note on the lookups above.
    summary.replay_count = replayTotal;
    summary.is_live = liveTotal > 0;
    // summarize() derives this from the visits it was handed, which is right for
    // a list row built from a full group and wrong here, where the page itself
    // was capped before it ever reached that function.
    if (visitsTruncated) summary.sessions_truncated = true;

    // ── The counters that are neither page-scoped nor an upper bound ──────────
    // The existing session_count / message_count / *_message_count keep their
    // meaning ON PURPOSE: they are what the LIST row reports, so the two views
    // still agree field for field, and the list cannot afford an events query per
    // row (see groupSessions' COUNTER HONESTY note). They are therefore both
    // page-scoped AND, for a session that spanned several chats, an upper bound.
    //
    // These are the honest answers, and they exist only on the detail route
    // because it is the only one that can afford them. `*_total` is the same
    // naming spirit as `sessions_truncated` / `messages_truncated`: a field whose
    // name says what its neighbour is not.
    summary.session_count_total = visitRows.length
      ? visitTotal
      : orphanSessionIds.filter(Boolean).length;
    summary.message_count_total = messageTotal;
    summary.user_message_count_total = userTotal;
    summary.assistant_message_count_total = assistantTotal;

    res.json({
      conversation: summary,
      // Every stretch of engagement that touched this conversation, oldest
      // first. This is what makes "the user came back to this chat three times"
      // visible without interleaving three chats into one transcript.
      visits: visitRows.map((s) => ({
        session_id: s.session_id,
        started_at: s.started_at ?? null,
        last_activity_at: s.last_activity_at ?? null,
        message_count: s.message_count ?? 0,
        highest_severity: s.highest_severity ?? null,
        // The OTHER conversations this same visit touched — useful context, and
        // the reason a visit's message_count is not this conversation's.
        external_conv_ids: s.external_conv_ids ?? [],
      })),
      messages: messageRows.map((r) => publicMessage(r, hasContentSet)),
      messages_truncated: messagesTruncated,
      replays: replayRows.map((r) => ({
        // `replay_id` on the wire, `recording_id` in storage — see routes/replays.js.
        replay_id: r.recording_id,
        capture: r.capture ?? null,
        started_at: r.started_at ?? null,
        duration_ms: r.duration_ms ?? null,
        status: r.status,
        event_count: r.event_count ?? 0,
        chunk_count: r.chunk_count ?? 0,
      })),
      replays_truncated: replaysTruncated,
    });
  }));
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Fold a bounded page of sessions into conversation groups.
 *
 * A session that touched three chats contributes to three groups; a session
 * that touched none becomes a standalone group of one, with the same shape and
 * a null key, so nothing downstream has to branch on "ungrouped".
 *
 * COUNTER HONESTY: message_count / user_message_count / assistant_message_count
 * are SUMS OF PER-SESSION counters, so a session spanning several chats counts
 * its whole total into each of them. They are an upper bound for a mixed
 * session, not an exact per-conversation count — the exact per-conversation
 * turns come from the detail route, which reads dlp_events directly. Making the
 * list exact would mean an events scan per row, which is the cost this bounded
 * summary exists to avoid.
 */
function groupSessions(sessions) {
  const byKey = new Map();

  for (const s of sessions) {
    const machineId = s.machine_id ?? null;
    const convIds = Array.isArray(s.external_conv_ids)
      ? s.external_conv_ids.map(normalizeExternalConvId).filter(Boolean)
      : [];
    // No conversation id extractable (a site we have no URL pattern for, a chat
    // that never got an id, or a session stored before conversation stamping
    // shipped) → its own group of one.
    const targets = convIds.length ? convIds : [null];

    for (const convId of targets) {
      // machineId is part of the key so the same site-minted id on two machines
      // can never merge.
      const key = `${machineId ?? ''}\u0000${convId ?? `session:${s.session_id}`}`;
      if (!byKey.has(key)) byKey.set(key, { machineId, convId, sessions: [] });
      byKey.get(key).sessions.push(s);
    }
  }

  return [...byKey.values()].map((g) => summarize(g.machineId, g.convId, g.sessions));
}

/** One conversation row, from the sessions that touched it. */
function summarize(machineId, externalConvId, sessions) {
  const ordered = [...sessions].sort((x, y) => dateMs(x.started_at) - dateMs(y.started_at));
  const newest = ordered.reduce(
    (best, s) => (best === null || dateMs(s.last_activity_at) >= dateMs(best.last_activity_at) ? s : best),
    null,
  );

  let rank = NO_SEVERITY_RANK;
  let severity = null;
  for (const s of ordered) {
    // Prefer the watermark ingest already computed; fall back to ranking the
    // stored label for sessions written before the rank field existed. Same
    // scale either way — the one in routes/dlp.js.
    const r = Number.isFinite(s.highest_severity_rank)
      ? s.highest_severity_rank
      : severityRank(s.highest_severity);
    if (r > rank) {
      rank = r;
      severity = s.highest_severity ?? null;
    }
  }

  const sessionIds = ordered.map((s) => s.session_id);

  return {
    // Null for a conversation with no site-minted id: there is nothing stable to
    // address it by, so it has no detail page and the caller opens its single
    // session instead. Never a fabricated key — a key that decodes to a filter
    // matching every id-less event of a machine would merge unrelated chats.
    conversation_key: externalConvId ? encodeConversationKey(machineId, externalConvId) : null,
    external_conv_id: externalConvId ?? null,
    machine_id: machineId ?? null,
    // From ai_sessions, which spells services as the client's display label.
    // A replay run of the same conversation carries the engagement's canonical
    // service_key instead; both are reported as-is rather than reconciled.
    ai_service: newest?.ai_service ?? null,
    started_at: ordered[0]?.started_at ?? null,
    last_activity_at: newest?.last_activity_at ?? null,
    message_count: sum(ordered, 'message_count'),
    user_message_count: sum(ordered, 'user_message_count'),
    assistant_message_count: sum(ordered, 'assistant_message_count'),
    highest_severity: severity,
    highest_severity_rank: rank,
    session_count: ordered.length,
    session_ids: sessionIds.slice(0, MAX_SESSIONS_PER_CONVERSATION),
    sessions_truncated: sessionIds.length > MAX_SESSIONS_PER_CONVERSATION,
    // Filled in by attachRunStats / the detail route.
    replay_count: 0,
    is_live: false,
  };
}

/** The same row, derived from the turns themselves — for a conversation whose
 * events carry an id that no session ever bound. */
function summarizeFromMessages(machineId, externalConvId, messages) {
  let rank = NO_SEVERITY_RANK;
  let severity = null;
  let user = 0;
  let assistant = 0;
  const sessionIds = [];
  for (const m of messages) {
    const r = severityRank(m.secret_class);
    if (r > rank) { rank = r; severity = m.secret_class ?? null; }
    if (m.role === 'user') user += 1;
    else if (m.role === 'assistant') assistant += 1;
    if (m.session_id && !sessionIds.includes(m.session_id)) sessionIds.push(m.session_id);
  }
  const times = messages.map((m) => dateMs(m.occurred_at)).filter((n) => Number.isFinite(n));
  return {
    conversation_key: encodeConversationKey(machineId, externalConvId),
    external_conv_id: externalConvId,
    machine_id: machineId,
    ai_service: messages[0]?.ai_service ?? null,
    started_at: times.length ? new Date(Math.min(...times)).toISOString() : null,
    last_activity_at: times.length ? new Date(Math.max(...times)).toISOString() : null,
    message_count: messages.length,
    user_message_count: user,
    assistant_message_count: assistant,
    highest_severity: severity,
    highest_severity_rank: rank,
    session_count: sessionIds.length,
    session_ids: sessionIds.slice(0, MAX_SESSIONS_PER_CONVERSATION),
    sessions_truncated: sessionIds.length > MAX_SESSIONS_PER_CONVERSATION,
    replay_count: 0,
    is_live: false,
  };
}

/** Attach "how many recordings, and is one running right now" per group. */
function attachRunStats(groups, runs) {
  const stats = new Map();
  for (const r of runs) {
    if (r.capture !== 'dom_events') continue;
    const key = `${r.machine_id ?? ''}\u0000${r.external_conv_id ?? ''}`;
    if (!stats.has(key)) stats.set(key, { count: 0, live: false });
    const s = stats.get(key);
    s.count += 1;
    if (r.status === 'recording') s.live = true;
  }
  for (const g of groups) {
    if (!g.external_conv_id) continue;
    const s = stats.get(`${g.machine_id ?? ''}\u0000${g.external_conv_id}`);
    if (!s) continue;
    g.replay_count = s.count;
    g.is_live = s.live;
  }
}

// ── Shaping ──────────────────────────────────────────────────────────────────

// Byte-for-byte the per-message shape GET /api/v1/sessions/:session_id returns,
// so a UI can render either route's transcript with one component. Kept as its
// own function here rather than imported, because sessions.js builds it inline;
// if that shape changes, both must change together.
function publicMessage(r, hasContentSet) {
  const meta = safeJson(r.metadata_json);
  return {
    // Fetch the body with GET /api/v1/dlp/<id>/content when has_content.
    id: r.id,
    client_seq: r.client_seq ?? null,
    event_kind: r.event_kind,
    role: r.role ?? null,
    occurred_at: r.occurred_at,
    received_at: r.received_at,
    ai_service: r.ai_service,
    content_length: r.content_length ?? null,
    highest_severity: r.secret_class ?? meta?.highest_severity ?? null,
    matches: meta?.matches ?? [],
    metadata: meta,
    has_content: hasContentSet.has(r.id),
  };
}

function sum(rows, field) {
  return rows.reduce((t, r) => t + (Number(r[field]) || 0), 0);
}

function dateMs(value) {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function parseDate(value) {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}
