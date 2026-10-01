// Desktop "Request Access" flow — regression tests for the breaks found tracing
// it end to end on 2026-10-01:
//
//   1. The Electron dialog dropped block_scope / agent_name, so an agent block in
//      Teams / M365 Copilot was filed as a WHOLE-APP request (live rows on
//      2026-09-23/24: agent_id set, block_scope 'app', agent_name null) and its
//      approval became a host-wide exception that lifted every blocked agent on
//      that host. The pending check was host-only too.
//   2. Two flushers drained the single offline slot (OsMonitor ran a private copy
//      of the sync next to the shared one), so a queued request was POSTed twice
//      — live: two pending rows for one device + tool, 9ms apart.
//
// main.js is CommonJS with Electron side effects and cannot be imported; its
// pure identity block is delimited by markers and evaluated on its own, the same
// way the rest of the suite reads source for the parts that cannot be run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const MAIN = join(AGENT_DIR, 'electron', 'main.js');
const BLOCKED_SYNC = join(AGENT_DIR, 'src', 'os_monitor', 'blocked-agents-sync.js');

async function loadIdentityBlock() {
  const src = await readFile(MAIN, 'utf8');
  const start = src.indexOf('// ── Access-request identity (pure;');
  const end = src.indexOf('// ── end access-request identity ──');
  assert.ok(start >= 0 && end > start, 'main.js must keep the delimited access-request identity block');
  const block = src.slice(start, end);
  // Pure means pure: nothing from Electron, the filesystem or the network.
  assert.equal(/require\(|fetch\(|fs\.|ipcMain|process\./.test(block), false, 'the identity block must stay side-effect free');
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return { accessRequestScope, accessRequestKey, sameAccessRequest };`)();
}

// ── 1. block scope survives the Electron dialog ─────────────────────────────

test('accessRequestScope: an agent block with an identity is agent-scoped, everything else is not', async () => {
  const { accessRequestScope } = await loadIdentityBlock();
  // The @@CFAI-BLOCK payload for an M365 agent block, as main.js receives it.
  assert.deepEqual(
    accessRequestScope({ block_scope: 'agent', agent_id: '44ba298c', blocked_agent: 'IT Help Desk Agent' }),
    { block_scope: 'agent', agent_id: '44ba298c', agent_name: 'IT Help Desk Agent' },
  );
  // Name only (no id) is still an agent — the server keys on the folded name.
  assert.equal(accessRequestScope({ block_scope: 'agent', blocked_agent: 'Finance Bot' }).block_scope, 'agent');
  // 'agent' with NO identity would be a 400 at the server — downgrade, don't send it.
  assert.equal(accessRequestScope({ block_scope: 'agent' }).block_scope, 'app');
  // Whole-app block: blocked_agent is just the product name again and must NOT
  // be sent as an agent name; agent_id (a per-agent row blocking a whole app)
  // still travels for the admin's information.
  assert.deepEqual(
    accessRequestScope({ block_scope: 'app', agent_id: 'ag-9', blocked_agent: 'Claude' }),
    { block_scope: 'app', agent_id: 'ag-9', agent_name: '' },
  );
  assert.equal(accessRequestScope({ block_scope: 'panel' }).block_scope, 'panel');
  assert.equal(accessRequestScope({}).block_scope, 'app');
  assert.equal(accessRequestScope(undefined).block_scope, 'app');
});

test('sameAccessRequest: "already pending" is per host AND agent', async () => {
  const { sameAccessRequest, accessRequestScope } = await loadIdentityBlock();
  const agentA = accessRequestScope({ block_scope: 'agent', agent_id: 'A', blocked_agent: 'IT Help Desk Agent' });
  const agentB = accessRequestScope({ block_scope: 'agent', agent_id: 'B', blocked_agent: 'Finance Bot' });
  const wholeApp = accessRequestScope({ block_scope: 'app' });
  const pendingA = { tool_host: 'teams.microsoft.com', status: 'pending', block_scope: 'agent', agent_id: 'A', agent_name: 'IT Help Desk Agent' };

  assert.equal(sameAccessRequest(pendingA, 'teams.microsoft.com', agentA), true);
  assert.equal(sameAccessRequest(pendingA, 'TEAMS.microsoft.com', agentA), true, 'host compare is case-insensitive');
  assert.equal(sameAccessRequest(pendingA, 'teams.microsoft.com', agentB), false, 'agent A pending is not an answer about agent B');
  assert.equal(sameAccessRequest(pendingA, 'teams.microsoft.com', wholeApp), false);
  assert.equal(sameAccessRequest(pendingA, 'm365.cloud.microsoft', agentA), false);
  // A legacy /mine row with no block_scope is a whole-app row.
  assert.equal(sameAccessRequest({ tool_host: 'claude.ai', status: 'pending' }, 'claude.ai', wholeApp), true);
  // A name-only grant matches the same agent spelled with different spacing/case.
  const byName = accessRequestScope({ block_scope: 'agent', blocked_agent: 'IT Help  Desk agent' });
  assert.equal(sameAccessRequest({ tool_host: 'teams.microsoft.com', block_scope: 'agent', agent_name: 'IT Help Desk Agent' }, 'teams.microsoft.com', byName), true);
});

test('the access-request IPC handler POSTs block_scope + agent_name, and the status check is identity-aware', async () => {
  const src = await readFile(MAIN, 'utf8');
  const handler = src.slice(src.indexOf("ipcMain.handle('access-request',"), src.indexOf("ipcMain.handle('access-request-status',"));
  assert.match(handler, /const scope = accessRequestScope\(p\);/);
  assert.match(handler, /block_scope: scope\.block_scope,/);
  assert.match(handler, /agent_name: scope\.agent_name \|\| undefined,/);
  assert.match(handler, /agent_id: scope\.agent_id \|\| undefined,/);

  const status = src.slice(src.indexOf("ipcMain.handle('access-request-status',"), src.indexOf("ipcMain.handle('get-auto-launch'"));
  assert.match(status, /async \(_event, toolHost, identity\) =>/);
  assert.match(status, /rows\.filter\(\(r\) => sameAccessRequest\(r, toolHost, want\)\)/);
  // Any queued file used to read "pending" for every app; now only a matching one.
  assert.equal(/queued: fs\.existsSync\(/.test(status), false);
  assert.match(status, /sameAccessRequest\(q, toolHost, want\)/);
});

test('the dialog sends the block scope through, and asks about pending per block', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'renderer', 'access-request.js'), 'utf8');
  const submit = src.slice(src.indexOf('window.api.submitAccessRequest({'), src.indexOf('if (res?.ok)'));
  assert.match(submit, /block_scope: current\?\.block_scope,/);
  assert.match(submit, /blocked_agent: current\?\.blocked_agent,/);
  assert.match(src, /getAccessRequestStatus\(current\.tool_host, current\)/);

  const preload = await readFile(join(AGENT_DIR, 'electron', 'preload.js'), 'utf8');
  // Host stays the FIRST argument so an older main.js keeps working; only the
  // three identity fields cross the bridge — never the whole block payload.
  assert.match(preload, /getAccessRequestStatus: \(toolHost, identity\) => ipcRenderer\.invoke\('access-request-status', toolHost, identity \? \{/);
  assert.match(preload, /block_scope: identity\.block_scope, agent_id: identity\.agent_id, blocked_agent: identity\.blocked_agent,/);
});

// ── 2. one flusher per queued request ────────────────────────────────────────

async function withSyncModule(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cfai-arflow-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  try {
    const mod = await import(`${pathToFileURL(BLOCKED_SYNC).href}?arflow=${encodeURIComponent(dir)}`);
    await mkdir(join(dir, '.cloudfuze-aigov'), { recursive: true });
    return await fn(mod, dir);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

function writeFileSyncCompat(p, obj) { writeFileSync(p, JSON.stringify(obj)); }

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function stubPost(status, onCall) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    onCall?.(String(url), init);
    // Yield so concurrent flushers genuinely overlap.
    await new Promise((r) => setTimeout(r, 20));
    if (status === 'throw') throw new Error('ECONNREFUSED');
    return new Response(JSON.stringify({ ok: true }), { status, headers: { 'content-type': 'application/json' } });
  };
  return () => { globalThis.fetch = real; };
}

const QUEUED = { tool_host: 'claude.ai', tool_name: 'Claude', surface: 'desktop', block_scope: 'app', reason: 'r' };

test('two flushers racing on one queued request POST it exactly once', async () => {
  await withSyncModule(async (mod, dir) => {
    await writeFile(mod.PENDING_REQUEST_PATH, JSON.stringify({ ...QUEUED, queued_at: new Date().toISOString() }));
    const posts = [];
    const restore = stubPost(201, (url, init) => posts.push({ url, body: JSON.parse(init.body) }));
    try {
      await Promise.all([
        mod.flushPendingAccessRequest('http://srv', 'tok', silentLog),
        mod.flushPendingAccessRequest('http://srv', 'tok', silentLog),
      ]);
    } finally { restore(); }
    assert.equal(posts.length, 1, 'the queued request must be submitted once, not once per flusher');
    assert.equal(posts[0].url, 'http://srv/api/v1/access-requests');
    assert.equal(posts[0].body.block_scope, 'app');
    assert.equal('queued_at' in posts[0].body, false);
    assert.equal(existsSync(mod.PENDING_REQUEST_PATH), false);
    assert.deepEqual((await readdir(join(dir, '.cloudfuze-aigov'))).filter((n) => n.includes('sending')), [], 'no claim file left behind');
  });
});

test('a 5xx or offline flush puts the slot back; a 4xx verdict clears it', async () => {
  await withSyncModule(async (mod) => {
    for (const outcome of [503, 'throw']) {
      await writeFile(mod.PENDING_REQUEST_PATH, JSON.stringify({ ...QUEUED, queued_at: new Date().toISOString() }));
      const restore = stubPost(outcome);
      try { await mod.flushPendingAccessRequest('http://srv', 'tok', silentLog); } finally { restore(); }
      assert.equal(existsSync(mod.PENDING_REQUEST_PATH), true, `a ${outcome} must leave the request queued for the next tick`);
      assert.equal(JSON.parse(await readFile(mod.PENDING_REQUEST_PATH, 'utf8')).tool_host, 'claude.ai');
    }
    const restore = stubPost(409);
    try { await mod.flushPendingAccessRequest('http://srv', 'tok', silentLog); } finally { restore(); }
    assert.equal(existsSync(mod.PENDING_REQUEST_PATH), false, '409 (already pending) is an answer — stop retrying');
  });
});

test('a newer Submit that lands while a flush is failing is kept, not clobbered by the old one', async () => {
  await withSyncModule(async (mod) => {
    await writeFile(mod.PENDING_REQUEST_PATH, JSON.stringify({ ...QUEUED, queued_at: new Date().toISOString() }));
    const restore = stubPost('throw', () => {
      // The user submits again (for another app) while the first is in flight.
      // Synchronous on purpose: it must land before the flush releases its claim.
      writeFileSyncCompat(mod.PENDING_REQUEST_PATH, { ...QUEUED, tool_host: 'chatgpt.com', queued_at: new Date().toISOString() });
    });
    try { await mod.flushPendingAccessRequest('http://srv', 'tok', silentLog); } finally { restore(); }
    assert.equal(JSON.parse(await readFile(mod.PENDING_REQUEST_PATH, 'utf8')).tool_host, 'chatgpt.com');
  });
});

test('OsMonitor runs no private sync/flush; every entry point starts the one shared sync', async () => {
  const idx = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  for (const gone of ['_refreshBlockedAgents', '_flushPendingAccessRequest', '_blockedAgentsInterval', '_handleAccessRequestStatus', '_handleAccessRequestSubmit']) {
    assert.equal(idx.includes(gone), false, `${gone} must not come back — it duplicated blocked-agents-sync.js`);
  }
  // The dead legacy status check read the FLEET-wide admin list.
  assert.equal(/access-requests\?tool_host=/.test(idx), false);

  const tracker = await readFile(join(AGENT_DIR, 'src', 'claude_tracker', 'index.js'), 'utf8');
  assert.match(tracker, /await import\('\.\.\/os_monitor\/blocked-agents-sync\.js'\)/);
  assert.match(tracker, /startBlockedAgentsSync\(\{ serverUrl: SERVER_URL, token: creds\.token, log \}\);/);
  const cli = await readFile(join(AGENT_DIR, 'src', 'index.js'), 'utf8');
  assert.match(cli, /startBlockedAgentsSync\(\{/);
  const runner = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
  assert.match(runner, /startBlockedAgentsSync\(\{ serverUrl: creds\.serverUrl, token: creds\.token, log \}\);/);
});
