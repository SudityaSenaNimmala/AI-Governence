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
    const res = await get('/downloads/update.xml');
    assert.equal(res.status, 200);
    assert.match(res.type, /xml/, 'Chrome parses this as XML; a JSON type is ignored');
    assert.match(res.body, new RegExp(`appid='${ID}'`));
    assert.match(res.body, /version='0\.8\.0'/);
    assert.match(res.body, new RegExp(`codebase='https://gov\\.example\\.test/downloads/${CRX_NAME}'`));
  });
});

test('the package is served with the extension content type', async () => {
  // Served as octet-stream, Chrome declines it during a policy install.
  await withServer(dist(), async (get) => {
    const res = await get(`/downloads/${CRX_NAME}`);
    assert.equal(res.status, 200);
    assert.match(res.type, /application\/x-chrome-extension/);
  });
});

test('a missing package answers 503 with the command that builds it', async () => {
  // NOT 404. A 404 reads as "wrong URL" and sends an admin hunting through
  // policy, when the real answer is that nobody ran the packer.
  await withServer(dist({ crx: false }), async (get) => {
    for (const path of ['/downloads/update.xml', `/downloads/${CRX_NAME}`, '/downloads/extension-info']) {
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
    const res = await get('/downloads/update.xml');
    assert.equal(res.status, 503);
    assert.match(JSON.stringify(res.body), /id\/version are unknown/);
  });
});

test('extension-info hands an admin the exact policy values', async () => {
  await withServer(dist(), async (get) => {
    const res = await get('/downloads/extension-info');
    assert.equal(res.status, 200);
    assert.equal(res.body.extension_id, ID);
    assert.equal(res.body.version, '0.8.0');
    assert.equal(res.body.policy_hint.ExtensionInstallForcelist,
      `${ID};https://gov.example.test/downloads/update.xml`);
    assert.equal(res.body.policy_hint.ExtensionInstallSources,
      'https://gov.example.test/*');
  });
});
