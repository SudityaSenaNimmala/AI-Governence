// GET /api/v1/routing/analytics and GET /api/v1/routing/log — read from the
// REAL record of routing: dlp_events of kind model_routed.
//
// THE BUG THIS PINS DOWN. Analytics used to add dlp_events model_routed counts
// to routing_log counts. Nothing real wrote routing_log, and every model_routed
// event counted as "routed" even when the picker switch failed or was a no-op,
// so "Requests Routed" overstated what actually happened. Now only result
// 'applied' (or, for clients that predate routing v2, ui_changed:true) counts.
//
// The reads are still issued in parallel (the history: thirteen serialized
// round trips used to back this tab), and the response shape the Model Routing
// page reads is unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountRouting } from '../src/routes/routing.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';

const HOUR = 3600_000;
const DAY = 86_400_000;
const QUERY_LATENCY_MS = 100;
const NOW = Date.now();
const iso = (ms) => new Date(NOW - ms).toISOString();
const day = (ms) => new Date(NOW - ms).toISOString().slice(0, 10);

const ev = (id, ago, meta, extra = {}) => ({
  id, event_kind: 'model_routed', occurred_at: iso(ago), machine_id: 'm1', ai_service: 'Claude',
  source: 'browser_extension', metadata_json: JSON.stringify(meta), ...extra,
});

async function seed(db) {
  await db.collection('dlp_events').insertMany([
    // v2, applied
    ev('a1', HOUR, { mechanism: 'browser_extension', from_label: 'Opus', to_label: 'Haiku', to_tier: 'economy', complexity: 'simple', rule_id: 'rule-1', result: 'applied' }, { routing_result: 'applied' }),
    ev('a2', 3 * DAY, { mechanism: 'desktop_uia', from_label: 'Opus', to_label: 'Haiku', complexity: 'simple', rule_id: 'rule-1', result: 'applied' }, { routing_result: 'applied', source: 'os_monitor' }),
    ev('a3', 30 * DAY, { from_label: 'Haiku', to_label: 'Opus', complexity: 'complex', rule_id: 'rule-2', result: 'applied' }, { routing_result: 'applied' }),
    // v2, NOT applied — must not count as routed
    ev('f1', HOUR, { result: 'failed', rule_id: 'rule-1' }, { routing_result: 'failed' }),
    ev('n1', HOUR, { result: 'noop', rule_id: 'rule-1' }, { routing_result: 'noop' }),
    ev('s1', 2 * HOUR, { result: 'suggested' }, { routing_result: 'suggested' }),
    // legacy (pre-v2): only ui_changed true counts
    ev('l1', 2 * DAY, { routed_model: 'GPT-4o mini', rule_name: 'Old rule', complexity: 'simple', ui_changed: true }),
    ev('l2', 2 * DAY, { routed_model: 'GPT-4o mini', rule_name: 'Old rule', complexity: 'simple', ui_changed: false }),
    ev('l3', 2 * DAY, { routed_model: 'GPT-4o mini', rule_name: 'Old rule' }),
    // not a routing event at all
    { id: 'p1', event_kind: 'prompt_submit', occurred_at: iso(HOUR), machine_id: 'm1', ai_service: 'ChatGPT', metadata_json: '{"ui_changed":true}' },
  ]);
  // routing_log is no longer read: nothing real ever wrote it.
  await db.collection('routing_log').insertMany([
    { id: 'r1', timestamp: new Date(NOW - HOUR), routed_model: 'x' },
  ]);
  await db.collection('routing_rules').insertMany([
    { id: 'rule-1', name: 'Cheap for simple', enabled: true, priority: 10 },
    { id: 'rule-2', name: 'Premium for hard', enabled: true, priority: 20 },
    { id: 'rule-3', name: 'Disabled one', enabled: false, priority: 30 },
  ]);
  await db.collection('routing_endpoints').insertMany([
    { id: 'ep-1', name: 'Azure East', provider: 'azure', enabled: true },
    { id: 'ep-2', name: 'Bedrock', provider: 'aws', enabled: false },
  ]);
}

async function withServer(latencyMs, fn) {
  const raw = createFakeDb();
  await seed(raw);
  const db = latencyMs > 0 ? withLatency(raw, latencyMs) : raw;
  const app = express();
  app.use(express.json());
  mountRouting(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ db, get: (p) => fetch(`${base}${p}`) });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('Requests Routed counts only applied events (and legacy ui_changed:true)', async () => {
  await withServer(0, async ({ get }) => {
    const body = await (await get('/api/v1/routing/analytics')).json();
    assert.equal(body.total_routed, 4, 'a1, a2, a3, l1 — failed/noop/suggested/unknown are not "routed"');
    assert.equal(body.last_24h, 1, 'a1');
    assert.equal(body.last_7d, 3, 'a1, a2, l1');
    assert.equal(body.active_rules, 2);
    assert.equal(body.active_endpoints, 1);
  });
});

test('the response keeps the shape the Model Routing page reads', async () => {
  await withServer(0, async ({ get }) => {
    const body = await (await get('/api/v1/routing/analytics')).json();
    for (const k of ['total_routed', 'last_24h', 'last_7d', 'active_rules', 'active_endpoints',
      'by_model', 'by_rule', 'by_sensitivity', 'by_complexity', 'daily_trend']) {
      assert.ok(k in body, `missing ${k}`);
    }
    // Breakdowns are over the 14-day window: a3 (30 days) is outside it.
    assert.deepEqual(body.by_model, [
      { from: 'Opus', to: 'Haiku', count: 2 },
      { from: null, to: 'GPT-4o mini', count: 1 },
    ]);
    assert.deepEqual(body.by_rule, [
      { id: 'rule-1', name: 'Cheap for simple', count: 2 },
      { id: null, name: 'Old rule', count: 1 },
    ]);
    assert.deepEqual(body.by_complexity, [{ complexity: 'simple', count: 3 }]);
    // Oldest first: a2 (3d), l1 (2d), a1 (1h) — three distinct days.
    assert.deepEqual(body.daily_trend, [
      { date: day(3 * DAY), count: 1 },
      { date: day(2 * DAY), count: 1 },
      { date: day(HOUR), count: 1 },
    ]);
  });
});

test('the reads overlap — one query of wall time, not seven', async () => {
  await withServer(QUERY_LATENCY_MS, async ({ db, get }) => {
    const started = Date.now();
    const res = await get('/api/v1/routing/analytics');
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);
    assert.equal(db.__latency.calls, 7);
    assert.equal(db.__latency.maxConcurrent, 7, 'all reads must be in flight at once');
    assert.equal(db.__latency.byCollection.get('routing_log'), undefined, 'routing_log is no longer read');
    assert.ok(elapsed < QUERY_LATENCY_MS * 4, `took ${elapsed}ms`);
  });
});

test('the routing log reads dlp_events, with result and the correct source per mechanism', async () => {
  await withServer(0, async ({ get }) => {
    const rows = await (await get('/api/v1/routing/log?limit=50')).json();
    assert.equal(rows.length, 9, 'every model_routed event, and nothing else');
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by.a1.result, 'applied');
    assert.equal(by.a1.source, 'browser_extension');
    assert.equal(by.a1.routed_model, 'Haiku');
    assert.equal(by.a1.rule_name, 'Cheap for simple');
    assert.equal(by.a2.source, 'desktop_agent');
    assert.equal(by.f1.result, 'failed');
    assert.equal(by.l1.result, 'applied');
    assert.equal(by.l2.result, 'noop');
    assert.equal(by.l3.result, null);
    assert.equal(rows[0].timestamp >= rows[rows.length - 1].timestamp, true, 'newest first');
  });
});
