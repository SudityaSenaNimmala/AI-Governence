// The fleet-known email matcher (lib/known-emails.js) and resolveProfiles using
// it to give an email-less profile its owner's work address.
//
// WHY. A desktop agent reports a run-together OS username ("Pravallikapunumalli")
// that no formatter can split. The same person's Claude Code session / usage
// tracker reports "pravallika.punumalli@cloudfuze.com" on another machine record.
// Linking the two is what lets every dashboard show "Pravallika Punumalli".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDb } from './helpers/fake-db.mjs';
import { compactKey, knownEmailsByKey, emailForUsername } from '../src/lib/known-emails.js';
import { resolveProfiles } from '../src/routes/identity.js';

test('compactKey strips domain prefix, email domain and separators', () => {
  assert.equal(compactKey('CORP\\Pravallikapunumalli'), 'pravallikapunumalli');
  assert.equal(compactKey('pravallika.punumalli@cloudfuze.com'), 'pravallikapunumalli');
  assert.equal(compactKey('Sruthi_Chimata'), 'sruthichimata');
  assert.equal(compactKey(null), '');
});

test('knownEmailsByKey: emails only, ambiguous keys null, demo personas skipped', () => {
  const map = knownEmailsByKey([
    { id: 'clicode:a', user: 'Pravallika.Punumalli@cloudfuze.com' },
    { id: 'clautrk:b', user: 'pravallika.punumalli@cloudfuze.com' }, // same email: not ambiguous
    { id: 'm1', user: 'SruthiChimata' },                              // not an email
    { id: 'm2', user: 'a.b@one.com' },
    { id: 'm3', user: 'ab@two.com' },                                 // same key, different email
    { id: 'm4', user: 'james.carter@cloudfuze.com' },                 // demo persona
  ]);
  assert.equal(map.get('pravallikapunumalli'), 'pravallika.punumalli@cloudfuze.com');
  assert.equal(map.has('sruthichimata'), false);
  assert.equal(map.get('ab'), null);
  assert.equal(map.has('jamescarter'), false);

  // Accepts a Map of machines too (risk-score passes its byId map).
  const fromMap = knownEmailsByKey(new Map([['x', { user: 'x.y@z.com' }]]));
  assert.equal(fromMap.get('xy'), 'x.y@z.com');

  assert.equal(emailForUsername(map, 'Pravallikapunumalli'), 'pravallika.punumalli@cloudfuze.com');
  assert.equal(emailForUsername(map, 'ab'), null);
  assert.equal(emailForUsername(map, 'JamesCarter'), null);
  assert.equal(emailForUsername(map, ''), null);
});

const agent = (over) => ({ platform: 'win32', type: 'desktop-agent', ...over });

test('resolveProfiles sets a fleet-known email on an email-less agent profile and heals its name', async () => {
  const db = createFakeDb();
  const machines = [
    agent({ id: 'm-pc', hostname: 'PRAV-PC', user: 'Pravallikapunumalli' }),
    { id: 'clicode:abc', hostname: 'Claude Code', user: 'pravallika.punumalli@cloudfuze.com' },
  ];
  const stats = await resolveProfiles(db, machines);
  const profiles = await db.collection('employee_profiles').find({}).toArray();
  const p = profiles.find((x) => x.os_user === 'Pravallikapunumalli');
  assert.ok(p, 'agent profile created');
  assert.equal(p.email, 'pravallika.punumalli@cloudfuze.com');
  assert.equal(p.display_name, 'Pravallika Punumalli');
  assert.equal(stats.emailed, 1);

  // Idempotent: a second pass changes nothing.
  const again = await resolveProfiles(db, machines);
  assert.equal(again.emailed, 0);
});

test('resolveProfiles never overwrites an existing email or an admin-edited spaced name', async () => {
  const db = createFakeDb();
  await db.collection('employee_profiles').insertOne({
    id: 'p1', resolve_key: 'agent:host1:sruthichimata', os_user: 'sruthichimata',
    display_name: 'Sruthi C.', email: null, hostname: 'host1', machine_ids: [],
  });
  await db.collection('employee_profiles').insertOne({
    id: 'p2', resolve_key: 'agent:host2:aniluser', os_user: 'aniluser',
    display_name: 'Anil', email: 'anil@corp.com', hostname: 'host2', machine_ids: [],
  });
  await resolveProfiles(db, [
    { id: 'clautrk:1', user: 'sruthi.chimata@cloudfuze.com' },
    { id: 'clautrk:2', user: 'anil.user@cloudfuze.com' },
  ]);
  const p1 = await db.collection('employee_profiles').findOne({ id: 'p1' });
  const p2 = await db.collection('employee_profiles').findOne({ id: 'p2' });
  assert.equal(p1.email, 'sruthi.chimata@cloudfuze.com');
  assert.equal(p1.display_name, 'Sruthi C.', 'a spaced (admin) name is never rewritten');
  assert.equal(p2.email, 'anil@corp.com', 'an existing email is never replaced');
});

test('resolveProfiles skips ambiguous keys and demo personas', async () => {
  const db = createFakeDb();
  await db.collection('employee_profiles').insertOne({
    id: 'amb', resolve_key: 'agent:h:ab', os_user: 'ab', display_name: 'Ab', email: null, machine_ids: [],
  });
  await db.collection('employee_profiles').insertOne({
    id: 'demo', resolve_key: 'agent:james:jamescarter', os_user: 'JamesCarter',
    display_name: 'JamesCarter', email: null, machine_ids: [],
  });
  await resolveProfiles(db, [
    { id: 'c1', user: 'a.b@one.com' },
    { id: 'c2', user: 'ab@two.com' },
    { id: 'c3', user: 'james.carter@cloudfuze.com' },
  ]);
  assert.equal((await db.collection('employee_profiles').findOne({ id: 'amb' })).email, null);
  assert.equal((await db.collection('employee_profiles').findOne({ id: 'demo' })).email, null);
});
