// Serving the force-installable extension package.
//
// WHY THESE ASSERTIONS. Everything about a self-hosted force-install fails
// silently. Chrome's policy updater does not report a wrong content type, a
// stale version, or a 404 — it simply does not install, and from the admin
// console that is indistinguishable from a policy that never reached the
// machine. So the properties that a browser actually depends on are pinned
// here, where a regression is visible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { _resetSigningKeyCache as resetKeyCache } from '../src/lib/crx-key.js';

const ID = 'pfgbiiohifpodfkaekolpccnmnjbmioi';
const CRX_NAME = 'cloudfuze-ai-governance.crx';

/** A dist dir containing whatever this test wants the server to find. */
function dist({ crx = true, info = { id: ID, version: '0.8.0' } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cfai-crx-'));
  if (crx) writeFileSync(join(dir, CRX_NAME), Buffer.from('Cr24fake-package'));
  if (info) writeFileSync(join(dir, 'manifest-info.json'), JSON.stringify(info));
  return dir;
}

async function withServer(distDir, fn) {
  // The route reads its dist dir at import time, so each case needs a fresh module.
  process.env.EXTENSION_DIST_DIR = distDir;
  process.env.PUBLIC_SERVER_URL = 'https://gov.example.test';
  // The signing key is cached per PROCESS — correct in production, where one
  // deployment has one key, but it would otherwise leak the first test's key into
  // every later case and make them pass for the wrong reason.
  resetKeyCache();
  const mod = await import(`../src/routes/extension-hosting.js?t=${distDir}`);
  const app = express();
  mod.mountExtensionHosting(app);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    await fn(async (path) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const type = res.headers.get('content-type') || '';
      return {
        status: res.status,
        type,
        body: type.includes('json') ? await res.json() : await res.text(),
        buf: null,
      };
    });
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(distDir, { recursive: true, force: true });
  }
}

test('the update manifest names the id, version and a fetchable codebase', async () => {
  await withServer(dist(), async (get) => {
    const res = await get('/api/v1/extension/update.xml');
    assert.equal(res.status, 200);
    assert.match(res.type, /xml/, 'Chrome parses this as XML; a JSON type is ignored');
    assert.match(res.body, new RegExp(`appid='${ID}'`));
    assert.match(res.body, /version='0\.8\.0'/);
    // /api/v1 and not /downloads: the deployed host proxies only /api to this
    // server, so a /downloads codebase 404s from the frontend. Verified against
    // the live host — this assertion is the reason that is not re-learned.
    assert.match(res.body, new RegExp(`codebase='https://gov\\.example\\.test/api/v1/extension/${CRX_NAME}'`));
  });
});

test('the package is served with the extension content type', async () => {
  // Served as octet-stream, Chrome declines it during a policy install.
  await withServer(dist(), async (get) => {
    const res = await get(`/api/v1/extension/${CRX_NAME}`);
    assert.equal(res.status, 200);
    assert.match(res.type, /application\/x-chrome-extension/);
  });
});

test('a missing package answers 503 with the command that builds it', async () => {
  // NOT 404. A 404 reads as "wrong URL" and sends an admin hunting through
  // policy, when the real answer is that nobody ran the packer.
  await withServer(dist({ crx: false }), async (get) => {
    for (const path of ['/api/v1/extension/update.xml', `/api/v1/extension/${CRX_NAME}`,
      '/api/v1/extension/extension-info', '/downloads/update.xml']) {
      const res = await get(path);
      assert.equal(res.status, 503, `${path} must fail loud`);
      assert.match(JSON.stringify(res.body), /pack-crx/, `${path} must say how to fix it`);
    }
  });
});

test('a package with no recorded id refuses to serve a manifest', async () => {
  // Guessing an id here would produce a manifest that installs nothing, which is
  // worse than an error: the policy looks correct and the rollout silently stalls.
  await withServer(dist({ info: null }), async (get) => {
    const res = await get('/api/v1/extension/update.xml');
    assert.equal(res.status, 503);
    assert.match(JSON.stringify(res.body), /id\/version are unknown/);
  });
});

test('extension-info hands an admin the exact policy values', async () => {
  await withServer(dist(), async (get) => {
    const res = await get('/api/v1/extension/extension-info');
    assert.equal(res.status, 200);
    assert.equal(res.body.extension_id, ID);
    assert.equal(res.body.version, '0.8.0');
    assert.equal(res.body.policy_hint.ExtensionInstallForcelist,
      `${ID};https://gov.example.test/api/v1/extension/update.xml`);
    assert.equal(res.body.policy_hint.ExtensionInstallSources,
      'https://gov.example.test/*');
  });
});

// ── Building from source when dist/ is not deployable ───────────────────────
//
// scripts/pack-crx.mjs writes into dist/, which is gitignored — correctly, since
// it holds a 23 MB binary and, on a first run, the signing key. So the DEPLOYED
// server never receives it, and these endpoints would answer 503 forever while
// every machine's policy pointed at them. Copying a binary onto the host before
// each rollout is exactly the manual step this flow exists to remove, so the
// server packs from the browser-extension/ source it already ships.

test('with a signing key and no dist, the server packs from source', async () => {
  const { generateKeyPem, extensionIdFromKey } = await import('../src/lib/crx.js');
  const key = generateKeyPem();
  process.env.CRX_SIGNING_KEY = key;
  try {
    // Point dist at an empty directory: nothing pre-built to fall back on.
    await withServer(dist({ crx: false, info: null }), async (get) => {
      const res = await get('/api/v1/extension/extension-info');
      assert.equal(res.status, 200, 'a signing key is enough — no dist/ required');
      assert.equal(res.body.extension_id, extensionIdFromKey(key),
        'the served package must sign to the id derived from the deployment key');
      assert.equal(res.body.packaged_from, 'source');
      assert.ok(res.body.size_bytes > 100_000, 'a real package, not an empty one');
    });
  } finally {
    delete process.env.CRX_SIGNING_KEY;
  }
});

test('a base64-wrapped signing key is accepted', async () => {
  // Env plumbing mangles PEM newlines, and a silently-truncated key would produce
  // a package that installs nowhere — so both forms are read.
  const { generateKeyPem, extensionIdFromKey } = await import('../src/lib/crx.js');
  const key = generateKeyPem();
  process.env.CRX_SIGNING_KEY = Buffer.from(key, 'utf8').toString('base64');
  try {
    await withServer(dist({ crx: false, info: null }), async (get) => {
      const res = await get('/api/v1/extension/extension-info');
      assert.equal(res.status, 200);
      assert.equal(res.body.extension_id, extensionIdFromKey(key));
    });
  } finally {
    delete process.env.CRX_SIGNING_KEY;
  }
});

test('a pre-built dist still wins over packing from source', async () => {
  // A locally packed package or a mounted volume must behave exactly as before,
  // so the packer stays the authority when someone has used it.
  process.env.CRX_SIGNING_KEY = (await import('../src/lib/crx.js')).generateKeyPem();
  try {
    await withServer(dist(), async (get) => {
      const res = await get('/api/v1/extension/extension-info');
      assert.equal(res.body.extension_id, ID, 'the dist package, not a freshly signed one');
      assert.equal(res.body.packaged_from, 'dist');
    });
  } finally {
    delete process.env.CRX_SIGNING_KEY;
  }
});

test('no key and no dist still fails loud', async () => {
  await withServer(dist({ crx: false, info: null }), async (get) => {
    const res = await get('/api/v1/extension/update.xml');
    assert.equal(res.status, 503);
    assert.match(JSON.stringify(res.body), /CRX_SIGNING_KEY/,
      'the error must name the one setting that fixes it');
  });
});

// ── The provisioning script, generated per deployment ───────────────────────
//
// Rolling out at CloudFuze meant hand-editing a script in the repo: paste the
// extension ID, the enroll secret, the server URL, the identity domain. Fine once
// for ourselves; unacceptable as a product, where every customer would be editing
// PowerShell and every value they got wrong would fail in the silent way this
// whole flow keeps demonstrating. The server knows all but two of those values
// about itself, so it fills them in.

import { ADMIN_TOKEN, ENROLL_SECRET } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

async function withDbServer(fn) {
  process.env.EXTENSION_DIST_DIR = mkdtempSync(join(tmpdir(), 'cfai-empty-'));
  process.env.PUBLIC_SERVER_URL = 'https://tenant.example.test';
  resetKeyCache();
  delete process.env.CRX_SIGNING_KEY;
  const db = createFakeDb();
  const mod = await import(`../src/routes/extension-hosting.js?p=${Date.now()}${Math.random()}`);
  const app = express();
  mod.mountExtensionHosting(app, db);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    await fn(async (path, headers = {}) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
      const type = res.headers.get('content-type') || '';
      return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
    }, db);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('the Windows script comes back filled in for THIS deployment', async () => {
  await withDbServer(async (get) => {
    const res = await get('/api/v1/extension/provisioning-script?platform=windows'
      + '&identityDomain=acme.com&cbcmToken=CBCM-XYZ',
    { authorization: `Bearer ${ADMIN_TOKEN}` });

    assert.equal(res.status, 200);
    assert.match(res.body, /\$ServerUrl {4}= 'https:\/\/tenant\.example\.test'/,
      "the customer's own server, not ours");
    assert.match(res.body, /\$IdentityDomain = 'acme\.com'/, 'their domain, not cloudfuze.com');
    assert.match(res.body, /\$ChromeCbcmToken = 'CBCM-XYZ'/, 'their CBCM token');
    assert.ok(res.body.includes(ENROLL_SECRET), 'their enroll secret');
    assert.match(res.body, /\$ExtensionId {7}= '[a-p]{32}'/, 'the id of the package this server serves');
    assert.ok(!/REPLACE_[A-Z_]+/.test(res.body),
      'nothing left for an admin to discover and get wrong');
  });
});

test('the macOS script is filled in the same way', async () => {
  await withDbServer(async (get) => {
    const res = await get('/api/v1/extension/provisioning-script?platform=macos'
      + '&identityDomain=acme.com&cbcmToken=CBCM-XYZ',
    { authorization: `Bearer ${ADMIN_TOKEN}` });

    assert.equal(res.status, 200);
    assert.match(res.body, /SERVER_URL="https:\/\/tenant\.example\.test"/);
    assert.match(res.body, /IDENTITY_DOMAIN="acme\.com"/);
    assert.match(res.body, /CBCM_TOKEN="CBCM-XYZ"/);
    assert.match(res.body, /EXTENSION_ID="[a-p]{32}"/);
    assert.ok(!/REPLACE_[A-Z_]+/.test(res.body));
  });
});

test('the script carries the same id the server serves', async () => {
  // A mismatch here is the whole failure mode: the policy would name an extension
  // the server does not host, and nothing would install with no error anywhere.
  await withDbServer(async (get) => {
    const info = await get('/api/v1/extension/extension-info');
    const script = await get('/api/v1/extension/provisioning-script?platform=windows',
      { authorization: `Bearer ${ADMIN_TOKEN}` });
    assert.ok(script.body.includes(info.body.extension_id));
  });
});

test('the script requires an admin token, because it contains the enroll secret', async () => {
  // The .crx itself is public — a browser updater cannot present credentials —
  // but the enroll secret is the credential for joining the fleet.
  await withDbServer(async (get) => {
    assert.equal((await get('/api/v1/extension/provisioning-script?platform=windows')).status, 401);
    assert.equal((await get('/api/v1/extension/provisioning-script?platform=windows',
      { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await get(
      `/api/v1/extension/provisioning-script?platform=windows&adminToken=${ADMIN_TOKEN}`)).status, 200,
    'a query param is accepted too, for a plain browser download');
  });
});

test('an unknown platform is refused', async () => {
  await withDbServer(async (get) => {
    const res = await get('/api/v1/extension/provisioning-script?platform=solaris',
      { authorization: `Bearer ${ADMIN_TOKEN}` });
    assert.equal(res.status, 400);
  });
});

test('a deployment with no key of its own still generates one and serves a script', async () => {
  // The product case: a customer deploys the stack, sets nothing, and the rollout
  // works. Zero CloudFuze secrets on their infrastructure.
  await withDbServer(async (get, db) => {
    const res = await get('/api/v1/extension/provisioning-script?platform=windows',
      { authorization: `Bearer ${ADMIN_TOKEN}` });
    assert.equal(res.status, 200);
    const stored = await db.collection('settings').findOne({ key: 'crx_signing_key' });
    assert.ok(stored?.value?.includes('BEGIN'), 'the key was generated and persisted');
  });
});
