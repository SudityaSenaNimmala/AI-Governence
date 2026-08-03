// POST /api/v1/dlp — session grouping (Session Replay, phase 1).
//
// Exercises the real Express handler over real HTTP with a real machine JWT;
// only the Mongo handle is faked (tests/helpers/fake-db.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';

// auth.js generates a stable random JWT_SECRET per process when the env var is
// absent, so signing and verifying inside this one process always agree.
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'test-host' });

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (events, token = TOKEN) => fetch(`${base}/api/v1/dlp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ events }),
  });

  try {
    return await fn({ db, post, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function promptEvent(sessionId, seq, overrides = {}) {
  return {
    kind: 'prompt_submit',
    service: 'ChatGPT',
    occurredAt: new Date(Date.UTC(2026, 6, 1, 10, seq, 0)).toISOString(),
    session_id: sessionId,
    client_seq: seq,
    length_bucket: '100-1k',
    content_length: 120,
    matches: [],
    highest_severity: null,
    tabHost: 'chatgpt.com',
    ...overrides,
  };
}

test('five prompts in one tab → one session doc, ordered client_seq, message_count 5', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-0001';
    const events = [0, 1, 2, 3, 4].map((seq) => promptEvent(sid, seq));

    const res = await post(events);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, stored: 5, bound: 0 });

    // Every event carries the same session_id and its own client_seq, both as
    // top-level fields (not buried in metadata_json).
    const rows = db._rows('dlp_events');
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((r) => r.session_id), Array(5).fill(sid));
    assert.deepEqual(rows.map((r) => r.client_seq), [0, 1, 2, 3, 4]);
    assert.equal(rows.every((r) => r.machine_id === MACHINE_ID), true);

    // Exactly one session record, counting all five messages.
    const sessions = db._rows('ai_sessions');
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.session_id, sid);
    assert.equal(s.machine_id, MACHINE_ID);
    assert.equal(s.ai_service, 'ChatGPT');
    assert.equal(s.message_count, 5);
    assert.equal(s.external_conv_id, null);

    // started_at pinned to the first event, last_activity_at to the last.
    assert.equal(s.started_at.toISOString(), events[0].occurredAt);
    assert.equal(s.last_activity_at.toISOString(), events[4].occurredAt);
  });
});

test('session_bind sets external_conv_id, is not stored as a DLP event, and does not count as a message', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-bind-1';
    const res = await post([
      promptEvent(sid, 0),
      {
        kind: 'session_bind',
        service: 'ChatGPT',
        occurredAt: new Date(Date.UTC(2026, 6, 1, 10, 1, 0)).toISOString(),
        session_id: sid,
        client_seq: 1,
        external_conv_id: '68a1f0c2-conv-id',
      },
      promptEvent(sid, 2),
    ]);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, stored: 2, bound: 1 });

    const kinds = db._rows('dlp_events').map((r) => r.event_kind);
    assert.deepEqual(kinds, ['prompt_submit', 'prompt_submit']);

    const sessions = db._rows('ai_sessions');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].external_conv_id, '68a1f0c2-conv-id');
    assert.equal(sessions[0].message_count, 2);
  });
});

test('session_bind arriving first creates the session with message_count 0', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'session_bind',
      service: 'Claude',
      occurredAt: new Date(Date.UTC(2026, 6, 1, 9, 0, 0)).toISOString(),
      session_id: 'sess-bind-first',
      client_seq: 0,
      external_conv_id: 'claude-conv-9',
    }]);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, stored: 0, bound: 1 });

    assert.equal(db._rows('dlp_events').length, 0);
    const s = db._rows('ai_sessions')[0];
    assert.equal(s.message_count, 0);
    assert.equal(s.ai_service, 'Claude');
    assert.equal(s.external_conv_id, 'claude-conv-9');
    assert.ok(s.started_at instanceof Date);
  });
});

test('a new session_id in the same batch creates a second session doc', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([
      promptEvent('sess-A', 0),
      promptEvent('sess-A', 1),
      promptEvent('sess-B', 0),   // user clicked "New Chat" → fresh session, seq restarts
    ]);
    assert.equal(res.status, 201);

    const sessions = db._rows('ai_sessions').sort((a, b) => a.session_id.localeCompare(b.session_id));
    assert.deepEqual(sessions.map((s) => [s.session_id, s.message_count]), [
      ['sess-A', 2],
      ['sess-B', 1],
    ]);
  });
});

test('all event kinds funnel their session fields through', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-kinds';
    const at = new Date(Date.UTC(2026, 6, 1, 12, 0, 0)).toISOString();
    const base = { service: 'Gemini', occurredAt: at, session_id: sid };
    const res = await post([
      { ...base, kind: 'prompt_submit', client_seq: 0, matches: [], content_length: 10 },
      { ...base, kind: 'prompt_paste', client_seq: 1, matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }], content_length: 20 },
      { ...base, kind: 'file_upload', client_seq: 2, filename: 'a.csv', size: 99, severity: 'high', file_class: 'spreadsheet' },
      { ...base, kind: 'enforcement_block', client_seq: 3, matches: [], highest_severity: 'critical' },
      { ...base, kind: 'enforcement_redact', client_seq: 4, matches: [] },
      { ...base, kind: 'enforcement_decision', client_seq: 5, matches: [] },
    ]);
    assert.equal(res.status, 201);

    const rows = db._rows('dlp_events');
    assert.equal(rows.length, 6);
    assert.equal(rows.every((r) => r.session_id === sid), true);
    assert.deepEqual(rows.map((r) => r.client_seq), [0, 1, 2, 3, 4, 5]);
    assert.equal(db._rows('ai_sessions')[0].message_count, 6);
  });
});

test('events without session fields still ingest (older extension build)', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'prompt_submit',
      service: 'Perplexity',
      occurredAt: new Date().toISOString(),
      matches: [],
      content_length: 5,
    }]);
    assert.equal(res.status, 201);

    const row = db._rows('dlp_events')[0];
    assert.equal(row.session_id, null);
    assert.equal(row.client_seq, null);
    assert.equal(db._rows('ai_sessions').length, 0);
  });
});

test('malformed session fields are normalized away rather than stored', async () => {
  await withServer(async ({ db, post }) => {
    const at = new Date().toISOString();
    const res = await post([
      { kind: 'prompt_submit', service: 'X', occurredAt: at, session_id: '   ', client_seq: 'nope', matches: [] },
      { kind: 'prompt_submit', service: 'X', occurredAt: at, session_id: 'x'.repeat(200), client_seq: -3, matches: [] },
      { kind: 'prompt_submit', service: 'X', occurredAt: at, session_id: { evil: 1 }, client_seq: 1.5, matches: [] },
      { kind: 'session_bind', service: 'X', occurredAt: at, session_id: 'sess-ok', client_seq: 0, external_conv_id: 'y'.repeat(500) },
    ]);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, stored: 3, bound: 1 });

    for (const row of db._rows('dlp_events')) {
      assert.equal(row.session_id, null);
      assert.equal(row.client_seq, null);
    }
    // The bind still lands, but the oversized external id is dropped.
    const s = db._rows('ai_sessions')[0];
    assert.equal(s.session_id, 'sess-ok');
    assert.equal(s.external_conv_id, null);
  });
});

// ── Engagement rule: one session spans a stretch of AI use ──────────────────
// A session_id now covers continuous use of one AI service in one tab, so it
// outlives the AI site's own conversation ids and it lives long enough for the
// extension's offline queue to deliver events out of order.

test('a session that spans several chats accumulates every conversation id', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-multi-conv';
    const bind = (convId, minute) => ({
      kind: 'session_bind',
      service: 'ChatGPT',
      occurredAt: new Date(Date.UTC(2026, 6, 1, 10, minute, 0)).toISOString(),
      session_id: sid,
      external_conv_id: convId,
    });

    const res = await post([
      bind('conv-aaa', 0),
      promptEvent(sid, 1),
      bind('conv-bbb', 2),        // user switched chats — SAME session now
      promptEvent(sid, 3),
      bind('conv-aaa', 4),        // …and flipped back
    ]);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, stored: 2, bound: 3 });

    const sessions = db._rows('ai_sessions');
    assert.equal(sessions.length, 1, 'a chat switch no longer starts a new session');
    const s = sessions[0];
    // Scalar keeps its old meaning: the most recent conversation.
    assert.equal(s.external_conv_id, 'conv-aaa');
    // The array holds each DISTINCT id once, in first-seen order.
    assert.deepEqual(s.external_conv_ids, ['conv-aaa', 'conv-bbb']);
    assert.equal(s.message_count, 2);
    assert.equal(s.ai_service, 'ChatGPT');
  });
});

test('a session with no conversation id still gets an empty external_conv_ids', async () => {
  await withServer(async ({ db, post }) => {
    await post([promptEvent('sess-no-conv', 0)]);
    const s = db._rows('ai_sessions')[0];
    assert.equal(s.external_conv_id, null);
    assert.deepEqual(s.external_conv_ids, []);
  });
});

test('a late-arriving old event cannot drag last_activity_at backwards', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-late';
    // The live batch.
    await post([promptEvent(sid, 5), promptEvent(sid, 6)]);
    const after = db._rows('ai_sessions')[0].last_activity_at.toISOString();

    // Now a batch that had been sitting in the extension's offline queue since
    // 09:00 finally flushes. It must not make a live session look stale.
    const stale = promptEvent(sid, 0, {
      occurredAt: new Date(Date.UTC(2026, 6, 1, 9, 0, 0)).toISOString(),
    });
    await post([stale]);

    const s = db._rows('ai_sessions')[0];
    assert.equal(s.last_activity_at.toISOString(), after, 'last_activity_at only ever moves forward');
    // …but the older event DOES correct the start of the session.
    assert.equal(s.started_at.toISOString(), stale.occurredAt);
    assert.equal(s.message_count, 3, 'the late event still counts');
  });
});

test('the earliest event wins started_at however it arrives', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-order';
    const at = (h, m) => new Date(Date.UTC(2026, 6, 1, h, m, 0)).toISOString();

    // Deliberately out of order inside one batch.
    await post([
      promptEvent(sid, 0, { occurredAt: at(11, 30) }),
      promptEvent(sid, 1, { occurredAt: at(10, 0) }),
      promptEvent(sid, 2, { occurredAt: at(12, 0) }),
    ]);

    const s = db._rows('ai_sessions')[0];
    assert.equal(s.started_at.toISOString(), at(10, 0));
    assert.equal(s.last_activity_at.toISOString(), at(12, 0));
  });
});

test('a session_bind arriving before the first prompt still sets a correct window', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-bind-window';
    const at = (m) => new Date(Date.UTC(2026, 6, 1, 10, m, 0)).toISOString();
    await post([
      { kind: 'session_bind', service: 'Claude', occurredAt: at(0), session_id: sid, external_conv_id: 'c-1' },
      promptEvent(sid, 1, { occurredAt: at(4) }),
    ]);
    const s = db._rows('ai_sessions')[0];
    assert.equal(s.started_at.toISOString(), at(0), 'the bind opened the session');
    assert.equal(s.last_activity_at.toISOString(), at(4));
  });
});

test('the engagement fields product decided against are NOT written', async () => {
  await withServer(async ({ db, post }) => {
    await post([promptEvent('sess-scope', 0)]);
    const s = db._rows('ai_sessions')[0];
    for (const field of ['ended_at', 'end_reason', 'session_scope', 'ai_services']) {
      assert.equal(field in s, false, `${field} is explicitly out of scope`);
    }
  });
});

test('an event with neither service nor conversation id still upserts cleanly', async () => {
  // Guards the empty-$set / empty-$addToSet path — Mongo rejects an empty
  // operator document, so this would be a 500 in production, not a silent no-op.
  await withServer(async ({ db, post }) => {
    const res = await post([{
      kind: 'session_bind',
      service: 'ChatGPT',        // required by validateEvent…
      occurredAt: new Date(Date.UTC(2026, 6, 1, 10, 0, 0)).toISOString(),
      session_id: 'sess-bare',
      external_conv_id: '   ',   // …but normalized away, so nothing lands in $set
    }]);
    assert.equal(res.status, 201);
    const s = db._rows('ai_sessions')[0];
    assert.equal(s.session_id, 'sess-bare');
    assert.equal(s.external_conv_id, null);
    assert.deepEqual(s.external_conv_ids, []);
  });
});

test('a second machine cannot take over an existing session record', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-owned';
    await post([promptEvent(sid, 0)]);

    const otherToken = signMachineToken({ machineId: 'machine-evil', hostname: 'evil-host' });
    const res = await post([promptEvent(sid, 1)], otherToken);
    assert.equal(res.status, 201);

    const sessions = db._rows('ai_sessions');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].machine_id, MACHINE_ID, 'ownership stays with the first machine');
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
