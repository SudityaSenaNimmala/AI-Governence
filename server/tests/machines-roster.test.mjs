// GET /api/v1/machines — the roster the AI Hub joins session rows against.
//
// The regression this pins down: the route used to filter
// { platform: { $ne: null } } to mean "endpoint agents only". In Mongo that also
// drops documents where `platform` is ABSENT, which is every browser-extension
// enrollment — so an extension-only session had no roster row to join against and
// rendered as a bare machine UUID.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountQueries } from '../src/routes/queries.js';
import { createFakeDb } from './helpers/fake-db.mjs';

async function withServer(seed, fn) {
  const db = createFakeDb();
  await seed(db);

  const app = express();
  app.use(express.json());
  mountQueries(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ db, base, get: (p) => fetch(`${base}${p}`) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// An endpoint agent reports platform + user; the browser extension reports
// neither — it enrolls with a machineId and a synthetic hostname only.
const AGENT = {
  id: 'agent-1',
  hostname: 'DESKTOP-ABC',
  user: 'jdoe',
  platform: 'win32',
  os_release: '10.0.26200',
  first_seen: new Date('2026-07-01T00:00:00Z'),
  last_seen: new Date('2026-07-30T10:00:00Z'),
};
const EXTENSION = {
  id: 'ext-9',
  hostname: 'Mozilla-browser-extension',
  first_seen: new Date('2026-07-20T00:00:00Z'),
  last_seen: new Date('2026-07-30T11:00:00Z'),
};
const EXPLICIT_NULL_PLATFORM = {
  id: 'ext-null',
  hostname: 'Chrome-browser-extension',
  platform: null,
  last_seen: new Date('2026-07-30T09:00:00Z'),
};

const seedMachines = async (db) => {
  for (const m of [AGENT, EXTENSION, EXPLICIT_NULL_PLATFORM]) {
    await db.collection('machines').insertOne(m);
  }
};

test('browser-extension machines are in the roster, not filtered out', async () => {
  await withServer(seedMachines, async ({ get }) => {
    const res = await get('/api/v1/machines');
    assert.equal(res.status, 200);
    const rows = await res.json();

    const ids = rows.map((r) => r.id);
    assert.ok(ids.includes('agent-1'), 'endpoint agents still listed');
    assert.ok(ids.includes('ext-9'), 'a machine with NO platform field is listed');
    assert.ok(ids.includes('ext-null'), 'a machine with platform: null is listed');
    assert.equal(rows.length, 3);
  });
});

test('every row carries the user → hostname → id label chain', async () => {
  await withServer(seedMachines, async ({ get }) => {
    const rows = await (await get('/api/v1/machines')).json();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // Agent: a real username is the best label.
    assert.equal(byId['agent-1'].user, 'jdoe');
    assert.equal(byId['agent-1'].hostname, 'DESKTOP-ABC');
    assert.equal(byId['agent-1'].platform, 'win32');

    // Extension: no user, so the hostname is the label — and it is present,
    // which is the whole point. Without this row the UI had only the raw id.
    assert.equal(byId['ext-9'].user, undefined);
    assert.equal(byId['ext-9'].hostname, 'Mozilla-browser-extension');
    assert.equal(byId['ext-9'].id, 'ext-9');

    for (const r of rows) {
      const label = r.user || r.hostname || r.id;
      assert.ok(label, `no label available for ${r.id}`);
    }
  });
});

test('rows still sort by last_seen and keep their scan/finding counters', async () => {
  await withServer(async (db) => {
    await seedMachines(db);
    await db.collection('findings').insertOne({ id: 'f1', machine_id: 'agent-1', tool_key: 'openai:chatgpt' });
    await db.collection('findings').insertOne({ id: 'f2', machine_id: 'agent-1', tool_key: 'openai:chatgpt' });
    await db.collection('findings').insertOne({ id: 'f3', machine_id: 'agent-1', tool_key: 'anthropic:claude' });
    await db.collection('scans').insertOne({ id: 's1', machine_id: 'agent-1', received_at: new Date('2026-07-29T00:00:00Z') });
  }, async ({ get }) => {
    const rows = await (await get('/api/v1/machines')).json();
    assert.deepEqual(rows.map((r) => r.id), ['ext-9', 'agent-1', 'ext-null']);

    const agent = rows.find((r) => r.id === 'agent-1');
    assert.equal(agent.findings_count, 3);
    assert.equal(agent.unique_tools, 2);
    assert.equal(new Date(agent.last_scan_at).toISOString(), '2026-07-29T00:00:00.000Z');

    const ext = rows.find((r) => r.id === 'ext-9');
    assert.equal(ext.findings_count, 0, 'an extension machine never scans — 0, not missing');
    assert.equal(ext.unique_tools, 0);
    assert.equal(ext.last_scan_at, null);
  });
});
