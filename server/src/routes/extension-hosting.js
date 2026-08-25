// Serve the force-installable extension package: /downloads/update.xml + the .crx
//
// WHY THE SERVER HOSTS THIS. Force-installing normally means publishing to the
// Chrome Web Store / Edge Add-ons and waiting on review. An enterprise can skip
// that: both browsers will force-install a self-hosted, self-signed package on a
// MANAGED device, given a policy naming the extension ID and an update manifest to
// poll. The governance server is already HTTPS and already reachable from every
// managed machine, so it is the natural place to put the two files.
//
// UNAUTHENTICATED, DELIBERATELY. The browser fetches these before any extension
// exists to hold a token, and Chrome's updater sends no credentials. What is
// exposed is the extension package itself — the same code we are installing on
// every machine — and not the enroll secret, which lives in Intune policy and
// never in the package. The path is unguessable-free on purpose: obscurity here
// would only break the updater.
//
// FAIL LOUD WHEN NOT BUILT. If the package is missing these return 503 with the
// command that produces it, rather than 404. A 404 here reads as "wrong URL" and
// sends an admin hunting through policy, when the real answer is that nobody ran
// the packer.

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { a } from '../util.js';
import { ENROLL_SECRET, ADMIN_TOKEN } from '../auth.js';
import { createZip } from '../lib/zip.js';
import {
  extensionIdFromDer, manifestKeyFromPem, packCrx, updateManifestXml,
} from '../lib/crx.js';
import { getOrCreateSigningKey } from '../lib/crx-key.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Where scripts/pack-crx.mjs writes. Overridable so a deployment can mount the
// package as a volume rather than baking it into the image.
const DIST_DIR = process.env.EXTENSION_DIST_DIR
  || join(__dirname, '..', '..', '..', 'dist', 'extension');
const CRX_NAME = 'cloudfuze-ai-governance.crx';

const PUBLIC_SERVER_URL = (process.env.PUBLIC_SERVER_URL || '').trim().replace(/\/+$/, '');

function baseUrl(req) {
  if (PUBLIC_SERVER_URL) return PUBLIC_SERVER_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}


// ── Build on demand, because dist/ is not deployable ────────────────────────
//
// THE PROBLEM THIS SOLVES. scripts/pack-crx.mjs writes into dist/, which is
// gitignored — correctly, since it holds a 23 MB binary and, on a first run, the
// signing key. But that means the deployed server never receives the package, and
// /api/v1/extension/* would answer 503 forever while every policy on every machine
// pointed at it. Copying a binary onto the host by hand before each rollout is
// exactly the manual step this whole flow exists to remove.
//
// So the server packs it itself from the browser-extension/ source it already
// ships, signing with CRX_SIGNING_KEY. The key stays a deployment secret; the
// package becomes a build artefact that can never be stale relative to the code.
//
// A pre-built dist/ still WINS when present, so a locally packed package (or a
// mounted volume) behaves as before and nothing about the packer changes.
const SKIP = new Set(['node_modules', 'tests', '.git', 'package-lock.json', 'package.json']);
const EXT_SRC = join(__dirname, '..', '..', '..', 'browser-extension');

let _built = null;   // { crx, id, version }

async function buildPackage(db) {
  if (_built) return _built;
  const key = await getOrCreateSigningKey(db);
  if (!key) return null;
  const SIGNING_KEY = key.pem;

  const manifestPath = join(EXT_SRC, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // The manifest's pinned key must match the signing key, or the id an unpacked
  // load reports differs from the one this package signs to — and the policy can
  // only name one of them.
  manifest.key = manifestKeyFromPem(SIGNING_KEY);

  const files = [];
  (function walk(dir, prefix) {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, rel);
      else files.push({ name: rel, data: readFileSync(full) });
    }
  }(EXT_SRC, ''));

  const mi = files.findIndex((f) => f.name === 'manifest.json');
  files[mi] = { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + String.fromCharCode(10), 'utf8') };

  const { crx, id } = packCrx(createZip(files, { compress: true }), SIGNING_KEY);
  _built = { crx, id, version: manifest.version };
  console.log(`[extension] packed ${id} v${manifest.version} (${(crx.length / 1048576).toFixed(1)} MB) from source, key from ${key.source}`);
  return _built;
}

// The package endpoints are public by necessity; the provisioning script is not,
// because it carries the enroll secret. Checked inline rather than via middleware
// so the public and admin routes can share one mount.
function requireAdmin(req, res) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.adminToken || '');
  if (token && token === ADMIN_TOKEN) return true;
  res.status(401).json({
    error: 'admin token required',
    detail: 'This script contains the enroll secret. Pass it as '
      + 'Authorization: Bearer <ADMIN_TOKEN> or ?adminToken=',
  });
  return false;
}

const NOT_BUILT = {
  error: 'extension package not available',
  fix: 'set CRX_SIGNING_KEY on the server, or deploy dist/extension/',
  detail: 'With CRX_SIGNING_KEY the server packs the extension itself. Otherwise '
    + 'run scripts/pack-crx.mjs and deploy dist/extension/ (or point '
    + 'EXTENSION_DIST_DIR at it).',
};

export function mountExtensionHosting(app, db = null) {
  const crxPath = join(DIST_DIR, CRX_NAME);

  // MOUNTED UNDER /api/v1 BECAUSE THAT IS WHAT THE PROXY FORWARDS. The deployed
  // host serves the dashboard from / and proxies only /api to this server, so a
  // /downloads path answered 404 from the frontend — verified against the live
  // host, not assumed. /downloads is kept as an alias for a server reached
  // directly (no proxy), which is how a pilot machine on the LAN might fetch it.
  const routes = (path, handler) => {
    app.get(`/api/v1/extension${path}`, handler);
    app.get(`/downloads${path}`, handler);
  };


  // dist/ wins when present (a locally packed package or a mounted volume);
  // otherwise pack from source. Either way the callers below see one shape.
  const resolve = async () => {
    if (existsSync(crxPath)) {
      const infoPath = join(DIST_DIR, 'manifest-info.json');
      let info = null;
      try { info = JSON.parse(readFileSync(infoPath, 'utf8')); } catch { /* handled */ }
      return { crx: readFileSync(crxPath), id: info?.id ?? null, version: info?.version ?? null, from: 'dist' };
    }
    const built = await buildPackage(db);
    return built ? { ...built, from: 'source' } : null;
  };

  // The update manifest is generated per request rather than served from disk, so
  // the codebase URL always matches the host the machine actually reached us on.
  // A manifest baked at pack time carries whatever URL the packer was told, and if
  // that is wrong every machine installs once and then never updates.
  routes('/update.xml', a(async (req, res) => {
    const info = await resolve();
    if (!info) return res.status(503).json(NOT_BUILT);
    if (!info.id || !info.version) {
      return res.status(503).json({
        ...NOT_BUILT,
        error: 'extension package present but its id/version are unknown',
        detail: 'dist/extension/manifest-info.json is missing or unreadable. '
          + 'Re-run the packer, or unset EXTENSION_DIST_DIR so the server packs '
          + 'from source instead.',
      });
    }

    res.type('application/xml').send(updateManifestXml({
      id: info.id,
      version: info.version,
      codebase: `${baseUrl(req)}/api/v1/extension/${CRX_NAME}`,
    }));
  }));

  routes(`/${CRX_NAME}`, a(async (_req, res) => {
    const pkg = await resolve();
    if (!pkg) return res.status(503).json(NOT_BUILT);
    // The CRX content type is what tells the browser this is an extension package
    // rather than something to download; serving it as octet-stream makes Chrome
    // ignore it during a policy install.
    res.type('application/x-chrome-extension');
    res.setHeader('Content-Length', pkg.crx.length);
    res.send(pkg.crx);
  }));

  // ── The provisioning script, generated per deployment ─────────────────────
  //
  // WHAT THIS REPLACES. Rolling out at CloudFuze meant editing a script in the
  // repo: paste the extension ID, the enroll secret, the server URL, the identity
  // domain. That is fine once for ourselves and unacceptable as a product — every
  // customer would be hand-editing PowerShell, and every value they got wrong
  // would fail silently in the way this whole flow keeps demonstrating.
  //
  // So the server emits the script already filled in from what it knows about
  // itself: its own URL, its own enroll secret, the ID of the package it is
  // serving. The admin supplies only what the server cannot know — their Chrome
  // CBCM token and their corporate email domain — as query parameters.
  //
  // ADMIN-AUTHENTICATED, unlike the package endpoints. The .crx is public because
  // a browser updater cannot present credentials, but this script contains the
  // enroll secret, which is the credential for joining the fleet.
  routes('/provisioning-script', a(async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const platform = String(req.query.platform || 'windows').toLowerCase();
    if (!['windows', 'macos'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be windows or macos' });
    }
    const pkg = await resolve();
    if (!pkg?.id) return res.status(503).json(NOT_BUILT);

    const file = platform === 'windows'
      ? 'intune-provision-extension.ps1'
      : 'macos-provision-extension.sh';
    const templatePath = join(__dirname, '..', '..', '..', 'scripts', file);
    if (!existsSync(templatePath)) {
      return res.status(500).json({ error: `provisioning template missing: ${file}` });
    }
    let src = readFileSync(templatePath, 'utf8');

    // Everything the server knows about itself. A value left as a placeholder is
    // a value the admin has to discover, so none are.
    const cbcm = String(req.query.cbcmToken || '').trim();
    const domain = String(req.query.identityDomain || '').trim();
    const base = baseUrl(req);

    src = src.replace(/REPLACE_WITH_ID_FROM_pack-crx/g, pkg.id)
      .replace(/REPLACE_WITH_ENROLL_SECRET/g, ENROLL_SECRET);

    if (platform === 'windows') {
      src = src.replace(/\$ServerUrl {4}= '[^']*'/, `$ServerUrl    = '${base}'`);
      if (domain) src = src.replace(/\$IdentityDomain = '[^']*'/, `$IdentityDomain = '${domain}'`);
      if (cbcm) src = src.replace("$ChromeCbcmToken = ''", `$ChromeCbcmToken = '${cbcm}'`);
    } else {
      src = src.replace(/SERVER_URL="[^"]*"/, `SERVER_URL="${base}"`);
      if (domain) src = src.replace(/IDENTITY_DOMAIN="[^"]*"/, `IDENTITY_DOMAIN="${domain}"`);
      if (cbcm) src = src.replace('CBCM_TOKEN=""', `CBCM_TOKEN="${cbcm}"`);
    }

    res.type('text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.send(src);
  }));

  // Small helper for the rollout itself: confirms what is being served and the ID
  // the policy must name. Saves an admin from decoding a binary to check.
  routes('/extension-info', a(async (req, res) => {
    const info = await resolve();
    if (!info) return res.status(503).json(NOT_BUILT);
    res.json({
      extension_id: info.id,
      version: info.version,
      size_bytes: info.crx.length,
      packaged_from: info.from,
      crx_url: `${baseUrl(req)}/api/v1/extension/${CRX_NAME}`,
      update_url: `${baseUrl(req)}/api/v1/extension/update.xml`,
      policy_hint: {
        ExtensionInstallForcelist: `${info?.id ?? '<id>'};${baseUrl(req)}/api/v1/extension/update.xml`,
        ExtensionInstallSources: `${baseUrl(req)}/*`,
      },
    });
  }));
}

// Exported for the packer and tests: the id a DER public key signs to.
export { extensionIdFromDer };
