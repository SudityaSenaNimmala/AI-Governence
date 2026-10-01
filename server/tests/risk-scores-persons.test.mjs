// Risk scores are per PERSON, not per employee_profile, and they recompute on
// a schedule.
//
// THE DEFECT. resolveProfiles mints one profile per agent machine/OS-user pair
// and one per unmatched browser extension, so "Employees by Risk" listed the
// same human several times, each row scored over only a slice of their
// machines. And scores only moved when an admin clicked Compute.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountRiskScore, computeAllScores, groupPersons } from '../src/routes/risk-score.js';
import {
  runRiskScorePass, startRiskScoreScheduler, riskIntervalMsFromEnv,
} from '../src/lib/risk-score-scheduler.js';
import { responseStore } from '../src/lib/response-budget.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

async function seedDb(seed) {
  const db = createFakeDb();
  await seed(db);
  return db;
}

async function withServer(db, fn) {
  responseStore.clear();
  const app = express();
  app.use(express.json());
  mountRiskScore(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      get: async (p) => (await fetch(base + p)).json(),
      compute: async () => (await fetch(base + '/api/v1/risk-scores/compute', { method: 'POST' })).json(),
    });
  } finally {
    await new Promise((r) => server.close(r));
    responseStore.clear();
  }
}

const block = (id, machine_id) => ({
  id, machine_id, occurred_at: iso(5), event_kind: 'enforcement_block', secret_class: 'high',
});

// ── Grouping ───────────────────────────────────────────────────────────

test('same email across an agent profile and an extension profile → one row', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('machines').insertMany([
      { id: 'm-agent', user: 'jdoe', hostname: 'LAPTOP-1', platform: 'win32' },
      { id: 'm-ext', user: 'Jane.Doe@x.com', hostname: 'chrome-browser-extension' },
    ]);
    await db.collection('employee_profiles').insertMany([
      { id: 'pa', display_name: 'Jane Doe', email: 'jane.doe@x.com', os_user: 'jdoe', machine_ids: ['m-agent'], sources: ['agent'] },
      { id: 'pe', display_name: 'Jane Doe', email: null, machine_ids: ['m-ext'], sources: ['extension'] },
    ]);
  });
  await withServer(db, async ({ get, compute }) => {
    const body = await compute();
    assert.equal(body.computed, 1, 'one person scored');
    assert.equal(body.profiles_updated, 2, 'written to both member profiles');
    const rows = await get('/api/v1/risk-scores');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].merged_profile_ids.sort(), ['pa', 'pe']);
    assert.deepEqual(rows[0].sources.sort(), ['agent', 'extension']);
    assert.equal(rows[0].person_key, 'jane.doe@x.com');
    assert.equal(rows[0].detected_name, 'jdoe');
  });
});

test('same OS user on two machines (DOMAIN\\ prefix, case) → one row', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('machines').insertMany([
      { id: 'm1', user: 'CORP\\Bob', hostname: 'DESK-1' },
      { id: 'm2', user: 'bob', hostname: 'LAPTOP-2' },
    ]);
    await db.collection('employee_profiles').insertMany([
      { id: 'p1', display_name: 'Bob', machine_ids: ['m1'], sources: ['agent'] },
      { id: 'p2', display_name: 'Bob', machine_ids: ['m2'], sources: ['agent'] },
    ]);
  });
  await withServer(db, async ({ get, compute }) => {
    await compute();
    const rows = await get('/api/v1/risk-scores');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].person_key, 'bob');
  });
});

test('different emails with the same display name stay two people', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('employee_profiles').insertMany([
      { id: 'p1', display_name: 'Alex Smith', email: 'alex.smith@a.com', machine_ids: ['m1'] },
      { id: 'p2', display_name: 'Alex Smith', email: 'alex.smith@b.com', machine_ids: ['m2'] },
    ]);
  });
  await withServer(db, async ({ get, compute }) => {
    await compute();
    assert.equal((await get('/api/v1/risk-scores')).length, 2);
    assert.equal((await get('/api/v1/risk-scores/summary')).total_employees, 2);
  });
});

test('"Browser User" profiles never merge, even with a shared machine user', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('machines').insertMany([
      { id: 'e1', user: 'shared', hostname: 'x-browser-extension' },
      { id: 'e2', user: 'shared', hostname: 'y-browser-extension' },
    ]);
    await db.collection('employee_profiles').insertMany([
      { id: 'b1', display_name: 'Browser User (aaaa1111)', machine_ids: ['e1'], sources: ['extension'] },
      { id: 'b2', display_name: 'Browser User (bbbb2222)', machine_ids: ['e2'], sources: ['extension'] },
    ]);
  });
  await withServer(db, async ({ get, compute }) => {
    await compute();
    const rows = await get('/api/v1/risk-scores');
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.is_identified === false));
    const summary = await get('/api/v1/risk-scores/summary');
    assert.equal(summary.unidentified, 2);
    assert.equal(summary.total_employees, 0);
  });
});

test('grouping is transitive: email links A~B, username links B~C', () => {
  const byId = new Map([['m2', { id: 'm2', user: 'cuser' }], ['m3', { id: 'm3', user: 'cuser' }]]);
  const groups = groupPersons([
    { id: 'a', display_name: 'C', email: 'c@x.com' },
    // b's username is its OWN (os_user) — a machine's user only stands in for a
    // profile that has no identity of its own.
    { id: 'b', display_name: 'C', email: 'c@x.com', os_user: 'cuser', machine_ids: ['m2'] },
    { id: 'c', display_name: 'C', machine_ids: ['m3'] },
  ], byId);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].person_key, 'c@x.com');
});

test('before the first compute, reads already group (no person_key yet)', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('employee_profiles').insertMany([
      { id: 'p1', display_name: 'Dana', email: 'dana@x.com', risk_score: 40, risk_level: 'medium' },
      { id: 'p2', display_name: 'Dana', email: 'DANA@x.com', risk_score: 70, risk_level: 'high' },
    ]);
  });
  await withServer(db, async ({ get }) => {
    const rows = await get('/api/v1/risk-scores');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'p2', 'highest-scoring member represents the person');
    assert.equal(rows[0].risk_score, 70);
  });
});

// ── Demo personas (real data only — commit 7500ded) ────────────────────
//
// Live shape: leftover demo profiles absorbed real people's extensions, so
// Suditya was merged into a "JamesCarter" row and Pravallika's data showed
// under an Emily profile.

const SUDITYA_EXT = 'dc769a1f-0000-4000-8000-000000000001';
const PRAVALLIKA_EXT = '494e23e4-0000-4000-8000-000000000002';

const demoSeed = async (db) => {
  await db.collection('machines').insertMany([
    { id: 'm-james', hostname: 'JAMES', user: 'JamesCarter', platform: 'win32' },
    { id: 'm-james-ext', hostname: 'JAMES-browser-extension', user: 'JamesCarter' },
    { id: 'm-emily', hostname: 'EMILY', user: 'EmilyRodriguez', platform: 'win32' },
    { id: 'm-sarah', hostname: 'SARAH', user: '' },
    { id: SUDITYA_EXT, hostname: 'chrome-browser-extension', user: 'SudityaNimmala' },
    { id: PRAVALLIKA_EXT, hostname: 'chrome-browser-extension', user: 'Pravallikapunumalli' },
  ]);
  await db.collection('employee_profiles').insertMany([
    { id: 'p-james', display_name: 'James Carter', resolve_key: 'agent:james:jamescarter', os_user: 'JamesCarter',
      machine_ids: ['m-james', 'm-james-ext', SUDITYA_EXT], sources: ['agent', 'extension'] },
    { id: 'p-suditya', display_name: 'Suditya Nimmala', resolve_key: 'ext:' + SUDITYA_EXT,
      machine_ids: [SUDITYA_EXT], sources: ['extension'] },
    { id: 'p-emily', display_name: 'Emily Rodriguez', resolve_key: 'agent:emily:emilyrodriguez', os_user: 'EmilyRodriguez',
      machine_ids: ['m-emily', PRAVALLIKA_EXT], sources: ['agent', 'extension'] },
    { id: 'p-pravallika', display_name: 'Pravallikapunumalli', resolve_key: 'ext:' + PRAVALLIKA_EXT,
      machine_ids: [PRAVALLIKA_EXT], sources: ['extension'] },
    // No identity of its own, only a demo machine → also demo.
    { id: 'p-sarah', display_name: 'Sarah Mitchell', machine_ids: ['m-sarah'], sources: ['agent'] },
  ]);
  await db.collection('dlp_events').insertMany([
    block('ev-james', 'm-james'), block('ev-emily', 'm-emily'),
    block('ev-s', SUDITYA_EXT), block('ev-p', PRAVALLIKA_EXT),
  ]);
};

test('demo personas never absorb real people: rows are Suditya and Pravallika only', async () => {
  const db = await seedDb(demoSeed);
  await withServer(db, async ({ get, compute }) => {
    const body = await compute();
    assert.equal(body.computed, 2, 'two real people scored, no demo persona');
    assert.ok(body.scores.every((s) => !/james|emily|sarah/i.test(String(s.detected_name) + s.person_key)));

    const rows = await get('/api/v1/risk-scores');
    assert.equal(rows.length, 2);
    const byKey = Object.fromEntries(rows.map((r) => [r.person_key, r]));
    assert.deepEqual(Object.keys(byKey).sort(), ['pravallikapunumalli', 'sudityanimmala']);

    const s = byKey.sudityanimmala;
    assert.equal(s.detected_name, 'SudityaNimmala');
    assert.equal(s.display_name, 'Suditya Nimmala');
    assert.deepEqual(s.merged_profile_ids, ['p-suditya'], 'the James profile is not merged in');
    assert.equal(s.risk_factors.dlp_violations.raw, 1, 'only Suditya\'s own events');

    const p = byKey.pravallikapunumalli;
    assert.equal(p.detected_name, 'Pravallikapunumalli');
    assert.deepEqual(p.merged_profile_ids, ['p-pravallika'], 'the Emily profile is not merged in');
    assert.equal(p.risk_factors.dlp_violations.raw, 1);

    const summary = await get('/api/v1/risk-scores/summary');
    assert.equal(summary.total_employees, 2);
    assert.equal(summary.not_assessed, 0, 'demo personas are not counted as unassessed people');
    assert.equal(summary.unidentified, 0);

    // Demo profiles are left as they were — skipped, not written.
    const james = db._rows('employee_profiles').find((x) => x.id === 'p-james');
    assert.equal(james.risk_score, undefined);

    // The detail route for a real person carries no demo profile or machine.
    const detail = await get('/api/v1/risk-scores/' + s.id);
    assert.deepEqual(detail.merged_profile_ids, ['p-suditya']);
    assert.deepEqual(detail.recent_events.map((e) => e.id), ['ev-s']);
  });
});

test('a stale person_key on a demo profile does not leak into the detail view', async () => {
  const db = await seedDb(async (db) => {
    await demoSeed(db);
    // Old compute stamped both with the same key.
    await db.collection('employee_profiles').updateMany(
      { id: { $in: ['p-james', 'p-suditya'] } }, { $set: { person_key: 'jamescarter' } });
  });
  await withServer(db, async ({ get }) => {
    const detail = await get('/api/v1/risk-scores/p-suditya');
    assert.deepEqual(detail.merged_profile_ids, ['p-suditya']);
    assert.deepEqual(detail.recent_events.map((e) => e.id), ['ev-s']);
  });
});

test('a real machine with a demo hostname but a real user is NOT demo', async () => {
  const { isDemoMachine, isDemoIdentity } = await import('../src/lib/demo-personas.js');
  assert.equal(isDemoMachine({ hostname: 'EMILY', user: 'Pravallikapunumalli' }), false);
  assert.equal(isDemoMachine({ hostname: 'EMILY', user: 'EmilyRodriguez' }), true);
  assert.equal(isDemoMachine({ hostname: 'EMILY' }), true, 'host match + empty user');
  assert.equal(isDemoMachine({ hostname: 'JAMES-browser-extension', user: 'jamescarter' }), true);
  assert.equal(isDemoMachine({ hostname: 'LAPTOP-1', user: 'JamesCarter' }), false, 'host must match too');
  assert.equal(isDemoIdentity('CORP\\EmilyRodriguez'), true);
  assert.equal(isDemoIdentity('Sarah.Mitchell@CloudFuze.com'), true);
  assert.equal(isDemoIdentity('James Carter'), true);
  assert.equal(isDemoIdentity('pravallikapunumalli'), false);
  assert.equal(isDemoIdentity(''), false);

  const db = await seedDb(async (db) => {
    await db.collection('machines').insertOne(
      { id: 'f0031ea6', hostname: 'EMILY', user: 'Pravallikapunumalli', platform: 'win32', type: 'desktop-agent' });
    await db.collection('employee_profiles').insertOne(
      { id: 'p-pc', display_name: 'Pravallikapunumalli', resolve_key: 'agent:emily:pravallikapunumalli',
        os_user: 'Pravallikapunumalli', hostname: 'EMILY', machine_ids: ['f0031ea6'], sources: ['agent'] });
    await db.collection('dlp_events').insertOne(block('ev-pc', 'f0031ea6'));
  });
  await withServer(db, async ({ get, compute }) => {
    await compute();
    const rows = await get('/api/v1/risk-scores');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detected_name, 'Pravallikapunumalli');
    assert.equal(rows[0].risk_factors.dlp_violations.raw, 1, 'its events still count');
  });
});

test('one borrowed machine does not bridge two real people', () => {
  const byId = new Map([
    ['ma', { id: 'ma', user: 'alice', hostname: 'A-PC' }],
    ['mb', { id: 'mb', user: 'bob', hostname: 'B-PC' }],
  ]);
  const groups = groupPersons([
    { id: 'pa', display_name: 'Alice', resolve_key: 'agent:a-pc:alice', os_user: 'alice', machine_ids: ['ma', 'mb'] },
    { id: 'pb', display_name: 'Bob', resolve_key: 'agent:b-pc:bob', os_user: 'bob', machine_ids: ['mb'] },
  ], byId);
  assert.equal(groups.length, 2);
});

// ── Per-person score ───────────────────────────────────────────────────

test('a person is scored over the UNION of their machines', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('machines').insertMany([
      { id: 'm1', user: 'eve', hostname: 'H1' },
      { id: 'm2', user: 'eve', hostname: 'H2' },
    ]);
    await db.collection('employee_profiles').insertMany([
      { id: 'p1', display_name: 'Eve', machine_ids: ['m1'], sources: ['agent'] },
      { id: 'p2', display_name: 'Eve', machine_ids: ['m2'], sources: ['agent'] },
    ]);
    await db.collection('dlp_events').insertMany([block('e1', 'm1'), block('e2', 'm2'), block('e3', 'm2')]);
  });
  await withServer(db, async ({ get, compute }) => {
    const body = await compute();
    assert.equal(body.scores[0].factors.dlp_violations.raw, 3, 'events from both machines count');
    const p1 = db._rows('employee_profiles').find((p) => p.id === 'p1');
    const p2 = db._rows('employee_profiles').find((p) => p.id === 'p2');
    assert.equal(p1.risk_score, p2.risk_score, 'every member carries the person score');
    assert.equal(p1.person_key, 'eve');
    assert.equal(p2.person_key, 'eve');

    // The detail of the representative row covers both machines.
    const [row] = await get('/api/v1/risk-scores');
    const detail = await get('/api/v1/risk-scores/' + row.id);
    assert.equal(detail.recent_events.length, 3);
    assert.deepEqual(detail.merged_profile_ids.sort(), ['p1', 'p2']);
  });
});

test('summary counts persons, not profiles', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('employee_profiles').insertMany([
      { id: 'p1', display_name: 'F', email: 'f@x.com', risk_score: 20, risk_level: 'low' },
      { id: 'p2', display_name: 'F', email: 'f@x.com', risk_score: 20, risk_level: 'low' },
      { id: 'p3', display_name: 'F', email: 'f@x.com', risk_score: 20, risk_level: 'low' },
      { id: 'p4', display_name: 'G', email: 'g@x.com', risk_score: 80, risk_level: 'high' },
      { id: 'p5', display_name: 'H', email: 'h@x.com', risk_score: null },
      { id: 'p6', display_name: 'H', email: 'h@x.com' },
    ]);
  });
  await withServer(db, async ({ get }) => {
    const s = await get('/api/v1/risk-scores/summary');
    assert.equal(s.total_employees, 2);
    assert.equal(s.average_score, 50, 'averaged over persons (20, 80), not profiles');
    assert.deepEqual(s.distribution, { low: 1, medium: 0, high: 1, critical: 0 });
    assert.equal(s.not_assessed, 1, 'H is one unassessed person, not two');
  });
});

// ── Guardrails ─────────────────────────────────────────────────────────

const riskySeed = (n) => async (db) => {
  await db.collection('machines').insertMany([{ id: 'm1', user: 'ivan' }, { id: 'm2', user: 'ivan' }]);
  await db.collection('employee_profiles').insertMany([
    { id: 'p1', display_name: 'Ivan', machine_ids: ['m1'], sources: ['extension'] },
    { id: 'p2', display_name: 'Ivan', machine_ids: ['m2'], sources: ['extension'] },
  ]);
  const evs = [];
  for (let i = 0; i < n; i++) evs.push({ ...block('x' + i, 'm1'), secret_class: 'critical' });
  for (let i = 0; i < 10; i++) await db.collection('tool_usage').insertOne({ machine_id: 'm2', tool_key: `s${i}.ai`, last_used_at: new Date() });
  await db.collection('dlp_events').insertMany(evs);
};

test('the high-risk webhook fires once per person, only on the transition', async () => {
  const db = await seedDb(riskySeed(20));
  const first = await computeAllScores(db, { source: 'test' });
  assert.ok(['high', 'critical'].includes(first.scores[0].level), `expected high/critical, got ${first.scores[0].level}`);
  assert.equal(first.alerts_fired, 1, 'one alert for the person, not one per profile');

  const second = await computeAllScores(db, { source: 'test' });
  assert.equal(second.alerts_fired, 0, 'still high — no repeat alert every run');
});

test('history: one row per person, deduped when nothing changed, refreshed after 24h', async () => {
  const db = await seedDb(riskySeed(3));
  const first = await computeAllScores(db, { source: 'test' });
  assert.equal(first.history_written, 1, 'one history row per person');
  assert.equal(db._rows('risk_scores').length, 1);
  assert.equal(db._rows('risk_scores')[0].display_name, 'Ivan');
  assert.equal(db._rows('risk_scores')[0].detected_name, 'ivan');

  await computeAllScores(db, { source: 'test' });
  assert.equal(db._rows('risk_scores').length, 1, 'unchanged score → no new row');

  // Age the last history write past 24h.
  const old = new Date(Date.now() - 25 * 3600 * 1000);
  await db.collection('employee_profiles').updateMany({}, { $set: { risk_history_at: old } });
  await computeAllScores(db, { source: 'test' });
  assert.equal(db._rows('risk_scores').length, 2, 'a day-old row is refreshed');

  // A real change writes immediately.
  await db.collection('dlp_events').insertOne(block('new', 'm2'));
  await computeAllScores(db, { source: 'test' });
  assert.equal(db._rows('risk_scores').length, 3);
});

// ── Scheduler ──────────────────────────────────────────────────────────

test('scheduler pass skips while a compute is already in flight', async () => {
  const db = await seedDb(riskySeed(1));
  const manual = computeAllScores(db, { source: 'manual' });
  const pass = await runRiskScorePass(db);
  assert.equal(pass.skipped, true);
  await manual;
  // And skip when its own previous tick is still running.
  assert.equal((await runRiskScorePass(db, { running: true })).skipped, true);
  // A manual POST arriving mid-run joins rather than starting a second run.
  const a1 = computeAllScores(db);
  const a2 = computeAllScores(db);
  assert.equal(a1, a2);
  await a1;
});

test('scheduler pass resolves profiles then scores them', async () => {
  const db = await seedDb(async (db) => {
    await db.collection('machines').insertOne({ id: 'm1', user: 'kim', hostname: 'KIM-PC', platform: 'win32' });
    await db.collection('dlp_events').insertOne(block('e1', 'm1'));
  });
  const realLog = console.log; console.log = () => {};
  try {
    const r = await runRiskScorePass(db);
    assert.equal(r.computed, 1);
  } finally { console.log = realLog; }
  const prof = db._rows('employee_profiles');
  assert.equal(prof.length, 1);
  assert.equal(typeof prof[0].risk_score, 'number');
  assert.equal(prof[0].person_key, 'kim');
});

test('scheduler is disabled by RISK_SCORE_INTERVAL_MIN=0', () => {
  assert.equal(riskIntervalMsFromEnv({ RISK_SCORE_INTERVAL_MIN: '0' }), 0);
  assert.equal(riskIntervalMsFromEnv({}), 15 * 60 * 1000);
  assert.equal(riskIntervalMsFromEnv({ RISK_SCORE_INTERVAL_MIN: 'abc' }), 15 * 60 * 1000);
  assert.equal(riskIntervalMsFromEnv({ RISK_SCORE_INTERVAL_MIN: '5' }), 5 * 60 * 1000);

  const realLog = console.log; console.log = () => {};
  let touched = false;
  const db = { collection() { touched = true; throw new Error('must not run'); } };
  try {
    const stop = startRiskScoreScheduler(db, { intervalMs: 0, firstRunDelayMs: 0 });
    assert.equal(typeof stop, 'function');
    stop();
  } finally { console.log = realLog; }
  assert.equal(touched, false);
});

test('a failing scheduled pass never throws', async () => {
  const db = { collection() { throw new Error('db down'); } };
  const realErr = console.error; console.error = () => {};
  try {
    const r = await runRiskScorePass(db);
    assert.match(r.error, /db down/);
  } finally { console.error = realErr; }
});
