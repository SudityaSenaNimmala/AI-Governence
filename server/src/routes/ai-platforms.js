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
import { requireAdminAuth } from '../auth.js';
import { MICROSOFT_WORKSPACE_COPILOT_HOSTS, applyMicrosoftWorkspaceCopilotCascade } from '../lib/ai-surfaces.js';

const VALID_CATEGORY = new Set([
  'chat-frontend', 'ide-assistant', 'autonomous-agent', 'api-platform', 'local-runtime',
]);
const VALID_SANDBOX = new Set(['local', 'remote', 'mixed', 'unknown']);
const VALID_SURFACE = new Set(['browser', 'desktop', 'cli', 'all']);
const VALID_CAPTURE_MODE = new Set(['observe', 'block_critical', 'hold']);

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
  if ('blocked'         in body) out.blocked          = body.blocked ? 1 : 0;
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
    blocked:  !!rest.blocked,
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
        governed: 1, blocked: 1, surface: 1, capture_mode: 1, governance_note: 1, pinned: 1,
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

  // ADMIN-GATED. `blocked` on this route reaches the SAME Microsoft 365 Copilot
  // host cascade that PUT /api/v1/registry/:id/status does (see the comment on
  // that call below), so leaving it open would have made gating only the other
  // route theatre — an unauthenticated PATCH on office.com could block or unblock
  // all ten Microsoft hosts for the org. The two GETs above stay public: the
  // browser extension polls `?surface=browser` with no credential, and gating
  // them would silently stop all enforcement.
  app.patch('/api/v1/ai-platforms/:host', requireAdminAuth, a(async (req, res) => {
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

    // Propagate block/unblock to ALL sibling hosts of the same tool.
    // If api.anthropic.com is blocked, claude.ai must also be blocked —
    // they're the same tool and the dashboard shows them as one entry.
    if ('blocked' in patch) {
      const siblings = await db.collection('agent_registry')
        .find({ matched_hosts: host })
        .project({ matched_hosts: 1 })
        .toArray();
      const allHosts = new Set();
      for (const s of siblings) {
        for (const h of (s.matched_hosts || [])) allHosts.add(h);
      }
      allHosts.delete(host); // already updated above
      if (allHosts.size > 0) {
        await db.collection('ai_platforms').updateMany(
          { host: { $in: [...allHosts] } },
          { $set: { blocked: patch.blocked, updated_at: new Date() } },
        );
      }
    }

    const row = await db.collection('ai_platforms').findOne({ host });
    if (!row) return res.status(404).json({ error: 'not found' });

    // The Microsoft 365 Copilot product toggle covers its web surfaces here
    // TOO — see applyMicrosoftWorkspaceCopilotCascade's own comment. A real
    // admin can reach this exact product from this host-keyed catalog page
    // (toggling `office.com` or `m365.cloud.microsoft` directly) just as
    // easily as from the Inventory list that calls registry.js's status
    // route, and the two must not disagree about what one toggle covers.
    // The `agent_registry.matched_hosts` propagation above is a DIFFERENT,
    // narrower mechanism (siblings of a discovered agent) and does not reach
    // this product — it has no discovered agent of its own, which is the
    // whole reason this cascade exists rather than relying on that path.
    //
    // Gated on HOST MEMBERSHIP in the curated list, not on `row.product` —
    // found live 2026-09-21: the seed data for `m365.cloud.microsoft` itself
    // (the exact host office_copilot_pane's `host` field points to) carries
    // `product: "Microsoft Copilot"`, missing "365", the same inconsistency
    // sharepoint.com/outlook.office.com have BY DESIGN for their own product
    // names. A product-string match would have silently never cascaded from
    // the single most relevant host in the whole set. The curated list is
    // already the reviewed, unambiguous signal (see its own comment in
    // lib/ai-surfaces.js) — this route doesn't need a second one.
    if ('blocked' in patch && MICROSOFT_WORKSPACE_COPILOT_HOSTS.includes(host)) {
      await applyMicrosoftWorkspaceCopilotCascade(db, !!patch.blocked);
    }

    res.json(rowToJson(row));
  }));

  app.delete('/api/v1/ai-platforms/:host', a(async (req, res) => {
    const host = normalizeHost(req.params.host);
    if (!host) return res.status(400).json({ error: 'bad host' });
    const result = await db.collection('ai_platforms').deleteOne({ host });
    res.json({ ok: true, deleted: result?.deletedCount ?? 0 });
  }));
}
