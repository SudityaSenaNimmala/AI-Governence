// One person, one row — on the access-request path.
//
// THE DEFECT THIS PINS DOWN, observed in live production data rather than
// imagined. The roster at GET /api/v1/access-requests was showing, among 40 real
// requests, these as separate employees:
//
//     Chaitanya.Malle@cloudfuze.com     Praveen.V@cloudfuze.com
//     srinidh.perla@cloudfuze.com       hari.rowlo@cloudfuze.com
//
// Two capitalisation conventions from one fleet, because Windows does not agree
// with itself: `whoami /upn` returns the lowercase form and the Intune enrolment
// registry key returns the mixed-case one. The desktop agent reads the first, the
// extension is handed the second as managed policy, and the request stored
// whichever arrived, verbatim.
//
// Nothing errors when this happens. The reviewer just sees one colleague twice and
// has no way to tell from the screen that the rows belong together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountAccessRequests } from '../src/routes/access-requests.js';
import { normalizeIdentity } from '../src/lib/identity-normalize.js';
import { createFakeDb } from './helpers/fake-db.mjs';

async function withServer(fn, seed) {
  const db = createFakeDb();
  if (seed) await seed(db);

  const app = express();
  app.use(express.json());
  mountAccessRequests(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const submit = (body) =>
    fetch(`${base}/api/v1/access-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const list = () => fetch(`${base}/api/v1/access-requests`).then((r) => r.json());

  try {
    return await fn({ db, base, submit, list });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── the helper ──────────────────────────────────────────────────────────────

test('an email folds to lowercase', () => {
  assert.equal(normalizeIdentity('Chaitanya.Malle@cloudfuze.com'), 'chaitanya.malle@cloudfuze.com');
  assert.equal(normalizeIdentity('  Praveen.V@cloudfuze.com  '), 'praveen.v@cloudfuze.com');
});

test('an OS username keeps its capitalisation', () => {
  // It is a display name for a Windows account, not an address. Lowercasing it
  // would fix nothing and make every agent-enrolled row look wrong.
  assert.equal(normalizeIdentity('SudityaNimmala'), 'SudityaNimmala');
  assert.equal(normalizeIdentity('BhanuSrikakulam'), 'BhanuSrikakulam');
});

test('absent identities stay absent rather than becoming empty strings', () => {
  // 10 of the 40 live rows carry no user at all. They must remain null so the
  // roster falls through to the profile/hostname, not render a blank name.
  for (const v of [null, undefined, '', '   ']) assert.equal(normalizeIdentity(v), null);
});

// ── the write path ──────────────────────────────────────────────────────────

test('two requests from the same person in different case are one identity', async () => {
  await withServer(async ({ submit, list }) => {
    await submit({ machine_id: 'm1', tool_host: 'notion.so', user: 'Chaitanya.Malle@cloudfuze.com' });
    await submit({ machine_id: 'm2', tool_host: 'cursor.com', user: 'chaitanya.malle@cloudfuze.com' });

    const rows = await list();
    assert.equal(rows.length, 2);
    const identities = new Set(rows.map((r) => r.user));
    assert.equal(identities.size, 1, 'one colleague must not appear as two reviewers-worth of rows');
    assert.equal([...identities][0], 'chaitanya.malle@cloudfuze.com');
  });
});

// ── the read path, for rows that predate the fix ────────────────────────────

test('rows stored before the fix are folded on read', async () => {
  // The 40 requests already in production were written verbatim. Fixing only the
  // write path would leave them fragmented forever.
  await withServer(async ({ list }) => {
    const rows = await list();
    const users = rows.map((r) => r.user).sort();
    assert.deepEqual(users, ['praveen.v@cloudfuze.com', 'praveen.v@cloudfuze.com'],
      'both legacy spellings must resolve to the same identity');
  }, async (db) => {
    await db.collection('access_requests').insertMany([
      { id: 'a', machine_id: 'm1', tool_host: 'huggingface.co', status: 'pending', user: 'Praveen.V@cloudfuze.com', submitted_at: new Date('2026-08-01') },
      { id: 'b', machine_id: 'm2', tool_host: 'notion.so',      status: 'pending', user: 'praveen.v@cloudfuze.com', submitted_at: new Date('2026-08-02') },
    ]);
  });
});

test('a row with no user falls back to the enrolment record, normalised', async () => {
  await withServer(async ({ list }) => {
    const [row] = await list();
    assert.equal(row.user, 'bhanu.srikakulam@cloudfuze.com',
      'the fallback identity must be folded too, or the fallback reintroduces the split');
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'a', machine_id: 'm9', tool_host: 'claude.ai', status: 'pending', submitted_at: new Date(),
    });
    await db.collection('machines').insertOne({
      id: 'm9', hostname: 'BHANU-PC', user: 'Bhanu.Srikakulam@cloudfuze.com',
    });
  });
});
