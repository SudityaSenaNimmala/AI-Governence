// Smoke test: generate CA, mint a leaf cert for api.openai.com, verify the
// leaf validates against the CA using node's own X509Certificate. Does NOT
// touch the trust store or open any ports.

import { loadOrCreateCA, mintLeafCert } from '../src/proxy/ca.js';
import { X509Certificate } from 'node:crypto';

const log = {
  info: (...a) => console.log('[INFO] ', ...a),
  warn: (...a) => console.log('[WARN] ', ...a),
};

console.log('-- generating / loading CA --');
const t0 = Date.now();
const ca = await loadOrCreateCA({ log });
console.log(`CA ready in ${Date.now() - t0}ms, fingerprint=${ca.fingerprintSha256.slice(0, 32)}…`);

const caX = new X509Certificate(ca.caCertPem);
console.log('CA subject :', caX.subject);
console.log('CA issuer  :', caX.issuer);
console.log('CA validTo :', caX.validTo);
console.log('CA ca?     :', caX.ca);

console.log('\n-- minting leaf cert for api.openai.com --');
const t1 = Date.now();
const leaf = mintLeafCert({ ca, hosts: ['api.openai.com', 'chatgpt.com'] });
console.log(`leaf minted in ${Date.now() - t1}ms`);

const leafX = new X509Certificate(leaf.certPem);
console.log('leaf subject :', leafX.subject);
console.log('leaf SANs    :', leafX.subjectAltName);
console.log('leaf issuer  :', leafX.issuer);
console.log('leaf validTo :', leafX.validTo);

// Verify the leaf was signed by the CA. X509Certificate.verify() returns true
// iff this cert's signature checks against the provided public key.
const ok = leafX.verify(caX.publicKey);
if (!ok) {
  console.error('FAIL: leaf cert does NOT verify against the CA public key');
  process.exit(1);
}
console.log('\nleaf -> CA verify : OK');

// And confirm the leaf is presentable as a TLS server cert by trying to
// load it into a SecureContext.
import('node:tls').then(({ createSecureContext }) => {
  try {
    createSecureContext({ cert: leaf.certPem, key: leaf.keyPem });
    console.log('SecureContext load : OK');
    console.log('\nALL CA CHECKS PASS');
  } catch (e) {
    console.error('FAIL: createSecureContext threw:', e.message);
    process.exit(1);
  }
});
