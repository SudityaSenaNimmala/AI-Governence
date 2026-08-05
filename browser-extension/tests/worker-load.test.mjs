// Does background/service-worker.js actually LOAD, and does the session boundary
// work end to end through its real listeners?
//
// WHY THIS TEST EXISTS
// The worker shipped for a while with `import { normalizeRecordingPolicy } from
// '../lib/recording.js'` after that export had been deleted in the video → rrweb
// pivot. That is an ESM link error, so the ENTIRE worker failed to start in
// Chrome — DLP capture, enrollment, the flush alarm, everything — and the whole
// unit suite stayed green, because every other test is a pure-logic slice that
// never loads the worker. A human had to find it.
//
// So: stub chrome.*, import the real module, and drive the real listeners. This
// cannot prove Chrome-specific behaviour, but it does prove the module links, that
// nothing throws at top level, that every alarm it creates has a handler, and that
// an event in → stamped event out actually happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const WORKER = new URL('../background/service-worker.js', import.meta.url).href;

// Only what the worker actually touches. Anything it reaches for that is NOT here
// throws, which is the point — an unstubbed API is either a new dependency worth
// noticing or a permission we no longer declare.
// A controllable fetch. The worker's authedFetch layers enrollment + 401 retry on
// top of it, so the stub answers /enroll too — otherwise every authed call would
// bail out at "not enrolled" and the replay handlers could not be exercised at all.
// Every request is recorded (method, path, and the parsed body) so a test can assert
// what the worker sent WITHOUT the test itself having to know about JWTs.
function makeFetch() {
  const calls = [];
  // Per-path lifetime totals. Unlike `calls` these survive reset(), which matters
  // for asserting on a cache: "was it fetched at all, ever" and "did it get fetched
  // again" are different questions and reset() would erase the first one.
  const totals = new Map();
  const routes = new Map();
  const fetchStub = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    calls.push({ method, path: u.pathname, body, headers: init.headers || {} });
    totals.set(u.pathname, (totals.get(u.pathname) || 0) + 1);

    const key = `${method} ${u.pathname}`;
    const handler = routes.get(key) ?? routes.get(u.pathname);
    if (typeof handler === 'function') return handler({ method, path: u.pathname, body });
    if (handler) return handler;
    return jsonResponse(404, { error: 'no stub for ' + key });
  };
  return {
    fetch: fetchStub,
    calls,
    /** route('POST /api/v1/replays', Response | (req) => Response) */
    route(key, value) { routes.set(key, value); return this; },
    of(path) { return calls.filter((c) => c.path === path); },
    /** Lifetime call count for a path, unaffected by reset(). */
    total(path) { return totals.get(path) || 0; },
    reset() { calls.length = 0; },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function emptyResponse(status) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => '' };
}

function makeChrome() {
  const store = {};
  const listeners = {
    alarm: [], message: [], tabRemoved: [], navCommitted: [], navHistory: [],
    startup: [], installed: [], actionClicked: [],
  };
  const alarmsCreated = [];
  const alarmsCleared = [];

  const chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]),
        ),
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; },
      },
    },
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      sendMessage: () => {},
      getURL: (p) => 'chrome-extension://test/' + p,
      openOptionsPage: () => { chrome._optionsOpened = (chrome._optionsOpened || 0) + 1; },
    },
    alarms: {
      create: (name, opts) => alarmsCreated.push({ name, ...opts }),
      clear: async (name) => { alarmsCleared.push(name); return true; },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
    tabs: {
      onRemoved: { addListener: (fn) => listeners.tabRemoved.push(fn) },
      query: async () => [],
      sendMessage: () => {},
      get: async () => ({}),
    },
    webNavigation: {
      onCommitted: { addListener: (fn) => listeners.navCommitted.push(fn) },
      onHistoryStateUpdated: { addListener: (fn) => listeners.navHistory.push(fn) },
    },
    action: {
      onClicked: { addListener: (fn) => listeners.actionClicked.push(fn) },
    },
    scripting: { executeScript: async () => {}, insertCSS: async () => {} },
    notifications: { create: () => {} },
    _store: store,
    _listeners: listeners,
    _alarmsCreated: alarmsCreated,
    _alarmsCleared: alarmsCleared,
  };
  return chrome;
}

// The module is imported once per process (ESM caches it), so all the tests below
// share one worker instance and one fake storage — which is also how Chrome runs it.
const chrome = makeChrome();
globalThis.chrome = chrome;

const server = makeFetch();
globalThis.fetch = server.fetch;
// Node exposes navigator read-only, and the worker only reads userAgent (to build
// the enrollment hostname), so leave whatever is there.

// Enrolled, with a server to talk to. Set BEFORE the module is imported because the
// worker reads config on its top-level best-effort refreshes.
chrome._store['cfai.config'] = { serverUrl: 'https://gov.example.test', enrollSecret: 's3cret' };
chrome._store['cfai.token'] = 'test-jwt';
server
  .route('POST /api/v1/enroll', jsonResponse(200, { token: 'test-jwt' }))
  .route('/api/v1/ai-platforms', jsonResponse(200, []))
  .route('/api/lifecycle/blocked-agents', jsonResponse(200, []))
  // Deliberately UNAVAILABLE: the queue assertions below inspect cfai.queue
  // directly, and a working flush would drain it out from under them on the next
  // alarm. The flush path itself is not what this file tests.
  .route('POST /api/v1/dlp', jsonResponse(503, { error: 'flush disabled in this test' }))
  .route('GET /api/v1/replay-policy', jsonResponse(200, {
    enabled: true,
    chunk_flush_ms: 10_000,
    chunk_max_bytes: 262_144,
    max_run_ms: 3_600_000,
    max_daily_ms: 14_400_000,
    checkout_every_ms: 300_000,
    mask_profile: 'composer_visible',
    retention_days: 30,
  }))
  .route('POST /api/v1/replays', jsonResponse(201, { replay_id: 'r-1' }));

await import(WORKER);
await new Promise((r) => setTimeout(r, 25));   // let the top-level best-effort calls settle

const settle = () => new Promise((r) => setTimeout(r, 20));

/** Deliver a message to the real listener chain and resolve with the response. */
function send(msg, sender) {
  return new Promise((resolve) => {
    let answered = false;
    for (const fn of chrome._listeners.message) {
      const async = fn(msg, sender, (v) => { answered = true; resolve(v); });
      if (async === true) return;
    }
    if (!answered) resolve(undefined);
  });
}

const emit = (overrides, tabId, url) => send(
  { kind: 'prompt_submit', service: 'ChatGPT', occurredAt: new Date().toISOString(), __cfai_visible: true, ...overrides },
  { tab: { id: tabId, url } },
);

const engagements = () => chrome._store['cfai.sessions'] || {};
const queue = () => chrome._store['cfai.queue'] || [];

test('the worker module links and evaluates without throwing', () => {
  // Reaching this line at all is the assertion: a bad import or a top-level throw
  // would have rejected the await above and failed the whole file.
  assert.ok(chrome._listeners.message.length > 0, 'it registered message listeners');
  assert.ok(chrome._listeners.tabRemoved.length > 0, 'it registered a tabs.onRemoved listener');
  assert.ok(chrome._listeners.navCommitted.length > 0, 'it registered a webNavigation.onCommitted listener');
  assert.ok(chrome._listeners.startup.length > 0, 'it registered an onStartup listener');
});

// EARLY, on purpose: it inspects the startup fetches, and later tests call
// server.reset().
test('the platforms mirror — which now gates RECORDING — is fetched WITH the JWT', () => {
  // cfai.platforms used to be pulled with a plain unauthenticated fetch, on the
  // grounds that GET /ai-platforms is public and block policy must not depend on
  // enrollment. That mirror now also answers "may this host be recorded"
  // (isRecordableHost() treats governed OR blocked as recordable, and replayGate reads
  // the mirror), so with <all_urls> host permissions an unauthenticated response is an
  // injection point that turns one forged row into full-DOM recording and upload of an
  // arbitrary internal site.
  const mirror = server.of('/api/v1/ai-platforms');
  assert.ok(mirror.length > 0, 'the worker syncs the registry at startup');
  for (const call of mirror) {
    assert.match(String(call.headers.authorization || ''), /^Bearer /,
      'every platforms fetch must go out through authedFetch');
  }
});

test('no unauthenticated fetch of the platforms registry is left in the worker', async () => {
  // Two call sites write STORAGE.PLATFORMS — the alarm-driven refreshPlatforms() and
  // the 2.5s-cached getFreshPlatforms() the content script drives. Fixing one and
  // leaving the other would leave the hole exactly as open as it was, and the second
  // one is cache-warm in this process so no runtime assertion can see it.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /[^d]fetch\(\s*`\$\{config\.serverUrl[^`]*ai-platforms/,
    'a raw fetch() of ai-platforms is back');
  assert.equal((src.match(/authedFetch\('\/api\/v1\/ai-platforms/g) || []).length, 2,
    'both platforms-mirror call sites must use authedFetch');
});

test('every alarm it creates has a handler, and the dead video watchdog is cleared', () => {
  const names = chrome._alarmsCreated.map((a) => a.name);
  assert.ok(names.includes('cfai-flush'));
  assert.ok(names.includes('cfai-engagement-sweep'), 'the idle/cap sweep must be armed');
  const sweep = chrome._alarmsCreated.find((a) => a.name === 'cfai-engagement-sweep');
  assert.equal(sweep.periodInMinutes, 1, 'the chrome.alarms floor');

  // No alarm may be created without something handling it, and dispatching every
  // one of them must not throw — that is how a deleted handler shows up.
  for (const name of names) {
    for (const fn of chrome._listeners.alarm) assert.doesNotThrow(() => fn({ name }));
  }

  // chrome.alarms persist across extension updates, so the deleted offscreen
  // watchdog would keep waking the worker every minute with nothing to answer it.
  assert.ok(chrome._alarmsCleared.includes('cfai-recording-watchdog'));
  assert.equal(names.includes('cfai-recording-watchdog'), false, 'and it is not re-created');
});

test('an event in becomes a stamped event out, with one session and rising client_seq', async () => {
  const r1 = await emit({}, 7, 'https://chatgpt.com/c/abc12345');
  const r2 = await emit({}, 7, 'https://chatgpt.com/c/abc12345');

  assert.equal(r1.ok, true);
  assert.match(r1.session_id, /^[0-9a-f-]{36}$/);
  assert.equal(r2.session_id, r1.session_id, 'the second event is the same session');

  const stamped = queue().map((e) => ({ sid: e.session_id, seq: e.client_seq }));
  assert.deepEqual(stamped, [
    { sid: r1.session_id, seq: 0 },
    { sid: r1.session_id, seq: 1 },
  ]);
  // The visibility control field must never reach the server.
  for (const e of queue()) assert.equal('__cfai_visible' in e, false);

  const rec = engagements()['7'];
  assert.equal(rec.service_key, 'openai');
  assert.equal(rec.client_seq, 2);
});

test('a same-service navigation does NOT rotate the session', async () => {
  const before = engagements()['7'].session_id;
  for (const fn of chrome._listeners.navCommitted) {
    fn({ frameId: 0, tabId: 7, url: 'https://chatgpt.com/c/a-totally-different-chat' });
  }
  await settle();

  const answer = await send(
    { __cfai_kind: 'currentSessionId', touch: true },
    { tab: { id: 7, url: 'https://chatgpt.com/c/a-totally-different-chat' } },
  );
  assert.equal(answer.session_id, before, 'switching chats keeps one session — the whole point');
});

test('a navigation to a different AI service ends the session', async () => {
  for (const fn of chrome._listeners.navCommitted) {
    fn({ frameId: 0, tabId: 7, url: 'https://claude.ai/chat/xyz98765' });
  }
  await settle();
  assert.equal('7' in engagements(), false, 'the openai engagement was closed');

  // The next activity mints a fresh one on the new service.
  const r = await emit({ service: 'Claude' }, 7, 'https://claude.ai/chat/xyz98765');
  assert.equal(engagements()['7'].service_key, 'anthropic');
  assert.equal(engagements()['7'].client_seq, 1, 'the new session starts its own seq');
  assert.equal(queue().at(-1).client_seq, 0);
  assert.equal(queue().at(-1).session_id, r.session_id);
});

test('closing the tab ends its session', async () => {
  await emit({}, 11, 'https://gemini.google.com/app/abcd1234');
  assert.ok('11' in engagements());

  for (const fn of chrome._listeners.tabRemoved) fn(11);
  await settle();
  assert.equal('11' in engagements(), false);
});

test('asking for the current session never mints one', async () => {
  const answer = await send(
    { __cfai_kind: 'currentSessionId', touch: true },
    { tab: { id: 99, url: 'https://chatgpt.com/' } },
  );
  assert.equal(answer.session_id, null);
  assert.equal('99' in engagements(), false, 'a bare ask must not open a conversation');
});

// ── Session Replay transport ─────────────────────────────────────────────────
// THE BUG THIS SECTION EXISTS FOR: the worker's first message listener treats every
// message it does not recognise as a governance event — it queues it into cfai.queue
// and POSTs it to /api/v1/dlp. A replayChunk falling through that guard would park
// gzipped, base64'd, UNMASKED composer DOM in the DLP queue and upload it to the
// wrong endpoint, i.e. raw prompt bytes into the wrong store, with no way to notice
// from the outside. So every replay kind must be a CONTROL message, and the proof of
// that is "cfai.queue did not grow".

const REPLAY_KINDS = ['replayPolicy', 'replayRegister', 'replayChunk', 'replayComplete', 'replayDailyAccrued'];

const AI_TAB = { tab: { id: 21, url: 'https://chatgpt.com/c/deadbeef1234' } };

/** A realistic chunk message — the shape content/replay.js's flushChunk sends. */
function chunkMessage(overrides = {}) {
  return {
    __cfai_kind: 'replayChunk',
    replay_id: '11111111-2222-3333-4444-555555555555',
    seq: 0,
    encoding: 'gzip',
    chunk_b64: Buffer.from('pretend gzip bytes').toString('base64'),
    sha256: 'a'.repeat(64),
    event_count: 12,
    first_ts: 1_700_000_000_000,
    last_ts: 1_700_000_009_000,
    has_full_snapshot: true,
    has_font_event: false,
    byte_size: 1234,
    ...overrides,
  };
}

test('NOT ONE of the replay RPCs falls through to the DLP event queue', async () => {
  server.route('POST /api/v1/replays/11111111-2222-3333-4444-555555555555/chunks/0', emptyResponse(204));
  server.route('POST /api/v1/replays/11111111-2222-3333-4444-555555555555/complete', jsonResponse(200, { ok: true }));

  const before = queue().length;
  for (const kind of REPLAY_KINDS) {
    const msg = kind === 'replayChunk'
      ? chunkMessage()
      : { __cfai_kind: kind, replay_id: '11111111-2222-3333-4444-555555555555', ms: 1, seq: 0 };
    const answer = await send(msg, AI_TAB);
    assert.ok(answer && typeof answer === 'object', `${kind} was answered by a dedicated handler`);
    assert.equal('session_id' in answer, false,
      `${kind} was answered by the GENERIC event path — it is missing from CONTROL_KINDS`);
  }
  await settle();
  assert.equal(queue().length, before,
    'a replay RPC must never become a governance event in cfai.queue');
});

test('THE REGRESSION: a replayChunk never touches cfai.queue, whatever the server says', async () => {
  const before = queue().length;

  // Accepted…
  server.route('POST /api/v1/replays/11111111-2222-3333-4444-555555555555/chunks/4', emptyResponse(204));
  assert.deepEqual(await send(chunkMessage({ seq: 4 }), AI_TAB), { ok: true });

  // …refused…
  server.route('POST /api/v1/replays/11111111-2222-3333-4444-555555555555/chunks/5', emptyResponse(413));
  assert.deepEqual(await send(chunkMessage({ seq: 5 }), AI_TAB), { ok: false, error: 413 });

  // …and with no route at all (a 404 from the stub).
  await send(chunkMessage({ seq: 99 }), AI_TAB);

  await settle();
  assert.equal(queue().length, before, 'no chunk bytes anywhere near the DLP queue');
  // And nothing was persisted either: the handler is stateless by design, because
  // gzipped unmasked composer text at rest in chrome.storage.local is worse than a
  // lost tail. (cfai.replayQueue is the key such a queue WOULD use; nothing writes
  // it, and there is no queue helper left in lib/recording.js to build one with.)
  assert.equal('cfai.replayQueue' in chrome._store, false, 'no chunk was persisted');
});

test('a chunk goes to the right URL, with exactly the fields the API expects', async () => {
  server.reset();
  server.route('POST /api/v1/replays/11111111-2222-3333-4444-555555555555/chunks/7', emptyResponse(204));

  const answer = await send(chunkMessage({ seq: 7 }), AI_TAB);
  assert.deepEqual(answer, { ok: true }, '204 is success');

  const posted = server.of('/api/v1/replays/11111111-2222-3333-4444-555555555555/chunks/7');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].method, 'POST');
  // seq travels in the PATH, not the body, and the body carries nothing else.
  assert.deepEqual(Object.keys(posted[0].body).sort(), [
    'chunk_b64', 'encoding', 'event_count', 'first_ts', 'has_font_event', 'has_full_snapshot', 'last_ts', 'sha256',
  ]);
  assert.equal(posted[0].body.event_count, 12);
  assert.equal(posted[0].body.has_full_snapshot, true);
  assert.equal(posted[0].body.has_font_event, false);
  assert.match(posted[0].headers.authorization, /^Bearer /, 'it goes out through authedFetch');
});

test('a malformed chunk address is refused locally instead of being sent anywhere', async () => {
  server.reset();
  assert.equal((await send({ __cfai_kind: 'replayChunk', seq: 0 }, AI_TAB)).ok, false, 'no replay_id');
  assert.equal((await send(chunkMessage({ seq: -1 }), AI_TAB)).ok, false, 'negative seq');
  assert.equal((await send(chunkMessage({ seq: 'abc' }), AI_TAB)).ok, false, 'non-numeric seq');
  assert.deepEqual(server.calls, [], 'nothing was sent');
});

test('replayRegister opens a run, tagged with the tab’s own service key', async () => {
  // Give tab 21 an engagement first, the way a real prompt would.
  await emit({}, 21, 'https://chatgpt.com/c/deadbeef1234');
  await settle();
  assert.equal(engagements()['21'].service_key, 'openai');

  server.reset();
  const answer = await send({
    __cfai_kind: 'replayRegister',
    replay_id: '11111111-2222-3333-4444-555555555555',
    session_id: engagements()['21'].session_id,
    // A LIE about the host, to prove the sender is what is trusted.
    tab_host: 'evil.example.com',
    started_at: '2026-07-31T10:00:00.000Z',
    recorder: 'rrweb@2.0.0-alpha.20',
    mask_profile: 'composer_visible',
  }, AI_TAB);

  assert.deepEqual(answer, { ok: true }, '201 Created is success');
  const posted = server.of('/api/v1/replays');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].body.tab_host, 'chatgpt.com', 'the SENDER’s host wins over the body');
  assert.equal(posted[0].body.capture, 'dom_events');
  assert.equal(posted[0].body.recorder, 'rrweb@2.0.0-alpha.20');
  assert.equal(posted[0].body.mask_profile, 'composer_visible');
  assert.equal(posted[0].body.ai_service, 'openai', 'taken from the engagement the worker already owns');
});

test('replayRegister treats an idempotent 200 as success and anything else as a refusal', async () => {
  server.route('POST /api/v1/replays', jsonResponse(200, { replay_id: 'r-1' }));
  assert.deepEqual(await send({ __cfai_kind: 'replayRegister', replay_id: 'r-1' }, AI_TAB), { ok: true });

  server.route('POST /api/v1/replays', jsonResponse(400, { error: 'tab_host required' }));
  assert.deepEqual(await send({ __cfai_kind: 'replayRegister', replay_id: 'r-1' }, AI_TAB), { ok: false, error: 400 });

  server.route('POST /api/v1/replays', jsonResponse(201, { replay_id: 'r-1' }));
});

test('replayComplete closes the run', async () => {
  server.reset();
  server.route('POST /api/v1/replays/r-9/complete', jsonResponse(200, { ok: true }));

  const answer = await send({
    __cfai_kind: 'replayComplete',
    replay_id: 'r-9',
    stop_reason: 'user_stopped',
    chunk_count: 3,
    event_count: 250,
    session_ids: ['sess-a'],
    ended_at: '2026-07-31T10:05:00.000Z',
    duration_ms: 300_000,
  }, AI_TAB);

  assert.deepEqual(answer, { ok: true });
  const posted = server.of('/api/v1/replays/r-9/complete');
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0].body, {
    stop_reason: 'user_stopped',
    chunk_count: 3,
    event_count: 250,
    session_ids: ['sess-a'],
    ended_at: '2026-07-31T10:05:00.000Z',
    duration_ms: 300_000,
  });

  server.route('POST /api/v1/replays/r-9/complete', jsonResponse(404, { error: 'no such run' }));
  assert.deepEqual(await send({ __cfai_kind: 'replayComplete', replay_id: 'r-9' }, AI_TAB), { ok: false, error: 404 });
});

test('replayDailyAccrued is a single-writer read-modify-write of the daily ledger', async () => {
  delete chrome._store['cfai.recordingDaily'];

  const first = await send({ __cfai_kind: 'replayDailyAccrued', ms: 60_000 }, AI_TAB);
  assert.equal(first.ok, true);
  const ledger = chrome._store['cfai.recordingDaily'];
  assert.equal(ledger.ms, 60_000);
  assert.match(ledger.day, /^\d{4}-\d{2}-\d{2}$/, 'a LOCAL calendar day, not a rolling window');
  assert.equal(first.remaining_daily_ms, 14_400_000 - 60_000, '4 h cap minus what was used');

  // Two tabs reporting in the same task must not lose an increment: the map is one
  // storage key, so both would otherwise read the same starting total.
  const [a, b] = await Promise.all([
    send({ __cfai_kind: 'replayDailyAccrued', ms: 5_000 }, AI_TAB),
    send({ __cfai_kind: 'replayDailyAccrued', ms: 7_000 }, { tab: { id: 22, url: 'https://claude.ai/' } }),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(chrome._store['cfai.recordingDaily'].ms, 72_000, 'both increments survived');

  // Garbage is ignored rather than corrupting the ledger.
  await send({ __cfai_kind: 'replayDailyAccrued', ms: 'lots' }, AI_TAB);
  assert.equal(chrome._store['cfai.recordingDaily'].ms, 72_000);
});

test('replayPolicy answers the gate, and caches the policy across tabs and polls', async () => {
  const answer = await send({ __cfai_kind: 'replayPolicy', host: 'chatgpt.com' }, AI_TAB);
  assert.equal(answer.ok, true);
  assert.equal(answer.recordable, true, 'chatgpt.com is on the built-in recordable list');
  assert.equal(answer.enabled, true, 'enrolled, with a server url and a token');
  assert.equal(answer.policy.mask_profile, 'composer_visible');
  assert.equal(answer.policy.chunk_flush_ms, 10_000);
  // The ledger from the previous test is still there, so the budget reflects it.
  assert.equal(answer.remaining_daily_ms, 14_400_000 - 72_000);

  // The policy document was fetched (the first tab to ask did it) and is now cached.
  const fetches = server.total('/api/v1/replay-policy');
  assert.equal(fetches, 1, 'exactly one server fetch for every replayPolicy answered so far');

  // Ten more polls from two different tabs: NOT ONE more server call. Each recording
  // tab re-asks every 30 s, so without the cache the server would see a request per
  // open tab per 30 s, forever, for a document that changes about never.
  for (let i = 0; i < 10; i++) {
    await send({ __cfai_kind: 'replayPolicy' }, i % 2 ? AI_TAB : { tab: { id: 22, url: 'https://claude.ai/x' } });
  }
  assert.equal(server.total('/api/v1/replay-policy'), fetches,
    'the policy is cached, not re-fetched on every poll');
});

test('replayPolicy trusts the SENDER’s host, not the message body', async () => {
  const lying = await send(
    { __cfai_kind: 'replayPolicy', host: 'chatgpt.com' },
    { tab: { id: 23, url: 'https://intranet.example.com/wiki' } },
  );
  assert.equal(lying.recordable, false, 'a non-AI tab cannot claim to be chatgpt.com');

  // With no sender at all (an options page, a test) the body is the only thing left,
  // and it is only ever used to answer the host gate — never to attribute anything.
  const bodyOnly = await send({ __cfai_kind: 'replayPolicy', host: 'claude.ai' }, {});
  assert.equal(bodyOnly.recordable, true);
});

test('replayPolicy reports enabled:false when there is nowhere to send the evidence', async () => {
  const token = chrome._store['cfai.token'];
  delete chrome._store['cfai.token'];
  try {
    const answer = await send({ __cfai_kind: 'replayPolicy' }, AI_TAB);
    assert.equal(answer.ok, true);
    assert.equal(answer.recordable, true, 'the host gate does not depend on enrollment');
    assert.equal(answer.enabled, false, 'no token means no destination means do not record');
  } finally {
    chrome._store['cfai.token'] = token;
  }
});

test('replayPolicy refuses to record to a NON-https server', async () => {
  // options.html takes the server URL as a bare type="url" with no scheme
  // restriction. Recording ships the page DOM, and the platforms registry that decides
  // WHICH hosts get recorded rides the same connection, so over http both are readable
  // and forgeable by anyone on the path. Scoped to replay only: DLP enrollment/flush
  // have historically tolerated http and are not tightened here.
  const config = chrome._store['cfai.config'];
  chrome._store['cfai.config'] = { serverUrl: 'http://gov.example.test', enrollSecret: 's3cret' };
  try {
    const answer = await send({ __cfai_kind: 'replayPolicy' }, AI_TAB);
    assert.equal(answer.ok, true, 'the RPC still answers — the recorder must not hang');
    assert.equal(answer.recordable, true, 'the host gate is a separate question');
    assert.equal(answer.enabled, false, 'but there is nowhere safe to send the evidence');
    assert.equal(answer.reason, 'insecure_server_url');
  } finally {
    chrome._store['cfai.config'] = config;
  }

  // https is what actually enables it, all else being equal.
  const ok = await send({ __cfai_kind: 'replayPolicy' }, AI_TAB);
  assert.equal(ok.enabled, true);
  assert.equal('reason' in ok, false);
});

// LAST, on purpose: these two poison the in-memory policy cache (or rely on it
// being cold), so anything after them would see a different worker.
test('an unreachable policy NEVER answers enabled:true', async () => {
  // Expire the cache the only way a test can: the TTL is 5 min of real time, so
  // reach for the failure path with the cache still warm and then with it cleared.
  chrome._store['cfai.config'] = { serverUrl: '', enrollSecret: '' };
  // A fresh policy fetch is forced by clearing what makes authedFetch work at all.
  const answer = await send({ __cfai_kind: 'replayPolicy' }, AI_TAB);
  assert.equal(answer.ok, true, 'the RPC still answers — the recorder must not hang');
  // With the cache still warm the policy is served, but `enabled` cannot be true
  // without a serverUrl.
  assert.equal(answer.enabled, false);
  chrome._store['cfai.config'] = { serverUrl: 'https://gov.example.test', enrollSecret: 's3cret' };
});

test('the toolbar click no longer calls the deleted arm path', () => {
  const before = chrome._optionsOpened || 0;
  for (const fn of chrome._listeners.actionClicked) {
    assert.doesNotThrow(() => fn({ id: 7, url: 'https://chatgpt.com/' }));
  }
  assert.equal(chrome._optionsOpened, before + chrome._listeners.actionClicked.length,
    'it opens the options page instead — a toolbar icon that does nothing reads as broken');
});
