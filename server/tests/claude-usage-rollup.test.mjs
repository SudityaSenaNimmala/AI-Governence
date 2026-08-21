// GET /api/v1/claude-usage — the per-person Claude rollup.
//
// The regression this pins down: the route reads pre-grouped rows out of Mongo
// rather than every raw document (a .find().toArray() here took 60.7s against
// 19k token rows and left the tab spinning forever). One returned row therefore
// stands for MANY events, so the sums have to add the group's own counts —
// `prompts += row.prompts`, `requests += row.requests` — not 1 per row. Getting
// that wrong still produces a plausible-looking page: every figure is simply too
// small, with nothing to say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountClaudeUsage } from '../src/routes/claude-usage.js';
import { CLAUDE_CODE_SURFACE } from '../src/lib/claude-clients.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400_000).toISOString();

async function withServer(seed, fn) {
  const db = createFakeDb();
  await seed(db);

  const app = express();
  app.use(express.json());
  mountClaudeUsage(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await fn({ db, get: (p) => fetch(`http://127.0.0.1:${server.address().port}${p}`) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// One person, one machine, two Claude surfaces. Browser prompts carry no token
// telemetry (so they are estimated from content_length); CLI usage does (so it is
// measured). Both halves share a machine, which is what folds them into one row.
const seed = async (db) => {
  await db.collection('machines').insertOne({
    id: 'm1', hostname: 'SATYA', user: 'SatyaPinniti', platform: 'win32',
  });

  // 3 browser prompts inside the window, 400 chars each, plus one 200 days old
  // that only the all-time query should see.
  for (const [i, when] of [iso(1), iso(2), iso(3), iso(200)].entries()) {
    await db.collection('dlp_events').insertOne({
      id: `e${i}`, machine_id: 'm1', event_kind: 'prompt_submit',
      source: 'claude_tracker', ai_service: 'Claude',
      content_length: 400, occurred_at: when,
    });
  }

  // 2 CLI prompts.
  for (const [i, when] of [iso(1), iso(2)].entries()) {
    await db.collection('dlp_events').insertOne({
      id: `c${i}`, machine_id: 'm1', event_kind: 'prompt_submit',
      source: 'claude_code_cli', ai_service: 'Claude Code', occurred_at: when,
    });
  }

  // 2 API requests that group together — same service, source, machine, email
  // and model — so a per-row increment would report 1 request instead of 2.
  for (const [i, when] of [iso(1), iso(2)].entries()) {
    await db.collection('ai_token_usage').insertOne({
      id: `u${i}`, machine_id: 'm1', user_email: 'satya@cloudfuze.com',
      source: 'claude_code_cli', ai_service: 'Claude Code', model: 'claude-opus-4-6',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 1000,
      cache_creation_tokens: 10, total_tokens: 1160, cost_usd: 0.25,
      occurred_at: when,
    });
  }
};

test('prompts and requests sum per group, not once per returned row', async () => {
  await withServer(seed, async ({ get }) => {
    const res = await get('/api/v1/claude-usage?days=30');
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.totals.prompts, 5, '3 browser + 2 CLI prompts');
    assert.equal(body.totals.measured_requests, 2, 'both API requests counted, not one per group');
    assert.equal(body.totals.measured_tokens, 2320, '2 x 1160');
    assert.equal(body.totals.measured_cost_usd, 0.5, '2 x 0.25');

    const browser = body.surfaces.find((s) => s.surface === 'Claude (browser)');
    assert.equal(browser.prompts, 3);
    // 3 x 400 chars / 4 = 300 input, x3 output = 900.
    assert.equal(browser.estimated_tokens, 1200);
    assert.equal(browser.measured_tokens, 0, 'an estimate never lands in the measured column');

    const cli = body.surfaces.find((s) => s.surface === CLAUDE_CODE_SURFACE);
    assert.equal(cli.prompts, 2);
    assert.equal(cli.measured_requests, 2);
    assert.equal(cli.estimated_tokens, 0, 'measured usage is never also estimated');
  });
});

test('one person on one machine is a single row across surfaces', async () => {
  await withServer(seed, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();

    assert.equal(body.systems.length, 1, 'browser and CLI fold into one person');
    const [person] = body.systems;
    assert.equal(person.label, 'SatyaPinniti');
    assert.equal(person.prompts, 5);
    // The pre-rename key is emitted alongside the new one for a release, so a
    // consumer already indexing by 'Claude Code (CLI)' keeps reading a number
    // instead of silently getting a blank column.
    assert.deepEqual(person.by_surface, {
      'Claude (browser)': 3,
      [CLAUDE_CODE_SURFACE]: 2,
      'Claude Code (CLI)': 2,
    });
    assert.equal(body.totals.users, 1);
    assert.equal(body.unattributed_rows, 0);
  });
});

test('the period filter bounds the window it says it does', async () => {
  await withServer(seed, async ({ get }) => {
    const month = await (await get('/api/v1/claude-usage?days=30')).json();
    const all = await (await get('/api/v1/claude-usage')).json();

    assert.equal(month.period_days, 30);
    assert.equal(all.period_days, null);
    assert.equal(month.totals.prompts, 5, 'the 200-day-old prompt is outside 30 days');
    assert.equal(all.totals.prompts, 6, 'and inside all-time');
  });
});

// The roster half of the table: a paid seat with no usage is the row the whole
// screen exists to produce, so absence of usage must not mean absence of a row.
test('an enrolled person with no usage is listed at zero', async () => {
  await withServer(async (db) => {
    await seed(db);
    // Same shape the tracker enrols with: real hostname, real OS user, no events.
    await db.collection('machines').insertOne({
      id: 'm2', hostname: 'IDLE-PC', user: 'QuietColleague', platform: 'win32',
      last_seen: new Date('2026-08-10T09:00:00Z'),
    });
  }, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();

    const idle = body.systems.find((s) => s.label === 'QuietColleague');
    assert.ok(idle, 'an enrolled machine with no prompts still gets a row');
    assert.equal(idle.prompts, 0);
    assert.equal(idle.active, false);
    assert.equal(idle.hostname, 'IDLE-PC');
    assert.equal(idle.last_seen, '2026-08-10T09:00:00.000Z', 'last contact is reported, so "installed but idle" is distinguishable from "gone"');
    assert.deepEqual(idle.by_surface, {});

    assert.equal(body.totals.enrolled_users, 2);
    assert.equal(body.totals.active_users, 1);
    assert.equal(body.totals.idle_users, 1);
    // The person who DID use Claude is unaffected.
    assert.equal(body.systems.find((s) => s.label === 'SatyaPinniti').prompts, 5);
  });
});

test('idle rows sort last, so the decision collects at the bottom', async () => {
  await withServer(async (db) => {
    await seed(db);
    for (const [id, host, user] of [['a', 'AAA-PC', 'Zoe'], ['b', 'BBB-PC', 'Adam']]) {
      await db.collection('machines').insertOne({ id, hostname: host, user, platform: 'win32' });
    }
  }, async ({ get }) => {
    const rows = (await (await get('/api/v1/claude-usage?days=30')).json()).systems;
    assert.equal(rows[0].label, 'SatyaPinniti', 'the busiest seat is first');
    // Ties break on name, not Map insertion order, so the list is stable between
    // requests rather than reshuffling for no reason.
    assert.deepEqual(rows.slice(1).map((r) => r.label), ['Adam', 'Zoe']);
  });
});

test('rows that name nobody are not invented as colleagues', async () => {
  await withServer(async (db) => {
    await db.collection('machines').insertOne({ id: 'real', hostname: 'REAL-PC', user: 'Someone', platform: 'win32' });
    // Seed/smoke-test records: a hostname and nothing else. Real enrolments always
    // carry an OS user, so this is what separates them.
    await db.collection('machines').insertOne({ id: 'seed1', hostname: 'prod-ai-server-1' });
    await db.collection('machines').insertOne({ id: 'seed2', hostname: 'qa-test-host' });
    // A browser that enrolled before it could learn the machine name.
    await db.collection('machines').insertOne({ id: 'ua', hostname: 'Mozilla-browser-extension' });
    // Claude Code's synthetic per-account record — an account, not a system.
    await db.collection('machines').insertOne({ id: 'clicode:x@y.com', hostname: 'Claude Code CLI', user: 'x@y.com' });
    // Debug enrolments are excluded by the same rule the rest of the route uses.
    await db.collection('machines').insertOne({ id: 'dbg', hostname: 'debug-box', user: 'tester', platform: 'win32' });
  }, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    assert.deepEqual(body.systems.map((s) => s.label), ['Someone']);
    assert.equal(body.totals.enrolled_users, 1);
  });
});

// Claude Code prompts carry the client they were typed in (`terminal`, from the
// CLI's own terminal.type telemetry). These pin down that the split is reported,
// that it does not leak into surfaces that cannot have one, and — the one that
// matters most — that a prompt whose client was never reported reads Unknown
// instead of being quietly counted as a terminal session, which would understate
// IDE usage while looking precise.
const clientSeed = async (db) => {
  await db.collection('machines').insertOne({
    id: 'm1', hostname: 'SATYA', user: 'SatyaPinniti', platform: 'win32',
  });
  const cli = (id, terminal, when) => db.collection('dlp_events').insertOne({
    id, machine_id: 'm1', event_kind: 'prompt_submit',
    source: 'claude_code_cli', ai_service: 'Claude Code',
    content_length: 100, terminal, occurred_at: when,
  });
  await cli('v1', 'vscode', iso(1));
  await cli('v2', 'vscode', iso(1));
  await cli('v3', 'vscode', iso(2));
  await cli('c1', 'cursor', iso(1));
  await cli('t1', 'xterm-256color', iso(1));
  await cli('u1', null, iso(1));           // telemetry never arrived for this one

  // A browser prompt, which has no client concept at all.
  await db.collection('dlp_events').insertOne({
    id: 'b1', machine_id: 'm1', event_kind: 'prompt_submit',
    source: 'claude_tracker', ai_service: 'Claude',
    content_length: 400, occurred_at: iso(1),
  });
};

test('Claude Code prompts are split by client', async () => {
  await withServer(clientSeed, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    const code = body.surfaces.find((s) => s.surface === CLAUDE_CODE_SURFACE);

    assert.equal(code.prompts, 6, 'every Claude Code prompt is counted once');
    const byClient = Object.fromEntries(code.clients.map((c) => [c.client, c.prompts]));
    assert.deepEqual(byClient, {
      'VS Code': 3,
      Cursor: 1,
      Terminal: 1,
      Unknown: 1,
    });
    // The split has to add back up to the surface, or one of the two is wrong.
    assert.equal(
      code.clients.reduce((n, c) => n + c.prompts, 0), code.prompts,
      'client counts reconcile with the surface total',
    );
  });
});

test('IDE clients sort ahead of Terminal, and Unknown sorts last', async () => {
  await withServer(clientSeed, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    const code = body.surfaces.find((s) => s.surface === CLAUDE_CODE_SURFACE);
    assert.deepEqual(code.clients.map((c) => c.client), ['VS Code', 'Cursor', 'Terminal', 'Unknown']);
  });
});

test('surfaces with no client concept report an empty split, not an Unknown row', async () => {
  await withServer(clientSeed, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    const browser = body.surfaces.find((s) => s.surface === 'Claude (browser)');
    assert.equal(browser.prompts, 1);
    assert.deepEqual(browser.clients, [], 'a browser prompt has no client to report');
  });
});

test('the per-person breakdown carries that person\'s own client mix', async () => {
  await withServer(clientSeed, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    const code = body.surfaces.find((s) => s.surface === CLAUDE_CODE_SURFACE);
    const [person] = code.breakdown;
    assert.equal(person.label, 'SatyaPinniti');
    assert.deepEqual(
      Object.fromEntries(person.clients.map((c) => [c.client, c.prompts])),
      { 'VS Code': 3, Cursor: 1, Terminal: 1, Unknown: 1 },
    );
  });
});

test('the three primary surfaces are always present, even at zero', async () => {
  await withServer(async (db) => {
    await db.collection('machines').insertOne({ id: 'm1', hostname: 'SATYA', user: 'SatyaPinniti' });
  }, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    const names = body.surfaces.map((s) => s.surface);
    for (const expected of ['Claude Desktop', 'Claude (browser)', CLAUDE_CODE_SURFACE]) {
      assert.ok(names.includes(expected), `${expected} is reported even with no activity`);
    }
    assert.equal(body.totals.prompts, 0);
  });
});
