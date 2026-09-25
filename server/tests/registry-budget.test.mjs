// GET /api/v1/registry and /registry/summary under the shared response budget.
//
// THE BUG THIS FILE EXISTS FOR. The old bespoke race kept a `settled` flag, and
// once the budget had expired that flag made the build's eventual result get
// DISCARDED. On the degraded cluster this budget was written for, EVERY build
// runs past the budget — so the cache could never be filled, and the Inventory
// page stayed pinned to the file snapshot until the database recovered and some
// request happened to land under budget by luck. "a late build repopulates the
// store" below is the regression test for that.
//
// The rest pins the safety properties that had to survive the conversion to
// lib/response-budget.js: the snapshot is still served (with a capture time) on
// an over-budget build, /summary is still answered from the snapshot's OWN
// summary, a truly fresh install with no snapshot and no capture still 503s
// rather than inventing rows, and REGISTRY_SNAPSHOT_FIRST=1 still skips the
// live build entirely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';
import { adminJsonHeaders } from './helpers/admin-auth.mjs';
import { responseStore } from '../src/lib/response-budget.js';

const ROUTE = '/api/v1/registry';

// A snapshot that is obviously NOT what the live build would produce, so which
// source answered is never ambiguous.
const SNAPSHOT = {
  captured_at: '2026-08-14T13:43:10.872Z',
  systems: [{
    id: 'snap:tool', name: 'Snapshot Tool', platform: 'web', category: 'web-service',
    vendor: 'SnapCo', status: 'approved', risk_level: 'medium', risk_score: 55,
    source: 'platform_registry', activity: { total: 3 },
  }],
  summary: {
    total_ai_systems: 260,
    by_source: { governance_agents: 244, endpoint_tools: 12, platform_services: 4 },
    by_status: { approved: 108, restricted: 149, blocked: 0, unknown: 3 },
    by_risk: { low: 54, medium: 198, high: 5, critical: 3, not_assessed: 0 },
  },
};

// Two governance agents, so a live build returns rows the snapshot never could.
async function seedLive(db) {
  await db.collection('discovered_agents').insertMany([
    // `scale: forward_v1` is the marker normalizeStoredRisk() looks for; without
    // it these scores would be read as legacy compliance scores and inverted.
    { id: 'live-1', name: 'Live Agent One', platform: 'copilot_studio', lifecycleStatus: 'active', risk: { score: 30, scale: 'forward_v1' } },
    { id: 'live-2', name: 'Live Agent Two', platform: 'vertex_ai', lifecycleStatus: 'active', risk: { score: 70, scale: 'forward_v1' } },
  ]);
}

/**
 * @param {object} opts
 * @param {number} [opts.latencyMs]   per-query latency (the build reads 5 collections in parallel)
 * @param {number} [opts.budgetMs]
 * @param {boolean} [opts.snapshot]   write a snapshot file
 * @param {boolean} [opts.snapshotFirst]
 * @param {Function} [opts.seed]
 */
async function withServer(opts, fn) {
  const {
    latencyMs = 0, budgetMs = 5000, snapshot = false, snapshotFirst = false,
    seed = seedLive, liveCacheTtlMs = 30_000,
  } = opts;

  // The shared store is module-level by design — clear it so one test cannot
  // answer another's request from a previous fixture's rows.
  responseStore.clear();

  const dir = mkdtempSync(join(tmpdir(), 'cfai-registry-'));
  const snapshotPath = join(dir, 'registry-snapshot.json');
  if (snapshot) writeFileSync(snapshotPath, JSON.stringify(SNAPSHOT), 'utf8');

  const saved = { ...process.env };
  process.env.REGISTRY_SNAPSHOT_PATH = snapshotPath;
  process.env.REGISTRY_BUILD_BUDGET_MS = String(budgetMs);
  process.env.REGISTRY_LIVE_CACHE_TTL_MS = String(liveCacheTtlMs);
  if (snapshotFirst) process.env.REGISTRY_SNAPSHOT_FIRST = '1';
  else delete process.env.REGISTRY_SNAPSHOT_FIRST;

  // Imported fresh per server: mountRegistry reads these env vars at mount time.
  const { mountRegistry } = await import(`../src/routes/registry.js?t=${Date.now()}${Math.random()}`);

  const raw = createFakeDb();
  await seed(raw);
  const db = latencyMs > 0 ? withLatency(raw, latencyMs) : raw;

  const app = express();
  app.use(express.json());
  mountRegistry(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      db, snapshotPath,
      get: (p = ROUTE) => fetch(`${base}${p}`),
      // PUT /:id/status is behind requireAdminAuth (it writes sanctions, suspends
      // agents and can cascade a block across ten Microsoft hosts); the GETs above
      // stay public. See helpers/admin-auth.mjs for the token.
      put: (id, body) => fetch(`${base}${ROUTE}/${encodeURIComponent(id)}/status`, {
        method: 'PUT', headers: adminJsonHeaders(), body: JSON.stringify(body),
      }),
    });
  } finally {
    await new Promise((r) => server.close(r));
    for (const k of ['REGISTRY_SNAPSHOT_PATH', 'REGISTRY_BUILD_BUDGET_MS', 'REGISTRY_SNAPSHOT_FIRST', 'REGISTRY_LIVE_CACHE_TTL_MS']) {
      if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    }
    // DRAIN BEFORE CLEARING. An over-budget test deliberately leaves a build
    // running, and that build's whole point is that it still writes to the
    // store when it lands — which, one test later, would be this fixture's rows
    // answering the NEXT test's request. The store is module-global by design
    // (one per process, not one per route), so the test has to wait the leaked
    // build out rather than pretend it is gone.
    await new Promise((r) => setTimeout(r, latencyMs + 60));
    responseStore.clear();
  }
}

test('a healthy build answers live, with no budget headers', async () => {
  await withServer({ snapshot: true }, async ({ get }) => {
    const res = await get();
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.deepEqual(rows.map((r) => r.id), ['live-2', 'live-1'], 'live rows, highest risk first');
    assert.equal(res.headers.get('x-response-stale'), null);
    assert.equal(res.headers.get('x-registry-stale'), null);
    assert.equal(res.headers.get('x-response-budget'), null);
  });
});

test('over budget with a snapshot — snapshot rows plus a capture time', async () => {
  await withServer({ snapshot: true, latencyMs: 120, budgetMs: 20 }, async ({ get }) => {
    const res = await get();
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.deepEqual(rows.map((r) => r.id), ['snap:tool'], 'served from the snapshot, not fabricated');

    assert.equal(res.headers.get('x-response-stale'), '1');
    assert.equal(res.headers.get('x-response-captured-at'), SNAPSHOT.captured_at);
    assert.equal(res.headers.get('x-response-budget'), null, 'stale is not budget-exceeded');
    // Legacy aliases, kept for anything already reading them.
    assert.equal(res.headers.get('x-registry-stale'), '1');
    assert.equal(res.headers.get('x-registry-captured-at'), SNAPSHOT.captured_at);
  });
});

test('/registry/summary over budget is served from the snapshot\'s OWN summary', async () => {
  await withServer({ snapshot: true, latencyMs: 120, budgetMs: 20 }, async ({ get }) => {
    const res = await get(`${ROUTE}/summary`);
    assert.equal(res.status, 200);
    // The file's precomputed summary verbatim — NOT a recount of the one row in
    // its systems[], which is what keeps "a count cannot disagree with the rows
    // it is counting" true of the fallback too.
    assert.deepEqual(await res.json(), SNAPSHOT.summary);
    assert.equal(res.headers.get('x-response-stale'), '1');
    assert.equal(res.headers.get('x-response-captured-at'), SNAPSHOT.captured_at);
  });
});

test('/registry/summary live is counted from the rows the list route serves', async () => {
  await withServer({ snapshot: true }, async ({ get }) => {
    const summary = await (await get(`${ROUTE}/summary`)).json();
    const rows = await (await get()).json();
    assert.equal(summary.total_ai_systems, rows.length);
    assert.equal(summary.by_source.governance_agents, 2);
  });
});

// ── THE DISCARD-BUG REGRESSION TEST ─────────────────────────────────────────
test('a late build repopulates the store, so the NEXT request is live and unstale', async () => {
  await withServer({ snapshot: true, latencyMs: 150, budgetMs: 20 }, async ({ get }) => {
    // Request 1 runs past the budget and is answered from the snapshot. The old
    // implementation threw the build's result away at this point.
    const first = await get();
    assert.equal(first.headers.get('x-response-stale'), '1');
    assert.deepEqual((await first.json()).map((r) => r.id), ['snap:tool']);

    // Let the losing build finish.
    await new Promise((r) => setTimeout(r, 250));

    // Request 2 is served from the self-healed store: live rows, no stale header
    // — and the circuit breaker, which tripped on request 1, does not get in the
    // way because the store now holds something real and current.
    const second = await get();
    assert.equal(second.status, 200);
    assert.deepEqual((await second.json()).map((r) => r.id), ['live-2', 'live-1'], 'the late build was discarded');
    assert.equal(second.headers.get('x-response-stale'), null, 'a self-healed answer is not stale');
    assert.equal(second.headers.get('x-response-budget'), null);
  });
});

test('no snapshot and no prior capture — waits out the build rather than 503ing', async () => {
  await withServer({ snapshot: false, latencyMs: 80, budgetMs: 20 }, async ({ get }) => {
    const res = await get();
    assert.equal(res.status, 200, 'a slow page must not become a 503 when a patient caller could have had the data');
    assert.deepEqual((await res.json()).map((r) => r.id), ['live-2', 'live-1']);
    assert.equal(res.headers.get('x-response-budget'), 'exceeded', 'slow-but-real, and says so');
    assert.equal(res.headers.get('x-response-stale'), null);
  });
});

test('snapshot absent AND the build fails — still 503, on both routes', async () => {
  // A build that throws: the fake db has no such collection behaviour to break,
  // so break the handle itself.
  const broken = { collection: () => { throw new Error('cluster down'); } };
  responseStore.clear();

  const saved = process.env.REGISTRY_SNAPSHOT_PATH;
  process.env.REGISTRY_SNAPSHOT_PATH = join(mkdtempSync(join(tmpdir(), 'cfai-registry-')), 'absent.json');
  const { mountRegistry } = await import(`../src/routes/registry.js?t=${Date.now()}broken`);
  const app = express();
  app.use(express.json());
  mountRegistry(app, broken);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of [ROUTE, `${ROUTE}/summary`]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 503, `${path} must not invent rows on a fresh install with a dead database`);
      const body = await res.json();
      assert.match(body.error, /temporarily unavailable/);
      assert.match(body.detail, /no snapshot is present/);
    }
  } finally {
    await new Promise((r) => server.close(r));
    if (saved === undefined) delete process.env.REGISTRY_SNAPSHOT_PATH;
    else process.env.REGISTRY_SNAPSHOT_PATH = saved;
    responseStore.clear();
  }
});

test('REGISTRY_SNAPSHOT_FIRST=1 skips the live build entirely', async () => {
  await withServer({ snapshot: true, snapshotFirst: true, latencyMs: 50 }, async ({ db, get }) => {
    const res = await get();
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).map((r) => r.id), ['snap:tool']);
    assert.equal(res.headers.get('x-response-stale'), '1');
    assert.equal(db.__latency.calls, 0, 'not one query may be issued when the snapshot answers first');
  });
});

test('a successful build rewrites the snapshot file on disk', async () => {
  await withServer({ snapshot: true }, async ({ get, snapshotPath }) => {
    const before = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    assert.equal(before.captured_at, SNAPSHOT.captured_at);

    await get();

    const after = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    assert.notEqual(after.captured_at, SNAPSHOT.captured_at, 'the snapshot still ages forever');
    assert.ok(Date.parse(after.captured_at) > Date.parse(SNAPSHOT.captured_at));
    assert.deepEqual(after.systems.map((r) => r.id).sort(), ['live-1', 'live-2']);
    // Its summary is derived from its own rows, by the same code /summary uses.
    assert.equal(after.summary.total_ai_systems, 2);
    assert.equal(after.summary.by_source.governance_agents, 2);
    // No temp file left behind — the write is atomic.
    assert.equal(existsSync(`${snapshotPath}.tmp`), false);
  });
});

test('the snapshot file is created when there was none', async () => {
  await withServer({ snapshot: false }, async ({ get, snapshotPath }) => {
    assert.equal(existsSync(snapshotPath), false);
    await get();
    assert.equal(existsSync(snapshotPath), true, 'a healthy server should leave a fallback behind for its next restart');
    assert.equal(JSON.parse(readFileSync(snapshotPath, 'utf8')).systems.length, 2);
  });
});

test('an EMPTY build never overwrites a real capture', async () => {
  await withServer({ snapshot: true, seed: async () => {} }, async ({ get, snapshotPath }) => {
    const res = await get();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [], 'an empty registry is a legitimate live answer');
    assert.equal(
      JSON.parse(readFileSync(snapshotPath, 'utf8')).captured_at, SNAPSHOT.captured_at,
      '260 real systems must not be replaced by [] on the strength of one anomalous build',
    );
  });
});

test('blocking a tool invalidates the read, so the decision is not reverted by the cache', async () => {
  await withServer({ snapshot: true, liveCacheTtlMs: 60_000 }, async ({ get, put }) => {
    const before = await (await get()).json();
    assert.equal(before.find((r) => r.id === 'live-1').status, 'approved');

    const put1 = await put('live-1', { status: 'blocked', product_name: 'Live Agent One', source: 'governance' });
    assert.equal(put1.status, 200);

    // Within the 30s (here 60s) TTL the old code served the pre-block rows.
    const after = await (await get()).json();
    assert.equal(after.find((r) => r.id === 'live-1').status, 'blocked', 'the admin decision was reverted by a warm cache');
  });
});
