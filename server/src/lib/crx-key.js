// The signing key for this deployment's extension package.
//
// WHY EACH CUSTOMER GETS THEIR OWN, RATHER THAN ONE CLOUDFUZE-SIGNED PACKAGE.
//
// An extension's ID is derived from its signing key, and the force-install policy
// on every managed machine names that ID. Two ways to arrange that for a product:
//
//   One key, held by CloudFuze. Every customer's browsers run a package signed by
//   us, which means shipping a 23 MB signed binary to every self-hosted install
//   (it cannot live in git), and it means our private key is the single thing
//   standing between an attacker and a force-installed extension on every
//   customer's fleet.
//
//   One key per deployment, generated where it runs. Nothing is shipped, no
//   CloudFuze secret reaches customer infrastructure, and a compromise is
//   contained to one tenant. The ID differs per customer — which costs nothing,
//   because each customer's policy only ever names their own.
//
// The second is what this does. There is no global ID to coordinate; the server
// tells the admin which ID to use, and the generated provisioning script already
// carries it.
//
// WHERE IT IS STORED. The customer's own database, not a file. This stack deploys
// as containers, and a file in the image is lost on the next deploy — which would
// mint a new key, change the ID, and orphan the force-install policy on every
// machine in that customer's fleet. Mongo is the only thing here that reliably
// survives a redeploy. It is the customer's own database holding the customer's
// own key, so no secret crosses a tenant boundary.
//
// CRX_SIGNING_KEY still wins when set, for anyone who would rather hold the key in
// their own secret manager.

import crypto from 'node:crypto';

import { generateKeyPem, extensionIdFromKey } from './crx.js';

const SETTINGS_KEY = 'crx_signing_key';

/** Read CRX_SIGNING_KEY, accepting a PEM or base64-wrapped PEM. */
export function signingKeyFromEnv() {
  const raw = process.env.CRX_SIGNING_KEY || '';
  if (!raw.trim()) return null;
  // Env plumbing mangles PEM newlines, and a silently truncated key produces a
  // package that installs nowhere — so both encodings are accepted and the result
  // is only used if it actually looks like a key.
  const pem = raw.includes('BEGIN')
    ? raw.replace(new RegExp(String.raw`\\n`, 'g'), '\n')
    : Buffer.from(raw, 'base64').toString('utf8');
  if (!pem.includes('BEGIN')) return null;
  try { crypto.createPublicKey(pem); } catch { return null; }
  return pem;
}

let _cached = null;

/**
 * The key this deployment signs with. Generated once and persisted; stable across
 * restarts and redeploys, which is the whole point.
 *
 * @param {object} db  Mongo-like handle, or null to fall back to env only
 * @returns {Promise<{pem: string, id: string, source: string}|null>}
 */
export async function getOrCreateSigningKey(db) {
  if (_cached) return _cached;

  const fromEnv = signingKeyFromEnv();
  if (fromEnv) {
    _cached = { pem: fromEnv, id: extensionIdFromKey(fromEnv), source: 'env' };
    return _cached;
  }
  if (!db) return null;

  const existing = await db.collection('settings').findOne({ key: SETTINGS_KEY });
  if (existing?.value) {
    _cached = { pem: existing.value, id: extensionIdFromKey(existing.value), source: 'database' };
    return _cached;
  }

  // First run for this deployment. Generate, persist, and say so loudly — the
  // admin needs to know a value now exists that must not be lost.
  const pem = generateKeyPem();
  const id = extensionIdFromKey(pem);
  await db.collection('settings').updateOne(
    { key: SETTINGS_KEY },
    { $set: { key: SETTINGS_KEY, value: pem, created_at: new Date() } },
    { upsert: true },
  );
  console.log(`[extension] generated a signing key for this deployment — extension id ${id}`);
  console.log('[extension] BACK UP the settings collection: losing this key means every '
    + 'force-install policy in the fleet names an extension that no longer exists.');
  _cached = { pem, id, source: 'database' };
  return _cached;
}

/** Test seam — the cache would otherwise leak between cases. */
export function _resetSigningKeyCache() {
  _cached = null;
}
