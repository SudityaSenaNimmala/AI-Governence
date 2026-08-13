// Server-side AI agent governance — ingest + query routes.
//
// Ingest:  POST /api/v1/server-agent-events   (machine-authenticated)
// Queries: GET  /api/v1/server-agents/calls   recent invocations
//          GET  /api/v1/server-agents/summary cost + counts by dimension
//          GET  /api/v1/server-agents/calls/:id  single call with full content

import crypto from 'node:crypto';
import { a } from '../util.js';
import { requireMachineAuth } from '../auth.js';

// Caps per-event content size.
const MAX_PROMPT_BYTES   = 5 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

// ── Client-authoritative pricing (USD per 1M tokens) ─────────────────────
// Cost is always recalculated from model + tokens, never from stored values.
const PRICING = [
  { m: /^claude-opus-4/,           input: 15.00, output: 75.00, cached: 1.50 },
  { m: /^claude-sonnet-4/,         input: 3.00,  output: 15.00, cached: 0.30 },
  { m: /^claude-haiku-4/,          input: 1.00,  output: 5.00,  cached: 0.10 },
  { m: /^claude-3-5-sonnet/,       input: 3.00,  output: 15.00, cached: 0.30 },
  { m: /^claude-3-5-haiku/,        input: 0.80,  output: 4.00,  cached: 0.08 },
  { m: /^claude-3-opus/,           input: 15.00, output: 75.00, cached: 1.50 },
  { m: /^gpt-4\.1-nano/,           input: 0.10,  output: 0.40,  cached: 0.025 },
  { m: /^gpt-4\.1-mini/,           input: 0.40,  output: 1.60,  cached: 0.10 },
  { m: /^gpt-4\.1/,                input: 2.00,  output: 8.00,  cached: 0.50 },
  { m: /^gpt-4o-mini/,             input: 0.15,  output: 0.60,  cached: 0.075 },
  { m: /^gpt-4o/,                  input: 2.50,  output: 10.00, cached: 1.25 },
  { m: /^gpt-4-turbo/,             input: 10.00, output: 30.00, cached: 10.00 },
  { m: /^gpt-4(?![\.\do]|-turbo)/, input: 30.00, output: 60.00, cached: 30.00 },
  { m: /^gpt-3\.5-turbo/,          input: 0.50,  output: 1.50,  cached: 0.50 },
  { m: /^o3-mini/,                 input: 1.10,  output: 4.40,  cached: 0.55 },
  { m: /^o3/,                      input: 10.00, output: 40.00, cached: 2.50 },
  { m: /^o1-mini/,                 input: 3.00,  output: 12.00, cached: 1.50 },
  { m: /^o1/,                      input: 15.00, output: 60.00, cached: 7.50 },
  { m: /^gemini-2\.5-pro/,         input: 1.25,  output: 10.00, cached: 0.31 },
  { m: /^gemini-2\.5-flash/,       input: 0.30,  output: 2.50,  cached: 0.075 },
  { m: /^gemini-1\.5-pro/,         input: 1.25,  output: 5.00,  cached: 0.31 },
  { m: /^gemini-1\.5-flash/,       input: 0.075, output: 0.30,  cached: 0.019 },
];
function calcCost(model, promptTokens = 0, completionTokens = 0, cachedTokens = 0) {
  if (!model) return 0;
  const p = PRICING.find(r => r.m.test(model));
  if (!p) return 0;
  const billed = Math.max(0, promptTokens - cachedTokens);
  return (billed * p.input + cachedTokens * p.cached + completionTokens * p.output) / 1_000_000;
}
// Sum cost across an array of calls/traces that have model + token fields
function sumCost(rows) {
  return rows.reduce((t, r) => t + calcCost(r.model || r._id, r.prompt_tokens || 0, r.completion_tokens || 0, r.cached_tokens || 0), 0);
}

export function mountServerAgents(app, db) {
  app.post('/api/v1/server-agent-events', requireMachineAuth, a(async (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });
    if (events.length > 200) return res.status(413).json({ error: 'batch too large (max 200)' });

    let stored = 0;
    for (const e of events) {
      const v = validateEvent(e);
      if (v.error) continue;

      const attr = e.attribution || {};
      const cost = e.cost || {};

      await db.collection('server_agent_calls').insertOne({
        id: crypto.randomUUID(),
        machine_id: req.machine.id,
        occurred_at: e.occurred_at,
        duration_ms: e.duration_ms ?? null,
        response_status: e.response_status ?? null,
        host: e.host,
        path: e.path ?? null,
        method: e.method ?? null,
        provider: e.provider ?? null,
        model: e.model ?? null,
        prompt_tokens: e.prompt_tokens ?? null,
        completion_tokens: e.completion_tokens ?? null,
        cached_tokens: e.cached_tokens ?? null,
        total_cost_usd: cost.total_cost_usd ?? null,
        input_cost_usd: cost.input_cost_usd ?? null,
        output_cost_usd: cost.output_cost_usd ?? null,
        cached_cost_usd: cost.cached_cost_usd ?? null,
        pricing_version: cost.pricing_version ?? null,
        pid: attr.pid ?? null,
        uid: attr.uid ?? null,
        loginuid: attr.loginuid ?? null,
        user: attr.user ?? null,
        cmdline: attr.cmdline ?? null,
        exe: attr.exe ?? null,
        cwd: attr.cwd ?? null,
        trigger_source: attr.trigger_source ?? null,
        parent_chain_json: attr.parent_chain ? JSON.stringify(attr.parent_chain) : null,
        source_ip: e.source_ip ?? null,
        prompt_text: truncate(e.prompt_text, MAX_PROMPT_BYTES),
        response_text: truncate(e.response_text, MAX_RESPONSE_BYTES),
        response_truncated: e.response_truncated ? 1 : 0,
        received_at: new Date(),
      });
      stored++;
    }

    res.status(201).json({ ok: true, stored });
  }));

  // Recent calls — paginated, optionally filtered.
  app.get('/api/v1/server-agents/calls', a(async (req, res) => {
    const { user, provider, model, trigger, machineId, sourceIp, from, to, limit = 1000 } = req.query;
    const filter = {};
    if (sourceIp)  filter.source_ip = sourceIp;
    if (user)      filter.user = user;
    if (provider)  filter.provider = provider;
    if (model)     filter.model = model;
    if (trigger)   filter.trigger_source = trigger;
    if (machineId) filter.machine_id = machineId;
    if (from || to) {
      filter.occurred_at = {};
      if (from) filter.occurred_at.$gte = from;
      if (to) filter.occurred_at.$lte = to;
    }
    const lim = Math.min(Number(limit) || 1000, 10000);

    const rows = await db.collection('server_agent_calls')
      .find(filter)
      .sort({ occurred_at: -1 })
      .limit(lim)
      .project({
        _id: 0, id: 1, machine_id: 1, occurred_at: 1, duration_ms: 1, response_status: 1,
        host: 1, path: 1, method: 1, provider: 1, model: 1,
        prompt_tokens: 1, completion_tokens: 1, cached_tokens: 1, total_cost_usd: 1, pricing_version: 1,
        pid: 1, user: 1, cmdline: 1, cwd: 1, trigger_source: 1,
        prompt_text: 1, response_text: 1,
      })
      .toArray();

    res.json(rows.map((r) => ({
      ...r,
      has_prompt: r.prompt_text != null,
      has_response: r.response_text != null,
      prompt_text: undefined,
      response_text: undefined,
    })));
  }));

  // Single call with full prompt + response.
  app.get('/api/v1/server-agents/calls/:id', a(async (req, res) => {
    const id = req.params.id;
    const row = await db.collection('server_agent_calls').findOne(
      { id },
      { projection: { _id: 0 } },
    );
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.parent_chain_json) {
      try { row.parent_chain = typeof row.parent_chain_json === 'string' ? JSON.parse(row.parent_chain_json) : row.parent_chain_json; } catch {}
    }
    res.json(row);
  }));

  // Signal events
  app.post('/api/v1/server-agent-signals', requireMachineAuth, a(async (req, res) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events array required' });
    if (events.length > 500) return res.status(413).json({ error: 'batch too large (max 500)' });

    let stored = 0;
    for (const e of events) {
      if (!e?.occurred_at || !e?.kind) continue;
      const attr = e.attribution || {};
      await db.collection('server_agent_signals').insertOne({
        id: crypto.randomUUID(),
        machine_id: req.machine.id,
        occurred_at: e.occurred_at,
        kind: e.kind,
        pid: attr.pid ?? null,
        uid: attr.uid ?? null,
        loginuid: attr.loginuid ?? null,
        user: attr.user ?? null,
        cmdline: attr.cmdline ?? null,
        exe: attr.exe ?? null,
        cwd: attr.cwd ?? null,
        trigger_source: attr.trigger_source ?? null,
        details_json: e.details ? JSON.stringify(e.details) : null,
        received_at: new Date(),
      });
      stored++;
    }
    res.status(201).json({ ok: true, stored });
  }));

  app.get('/api/v1/server-agents/signals', a(async (req, res) => {
    const { kind, user, limit = 200 } = req.query;
    const filter = {};
    if (kind) filter.kind = kind;
    if (user) filter.user = user;
    const lim = Math.min(Number(limit) || 200, 1000);
    const rows = await db.collection('server_agent_signals')
      .find(filter)
      .sort({ occurred_at: -1 })
      .limit(lim)
      .project({ _id: 0, id: 1, machine_id: 1, occurred_at: 1, kind: 1, pid: 1, user: 1, cmdline: 1, cwd: 1, trigger_source: 1, details_json: 1 })
      .toArray();
    res.json(rows.map((r) => ({ ...r, details: safeJson(r.details_json) })));
  }));

  // Summary — totals, broken down by user, provider, model, trigger_source.
  app.get('/api/v1/server-agents/summary', a(async (req, res) => {
    // Group by model to recalculate cost from tokens
    const totalsPerModel = await db.collection('server_agent_calls').aggregate([
      {
        $group: {
          _id: '$model',
          calls: { $sum: 1 },
          prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } },
          completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } },
          cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } },
          distinct_users: { $addToSet: '$user' },
          distinct_machines: { $addToSet: '$machine_id' },
        },
      },
    ]).toArray();

    const allUsers = new Set(); const allMachines = new Set(); const allModels = new Set();
    let totalCalls = 0, totalPrompt = 0, totalCompletion = 0, totalCostUsd = 0;
    for (const r of totalsPerModel) {
      totalCalls += r.calls;
      totalPrompt += r.prompt_tokens;
      totalCompletion += r.completion_tokens;
      totalCostUsd += calcCost(r._id, r.prompt_tokens, r.completion_tokens, r.cached_tokens);
      r.distinct_users.filter(Boolean).forEach(u => allUsers.add(u));
      r.distinct_machines.filter(Boolean).forEach(m => allMachines.add(m));
      if (r._id) allModels.add(r._id);
    }
    const totals = {
      calls: totalCalls, total_cost_usd: totalCostUsd,
      prompt_tokens: totalPrompt, completion_tokens: totalCompletion,
      distinct_users: allUsers.size, distinct_machines: allMachines.size, distinct_models: allModels.size,
    };

    // byUser — group by user+model to recalculate cost
    const byUserRaw = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: { user: { $ifNull: ['$user', '(unknown)'] }, model: '$model' }, calls: { $sum: 1 }, prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } }, completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } }, cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } } } },
    ]).toArray();
    const userMap = new Map();
    for (const r of byUserRaw) {
      const u = r._id.user;
      if (!userMap.has(u)) userMap.set(u, { user: u, calls: 0, cost_usd: 0 });
      const e = userMap.get(u);
      e.calls += r.calls;
      e.cost_usd += calcCost(r._id.model, r.prompt_tokens, r.completion_tokens, r.cached_tokens);
    }
    const byUser = [...userMap.values()].sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 25);

    // byProvider — group by provider+model
    const byProvRaw = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: { provider: { $ifNull: ['$provider', '(unknown)'] }, model: '$model' }, calls: { $sum: 1 }, prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } }, completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } }, cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } } } },
    ]).toArray();
    const provMap = new Map();
    for (const r of byProvRaw) {
      const p = r._id.provider;
      if (!provMap.has(p)) provMap.set(p, { provider: p, calls: 0, cost_usd: 0 });
      const e = provMap.get(p);
      e.calls += r.calls;
      e.cost_usd += calcCost(r._id.model, r.prompt_tokens, r.completion_tokens, r.cached_tokens);
    }
    const byProvider = [...provMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);

    // byModel — already grouped by model
    const byModelRaw = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: { $ifNull: ['$model', '(unknown)'] }, calls: { $sum: 1 }, prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } }, completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } }, cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } } } },
      { $limit: 25 },
    ]).toArray();
    const byModel = byModelRaw.map(r => ({
      model: r._id, calls: r.calls, prompt_tokens: r.prompt_tokens, completion_tokens: r.completion_tokens,
      cost_usd: calcCost(r._id, r.prompt_tokens, r.completion_tokens, r.cached_tokens),
    })).sort((a, b) => b.cost_usd - a.cost_usd);

    // byTrigger — group by trigger+model
    const byTrigRaw = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: { trigger: { $ifNull: ['$trigger_source', '(unknown)'] }, model: '$model' }, calls: { $sum: 1 }, prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } }, completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } }, cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } } } },
    ]).toArray();
    const trigMap = new Map();
    for (const r of byTrigRaw) {
      const t = r._id.trigger;
      if (!trigMap.has(t)) trigMap.set(t, { trigger_source: t, calls: 0, cost_usd: 0 });
      const e = trigMap.get(t);
      e.calls += r.calls;
      e.cost_usd += calcCost(r._id.model, r.prompt_tokens, r.completion_tokens, r.cached_tokens);
    }
    const byTrigger = [...trigMap.values()].sort((a, b) => b.cost_usd - a.cost_usd);

    res.json({ totals, byUser, byProvider, byModel, byTrigger });
  }));

  // ── Governed containers — register + list ───────────────────────────────
  // Called by the 'govern' CLI command after setting up a container.
  app.post('/api/v1/monitor/governed', requireMachineAuth, a(async (req, res) => {
    const { container_name, container_ip, gateway_ip } = req.body || {};
    if (!container_name) return res.status(400).json({ error: 'container_name required' });
    await db.collection('governed_containers').updateOne(
      { machine_id: req.machine.id, container_name },
      { $set: { container_name, container_ip, gateway_ip, machine_id: req.machine.id, governed_at: new Date(), status: 'active' } },
      { upsert: true },
    );
    res.json({ ok: true });
  }));

  // Remove governed container (called by 'ungovernable')
  app.delete('/api/v1/monitor/governed/:name', requireMachineAuth, a(async (req, res) => {
    await db.collection('governed_containers').updateOne(
      { machine_id: req.machine.id, container_name: req.params.name },
      { $set: { status: 'removed', removed_at: new Date() } },
    );
    res.json({ ok: true });
  }));

  // List governed containers for a server, with trace counts
  app.get('/api/v1/monitor/governed', a(async (req, res) => {
    const { machineId } = req.query;
    // Show all governed containers (including removed) — traces persist
    const filter = {};
    if (machineId) filter.machine_id = machineId;

    const containers = await db.collection('governed_containers')
      .find(filter)
      .project({ _id: 0 })
      .sort({ governed_at: -1 })
      .toArray();

    // Get trace counts + cost per container by matching source_ip
    for (const c of containers) {
      const ipFilter = c.container_ip
        ? { machine_id: c.machine_id, source_ip: c.container_ip }
        : { machine_id: c.machine_id };

      const costAgg = await db.collection('server_agent_calls').aggregate([
        { $match: ipFilter },
        { $group: { _id: '$model', calls: { $sum: 1 }, prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } }, completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } }, cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } } } },
      ]).toArray();
      c.total_cost_usd = sumCost(costAgg);
      c.total_calls = costAgg.reduce((t, r) => t + (r.calls || 0), 0);
      c.trace_count = c.total_calls;
    }

    res.json(containers);
  }));

  // ── Traces — group calls into execution traces ─────────────────────────
  app.get('/api/v1/traces/stats', a(async (req, res) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400000);
    const [totalCalls, recentCalls, enrolledCount] = await Promise.all([
      db.collection('server_agent_calls').countDocuments(),
      db.collection('server_agent_calls').countDocuments({ occurred_at: { $gte: dayAgo.toISOString() } }),
      db.collection('monitored_servers').countDocuments({}),
    ]);
    // Recalculate cost from model + tokens (not stored cost)
    const costAgg = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: '$model', prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } }, completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } }, cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } } } },
    ]).toArray();
    const totalCost = sumCost(costAgg);
    res.json({ total_calls: totalCalls, calls_last_24h: recentCalls, connected_servers: enrolledCount, total_cost_usd: totalCost });
  }));

  app.get('/api/v1/traces', a(async (req, res) => {
    const { user, provider, model, machineId, limit = 50 } = req.query;
    const filter = {};
    if (user) filter.user = user;
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (machineId) filter.machine_id = machineId;
    const lim = Math.min(Number(limit) || 50, 200);
    const calls = await db.collection('server_agent_calls')
      .find(filter).sort({ occurred_at: -1 }).limit(lim * 20)
      .project({ _id: 0, id: 1, machine_id: 1, occurred_at: 1, duration_ms: 1, response_status: 1, provider: 1, model: 1, prompt_tokens: 1, completion_tokens: 1, total_cost_usd: 1, pid: 1, user: 1, cmdline: 1, cwd: 1, trigger_source: 1 })
      .toArray();
    res.json(groupIntoTraces(calls, 30000).slice(0, lim));
  }));

  app.get('/api/v1/traces/:traceId', a(async (req, res) => {
    const parts = req.params.traceId.split('|');
    if (parts.length < 3) return res.status(400).json({ error: 'invalid trace ID' });
    const [machineId, pid, startTs] = parts;
    const calls = await db.collection('server_agent_calls')
      .find({ machine_id: machineId, pid: Number(pid) || pid, occurred_at: { $gte: new Date(Number(startTs)).toISOString(), $lte: new Date(Number(startTs) + 300000).toISOString() } })
      .sort({ occurred_at: 1 }).project({ _id: 0 }).toArray();
    if (calls.length === 0) return res.status(404).json({ error: 'trace not found' });
    const first = calls[0], last = calls[calls.length - 1];
    const dur = new Date(last.occurred_at).getTime() + (last.duration_ms || 0) - new Date(first.occurred_at).getTime();
    const tokens = calls.reduce((s, c) => s + (c.prompt_tokens || 0) + (c.completion_tokens || 0), 0);
    const cost = sumCost(calls);
    res.json({
      trace_id: req.params.traceId, machine_id: machineId, pid, user: first.user, cmdline: first.cmdline, cwd: first.cwd, trigger_source: first.trigger_source, started_at: first.occurred_at,
      duration_ms: dur, call_count: calls.length, total_tokens: tokens, total_cost_usd: Math.round(cost * 1e6) / 1e6,
      status: calls.some(c => c.response_status >= 400) ? 'error' : 'ok',
      providers: [...new Set(calls.map(c => c.provider).filter(Boolean))], models: [...new Set(calls.map(c => c.model).filter(Boolean))],
      calls: calls.map(c => ({ ...c, offset_ms: new Date(c.occurred_at).getTime() - new Date(first.occurred_at).getTime() })),
    });
  }));

  // ── Install token generation ──────────────────────────────────────────
  app.post('/api/v1/monitor/generate-token', a(async (req, res) => {
    // Build server URL from: explicit host in body, or X-Forwarded-Host, or req.get('host')
    const bodyHost = req.body?.host;
    const reqHost = req.get('host');  // includes port (e.g. "165.22.223.59:8787")
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const serverUrl = bodyHost
      ? `${proto}://${bodyHost}:${reqHost?.split(':')[1] || '8787'}`
      : `${proto}://${reqHost}`;
    const port = req.body?.port || '8443';
    const authMod = await import('../auth.js');
    const payload = Buffer.from(`${serverUrl}|${authMod.ENROLL_SECRET}`).toString('base64');
    const token = `cfm_${payload}`;
    const installCmd = `curl -sSL ${serverUrl}/install-monitor.sh | sudo bash -s -- --token ${token} --port ${port}`;
    res.json({ token, install_command: installCmd, server_url: serverUrl, port });
  }));

  // ── Update script — served to monitors that run the update command ──────
  app.get('/update-monitor.sh', async (req, res) => {
    const script = `#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/cloudfuze-monitor"
REPO_URL="https://github.com/SudityaSenaNimmala/AI-Governence.git"

if [[ ! -d "\$INSTALL_DIR" ]]; then
  echo "CloudFuze monitor not installed at \$INSTALL_DIR"
  exit 1
fi

echo ""
echo "  Updating CloudFuze Server Monitor..."
echo ""

# Clone latest into temp dir
TMP=\$(mktemp -d)
trap 'rm -rf "\$TMP"' EXIT

echo "[1/5] Downloading latest version..."
git clone --depth 1 "\$REPO_URL" "\$TMP/repo" 2>&1 | tail -1

AGENT_SRC="\$TMP/repo/agent team/agent"
if [[ ! -d "\$AGENT_SRC/src/server-monitor" ]]; then
  AGENT_SRC="\$TMP/repo/agent"
fi
if [[ ! -d "\$AGENT_SRC/src/server-monitor" ]]; then
  echo "ERROR: server-monitor not found in repo."
  exit 1
fi

echo "[2/5] Replacing files..."
# Remove old source files but keep node_modules and data
for item in "\$INSTALL_DIR"/*; do
  case "\$(basename "\$item")" in
    node_modules) ;;  # keep
    *) rm -rf "\$item" ;;
  esac
done

# Copy new source files in
cp -r "\$AGENT_SRC/"* "\$INSTALL_DIR/"

echo "[3/5] Updating dependencies..."
cd "\$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund --quiet 2>&1 | tail -3

echo "[4/5] Refreshing CLI commands..."
for candidate in "\$TMP/repo/scripts/install-monitor.sh" "\$TMP/repo/agent team/scripts/install-monitor.sh"; do
  if [[ -f "\$candidate" ]]; then
    mkdir -p "\$INSTALL_DIR/scripts"
    cp "\$candidate" "\$INSTALL_DIR/scripts/install-monitor.sh"
    chmod +x "\$INSTALL_DIR/scripts/install-monitor.sh"
    # Extract the CONTENT between the heredoc markers (not the cat command itself)
    # and write directly to the CLI file. No bash re-interpretation needed.
    sed -n "/^cat > \\/usr\\/local\\/bin\\/cloudfuze-monitor/,/^WRAPPER/{/^cat /d;/^WRAPPER/d;p}" "\$candidate" > /usr/local/bin/cloudfuze-monitor
    chmod +x /usr/local/bin/cloudfuze-monitor 2>/dev/null
    echo "  CLI commands updated."
    break
  fi
done

echo "[5/6] Updating systemd unit..."
# Update systemd unit to use 0.0.0.0 (needed for Docker bridge traffic)
sed -i "s|PROXY_LISTEN_HOST=127.0.0.1|PROXY_LISTEN_HOST=0.0.0.0|" /etc/systemd/system/cloudfuze-monitor.service 2>/dev/null || true
sed -i "s|/etc/cloudfuze/ca/ca.crt|/root/.cloudfuze-aigov/ca/ca.crt|" /etc/systemd/system/cloudfuze-monitor.service 2>/dev/null || true
systemctl daemon-reload
echo "  Systemd unit updated."

echo "[6/6] Restarting service..."
systemctl restart cloudfuze-monitor 2>/dev/null || systemctl restart cloudfuze-server-monitor 2>/dev/null || true

echo ""
echo "  Update complete."
echo "  Run 'cloudfuze-monitor help' to see all commands."
echo ""
`;
    res.type('text/plain').send(script);
  });

  app.get('/install-monitor.sh', async (req, res) => {
    const { resolve } = await import('path');
    const { existsSync } = await import('fs');
    const candidates = [
      resolve(process.cwd(), '..', 'scripts', 'install-monitor.sh'),
      resolve(process.cwd(), 'scripts', 'install-monitor.sh'),
      resolve(process.cwd(), '..', '..', 'scripts', 'install-monitor.sh'),
      '/opt/ai-gov/scripts/install-monitor.sh', '/app/scripts/install-monitor.sh',
    ];
    for (const p of candidates) { if (existsSync(p)) return res.type('text/plain').sendFile(p); }
    res.status(404).send('Install script not found. Tried: ' + candidates.join(', '));
  });

  // ── Monitor heartbeat — called periodically by the daemon ──────────────
  app.post('/api/v1/monitor/heartbeat', requireMachineAuth, a(async (req, res) => {
    // Upsert — ensures the server appears even if enrollment went to the wrong collection
    await db.collection('monitored_servers').updateOne(
      { id: req.machine.id },
      {
        $set: { last_seen: new Date(), status: 'active', hostname: req.machine.hostname, type: 'server-monitor' },
        $setOnInsert: { first_seen: new Date() },
      },
      { upsert: true },
    );
    res.json({ ok: true });
  }));

  // ── Monitor deregister — called on uninstall ─────────────────────────
  app.post('/api/v1/monitor/deregister', requireMachineAuth, a(async (req, res) => {
    await db.collection('monitored_servers').updateOne(
      { id: req.machine.id },
      { $set: { status: 'removed', removed_at: new Date() } },
    );
    res.json({ ok: true });
  }));

  // ── Connected servers list ────────────────────────────────────────────
  // Shows all enrolled server-monitor machines (appears immediately on install,
  // disappears on uninstall). Enriched with call stats from server_agent_calls.
  app.get('/api/v1/monitor/servers', a(async (req, res) => {
    // 1. Get all server-monitor machines from enrollment (excludes removed)
    // Show ALL servers including uninstalled — traces persist forever
    const enrolled = await db.collection('monitored_servers')
      .find({})
      .project({ _id: 0, id: 1, hostname: 1, last_seen: 1, first_seen: 1, proxy_port: 1, user: 1, display_name: 1 })
      .sort({ last_seen: -1 })
      .toArray();

    // 2. Get call stats per machine from server_agent_calls
    // Two-level aggregation: group by machine+model to get tokens, then roll up per machine
    const perModelStats = await db.collection('server_agent_calls').aggregate([
      { $group: {
        _id: { machine_id: '$machine_id', model: '$model' },
        calls: { $sum: 1 },
        prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } },
        completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } },
        cached_tokens: { $sum: { $ifNull: ['$cached_tokens', 0] } },
        users: { $addToSet: '$user' },
        providers: { $addToSet: '$provider' },
        last_call: { $max: '$occurred_at' },
      }},
    ]).toArray();
    // Roll up per machine
    const statsMap = new Map();
    for (const r of perModelStats) {
      const mid = r._id.machine_id;
      const model = r._id.model;
      const cost = calcCost(model, r.prompt_tokens, r.completion_tokens, r.cached_tokens);
      if (!statsMap.has(mid)) statsMap.set(mid, { total_calls: 0, total_cost_usd: 0, users: new Set(), providers: new Set(), models: new Set(), last_call: null });
      const s = statsMap.get(mid);
      s.total_calls += r.calls;
      s.total_cost_usd += cost;
      r.users.filter(Boolean).forEach(u => s.users.add(u));
      r.providers.filter(Boolean).forEach(p => s.providers.add(p));
      if (model) s.models.add(model);
      if (!s.last_call || r.last_call > s.last_call) s.last_call = r.last_call;
    }

    // 3. Merge enrollment + call stats
    const result = enrolled.map(m => {
      const s = statsMap.get(m.id) || {};
      const lastSeen = m.last_seen || m.first_seen;
      const isRemoved = m.status === 'removed';
      const isActive = !isRemoved && lastSeen && (new Date() - new Date(lastSeen)) < 300000;
      return {
        machine_id: m.id,
        hostname: m.hostname,
        display_name: m.display_name || m.hostname || m.id,
        proxy_port: m.proxy_port || null,
        status: isRemoved ? 'uninstalled' : (isActive ? 'active' : 'inactive'),
        last_seen: lastSeen,
        first_seen: m.first_seen || null,
        total_calls: s.total_calls || 0,
        total_cost_usd: s.total_cost_usd || 0,
        users: s.users ? [...s.users] : [],
        providers: s.providers ? [...s.providers] : [],
        models: s.models ? [...s.models] : [],
      };
    });

    res.json(result);
  }));
}

function groupIntoTraces(calls, gapMs) {
  const sorted = [...calls].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  const traceMap = new Map();
  for (const call of sorted) {
    const key = `${call.machine_id}|${call.pid || 'none'}`;
    const t = new Date(call.occurred_at).getTime();
    const ex = traceMap.get(key);
    if (ex && (t - ex.lastTime) < gapMs) { ex.calls.push(call); ex.lastTime = t + (call.duration_ms || 0); }
    else { traceMap.set(key, { traceId: `${call.machine_id}|${call.pid || 'none'}|${t}`, calls: [call], lastTime: t + (call.duration_ms || 0) }); }
  }
  const traces = [];
  for (const e of traceMap.values()) {
    const f = e.calls[0], l = e.calls[e.calls.length - 1];
    const dur = new Date(l.occurred_at).getTime() + (l.duration_ms || 0) - new Date(f.occurred_at).getTime();
    traces.push({ trace_id: e.traceId, machine_id: f.machine_id, pid: f.pid, user: f.user, cmdline: f.cmdline, trigger_source: f.trigger_source, started_at: f.occurred_at, duration_ms: dur, call_count: e.calls.length, total_tokens: e.calls.reduce((s, c) => s + (c.prompt_tokens || 0) + (c.completion_tokens || 0), 0), total_cost_usd: Math.round(sumCost(e.calls) * 1e6) / 1e6, status: e.calls.some(c => c.response_status >= 400) ? 'error' : 'ok', providers: [...new Set(e.calls.map(c => c.provider).filter(Boolean))], models: [...new Set(e.calls.map(c => c.model).filter(Boolean))] });
  }
  return traces.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
}

function validateEvent(e) {
  if (!e || typeof e !== 'object') return { error: 'not an object' };
  if (!e.occurred_at || !e.host) return { error: 'occurred_at + host required' };
  return { ok: true };
}

function truncate(s, max) {
  if (typeof s !== 'string') return null;
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  return s.slice(0, Math.floor(max / 4));
}

function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}
