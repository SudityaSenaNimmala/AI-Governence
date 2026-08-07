// Intelligent Model Routing — rules CRUD, endpoint registry, decision API, analytics.
//
// The proxy agent fetches rules via GET /rules, caches them locally, and
// evaluates routing decisions in <5ms without calling the server per-request.
// Routing events are reported asynchronously through the DLP reporter pipeline.
// The POST /decide endpoint exists for the browser extension and testing.

import crypto from 'node:crypto';
import { a } from '../util.js';

export function mountRouting(app, db) {
  const rules    = () => db.collection('routing_rules');
  const endpoints = () => db.collection('routing_endpoints');
  const log      = () => db.collection('routing_log');

  // ── Rules CRUD ──────────────────────────────────────────────────────

  app.get('/api/v1/routing/rules', a(async (req, res) => {
    const rows = await rules()
      .find({}).sort({ priority: 1 }).project({ _id: 0 }).toArray();
    res.json(rows);
  }));

  app.post('/api/v1/routing/rules', a(async (req, res) => {
    const { name, enabled = true, priority = 50, conditions, action } = req.body ?? {};
    if (!name || !conditions || !action) {
      return res.status(400).json({ error: 'name, conditions, and action are required' });
    }
    if (!action.model && !action.endpoint_id) {
      return res.status(400).json({ error: 'action must specify model or endpoint_id' });
    }
    const rule = {
      id: crypto.randomUUID(),
      name,
      enabled: !!enabled,
      priority: Number(priority) || 50,
      conditions,
      action,
      created_at: new Date(),
      updated_at: new Date(),
    };
    await rules().insertOne(rule);
    res.status(201).json({ ok: true, id: rule.id });
  }));

  app.put('/api/v1/routing/rules/:id', a(async (req, res) => {
    const { name, enabled, priority, conditions, action } = req.body ?? {};
    const update = { updated_at: new Date() };
    if (name !== undefined)       update.name       = name;
    if (enabled !== undefined)    update.enabled    = !!enabled;
    if (priority !== undefined)   update.priority   = Number(priority) || 50;
    if (conditions !== undefined) update.conditions = conditions;
    if (action !== undefined)     update.action     = action;
    const result = await rules().updateOne({ id: req.params.id }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'rule not found' });
    res.json({ ok: true });
  }));

  app.delete('/api/v1/routing/rules/:id', a(async (req, res) => {
    await rules().deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  // ── Endpoints CRUD ──────────────────────────────────────────────────

  app.get('/api/v1/routing/endpoints', a(async (req, res) => {
    const rows = await endpoints()
      .find({}).sort({ name: 1 }).project({ _id: 0 }).toArray();
    res.json(rows);
  }));

  app.post('/api/v1/routing/endpoints', a(async (req, res) => {
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

  app.put('/api/v1/routing/endpoints/:id', a(async (req, res) => {
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

  app.delete('/api/v1/routing/endpoints/:id', a(async (req, res) => {
    await endpoints().deleteOne({ id: req.params.id });
    res.json({ ok: true });
  }));

  // ── Routing Decision (browser extension / testing) ──────────────────

  app.post('/api/v1/routing/decide', a(async (req, res) => {
    const { host, model, sensitivity, complexity, prompt_tokens, machine_id } = req.body ?? {};
    const activeRules = await rules()
      .find({ enabled: true }).sort({ priority: 1 }).project({ _id: 0 }).toArray();
    const activeEndpoints = await endpoints()
      .find({ enabled: true }).project({ _id: 0 }).toArray();

    for (const rule of activeRules) {
      if (matchesConditions(rule.conditions, { host, model, sensitivity, complexity, prompt_tokens, machine_id })) {
        const resolved = resolveAction(rule.action, activeEndpoints, model);
        if (resolved) {
          await log().insertOne({
            id: crypto.randomUUID(),
            machine_id: machine_id || null,
            timestamp: new Date(),
            original_host: host || null,
            original_model: model || null,
            routed_model: resolved.model || model,
            routed_host: resolved.host || null,
            rule_id: rule.id,
            rule_name: rule.name,
            sensitivity: sensitivity || null,
            complexity: complexity || null,
            prompt_tokens_est: prompt_tokens || null,
          });
          return res.json({ routed: true, model: resolved.model, host: resolved.host, rule: rule.name });
        }
      }
    }
    res.json({ routed: false });
  }));

  // ── Routing Log Ingestion (from proxy reporter) ─────────────────────

  app.post('/api/v1/routing/log', a(async (req, res) => {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    if (events.length > 200) return res.status(400).json({ error: 'max 200 events per batch' });
    const docs = events.map(e => ({
      id: crypto.randomUUID(),
      machine_id: e.machine_id || null,
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      original_host: e.original_host || null,
      original_model: e.original_model || null,
      routed_model: e.routed_model || null,
      routed_host: e.routed_host || null,
      rule_id: e.rule_id || null,
      rule_name: e.rule_name || null,
      sensitivity: e.sensitivity || null,
      complexity: e.complexity || null,
      prompt_tokens_est: e.prompt_tokens_est || null,
    }));
    if (docs.length) await log().insertMany(docs);
    res.json({ ok: true, count: docs.length });
  }));

  // ── Routing Log Query ───────────────────────────────────────────────

  app.get('/api/v1/routing/log', a(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    // Routing events are stored in dlp_events (sent by browser extension as
    // kind: 'model_routed'). The dedicated routing_log collection only has
    // entries from the proxy path. Merge both sources.
    const [dlpRows, logRows] = await Promise.all([
      db.collection('dlp_events')
        .find({ event_kind: 'model_routed' })
        .sort({ occurred_at: -1 }).limit(limit)
        .project({ _id: 0, id: 1, machine_id: 1, occurred_at: 1, ai_service: 1, metadata_json: 1 })
        .toArray(),
      log().find({}).sort({ timestamp: -1 }).limit(limit).project({ _id: 0 }).toArray(),
    ]);
    // Normalize dlp_events to routing log format
    const normalized = dlpRows.map(r => {
      let meta = {};
      try { meta = typeof r.metadata_json === 'string' ? JSON.parse(r.metadata_json) : (r.metadata_json || {}); } catch {}
      return {
        timestamp: r.occurred_at,
        machine_id: r.machine_id,
        original_model: null,
        routed_model: meta.routed_model || null,
        rule_name: meta.rule_name || null,
        sensitivity: meta.sensitivity || null,
        complexity: meta.complexity || meta.current_tier || null,
        provider: meta.provider || null,
        ai_service: r.ai_service || null,
        source: 'browser_extension',
      };
    });
    // Merge and sort by time
    const all = [...normalized, ...logRows.map(r => ({ ...r, source: 'proxy' }))];
    all.sort((a, b) => (b.timestamp || b.occurred_at || '') > (a.timestamp || a.occurred_at || '') ? 1 : -1);
    res.json(all.slice(0, limit));
  }));

  // ── Analytics ───────────────────────────────────────────────────────

  app.get('/api/v1/routing/analytics', a(async (req, res) => {
    // Count from BOTH dlp_events (browser extension) and routing_log (proxy)
    const dlpRouted = await db.collection('dlp_events').countDocuments({ event_kind: 'model_routed' });
    const proxyRouted = await log().countDocuments();
    const totalRouted = dlpRouted + proxyRouted;
    const now24h = new Date(Date.now() - 86400000).toISOString();
    const now7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const dlp24h = await db.collection('dlp_events').countDocuments({ event_kind: 'model_routed', occurred_at: { $gte: now24h } });
    const dlp7d = await db.collection('dlp_events').countDocuments({ event_kind: 'model_routed', occurred_at: { $gte: now7d } });
    const last24h = dlp24h + await log().countDocuments({ timestamp: { $gte: new Date(Date.now() - 86400000) } });
    const last7d = dlp7d + await log().countDocuments({ timestamp: { $gte: new Date(Date.now() - 7 * 86400000) } });
    const activeRules  = await rules().countDocuments({ enabled: true });
    const totalEndpoints = await endpoints().countDocuments({ enabled: true });

    const byModel = await log().aggregate([
      { $group: { _id: { from: '$original_model', to: '$routed_model' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]).toArray();

    const byRule = await log().aggregate([
      { $group: { _id: { id: '$rule_id', name: '$rule_name' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]).toArray();

    const bySensitivity = await log().aggregate([
      { $match: { sensitivity: { $ne: null } } },
      { $group: { _id: '$sensitivity', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    const byComplexity = await log().aggregate([
      { $match: { complexity: { $ne: null } } },
      { $group: { _id: '$complexity', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    // Daily trend (last 14 days)
    const dailyTrend = await log().aggregate([
      { $match: { timestamp: { $gte: new Date(Date.now() - 14 * 86400000) } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]).toArray();

    res.json({
      total_routed: totalRouted,
      last_24h: last24h,
      last_7d: last7d,
      active_rules: activeRules,
      active_endpoints: totalEndpoints,
      by_model: byModel.map(r => ({ from: r._id.from, to: r._id.to, count: r.count })),
      by_rule: byRule.map(r => ({ id: r._id.id, name: r._id.name, count: r.count })),
      by_sensitivity: bySensitivity.map(r => ({ sensitivity: r._id, count: r.count })),
      by_complexity: byComplexity.map(r => ({ complexity: r._id, count: r.count })),
      daily_trend: dailyTrend.map(r => ({ date: r._id, count: r.count })),
    });
  }));
}

// ── Rule Matching ──────────────────────────────────────────────────────

function matchesConditions(conditions, ctx) {
  if (conditions.sensitivity) {
    const targets = Array.isArray(conditions.sensitivity) ? conditions.sensitivity : [conditions.sensitivity];
    if (!ctx.sensitivity || !targets.includes(ctx.sensitivity)) return false;
  }
  if (conditions.complexity) {
    const targets = Array.isArray(conditions.complexity) ? conditions.complexity : [conditions.complexity];
    if (!ctx.complexity || !targets.includes(ctx.complexity)) return false;
  }
  if (conditions.provider) {
    const targets = Array.isArray(conditions.provider) ? conditions.provider : [conditions.provider];
    const hostProvider = providerFromHost(ctx.host);
    if (!targets.includes(hostProvider)) return false;
  }
  if (conditions.model) {
    const targets = Array.isArray(conditions.model) ? conditions.model : [conditions.model];
    const modelLower = (ctx.model || '').toLowerCase();
    if (!targets.some(t => modelLower.includes(t.toLowerCase()))) return false;
  }
  if (conditions.prompt_tokens_gt != null) {
    if ((ctx.prompt_tokens || 0) <= conditions.prompt_tokens_gt) return false;
  }
  if (conditions.prompt_tokens_lt != null) {
    if ((ctx.prompt_tokens || Infinity) >= conditions.prompt_tokens_lt) return false;
  }
  return true;
}

function providerFromHost(host) {
  if (!host) return 'unknown';
  const h = host.toLowerCase();
  if (h.includes('openai'))      return 'openai';
  if (h.includes('anthropic'))   return 'anthropic';
  if (h.includes('googleapis') || h.includes('google')) return 'google';
  if (h.includes('copilot') || h.includes('microsoft')) return 'microsoft';
  if (h.includes('perplexity'))  return 'perplexity';
  if (h.includes('huggingface')) return 'huggingface';
  return 'unknown';
}

function resolveAction(action, endpoints, originalModel) {
  if (action.model) {
    return { model: action.model, host: action.host || null };
  }
  if (action.endpoint_id) {
    const ep = endpoints.find(e => e.id === action.endpoint_id);
    if (ep && ep.enabled) {
      return { model: ep.models?.[0] || originalModel, host: ep.host || null };
    }
  }
  return null;
}

// Exported for the agent-side router to reuse the same logic.
export { matchesConditions, providerFromHost, resolveAction };
