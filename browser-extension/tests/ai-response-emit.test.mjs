// The content-script half of AI response capture (Session Replay, phase 3).
//
// Exercises the real ai_response listener from content/content.js wired to the
// real conversation-identity block, so what is under test is the actual contract:
// a reply handed over from the page world becomes ONE emitted event.
//
// Session grouping is NOT asserted here any more — the service worker stamps
// session_id / client_seq onto every event as it arrives, from the engagement
// record it owns for the tab (tests/engagement.test.mjs covers that rule). What
// this file pins down is that the listener does not try to do it itself.
//
// See load-ai-response-listener.mjs for how the regions are sliced.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadAiResponseListener } from './load-ai-response-listener.mjs';

test('a captured reply is emitted as one ai_response event', () => {
  const s = loadAiResponseListener();
  s.fire({ text: 'The capital of France is Paris.', format: 'sse', site: 'chatgpt', truncated: false, duration_ms: 2400 });

  assert.equal(s.sent.length, 1, 'exactly one event per response');
  const ev = s.sent[0];
  assert.equal(ev.kind, 'ai_response');
  assert.equal(ev.content_text, 'The capital of France is Paris.');
  assert.equal(ev.content_length, 31);
  assert.equal(ev.service, 'ChatGPT');
  assert.equal(ev.response_format, 'sse');
  assert.equal(ev.capture_truncated, 0);
  assert.equal(ev.duration_ms, 2400);
  assert.equal(typeof ev.occurredAt, 'string');
  // The worker stamps the session fields; the listener must not.
  assert.equal('session_id' in ev, false);
  assert.equal('client_seq' in ev, false);
});

test('a reply goes out through emit(), so it is grouped and ordered by the worker', () => {
  const s = loadAiResponseListener();
  s.emit({ kind: 'prompt_submit', content_length: 12 });
  s.fire({ text: 'first reply', format: 'sse' });
  s.emit({ kind: 'prompt_submit', content_length: 8 });
  s.fire({ text: 'second reply', format: 'sse' });

  assert.deepEqual(s.sent.map((e) => e.kind), ['prompt_submit', 'ai_response', 'prompt_submit', 'ai_response']);
  // Every one of them is an ordinary emit() with no session identity of its own —
  // the worker assigns one session_id and consecutive client_seqs on arrival, so a
  // turn-by-turn conversation stays ordered without the page owning a counter.
  assert.equal(s.sent.every((e) => !('session_id' in e) && !('client_seq' in e)), true);
  assert.equal(s.sent.every((e) => e.__cfai_visible === true), true);
});

test('a reply captured while the tab is hidden does not count as visible use', () => {
  // A backgrounded tab that keeps streaming replies must not keep its session
  // alive past the idle window — the worker needs to be told which it was.
  const s = loadAiResponseListener({ visibility: 'hidden' });
  s.fire({ text: 'a reply nobody is looking at', format: 'sse' });
  assert.equal(s.sent[0].__cfai_visible, false);
});

test('an identical back-to-back reply is dropped, a different one is not', () => {
  const s = loadAiResponseListener();
  s.fire({ text: 'same answer', format: 'sse' });
  s.fire({ text: 'same answer', format: 'sse' });     // refetch / regenerate of the same turn
  assert.equal(s.sent.length, 1);

  s.fire({ text: 'a different answer', format: 'sse' });
  assert.equal(s.sent.length, 2);

  // …and the first text may legitimately come round again later.
  s.fire({ text: 'same answer', format: 'sse' });
  assert.equal(s.sent.length, 3);
});

test('empty, blank and non-string replies emit nothing', () => {
  const s = loadAiResponseListener();
  s.fire({ text: '' });
  s.fire({ text: '   \n\t ' });
  s.fire({ text: null });
  s.fire({ text: 12345 });
  s.fire({});
  s.fire(undefined);
  assert.equal(s.sent.length, 0);
  assert.equal(s.currentSessionIdCached(), null, 'and nothing pretended a session exists');
});

test('an over-cap reply is truncated and flagged rather than dropped', () => {
  const s = loadAiResponseListener();
  const huge = 'x'.repeat(1024 * 1024 + 500);
  s.fire({ text: huge, format: 'sse', truncated: false });

  const ev = s.sent[0];
  assert.equal(ev.content_length, 1024 * 1024);
  assert.equal(ev.content_text.length, 1024 * 1024);
  assert.equal(ev.capture_truncated, 1);
});

test('a page-side truncation flag is carried through even when under the cap', () => {
  const s = loadAiResponseListener();
  s.fire({ text: 'partial reply', format: 'sse', truncated: true });
  assert.equal(s.sent[0].capture_truncated, 1);
});

test('the reply carries no scan verdict in this phase (capture only)', () => {
  const s = loadAiResponseListener();
  s.fire({ text: 'here is an ssn 123-45-6789', format: 'sse' });
  assert.deepEqual(s.sent[0].matches, []);
  assert.equal(s.sent[0].highest_severity, undefined);
});

test('a listener throw can never escape into the page', () => {
  const s = loadAiResponseListener();
  // A detail object whose getter throws — the handler must swallow it.
  const hostile = { get text() { throw new Error('boom'); } };
  assert.doesNotThrow(() => s.fire(hostile));
  assert.equal(s.sent.length, 0);
});

// ── which conversation a reply belongs to ───────────────────────────────────
// The page side captures it when the request is TEED. A long answer can still be
// streaming when the user has clicked into another chat, so reading the URL at
// end-of-stream would file the reply under whichever chat is on screen by then.

test('a reply is filed under the conversation captured at tee time, not the current one', () => {
  const s = loadAiResponseListener({ pathname: '/c/conversation-newer' });
  // The user asked in the older chat, then switched while the answer streamed.
  s.fire({ text: 'the answer to the earlier question', format: 'sse', external_conv_id: 'conversation-older' });
  assert.equal(s.sent[0].external_conv_id, 'conversation-older');
});

test('a reply with no captured id falls back rather than inventing one', () => {
  const s = loadAiResponseListener({ pathname: '/c/conversation-aaaa' });
  // Nothing has been interacted with, so there is no active conversation either.
  s.fire({ text: 'an answer', format: 'sse' });
  assert.equal(s.sent[0].external_conv_id, null);

  // After a real prompt in this chat, the fallback is that chat.
  s.emit({ kind: 'prompt_submit', content_length: 4 });
  s.fire({ text: 'another answer', format: 'sse' });
  assert.equal(s.sent.at(-1).external_conv_id, 'conversation-aaaa');
});

test('a junk captured id is ignored, not forwarded', () => {
  const s = loadAiResponseListener({ pathname: '/c/conversation-aaaa' });
  s.emit({ kind: 'prompt_submit' });
  for (const bad of ['', '   ', 42, null, {}]) {
    s.fire({ text: `answer ${String(bad)}`, format: 'sse', external_conv_id: bad });
    assert.equal(s.sent.at(-1).external_conv_id, 'conversation-aaaa', String(bad));
  }
});
