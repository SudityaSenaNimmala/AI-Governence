// AI Platforms registry — admin-editable single source of truth for which
// hosts the governance stack actively captures from.
//
// Routes:
//
//   GET    /api/v1/ai-platforms             list all (browser ext + dashboard)
//   GET    /api/v1/ai-platforms/:host       single row
//   POST   /api/v1/ai-platforms             admin: add
//   PATCH  /api/v1/ai-platforms/:host       admin: edit fields
//   DELETE /api/v1/ai-platforms/:host       admin: remove

import { a } from '../util.js';

const VALID_CATEGORY = new Set([
  'chat-frontend', 'ide-assistant', 'autonomous-agent', 'api-platform', 'local-runtime',
]);
const VALID_SANDBOX = new Set(['local', 'remote', 'mixed', 'unknown']);
const VALID_SURFACE = new Set(['browser', 'desktop', 'cli', 'all']);
const VALID_CAPTURE_MODE = new Set(['observe', 'block_critical']);

function normalizeHost(h) {
  if (!h || typeof h !== 'string') return null;
  let s = h.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9.\-]+\.[a-z]{2,}$/.test(s) && !/^[a-z0-9.\-]+\.[a-z0-9]+$/.test(s)) return null;
  return s;
}

function pickPatch(body) {
  const out = {};
  if (body == null) return out;
  if ('vendor'          in body) out.vendor          = body.vendor          ?? null;
  if ('product'         in body) out.product         = body.product         ?? null;
  if ('category'        in body) {
    if (body.category != null && !VALID_CATEGORY.has(body.category)) return { _err: 'invalid category' };
    out.category = body.category ?? null;
  }
  if ('sandbox'         in body) {
    if (body.sandbox != null && !VALID_SANDBOX.has(body.sandbox)) return { _err: 'invalid sandbox' };
    out.sandbox = body.sandbox ?? null;
  }
  if ('governed'        in body) out.governed        = body.governed ? 1 : 0;
  if ('surface'         in body) {
    if (body.surface != null && !VALID_SURFACE.has(body.surface)) return { _err: 'invalid surface' };
    out.surface = body.surface ?? 'browser';
  }
  if ('capture_mode'    in body) {
    if (body.capture_mode != null && !VALID_CAPTURE_MODE.has(body.capture_mode)) return { _err: 'invalid capture_mode' };
    out.capture_mode = body.capture_mode ?? 'observe';
  }
  if ('governance_note' in body) out.governance_note = body.governance_note ?? null;
  if ('pinned'          in body) out.pinned          = body.pinned ? 1 : 0;
  return out;
}

function rowToJson(r) {
  if (!r) return null;
  const { _id, ...rest } = r;
  return {
    ...rest,
    governed: !!rest.governed,
    pinned:   !!rest.pinned,
  };
}

export function mountAiPlatforms(app, db) {
  app.get('/api/v1/ai-platforms', a(async (req, res) => {
    const filter = {};
    if (req.query.governed === '1') filter.governed = 1;
    if (req.query.governed === '0') filter.governed = 0;
    if (req.query.surface) {
      filter.$or = [{ surface: req.query.surface }, { surface: 'all' }];
    }

    const rows = await db.collection('ai_platforms')
      .find(filter)
      .sort({ updated_at: -1 })
      .limit(1000)
      .project({
        _id: 0, host: 1, vendor: 1, product: 1, category: 1, sandbox: 1,
        governed: 1, surface: 1, capture_mode: 1, governance_note: 1, pinned: 1,
        source: 1, added_by: 1, added_at: 1, updated_at: 1,
      })
      .toArray();
    res.json(rows.map(rowToJson));
  }));

  app.get('/api/v1/ai-platforms/:host', a(async (req, res) => {
    const host = normalizeHost(req.params.host);
    if (!host) return res.status(400).json({ error: 'bad host' });
    const row = await db.collection('ai_platforms').findOne({ host });
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(rowToJson(row));
  }));

  app.post('/api/v1/ai-platforms', a(async (req, res) => {
    const host = normalizeHost(req.body?.host);
    if (!host) return res.status(400).json({ error: 'host required (e.g. lovable.dev)' });
    const patch = pickPatch(req.body);
    if (patch._err) return res.status(400).json({ error: patch._err });

    const now = new Date();
    const vendor       = patch.vendor          ?? null;
    const product      = patch.product         ?? vendor;
    const category     = patch.category        ?? null;
    const sandbox      = patch.sandbox         ?? 'unknown';
    const governed     = patch.governed        ?? 1;
    const surface      = patch.surface         ?? 'browser';
    const captureMode  = patch.capture_mode    ?? 'observe';
    const governanceNote = patch.governance_note ?? null;
    const pinned       = patch.pinned          ?? 0;
    const addedBy      = req.body?.added_by    || 'admin';

    await db.collection('ai_platforms').updateOne(
      { host },
      {
        $set: {
          host,
          vendor,
          product,
          category,
          sandbox,
          governed,
          surface,
          capture_mode: captureMode,
          governance_note: governanceNote,
          pinned,
          source: 'admin',
          added_by: addedBy,
          updated_at: now,
        },
        $setOnInsert: { added_at: now },
      },
      { upsert: true },
    );

    const row = await db.collection('ai_platforms').findOne({ host });
    res.status(201).json(rowToJson(row));
  }));

  app.patch('/api/v1/ai-platforms/:host', a(async (req, res) => {
    const host = normalizeHost(req.params.host);
    if (!host) return res.status(400).json({ error: 'bad host' });
    const patch = pickPatch(req.body);
    if (patch._err) return res.status(400).json({ error: patch._err });
    const cols = Object.keys(patch);
    if (cols.length === 0) return res.status(400).json({ error: 'no patchable fields' });

    const setObj = { ...patch, updated_at: new Date() };
    await db.collection('ai_platforms').updateOne(
      { host },
      { $set: setObj },
    );
    const row = await db.collection('ai_platforms').findOne({ host });
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(rowToJson(row));
  }));

  app.delete('/api/v1/ai-platforms/:host', a(async (req, res) => {
    const host = normalizeHost(req.params.host);
    if (!host) return res.status(400).json({ error: 'bad host' });
    const result = await db.collection('ai_platforms').deleteOne({ host });
    res.json({ ok: true, deleted: result?.deletedCount ?? 0 });
  }));
}
