// content/content.js — WHICH CONVERSATION an event is filed under.
//
// Two different questions share one region of that file, and conflating them is
// what this suite exists to prevent:
//
//   "which chat is the user composing in?"  — _activeConvId. Debounced against
//      mere navigation ON PURPOSE: it moves only on a real user action, so
//      clicking through five old chats never starts five recordings. The replay
//      controller reads this and nothing else.
//
//   "where did this thing that just happened, happen?"  — a LIVE read of the
//      URL. Enforcement records, access requests and routing decisions are
//      system-generated at a moment in time; there is no composition to debounce
//      and the cache is simply the wrong answer for them.
//
// THE BUG. A prompt that trips enforcement never reaches logPromptEvent() — the
// blocking branch deliberately skips it and emits only enforcement_block,
// carrying the blocked text — and a blocked file upload skips emitFileUpload()
// the same way. Neither path moved _activeConvId, so the evidence was stamped
// with the last chat the user successfully TYPED in. Block something in chat B
// right after prompting in chat A and it was filed under chat A.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeConvIdentityWorld, emittedKinds } from './load-conv-identity.mjs';

// ── the regression ───────────────────────────────────────────────────────────

test('a BLOCKED prompt is filed under the chat it was blocked in, not the last one typed in', () => {
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });

  // The user's last SUCCESSFUL prompt was in chat A.
  w.emit({ kind: 'prompt_submit', content_length: 11 });
  assert.equal(w.last.external_conv_id, 'chat-aaaa-0001');
  assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001');

  // They switch to chat B and paste a secret. The prompt is BLOCKED, so
  // logPromptEvent() is never called and only the enforcement record is emitted.
  w.navigate('/c/chat-bbbb-0002');
  w.emit({
    kind: 'enforcement_block',
    blocked_for: 'prompt_submit',
    highest_severity: 'critical',
    content_text: 'sk-live-0123456789',
  });

  assert.equal(w.last.external_conv_id, 'chat-bbbb-0002',
    'the blocked prompt belongs to the chat it was blocked in — a LIVE read');
  assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001',
    '…and reading the URL for it must NOT move the composition cache');
});

test('every non-user-action, non-reply kind reads the URL live', () => {
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });
  w.emit({ kind: 'prompt_submit' });                 // the cache is now chat-aaaa-0001
  w.navigate('/c/chat-bbbb-0002');

  for (const kind of [
    'enforcement_block',      // a blocked prompt, and a blocked file upload
    'enforcement_redact',     // the redact-and-send path
    'enforcement_decision',   // what the user chose in the modal
    'enforcement_override',   // any future enforcement action, by prefix
    'model_routed',
  ]) {
    w.emit({ kind });
    assert.equal(w.last.external_conv_id, 'chat-bbbb-0002', kind);
    assert.equal(w.last.kind, kind);
  }
  assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001', 'none of them moved the cache');
});

test('a live read that finds no id stores null — never a guess, never the stale one', () => {
  // A brand-new chat: the site does not mint /c/<id> until the first message has
  // been sent, so there is genuinely nothing to attribute this to. Null is the
  // correct outcome — misattributing is worse than not attributing, and the
  // server backfills the opening turn once the id appears.
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });
  w.emit({ kind: 'prompt_submit' });
  assert.equal(w.last.external_conv_id, 'chat-aaaa-0001');

  w.navigate('/');
  w.emit({ kind: 'enforcement_block', blocked_for: 'prompt_submit' });
  assert.equal(w.last.external_conv_id, null);
  assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001');
});

// ── what must NOT change ─────────────────────────────────────────────────────

test('THE DEBOUNCE SURVIVES: a user action still moves the cache, navigation still does not', () => {
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });
  w.emit({ kind: 'prompt_submit' });
  assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001');

  // Clicking through old chats without typing: the recorder's view never moves,
  // which is the whole no-timer debounce.
  for (const id of ['chat-bbbb-0002', 'chat-cccc-0003', 'chat-dddd-0004']) {
    w.navigate(`/c/${id}`);
    assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001');
  }
  // …until they actually type in one.
  w.emit({ kind: 'prompt_paste' });
  assert.equal(w.activeConvIdCached(), 'chat-dddd-0004');
  assert.equal(w.last.external_conv_id, 'chat-dddd-0004');

  // Every user-action kind moves it; a file upload included.
  w.navigate('/c/chat-eeee-0005');
  w.emit({ kind: 'file_upload', filename: 'x.pdf' });
  assert.equal(w.activeConvIdCached(), 'chat-eeee-0005');
});

test('an AI reply keeps its own capture-time id, and falls back to the cache', () => {
  // A reply is the model acting, not the user, and it can land after the user
  // has already switched chats — so the response listener carries the id it
  // recorded when the request was TEED. It is deliberately not a live read.
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });
  w.emit({ kind: 'prompt_submit' });

  w.navigate('/c/chat-bbbb-0002');
  w.emit({ kind: 'ai_response', external_conv_id: 'chat-aaaa-0001', length_bucket: '1k-10k' });
  assert.equal(w.last.external_conv_id, 'chat-aaaa-0001', 'the id captured at request time wins');

  // With no captured id it falls back to the cache — NOT to a live read, which
  // would attribute a slow reply to whatever chat the user has since opened.
  w.emit({ kind: 'ai_response', length_bucket: '1k-10k' });
  assert.equal(w.last.external_conv_id, 'chat-aaaa-0001');
  assert.equal(w.activeConvIdCached(), 'chat-aaaa-0001');
});

test('session_bind is about one specific id and always supplies its own', () => {
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });
  w.checkConvUrl();
  assert.equal(w.last.kind, 'session_bind');
  assert.equal(w.last.external_conv_id, 'chat-aaaa-0001');
  // A bare navigation binds, but still does not move the composition cache.
  assert.equal(w.activeConvIdCached(), null);

  // "New chat" (an id → no id) binds nothing.
  const before = w.sent.length;
  w.navigate('/');
  w.checkConvUrl();
  assert.equal(w.sent.length, before);
});

test('emit() still sends no session identity of its own', () => {
  // The worker owns session_id / client_seq and stamps both on arrival; a second,
  // page-lifetime-scoped opinion is the bug that ownership move removed.
  const w = makeConvIdentityWorld({ pathname: '/c/chat-aaaa-0001' });
  w.emit({ kind: 'prompt_submit' });
  assert.equal('session_id' in w.last, false);
  assert.equal('client_seq' in w.last, false);
  assert.equal(w.last.__cfai_visible, true);
  assert.equal(w.last.service, 'ChatGPT');
});

// ── the kind lists are pinned against the emitting code ──────────────────────

test('every kind content.js emits is on exactly one side of the split', () => {
  // A new kind that lands on neither list silently inherits the stale cache,
  // which is the failure mode this whole suite is about. So the lists are
  // checked against the kinds the shipped file actually EMITS — read off the
  // emit() call sites themselves, not off a whole-file grep for `kind:`.
  //
  // The grep is what let a dead entry live: `access_request` is not an emit() at
  // all (a bare sendMessage the worker relays to /api/v1/access-requests, which
  // never reaches dlp_events and so has no conversation id to stamp), but it
  // looked like one to a text scan, so LIVE_CONV_ID_KINDS could list it and this
  // test would confirm the rule it was inventing. See emittedKinds().
  const emitted = emittedKinds();

  const w = makeConvIdentityWorld();
  const CARRIES_OWN_ID = new Set(['ai_response', 'session_bind']);

  for (const kind of emitted) {
    const live = w.readsLiveConvId(kind);
    const cached = w.USER_ACTION_KINDS.has(kind);
    if (CARRIES_OWN_ID.has(kind)) {
      assert.equal(live, false, `${kind} carries its own capture-time id`);
      continue;
    }
    assert.equal(live || cached, true,
      `${kind} is on neither list — it would silently inherit a stale conversation id`);
    assert.equal(live && cached, false, `${kind} cannot be on both lists`);
  }

  // THE OTHER DIRECTION, which is the half that was missing. A listed kind that
  // no emit() call sends is a rule about nothing, and it reads as though it were
  // load-bearing — so it must fail here rather than be quietly inherited by the
  // next person deciding where a new kind belongs.
  //
  // One deliberate exemption: 'prompt_typed' is emitted by agent/src/os_monitor,
  // not by content.js, and is pinned in USER_ACTION_KINDS for cross-subsystem
  // consistency (server routes/dlp.js counts all four as user turns).
  const NOT_EMITTED_BY_CONTENT_JS = new Set(['prompt_typed']);
  for (const kind of [...w.LIVE_CONV_ID_KINDS, ...w.USER_ACTION_KINDS]) {
    if (NOT_EMITTED_BY_CONTENT_JS.has(kind)) continue;
    assert.equal(emitted.has(kind), true,
      `'${kind}' is listed, but no emit() call in content.js sends it — dead entry`);
  }

  // The four that really are compositions, and nothing else.
  assert.deepEqual([...w.USER_ACTION_KINDS].sort(),
    ['file_upload', 'prompt_paste', 'prompt_submit', 'prompt_typed']);
});
