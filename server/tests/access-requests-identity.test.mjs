// GET /api/v1/access-requests and /api/v1/access-exceptions — WHO asked.
//
// The regression this pins down: an access_exceptions document stores only the
// machine it was granted to, and the route returned it verbatim. The admin's
// "who currently has access" tab therefore had nothing to show but a truncated
// device hash — no name, no hostname, on the one screen whose whole job is
// deciding whether a named person should keep access to a blocked tool.
//
// Also pins the name PRECEDENCE, which is the part that is easy to get subtly
// wrong: a curated profile name wins; after that the row's OWN user/hostname
// (stamped by the extension at submit time) beats the machine lookup, so a
// shared device still names the person who actually asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountAccessRequests } from '../src/routes/access-requests.js';
import { createFakeDb } from './helpers/fake-db.mjs';

async function withServer(seed, fn) {
  const db = createFakeDb();
  await seed(db);

  const app = express();
  app.use(express.json());
  mountAccessRequests(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      db,
      async get(p) {
        const res = await fetch(`${base}${p}`);
        assert.equal(res.status, 200, `GET ${p} → ${res.status}`);
        return res.json();
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const FUTURE = new Date(Date.now() + 8 * 3600000);

// Three requests, one per identity source:
//   profiled  — machine has a curated employee_profiles display name
//   stamped   — no profile; the request itself carries the detected user
//   bare      — no profile, no stamp; only the enrolment record knows anything
const REQUESTS = [
  {
    id: 'req-profiled', machine_id: 'mach-1', user: 'jdoe@corp.com', hostname: 'DESKTOP-ABC',
    tool_host: 'midjourney.com', tool_name: 'Midjourney', reason: 'design comps',
    status: 'approved', submitted_at: new Date('2026-08-19T10:00:00Z'), expires_at: FUTURE,
  },
  {
    id: 'req-stamped', machine_id: 'mach-2', user: 'asmith@corp.com', hostname: 'LAPTOP-XYZ',
    tool_host: 'perplexity.ai', tool_name: 'Perplexity', reason: 'research',
    status: 'pending', submitted_at: new Date('2026-08-20T09:00:00Z'),
  },
  {
    id: 'req-bare', machine_id: 'mach-3', user: null, hostname: null,
    tool_host: 'poe.com', tool_name: 'Poe', reason: '',
    status: 'pending', submitted_at: new Date('2026-08-20T08:00:00Z'),
  },
];

const seed = async (db) => {
  for (const r of REQUESTS) await db.collection('access_requests').insertOne(r);

  // mach-1 is curated AND enrolled under a different OS user — the profile name
  // has to win over both the request stamp and the enrolment.
  await db.collection('employee_profiles').insertOne({
    machine_ids: ['mach-1'], display_name: 'Jane Doe',
  });
  await db.collection('machines').insertOne({ id: 'mach-1', user: 'winuser1', hostname: 'DESKTOP-ABC' });
  // mach-2 is enrolled to SOMEONE ELSE — a shared/re-imaged device. The request's
  // own stamp must win, or the wrong person gets named on the approval screen.
  await db.collection('machines').insertOne({ id: 'mach-2', user: 'shared-kiosk', hostname: 'KIOSK-01' });
  await db.collection('machines').insertOne({ id: 'mach-3', user: 'rlee', hostname: 'BUILD-07' });

  // The approved request's exception — the row the "Active Exceptions" tab reads.
  await db.collection('access_exceptions').insertOne({
    machine_id: 'mach-1', tool_host: 'midjourney.com', tool_name: 'Midjourney',
    request_id: 'req-profiled', granted_at: new Date('2026-08-19T11:00:00Z'),
    expires_at: FUTURE, active: true,
  });
  // An exception whose originating request is gone (pruned history). It must
  // still name someone, from the enrolment record.
  await db.collection('access_exceptions').insertOne({
    machine_id: 'mach-3', tool_host: 'poe.com', tool_name: 'Poe',
    request_id: 'req-deleted', granted_at: new Date('2026-08-18T11:00:00Z'),
    expires_at: FUTURE, active: true,
  });
};

test('request list names the person, with profile > own stamp > enrolment', async () => {
  await withServer(seed, async ({ get }) => {
    const rows = await get('/api/v1/access-requests');
    const byId = new Map(rows.map((r) => [r.id, r]));

    assert.equal(byId.get('req-profiled').employee_name, 'Jane Doe');
    // The stamp, not the kiosk account the machine is enrolled under.
    assert.equal(byId.get('req-stamped').employee_name, 'asmith@corp.com');
    assert.equal(byId.get('req-stamped').hostname, 'LAPTOP-XYZ');
    // Nothing stamped: fall through to the enrolment record rather than 'Unknown'.
    assert.equal(byId.get('req-bare').employee_name, 'rlee');
    assert.equal(byId.get('req-bare').user, 'rlee');
    assert.equal(byId.get('req-bare').hostname, 'BUILD-07');
  });
});

test('exception list carries the person, not just a machine hash', async () => {
  await withServer(seed, async ({ get }) => {
    const rows = await get('/api/v1/access-exceptions');
    const byTool = new Map(rows.map((r) => [r.tool_host, r]));

    const mj = byTool.get('midjourney.com');
    assert.equal(mj.employee_name, 'Jane Doe');
    assert.equal(mj.user, 'jdoe@corp.com');     // from the originating request
    assert.equal(mj.hostname, 'DESKTOP-ABC');
    assert.equal(mj.machine_id, 'mach-1');      // still traceable to the device

    // Originating request pruned — the enrolment record answers instead.
    const poe = byTool.get('poe.com');
    assert.equal(poe.employee_name, 'rlee');
    assert.equal(poe.hostname, 'BUILD-07');
  });
});

// Seen on real data: the identity scanner mints "Browser User (<hash>)" for an
// extension install it cannot match to an account. Ranking that above the OS
// username the extension actually detected made the approval screen LESS
// informative than the raw row — "Browser User (480fff58)" instead of
// "AnilVoruganti".
test('a placeholder profile name loses to a real detected username', async () => {
  await withServer(async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-placeholder', machine_id: 'mach-ext', user: 'AnilVoruganti', hostname: 'LAPTOP-8KJGSY3',
      tool_host: 'api.openai.com', tool_name: 'OpenAI API', reason: 'testing',
      status: 'pending', submitted_at: new Date('2026-08-20T07:00:00Z'),
    });
    await db.collection('employee_profiles').insertOne({
      machine_ids: ['mach-ext'], display_name: 'Browser User (480fff58)',
    });
  }, async ({ get }) => {
    const [row] = await get('/api/v1/access-requests');
    assert.equal(row.employee_name, 'AnilVoruganti');
  });
});

// ...but with no username anywhere it outranks a hostname, because the browser
// extension's hostname is the synthetic "Mozilla-browser-extension" that every
// such install shares while the hash tells two installs apart. The hostname is
// still returned, so the UI renders it as the subline either way.
test('with no username, the placeholder outranks a synthetic hostname', async () => {
  await withServer(async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-anon', machine_id: 'mach-anon', user: null, hostname: 'Mozilla-browser-extension',
      tool_host: 'api.openai.com', tool_name: 'OpenAI API',
      status: 'pending', submitted_at: new Date('2026-08-20T07:00:00Z'),
    });
    await db.collection('employee_profiles').insertOne({
      machine_ids: ['mach-anon'], display_name: 'Browser User (c1469c64)',
    });
  }, async ({ get }) => {
    const [row] = await get('/api/v1/access-requests');
    assert.equal(row.employee_name, 'Browser User (c1469c64)');
    assert.equal(row.hostname, 'Mozilla-browser-extension');
  });
});

// A hostname is still better than nothing when there is no profile at all.
test('hostname is the last resort before Unknown', async () => {
  await withServer(async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-host-only', machine_id: 'mach-host', user: null, hostname: 'BUILD-07',
      tool_host: 'api.openai.com', tool_name: 'OpenAI API',
      status: 'pending', submitted_at: new Date('2026-08-20T07:00:00Z'),
    });
  }, async ({ get }) => {
    const [row] = await get('/api/v1/access-requests');
    assert.equal(row.employee_name, 'BUILD-07');
  });
});

test('a machine nobody has ever seen reports Unknown, not a crash', async () => {
  await withServer(async (db) => {
    await db.collection('access_exceptions').insertOne({
      machine_id: 'ghost', tool_host: 'poe.com', tool_name: 'Poe',
      request_id: null, granted_at: new Date('2026-08-19T11:00:00Z'),
      expires_at: FUTURE, active: true,
    });
  }, async ({ get }) => {
    const [row] = await get('/api/v1/access-exceptions');
    assert.equal(row.employee_name, 'Unknown');
    assert.equal(row.user, null);
    assert.equal(row.hostname, null);
    assert.equal(row.machine_id, 'ghost');
  });
});
