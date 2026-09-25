// GET /api/v1/claude-usage — the ONE read route that does not fall back to
// stale data, and what it answers instead.
//
// WHY IT IS THE EXCEPTION. This route drives cost and seat-reclamation
// decisions, and routes/claude-usage.js's own rule is never to mix measured and
// estimated figures. A stale dollar figure presented as current is materially
// worse than a stale registry or DLP count, because someone acts on it. And
// maxTimeMS ABORTS the aggregation, where a race would leave the losing query
// running — which is what left the whole server unresponsive after a few visits
// to this tab.
//
// So it aborts, and says so in a shape the frontend can branch on:
//   503 { "error": "budget_exceeded", "budget_ms": 5000 }
// It used to surface as 500 { error: "<raw mongo message>" }, which the tab
// could only render as the literal word "500".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountClaudeUsage } from '../src/routes/claude-usage.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { RESPONSE_BUDGET_MS } from '../src/lib/response-budget.js';

// Mongo's maxTimeMS abort, as the driver raises it.
function maxTimeMsExpired() {
  const err = new Error('operation exceeded time limit');
  err.code = 50;
  err.codeName = 'MaxTimeMSExpired';
  return err;
}

// A db handle that answers the route's cheap reads normally and makes the heavy
// aggregations fail in a chosen way.
function dbWithFailingAggregate(base, makeError, collections = ['dlp_events', 'ai_token_usage']) {
  return {
    ...base,
    collection(name) {
      const real = base.collection(name);
      if (!collections.includes(name)) return real;
      return new Proxy(real, {
        get(target, prop) {
          if (prop === 'aggregate') {
            return () => ({ async toArray() { throw makeError(); } });
          }
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    },
  };
}

async function withServer(db, fn) {
  const app = express();
  app.use(express.json());
  mountClaudeUsage(app, db);
  // The same error middleware src/index.js installs, so an unhandled throw is
  // observed exactly as a client would see it.
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ get: (p) => fetch(`${base}${p}`) });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function seed(db) {
  await db.collection('machines').insertOne({ id: 'm1', hostname: 'DESKTOP-A', user: 'alice' });
  await db.collection('employee_profiles').insertOne({ id: 'p1', hostname: 'DESKTOP-A', os_user: 'alice', display_name: 'Alice Anderson', machine_ids: ['m1'] });
}

test('a timing-out aggregation yields a structured 503, not a bare 500', async () => {
  const base = createFakeDb();
  await seed(base);
  const realWarn = console.warn; console.warn = () => {};
  try {
    await withServer(dbWithFailingAggregate(base, maxTimeMsExpired), async ({ get }) => {
      const res = await get('/api/v1/claude-usage');
      assert.equal(res.status, 503, 'the timeout still surfaced as a 500');
      const body = await res.json();
      // EXACT shape — a frontend branches on it.
      assert.deepEqual(body, { error: 'budget_exceeded', budget_ms: RESPONSE_BUDGET_MS });
      assert.equal(body.budget_ms, 5000, 'the budget is the shared 5s one, lowered from 20s');
      // And nothing was invented in place of the figures.
      assert.equal(body.surfaces, undefined);
      assert.equal(body.total_cost_usd, undefined);
    });
  } finally { console.warn = realWarn; }
});

test('a non-timeout failure still surfaces as a 500 — a real bug is not relabelled', async () => {
  const base = createFakeDb();
  await seed(base);
  await withServer(dbWithFailingAggregate(base, () => new Error('E11000 duplicate key')), async ({ get }) => {
    const res = await get('/api/v1/claude-usage');
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'E11000 duplicate key');
    assert.notEqual(body.error, 'budget_exceeded');
  });
});

test('the healthy path is unaffected', async () => {
  const db = createFakeDb();
  await seed(db);
  await db.collection('dlp_events').insertOne({
    id: 'e1', machine_id: 'm1', occurred_at: '2026-09-20T10:00:00.000Z',
    source: 'claude_tracker', ai_service: 'Claude Code', event_kind: 'prompt_submit',
    content_length: 400, terminal: 'vscode',
  });
  await db.collection('ai_token_usage').insertOne({
    id: 'u1', request_id: 'r1', machine_id: 'm1', user_email: 'alice@x.com',
    occurred_at: '2026-09-20T10:00:00.000Z', source: 'claude_tracker', ai_service: 'Claude Code',
    model: 'claude-sonnet-4', input_tokens: 1000, output_tokens: 500,
    cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 1500, cost_usd: 0.02,
    measured: true,
  });

  await withServer(db, async ({ get }) => {
    const res = await get('/api/v1/claude-usage');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.surfaces), 'the usual payload still comes back');
    // No stale-fallback headers on this route, ever — it has no stale tier.
    assert.equal(res.headers.get('x-response-stale'), null);
    assert.equal(res.headers.get('x-response-captured-at'), null);
  });
});
