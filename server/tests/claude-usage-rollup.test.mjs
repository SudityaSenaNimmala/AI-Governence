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

    const cli = body.surfaces.find((s) => s.surface === 'Claude Code (CLI)');
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
    assert.deepEqual(person.by_surface, { 'Claude (browser)': 3, 'Claude Code (CLI)': 2 });
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

test('the three primary surfaces are always present, even at zero', async () => {
  await withServer(async (db) => {
    await db.collection('machines').insertOne({ id: 'm1', hostname: 'SATYA', user: 'SatyaPinniti' });
  }, async ({ get }) => {
    const body = await (await get('/api/v1/claude-usage?days=30')).json();
    const names = body.surfaces.map((s) => s.surface);
    for (const expected of ['Claude Desktop', 'Claude (browser)', 'Claude Code (CLI)']) {
      assert.ok(names.includes(expected), `${expected} is reported even with no activity`);
    }
    assert.equal(body.totals.prompts, 0);
  });
});
