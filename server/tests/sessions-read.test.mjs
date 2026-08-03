// GET /api/v1/sessions* — Session Replay read API (phase 2).
//
// Same harness as dlp-sessions.test.mjs / dlp-ai-response.test.mjs: real Express
// handlers over real HTTP, only the Mongo handle is faked. Fixtures are created
// by POSTing through the real ingest route so the read routes are always tested
// against the document shape ingest actually writes, not a hand-rolled guess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { mountSessions } from '../src/routes/sessions.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'test-host' });

const OTHER_MACHINE = 'machine-xyz-999';
const OTHER_TOKEN = signMachineToken({ machineId: OTHER_MACHINE, hostname: 'other-host' });

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

  // Deliberately no Authorization header — the read routes are open, matching
  // the sibling GET /api/v1/dlp routes.
  const get = async (path) => {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, text };
  };

  try {
    return await fn({ db, post, get, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const at = (day, min) => new Date(Date.UTC(2026, 6, day, 10, min, 0)).toISOString();

function promptEvent(sessionId, seq, overrides = {}) {
  return {
    kind: 'prompt_submit',
    service: 'ChatGPT',
    occurredAt: at(1, seq),
    session_id: sessionId,
    client_seq: seq,
    length_bucket: '100-1k',
    content_length: 30,
    content_text: 'capital of France?',
    matches: [],
    tabHost: 'chatgpt.com',
    ...overrides,
  };
}

function responseEvent(sessionId, seq, text, overrides = {}) {
  return {
    kind: 'ai_response',
    service: 'ChatGPT',
    occurredAt: at(1, seq),
    session_id: sessionId,
    client_seq: seq,
    content_text: text,
    content_length: text.length,
    length_bucket: '100-1k',
    matches: [],
    response_format: 'sse',
    capture_truncated: 0,
    duration_ms: 1200,
    tabHost: 'chatgpt.com',
    ...overrides,
  };
}

// ── GET /api/v1/sessions ─────────────────────────────────────────────────────

test('list returns one summary per session, newest activity first, metadata only', async () => {
  await withServer(async ({ post, get }) => {
    // sess-old last active at :01, sess-new at :09 → sess-new must sort first.
    await post([promptEvent('sess-old', 0), promptEvent('sess-old', 1)]);
    await post([promptEvent('sess-new', 8), responseEvent('sess-new', 9, 'Paris.')]);

    const { status, body, text } = await get('/api/v1/sessions');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), 'responds with a bare array, like GET /api/v1/dlp');
    assert.deepEqual(body.map((s) => s.session_id), ['sess-new', 'sess-old']);

    const s = body[0];
    assert.equal(s.machine_id, MACHINE_ID);
    assert.equal(s.ai_service, 'ChatGPT');
    assert.equal(s.external_conv_id, null);
    assert.equal(s.message_count, 2);
    assert.equal(s.user_message_count, 1);
    assert.equal(s.assistant_message_count, 1);
    assert.equal(s.started_at, at(1, 8));
    assert.equal(s.last_activity_at, at(1, 9));
    assert.equal('_id' in s, false, 'internal Mongo _id is never exposed');

    // A session list must not carry any conversation text.
    assert.equal(text.includes('capital of France'), false);
    assert.equal(text.includes('Paris.'), false);
  });
});

test('list passes through counters it does not know about', async () => {
  // Later phases add fields to ai_sessions; the read route projects the whole
  // doc so it must not need editing when they do.
  await withServer(async ({ db, get }) => {
    await db.collection('ai_sessions').insertOne({
      session_id: 'sess-future',
      machine_id: MACHINE_ID,
      ai_service: 'Claude',
      external_conv_id: null,
      started_at: new Date(at(1, 0)),
      last_activity_at: new Date(at(1, 5)),
      message_count: 3,
      some_future_counter: 42,
    });

    const { body } = await get('/api/v1/sessions');
    assert.equal(body[0].some_future_counter, 42);
  });
});

test('list filters by machine_id and by ai_service', async () => {
  await withServer(async ({ post, get }) => {
    await post([promptEvent('sess-mine', 0)]);
    await post([promptEvent('sess-theirs', 1, { service: 'Gemini' })], OTHER_TOKEN);

    const byMachine = await get(`/api/v1/sessions?machine_id=${OTHER_MACHINE}`);
    assert.deepEqual(byMachine.body.map((s) => s.session_id), ['sess-theirs']);

    const byService = await get('/api/v1/sessions?ai_service=ChatGPT');
    assert.deepEqual(byService.body.map((s) => s.session_id), ['sess-mine']);

    const both = await get(`/api/v1/sessions?machine_id=${MACHINE_ID}&ai_service=Gemini`);
    assert.deepEqual(both.body, []);
  });
});

test('list windows on started_at with from/to and rejects unparseable dates', async () => {
  await withServer(async ({ post, get }) => {
    await post([promptEvent('sess-jul01', 0, { occurredAt: at(1, 0) })]);
    await post([promptEvent('sess-jul05', 0, { occurredAt: at(5, 0) })]);
    await post([promptEvent('sess-jul10', 0, { occurredAt: at(10, 0) })]);

    const mid = await get('/api/v1/sessions?from=2026-07-03T00:00:00Z&to=2026-07-07T00:00:00Z');
    assert.deepEqual(mid.body.map((s) => s.session_id), ['sess-jul05']);

    const fromOnly = await get('/api/v1/sessions?from=2026-07-05T00:00:00Z');
    assert.deepEqual(fromOnly.body.map((s) => s.session_id), ['sess-jul10', 'sess-jul05']);

    const toOnly = await get('/api/v1/sessions?to=2026-07-05T00:00:00Z');
    assert.deepEqual(toOnly.body.map((s) => s.session_id), ['sess-jul01']);

    const badFrom = await get('/api/v1/sessions?from=not-a-date');
    assert.equal(badFrom.status, 400);
    assert.match(badFrom.body.error, /invalid `from` date/);

    const badTo = await get('/api/v1/sessions?to=13/13/2026x');
    assert.equal(badTo.status, 400);
    assert.match(badTo.body.error, /invalid `to` date/);
  });
});

test('list defaults to 100 sessions and caps at 500', async () => {
  await withServer(async ({ db, get }) => {
    const col = db.collection('ai_sessions');
    for (let i = 0; i < 600; i++) {
      await col.insertOne({
        session_id: `sess-${String(i).padStart(4, '0')}`,
        machine_id: MACHINE_ID,
        ai_service: 'ChatGPT',
        started_at: new Date(Date.UTC(2026, 6, 1, 0, i, 0)),
        last_activity_at: new Date(Date.UTC(2026, 6, 1, 0, i, 0)),
        message_count: 1,
      });
    }

    assert.equal((await get('/api/v1/sessions')).body.length, 100);
    assert.equal((await get('/api/v1/sessions?limit=7')).body.length, 7);
    assert.equal((await get('/api/v1/sessions?limit=500')).body.length, 500);
    assert.equal((await get('/api/v1/sessions?limit=9999')).body.length, 500, 'capped');
    assert.equal((await get('/api/v1/sessions?limit=0')).body.length, 100, 'falls back to default');
    assert.equal((await get('/api/v1/sessions?limit=-5')).body.length, 100);
    assert.equal((await get('/api/v1/sessions?limit=abc')).body.length, 100);
  });
});

// ── GET /api/v1/sessions/:session_id ─────────────────────────────────────────

test('detail returns the summary plus turns ordered by client_seq', async () => {
  await withServer(async ({ post, get }) => {
    const sid = 'sess-detail';
    // Delivered out of order on purpose — client_seq is the ordering truth.
    await post([
      responseEvent(sid, 3, 'Paris is the capital.'),
      promptEvent(sid, 2, { content_text: 'and France?' }),
      responseEvent(sid, 1, 'Berlin is the capital.'),
      promptEvent(sid, 0, { content_text: 'capital of Germany?' }),
    ]);

    const { status, body } = await get(`/api/v1/sessions/${sid}`);
    assert.equal(status, 200);

    assert.equal(body.session.session_id, sid);
    assert.equal(body.session.message_count, 4);
    assert.equal(body.messages_truncated, false);

    assert.deepEqual(body.messages.map((m) => [m.client_seq, m.event_kind, m.role]), [
      [0, 'prompt_submit', 'user'],
      [1, 'ai_response', 'assistant'],
      [2, 'prompt_submit', 'user'],
      [3, 'ai_response', 'assistant'],
    ]);

    for (const m of body.messages) {
      assert.equal(typeof m.id, 'string');
      assert.equal(m.has_content, true);
      assert.equal(m.occurred_at, at(1, m.client_seq));
      assert.ok(m.received_at, 'received_at is surfaced for ingest-lag debugging');
      assert.equal(m.ai_service, 'ChatGPT');
    }
  });
});

test('detail never inlines content text, only whether content exists and its id', async () => {
  await withServer(async ({ post, get, base }) => {
    const sid = 'sess-no-inline';
    const secret = 'my aws key is AKIAIOSFODNN7EXAMPLE';
    await post([
      promptEvent(sid, 0, { content_text: secret }),
      // No body captured at all → has_content must be false.
      promptEvent(sid, 1, { content_text: '' }),
    ]);

    const { body, text } = await get(`/api/v1/sessions/${sid}`);
    assert.equal(text.includes(secret), false, 'prompt body must not leak into the replay index');
    assert.equal(text.includes('content_text'), false);

    assert.deepEqual(body.messages.map((m) => m.has_content), [true, false]);

    // The id handed back is the one the existing content route accepts, so the
    // frontend fetches bodies one turn at a time through that single path.
    const fetched = await fetch(`${base}/api/v1/dlp/${body.messages[0].id}/content`);
    assert.equal(fetched.status, 200);
    assert.equal(await fetched.text(), secret);

    const missing = await fetch(`${base}/api/v1/dlp/${body.messages[1].id}/content`);
    assert.equal(missing.status, 404);
  });
});

test('detail surfaces severity and matches per turn', async () => {
  await withServer(async ({ post, get }) => {
    const sid = 'sess-sev';
    const at0 = at(1, 0);
    await post([
      { kind: 'prompt_submit', service: 'ChatGPT', occurredAt: at0, session_id: sid, client_seq: 0, matches: [] },
      {
        kind: 'prompt_paste', service: 'ChatGPT', occurredAt: at0, session_id: sid, client_seq: 1,
        matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }, { pattern: 'email', severity: 'low', count: 2 }],
      },
      {
        kind: 'file_upload', service: 'ChatGPT', occurredAt: at0, session_id: sid, client_seq: 2,
        filename: 'payroll.csv', size: 1024, severity: 'high', file_class: 'spreadsheet',
      },
      // An enforcement event reports a severity with no match list; the client's
      // highest_severity is the only signal there.
      { kind: 'enforcement_block', service: 'ChatGPT', occurredAt: at0, session_id: sid, client_seq: 3, matches: [], highest_severity: 'critical' },
    ]);

    const { body } = await get(`/api/v1/sessions/${sid}`);
    assert.deepEqual(body.messages.map((m) => m.highest_severity), [null, 'critical', 'high', 'critical']);
    assert.deepEqual(body.messages.map((m) => m.matches.length), [0, 2, 0, 0]);
    assert.equal(body.messages[1].matches[0].pattern, 'us-ssn');
    // metadata is passed through for the UI (filename, tab_host, duration…).
    assert.equal(body.messages[2].metadata.filename, 'payroll.csv');
    assert.equal(body.messages[2].content_length, 1024);
    assert.deepEqual(body.messages.map((m) => m.role), ['user', 'user', 'user', 'system']);
  });
});

test('detail 404s for an unknown session id', async () => {
  await withServer(async ({ post, get }) => {
    await post([promptEvent('sess-real', 0)]);
    const { status, body } = await get('/api/v1/sessions/sess-does-not-exist');
    assert.equal(status, 404);
    assert.deepEqual(body, { error: 'session not found' });
  });
});

test('detail returns an empty message list for a bind-only session', async () => {
  await withServer(async ({ post, get }) => {
    await post([{
      kind: 'session_bind',
      service: 'Claude',
      occurredAt: at(1, 0),
      session_id: 'sess-bound-only',
      client_seq: 0,
      external_conv_id: 'claude-conv-9',
    }]);

    const { status, body } = await get('/api/v1/sessions/sess-bound-only');
    assert.equal(status, 200);
    assert.equal(body.session.external_conv_id, 'claude-conv-9');
    assert.equal(body.session.message_count, 0);
    assert.deepEqual(body.messages, []);
  });
});

test('detail only returns turns belonging to the requested session', async () => {
  await withServer(async ({ post, get }) => {
    await post([promptEvent('sess-A', 0), promptEvent('sess-A', 1), promptEvent('sess-B', 0)]);

    const a = await get('/api/v1/sessions/sess-A');
    const b = await get('/api/v1/sessions/sess-B');
    assert.equal(a.body.messages.length, 2);
    assert.equal(b.body.messages.length, 1);
    assert.equal(a.body.messages.every((m) => m.id !== b.body.messages[0].id), true);
  });
});

test('detail caps a very long conversation and flags the truncation', async () => {
  await withServer(async ({ db, get }) => {
    const sid = 'sess-huge';
    await db.collection('ai_sessions').insertOne({
      session_id: sid, machine_id: MACHINE_ID, ai_service: 'ChatGPT',
      started_at: new Date(at(1, 0)), last_activity_at: new Date(at(1, 0)),
      message_count: 2100,
    });
    const events = db.collection('dlp_events');
    for (let i = 0; i < 2100; i++) {
      await events.insertOne({
        id: `evt-${i}`, machine_id: MACHINE_ID, session_id: sid, client_seq: i,
        event_kind: 'prompt_submit', role: 'user', ai_service: 'ChatGPT',
        occurred_at: at(1, 0), received_at: new Date(at(1, 0)), secret_class: null,
        content_length: 1, pattern_matched: '', metadata_json: '{}',
      });
    }

    const { body } = await get(`/api/v1/sessions/${sid}`);
    assert.equal(body.messages.length, 2000);
    assert.equal(body.messages_truncated, true);
    assert.equal(body.messages[0].client_seq, 0, 'kept in order from the start of the chat');
    assert.equal(body.session.message_count, 2100, 'the summary still reports the true total');
  });
});

// ── GET /api/v1/sessions/stats/summary ───────────────────────────────────────

test('stats/summary aggregates sessions, messages, alerting sessions and machines', async () => {
  await withServer(async ({ post, get }) => {
    // Machine 1: a clean session, and one with a critical paste.
    await post([promptEvent('sess-clean', 0), responseEvent('sess-clean', 1, 'ok')]);
    await post([
      promptEvent('sess-critical', 0),
      {
        kind: 'prompt_paste', service: 'ChatGPT', occurredAt: at(1, 1), session_id: 'sess-critical', client_seq: 1,
        matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }],
      },
    ]);
    // Machine 2: a session with a high-severity file upload.
    await post([{
      kind: 'file_upload', service: 'Gemini', occurredAt: at(1, 0), session_id: 'sess-file',
      client_seq: 0, filename: 'a.csv', size: 9, severity: 'high', file_class: 'spreadsheet',
    }], OTHER_TOKEN);

    const { status, body } = await get('/api/v1/sessions/stats/summary');
    assert.equal(status, 200);
    assert.deepEqual(body, {
      total_sessions: 3,
      total_messages: 5,
      total_user_messages: 4,
      total_assistant_messages: 1,
      sessions_with_high_severity: 2,
      distinct_machines: 2,
    });
  });
});

test('stats/summary counts a session once no matter how many bad turns it has', async () => {
  await withServer(async ({ post, get }) => {
    const sid = 'sess-many-bad';
    const bad = (seq) => ({
      kind: 'prompt_paste', service: 'ChatGPT', occurredAt: at(1, seq), session_id: sid, client_seq: seq,
      matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }],
    });
    await post([bad(0), bad(1), bad(2)]);

    const { body } = await get('/api/v1/sessions/stats/summary');
    assert.equal(body.sessions_with_high_severity, 1);
    assert.equal(body.total_messages, 3);
  });
});

test('stats/summary ignores severity on events that belong to no session', async () => {
  await withServer(async ({ post, get }) => {
    // Pre-phase-1 event: severe, but no session_id to attribute it to.
    await post([{
      kind: 'prompt_paste', service: 'ChatGPT', occurredAt: at(1, 0),
      matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }],
    }]);

    const { body } = await get('/api/v1/sessions/stats/summary');
    assert.deepEqual(body, {
      total_sessions: 0,
      total_messages: 0,
      total_user_messages: 0,
      total_assistant_messages: 0,
      sessions_with_high_severity: 0,
      distinct_machines: 0,
    });
  });
});

test('stats/summary returns zeroes rather than nulls on an empty database', async () => {
  await withServer(async ({ get }) => {
    const { status, body } = await get('/api/v1/sessions/stats/summary');
    assert.equal(status, 200);
    assert.deepEqual(body, {
      total_sessions: 0,
      total_messages: 0,
      total_user_messages: 0,
      total_assistant_messages: 0,
      sessions_with_high_severity: 0,
      distinct_machines: 0,
    });
  });
});

test('stats/summary is not shadowed by the :session_id route', async () => {
  await withServer(async ({ post, get }) => {
    await post([promptEvent('stats', 0)]);   // a session literally named "stats"
    const { status, body } = await get('/api/v1/sessions/stats/summary');
    assert.equal(status, 200);
    assert.equal(body.total_sessions, 1);
    assert.equal('messages' in body, false, 'resolved to the aggregate, not the detail route');
  });
});

// ── Auth posture ─────────────────────────────────────────────────────────────

test('reads are open, matching the existing GET /api/v1/dlp precedent', async () => {
  // Deliberate, and consistent with the sibling read routes in dlp.js. The
  // unauthenticated read-path issue is tracked separately; if that gets fixed
  // repo-wide, this expectation is the one to flip.
  await withServer(async ({ post, get }) => {
    await post([promptEvent('sess-open', 0)]);
    assert.equal((await get('/api/v1/sessions')).status, 200);
    assert.equal((await get('/api/v1/sessions/sess-open')).status, 200);
    assert.equal((await get('/api/v1/sessions/stats/summary')).status, 200);
  });
});

test('ingest still requires machine auth', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/v1/dlp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [promptEvent('sess-noauth', 0)] }),
    });
    assert.equal(res.status, 401);
  });
});
