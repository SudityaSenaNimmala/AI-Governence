// POST /api/v1/access-requests hardening + the desktop (Electron agent) surface.
//
// Three properties this pins down, all of them things that were either wrong or
// absent before the desktop "Request Access" flow existed:
//
//   1. IDENTITY. The browser extension has no machine token and posts its own
//      machine_id — that path must keep working byte-for-byte. The desktop agent
//      DOES hold an enrolment JWT, and when it presents one the verified claims
//      win over the body, so a compromised body cannot file a request (or probe
//      the pending/cooldown state) under another machine's identity. A token
//      that is present but invalid is a 401, never a silent downgrade to
//      body-trust.
//   2. COOLDOWN. A rejection is an answer. Re-asking for the same tool within
//      24h is refused with a machine-readable code instead of filing a fresh
//      request and re-firing the access_request webhook at the admin who just
//      said no.
//   3. SCOPE. /access-requests/mine and /access-exceptions/mine read ONLY the
//      calling machine's rows, from the token claims — never from a query param
//      — and the fleet-wide exception list (named employees + hostnames) now
//      requires admin auth.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountAccessRequests } from '../src/routes/access-requests.js';
import { signMachineToken, ADMIN_TOKEN } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE = 'mach-desktop-1';
const OTHER   = 'mach-desktop-2';

async function withServer(fn, seed = async () => {}) {
  const db = createFakeDb();
  await seed(db);

  const app = express();
  app.use(express.json());
  mountAccessRequests(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { body, token } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : null),
        ...(token ? { authorization: `Bearer ${token}` } : null),
      },
      ...(body ? { body: JSON.stringify(body) } : null),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  try {
    return await fn({
      db,
      post: (p, opts) => call('POST', p, opts),
      get:  (p, opts) => call('GET', p, opts),
      put:  (p, opts) => call('PUT', p, opts),
      del:  (p, opts) => call('DELETE', p, opts),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const desktopToken = (machineId = MACHINE, hostname = 'DESKTOP-CFAI') =>
  signMachineToken({ machineId, hostname });

const DESKTOP_BODY = {
  tool_host: 'claude.ai',
  tool_name: 'Claude',
  tool_vendor: 'Anthropic',
  reason: 'Need it for the migration runbook',
  surface: 'desktop',
  platform: 'claude_ai_project',
  process_name: 'Claude',
  agent_id: 'agent-77',
};

// ── 1. Identity ──────────────────────────────────────────────────────────────

test('a machine token overrides a spoofed machine_id/hostname in the body', async () => {
  await withServer(async ({ post, db }) => {
    const res = await post('/api/v1/access-requests', {
      token: desktopToken(),
      body: { ...DESKTOP_BODY, machine_id: OTHER, hostname: 'SOMEONE-ELSES-PC' },
    });
    assert.equal(res.status, 201);

    const [row] = db._rows('access_requests');
    assert.equal(row.machine_id, MACHINE, 'identity must come from the verified claims');
    assert.equal(row.hostname, 'DESKTOP-CFAI');
  });
});

test('the desktop fields are stored, and surface defaults to browser without them', async () => {
  await withServer(async ({ post, db }) => {
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY })).status, 201);
    // The browser extension's payload, exactly as it ships today: no token, no
    // surface, no desktop fields.
    assert.equal((await post('/api/v1/access-requests', {
      body: { machine_id: 'mach-ext', hostname: 'LAPTOP-1', user: 'jdoe', tool_host: 'chatgpt.com', tool_name: 'ChatGPT', reason: 'research' },
    })).status, 201);

    const rows = db._rows('access_requests');
    const desktop = rows.find((r) => r.machine_id === MACHINE);
    assert.equal(desktop.surface, 'desktop');
    assert.equal(desktop.platform, 'claude_ai_project');
    assert.equal(desktop.process_name, 'Claude');
    assert.equal(desktop.agent_id, 'agent-77');

    const browser = rows.find((r) => r.machine_id === 'mach-ext');
    assert.equal(browser.surface, 'browser', 'an extension request must not be mislabelled as desktop');
    assert.equal(browser.platform, null);
    assert.equal(browser.user, 'jdoe', 'the body-trust path still stamps the detected user');
  });
});

test('an invalid bearer token is a 401, not a silent fall back to body-trust', async () => {
  await withServer(async ({ post, db }) => {
    const res = await post('/api/v1/access-requests', {
      token: 'not-a-jwt',
      body: { ...DESKTOP_BODY, machine_id: MACHINE },
    });
    assert.equal(res.status, 401);
    assert.equal(db._rows('access_requests').length, 0, 'nothing may be filed for an unverifiable device');
  });
});

test('an unknown surface value is rejected instead of stored', async () => {
  await withServer(async ({ post }) => {
    const res = await post('/api/v1/access-requests', {
      token: desktopToken(), body: { ...DESKTOP_BODY, surface: 'mobile' },
    });
    assert.equal(res.status, 400);
  });
});

test('reason is capped and control characters are stripped server-side', async () => {
  await withServer(async ({ post, db }) => {
    const res = await post('/api/v1/access-requests', {
      token: desktopToken(),
      // 900 chars of client-supplied text with a zero-width joiner and a stray
      // \r — the client caps at 500 too, but this route does not trust it.
      body: { ...DESKTOP_BODY, reason: 'x'.repeat(900) + '‍\rtail' },
    });
    assert.equal(res.status, 201);
    const [row] = db._rows('access_requests');
    assert.equal(row.reason.length, 500);
    assert.equal(/[\r‍]/.test(row.reason), false);
  });
});

test('a request with no tool_host is still a 400 with a machine token', async () => {
  await withServer(async ({ post }) => {
    const res = await post('/api/v1/access-requests', { token: desktopToken(), body: { surface: 'desktop' } });
    assert.equal(res.status, 400);
  });
});

// ── 2. Pending + cooldown ────────────────────────────────────────────────────

test('a second request for the same tool while one is pending is a 409', async () => {
  await withServer(async ({ post }) => {
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY })).status, 201);
    const dup = await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'pending');
    assert.ok(dup.body.request_id);
  });
});

test('re-asking within 24h of a rejection is a 429 carrying a retry time', async () => {
  await withServer(async ({ post }) => {
    const res = await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY });
    assert.equal(res.status, 429);
    assert.equal(res.body.code, 'recently_rejected');
    assert.ok(new Date(res.body.retry_after).getTime() > Date.now());
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-rejected', machine_id: MACHINE, hostname: 'DESKTOP-CFAI', tool_host: 'claude.ai',
      tool_name: 'Claude', status: 'rejected', surface: 'desktop',
      submitted_at: new Date(Date.now() - 2 * 3600000),
      reviewed_at: new Date(Date.now() - 3600000),
    });
  });
});

test('a rejection older than 24h no longer blocks a new request', async () => {
  await withServer(async ({ post }) => {
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY })).status, 201);
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-old-reject', machine_id: MACHINE, tool_host: 'claude.ai', status: 'rejected',
      submitted_at: new Date(Date.now() - 40 * 3600000),
      reviewed_at: new Date(Date.now() - 25 * 3600000),
    });
  });
});

test('the cooldown is per tool, and an approval is not a rejection', async () => {
  await withServer(async ({ post }) => {
    // Different tool → unaffected by the claude.ai rejection.
    assert.equal((await post('/api/v1/access-requests', {
      token: desktopToken(), body: { ...DESKTOP_BODY, tool_host: 'chatgpt.com', tool_name: 'ChatGPT' },
    })).status, 201);
    // Same tool, but the earlier verdict was an approval that has since expired.
    assert.equal((await post('/api/v1/access-requests', {
      token: desktopToken(), body: { ...DESKTOP_BODY, tool_host: 'cursor.com', tool_name: 'Cursor' },
    })).status, 201);
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-rej', machine_id: MACHINE, tool_host: 'claude.ai', status: 'rejected',
      submitted_at: new Date(Date.now() - 7200000), reviewed_at: new Date(Date.now() - 3600000),
    });
    await db.collection('access_requests').insertOne({
      id: 'req-app', machine_id: MACHINE, tool_host: 'cursor.com', status: 'approved',
      submitted_at: new Date(Date.now() - 7200000), reviewed_at: new Date(Date.now() - 3600000),
    });
  });
});

test("a rejection on another machine's row does not silence this machine", async () => {
  await withServer(async ({ post }) => {
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY })).status, 201);
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-other', machine_id: OTHER, hostname: 'OTHER-PC', tool_host: 'claude.ai', status: 'rejected',
      submitted_at: new Date(Date.now() - 7200000), reviewed_at: new Date(Date.now() - 3600000),
    });
  });
});

test('a body-trust caller cannot dodge the cooldown by minting a new machine_id', async () => {
  // Extension reinstalls generate a fresh machine_id, so for the body-trust
  // path the hostname is the only continuity there is.
  await withServer(async ({ post }) => {
    const res = await post('/api/v1/access-requests', {
      body: { machine_id: 'mach-ext-reinstalled', hostname: 'LAPTOP-1', tool_host: 'claude.ai' },
    });
    assert.equal(res.status, 429);
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-ext-rej', machine_id: 'mach-ext-old', hostname: 'LAPTOP-1', tool_host: 'claude.ai',
      status: 'rejected', submitted_at: new Date(Date.now() - 7200000), reviewed_at: new Date(Date.now() - 3600000),
    });
  });
});

// ── 3. Scope ─────────────────────────────────────────────────────────────────

test('/access-requests/mine returns only the calling machine, and needs a token', async () => {
  await withServer(async ({ get }) => {
    assert.equal((await get('/api/v1/access-requests/mine')).status, 401);

    const res = await get('/api/v1/access-requests/mine', { token: desktopToken() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((r) => r.id), ['req-mine-2', 'req-mine-1']);
    // No admin-only or cross-machine field leaks through this route.
    for (const row of res.body) {
      assert.equal('review_note' in row, false);
      assert.equal('machine_id' in row, false);
      assert.equal('employee_name' in row, false);
    }
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-mine-1', machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude',
      status: 'rejected', surface: 'desktop', review_note: 'not for contractors',
      submitted_at: new Date('2026-08-20T09:00:00Z'), reviewed_at: new Date('2026-08-20T10:00:00Z'),
    });
    await db.collection('access_requests').insertOne({
      id: 'req-mine-2', machine_id: MACHINE, tool_host: 'chatgpt.com', tool_name: 'ChatGPT',
      status: 'pending', surface: 'desktop', submitted_at: new Date('2026-08-21T09:00:00Z'),
    });
    await db.collection('access_requests').insertOne({
      id: 'req-theirs', machine_id: OTHER, tool_host: 'claude.ai', tool_name: 'Claude',
      status: 'pending', surface: 'desktop', submitted_at: new Date('2026-08-21T10:00:00Z'),
    });
  });
});

test('/access-exceptions/mine returns this machine\'s live exceptions only', async () => {
  await withServer(async ({ get }) => {
    assert.equal((await get('/api/v1/access-exceptions/mine')).status, 401);

    const res = await get('/api/v1/access-exceptions/mine', { token: desktopToken() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.map((r) => r.tool_host), ['claude.ai']);
    assert.equal(res.body[0].tool_name, 'Claude');
    assert.ok(res.body[0].expires_at);
    // machine_id / request_id are not part of the agent-facing shape.
    //
    // scope / agent_id / agent_name ARE, deliberately: the enforcer has to know
    // whether a grant lifts the whole app or only one named agent, and a row
    // written before agent scoping existed reports scope:'host' with both agent
    // fields null — which is what all four seeded rows below are.
    assert.deepEqual(Object.keys(res.body[0]).sort(),
      ['agent_id', 'agent_name', 'expires_at', 'scope', 'tool_host', 'tool_name']);
    assert.equal(res.body[0].scope, 'host', 'a legacy row with no scope field must read as host-wide');
    assert.equal(res.body[0].agent_id, null);
    assert.equal(res.body[0].agent_name, null);
  }, async (db) => {
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude', request_id: 'r1',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
    // Expired → the app must go back to being blocked.
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'chatgpt.com', tool_name: 'ChatGPT', request_id: 'r2',
      active: true, expires_at: new Date(Date.now() - 3600000),
    });
    // Revoked early.
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'cursor.com', tool_name: 'Cursor', request_id: 'r3',
      active: false, expires_at: new Date(Date.now() + 8 * 3600000),
    });
    // Someone else's grant.
    await db.collection('access_exceptions').insertOne({
      machine_id: OTHER, tool_host: 'gemini.google.com', tool_name: 'Gemini', request_id: 'r4',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
  });
});

test('the fleet-wide exception list is readable by the review UI', async () => {
  await withServer(async ({ get }) => {
    // Open by default now — the dashboard has no sign-in, so a closed queue means
    // this panel is dead in every deployment. The closed posture
    // (ADMIN_AUTH_OPEN=false) is covered in admin-auth-open.test.mjs.
    assert.equal((await get('/api/v1/access-exceptions')).status, 200);

    const ok = await get('/api/v1/access-exceptions', { token: ADMIN_TOKEN });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.length, 1);
    assert.equal(ok.body[0].machine_id, MACHINE);
  }, async (db) => {
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude', request_id: 'r1',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
  });
});

// ── 4. Admin auth on the review surface ──────────────────────────────────────
//
// The review step IS the control. Approve/reject/revoke and the fleet-wide
// request list shipped with no middleware at all, so anyone who could reach the
// server could approve their own pending request (minting the exception the
// extension and the desktop enforcer both honour), reject a colleague's — which
// also starts the 24h cooldown that silences them — revoke a granted exception,
// or just read every request in the fleet with the requester's name, hostname
// and the free-text reason they typed.
//
// A MACHINE token is asserted separately from no token at all in each case: an
// enrolled device holds one, and the requester's own laptop presenting its
// enrolment JWT is precisely the self-approval this must refuse. Passing
// requireMachineAuth is not passing requireAdminAuth.

const PENDING = {
  id: 'req-pending', machine_id: MACHINE, hostname: 'DESKTOP-CFAI', user: 'jdoe@corp.com',
  tool_host: 'claude.ai', tool_name: 'Claude', reason: 'migration runbook',
  status: 'pending', surface: 'desktop', submitted_at: new Date('2026-08-21T09:00:00Z'),
};

const seedReview = async (db) => {
  await db.collection('access_requests').insertOne({ ...PENDING });
  await db.collection('access_requests').insertOne({
    id: 'req-granted', machine_id: OTHER, tool_host: 'chatgpt.com', tool_name: 'ChatGPT',
    status: 'approved', surface: 'browser', submitted_at: new Date('2026-08-20T09:00:00Z'),
    expires_at: new Date(Date.now() + 8 * 3600000),
  });
  await db.collection('access_exceptions').insertOne({
    machine_id: OTHER, tool_host: 'chatgpt.com', tool_name: 'ChatGPT', request_id: 'req-granted',
    active: true, expires_at: new Date(Date.now() + 8 * 3600000),
  });
};

test('the fleet-wide request list is readable by the review UI', async () => {
  await withServer(async ({ get }) => {
    assert.equal((await get('/api/v1/access-requests')).status, 200);

    const ok = await get('/api/v1/access-requests', { token: ADMIN_TOKEN });
    assert.equal(ok.status, 200);
    // Behaves exactly as before once authenticated: every row, newest first,
    // enriched with identity and carrying the reason text.
    assert.deepEqual(ok.body.map((r) => r.id), ['req-pending', 'req-granted']);
    assert.equal(ok.body[0].employee_name, 'jdoe@corp.com');
    assert.equal(ok.body[0].reason, 'migration runbook');
  }, seedReview);
});

test('the request list status filter still works', async () => {
  await withServer(async ({ get }) => {
    const ok = await get('/api/v1/access-requests?status=pending', { token: ADMIN_TOKEN });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.map((r) => r.id), ['req-pending']);
  }, seedReview);
});

test('approving mints exactly one exception and moves the request', async () => {
  await withServer(async ({ put, db }) => {
    const body = { expires_in_hours: 8, note: 'migration window' };

    // Open by default — see requireReviewAuth in auth.js. A queue you can see and
    // cannot act on is not a review queue. The closed posture is covered in
    // admin-auth-open.test.mjs; what matters here is the state transition.
    assert.equal(db._rows('access_requests').find((r) => r.id === 'req-pending').status, 'pending');
    assert.equal(db._rows('access_exceptions').length, 1);

    const ok = await put('/api/v1/access-requests/req-pending/approve', { token: ADMIN_TOKEN, body });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.expires_at);
    assert.equal(db._rows('access_requests').find((r) => r.id === 'req-pending').status, 'approved');
    assert.equal(db._rows('access_exceptions').length, 2);
  }, seedReview);
});

test('approve validates the expiry it is given', async () => {
  // A mandatory expiry is the point of the approval step: an approval with no end
  // date is a permanent grant wearing a temporary label.
  await withServer(async ({ put }) => {
    assert.equal((await put('/api/v1/access-requests/req-pending/approve', { body: {} })).status, 400,
      'no expiry must be refused, not defaulted');
    assert.equal((await put('/api/v1/access-requests/req-pending/approve', { token: ADMIN_TOKEN, body: {} })).status, 400);
    assert.equal((await put('/api/v1/access-requests/req-pending/approve', {
      token: ADMIN_TOKEN, body: { expires_at: '2020-01-01T00:00:00Z' },
    })).status, 400);
  }, seedReview);
});

test('rejecting stamps a verdict and the review note', async () => {
  await withServer(async ({ put, db }) => {
    const body = { note: 'not for contractors' };

    const untouched = db._rows('access_requests').find((r) => r.id === 'req-pending');
    assert.equal(untouched.status, 'pending');
    assert.ok(!untouched.reviewed_at, 'nothing is stamped before a verdict is given');

    const ok = await put('/api/v1/access-requests/req-pending/reject', { token: ADMIN_TOKEN, body });
    assert.equal(ok.status, 200);
    const rejected = db._rows('access_requests').find((r) => r.id === 'req-pending');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.review_note, 'not for contractors');
  }, seedReview);
});

test('revoking deactivates the exception and marks the request revoked', async () => {
  await withServer(async ({ del, db }) => {
    const live = () => db._rows('access_exceptions').find((e) => e.request_id === 'req-granted');

    assert.equal(live().active, true);
    assert.equal(db._rows('access_requests').find((r) => r.id === 'req-granted').status, 'approved');

    const ok = await del('/api/v1/access-exceptions/req-granted', { token: ADMIN_TOKEN });
    assert.equal(ok.status, 200);
    assert.equal(live().active, false);
    assert.equal(db._rows('access_requests').find((r) => r.id === 'req-granted').status, 'revoked');
  }, seedReview);
});

// The extension's own per-machine check stays open on purpose: it runs in a
// content script with no admin context, and it answers one boolean about the
// machine_id it was handed. Pinned here so locking it down is a deliberate
// decision with a client change attached, not an accident.
test('the extension exception check stays reachable without a credential', async () => {
  await withServer(async ({ get }) => {
    const res = await get('/api/v1/access-exceptions/check?machine_id=' + OTHER + '&tool_host=chatgpt.com');
    assert.equal(res.status, 200);
    assert.equal(res.body.allowed, true);
  }, seedReview);
});

// ── End to end: approve on the server, agent sees the exception ───────────────

test('approving a desktop request produces an exception the agent can read back', async () => {
  await withServer(async ({ post, put, get }) => {
    const created = await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY });
    assert.equal(created.status, 201);

    const approved = await put(`/api/v1/access-requests/${created.body.id}/approve`, {
      token: ADMIN_TOKEN,
      body: { expires_in_hours: 8, note: 'migration window' },
    });
    assert.equal(approved.status, 200);

    const mine = await get('/api/v1/access-exceptions/mine', { token: desktopToken() });
    assert.deepEqual(mine.body.map((r) => r.tool_host), ['claude.ai'],
      'the exception key is the canonical vendor host, which is what the agent filters blocked-agents.json on');
    assert.equal(mine.body[0].scope, 'host',
      'a request with no block_scope is a whole-app block, so the grant is host-wide');

    // …and the request itself now reads as approved on the device.
    const reqs = await get('/api/v1/access-requests/mine', { token: desktopToken() });
    assert.equal(reqs.body[0].status, 'approved');
    assert.ok(reqs.body[0].expires_at);
    assert.equal(reqs.body[0].block_scope, 'app');
  });
});

// ── 5. Per-agent scope ───────────────────────────────────────────────────────
//
// A block can be narrowed to ONE NAMED AGENT inside a host app (an agent in
// Microsoft Teams, one M365 Copilot agent). Everything below is about the
// over-grant that the host-only key produced: a single {machine_id, tool_host}
// exception document meant the FIRST per-agent approval on a host both
// overwrote any other agent's live grant and read back as "allowed" for every
// agent there, on the desktop enforcer and via /check in the browser alike.

const TEAMS = { tool_host: 'teams.microsoft.com', tool_name: 'Microsoft Teams' };
const AGENT_A = {
  ...DESKTOP_BODY, ...TEAMS, platform: 'ms_teams', process_name: 'ms-teams',
  block_scope: 'agent', agent_id: 'agent-a', agent_name: 'IT Help Desk Agent',
};
const AGENT_B = { ...AGENT_A, agent_id: 'agent-b', agent_name: 'Finance Bot' };

const checkUrl = (host, query = '', machineId = MACHINE) =>
  `/api/v1/access-exceptions/check?machine_id=${machineId}&tool_host=${host}${query}`;

test('approving one agent on a host grants only that agent', async () => {
  await withServer(async ({ post, put, get, db }) => {
    const a = await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_A });
    const b = await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_B });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201, 'a pending ask about agent A must not 409 an ask about agent B');

    const approved = await put(`/api/v1/access-requests/${a.body.id}/approve`, {
      token: ADMIN_TOKEN, body: { expires_in_hours: 8 },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.scope, 'agent');

    // (a) Agent B's request is untouched, and exactly ONE exception exists —
    // agent A's. Nothing was minted or overwritten on B's behalf.
    assert.equal(db._rows('access_requests').find((r) => r.id === b.body.id).status, 'pending');
    const exc = db._rows('access_exceptions');
    assert.equal(exc.length, 1);
    assert.equal(exc[0].scope, 'agent');
    assert.equal(exc[0].agent_key, 'agent-a');
    assert.equal(exc[0].agent_name, 'IT Help Desk Agent');

    // (b) A caller that names NO agent is not allowed: there is no host-scoped
    // grant here, only an agent-scoped one. This is the over-grant itself.
    const anon = await get(checkUrl('teams.microsoft.com'));
    assert.equal(anon.status, 200);
    assert.equal(anon.body.allowed, false);

    // (c) The approved agent is allowed, and says so as an agent grant.
    const okA = await get(checkUrl('teams.microsoft.com', '&agent_id=agent-a'));
    assert.equal(okA.body.allowed, true);
    assert.equal(okA.body.scope, 'agent');
    assert.equal(okA.body.agent_name, 'IT Help Desk Agent');
    assert.ok(okA.body.expires_at);

    // (d) The agent that was NOT approved stays blocked, by id or by name.
    assert.equal((await get(checkUrl('teams.microsoft.com', '&agent_id=agent-b'))).body.allowed, false);
    assert.equal((await get(checkUrl('teams.microsoft.com', '&agent_name=Finance%20Bot'))).body.allowed, false);

    // …and the grant does not leak to another machine, agent id notwithstanding.
    assert.equal((await get(checkUrl('teams.microsoft.com', '&agent_id=agent-a', OTHER))).body.allowed, false);
  });
});

test('approving a second agent on the same host does not overwrite the first grant', async () => {
  await withServer(async ({ post, put, get, db }) => {
    const a = await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_A });
    const b = await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_B });

    for (const id of [a.body.id, b.body.id]) {
      assert.equal((await put(`/api/v1/access-requests/${id}/approve`, {
        token: ADMIN_TOKEN, body: { expires_in_hours: 8 },
      })).status, 200);
    }

    // Two documents, not one. {machine_id, tool_host} alone made the second
    // approval a last-writer-wins update over the first.
    const exc = db._rows('access_exceptions').filter((e) => e.tool_host === 'teams.microsoft.com');
    assert.equal(exc.length, 2);
    assert.deepEqual(exc.map((e) => e.agent_key).sort(), ['agent-a', 'agent-b']);

    assert.equal((await get(checkUrl('teams.microsoft.com', '&agent_id=agent-a'))).body.allowed, true);
    assert.equal((await get(checkUrl('teams.microsoft.com', '&agent_id=agent-b'))).body.allowed, true);
    assert.equal((await get(checkUrl('teams.microsoft.com'))).body.allowed, false,
      'two agent grants are still not a grant for the whole app');
  });
});

test('a host-scoped grant allows the whole app, agent named or not', async () => {
  await withServer(async ({ get }) => {
    for (const query of ['', '&agent_id=agent-a', '&agent_name=Some%20Other%20Agent']) {
      const res = await get(checkUrl('claude.ai', query));
      assert.equal(res.body.allowed, true, `host-wide grant must cover "${query}"`);
      assert.equal(res.body.scope, 'host');
    }
  }, async (db) => {
    // No `scope` field at all — a row exactly as earlier builds wrote it.
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude', request_id: 'r1',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
  });
});

test('an agent grant with no id matches on the normalized display name', async () => {
  await withServer(async ({ get }) => {
    // The enforcer reads the name off a UI label, the extension off the DOM, so
    // case and internal whitespace differ between the two for the same agent.
    const spellings = ['IT Help Desk Agent', 'it  help   desk agent', 'IT HELP DESK AGENT '];
    for (const name of spellings) {
      const res = await get(checkUrl('teams.microsoft.com', '&agent_name=' + encodeURIComponent(name)));
      assert.equal(res.body.allowed, true, `"${name}" is the same agent`);
      assert.equal(res.body.scope, 'agent');
    }
    assert.equal((await get(checkUrl('teams.microsoft.com', '&agent_name=Finance%20Bot'))).body.allowed, false);
    assert.equal((await get(checkUrl('teams.microsoft.com'))).body.allowed, false);
  }, async (db) => {
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, ...TEAMS, request_id: 'r-agent', scope: 'agent',
      agent_id: null, agent_name: 'IT Help Desk Agent', agent_key: 'it help desk agent',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
  });
});

test("block_scope 'agent' with no agent identity is a 400, not a host-wide request", async () => {
  await withServer(async ({ post, db }) => {
    for (const body of [
      { ...AGENT_A, agent_id: null, agent_name: null },
      { ...AGENT_A, agent_id: '', agent_name: '   ' },
      { ...AGENT_A, agent_id: undefined, agent_name: undefined },
    ]) {
      const res = await post('/api/v1/access-requests', { token: desktopToken(), body });
      assert.equal(res.status, 400, 'an agent-scoped ask that names no agent grants the whole app on approval');
    }
    assert.equal(db._rows('access_requests').length, 0);
  });
});

test('an unknown block_scope is rejected instead of stored', async () => {
  await withServer(async ({ post, db }) => {
    assert.equal((await post('/api/v1/access-requests', {
      token: desktopToken(), body: { ...AGENT_A, block_scope: 'everything' },
    })).status, 400);
    assert.equal(db._rows('access_requests').length, 0);
    // The three that ARE allowed.
    for (const block_scope of ['app', 'panel', 'agent']) {
      assert.equal((await post('/api/v1/access-requests', {
        token: desktopToken(), body: { ...AGENT_A, block_scope, tool_host: block_scope + '.example.com' },
      })).status, 201);
    }
  });
});

test('agent_key is derived server-side and never taken from the body', async () => {
  await withServer(async ({ post, db }) => {
    // A client trying to name its own key: '' would be a host-wide grant.
    const res = await post('/api/v1/access-requests', {
      token: desktopToken(),
      body: { ...AGENT_A, agent_id: null, agent_name: 'IT  Help Desk  Agent', agent_key: '' },
    });
    assert.equal(res.status, 201);
    const [row] = db._rows('access_requests');
    assert.equal(row.agent_key, 'it help desk agent');
    assert.equal(row.agent_name, 'IT  Help Desk  Agent', 'the display name is stored as seen');
    assert.equal(row.block_scope, 'agent');

    // An id beats the name, verbatim — ids are not case-folded.
    assert.equal((await post('/api/v1/access-requests', {
      token: desktopToken(), body: { ...AGENT_A, agent_id: 'Agent-XYZ', tool_host: 'copilot.microsoft.com' },
    })).status, 201);
    assert.equal(db._rows('access_requests').find((r) => r.tool_host === 'copilot.microsoft.com').agent_key, 'Agent-XYZ');

    // A whole-app request has no agent key at all, even when it carries the
    // enforcer's agent_id for provenance.
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: DESKTOP_BODY })).status, 201);
    const app = db._rows('access_requests').find((r) => r.tool_host === 'claude.ai');
    assert.equal(app.block_scope, 'app');
    assert.equal(app.agent_key, '');
    assert.equal(app.agent_id, 'agent-77');
  });
});

test('a rejection for an agent-scoped request does not gag an immediate retry, or another agent', async () => {
  await withServer(async ({ post }) => {
    // Agent-scoped requests carry no rejection cooldown — the desktop dialog
    // reopens on every blocked send attempt, so a 24h gag would silently
    // swallow every later attempt. Immediate resubmission is allowed.
    const same = await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_A });
    assert.equal(same.status, 201);

    // A different agent on the same host is a different question, same as before.
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_B })).status, 201);
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-rej-agent-a', machine_id: MACHINE, hostname: 'DESKTOP-CFAI', ...TEAMS,
      status: 'rejected', surface: 'desktop', block_scope: 'agent',
      agent_id: 'agent-a', agent_name: 'IT Help Desk Agent', agent_key: 'agent-a',
      submitted_at: new Date(Date.now() - 7200000), reviewed_at: new Date(Date.now() - 3600000),
    });
  });
});

test('the hostname cooldown fallback does not apply to agent-scoped requests', async () => {
  // Body-trust path: a reinstall mints a new machine_id, so the hostname is the
  // only continuity — but agent-scoped requests carry no rejection cooldown at
  // all now, on either identity path.
  await withServer(async ({ post }) => {
    assert.equal((await post('/api/v1/access-requests', {
      body: { machine_id: 'mach-ext-new', hostname: 'LAPTOP-1', ...TEAMS,
        block_scope: 'agent', agent_id: 'agent-a', agent_name: 'IT Help Desk Agent' },
    })).status, 201);
    assert.equal((await post('/api/v1/access-requests', {
      body: { machine_id: 'mach-ext-new', hostname: 'LAPTOP-1', ...TEAMS,
        block_scope: 'agent', agent_id: 'agent-b', agent_name: 'Finance Bot' },
    })).status, 201);
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-ext-rej-a', machine_id: 'mach-ext-old', hostname: 'LAPTOP-1', ...TEAMS,
      status: 'rejected', block_scope: 'agent', agent_id: 'agent-a',
      agent_name: 'IT Help Desk Agent', agent_key: 'agent-a',
      submitted_at: new Date(Date.now() - 7200000), reviewed_at: new Date(Date.now() - 3600000),
    });
  });
});

test('/access-requests/mine carries the agent identity so the client can pre-check per agent', async () => {
  await withServer(async ({ post, get }) => {
    await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_A });
    const res = await get('/api/v1/access-requests/mine', { token: desktopToken() });
    assert.equal(res.status, 200);
    assert.equal(res.body[0].block_scope, 'agent');
    assert.equal(res.body[0].agent_id, 'agent-a');
    assert.equal(res.body[0].agent_name, 'IT Help Desk Agent');
    // agent_key is an internal match key; it is not part of the client contract.
    assert.equal('agent_key' in res.body[0], false);
  });
});

test('the admin exception list carries the scope and agent for the AI Hub', async () => {
  await withServer(async ({ get }) => {
    const res = await get('/api/v1/access-exceptions', { token: ADMIN_TOKEN });
    assert.equal(res.status, 200);
    const byHost = Object.fromEntries(res.body.map((r) => [r.tool_host, r]));

    assert.equal(byHost['teams.microsoft.com'].scope, 'agent');
    assert.equal(byHost['teams.microsoft.com'].agent_id, 'agent-a');
    assert.equal(byHost['teams.microsoft.com'].agent_name, 'IT Help Desk Agent');

    // A row from before agent scoping: defaulted, never undefined.
    assert.equal(byHost['claude.ai'].scope, 'host');
    assert.equal(byHost['claude.ai'].agent_id, null);
    assert.equal(byHost['claude.ai'].agent_name, null);
    // Existing fields are unchanged.
    assert.equal(byHost['claude.ai'].machine_id, MACHINE);
    assert.equal(byHost['claude.ai'].tool_name, 'Claude');
  }, async (db) => {
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, ...TEAMS, request_id: 'r-agent', scope: 'agent',
      agent_id: 'agent-a', agent_name: 'IT Help Desk Agent', agent_key: 'agent-a',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude', request_id: 'r1',
      active: true, expires_at: new Date(Date.now() + 8 * 3600000),
    });
  });
});

test('a host-wide approval still lands on the exception row an older build created', async () => {
  // The legacy row has no agent_key field, so a bare `agent_key: ''` filter would
  // miss it and mint a SECOND host exception for the same host.
  await withServer(async ({ put, db }) => {
    assert.equal(db._rows('access_exceptions').length, 1);
    assert.equal((await put('/api/v1/access-requests/req-legacy/approve', {
      token: ADMIN_TOKEN, body: { expires_in_hours: 8 },
    })).status, 200);

    const exc = db._rows('access_exceptions');
    assert.equal(exc.length, 1, 'the pre-existing host row is updated, not duplicated');
    assert.equal(exc[0].scope, 'host');
    assert.equal(exc[0].agent_key, '');
    assert.equal(exc[0].request_id, 'req-legacy');
  }, async (db) => {
    await db.collection('access_requests').insertOne({
      id: 'req-legacy', machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude',
      status: 'pending', surface: 'browser', submitted_at: new Date(Date.now() - 3600000),
    });
    await db.collection('access_exceptions').insertOne({
      machine_id: MACHINE, tool_host: 'claude.ai', tool_name: 'Claude', request_id: 'r-old',
      active: true, expires_at: new Date(Date.now() - 3600000),
    });
  });
});

// ── Cross-surface: the same person's desktop agent and browser extension ────

test('an exception granted to the desktop machine is visible to the same person\'s browser extension', async () => {
  await withServer(async ({ post, put, get }) => {
    assert.equal((await post('/api/v1/access-requests', { token: desktopToken(), body: AGENT_A })).status, 201);
    const [pending] = (await get('/api/v1/access-requests/mine', { token: desktopToken() })).body;
    assert.equal((await put(`/api/v1/access-requests/${pending.id}/approve`, {
      token: ADMIN_TOKEN, body: { expires_in_hours: 8 },
    })).status, 200);

    // MACHINE requested and was approved — sees it, unsurprisingly.
    const mine = await get('/api/v1/access-exceptions/mine', { token: desktopToken() });
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].agent_id, 'agent-a');

    // OTHER is a different machine_id (the browser extension's own enrolment)
    // but the identity scanner already linked it to the same person as MACHINE
    // — the exception must be visible there too, not just on the exact machine
    // that filed the request.
    const browserSide = await get('/api/v1/access-exceptions/mine', { token: desktopToken(OTHER, 'LAPTOP-BROWSER') });
    assert.equal(browserSide.body.length, 1, 'same person, different surface — must see the grant');
    assert.equal(browserSide.body[0].agent_id, 'agent-a');
    assert.equal(browserSide.body[0].scope, 'agent');

    // A third, UNLINKED machine must see nothing — this is not a fleet-wide
    // bypass, only a same-person one.
    const stranger = await get('/api/v1/access-exceptions/mine', { token: desktopToken('mach-unrelated', 'SOMEONE-ELSES-PC') });
    assert.equal(stranger.body.length, 0, 'an unlinked machine gets no grant it did not earn');
  }, async (db) => {
    await db.collection('employee_profiles').insertOne({
      display_name: 'Pravallika', machine_ids: [MACHINE, OTHER],
    });
  });
});
