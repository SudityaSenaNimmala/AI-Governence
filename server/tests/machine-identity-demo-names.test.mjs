// REGRESSION: a real PC whose machine record still carried the old demo
// relabelling (hostname EMILY, user "EmilyRodriguez", inside an "Emily
// Rodriguez" profile) showed its events in Activity as "Emily Rodriguez", though
// every event was stamped with the real OS user "Pravallikapunumalli".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachMachineIdentity } from '../src/lib/machine-identity.js';
import { createFakeDb } from './helpers/fake-db.mjs';

async function seed() {
  const db = createFakeDb();
  await db.collection('machines').insertMany([
    { id: 'm-old-pc', hostname: 'EMILY', user: 'EmilyRodriguez', platform: 'win32' },
    { id: 'clicode:Pravallika.Punumalli@cloudfuze.com', hostname: 'Claude Code CLI', user: 'Pravallika.Punumalli@cloudfuze.com' },
  ]);
  await db.collection('employee_profiles').insertMany([
    { id: 'p-emily', display_name: 'Emily Rodriguez', machine_ids: ['m-old-pc'] },
  ]);
  return db;
}

test('the event\'s own user wins and a demo persona never names the row', async () => {
  const db = await seed();
  const [row] = await attachMachineIdentity(db, [{ machine_id: 'm-old-pc', user: 'Pravallikapunumalli' }]);
  assert.equal(row.user, 'Pravallikapunumalli');
  assert.equal(row.employee_name ?? null, null);
  assert.equal(row.email, 'pravallika.punumalli@cloudfuze.com');
});

test('a row with no user of its own is not filled with a demo persona', async () => {
  const db = await seed();
  const [row] = await attachMachineIdentity(db, [{ machine_id: 'm-old-pc' }]);
  assert.equal(row.user, null);
  assert.equal(row.employee_name ?? null, null);
});
