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
    const { user, provider, model, trigger, machineId, limit = 200 } = req.query;
    const filter = {};
    if (user)      filter.user = user;
    if (provider)  filter.provider = provider;
    if (model)     filter.model = model;
    if (trigger)   filter.trigger_source = trigger;
    if (machineId) filter.machine_id = machineId;
    const lim = Math.min(Number(limit) || 200, 1000);

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
    const totalsAgg = await db.collection('server_agent_calls').aggregate([
      {
        $group: {
          _id: null,
          calls: { $sum: 1 },
          total_cost_usd: { $sum: { $ifNull: ['$total_cost_usd', 0] } },
          prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } },
          completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } },
          distinct_users: { $addToSet: '$user' },
          distinct_machines: { $addToSet: '$machine_id' },
          distinct_models: { $addToSet: '$model' },
        },
      },
    ]).toArray();

    const totals = totalsAgg[0] ? {
      calls: totalsAgg[0].calls,
      total_cost_usd: totalsAgg[0].total_cost_usd,
      prompt_tokens: totalsAgg[0].prompt_tokens,
      completion_tokens: totalsAgg[0].completion_tokens,
      distinct_users: totalsAgg[0].distinct_users.filter(Boolean).length,
      distinct_machines: totalsAgg[0].distinct_machines.filter(Boolean).length,
      distinct_models: totalsAgg[0].distinct_models.filter(Boolean).length,
    } : { calls: 0, total_cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, distinct_users: 0, distinct_machines: 0, distinct_models: 0 };

    const byUser = await db.collection('server_agent_calls').aggregate([
      {
        $group: {
          _id: { $ifNull: ['$user', '(unknown)'] },
          calls: { $sum: 1 },
          cost_usd: { $sum: { $ifNull: ['$total_cost_usd', 0] } },
        },
      },
      { $project: { _id: 0, user: '$_id', calls: 1, cost_usd: 1 } },
      { $sort: { cost_usd: -1 } },
      { $limit: 25 },
    ]).toArray();

    const byProvider = await db.collection('server_agent_calls').aggregate([
      {
        $group: {
          _id: { $ifNull: ['$provider', '(unknown)'] },
          calls: { $sum: 1 },
          cost_usd: { $sum: '$total_cost_usd' },
        },
      },
      { $project: { _id: 0, provider: '$_id', calls: 1, cost_usd: 1 } },
      { $sort: { cost_usd: -1 } },
    ]).toArray();

    const byModel = await db.collection('server_agent_calls').aggregate([
      {
        $group: {
          _id: { $ifNull: ['$model', '(unknown)'] },
          calls: { $sum: 1 },
          cost_usd: { $sum: '$total_cost_usd' },
          prompt_tokens: { $sum: '$prompt_tokens' },
          completion_tokens: { $sum: '$completion_tokens' },
        },
      },
      { $project: { _id: 0, model: '$_id', calls: 1, cost_usd: 1, prompt_tokens: 1, completion_tokens: 1 } },
      { $sort: { cost_usd: -1 } },
      { $limit: 25 },
    ]).toArray();

    const byTrigger = await db.collection('server_agent_calls').aggregate([
      {
        $group: {
          _id: { $ifNull: ['$trigger_source', '(unknown)'] },
          calls: { $sum: 1 },
          cost_usd: { $sum: '$total_cost_usd' },
        },
      },
      { $project: { _id: 0, trigger_source: '$_id', calls: 1, cost_usd: 1 } },
      { $sort: { cost_usd: -1 } },
    ]).toArray();

    res.json({ totals, byUser, byProvider, byModel, byTrigger });
  }));

  // ── Traces — group calls into execution traces ─────────────────────────
  app.get('/api/v1/traces/stats', a(async (req, res) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400000);
    const [totalCalls, recentCalls, enrolledCount] = await Promise.all([
      db.collection('server_agent_calls').countDocuments(),
      db.collection('server_agent_calls').countDocuments({ occurred_at: { $gte: dayAgo.toISOString() } }),
      db.collection('monitored_servers').countDocuments({ status: { $ne: 'removed' } }),
    ]);
    const costAgg = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$total_cost_usd', 0] } } } },
    ]).toArray();
    res.json({ total_calls: totalCalls, calls_last_24h: recentCalls, connected_servers: enrolledCount, total_cost_usd: costAgg[0]?.total || 0 });
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
    const cost = calls.reduce((s, c) => s + (c.total_cost_usd || 0), 0);
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

echo "[1/4] Downloading latest version..."
git clone --depth 1 "\$REPO_URL" "\$TMP/repo" 2>&1 | tail -1

AGENT_SRC="\$TMP/repo/agent team/agent"
if [[ ! -d "\$AGENT_SRC/src/server-monitor" ]]; then
  AGENT_SRC="\$TMP/repo/agent"
fi
if [[ ! -d "\$AGENT_SRC/src/server-monitor" ]]; then
  echo "ERROR: server-monitor not found in repo."
  exit 1
fi

echo "[2/4] Replacing files..."
# Remove old source files but keep node_modules and data
for item in "\$INSTALL_DIR"/*; do
  case "\$(basename "\$item")" in
    node_modules) ;;  # keep
    *) rm -rf "\$item" ;;
  esac
done

# Copy new source files in
cp -r "\$AGENT_SRC/"* "\$INSTALL_DIR/"

echo "[3/4] Updating dependencies..."
cd "\$INSTALL_DIR"
npm install --omit=dev --no-audit --no-fund --quiet 2>&1 | tail -3

echo "[4/4] Restarting service..."
systemctl restart cloudfuze-monitor 2>/dev/null || systemctl restart cloudfuze-server-monitor 2>/dev/null || true

echo ""
echo "  Update complete. Service restarted."
echo "  Status: systemctl status cloudfuze-monitor"
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
    const enrolled = await db.collection('monitored_servers')
      .find({ status: { $ne: 'removed' } })
      .project({ _id: 0, id: 1, hostname: 1, last_seen: 1, first_seen: 1, proxy_port: 1, user: 1, display_name: 1 })
      .sort({ last_seen: -1 })
      .toArray();

    // 2. Get call stats per machine from server_agent_calls
    const callStats = await db.collection('server_agent_calls').aggregate([
      { $group: {
        _id: '$machine_id',
        total_calls: { $sum: 1 },
        total_cost_usd: { $sum: { $ifNull: ['$total_cost_usd', 0] } },
        users: { $addToSet: '$user' },
        providers: { $addToSet: '$provider' },
        models: { $addToSet: '$model' },
        last_call: { $max: '$occurred_at' },
      }},
    ]).toArray();
    const statsMap = new Map(callStats.map(s => [s._id, s]));

    // 3. Merge enrollment + call stats
    const result = enrolled.map(m => {
      const s = statsMap.get(m.id) || {};
      const lastSeen = m.last_seen || m.first_seen;
      const isActive = lastSeen && (new Date() - new Date(lastSeen)) < 300000; // 5 min
      return {
        machine_id: m.id,
        hostname: m.hostname,
        display_name: m.display_name || m.hostname || m.id,
        proxy_port: m.proxy_port || null,
        status: isActive ? 'active' : 'inactive',
        last_seen: lastSeen,
        first_seen: m.first_seen || null,
        total_calls: s.total_calls || 0,
        total_cost_usd: s.total_cost_usd || 0,
        users: (s.users || []).filter(Boolean),
        providers: (s.providers || []).filter(Boolean),
        models: (s.models || []).filter(Boolean),
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
    traces.push({ trace_id: e.traceId, machine_id: f.machine_id, pid: f.pid, user: f.user, cmdline: f.cmdline, trigger_source: f.trigger_source, started_at: f.occurred_at, duration_ms: dur, call_count: e.calls.length, total_tokens: e.calls.reduce((s, c) => s + (c.prompt_tokens || 0) + (c.completion_tokens || 0), 0), total_cost_usd: Math.round(e.calls.reduce((s, c) => s + (c.total_cost_usd || 0), 0) * 1e6) / 1e6, status: e.calls.some(c => c.response_status >= 400) ? 'error' : 'ok', providers: [...new Set(e.calls.map(c => c.provider).filter(Boolean))], models: [...new Set(e.calls.map(c => c.model).filter(Boolean))] });
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
