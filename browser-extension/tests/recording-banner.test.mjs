// The recording INDICATOR region of content/content.js — which, by deliberate
// product decision, indicates nothing.
//
// HISTORY, because these tests read strangely without it. This region used to
// paint a fixed banner ("This tab is being recorded for AI governance") with a
// Stop recording button, and it used to watch that banner: if the host page pruned
// the node, the region FAILED CLOSED and stopped the recorder, on the principle
// that a tab must never be recorded without a visible indicator.
//
// That principle was replaced, not violated. This deployment governs employee AI
// usage under a policy the employee is notified of through other channels
// (handbook / IT policy / onboarding). Notice is an HR control here, not page
// chrome — so the banner, the Stop button and the whole fail-closed watcher were
// removed rather than merely hidden, and recording is intentionally not stoppable
// from the page.
//
// So this file's job is the inverse of what it once was: prove the ABSENCE of a
// stop mechanism and of any DOM footprint, and keep the two surviving no-op hooks
// safe to call. That absence is asserted twice over — dynamically, by driving
// every entry point against spies, and statically, against the shipped source —
// because the failure mode being guarded is "someone re-adds a Stop button",
// and new code that this harness's stubs happen not to reach would slip past a
// purely dynamic test.
//
// Exercises the real slice of content/content.js — see load-recording-banner.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  loadRecordingBanner,
  bannerRegionCode,
  contentSource,
  stripComments,
} from './load-recording-banner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── the two surviving hooks are no-ops ──────────────────────────────────────
// They exist only because the replay controller's DI contract calls them
// (`d.showBanner` / `d.hideBanner`) at run start, registration, pause, resume and
// complete. See content/replay.js — it neither knows nor cares that they do
// nothing, which is why replay.js and its tests were untouched by this change.

test('showRecordingBanner() creates no DOM, whatever it is passed', () => {
  const b = loadRecordingBanner();

  for (const arg of ['rec-1', '', null, undefined, 0, 123, {}, [], true]) {
    assert.equal(b.showRecordingBanner(arg), null, 'always returns null');
  }

  assert.deepEqual(b.domNodes(), [], 'nothing was appended to the document');
  assert.deepEqual(b.elementsCreated, [], 'no element was even constructed');
  assert.deepEqual(b.domCalls, [], 'no DOM method was called at all');
});

test('showRecordingBanner() called repeatedly stays a no-op', () => {
  const b = loadRecordingBanner();
  for (let i = 0; i < 50; i++) b.showRecordingBanner(`rec-${i}`);

  assert.deepEqual(b.domNodes(), []);
  assert.deepEqual(b.domCalls, []);
  assert.equal(b.observersCreated(), 0, 'no fail-closed watcher armed');
  assert.deepEqual(b.timerCalls, [], 'no poll installed');
});

test('hideRecordingBanner() is safe when nothing was ever shown', () => {
  const b = loadRecordingBanner();

  assert.doesNotThrow(() => b.hideRecordingBanner());
  assert.doesNotThrow(() => b.hideRecordingBanner());
  assert.doesNotThrow(() => b.hideRecordingBanner());

  assert.deepEqual(b.domCalls, []);
  assert.equal(b.state().recordingId, null);
});

test('neither hook ever touches getElementById / createElement / appendChild', () => {
  const b = loadRecordingBanner();

  b.showRecordingBanner('rec-1');
  b.hideRecordingBanner();
  b.showRecordingBanner('rec-2');
  b.showRecordingBanner();
  b.hideRecordingBanner();

  // The spy `document` is a Proxy that logs every property READ, not just the
  // handful of methods the old banner used — so a future querySelector or
  // innerHTML path is caught too, not only the three named here.
  assert.deepEqual(b.domTouches, [], 'the region never reads a single document property');
  assert.deepEqual(b.domCalls, []);
});

// ── bookkeeping ─────────────────────────────────────────────────────────────
// Nothing in content.js reads _recRecordingId any more (the banner that displayed
// it is gone, and the legacy stop message that quoted it is gone with it), so this
// is dead-but-real state. Kept asserted, cheaply, because it is still the region's
// only observable behaviour: if it ever comes back into use — a header on a segment
// upload, say — this locks in the semantics it has today.

test('_recRecordingId tracks the last id shown and clears on hide', () => {
  const b = loadRecordingBanner();
  assert.equal(b.state().recordingId, null, 'starts empty');

  b.showRecordingBanner('rec-1');
  assert.equal(b.state().recordingId, 'rec-1');

  // A falsy id KEEPS the current one — the controller calls showBanner() with no
  // argument on resume, and that must not blank out the id from the start call.
  b.showRecordingBanner();
  assert.equal(b.state().recordingId, 'rec-1');
  b.showRecordingBanner('');
  assert.equal(b.state().recordingId, 'rec-1');

  b.showRecordingBanner('rec-2');
  assert.equal(b.state().recordingId, 'rec-2');

  b.hideRecordingBanner();
  assert.equal(b.state().recordingId, null);
});

test('a subframe records nothing, not even the id', () => {
  // content.js is injected with all_frames:true, so the hooks run in every frame.
  // Recording state belongs to the TAB, so the non-top frames bail out first.
  const sub = loadRecordingBanner({ topFrame: false });
  assert.equal(sub.isTopFrame(), false);

  assert.equal(sub.showRecordingBanner('rec-x'), null);
  assert.equal(sub.state().recordingId, null, 'the early return happens before the assignment');
  assert.deepEqual(sub.domCalls, []);
  assert.deepEqual(sub.sent, []);
});

// ── the region does not talk to the worker on load ──────────────────────────

test('the region sends nothing at load time', () => {
  // A vestigial "ask the worker whether this tab is already recording, restore the
  // banner if so" query lived here from the tabCapture era, when the capture
  // outlived the content script across a navigation. Recording is in-page rrweb
  // now and there is no banner to restore, so nothing sends anything.
  const top = loadRecordingBanner();
  assert.deepEqual(top.sent, []);

  const sub = loadRecordingBanner({ topFrame: false });
  assert.deepEqual(sub.sent, []);
});

test('the region arms no watcher and no poll', () => {
  const b = loadRecordingBanner();
  b.showRecordingBanner('rec-1');

  assert.equal(b.observersCreated(), 0, 'no MutationObserver constructed');
  assert.equal(b.activeObservers(), 0);
  assert.equal(b.activeIntervals(), 0);
  assert.deepEqual(b.timerCalls, []);

  // And driving the (empty) timer/observer sets changes nothing.
  b.tickPoll(50);
  b.fireMutation();
  assert.deepEqual(b.replayStops, []);
  assert.deepEqual(b.domCalls, []);
});

// ── REGRESSION GUARD: recording is not stoppable from the page ──────────────
// This is the assertion the file exists for. If a Stop control is ever re-added
// without realising this deployment records non-stoppably, these must fail.

test('no reachable path in this region stops the recorder', () => {
  const b = loadRecordingBanner();

  // Drive every entry point the region exposes, in every order, with the kind of
  // junk a real message channel delivers.
  b.showRecordingBanner('rec-1');
  b.showRecordingBanner();
  b.hideRecordingBanner();
  b.showRecordingBanner('rec-2');

  for (const msg of [
    null,
    undefined,
    'cfai-recording-started',
    42,
    {},
    { type: null },
    { type: 'cfai-recording-started', recording_id: 'rec-3' },
    { type: 'cfai-recording-stopped' },
    { type: 'cfai-recording-stopped', reason: 'user_banner' },
    { type: 'cfai-recording-state' },
    { type: 'cfai-recording-state', want: 'session' },
    { type: 'cfai-stop-recording', reason: 'user_banner' },
    { type: 'cfai-something-nobody-implemented' },
  ]) {
    assert.doesNotThrow(() => b.message(msg), `message ${JSON.stringify(msg)} threw`);
  }

  b.tickPoll(10);
  b.fireMutation();

  assert.deepEqual(b.replayStops, [], 'the replay controller was never stopped');
  assert.deepEqual(b.sent, [], 'and no stop was messaged to the worker either');
  assert.deepEqual(b.domCalls, [], 'and no DOM was created for anyone to click');
  assert.equal(b.state().hasController, true, 'the controller reference IS still held');
});

test('the shipped source of this region contains no stop path', () => {
  // Static half of the guard: comment-stripped, so the region's own explanation of
  // WHY the Stop button was removed cannot satisfy the assertion.
  const code = bannerRegionCode();

  assert.doesNotMatch(code, /\bstop\s*\(/i, 'no stop() call');
  assert.doesNotMatch(code, /_replayController\s*\.\s*\w/, 'the controller is only held, never driven');
  assert.doesNotMatch(code, /cfai-stop-recording/, 'no stop message to the worker');
  assert.doesNotMatch(code, /REPLAY_STOP_REASONS/, 'the stop-reason vocabulary is gone');
  assert.doesNotMatch(code, /addEventListener\s*\(\s*['"]click/, 'nothing clickable');

  // Sanity: the strip did not just empty the region out and pass vacuously.
  assert.match(code, /function\s+showRecordingBanner/);
  assert.match(code, /function\s+hideRecordingBanner/);
  assert.match(code, /_replayController/);
});

test('the shipped source of this region builds no DOM', () => {
  const code = bannerRegionCode();

  for (const api of [
    'createElement',
    'createTextNode',
    'appendChild',
    'insertBefore',
    'innerHTML',
    'outerHTML',
    'getElementById',
    'querySelector',
    'MutationObserver',
    'setInterval',
    'setTimeout',
  ]) {
    assert.doesNotMatch(code, new RegExp(api), `region must not use ${api}`);
  }
});

test('the removed banner machinery exists nowhere in content.js', () => {
  // Whole-file, not just this region: a stop path re-introduced two regions away
  // would be just as much of a regression, and the old names are the likeliest
  // shape for it to come back in (e.g. restored from git history).
  const code = stripComments(contentSource());

  for (const name of [
    'watchRecordingBanner',
    'unwatchRecordingBanner',
    'recordingBannerAttached',
    'checkRecordingBanner',
    'requestStopRecording',
    'recBannerStyle',
    'REC_BANNER_ID',
    'REC_BANNER_POLL_MS',
    'REPLAY_STOP_REASONS',
    '_recBanner',
    '_recBannerObserver',
    '_recBannerPoll',
    '_recStopRequested',
    'cfai-recording-banner',
  ]) {
    assert.doesNotMatch(code, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `content.js must not reference ${name} any more`);
  }

  // The stop button's class, but NOT the legacy 'cfai-recording-stopped' message
  // type, which is deliberately still handled (see below).
  assert.doesNotMatch(code, /cfai-recording-stop(?!ped)/,
    'content.js must not reference the cfai-recording-stop control any more');
  assert.match(code, /cfai-recording-stopped/, 'the legacy message type IS still handled');
});

test('content.css no longer styles a banner that cannot exist', () => {
  const css = readFileSync(path.join(here, '..', 'content', 'content.css'), 'utf8');
  assert.doesNotMatch(css, /cfai-recording-banner/);
  assert.doesNotMatch(css, /cfai-recording-text/);
  assert.doesNotMatch(css, /cfai-recording-stop/);
  // Sanity: we are reading the real stylesheet, not an empty file.
  assert.match(css, /cfai-/);
});

// ── legacy message handlers ─────────────────────────────────────────────────
// Kept only so an OLD service-worker build talking to a freshly-updated content
// script does not hang on a sendMessage with no answer. Nothing sends these now.

test('the legacy recording-started / -stopped messages still answer without DOM', () => {
  const b = loadRecordingBanner();

  assert.deepEqual(b.message({ type: 'cfai-recording-started', recording_id: 'rec-m' }), { ok: true });
  assert.equal(b.state().recordingId, 'rec-m', 'routed through the no-op show hook');
  assert.deepEqual(b.domCalls, [], 'answering did not paint anything');

  assert.deepEqual(b.message({ type: 'cfai-recording-stopped' }), { ok: true });
  assert.equal(b.state().recordingId, null, 'routed through the no-op hide hook');

  // Idempotent — a second stop message must not throw or send anything.
  assert.deepEqual(b.message({ type: 'cfai-recording-stopped' }), { ok: true });
  assert.deepEqual(b.sent, []);
  assert.deepEqual(b.replayStops, []);
  assert.deepEqual(b.domCalls, []);
});

test('a malformed message is ignored without an answer', () => {
  const b = loadRecordingBanner();
  assert.equal(b.message(null), undefined);
  assert.equal(b.message('nope'), undefined);
  assert.equal(b.message({ type: 'cfai-unknown' }), undefined);
  assert.deepEqual(b.domCalls, []);
});

test('the legacy session_id query answers null instead of minting a session', () => {
  const b = loadRecordingBanner();
  // Nothing in this region may create a session. Session identity is an engagement
  // record owned by the service worker; all a content script can do is report the
  // last answer the worker gave it, and null ("nobody has used the AI in this tab
  // yet") is a perfectly valid answer.
  assert.deepEqual(b.message({ type: 'cfai-recording-state', want: 'session' }), { session_id: null });
});

test('the legacy session_id query reports the worker\'s answer when there is one', () => {
  const b = loadRecordingBanner({ cachedSessionId: 'sess-from-worker' });
  assert.deepEqual(
    b.message({ type: 'cfai-recording-state', want: 'session' }),
    { session_id: 'sess-from-worker' },
  );
});

// ── the controller reference itself ─────────────────────────────────────────

test('_replayController is declared here and only held, never driven', () => {
  // It has to be DECLARED in this region even though the bootstrap 300 lines below
  // assigns it, because the visibilitychange handler ABOVE reads it and `let` has
  // no hoisted initialised value — a declaration further down would leave that read
  // in a temporal dead zone.
  const b = loadRecordingBanner();
  assert.equal(b.state().hasController, true);

  b.showRecordingBanner('rec-1');
  b.hideRecordingBanner();
  assert.deepEqual(b.replayStops, []);
});

test('a page where replay never started still calls both hooks cleanly', () => {
  // No controller: an unenrolled install, a host the policy said no to, or a
  // missing vendor bundle. The hooks are still called at every lifecycle point.
  const b = loadRecordingBanner({ replayController: null });
  assert.equal(b.state().hasController, false);

  assert.doesNotThrow(() => b.showRecordingBanner('rec-none'));
  assert.doesNotThrow(() => b.hideRecordingBanner());
  assert.doesNotThrow(() => b.message({ type: 'cfai-recording-started', recording_id: 'x' }));
  assert.doesNotThrow(() => b.message({ type: 'cfai-recording-stopped' }));
  assert.deepEqual(b.domCalls, []);
});
