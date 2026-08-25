// One signing key per deployment, generated where it runs and never lost.
//
// WHY THIS MATTERS FOR A PRODUCT. An extension's ID is derived from its signing
// key, and the force-install policy on every managed machine names that ID. Two
// arrangements were possible: one CloudFuze-held key for all customers, which
// means shipping a 23 MB signed binary to every self-hosted install and making our
// private key the single thing between an attacker and a force-installed extension
// on every customer fleet — or a key per deployment, which ships nothing, puts no
// CloudFuze secret on customer infrastructure, and contains a compromise to one
// tenant. The ID differing per customer costs nothing, since each customer's
// policy only ever names their own.
//
// The failure this pins down is losing it. A key regenerated on redeploy mints a
// new ID, and every machine's policy then names an extension that does not exist —
// silently, because a force-install that matches nothing reports nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeDb } from './helpers/fake-db.mjs';
import { getOrCreateSigningKey, signingKeyFromEnv, _resetSigningKeyCache } from '../src/lib/crx-key.js';
import { generateKeyPem, extensionIdFromKey } from '../src/lib/crx.js';

function clean() {
  _resetSigningKeyCache();
  delete process.env.CRX_SIGNING_KEY;
}

test('a first run generates a key and persists it', async () => {
  clean();
  const db = createFakeDb();
  const first = await getOrCreateSigningKey(db);

  assert.ok(first.pem.includes('BEGIN'), 'a real PEM');
  assert.match(first.id, /^[a-p]{32}$/);
  assert.equal(first.source, 'database');

  const stored = await db.collection('settings').findOne({ key: 'crx_signing_key' });
  assert.equal(stored.value, first.pem, 'it must survive this process');
});

test('a restart reuses the stored key, so the extension ID never changes', async () => {
  clean();
  const db = createFakeDb();
  const before = await getOrCreateSigningKey(db);

  // A redeploy: same database, brand-new process with no cache.
  _resetSigningKeyCache();
  const after = await getOrCreateSigningKey(db);

  assert.equal(after.id, before.id,
    'a new ID here would orphan the force-install policy on every machine in the fleet');
  assert.equal(after.pem, before.pem);
});

test('CRX_SIGNING_KEY overrides the database, for externally managed secrets', async () => {
  clean();
  const db = createFakeDb();
  const stored = await getOrCreateSigningKey(db);      // put something in the db first

  const external = generateKeyPem();
  _resetSigningKeyCache();
  process.env.CRX_SIGNING_KEY = external;

  const used = await getOrCreateSigningKey(db);
  assert.equal(used.id, extensionIdFromKey(external));
  assert.equal(used.source, 'env');
  assert.notEqual(used.id, stored.id, 'the env value must win, not be merged');
  clean();
});

test('a base64-wrapped env key is accepted', async () => {
  // Env plumbing mangles PEM newlines. A key that silently fails to parse would
  // fall through to a DIFFERENT key and change the ID, so both forms are read.
  clean();
  const key = generateKeyPem();
  process.env.CRX_SIGNING_KEY = Buffer.from(key, 'utf8').toString('base64');
  assert.equal(extensionIdFromKey(signingKeyFromEnv()), extensionIdFromKey(key));
  clean();
});

test('a malformed env key is rejected rather than half-used', async () => {
  // Returning garbage here would throw deep inside packCrx at request time; the
  // useful behaviour is to ignore it and fall back to the persisted key.
  clean();
  for (const bad of ['not-a-key', 'BEGIN but not really', Buffer.from('nope').toString('base64')]) {
    process.env.CRX_SIGNING_KEY = bad;
    assert.equal(signingKeyFromEnv(), null, `${bad.slice(0, 20)} must be refused`);
  }
  clean();

  // ...and with a malformed env value present, the deployment still works.
  process.env.CRX_SIGNING_KEY = 'not-a-key';
  const db = createFakeDb();
  const key = await getOrCreateSigningKey(db);
  assert.equal(key.source, 'database', 'falls back rather than failing the deployment');
  clean();
});

test('with no database and no env there is no key, rather than a throwaway one', async () => {
  // Minting an in-memory key would produce a package that installs once and is
  // orphaned on the next restart — worse than answering "not available".
  clean();
  assert.equal(await getOrCreateSigningKey(null), null);
});
