import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import { generateApiKey, hashApiKey } from '../integration-util.js';

// Authenticated third-party "signals" API — a stable, scoped, secured surface
// for external governance/control layers to PULL CloudFuze policy / identity /
// risk / permission / app-state signals. Distinct from the dashboard's internal
// endpoints; every call requires an API key (x-api-key or Bearer) with the right
// scope. Keys are minted by an admin and stored only as SHA-256 hashes.

export const SIGNAL_SCOPES = ['policy', 'identity', 'risk', 'permission', 'appstate'];

// Middleware factory: require an active API key carrying `scope` (or 'all').
function requireApiKey(db, scope) {
  return a(async (req, res, next) => {
    const presented =
      req.get('x-api-key') ||
      (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || '';
    if (!presented) return res.status(401).json({ error: 'API key required (x-api-key header)' });
    const key = await db.collection('api_keys').findOne({ key_hash: hashApiKey(presented), active: true });
    if (!key) return res.status(401).json({ error: 'invalid or revoked API key' });
    const scopes = key.scopes || [];
    if (!scopes.includes('all') && !scopes.includes(scope)) {
      return res.status(403).json({ error: `API key lacks scope '${scope}'` });
    }
    req.apiClient = { id: key.id, name: key.name, scopes };
    db.collection('api_keys').updateOne({ id: key.id }, { $set: { last_used_at: new Date() } }).catch(() => {});
    next();
  });
}

export function mountSignals(app, db) {
  // ── API key management (admin) ──────────────────────────────────────────────
  app.post('/api/v1/integration/keys', requireAdminAuth, a(async (req, res) => {
    const { name, scopes } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const scopeList = Array.isArray(scopes) && scopes.length ? scopes : ['all'];
    const bad = scopeList.filter((s) => s !== 'all' && !SIGNAL_SCOPES.includes(s));
    if (bad.length) return res.status(400).json({ error: `unknown scopes: ${bad.join(',')}` });

    const { key, hash, hint } = generateApiKey();
    const doc = { id: crypto.randomUUID(), name, key_hash: hash, key_hint: hint,
      scopes: scopeList, active: true, created_at: new Date(), last_used_at: null };
    await db.collection('api_keys').insertOne(doc);
    res.status(201).json({ id: doc.id, name, scopes: scopeList, key,
      note: 'Copy this key now — only its hash is stored and it will not be shown again.' });
  }));

  app.get('/api/v1/integration/keys', requireAdminAuth, a(async (req, res) => {
    const rows = await db.collection('api_keys')
      .find({}).project({ _id: 0, key_hash: 0 }).toArray();
    res.json({ scopes: SIGNAL_SCOPES, keys: rows });
  }));

  app.delete('/api/v1/integration/keys/:id', requireAdminAuth, a(async (req, res) => {
    await db.collection('api_keys').updateOne({ id: req.params.id }, { $set: { active: false } });
    res.json({ ok: true });
  }));

  // ── Signals (scoped, API-key authenticated) ─────────────────────────────────

  // POLICY — sanctions catalog + blocked platforms.
  app.get('/api/v1/signals/policy', requireApiKey(db, 'policy'), a(async (req, res) => {
    const [sanctions, blocked] = await Promise.all([
      db.collection('sanctions').find({}).project({ _id: 0 }).toArray().catch(() => []),
      db.collection('ai_platforms').find({ blocked: true }).project({ _id: 0, host: 1, vendor: 1, product: 1, capture_mode: 1 }).toArray().catch(() => []),
    ]);
    res.json({ generated_at: new Date().toISOString(), sanctions, blocked_platforms: blocked });
  }));

  // IDENTITY — enrolled machines and their resolved users.
  app.get('/api/v1/signals/identity', requireApiKey(db, 'identity'), a(async (req, res) => {
    const machines = await db.collection('machines')
      .find({}).project({ _id: 0, id: 1, hostname: 1, user: 1, platform: 1, last_seen: 1 }).toArray();
    res.json({ generated_at: new Date().toISOString(), machines });
  }));

  // RISK — sensitive-data attempts (blocks) by service + severity over a window.
  app.get('/api/v1/signals/risk', requireApiKey(db, 'risk'), a(async (req, res) => {
    const events = await db.collection('dlp_events')
      .find({ event_kind: { $in: ['enforcement_block', 'enforcement_override'] } })
      .project({ _id: 0, ai_service: 1, secret_class: 1, event_kind: 1, occurred_at: 1 })
      .toArray();
    const byService = {};
    for (const e of events) {
      const k = e.ai_service || 'unknown';
      byService[k] = byService[k] || { service: k, blocks: 0, overrides: 0, critical: 0, high: 0 };
      if (e.event_kind === 'enforcement_override') byService[k].overrides += 1; else byService[k].blocks += 1;
      if (e.secret_class === 'critical') byService[k].critical += 1;
      if (e.secret_class === 'high') byService[k].high += 1;
    }
    res.json({ generated_at: new Date().toISOString(), total_events: events.length, by_service: Object.values(byService) });
  }));

  // PERMISSION — MCP servers discovered and the scopes/capabilities granted.
  app.get('/api/v1/signals/permission', requireApiKey(db, 'permission'), a(async (req, res) => {
    const mcp = await db.collection('findings')
      .find({ type: 'mcp_server' }).project({ _id: 0, machine_id: 1, payload: 1 }).limit(2000).toArray().catch(() => []);
    const servers = mcp.map((f) => ({
      machine_id: f.machine_id,
      client: f.payload?.client || null,
      server: f.payload?.serverName || null,
      scopes: f.payload?.scopes || [],
      command: [f.payload?.command, ...(f.payload?.args || [])].filter(Boolean).join(' ') || null,
    }));
    res.json({ generated_at: new Date().toISOString(), mcp_servers: servers });
  }));

  // APP-STATE — the AI platform registry (discovered + governed + blocked).
  app.get('/api/v1/signals/appstate', requireApiKey(db, 'appstate'), a(async (req, res) => {
    const platforms = await db.collection('ai_platforms')
      .find({}).project({ _id: 0, host: 1, vendor: 1, product: 1, category: 1, source: 1, governed: 1, blocked: 1, capture_mode: 1, updated_at: 1 }).toArray();
    res.json({ generated_at: new Date().toISOString(), platforms });
  }));
}
