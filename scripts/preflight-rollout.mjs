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
// The Windows fleet ships the desktop agent alongside the extension, so that is
// the default posture this checks. `--browser-only` asserts the opposite (the
// pre-2026-08-31 rollout) and flips section 5's expectations rather than skipping
// them — an unchecked posture is how the two halves drift apart unnoticed.
const browserOnlyRollout = args.has('browser-only');

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

  // A PLACEHOLDER IS NOT THE ONLY WAY THIS SHIPS WRONG. The placeholder check
  // above passes the moment pack-crx substitutes ANY value — including the dev
  // default, which is what happens when someone packs on a machine whose .env was
  // never changed from the checked-in example. That was the actual state of
  // dist/provision before this check existed.
  //
  // Shipping it fleet-wide publishes the enrolment credential: the secret is the
  // only thing standing between the internet and POST /api/v1/enroll, so anyone
  // who knows it can register machines and post fabricated DLP events into the
  // governance record. On a compliance product that is the whole product.
  //
  // Matched loosely on purpose — any secret advertising itself as a dev value is
  // one nobody chose deliberately for a fleet.
  const weak = src.match(/(?:EnrollSecret|ENROLL_SECRET)\s*=\s*["']([^"']+)["']/);
  if (weak && /^(dev-|test-|changeme|change-me|placeholder|secret)|change-me$/i.test(weak[1])) {
    block('all machines', `${label} enroll secret is not a dev default`,
      `${file} ships "${weak[1]}" — rotate ENROLL_SECRET on the server, then repack with --secret`);
  } else if (weak) {
    pass('all machines', `${label} enroll secret is not a dev default`, 'a deliberate secret is baked in');
  }
}

// ── 3b. Is the CBCM token in the artifacts? ─────────────────────────────────
// Chrome ignores an off-store force-install unless the machine is AD-domain-joined
// or CBCM-enrolled. A WARN rather than a BLOCK: an Edge-only estate genuinely does
// not need this, and an AD-joined one already satisfies Chrome. But shipping
// without it on an Entra-only estate with Chrome installed means Chrome is
// ungoverned and nothing says so, so it must not pass quietly.
{
  const winSrc = read(PS1);
  const hasToken = /\$ChromeCbcmToken\s*=\s*'[^']+'/.test(winSrc);
  if (hasToken) {
    pass('all browsers', 'Chrome CBCM token present', 'Chrome will accept the off-store install');
  } else {
    warn('all browsers', 'Chrome CBCM token missing',
      'Chrome installs nothing unless the machine is AD-domain-joined. Get a token '
      + 'from admin.google.com -> Devices -> Chrome -> Managed browsers, then repack '
      + 'with --cbcm-token. Skip only if the estate is Edge-only or AD-joined.');
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

// ── 5. Desktop agent, and ONE identity across both surfaces ─────────────────
//
// WHY THIS SECTION IS THE FIDDLY ONE. The agent and the extension enrol
// separately, and server/src/routes/ai-usage.js groups usage by machines.user with
// an EXACT string match. So the two only merge into one person if they report
// byte-identical identities — and every way that can fail is silent: the dashboard
// shows two plausible rows with two plausible names and nothing marking them as
// the same human. These checks pin the alignment down.

const REQ5 = browserOnlyRollout ? 'no desktop agent' : 'agent + extension, one identity';

if (browserOnlyRollout) {
  if (!/\$BrowserOnly\s*=\s*\$true/.test(ps1)) {
    block(REQ5, 'Windows declares browser-only', 'a browser-only rollout must set $BrowserOnly = $true');
  } else {
    pass(REQ5, 'Windows declares browser-only', 'skips the 5-minute agent wait');
  }
} else {
  // browserOnly tells the extension not to wait for a beacon. With the agent
  // deployed the beacon does arrive, and suppressing the wait throws away the
  // hostname link that ties this browser's enrolment to the agent's machine record.
  if (!/\$BrowserOnly\s*=\s*\$false/.test(ps1)) {
    block(REQ5, 'Windows waits for the agent beacon', '$BrowserOnly must be $false where the agent is deployed');
  } else {
    pass(REQ5, 'Windows waits for the agent beacon', '$BrowserOnly = $false');
  }

  // Not an oversight to be caught: the tracker needs Windows UI Automation and
  // exits on darwin, so a Mac has no beacon and must not wait for one.
  if (!/BROWSER_ONLY=1/.test(sh)) {
    block(REQ5, 'macOS stays browser-only', 'no agent runs on darwin — BROWSER_ONLY must stay 1');
  } else {
    pass(REQ5, 'macOS stays browser-only', 'no agent exists on darwin');
  }

  // The agent must resolve the same corporate UPN the extension gets from policy,
  // not the OS username.
  const ident = 'agent/src/util/corporate-identity.js';
  if (!existsSync(join(root, ident))) {
    block(REQ5, 'agent resolves a corporate UPN', `${ident} is missing`);
  } else {
    pass(REQ5, 'agent resolves a corporate UPN', 'util/corporate-identity.js');
  }

  const tracker = read('agent/src/claude_tracker/index.js');
  if (!tracker.includes('resolveCorporateIdentity')) {
    block(REQ5, 'agent enrols as the UPN', 'claude_tracker enrols without resolveCorporateIdentity');
  } else if (/user:\s*os\.userInfo\(\)\.username/.test(tracker)) {
    block(REQ5, 'agent enrols as the UPN', 'claude_tracker still enrols with the OS username');
  } else {
    pass(REQ5, 'agent enrols as the UPN', 'resolveCorporateIdentity()');
  }

  // The beacon must serve what the caller enrolled with. If it derived its own
  // identity the extension could be told a different name than the server was.
  const beacon = read('agent/src/identity-beacon.js');
  if (!/startIdentityBeacon\(\{[^}]*\buser\b/.test(beacon)) {
    block(REQ5, 'beacon serves the enrolled identity', 'startIdentityBeacon does not accept a user');
  } else {
    pass(REQ5, 'beacon serves the enrolled identity', 'caller-supplied, cannot disagree with enrolment');
  }

  // Case folding. Verified on real hardware: `whoami /upn` returns
  // "satya.pinniti@cloudfuze.com" and the Intune enrolment key
  // "Satya.Pinniti@cloudfuze.com". Exact-match grouping splits those into two rows.
  if (!/toLowerCase\(\)/.test(read('server/src/routes/enroll.js'))) {
    block(REQ5, 'server folds identity case', 'enroll.js does not normalise user case');
  } else {
    pass(REQ5, 'server folds identity case', 'email-shaped identities lowercased on enrol');
  }

  // A fleet build with no domain baked in accepts a UPN from any tenant.
  if (!read('agent/scripts/build-claude-tracker.mjs').includes('CFAI_IDENTITY_DOMAIN')) {
    block(REQ5, 'tracker build bakes the UPN guard', 'CFAI_IDENTITY_DOMAIN is not a build input');
  } else {
    pass(REQ5, 'tracker build bakes the UPN guard', 'CFAI_IDENTITY_DOMAIN');
  }

  // A pilot machine's per-user autostart outlives the fleet install and wins the
  // single-instance lock, keeping the old build (and the old identity) forever.
  const svc = read('agent/src/claude_tracker/service.js');
  if (!svc.includes('sweepPerUserAutostart')) {
    block(REQ5, 'fleet install supersedes a pilot', 'no sweep of per-user autostarts');
  } else if (!/S-1-12-1/.test(svc)) {
    block(REQ5, 'fleet install supersedes a pilot',
      'the sweep does not match Entra SIDs (S-1-12-1) — it would find nobody on this estate');
  } else {
    pass(REQ5, 'fleet install supersedes a pilot', 'sweeps HKEY_USERS incl. Entra SIDs');
  }
}

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

// ── 9. Chrome manageability, which is the likeliest silent failure ──────────
// Chrome ignores an off-store force-install unless the machine is AD-domain-joined
// or CBCM-enrolled. Entra join and Intune MDM do not count. It cannot be checked
// from here for the whole estate — only reported per machine — so this reports what
// the fleet has already said.
try {
  const res = await fetch(`${baseUrl}/api/v1/browser-coverage`);
  if (res.ok) {
    const cov = await res.json();
    if (cov.machines_reporting === 0) {
      warn('all machines', 'Chrome manageability', 'no machine has reported yet — run the provisioning script on the pilot first');
    } else if (cov.ungoverned_chrome > 0) {
      block('all machines', 'Chrome manageability',
        `${cov.ungoverned_chrome} of ${cov.machines_reporting} reporting machines have Chrome `
        + 'installed but ungovernable — set $ChromeCbcmToken and re-run provisioning');
    } else {
      pass('all machines', 'Chrome manageability',
        `${cov.machines_reporting} machines reporting, no ungoverned Chrome`);
    }
    if (cov.ungoverned_firefox > 0) {
      warn('all machines', 'Firefox present',
        `${cov.ungoverned_firefox} machines have Firefox, which cannot be governed at all`);
    }
  }
} catch { /* server unreachable is already reported above */ }

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
