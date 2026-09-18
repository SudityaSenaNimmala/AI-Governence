// content.js's session-replay bootstrap — the wiring that made a fully-written,
// fully-tested recorder actually run.
//
// Exercises the real slice of content/content.js; see load-replay-bootstrap.mjs.
// The properties that matter here are all failure modes: a missing file, a
// subframe, a dead worker, a throwing constructor. None of them may take the DLP
// content script down with them, because DLP capture and enforcement are the
// features people are actually paying for.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadReplayBootstrap } from './load-replay-bootstrap.mjs';

test('it builds the controller with the collaborators only content.js can supply', () => {
  const b = loadReplayBootstrap();

  assert.equal(b.createCalls(), 1);
  const deps = b.createdDeps();
  assert.ok(deps, 'createReplayController was called');

  assert.equal(deps.rrweb, b.window.rrweb, 'the vendored recorder is handed in, not looked up later');
  assert.equal(typeof deps.send, 'function');
  assert.equal(deps.host, 'chatgpt.com', 'the HOSTNAME only — the path carries the conversation id');
  assert.equal(deps.doc, b.document);
  assert.equal(deps.getSessionId(), 'sess-cached', 'a cached read of the worker-owned session id');
  assert.equal(deps.visible(), true);

  // The banner functions are the real ones from the banner region, so "never
  // recorded without a visible indicator" is one implementation, not two.
  deps.showBanner('rep-1');
  deps.hideBanner();
  assert.deepEqual(b.banners, [{ show: 'rep-1' }, { hide: true }]);

  assert.equal(b.fakeController.initCalls, 1, 'and it was started');
  assert.equal(b.controller(), b.fakeController, 'the reference is kept for the banner stop path');
});

test('only the top frame records', () => {
  // content.js is injected with all_frames:true. A per-frame recorder would open N
  // runs for one page and each subframe would spend the same daily budget.
  const sub = loadReplayBootstrap({ topFrame: false });
  assert.equal(sub.createCalls(), 0);
  assert.equal(sub.controller(), null);
  assert.deepEqual(sub.banners, []);
  assert.deepEqual(sub.logs.warn, [], 'and it does not warn — this is normal, not a fault');
});

test('a missing file warns once and stops, and names the RIGHT file', () => {
  // Each precondition is reported separately. Blaming content/replay.js for a missing
  // vendor bundle (which is what this used to do whenever `api` was falsy) sends the
  // next person to debug it straight to the wrong file.
  const noReplay = loadReplayBootstrap({ replayApi: null });
  assert.equal(noReplay.createCalls(), 0);
  assert.equal(noReplay.controller(), null);
  assert.match(noReplay.logs.warn.join('\n'), /content\/replay\.js did not load/);
  assert.doesNotMatch(noReplay.logs.warn.join('\n'), /rrweb-record\.js/,
    'the vendor bundle is present here — it must not be blamed');

  const noRrweb = loadReplayBootstrap({ rrweb: null });
  assert.equal(noRrweb.createCalls(), 0);
  assert.equal(noRrweb.controller(), null);
  assert.match(noRrweb.logs.warn.join('\n'), /vendor\/rrweb-record\.js did not load/);
  assert.doesNotMatch(noRrweb.logs.warn.join('\n'), /content\/replay\.js/);

  // A vendor global that loaded but exposes no record() is the same situation as no
  // vendor global at all, and must be reported as such rather than as a missing
  // replay.js.
  const emptyRrweb = loadReplayBootstrap({ rrweb: {} });
  assert.equal(emptyRrweb.createCalls(), 0);
  assert.equal(emptyRrweb.controller(), null);
  assert.match(emptyRrweb.logs.warn.join('\n'), /vendor\/rrweb-record\.js did not load/);

  // An API object without the factory is the replay.js side of the same situation.
  const halfApi = loadReplayBootstrap({ replayApi: {} });
  assert.equal(halfApi.createCalls(), 0);
  assert.equal(halfApi.controller(), null);
  assert.match(halfApi.logs.warn.join('\n'), /content\/replay\.js did not load/);
});

test('a controller that blows up on construction or on init cannot break the DLP layer', async () => {
  const onCreate = loadReplayBootstrap({ throwOnCreate: true });
  assert.equal(onCreate.controller(), null, 'no half-built controller is kept');
  assert.match(onCreate.logs.warn.join('\n'), /failed to start/);

  // A controller whose init() is not async and throws outright.
  const onInit = loadReplayBootstrap({ throwOnInit: true });
  assert.equal(onInit.controller(), null);
  assert.match(onInit.logs.warn.join('\n'), /failed to start/);

  // THE REALISTIC ONE. The shipped init() is `async`, so it can only ever REJECT —
  // and the sync try/catch this region wraps the call in is structurally incapable of
  // catching that. Without an explicit .catch() this is an unhandled rejection in the
  // page's console on every failing init.
  const rejected = loadReplayBootstrap({ rejectOnInit: true });
  await new Promise((r) => setImmediate(r));
  assert.match(rejected.logs.warn.join('\n'), /init failed/);
  // The controller IS kept: init() arms its own tick timer regardless of a failure
  // inside it, and the banner's Stop path needs this reference to be able to stop the
  // recorder at all. A null here would reopen the governance hole where the indicator
  // comes down and the recorder keeps observing.
  assert.equal(rejected.controller(), rejected.fakeController);
  assert.equal(rejected.fakeController.initCalls, 1);
});

test('pagehide is wired, and beforeunload deliberately is not', () => {
  const b = loadReplayBootstrap();
  assert.equal(b.pagehide(), 1, 'exactly one pagehide listener');
  assert.equal(b.fakeController.pageHideCalls, 1);

  // beforeunload would disqualify the page from the back/forward cache.
  assert.equal(b.listeners.filter((l) => l.type === 'beforeunload').length, 0);
  // visibilitychange is folded into the ONE listener next to the session-id
  // refresh, further up content.js — this region must not register a second.
  assert.equal(b.listeners.filter((l) => l.type === 'visibilitychange').length, 0);
});

test('pagehide on a page with no controller is a no-op, not a crash', () => {
  const b = loadReplayBootstrap({ rrweb: null });
  assert.doesNotThrow(() => b.pagehide());
});

// ── sendReplayRpc ───────────────────────────────────────────────────────────

test('sendReplayRpc resolves the worker answer', async () => {
  const b = loadReplayBootstrap({ response: { ok: true, recordable: true, enabled: true } });
  const resp = await b.sendReplayRpc({ __cfai_kind: 'replayPolicy', host: 'chatgpt.com' });
  assert.deepEqual(resp, { ok: true, recordable: true, enabled: true });
  assert.deepEqual(b.sent.at(-1), { __cfai_kind: 'replayPolicy', host: 'chatgpt.com' });
});

test('sendReplayRpc RESOLVES { ok:false } on every failure — it never rejects', async () => {
  // The recorder treats any falsy / !ok answer as "not accepted" and handles it
  // (roll back the chunk, retry, eventually abort). A rejected promise would turn a
  // handled outage into an unhandled rejection in the page's console.
  const dead = loadReplayBootstrap({ lastError: { message: 'Receiving end does not exist' } });
  const a = await dead.sendReplayRpc({ __cfai_kind: 'replayChunk' });
  assert.equal(a.ok, false);
  assert.match(a.error, /Receiving end does not exist/);

  const gone = loadReplayBootstrap({ sendThrows: true });
  const c = await gone.sendReplayRpc({ __cfai_kind: 'replayChunk' });
  assert.equal(c.ok, false);
  assert.match(c.error, /Extension context invalidated/);

  // A worker that answers with nothing at all.
  const silent = loadReplayBootstrap({ response: null });
  const d = await silent.sendReplayRpc({ __cfai_kind: 'replayPolicy' });
  assert.deepEqual(d, { ok: false, error: 'no response' });
});

test('sendReplayRpc reads chrome.runtime.lastError on the success path too', async () => {
  // Not reading it makes Chrome log "Unchecked runtime.lastError" for every send to
  // a worker that has been terminated — which is every idle worker, i.e. constantly.
  // The behavioural proof is the test above; this pins it at the source level so the
  // read cannot be optimised away into the error branch only.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
  const from = src.indexOf('function sendReplayRpc');
  assert.ok(from > 0, 'sendReplayRpc not found');
  const slice = src.slice(from, from + 800);
  assert.match(slice, /const err = chrome\.runtime\.lastError/,
    'lastError must be read before the response is inspected');
});
