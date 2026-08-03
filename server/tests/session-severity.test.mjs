// Per-session severity watermark (Session Replay — highest_severity rollup).
//
// Same harness as dlp-sessions.test.mjs / sessions-read.test.mjs: the real
// Express handlers over real HTTP with a real machine JWT, only the Mongo handle
// is faked. Fixtures always go through the real ingest route so the assertions
// are made against the document shape ingest actually writes.
//
// The point of these tests is the DOWNGRADE case: the rollup is maintained with
// an atomic $max on a numeric rank plus a rank-guarded compare-and-set for the
// label, precisely so that a low-severity turn arriving after a high-severity
// one cannot pull the session back down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { mountSessions } from '../src/routes/sessions.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'test-host' });

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  mountSessions(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (events, token = TOKEN) => fetch(`${base}/api/v1/dlp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
  });

  const get = async (path) => {
    const res = await fetch(`${base}${path}`);
    return { status: res.status, body: await res.json() };
  };

  try {
    return await fn({ db, post, get, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const at = (min) => new Date(Date.UTC(2026, 6, 1, 10, min, 0)).toISOString();

// A prompt whose match list scores at `severity` (null → no matches at all).
function promptAt(sessionId, seq, severity) {
  return {
    kind: 'prompt_submit',
    service: 'ChatGPT',
    occurredAt: at(seq),
    session_id: sessionId,
    client_seq: seq,
    length_bucket: '100-1k',
    content_length: 120,
    matches: severity ? [{ pattern: `pat-${severity}`, severity, count: 1 }] : [],
    tabHost: 'chatgpt.com',
  };
}

function session(db, sessionId) {
  return db._rows('ai_sessions').find((s) => s.session_id === sessionId);
}

test('the worst severity in a conversation lands on the session doc', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sev-basic';
    const res = await post([
      promptAt(sid, 0, null),
      promptAt(sid, 1, 'low'),
      promptAt(sid, 2, 'critical'),
      promptAt(sid, 3, 'moderate'),
    ]);
    assert.equal(res.status, 201);

    const s = session(db, sid);
    assert.equal(s.highest_severity, 'critical');
    assert.equal(s.highest_severity_rank, 4);
    assert.equal(s.message_count, 4, 'the counters still work');
  });
});

test('a LOW event after a HIGH event does not downgrade the session', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sev-no-downgrade';

    // Separate batches: the low turn is ingested strictly after the high one,
    // which is exactly the ordering a naive $set would get wrong.
    await post([promptAt(sid, 0, 'high')]);
    assert.equal(session(db, sid).highest_severity, 'high');
    assert.equal(session(db, sid).highest_severity_rank, 3);

    await post([promptAt(sid, 1, 'low')]);
    assert.equal(session(db, sid).highest_severity, 'high', 'low must not overwrite high');
    assert.equal(session(db, sid).highest_severity_rank, 3);

    // Neither does a whole run of quiet turns, including ones with no matches.
    await post([promptAt(sid, 2, null), promptAt(sid, 3, 'low'), promptAt(sid, 4, 'moderate')]);
    assert.equal(session(db, sid).highest_severity, 'high');
    assert.equal(session(db, sid).highest_severity_rank, 3);

    // …but a genuinely worse turn still raises it.
    await post([promptAt(sid, 5, 'critical')]);
    assert.equal(session(db, sid).highest_severity, 'critical');
    assert.equal(session(db, sid).highest_severity_rank, 4);

    // And once at the top, nothing below it moves the mark again.
    await post([promptAt(sid, 6, 'high'), promptAt(sid, 7, 'low')]);
    assert.equal(session(db, sid).highest_severity, 'critical');
    assert.equal(session(db, sid).highest_severity_rank, 4);
  });
});

test('the full DLP severity ladder ranks low < moderate < high < critical', async () => {
  await withServer(async ({ db, post }) => {
    // Each session receives its ladder in DESCENDING order, so every later,
    // lower turn is a chance to downgrade. The first one must always win.
    const ladder = ['critical', 'high', 'moderate', 'low'];
    for (let i = 0; i < ladder.length; i++) {
      const sid = `sev-ladder-${ladder[i]}`;
      const rest = ladder.slice(i);
      for (let j = 0; j < rest.length; j++) {
        await post([promptAt(sid, j, rest[j])]);
      }
      assert.equal(session(db, sid).highest_severity, ladder[i], `session topped out at ${ladder[i]}`);
    }

    assert.deepEqual(
      ladder.map((sev) => session(db, `sev-ladder-${sev}`).highest_severity_rank),
      [4, 3, 2, 1],
    );

    // 'medium' is the governance spelling of 'moderate' — same rank, so it can
    // neither beat 'high' nor be beaten by 'low'.
    const sid = 'sev-medium';
    await post([promptAt(sid, 0, 'medium'), promptAt(sid, 1, 'low')]);
    assert.equal(session(db, sid).highest_severity, 'medium');
    assert.equal(session(db, sid).highest_severity_rank, 2);
    await post([promptAt(sid, 2, 'high')]);
    assert.equal(session(db, sid).highest_severity, 'high');
  });
});

test('concurrent ingests of the same session settle on the higher severity either way round', async () => {
  await withServer(async ({ db, post }) => {
    // Two in-flight requests for one session. Whatever order the two updates
    // interleave in, the watermark is the max — the guard on the label write is
    // what makes this deterministic rather than last-writer-wins.
    const sid = 'sev-concurrent';
    await Promise.all([
      post([promptAt(sid, 0, 'critical')]),
      post([promptAt(sid, 1, 'low')]),
    ]);
    assert.equal(session(db, sid).highest_severity, 'critical');
    assert.equal(session(db, sid).highest_severity_rank, 4);

    const sid2 = 'sev-concurrent-2';
    await Promise.all([
      post([promptAt(sid2, 0, 'low')]),
      post([promptAt(sid2, 1, 'high')]),
    ]);
    assert.equal(session(db, sid2).highest_severity, 'high');
    assert.equal(session(db, sid2).highest_severity_rank, 3);
  });
});

test('a session with nothing sensitive in it reports null, not a severity', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sev-clean';
    await post([promptAt(sid, 0, null), promptAt(sid, 1, null)]);
    const s = session(db, sid);
    assert.equal(s.highest_severity, null);
    assert.equal(s.highest_severity_rank, 0);
  });
});

test('a session that starts life with a session_bind gets the fields at their floor', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sev-bind-first';
    await post([{
      kind: 'session_bind',
      service: 'Claude',
      occurredAt: at(0),
      session_id: sid,
      client_seq: 0,
      external_conv_id: 'claude-conv-1',
    }]);
    let s = session(db, sid);
    assert.equal(s.highest_severity, null);
    assert.equal(s.highest_severity_rank, 0);

    // A later bind (the tab re-binds when the URL settles) must not disturb a
    // severity the conversation has already earned.
    await post([promptAt(sid, 1, 'high')]);
    await post([{
      kind: 'session_bind',
      service: 'Claude',
      occurredAt: at(2),
      session_id: sid,
      client_seq: 2,
      external_conv_id: 'claude-conv-1',
    }]);
    s = session(db, sid);
    assert.equal(s.highest_severity, 'high');
    assert.equal(s.highest_severity_rank, 3);
  });
});

test('a file upload severity rolls up; a client-declared enforcement severity does not', async () => {
  await withServer(async ({ db, post }) => {
    // file_upload carries its severity as a top-level field, and ingest already
    // stores that as the event's secret_class — so it counts.
    const sid = 'sev-file';
    await post([{
      kind: 'file_upload',
      service: 'ChatGPT',
      occurredAt: at(0),
      session_id: sid,
      client_seq: 0,
      filename: 'payroll.xlsx',
      size: 4096,
      severity: 'high',
      file_class: 'spreadsheet',
    }]);
    assert.equal(session(db, sid).highest_severity, 'high');

    // enforcement_* kinds report a severity in metadata only, with no match list
    // behind it. secret_class stays null for those, so the rollup ignores them —
    // the same call GET /api/v1/sessions/stats/summary already makes, and it
    // keeps a client from inflating a session's severity by assertion alone.
    const sid2 = 'sev-enforcement';
    await post([{
      kind: 'enforcement_block',
      service: 'ChatGPT',
      occurredAt: at(0),
      session_id: sid2,
      client_seq: 0,
      matches: [],
      highest_severity: 'critical',
    }]);
    const s2 = session(db, sid2);
    assert.equal(s2.highest_severity, null);
    assert.equal(s2.highest_severity_rank, 0);
    assert.equal(s2.message_count, 1, 'the event itself is still stored and counted');
  });
});

test('sessions do not leak their severity into each other', async () => {
  await withServer(async ({ db, post }) => {
    await post([
      promptAt('sev-a', 0, 'critical'),
      promptAt('sev-b', 0, 'low'),
      promptAt('sev-c', 0, null),
    ]);
    assert.deepEqual(
      ['sev-a', 'sev-b', 'sev-c'].map((sid) => session(db, sid).highest_severity),
      ['critical', 'low', null],
    );
  });
});

test('GET /api/v1/sessions exposes highest_severity for the dashboard column', async () => {
  await withServer(async ({ post, get }) => {
    await post([promptAt('sev-list-hot', 0, 'high'), promptAt('sev-list-hot', 1, 'low')]);
    await post([promptAt('sev-list-cold', 0, null)]);

    const { status, body } = await get('/api/v1/sessions');
    assert.equal(status, 200);

    const bySid = Object.fromEntries(body.map((s) => [s.session_id, s]));
    assert.equal(bySid['sev-list-hot'].highest_severity, 'high');
    assert.equal(bySid['sev-list-hot'].highest_severity_rank, 3);
    assert.equal(bySid['sev-list-cold'].highest_severity, null);
    assert.equal(bySid['sev-list-cold'].highest_severity_rank, 0);
  });
});

test('GET /api/v1/sessions/:id carries the same rollup on the session object', async () => {
  await withServer(async ({ post, get }) => {
    const sid = 'sev-detail';
    await post([promptAt(sid, 0, 'critical'), promptAt(sid, 1, 'low')]);

    const { status, body } = await get(`/api/v1/sessions/${sid}`);
    assert.equal(status, 200);
    assert.equal(body.session.highest_severity, 'critical');
    assert.equal(body.session.highest_severity_rank, 4);
    // Per-message severity is unchanged: the rollup is a session-level summary,
    // not a rewrite of the individual turns.
    assert.deepEqual(body.messages.map((m) => m.highest_severity), ['critical', 'low']);
  });
});

test('a session created before this shipped keeps working and self-heals on its next event', async () => {
  await withServer(async ({ db, post, get }) => {
    // Hand-seed a legacy doc: no severity fields at all.
    const sid = 'sev-legacy';
    await db.collection('ai_sessions').insertOne({
      session_id: sid,
      machine_id: MACHINE_ID,
      ai_service: 'ChatGPT',
      external_conv_id: null,
      started_at: new Date(at(0)),
      last_activity_at: new Date(at(0)),
      message_count: 3,
    });

    // The list route must not choke on the missing fields — it reports them as
    // absent, which the dashboard already renders as "unknown".
    const before = await get('/api/v1/sessions');
    const legacy = before.body.find((s) => s.session_id === sid);
    assert.equal(legacy.highest_severity, undefined);
    assert.equal(legacy.highest_severity_rank, undefined);

    // No backfill is shipped, but the next event through ingest establishes it.
    await post([promptAt(sid, 4, 'moderate')]);
    const after = await get('/api/v1/sessions');
    const healed = after.body.find((s) => s.session_id === sid);
    assert.equal(healed.highest_severity, 'moderate');
    assert.equal(healed.highest_severity_rank, 2);
    assert.equal(healed.message_count, 4, 'the legacy counter carried on from 3');
  });
});
