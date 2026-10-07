// Intelligent Model Routing — rules (schema v2, lib/routing-schema.js), catalog
// overrides, settings, the machine-facing policy document, and analytics.
//
// HOW CLIENTS GET POLICY. The browser extension and desktop agent poll
// GET /api/v1/routing/policy (machine token, ETag → 304) and evaluate routing
// locally; the server is never asked per prompt. What they DID is reported back
// as `model_routed` events through POST /api/v1/dlp, and the analytics below
// read those events — they are the only real record of routing.
//
// AUTH. Writes go through requireReviewAuth: there is no admin sign-in yet, so
// it is open by default and closed with ADMIN_AUTH_OPEN=false — the same gate as
// the access-request queue. Reads the dashboard needs stay open, as they were.
//
// REMOVED: POST /routing/decide (no callers; it evaluated v1 rules server-side)
// and POST /routing/log (no callers; it wrote routing_log, which analytics no
// longer reads).

import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth, requireReviewAuth } from '../auth.js';
import { resolveFeatures } from './feature-settings.js';
import {
  SCHEMA_VERSION, RULE_SURFACES, DEFAULT_SETTINGS, SETTINGS_REV,
  normalizeRuleInput, normalizeCatalogOverride, normalizeSettings,
  toLegacyView, policyVersion,
} from '../lib/routing-schema.js';
import {
  RESPONSE_BUDGET_MS, raceWithFallback, applyBudgetHeaders, registerResponseWarmer,
} from '../lib/response-budget.js';

const LOG_ROUTE = 'routing.log';
const ANALYTICS_ROUTE = 'routing.analytics';
const SETTINGS_ID = 'default';

export function mountRouting(app, db) {
  const rules     = () => db.collection('routing_rules');
  const endpoints = () => db.collection('routing_endpoints');
  const overrides = () => db.collection('routing_catalog_overrides');
  const settingsC = () => db.collection('routing_settings');

  const readSettings = async () => {
    const doc = await settingsC().findOne({ id: SETTINGS_ID });
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof doc?.[k] === 'boolean') out[k] = doc[k];
    return out;
  };
  const readOverrides = () => overrides()
    .find({}).sort({ provider: 1 }).project({ _id: 0 }).toArray();

  // ── Policy (machine-facing) ─────────────────────────────────────────────

  // The one document a client needs. Enabled rules only, sorted by priority;
  // ?surface=browser|desktop_app|api_proxy trims to rules scoped to it. The
  // version is a content hash of the returned payload, sent as a strong ETag.
  app.get('/api/v1/routing/policy', requireMachineAuth, a(async (req, res) => {
    const surface = req.query.surface ? String(req.query.surface) : null;
    if (surface && !RULE_SURFACES.includes(surface)) {
      return res.status(400).json({ error: `unknown surface: ${surface}` });
    }
    const [ruleRows, overrideRows, settings, features] = await Promise.all([
      rules().find({ enabled: true }).sort({ priority: 1 }).project({ _id: 0 }).toArray(),
      readOverrides(),
      readSettings(),
      resolveFeatures(db),
    ]);

    const policyRules = ruleRows
      .filter((r) => r.schema_version === SCHEMA_VERSION)
      .filter((r) => !surface || (r.scope?.surfaces || RULE_SURFACES).includes(surface))
      .map(policyRule);
    const catalogOverrides = overrideRows.map(({ provider, host_or_app, tier, label }) =>
      ({ provider, host_or_app, tier, label }));
    const fleetEnabled = features.features?.model_routing?.status !== 'disabled';

    const body = {
      schema_version: SCHEMA_VERSION,
      rules: policyRules,
      catalog_overrides: catalogOverrides,
      settings,
      fleet_enabled: fleetEnabled,
    };
    const version = policyVersion(body);
    const etag = `"${version}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'no-cache');
    const inm = String(req.headers['if-none-match'] || '');
    if (inm && inm.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) {
      return res.status(304).end();
    }
    res.json({ version, ...body, generated_at: new Date().toISOString() });
  }));

  // ── Rules ───────────────────────────────────────────────────────────────

  // LEGACY READ, kept for one release: clients that predate the policy endpoint
  // poll this unauthenticated and act on action.ui_name / action.model, so v2
  // rules are projected back to that shape (toLegacyView — additive). The
  // dashboard asks for the stored v2 documents with ?schema=2.
  app.get('/api/v1/routing/rules', a(async (req, res) => {
    const rows = await rules().find({}).sort({ priority: 1 }).project({ _id: 0 }).toArray();
    if (String(req.query.schema || '') === String(SCHEMA_VERSION)) return res.json(rows);
    const ovs = await readOverrides();
    res.json(rows.map((r) => toLegacyView(r, ovs)));
  }));

  app.post('/api/v1/routing/rules', requireReviewAuth, a(async (req, res) => {
    const { value, error } = normalizeRuleInput(req.body);
    if (error) return res.status(400).json({ error });
    const now = new Date();
    const rule = { id: crypto.randomUUID(), ...value, created_at: now, updated_at: now };
    await rules().insertOne(rule);
    res.status(201).json({ ok: true, id: rule.id });
  }));

  app.put('/api/v1/routing/rules/:id', requireReviewAuth, a(async (req, res) => {
    const { value, error } = normalizeRuleInput(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const existing = await rules().findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'rule not found' });
    // A partial update to a rule still on v1 (the migration could not have run
    // yet only on a server that failed to seed) must not stamp schema_version 2
    // onto a v1 action. Only claim v2 when the stored action is v2-shaped.
    const update = { ...value, updated_at: new Date() };
    if (!value.action && !existing.action?.type) delete update.schema_version;
    await rules().updateOne({ id: req.params.id }, { $set: update });
    res.json({ ok: true });
  }));

  app.delete('/api/v1/routing/rules/:id', requireReviewAuth, a(async (req, res) => {
    await rules().deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  // ── Catalog overrides (admin picker-label corrections) ──────────────────

  app.get('/api/v1/routing/catalog-overrides', a(async (_req, res) => {
    res.json(await readOverrides());
  }));

  // Upsert on (provider, host_or_app, tier): one label per slot.
  app.put('/api/v1/routing/catalog-overrides', requireReviewAuth, a(async (req, res) => {
    const { value, error } = normalizeCatalogOverride(req.body);
    if (error) return res.status(400).json({ error });
    const key = { provider: value.provider, host_or_app: value.host_or_app, tier: value.tier };
    const existing = await overrides().findOne(key);
    const now = new Date();
    if (existing) {
      await overrides().updateOne({ id: existing.id }, { $set: { label: value.label, updated_at: now } });
      return res.json({ ok: true, id: existing.id });
    }
    const id = crypto.randomUUID();
    await overrides().insertOne({ id, ...value, source: 'admin', created_at: now, updated_at: now });
    res.status(201).json({ ok: true, id });
  }));

  app.delete('/api/v1/routing/catalog-overrides/:id', requireReviewAuth, a(async (req, res) => {
    await overrides().deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  // ── Settings ────────────────────────────────────────────────────────────

  app.get('/api/v1/routing/settings', a(async (_req, res) => {
    res.json(await readSettings());
  }));

  app.put('/api/v1/routing/settings', requireReviewAuth, a(async (req, res) => {
    const { value, error } = normalizeSettings(req.body, await readSettings());
    if (error) return res.status(400).json({ error });
    await settingsC().updateOne(
      { id: SETTINGS_ID },
      // settings_rev marks a doc written after the respect_user_override
      // default flipped, so migrateRoutingSettings never touches it.
      { $set: { id: SETTINGS_ID, ...value, settings_rev: SETTINGS_REV, updated_at: new Date() } },
      { upsert: true },
    );
    res.json(value);
  }));

  // ── Endpoints (api_proxy targets) ───────────────────────────────────────

  app.get('/api/v1/routing/endpoints', a(async (req, res) => {
    const rows = await endpoints()
      .find({}).sort({ name: 1 }).project({ _id: 0 }).toArray();
    res.json(rows);
  }));

  app.post('/api/v1/routing/endpoints', requireReviewAuth, a(async (req, res) => {
    const { name, provider, host, models, region, pricing, enabled = true } = req.body ?? {};
    if (!name || !provider) {
      return res.status(400).json({ error: 'name and provider are required' });
    }
    const ep = {
      id: crypto.randomUUID(),
      name,
      provider,
      host: host || null,
      models: models || [],
      region: region || null,
      pricing: pricing || null,
      enabled: !!enabled,
      health: { status: 'unknown', last_check: null, latency_ms: null },
      created_at: new Date(),
      updated_at: new Date(),
    };
    await endpoints().insertOne(ep);
    res.status(201).json({ ok: true, id: ep.id });
  }));

  app.put('/api/v1/routing/endpoints/:id', requireReviewAuth, a(async (req, res) => {
    const { name, provider, host, models, region, pricing, enabled } = req.body ?? {};
    const update = { updated_at: new Date() };
    if (name !== undefined)     update.name     = name;
    if (provider !== undefined) update.provider = provider;
    if (host !== undefined)     update.host     = host;
    if (models !== undefined)   update.models   = models;
    if (region !== undefined)   update.region   = region;
    if (pricing !== undefined)  update.pricing  = pricing;
    if (enabled !== undefined)  update.enabled  = !!enabled;
    const result = await endpoints().updateOne({ id: req.params.id }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'endpoint not found' });
    res.json({ ok: true });
  }));

  app.delete('/api/v1/routing/endpoints/:id', requireReviewAuth, a(async (req, res) => {
    await endpoints().deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  // ── Routing log (dashboard read) ────────────────────────────────────────

  app.get('/api/v1/routing/log', a(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const result = await raceWithFallback({
      route: LOG_ROUTE, params: { limit }, budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchRoutingLog(db, limit),
    });
    if (result.failed) throw result.error;
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  registerResponseWarmer(LOG_ROUTE, () => raceWithFallback({
    route: LOG_ROUTE, params: { limit: 100 }, budgetMs: RESPONSE_BUDGET_MS,
    live: () => fetchRoutingLog(db, 100),
  }));

  // ── Analytics ───────────────────────────────────────────────────────────

  app.get('/api/v1/routing/analytics', a(async (req, res) => {
    const result = await raceWithFallback({
      route: ANALYTICS_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS,
      live: () => fetchRoutingAnalytics(db),
    });
    if (result.failed) throw result.error;
    applyBudgetHeaders(res, result);
    res.json(result.value);
  }));

  registerResponseWarmer(ANALYTICS_ROUTE, () => raceWithFallback({
    route: ANALYTICS_ROUTE, params: null, budgetMs: RESPONSE_BUDGET_MS,
    live: () => fetchRoutingAnalytics(db),
  }));
}

/** The client-facing projection of a stored rule: no audit or migration fields. */
function policyRule(r) {
  const { created_at, updated_at, migrated_from_v1, _id, ...rest } = r;
  return rest;
}

// ── Analytics over dlp_events model_routed ────────────────────────────────

// "Requests Routed" means the model actually CHANGED. New events carry a
// top-level routing_result (dlp.js); events from clients that predate it only
// have metadata.ui_changed, so `true` there counts as applied.
const APPLIED = {
  event_kind: 'model_routed',
  $or: [
    { routing_result: 'applied' },
    { routing_result: { $exists: false }, metadata_json: { $regex: '"ui_changed":true' } },
  ],
};
// The per-model / per-rule / per-complexity breakdowns and the trend are over
// this window, bounded, so the read cannot grow with the event table.
const BREAKDOWN_DAYS = 14;
const BREAKDOWN_ROW_CAP = 5000;

const parseMeta = (v) => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}') || {}; } catch { return {}; }
};

const SOURCE_FOR_MECHANISM = {
  browser_extension: 'browser_extension',
  desktop_uia: 'desktop_agent',
  desktop_web_uia: 'desktop_agent',
  proxy: 'proxy',
};

async function fetchRoutingAnalytics(db) {
  const events = db.collection('dlp_events');
  const now = Date.now();
  const since24h = new Date(now - 86400000).toISOString();
  const since7d = new Date(now - 7 * 86400000).toISOString();
  const sinceWin = new Date(now - BREAKDOWN_DAYS * 86400000).toISOString();

  // Independent reads, issued at once (see the history in the analytics test).
  const [total, last24h, last7d, activeRules, activeEndpoints, recent, ruleNames] = await Promise.all([
    events.countDocuments(APPLIED),
    events.countDocuments({ ...APPLIED, occurred_at: { $gte: since24h } }),
    events.countDocuments({ ...APPLIED, occurred_at: { $gte: since7d } }),
    db.collection('routing_rules').countDocuments({ enabled: true }),
    db.collection('routing_endpoints').countDocuments({ enabled: true }),
    events.find({ ...APPLIED, occurred_at: { $gte: sinceWin } })
      .sort({ occurred_at: -1 }).limit(BREAKDOWN_ROW_CAP)
      .project({ _id: 0, occurred_at: 1, metadata_json: 1 }).toArray(),
    db.collection('routing_rules').find({}).project({ _id: 0, id: 1, name: 1 }).toArray(),
  ]);

  const nameById = new Map(ruleNames.map((r) => [r.id, r.name]));
  const byModel = new Map();
  const byRule = new Map();
  const byComplexity = new Map();
  const byDay = new Map();
  const bump = (m, k, init) => { const cur = m.get(k) || { ...init, count: 0 }; cur.count++; m.set(k, cur); };

  for (const row of recent) {
    const m = parseMeta(row.metadata_json);
    const from = m.from_label || m.from_tier || m.current_tier || null;
    const to = m.to_label || m.model || m.routed_model || m.to_tier || null;
    bump(byModel, `${from}\u0000${to}`, { from, to });
    const rid = m.rule_id || null;
    const rname = (rid && nameById.get(rid)) || m.rule_name || null;
    bump(byRule, `${rid}\u0000${rname}`, { id: rid, name: rname });
    if (m.complexity) bump(byComplexity, m.complexity, { complexity: m.complexity });
    const day = String(row.occurred_at || '').slice(0, 10);
    if (day) bump(byDay, day, { date: day });
  }
  const desc = (m) => [...m.values()].sort((x, y) => y.count - x.count);

  return {
    total_routed: total,
    last_24h: last24h,
    last_7d: last7d,
    active_rules: activeRules,
    active_endpoints: activeEndpoints,
    by_model: desc(byModel).slice(0, 20),
    by_rule: desc(byRule).slice(0, 20),
    // Sensitivity is not part of a routing event (it would be DLP content-
    // adjacent); kept as an empty list so the response shape is unchanged.
    by_sensitivity: [],
    by_complexity: desc(byComplexity),
    daily_trend: [...byDay.values()].sort((x, y) => (x.date < y.date ? -1 : 1)),
    breakdown_window_days: BREAKDOWN_DAYS,
  };
}

async function fetchRoutingLog(db, limit) {
  const [rows, ruleNames] = await Promise.all([
    db.collection('dlp_events')
      .find({ event_kind: 'model_routed' })
      .sort({ occurred_at: -1 }).limit(limit)
      .project({ _id: 0, id: 1, machine_id: 1, occurred_at: 1, ai_service: 1, source: 1, routing_result: 1, metadata_json: 1 })
      .toArray(),
    db.collection('routing_rules').find({}).project({ _id: 0, id: 1, name: 1 }).toArray(),
  ]);
  const nameById = new Map(ruleNames.map((r) => [r.id, r.name]));
  return rows.map((r) => {
    const m = parseMeta(r.metadata_json);
    const result = r.routing_result
      || (m.ui_changed === true ? 'applied' : m.ui_changed === false ? 'noop' : null);
    return {
      id: r.id,
      timestamp: r.occurred_at,
      machine_id: r.machine_id,
      original_model: m.from_label || m.from_tier || null,
      routed_model: m.to_label || m.model || m.routed_model || m.to_tier || null,
      rule_id: m.rule_id || null,
      rule_name: (m.rule_id && nameById.get(m.rule_id)) || m.rule_name || null,
      sensitivity: null,
      complexity: m.complexity || null,
      provider: m.provider || null,
      from_tier: m.from_tier || m.current_tier || null,
      to_tier: m.to_tier || null,
      effort_from: m.effort_from || null,
      effort_to: m.effort_to || null,
      result,
      mechanism: m.mechanism || null,
      surface: m.surface || null,
      host_or_app: m.host_or_app || m.tab_host || null,
      prompt_tokens_est: null,
      ai_service: r.ai_service || null,
      source: SOURCE_FOR_MECHANISM[m.mechanism] || r.source || 'browser_extension',
    };
  });
}
