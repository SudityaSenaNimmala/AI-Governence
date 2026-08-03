// content/replay.js — the session-replay recorder.
//
// This is the file that decides WHAT gets captured and WHETHER anything gets
// captured at all, so it is tested as a whole: the pure state machine, the masking
// profile, and then the real controller driven end to end with a fake rrweb, a fake
// transport and real gzip/sha256. See load-replay.mjs for the harness.
//
// The two properties worth stating out loud, because they are governance
// requirements rather than features:
//   1. MASKING FAILS CLOSED. Every path that cannot prove an input is the AI prompt
//      composer returns asterisks: no element, an unusable selector, a throwing
//      matches(), an unknown mask profile, and type=password unconditionally.
//   2. NOTHING IS UPLOADED BEFORE A SESSION EXISTS. A visitor who reads the page and
//      never sends a prompt leaves with the ring buffer discarded — no run
//      registered, no chunk sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadReplay,
  makeReplayHarness,
  makeFakeDoc,
  makeFakeInput,
  composerMark,
  DLP_BROAD_MARK,
  settle,
} from './load-replay.mjs';

const R = loadReplay();
const { STATES, MIN_USEFUL_BUDGET_MS } = R;

// ── the state machine ───────────────────────────────────────────────────────

const base = {
  state: STATES.RECORDING,
  visible: true,
  recordable: true,
  enabled: true,
  sessionId: 'sess-1',
  registered: true,
  runSessionId: 'sess-1',
  remainingDailyMs: 60_000,
  runMs: 1_000,
  maxRunMs: 3_600_000,
};

test('IDLE starts only when every gate is open', () => {
  assert.equal(R.nextReplayState({ ...base, state: STATES.IDLE, registered: false }).action, 'start');

  for (const [label, override] of [
    ['hidden tab',        { visible: false }],
    ['not an AI surface', { recordable: false }],
    ['policy disabled',   { enabled: false }],
    ['no useful budget',  { remainingDailyMs: MIN_USEFUL_BUDGET_MS - 1 }],
  ]) {
    const t = R.nextReplayState({ ...base, state: STATES.IDLE, registered: false, ...override });
    assert.equal(t.action, 'none', label);
    assert.equal(t.state, STATES.IDLE, label);
  }
});

test('an explicit stop request beats every other condition', () => {
  // Hidden AND out of budget AND asked to stop: the stop reason is the one reported.
  const t = R.nextReplayState({
    ...base, visible: false, remainingDailyMs: 0, stopRequest: 'pagehide',
  });
  assert.deepEqual(t, { state: STATES.IDLE, action: 'complete', stop_reason: 'pagehide' });
});

test('an unregistered run is DISCARDED, never completed — nothing was ever stored', () => {
  const t = R.nextReplayState({ ...base, registered: false, stopRequest: 'pagehide' });
  assert.equal(t.action, 'discard');
  assert.equal(t.stop_reason, 'pagehide');
});

test('completion beats pause: a cap reached in a hidden tab ends the run', () => {
  assert.equal(R.nextReplayState({ ...base, visible: false, remainingDailyMs: 0 }).stop_reason, 'daily_cap');
  assert.equal(R.nextReplayState({ ...base, visible: false, runMs: 9e9 }).stop_reason, 'max_run_ms');
  assert.equal(R.nextReplayState({ ...base, visible: false, chunkCount: 5000 }).stop_reason, 'chunk_cap');
  assert.equal(R.nextReplayState({ ...base, visible: false, runBytes: 9e9 }).stop_reason, 'chunk_cap');
});

test('policy is checked before the host gate, so a disabled policy is reported as such', () => {
  const t = R.nextReplayState({ ...base, enabled: false, recordable: false });
  assert.equal(t.stop_reason, 'policy_disabled');
  assert.equal(R.nextReplayState({ ...base, recordable: false }).stop_reason, 'navigated_away');
});

test('a rotated engagement ends the run — one run is scoped to one session_id', () => {
  const t = R.nextReplayState({ ...base, sessionId: 'sess-2' });
  assert.equal(t.stop_reason, 'engagement_rotated');
  assert.equal(t.action, 'complete');
  // …but only once a run HAS a session. Before registration there is nothing to
  // rotate away from.
  assert.equal(R.nextReplayState({ ...base, registered: false, runSessionId: null }).action, 'register');
});

test('lazy registration, then pause/resume on visibility', () => {
  assert.equal(R.nextReplayState({ ...base, registered: false, runSessionId: null }).action, 'register');
  // No session yet → keep buffering, register nothing.
  assert.equal(
    R.nextReplayState({ ...base, registered: false, runSessionId: null, sessionId: null }).action,
    'none',
  );

  const paused = R.nextReplayState({ ...base, visible: false });
  assert.deepEqual(paused, { state: STATES.PAUSED, action: 'pause', stop_reason: null });

  const resumed = R.nextReplayState({ ...base, state: STATES.PAUSED, visible: true });
  assert.deepEqual(resumed, { state: STATES.RECORDING, action: 'resume', stop_reason: null });

  // A hidden PAUSED run just stays paused.
  assert.equal(R.nextReplayState({ ...base, state: STATES.PAUSED, visible: false }).action, 'none');
});

// ── masking ─────────────────────────────────────────────────────────────────

test('the composer is unmasked and NOTHING else is', () => {
  const mask = R.makeMaskInputFn('#prompt-textarea', 'composer_visible');

  const composer = makeFakeInput({ matchSelectors: ['#prompt-textarea'] });
  assert.equal(mask('my secret prompt', composer), 'my secret prompt');

  // The PRIMARY signal: content.js's attach() marked this element as a composer.
  const marked = makeFakeInput({ attached: true });
  assert.equal(mask('typed into the composer', marked), 'typed into the composer');

  // An unrelated form field on the same page.
  const search = makeFakeInput({ matchSelectors: ['input[name=q]'] });
  assert.equal(mask('4111111111111111', search), '****************');
});

// ── the unmask signal is UNFORGEABLE by the page ─────────────────────────────
// The old rule was pure CSS: a documented "PRIMARY" [data-cfai-composer] attribute
// that nothing in the codebase ever set (so every host outside the hardcoded fallback
// list had its composer masked, i.e. the feature did nothing there), plus two generic
// wildcards. Any in-scope hostile or compromised page could put those wildcards on an
// arbitrary field with one setAttribute() and have it recorded in cleartext.

test('an ATTRIBUTE a page can set never unmasks anything', () => {
  const mask = R.makeMaskInputFn(R.COMPOSER_UNMASK_SELECTORS.join(','), 'composer_visible');

  // The dropped wildcards, as a page would forge them on an API-key box: the element
  // both carries the attribute and claims to match the selector that used to be in
  // the list. Neither gets it unmasked, because neither is in the list any more.
  const forgedAria = makeFakeInput({
    attrs: { 'aria-label': 'prompt' },
    matchSelectors: ['textarea[aria-label*="prompt" i]'],
  });
  assert.equal(mask('sk-live-0123456789', forgedAria), '******************');

  const forgedPlaceholder = makeFakeInput({
    attrs: { placeholder: 'Ask anything' },
    matchSelectors: ['textarea[placeholder*="ask anything" i]'],
  });
  assert.equal(mask('sk-live-0123456789', forgedPlaceholder), '******************');

  // The attribute that was documented as PRIMARY and never actually set.
  const forgedMark = makeFakeInput({ matchSelectors: ['[data-cfai-composer]'] });
  assert.equal(mask('sk-live-0123456789', forgedMark), '******************');

  // …while the isolated-world mark, which page JS cannot reach, does unmask.
  assert.equal(mask('a real prompt', makeFakeInput({ attached: true })), 'a real prompt');
});

test('the two page-forgeable wildcards are gone from the fallback list', () => {
  for (const gone of ['textarea[aria-label*="prompt" i]', 'textarea[placeholder*="ask anything" i]',
                      '[data-cfai-composer]']) {
    assert.equal(R.COMPOSER_UNMASK_SELECTORS.includes(gone), false, gone);
  }
  // The narrow site-specific fallbacks stay: they cover the window between rrweb's
  // first full snapshot and attach() having run.
  assert.ok(R.COMPOSER_UNMASK_SELECTORS.includes('#prompt-textarea'));
  assert.ok(R.COMPOSER_UNMASK_SELECTORS.includes('rich-textarea textarea'));
});

test('the composer mark is the SAME property content.js attach() sets', async () => {
  // The whole fix rests on this: replay.js reads a property content.js writes, in the
  // one isolated world both classic content scripts share. If either side renames it,
  // the primary unmask signal silently stops existing and every composer is masked.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');
  assert.equal(R.COMPOSER_MARK, composerMark());
  assert.match(
    src,
    new RegExp(`el\\.${R.COMPOSER_MARK}\\s*=\\s*true`),
    `content.js attach() must mark composers with .${R.COMPOSER_MARK}`,
  );

  // …and it is the NARROW of content.js's two marks. The broad one exists and is set
  // by the same function, so a rename that collapsed them would still pass the check
  // above; this pins them apart.
  assert.notEqual(R.COMPOSER_MARK, DLP_BROAD_MARK,
    'the unmask signal must not be the broad "DLP is watching this" mark');
  assert.match(
    src,
    new RegExp(`el\\.${DLP_BROAD_MARK}\\s*=\\s*true`),
    `content.js attach() must still set the broad .${DLP_BROAD_MARK} scan mark`,
  );
  // The narrow mark is set behind the stricter shape test, not unconditionally.
  assert.match(
    src,
    new RegExp(`isPromptInput\\(el\\)\\)\\s*el\\.${R.COMPOSER_MARK}\\s*=\\s*true`),
    `content.js must gate .${R.COMPOSER_MARK} behind isPromptInput()`,
  );
});

test('the BROAD DLP mark alone does NOT unmask', () => {
  // The regression this split exists for. findPromptInputs()'s selector is wide on
  // purpose — [role="combobox"], [role="searchbox"], bare [contenteditable] — so on an
  // in-scope host (Salesforce is in the host list) attach() runs on Lightning lookups,
  // notes fields and description boxes. Every one of those carries __cfaiAttached.
  // None of them is a prompt composer, and none of them may be recorded verbatim.
  const mask = R.makeMaskInputFn(R.COMPOSER_UNMASK_SELECTORS.join(','), 'composer_visible');
  const scannedNotAComposer = makeFakeInput({ dlpAttached: true });
  assert.equal(scannedNotAComposer[DLP_BROAD_MARK], true, 'fixture must carry the broad mark');
  assert.equal(scannedNotAComposer[composerMark()], undefined, 'fixture must NOT carry the narrow mark');
  assert.equal(mask('4111 1111 1111 1111', scannedNotAComposer), '*'.repeat(19));
});

test('the NARROW composer mark still unmasks', () => {
  // The other half: the split must not have masked the thing we actually want. An
  // element attach() decided is composer-shaped records in cleartext, with no
  // selector match at all — which is the whole point of the mark, since admin-registry
  // and classifier-discovered hosts have no entry in the fallback list.
  const mask = R.makeMaskInputFn(R.COMPOSER_UNMASK_SELECTORS.join(','), 'composer_visible');
  const composer = makeFakeInput({ attached: true });
  assert.equal(composer[composerMark()], true);
  assert.equal(composer[DLP_BROAD_MARK], true, 'a real composer carries BOTH marks');
  assert.equal(mask('summarise this contract', composer), 'summarise this contract');
});

test('a forged role attribute cannot buy cleartext capture', () => {
  // The attack the broad mark made cheap: on an in-scope page, one
  // setAttribute('role','combobox') (or 'searchbox') on an API-key box put it inside
  // findPromptInputs()'s selector, so attach() ran and — under the old code — the
  // field was recorded verbatim. isPromptInput() rejects both roles, so the narrow
  // mark is never set and the field stays masked. Modelled the way it really happens:
  // the page sets the attribute, the scanner dutifully attaches, nothing else changes.
  const mask = R.makeMaskInputFn(R.COMPOSER_UNMASK_SELECTORS.join(','), 'composer_visible');
  for (const role of ['combobox', 'searchbox']) {
    const forged = makeFakeInput({ attrs: { role }, dlpAttached: true });
    assert.equal(mask('sk-live-0123456789', forged), '******************', `role="${role}"`);
  }
  // Same for a bare [contenteditable] with no value — in the broad selector, rejected
  // by isPromptInput(), which requires contenteditable="true" exactly.
  const bareEditable = makeFakeInput({ attrs: { contenteditable: '' }, dlpAttached: true });
  assert.equal(mask('sk-live-0123456789', bareEditable), '******************');
});

test('type=password beats BOTH marks', () => {
  // The password check sits ahead of every unmask signal, so it must survive an
  // element that somehow carries the narrow mark too (a site that renders its composer
  // as an <input type=password>, or a future selector bug in findPromptInputs()).
  const mask = R.makeMaskInputFn(R.COMPOSER_UNMASK_SELECTORS.join(','), 'composer_visible');
  const bothMarks = makeFakeInput({ type: 'password', attached: true });
  assert.equal(bothMarks[composerMark()], true);
  assert.equal(bothMarks[DLP_BROAD_MARK], true);
  assert.equal(mask('hunter2', bothMarks), '*******');
  // Broad mark + password, and under the stricter profile too.
  assert.equal(mask('hunter2', makeFakeInput({ type: 'password', dlpAttached: true })), '*******');
  const maskAll = R.makeMaskInputFn(R.COMPOSER_UNMASK_SELECTORS.join(','), 'mask_all');
  assert.equal(maskAll('hunter2', bothMarks), '*******');
});

test('type=password is masked under EVERY profile, composer selector or not', () => {
  const mask = R.makeMaskInputFn('#prompt-textarea', 'composer_visible');
  const pw = makeFakeInput({ type: 'password', matchSelectors: ['#prompt-textarea'] });
  assert.equal(mask('hunter2', pw), '*******');
  // Case-insensitively, the way an attribute can actually be written.
  const pw2 = makeFakeInput({ type: 'PASSWORD', matchSelectors: ['#prompt-textarea'] });
  assert.equal(mask('hunter2', pw2), '*******');
  // Including a password field that attach() itself decided was a composer: the
  // password check is ahead of BOTH unmask signals, not just the selector.
  const pw3 = makeFakeInput({ type: 'password', attached: true });
  assert.equal(mask('hunter2', pw3), '*******');
});

test('masking fails closed on every unusable input', () => {
  const mask = R.makeMaskInputFn('#prompt-textarea', 'composer_visible');
  assert.equal(mask('secret', null), '******', 'no element');
  assert.equal(mask('secret', {}), '******', 'no matches()');
  assert.equal(mask('secret', makeFakeInput({ throwOnMatches: true })), '******', 'matches() threw');
  assert.equal(mask(undefined, makeFakeInput({ matchSelectors: ['#prompt-textarea'] })), '', 'no text');

  // mask_all masks the composer too.
  const maskAll = R.makeMaskInputFn('#prompt-textarea', 'mask_all');
  assert.equal(maskAll('secret', makeFakeInput({ matchSelectors: ['#prompt-textarea'] })), '******');

  // No usable selector at all → mask everything, whatever the profile says.
  const noSelector = R.makeMaskInputFn('', 'composer_visible');
  assert.equal(noSelector('secret', makeFakeInput({ matchSelectors: ['#prompt-textarea'] })), '******');
});

test('an unparseable selector is dropped instead of poisoning the whole list', () => {
  const list = ['#good', 'textarea[[[broken', '[data-cfai-composer]'];
  const doc = makeFakeDoc({ invalid: ['textarea[[[broken'] });
  assert.equal(R.usableSelector(list, doc), '#good,[data-cfai-composer]');

  // And if EVERY selector is unusable the profile fails closed to mask_all
  // behaviour, because there is no way left to identify the composer.
  const allBad = makeFakeDoc({ invalid: list });
  assert.equal(R.usableSelector(list, allBad), '');
});

test('buildRecordOptions pins the capture profile', () => {
  const policy = R.sanitizePolicy(null);
  const opts = R.buildRecordOptions({ policy, emit: () => {}, doc: makeFakeDoc() });

  assert.equal(opts.maskAllInputs, true, 'every input is masked by default');
  assert.equal(typeof opts.maskInputFn, 'function', 'and the composer is unmasked by function');
  assert.equal(opts.blockSelector, 'img,video,canvas,object,embed');
  // No pixels, no fonts, no main-world injection.
  assert.equal(opts.recordCanvas, false, 'canvas needs main-world injection — never enabled');
  assert.equal(opts.inlineImages, false);
  assert.equal(opts.collectFonts, false);
  assert.equal(opts.slimDOMOptions, 'all');
  assert.equal(opts.checkoutEveryNms, policy.checkout_every_ms);
  assert.equal(typeof opts.errorHandler, 'function', 'rrweb must never break the host page');
  assert.equal(opts.errorHandler(new Error('x')), true);
});

test('buildRecordOptions honours an unusable selector list by masking everything', () => {
  const policy = R.sanitizePolicy(null);
  const doc = makeFakeDoc({ invalid: ['#only'] });
  const opts = R.buildRecordOptions({ policy, emit: () => {}, doc, selectorList: ['#only'] });
  assert.equal(opts.maskInputFn('secret', makeFakeInput({ matchSelectors: ['#only'] })), '******');
});

test('sanitizePolicy clamps to defaults and NEVER widens an unknown mask profile', () => {
  const d = R.CLIENT_POLICY_DEFAULTS;
  assert.deepEqual(R.sanitizePolicy(null), { ...d });
  assert.deepEqual(R.sanitizePolicy('nonsense'), { ...d });

  assert.equal(R.sanitizePolicy({ chunk_flush_ms: 0 }).chunk_flush_ms, d.chunk_flush_ms);
  assert.equal(R.sanitizePolicy({ chunk_flush_ms: -5 }).chunk_flush_ms, d.chunk_flush_ms);
  assert.equal(R.sanitizePolicy({ chunk_flush_ms: 2500 }).chunk_flush_ms, 2500);
  assert.equal(R.sanitizePolicy({ enabled: false }).enabled, false);
  assert.equal(R.sanitizePolicy({ enabled: true }).enabled, true);

  assert.equal(R.sanitizePolicy({ mask_profile: 'composer_visible' }).mask_profile, 'composer_visible');
  assert.equal(R.sanitizePolicy({ mask_profile: 'mask_all' }).mask_profile, 'mask_all');
  // THE FAIL-CLOSED RULE. 'v1' is not a profile this client knows how to honour —
  // and it is exactly what the server used to send.
  assert.equal(R.sanitizePolicy({ mask_profile: 'v1' }).mask_profile, 'mask_all');
  assert.equal(R.sanitizePolicy({ mask_profile: 'everything_visible' }).mask_profile, 'mask_all');
  // Absent is not unknown: absent means the default.
  assert.equal(R.sanitizePolicy({}).mask_profile, d.mask_profile);
});

// ── bytes on the wire ───────────────────────────────────────────────────────

test('gzip + base64 + sha256 produce real, verifiable bytes', async () => {
  const zlib = await import('node:zlib');
  const { createHash } = await import('node:crypto');

  const json = JSON.stringify([{ type: 2, timestamp: 1, data: { a: 'hello '.repeat(50) } }]);
  const gz = await R.gzipString(json);
  assert.ok(gz instanceof Uint8Array);
  assert.equal(zlib.gunzipSync(Buffer.from(gz)).toString('utf8'), json, 'round-trips');

  const b64 = R.bytesToBase64(gz);
  assert.deepEqual(new Uint8Array(Buffer.from(b64, 'base64')), gz, 'base64 is byte-exact');

  const sha = await R.sha256Hex(gz);
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(sha, createHash('sha256').update(Buffer.from(gz)).digest('hex'));
});

// ── the controller, end to end ──────────────────────────────────────────────

test('a start-to-finish run is policy → register → chunk(seq 0) → complete', async () => {
  const h = makeReplayHarness();

  await h.ctl.init();
  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.equal(h.recordCalls(), 1, 'rrweb was attached');
  // The banner goes up the instant we start OBSERVING, not at registration.
  assert.deepEqual(h.banners, [{ show: null }]);
  assert.deepEqual(h.kinds, ['replayPolicy']);

  // The user looks at the page. Nothing is registered and nothing is uploaded.
  h.snapshot();
  h.noise(3);
  await settle();
  assert.deepEqual(h.kinds, ['replayPolicy'], 'no session yet → nothing leaves the tab');
  assert.equal(h.ctl.stats().registered, false);
  assert.equal(h.ctl.stats().buffered_events, 4);

  // Now they send a prompt: the worker mints an engagement and the run registers.
  h.setSessionId('sess-1');
  await h.ctl.tick();
  await settle();

  assert.deepEqual(h.kinds, ['replayPolicy', 'replayRegister', 'replayChunk']);

  const reg = h.sentOf('replayRegister')[0];
  assert.equal(reg.session_id, 'sess-1');
  assert.equal(reg.tab_host, 'chatgpt.com');
  assert.equal(reg.capture, 'dom_events');
  assert.equal(reg.recorder, R.RECORDER_ID);
  assert.equal(reg.mask_profile, 'composer_visible');
  assert.match(reg.started_at, /^\d{4}-\d{2}-\d{2}T/);

  const chunk = h.sentOf('replayChunk')[0];
  assert.equal(chunk.seq, 0);
  assert.equal(chunk.replay_id, reg.replay_id);
  assert.equal(chunk.encoding, 'gzip');
  assert.equal(chunk.event_count, 4);
  assert.equal(chunk.has_full_snapshot, true, 'seq 0 must be independently replayable');
  assert.match(chunk.sha256, /^[0-9a-f]{64}$/);
  assert.ok(chunk.chunk_b64.length > 0);
  // The chunk is opaque: the only shape on the wire is base64.
  assert.match(chunk.chunk_b64, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(h.banners.at(-1).show, reg.replay_id, 'the banner now names the run');

  // The user clicks Stop.
  await h.ctl.stop('user_stopped');
  await settle();

  assert.deepEqual(
    h.kinds.slice(0, 4),
    ['replayPolicy', 'replayRegister', 'replayChunk', 'replayComplete'],
    'the whole run, in order, with nothing else in between',
  );
  const done = h.sentOf('replayComplete')[0];
  assert.equal(done.replay_id, reg.replay_id);
  assert.equal(done.stop_reason, 'user_stopped');
  assert.equal(done.chunk_count, 1);
  assert.equal(done.event_count, 4);
  assert.deepEqual(done.session_ids, ['sess-1']);
  assert.equal(h.stopCalls(), 1, 'rrweb was detached');

  // STOP IS A LATCH. It did not use to be: the state machine applies one transition
  // per pass and the controller loops, so a run that closed while the gate was still
  // open (visible tab, recordable host, budget left) was immediately followed by a
  // fresh one — banner and full DOM snapshot included — on the same tick. Clicking
  // Stop stopped one run and started the next.
  assert.equal(h.ctl.state, STATES.IDLE, 'no replacement run');
  assert.equal(h.ctl.stats(), null, 'no run at all');
  assert.equal(h.ctl.stopped, true);
  assert.equal(h.banners.at(-1).hide, true, 'and the banner stayed down');
});

test("the default stop reason is 'user_stopped' — a name the server files as CLEAN", async () => {
  // server/src/routes/replays.js CLEAN_STOP_REASONS contains 'user_stopped' and
  // not 'user_stop'. Getting this wrong files a deliberate user stop as an abort.
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();
  await h.ctl.stop();
  await settle();
  assert.equal(h.sentOf('replayComplete')[0].stop_reason, 'user_stopped');
});

// ── the stop latch ──────────────────────────────────────────────────────────
// Two compounding bugs used to make stop() not stop:
//   1. `stopRequest` was cleared only on the loop's FIRST iteration, but the actions
//      applied inside the loop set it too — so a reason set on iteration >= 1 leaked
//      into whatever run opened next and killed that one as well.
//   2. nothing latched, so the cold-start branch reopened a run on the very next
//      iteration while the gate was still open.
// Together with a page that keeps pruning the banner, (2) is an unbounded loop: a new
// run and a full DOM snapshot upload roughly every second, indefinitely, with no cap
// catching it (each restarted run's duration is ~0, so the daily ledger never bites,
// and the per-run byte/chunk caps reset on every restart).

test('after Stop, repeated ticks do NOT reopen a run or re-show the banner', async () => {
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();
  assert.equal(h.ctl.stats().registered, true);

  await h.ctl.stop('user_stopped');
  await settle();
  const bannersAfterStop = h.banners.length;
  const recordsAfterStop = h.recordCalls();
  const completes = h.sentOf('replayComplete').length;

  // The gate stays wide open — visible tab, recordable host, budget left — which is
  // exactly the situation the cold start fires in.
  for (let i = 0; i < 20; i++) {
    h.advance(1_000);
    await h.fireTimer();
    await settle();
  }

  assert.equal(h.ctl.state, STATES.IDLE);
  assert.equal(h.ctl.stats(), null, 'not one replacement run');
  assert.equal(h.recordCalls(), recordsAfterStop, 'rrweb was never re-attached');
  assert.equal(h.banners.length, bannersAfterStop, 'and the banner never came back');
  assert.equal(h.sentOf('replayComplete').length, completes, 'no further runs to complete');
  assert.equal(h.sentOf('replayRegister').length, 1);
});

test('the fail-closed banner_removed stop latches too — that is the unbounded loop', async () => {
  // A page that prunes DOM nodes it does not recognise prunes the banner again the
  // moment it reappears, so restarting after banner_removed is a loop that uploads a
  // fresh full-page snapshot per tick, forever.
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  await h.ctl.stop('banner_removed');
  await settle();
  assert.equal(h.sentOf('replayComplete')[0].stop_reason, 'banner_removed');

  const chunks = h.sentOf('replayChunk').length;
  for (let i = 0; i < 10; i++) { h.advance(1_000); await h.fireTimer(); await settle(); }
  assert.equal(h.ctl.state, STATES.IDLE);
  assert.equal(h.recordCalls(), 1, 'the recorder was attached exactly once, ever');
  assert.equal(h.sentOf('replayChunk').length, chunks, 'no snapshot-per-second upload loop');
});

test('a NON-latching stop still lets a fresh run open — the caps are per-run', async () => {
  // 'chunk_cap' / 'max_run_ms' / 'chunk_rejected' end a RUN on its own limits. The
  // user has not asked to stop and the indicator is still up, so a new run is correct.
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();
  const first = h.ctl.stats().replay_id;

  await h.ctl.stop('chunk_cap');
  await settle();
  assert.equal(h.ctl.stopped, false);
  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.notEqual(h.ctl.stats().replay_id, first, 'a NEW run, with its own replay_id');
});

test('the latch is released when the engagement genuinely rotates', async () => {
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  await h.ctl.stop('user_stopped');
  await settle();
  assert.equal(h.ctl.stopped, true);

  // Same session: still latched, however long the tab sits there.
  for (let i = 0; i < 5; i++) { h.advance(1_000); await h.fireTimer(); await settle(); }
  assert.equal(h.ctl.state, STATES.IDLE);

  // The worker rotates the engagement (a different AI service in this tab, an idle
  // timeout, the 12h cap). That is a new conversation, and stopping was scoped to the
  // old one — the same rule nextReplayState uses for 'engagement_rotated'.
  h.setSessionId('sess-2');
  h.advance(1_000);
  await h.fireTimer();
  await settle();

  assert.equal(h.ctl.stopped, false, 'the latch was released');
  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.ok(h.ctl.stats(), 'recording again');
  assert.equal(h.sentOf('replayRegister').length, 2);
  assert.equal(h.sentOf('replayRegister').at(-1).session_id, 'sess-2');
  assert.equal(h.banners.at(-1).show, h.ctl.stats().replay_id, 'with a visible indicator again');
});

test('a stop reason set INSIDE the tick loop cannot leak into the next run', async () => {
  // doRegister sets stopRequest='register_failed' from inside the loop. It used to be
  // cleared only on iteration 0, so it survived the whole tick and then terminated the
  // replacement run too — one bad registration killed the next run for free.
  let failRegister = true;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    responses: { replayRegister: () => (failRegister ? { ok: false, error: 500 } : { ok: true }) },
  });

  await h.ctl.init();
  await settle();
  // Burn through the register attempt cap. Each attempt is rate-limited to one per
  // REGISTER_RETRY_MS, so the clock has to move between ticks.
  for (let i = 0; i < 8; i++) {
    h.advance(6_000);
    await h.ctl.tick();
    await settle();
  }
  assert.match(h.logs.warn.join('\n'), /could not register replay run/);

  // register_failed is not a latching reason, so a fresh run opened. With the leak, it
  // was born already carrying 'register_failed' and died on its first tick.
  failRegister = false;
  h.advance(6_000);
  await h.ctl.tick();
  await settle();
  h.advance(6_000);
  await h.ctl.tick();
  await settle();

  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.equal(h.ctl.stats().registered, true, 'the replacement run registered normally');
});

test('a run that never gets a session is DISCARDED — nothing is registered or stored', async () => {
  const h = makeReplayHarness();
  await h.ctl.init();
  h.snapshot();
  h.noise(10);

  await h.ctl.onPageHide();
  await settle();

  assert.deepEqual(h.kinds, ['replayPolicy'], 'not one byte left the tab');
  assert.equal(h.ctl.stats().registered, false);
  assert.equal(h.ctl.stats().buffered_events, 0, 'the buffer was thrown away, not flushed');
  assert.ok(h.banners.some((b) => b.hide), 'the banner came down');
  assert.match(h.logs.info.join('\n'), /nothing was uploaded and nothing is stored/);
});

test('the ring buffer is truncated to the newest full snapshot until registration', async () => {
  const h = makeReplayHarness();
  await h.ctl.init();

  h.snapshot();
  h.noise(5);
  assert.equal(h.ctl.stats().buffered_events, 6);

  // rrweb checkouts every checkout_every_ms; each one throws away everything older.
  h.snapshot();
  assert.equal(h.ctl.stats().buffered_events, 1, 'only the fresh snapshot survives');
  h.noise(2);
  assert.equal(h.ctl.stats().buffered_events, 3);
});

test('hiding the tab pauses immediately and accrues the observed time', async () => {
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();          // register + seq 0
  await settle();

  h.advance(5_000);
  h.setVisible(false);
  await h.ctl.tick();
  await settle();

  assert.equal(h.ctl.state, STATES.PAUSED);
  assert.equal(h.stopCalls(), 1, 'the recorder is fully stopped, not just ignored');
  const accrued = h.sentOf('replayDailyAccrued');
  assert.equal(accrued.length, 1);
  assert.equal(accrued[0].ms, 5_000);

  // Coming back re-attaches (which re-snapshots) and keeps the same run + seq.
  h.setVisible(true);
  await h.ctl.tick();
  await settle();
  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.equal(h.recordCalls(), 2);
  assert.equal(h.ctl.stats().seq, 1, 'the seq counter survives the pause');
  assert.equal(h.ctl.stats().replay_id, h.sentOf('replayRegister')[0].replay_id);
});

test('a closed gate never starts a run, and an unanswered policy stays closed', async () => {
  for (const gate of [
    { recordable: false },
    { enabled: false },
    { remainingDailyMs: 0 },
  ]) {
    const h = makeReplayHarness(gate);
    await h.ctl.init();
    h.snapshot();
    await settle();
    assert.equal(h.ctl.state, STATES.IDLE, JSON.stringify(gate));
    assert.equal(h.recordCalls(), 0, 'rrweb was never attached');
    assert.deepEqual(h.banners, [], 'and no banner was shown');
  }

  // No answer at all from the worker — the safe state is not recording.
  const silent = makeReplayHarness({ responses: { replayPolicy: null } });
  await silent.ctl.init();
  assert.equal(silent.ctl.state, STATES.IDLE);
  assert.equal(silent.ctl.gate.ready, false);
  assert.equal(silent.recordCalls(), 0);
});

test('a missing rrweb bundle disables replay instead of throwing', async () => {
  const h = makeReplayHarness({ rrwebPresent: false });
  await h.ctl.init();
  assert.equal(h.ctl.state, STATES.IDLE);
  assert.deepEqual(h.banners, [], 'no banner for a recording that is not happening');
  assert.match(h.logs.warn.join('\n'), /rrweb recorder not present/);
});

// ── the two fixes ───────────────────────────────────────────────────────────

test('a chunk the server keeps REFUSING ends the run instead of retrying forever', async () => {
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    // A 413 (over the size cap) or a 409 (seq already stored) will be refused again
    // on every retry — this is not a transient outage.
    responses: { replayChunk: { ok: false, error: 413 } },
  });

  // A session already exists, so init() starts AND registers in one pass.
  await h.ctl.init();
  await settle();
  assert.equal(h.ctl.stats().registered, true);
  h.snapshot();
  h.noise(2);

  // Three interval flushes, three refusals.
  for (const expected of [1, 2, 3]) {
    h.advance(11_000);
    await h.ctl.tick();
    await settle();
    assert.equal(h.sentOf('replayChunk').length, expected, `refusal ${expected}`);
    if (expected < 3) {
      assert.equal(h.ctl.stats().reject_streak, expected);
      assert.equal(h.ctl.stats().chunks, 0, 'nothing was counted as uploaded');
    }
  }

  assert.match(h.logs.warn.join('\n'), /refused 3 times in a row/);
  assert.match(h.logs.warn.join('\n'), /chunk_rejected/);

  // The next tick consumes the stop request and ends the run honestly, rather than
  // leaving it observing the page and re-buffering forever.
  await h.ctl.tick();
  await settle();
  const done = h.sentOf('replayComplete');
  assert.equal(done.length, 1);
  assert.equal(done[0].stop_reason, 'chunk_rejected');

  // That run really is over: it makes no further upload attempts of its own. (A
  // FRESH run opens, because the gate is still open — see the note above — but it
  // starts with an empty buffer and nothing to send.)
  const attempts = h.sentOf('replayChunk').length;
  h.advance(60_000);
  await h.ctl.tick();
  await settle();
  assert.equal(h.sentOf('replayChunk').length, attempts, 'no retry after the run ended');
});

test('a successful upload resets the refusal streak', async () => {
  let refuse = true;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    responses: { replayChunk: () => (refuse ? { ok: false, error: 503 } : { ok: true }) },
  });
  await h.ctl.init();
  await settle();
  h.snapshot();
  h.advance(11_000);
  await h.ctl.tick();
  await settle();
  assert.equal(h.ctl.stats().reject_streak, 1);

  refuse = false;
  h.advance(11_000);
  await h.ctl.tick();
  await settle();
  assert.equal(h.ctl.stats().reject_streak, 0, 'a transient outage must not count towards the abort');
  assert.equal(h.ctl.stats().chunks, 1);
  assert.equal(h.ctl.state, STATES.RECORDING, 'the run is still going');
});

test('a THROW while building a chunk rolls back exactly like a refusal does', async () => {
  // The buffer is drained before the compress/hash/send sequence, and only send used
  // to be guarded. A throw from JSON.stringify (RangeError on a huge snapshot),
  // compress, or digest (crypto.subtle is undefined on a non-secure origin) escaped to
  // queueFlush()'s .catch(), which logged "chunk flush failed" — and the events were
  // gone: no rollback, no droppedEvents, and no contribution to the rejectStreak, so a
  // chronically failing run never aborted either. It silently lost data forever.
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    digest: async () => { throw new TypeError("Cannot read properties of undefined (reading 'digest')"); },
  });

  await h.ctl.init();
  await settle();
  assert.equal(h.ctl.stats().registered, true);
  h.snapshot();
  h.noise(4);
  const buffered = h.ctl.stats().buffered_events;
  assert.ok(buffered >= 5);

  h.advance(11_000);
  await h.ctl.tick();
  await settle();

  // Nothing was sent (it never got that far) but nothing was lost either.
  assert.deepEqual(h.sentOf('replayChunk'), [], 'the chunk never reached the transport');
  assert.equal(h.ctl.stats().buffered_events, buffered, 'every event is back in the buffer');
  assert.equal(h.ctl.stats().reject_streak, 1, 'and it counts towards the abort');
  assert.match(h.logs.warn.join('\n'), /could not be built or sent/);
  assert.doesNotMatch(h.logs.warn.join('\n'), /chunk flush failed/,
    'it must be handled in flushChunk, not swallowed by the outer chain catch');

  // Two more failures and the run aborts honestly instead of observing the page
  // forever while quietly throwing its own evidence away.
  for (const expected of [2, 3]) {
    h.advance(11_000);
    await h.ctl.tick();
    await settle();
    if (expected < 3) assert.equal(h.ctl.stats().reject_streak, expected);
  }
  await h.ctl.tick();
  await settle();
  const done = h.sentOf('replayComplete');
  assert.equal(done.length, 1);
  assert.equal(done[0].stop_reason, 'chunk_rejected');
});

test('the outage re-buffer counts the events it drops (it used to report NaN)', async () => {
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    // A big per-chunk budget so the events pile up instead of auto-flushing, which
    // is what lets the re-buffer exceed its own 2 MB ceiling in one go.
    policy: { chunk_max_bytes: 4 * 1024 * 1024, chunk_flush_ms: 10_000 },
    responses: { replayChunk: { ok: false, error: 503 } },
  });

  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();                       // register + refusal 1 (tiny buffer)
  await settle();
  assert.equal(h.ctl.stats().dropped_events, 0, 'initialised, not undefined');

  // ~2.7 MB of events, then one flush attempt that gets refused.
  h.noise(9, 300 * 1024);
  h.advance(11_000);
  await h.ctl.tick();
  await settle();

  const dropped = h.ctl.stats().dropped_events;
  assert.ok(Number.isInteger(dropped) && dropped > 0, `dropped_events should be a positive integer, got ${dropped}`);
  assert.ok(h.ctl.stats().buffered_events > 0, 'the newest events are kept');
  const warned = h.logs.warn.join('\n');
  assert.match(warned, /dropped \d+ oldest/);
  assert.doesNotMatch(warned, /NaN/, 'the whole point of the fix');
});

// ── the full snapshot survives everything ───────────────────────────────────
// The live finding: on a real site the snapshot chunk is at or over the server's
// per-chunk cap, so it is refused; the rollback re-buffers it; each retry cycle lets
// more incremental events pile on top of it; the re-buffer goes over its 2 MB
// ceiling; and the eviction loop — a plain shift() off the front — threw away the
// OLDEST event, which is always the snapshot (rrweb emits it first). The run then
// uploaded happily and replayed as a blank page with a moving cursor. Losing the
// snapshot is not "degraded", it is the whole recording.

test('a fresh full snapshot is flushed on its own instead of accumulating events first', async () => {
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    // Deliberately far above anything this test buffers: if the snapshot goes up on
    // its own it is NOT because a size threshold happened to fire.
    policy: { chunk_max_bytes: 8 * 1024 * 1024, chunk_flush_ms: 10_000 },
  });

  await h.ctl.init();
  await settle();
  assert.equal(h.ctl.stats().registered, true);
  const before = h.sentOf('replayChunk').length;

  h.snapshot();
  await settle();

  const uploads = h.sentOf('replayChunk');
  assert.equal(uploads.length, before + 1, 'the snapshot did not wait for the interval or the byte budget');
  const chunk = uploads.at(-1);
  assert.equal(chunk.has_full_snapshot, true);
  assert.equal(chunk.event_count, 1, 'and it went up in its own chunk, with nothing piled on top of it');
  assert.equal(h.ctl.stats().buffered_events, 0);

  // Ordinary incremental events still wait for the normal triggers — this is not a
  // flush-per-event.
  h.noise(5);
  await settle();
  assert.equal(h.sentOf('replayChunk').length, before + 1, 'no chunk per event');
  assert.equal(h.ctl.stats().buffered_events, 5);
});

test('eviction drops everything else before it will drop the full snapshot', async () => {
  let accept = false;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    policy: { chunk_max_bytes: 8 * 1024 * 1024, chunk_flush_ms: 10_000 },
    // 413: the server refuses this chunk on its merits, and will refuse it again.
    responses: { replayChunk: () => (accept ? { ok: true } : { ok: false, error: 413 }) },
  });

  await h.ctl.init();
  await settle();
  h.snapshot();
  await settle();
  assert.equal(h.sentOf('replayChunk').length, 1, 'refusal 1 — the snapshot chunk');
  assert.equal(h.ctl.stats().buffered_snapshots, 1, 'rolled back into the buffer, not lost');

  // The page keeps mutating while the snapshot is still unaccepted: ~2.7 MB of
  // incremental events pile on top of it, which is what takes the re-buffer past its
  // 2 MB ceiling on the next refusal.
  h.noise(9, 300 * 1024);
  h.advance(11_000);
  await h.ctl.tick();
  await settle();

  const s = h.ctl.stats();
  assert.equal(s.buffered_snapshots, 1, 'THE FIX: the snapshot is still there');
  assert.ok(s.dropped_events > 0, 'other events were evicted in its place');
  assert.ok(s.buffered_bytes <= 2 * 1024 * 1024, 'and the buffer really was brought back under its ceiling');

  // When the transport recovers, what goes up still opens with a full snapshot — so
  // the recording is watchable rather than a mutation stream applied to nothing.
  accept = true;
  h.advance(11_000);
  await h.ctl.tick();
  await settle();
  const uploaded = h.sentOf('replayChunk').at(-1);
  assert.equal(uploaded.has_full_snapshot, true);
  assert.equal(h.ctl.stats().chunks, 1);
});

test('with nothing but the snapshot left, the run aborts instead of evicting it', async () => {
  // The last-resort case. Evicting the snapshot here would let the run "succeed" and
  // store something unwatchable; the honest ending is the existing chunk_rejected
  // abort, and it must not be softened.
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    policy: { chunk_max_bytes: 8 * 1024 * 1024, chunk_flush_ms: 10_000 },
    responses: { replayChunk: { ok: false, error: 413 } },
  });

  await h.ctl.init();
  await settle();

  // Two snapshots and NOTHING else, together well past the 2 MB re-buffer ceiling.
  // (rrweb re-snapshots on every checkout, and one snapshot of a big enough page is
  // already over the ceiling on its own.)
  const blob = 'x'.repeat(1_600_000);
  h.emit({ type: 2, timestamp: h.nowValue(), data: { node: { id: 1 }, blob } }, true);
  await settle();
  h.emit({ type: 2, timestamp: h.nowValue() + 1, data: { node: { id: 2 }, blob } }, true);
  await settle();

  const s = h.ctl.stats();
  assert.equal(s.buffered_snapshots, 2, 'both snapshots are still buffered');
  assert.equal(s.dropped_events, 0, 'nothing was evicted, because everything left is a snapshot');
  assert.ok(s.buffered_bytes > 2 * 1024 * 1024, 'the buffer is knowingly left over its ceiling');
  assert.equal(h.ctl.stats().chunks, 0, 'and nothing was counted as uploaded');

  // Third refusal → the existing rejection cap ends the run honestly.
  h.advance(11_000);
  await h.ctl.tick();
  await settle();
  assert.match(h.logs.warn.join('\n'), /refused 3 times in a row/);

  await h.ctl.tick();
  await settle();
  const done = h.sentOf('replayComplete');
  assert.equal(done.length, 1);
  assert.equal(done[0].stop_reason, 'chunk_rejected', 'an honest abort, not a silently corrupt recording');
});

// ── plumbing ────────────────────────────────────────────────────────────────

test('tick() never rejects, and a failing FIRST tick still arms the timer', async () => {
  // tick() is called from the interval and from four places in content.js, none of
  // which can catch an async rejection (a sync try/catch around a call to an async
  // function never sees one) — so it catches its own. And the timer must be armed even
  // when tick('init') fails: it used to sit AFTER an unguarded `await tick('init')`, so
  // one throw there left the recorder with no timer, silently dead for the whole life
  // of the page, while content.js's `_replayController` stayed non-null.
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    extraDeps: { visible: () => { throw new Error('visibilityState blew up'); } },
  });

  await assert.doesNotReject(() => h.ctl.init());
  assert.equal(h.hasTimer(), true, 'the timer is armed regardless');
  assert.match(h.logs.warn.join('\n'), /tick\(init\) failed/);

  // Every later tick is just as safe, from any trigger.
  await assert.doesNotReject(() => h.ctl.tick('manual'));
  await assert.doesNotReject(() => h.ctl.onVisibilityChange());
  await assert.doesNotReject(() => h.ctl.onPageHide());
  await assert.doesNotReject(() => h.ctl.stop());
  assert.doesNotThrow(() => h.fireTimer());
  await settle();

  // A tick that failed must not have swallowed the stop: the latch is closed, so no
  // run can open even once the underlying fault clears.
  assert.equal(h.ctl.stopped, true);
  assert.equal(h.ctl.state, STATES.IDLE);
  assert.deepEqual(h.banners, [], 'nothing ever started, so nothing was ever indicated');
});

test('init arms the tick timer and dispose tears everything down', async () => {
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  assert.equal(h.hasTimer(), true);

  h.ctl.dispose();
  assert.equal(h.hasTimer(), false);
  assert.equal(h.ctl.state, STATES.IDLE);

  // A disposed controller does nothing further, however hard it is poked.
  const before = h.sends.length;
  await h.ctl.tick();
  assert.equal(h.sends.length, before);
});

test('the recorder identity that is stored with every run matches the vendored pin', () => {
  assert.equal(R.RECORDER_ID, 'rrweb@' + R.RRWEB_VERSION);
  assert.match(R.RRWEB_VERSION, /^\d+\.\d+\.\d+/);
});
