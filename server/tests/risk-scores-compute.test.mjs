// POST /api/v1/risk-scores/compute — scores are right, and the query count does
// not grow with the number of people.
//
// The regression this pins down: the handler issued SIX sequential Mongo queries
// per profile (four countDocuments, one find, plus the two volume-window counts)
// and then TWO sequential writes, all inside a sequential for-loop. At 48 real
// profiles that is 384 serialized round trips against Atlas over a 90-day window.
// Measured at ~46ms per round trip that is ~18s from a developer machine; on the
// deploy host it blew past nginx's 120s proxy_read_timeout and the browser got a
// 504 from /api/v1/risk-scores/compute — while the run held the box long enough
// that concurrent /api/v1/identity/resolve and /api/v1/access-exceptions requests
// failed alongside it.
//
// So there are two things worth pinning, and the second is the one that actually
// prevents the outage coming back:
//   1. the factor arithmetic still produces the same numbers, and
//   2. doubling the profile count does NOT increase the number of DB operations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountRiskScore } from '../src/routes/risk-score.js';
import { createFakeDb } from './helpers/fake-db.mjs';

// Counts every real collection operation, so "no N+1" is an assertion rather
// than a hope. Wraps the fake db without changing its behaviour.
function countingDb(db) {
  const counts = { aggregate: 0, find: 0, countDocuments: 0, insertOne: 0, insertMany: 0, updateOne: 0, bulkWrite: 0, total: 0 };
  const wrapped = {
    ...db,
    collection(name) {
      const col = db.collection(name);
      return new Proxy(col, {
        get(target, prop) {
          const v = target[prop];
          if (typeof v !== 'function' || !(prop in counts)) return typeof v === 'function' ? v.bind(target) : v;
          return (...args) => { counts[prop]++; counts.total++; return v.apply(target, args); };
        },
      });
    },
  };
  return { db: wrapped, counts };
}

async function withServer(seed, fn) {
  const base = createFakeDb();
  await seed(base);
  const { db, counts } = countingDb(base);

  const app = express();
  app.use(express.json());
  mountRiskScore(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({
      raw: base,
      counts,
      async compute() {
        const res = await fetch(`${url}/api/v1/risk-scores/compute`, { method: 'POST' });
        const body = await res.json();
        assert.equal(res.status, 200, `compute → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
        return body;
      },
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

// WEIGHTS: dlp 30, overrides 25, shadow 20, sensitivity 15, volume 10.
// Scores are (factorScore * weight) summed / 100, rounded, capped at 100.
const seedOne = async (db) => {
  await db.collection('employee_profiles').insertOne({
    id: 'p1', display_name: 'Jane Doe', machine_ids: ['m1'],
  });
  // 2 blocks -> 16; 1 override -> 20; 3 hi/crit -> 30
  for (let i = 0; i < 2; i++) {
    await db.collection('dlp_events').insertOne({
      id: `b${i}`, machine_id: 'm1', occurred_at: iso(30), event_kind: 'enforcement_block', secret_class: 'high',
    });
  }
  await db.collection('dlp_events').insertOne({
    id: 'o1', machine_id: 'm1', occurred_at: iso(30), event_kind: 'enforcement_override', secret_class: 'critical',
  });
  // Outside the 90-day window — must be ignored entirely.
  await db.collection('dlp_events').insertOne({
    id: 'old', machine_id: 'm1', occurred_at: iso(200), event_kind: 'enforcement_block', secret_class: 'critical',
  });
  // One sanctioned tool, one shadow tool.
  await db.collection('findings').insertOne({ id: 'f1', machine_id: 'm1', detected_at: iso(10), tool_key: 'openai:chatgpt' });
  await db.collection('findings').insertOne({ id: 'f2', machine_id: 'm1', detected_at: iso(10), tool_key: 'evil:tool' });
  await db.collection('sanctions').insertOne({ tool_key: 'openai:chatgpt', status: 'approved' });
};

test('factors are computed from the batched metrics, window respected', async () => {
  await withServer(seedOne, async ({ compute }) => {
    const body = await compute();
    assert.equal(body.computed, 1);
    const f = body.scores[0].factors;

    // 2 in-window blocks, NOT the 200-day-old one.
    assert.equal(f.dlp_violations.raw, 2);
    assert.equal(f.dlp_violations.score, 16);
    assert.equal(f.enforcement_overrides.raw, 1);
    assert.equal(f.enforcement_overrides.score, 20);
    // 3 hi/crit in window: 2 high blocks + 1 critical override.
    assert.equal(f.data_sensitivity.raw, 3);
    assert.equal(f.data_sensitivity.score, 30);
    // Only the unsanctioned tool counts.
    assert.equal(f.shadow_tools.raw, 1);
    assert.equal(f.shadow_tools.score, 15);

    // (16*30 + 20*25 + 15*20 + 30*15 + volume*10)/100
    const expected = Math.min(Math.round(
      (16 * 30 + 20 * 25 + 15 * 20 + 30 * 15 + f.volume_anomaly.score * 10) / 100), 100);
    assert.equal(body.scores[0].score, expected);
  });
});

test('the score is persisted to the profile and a history row is written', async () => {
  await withServer(seedOne, async ({ compute, raw }) => {
    const body = await compute();
    const profile = raw._rows('employee_profiles').find((p) => p.id === 'p1');
    assert.equal(profile.risk_score, body.scores[0].score);
    assert.equal(profile.risk_level, body.scores[0].level);
    assert.ok(profile.risk_computed_at instanceof Date);
    assert.equal(raw._rows('risk_scores').length, 1);
    assert.equal(raw._rows('risk_scores')[0].profile_id, 'p1');
  });
});

// A profile with no enrolled machine is "not assessed", never a safe 0 — the
// behaviour the file's own comment calls out as backwards for a governance tool.
test('a profile with no machines stays not_assessed', async () => {
  await withServer(async (db) => {
    await db.collection('employee_profiles').insertOne({ id: 'p0', display_name: 'No Device', machine_ids: [] });
  }, async ({ compute }) => {
    const body = await compute();
    assert.equal(body.scores[0].score, null);
    assert.equal(body.scores[0].level, 'not_assessed');
  });
});

// Events on a machine shared by two profiles count for BOTH, matching the old
// per-profile `machine_id: { $in: [...] }` queries.
test('a machine on two profiles counts for both', async () => {
  await withServer(async (db) => {
    await db.collection('employee_profiles').insertOne({ id: 'a', display_name: 'A', machine_ids: ['shared'] });
    await db.collection('employee_profiles').insertOne({ id: 'b', display_name: 'B', machine_ids: ['shared'] });
    await db.collection('dlp_events').insertOne({
      id: 'e1', machine_id: 'shared', occurred_at: iso(5), event_kind: 'enforcement_block', secret_class: 'high',
    });
  }, async ({ compute }) => {
    const body = await compute();
    assert.equal(body.computed, 2);
    for (const s of body.scores) assert.equal(s.factors.dlp_violations.raw, 1);
  });
});

// THE ONE THAT MATTERS. Twelve profiles must cost the same number of database
// operations as one — that is the difference between ~18s and a 504.
test('DB operation count does not grow with the number of profiles', async () => {
  const makeSeed = (n) => async (db) => {
    for (let i = 0; i < n; i++) {
      await db.collection('employee_profiles').insertOne({
        id: `p${i}`, display_name: `Person ${i}`, machine_ids: [`m${i}`],
      });
      await db.collection('dlp_events').insertOne({
        id: `e${i}`, machine_id: `m${i}`, occurred_at: iso(3), event_kind: 'enforcement_block', secret_class: 'high',
      });
      await db.collection('findings').insertOne({
        id: `f${i}`, machine_id: `m${i}`, detected_at: iso(3), tool_key: `t${i}`,
      });
    }
  };

  let small, large;
  await withServer(makeSeed(1), async ({ compute, counts }) => {
    await compute();
    small = { ...counts };
  });
  await withServer(makeSeed(12), async ({ compute, counts }) => {
    const body = await compute();
    assert.equal(body.computed, 12);
    large = { ...counts };
  });

  assert.equal(large.total, small.total,
    `query count grew with profile count: 1 profile = ${small.total} ops, 12 profiles = ${large.total} ops`);
  // And it is genuinely a handful, not merely constant-but-huge.
  assert.ok(large.total <= 8, `expected a handful of ops, got ${large.total}`);
  // Per-profile writes are gone: one insertMany + one bulkWrite, whatever N is.
  assert.equal(large.insertOne, 0, 'per-profile insertOne is back');
  assert.equal(large.updateOne, 0, 'per-profile updateOne is back');
  assert.equal(large.countDocuments, 0, 'per-profile countDocuments is back');
  assert.equal(large.insertMany, 1);
  assert.equal(large.bulkWrite, 1);
});

// ── Shadow tools on a browser-only rollout ─────────────────────────────────
//
// THE DEFECT THIS PINS DOWN. shadow_tools is 20 of the 100 score weight, and it
// read only `findings` — written exclusively by the desktop agent's scan report.
// On a browser-only rollout (extension force-installed, no agent) it was therefore
// structurally zero for everybody. Verified in production before the fix: all 39
// extension-only profiles scored shadow_tools 0, capping each at 80 of 100 and
// losing the "which unsanctioned AI is this person using" signal — the headline
// question the factor exists to answer.
//
// The data was already collected and correctly shaped: classifications.js upserts
// { machine_id, tool_key: host } into tool_usage on every hit against an
// AI-classified host. Nothing read it.

const profileOnly = (extra = {}) => async (db) => {
  await db.collection('employee_profiles').insertOne({
    id: 'p1', display_name: 'Browser Only', machine_ids: ['m1'],
  });
  for (const [coll, docs] of Object.entries(extra)) {
    for (const doc of docs) await db.collection(coll).insertOne(doc);
  }
};

const shadowRaw = (body) => body.scores[0].factors.shadow_tools.raw;

test('browser-discovered tools count toward shadow tools', async () => {
  await withServer(profileOnly({
    tool_usage: [
      { machine_id: 'm1', tool_key: 'chatgpt.com', last_used_at: new Date() },
      { machine_id: 'm1', tool_key: 'perplexity.ai', last_used_at: new Date() },
    ],
  }), async ({ compute }) => {
    assert.equal(shadowRaw(await compute()), 2,
      'both browser-discovered tools must count — this was 0 before the fix');
  });
});

test('a sanctioned browser tool is not shadow', async () => {
  await withServer(profileOnly({
    sanctions: [{ tool_key: 'chatgpt.com', status: 'approved' }],
    tool_usage: [{ machine_id: 'm1', tool_key: 'chatgpt.com', last_used_at: new Date() }],
  }), async ({ compute }) => {
    assert.equal(shadowRaw(await compute()), 0,
      'approving a tool must remove it from the risk score');
  });
});

test('a tool seen by BOTH the agent and the browser counts once', async () => {
  await withServer(profileOnly({
    findings: [{ machine_id: 'm1', tool_key: 'openai:chatgpt', detected_at: new Date() }],
    tool_usage: [{ machine_id: 'm1', tool_key: 'openai:chatgpt', last_used_at: new Date() }],
  }), async ({ compute }) => {
    assert.equal(shadowRaw(await compute()), 1, 'the two sources are unioned, not summed');
  });
});

test('tool usage older than the window is excluded', async () => {
  // The window bound must actually apply. tool_usage stores Date objects while
  // dlp_events store ISO strings, and Mongo comparisons are type-bracketed — using
  // the string bound here would match nothing and look exactly like "no tools".
  await withServer(profileOnly({
    tool_usage: [
      { machine_id: 'm1', tool_key: 'ancient.ai', last_used_at: new Date(Date.now() - 400 * 86400000) },
      { machine_id: 'm1', tool_key: 'current.ai', last_used_at: new Date() },
    ],
  }), async ({ compute }) => {
    assert.equal(shadowRaw(await compute()), 1, 'only the in-window tool counts');
  });
});
