// The desktop "Request Access" flow end to end, and two defects found tracing it
// against live data (2026-10-01):
//
//   1. DUPLICATE PENDING ROWS. The pending check and the insert are two round
//      trips, so two submissions landing together both passed the check. Live:
//      two pending claude.ai rows for one device 9ms apart — the admin approved
//      one and the twin sat in the queue forever.
//   2. OVER-WIDE APPROVAL. Approve widened the exception to "sibling" machines by
//      a bare hostname PREFIX, so LAPTOP-1 also granted LAPTOP-10, and an
//      unidentified extension install ("Mozilla-browser-extension", 47 of them
//      live) granted the tool to every other unidentified Firefox install.
//
// Plus the agent-scope contract the Electron dialog must honour: a request filed
// WITHOUT block_scope is a whole-app request even when it carries an agent_id,
// and approving it lifts every agent on that host. That is why the desktop
// client must send block_scope + agent_name (agent/electron/main.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountAccessRequests, siblingBaseHostname } from '../src/routes/access-requests.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

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
      post: (p, o) => call('POST', p, o),
      get: (p, o) => call('GET', p, o),
      put: (p, o) => call('PUT', p, o),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const tokenFor = (machineId, hostname) => signMachineToken({ machineId, hostname });
const recent = () => new Date(Date.now() - 3600 * 1000);

// ── 1. duplicate pending rows ────────────────────────────────────────────────

// The in-memory fake answers too fast for three HTTP requests to overlap on
// their own, so the race is forced: the pending-check findOne is held at a
// barrier until every racer has reached it — i.e. all three pass the check
// before any of them inserts, which is exactly the interleaving seen live.
function withPendingCheckBarrier(db, racers) {
  const realCollection = db.collection.bind(db);
  let waiting = [];
  db.collection = (name) => {
    const coll = realCollection(name);
    if (name !== 'access_requests') return coll;
    return new Proxy(coll, {
      get(target, prop) {
        if (prop !== 'findOne') return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
        return async (filter, ...rest) => {
          if (filter?.status === 'pending' && waiting !== null) {
            await new Promise((resolve) => {
              waiting.push(resolve);
              if (waiting.length >= racers) { const all = waiting; waiting = null; all.forEach((r) => r()); }
            });
          }
          return target.findOne(filter, ...rest);
        };
      },
    });
  };
}

test('two simultaneous submissions for the same device + tool file ONE pending request', async () => {
  await withServer(async ({ post, db }) => {
    withPendingCheckBarrier(db, 3);
    const token = tokenFor('mach-a', 'LAPTOP-A');
    const body = { tool_host: 'claude.ai', tool_name: 'Claude', reason: 'r', surface: 'desktop' };
    const results = await Promise.all([
      post('/api/v1/access-requests', { token, body }),
      post('/api/v1/access-requests', { token, body }),
      post('/api/v1/access-requests', { token, body }),
    ]);
    const pending = db._rows('access_requests').filter((r) => r.status === 'pending');
    assert.equal(pending.length, 1, 'racing submissions must not leave twin pending rows');
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);
    // Every 409 names the surviving row, so the client can show "already pending".
    for (const r of results.filter((x) => x.status === 409)) {
      assert.equal(r.body.code, 'pending');
      assert.equal(r.body.request_id, pending[0].id);
    }
  });
});

test('different agents on one host are not twins of each other', async () => {
  await withServer(async ({ post, db }) => {
    const token = tokenFor('mach-a', 'LAPTOP-A');
    const base = { tool_host: 'teams.microsoft.com', tool_name: 'Microsoft Teams', surface: 'desktop', block_scope: 'agent' };
    const [a, b] = await Promise.all([
      post('/api/v1/access-requests', { token, body: { ...base, agent_id: 'agent-A', agent_name: 'IT Help Desk Agent' } }),
      post('/api/v1/access-requests', { token, body: { ...base, agent_id: 'agent-B', agent_name: 'Finance Bot' } }),
    ]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(db._rows('access_requests').filter((r) => r.status === 'pending').length, 2);
  });
});

// ── 2. approval widening ─────────────────────────────────────────────────────

test('siblingBaseHostname refuses synthetic extension names and strips the suffix', () => {
  assert.equal(siblingBaseHostname('Mozilla-browser-extension'), null);
  assert.equal(siblingBaseHostname('chrome-browser-extension'), null);
  assert.equal(siblingBaseHostname(''), null);
  assert.equal(siblingBaseHostname(undefined), null);
  assert.equal(siblingBaseHostname('LAPTOP-FCRNKB4-browser-extension'), 'LAPTOP-FCRNKB4');
  assert.equal(siblingBaseHostname('LAPTOP-FCRNKB4'), 'LAPTOP-FCRNKB4');
});

test('approve grants the same host and its extension — never a hostname that merely starts the same', async () => {
  await withServer(async ({ post, put, db }) => {
    const res = await post('/api/v1/access-requests', {
      token: tokenFor('desk-1', 'LAPTOP-1'),
      body: { tool_host: 'claude.ai', tool_name: 'Claude', surface: 'desktop' },
    });
    assert.equal(res.status, 201);
    const ok = await put(`/api/v1/access-requests/${res.body.id}/approve`, { body: { expires_in_hours: 4 } });
    assert.equal(ok.status, 200);
    const granted = new Set(db._rows('access_exceptions').map((e) => e.machine_id));
    assert.ok(granted.has('desk-1'));
    assert.ok(granted.has('ext-1'), "the same host's browser extension is a legitimate sibling");
    assert.ok(granted.has('desk-1-upper'), 'hostname match stays case-insensitive');
    assert.equal(granted.has('desk-10'), false, 'LAPTOP-10 is a different device');
    assert.equal(granted.has('ext-10'), false);
    assert.equal(ok.body.surfaces, 3);
  }, async (db) => {
    await db.collection('machines').insertMany([
      { id: 'desk-1', hostname: 'LAPTOP-1', last_seen: recent() },
      { id: 'ext-1', hostname: 'LAPTOP-1-browser-extension', last_seen: recent() },
      { id: 'desk-1-upper', hostname: 'laptop-1', last_seen: recent() },
      { id: 'desk-10', hostname: 'LAPTOP-10', last_seen: recent() },
      { id: 'ext-10', hostname: 'LAPTOP-10-browser-extension', last_seen: recent() },
    ]);
  });
});

test('approving an unidentified extension install grants THAT install only', async () => {
  await withServer(async ({ post, put, db }) => {
    const res = await post('/api/v1/access-requests', {
      body: { machine_id: 'moz-1', hostname: 'Mozilla-browser-extension', tool_host: 'chatgpt.com', tool_name: 'ChatGPT' },
    });
    assert.equal(res.status, 201);
    const ok = await put(`/api/v1/access-requests/${res.body.id}/approve`, { body: { expires_in_hours: 4 } });
    assert.equal(ok.status, 200);
    assert.deepEqual(db._rows('access_exceptions').map((e) => e.machine_id), ['moz-1']);
  }, async (db) => {
    await db.collection('machines').insertMany([
      { id: 'moz-1', hostname: 'Mozilla-browser-extension', last_seen: recent() },
      { id: 'moz-2', hostname: 'Mozilla-browser-extension', last_seen: recent() },
      { id: 'moz-3', hostname: 'Mozilla-browser-extension', last_seen: recent() },
    ]);
  });
});

// ── 3. the desktop agent-scope contract, end to end ──────────────────────────

test('desktop agent-scoped request → approve → /access-exceptions/mine carries an AGENT grant', async () => {
  await withServer(async ({ post, put, get }) => {
    const token = tokenFor('desk-m365', 'LAPTOP-M365');
    const res = await post('/api/v1/access-requests', {
      token,
      body: {
        tool_host: 'teams.microsoft.com', tool_name: 'Microsoft Teams', surface: 'desktop',
        platform: 'copilot_studio', process_name: 'ms-teams',
        block_scope: 'agent', agent_id: '44ba298c', agent_name: 'IT Help Desk Agent',
      },
    });
    assert.equal(res.status, 201);

    const list = await get('/api/v1/access-requests?status=pending');
    assert.equal(list.status, 200, 'review queue readable with the default (open) review auth');
    const row = list.body.find((r) => r.id === res.body.id);
    assert.equal(row.block_scope, 'agent');
    assert.equal(row.agent_name, 'IT Help Desk Agent');

    const ok = await put(`/api/v1/access-requests/${res.body.id}/approve`, { body: { expires_in_hours: 8 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.scope, 'agent');

    const mine = await get('/api/v1/access-exceptions/mine', { token });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].scope, 'agent');
    assert.equal(mine.body[0].agent_id, '44ba298c');
    assert.equal(mine.body[0].tool_host, 'teams.microsoft.com');

    // The request is no longer pending for this device.
    const own = await get('/api/v1/access-requests/mine', { token });
    assert.equal(own.body[0].status, 'approved');
    assert.equal(own.body[0].block_scope, 'agent');
  });
});

test('the same request WITHOUT block_scope is filed whole-app and approves host-wide', async () => {
  // This is what the Electron dialog used to send (agent_id but no block_scope /
  // agent_name), seen live on 2026-09-23/24 for M365 agent blocks. Pinned so the
  // server default stays the documented one and the client fix stays necessary.
  await withServer(async ({ post, put, get }) => {
    const token = tokenFor('desk-m365', 'LAPTOP-M365');
    const res = await post('/api/v1/access-requests', {
      token,
      body: { tool_host: 'teams.microsoft.com', surface: 'desktop', platform: 'copilot_studio', agent_id: '44ba298c' },
    });
    assert.equal(res.status, 201);
    const ok = await put(`/api/v1/access-requests/${res.body.id}/approve`, { body: { expires_in_hours: 8 } });
    assert.equal(ok.body.scope, 'host');
    const mine = await get('/api/v1/access-exceptions/mine', { token });
    assert.equal(mine.body[0].scope, 'host');
  });
});

test('reject closes the request and starts the cooldown for a whole-app ask', async () => {
  await withServer(async ({ post, put }) => {
    const token = tokenFor('desk-r', 'LAPTOP-R');
    const body = { tool_host: 'chatgpt.com', tool_name: 'ChatGPT', surface: 'desktop' };
    const res = await post('/api/v1/access-requests', { token, body });
    const rej = await put(`/api/v1/access-requests/${res.body.id}/reject`, { body: { note: 'no' } });
    assert.equal(rej.status, 200);
    const again = await post('/api/v1/access-requests', { token, body });
    assert.equal(again.status, 429);
    assert.equal(again.body.code, 'recently_rejected');
  });
});
