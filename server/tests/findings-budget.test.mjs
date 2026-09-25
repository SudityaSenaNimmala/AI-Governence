// GET /api/v1/findings — page-size clamp, NaN guard, operator-injection defence,
// and the shared response budget. Plus the boot-time warming of the three
// queries.js read routes.
//
// Two real bugs are pinned here:
//   * `.limit(Number(limit))` had NO server-side ceiling, so one request could
//     pull the whole collection — and `?limit=abc` produced NaN, which is not a
//     page size any driver accepts.
//   * every filter value went into the Mongo query UNCOERCED. Express's default
//     extended query parser turns `?type[$ne]=x` into an OBJECT, and an object
//     in the filter is evaluated as a query OPERATOR. routes/dlp.js already
//     defends against exactly this (its own comment records `?severity[$ne]=zzz`
//     returning all 500 events instead of 0, and the same trick on machineId
//     defeating per-machine scoping); /findings had no such defence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountQueries } from '../src/routes/queries.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { withLatency } from './helpers/slow-db.mjs';
import {
  responseStore, peekLastKnownGood, warmResponseStore,
} from '../src/lib/response-budget.js';

const TYPES = ['desktop_app', 'ide_extension', 'mcp_server'];

async function seed(db) {
  await db.collection('machines').insertMany([
    { id: 'm1', hostname: 'DESKTOP-A', user: 'alice', platform: 'win32' },
    { id: 'm2', hostname: 'DESKTOP-B', user: 'bob', platform: 'darwin' },
  ]);
  await db.collection('scans').insertMany([
    { id: 's1', machine_id: 'm1', received_at: new Date('2026-09-01T00:00:00Z') },
    { id: 's2', machine_id: 'm1', received_at: new Date('2026-09-10T00:00:00Z') },
  ]);
  await db.collection('findings').insertMany(
    Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      machine_id: i % 2 === 0 ? 'm1' : 'm2',
      scan_id: i < 3 ? 's1' : 's2',
      type: TYPES[i % TYPES.length],
      vendor: 'OpenAI',
      product: 'ChatGPT',
      tool_key: 'openai:chatgpt',
      risk_score: 50 + i,
      detected_at: `2026-09-0${i + 1}T00:00:00.000Z`,
      payload_json: JSON.stringify({ path_seen: true }),
    })),
  );
}

async function withServer(opts, fn) {
  const { latencyMs = 0 } = opts ?? {};
  responseStore.clear();

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
    responseStore.clear();
  }
}

test('?limit= is honoured and clamped to [1, 2000]', async () => {
  await withServer({}, async ({ get }) => {
    assert.equal((await (await get('/api/v1/findings?limit=2')).json()).length, 2);
    assert.equal((await (await get('/api/v1/findings?limit=6')).json()).length, 6);
    // Above the ceiling: clamped, not unbounded. (Only 6 rows exist, so what is
    // asserted here is that the request succeeds and is bounded.)
    assert.equal((await (await get('/api/v1/findings?limit=999999')).json()).length, 6);
  });
});

test('a non-numeric ?limit= falls back to the default instead of becoming NaN', async () => {
  await withServer({}, async ({ get }) => {
    const res = await get('/api/v1/findings?limit=abc');
    assert.equal(res.status, 200, 'NaN reached the driver as a page size');
    assert.equal((await res.json()).length, 6);

    // Zero falls back to the default; a negative clamps to the floor of 1 —
    // the same arithmetic /api/v1/dlp has always used, so the two routes cannot
    // disagree about what a page size means.
    assert.equal((await (await get('/api/v1/findings?limit=0')).json()).length, 6);
    assert.equal((await (await get('/api/v1/findings?limit=-5')).json()).length, 1);
  });
});

test('an operator smuggled through a filter cannot unfilter or rescope the list', async () => {
  await withServer({}, async ({ get }) => {
    // Express parses these into objects. Coerced with String(), they can only
    // ever mean equality against a literal — which matches nothing.
    for (const q of ['type[$ne]=zzz', 'vendor[$ne]=zzz', 'product[$ne]=zzz', 'toolKey[$ne]=zzz']) {
      const rows = await (await get(`/api/v1/findings?${q}`)).json();
      assert.deepEqual(rows, [], `?${q} returned rows — the filter was evaluated as an operator`);
    }
    // The scoping one: machineId must not be escapable.
    const scoped = await (await get('/api/v1/findings?machineId[$ne]=m1')).json();
    assert.deepEqual(scoped, [], 'per-machine scoping was defeated');

    // And the honest form still works.
    const real = await (await get('/api/v1/findings?machineId=m1')).json();
    assert.equal(real.length, 3);
    assert.ok(real.every((r) => r.machine_id === 'm1'));
  });
});

test('each filter is its own cache key', async () => {
  await withServer({}, async ({ get }) => {
    const desktop = await (await get('/api/v1/findings?type=desktop_app')).json();
    const ide = await (await get('/api/v1/findings?type=ide_extension')).json();
    assert.ok(desktop.every((r) => r.type === 'desktop_app'));
    assert.ok(ide.every((r) => r.type === 'ide_extension'), 'one filter was answered from another\'s cache');
    assert.equal(desktop.length, 2);
    assert.equal(ide.length, 2);

    // A different page size is a different key too.
    assert.equal((await (await get('/api/v1/findings?type=desktop_app&limit=1')).json()).length, 1);
    assert.equal((await (await get('/api/v1/findings?type=desktop_app')).json()).length, 2);
  });
});

test('the row shape is unchanged — identity joined, payload parsed', async () => {
  await withServer({}, async ({ get }) => {
    const rows = await (await get('/api/v1/findings?limit=1')).json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user, rows[0].machine_id === 'm1' ? 'alice' : 'bob');
    assert.deepEqual(rows[0].payload, { path_seen: true });
  });
});

test('latestOnly=true still restricts to the newest scan per machine', async () => {
  await withServer({}, async ({ get }) => {
    const rows = await (await get('/api/v1/findings?latestOnly=true')).json();
    // s2 is m1's newest scan; the dependency (scan ids first, then findings)
    // is real and deliberately stays sequential.
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.scan_id === 's2'));
  });
});

test('/overview and /machines are budget-wrapped — a served answer lands in the store', async () => {
  await withServer({}, async ({ get }) => {
    assert.equal(peekLastKnownGood({ route: 'overview' }), null);
    await get('/api/v1/overview');
    assert.ok(peekLastKnownGood({ route: 'overview' }), 'the answer was not stored, so there is no fallback');

    await get('/api/v1/machines');
    const machines = peekLastKnownGood({ route: 'machines' });
    assert.ok(machines);
    assert.equal(machines.value.length, 2);
  });
});

test('warmResponseStore fills every queries.js read route from cold', async () => {
  responseStore.clear();
  const db = createFakeDb();
  await seed(db);

  const app = express();
  mountQueries(app, db);

  const realLog = console.log, realWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try {
    await warmResponseStore(db);
  } finally {
    console.log = realLog; console.warn = realWarn;
  }

  // The default, no-filter parameters each route's own handler would use — so
  // the first real request after a deploy has a real fallback to serve.
  assert.ok(peekLastKnownGood({ route: 'overview' }), 'overview was not warmed');
  assert.ok(peekLastKnownGood({ route: 'machines' }), 'machines was not warmed');
  const findings = peekLastKnownGood({ route: 'findings', params: { filter: {}, lim: 500, latest: false } });
  assert.ok(findings, 'findings was not warmed under the parameters its handler uses');
  assert.equal(findings.value.length, 6);
  responseStore.clear();
});
