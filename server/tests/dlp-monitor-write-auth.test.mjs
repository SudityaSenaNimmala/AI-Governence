// POST /api/lifecycle/dlp-monitor — who may call it, and what shapes it accepts.
//
// Same two findings /block and /unblock already had fixed (see
// blocklist-write-auth.test.mjs), left open on this third write to the same
// `blocked_agents` rows:
//
// 1. NO AUTH. The flag changes what the desktop agent and the browser extension
//    enforce for every user of the named agent, yet anyone who could reach the
//    API could set or clear it.
// 2. `agent_id` WAS ONLY TRUTHINESS-CHECKED. `{"agent_id": {"$ne": null}}` passed
//    `if (!agent_id)` and reached setDlpMonitor()'s `updateOne({ agent_id }, …)`,
//    where Mongo reads it as a query operator and toggles an unrelated agent.
//
// Unlike the source-pinning tests elsewhere, these mount the REAL router over
// real HTTP: setMongoForTests() points getDb() at the in-memory fake.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import lifecycleRouter from '../src/governance/routes/lifecycle.ts';
import { setMongoForTests } from '../src/db/mongodb.js';
import { setDlpMonitor } from '../src/governance/dlp-monitor.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { adminJsonHeaders } from './helpers/admin-auth.mjs';

after(() => setMongoForTests(null));

async function withServer(fn) {
  const db = createFakeDb();
  setMongoForTests(db);
  const app = express();
  app.use(express.json());
  app.use('/api/lifecycle', lifecycleRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers) => fetch(`${base}/api/lifecycle/dlp-monitor`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  try {
    return await fn({ db, base, post });
  } finally {
    await new Promise((r) => server.close(r));
    setMongoForTests(null);
  }
}

const GOOD = { agent_id: 'agent-hr-1', agent_name: 'HR Assistant', platform: 'teams_chat_agent', agent_scope: 'agent', dlp_monitor: true };

test('POST /dlp-monitor refuses a caller with no admin token and writes nothing', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post(GOOD, { 'content-type': 'application/json' });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'admin auth required' });
    assert.equal(db._rows('blocked_agents').length, 0);
  });
});

test('POST /dlp-monitor refuses a WRONG admin token', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post(GOOD, { 'content-type': 'application/json', authorization: 'Bearer not-the-token' });
    assert.equal(res.status, 401);
    assert.equal(db._rows('blocked_agents').length, 0);
  });
});

test('POST /dlp-monitor with the admin bearer token succeeds and writes the flag', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post(GOOD, adminJsonHeaders());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.agent_id, 'agent-hr-1');
    assert.equal(body.status, 'dlp_monitored');
    const rows = db._rows('blocked_agents');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].agent_id, 'agent-hr-1');
    assert.equal(rows[0].dlp_monitor, true);
    assert.equal(rows[0].blocked, false);
  });
});

test('POST /dlp-monitor rejects a non-string agent_id with 400 and touches no row', async () => {
  await withServer(async ({ db, post }) => {
    // A pre-existing, unrelated row: the operator-shaped id would have matched it.
    await db.collection('blocked_agents').insertOne({ agent_id: 'victim', blocked: false, dlp_monitor: false });
    for (const agent_id of [{ $ne: null }, ['victim'], 42, true, '', '   ', null]) {
      const res = await post({ ...GOOD, agent_id }, adminJsonHeaders());
      assert.equal(res.status, 400, `agent_id=${JSON.stringify(agent_id)}`);
      assert.deepEqual(await res.json(), { error: 'agent_id is required and must be a string' });
    }
    // Missing entirely, too.
    const { agent_id: _omit, ...noId } = GOOD;
    assert.equal((await post(noId, adminJsonHeaders())).status, 400);

    const rows = db._rows('blocked_agents');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dlp_monitor, false, 'the unrelated row must be untouched');
  });
});

test('POST /dlp-monitor rejects a non-string optional identity field with 400', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post({ ...GOOD, agent_name: { $gt: '' } }, adminJsonHeaders());
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'agent_name must be a string when present' });
    assert.equal(db._rows('blocked_agents').length, 0);
  });
});

test('GET /governed-agents stays public — the enforcers poll it with no token', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/lifecycle/governed-agents`);
    assert.notEqual(res.status, 401);
    assert.equal(res.status, 200);
  });
});

test('setDlpMonitor itself refuses a non-string agent_id (defence in depth)', async () => {
  const db = createFakeDb();
  for (const agent_id of [{ $ne: null }, ['x'], 1, '', undefined]) {
    await assert.rejects(() => setDlpMonitor(db, { agent_id, dlp_monitor: true }), TypeError);
  }
  assert.equal(db._rows('blocked_agents').length, 0);
});
