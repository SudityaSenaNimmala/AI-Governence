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
  // Groups individual server_agent_calls into traces by:
  //   same machine_id + same pid + calls within 30s of each other
  // Returns aggregated trace summaries.

  app.get('/api/v1/traces/stats', a(async (req, res) => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86400000);

    const [totalCalls, recentCalls, machines] = await Promise.all([
      db.collection('server_agent_calls').countDocuments(),
      db.collection('server_agent_calls').countDocuments({
        occurred_at: { $gte: dayAgo.toISOString() },
      }),
      db.collection('server_agent_calls').distinct('machine_id'),
    ]);

    const costAgg = await db.collection('server_agent_calls').aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$total_cost_usd', 0] } } } },
    ]).toArray();

    res.json({
      total_calls: totalCalls,
      calls_last_24h: recentCalls,
      connected_servers: machines.filter(Boolean).length,
      total_cost_usd: costAgg[0]?.total || 0,
    });
  }));

  app.get('/api/v1/traces', a(async (req, res) => {
    const { user, provider, model, machineId, limit = 50 } = req.query;
    const filter = {};
    if (user)      filter.user = user;
    if (provider)  filter.provider = provider;
    if (model)     filter.model = model;
    if (machineId) filter.machine_id = machineId;
    const lim = Math.min(Number(limit) || 50, 200);

    // Get recent calls sorted by time
    const calls = await db.collection('server_agent_calls')
      .find(filter)
      .sort({ occurred_at: -1 })
      .limit(lim * 20) // fetch more than needed, then group
      .project({
        _id: 0, id: 1, machine_id: 1, occurred_at: 1, duration_ms: 1,
        response_status: 1, provider: 1, model: 1,
        prompt_tokens: 1, completion_tokens: 1, total_cost_usd: 1,
        pid: 1, user: 1, cmdline: 1, cwd: 1, trigger_source: 1,
      })
      .toArray();

    // Group into traces: same machine_id + pid, within 30s gap
    const traces = groupIntoTraces(calls, 30000);
    res.json(traces.slice(0, lim));
  }));

  app.get('/api/v1/traces/:traceId', a(async (req, res) => {
    const traceId = req.params.traceId;

    // traceId format: machine_id|pid|startTimestamp
    const parts = traceId.split('|');
    if (parts.length < 3) return res.status(400).json({ error: 'invalid trace ID' });
    const [machineId, pid, startTs] = parts;
    const startTime = new Date(Number(startTs));
    const endTime = new Date(Number(startTs) + 300000); // 5 min max trace window

    const calls = await db.collection('server_agent_calls')
      .find({
        machine_id: machineId,
        pid: Number(pid) || pid,
        occurred_at: { $gte: startTime.toISOString(), $lte: endTime.toISOString() },
      })
      .sort({ occurred_at: 1 })
      .project({ _id: 0 })
      .toArray();

    if (calls.length === 0) return res.status(404).json({ error: 'trace not found' });

    // Build trace summary
    const firstCall = calls[0];
    const lastCall = calls[calls.length - 1];
    const lastEnd = new Date(lastCall.occurred_at).getTime() + (lastCall.duration_ms || 0);
    const totalDuration = lastEnd - new Date(firstCall.occurred_at).getTime();
    const totalTokens = calls.reduce((s, c) => s + (c.prompt_tokens || 0) + (c.completion_tokens || 0), 0);
    const totalCost = calls.reduce((s, c) => s + (c.total_cost_usd || 0), 0);
    const hasError = calls.some(c => c.response_status && c.response_status >= 400);

    res.json({
      trace_id: traceId,
      machine_id: machineId,
      pid,
      user: firstCall.user,
      cmdline: firstCall.cmdline,
      cwd: firstCall.cwd,
      trigger_source: firstCall.trigger_source,
      started_at: firstCall.occurred_at,
      duration_ms: totalDuration,
      call_count: calls.length,
      total_tokens: totalTokens,
      total_cost_usd: Math.round(totalCost * 1000000) / 1000000,
      status: hasError ? 'error' : 'ok',
      providers: [...new Set(calls.map(c => c.provider).filter(Boolean))],
      models: [...new Set(calls.map(c => c.model).filter(Boolean))],
      calls: calls.map(c => ({
        ...c,
        // Add relative timing for timeline visualization
        offset_ms: new Date(c.occurred_at).getTime() - new Date(firstCall.occurred_at).getTime(),
      })),
    });
  }));

  // ── Install token generation ──────────────────────────────────────────
  // Dashboard calls this to generate a one-time install command for customers.
  app.post('/api/v1/monitor/generate-token', a(async (req, res) => {
    const serverUrl = req.body?.serverUrl || `${req.protocol}://${req.get('host')}`;
    // Import ENROLL_SECRET — already loaded at server startup
    const authMod = await import('../auth.js');
    const enrollSecret = authMod.ENROLL_SECRET;

    // Token format: cfm_base64(serverUrl|enrollSecret)
    const payload = Buffer.from(`${serverUrl}|${enrollSecret}`).toString('base64');
    const token = `cfm_${payload}`;

    const installCmd = `curl -sSL ${serverUrl}/install-monitor.sh | sudo bash -s -- --token ${token}`;

    res.json({
      token,
      install_command: installCmd,
      server_url: serverUrl,
    });
  }));

  // Serve the install script
  app.get('/install-monitor.sh', async (req, res) => {
    const { resolve } = await import('path');
    const { existsSync } = await import('fs');
    const scriptPath = resolve(process.cwd(), '..', 'scripts', 'install-monitor.sh');
    if (existsSync(scriptPath)) {
      res.type('text/plain').sendFile(scriptPath);
    } else {
      res.status(404).send('Install script not found');
    }
  });

  // Connected servers list
  app.get('/api/v1/monitor/servers', a(async (req, res) => {
    const machines = await db.collection('server_agent_calls').aggregate([
      { $group: {
        _id: '$machine_id',
        last_seen: { $max: '$occurred_at' },
        total_calls: { $sum: 1 },
        total_cost_usd: { $sum: { $ifNull: ['$total_cost_usd', 0] } },
        users: { $addToSet: '$user' },
        providers: { $addToSet: '$provider' },
        models: { $addToSet: '$model' },
      }},
      { $project: {
        _id: 0, machine_id: '$_id', last_seen: 1, total_calls: 1, total_cost_usd: 1,
        users: 1, providers: 1, models: 1,
      }},
      { $sort: { last_seen: -1 } },
    ]).toArray();

    // Enrich with hostname from enrollment
    for (const m of machines) {
      m.users = (m.users || []).filter(Boolean);
      m.providers = (m.providers || []).filter(Boolean);
      m.models = (m.models || []).filter(Boolean);
      m.status = (new Date() - new Date(m.last_seen)) < 300000 ? 'active' : 'inactive';
    }

    res.json(machines);
  }));
}

function groupIntoTraces(calls, gapMs) {
  // Sort oldest first for grouping
  const sorted = [...calls].sort((a, b) =>
    new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  const traceMap = new Map(); // key: machine_id|pid → { calls, lastTime }

  for (const call of sorted) {
    const key = `${call.machine_id}|${call.pid || 'none'}`;
    const callTime = new Date(call.occurred_at).getTime();
    const existing = traceMap.get(key);

    if (existing && (callTime - existing.lastTime) < gapMs) {
      existing.calls.push(call);
      existing.lastTime = callTime + (call.duration_ms || 0);
    } else {
      // New trace
      const traceId = `${call.machine_id}|${call.pid || 'none'}|${callTime}`;
      traceMap.set(key, { traceId, calls: [call], lastTime: callTime + (call.duration_ms || 0) });
    }
  }

  // Build trace summaries
  const traces = [];
  for (const entry of traceMap.values()) {
    const first = entry.calls[0];
    const last = entry.calls[entry.calls.length - 1];
    const lastEnd = new Date(last.occurred_at).getTime() + (last.duration_ms || 0);
    const totalDuration = lastEnd - new Date(first.occurred_at).getTime();

    traces.push({
      trace_id: entry.traceId,
      machine_id: first.machine_id,
      pid: first.pid,
      user: first.user,
      cmdline: first.cmdline,
      trigger_source: first.trigger_source,
      started_at: first.occurred_at,
      duration_ms: totalDuration,
      call_count: entry.calls.length,
      total_tokens: entry.calls.reduce((s, c) => s + (c.prompt_tokens || 0) + (c.completion_tokens || 0), 0),
      total_cost_usd: Math.round(entry.calls.reduce((s, c) => s + (c.total_cost_usd || 0), 0) * 1000000) / 1000000,
      status: entry.calls.some(c => c.response_status >= 400) ? 'error' : 'ok',
      providers: [...new Set(entry.calls.map(c => c.provider).filter(Boolean))],
      models: [...new Set(entry.calls.map(c => c.model).filter(Boolean))],
    });
  }

  // Sort newest first
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
