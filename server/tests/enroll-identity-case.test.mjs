// One person, one row — the case-folding that makes the desktop agent and the
// browser extension merge.
//
// THE DEFECT THIS PINS DOWN. Both surfaces now report the corporate UPN so they
// share an identity, but they read it from different places and Windows does not
// agree with itself about capitalisation:
//
//   whoami /upn                              -> satya.pinniti@cloudfuze.com
//   HKLM\...\Enrollments\<guid>\UPN          -> Satya.Pinniti@cloudfuze.com
//
// Both observed on one real Entra-joined machine. The desktop agent resolves the
// first, the Intune provisioning script pushes the second to the extension as
// managed policy. server/src/routes/ai-usage.js groups usage by `machines.user`
// with an EXACT match, so storing them verbatim splits one human into two rows
// that differ only by two capital letters — and the whole UPN alignment is
// defeated by capitalisation alone.
//
// An OS username must NOT be folded: it is a Windows account's display name, and
// "SatyaPinniti" is how its owner expects to read it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountEnroll } from '../src/routes/enroll.js';
import { ENROLL_SECRET } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json());
  mountEnroll(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const enroll = (body) =>
    fetch(`${base}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollSecret: ENROLL_SECRET, ...body }),
    });

  try {
    return await fn({ db, enroll });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const userOf = async (db, id) =>
  (await db.collection('machines').findOne({ id })).user;

test('the agent and the extension land on ONE identity despite differing case', async () => {
  await withServer(async ({ db, enroll }) => {
    // The desktop agent, resolving the UPN via `whoami /upn`.
    await enroll({
      machineId: 'agent-1',
      hostname: 'SATYA',
      user: 'satya.pinniti@cloudfuze.com',
    });
    // The browser extension on the SAME machine, whose userEmail came from the
    // Intune enrolment registry key.
    await enroll({
      machineId: 'ext-1',
      hostname: 'SATYA-browser-extension',
      user: 'Satya.Pinniti@cloudfuze.com',
    });

    const agentUser = await userOf(db, 'agent-1');
    const extUser = await userOf(db, 'ext-1');

    assert.equal(agentUser, 'satya.pinniti@cloudfuze.com');
    assert.equal(extUser, 'satya.pinniti@cloudfuze.com');
    // The actual requirement: ai-usage.js groups on this exact string.
    assert.equal(agentUser, extUser, 'one person must not become two rows');
  });
});

test('an OS username keeps its capitalisation', async () => {
  await withServer(async ({ db, enroll }) => {
    // A machine with no work identity — a local account, or a UPN outside the
    // corporate domain. The agent falls back to the OS account name, which is a
    // display name and not an address.
    await enroll({ machineId: 'local-1', hostname: 'WORKBENCH', user: 'SatyaPinniti' });

    assert.equal(await userOf(db, 'local-1'), 'SatyaPinniti');
  });
});

test('surrounding whitespace never forks an identity', async () => {
  await withServer(async ({ db, enroll }) => {
    await enroll({ machineId: 'a', hostname: 'H1', user: '  satya.pinniti@cloudfuze.com  ' });
    await enroll({ machineId: 'b', hostname: 'H2', user: 'satya.pinniti@cloudfuze.com' });

    assert.equal(await userOf(db, 'a'), await userOf(db, 'b'));
  });
});

test('an absent user does not overwrite one already recorded', async () => {
  await withServer(async ({ db, enroll }) => {
    // The full agent used to enrol without a user at all. A later re-enrol that
    // omits it must not blank out a name the machine already reported.
    await enroll({ machineId: 'm', hostname: 'H', user: 'Satya.Pinniti@cloudfuze.com' });
    await enroll({ machineId: 'm', hostname: 'H' });

    assert.equal(await userOf(db, 'm'), 'satya.pinniti@cloudfuze.com');
  });
});
