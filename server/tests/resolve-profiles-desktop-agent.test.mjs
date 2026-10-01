// REGRESSION: resolveProfiles only built profiles for machines with BOTH `user`
// and `platform`. The tray app / os_monitor never sends a platform — the server
// marks those machines `type: 'desktop-agent'` instead — so a machine the
// Overview counted as a System (e.g. a friend's laptop reporting DLP events)
// never got an employee profile and never appeared in Risk Scores.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveProfiles } from '../src/routes/identity.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const profilesFor = async (machines) => {
  const db = createFakeDb();
  await db.collection('machines').insertMany(machines);
  await resolveProfiles(db, machines);
  return db.collection('employee_profiles').find({}).toArray();
};

test('a desktop-agent machine with a user but no platform gets a profile', async () => {
  const rows = await profilesFor([
    { id: 'm-sruthi', hostname: 'LAPTOP-FCRNKB4', user: 'SruthiChimata', type: 'desktop-agent' },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].machine_ids, ['m-sruthi']);
});

test('scanner machines with user + platform still get a profile', async () => {
  const rows = await profilesFor([
    { id: 'm-james', hostname: 'JAMES', user: 'JamesCarter', platform: 'win32' },
  ]);
  assert.equal(rows.length, 1);
});

test('no user, CLI sessions and usage trackers never get an agent profile', async () => {
  const rows = await profilesFor([
    { id: 'm-nouser', hostname: 'EMILY', type: 'desktop-agent' },
    { id: 'clicode:someone@x.com', hostname: 'Claude Code CLI', user: 'someone@x.com', type: 'desktop-agent' },
    { id: 'clautrk:abc', hostname: 'LAPTOP-X', user: 'Someone', type: 'desktop-agent' },
  ]);
  assert.equal(rows.length, 0);
});
