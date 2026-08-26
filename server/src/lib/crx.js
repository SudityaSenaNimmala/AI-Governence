// Pack a browser extension into a signed .crx3, and derive its extension ID.
//
// WHY THIS EXISTS. Force-installing an extension normally means publishing it to
// the Chrome Web Store / Edge Add-ons and letting the store assign an ID. That is
// a review queue measured in days. An enterprise can skip it: Chrome and Edge will
// force-install from a self-hosted update manifest on a MANAGED device, provided
// the package is a properly signed .crx3 and the policy names the ID it signs to.
//
// THE ID IS THE PUBLIC KEY, NOT A NAME. An extension's ID is the first 16 bytes of
// SHA-256 over the DER-encoded public key, rendered in a 16-letter alphabet (a–p).
// Two consequences drive everything below:
//
//   1. Whoever holds the private key controls the ID. Generate it ONCE and keep it,
//      because a new key means a new ID, which means the force-install policy on
//      every machine now points at an extension that no longer exists.
//   2. The same key must be embedded in manifest.json as `key`, or an unpacked
//      load (developer testing) gets a different, random ID than the packed build
//      — so the policy would work in production and silently not in testing.
//
// CRX3 FORMAT, since there is no dependency here doing it for us:
//
//   "Cr24"            magic
//   uint32le 3        format version
//   uint32le N        header length
//   N bytes           CrxFileHeader protobuf
//   ...               the ZIP archive, verbatim
//
// and the signature covers a domain-separated preamble rather than the raw file,
// which is what stops a signature being lifted from one context into another:
//
//   "CRX3 SignedData\x00" || uint32le(len(signedHeaderData)) || signedHeaderData || zip

import crypto from 'node:crypto';

const CRX_MAGIC = Buffer.from('Cr24', 'ascii');
const CRX_VERSION = 3;
const SIGNATURE_CONTEXT = Buffer.from('CRX3 SignedData\x00', 'binary');

// ── Minimal protobuf writing ────────────────────────────────────────────────
// Only two wire shapes are needed — a length-delimited field, and the varint key
// that introduces it — so a full protobuf runtime would be more code to audit
// than the format it implements.

function varint(value) {
  const out = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Buffer.from(out);
}

/** field number + wire type 2 (length-delimited), then length, then payload. */
function lengthDelimited(fieldNumber, payload) {
  return Buffer.concat([
    varint((fieldNumber << 3) | 2),
    varint(payload.length),
    payload,
  ]);
}

// ── Keys and IDs ────────────────────────────────────────────────────────────

/** A fresh 2048-bit RSA key as PKCS#8 PEM. Generate once; losing it changes the ID. */
export function generateKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return privateKey;
}

/** DER (SPKI) public key for a private key PEM — the exact bytes the ID hashes. */
export function publicKeyDer(privateKeyPem) {
  return crypto.createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
}

/**
 * The extension ID: SHA-256 of the DER public key, first 16 bytes, each nibble
 * mapped 0–f → a–p. Chrome calls this "mpdecimal"; it exists so an ID is always
 * 32 letters and never looks like a hash a user might try to read as one.
 */
export function extensionIdFromDer(der) {
  const digest = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i += 1) {
    const byte = digest[i];
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

/** Convenience: private key PEM → extension ID. */
export function extensionIdFromKey(privateKeyPem) {
  return extensionIdFromDer(publicKeyDer(privateKeyPem));
}

/**
 * The value manifest.json's `key` field takes: base64 of the DER public key.
 *
 * Embedding it is not optional in practice. Without it an unpacked load gets a
 * random ID, so the machine you test on and the machines the policy targets
 * disagree about which extension this is — and that failure looks like "the
 * policy did not apply" rather than "the ID is different".
 */
export function manifestKeyFromPem(privateKeyPem) {
  return publicKeyDer(privateKeyPem).toString('base64');
}

// ── Packing ─────────────────────────────────────────────────────────────────

/**
 * Wrap a ZIP archive in a signed CRX3 container.
 *
 * @param {Buffer} zipBuffer   the extension directory, zipped
 * @param {string} privateKeyPem  PKCS#8 PEM; its public half becomes the ID
 * @returns {{crx: Buffer, id: string}}
 */
export function packCrx(zipBuffer, privateKeyPem) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    throw new Error('packCrx: zipBuffer must be a non-empty Buffer');
  }
  const der = publicKeyDer(privateKeyPem);
  const id = extensionIdFromDer(der);

  // SignedData { bytes crx_id = 1 } — the 16 RAW bytes, not the a–p rendering.
  const crxIdBytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) {
    const hi = id.charCodeAt(i * 2) - 97;
    const lo = id.charCodeAt(i * 2 + 1) - 97;
    crxIdBytes[i] = (hi << 4) | lo;
  }
  const signedHeaderData = lengthDelimited(1, crxIdBytes);

  // The signature covers the context string, the length-prefixed signed header,
  // and the archive — in that order.
  const lengthPrefix = Buffer.alloc(4);
  lengthPrefix.writeUInt32LE(signedHeaderData.length, 0);
  const signature = crypto.createSign('sha256')
    .update(SIGNATURE_CONTEXT)
    .update(lengthPrefix)
    .update(signedHeaderData)
    .update(zipBuffer)
    .sign(privateKeyPem);

  // AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
  const proof = Buffer.concat([
    lengthDelimited(1, der),
    lengthDelimited(2, signature),
  ]);

  // CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2;
  //                 bytes signed_header_data = 10000; }
  const header = Buffer.concat([
    lengthDelimited(2, proof),
    lengthDelimited(10000, signedHeaderData),
  ]);

  const prelude = Buffer.alloc(12);
  CRX_MAGIC.copy(prelude, 0);
  prelude.writeUInt32LE(CRX_VERSION, 4);
  prelude.writeUInt32LE(header.length, 8);

  return { crx: Buffer.concat([prelude, header, zipBuffer]), id };
}

/**
 * The Omaha update manifest Chrome and Edge poll for a self-hosted extension.
 *
 * The version here MUST match manifest.json's, and must increase on every update
 * or browsers will not fetch the new package — a stale version is the usual
 * reason a self-hosted rollout appears to be stuck on an old build.
 */
export function updateManifestXml({ id, version, codebase }) {
  if (!id || !version || !codebase) {
    throw new Error('updateManifestXml: id, version and codebase are all required');
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${esc(id)}'>
    <updatecheck codebase='${esc(codebase)}' version='${esc(version)}' />
  </app>
</gupdate>
`;
}

/**
 * Read a CRX3 back: used by the tests, and by anyone who needs to confirm that a
 * package on disk really signs to the ID their policy names.
 */
export function parseCrx(crxBuffer) {
  if (crxBuffer.length < 12 || !crxBuffer.subarray(0, 4).equals(CRX_MAGIC)) {
    throw new Error('not a CRX file (bad magic)');
  }
  const version = crxBuffer.readUInt32LE(4);
  if (version !== CRX_VERSION) throw new Error(`unsupported CRX version ${version}`);
  const headerLength = crxBuffer.readUInt32LE(8);
  const header = crxBuffer.subarray(12, 12 + headerLength);
  const zip = crxBuffer.subarray(12 + headerLength);
  return { version, header, zip };
}
