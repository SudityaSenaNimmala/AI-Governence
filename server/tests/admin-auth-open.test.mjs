// ADMIN_AUTH_OPEN — the temporary hole, and the line it must not cross.
//
// WHY IT EXISTS. The dashboard has no sign-in yet, so every admin-gated panel
// (Access Requests, Active Exceptions, session replay, SDK projects) is unusable
// in a deployment: the browser has no credential and the server correctly answers
// 401. Admin OAuth is the real answer and is deliberately deferred, so this flag
// makes those panels work in the meantime.
//
// WHAT IS ASSERTED HERE is the shape of the compromise, because a temporary hole
// with no tests around it is how a stopgap becomes permanent and unbounded:
//
//   - It is OFF unless explicitly enabled, so nobody inherits it by upgrading.
//   - Only the exact string "true" enables it — not "1", not "yes", not any
//     truthy accident from a mistyped .env.
//   - It does NOT open the provisioning-script endpoint, which returns the ENROLL
//     SECRET. Opening an approval queue is a different order of problem from
//     handing out the credential that lets anyone enrol machines and post
//     fabricated events.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

async function freshAuth(flag) {
  if (flag === undefined) delete process.env.ADMIN_AUTH_OPEN;
  else process.env.ADMIN_AUTH_OPEN = flag;
  // The flag is read at module load, as a deployment-time setting should be, so
  // each case needs its own instance.
  return import(`../src/auth.js?f=${flag}-${Math.random()}`);
}

async function probe(auth) {
  const app = express();
  app.get('/guarded', auth.requireAdminAuth, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/guarded`);
    return res.status;
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('admin auth stays REQUIRED by default', async () => {
  // I briefly made this default-open so the dashboard would work unconfigured, and
  // thirteen tests failed — correctly. They guard session replay, raw prompt
  // content, conversation content and the SDK routes: the most sensitive artefacts
  // this product holds. The default does not move for them.
  const auth = await freshAuth(undefined);
  assert.equal(await probe(auth), 401, 'nobody should inherit an open admin surface');
  assert.equal(auth.adminAuthIsOpen(), false);
});

test('ADMIN_AUTH_OPEN=true opens the guarded routes', async () => {
  const auth = await freshAuth('true');
  assert.equal(await probe(auth), 200);
  assert.equal(auth.adminAuthIsOpen(), true);
});

test('only the exact string "true" opens it', async () => {
  // A mistyped .env must fail CLOSED. "1"/"yes"/"TRUE " reading as enabled is how
  // a deployment ends up open without anyone having decided to.
  for (const value of ['1', 'yes', 'on', 'false', '', 'True ', 'truthy']) {
    const auth = await freshAuth(value);
    assert.equal(auth.adminAuthIsOpen(), value.trim().toLowerCase() === 'true',
      `ADMIN_AUTH_OPEN=${JSON.stringify(value)} must not be treated as enabled`);
  }
});

// ── The review queue is the one exception, and it inverts the default ──────
//
// The dashboard has no sign-in, so a closed review queue means Access Requests is
// dead in every deployment — it cannot even be demonstrated. That queue is also a
// different exposure class from the routes above, and the same one this codebase
// already accepts: /api/v1/risk-scores, /machines and /dlp are readable without a
// credential today.
//
// One variable, two defaults. That is surprising, so it is pinned here.

test('the review queue is open by default', async () => {
  const auth = await freshAuth(undefined);
  assert.equal(auth.reviewAuthIsOpen(), true);
  const app = express();
  app.get('/review', auth.requireReviewAuth, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/review`);
    assert.equal(res.status, 200, 'Access Requests must work without configuration');
  } finally { await new Promise((r) => server.close(r)); }
});

test('ADMIN_AUTH_OPEN=false closes the review queue too', async () => {
  // One switch for an operator to think about, not two.
  const auth = await freshAuth('false');
  assert.equal(auth.reviewAuthIsOpen(), false);
  const app = express();
  app.get('/review', auth.requireReviewAuth, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/review`);
    assert.equal(res.status, 401);
  } finally { await new Promise((r) => server.close(r)); }
});

test('closing the review queue takes only an exact "false"', async () => {
  for (const value of ['0', 'no', 'off', 'true', '', 'False ', 'falsey']) {
    const auth = await freshAuth(value);
    assert.equal(auth.reviewAuthIsOpen(), value.trim().toLowerCase() !== 'false',
      `ADMIN_AUTH_OPEN=${JSON.stringify(value)} handled wrongly for the review queue`);
  }
});

test('a valid token still works while the flag is on', async () => {
  // The flag must not break the credentialed path — the provisioning download and
  // any scripted caller still present a token.
  const auth = await freshAuth(undefined);
  const app = express();
  app.get('/guarded', auth.requireAdminAuth, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/guarded`, {
      headers: { authorization: `Bearer ${auth.ADMIN_TOKEN}` },
    });
    assert.equal(res.status, 200);
  } finally {
    await new Promise((r) => server.close(r));
    delete process.env.ADMIN_AUTH_OPEN;
  }
});

test('the flag does NOT open the provisioning script, which carries the enroll secret', async () => {
  delete process.env.ADMIN_AUTH_OPEN;   // i.e. open, the default
  process.env.PUBLIC_SERVER_URL = 'https://tenant.example.test';
  try {
    const mod = await import(`../src/routes/extension-hosting.js?open=${Math.random()}`);
    const app = express();
    mod.mountExtensionHosting(app, null);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/extension/provisioning-script?platform=windows`);
      assert.equal(res.status, 401,
        'handing out the enroll secret is not part of this compromise');
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    delete process.env.ADMIN_AUTH_OPEN;
  }
});
