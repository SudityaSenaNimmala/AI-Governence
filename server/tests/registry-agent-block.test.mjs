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

import { mountRegistry } from '../src/routes/registry.js';
import { createFakeDb } from './helpers/fake-db.mjs';

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
    id: AGENT_ID, name: 'Enterprise Agent', lifecycleStatus: 'active',
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
