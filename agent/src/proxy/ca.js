// CloudFuze AI Governance — local certificate authority for the MITM proxy.
//
// The CA root is generated once on first proxy start and persisted at
// ~/.cloudfuze-aigov/ca/{ca.key,ca.crt}. The CA is installed into the user's
// trust store (see trust-win32.js) so the OS / browsers / Electron apps accept
// the leaf certs the proxy mints on the fly.
//
// We use RSA-2048 (not 4096) for the CA key — 2048 is universally accepted,
// faster to generate, and saves ~3s on first-run UX. The threat model is
// "DLP for a single user's outbound HTTPS to AI vendors", not "protect against
// a nation-state adversary forging a CloudFuze cert"; 2048 is more than enough.
//
// Leaf certs are generated per (host, SAN-list) on first request, then cached
// in-memory for the lifetime of the proxy process. Cache keyed on lowercased
// host. No on-disk cache — keeps the FS surface small and removes a class of
// "stale cert after rotation" bugs.

import forge from 'node-forge';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const CA_DIR  = join(os.homedir(), '.cloudfuze-aigov', 'ca');
const CA_KEY  = join(CA_DIR, 'ca.key');
const CA_CERT = join(CA_DIR, 'ca.crt');

const CA_COMMON_NAME = 'CloudFuze AI Governance Root CA';
const CA_ORG         = 'CloudFuze, Inc.';
const CA_VALID_YEARS = 10;
const LEAF_VALID_DAYS = 90;

// Minimal RSA bits for leaf certs. Some apps (notably Microsoft Edge Chromium)
// reject sub-2048 RSA when validating Trusted Root chains.
const LEAF_RSA_BITS = 2048;

/**
 * Load the on-disk CA, or generate + persist a new one if missing.
 * Returns { caKeyPem, caCertPem, caCert (forge), caKey (forge), fingerprintSha256 }.
 */
export async function loadOrCreateCA({ log } = {}) {
  await mkdir(CA_DIR, { recursive: true });
  const existing = await tryLoad();
  if (existing) {
    log?.info?.(`proxy/ca: loaded existing CA (sha256=${existing.fingerprintSha256.slice(0, 24)}…)`);
    return existing;
  }
  log?.info?.('proxy/ca: no CA found — generating new RSA-2048 root (≈2s)');
  const fresh = await generate();
  await writeFile(CA_KEY,  fresh.caKeyPem,  { mode: 0o600 });
  await writeFile(CA_CERT, fresh.caCertPem, { mode: 0o644 });
  log?.info?.(`proxy/ca: new CA written to ${CA_DIR} (sha256=${fresh.fingerprintSha256.slice(0, 24)}…)`);
  return fresh;
}

async function tryLoad() {
  try {
    await access(CA_KEY, fsConstants.R_OK);
    await access(CA_CERT, fsConstants.R_OK);
  } catch {
    return null;
  }
  const caKeyPem  = await readFile(CA_KEY,  'utf8');
  const caCertPem = await readFile(CA_CERT, 'utf8');
  const caKey  = forge.pki.privateKeyFromPem(caKeyPem);
  const caCert = forge.pki.certificateFromPem(caCertPem);
  return { caKeyPem, caCertPem, caKey, caCert, fingerprintSha256: fingerprintCert(caCert) };
}

async function generate() {
  // RSA-2048 root key.
  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter  = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + CA_VALID_YEARS);

  const attrs = [
    { name: 'commonName',         value: CA_COMMON_NAME },
    { name: 'organizationName',   value: CA_ORG         },
    { shortName: 'OU',            value: 'AI Governance - DLP proxy' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);   // self-signed
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keypair.privateKey, forge.md.sha256.create());

  const caCertPem = forge.pki.certificateToPem(cert);
  const caKeyPem  = forge.pki.privateKeyToPem(keypair.privateKey);
  return {
    caKeyPem, caCertPem,
    caKey: keypair.privateKey,
    caCert: cert,
    fingerprintSha256: fingerprintCert(cert),
  };
}

/**
 * Mint a leaf TLS cert signed by the CA for the given host (or list of hosts).
 * Returns { certPem, keyPem } suitable for tls.createSecureContext().
 *
 * Synchronous (forge is in-process). RSA-2048 keygen is ~150-300ms on a modern
 * laptop. Callers should cache by host.
 */
export function mintLeafCert({ ca, hosts }) {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw new Error('mintLeafCert: hosts[] required');
  }
  const primary = hosts[0];
  const keypair = forge.pki.rsa.generateKeyPair({ bits: LEAF_RSA_BITS, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter  = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + LEAF_VALID_DAYS);

  cert.setSubject([
    { name: 'commonName',       value: primary       },
    { name: 'organizationName', value: CA_ORG        },
    { shortName: 'OU',          value: 'AI Governance - proxy leaf' },
  ]);
  cert.setIssuer(ca.caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    {
      name: 'subjectAltName',
      altNames: hosts.map((h) => isIp(h)
        ? { type: 7, ip: h }     // IP SAN
        : { type: 2, value: h }  // DNS SAN
      ),
    },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(ca.caKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem:  forge.pki.privateKeyToPem(keypair.privateKey),
  };
}

// ---- helpers ----
function randomSerial() {
  // 16-byte serial as hex. Some CAs require the high bit unset; forge handles
  // that for us when we set serialNumber as a hex string.
  const bytes = forge.random.getBytesSync(16);
  const hex = forge.util.bytesToHex(bytes);
  // Clear the top bit to keep the integer positive — RFC 5280 requires
  // serialNumber to be a positive integer.
  const firstByte = parseInt(hex.slice(0, 2), 16) & 0x7f;
  return firstByte.toString(16).padStart(2, '0') + hex.slice(2);
}
function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}
function fingerprintCert(cert) {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  return md.digest().toHex();
}

export { CA_DIR, CA_KEY, CA_CERT };
