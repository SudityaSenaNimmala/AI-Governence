#!/usr/bin/env node
// Pre-flight for an organisation-wide force-install.
//
//   node scripts/preflight-rollout.mjs [--url https://agentgovernence.cftools.live]
//
// Checks the things that are actually checkable, and says plainly which of the
// stated requirements each one covers. Exits non-zero if anything is BLOCKED.
//
// WHY AN EXECUTABLE CHECK AND NOT A CHECKLIST. Every failure mode in this rollout
// is silent: a placeholder left in a script, an ID that does not match the signed
// package, a package the server is not serving, a signing key accidentally
// committed. None of those produce an error at install time — the extension simply
// does not appear, and the admin console shows nothing. A checklist gets skimmed;
// this does not.
//
// WHAT IT CANNOT CHECK, stated so the PASS is not mistaken for more than it is:
// whether a real machine installs it, whether the macOS identity lookups find
// anything on real hardware, and whether your Chrome estate is managed enough for
// Chrome to honour an off-store policy. Those need a pilot machine.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { parseCrx, extensionIdFromDer } from '../server/src/lib/crx.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const baseUrl = (args.get('url') || 'https://agentgovernence.cftools.live').replace(/\/$/, '');

const results = [];
const record = (state, requirement, check, detail) => results.push({ state, requirement, check, detail });
const pass = (r, c, d) => record('PASS', r, c, d);
const block = (r, c, d) => record('BLOCK', r, c, d);
const warn = (r, c, d) => record('WARN', r, c, d);

const read = (p) => readFileSync(join(root, p), 'utf8');
const CRX_PATH = 'dist/extension/cloudfuze-ai-governance.crx';

// JUDGE THE DEPLOYMENT ARTIFACTS, NOT THE REPO TEMPLATES. The templates in
// scripts/ keep their placeholders deliberately — the enroll secret must never be
// committed — so checking them would always block. pack-crx.mjs writes filled-in
// copies to dist/provision/ (gitignored), and those are what actually gets
// uploaded to Intune. Fall back to the templates only to report that the packer
// has not run.
const PROVISIONED = existsSync(join(root, 'dist/provision/intune-provision-extension.ps1'));
const PS1 = PROVISIONED ? 'dist/provision/intune-provision-extension.ps1' : 'scripts/intune-provision-extension.ps1';
const SH  = PROVISIONED ? 'dist/provision/macos-provision-extension.sh' : 'scripts/macos-provision-extension.sh';

// ── 1. No store publishing: a valid, self-signed package exists ─────────────

let packedId = null;
let packedVersion = null;
if (!existsSync(join(root, CRX_PATH))) {
  block('no store publishing', 'signed package exists',
    `${CRX_PATH} not found — run: node scripts/pack-crx.mjs --url ${baseUrl}`);
} else {
  const crx = readFileSync(join(root, CRX_PATH));
  try {
    const { header, zip } = parseCrx(crx);

    // Verify the signature the way a browser does, rather than trusting that we
    // wrote it. A package that does not verify installs nowhere, silently.
    const fields = [];
    let p = 0;
    const varint = () => { let r = 0, s = 0; for (;;) { const b = header[p++]; r |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; } return r >>> 0; };
    while (p < header.length) {
      const key = varint(); const len = varint();
      fields.push({ field: key >>> 3, value: header.subarray(p, p + len) }); p += len;
    }
    const proofBuf = fields.find((f) => f.field === 2).value;
    const shd = fields.find((f) => f.field === 10000).value;
    const sub = [];
    p = 0;
    while (p < proofBuf.length) {
      const key = (() => { let r = 0, s = 0; for (;;) { const b = proofBuf[p++]; r |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; } return r >>> 0; })();
      const len = (() => { let r = 0, s = 0; for (;;) { const b = proofBuf[p++]; r |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; } return r >>> 0; })();
      sub.push({ field: key >>> 3, value: proofBuf.subarray(p, p + len) }); p += len;
    }
    const pub = sub.find((f) => f.field === 1).value;
    const sig = sub.find((f) => f.field === 2).value;
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(shd.length, 0);
    const ok = crypto.createVerify('sha256')
      .update(Buffer.from('CRX3 SignedData\x00', 'binary')).update(prefix).update(shd).update(zip)
      .verify(crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' }), sig);

    packedId = extensionIdFromDer(pub);
    if (ok) {
      pass('no store publishing', 'package signature verifies',
        `${packedId} — ${(crx.length / 1024 / 1024).toFixed(1)} MB`);
    } else {
      block('no store publishing', 'package signature verifies',
        'the signature does not verify — no browser will install this');
    }
  } catch (err) {
    block('no store publishing', 'package is a valid CRX3', err.message);
  }

  const info = join(root, 'dist/extension/manifest-info.json');
  if (existsSync(info)) packedVersion = JSON.parse(readFileSync(info, 'utf8')).version;
}

// ── 2. The ID is consistent everywhere ──────────────────────────────────────
// A mismatch anywhere means the policy names an extension that does not exist,
// and nothing installs with no error shown.

const manifest = JSON.parse(read('browser-extension/manifest.json'));
if (!manifest.key) {
  block('all profiles', 'manifest key pinned',
    'manifest.json has no "key" — an unpacked load would get a different ID than the packed build');
} else {
  const manifestId = extensionIdFromDer(Buffer.from(manifest.key, 'base64'));
  if (packedId && manifestId !== packedId) {
    block('no store publishing', 'manifest key matches the package',
      `manifest derives ${manifestId} but the package is ${packedId} — repack`);
  } else {
    pass('no store publishing', 'manifest key matches the package', manifestId);
  }
}

if (packedVersion && packedVersion !== manifest.version) {
  block('no store publishing', 'package version is current',
    `package is ${packedVersion} but manifest.json says ${manifest.version} — repack, or browsers stay on the old build`);
} else if (packedVersion) {
  pass('no store publishing', 'package version is current', packedVersion);
}

// ── 3. Provisioning scripts are actually filled in ──────────────────────────

for (const [file, label] of [[PS1, 'Windows'], [SH, 'macOS']]) {
  const src = read(file);
  const placeholders = [...src.matchAll(/REPLACE_[A-Z_]+/g)].map((m) => m[0]);
  if (placeholders.length) {
    const secretOnly = [...new Set(placeholders)].every((x) => x.includes('ENROLL_SECRET'));
    const how = PROVISIONED
      ? `re-run: node scripts/pack-crx.mjs --url ${baseUrl} --secret <enroll secret>`
      : `run: node scripts/pack-crx.mjs --url ${baseUrl} --secret <enroll secret>`;
    block('all machines', `${label} script configured`,
      `${file} still contains ${[...new Set(placeholders)].join(', ')}${secretOnly ? ' — ' : ' — '}${how}`);
  } else {
    pass('all machines', `${label} script configured`, file);
  }
  if (packedId && !src.includes(packedId)) {
    block('all machines', `${label} script names the packed ID`,
      `${file} does not contain ${packedId}`);
  }
}

// ── 4. All browsers, both platforms ─────────────────────────────────────────

const WIN_ROOTS = ['Microsoft\\\\Edge', 'Google\\\\Chrome', 'BraveSoftware\\\\Brave', 'Vivaldi', 'Opera Software\\\\Opera', 'Chromium'];
const MAC_IDS = ['com.google.Chrome', 'com.microsoft.Edge', 'com.brave.Browser', 'com.vivaldi.Vivaldi', 'com.operasoftware.Opera', 'org.chromium.Chromium'];
const ps1 = read(PS1);
const sh = read(SH);
const missingWin = WIN_ROOTS.filter((r) => !ps1.includes(r.replace(/\\\\/g, '\\')));
const missingMac = MAC_IDS.filter((b) => !sh.includes(b));
if (missingWin.length) block('all browsers', 'Windows covers every Chromium browser', `missing: ${missingWin.join(', ')}`);
else pass('all browsers', 'Windows covers every Chromium browser', `${WIN_ROOTS.length} browsers`);
if (missingMac.length) block('all browsers', 'macOS covers every Chromium browser', `missing: ${missingMac.join(', ')}`);
else pass('all browsers', 'macOS covers every Chromium browser', `${MAC_IDS.length} browsers`);

// Off-store installs need these or the force-install is silently ignored.
for (const [src, label] of [[ps1, 'Windows'], [sh, 'macOS']]) {
  const missing = ['ExtensionInstallForcelist', 'ExtensionInstallAllowlist', 'ExtensionInstallSources']
    .filter((k) => !src.includes(k));
  if (missing.length) block('all machines', `${label} off-store allowances`, `missing: ${missing.join(', ')}`);
  else pass('all machines', `${label} off-store allowances`, 'forcelist + allowlist + sources');
}

// ── 5. No desktop agent ─────────────────────────────────────────────────────

if (!ps1.includes('browserOnly')) block('no desktop agent', 'browserOnly is provisioned', `${PS1} does not set browserOnly`);
else pass('no desktop agent', 'browserOnly is provisioned', 'skips the 5-minute agent wait');

// ── 6. Accurate username ────────────────────────────────────────────────────

const worker = read('browser-extension/background/service-worker.js');
const order = ['managed_policy', 'agent_beacon', 'browser_profile'].map((s) => worker.indexOf(`source: '${s}'`));
if (order.some((i) => i < 0) || order[0] > order[2]) {
  block('accurate username', 'identity precedence', 'managed policy must be checked before the browser profile');
} else {
  pass('accurate username', 'identity precedence', 'managed_policy → agent_beacon → browser_profile');
}

if (!worker.includes('profile_domain_mismatch')) {
  block('accurate username', 'domain guard present',
    'a personal/test browser profile could be attributed as the user');
} else {
  pass('accurate username', 'domain guard present', 'non-corporate profiles are refused, not attributed');
}
for (const [src, label] of [[ps1, 'Windows'], [sh, 'macOS']]) {
  if (!/identityDomain/.test(src)) block('accurate username', `${label} sets identityDomain`, 'the domain guard is inert without it');
  else pass('accurate username', `${label} sets identityDomain`, 'set');
}
if (!ps1.includes('Get-EnrolledUpn')) block('accurate username', 'Windows reads the Intune UPN', 'not present');
else pass('accurate username', 'Windows reads the Intune UPN', 'HKLM\\SOFTWARE\\Microsoft\\Enrollments');

// ── 7. The signing key must not be in git ───────────────────────────────────

try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  const leaked = tracked.split(/\r?\n/).filter((f) => /\.pem$|crx-signing-key/.test(f));
  if (leaked.length) block('no store publishing', 'signing key not committed', `tracked: ${leaked.join(', ')}`);
  else pass('no store publishing', 'signing key not committed', 'no .pem tracked');
} catch {
  warn('no store publishing', 'signing key not committed', 'could not run git — check manually');
}
if (!existsSync(join(root, 'dist/extension/crx-signing-key.pem'))) {
  warn('no store publishing', 'signing key present locally',
    'not in dist/ — fine if you moved it somewhere safe, fatal if it is lost (you could never update the extension)');
} else {
  warn('no store publishing', 'signing key still in dist/',
    'move it to your secret store — the extension ID depends on it forever');
}

// ── 7b. Is the signing key actually reaching the container? ─────────────────
// Compose forwards ONLY the variables it lists. Putting CRX_SIGNING_KEY in the
// host's .env without the passthrough line leaves the container blind to it, and
// /api/v1/extension/* answers 503 forever while every machine's policy points at
// it. That is exactly how ENROLL_SECRET went wrong before, so it is checked here
// rather than rediscovered.
try {
  const compose = read('docker-compose.yml');
  if (/CRX_SIGNING_KEY:\s*\$\{CRX_SIGNING_KEY/.test(compose)) {
    pass('all machines', 'compose forwards CRX_SIGNING_KEY', 'the container can see the host .env value');
  } else {
    block('all machines', 'compose forwards CRX_SIGNING_KEY',
      'docker-compose.yml does not pass it through — the container will never see it');
  }
} catch {
  warn('all machines', 'compose forwards CRX_SIGNING_KEY', 'docker-compose.yml not readable here');
}

// ── 8. Is the server actually serving the package? ──────────────────────────

async function probe() {
  const out = [];
    // /api/v1 is the proxied prefix on the deployed host; /downloads answers from
  // the frontend and 404s. Verified against the live host.
  for (const [path, expect] of [['/api/v1/extension/update.xml', /xml/], [`/api/v1/extension/${CRX_PATH.split('/').pop()}`, /chrome-extension/]]) {
    try {
      const res = await fetch(baseUrl + path, { redirect: 'follow' });
      out.push({ path, status: res.status, type: res.headers.get('content-type') || '', expect });
    } catch (err) {
      out.push({ path, status: 0, type: '', expect, err: err.message });
    }
  }
  return out;
}

for (const r of await probe()) {
  if (r.status === 200 && r.expect.test(r.type)) {
    pass('all machines', `server serves ${r.path}`, r.type);
  } else if (r.status === 503) {
    block('all machines', `server serves ${r.path}`,
      '503 — the route is live but has no package: set CRX_SIGNING_KEY in the '
      + "HOST's .env (base64, one line) and redeploy so the server can build it");
  } else {
    block('all machines', `server serves ${r.path}`,
      r.err ? `unreachable: ${r.err}` : `HTTP ${r.status}, content-type ${r.type || '(none)'}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

const ICON = { PASS: 'PASS ', BLOCK: 'BLOCK', WARN: 'WARN ' };
const byReq = new Map();
for (const r of results) {
  if (!byReq.has(r.requirement)) byReq.set(r.requirement, []);
  byReq.get(r.requirement).push(r);
}

console.log('\nPRE-FLIGHT — organisation-wide force-install\n');
for (const [req, rows] of byReq) {
  const worst = rows.some((r) => r.state === 'BLOCK') ? 'BLOCK' : rows.some((r) => r.state === 'WARN') ? 'WARN ' : 'PASS ';
  console.log(`[${worst}] ${req}`);
  for (const r of rows) console.log(`    ${ICON[r.state]}  ${r.check} — ${r.detail}`);
  console.log('');
}

const blocked = results.filter((r) => r.state === 'BLOCK');
console.log(`${results.filter((r) => r.state === 'PASS').length} passed, `
  + `${results.filter((r) => r.state === 'WARN').length} warnings, ${blocked.length} blocked\n`);

console.log('NOT CHECKABLE FROM HERE — these need one pilot machine:');
console.log('  - that a real machine installs it (edge://extensions shows "Installed by your organization")');
console.log('  - that the macOS identity lookups find anything on real hardware (the script prints its source)');
console.log('  - that your Chrome estate is managed enough for Chrome to honour an off-store policy');
console.log('  - that private windows are ungoverned (they are, unless you disabled them)\n');

if (blocked.length) {
  console.log('DO NOT ROLL OUT YET. Blocked:');
  for (const b of blocked) console.log(`  - ${b.check}: ${b.detail}`);
  process.exit(1);
}
console.log('No blockers. Pilot on one Windows machine and one Mac, then roll out.');
