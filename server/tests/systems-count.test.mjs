// AI Hub Overview "Systems" card — desktop agents must be counted.
//
// THE DEFECT. The count (GET /api/v1/overview totals.machines) required BOTH
// `user` and `platform` on the machine record. The Electron desktop agent enrolled
// with only {machineId, hostname, enrollSecret}, enroll.js never stored platform,
// and the tray app enrolls once — so a desktop agent sending os_monitor DLP events
// all day was invisible, while old scanner-report machines were counted.
//
// Pinned here:
//   1. enroll stores an allowlisted platform (and drops anything else);
//   2. the count includes a desktop-agent record with no user, and still
//      excludes browser-extension / CLI / tracker / anonymous records;
//   3. an ALREADY-installed agent (old-style record, no type/user/platform) is
//      counted after it sends os_monitor traffic or fetches its preferences,
//      without anything being overwritten or created.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountEnroll } from '../src/routes/enroll.js';
import { mountQueries } from '../src/routes/queries.js';
import { mountDlp } from '../src/routes/dlp.js';
import { mountInstallations } from '../src/routes/installations.js';
import { ENROLL_SECRET, signMachineToken } from '../src/auth.js';
import { _resetDesktopAgentPresence } from '../src/lib/desktop-agent-presence.js';
import { createFakeDb } from './helpers/fake-db.mjs';

beforeEach(() => _resetDesktopAgentPresence());

async function withServer(fn, seed = async () => {}) {
  const db = createFakeDb();
  await seed(db);
  const app = express();
  app.use(express.json());
  mountEnroll(app, db);
  mountInstallations(app, db);
  mountDlp(app, db);
  mountQueries(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (path, body, token) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : null),
    },
    body: JSON.stringify(body),
  });
  const get = (path, token) => fetch(`${base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  // Fresh read every time — the overview route is cached per process, and the
  // fetchOverview live path is what both the route and the warmer run.
  const systems = async () => {
    const res = await get('/api/v1/overview');
    assert.equal(res.status, 200);
    return (await res.json()).totals.machines;
  };
  try {
    return await fn({ db, post, get, systems });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const machine = (db, id) => db.collection('machines').findOne({ id });
const tokenFor = (id, hostname) => signMachineToken({ machineId: id, hostname });
const osEvent = (extra = {}) => ({
  source: 'os_monitor', kind: 'prompt', service: 'chatgpt',
  occurredAt: new Date().toISOString(), user: 'Pravallikapunumalli', ...extra,
});

test('enroll stores an allowlisted platform and drops anything else', async () => {
  await withServer(async ({ db, post }) => {
    for (const [id, platform] of [['m-win', 'win32'], ['m-mac', 'darwin'], ['m-lin', 'linux'], ['m-bad', 'haiku<script>']]) {
      const res = await post('/api/v1/enroll', { enrollSecret: ENROLL_SECRET, machineId: id, hostname: id, platform, type: 'desktop-agent' });
      assert.equal(res.status, 200);
    }
    assert.equal((await machine(db, 'm-win')).platform, 'win32');
    assert.equal((await machine(db, 'm-mac')).platform, 'darwin');
    assert.equal((await machine(db, 'm-lin')).platform, 'linux');
    assert.equal((await machine(db, 'm-bad')).platform, undefined, 'non-allowlisted platform must not be stored');
    assert.equal((await machine(db, 'm-win')).type, 'desktop-agent');
  });
});

test('a new-style desktop-agent enroll is counted as a System', async () => {
  await withServer(async ({ post, systems }) => {
    assert.equal(await systems(), 0);
    await post('/api/v1/enroll', {
      enrollSecret: ENROLL_SECRET, machineId: 'laptop-1', hostname: 'LAPTOP-FCRNKB4',
      user: 'Pravallikapunumalli', platform: 'win32', type: 'desktop-agent',
    });
    assert.equal(await systems(), 1);
  });
});

test('count includes desktop agents (even with no user) and excludes non-endpoints', async () => {
  await withServer(async ({ systems }) => {
    assert.equal(await systems(), 2);
  }, async (db) => {
    await db.collection('machines').insertMany([
      // counted
      { id: 'desk-1', hostname: 'LAPTOP-FCRNKB4', type: 'desktop-agent' },   // no user, no platform
      { id: 'scan-1', hostname: 'DESKTOP-A', user: 'alice', platform: 'win32' }, // scanner report
      // excluded
      { id: 'ext-1', hostname: 'chrome-browser-extension', user: 'a@x.com', platform: 'win32' },
      { id: 'ext-2', hostname: 'edge-browser-extension', type: 'desktop-agent' },
      { id: 'clicode:a@x.com', hostname: 'Claude Code CLI', user: 'a@x.com', platform: 'linux' },
      { id: 'clautrk:abc123', hostname: 'LAPTOP-X', user: 'a@x.com', platform: 'win32', type: 'desktop-agent' },
      { id: 'anon-1', hostname: 'LAPTOP-OLD' },  // old-style enroll, never seen as an agent
      { id: 'srv-1', hostname: 'srv', user: 'root', platform: 'linux', type: 'server-monitor' },
    ]);
  });
});

test('leftover demo machines are not Systems; a real machine named EMILY still is', async () => {
  await withServer(async ({ systems }) => {
    assert.equal(await systems(), 2);
  }, async (db) => {
    await db.collection('machines').insertMany([
      // excluded — demo host with a demo or empty user
      { id: 'demo-j', hostname: 'JAMES', user: 'JamesCarter', platform: 'win32' },
      { id: 'demo-e', hostname: 'EMILY', user: 'emilyrodriguez', platform: 'win32', type: 'desktop-agent' },
      { id: 'demo-s', hostname: 'SARAH', type: 'desktop-agent' },
      { id: 'demo-s2', hostname: 'sarah', user: '', platform: 'win32', type: 'desktop-agent' },
      // counted — real users, even on a demo-looking hostname
      { id: 'f0031ea6', hostname: 'EMILY', user: 'Pravallikapunumalli', platform: 'win32', type: 'desktop-agent' },
      { id: 'real-2', hostname: 'Pravallika', user: 'Pravallika', type: 'desktop-agent' },
    ]);
  });
});

test('an already-installed agent is counted once it sends os_monitor events', async () => {
  await withServer(async ({ db, post, systems }) => {
    assert.equal(await systems(), 0, 'old-style record is not counted before any traffic');

    const res = await post('/api/v1/dlp', { events: [osEvent()] }, tokenFor('8092a78f', 'LAPTOP-FCRNKB4'));
    assert.equal(res.status, 201);

    const m = await machine(db, '8092a78f');
    assert.equal(m.type, 'desktop-agent');
    assert.equal(m.user, 'Pravallikapunumalli', 'user backfilled from the event when absent');
    assert.equal(m.platform, undefined, 'platform is not guessed');
    assert.ok(m.last_seen instanceof Date);
    assert.equal(await systems(), 1);
  }, async (db) => {
    await db.collection('machines').insertOne({ id: '8092a78f', hostname: 'LAPTOP-FCRNKB4' });
  });
});

test('backfill never overwrites, never creates, and ignores non-desktop traffic', async () => {
  await withServer(async ({ db, post }) => {
    // Existing user/type survive.
    await post('/api/v1/dlp', { events: [osEvent({ user: 'someone-else' })] }, tokenFor('has-user', 'H'));
    const kept = await machine(db, 'has-user');
    assert.equal(kept.user, 'alice@cloudfuze.com');
    assert.equal(kept.type, 'scanner');

    // Browser-extension traffic (default source) does not mark.
    await post('/api/v1/dlp', { events: [osEvent({ source: undefined })] }, tokenFor('plain', 'P'));
    assert.equal((await machine(db, 'plain')).type, undefined);

    // A browser-extension record is never marked even if it claims os_monitor.
    await post('/api/v1/dlp', { events: [osEvent()] }, tokenFor('ext-1', 'chrome-browser-extension'));
    assert.equal((await machine(db, 'ext-1')).type, undefined);

    // Unknown machine: no record is created from event traffic.
    await post('/api/v1/dlp', { events: [osEvent()] }, tokenFor('ghost', 'G'));
    assert.equal(await machine(db, 'ghost'), null);
  }, async (db) => {
    await db.collection('machines').insertMany([
      { id: 'has-user', hostname: 'H', user: 'alice@cloudfuze.com', type: 'scanner' },
      { id: 'plain', hostname: 'P' },
      { id: 'ext-1', hostname: 'chrome-browser-extension' },
    ]);
  });
});

test('the tray app preferences fetch marks an installed agent', async () => {
  await withServer(async ({ db, get, systems }) => {
    const res = await get('/api/v1/machines/me/preferences', tokenFor('tray-1', 'LAPTOP-T'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { model_routing_enabled: true });
    assert.equal((await machine(db, 'tray-1')).type, 'desktop-agent');
    assert.equal(await systems(), 1);
  }, async (db) => {
    await db.collection('machines').insertOne({ id: 'tray-1', hostname: 'LAPTOP-T' });
  });
});
