// The WRITE side of the agent blocklist: who may call it, and what shapes it accepts.
//
// TWO FINDINGS FROM THE SECURITY REVIEW OF THE M365 PER-AGENT BLOCKING WORK, and
// both are about the same four routes — the ones that can block or unblock an AI
// system for the whole organisation.
//
// 1. THEY WERE UNAUTHENTICATED. POST /api/lifecycle/block, POST
//    /api/lifecycle/unblock, PUT /api/v1/registry/:id/status and PATCH
//    /api/v1/ai-platforms/:host all wrote enforcement state with no credential.
//    In a governance product that is the whole ballgame: an unauthenticated
//    caller could lift every block in the org, or — through the Microsoft 365
//    Copilot host cascade the last two reach — block Teams, Outlook and
//    SharePoint for everyone with a single request.
//
// 2. `agent_id` WAS CHECKED FOR TRUTHINESS, NOT TYPE. express.json() returns
//    whatever JSON shape arrived, so `{"agent_id": {"$ne": null}}` passed
//    `if (!agent_id)` and reached `updateOne({ agent_id }, …)`, where Mongo reads
//    it as a QUERY OPERATOR rather than a value — matching, and overwriting, an
//    unrelated agent's row.
//
// The READS stay open and are asserted so here too, because closing them is the
// tempting over-correction: the browser extension and the desktop agent poll
// GET /blocked-agents, GET /governed-agents, GET /ai-surfaces and GET
// /ai-platforms with no token at all, and gating any of them would silently stop
// enforcement everywhere rather than tighten it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mountRegistry } from '../src/routes/registry.js';
import { mountAiPlatforms } from '../src/routes/ai-platforms.js';
import { badBlockField } from '../src/governance/routes/lifecycle.ts';
import { createFakeDb } from './helpers/fake-db.mjs';
import { adminJsonHeaders, TEST_ADMIN_TOKEN } from './helpers/admin-auth.mjs';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same guard registry-agent-block.test.mjs uses: a live registry build rewrites
// data/registry-snapshot.json, and a fixture must not overwrite the curated
// capture that is the Inventory tab's fallback.
process.env.REGISTRY_SNAPSHOT_PATH = join(
  mkdtempSync(join(tmpdir(), 'cfai-blocklist-auth-')), 'registry-snapshot.json',
);

async function withServer(mount, seed, fn) {
  const db = createFakeDb();
  if (seed) await seed(db);
  const app = express();
  app.use(express.json());
  mount(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    return await fn({ db, base: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── PUT /api/v1/registry/:id/status ─────────────────────────────────────────

const seedAgent = (db) => db.collection('discovered_agents').insertOne({
  id: 'agent-1', name: 'Enterprise Agent', platform: 'copilot_studio', lifecycleStatus: 'active',
});

const putStatus = (base, headers) => fetch(`${base}/api/v1/registry/agent-1/status`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({ status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' }),
});

test('PUT /registry/:id/status refuses an unauthenticated caller and writes nothing', async () => {
  await withServer(mountRegistry, seedAgent, async ({ db, base }) => {
    const res = await putStatus(base, { 'content-type': 'application/json' });
    assert.equal(res.status, 401, 'the widest write in the product answered without a credential');
    // The refusal has to happen BEFORE the write, not after it — a 401 on a
    // request that already suspended the agent would be worse than no gate.
    assert.equal(db._rows('blocked_agents').length, 0, 'an unauthenticated PUT still wrote a block row');
    assert.equal(db._rows('sanctions').length, 0, 'an unauthenticated PUT still wrote a sanction');
    assert.equal(db._rows('discovered_agents')[0].lifecycleStatus, 'active',
      'an unauthenticated PUT still suspended the agent');
  });
});

test('a wrong bearer token is refused as firmly as no token at all', async () => {
  await withServer(mountRegistry, seedAgent, async ({ db, base }) => {
    const res = await putStatus(base, adminJsonHeaders({ authorization: 'Bearer not-the-admin-token' }));
    assert.equal(res.status, 401);
    assert.equal(db._rows('blocked_agents').length, 0);
  });
});

test('the admin credential still gets through — the gate is not a wall', async () => {
  await withServer(mountRegistry, seedAgent, async ({ db, base }) => {
    const res = await putStatus(base, adminJsonHeaders());
    assert.equal(res.status, 200, await res.text());
    assert.equal(db._rows('blocked_agents').length, 1, 'the authorised block did not land');
  });
});

test('the registry READS stay open — the extension and agent poll them with no token', async () => {
  await withServer(mountRegistry, seedAgent, async ({ base }) => {
    for (const path of ['/api/v1/registry', '/api/v1/registry/summary']) {
      const res = await fetch(`${base}${path}`);
      assert.notEqual(res.status, 401, `${path} now demands a credential no poller has`);
    }
  });
});

// ── PATCH /api/v1/ai-platforms/:host ────────────────────────────────────────
//
// Gated for the same reason, and not optional: `blocked` on this route reaches
// the SAME Microsoft 365 Copilot host cascade the registry route does, so gating
// only the registry route would have left the whole cascade reachable anyway.

const seedOffice = (db) => db.collection('ai_platforms').insertOne({
  host: 'office.com', vendor: 'Microsoft', product: 'Microsoft 365 Copilot', blocked: 0,
});

test('PATCH /ai-platforms/:host refuses an unauthenticated caller and cascades nothing', async () => {
  await withServer(mountAiPlatforms, seedOffice, async ({ db, base }) => {
    const res = await fetch(`${base}/api/v1/ai-platforms/office.com`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(res.status, 401);
    assert.equal(db._rows('ai_platforms').length, 1,
      'the M365 host cascade ran for an unauthenticated caller');
    assert.equal(db._rows('ai_platforms')[0].blocked, 0, 'office.com was blocked without a credential');
  });
});

test('PATCH /ai-platforms/:host works with the admin credential', async () => {
  await withServer(mountAiPlatforms, seedOffice, async ({ db, base }) => {
    const res = await fetch(`${base}/api/v1/ai-platforms/office.com`, {
      method: 'PATCH',
      headers: adminJsonHeaders(),
      body: JSON.stringify({ blocked: true }),
    });
    assert.equal(res.status, 200, await res.text());
    assert.equal(db._rows('ai_platforms').find((r) => r.host === 'office.com').blocked, 1);
  });
});

test('the ai-platforms READS stay open — the extension polls ?surface=browser unauthenticated', async () => {
  await withServer(mountAiPlatforms, seedOffice, async ({ base }) => {
    for (const path of ['/api/v1/ai-platforms', '/api/v1/ai-platforms?surface=browser', '/api/v1/ai-platforms/office.com']) {
      const res = await fetch(`${base}${path}`);
      assert.notEqual(res.status, 401, `${path} now demands a credential the extension does not have`);
    }
  });
});

// ── POST /api/lifecycle/block + /unblock ────────────────────────────────────
//
// This router resolves its Mongo handle through getDb() at request time, so it
// cannot be mounted against the in-memory fake the way the two above can (same
// limitation agent-scope.test.mjs and registry-agent-block.test.mjs work around).
// The middleware is therefore pinned in the SOURCE, and the body check — which is
// a pure function — is tested for real just below.

const lifecycleSrc = () => readFile(join(SERVER_DIR, 'src', 'governance', 'routes', 'lifecycle.ts'), 'utf8');

test('the two lifecycle WRITES carry requireAdminAuth and the READS do not', async () => {
  const src = await lifecycleSrc();
  // The same middleware the SDK, replay, conversation and feature-settings routes
  // use — one admin credential in the product, not a second mechanism.
  assert.match(src, /import \{ requireAdminAuth \} from "\.\.\/\.\.\/auth\.js";/);
  assert.match(src, /router\.post\("\/block", requireAdminAuth, async \(req, res\) => \{/);
  assert.match(src, /router\.post\("\/unblock", requireAdminAuth, async \(req, res\) => \{/);
  // …and the polled reads stay open. The desktop agent's blocked-agents-sync and
  // the extension both fetch these with no Authorization header; gating them
  // would not tighten anything, it would disable enforcement fleet-wide.
  assert.match(src, /router\.get\("\/blocked-agents", async \(_req, res\) => \{/);
  assert.match(src, /router\.get\("\/governed-agents", async \(_req, res\) => \{/);
});

test('/block type-checks the body before anything reaches a Mongo filter', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.post("/block"'), src.indexOf('router.post("/unblock"'));
  assert.ok(route.length > 0, 'expected a POST /block body');
  assert.match(route, /const badField = badBlockField\(req\.body\);/);
  // Before the write, before the derivation. Either one reached with an object
  // is the injection itself.
  const checkAt = route.indexOf('const badField = badBlockField(req.body);');
  // Anchored on the CALL, not the word — the comment above the check names
  // derivePlatform too, and matching that would pass no matter where the check is.
  assert.ok(checkAt < route.indexOf('await derivePlatform(db, {'),
    'the body is checked after derivePlatform builds its $or');
  assert.ok(checkAt < route.indexOf('collection("blocked_agents").updateOne'),
    'the body is checked after the row has already been written');
  // The old truthiness-only gate must not survive alongside it.
  assert.equal(/if \(!agent_id\) \{/.test(route), false,
    'the truthiness-only agent_id check is still here — an object still passes it');
});

// ── The check itself ────────────────────────────────────────────────────────

test('badBlockField refuses every non-string agent_id, operator objects included', () => {
  // The exact payload from the review: a Mongo query operator in the position the
  // route uses as a FILTER. `{$ne: null}` matches the first row whose agent_id is
  // not null, so the upsert lands on an unrelated agent's block.
  assert.equal(badBlockField({ agent_id: { $ne: null } }), 'agent_id');
  assert.equal(badBlockField({ agent_id: { $gt: '' } }), 'agent_id');
  assert.equal(badBlockField({ agent_id: { $regex: '.*' } }), 'agent_id');
  assert.equal(badBlockField({ agent_id: ['a', 'b'] }), 'agent_id');
  for (const bad of [undefined, null, 0, 1, true, false, {}, []]) {
    assert.equal(badBlockField({ agent_id: bad }), 'agent_id', JSON.stringify(bad) ?? 'undefined');
  }
  // …and the empty-string rejection the old truthiness check gave us is kept.
  assert.equal(badBlockField({ agent_id: '' }), 'agent_id');
  assert.equal(badBlockField({ agent_id: '   ' }), 'agent_id');
  assert.equal(badBlockField(undefined), 'agent_id');
  assert.equal(badBlockField(null), 'agent_id');
});

test('badBlockField refuses a non-string in any of the four optional fields', () => {
  for (const field of ['agent_name', 'platform', 'reason', 'oauth_key_id']) {
    assert.equal(badBlockField({ agent_id: 'a', [field]: { $ne: null } }), field);
    assert.equal(badBlockField({ agent_id: 'a', [field]: 42 }), field);
    assert.equal(badBlockField({ agent_id: 'a', [field]: ['x'] }), field);
  }
  // `platform` matters beyond the stored row: it is handed to normalizePlatform
  // and, when absent, decides whether derivePlatform runs at all.
  assert.equal(badBlockField({ agent_id: 'a', platform: { $exists: true } }), 'platform');
});

test('badBlockField accepts the bodies real callers send', () => {
  assert.equal(badBlockField({ agent_id: 'agent-1' }), null);
  assert.equal(badBlockField({
    agent_id: 'agent-1', agent_name: 'AI Learning Advisor', platform: 'personal_agent',
    reason: 'Blocked by admin', oauth_key_id: 'key-1', agent_scope: 'agent',
  }), null);
  // Omitted and explicitly-null optionals are both fine — the write path already
  // normalises them to null, and refusing null would break the dashboard, which
  // sends it.
  for (const field of ['agent_name', 'platform', 'reason', 'oauth_key_id']) {
    assert.equal(badBlockField({ agent_id: 'agent-1', [field]: null }), null, field);
    assert.equal(badBlockField({ agent_id: 'agent-1', [field]: undefined }), null, field);
  }
  // agent_scope is deliberately NOT checked here: it has its own validator
  // (normalizeAgentScope), which refuses a non-string by returning undefined and
  // is already asserted in agent-scope.test.mjs.
  assert.equal(badBlockField({ agent_id: 'agent-1', agent_scope: { $ne: null } }), null);
});

test('/unblock gets the identical agent_id check, not a weaker one', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.post("/unblock"'), src.indexOf('router.get("/blocked-agents"'));
  assert.ok(route.length > 0, 'expected a POST /unblock body');
  // Lifting a block through an operator object would have set blocked:false on
  // somebody else's row — the same hole, pointed the other way.
  assert.match(route, /typeof agent_id !== "string" \|\| agent_id\.trim\(\)\.length === 0/);
  assert.equal(/if \(!agent_id\) \{/.test(route), false,
    'the truthiness-only check is still here — an operator object still lifts an unrelated block');
});

// The credential itself: asserted so a future change to auth.js's default cannot
// quietly make every test above pass for the wrong reason.
test('the test credential is the token the middleware actually compares against', async () => {
  const { ADMIN_TOKEN } = await import('../src/auth.js');
  assert.equal(TEST_ADMIN_TOKEN, ADMIN_TOKEN,
    'helpers/admin-auth.mjs sends a token the server does not accept — the 200s above prove nothing');
});
