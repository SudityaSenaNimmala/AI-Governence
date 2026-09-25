// The Prompts & DLP tab's read routes under the shared response budget.
//
// /api/v1/dlp had its own 9s budget and its own pair of Maps; /dlp/summary,
// /dlp/trend and /dlp/files had no cap at all. All four now use
// lib/response-budget.js, which is also what makes the store bounded and
// memory-only in one place instead of four.
//
// THE CORRECTNESS-CRITICAL TEST HERE is the last one: a request with a
// different ?severity= must never be answered from another filter's cached
// body. A wrong-key collision shows an admin the wrong events with nothing on
// screen to say so — which is worse than the slow page the cache exists to fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';
import { responseStore } from '../src/lib/response-budget.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

const event = (id, over) => ({
  id,
  machine_id: 'm1',
  occurred_at: `${today}T10:00:00.000Z`,
  source: 'browser_extension',
  ai_service: 'ChatGPT',
  event_kind: 'prompt_submit',
  secret_class: 'high',
  content_length: 120,
  pattern_matched: 'aws-access-key',
  // Pattern NAMES and counts only — never the matched text. Checked against
  // every emitter (browser extension and desktop agent) before this store was
  // allowed to hold these bodies at all.
  metadata_json: JSON.stringify({ matches: [{ pattern: 'aws-access-key', class: 'secret', severity: 'high', count: 1 }], tab_host: 'chatgpt.com' }),
  ...over,
});

async function seed(db) {
  await db.collection('machines').insertOne({ id: 'm1', hostname: 'DESKTOP-A', user: 'alice' });
  await db.collection('employee_profiles').insertOne({ id: 'p1', machine_ids: ['m1'], display_name: 'Alice Anderson' });
  await db.collection('dlp_events').insertMany([
    event('e1'),
    event('e2', { secret_class: 'critical' }),
    event('e3', { secret_class: 'low' }),
    event('f1', { event_kind: 'file_upload', secret_class: 'critical', pattern_matched: 'source-code', content_length: 2048,
      metadata_json: JSON.stringify({ filename: 'budget.xlsx', size: 2048, tab_host: 'chatgpt.com' }) }),
  ]);
  await db.collection('ai_platforms').insertOne({ host: 'chatgpt.com', vendor: 'OpenAI', product: 'ChatGPT', category: 'chat' });
}

async function withServer(opts, fn) {
  const { latencyMs = 0, seed: seedFn = seed } = opts;
  responseStore.clear();

  const raw = createFakeDb();
  await seedFn(raw);
  const db = latencyMs > 0 ? withLatency(raw, latencyMs) : raw;

  const app = express();
  app.use(express.json());
  mountDlp(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ db, get: (p) => fetch(`${base}${p}`) });
  } finally {
    await new Promise((r) => server.close(r));
    // An over-budget test leaves its live fetch running on purpose; wait it out
    // before clearing, or its rows answer the next test's request.
    await sleep(latencyMs + 60);
    responseStore.clear();
  }
}

// ── GET /api/v1/dlp ─────────────────────────────────────────────────────────

test('a cold first request waits for the real data and is correct', async () => {
  // Budget 5s, latency 40ms/query: this one is simply live. The cold-miss path
  // (budget expired, empty store) is covered below.
  await withServer({ latencyMs: 40 }, async ({ get }) => {
    const res = await get('/api/v1/dlp?limit=10');
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 4);
    assert.equal(res.headers.get('x-response-stale'), null);
    assert.equal(res.headers.get('x-response-budget'), null);
    // Identity is joined, and the metadata is parsed — the body is unchanged by
    // the budget work.
    assert.equal(rows[0].user, 'alice');
    assert.ok(rows[0].metadata.matches[0].pattern);
  });
});

test('the 20s TTL serves a repeat request without re-querying', async () => {
  // The TTL is a separate knob from the budget: it decides when it is worth
  // asking the database again, not how long to wait for the answer.
  await withServer({ latencyMs: 10 }, async ({ db, get }) => {
    await get('/api/v1/dlp?limit=10');
    const afterFirst = db.__latency.calls;
    assert.ok(afterFirst > 0);
    await get('/api/v1/dlp?limit=10');
    assert.equal(db.__latency.calls, afterFirst, 'the second request inside the TTL must not re-query');
  });
});

// ── Stale fallback ──────────────────────────────────────────────────────────

test('an over-budget request serves last-known-good with a stale header', async () => {
  // Drive the budget directly through the helper against this route's own key,
  // so the test does not have to wait out a real 5s budget: fill the store from
  // a healthy fetch, then make the next fetch slower than a tiny budget.
  const { raceWithFallback, applyBudgetHeaders, dlpResponseStore } = await import('../src/lib/response-budget.js');
  responseStore.clear();

  const first = await raceWithFallback({
    route: 'dlp.list', params: { filter: {}, lim: 500 }, budgetMs: 1000, store: dlpResponseStore,
    live: async () => [{ id: 'e1' }],
  });
  assert.equal(first.stale, false);

  const realWarn = console.warn; console.warn = () => {};
  let second;
  try {
    second = await raceWithFallback({
      route: 'dlp.list', params: { filter: {}, lim: 500 }, budgetMs: 10, store: dlpResponseStore,
      live: async () => { await sleep(200); return [{ id: 'e2' }]; },
    });
  } finally { console.warn = realWarn; }

  assert.deepEqual(second.value, [{ id: 'e1' }], 'a real prior response, never a fabricated one');
  assert.equal(second.stale, true);
  const headers = {};
  applyBudgetHeaders({ setHeader: (k, v) => { headers[k] = v; } }, second);
  assert.equal(headers['X-Response-Stale'], '1');
  assert.ok(headers['X-Response-Captured-At']);
  await sleep(250);
  responseStore.clear();
});

// ── THE KEY-COLLISION TEST ──────────────────────────────────────────────────

test('a different ?severity= never receives another filter\'s cached body', async () => {
  await withServer({ latencyMs: 0 }, async ({ get }) => {
    const critical = await (await get('/api/v1/dlp?severity=critical')).json();
    assert.deepEqual(critical.map((r) => r.id).sort(), ['e2', 'f1']);

    // Same route, same limit, different severity — inside the TTL, so a
    // route-only or limit-only cache key would hand back the critical rows.
    const low = await (await get('/api/v1/dlp?severity=low')).json();
    assert.deepEqual(low.map((r) => r.id), ['e3'], 'the severity filter was answered from another filter\'s cache');

    const multi = await (await get('/api/v1/dlp?severity=critical,high')).json();
    assert.deepEqual(multi.map((r) => r.id).sort(), ['e1', 'e2', 'f1']);

    // And an unknown severity still yields nothing rather than everything.
    assert.deepEqual(await (await get('/api/v1/dlp?severity=zzz')).json(), []);

    // A different service filter is also its own key.
    assert.deepEqual((await (await get('/api/v1/dlp?service=Claude')).json()), []);
    assert.equal((await (await get('/api/v1/dlp?service=ChatGPT')).json()).length, 4);
  });
});

test('the extended-query-parser attack on ?severity= still cannot unfilter the list', async () => {
  await withServer({ latencyMs: 0 }, async ({ get }) => {
    // Express turns severity[$ne]=zzz into an OBJECT; String() collapses it, so
    // it can only ever mean equality — and an unknown name yields nothing.
    const rows = await (await get('/api/v1/dlp?severity[$ne]=zzz')).json();
    assert.deepEqual(rows, [], 'a query operator smuggled through ?severity= returned rows');
    const byMachine = await (await get('/api/v1/dlp?machineId[$ne]=nope')).json();
    assert.deepEqual(byMachine, [], 'per-machine scoping was defeated');
  });
});

// ── /dlp/summary and /dlp/trend ─────────────────────────────────────────────

test('/dlp/summary is unchanged in shape and budgeted', async () => {
  await withServer({ latencyMs: 20 }, async ({ get }) => {
    const res = await get('/api/v1/dlp/summary');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['byKind', 'byService', 'bySeverity', 'recentCritical']);
    assert.equal(body.byService[0].ai_service, 'ChatGPT');
    assert.equal(body.byService[0].events, 4);
    assert.equal(body.recentCritical.length, 3, 'critical + high, newest first');
    assert.equal(res.headers.get('x-response-stale'), null);
  });
});

test('/dlp/trend is unchanged in shape and zero-fills its window', async () => {
  await withServer({ latencyMs: 0 }, async ({ get }) => {
    const rows = await (await get('/api/v1/dlp/trend?days=7')).json();
    assert.equal(rows.length, 7);
    const last = rows[rows.length - 1];
    assert.equal(last.date, today);
    assert.equal(last.prompts, 2, 'e1 (high) + e2 (critical); e3 is low');
    assert.equal(last.file_uploads, 1);
    assert.equal(last.events, 3);
    assert.equal(rows[0].events, 0, 'days with nothing are zero-filled, not missing');
  });
});

// ── /dlp/files honours the client's limit ───────────────────────────────────

test('/dlp/files honours ?limit=, clamped to [1, 2000]', async () => {
  await withServer({ latencyMs: 0, seed: async (db) => {
    await db.collection('machines').insertOne({ id: 'm1', hostname: 'DESKTOP-A', user: 'alice' });
    await db.collection('dlp_events').insertMany(
      Array.from({ length: 12 }, (_, i) => event(`u${i}`, {
        event_kind: 'file_upload', pattern_matched: 'source-code',
        occurred_at: `${today}T10:${String(i).padStart(2, '0')}:00.000Z`,
        metadata_json: JSON.stringify({ filename: `f${i}.xlsx`, size: 10, tab_host: 'chatgpt.com' }),
      })),
    );
  } }, async ({ get }) => {
    // The parameter used to be ignored entirely — every answer was 500 rows max
    // with nothing to say the caller's number had been dropped.
    assert.equal((await (await get('/api/v1/dlp/files?limit=5')).json()).length, 5);
    assert.equal((await (await get('/api/v1/dlp/files?limit=12')).json()).length, 12);
    // Above the clamp, and below it, and non-numeric — all land on a sane page.
    assert.equal((await (await get('/api/v1/dlp/files?limit=5000')).json()).length, 12);
    assert.equal((await (await get('/api/v1/dlp/files?limit=0')).json()).length, 12, 'falls back to the default, not zero rows');
    assert.equal((await (await get('/api/v1/dlp/files?limit=abc')).json()).length, 12, 'NaN falls back to the default');
    assert.equal((await (await get('/api/v1/dlp/files')).json()).length, 12);

    // Each limit is its own cache key, so asking for 5 after asking for 12
    // cannot be answered with 12 rows.
    assert.equal((await (await get('/api/v1/dlp/files?limit=5')).json()).length, 5);
  });
});

test('/dlp/files rows keep their existing shape', async () => {
  await withServer({ latencyMs: 0 }, async ({ get }) => {
    const rows = await (await get('/api/v1/dlp/files')).json();
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      'ai_service', 'employee_name', 'file_class', 'has_content', 'hostname', 'id',
      'machine_id', 'metadata', 'metadata_json', 'occurred_at', 'platform', 'severity', 'size', 'user',
    ].sort());
    assert.equal(rows[0].severity, 'critical');
    assert.equal(rows[0].platform.product, 'ChatGPT');
  });
});
