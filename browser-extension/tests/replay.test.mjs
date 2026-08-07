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
  decodeChunkEvents,
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

// ── the conversation boundary ───────────────────────────────────────────────
// A session survives a chat switch by design (the engagement rule). A REPLAY
// must not: otherwise one recording covers three different chats and can never
// honestly be shown against any of them.

test('the conversation null-semantics table, row by row', () => {
  const conv = { ...base, runConversationId: null, conversationId: null };

  // null → null: nothing has been established yet.
  assert.equal(R.nextReplayState(conv).action, 'none');

  // null → 'A': ADOPT. A run that started before the site minted an id belongs
  // to whatever id it eventually gets — that is never a rotation.
  const adopt = R.nextReplayState({ ...conv, conversationId: 'A' });
  assert.deepEqual(adopt, { state: STATES.RECORDING, action: 'bind_conversation', stop_reason: null });

  // 'A' → 'B': ROTATE.
  const rotate = R.nextReplayState({ ...conv, runConversationId: 'A', conversationId: 'B' });
  assert.equal(rotate.stop_reason, 'conversation_changed');
  assert.equal(rotate.action, 'complete');
  assert.equal(rotate.state, STATES.IDLE);

  // 'A' → null: ROTATE. This is "New chat" — the next prompt belongs to a
  // conversation whose id does not exist yet, so the CURRENT run must close now
  // rather than swallow the first turn of the next chat.
  const newChat = R.nextReplayState({ ...conv, runConversationId: 'A', conversationId: null });
  assert.equal(newChat.stop_reason, 'conversation_changed');
  assert.equal(newChat.action, 'complete');

  // …and the same conversation is, of course, no boundary at all. (Once the
  // server has acknowledged it — an id claimed locally but not yet confirmed is
  // still owed a bind, which is a separate axis; see the bind test below.)
  assert.equal(
    R.nextReplayState({ ...conv, runConversationId: 'A', runConversationBound: true, conversationId: 'A' }).action,
    'none',
  );
});

test('an unregistered run is DISCARDED on a conversation change, not completed', () => {
  // Unreachable in practice (runConversationId is only set once a run has
  // registered), but the close() contract must hold for this reason too.
  const t = R.nextReplayState({
    ...base, registered: false, runConversationId: 'A', conversationId: 'B',
  });
  assert.equal(t.action, 'discard');
  assert.equal(t.stop_reason, 'conversation_changed');
});

test('a coincident engagement rotation wins the name — the coarser boundary', () => {
  const t = R.nextReplayState({
    ...base,
    sessionId: 'sess-2', runSessionId: 'sess-1',
    conversationId: 'B', runConversationId: 'A',
  });
  assert.equal(t.stop_reason, 'engagement_rotated', 'the older, coarser boundary is reported');
});

test('bind_conversation is RECORDING-only and stops once the SERVER confirms it', () => {
  const bindable = { ...base, runConversationId: null, conversationId: 'A' };
  assert.equal(R.nextReplayState(bindable).action, 'bind_conversation');

  // A paused run is not observing anything; the bind can wait for the resume.
  assert.equal(R.nextReplayState({ ...bindable, state: STATES.PAUSED, visible: false }).action, 'none');
  // Registration comes first: an unregistered run has no replay_id to bind.
  assert.equal(
    R.nextReplayState({ ...bindable, registered: false, runSessionId: null }).action,
    'register',
  );

  // WHAT ENDS THE ASKING IS THE ACK, NOT THE LOCAL CLAIM. The action sets
  // runConversationId optimistically, so if that alone stopped the retry, one
  // transient failure would leave the run permanently unbound server-side.
  assert.equal(
    R.nextReplayState({ ...bindable, runConversationId: 'A', runConversationBound: false }).action,
    'bind_conversation',
    'claimed locally but not acknowledged → keep asking',
  );
  assert.equal(
    R.nextReplayState({ ...bindable, runConversationId: 'A', runConversationBound: true }).action,
    'none',
    'acknowledged → nothing left to do',
  );
  // …and the retry budget latches, so a server that never answers cannot make
  // this spin for the life of the run.
  assert.equal(
    R.nextReplayState({ ...bindable, runConversationId: 'A', bindAbandoned: true }).action,
    'none',
  );
});

test('an UNACKNOWLEDGED conversation id still rotates the run', () => {
  // THE MERGE BUG. A transient bind failure used to roll runConversationId back
  // to null, and the rotation guard needs it truthy to fire at all — so for the
  // whole ~30 s retry window a chat switch could not be detected and one run
  // kept recording across two conversations.
  const t = R.nextReplayState({
    ...base, runConversationId: 'A', runConversationBound: false, conversationId: 'B',
  });
  assert.equal(t.stop_reason, 'conversation_changed');
  assert.equal(t.action, 'complete');
  // Same for a run whose bind was permanently given up on: recording continues,
  // but the boundary it knows about is still a boundary.
  assert.equal(
    R.nextReplayState({
      ...base, runConversationId: 'A', bindAbandoned: true, conversationId: 'B',
    }).stop_reason,
    'conversation_changed',
  );
});

test('visibility outranks the bind: a hidden tab pauses with a bind outstanding', () => {
  // A pending bind re-triggers on EVERY tick until it is acknowledged, so while
  // it sat ahead of the visibility check it could hold a hidden tab in RECORDING
  // for the entire retry window — against this file's own "recording stops the
  // moment the tab is hidden, unconditionally" invariant.
  const pending = { ...base, runConversationId: null, runConversationBound: false, conversationId: 'A' };
  assert.equal(R.nextReplayState(pending).action, 'bind_conversation', 'visible → bind');
  assert.deepEqual(
    R.nextReplayState({ ...pending, visible: false }),
    { state: STATES.PAUSED, action: 'pause', stop_reason: null },
  );

  // Registration keeps its place AHEAD of the pause, because registering is what
  // flushes the ring buffer.
  assert.equal(
    R.nextReplayState({ ...pending, visible: false, registered: false, runSessionId: null }).action,
    'register',
  );
});

test('a conversation change never outranks a cap, a stop or the gate', () => {
  const rotating = { ...base, runConversationId: 'A', conversationId: 'B' };
  assert.equal(R.nextReplayState({ ...rotating, stopRequest: 'pagehide' }).stop_reason, 'pagehide');
  assert.equal(R.nextReplayState({ ...rotating, enabled: false }).stop_reason, 'policy_disabled');
  assert.equal(R.nextReplayState({ ...rotating, recordable: false }).stop_reason, 'navigated_away');
  assert.equal(R.nextReplayState({ ...rotating, remainingDailyMs: 0 }).stop_reason, 'daily_cap');
});

test('a caller that never wires getConversationId behaves exactly as before', () => {
  // The dep defaults to () => null, so conversationId/runConversationId are both
  // null on every tick and neither the boundary nor the bind can ever fire.
  const t = R.nextReplayState({ ...base });
  assert.equal(t.action, 'none');
  assert.equal(t.stop_reason, null);
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
  // No pixels, no main-world injection. Fonts ARE collected — see the
  // font-event tests below for why (missing fonts garble text layout).
  assert.equal(opts.recordCanvas, false, 'canvas needs main-world injection — never enabled');
  assert.equal(opts.inlineImages, false);
  assert.equal(opts.collectFonts, true, 'without real font metrics, replay text overlaps/garbles');
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

// ── font events (collectFonts) ───────────────────────────────────────────────
// Same three tests as the full-snapshot fix above, for the same reason: a font
// missing from the replay reproduces the garbled/overlapping-text bug
// collectFonts:true exists to fix, just as surely as a missing snapshot blanks
// the page. Font events are IncrementalSnapshot (type 3) / source 10.

test('a font event is flushed on its own instead of accumulating events first', async () => {
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    policy: { chunk_max_bytes: 8 * 1024 * 1024, chunk_flush_ms: 10_000 },
  });

  await h.ctl.init();
  await settle();
  h.snapshot();
  await settle();
  const before = h.sentOf('replayChunk').length;

  h.font();
  await settle();

  const uploads = h.sentOf('replayChunk');
  assert.equal(uploads.length, before + 1, 'the font did not wait for the interval or the byte budget');
  const chunk = uploads.at(-1);
  assert.equal(chunk.has_font_event, true);
  assert.equal(chunk.event_count, 1, 'and it went up in its own chunk, with nothing piled on top of it');

  h.noise(5);
  await settle();
  assert.equal(h.sentOf('replayChunk').length, before + 1, 'no chunk per event');
});

test('eviction drops everything else before it will drop a font event', async () => {
  let accept = false;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    policy: { chunk_max_bytes: 8 * 1024 * 1024, chunk_flush_ms: 10_000 },
    responses: { replayChunk: () => (accept ? { ok: true } : { ok: false, error: 413 }) },
  });

  await h.ctl.init();
  await settle();
  h.snapshot();
  await settle();
  h.font();
  await settle();
  assert.equal(h.sentOf('replayChunk').length, 2, 'refusal — the font chunk (snapshot already went up separately)');
  assert.equal(h.ctl.stats().buffered_fonts, 1, 'rolled back into the buffer, not lost');

  h.noise(9, 300 * 1024);
  h.advance(11_000);
  await h.ctl.tick();
  await settle();

  const s = h.ctl.stats();
  assert.equal(s.buffered_fonts, 1, 'THE FIX: the font is still there');
  assert.ok(s.dropped_events > 0, 'other events were evicted in its place');
  assert.ok(s.buffered_bytes <= 2 * 1024 * 1024, 'and the buffer really was brought back under its ceiling');

  accept = true;
  h.advance(11_000);
  await h.ctl.tick();
  await settle();
  const uploaded = h.sentOf('replayChunk').at(-1);
  assert.equal(uploaded.has_font_event, true);
});

test('with nothing but snapshots and fonts left, the run aborts instead of evicting either', async () => {
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    policy: { chunk_max_bytes: 8 * 1024 * 1024, chunk_flush_ms: 10_000 },
    responses: { replayChunk: { ok: false, error: 413 } },
  });

  await h.ctl.init();
  await settle();

  h.snapshot();
  await settle();
  h.font(1_600_000);
  await settle();

  const s = h.ctl.stats();
  assert.equal(s.buffered_snapshots, 1);
  assert.equal(s.buffered_fonts, 1);
  assert.equal(s.dropped_events, 0, 'nothing was evicted, because everything left is protected');
  assert.ok(s.buffered_bytes > 2 * 1024 * 1024, 'the buffer is knowingly left over its ceiling');

  h.advance(11_000);
  await h.ctl.tick();
  await settle();
  await h.ctl.tick();
  await settle();
  const done = h.sentOf('replayComplete');
  assert.equal(done.length, 1);
  assert.equal(done[0].stop_reason, 'chunk_rejected', 'an honest abort, not a silently corrupt recording');
});

// ── capture-time font inlining ────────────────────────────────────────────────
// collectFonts:true only catches the JS FontFace API. Real sites (Gemini
// included) declare fonts as ordinary @font-face CSS rules pointing at a vendor
// CDN, which the replay-side sanitizer blanks — so this fetches the bytes at
// RECORD time (while the browser already trusts the host) and inlines them as
// data: URIs before the snapshot ever leaves the machine.

test('a CSS blob with no @font-face is returned untouched, and fetch is never called', async () => {
  // Uses the shared R (loadReplay() with no fetchImpl override — its default
  // throws loudly on any call), so this only passes if fetch is genuinely
  // never reached for CSS with nothing to inline.
  const css = '.foo { color: red; } .bar { background: url(https://cdn.example.com/x.png); }';
  const out = await R.inlineFontsInCssText(css, new Map(), { bytes: 0, count: 0, maxBytes: R.MAX_FONT_INLINE_BYTES });
  assert.equal(out, css);
});

test('an external @font-face url is fetched and inlined as a data: URI', async () => {
  const fontBytes = Buffer.from('fake-woff2-bytes');
  const url = 'https://fonts.gstatic.com/s/googlesans/v1/regular.woff2';
  let fetchCalls = 0;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async (reqUrl) => {
      fetchCalls++;
      assert.equal(reqUrl, url);
      return { ok: true, arrayBuffer: async () => fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) };
    },
  });

  await h.ctl.init();
  await settle();

  const css = `@font-face { font-family: "Google Sans"; src: url("${url}") format("woff2"); }`;
  h.snapshotWithCss(css);
  await settle();

  assert.equal(fetchCalls, 1);
  const chunk = h.sentOf('replayChunk').at(-1);
  const events = decodeChunkEvents(chunk);
  const styleNode = events[0].data.node.childNodes[0];
  assert.ok(styleNode.attributes._cssText.includes('data:font/woff2;base64,'), 'the url was replaced with an inline data: URI');
  assert.ok(!styleNode.attributes._cssText.includes(url), 'the original external URL is gone');
});

test('the same font URL declared twice is only fetched once', async () => {
  const url = 'https://fonts.gstatic.com/s/googlesans/v1/regular.woff2';
  let fetchCalls = 0;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(10) };
    },
  });

  await h.ctl.init();
  await settle();

  const css = `@font-face { font-family: "A"; src: url("${url}"); }`
    + `@font-face { font-family: "A"; font-weight: bold; src: url("${url}"); }`;
  h.snapshotWithCss(css);
  await settle();

  assert.equal(fetchCalls, 1, 'the cache de-duplicates identical font URLs within one snapshot');
  const events = decodeChunkEvents(h.sentOf('replayChunk').at(-1));
  const cssOut = events[0].data.node.childNodes[0].attributes._cssText;
  assert.equal((cssOut.match(/data:font/g) || []).length, 2, 'both declarations got the inlined result');
});

test('a font fetch failure leaves that url() untouched — no crash, no data loss', async () => {
  const url = 'https://fonts.gstatic.com/s/googlesans/v1/broken.woff2';
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });

  await h.ctl.init();
  await settle();

  const css = `@font-face { font-family: "A"; src: url("${url}"); }`;
  h.snapshotWithCss(css);
  await settle();

  const chunk = h.sentOf('replayChunk').at(-1);
  assert.ok(chunk, 'the chunk still uploaded — a failed font fetch does not fail the flush');
  const events = decodeChunkEvents(chunk);
  const cssOut = events[0].data.node.childNodes[0].attributes._cssText;
  assert.ok(cssOut.includes(url), 'left exactly as it was — sanitized away at replay like today, not a regression');
});

test('a background-image url() outside @font-face is never touched', async () => {
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async () => { throw new Error('should never be called for a non-font url'); },
  });

  await h.ctl.init();
  await settle();

  const css = '.hero { background-image: url(https://cdn.example.com/photo.png); }';
  h.snapshotWithCss(css);
  await settle();

  const events = decodeChunkEvents(h.sentOf('replayChunk').at(-1));
  const cssOut = events[0].data.node.childNodes[0].attributes._cssText;
  assert.equal(cssOut, css, 'untouched — images stay blocked, this only ever reaches inside @font-face blocks');
});

test('the total inlined bytes are capped, and whatever does not fit is left external', async () => {
  const bigChunk = Buffer.alloc(1024 * 1024).fill('a'); // 1 MB per "font"
  let fetchCalls = 0;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, arrayBuffer: async () => bigChunk.buffer.slice(0, bigChunk.byteLength) };
    },
  });

  await h.ctl.init();
  await settle();

  // 3 distinct ~1 MB fonts — comfortably over the 1.5 MB total budget, so the
  // third one (at least) cannot fit regardless of fetch order. Family names are
  // plain (F1/F2/F3), not derived from the URL, so `cssOut.includes(url)` below
  // can only match the url() itself — not an unrelated copy of the same string.
  const urls = [1, 2, 3].map((n) => `https://fonts.gstatic.com/s/font${n}.woff2`);
  const css = urls.map((u, i) => `@font-face { font-family: "F${i}"; src: url("${u}"); }`).join('');
  h.snapshotWithCss(css);
  await settle();

  const events = decodeChunkEvents(h.sentOf('replayChunk').at(-1));
  const cssOut = events[0].data.node.childNodes[0].attributes._cssText;
  const inlinedCount = (cssOut.match(/data:font/g) || []).length;
  const externalCount = urls.filter((u) => cssOut.includes(u)).length;
  assert.ok(inlinedCount < urls.length, 'not everything fit under the budget');
  assert.ok(externalCount > 0, 'and what did not fit was left external rather than corrupting the CSS');
  assert.equal(inlinedCount + externalCount, urls.length);
});

test('a rejected snapshot chunk does not re-attempt font inlining on retry — no unbounded growth', async () => {
  // THE LIVE BUG: a rejected chunk rolls its events back into the buffer and
  // re-flushes them later — same event objects, not fresh ones. Without
  // per-event tracking, EVERY retry called inlineExternalFontsInEvents again
  // with a brand-new budget, inlining ANOTHER ~1.5 MB batch of whatever font
  // didn't fit last time — the budget resetting per call while the CSS
  // mutations accumulated across calls. Confirmed live: a real Gemini
  // recording's snapshot chunk grew 6 MB -> 12 MB -> 13 MB -> ~14 MB over
  // ~24 retries before the run gave up, nine times the sanctioned ceiling.
  const bigFont = Buffer.alloc(1024 * 1024).fill('a'); // 1 MB
  let fetchCalls = 0;
  let sendAttempt = 0;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, arrayBuffer: async () => bigFont.buffer.slice(0, bigFont.byteLength) };
    },
    responses: {
      // The FIRST send is refused (mirrors the live 413); every send after
      // that succeeds, so a second attempt is exactly one retry, not a loop.
      replayChunk: () => { sendAttempt++; return sendAttempt === 1 ? { ok: false, error: 413 } : { ok: true }; },
    },
  });

  await h.ctl.init();
  await settle();

  // 3 distinct ~1 MB fonts — only one fits under the 1.5 MB budget on any
  // single pass, so this reproduces "something left over to (wrongly) top up."
  const urls = [1, 2, 3].map((n) => `https://fonts.gstatic.com/s/font${n}.woff2`);
  const css = urls.map((u, i) => `@font-face { font-family: "F${i}"; src: url("${u}"); }`).join('');
  h.snapshotWithCss(css);
  await settle();

  assert.equal(sendAttempt, 1, 'first attempt made and refused');
  const fetchesAfterFirst = fetchCalls;

  // The rejected chunk waits for the next flush trigger to retry.
  h.advance(11_000);
  await h.ctl.tick();
  await settle();

  assert.equal(sendAttempt, 2, 'retried exactly once');
  assert.equal(fetchCalls, fetchesAfterFirst, 'THE FIX: no new font fetches on the retry');

  const allChunks = h.sentOf('replayChunk');
  assert.equal(allChunks.length, 2, 'the refused attempt and the retry both show up as sends');
  const css1 = decodeChunkEvents(allChunks[0])[0].data.node.childNodes[0].attributes._cssText;
  const css2 = decodeChunkEvents(allChunks[1])[0].data.node.childNodes[0].attributes._cssText;
  assert.equal(css1, css2, 'byte-for-byte identical — the retried payload did not grow');
  const inlinedCount = (css2.match(/data:font/g) || []).length;
  assert.ok(inlinedCount < urls.length, 'still bounded by the budget, exactly as the first attempt was');
});

test('two genuinely distinct snapshots piled up in one buffer share ONE total budget, not one each', async () => {
  // THE SECOND LIVE BUG, on top of the first: a tab whose VISIBILITY toggles
  // (switching windows to check DevTools — exactly what happened testing this
  // live) makes rrweb take a BRAND NEW full snapshot on every resume. Each one
  // is a genuinely distinct object, so the once-per-event fix above correctly
  // leaves it alone (no re-fetch) — but if the chunk keeps getting refused,
  // several of these distinct snapshots pile up TOGETHER in the same
  // still-unsent buffer, and each would otherwise still claim its own fresh
  // ~1.5 MB allowance, simply adding up. Confirmed live: a chunk's wire size
  // jumped 6 MB -> 12 MB across exactly one more accumulated snapshot.
  // Sized to fully consume ONE snapshot's own ~1.5 MB per-snapshot cap by
  // itself (R.MAX_FONT_INLINE_BYTES) — the numbers matter here: this is what
  // makes "snapshot 2 gets NOTHING" (fixed) cleanly distinguishable from
  // "snapshot 2 gets its own font anyway" (broken), rather than both landing
  // on the same count by coincidence.
  const bigFont = Buffer.alloc(R.MAX_FONT_INLINE_BYTES).fill('a');
  let sendAttempt = 0;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bigFont.buffer.slice(0, bigFont.byteLength) }),
    responses: {
      // First attempt (snapshot 1 alone) is refused, forcing a rollback;
      // everything after that succeeds.
      replayChunk: () => { sendAttempt++; return sendAttempt === 1 ? { ok: false, error: 413 } : { ok: true }; },
    },
  });

  await h.ctl.init();
  await settle();

  const cssFor = (n) => `@font-face { font-family: "Snap${n}"; src: url("https://fonts.gstatic.com/s/snap${n}font.woff2"); }`;

  // Snapshot 1 — one font that alone fills its per-snapshot cap — refused,
  // rolled back into the buffer.
  h.snapshotWithCss(cssFor(1));
  await settle();
  assert.equal(sendAttempt, 1);

  // A second, genuinely distinct snapshot arrives while the first is still
  // stuck unsent — the visibility-toggle pile-up scenario.
  h.snapshotWithCss(cssFor(2));
  await settle();
  assert.equal(sendAttempt, 2, 'retried with both snapshots bundled together');

  const events = decodeChunkEvents(h.sentOf('replayChunk').at(-1));
  const snapshots = events.filter((e) => e.type === 2);
  assert.equal(snapshots.length, 2, 'both distinct snapshots really did end up in the same chunk');
  const css1 = snapshots[0].data.node.childNodes[0].attributes._cssText;
  const css2 = snapshots[1].data.node.childNodes[0].attributes._cssText;

  assert.ok(css1.includes('data:font'), 'snapshot 1 got its font — it had the whole ceiling to itself');
  // THE FIX: snapshot 1 alone already used up MAX_FONT_INLINE_BYTES worth of
  // the SHARED MAX_TOTAL_RAW_BYTES_WITH_FONTS ceiling, so snapshot 2 must get
  // ZERO room left — not its own fresh ~1.5 MB. Without the fix (a flat
  // per-call budget), snapshot 2 would inline its font too.
  assert.ok(!css2.includes('data:font'), 'snapshot 2 must get NOTHING — no fresh budget of its own');
  assert.ok(css2.includes('https://fonts.gstatic.com/s/snap2font.woff2'), 'left external, exactly like any font that does not fit');
});

// ── conversation scoping, end to end ────────────────────────────────────────
//
// THE ACCEPTANCE REQUIREMENT, restated: one tab, one sitting, no idle gap —
// ask in chat A, switch to chat B and ask, come back to A and ask. Chat A's
// replay must hold the first and third turns and NOTHING from B; chat B's must
// hold only its own. Before this existed that was ONE undifferentiated
// recording, because the engagement (session_id) deliberately survives a
// same-service chat switch and the run was scoped only to the engagement.
//
// The debounce is not a timer. What the recorder reads only moves when the user
// actually DID something in a chat (content.js updates _activeConvId inside
// emit(), for prompt/upload kinds only), so clicking through old chats is free
// by construction. `h.navigateTo()` vs `h.interactIn()` is exactly that split.

/** Drive the controller until it settles: several ticks with the clock moving,
 * the way the real 1 s interval does. */
async function run(h, ticks = 3) {
  for (let i = 0; i < ticks; i++) {
    h.advance(1_000);
    await h.fireTimer();
    await settle();
  }
}

test('a run registered in an existing chat carries the conversation id with it', async () => {
  const h = makeReplayHarness({ sessionId: 'sess-1', conversationId: 'conv-A' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  const reg = h.sentOf('replayRegister')[0];
  assert.equal(reg.external_conv_id, 'conv-A', 'no separate bind round-trip is needed');
  assert.equal(h.sentOf('replayBindConversation').length, 0);
  assert.equal(h.ctl.stats().conversation_id, 'conv-A');
});

test('a run that starts in a NEW chat adopts the id the site mints, without rotating', async () => {
  // "New chat": the URL has no /c/<id> when the first prompt goes out, so the
  // run registers unbound and adopts the id the site produces afterwards.
  const h = makeReplayHarness({ sessionId: 'sess-1' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  const reg = h.sentOf('replayRegister')[0];
  assert.equal('external_conv_id' in reg, false, 'nothing is claimed that is not known');
  assert.equal(h.ctl.stats().conversation_id, null);

  // The site mints one, and the user's next prompt is what the recorder sees.
  h.interactIn('conv-A');
  await run(h);

  const binds = h.sentOf('replayBindConversation');
  assert.equal(binds.length, 1, 'exactly one bind');
  assert.deepEqual(binds[0], {
    __cfai_kind: 'replayBindConversation',
    replay_id: reg.replay_id,
    external_conv_id: 'conv-A',
  });
  assert.equal(h.ctl.stats().replay_id, reg.replay_id, 'the SAME run — adopting is not a boundary');
  assert.equal(h.ctl.stats().conversation_id, 'conv-A');
  assert.equal(h.sentOf('replayComplete').length, 0, 'nothing was closed');

  // …and it is never re-sent.
  await run(h, 5);
  assert.equal(h.sentOf('replayBindConversation').length, 1);
});

test('a failing bind is retried, then given up on — recording never stops', async () => {
  let ok = false;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    responses: { replayBindConversation: () => (ok ? { ok: true } : { ok: false, error: 503 }) },
  });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();
  const replayId = h.ctl.stats().replay_id;

  h.interactIn('conv-A');
  // Attempts are rate-limited to one per REGISTER_RETRY_MS (5 s), so the clock
  // has to move for the retry to be allowed.
  for (let i = 0; i < 3; i++) { h.advance(6_000); await h.fireTimer(); await settle(); }
  assert.ok(h.sentOf('replayBindConversation').length >= 2, 'it retried');
  assert.equal(h.ctl.state, STATES.RECORDING, 'and kept recording throughout');
  assert.equal(h.ctl.stats().replay_id, replayId, 'the same run');

  // Burn through the attempt cap.
  for (let i = 0; i < 8; i++) { h.advance(6_000); await h.fireTimer(); await settle(); }
  const attempts = h.sentOf('replayBindConversation').length;
  assert.match(h.logs.warn.join('\n'), /could not bind run .* after \d+ attempts/);
  assert.equal(h.ctl.state, STATES.RECORDING, 'a failed bind must never abort a run');

  // Permanently given up: no more binds, ever, for this run.
  ok = true;
  for (let i = 0; i < 5; i++) { h.advance(6_000); await h.fireTimer(); await settle(); }
  assert.equal(h.sentOf('replayBindConversation').length, attempts, 'it does not spin forever');
  assert.equal(h.ctl.stats().replay_id, replayId);
});

// ── a bind that has NOT been confirmed is still a conversation boundary ──────
// Both of these reproduce live-confirmed bugs whose single root cause was
// doBindConversation() rolling run.conversationId back to null on every
// TRANSIENT failure, not just on the permanent give-up.

test('a chat switch DURING a failed bind still rotates the run — it is never merged', async () => {
  // THE MERGE BUG, end to end. Recording starts in a brand-new chat, the site
  // mints an id, the bind fails transiently, and inside the ~30 s retry window
  // the user switches to another chat and prompts there. With the id rolled back
  // to null the rotation guard could not fire, so ONE run kept recording across
  // BOTH chats and was finally bound to the second — silently merging the first
  // chat's screen content into what displays as the second chat's replay.
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    responses: { replayBindConversation: { ok: false, error: 503 } },
  });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();
  const runId = h.ctl.stats().replay_id;
  assert.equal(h.sentOf('replayRegister')[0].external_conv_id, undefined, 'a brand-new chat');

  // The site mints conv-A and the user prompts in it. The bind is refused.
  h.interactIn('conv-A');
  await run(h);
  assert.ok(h.sentOf('replayBindConversation').length >= 1, 'it tried');
  assert.equal(h.ctl.stats().replay_id, runId, 'a failed bind never ends a run');
  assert.equal(h.ctl.stats().conversation_id, 'conv-A',
    'the id stays claimed even though the server never acknowledged it');
  assert.equal(h.ctl.stats().conversation_bound, false, '…and it is HONEST about that');

  // Still inside the retry window, the user switches to chat B and prompts there.
  h.interactIn('conv-B');
  await run(h);

  const done = h.sentOf('replayComplete').find((c) => c.replay_id === runId);
  assert.ok(done, 'the run that observed chat A closed instead of absorbing chat B');
  assert.equal(done.stop_reason, 'conversation_changed');

  const regs = h.sentOf('replayRegister');
  assert.equal(regs.length, 2, 'chat B is a NEW run');
  assert.equal(regs[1].external_conv_id, 'conv-B', 'and it carries B from the start');
  assert.notEqual(h.ctl.stats().replay_id, runId);

  // The failed bind must never have named chat B against chat A's run.
  const bindsForRunA = h.sentOf('replayBindConversation').filter((b) => b.replay_id === runId);
  assert.equal(bindsForRunA.every((b) => b.external_conv_id === 'conv-A'), true,
    "run A was only ever offered A's id");
});

test('a pending bind never keeps a HIDDEN tab recording', async () => {
  // Same root cause, second symptom. A bind that is still retrying re-triggers
  // on every tick, and while that check sat ahead of the visibility check the
  // tab kept observing for up to ~25 s after being hidden.
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    responses: { replayBindConversation: { ok: false, error: 503 } },
  });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  h.interactIn('conv-A');
  await run(h, 1);
  assert.equal(h.sentOf('replayBindConversation').length, 1, 'one refused attempt is outstanding');
  assert.equal(h.ctl.state, STATES.RECORDING);
  const detaches = h.stopCalls();

  // The user switches windows. The very NEXT tick must pause — not the tick
  // after the retry budget runs out.
  h.setVisible(false);
  h.advance(1_000);
  await h.fireTimer();
  await settle();

  assert.equal(h.ctl.state, STATES.PAUSED, 'paused immediately');
  assert.equal(h.stopCalls(), detaches + 1, 'and rrweb really was detached, not just relabelled');

  // It stays paused for the whole retry window rather than resuming to bind.
  for (let i = 0; i < 6; i++) { h.advance(6_000); await h.fireTimer(); await settle(); }
  assert.equal(h.ctl.state, STATES.PAUSED, 'a hidden tab is never re-armed by a pending bind');
  assert.equal(h.stopCalls(), detaches + 1, 'and never re-attached in the meantime');

  // Coming back resumes, and the bind picks up where it left off.
  h.setVisible(true);
  await run(h);
  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.ok(h.sentOf('replayBindConversation').length > 1, 'the bind resumed too');
});

test('a bind that finally succeeds stops the retry; one that never does, latches', async () => {
  let ok = false;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    responses: { replayBindConversation: () => (ok ? { ok: true } : { ok: false, error: 503 }) },
  });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  h.interactIn('conv-A');
  h.advance(1_000); await h.fireTimer(); await settle();
  assert.equal(h.ctl.stats().conversation_bound, false);

  ok = true;
  h.advance(6_000); await h.fireTimer(); await settle();
  assert.equal(h.ctl.stats().conversation_bound, true, 'the ack is what flips it');
  const sentSoFar = h.sentOf('replayBindConversation').length;

  // …and it is never re-sent once acknowledged.
  for (let i = 0; i < 5; i++) { h.advance(6_000); await h.fireTimer(); await settle(); }
  assert.equal(h.sentOf('replayBindConversation').length, sentSoFar);
  assert.equal(h.ctl.stats().conversation_bind_abandoned, false);
});

test('clicking through five old chats without typing records NOTHING new', async () => {
  // THE DEBOUNCE REPLACEMENT. No timer, no settle window: navigation alone does
  // not move what the recorder reads, so no boundary can fire.
  const h = makeReplayHarness({ sessionId: 'sess-1', conversationId: 'conv-A' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  const runId = h.ctl.stats().replay_id;
  const registers = h.sentOf('replayRegister').length;
  const completes = h.sentOf('replayComplete').length;

  for (const id of ['conv-B', 'conv-C', 'conv-D', 'conv-E', 'conv-F']) {
    h.navigateTo(id);
    await run(h, 2);
    assert.equal(h.activeConvId(), 'conv-A', 'the recorder still sees the chat the user last used');
  }

  assert.equal(h.sentOf('replayRegister').length, registers, 'not one extra run');
  assert.equal(h.sentOf('replayComplete').length, completes, 'and not one extra completion');
  assert.equal(h.sentOf('replayBindConversation').length, 0);
  assert.equal(h.ctl.stats().replay_id, runId, 'still the same run');

  // …and then they actually type in the chat they landed on. NOW it rotates.
  h.interactIn();
  await run(h);
  assert.equal(h.sentOf('replayComplete').length, completes + 1);
  assert.equal(h.sentOf('replayComplete').at(-1).stop_reason, 'conversation_changed');
  assert.equal(h.sentOf('replayRegister').at(-1).external_conv_id, 'conv-F');
  assert.notEqual(h.ctl.stats().replay_id, runId);
});

test('THE ACCEPTANCE SCENARIO: A → B → A is three runs, tagged A, B, A', async () => {
  // No session yet: the worker mints one on the first real activity, exactly as
  // it does in the browser. So the recorder is observing into the ring buffer
  // and nothing has been registered.
  const h = makeReplayHarness();
  await h.ctl.init();
  h.snapshot();
  await settle();
  assert.equal(h.sentOf('replayRegister').length, 0, 'nothing is stored until someone uses the AI');

  // "What is CloudFuze?" in chat A — the prompt mints the engagement AND moves
  // the active conversation, both in the same moment.
  h.setSessionId('sess-1');
  h.interactIn('conv-A');
  await run(h);

  // Switch to chat B and ask "What is AI Governance?".
  h.navigateTo('conv-B');
  h.interactIn();
  await run(h);

  // Back to chat A and ask "What is Data Governance?".
  h.navigateTo('conv-A');
  h.interactIn();
  await run(h);

  const regs = h.sentOf('replayRegister');
  assert.equal(regs.length, 3, 'exactly three runs — one per conversation visit');
  assert.deepEqual(regs.map((r) => r.external_conv_id), ['conv-A', 'conv-B', 'conv-A']);
  // Three distinct server rows: A's two visits are two runs, and neither of them
  // is the run that covered B.
  assert.equal(new Set(regs.map((r) => r.replay_id)).size, 3);

  const dones = h.sentOf('replayComplete');
  assert.equal(dones.length, 2, 'the first two closed; the third is still recording');
  assert.deepEqual(dones.map((d) => d.stop_reason), ['conversation_changed', 'conversation_changed']);
  assert.deepEqual(dones.map((d) => d.replay_id), [regs[0].replay_id, regs[1].replay_id]);
  // Every run stayed inside ONE engagement — the session never rotated, which is
  // exactly why the engagement boundary alone could not tell these apart.
  assert.equal(dones.every((d) => d.session_ids.length === 1 && d.session_ids[0] === 'sess-1'), true);
  assert.equal(h.ctl.state, STATES.RECORDING);
  assert.equal(h.ctl.stats().conversation_id, 'conv-A');
});

test('a run mid-upload when the conversation switches still completes cleanly', async () => {
  // The rollback path and the boundary must not fight: a chunk the worker
  // refuses is re-buffered, and the run then closes on the conversation change
  // with its counters intact.
  let accept = false;
  const h = makeReplayHarness({
    sessionId: 'sess-1',
    conversationId: 'conv-A',
    responses: { replayChunk: () => (accept ? { ok: true } : { ok: false, error: 500 }) },
  });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  assert.equal(h.sentOf('replayChunk').length, 1);
  assert.ok(h.ctl.stats().buffered_events > 0, 'the refused chunk rolled back into the buffer');
  assert.equal(h.ctl.stats().buffered_snapshots, 1, 'including the snapshot, which is never evicted');

  // The server comes back just as the user switches chats.
  accept = true;
  h.interactIn('conv-B');
  await run(h);

  const done = h.sentOf('replayComplete').find((d) => d.replay_id === h.sentOf('replayRegister')[0].replay_id);
  assert.ok(done, 'the first run completed');
  assert.equal(done.stop_reason, 'conversation_changed');
  assert.ok(done.chunk_count >= 1, 'the re-buffered events went up before it closed');
  assert.equal(h.sentOf('replayRegister').at(-1).external_conv_id, 'conv-B');
});

test('a conversation change does NOT release the stop latch', async () => {
  // Only an ENGAGEMENT rotation does. If a chat switch released it, a user who
  // pressed Stop and then clicked into another chat would be silently recorded
  // again — consent does not carry across a click.
  const h = makeReplayHarness({ sessionId: 'sess-1', conversationId: 'conv-A' });
  await h.ctl.init();
  h.snapshot();
  await h.ctl.tick();
  await settle();

  await h.ctl.stop('user_stopped');
  await settle();
  assert.equal(h.ctl.stopped, true);
  const registers = h.sentOf('replayRegister').length;
  const records = h.recordCalls();

  // Switch chats — and actually type there, the strongest signal available.
  h.interactIn('conv-B');
  await run(h, 10);

  assert.equal(h.ctl.stopped, true, 'still latched');
  assert.equal(h.ctl.state, STATES.IDLE);
  assert.equal(h.ctl.stats(), null, 'no replacement run');
  assert.equal(h.recordCalls(), records, 'rrweb was never re-attached');
  assert.equal(h.sentOf('replayRegister').length, registers);

  // The engagement rotating DOES release it — the existing rule, unchanged.
  h.setSessionId('sess-2');
  await run(h);
  assert.equal(h.ctl.stopped, false);
  assert.equal(h.ctl.state, STATES.RECORDING);
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
