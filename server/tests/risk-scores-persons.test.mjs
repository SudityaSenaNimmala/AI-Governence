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
    { id: 'b', display_name: 'C', email: 'c@x.com', machine_ids: ['m2'] },
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
