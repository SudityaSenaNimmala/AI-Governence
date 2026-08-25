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

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { a } from '../util.js';
import { extensionIdFromDer, updateManifestXml } from '../lib/crx.js';

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

const NOT_BUILT = {
  error: 'extension package not built',
  fix: 'node scripts/pack-crx.mjs --url <public server url>',
  detail: 'Run the packer, then deploy dist/extension/ alongside the server '
    + '(or point EXTENSION_DIST_DIR at it).',
};

export function mountExtensionHosting(app) {
  const crxPath = join(DIST_DIR, CRX_NAME);

  // The update manifest is generated per request rather than served from disk, so
  // the codebase URL always matches the host the machine actually reached us on.
  // A manifest baked at pack time carries whatever URL the packer was told, and if
  // that is wrong every machine installs once and then never updates.
  app.get('/downloads/update.xml', a(async (req, res) => {
    if (!existsSync(crxPath)) return res.status(503).json(NOT_BUILT);

    const manifestPath = join(DIST_DIR, 'manifest-info.json');
    let info = null;
    if (existsSync(manifestPath)) {
      try { info = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { info = null; }
    }
    if (!info?.id || !info?.version) {
      return res.status(503).json({
        ...NOT_BUILT,
        error: 'extension package present but its id/version are unknown',
        detail: 'dist/extension/manifest-info.json is missing or unreadable. '
          + 'Re-run the packer to regenerate it.',
      });
    }

    res.type('application/xml').send(updateManifestXml({
      id: info.id,
      version: info.version,
      codebase: `${baseUrl(req)}/downloads/${CRX_NAME}`,
    }));
  }));

  app.get(`/downloads/${CRX_NAME}`, a(async (_req, res) => {
    if (!existsSync(crxPath)) return res.status(503).json(NOT_BUILT);
    // The CRX content type is what tells the browser this is an extension package
    // rather than something to download; serving it as octet-stream makes Chrome
    // ignore it during a policy install.
    res.type('application/x-chrome-extension');
    res.setHeader('Content-Length', statSync(crxPath).size);
    res.send(readFileSync(crxPath));
  }));

  // Small helper for the rollout itself: confirms what is being served and the ID
  // the policy must name. Saves an admin from decoding a binary to check.
  app.get('/downloads/extension-info', a(async (req, res) => {
    if (!existsSync(crxPath)) return res.status(503).json(NOT_BUILT);
    const manifestPath = join(DIST_DIR, 'manifest-info.json');
    let info = null;
    try { info = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* reported below */ }
    res.json({
      extension_id: info?.id ?? null,
      version: info?.version ?? null,
      size_bytes: statSync(crxPath).size,
      crx_url: `${baseUrl(req)}/downloads/${CRX_NAME}`,
      update_url: `${baseUrl(req)}/downloads/update.xml`,
      policy_hint: {
        ExtensionInstallForcelist: `${info?.id ?? '<id>'};${baseUrl(req)}/downloads/update.xml`,
        ExtensionInstallSources: `${baseUrl(req)}/*`,
      },
    });
  }));
}

// Exported for the packer and tests: the id a DER public key signs to.
export { extensionIdFromDer };
