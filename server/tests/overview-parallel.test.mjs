// GET /api/v1/overview — six independent reads, issued at once.
//
// The route used to await each of them in turn: two countDocuments, a
// distinct(), a findings countDocuments and two aggregations. Nothing in that
// payload depends on anything else in it, so the six round trips cost six times
// the round-trip latency before the first byte — and this is the first call the
// Overview tab makes. /api/v1/machines was the same shape and went from 11.8s to
// 272ms on exactly this change.
//
// Two things are asserted, and the second one matters as much as the first:
//   1. the reads OVERLAP (wall time ≈ one query, and six in flight at once);
//   2. the JSON is byte-identical to what the sequential version returned. The
//      payload string below was captured from the sequential implementation
//      before the change — this is a parallelization, not a rewrite of what the
//      Overview tab is told.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountQueries } from '../src/routes/queries.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';

// Captured from the pre-change, sequential /api/v1/overview against this seed.
const SEQUENTIAL_PAYLOAD = '{"totals":{"machines":2,"scans":2,"findings":4,"unique_tools":3},"byType":[{"type":"desktop_app","count":2},{"type":"ide_extension","count":1},{"type":"mcp_server","count":1}],"topTools":[{"tool_key":"openai:chatgpt","vendor":"OpenAI","product":"ChatGPT","machines":2,"findings":2,"risk_score":70,"sanction":"approved"},{"tool_key":"anthropic:claude","vendor":"Anthropic","product":"Claude","machines":1,"findings":1,"risk_score":40,"sanction":"unknown"},{"tool_key":"local:fs-mcp","vendor":"Local","product":"fs-mcp","machines":1,"findings":1,"risk_score":20,"sanction":"unknown"}]}';

const QUERY_LATENCY_MS = 100;

async function seed(db) {
  // m3 has no OS user/platform (a browser extension) and m4 is the CLI — both
  // are excluded from the "employees with the agent installed" count.
  await db.collection('machines').insertMany([
    { id: 'm1', hostname: 'DESKTOP-A', user: 'alice', platform: 'win32' },
    { id: 'm2', hostname: 'DESKTOP-B', user: 'bob', platform: 'darwin' },
    { id: 'm3', hostname: 'Chrome-browser-extension' },
    { id: 'm4', hostname: 'Claude Code CLI', user: 'carol', platform: 'linux' },
  ]);
  await db.collection('scans').insertMany([
    { id: 's1', machine_id: 'm1', received_at: new Date('2026-09-01T00:00:00Z') },
    { id: 's2', machine_id: 'm2', received_at: new Date('2026-09-02T00:00:00Z') },
  ]);
  await db.collection('findings').insertMany([
    { id: 'f1', machine_id: 'm1', scan_id: 's1', type: 'desktop_app', tool_key: 'openai:chatgpt', vendor: 'OpenAI', product: 'ChatGPT', risk_score: 70 },
    { id: 'f2', machine_id: 'm2', scan_id: 's2', type: 'desktop_app', tool_key: 'openai:chatgpt', vendor: 'OpenAI', product: 'ChatGPT', risk_score: 55 },
    { id: 'f3', machine_id: 'm1', scan_id: 's1', type: 'ide_extension', tool_key: 'anthropic:claude', vendor: 'Anthropic', product: 'Claude', risk_score: 40 },
    { id: 'f4', machine_id: 'm2', scan_id: 's2', type: 'mcp_server', tool_key: 'local:fs-mcp', vendor: 'Local', product: 'fs-mcp', risk_score: 20 },
  ]);
  await db.collection('sanctions').insertOne({ tool_key: 'openai:chatgpt', status: 'approved' });
}

async function withServer(latencyMs, fn) {
  const raw = createFakeDb();
  await seed(raw);
  const db = latencyMs > 0 ? withLatency(raw, latencyMs) : raw;

  const app = express();
  app.use(express.json());
  mountQueries(app, db);
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
    const res = await get('/api/v1/overview');
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(await res.json()), SEQUENTIAL_PAYLOAD);
  });
});

test('the six reads overlap — one query of wall time, not six', async () => {
  await withServer(QUERY_LATENCY_MS, async ({ db, get }) => {
    const started = Date.now();
    const res = await get('/api/v1/overview');
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);

    assert.equal(db.__latency.calls, 6, 'still exactly six round trips — no query was dropped or added');
    // The concurrency assertion is the load-bearing one: it pins "these were
    // issued together" independently of how fast or busy the machine is. A
    // sequential route reports maxConcurrent 1 however quick the box.
    assert.equal(db.__latency.maxConcurrent, 6, 'all six reads must be in flight at once');
    assert.ok(
      elapsed < QUERY_LATENCY_MS * 3,
      `expected roughly one query of latency, took ${elapsed}ms (sequential would be ~${QUERY_LATENCY_MS * 6}ms)`,
    );
  });
});

test('the payload is the same with latency in play as without', async () => {
  await withServer(QUERY_LATENCY_MS, async ({ get }) => {
    const body = await (await get('/api/v1/overview')).json();
    assert.equal(JSON.stringify(body), SEQUENTIAL_PAYLOAD);
  });
});
