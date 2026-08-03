// POST /api/v1/dlp — AI response capture (Session Replay, phase 3).
//
// Same harness as dlp-sessions.test.mjs: the real Express handler over real
// HTTP with a real machine JWT; only the Mongo handle is faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';
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

const at = (min) => new Date(Date.UTC(2026, 6, 1, 10, min, 0)).toISOString();

function promptEvent(sessionId, seq, overrides = {}) {
  return {
    kind: 'prompt_submit',
    service: 'ChatGPT',
    occurredAt: at(seq),
    session_id: sessionId,
    client_seq: seq,
    length_bucket: '100-1k',
    content_length: 120,
    content_text: 'what is the capital of France?',
    matches: [],
    tabHost: 'chatgpt.com',
    ...overrides,
  };
}

function responseEvent(sessionId, seq, text, overrides = {}) {
  return {
    kind: 'ai_response',
    service: 'ChatGPT',
    occurredAt: at(seq),
    session_id: sessionId,
    client_seq: seq,
    content_text: text,
    content_length: text.length,
    length_bucket: '100-1k',
    matches: [],
    response_format: 'sse',
    capture_truncated: 0,
    duration_ms: 2400,
    tabHost: 'chatgpt.com',
    ...overrides,
  };
}

test('ai_response is stored like any other dlp_event, with role=assistant and its full text', async () => {
  await withServer(async ({ db, post, base }) => {
    const sid = 'sess-resp-1';
    const reply = 'The capital of France is Paris.';
    const res = await post([promptEvent(sid, 0), responseEvent(sid, 1, reply)]);
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { ok: true, stored: 2, bound: 0 });

    const rows = db._rows('dlp_events');
    assert.equal(rows.length, 2);

    const [prompt, response] = rows;
    assert.equal(prompt.event_kind, 'prompt_submit');
    assert.equal(prompt.role, 'user');
    assert.equal(response.event_kind, 'ai_response');
    assert.equal(response.role, 'assistant');

    // Session fields stay top-level, exactly as phase 1 established.
    assert.equal(response.session_id, sid);
    assert.equal(response.client_seq, 1);
    assert.equal(response.machine_id, MACHINE_ID);
    assert.equal(response.ai_service, 'ChatGPT');
    assert.equal(response.content_length, reply.length);
    assert.equal(response.secret_class, null);

    // Descriptive capture detail goes to metadata_json, never content.
    const meta = JSON.parse(response.metadata_json);
    assert.equal(meta.response_format, 'sse');
    assert.equal(meta.capture_truncated, 0);
    assert.equal(meta.duration_ms, 2400);
    assert.equal(meta.tab_host, 'chatgpt.com');
    assert.equal('content_text' in meta, false, 'reply text must not be duplicated into metadata');

    // The reply text lands in dlp_content via the same mechanism prompts use.
    const content = db._rows('dlp_content');
    assert.equal(content.length, 2);
    const respContent = content.find((c) => c.event_id === response.id);
    assert.equal(respContent.content_text, reply);
    assert.equal(respContent.kind, 'response', 'distinguishable from a prompt body');
    assert.equal(respContent.mime_type, 'text/plain; charset=utf-8');
    assert.equal(respContent.truncated, 0);

    // …and is readable back over the existing content route.
    const fetched = await fetch(`${base}/api/v1/dlp/${response.id}/content`);
    assert.equal(fetched.status, 200);
    assert.equal(await fetched.text(), reply);
  });
});

test('a captured reply counts towards the session, split by role', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-resp-2';
    const res = await post([
      promptEvent(sid, 0),
      responseEvent(sid, 1, 'first reply'),
      promptEvent(sid, 2),
      responseEvent(sid, 3, 'second reply'),
    ]);
    assert.equal(res.status, 201);

    const sessions = db._rows('ai_sessions');
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.session_id, sid);
    assert.equal(s.message_count, 4, 'every stored event still counts');
    assert.equal(s.user_message_count, 2);
    assert.equal(s.assistant_message_count, 2);
    // Activity window advances with the reply, not just the prompt.
    assert.equal(s.last_activity_at.toISOString(), at(3));
    assert.equal(s.started_at.toISOString(), at(0));
  });
});

test('an ai_response arriving before any prompt still creates the session', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([responseEvent('sess-resp-orphan', 0, 'reply with no prompt seen')]);
    assert.equal(res.status, 201);
    const s = db._rows('ai_sessions')[0];
    assert.equal(s.message_count, 1);
    assert.equal(s.user_message_count, 0);
    assert.equal(s.assistant_message_count, 1);
    assert.equal(s.machine_id, MACHINE_ID);
  });
});

test('role is derived from the event kind, never trusted from the client', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-role-spoof';
    const res = await post([
      // A caller claiming to be the assistant on a user prompt.
      promptEvent(sid, 0, { role: 'assistant' }),
      // …and vice versa.
      responseEvent(sid, 1, 'hi', { role: 'user' }),
    ]);
    assert.equal(res.status, 201);

    const rows = db._rows('dlp_events');
    assert.equal(rows[0].role, 'user');
    assert.equal(rows[1].role, 'assistant');

    const s = db._rows('ai_sessions')[0];
    assert.equal(s.user_message_count, 1);
    assert.equal(s.assistant_message_count, 1);
  });
});

test('every existing event kind gets a sensible role', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-roles';
    const base = { service: 'Claude', occurredAt: at(0), session_id: sid };
    const res = await post([
      { ...base, kind: 'prompt_submit', client_seq: 0, matches: [] },
      { ...base, kind: 'prompt_paste', client_seq: 1, matches: [] },
      { ...base, kind: 'prompt_typed', client_seq: 2, matches: [] },
      { ...base, kind: 'file_upload', client_seq: 3, filename: 'a.csv', size: 9, severity: 'high', file_class: 'spreadsheet' },
      { ...base, kind: 'ai_response', client_seq: 4, content_text: 'reply', content_length: 5 },
      { ...base, kind: 'enforcement_block', client_seq: 5, matches: [], highest_severity: 'critical' },
      { ...base, kind: 'enforcement_redact', client_seq: 6, matches: [] },
      { ...base, kind: 'enforcement_decision', client_seq: 7, matches: [] },
      { ...base, kind: 'something_new_we_have_not_seen', client_seq: 8, matches: [] },
    ]);
    assert.equal(res.status, 201);

    assert.deepEqual(db._rows('dlp_events').map((r) => [r.event_kind, r.role]), [
      ['prompt_submit', 'user'],
      ['prompt_paste', 'user'],
      ['prompt_typed', 'user'],
      ['file_upload', 'user'],
      ['ai_response', 'assistant'],
      ['enforcement_block', 'system'],
      ['enforcement_redact', 'system'],
      ['enforcement_decision', 'system'],
      ['something_new_we_have_not_seen', 'system'],
    ]);

    const s = db._rows('ai_sessions')[0];
    assert.equal(s.message_count, 9);
    assert.equal(s.user_message_count, 4);
    assert.equal(s.assistant_message_count, 1);
  });
});

test('the conversation can be replayed in order from session_id + client_seq + role', async () => {
  await withServer(async ({ db, post }) => {
    const sid = 'sess-replay';
    // Deliberately out of delivery order — client_seq is the ordering truth.
    await post([
      responseEvent(sid, 3, 'Paris is the capital.'),
      promptEvent(sid, 2, { content_text: 'and France?' }),
      responseEvent(sid, 1, 'Berlin is the capital.'),
      promptEvent(sid, 0, { content_text: 'capital of Germany?' }),
    ]);

    const events = db._rows('dlp_events')
      .filter((r) => r.session_id === sid)
      .sort((a, b) => a.client_seq - b.client_seq);
    const content = new Map(db._rows('dlp_content').map((c) => [c.event_id, c.content_text]));

    assert.deepEqual(events.map((e) => [e.client_seq, e.role, content.get(e.id)]), [
      [0, 'user', 'capital of Germany?'],
      [1, 'assistant', 'Berlin is the capital.'],
      [2, 'user', 'and France?'],
      [3, 'assistant', 'Paris is the capital.'],
    ]);
  });
});

test('an oversized reply is stored truncated and flagged, not rejected', async () => {
  await withServer(async ({ db, post }) => {
    // MAX_CONTENT_BYTES in dlp.js is 25 MB; go just past it.
    const huge = 'x'.repeat(26 * 1024 * 1024);
    const res = await post([responseEvent('sess-huge', 0, huge, { content_length: huge.length })]);
    assert.equal(res.status, 201);

    const row = db._rows('dlp_content')[0];
    assert.equal(row.truncated, 1);
    assert.ok(row.content_text.length < huge.length);
    assert.equal(db._rows('dlp_events')[0].role, 'assistant');
  });
});

test('an ai_response with no text stores the event but no content row', async () => {
  await withServer(async ({ db, post }) => {
    const res = await post([responseEvent('sess-empty', 0, '', { content_text: '', content_length: 0 })]);
    assert.equal(res.status, 201);
    assert.equal(db._rows('dlp_events').length, 1);
    assert.equal(db._rows('dlp_content').length, 0);
  });
});

test('ai_response still requires machine auth', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/v1/dlp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [responseEvent('sess-noauth', 0, 'nope')] }),
    });
    assert.equal(res.status, 401);
  });
});
