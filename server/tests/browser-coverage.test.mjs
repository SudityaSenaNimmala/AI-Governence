// Which machines have a browser we cannot govern.
//
// THE GAP THIS MEASURES. Chrome refuses an off-store force-install unless the
// machine is joined to an Active Directory domain or enrolled in Chrome Browser
// Cloud Management. Entra/Azure-AD join and Intune MDM do not satisfy it. On an
// Entra-only estate a machine can therefore be fully provisioned — policy written,
// Intune reporting success — and still have a completely ungoverned Chrome.
//
// Nothing observable distinguishes that from a machine with no Chrome at all: the
// extension never installs, so it never enrols, so there is no row to be missing
// from. An absence cannot be measured from the outside, so the machine reports
// what it found and these assertions pin what the report has to say.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createFakeDb } from './helpers/fake-db.mjs';
import { mountBrowserCoverage } from '../src/routes/browser-coverage.js';
import { ENROLL_SECRET } from '../src/auth.js';

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json());
  mountBrowserCoverage(app, db);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({
      post: (b) => call('POST', '/api/v1/browser-coverage', b),
      get: () => call('GET', '/api/v1/browser-coverage'),
      db,
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const REPORT = {
  hostname: 'SATYA',
  os: 'windows',
  user: 'satya.pinniti@cloudfuze.com',
  browsers: ['chrome', 'edge'],
  chrome_installed: true,
  chrome_governable: false,     // Entra-joined, no CBCM token
  domain_joined: false,
  entra_joined: true,
  cbcm_token: false,
  private_browsing_blocked: false,
  enrollSecret: ENROLL_SECRET,
};

test('an ungoverned Chrome is recorded and reported back as a gap', async () => {
  await withServer(async ({ post, get }) => {
    const res = await post(REPORT);
    assert.equal(res.status, 200);
    assert.equal(res.body.gap, true, 'the machine is told immediately that it has a hole');

    const view = await get();
    assert.equal(view.body.ungoverned_chrome, 1);
    assert.equal(view.body.chrome_gap_machines[0].hostname, 'SATYA');
    assert.match(view.body.fix, /CBCM|Enrollment token/i,
      'the report must name the fix, not just the problem');
  });
});

test('Chrome with a CBCM token is not a gap', async () => {
  await withServer(async ({ post, get }) => {
    await post({ ...REPORT, chrome_governable: true, cbcm_token: true });
    const view = await get();
    assert.equal(view.body.ungoverned_chrome, 0);
    assert.equal(view.body.fix, null, 'no fix offered when there is nothing to fix');
  });
});

test('Chrome not installed is not a gap', async () => {
  // An Edge-only machine is fully governed; it must not be counted as a hole.
  await withServer(async ({ post, get }) => {
    await post({ ...REPORT, browsers: ['edge'], chrome_installed: false });
    const view = await get();
    assert.equal(view.body.ungoverned_chrome, 0);
  });
});

test('Firefox is reported separately, because no provisioning run can fix it', async () => {
  // Chrome's gap closes with a token. Firefox needs a different build and Mozilla
  // signing, so it is a standing exclusion rather than a misconfiguration.
  await withServer(async ({ post, get }) => {
    await post({ ...REPORT, browsers: ['edge', 'firefox'], chrome_installed: false });
    const view = await get();
    assert.equal(view.body.ungoverned_firefox, 1);
    assert.equal(view.body.firefox_machines[0].hostname, 'SATYA');
  });
});

test('re-reporting a machine updates it rather than accumulating rows', async () => {
  // Current state, not history: a machine that gets its token tomorrow must stop
  // appearing as a gap, not sit alongside its own older row making the estate
  // look worse than it is.
  await withServer(async ({ post, get }) => {
    await post(REPORT);
    await post({ ...REPORT, chrome_governable: true, cbcm_token: true });
    const view = await get();
    assert.equal(view.body.machines_reporting, 1, 'one machine, one row');
    assert.equal(view.body.ungoverned_chrome, 0, 'the fix is reflected, not appended');
  });
});

test('the same hostname on a different OS is a different machine', async () => {
  await withServer(async ({ post, get }) => {
    await post(REPORT);
    await post({ ...REPORT, os: 'macos' });
    const view = await get();
    assert.equal(view.body.machines_reporting, 2);
  });
});

test('private browsing left open is counted', async () => {
  // Accepted risk rather than a defect, but it should still be countable — an
  // accepted risk nobody can quantify is not really accepted.
  await withServer(async ({ post, get }) => {
    await post(REPORT);
    const view = await get();
    assert.equal(view.body.private_browsing_open, 1);
  });
});

test('a wrong or missing enroll secret is rejected', async () => {
  // This endpoint is reachable before any extension exists to hold a token, so
  // the enroll secret is the credential — and it must actually be checked.
  await withServer(async ({ post }) => {
    assert.equal((await post({ ...REPORT, enrollSecret: 'wrong' })).status, 401);
    const { enrollSecret, ...noSecret } = REPORT;
    assert.equal((await post(noSecret)).status, 401);
  });
});

test('a report with no hostname is refused', async () => {
  await withServer(async ({ post }) => {
    const { hostname, ...noHost } = REPORT;
    assert.equal((await post(noHost)).status, 400);
  });
});
