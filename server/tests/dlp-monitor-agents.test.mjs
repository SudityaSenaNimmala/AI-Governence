// `blocked_agents.dlp_monitor` — the governed-but-NOT-blocked state.
//
// WHY A THIRD STATE EXISTS. Until now a `blocked_agents` row could only say
// "blocked" or nothing. Microsoft Teams fits neither: it is a host app for
// ordinary human chat, so the desktop enforcer excludes it from capture
// wholesale, and when a named agent inside it IS blocked, tokenization is
// deliberately disabled (masking one value does not help when the whole
// conversation is disallowed — Request Access is the remedy). `dlp_monitor` is
// the missing middle: scan prompts for this named agent and offer
// "Tokenize & Send", while letting the conversation happen.
//
// The two flags are INDEPENDENT, and where both are set BLOCKED WINS. That
// precedence is applied agent-side, but it is also enforced at the data level
// here — GET /governed-agents must never offer a blocked agent as merely
// governed, so the two lists stay honestly disjoint and no consumer has to
// remember the rule in order to be safe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  GOVERNED_AGENTS_FILTER,
  GOVERNED_AGENTS_PROJECTION,
  normalizeDlpMonitor,
  setDlpMonitor,
  listGovernedAgents,
} from '../src/governance/dlp-monitor.js';
import { mountRegistry } from '../src/routes/registry.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const lifecycleSrc = () => readFile(join(SERVER_DIR, 'src', 'governance', 'routes', 'lifecycle.ts'), 'utf8');

// ── The flag validator ───────────────────────────────────────────────────────

test('normalizeDlpMonitor takes booleans only and REFUSES everything else', () => {
  assert.equal(normalizeDlpMonitor(true), true);
  assert.equal(normalizeDlpMonitor(false), false);
  // No default either way. An absent flag defaulting to true would let an empty
  // body start monitoring an agent nobody asked to monitor; defaulting to false
  // would let a typo silently stop monitoring one. undefined is the caller's
  // signal to answer 400 — the same stance normalizeAgentScope takes.
  for (const value of [undefined, null, '', 'true', 'false', 0, 1, 'yes', {}, []]) {
    assert.equal(normalizeDlpMonitor(value), undefined, JSON.stringify(value) ?? 'undefined');
  }
});

// ── The read model: GET /api/lifecycle/governed-agents ───────────────────────

const seedRow = (db, row) => db.collection('blocked_agents').insertOne(row);

test('governed-agents returns rows flagged dlp_monitor and NOT blocked', async () => {
  const db = createFakeDb();
  await seedRow(db, { agent_id: 'a1', agent_name: 'HR Assistant', platform: 'teams_chat_agent', agent_scope: 'agent', dlp_monitor: true, blocked: false });
  // A row that never carried the field at all — every pre-existing row looks like
  // this, and absence must read as false rather than as "unset, so include it".
  await seedRow(db, { agent_id: 'a2', agent_name: 'Legacy Row', blocked: false });
  // Monitoring explicitly turned back off.
  await seedRow(db, { agent_id: 'a3', agent_name: 'Was Monitored', dlp_monitor: false, blocked: false });
  // A plain block, untouched by any of this.
  await seedRow(db, { agent_id: 'a4', agent_name: 'Blocked Agent', blocked: true });

  const list = await listGovernedAgents(db);
  assert.deepEqual(list.map((a) => a.agent_id), ['a1']);
  // The flag is returned RAW rather than implied by list membership, so the
  // agent-side blocked-wins rule has the actual field to reason about.
  assert.equal(list[0].dlp_monitor, true);
  assert.equal(list[0].agent_scope, 'agent');
});

test('a row that is BOTH dlp_monitor and blocked is excluded — blocked wins at the data level', async () => {
  const db = createFakeDb();
  await seedRow(db, { agent_id: 'both', agent_name: 'Escalated Agent', dlp_monitor: true, blocked: true });
  assert.deepEqual(await listGovernedAgents(db), [],
    'a blocked agent must never be offered as merely governed');

  // …and it is still on the blocked list, which is the point: escalating a
  // monitored agent to blocked moves it between the two lists rather than
  // putting it on both.
  const blocked = await db.collection('blocked_agents').find({ blocked: true }).toArray();
  assert.deepEqual(blocked.map((b) => b.agent_id), ['both']);
});

test('a governed row with no `blocked` field at all is included', async () => {
  // The filter is `blocked: { $ne: true }`, not `blocked: false`, precisely so a
  // row created by the dlp-monitor toggle for an agent that was never blocked is
  // not excluded by a field it has no reason to carry.
  const db = createFakeDb();
  await seedRow(db, { agent_id: 'fresh', agent_name: 'Never Blocked', dlp_monitor: true });
  assert.deepEqual((await listGovernedAgents(db)).map((a) => a.agent_id), ['fresh']);
  assert.deepEqual(GOVERNED_AGENTS_FILTER, { dlp_monitor: true, blocked: { $ne: true } });
});

test('governed agents are FLAGGED orphaned when no scan still shows them, never dropped', async () => {
  // Same rule as /blocked-agents: filtering the list here would silently lift a
  // governance decision an admin deliberately made.
  const db = createFakeDb();
  await seedRow(db, { agent_id: 'live', agent_name: 'Live Agent', dlp_monitor: true });
  await seedRow(db, { agent_id: 'gone', agent_name: 'Ghost Agent', dlp_monitor: true });
  await db.collection('discovered_agents').insertOne({ id: 'live', name: 'Live Agent' });

  const byId = Object.fromEntries((await listGovernedAgents(db)).map((a) => [a.agent_id, a]));
  assert.equal(Object.keys(byId).length, 2);
  assert.equal(byId.live.orphaned, false);
  assert.equal(byId.gone.orphaned, true);
});

test('the projection mirrors /blocked-agents field for field, minus blocked_at', async () => {
  // A client that already parses the blocked-agents payload must be able to parse
  // this one with the same code, so the identity and ENFORCEMENT fields
  // (agent_scope above all — it is what stops a row governing a whole host app)
  // are carried over unchanged.
  const src = await lifecycleSrc();
  const blockedRoute = src.slice(src.indexOf('router.get("/blocked-agents"'), src.indexOf('router.post("/dlp-monitor"'));
  // The FIRST projection in that route — the payload itself. The second one
  // belongs to the discovered_agents orphan lookup and is not part of the shape.
  const blockedProjection = blockedRoute.match(/\.project\(\{([^}]*)\}\)/)[1];
  const blockedFields = [...blockedProjection.matchAll(/(\w+): 1/g)].map((m) => m[1]);
  const governedFields = Object.keys(GOVERNED_AGENTS_PROJECTION).filter((k) => k !== '_id');

  for (const field of blockedFields) {
    if (field === 'blocked_at') continue;
    assert.ok(governedFields.includes(field), `/governed-agents must also project ${field}`);
  }
  // blocked_at is the one field deliberately dropped: every row in this list is
  // by construction NOT blocked, and a leftover timestamp from a since-lifted
  // block would read as "blocked since then".
  assert.equal(governedFields.includes('blocked_at'), false);
  assert.deepEqual(governedFields, [
    'agent_id', 'agent_name', 'platform', 'reason', 'oauth_key_id', 'agent_scope',
    'dlp_monitor', 'dlp_monitor_at',
  ]);
  assert.equal(GOVERNED_AGENTS_PROJECTION._id, 0);
});

// ── The write path: the admin toggle ─────────────────────────────────────────

test('the toggle sets dlp_monitor without touching the row\'s blocked state', async () => {
  const db = createFakeDb();
  await seedRow(db, { agent_id: 'x', agent_name: 'Contract Bot', platform: 'teams_chat_agent', agent_scope: 'agent', blocked: false, unblocked_at: new Date('2026-01-01') });

  await setDlpMonitor(db, { agent_id: 'x', dlp_monitor: true });
  const [row] = db._rows('blocked_agents');
  assert.equal(row.dlp_monitor, true);
  assert.ok(row.dlp_monitor_at instanceof Date);
  assert.equal(row.blocked, false, 'monitoring must not change whether an agent is blocked');
  // Identity the caller did not supply is left alone rather than blanked — this
  // is a narrow toggle, not a rewrite of the row.
  assert.equal(row.agent_name, 'Contract Bot');
  assert.equal(row.platform, 'teams_chat_agent');
  assert.equal(row.agent_scope, 'agent');

  await setDlpMonitor(db, { agent_id: 'x', dlp_monitor: false });
  assert.equal(db._rows('blocked_agents')[0].dlp_monitor, false);
  assert.equal(db._rows('blocked_agents')[0].blocked, false);
});

test('the toggle can mark an agent that is ALREADY blocked, and vice versa', async () => {
  // The two flags are independent even though they share a row. Marking a blocked
  // agent for monitoring is allowed and recorded — the list route is what keeps
  // the lists disjoint, not the write path, so the flag survives a later unblock.
  const db = createFakeDb();
  await seedRow(db, { agent_id: 'b', agent_name: 'Blocked One', blocked: true, blocked_at: new Date('2026-02-02') });
  await setDlpMonitor(db, { agent_id: 'b', dlp_monitor: true });
  const [row] = db._rows('blocked_agents');
  assert.equal(row.blocked, true, 'the block must survive the monitoring toggle');
  assert.equal(row.dlp_monitor, true);
  assert.deepEqual(await listGovernedAgents(db), [], 'still excluded while blocked');
});

test('enabling UPSERTS, so an agent only ever seen in discovered_agents can be governed', async () => {
  // The connect-ui picker seeds from real discovered agents, and an agent an
  // admin wants monitored has usually never been blocked, so it has no
  // blocked_agents row at all. Requiring one first would make the
  // governed-not-blocked state unreachable. Mirrors POST /lifecycle/block, which
  // upserts for exactly the same reason.
  const db = createFakeDb();
  await db.collection('discovered_agents').insertOne({ id: 'new-agent', name: 'Copilot Studio HR Bot', platform: 'copilot_studio' });
  assert.equal(db._rows('blocked_agents').length, 0);

  const result = await setDlpMonitor(db, {
    agent_id: 'new-agent', dlp_monitor: true,
    agent_name: 'Copilot Studio HR Bot', platform: 'copilot_studio', agent_scope: 'agent',
  });
  assert.equal(result.created, true);
  const [row] = db._rows('blocked_agents');
  assert.equal(row.dlp_monitor, true);
  assert.equal(row.agent_name, 'Copilot Studio HR Bot');
  assert.equal(row.agent_scope, 'agent');
  // A row this toggle brings into existence is explicitly NOT blocked, rather
  // than merely missing the field.
  assert.equal(row.blocked, false);
  assert.deepEqual((await listGovernedAgents(db)).map((a) => a.agent_id), ['new-agent']);
});

test('disabling never creates a row', async () => {
  // Mirrors /unblock, which only ever relaxes an existing row. A row asserting
  // that an agent is not monitored says nothing that its absence does not.
  const db = createFakeDb();
  const result = await setDlpMonitor(db, { agent_id: 'unknown-agent', dlp_monitor: false });
  assert.equal(db._rows('blocked_agents').length, 0);
  assert.equal(result.created, false);
  assert.equal(result.matched, 0, 'the caller is told nothing matched rather than being told ok');
});

// ── The other direction: blocking must not clear dlp_monitor ─────────────────

async function withRegistry(seed, fn) {
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

test('blocking and unblocking an agent leave dlp_monitor exactly as it was', async () => {
  // The registry's block mirror and POST /lifecycle/block both write fixed field
  // lists that do not mention dlp_monitor, so an admin who blocks a monitored
  // agent and later lifts the block gets the monitoring back rather than having
  // silently lost the setting.
  await withRegistry(async (db) => {
    await db.collection('discovered_agents').insertOne({
      id: AGENT_ID, name: 'Enterprise Agent', platform: 'personal_agent', lifecycleStatus: 'active',
    });
    await setDlpMonitor(db, { agent_id: AGENT_ID, dlp_monitor: true, agent_name: 'Enterprise Agent', platform: 'personal_agent', agent_scope: 'agent' });
  }, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent', source: 'governance', platform: 'personal_agent' });
    let [row] = db._rows('blocked_agents');
    assert.equal(row.blocked, true);
    assert.equal(row.dlp_monitor, true, 'blocking must not clear the monitoring flag');
    assert.deepEqual(await listGovernedAgents(db), [], 'while blocked it is off the governed list');

    await setStatus(AGENT_ID, { status: 'approved', product_name: 'Enterprise Agent', category: 'autonomous-agent', source: 'governance' });
    [row] = db._rows('blocked_agents');
    assert.equal(row.blocked, false);
    assert.equal(row.dlp_monitor, true, 'the monitoring flag must survive the unblock');
    assert.deepEqual((await listGovernedAgents(db)).map((a) => a.agent_id), [AGENT_ID],
      'and the agent returns to the governed list');
  });
});

// ── The routes themselves ────────────────────────────────────────────────────
//
// The governance router resolves its Mongo handle through getDb() at request
// time rather than taking an injected db, so it cannot be mounted against the
// in-memory fake. These assertions pin the route's SOURCE — the same convention
// agent-scope.test.mjs uses for this file — while every behaviour above is
// covered against the shared helpers the routes delegate to.

test('POST /lifecycle/dlp-monitor validates both flags before writing anything', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.post("/dlp-monitor"'), src.indexOf('router.get("/governed-agents"'));
  assert.ok(route.length > 0, 'expected a POST /dlp-monitor body');
  assert.match(route, /const monitor = normalizeDlpMonitor\(dlp_monitor\);/);
  assert.match(route, /if \(monitor === undefined\) \{[\s\S]{0,200}?res\.status\(400\)/);
  // The scope enum keeps ONE definition — validated through the same helper
  // /block uses, never re-implemented here.
  assert.match(route, /const scope = normalizeAgentScope\(agent_scope\);/);
  assert.match(route, /if \(scope === undefined\) \{[\s\S]{0,240}?res\.status\(400\)/);
  assert.match(route, /if \(!agent_id\) \{[\s\S]{0,160}?res\.status\(400\)/);
  // Validation happens BEFORE the write, so no bad row can be stored.
  assert.ok(route.indexOf('const monitor =') < route.indexOf('setDlpMonitor('));
  assert.ok(route.indexOf('const scope =') < route.indexOf('setDlpMonitor('));
  // The write shape is the shared helper's, not a second copy of it.
  assert.match(src, /import \{ normalizeDlpMonitor, setDlpMonitor, listGovernedAgents \} from "\.\.\/dlp-monitor\.js";/);
});

test('GET /lifecycle/governed-agents is public and delegates to the shared read model', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.get("/governed-agents"'));
  assert.ok(route.length > 0, 'expected a GET /governed-agents body');
  // Same auth stance as /blocked-agents — deliberately none, because the same two
  // unauthenticated consumers (desktop agent, browser extension) poll it.
  assert.match(route, /router\.get\("\/governed-agents", async \(_req, res\) => \{/);
  assert.match(route, /listGovernedAgents\(getDb\(\)\)/);
  // The filter is not restated in the route, so there is no second place for the
  // blocked-wins exclusion to drift.
  assert.equal(/dlp_monitor: true/.test(route), false);
});

test('GET /lifecycle/blocked-agents is completely unchanged by any of this', async () => {
  const src = await lifecycleSrc();
  const route = src.slice(src.indexOf('router.get("/blocked-agents"'), src.indexOf('router.post("/dlp-monitor"'));
  // Same filter, same projection, still unfiltered by orphan status.
  assert.match(route, /\.find\(\{ blocked: true \}\)/);
  assert.match(route, /\.project\(\{ _id: 0, agent_id: 1, agent_name: 1, platform: 1, reason: 1, blocked_at: 1, oauth_key_id: 1, agent_scope: 1 \}\)/);
  // And it says nothing about dlp_monitor: a monitored agent is not a blocked
  // one, and this list is what the enforcer refuses traffic on.
  assert.equal(/dlp_monitor/.test(route), false);
});

test('the block and unblock write paths never mention dlp_monitor', async () => {
  const src = await lifecycleSrc();
  const blockRoutes = src.slice(src.indexOf('router.post("/block"'), src.indexOf('router.get("/blocked-agents"'));
  assert.ok(blockRoutes.length > 0);
  assert.equal(/dlp_monitor/.test(blockRoutes), false,
    'block/unblock must leave the monitoring flag untouched, in either direction');
  const registrySrc = await readFile(join(SERVER_DIR, 'src', 'routes', 'registry.js'), 'utf8');
  assert.equal(/dlp_monitor/.test(registrySrc), false,
    "the registry's block mirror must leave the monitoring flag untouched too");
});
