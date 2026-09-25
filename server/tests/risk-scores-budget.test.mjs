// GET /api/v1/risk-scores and /risk-scores/summary — budgeted, and the summary
// parallelized.
//
// WHY THESE TWO NEEDED A SAFETY NET. routes/risk-score.js documents a real
// incident: the compute path issued 384 serialized round trips, took ~18s from a
// developer machine, exceeded nginx's 120s proxy_read_timeout on the deploy host
// and returned a 504 — while monopolising the box long enough that unrelated
// requests failed too. That was fixed by batching the compute, and no ceiling
// was ever put on the READ paths. They have one now, and /summary's own three
// reads no longer run one after another.
//
// POST /risk-scores/compute is deliberately untouched: it is admin-triggered,
// not part of a tab load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountRiskScore } from '../src/routes/risk-score.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';
import { responseStore, peekLastKnownGood, warmResponseStore } from '../src/lib/response-budget.js';

const QUERY_LATENCY_MS = 100;

async function seed(db) {
  await db.collection('employee_profiles').insertMany([
    { id: 'p1', display_name: 'Alice Anderson', email: 'alice@x.com', risk_score: 80, risk_level: 'critical', sources: ['agent'] },
    { id: 'p2', display_name: 'Bob Brown', email: 'bob@x.com', risk_score: 20, risk_level: 'low', sources: ['agent'] },
    // Scored but unattributable — counted separately, never dropped.
    { id: 'p3', display_name: 'Browser User (a1b2)', risk_score: 55, risk_level: 'medium', sources: ['extension'] },
    // Never assessed — reported so thin coverage cannot hide.
    { id: 'p4', display_name: 'Carol Chen', email: 'carol@x.com', risk_score: null },
  ]);
}

async function withServer(opts, fn) {
  const { latencyMs = 0 } = opts ?? {};
  responseStore.clear();

  const raw = createFakeDb();
  await seed(raw);
  const db = latencyMs > 0 ? withLatency(raw, latencyMs) : raw;

  const app = express();
  app.use(express.json());
  mountRiskScore(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ db, get: (p) => fetch(`${base}${p}`) });
  } finally {
    await new Promise((r) => server.close(r));
    responseStore.clear();
  }
}

test('/risk-scores keeps its shape and its is_identified flag', async () => {
  await withServer({}, async ({ get }) => {
    const res = await get('/api/v1/risk-scores');
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.deepEqual(rows.map((r) => r.id), ['p1', 'p3', 'p2'], 'highest score first');
    assert.equal(rows.find((r) => r.id === 'p1').is_identified, true);
    assert.equal(rows.find((r) => r.id === 'p3').is_identified, false);
    // A live answer carries no budget headers.
    assert.equal(res.headers.get('x-response-stale'), null);
    assert.equal(res.headers.get('x-response-budget'), null);
  });
});

test('/risk-scores/summary keeps its shape, and its counts still reconcile with the list', async () => {
  await withServer({}, async ({ get }) => {
    const summary = await (await get('/api/v1/risk-scores/summary')).json();
    const rows = await (await get('/api/v1/risk-scores')).json();

    assert.equal(summary.total_employees, 2, 'identified, scored people');
    assert.equal(summary.unidentified, 1);
    assert.equal(summary.not_assessed, 1);
    assert.equal(summary.average_score, 50);
    assert.deepEqual(summary.distribution, { low: 1, medium: 0, high: 0, critical: 1 });
    assert.equal(summary.coverage_percent, 67);
    // The property the two endpoints exist to keep: the header and the table
    // below it must add up.
    assert.equal(summary.total_employees + summary.unidentified, rows.length);
  });
});

test('/risk-scores/summary issues its three reads together, not one after another', async () => {
  await withServer({ latencyMs: QUERY_LATENCY_MS }, async ({ db, get }) => {
    const started = Date.now();
    const res = await get('/api/v1/risk-scores/summary');
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);

    assert.equal(db.__latency.calls, 3, 'still exactly three round trips');
    assert.equal(db.__latency.maxConcurrent, 3, 'all three must be in flight at once');
    assert.ok(elapsed < QUERY_LATENCY_MS * 2.5, `expected ~one query of latency, took ${elapsed}ms`);
  });
});

test('both reads are budget-wrapped, so each has a real fallback after it answers once', async () => {
  await withServer({}, async ({ get }) => {
    await get('/api/v1/risk-scores');
    await get('/api/v1/risk-scores/summary');
    assert.ok(peekLastKnownGood({ route: 'risk-scores' }), 'the list has no fallback stored');
    assert.ok(peekLastKnownGood({ route: 'risk-scores.summary' }), 'the summary has no fallback stored');
  });
});

test('warmResponseStore fills both read routes from cold', async () => {
  responseStore.clear();
  const db = createFakeDb();
  await seed(db);
  const app = express();
  mountRiskScore(app, db);

  const realLog = console.log, realWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    await warmResponseStore(db);
  } finally {
    console.log = realLog; console.warn = realWarn;
  }

  assert.equal(peekLastKnownGood({ route: 'risk-scores' }).value.length, 3);
  assert.equal(peekLastKnownGood({ route: 'risk-scores.summary' }).value.total_employees, 2);
  responseStore.clear();
});
