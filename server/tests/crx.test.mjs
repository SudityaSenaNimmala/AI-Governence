// Packing a signed .crx3 for self-hosted force-install.
//
// WHY THIS IS TESTED HARD. Publishing to the Web Store means a review queue; an
// enterprise can skip it by force-installing a self-hosted package from a managed
// device. The catch is that every failure in this path is SILENT: Chrome does not
// explain a malformed CRX or a signature that does not verify, it simply declines
// to install, and from the admin console that is indistinguishable from a policy
// that never applied. There is also no dependency doing the format for us, so the
// protobuf header is hand-written here and has to be checked against what a
// browser would actually do — parse the header, verify the signature over the
// domain-separated preamble, and confirm the embedded id matches the key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  generateKeyPem, publicKeyDer, extensionIdFromDer, extensionIdFromKey,
  manifestKeyFromPem, packCrx, parseCrx, updateManifestXml,
} from '../src/lib/crx.js';
import { createZip } from '../src/lib/zip.js';

const KEY = generateKeyPem();
const ZIP = createZip([
  { name: 'manifest.json', data: Buffer.from('{"manifest_version":3,"name":"t","version":"0.8.0"}', 'utf8') },
  { name: 'background/service-worker.js', data: Buffer.from('// worker', 'utf8') },
]);

// ── A protobuf reader, so the test decodes the header rather than trusting it ──

function readVarint(buf, pos) {
  let result = 0; let shift = 0; let p = pos;
  for (;;) {
    const byte = buf[p]; p += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, p];
}

/** Every length-delimited field in a message, as {field, value} in order. */
function readFields(buf) {
  const out = [];
  let p = 0;
  while (p < buf.length) {
    let key; [key, p] = readVarint(buf, p);
    const field = key >>> 3;
    const wire = key & 7;
    assert.equal(wire, 2, `unexpected wire type ${wire} for field ${field}`);
    let len; [len, p] = readVarint(buf, p);
    out.push({ field, value: buf.subarray(p, p + len) });
    p += len;
  }
  return out;
}

// ── Identity ────────────────────────────────────────────────────────────────

test('an extension id is 32 characters from the a-p alphabet', () => {
  const id = extensionIdFromKey(KEY);
  assert.equal(id.length, 32);
  assert.match(id, /^[a-p]{32}$/, 'ids outside a-p are rejected by the browser outright');
});

test('the id is derived from the key, so it is stable across packings', () => {
  const a = packCrx(ZIP, KEY);
  const b = packCrx(createZip([{ name: 'other.js', data: Buffer.from('x') }]), KEY);
  assert.equal(a.id, b.id, 'changing the CONTENTS must not change the id');
  assert.equal(a.id, extensionIdFromKey(KEY));
});

test('a different key means a different id', () => {
  // The operational consequence: losing the key invalidates every deployed
  // policy, because the id it names no longer exists.
  assert.notEqual(extensionIdFromKey(KEY), extensionIdFromKey(generateKeyPem()));
});

test('the manifest key field derives the SAME id as the packed build', () => {
  // If these disagree, an unpacked developer load has a different id than the
  // packed one, so the policy works in production and silently not in testing —
  // and the symptom looks like "the policy did not apply".
  const fromManifest = extensionIdFromDer(Buffer.from(manifestKeyFromPem(KEY), 'base64'));
  assert.equal(fromManifest, extensionIdFromKey(KEY));
});

// ── Container ───────────────────────────────────────────────────────────────

test('the package is a CRX3 container with the zip intact', () => {
  const { crx } = packCrx(ZIP, KEY);
  assert.equal(crx.subarray(0, 4).toString('ascii'), 'Cr24');

  const parsed = parseCrx(crx);
  assert.equal(parsed.version, 3);
  assert.ok(parsed.zip.equals(ZIP), 'the archive must be embedded byte-for-byte');
});

test('the header carries the public key and the id the browser will check', () => {
  const { crx, id } = packCrx(ZIP, KEY);
  const fields = readFields(parseCrx(crx).header);

  const proof = fields.find((f) => f.field === 2);
  const signedHeaderData = fields.find((f) => f.field === 10000);
  assert.ok(proof, 'CrxFileHeader.sha256_with_rsa (field 2) is missing');
  assert.ok(signedHeaderData, 'CrxFileHeader.signed_header_data (field 10000) is missing');

  const [pub, sig] = readFields(proof.value);
  assert.equal(pub.field, 1);
  assert.equal(sig.field, 2);
  assert.ok(pub.value.equals(publicKeyDer(KEY)), 'the DER public key must be embedded verbatim');

  // SignedData.crx_id — the RAW 16 bytes, which must decode to the same id.
  const [crxId] = readFields(signedHeaderData.value);
  assert.equal(crxId.value.length, 16);
  let decoded = '';
  for (const byte of crxId.value) {
    decoded += String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 0x0f));
  }
  assert.equal(decoded, id, 'the id inside the header must match the id the policy names');
});

// ── Signature ───────────────────────────────────────────────────────────────

function verifyAsBrowserWould(crx) {
  const { header, zip } = parseCrx(crx);
  const fields = readFields(header);
  const proof = readFields(fields.find((f) => f.field === 2).value);
  const signedHeaderData = fields.find((f) => f.field === 10000).value;

  const pub = proof.find((f) => f.field === 1).value;
  const sig = proof.find((f) => f.field === 2).value;

  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(signedHeaderData.length, 0);

  return crypto.createVerify('sha256')
    .update(Buffer.from('CRX3 SignedData\x00', 'binary'))
    .update(prefix)
    .update(signedHeaderData)
    .update(zip)
    .verify(crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }), sig);
}

test('the signature verifies over the domain-separated preamble', () => {
  assert.equal(verifyAsBrowserWould(packCrx(ZIP, KEY).crx), true);
});

test('tampering with the archive invalidates the signature', () => {
  // The property that makes hosting this ourselves acceptable: a package modified
  // in transit or on the file share will not install.
  const { crx } = packCrx(ZIP, KEY);
  const tampered = Buffer.from(crx);
  tampered[tampered.length - 1] ^= 0xff;
  assert.equal(verifyAsBrowserWould(tampered), false);
});

test('an empty archive is refused rather than packed', () => {
  assert.throws(() => packCrx(Buffer.alloc(0), KEY), /non-empty/);
});

// ── Update manifest ─────────────────────────────────────────────────────────

test('the update manifest names the id, version and package location', () => {
  const xml = updateManifestXml({
    id: 'abcdefghijklmnopabcdefghijklmnop',
    version: '0.8.0',
    codebase: 'https://gov.example.test/api/v1/installations/extension.crx',
  });
  assert.match(xml, /appid='abcdefghijklmnopabcdefghijklmnop'/);
  assert.match(xml, /version='0\.8\.0'/);
  assert.match(xml, /codebase='https:\/\/gov\.example\.test/);
  assert.match(xml, /protocol='2\.0'/);
});

test('the update manifest escapes its inputs', () => {
  // codebase comes from the request host, so it is not ours to trust.
  const xml = updateManifestXml({
    id: 'x', version: '1', codebase: "https://h/?a=1&b='2'",
  });
  assert.ok(!xml.includes("&b='2'"), 'raw quotes/ampersands would break the XML');
  assert.match(xml, /&amp;b=&apos;2&apos;/);
});

test('an incomplete update manifest is refused', () => {
  // A manifest missing the version silently stops browsers updating, which is the
  // usual reason a self-hosted rollout appears stuck on an old build.
  assert.throws(() => updateManifestXml({ id: 'x', codebase: 'https://h/x.crx' }), /required/);
});
