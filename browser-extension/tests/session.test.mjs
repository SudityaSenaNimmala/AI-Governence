// The content-script half of session identity (Session Replay).
//
// The session BOUNDARY is not here any more — it is the engagement rule in
// lib/recording.js, driven by background/service-worker.js, and it is covered by
// tests/engagement.test.mjs. What this file pins down is what content.js is still
// responsible for, exercising the real slice of content/content.js (see
// load-session.mjs):
//
//   * emit() must NOT stamp session_id / client_seq. If it does, a page-lifetime
//     local is competing with the worker's engagement record and reloads start
//     "new sessions" again — the exact bug the change removed.
//   * the AI site's own conversation id is still read from the URL, and a change
//     still emits session_bind — but it no longer rotates anything.
//   * the session id the replay controller reads is a CACHED answer from the
//     worker, and asking for it must never mint.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSession } from './load-session.mjs';

// ── emit() no longer owns session identity ──────────────────────────────────

test('emit() sends no session_id and no client_seq — the worker stamps both', () => {
  const s = loadSession({ pathname: '/' });
  for (let i = 0; i < 5; i++) s.emit({ kind: 'prompt_submit', content_length: 10 + i });

  assert.equal(s.sent.length, 5);
  for (const e of s.sent) {
    assert.equal('session_id' in e, false, 'session identity is the worker\'s job');
    assert.equal('client_seq' in e, false, 'sequence numbers come from the engagement record');
  }
  // Everything else about an event is unchanged.
  assert.equal(s.sent.every((e) => e.service === 'ChatGPT'), true);
  assert.equal(s.sent.every((e) => typeof e.occurredAt === 'string'), true);
  assert.deepEqual(s.sent.map((e) => e.content_length), [10, 11, 12, 13, 14]);
});

test('emit() tells the worker whether the tab was visible', () => {
  // This is what decides whether the event slides the 15-min idle window. A
  // backgrounded tab still streaming replies must not keep its session alive.
  const s = loadSession();
  s.emit({ kind: 'prompt_submit' });
  assert.equal(s.sent[0].__cfai_visible, true);

  s.setVisibility('hidden');
  s.emit({ kind: 'ai_response' });
  assert.equal(s.sent[1].__cfai_visible, false);
});

test('emit() caches the session id the worker reports back', () => {
  const s = loadSession();
  assert.equal(s.currentSessionIdCached(), null, 'nothing known before anything happened');

  s.answerSessionId('sess-from-worker');
  s.emit({ kind: 'prompt_submit' });
  assert.equal(s.currentSessionIdCached(), 'sess-from-worker',
    'the response to the event is the cheapest possible refresh — no extra RPC');
  assert.equal(s.asks.length, 0, 'and it costs no extra round-trip');
});

test('a worker answer of null leaves the last known id alone', () => {
  // A momentarily unanswered send (worker asleep, context lost) must not blank the
  // id out from under a live replay run.
  const s = loadSession();
  s.answerSessionId('sess-1');
  s.emit({ kind: 'prompt_submit' });
  s.answerSessionId(null);
  s.emit({ kind: 'prompt_submit' });
  assert.equal(s.currentSessionIdCached(), 'sess-1');
});

// ── conversation id: still read here, no longer a boundary ──────────────────

test('a conversation id appearing in the URL emits session_bind', () => {
  const s = loadSession({ pathname: '/' });
  s.emit({ kind: 'prompt_submit' });

  // ChatGPT rewrites / → /c/<id> right after the first message.
  s.setPath('/c/68a1f0c2-1111-2222-3333-444455556666');
  s.checkConvUrl();

  const bind = s.sent[1];
  assert.equal(bind.kind, 'session_bind');
  assert.equal(bind.external_conv_id, '68a1f0c2-1111-2222-3333-444455556666');
  assert.equal(bind.content_text, undefined, 'session_bind carries no content');
  assert.equal('session_id' in bind, false);

  // Idempotent — re-checking the same URL does not re-bind.
  s.checkConvUrl();
  assert.equal(s.sent.length, 2);
});

test('switching to a different chat binds the new conversation and nothing else', () => {
  // This is THE behaviour change: it used to mint a new session_id and restart
  // client_seq. Now it is one informational event, and the session continues.
  const s = loadSession({ pathname: '/c/aaaaaaaa-1111-2222-3333-444455556666' });
  s.checkConvUrl();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].external_conv_id, 'aaaaaaaa-1111-2222-3333-444455556666');

  s.setPath('/c/bbbbbbbb-1111-2222-3333-444455556666');
  s.checkConvUrl();

  assert.equal(s.sent.length, 2);
  const bind = s.sent[1];
  assert.equal(bind.kind, 'session_bind');
  assert.equal(bind.external_conv_id, 'bbbbbbbb-1111-2222-3333-444455556666');
  // Nothing was rotated: no session_id was ever sent, so there is nothing to
  // restart, and the server $addToSet's both ids onto the SAME session.
  assert.equal(s.sent.every((e) => !('client_seq' in e)), true);
});

test('"New chat" (the conversation id disappears) binds nothing at all', () => {
  const s = loadSession({ pathname: '/c/aaaaaaaa-1111-2222-3333-444455556666' });
  s.checkConvUrl();
  assert.equal(s.sent.length, 1);

  s.setPath('/');
  s.checkConvUrl();
  assert.equal(s.sent.length, 1, 'there is no conversation id to bind, and no session to rotate');

  // The new chat gets its id → one bind, still the same session.
  s.setPath('/c/cccccccc-1111-2222-3333-444455556666');
  s.checkConvUrl();
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1].external_conv_id, 'cccccccc-1111-2222-3333-444455556666');
});

test('checkConvUrl() on a generic URL is a no-op, whatever the state', () => {
  const s = loadSession({ pathname: '/settings' });
  s.checkConvUrl();
  s.checkConvUrl();
  assert.equal(s.sent.length, 0);
});

test('conversation-id extraction covers the major SPA URL shapes', () => {
  const s = loadSession();
  const cases = [
    ['/c/68a1f0c2-abcd', '68a1f0c2-abcd'],                       // ChatGPT
    ['/chat/11112222-3333-4444', '11112222-3333-4444'],          // Claude / Poe
    ['/app/abc123defg', 'abc123defg'],                           // Gemini
    ['/search/why-is-the-sky-blue', 'why-is-the-sky-blue'],      // Perplexity
    ['/', null],
    ['/c/short', null],                                          // too short to be an id
    ['/settings', null],
  ];
  for (const [pathname, expected] of cases) {
    s.setPath(pathname);
    assert.equal(s.currentConvId(), expected, pathname);
  }
});

// ── asking the worker for the current session ───────────────────────────────

test('refreshSessionId asks the worker, marks the ask as a touch, and caches the reply', () => {
  const s = loadSession();
  s.answerSessionId('sess-resumed');
  s.refreshSessionId(true);

  assert.equal(s.asks.length, 1);
  assert.equal(s.asks[0].__cfai_kind, 'currentSessionId');
  assert.equal(s.asks[0].touch, true, 'reading a long reply is still use of the session');
  assert.equal(s.asks[0].__cfai_visible, true);
  assert.equal(s.currentSessionIdCached(), 'sess-resumed',
    'a session that survived this page load is picked straight back up');
  // The ask is a control RPC, never a governance event.
  assert.equal(s.sent.length, 0);
});

test('refreshSessionId is throttled unless forced', () => {
  const s = loadSession();
  s.refreshSessionId(true);
  s.refreshSessionId(false);
  s.refreshSessionId(false);
  assert.equal(s.asks.length, 1, 'an unforced re-ask inside the window is dropped');
  s.refreshSessionId(true);
  assert.equal(s.asks.length, 2, 'a forced refresh always asks');
});

test('asking never mints: the tab keeps reporting null until the worker has a session', () => {
  const s = loadSession();
  s.answerSessionId(null);
  s.refreshSessionId(true);
  s.refreshSessionId(true);
  assert.equal(s.currentSessionIdCached(), null);
  assert.equal(s.sent.length, 0, 'and no event was invented to create one');
});
