// GET /api/v1/routing/analytics — thirteen independent reads, issued at once.
//
// The route used to run eight countDocuments (four against dlp_events) and then
// five aggregations, each awaited before the next was sent. Nothing in the
// payload depends on anything else in it: total_routed, last_24h and last_7d
// look like dependencies but are just two counts added together in JS, so the
// counts can go out in parallel and the addition happens after.
//
// The expected payload below is built from the seed rather than pasted, because
// daily_trend's bucket keys are real dates — but it IS the payload the
// sequential implementation produced against this seed, checked against a
// capture taken before the change. This is a parallelization, not a rewrite of
// what the Routing tab is told.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountRouting } from '../src/routes/routing.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';

const HOUR = 3600_000;
const DAY = 86_400_000;
const QUERY_LATENCY_MS = 100;

// One fixed instant for both the seed and the expectation, so a test that runs
// across midnight cannot disagree with itself about which day a row is in.
const NOW = Date.now();
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

async function seed(db) {
  await db.collection('dlp_events').insertMany([
    { id: 'd1', event_kind: 'model_routed', occurred_at: new Date(NOW - HOUR).toISOString(), machine_id: 'm1', ai_service: 'ChatGPT', metadata_json: '{"routed_model":"gpt-4o-mini"}' },
    { id: 'd2', event_kind: 'model_routed', occurred_at: new Date(NOW - 3 * DAY).toISOString(), machine_id: 'm1', ai_service: 'ChatGPT', metadata_json: '{"routed_model":"gpt-4o-mini"}' },
    { id: 'd3', event_kind: 'model_routed', occurred_at: new Date(NOW - 30 * DAY).toISOString(), machine_id: 'm2', ai_service: 'Claude', metadata_json: '{}' },
    // Not a routing event — it must not be counted by any of the four
    // dlp_events reads.
    { id: 'd4', event_kind: 'prompt_submit', occurred_at: new Date(NOW - HOUR).toISOString(), machine_id: 'm1', ai_service: 'ChatGPT' },
  ]);
  await db.collection('routing_log').insertMany([
    { id: 'r1', machine_id: 'm1', timestamp: new Date(NOW - 2 * HOUR), original_model: 'gpt-4o', routed_model: 'gpt-4o-mini', rule_id: 'rule-1', rule_name: 'Cheap for simple', sensitivity: 'low', complexity: 'simple' },
    { id: 'r2', machine_id: 'm2', timestamp: new Date(NOW - 2 * DAY), original_model: 'gpt-4o', routed_model: 'gpt-4o-mini', rule_id: 'rule-1', rule_name: 'Cheap for simple', sensitivity: 'low', complexity: 'simple' },
    { id: 'r3', machine_id: 'm2', timestamp: new Date(NOW - 20 * DAY), original_model: 'claude-opus', routed_model: 'claude-sonnet', rule_id: 'rule-2', rule_name: 'Downshift opus', sensitivity: null, complexity: 'moderate' },
  ]);
  await db.collection('routing_rules').insertMany([
    { id: 'rule-1', name: 'Cheap for simple', enabled: true, priority: 10 },
    { id: 'rule-2', name: 'Downshift opus', enabled: true, priority: 20 },
    { id: 'rule-3', name: 'Disabled one', enabled: false, priority: 30 },
  ]);
  await db.collection('routing_endpoints').insertMany([
    { id: 'ep-1', name: 'Azure East', provider: 'azure', enabled: true },
    { id: 'ep-2', name: 'Bedrock', provider: 'aws', enabled: false },
  ]);
}

// Key order included, since the assertion is on the serialized body.
const expectedPayload = () => ({
  total_routed: 6,            // 3 dlp model_routed + 3 routing_log rows
  last_24h: 2,                // d1 + r1
  last_7d: 4,                 // d1, d2 + r1, r2
  active_rules: 2,
  active_endpoints: 1,
  by_model: [
    { from: 'gpt-4o', to: 'gpt-4o-mini', count: 2 },
    { from: 'claude-opus', to: 'claude-sonnet', count: 1 },
  ],
  by_rule: [
    { id: 'rule-1', name: 'Cheap for simple', count: 2 },
    { id: 'rule-2', name: 'Downshift opus', count: 1 },
  ],
  by_sensitivity: [{ sensitivity: 'low', count: 2 }],
  by_complexity: [
    { complexity: 'simple', count: 2 },
    { complexity: 'moderate', count: 1 },
  ],
  // r3 is 20 days old, outside the 14-day trend window.
  daily_trend: [
    { date: day(NOW - 2 * DAY), count: 1 },
    { date: day(NOW), count: 1 },
  ],
});

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

test('the payload is byte-identical to the sequential version', async () => {
  await withServer(0, async ({ get }) => {
    const res = await get('/api/v1/routing/analytics');
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(await res.json()), JSON.stringify(expectedPayload()));
  });
});

test('the thirteen reads overlap — one query of wall time, not thirteen', async () => {
  await withServer(QUERY_LATENCY_MS, async ({ db, get }) => {
    const started = Date.now();
    const res = await get('/api/v1/routing/analytics');
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);

    assert.equal(db.__latency.calls, 13, 'still exactly thirteen round trips — none dropped or added');
    assert.equal(db.__latency.maxConcurrent, 13, 'all thirteen reads must be in flight at once');
    assert.ok(
      elapsed < QUERY_LATENCY_MS * 4,
      `expected roughly one query of latency, took ${elapsed}ms (sequential would be ~${QUERY_LATENCY_MS * 13}ms)`,
    );
  });
});

test('the payload is the same with latency in play as without', async () => {
  await withServer(QUERY_LATENCY_MS, async ({ get }) => {
    const body = await (await get('/api/v1/routing/analytics')).json();
    assert.equal(JSON.stringify(body), JSON.stringify(expectedPayload()));
  });
});

test('the four dlp_events counts still exclude non-routing events', async () => {
  await withServer(0, async ({ get }) => {
    const body = await (await get('/api/v1/routing/analytics')).json();
    // d4 is a prompt_submit; counting it would make these 7 / 3 / 5.
    assert.equal(body.total_routed, 6);
    assert.equal(body.last_24h, 2);
    assert.equal(body.last_7d, 4);
  });
});
