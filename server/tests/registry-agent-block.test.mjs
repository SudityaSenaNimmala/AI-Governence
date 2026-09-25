// PUT /api/v1/registry/:id/status — blocking an AGENT must reach the list the
// extension actually enforces.
//
// THE GAP THIS PINS DOWN. Two different things were both called "blocked", and
// neither knew about the other:
//
//   * this route wrote `sanctions` and `ai_platforms`, which are HOST-keyed, and
//     drive "this platform is blocked" in the extension;
//   * content.js's enforceBlockedAgent() polls GET /api/lifecycle/blocked-agents,
//     which reads `blocked_agents` and matches on the agent NAME in the page
//     header. Only POST /api/lifecycle/block ever wrote to it.
//
// Reported live: an admin blocked a Copilot Studio agent ("Enterprise Agent") from
// Inventory → AI Systems. The row showed Blocked, its lifecycle went to suspended,
// and the agent stayed completely usable in m365.cloud.microsoft — because the one
// list the extension reads never heard about it. A host-keyed block could not have
// stopped it either: an agent inside Copilot Studio has no host of its own, only a
// name inside someone else's app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mountRegistry } from '../src/routes/registry.js';
import { isUnenforceableBlock } from '../src/lib/agent-platform.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { adminJsonHeaders } from './helpers/admin-auth.mjs';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

// POINT THE SNAPSHOT AT A TEMP FILE. A successful live build now REWRITES
// data/registry-snapshot.json (routes/registry.js — the snapshot is kept current
// instead of ageing from the day it was captured), and this file's readStatus()
// helper issues a real GET /api/v1/registry. Left on the default path, a
// one-agent fixture would overwrite the curated 260-system capture that is the
// Inventory tab's fallback. Set before any mountRegistry() call, which is when
// the path is read.
process.env.REGISTRY_SNAPSHOT_PATH = join(
  mkdtempSync(join(tmpdir(), 'cfai-registry-agent-block-')), 'registry-snapshot.json',
);

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
          headers: adminJsonHeaders(),
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
// `platform` is part of the fixture because it is part of the record: every real
// discovered agent carries one, and the server now DERIVES the blocklist row's
// platform from this document when the caller omits it (see the platform-derivation
// section at the bottom of this file). A fixture without it would be testing the
// one shape the write path is no longer allowed to produce silently.
const seedAgent = async (db) => {
  await db.collection('discovered_agents').insertOne({
    id: AGENT_ID, name: 'Enterprise Agent', platform: 'copilot_studio', lifecycleStatus: 'active',
  });
};
const blockedRows = (db) => db._rows('blocked_agents').filter((r) => r.blocked === true);

test('blocking an agent writes it to blocked_agents', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent',
      category: 'autonomous-agent', source: 'governance',
    });

    const rows = blockedRows(db);
    assert.equal(rows.length, 1, 'the agent never reached the list the extension enforces');
    // The extension matches on the NAME in the page header, so the name is the
    // field that has to be right — an id alone enforces nothing.
    assert.equal(rows[0].agent_name, 'Enterprise Agent');
    assert.equal(rows[0].agent_id, AGENT_ID);
    assert.equal(rows[0].blocked, true);
    assert.ok(rows[0].blocked_at instanceof Date);
    assert.equal(rows[0].unblocked_at, null);
  });
});

// Field-for-field with POST /api/lifecycle/block, so the two write paths produce
// rows the read path and /unblock cannot tell apart.
test('the mirrored row has the same shape as a lifecycle block', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    const row = blockedRows(db)[0];
    for (const key of ['agent_id', 'agent_name', 'platform', 'reason', 'oauth_key_id', 'blocked', 'blocked_at', 'unblocked_at']) {
      assert.ok(key in row, `mirrored row is missing ${key}, which /blocked-agents or /unblock reads`);
    }
    assert.match(row.reason, /AI Systems/, 'the block is not attributable to the screen that made it');
  });
});

test('un-blocking relaxes the block rather than deleting it', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    assert.equal(blockedRows(db).length, 1);

    await setStatus(AGENT_ID, { status: 'approved', product_name: 'Enterprise Agent', category: 'autonomous-agent' });

    // GET /blocked-agents filters on blocked:true, so this lifts the block …
    assert.equal(blockedRows(db).length, 0, 'the block was not lifted');
    // … and the row survives, matching /unblock and keeping the audit trail.
    const all = db._rows('blocked_agents');
    assert.equal(all.length, 1, 'the audit row was deleted instead of being relaxed');
    assert.equal(all[0].blocked, false);
    assert.ok(all[0].unblocked_at instanceof Date);
  });
});

test('approving an agent that was never blocked creates nothing', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'approved', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    assert.equal(db._rows('blocked_agents').length, 0, 'an unblock invented a blocklist row');
  });
});

// A platform is host-keyed and already enforced through ai_platforms. Mirroring it
// into the agent blocklist would have the extension matching a product name
// against page headers, which is not what that list is for.
test('blocking a plain platform does not touch the agent blocklist', async () => {
  await withServer(async (db) => {
    await db.collection('ai_platforms').insertOne({ host: 'poe.com', product: 'Poe', blocked: 0 });
  }, async ({ db, setStatus }) => {
    await setStatus('poe.com', { status: 'blocked', product_name: 'Poe', matched_hosts: ['poe.com'] });

    assert.equal(db._rows('blocked_agents').length, 0, 'a platform block leaked into the agent blocklist');
    // …and the host-keyed enforcement still happened.
    assert.equal(db._rows('ai_platforms')[0].blocked, 1);
  });
});

// The UI sends category/source, but the server must not depend on it: a caller
// that omits them still has the agent recognised from discovered_agents.
test('an agent is recognised even when the caller sends no category', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent' });
    assert.equal(blockedRows(db).length, 1, 'the discovered_agents fallback did not fire');
  });
});

// A block must outlive the connection that discovered the agent — otherwise
// removing a tenant scan silently un-blocks things.
test('an agent absent from discovered_agents is still blocked when declared', async () => {
  await withServer(null, async ({ db, setStatus }) => {
    await setStatus('orphan-agent-id', {
      status: 'blocked', product_name: 'Ghost Agent', category: 'autonomous-agent',
    });
    const rows = blockedRows(db);
    assert.equal(rows.length, 1, 'an agent with no scan row could not be blocked at all');
    assert.equal(rows[0].agent_name, 'Ghost Agent');
  });
});

test('the agent lifecycle is still suspended alongside the mirror', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, { status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    assert.equal(db._rows('discovered_agents')[0].lifecycleStatus, 'suspended');

    await setStatus(AGENT_ID, { status: 'approved', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
    assert.equal(db._rows('discovered_agents')[0].lifecycleStatus, 'active');
  });
});

// ── The key mismatch that made the toggle silently revert ───────────────────
//
// Observed live: PUT /registry/:id/status returned {"ok":true} and a re-read of
// the registry still said status "approved". The UI showed Blocked from optimistic
// local state and reverted on reload, so an admin's decision quietly vanished.
//
// Cause: the write stores sanctions.tool_key using the id the UI sent — the row's
// exposed `id`, which is `agent.id || key` — while the read looked the sanction up
// under `agent.botId || agent.appId || agent.id || agent.name`. For a Copilot
// Studio agent whose botId differs from its id, the write landed under one key and
// the read looked under another.

const readStatus = async (base, name) => {
  const res = await fetch(`${base}/api/v1/registry`);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.rows || body.items || []);
  return rows.find((r) => r.name === name);
};

async function withRegistry(seed, fn) {
  const db = createFakeDb();
  await seed(db);
  const app = express();
  app.use(express.json());
  mountRegistry(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn({ db, base }); }
  finally { await new Promise((r) => server.close(r)); }
}

// botId deliberately differs from id — the exact shape that broke.
const AGENT_WITH_BOTID = {
  id: '124794af-3b8f-f111-b8da-0022480b1f83',
  botId: 'bot-9999-different-from-id',
  name: 'Enterprise Agent',
  platform: 'copilot_studio',
  lifecycleStatus: 'active',
};

test('a block persists when botId differs from the row id', async () => {
  await withRegistry(async (db) => {
    await db.collection('discovered_agents').insertOne({ ...AGENT_WITH_BOTID });
  }, async ({ base }) => {
    const before = await readStatus(base, 'Enterprise Agent');
    assert.ok(before, 'the agent is not in the registry at all');

    const res = await fetch(`${base}/api/v1/registry/${encodeURIComponent(before.id)}/status`, {
      method: 'PUT',
      headers: adminJsonHeaders(),
      body: JSON.stringify({ status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' }),
    });
    assert.equal(res.status, 200);

    const after = await readStatus(base, 'Enterprise Agent');
    assert.equal(after.status, 'blocked',
      'the block was written under one key and read under another — it silently reverted');
  });
});

test('the decision round-trips back to approved', async () => {
  await withRegistry(async (db) => {
    await db.collection('discovered_agents').insertOne({ ...AGENT_WITH_BOTID });
  }, async ({ base }) => {
    const row = await readStatus(base, 'Enterprise Agent');
    const put = (status) => fetch(`${base}/api/v1/registry/${encodeURIComponent(row.id)}/status`, {
      method: 'PUT',
      headers: adminJsonHeaders(),
      body: JSON.stringify({ status, product_name: 'Enterprise Agent', category: 'autonomous-agent' }),
    });

    await put('blocked');
    assert.equal((await readStatus(base, 'Enterprise Agent')).status, 'blocked');
    await put('approved');
    assert.equal((await readStatus(base, 'Enterprise Agent')).status, 'approved',
      'un-blocking did not read back');
  });
});

// `enforced:false` on a successful agent block is what sent this investigation
// down the wrong path — it reads as "the block did nothing".
test('enforced reports the agent blocklist, not just platform hosts', async () => {
  await withRegistry(async (db) => {
    await db.collection('discovered_agents').insertOne({ ...AGENT_WITH_BOTID });
  }, async ({ base }) => {
    const row = await readStatus(base, 'Enterprise Agent');
    const res = await fetch(`${base}/api/v1/registry/${encodeURIComponent(row.id)}/status`, {
      method: 'PUT',
      headers: adminJsonHeaders(),
      body: JSON.stringify({ status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' }),
    });
    const body = await res.json();
    assert.equal(body.enforced, true, 'a successful agent block still reported enforced:false');
    assert.ok(body.enforced_via.includes('agent_blocklist'), 'enforced_via does not name the agent blocklist');
  });
});

// ── The over-blocking bug: blocking one agent blocked Teams/SharePoint/Outlook ──
//
// Reported live: clicking Block on "Enterprise Agent" from Inventory also set
// blocked:true on every host in matched_hosts — for a Copilot Studio agent that
// list is broad Microsoft-suite hosts (teams.microsoft.com, sharepoint.com,
// outlook.office.com, m365.cloud.microsoft, ...), so one agent decision blocked
// Teams, SharePoint and Outlook for the whole org. Confirmed live via a direct
// PUT replicating the dashboard's exact request body.
const MS_SUITE_HOSTS = [
  'teams.microsoft.com', 'sharepoint.com', 'outlook.office.com',
  'office.com', 'm365.cloud.microsoft', 'copilot.microsoft.com',
];

test('blocking an agent does NOT touch ai_platforms, even when matched_hosts is sent', async () => {
  await withServer(async (db) => {
    await seedAgent(db);
    for (const host of MS_SUITE_HOSTS) {
      await db.collection('ai_platforms').insertOne({ host, blocked: 0 });
    }
  }, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent',
      // This is the exact shape the dashboard sends for an agent row — a broad
      // matched_hosts list travels along unconditionally, so the fix has to be
      // "ignore it for an agent", not "the UI happens not to send one".
      matched_hosts: MS_SUITE_HOSTS,
    });

    for (const row of db._rows('ai_platforms')) {
      assert.equal(row.blocked, 0, `${row.host} was blocked by an individual agent decision`);
    }
    // The agent itself is still correctly blocked via the narrow mechanism.
    assert.equal(blockedRows(db).length, 1);
  });
});

test('enforced_via names only agent_blocklist when matched_hosts was ignored', async () => {
  await withServer(async (db) => {
    await seedAgent(db);
    await db.collection('ai_platforms').insertOne({ host: 'teams.microsoft.com', blocked: 0 });
  }, async ({ setStatus }) => {
    const body = await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent',
      matched_hosts: ['teams.microsoft.com'],
    });
    assert.deepEqual(body.enforced_via, ['agent_blocklist'],
      'reporting platform_hosts here would mean ai_platforms was touched after all');
  });
});

// ── The platform field: without it, the mirrored row is unmatchable ──────────
//
// Reported live: the dashboard's PUT never sent `platform`, so the mirrored
// blocked_agents row carried platform:null. Both the browser extension's
// isBlockedAgentActive() and the desktop enforcer's PLATFORM_PROCS lookup key
// on this field — a null value makes the row look blocked in the UI while
// enforcing nothing on either surface.
test('the mirrored row carries the real platform, not null', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent',
      category: 'autonomous-agent', platform: 'copilot_studio',
    });
    const row = blockedRows(db)[0];
    assert.equal(row.platform, 'copilot_studio',
      'platform came through as null — this row cannot be matched by PLATFORM_PROCS on either enforcement surface');
  });
});

// The dashboard's PUT does not send one, so it has to be DERIVED rather than
// stored as null — from the same discovered_agents document this request already
// matched for the lifecycle update, never guessed from anything else.
test('the platform is derived from discovered_agents when the body omits it', async () => {
  await withServer(seedAgent, async ({ db, setStatus }) => {
    const body = await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent',
      // no `platform` — exactly what the dashboard sends
    });
    assert.equal(blockedRows(db)[0].platform, 'copilot_studio',
      'the row was stored with platform:null and enforces on neither surface');
    assert.equal(body.enforced, true);
    assert.equal('reason' in body, false, 'a derivable platform must not report a reason');
  });
});

test('a platform sent explicitly still wins over the derived one', async () => {
  await withServer(async (db) => {
    await db.collection('discovered_agents').insertOne({
      id: AGENT_ID, name: 'Enterprise Agent', platform: 'copilot_studio', lifecycleStatus: 'active',
    });
  }, async ({ db, setStatus }) => {
    await setStatus(AGENT_ID, {
      status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent',
      platform: 'personal_agent',
    });
    assert.equal(blockedRows(db)[0].platform, 'personal_agent',
      'the caller was overruled by discovery');
  });
});

test('derivation matches on botId and appId too, not just id', async () => {
  // The registry exposes `agent.id || key`, and for a Copilot Studio agent the
  // botId legitimately differs — the derivation must use the SAME filter the
  // lifecycle update used, or it resolves a different document (or none).
  for (const key of ['botId', 'appId', 'name']) {
    await withServer(async (db) => {
      await db.collection('discovered_agents').insertOne({
        id: 'some-other-id', [key]: 'lookup-key', name: key === 'name' ? 'lookup-key' : 'Enterprise Agent',
        platform: 'teams_chat_agent', lifecycleStatus: 'active',
      });
    }, async ({ db, setStatus }) => {
      await setStatus('lookup-key', { status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent' });
      assert.equal(blockedRows(db)[0].platform, 'teams_chat_agent', `derivation missed a match on ${key}`);
    });
  }
});

// ── When it genuinely cannot be derived: say so, do not lose the block ───────

test('an underivable platform reports enforced:false with a reason, not a false success', async () => {
  await withServer(null, async ({ db, setStatus }) => {
    const body = await setStatus('orphan-agent-id', {
      status: 'blocked', product_name: 'Ghost Agent', category: 'autonomous-agent',
    });
    assert.equal(body.enforced, false,
      'an inert row (platform:null) was reported as enforced — the exact false positive this fixes');
    assert.equal(body.reason, 'no_platform');
    assert.deepEqual(body.enforced_via, [], 'nothing enforced, so nothing to name');
    // …and the admin's decision is still on record, which is the half that must
    // not regress: refusing the write would silently drop the block.
    const [row] = blockedRows(db);
    assert.equal(row.agent_name, 'Ghost Agent');
    assert.equal(row.platform, null);
  });
});

test('a discovered agent with no platform of its own is treated the same way', async () => {
  // A matching document that simply has no platform field is as underivable as no
  // document at all — and an empty/whitespace platform must not pass either, since
  // the enforcer drops exactly those rows at parse time.
  for (const platform of [undefined, null, '', '   ']) {
    await withServer(async (db) => {
      await db.collection('discovered_agents').insertOne({ id: AGENT_ID, name: 'Enterprise Agent', platform });
    }, async ({ setStatus }) => {
      const body = await setStatus(AGENT_ID, {
        status: 'blocked', product_name: 'Enterprise Agent', category: 'autonomous-agent',
      });
      assert.equal(body.enforced, false, `platform ${JSON.stringify(platform)} was accepted as enforceable`);
      assert.equal(body.reason, 'no_platform');
    });
  }
});

test('unblocking never reports no_platform — a lifted block needs no platform', async () => {
  await withServer(null, async ({ setStatus }) => {
    const body = await setStatus('orphan-agent-id', { status: 'approved', product_name: 'Ghost Agent', category: 'autonomous-agent' });
    assert.equal(body.enforced, true);
    assert.equal('reason' in body, false);
  });
});

// ── The read path marks the row instead of dropping it ──────────────────────
//
// GET /api/lifecycle/blocked-agents lives on the governance router, which resolves
// its Mongo handle through getDb() at request time and so cannot be mounted against
// the in-memory fake. Same convention as agent-scope.test.mjs: the marker's logic is
// covered behaviourally through the shared helper, the route's use of it by pinning
// its source — including the one change that must never be made here, filtering.

// The tests below pin lifecycle.ts's SOURCE, which cannot tell a working route
// from one that no longer parses — `const reason = ...` shadowing the `reason`
// already destructured from the request body matched every regex here and still
// crashed the whole governance router at import. One real import closes that hole.
test('the governance lifecycle route still loads', async () => {
  const mod = await import('../src/governance/routes/lifecycle.ts');
  assert.equal(typeof mod.default, 'function', 'lifecycle.ts no longer exports a router');
});

test('isUnenforceableBlock marks exactly the rows no surface can enforce', () => {
  for (const platform of [undefined, null, '', '  ', 0, false, {}]) {
    assert.equal(isUnenforceableBlock({ agent_id: 'x', platform }), true, JSON.stringify(platform) ?? 'undefined');
  }
  for (const platform of ['copilot_studio', 'personal_agent', ' teams_chat_agent ']) {
    assert.equal(isUnenforceableBlock({ agent_id: 'x', platform }), false, platform);
  }
});

test('GET /lifecycle/blocked-agents ANNOTATES a platform-less row and never omits it', async () => {
  const src = await readFile(join(SERVER_DIR, 'src', 'governance', 'routes', 'lifecycle.ts'), 'utf8');
  const route = src.slice(src.indexOf('router.get("/blocked-agents"'), src.indexOf('router.post("/dlp-monitor"'));
  assert.ok(route.length > 0, 'expected a GET /blocked-agents body');
  // The marker rides the same map as `orphaned` — annotate, never drop. It is now
  // derived from unenforceableReason() (lib/agent-platforms.js), which widened it
  // to cover a row whose platform is set but unknown to every surface; the boolean
  // itself is unchanged for the clients already reading it.
  assert.match(route, /unenforceable: unenforceableReasonForRow !== null,/);
  assert.match(route, /unenforceable_reason: unenforceableReasonForRow,/);
  assert.match(route, /orphaned: !known\.has\(String\(b\.agent_id\)\),/);
  // Still the unfiltered list: the selection is `blocked: true` and nothing else,
  // and no post-filter narrows it. Dropping a platform-less row here would make
  // the payload agree with what is enforced by silently discarding the block.
  assert.match(route, /\.find\(\{ blocked: true \}\)/);
  assert.equal(/list\.filter\(/.test(route), false, 'the blocked list must never be filtered');
  // One definition of the predicate, shared with the write path in the same file.
  assert.match(src, /import \{ derivePlatform, normalizePlatform \} from "\.\.\/\.\.\/lib\/agent-platform\.js";/);
  assert.match(src, /import \{ unenforceableReason \} from "\.\.\/\.\.\/lib\/agent-platforms\.js";/);
});

test('POST /lifecycle/block derives the platform the same way the registry route does', async () => {
  const src = await readFile(join(SERVER_DIR, 'src', 'governance', 'routes', 'lifecycle.ts'), 'utf8');
  const route = src.slice(src.indexOf('router.post("/block"'), src.indexOf('router.post("/unblock"'));
  assert.ok(route.length > 0, 'expected a POST /block body');
  // Derived through the shared helper, and the RESOLVED value is what gets stored —
  // `platform: platform || null` straight off the body is the bug.
  assert.match(route, /const resolvedPlatform = normalizePlatform\(platform\)\s*\?\?\s*await derivePlatform\(db, \{/);
  assert.match(route, /platform: resolvedPlatform,/);
  assert.equal(/platform: platform \|\| null/.test(route), false,
    'the raw body value is stored again — a null platform enforces on neither surface');
  // Honest response, same stance as the registry route — and the reason string now
  // comes from the shared helper, so a row reported 'unknown_platform' on write
  // reads back as 'unknown_platform' too rather than as a silent success.
  assert.match(route, /const enforcementReason = unenforceableReason\(resolvedPlatform\);/);
  assert.match(route, /\.\.\.\(enforcementReason \? \{ enforced: false, reason: enforcementReason \} : \{\}\),/);
  // The write itself is never conditional on enforceability.
  assert.ok(
    route.indexOf('const enforcementReason = unenforceableReason(resolvedPlatform);')
      > route.indexOf('collection("blocked_agents").updateOne'),
    'the block is computed before it is stored — an unenforceable platform must never gate the write',
  );
});

test('a sanction already stored under the legacy key is still honoured', async () => {
  // No migration: rows written before the fix used whichever key the write path
  // produced, and both must read back.
  await withRegistry(async (db) => {
    await db.collection('discovered_agents').insertOne({ ...AGENT_WITH_BOTID });
    await db.collection('sanctions').insertOne({ tool_key: AGENT_WITH_BOTID.botId, status: 'blocked' });
  }, async ({ base }) => {
    const row = await readStatus(base, 'Enterprise Agent');
    assert.equal(row.status, 'blocked', 'a sanction stored under botId no longer reads back');
  });
});
