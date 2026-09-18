// The session boundary's WIRING, checked statically over the shipped source.
//
// WHY THIS TEST EXISTS
// The boundary rule itself is pure and fully covered by tests/engagement.test.mjs.
// What that cannot cover is whether background/service-worker.js is actually
// plumbed to it: the worker is an MV3 module that touches chrome.* at load time,
// so it cannot be imported in Node, and every listener it registers is a place the
// feature can silently stop working. A session that never ENDS is invisible in
// testing and is exactly the failure mode a governance product cannot ship — one
// session_id quietly spanning days of use.
//
// So this is the cheap guard: the five closers exist, session identity is not
// minted in the content script any more, and the content script does not stamp
// session fields it no longer owns. It proves wiring, not behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

const WORKER = read('background/service-worker.js');
const CONTENT = read('content/content.js');
const REPLAY = read('content/replay.js');

// Comments explain the rule at length, and that prose must not be mistaken for
// wiring. Line comments only — the worker uses no block comments in these regions.
function code(src) {
  return src
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');
}

const WORKER_CODE = code(WORKER);
const CONTENT_CODE = code(CONTENT);

test('the worker owns session identity: storage key, pure logic, single writer', () => {
  assert.match(WORKER_CODE, /SESSIONS:\s*'cfai\.sessions'/, 'the engagement map needs its own storage key');
  // The decision logic must come from lib/recording.js, not be re-implemented here.
  assert.match(WORKER_CODE, /nextEngagement/, 'the worker resolves engagements through the pure state machine');
  assert.match(WORKER_CODE, /engagementExpiry/, 'and ages them out through the pure expiry check');
  assert.match(WORKER_CODE, /from '\.\.\/lib\/recording\.js'/);
  // One storage key holds the whole tabId → engagement map, so concurrent writers
  // clobber each other's tabs. Two frames of one tab must not mint two sessions.
  assert.match(WORKER_CODE, /withSessionsLock/, 'engagement writes are serialized');
  assert.match(WORKER_CODE, /_sessionsChain/);
});

test('every event the worker queues is stamped from the engagement record', () => {
  assert.match(WORKER_CODE, /sessionTouch\([^)]*type:\s*'activity'/s,
    'an outgoing event resolves the engagement first');
  assert.match(WORKER_CODE, /pushEvent\(\{\s*\.\.\.event,\s*session_id,\s*client_seq\s*\}\)/,
    'session_id and client_seq are added by the worker, from the record');
  // Whatever a (possibly older) content script sent for these is discarded.
  assert.match(WORKER_CODE, /session_id:\s*_dropSid/, 'a sender-supplied session_id is stripped');
  assert.match(WORKER_CODE, /client_seq:\s*_dropSeq/, 'a sender-supplied client_seq is stripped');
  assert.match(WORKER_CODE, /__cfai_visible:\s*_dropVisible/,
    'the visibility control field never reaches the server');
});

test('all five session closers are wired', () => {
  // 1. tab closed — the one boundary that says nothing about a host, so it is
  //    driven from the listener rather than from the state machine.
  assert.match(WORKER_CODE, /onRemoved\.addListener[\s\S]{0,200}closeEngagement\([^)]*'tab_closed'\)/,
    'tabs.onRemoved must close the tab\'s engagement');

  // 2 + 3. a top-frame navigation: a different service ends it, a non-AI host ends
  //        it, the SAME service does not. The reasons come from nextEngagement().
  assert.match(WORKER_CODE, /onCommitted\?\.addListener[\s\S]{0,400}sessionTouch\([^)]*'nav_committed'/,
    'webNavigation.onCommitted must feed the boundary check');
  assert.match(WORKER_CODE, /frameId\s*!==\s*0/, 'subframe commits are not boundaries');

  // 4. the idle / hard-cap sweep, at the chrome.alarms 1-minute floor.
  assert.match(WORKER_CODE, /ENGAGEMENT_SWEEP_ALARM[\s\S]{0,120}periodInMinutes:\s*1/,
    'the sweep alarm must be created at a 1-minute period');
  assert.match(WORKER_CODE, /alarm\.name === ENGAGEMENT_SWEEP_ALARM[\s\S]{0,60}engagementSweep\(\)/,
    'and actually run the sweep');

  // 5. a browser restart: tab ids are not stable across it, so nothing resumes.
  assert.match(WORKER_CODE, /onStartup\.addListener\([\s\S]{0,300}closeEngagementsOnStartup\(\)/,
    'onStartup must close every persisted engagement');
  assert.match(WORKER_CODE, /'browser_restarted'/);
});

test('the current session is a local read, not a round-trip to the content script', () => {
  // It used to be a tabs.sendMessage relay because the content script held the id.
  // Asking another context for our own state can only produce a different answer —
  // and, with content.js injected all_frames, a different one per frame.
  const decl = 'async function getTabSessionId(tabId)';
  const from = WORKER_CODE.indexOf(decl);
  assert.ok(from >= 0, 'getTabSessionId was renamed — this test needs updating');
  const body = WORKER_CODE.slice(from, WORKER_CODE.indexOf('\n}', from));
  assert.match(body, /getEngagement\(tabId\)/, 'it reads the stored engagement');
  assert.match(body, /engagementExpiry\(/, 'and does not hand out an id the sweep is about to reap');
  assert.doesNotMatch(body, /sendMessage/, 'it must not ask another context');
});

test('the content script no longer mints or rotates a session', () => {
  for (const gone of ['mintSession', 'ensureSessionId', '_clientSeq', 'newSessionId', 'checkSessionUrl']) {
    assert.doesNotMatch(CONTENT_CODE, new RegExp(`\\b${gone}\\b`),
      `${gone} moved to the worker — a page-lifetime session is the bug being fixed`);
  }
  // _sessionId in particular: a content-script local is destroyed by every page
  // load, which is precisely why reloads used to start a new session.
  assert.doesNotMatch(CONTENT_CODE, /\b_sessionId\b/);
});

test('the content script still reads the conversation id and still binds it', () => {
  // Only a content script can see the URL, so this half stays — but it is now
  // purely informational: the server $addToSet's the id onto the session.
  assert.match(CONTENT_CODE, /CONV_ID_PATTERNS/);
  assert.match(CONTENT_CODE, /function currentConvId\(/);
  assert.match(CONTENT_CODE, /function checkConvUrl\(/);
  assert.match(CONTENT_CODE, /kind:\s*'session_bind',\s*external_conv_id:\s*convId/);
});

test('emit() sends neither session_id nor client_seq', () => {
  const emitBody = CONTENT_CODE.slice(
    CONTENT_CODE.indexOf('function emit(event)'),
    CONTENT_CODE.indexOf('function isTabVisible('),
  );
  assert.ok(emitBody.length > 50, 'emit() was not found — this test needs updating');
  assert.doesNotMatch(emitBody, /session_id:/);
  assert.doesNotMatch(emitBody, /client_seq:/);
  assert.match(emitBody, /__cfai_visible:\s*isTabVisible\(\)/,
    'the worker needs to know whether the tab was visible to run the idle window');
});

test('a replay run still refuses to mix two sessions, under the new reason name', () => {
  assert.match(REPLAY, /sessionId !== runSessionId\) return close\('engagement_rotated'\)/,
    'the guard behaviour is unchanged; only the stop reason was renamed');
  assert.doesNotMatch(REPLAY, /'session_rotated'/);
});
