// `blocked_agents.agent_scope` — how WIDE a block row is.
//
// THE AMBIGUITY THIS RESOLVES. A blocked_agents row has always named one specific
// agent ({ agent_name: "AI Learning Advisor", platform: "personal_agent" }), but
// the desktop enforcer matched that row against the whole PROCESS set the
// platform maps to (PLATFORM_PROCS: personal_agent → Copilot, M365Copilot) and
// used agent_name only as display text. So blocking one agent disabled the entire
// Microsoft 365 Copilot app — generic Copilot chat and every other agent in it
// included.
//
// agent_scope is the row's own statement of intent:
//   'platform' / absent / null — the whole process is blocked (today's behaviour)
//   'agent'                    — narrow to the ONE agent in agent_name
//
// The enforcer still falls back to the whole-app block when it cannot tell which
// agent is open, so 'agent' is a request rather than a guarantee — but a row that
// never carries the field can never be narrowed at all, which is why this is
// tested on the write path AND the read projection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeAgentScope, AGENT_SCOPES } from '../src/governance/agent-scope.js';
import { mountRegistry } from '../src/routes/registry.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── The validator, which is what POST /api/lifecycle/block gates on ──────────

test('normalizeAgentScope accepts the enum and defaults an absent value to null', () => {
  assert.deepEqual([...AGENT_SCOPES], ['agent', 'platform']);
  assert.equal(normalizeAgentScope('agent'), 'agent');
  assert.equal(normalizeAgentScope('platform'), 'platform');
  // Trimmed and lower-cased, so a UI that sends " Agent " is not silently
  // widened to platform scope.
  assert.equal(normalizeAgentScope(' AGENT '), 'agent');
  assert.equal(normalizeAgentScope('Platform'), 'platform');
  // Absent / null / empty is the DEFAULT, and the default is today's behaviour.
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(normalizeAgentScope(value), null, JSON.stringify(value));
  }
});

test('normalizeAgentScope REFUSES an unrecognised value rather than coercing it', () => {
  // Neither default is safe for a typo. Defaulting to platform-wide would look
  // like the admin's narrowing had been applied while the block stayed as coarse
  // as before; defaulting to 'agent' would silently narrow a block an admin meant
  // to be app-wide. undefined is the caller's signal to answer 400.
  for (const value of ['agents', 'app', 'panel', 'everything', 'AGENT_SCOPE', 0, 1, true, {}, [], ['agent']]) {
    assert.equal(normalizeAgentScope(value), undefined, JSON.stringify(value));
  }
});

// ── POST /api/lifecycle/block + GET /api/lifecycle/blocked-agents ────────────
//
// The governance router resolves its Mongo handle through getDb() at request
// time rather than taking an injected db, so it cannot be mounted against the
// in-memory fake the way mountRegistry() can. These assertions therefore pin the
// route's SOURCE — the same convention agent/tests uses for enforcer-win.ps1 —
// while the validator above is covered behaviourally and registry.js's write path
// is covered end to end below.

const lifecycleSrc = () => readFile(join(SERVER_DIR, 'src', 'governance', 'routes', 'lifecycle.ts'), 'utf8');

test('POST /lifecycle/block accepts agent_scope, validates it, and persists it', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.post("/block"'), src.indexOf('router.post("/unblock"'));
  assert.ok(route.length > 0, 'expected a POST /block body');
  // Read off the body …
  assert.match(route, /const \{ agent_id, agent_name, platform, reason, oauth_key_id, agent_scope \} = req\.body;/);
  // … validated through the one shared definition, never re-implemented here …
  assert.match(route, /const scope = normalizeAgentScope\(agent_scope\);/);
  assert.match(src, /import \{ normalizeAgentScope \} from "\.\.\/agent-scope\.js";/);
  // … an unrecognised value is a 400, not a silent default …
  assert.match(route, /if \(scope === undefined\) \{[\s\S]{0,240}?res\.status\(400\)/);
  assert.match(route, /agent_scope must be 'agent', 'platform', or omitted/);
  // … and the validation happens BEFORE the write, so no bad row can be stored.
  assert.ok(route.indexOf('const scope =') < route.indexOf('blocked_agents'),
    'agent_scope must be validated before the row is written');
  // Persisted on the row, from the normalised value rather than the raw body.
  assert.match(route, /agent_scope: scope,/);
  assert.equal(/agent_scope: agent_scope/.test(route), false, 'the raw body value must not be stored');
});

test('GET /lifecycle/blocked-agents returns agent_scope in its projection', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.get("/blocked-agents"'));
  assert.ok(route.length > 0, 'expected a GET /blocked-agents body');
  // This payload IS what the desktop agent builds blocked-agents.json from. A row
  // whose scope never reaches the enforcer is a row that silently blocks the
  // whole app, so the field is enforcement input, not metadata.
  assert.match(route, /\.project\(\{[^}]*agent_scope: 1[^}]*\}\)/);
  // The list is still not filtered — dropping a row here would lift a block an
  // admin deliberately applied.
  assert.match(route, /\.find\(\{ blocked: true \}\)/);
});

// ── PUT /api/v1/registry/:id/status — the individual-agent block path ────────

async function withServer(seed, fn) {
  const db = createFakeDb();
  if (seed) await seed(db);
  const app = express();
  app.use(express.json());
  mountRegistry(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      db,
      async setStatus(id, body) {
        const res = await fetch(`${base}/api/v1/registry/${encodeURIComponent(id)}/status`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        assert.equal(res.status, 200, `PUT status → ${res.status}: ${JSON.stringify(json)}`);
        return json;
      },
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const AGENT_ID = '124794af-3b8f-f111-b8da-0022480b1f83';
const seedAgent = async (db) => {
  await db.collection('discovered_agents').insertOne({
    id: AGENT_ID, name: 'Enterprise Agent', platform: 'personal_agent', lifecycleStatus: 'active',
  });
};

test("the registry's individual-agent block path always writes agent_scope:'agent'", async () => {
  // By construction of the looksLikeAgent guard, everything reaching this write
  // IS an individual agent — a named agent inside someone else's app, with no
  // host of its own — so "block the whole app it lives in" was never what the
  // admin asked for. Unconditional, because there is no case on this path where
  // the row means anything else.
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent',
      category: 'autonomous-agent', source: 'governance', platform: 'personal_agent',
    });
    const [row] = db._rows('blocked_agents');
    assert.equal(row.agent_scope, 'agent');
    assert.equal(row.agent_name, 'Enterprise Agent');
    assert.equal(row.platform, 'personal_agent');
  });
});

test("agent_scope:'agent' is written even when the caller sends no category or platform", async () => {
  // The scope must not depend on optional request fields: the agent is recognised
  // from discovered_agents, and the row's scope follows from the PATH, not the
  // payload.
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent' });
    assert.equal(db._rows('blocked_agents')[0].agent_scope, 'agent');
  });

  // Including for an agent that no longer appears in any scan — a block must
  // outlive the connection that discovered it, scope included.
  await withServer(null, async ({ db, setStatus }) => {
    await setStatus('orphan-agent-id', {
      status: 'blocked', product_name: 'Ghost Agent', category: 'autonomous-agent',
    });
    assert.equal(db._rows('blocked_agents')[0].agent_scope, 'agent');
  });
});

test('a plain PLATFORM block still writes no blocklist row at all, so no scope either', async () => {
  // A platform is host-keyed and enforced through ai_platforms. Mirroring it into
  // the agent blocklist — with any scope — would have the extension matching a
  // product name against page headers, which is not what that list is for.
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({ host: 'poe.com', product: 'Poe', blocked: 0 });
  }, async ({ db, setStatus }) => {
    await setStatus('poe.com', { status: 'blocked', product_name: 'Poe', matched_hosts: ['poe.com'] });
    assert.equal(db._rows('blocked_agents').length, 0, 'a platform block leaked into the agent blocklist');
    assert.equal(db._rows('ai_platforms')[0].blocked, 1);
  });
});

test('un-blocking relaxes the row without touching its scope', async () => {
  // /unblock sets blocked:false and keeps the audit row. Re-writing or clearing
  // agent_scope on that path would quietly change what a later re-block means.
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    await setStatus(AGENT_ID, { status: 'approved', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    const [row] = db._rows('blocked_agents');
    assert.equal(row.blocked, false);
    assert.equal(row.agent_scope, 'agent', 'the scope must survive an unblock');
  });
});
