#!/usr/bin/env node
// Build a signed, self-hosted .crx for force-install — no Web Store, no review queue.
//
//   node scripts/pack-crx.mjs --url https://agentgovernence.cftools.live
//
// Outputs to dist/extension/:
//   cloudfuze-ai-governance.crx   the signed package
//   update.xml                    the manifest browsers poll
//   crx-signing-key.pem           FIRST RUN ONLY — move this somewhere safe
//
// and prints the extension ID plus the exact policy values to deploy.
//
// THE KEY IS THE PRODUCT. An extension's ID is derived from its signing key, and
// the force-install policy on every machine names that ID. Lose the key and you
// cannot ship an update — you can only ship a DIFFERENT extension with a new ID,
// then re-push policy to every machine. Keep crx-signing-key.pem in the same place
// you keep production secrets, and out of git.
//
// The public half is written into manifest.json as `key`, which is safe to commit
// and is what makes an unpacked developer load report the same ID as the packed
// build. Without it, testing and production disagree about which extension this
// is, and the mismatch presents as "the policy did not apply".

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createZip } from '../server/src/lib/zip.js';
import {
  generateKeyPem, extensionIdFromKey, manifestKeyFromPem, packCrx, updateManifestXml,
} from '../server/src/lib/crx.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const extDir = join(root, 'browser-extension');
const outDir = join(root, 'dist', 'extension');

// ── Arguments ───────────────────────────────────────────────────────────────
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const baseUrl = (args.get('url') || process.env.PUBLIC_SERVER_URL || '').replace(/\/$/, '');
const keyPath = args.get('key') || join(outDir, 'crx-signing-key.pem');

if (!baseUrl) {
  console.error('Missing --url. This is the address machines will fetch the package from,');
  console.error('and it is baked into update.xml, so a wrong value produces a package that');
  console.error('installs once and can never update.\n');
  console.error('  node scripts/pack-crx.mjs --url https://agentgovernence.cftools.live');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// ── Signing key ─────────────────────────────────────────────────────────────
let keyPem;
let generated = false;
if (existsSync(keyPath)) {
  keyPem = readFileSync(keyPath, 'utf8');
} else {
  keyPem = generateKeyPem();
  writeFileSync(keyPath, keyPem, { mode: 0o600 });
  generated = true;
}
const extensionId = extensionIdFromKey(keyPem);

// ── Pin the public key into the manifest so unpacked == packed ──────────────
const manifestPath = join(extDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const publicKeyB64 = manifestKeyFromPem(keyPem);
if (manifest.key !== publicKeyB64) {
  manifest.key = publicKeyB64;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('manifest.json: pinned the public key (commit this — it is not a secret)');
}

// ── Collect the extension, minus anything that should not ship ──────────────
// tests/ and node_modules are not just weight: shipping test fixtures to every
// employee's browser widens what the package can be blamed for.
const SKIP = new Set(['node_modules', 'tests', '.git', 'package-lock.json', 'package.json']);
const files = [];
(function walk(dir, prefix) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) walk(full, rel);
    else files.push({ name: rel, data: readFileSync(full) });
  }
}(extDir, ''));

// manifest.json must be the copy we just edited, not the one read off disk before it.
const mi = files.findIndex((f) => f.name === 'manifest.json');
files[mi] = { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8') };

const { crx } = packCrx(createZip(files, { compress: true }), keyPem);
const crxName = 'cloudfuze-ai-governance.crx';
// /api/v1 is what the deployed host's proxy forwards; /downloads 404s there.
const codebase = `${baseUrl}/api/v1/extension/${crxName}`;

writeFileSync(join(outDir, crxName), crx);
writeFileSync(join(outDir, 'update.xml'), updateManifestXml({
  id: extensionId, version: manifest.version, codebase,
}));
// The server generates update.xml per request (so the codebase URL matches the host
// the machine actually reached), but it cannot read the id out of a signed binary
// cheaply — so record it alongside the package.
writeFileSync(join(outDir, 'manifest-info.json'), JSON.stringify({
  id: extensionId, version: manifest.version,
}, null, 2) + '\n');

// ── Deployment-ready provisioning scripts ───────────────────────────────────
//
// The templates in scripts/ keep their placeholders on purpose: an extension ID is
// harmless, but the enroll secret must never be committed. So filled-in copies are
// generated into dist/provision/ (gitignored) and those are what gets uploaded to
// Intune. Pass --secret, or set ENROLL_SECRET, to fill it in; without it the copy
// still carries the placeholder and the pre-flight will refuse the rollout.
const provisionDir = join(root, 'dist', 'provision');
mkdirSync(provisionDir, { recursive: true });
const enrollSecret = args.get('secret') || process.env.ENROLL_SECRET || '';
// Chrome ignores an off-store force-install unless the machine is AD-domain-joined
// or CBCM-enrolled; Entra join does not count. Passing the token here injects it
// into both provisioning artifacts so nobody edits a generated script by hand and
// forgets on the next repack.
const cbcmToken = args.get('cbcm-token') || process.env.CBCM_TOKEN || '';

for (const name of ['intune-provision-extension.ps1', 'macos-provision-extension.sh']) {
  let src = readFileSync(join(root, 'scripts', name), 'utf8');
  src = src.replace(/REPLACE_WITH_ID_FROM_pack-crx/g, extensionId);
  if (enrollSecret) src = src.replace(/REPLACE_WITH_ENROLL_SECRET/g, enrollSecret);
  if (cbcmToken) {
    src = src.replace("$ChromeCbcmToken = ''", `$ChromeCbcmToken = '${cbcmToken}'`)
             .replace('CBCM_TOKEN=""', `CBCM_TOKEN="${cbcmToken}"`);
  }
  writeFileSync(join(provisionDir, name), src);
}

// ── What to do with it ──────────────────────────────────────────────────────
const updateUrl = `${baseUrl}/api/v1/extension/update.xml`;
console.log(`
Packed ${files.length} files — ${(crx.length / 1024).toFixed(0)} KB

  Extension ID : ${extensionId}
  Version      : ${manifest.version}
  Output       : dist/extension/

Served by the governance server at ${baseUrl}/api/v1/extension/ :
  ${crxName}
  update.xml

Upload these to Intune (already filled in, ${enrollSecret ? 'including the enroll secret' : 'BUT the enroll secret is still a placeholder — re-run with --secret'}):
  dist/provision/intune-provision-extension.ps1   (Windows, device/SYSTEM context)
  dist/provision/macos-provision-extension.sh     (macOS, root)

Self-hosted force-install works on MANAGED machines only. Edge allows it on any
Intune-managed device. Chrome requires the machine to be domain-joined or enrolled
in Chrome Browser Cloud Management — on an unmanaged Chrome the policy is ignored
and nothing installs, with no error shown.

Re-run this after every version bump, or browsers will stay on the old build.
`);

if (generated) {
  console.log(`A NEW SIGNING KEY WAS CREATED: ${keyPath}
Move it somewhere safe and keep it out of git. It determines the extension ID —
lose it and you cannot update this extension on any machine, only replace it and
re-push policy everywhere.
`);
}
