// Session Replay — read API (phase 2).
//
// Three read routes over the two collections phase 1 established:
//   ai_sessions   one summary doc per conversation (identity + counters)
//   dlp_events    the individual turns, ordered by client_seq inside a session
//
// Content discipline: this file never returns prompt or response bodies. The
// detail route reports WHICH turns have a captured body (`has_content`) and the
// event id to fetch it with; the body itself is served only by the existing
// GET /api/v1/dlp/:id/content route. That keeps one code path for content
// egress instead of two.
//
// Auth: intentionally none, matching the sibling read routes in dlp.js
// (GET /api/v1/dlp, GET /api/v1/dlp/:id/content). The unauthenticated read-path
// problem is real but tracked separately; fixing it here alone would leave the
// dashboard half-broken and the rest of the read path just as open.

import { a } from '../util.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

// A single conversation should not be able to blow up a response. Long chats get
// their first N turns plus a truncation flag so the UI can say so out loud.
const MAX_MESSAGES = 2000;

// Replays attached to one conversation. A capture run produces one document, so a
// busy day in one tab is a handful of these, not thousands.
const MAX_REPLAYS = 50;

// Severities that make a session interesting to an admin. Same pair
// GET /api/v1/dlp/summary already treats as noteworthy.
const ALERT_SEVERITIES = ['high', 'critical'];

export function mountSessions(app, db) {
  // ── Dashboard header aggregate ─────────────────────────────────────────────
  // Registered before /:session_id purely for readability — Express would not
  // confuse a 3-segment path with a 2-segment one anyway.
  app.get('/api/v1/sessions/stats/summary', a(async (req, res) => {
    const sessions = db.collection('ai_sessions');

    const [totalSessions, totals, machines, alerting] = await Promise.all([
      sessions.countDocuments(),

      // message_count is already maintained per session on ingest, so the
      // cross-session total is a sum of counters rather than a scan of events.
      sessions.aggregate([
        {
          $group: {
            _id: null,
            total_messages: { $sum: '$message_count' },
            total_user_messages: { $sum: '$user_message_count' },
            total_assistant_messages: { $sum: '$assistant_message_count' },
          },
        },
        { $project: { _id: 0, total_messages: 1, total_user_messages: 1, total_assistant_messages: 1 } },
      ]).toArray(),

      sessions.aggregate([
        { $group: { _id: '$machine_id' } },
        { $count: 'distinct_machines' },
      ]).toArray(),

      // "Sessions whose worst turn was high or critical" — the same answer as a
      // max-severity-per-session rollup, but reachable straight off the
      // {session_id, ...} index instead of grouping every event in the
      // collection: match the noteworthy turns first, then count the distinct
      // sessions left. Reads secret_class (the server-derived severity), so a
      // client-only `metadata.highest_severity` on an enforcement event does not
      // count here.
      db.collection('dlp_events').aggregate([
        { $match: { session_id: { $ne: null }, secret_class: { $in: ALERT_SEVERITIES } } },
        { $group: { _id: '$session_id' } },
        { $count: 'sessions' },
      ]).toArray(),
    ]);

    res.json({
      total_sessions: totalSessions,
      total_messages: totals[0]?.total_messages ?? 0,
      total_user_messages: totals[0]?.total_user_messages ?? 0,
      total_assistant_messages: totals[0]?.total_assistant_messages ?? 0,
      sessions_with_high_severity: alerting[0]?.sessions ?? 0,
      distinct_machines: machines[0]?.distinct_machines ?? 0,
    });
  }));

  // ── List sessions — metadata only, no message content ─────────────────────
  app.get('/api/v1/sessions', a(async (req, res) => {
    const { machine_id, ai_service, from, to } = req.query;

    const filter = {};
    if (machine_id) filter.machine_id = String(machine_id);
    if (ai_service) filter.ai_service = String(ai_service);

    // Date window on started_at, which ingest writes as a real Date.
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

    // Whole doc minus _id, so counters added by later phases show up here
    // without this route needing to know their names.
    const rows = await db.collection('ai_sessions')
      .find(filter)
      .sort({ last_activity_at: -1 })
      .limit(clampLimit(req.query.limit))
      .project({ _id: 0 })
      .toArray();

    res.json(rows);
  }));

  // ── One session + its ordered turns ───────────────────────────────────────
  app.get('/api/v1/sessions/:session_id', a(async (req, res) => {
    const sessionId = req.params.session_id;

    const session = await db.collection('ai_sessions').findOne(
      { session_id: sessionId },
      { projection: { _id: 0 } },
    );
    if (!session) return res.status(404).json({ error: 'session not found' });

    // client_seq is the ordering truth (the client clock is not trusted for
    // ordering); occurred_at breaks ties and keeps pre-phase-1 events, which
    // have a null client_seq, in a stable order.
    const rows = await db.collection('dlp_events')
      .find({ session_id: sessionId })
      .sort({ client_seq: 1, occurred_at: 1 })
      .limit(MAX_MESSAGES + 1)
      .project({ _id: 0 })
      .toArray();

    const truncated = rows.length > MAX_MESSAGES;
    if (truncated) rows.length = MAX_MESSAGES;

    // One bulk lookup for "does this turn have a captured body", same shape as
    // GET /api/v1/dlp uses, rather than a query per message.
    const contentDocs = await db.collection('dlp_content')
      .find({ event_id: { $in: rows.map((r) => r.id) } })
      .project({ _id: 0, event_id: 1 })
      .toArray();
    const hasContentSet = new Set(contentDocs.map((c) => c.event_id));

    // Replays covering this conversation (Session Replay). Metadata only: no event
    // payloads. The events are served solely by the admin-authenticated
    // GET /api/v1/replays/:replay_id/events, so this route does not widen access to
    // them — it only says a replay exists.
    //
    // No `capture` filter on purpose: this returns both current rrweb DOM runs and
    // the retired video phase's tombstones, and `capture` in the projection tells
    // them apart ('dom_events' is playable, 'tab_video' is a tombstone whose bytes
    // are gone). A run can span several conversations, hence the array containment
    // match on session_ids (served by the {session_ids:1, started_at:1} multikey
    // index).
    const replays = await db.collection('session_recordings')
      .find({ session_ids: sessionId })
      .sort({ started_at: 1 })
      .limit(MAX_REPLAYS)
      .project({
        _id: 0, recording_id: 1, capture: 1, started_at: 1, duration_ms: 1,
        status: 1, event_count: 1, chunk_count: 1,
      })
      .toArray();

    res.json({
      session,
      messages: rows.map((r) => {
        const meta = safeJson(r.metadata_json);
        return {
          // Fetch the body with GET /api/v1/dlp/<id>/content when has_content.
          id: r.id,
          client_seq: r.client_seq ?? null,
          event_kind: r.event_kind,
          // 'user' | 'assistant' | 'system', derived server-side on ingest.
          // Absent on events stored before phase 3 shipped.
          role: r.role ?? null,
          occurred_at: r.occurred_at,
          received_at: r.received_at,
          ai_service: r.ai_service,
          content_length: r.content_length ?? null,
          // secret_class is the server-derived severity; fall back to the
          // client's own highest_severity for kinds that carry no matches
          // (enforcement_* events report a severity without a match list).
          highest_severity: r.secret_class ?? meta?.highest_severity ?? null,
          matches: meta?.matches ?? [],
          metadata: meta,
          has_content: hasContentSet.has(r.id),
        };
      }),
      messages_truncated: truncated,
      // Mapped explicitly rather than passed through, so a field added to
      // session_recordings later cannot leak out of this route by accident.
      replays: replays.map((r) => ({
        // `replay_id` on the wire, `recording_id` in storage — the collection and
        // its unique index predate the rename. See routes/replays.js.
        replay_id: r.recording_id,
        capture: r.capture ?? null,
        started_at: r.started_at ?? null,
        duration_ms: r.duration_ms ?? null,
        status: r.status,
        event_count: r.event_count ?? 0,
        chunk_count: r.chunk_count ?? 0,
      })),
    });
  }));
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
