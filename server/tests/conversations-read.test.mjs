// GET /api/v1/conversations* — the AI site's OWN chat threads, and the
// POST /api/v1/replays/:replay_id/conversation write that feeds them.
//
// Same harness as sessions-read.test.mjs / replays.test.mjs: real Express
// handlers over real HTTP with a real machine JWT and a real admin token, and
// only the Mongo handle faked. Fixtures go in through the REAL ingest routes, so
// every read here is tested against the document shape ingest actually writes.
//
// ── THE ACCEPTANCE REQUIREMENT ───────────────────────────────────────────────
// One tab, one sitting, no idle gap: ask in chat A, switch to chat B and ask,
// come back to A and ask. That is ONE session by design (the engagement rule —
// a chat switch is deliberately not a session boundary), and it used to be ONE
// undifferentiated recording. Chat A's conversation must now hold its two turns
// and NOTHING from B, and chat B's must hold only its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';

import { mountDlp } from '../src/routes/dlp.js';
import { mountSessions } from '../src/routes/sessions.js';
import { mountConversations, encodeConversationKey } from '../src/routes/conversations.js';
import { mountReplays } from '../src/routes/replays.js';
import { signMachineToken, ADMIN_TOKEN } from '../src/auth.js';
import { applyInitialSchema } from '../src/db/index.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const MACHINE_ID = 'machine-abc-123';
const TOKEN = signMachineToken({ machineId: MACHINE_ID, hostname: 'test-host' });

const OTHER_MACHINE = 'machine-xyz-999';
const OTHER_TOKEN = signMachineToken({ machineId: OTHER_MACHINE, hostname: 'other-host' });

const at = (min) => new Date(Date.UTC(2026, 6, 1, 10, min, 0)).toISOString();

async function withServer(fn) {
  const db = createFakeDb();
  await applyInitialSchema(db);

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountDlp(app, db);
  mountSessions(app, db);
  mountConversations(app, db);
  mountReplays(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const json = async (res) => {
    const text = await res.text();
    try { return { body: JSON.parse(text), text }; } catch { return { body: text, text }; }
  };

  const api = {
    db,
    base,

    /** POST real events through the real ingest route. */
    async ingest(events, token = TOKEN) {
      const res = await fetch(`${base}/api/v1/dlp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ events }),
      });
      const { body } = await json(res);
      return { status: res.status, body };
    },

    /** Admin read. `admin:false` proves the route is not open like /sessions. */
    async get(path, { admin = true } = {}) {
      const headers = admin ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
      const res = await fetch(`${base}${path}`, { headers });
      const { body, text } = await json(res);
      return { status: res.status, body, text };
    },

    async registerReplay(body = {}, token = TOKEN) {
      const res = await fetch(`${base}/api/v1/replays`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          replay_id: crypto.randomUUID(),
          tab_host: 'chatgpt.com',
          ai_service: 'openai',
          capture: 'dom_events',
          recorder: 'rrweb@2.0.0-alpha.20',
          started_at: at(0),
          ...body,
        }),
      });
      const { body: out } = await json(res);
      return { status: res.status, body: out };
    },

    async bindConversation(replayId, body, token = TOKEN) {
      const res = await fetch(`${base}/api/v1/replays/${encodeURIComponent(replayId)}/conversation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const { body: out } = await json(res);
      return { status: res.status, body: res.status === 204 ? null : out };
    },

    async completeReplay(replayId, body = {}, token = TOKEN) {
      const res = await fetch(`${base}/api/v1/replays/${encodeURIComponent(replayId)}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const { body: out } = await json(res);
      return { status: res.status, body: out };
    },
  };

  try {
    return await fn(api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** A user turn, exactly as the browser extension now sends it. */
function prompt(sessionId, seq, text, convId, overrides = {}) {
  return {
    kind: 'prompt_submit',
    service: 'ChatGPT',
    occurredAt: at(seq),
    session_id: sessionId,
    client_seq: seq,
    external_conv_id: convId,
    content_length: text.length,
    length_bucket: '100-1k',
    content_text: text,
    matches: [],
    tabHost: 'chatgpt.com',
    ...overrides,
  };
}

/** The tiny event that tells the server "this session also touched chat X". */
function bind(sessionId, convId, min) {
  return {
    kind: 'session_bind',
    service: 'ChatGPT',
    occurredAt: at(min),
    session_id: sessionId,
    external_conv_id: convId,
  };
}

// ── grouping ─────────────────────────────────────────────────────────────────

test('two sessions that touched the same conversation are ONE conversation', async () => {
  await withServer(async ({ ingest, get }) => {
    // Monday's session and Tuesday's session, same chat.
    await ingest([bind('sess-mon', 'conv-A', 0), prompt('sess-mon', 1, 'first visit', 'conv-A')]);
    await ingest([bind('sess-tue', 'conv-A', 10), prompt('sess-tue', 11, 'second visit', 'conv-A')]);

    const { status, body } = await get('/api/v1/conversations');
    assert.equal(status, 200);
    assert.equal(body.length, 1, 'one conversation, not two sessions');

    const c = body[0];
    assert.equal(c.external_conv_id, 'conv-A');
    assert.equal(c.machine_id, MACHINE_ID);
    assert.equal(c.session_count, 2);
    assert.deepEqual(c.session_ids, ['sess-mon', 'sess-tue'], 'oldest → newest');
    assert.equal(c.started_at, at(0), 'the earliest visit');
    assert.equal(c.last_activity_at, at(11), 'the latest activity in any visit');
    assert.equal(c.message_count, 2);
    assert.equal(c.user_message_count, 2);
    assert.equal(typeof c.conversation_key, 'string');
  });
});

test('a session with no conversation id is its own standalone group', async () => {
  await withServer(async ({ ingest, get }) => {
    await ingest([prompt('sess-plain', 0, 'on a site with no id in the URL', undefined)]);
    await ingest([bind('sess-chat', 'conv-A', 5), prompt('sess-chat', 6, 'in a real chat', 'conv-A')]);

    const { body } = await get('/api/v1/conversations');
    assert.equal(body.length, 2);

    const plain = body.find((c) => c.external_conv_id === null);
    assert.ok(plain, 'it still appears — an ungrouped session is not a hidden one');
    assert.equal(plain.session_count, 1);
    assert.deepEqual(plain.session_ids, ['sess-plain']);
    // Same shape as every other row, so nothing downstream has to branch.
    assert.deepEqual(Object.keys(plain).sort(), Object.keys(body.find((c) => c.external_conv_id === 'conv-A')).sort());
    // …but no key: there is nothing stable to address it by, and a fabricated
    // one would decode to a filter matching every id-less event of a machine.
    assert.equal(plain.conversation_key, null);
  });
});

test('the same conversation id on two machines is never merged', async () => {
  await withServer(async ({ ingest, get }) => {
    // A shared chat link: the AI site mints the id, so two machines can hold it.
    await ingest([bind('sess-mine', 'conv-shared', 0), prompt('sess-mine', 1, 'my turn', 'conv-shared')]);
    await ingest(
      [bind('sess-theirs', 'conv-shared', 2), prompt('sess-theirs', 3, 'their turn', 'conv-shared')],
      OTHER_TOKEN,
    );

    const { body } = await get('/api/v1/conversations');
    const shared = body.filter((c) => c.external_conv_id === 'conv-shared');
    assert.equal(shared.length, 2, 'two conversations — one per machine');
    assert.deepEqual(shared.map((c) => c.machine_id).sort(), [MACHINE_ID, OTHER_MACHINE].sort());
    assert.notEqual(shared[0].conversation_key, shared[1].conversation_key);

    // …and the detail route holds the line too.
    const key = encodeConversationKey(MACHINE_ID, 'conv-shared');
    const { body: detail } = await get(`/api/v1/conversations/${key}`);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].content_length, 'my turn'.length);
  });
});

test('a just-used conversation sorts to the top, and the filters match /sessions', async () => {
  await withServer(async ({ ingest, get }) => {
    await ingest([bind('sess-a', 'conv-A', 0), prompt('sess-a', 1, 'older', 'conv-A')]);
    await ingest([bind('sess-b', 'conv-B', 5), prompt('sess-b', 6, 'newer', 'conv-B')]);
    assert.deepEqual((await get('/api/v1/conversations')).body.map((c) => c.external_conv_id), ['conv-B', 'conv-A']);

    // One more turn in the OLDER chat lifts the whole conversation, because the
    // group's last_activity_at is the max over its sessions.
    await ingest([prompt('sess-a', 9, 'back again', 'conv-A', { occurredAt: at(20) })]);
    assert.deepEqual((await get('/api/v1/conversations')).body.map((c) => c.external_conv_id), ['conv-A', 'conv-B']);

    assert.equal((await get(`/api/v1/conversations?machine_id=${OTHER_MACHINE}`)).body.length, 0);
    assert.equal((await get('/api/v1/conversations?ai_service=ChatGPT')).body.length, 2);
    assert.equal((await get('/api/v1/conversations?ai_service=Claude')).body.length, 0);
    assert.equal((await get('/api/v1/conversations?limit=1')).body.length, 1);
    assert.equal((await get('/api/v1/conversations?from=nonsense')).status, 400);
  });
});

test('both conversation routes need admin auth — the same check the replay routes use', async () => {
  await withServer(async ({ ingest, get }) => {
    await ingest([bind('sess-a', 'conv-A', 0), prompt('sess-a', 1, 'hello', 'conv-A')]);
    assert.equal((await get('/api/v1/conversations', { admin: false })).status, 401);
    const key = encodeConversationKey(MACHINE_ID, 'conv-A');
    assert.equal((await get(`/api/v1/conversations/${key}`, { admin: false })).status, 401);
  });
});

// ── the opaque key is a security boundary ────────────────────────────────────

test('a malformed or hostile key is a 400 — never a 500, and never a query', async () => {
  await withServer(async ({ ingest, get }) => {
    await ingest([bind('sess-a', 'conv-A', 0), prompt('sess-a', 1, 'hello', 'conv-A')]);

    const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
    const bad = [
      // '+' and '=' are base64 but NOT base64url, and both are legal in a path
      // segment — so this really does reach the decoder rather than Express's
      // own 404.
      ['not base64url at all', 'not+base64=url'],
      ['blank', '%20'],
      ['too long', 'A'.repeat(2000)],
      ['not JSON', Buffer.from('nonsense{', 'utf8').toString('base64url')],
      ['a JSON array', b64([1, 2, 3])],
      ['a JSON scalar', b64('just-a-string')],
      ['no version', b64({ m: MACHINE_ID, c: 'conv-A' })],
      ['wrong version', b64({ v: 2, m: MACHINE_ID, c: 'conv-A' })],
      ['missing machine', b64({ v: 1, c: 'conv-A' })],
      ['blank conversation', b64({ v: 1, m: MACHINE_ID, c: '   ' })],
      ['over-long conversation', b64({ v: 1, m: MACHINE_ID, c: 'x'.repeat(300) })],
      // THE INJECTION ATTEMPT: a Mongo operator document where a string belongs.
      // If the decoded object were spread into the filter, this would match every
      // conversation of every machine.
      ['$ne operator as the machine id', b64({ v: 1, m: { $ne: null }, c: 'conv-A' })],
      ['$ne operator as the conversation id', b64({ v: 1, m: MACHINE_ID, c: { $ne: null } })],
      ['$gt operator as the conversation id', b64({ v: 1, m: MACHINE_ID, c: { $gt: '' } })],
      ['a nested regex', b64({ v: 1, m: MACHINE_ID, c: { $regex: '.*' } })],
    ];

    for (const [why, key] of bad) {
      const { status, body } = await get(`/api/v1/conversations/${key}`);
      assert.equal(status, 400, `${why} → 400, got ${status}`);
      assert.equal(body.error, 'invalid conversation key', why);
    }
  });
});

test('a well-formed key that names nothing is a 404, not a 400', async () => {
  await withServer(async ({ ingest, get }) => {
    await ingest([bind('sess-a', 'conv-A', 0), prompt('sess-a', 1, 'hello', 'conv-A')]);
    const key = encodeConversationKey(MACHINE_ID, 'conv-does-not-exist');
    assert.equal((await get(`/api/v1/conversations/${key}`)).status, 404);
  });
});

// ── POST /api/v1/replays/:replay_id/conversation ─────────────────────────────

test('a run binds its conversation once, and then it is immutable', async () => {
  await withServer(async ({ registerReplay, bindConversation }) => {
    const { body: run } = await registerReplay({ session_id: 'sess-a' });
    const id = run.replay_id;

    // null → id
    assert.equal((await bindConversation(id, { external_conv_id: 'conv-A' })).status, 204);
    // the SAME id again — the recorder retries on any transport failure
    assert.equal((await bindConversation(id, { external_conv_id: 'conv-A' })).status, 204);
    assert.equal((await bindConversation(id, { external_conv_id: '  conv-A  ' })).status, 204, 'normalized the same way');
    // a DIFFERENT id — refused. Re-filing a stored recording under another
    // conversation would MOVE evidence.
    const clash = await bindConversation(id, { external_conv_id: 'conv-B' });
    assert.equal(clash.status, 409);
    assert.match(clash.body.error, /different conversation/);
  });
});

test('binding refuses a malformed body, another machine, and an unknown run', async () => {
  await withServer(async ({ registerReplay, bindConversation }) => {
    const { body: run } = await registerReplay({ session_id: 'sess-a' });
    const id = run.replay_id;

    for (const body of [{}, { external_conv_id: '' }, { external_conv_id: '   ' }, { external_conv_id: 42 },
      { external_conv_id: null }, { external_conv_id: 'x'.repeat(300) }, { external_conv_id: { $ne: null } }]) {
      const res = await bindConversation(id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }

    assert.equal((await bindConversation(id, { external_conv_id: 'conv-A' }, OTHER_TOKEN)).status, 403);
    assert.equal((await bindConversation(crypto.randomUUID(), { external_conv_id: 'conv-A' })).status, 404);
    // Nothing above was allowed to land.
    assert.equal((await bindConversation(id, { external_conv_id: 'conv-Z' })).status, 204);
  });
});

test('a finished run will not take a NEW conversation, but a retry of its own is fine', async () => {
  await withServer(async ({ registerReplay, bindConversation, completeReplay }) => {
    const { body: run } = await registerReplay({ session_id: 'sess-a' });
    const id = run.replay_id;
    assert.equal((await bindConversation(id, { external_conv_id: 'conv-A' })).status, 204);
    await completeReplay(id, { stop_reason: 'conversation_changed' });

    // A retry that lands just after the run ended still succeeds — the stored
    // value is already what it is asking for.
    assert.equal((await bindConversation(id, { external_conv_id: 'conv-A' })).status, 204);
    // …but the membership of a finished run cannot be changed.
    const late = await bindConversation(id, { external_conv_id: 'conv-B' });
    assert.equal(late.status, 409);

    const { body: unbound } = await registerReplay({ session_id: 'sess-a' });
    await completeReplay(unbound.replay_id, { stop_reason: 'pagehide' });
    const closed = await bindConversation(unbound.replay_id, { external_conv_id: 'conv-C' });
    assert.equal(closed.status, 409);
    assert.match(closed.body.error, /not accepting a conversation binding/);
  });
});

// ── the replay routes' own shape ─────────────────────────────────────────────

test("'conversation_changed' is a CLEAN ending, not an aborted run", async () => {
  await withServer(async ({ registerReplay, completeReplay }) => {
    const { body: run } = await registerReplay({ session_id: 'sess-a', external_conv_id: 'conv-A' });
    const { status, body } = await completeReplay(run.replay_id, {
      stop_reason: 'conversation_changed',
      chunk_count: 2,
      event_count: 40,
      ended_at: at(5),
      duration_ms: 300_000,
    });
    assert.equal(status, 200);
    assert.equal(body.status, 'complete', 'a chat switch is a normal ending, not a failure');
    assert.equal(body.stop_reason, 'conversation_changed');
    assert.equal(body.abort_reason, null);
  });
});

test('the replay list/manifest gain external_conv_id and change in no other way', async () => {
  await withServer(async ({ registerReplay, get }) => {
    const { body: bound } = await registerReplay({ session_id: 'sess-a', external_conv_id: '  conv-A  ' });
    const { body: unbound } = await registerReplay({ session_id: 'sess-a' });

    const { body: list } = await get('/api/v1/replays');
    const rowOf = (id) => list.find((r) => r.replay_id === id);
    assert.equal(rowOf(bound.replay_id).external_conv_id, 'conv-A', 'trimmed on the way in');
    assert.equal(rowOf(unbound.replay_id).external_conv_id, null, 'optional, defaults null');

    // Byte-compatible otherwise: exactly one new key on the run shape.
    const KNOWN = [
      'replay_id', 'machine_id', 'tab_host', 'ai_service', 'capture', 'recorder', 'mask_profile',
      'session_ids', 'started_at', 'ended_at', 'duration_ms', 'first_event_ts', 'last_event_ts',
      'event_count', 'chunk_count', 'byte_size', 'client_event_count', 'client_chunk_count',
      'audio', 'status', 'stop_reason', 'abort_reason', 'cap_exceeded', 'expires_at', 'expired_at',
      'purged_at', 'purged_reason', 'purged_chunk_count', 'purged_byte_size',
    ];
    assert.deepEqual(Object.keys(rowOf(bound.replay_id)).sort(), [...KNOWN, 'external_conv_id'].sort());

    // The filter, and the manifest.
    const { body: filtered } = await get('/api/v1/replays?external_conv_id=conv-A');
    assert.deepEqual(filtered.map((r) => r.replay_id), [bound.replay_id]);
    const { body: manifest } = await get(`/api/v1/replays/${bound.replay_id}`);
    assert.equal(manifest.external_conv_id, 'conv-A');
    assert.ok(manifest.playback && manifest.integrity && Array.isArray(manifest.chunks), 'unchanged otherwise');
  });
});

// ── every turn carries its own conversation ──────────────────────────────────

test('ingest stores the conversation per EVENT, and leaves the session doc alone', async () => {
  await withServer(async ({ ingest, db, get }) => {
    await ingest([
      bind('sess-a', 'conv-A', 0),
      prompt('sess-a', 1, 'in chat A', 'conv-A'),
      prompt('sess-a', 2, 'in chat B', 'conv-B'),
    ]);

    const events = db._rows('dlp_events');
    assert.deepEqual(events.map((e) => e.external_conv_id), ['conv-A', 'conv-B']);

    // The session's OWN conversation tracking is unchanged: only session_bind
    // moves it, so the scalar is still the bound one and the array still holds
    // exactly what was bound.
    const session = db._rows('ai_sessions')[0];
    assert.equal(session.external_conv_id, 'conv-A');
    assert.deepEqual(session.external_conv_ids, ['conv-A']);

    // A junk id on an event is dropped, never stored as-is.
    await ingest([prompt('sess-a', 3, 'junk id', undefined, { external_conv_id: { $ne: null } })]);
    await ingest([prompt('sess-a', 4, 'long id', undefined, { external_conv_id: 'x'.repeat(300) })]);
    assert.deepEqual(db._rows('dlp_events').slice(2).map((e) => e.external_conv_id), [null, null]);

    // And the session read route is untouched by any of it.
    const { body } = await get('/api/v1/sessions/sess-a');
    assert.equal(body.session.external_conv_id, 'conv-A');
    assert.equal(body.messages.length, 4);
  });
});

test('the conversation id does NOT reach the SIEM feed', async () => {
  // siemForward('dlp', eventDoc) runs the doc through normalizeDlpEvent, which
  // maps an explicit allowlist of fields — so a field added to eventDoc cannot
  // start leaving the building by accident. Asserted rather than assumed,
  // because "it happens not to be mapped today" is not a control.
  const { normalizeDlpEvent } = await import('../src/lib/cef.js');
  const ev = normalizeDlpEvent({
    id: 'e-1',
    event_kind: 'prompt_submit',
    machine_id: MACHINE_ID,
    ai_service: 'ChatGPT',
    occurred_at: at(0),
    secret_class: 'critical',
    external_conv_id: 'conv-SECRET-THREAD-ID',
    metadata_json: JSON.stringify({ tab_host: 'chatgpt.com' }),
  });
  assert.equal(JSON.stringify(ev).includes('conv-SECRET-THREAD-ID'), false);
  assert.equal(JSON.stringify(ev).includes('external_conv_id'), false);
});

// ── the first turn of a BRAND-NEW chat ───────────────────────────────────────
// A new chat has no id in the URL until AFTER the first prompt is sent — the
// site mints /c/<id> in response to that first message. So the opening question
// (and usually its reply) is stamped external_conv_id: null at emit time and
// nothing ever went back to fix it up, even though the REPLAY side of this
// feature has always handled the same timing gap correctly with its late bind.
// The result was a conversation detail view that permanently omitted the very
// question that started the conversation.

test('the OPENING question of a brand-new chat is adopted once the id appears', async () => {
  await withServer(async ({ ingest, db, get }) => {
    const S = 'sess-new-chat';

    // The first prompt goes out with no conversation id in existence yet…
    await ingest([prompt(S, 1, 'What is CloudFuze?', undefined)]);
    assert.deepEqual(db._rows('dlp_events').map((e) => e.external_conv_id), [null],
      'stamped null, as it must be — there was nothing else to stamp it with');

    // …and the site then mints one, which the content script binds. Both ride
    // the same queue, so the bind lands in (or right after) the batch carrying
    // that first prompt.
    await ingest([bind(S, 'conv-new', 2), prompt(S, 3, 'and what does it cost?', 'conv-new')]);

    const key = encodeConversationKey(MACHINE_ID, 'conv-new');
    const { status, body } = await get(`/api/v1/conversations/${key}`);
    assert.equal(status, 200);
    assert.deepEqual(body.messages.map((m) => m.content_length), [
      'What is CloudFuze?'.length,
      'and what does it cost?'.length,
    ], 'the opening question is there, first, in order');
  });
});

test('the backfill adopts the reply too, and stops at the events it may touch', async () => {
  await withServer(async ({ ingest, db, get }) => {
    const S = 'sess-new-chat';

    // Another session, another machine, and an already-stamped turn: none of
    // them may move. The backfill can only ADD grouping, never change it.
    await ingest([prompt('sess-other', 1, 'a different sitting', undefined)]);
    await ingest([prompt('sess-theirs', 1, 'another machine', undefined)], OTHER_TOKEN);
    await ingest([
      prompt(S, 2, 'the opening question', undefined),
      { ...prompt(S, 3, 'its reply', undefined), kind: 'ai_response' },
      prompt(S, 4, 'already stamped', 'conv-OLD'),
    ]);

    await ingest([bind(S, 'conv-new', 5)]);

    const rows = db._rows('dlp_events');
    const conv = (sid, seq) => rows.find((r) => r.session_id === sid && r.client_seq === seq)?.external_conv_id;
    assert.equal(conv(S, 2), 'conv-new', 'the opening prompt');
    assert.equal(conv(S, 3), 'conv-new', 'and its reply');
    assert.equal(conv(S, 4), 'conv-OLD', 'a turn that already had an id is NEVER moved');
    assert.equal(conv('sess-other', 1), null, 'another session of the same machine is untouched');
    assert.equal(conv('sess-theirs', 1), null, 'another machine is untouched');

    // Idempotent: a repeat bind changes nothing.
    await ingest([bind(S, 'conv-new', 6)]);
    assert.equal(conv(S, 4), 'conv-OLD');
    const { body } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-new')}`);
    assert.equal(body.messages.length, 2);
  });
});

test('a session that visits two new chats keeps them apart — each bind clears its own', async () => {
  await withServer(async ({ ingest, get }) => {
    const S = 'sess-two-new-chats';
    // Both events and binds ride the SAME queue, so they arrive in order.
    await ingest([
      prompt(S, 1, 'first new chat', undefined),
      bind(S, 'conv-first', 2),
      prompt(S, 3, 'second new chat', undefined),
      bind(S, 'conv-second', 4),
    ]);

    const first = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-first')}`);
    const second = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-second')}`);
    assert.deepEqual(first.body.messages.map((m) => m.content_length), ['first new chat'.length]);
    assert.deepEqual(second.body.messages.map((m) => m.content_length), ['second new chat'.length]);
  });
});

test("the REPLAY run's own late bind backfills the same way", async () => {
  // The other signal that "the id is now known". It reaches the server within a
  // second of the id appearing, which is usually BEFORE the first prompt has
  // flushed (the extension drains its event queue on a 1-minute alarm) — but a
  // run bound late, on a retry, or with recording started mid-conversation can
  // be the first to know, so it runs the same bounded update.
  await withServer(async ({ ingest, registerReplay, bindConversation, db, get }) => {
    const S = 'sess-replay-bind';
    const { body: run } = await registerReplay({ session_id: S });
    // No `session_bind` on this path at all: the events are the only thing that
    // ever carried this conversation, so the summary comes from them.
    await ingest([prompt(S, 1, 'the opening question', undefined)]);
    assert.equal(db._rows('dlp_events')[0].external_conv_id, null);

    assert.equal((await bindConversation(run.replay_id, { external_conv_id: 'conv-late' })).status, 204);
    assert.equal(db._rows('dlp_events')[0].external_conv_id, 'conv-late');

    const { body } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-late')}`);
    assert.equal(body.messages.length, 1);
    assert.equal(body.conversation.external_conv_id, 'conv-late');
    assert.deepEqual(body.replays.map((r) => r.replay_id), [run.replay_id]);
  });
});

test('a REFUSED bind backfills nothing — the events keep whatever they had', async () => {
  await withServer(async ({ ingest, registerReplay, bindConversation, db }) => {
    const S = 'sess-refused';
    const { body: run } = await registerReplay({ session_id: S, external_conv_id: 'conv-A' });
    await ingest([prompt(S, 1, 'no id yet', undefined)]);

    // A different id on an already-bound run is a 409, and must not move events.
    assert.equal((await bindConversation(run.replay_id, { external_conv_id: 'conv-B' })).status, 409);
    assert.equal(db._rows('dlp_events')[0].external_conv_id, null);
    // Another machine's attempt is a 403, likewise.
    const { body: mine } = await registerReplay({ session_id: S });
    assert.equal((await bindConversation(mine.replay_id, { external_conv_id: 'conv-C' }, OTHER_TOKEN)).status, 403);
    assert.equal(db._rows('dlp_events')[0].external_conv_id, null);
  });
});

// ── the detail route's counters tell the truth about their own caps ──────────

test('a conversation with more visits than the cap says so', async () => {
  await withServer(async ({ ingest, get }) => {
    // 51 separate sittings in the same chat — one over MAX_SESSIONS_PER_CONVERSATION.
    for (let i = 0; i < 51; i++) {
      await ingest([bind(`sess-${i}`, 'conv-busy', i), prompt(`sess-${i}`, i, 'again', 'conv-busy')]);
    }
    const { body } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-busy')}`);
    assert.equal(body.visits.length, 50, 'the page is capped');
    assert.equal(body.conversation.sessions_truncated, true,
      'and it ADMITS the cap — the page used to be fetched without the +1, so this could never be true');
    assert.equal(body.conversation.session_count, 50, 'the count is of what was returned');

    // …and next to it, the count that is NOT of what was returned. The pair of
    // them is the point: session_count matches the visits array a UI renders and
    // matches the list row, session_count_total is how many there really are.
    // Before this, replay_count was exact while these silently stopped at 50.
    assert.equal(body.conversation.session_count_total, 51, 'every sitting, past the cap');
    assert.equal(body.conversation.message_count_total, 51, 'and every turn');
    assert.equal(body.conversation.user_message_count_total, 51);
    assert.equal(body.conversation.assistant_message_count_total, 0);
    // The capped sum is still the under-report it always was, ON PURPOSE — it is
    // the same figure the list row shows, and the list cannot afford an events
    // query per row.
    assert.equal(body.conversation.message_count, 50);
  });
});

test('the true totals are exact PER CONVERSATION, not a per-session upper bound', async () => {
  await withServer(async ({ ingest, get }) => {
    // One sitting across two chats: three turns in A, one in B. The session's own
    // message_count is 4 for both conversations — that is the documented upper
    // bound the list row reports — while the totals count only this chat's turns.
    const S = 'sess-mixed';
    await ingest([
      bind(S, 'conv-A', 0),
      prompt(S, 1, 'first', 'conv-A'),
      { ...prompt(S, 2, 'its reply', 'conv-A'), kind: 'ai_response' },
      bind(S, 'conv-B', 3),
      prompt(S, 4, 'over in B', 'conv-B'),
      prompt(S, 5, 'back in A', 'conv-A'),
    ]);

    const { body: A } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-A')}`);
    assert.equal(A.messages.length, 3);
    assert.equal(A.conversation.message_count, 4, 'the whole session, as documented');
    assert.equal(A.conversation.message_count_total, 3, 'this conversation only');
    assert.equal(A.conversation.user_message_count_total, 2);
    assert.equal(A.conversation.assistant_message_count_total, 1);
    assert.equal(A.conversation.session_count_total, 1);

    const { body: B } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-B')}`);
    assert.equal(B.conversation.message_count_total, 1);
    assert.equal(B.conversation.user_message_count_total, 1);
    assert.equal(B.conversation.assistant_message_count_total, 0);
    assert.equal(B.conversation.session_count_total, 1);
  });
});

test('a conversation no session ever bound still counts its own sittings', async () => {
  // The summarizeFromMessages() branch: no visit row exists, so the sessions are
  // read off the turns themselves — and off ALL of them, not off the capped page.
  await withServer(async ({ ingest, registerReplay, bindConversation, get }) => {
    const { body: run } = await registerReplay({ session_id: 'sess-one' });
    await ingest([prompt('sess-one', 1, 'no id yet', undefined)]);
    await ingest([prompt('sess-two', 1, 'nor here', undefined)]);
    // The replay's late bind adopts only its OWN session's turns.
    assert.equal((await bindConversation(run.replay_id, { external_conv_id: 'conv-late' })).status, 204);

    const { body } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-late')}`);
    assert.equal(body.visits.length, 0, 'nothing ever bound it to a session');
    assert.equal(body.conversation.session_count_total, 1, 'counted from the turns, not from zero visits');
    assert.equal(body.conversation.message_count_total, 1);
    assert.equal(body.conversation.user_message_count_total, 1);
  });
});

test('replay_count is the TRUE total, and is_live survives the replay cap', async () => {
  await withServer(async ({ ingest, registerReplay, completeReplay, get }) => {
    await ingest([bind('sess-a', 'conv-many', 0), prompt('sess-a', 1, 'hello', 'conv-many')]);

    // 51 runs, oldest first. Every one of them but the newest has finished.
    const ids = [];
    for (let i = 0; i < 51; i++) {
      const { body } = await registerReplay({
        session_id: 'sess-a', external_conv_id: 'conv-many', started_at: at(i),
      });
      ids.push(body.replay_id);
    }
    for (const id of ids.slice(0, 50)) await completeReplay(id, { stop_reason: 'pagehide' });

    const { body } = await get(`/api/v1/conversations/${encodeConversationKey(MACHINE_ID, 'conv-many')}`);
    assert.equal(body.replays.length, 50, 'the page is capped');
    assert.equal(body.replays_truncated, true);
    assert.equal(body.conversation.replay_count, 51,
      'the count is the true total, not the length of the capped page');
    assert.equal(body.conversation.is_live, true,
      'the run that is still recording is the NEWEST — i.e. exactly the one the cap drops');
  });
});

// ── THE ACCEPTANCE SCENARIO ──────────────────────────────────────────────────

test('A → B → A in one sitting: each chat gets its own turns and its own runs', async () => {
  await withServer(async ({ ingest, registerReplay, bindConversation, completeReplay, get }) => {
    // ONE session throughout — a same-service chat switch is deliberately not a
    // session boundary, which is exactly why the session view cannot tell these
    // three questions apart.
    const S = 'sess-one-sitting';

    // Chat A: "What is CloudFuze?"
    const { body: runA1 } = await registerReplay({ session_id: S, external_conv_id: 'conv-A' });
    await ingest([bind(S, 'conv-A', 0), prompt(S, 1, 'What is CloudFuze?', 'conv-A')]);

    // → chat B: "What is AI Governance?"
    await completeReplay(runA1.replay_id, { stop_reason: 'conversation_changed', session_ids: [S] });
    const { body: runB } = await registerReplay({ session_id: S, external_conv_id: 'conv-B', started_at: at(2) });
    await ingest([bind(S, 'conv-B', 2), prompt(S, 3, 'What is AI Governance?', 'conv-B')]);

    // → back to chat A: "What is Data Governance?". This run registers before the
    // id is known and BINDS it afterwards, exercising the other write path.
    await completeReplay(runB.replay_id, { stop_reason: 'conversation_changed', session_ids: [S] });
    const { body: runA2 } = await registerReplay({ session_id: S, started_at: at(4) });
    assert.equal((await bindConversation(runA2.replay_id, { external_conv_id: 'conv-A' })).status, 204);
    await ingest([bind(S, 'conv-A', 4), prompt(S, 5, 'What is Data Governance?', 'conv-A')]);

    // Two conversations, from one session.
    const { body: list } = await get('/api/v1/conversations');
    assert.deepEqual(list.map((c) => c.external_conv_id).sort(), ['conv-A', 'conv-B']);
    const rowA = list.find((c) => c.external_conv_id === 'conv-A');
    assert.equal(rowA.session_count, 1, 'both visits were the same engagement');
    assert.equal(rowA.replay_count, 2);
    assert.equal(rowA.is_live, true, 'the third run is still recording');

    // Chat A: its two turns, in order, and NOTHING from B.
    const { body: A, text: textA } = await get(`/api/v1/conversations/${rowA.conversation_key}`);
    assert.deepEqual(A.messages.map((m) => m.content_length), [
      'What is CloudFuze?'.length,
      'What is Data Governance?'.length,
    ]);
    assert.equal(A.messages.length, 2);
    assert.equal(A.messages_truncated, false);
    assert.deepEqual(A.replays.map((r) => r.replay_id), [runA1.replay_id, runA2.replay_id]);
    assert.equal(A.replays.length, 2, 'and NOT the run that covered chat B');
    assert.deepEqual(A.visits.map((v) => v.session_id), [S]);
    // No prompt or response body is ever returned by this route.
    assert.equal(textA.includes('What is CloudFuze?'), false);

    // Chat B: only its own.
    const rowB = list.find((c) => c.external_conv_id === 'conv-B');
    const { body: B } = await get(`/api/v1/conversations/${rowB.conversation_key}`);
    assert.equal(B.messages.length, 1);
    assert.equal(B.messages[0].content_length, 'What is AI Governance?'.length);
    assert.deepEqual(B.replays.map((r) => r.replay_id), [runB.replay_id]);
    assert.equal(B.replays.length, 1);
    assert.equal(B.conversation.is_live, false);

    // The turn bodies are still reachable exactly where they always were.
    assert.equal(A.messages.every((m) => m.has_content), true);
  });
});

test('the detail route returns the same message and replay shapes /sessions does', async () => {
  await withServer(async ({ ingest, registerReplay, get }) => {
    await ingest([bind('sess-a', 'conv-A', 0), prompt('sess-a', 1, 'hello there', 'conv-A')]);
    const { body: runRow } = await registerReplay({ session_id: 'sess-a', external_conv_id: 'conv-A' });

    const key = encodeConversationKey(MACHINE_ID, 'conv-A');
    const { body: conv } = await get(`/api/v1/conversations/${key}`);
    const { body: sess } = await get('/api/v1/sessions/sess-a');

    assert.deepEqual(Object.keys(conv.messages[0]).sort(), Object.keys(sess.messages[0]).sort());
    assert.deepEqual(conv.messages[0], sess.messages[0]);
    assert.deepEqual(Object.keys(conv.replays[0]).sort(), Object.keys(sess.replays[0]).sort());
    assert.equal(conv.replays[0].replay_id, runRow.replay_id);
    assert.equal(conv.replays_truncated, false);

    // The summary carries the grouping fields a list row does.
    assert.equal(conv.conversation.external_conv_id, 'conv-A');
    assert.equal(conv.conversation.machine_id, MACHINE_ID);
    assert.equal(conv.conversation.conversation_key, key);
  });
});

test('the worst severity in a conversation is reported on the existing scale', async () => {
  await withServer(async ({ ingest, get }) => {
    const critical = { matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }] };
    const low = { matches: [{ pattern: 'email', severity: 'low', count: 1 }] };
    await ingest([
      bind('sess-a', 'conv-A', 0),
      prompt('sess-a', 1, 'harmless', 'conv-A', low),
      prompt('sess-a', 2, 'my ssn is ...', 'conv-A', critical),
      prompt('sess-a', 3, 'harmless again', 'conv-A', low),
    ]);

    const { body } = await get('/api/v1/conversations');
    assert.equal(body[0].highest_severity, 'critical', 'a watermark, never lowered');
    assert.equal(body[0].highest_severity_rank, 4);
  });
});
