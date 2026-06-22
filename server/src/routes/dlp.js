import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth } from '../auth.js';

// Hard cap on per-event content size. Anything bigger gets stored truncated
// with a `truncated=1` flag so the dashboard can warn the admin.
const MAX_CONTENT_BYTES = 25 * 1024 * 1024;   // 25 MB

export function mountDlp(app, db) {
  // Ingest — auth required, body { events: [...] }
  app.post('/api/v1/dlp', requireMachineAuth, a(async (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });
    if (events.length > 200) return res.status(413).json({ error: 'batch too large (max 200)' });

    let stored = 0;
    for (const e of events) {
      const valid = validateEvent(e);
      if (valid.error) continue;

      const isFileUpload = e.kind === 'file_upload';
      const secretClass    = isFileUpload ? e.severity   : highestSeverityClass(e.matches);
      const patternMatched = isFileUpload ? e.file_class : (e.matches || []).map((m) => m.pattern).join(',');
      const contentLength  = isFileUpload ? (e.size ?? null) : (e.content_length ?? null);

      const eventId = crypto.randomUUID();
      await db.collection('dlp_events').insertOne({
        id: eventId,
        machine_id: req.machine.id,
        occurred_at: e.occurredAt,
        source: e.source ?? 'browser_extension',
        ai_service: e.service ?? 'unknown',
        event_kind: e.kind ?? 'unknown',
        secret_class: secretClass,
        content_length: contentLength,
        pattern_matched: patternMatched,
        metadata_json: JSON.stringify(isFileUpload ? {
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
        } : {
          matches: e.matches ?? [],
          length_bucket: e.length_bucket,
          highest_severity: e.highest_severity,
          tab_host: e.tabHost,
        }),
        received_at: new Date(),
      });

      await insertContent(db, eventId, e);
      stored++;
    }

    res.status(201).json({ ok: true, stored });
  }));

  // Stream the captured content for a single event.
  app.get('/api/v1/dlp/:id/content', a(async (req, res) => {
    const id = req.params.id;

    const row = await db.collection('dlp_content').findOne(
      { event_id: id },
      { projection: { _id: 0, kind: 1, mime_type: 1, filename: 1, byte_size: 1, content_text: 1, content_blob: 1, truncated: 1 } },
    );
    if (!row) return res.status(404).json({ error: 'no content captured for this event' });

    if (row.content_text != null && (row.content_blob == null || row.content_blob.length === 0)) {
      res.setHeader('Content-Type', row.mime_type || 'text/plain; charset=utf-8');
      if (row.filename) res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(row.filename)}"`);
      if (row.truncated) res.setHeader('X-Content-Truncated', '1');
      return res.send(row.content_text);
    }
    if (row.content_blob) {
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      if (row.filename) res.setHeader('Content-Disposition', `inline; filename="${encodeFilename(row.filename)}"`);
      if (row.truncated) res.setHeader('X-Content-Truncated', '1');
      const buf = Buffer.isBuffer(row.content_blob) ? row.content_blob : Buffer.from(row.content_blob.buffer || row.content_blob);
      return res.end(buf);
    }
    return res.status(404).json({ error: 'content row empty' });
  }));

  // Query — recent events.
  app.get('/api/v1/dlp', a(async (req, res) => {
    const { service, severity, machineId, limit = 500 } = req.query;
    const filter = {};
    if (service)    filter.ai_service = service;
    if (severity)   filter.secret_class = severity;
    if (machineId)  filter.machine_id = machineId;

    const [rows, platforms] = await Promise.all([
      db.collection('dlp_events')
        .find(filter)
        .sort({ occurred_at: -1 })
        .limit(Number(limit))
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
      .project({ _id: 0, id: 1, occurred_at: 1, ai_service: 1, pattern_matched: 1, event_kind: 1, machine_id: 1, metadata_json: 1 })
      .toArray();

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

    const platformMap = buildPlatformMap(platforms);
    res.json(rows.map((r) => {
      const meta = safeJson(r.metadata_json);
      return {
        id: r.id,
        machine_id: r.machine_id,
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

// Persist content if the event carries any.
async function insertContent(db, eventId, e) {
  const isFileUpload = e.kind === 'file_upload';

  let mimeType = e.mime_type || null;
  let filename = isFileUpload ? (e.filename || null) : null;
  let kind = isFileUpload ? 'file' : 'prompt';
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

function encodeFilename(name) {
  return String(name).replace(/[\r\n"\\]/g, '_');
}

function validateEvent(e) {
  if (!e || typeof e !== 'object') return { error: 'not an object' };
  if (!e.occurredAt || !e.kind || !e.service) return { error: 'required fields missing' };
  return { ok: true };
}

function highestSeverityClass(matches) {
  if (!matches?.length) return null;
  const order = ['low', 'moderate', 'high', 'critical'];
  let top = null;
  for (const m of matches) {
    if (order.indexOf(m.severity) > order.indexOf(top)) top = m.severity;
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
