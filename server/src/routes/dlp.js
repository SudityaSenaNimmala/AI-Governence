import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth } from '../auth.js';
import { emitWebhook } from './webhooks.js';
import { siemForward } from '../lib/siem-forward.js';
import { attachMachineIdentity, machineIdentity } from '../lib/machine-identity.js';

// Hard cap on per-event content size. Anything bigger gets stored truncated
// with a `truncated=1` flag so the dashboard can warn the admin.
const MAX_CONTENT_BYTES = 25 * 1024 * 1024;   // 25 MB

export function mountDlp(app, db) {
  // Ingest — auth required, body { events: [...] }
  app.post('/api/v1/dlp', requireMachineAuth, a(async (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });
    if (events.length > 200) return res.status(413).json({ error: 'batch too large (max 200)' });

    // Every event in a batch belongs to the authenticated machine, so resolve
    // the enrolled person once and stamp it on each event (a client-supplied
    // e.user still wins — e.g. the browser extension's signed-in identity).
    const identity = await machineIdentity(db, req.machine.id);

    let stored = 0;
    let bound = 0;
    for (const e of events) {
      const valid = validateEvent(e);
      if (valid.error) continue;

      // Session grouping (Session Replay, phase 1). The browser extension
      // stamps every event with the conversation it belongs to (session_id)
      // and its order inside that conversation (client_seq). Both are stored
      // as top-level columns — same rule the rest of this handler follows:
      // anything we filter/sort/join on is top-level, descriptive detail goes
      // into metadata_json.
      const sessionId = normalizeSessionId(e.session_id);
      const clientSeq = normalizeClientSeq(e.client_seq);

      // `session_bind` is not a DLP event. It only tells us that this browser
      // session_id corresponds to the AI site's own conversation id, so it
      // updates the session record and is never stored in dlp_events.
      if (e.kind === 'session_bind') {
        if (sessionId) {
          await upsertSession(db, {
            sessionId,
            machineId: req.machine.id,
            aiService: e.service,
            externalConvId: normalizeExternalConvId(e.external_conv_id),
            occurredAt: e.occurredAt,
            countMessage: false,
          });
          bound++;
        }
        continue;
      }

      const isFileUpload = e.kind === 'file_upload';
      const isAiResponse = e.kind === 'ai_response';
      const secretClass    = isFileUpload ? e.severity   : highestSeverityClass(e.matches);
      const patternMatched = isFileUpload ? e.file_class : (e.matches || []).map((m) => m.pattern).join(',');
      const contentLength  = isFileUpload ? (e.size ?? null) : (e.content_length ?? null);
      // Who is speaking. Derived from the event kind on the SERVER — never taken
      // from the client — so an agent cannot mislabel a user prompt as an
      // assistant reply. Needed to render a conversation in order later.
      const role = roleForKind(e.kind);

      // A client may supply a stable dedupe key (the Claude tracker uses the
      // transcript message uuid). Re-reporting the same key updates the row
      // instead of inserting a duplicate, which is what makes replaying local
      // history safe after the server has been unreachable.
      const dedupeKey = typeof e.clientEventId === 'string' && e.clientEventId ? e.clientEventId : null;
      const eventId = dedupeKey || crypto.randomUUID();
      const eventDoc = {
        id: eventId,
        client_event_id: dedupeKey,
        machine_id: req.machine.id,
        user: e.user ?? identity.user,
        hostname: e.hostname ?? identity.hostname,
        occurred_at: e.occurredAt,
        source: e.source ?? 'browser_extension',
        ai_service: e.service ?? 'unknown',
        event_kind: e.kind ?? 'unknown',
        role,
        session_id: sessionId,
        client_seq: clientSeq,
        secret_class: secretClass,
        content_length: contentLength,
        pattern_matched: patternMatched,
        metadata_json: JSON.stringify(
          isFileUpload ? {
            filename: e.filename,
            size: e.size,
            size_bucket: e.size_bucket,
            mime_type: e.mime_type,
            extension: e.extension,
            file_class: e.file_class,
            severity: e.severity,
            reason: e.reason,
            via: e.via,
            tab_host: e.tabHost,
            content_scan: e.content_scan ?? null,
          } : isAiResponse ? {
            // How the reply was decoded on the client, and whether the page-side
            // buffer had to cut it short. No content here — the text itself goes
            // to dlp_content like every other captured body.
            response_format: e.response_format ?? null,
            capture_truncated: e.capture_truncated ? 1 : 0,
            duration_ms: e.duration_ms ?? null,
            length_bucket: e.length_bucket,
            tab_host: e.tabHost,
          } : {
            matches: e.matches ?? [],
            length_bucket: e.length_bucket,
            highest_severity: e.highest_severity,
            tab_host: e.tabHost,
          },
        ),
        received_at: new Date(),
      };
      if (dedupeKey) {
        await db.collection('dlp_events').updateOne(
          { id: dedupeKey },
          { $set: eventDoc },
          { upsert: true },
        );
      } else {
        await db.collection('dlp_events').insertOne(eventDoc);
      }

      await insertContent(db, eventId, e);

      if (sessionId) {
        await upsertSession(db, {
          sessionId,
          machineId: req.machine.id,
          aiService: e.service,
          externalConvId: null,
          occurredAt: e.occurredAt,
          countMessage: true,
          role,
          // The server-derived severity only — the same value stored as this
          // event's secret_class. A client-supplied metadata.highest_severity
          // (enforcement_* kinds) is deliberately NOT rolled up, matching what
          // GET /api/v1/sessions/stats/summary already counts.
          severity: secretClass,
        });
      }

      // Push critical enforcement events to webhook subscribers.
      if ((e.kind === 'enforcement_block' || e.kind === 'enforcement_override') && (secretClass === 'critical' || secretClass === 'high')) {
        emitWebhook(db, 'dlp_critical', {
          title: 'DLP Violation: ' + (e.service || 'AI Tool'),
          body: 'Sensitive data (' + (secretClass || 'unknown') + ') detected in ' + (e.service || 'an AI tool') + '. ' + (e.kind === 'enforcement_override' ? 'User overrode the block.' : 'Prompt was blocked.') + '\nPatterns: ' + (patternMatched || 'unknown'),
          severity: secretClass,
          employee: req.machine.hostname || req.machine.id,
          tool: e.service || 'unknown',
          trigger: 'dlp_critical',
        });
      }

      // Real-time push to a configured SIEM syslog collector (no-op if unset).
      siemForward('dlp', eventDoc);
      stored++;
    }

    res.status(201).json({ ok: true, stored, bound });
  }));

  // Stream the captured content for a single event.
  //
  // SECURITY — UNAUTHENTICATED, KNOWN GAP, DEFERRED BY DECISION.
  // This route returns raw captured prompt bodies, AI responses and uploaded file
  // bytes (up to MAX_CONTENT_BYTES). POST /api/v1/dlp is gated by
  // requireMachineAuth; this route, which serves the same bytes back out, is not
  // gated at all. Port 8787 is published publicly by docker-compose and
  // app.use(cors()) sends Access-Control-Allow-Origin: *, so any page a user
  // visits can enumerate GET /api/v1/dlp and drain the corpus cross-origin.
  //
  // The fix is one word — add requireAdminAuth below — but it must land together
  // with a credential the dashboard can actually send: the content viewer at
  // AIHubPage.jsx:94 uses a bare fetch() with no Authorization header, so gating
  // this route on its own breaks the "View" button in AI Activity. Scheduled with
  // the session-auth work, not before.
  //
  // app.get('/api/v1/dlp/:id/content', requireAdminAuth, a(async (req, res) => {
  app.get('/api/v1/dlp/:id/content', a(async (req, res) => {
    const id = req.params.id;

    const row = await db.collection('dlp_content').findOne(
      { event_id: id },
      { projection: { _id: 0, kind: 1, mime_type: 1, filename: 1, byte_size: 1, content_text: 1, content_blob: 1, truncated: 1 } },
    );
    if (!row) return res.status(404).json({ error: 'no content captured for this event' });

    if (row.content_text != null && (row.content_blob == null || row.content_blob.length === 0)) {
      // safeMimeType, not row.mime_type: the value is client-supplied at ingest.
      res.setHeader('Content-Type', safeMimeType(row.mime_type, 'text/plain; charset=utf-8'));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (row.filename) res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(row.filename)}"`);
      if (row.truncated) res.setHeader('X-Content-Truncated', '1');
      return res.send(row.content_text);
    }
    if (row.content_blob) {
      res.setHeader('Content-Type', safeMimeType(row.mime_type, 'application/octet-stream'));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (row.filename) res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(row.filename)}"`);
      if (row.truncated) res.setHeader('X-Content-Truncated', '1');
      const buf = Buffer.isBuffer(row.content_blob) ? row.content_blob : Buffer.from(row.content_blob.buffer || row.content_blob);
      return res.end(buf);
    }
    return res.status(404).json({ error: 'content row empty' });
  }));

  // Query — recent events.
  //
  // Every filter value is coerced with String() before it reaches Mongo. Express's
  // default extended query parser turns `?severity[$ne]=x` into an OBJECT, which
  // used to land in the filter verbatim and be evaluated as a query operator:
  // `?severity[$ne]=zzz` returned all 500 events instead of 0, and the same trick
  // on machineId defeated per-machine scoping. String() collapses the object to
  // harmless text so the filter can only ever mean equality.
  //
  // `severity` also accepts a comma list (e.g. "critical,high") validated against
  // SEVERITY_VALUES. Callers that want only the events worth reviewing can now say
  // so, instead of pulling the newest N of every severity and filtering client-side
  // — which is how the dashboard ended up showing an empty "Sensitive prompts"
  // table underneath a "1,196 high/critical" counter.
  app.get('/api/v1/dlp', a(async (req, res) => {
    const { service, severity, machineId, limit = 500 } = req.query;
    const filter = {};
    if (service)   filter.ai_service = String(service);
    if (machineId) filter.machine_id = String(machineId);
    if (severity) {
      // Unknown names are dropped rather than passed through, so a bogus value
      // yields an empty result set instead of an unfiltered one.
      const wanted = String(severity).split(',').map((s) => s.trim()).filter((s) => SEVERITY_VALUES.has(s));
      if (wanted.length === 1)      filter.secret_class = wanted[0];
      else if (wanted.length > 1)   filter.secret_class = { $in: wanted };
      else                          filter.secret_class = '__no_such_severity__';
    }

    // Cap the page size: an unbounded Number(limit) let one request pull the whole
    // collection, and NaN from a non-numeric value silently became "no limit".
    const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);

    const [rows, platforms] = await Promise.all([
      db.collection('dlp_events')
        .find(filter)
        .sort({ occurred_at: -1 })
        .limit(lim)
        .project({ _id: 0 })
        .toArray(),
      db.collection('ai_platforms')
        .find({})
        .limit(2000)
        .project({ _id: 0, host: 1, vendor: 1, product: 1, category: 1, sandbox: 1, governance_note: 1 })
        .toArray(),
    ]);

    // Check which events have content
    const eventIds = rows.map((r) => r.id);
    const contentDocs = await db.collection('dlp_content')
      .find({ event_id: { $in: eventIds } })
      .project({ _id: 0, event_id: 1 })
      .toArray();
    const hasContentSet = new Set(contentDocs.map((c) => c.event_id));

    // Resolve the person for events that predate per-event user stamping.
    await attachMachineIdentity(db, rows);

    const platformMap = buildPlatformMap(platforms);
    res.json(rows.map((r) => {
      const meta = safeJson(r.metadata_json);
      return {
        ...r,
        metadata:    meta,
        has_content: hasContentSet.has(r.id),
        platform:    lookupPlatform(meta?.tab_host, platformMap),
      };
    }));
  }));

  // Summary — counts by service, by severity, broken down by event_kind
  app.get('/api/v1/dlp/summary', a(async (req, res) => {
    const byService = await db.collection('dlp_events').aggregate([
      {
        $group: {
          _id: '$ai_service',
          events: { $sum: 1 },
          file_uploads: { $sum: { $cond: [{ $eq: ['$event_kind', 'file_upload'] }, 1, 0] } },
          prompts: { $sum: { $cond: [{ $in: ['$event_kind', ['prompt_paste', 'prompt_submit', 'prompt_typed']] }, 1, 0] } },
          machines: { $addToSet: '$machine_id' },
        },
      },
      { $project: { _id: 0, ai_service: '$_id', events: 1, file_uploads: 1, prompts: 1, machines: { $size: '$machines' } } },
      { $sort: { events: -1 } },
    ]).toArray();

    const bySeverity = await db.collection('dlp_events').aggregate([
      {
        $group: {
          _id: { $ifNull: ['$secret_class', 'none'] },
          events: { $sum: 1 },
        },
      },
      { $project: { _id: 0, severity: '$_id', events: 1 } },
      { $sort: { events: -1 } },
    ]).toArray();

    const byKind = await db.collection('dlp_events').aggregate([
      { $group: { _id: '$event_kind', events: { $sum: 1 } } },
      { $project: { _id: 0, event_kind: '$_id', events: 1 } },
      { $sort: { events: -1 } },
    ]).toArray();

    const recentCritical = await db.collection('dlp_events')
      .find({ secret_class: { $in: ['critical', 'high'] } })
      .sort({ occurred_at: -1 })
      .limit(25)
      .project({ _id: 0, id: 1, occurred_at: 1, ai_service: 1, pattern_matched: 1, event_kind: 1, machine_id: 1, user: 1, hostname: 1, metadata_json: 1 })
      .toArray();
    await attachMachineIdentity(db, recentCritical);

    res.json({
      byService,
      bySeverity,
      byKind,
      recentCritical: recentCritical.map((r) => ({ ...r, metadata: safeJson(r.metadata_json) })),
    });
  }));

  // File uploads — filtered view of dlp_events, enriched with registry platform info
  app.get('/api/v1/dlp/files', a(async (req, res) => {
    const [rows, platforms] = await Promise.all([
      db.collection('dlp_events')
        .find({ event_kind: 'file_upload' })
        .sort({ occurred_at: -1 })
        .limit(500)
        .project({ _id: 0 })
        .toArray(),
      db.collection('ai_platforms')
        .find({})
        .limit(2000)
        .project({ _id: 0, host: 1, vendor: 1, product: 1, category: 1, sandbox: 1, governance_note: 1 })
        .toArray(),
    ]);

    // Check which events have content
    const eventIds = rows.map((r) => r.id);
    const contentDocs = await db.collection('dlp_content')
      .find({ event_id: { $in: eventIds } })
      .project({ _id: 0, event_id: 1 })
      .toArray();
    const hasContentSet = new Set(contentDocs.map((c) => c.event_id));

    await attachMachineIdentity(db, rows);

    const platformMap = buildPlatformMap(platforms);
    res.json(rows.map((r) => {
      const meta = safeJson(r.metadata_json);
      return {
        id: r.id,
        machine_id: r.machine_id,
        user: r.user,
        hostname: r.hostname,
        occurred_at: r.occurred_at,
        ai_service: r.ai_service,
        file_class: r.pattern_matched,
        severity: r.secret_class,
        size: r.content_length,
        metadata_json: r.metadata_json,
        metadata:    meta,
        has_content: hasContentSet.has(r.id),
        platform:    lookupPlatform(meta?.tab_host, platformMap),
      };
    }));
  }));
}

// Which side of the conversation an event kind belongs to.
//   'user'      — the human put this content in front of the model
//   'assistant' — the model produced it
//   'system'    — our own governance bookkeeping (blocks, redactions, decisions)
// Anything unrecognized is 'system' rather than a guess: a replay view showing
// an unknown event as a user turn would be worse than showing it as metadata.
const USER_KINDS = new Set(['prompt_submit', 'prompt_paste', 'prompt_typed', 'file_upload']);
const ASSISTANT_KINDS = new Set(['ai_response']);

function roleForKind(kind) {
  if (USER_KINDS.has(kind)) return 'user';
  if (ASSISTANT_KINDS.has(kind)) return 'assistant';
  return 'system';
}

// Persist content if the event carries any.
async function insertContent(db, eventId, e) {
  const isFileUpload = e.kind === 'file_upload';

  let mimeType = e.mime_type || null;
  let filename = isFileUpload ? (e.filename || null) : null;
  let kind = isFileUpload ? 'file' : (e.kind === 'ai_response' ? 'response' : 'prompt');
  let contentText = null;
  let contentBlob = null;
  let byteSize = null;
  let truncated = 0;

  if (typeof e.content_text === 'string' && e.content_text.length > 0) {
    let txt = e.content_text;
    if (Buffer.byteLength(txt, 'utf8') > MAX_CONTENT_BYTES) {
      txt = txt.slice(0, Math.floor(MAX_CONTENT_BYTES / 4));
      truncated = 1;
    }
    contentText = txt;
    byteSize = Buffer.byteLength(txt, 'utf8');
    if (!mimeType) mimeType = 'text/plain; charset=utf-8';
  }

  if (isFileUpload && typeof e.content_base64 === 'string' && e.content_base64.length > 0) {
    let buf;
    try { buf = Buffer.from(e.content_base64, 'base64'); }
    catch { buf = null; }
    if (buf && buf.length > 0) {
      if (buf.length > MAX_CONTENT_BYTES) {
        buf = buf.subarray(0, MAX_CONTENT_BYTES);
        truncated = 1;
      }
      contentBlob = buf;
      byteSize = buf.length;
      if (!mimeType) mimeType = 'application/octet-stream';
    }
  }

  if (contentText == null && contentBlob == null) return;

  await db.collection('dlp_content').insertOne({
    event_id: eventId,
    kind,
    mime_type: mimeType,
    filename,
    byte_size: byteSize,
    content_text: contentText,
    content_blob: contentBlob,
    truncated,
  });
}

// ── Sessions (Session Replay, phases 1 + 3) ──────────────────────────────────
// One document per conversation, tracked as a first-class concept so later
// phases have something to hang messages off. Deliberately minimal: identity,
// ownership, the activity window and message counters. No content ever lands
// here — prompt/response bodies stay in dlp_content.
//
// Counters (phase 3): `message_count` stays what it always was — EVERY stored
// event in the session, which is what the phase-1 dashboards read — and the
// per-role counters are added alongside it rather than redefining it:
//   message_count            all stored events (incl. enforcement bookkeeping)
//   user_message_count       prompts + uploads
//   assistant_message_count  captured AI replies
// An AI reply is part of the conversation, so it counts in message_count too.
//
// Severity rollup (phase 4): the worst severity seen in the conversation is kept
// on the session as a high-water mark so the list route can show and filter it
// without an aggregation over dlp_events per request:
//   highest_severity_rank   numeric, 0 = none … 4 = critical (see SEVERITY_RANK)
//   highest_severity        the matching label, or null while nothing has scored
// Sessions that existed before this shipped carry neither field until their next
// event arrives; readers treat that as "unknown", the same as rank 0.
//
// Session boundary (engagement rule): a session_id now covers a continuous
// stretch of using ONE AI service in ONE browser tab — it survives chat switches,
// "New chat" and same-service reloads, and the browser extension ends it only on
// tab close, a service change, 15 min of visible-tab inactivity, a 12h cap or a
// browser restart. Nothing about that decision lives here (it is entirely
// client-side, in browser-extension/lib/recording.js), but two consequences do:
//   * a session spans several of the AI site's own conversation ids, so they
//     accumulate in `external_conv_ids` alongside the most-recent scalar
//   * a session lives long enough for out-of-order delivery to matter, so the
//     activity window is maintained with $max / $min instead of $set
// Deliberately NOT stored: ended_at / end_reason / session_scope (out of scope by
// product decision) and an `ai_services` plural — a session is single-service by
// construction, so the scalar `ai_service` remains correct.
async function upsertSession(db, { sessionId, machineId, aiService, externalConvId, occurredAt, countMessage, role = null, severity = null }) {
  const activityAt = toDate(occurredAt);
  const rank = severityRank(severity);

  const set = {};
  const setOnInsert = {
    session_id: sessionId,
    // Ownership is claimed once, by the machine whose events created the
    // session, and never rewritten — a second machine reusing (or guessing) a
    // session_id must not be able to take the record over.
    machine_id: machineId,
  };
  const addToSet = {};

  // The activity window is maintained with $max / $min, not $set / $setOnInsert,
  // because arrival order is not event order. The extension queues events in
  // chrome.storage and flushes them on an alarm, so a batch that was offline for
  // an hour lands AFTER the events that happened later — and a session that now
  // spans a whole stretch of AI use (chat switches, reloads and all) sees far
  // more of that than a per-conversation one did.
  //   last_activity_at  $max — a late-arriving old event must not drag the
  //                     window backwards and make a live session look stale
  //   started_at        $min — an out-of-order first event must not pin a start
  //                     later than the true one
  // $min on an ABSENT field just sets it, which is why started_at can drop out of
  // $setOnInsert entirely (and must: a field may not appear in two operators).
  // The one trap — $min will NOT replace a stored null with a number, because
  // null sorts below every number in BSON — does not apply here, since started_at
  // is never written as null on any path.
  const max = { last_activity_at: activityAt };
  const min = { started_at: activityAt };

  // A field may not appear in both $set and $setOnInsert, so only default the
  // ones we aren't already writing on this event.
  const service = aiService ?? null;
  if (service) set.ai_service = service;
  else setOnInsert.ai_service = 'unknown';

  // `external_conv_id` (scalar) stays what it always was: the MOST RECENT
  // conversation the tab was in. `external_conv_ids` (array) accumulates every
  // one of them, because a session now spans chat switches — the user starting a
  // new chat, or flipping back to an old one, no longer ends the session, so a
  // single scalar can no longer answer "which conversations did this session
  // touch". $addToSet, so re-binding the same id (a reload, a re-scan) does not
  // grow the array.
  if (externalConvId) {
    set.external_conv_id = externalConvId;
    addToSet.external_conv_ids = externalConvId;
  } else {
    setOnInsert.external_conv_id = null;
    setOnInsert.external_conv_ids = [];
  }

  // The label is never written in this operator document: $set is unconditional
  // and would cheerfully overwrite 'critical' with 'low'. It only gets a null
  // default here so a fresh session doc has the field. The rank is not defaulted
  // because $max already creates it (and both on one path is a Mongo conflict).
  setOnInsert.highest_severity = null;

  // Raise the severity watermark, never lower it. $max does the comparison inside
  // the single atomic document update, so two events for the same session racing
  // through this function cannot lose the higher one the way a read-compare-write
  // in JS would. It shares the operator with last_activity_at, which wants the
  // same "never go backwards" guarantee.
  max.highest_severity_rank = rank;

  const update = {
    $setOnInsert: setOnInsert,
    // $inc creates the field at 0 on insert when the delta is 0, which is
    // what we want for a session that starts life with a session_bind — and
    // for the role counters on a session that has only seen one side so far.
    $inc: {
      message_count: countMessage ? 1 : 0,
      user_message_count: countMessage && role === 'user' ? 1 : 0,
      assistant_message_count: countMessage && role === 'assistant' ? 1 : 0,
    },
    $max: max,
    $min: min,
  };
  // Mongo rejects an EMPTY operator document, and both of these are now legitimately
  // empty on some paths (an event with no service name and no conversation id).
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(addToSet).length) update.$addToSet = addToSet;

  await db.collection('ai_sessions').updateOne({ session_id: sessionId }, update, { upsert: true });

  if (rank === NO_SEVERITY_RANK) return;

  // Sync the human-readable label to the watermark we just raised. Guarded by
  // the rank in the FILTER, so this is a compare-and-set, not a read-then-write:
  // it lands only while the stored rank is still the one this event produced. A
  // slower low-severity event therefore cannot relabel a session that a
  // concurrent high-severity event already raised — its filter simply no longer
  // matches and the update is a no-op. The `$ne` skips the write entirely once
  // the label is already correct, which is the common case in a long chat.
  await db.collection('ai_sessions').updateOne(
    {
      session_id: sessionId,
      highest_severity_rank: rank,
      highest_severity: { $ne: severity },
    },
    { $set: { highest_severity: severity } },
  );
}

// The client clock is not trusted for ordering (client_seq is), but it is still
// the best available wall-clock for the activity window. Fall back to server
// time when it's missing or unparseable.
function toDate(value) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function normalizeSessionId(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > 128) return null;
  return s;
}

function normalizeClientSeq(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

// Opaque id minted by the AI site itself (ChatGPT /c/<id> etc.). Never used in
// a path or a query we build by hand, but keep it short and boring anyway.
function normalizeExternalConvId(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > 200) return null;
  return s;
}

function encodeFilename(name) {
  return String(name).replace(/[\r\n"\\]/g, '_');
}

// Severity names accepted by the ?severity= filter. Anything else is dropped, so a
// caller cannot smuggle a query operator or a regex through this parameter.
const SEVERITY_VALUES = new Set(['critical', 'high', 'moderate', 'medium', 'low']);

// Response Content-Type allowlist for GET /api/v1/dlp/:id/content.
//
// mime_type arrives in the ingest body (validateEvent does not constrain it), so
// echoing it back into a response header let a caller choose how the browser
// interprets stored bytes. Posting content_text of "<script>…</script>" with
// mime_type "text/html" made this route serve executable HTML on the API origin —
// the same origin every other endpoint here lives on.
//
// An allowlist rather than a denylist, and deliberately NOT a `text/*` prefix
// test: text/html and image/svg+xml both script, and both are "text-ish". Only
// these exact types are echoed; anything else — including anything new an agent
// starts sending — degrades to the caller-supplied fallback. Paired with
// X-Content-Type-Options: nosniff so the browser cannot second-guess it.
//
// Covers every type actually present in dlp_content today (text/plain, docx,
// png, jpeg, pdf, zip) plus the obvious near neighbours.
const SAFE_MIME_TYPES = new Set([
  'text/plain', 'text/plain; charset=utf-8', 'text/csv', 'application/json',
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/zip', 'application/x-zip-compressed', 'application/octet-stream',
  'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
function safeMimeType(mime, fallback) {
  const m = String(mime || '').trim().toLowerCase();
  return SAFE_MIME_TYPES.has(m) ? m : fallback;
}

function validateEvent(e) {
  if (!e || typeof e !== 'object') return { error: 'not an object' };
  if (!e.occurredAt || !e.kind || !e.service) return { error: 'required fields missing' };
  return { ok: true };
}

// ── Severity ordering ────────────────────────────────────────────────────────
// One definition for "which severity is worse", used both to pick the top match
// on a single event and to keep the per-session watermark.
//
// The DLP scale is the one the browser extension emits: low < moderate < high <
// critical (browser-extension/content/patterns.js). The governance side spells
// the middle step 'medium' (src/governance/types/agent.ts) — same level, so it
// ranks identically rather than being treated as unknown. Absent/unrecognized
// severity ranks 0, which is how a turn with no matches is treated: it can never
// raise the watermark and can never be picked as the top match.
const NO_SEVERITY_RANK = 0;
const SEVERITY_RANK = {
  low: 1,
  moderate: 2,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityRank(severity) {
  if (typeof severity !== 'string') return NO_SEVERITY_RANK;
  return SEVERITY_RANK[severity.trim().toLowerCase()] ?? NO_SEVERITY_RANK;
}

function highestSeverityClass(matches) {
  if (!matches?.length) return null;
  let top = null;
  let topRank = NO_SEVERITY_RANK;
  for (const m of matches) {
    const rank = severityRank(m?.severity);
    if (rank > topRank) {
      topRank = rank;
      top = m.severity;
    }
  }
  return top;
}

function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

function buildPlatformMap(platforms) {
  const m = new Map();
  for (const p of platforms || []) {
    if (p.host) m.set(p.host.toLowerCase(), p);
  }
  return m;
}

function lookupPlatform(host, map) {
  if (!host || !map?.size) return null;
  const h = host.toLowerCase();
  if (map.has(h)) return map.get(h);
  for (const [k, v] of map) {
    if (h.endsWith('.' + k)) return v;
  }
  return null;
}
