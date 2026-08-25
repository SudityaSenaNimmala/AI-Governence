// Turning enrolled machines into named employee profiles.
//
// THE DEFECT THIS PINS DOWN. On a browser-only rollout the extension is
// provisioned with the enrolled user's email — pushed as managed policy by the
// Intune script, which reads it from HKLM\SOFTWARE\Microsoft\Enrollments\*\UPN.
// That address arrives at /enroll in `user` and is stored on the machine record.
//
// resolveProfiles() read only `employee_email`, which is set by a DIFFERENT
// managed key (employeeEmail) that such a rollout does not use. So the machine
// reported a perfectly good corporate address and was still displayed as
// "Browser User (a1b2c3)" — the name was known and thrown away. Every downstream
// view (Activity, Access Requests, risk scores) showed the placeholder, which
// looks exactly like the case where no identity was available at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDb } from './helpers/fake-db.mjs';
import { resolveProfiles } from '../src/routes/identity.js';

function extensionMachine(over = {}) {
  return {
    id: 'ext-1',
    hostname: 'Mozilla-browser-extension',
    ...over,
  };
}

async function profilesAfter(machines) {
  const db = createFakeDb();
  await resolveProfiles(db, machines);
  return db.collection('employee_profiles').find({}).toArray();
}

test('an Intune-provisioned email becomes the display name', async () => {
  // The whole browser-only rollout depends on this one hop.
  const [p] = await profilesAfter([extensionMachine({ user: 'Satya.Pinniti@cloudfuze.com' })]);

  assert.equal(p.email, 'satya.pinniti@cloudfuze.com');
  assert.equal(p.display_name, 'Satya Pinniti');
  assert.ok(!/Browser User/.test(p.display_name),
    'a machine that reported a real address must never show the anonymous placeholder');
});

test('employee_email still wins when both are present', async () => {
  // employeeEmail is the explicit admin override; it must not be displaced by the
  // value the extension resolved for itself.
  const [p] = await profilesAfter([extensionMachine({
    user: 'resolved@cloudfuze.com',
    employee_email: 'Override@cloudfuze.com',
  })]);
  assert.equal(p.email, 'override@cloudfuze.com');
});

test('a non-email username is humanized rather than discarded', async () => {
  // The desktop-agent beacon reports an OS username, not an address. It is still
  // a name, and it is still better than a placeholder.
  const [p] = await profilesAfter([extensionMachine({ user: 'suditya.nimmala' })]);
  assert.equal(p.display_name, 'Suditya Nimmala');
  assert.equal(p.email, null, 'an OS username must not be recorded as an email address');
});

test('a machine that reported nothing still gets the anonymous placeholder', async () => {
  // The placeholder is a last resort, not a default — this is the genuinely
  // anonymous deployment and it must keep working.
  const [p] = await profilesAfter([extensionMachine({ id: 'ext-abcdef123456' })]);
  assert.match(p.display_name, /^Browser User \(/);
  assert.equal(p.email, null);
});

test('a value that only looks vaguely like an address is not treated as one', async () => {
  // "user" carries an OS username on the beacon path, and some of those contain
  // an @ (UPN-style logons, domain\\user variants). Recording a malformed value
  // as an email would silently corrupt matching against real profiles.
  for (const raw of ['DOMAIN\\alice', 'alice@', '@cloudfuze.com', 'alice@localhost']) {
    const [p] = await profilesAfter([extensionMachine({ user: raw })]);
    assert.equal(p.email, null, `${raw} must not be stored as an email`);
    assert.ok(p.display_name, 'but it should still produce some display name');
  }
});
