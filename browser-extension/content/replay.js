// Session Replay — automatic DOM/interaction recording (rrweb).
//
// WHAT THIS IS
// Not video. rrweb observes DOM mutations plus user interactions and emits them as
// structured JSON events; a matching rrweb player reconstructs the page later.
// Same category of technique as Clarity/Hotjar/FullStory, MIT-licensed.
//
// WHY IT REPLACED THE VIDEO PIPELINE
// The previous round used chrome.tabCapture + MediaRecorder in an offscreen
// document. chrome.tabCapture only hands out a stream for a tab the extension has
// been INVOKED on, i.e. a toolbar click per tab, every time — confirmed by live
// testing, and not fixable. Governance recording that needs a click is not
// governance recording. DOM observation needs no gesture at all: it runs in the
// content script that the DLP layer is already auto-injected into, so recording
// starts the instant the user is on an AI site. The extension also dropped the
// "tabCapture" and "offscreen" permissions, which shrinks the install prompt.
//
// WHY THIS IS A SEPARATE CLASSIC SCRIPT (not part of content.js, not in lib/)
// Content scripts are classic scripts and this repo has no bundler, so a content
// script cannot `import` lib/recording.js. content/patterns.js already solves that
// by exposing window.__cfaiPatterns; this file follows it exactly and exposes
// window.__cfaiReplay. The payoff is real: everything here is either pure or
// dependency-injected, so tests/replay*.test.mjs drive the WHOLE pipeline —
// state machine, chunking, gzip, base64, sha256, register/complete — in plain
// `node --test` with no browser. content/content.js only does the wiring.
//
// ISOLATED WORLD
// A content script shares the DOM but not the page's JS world. That is fine for
// DOM-mutation observation. It is NOT enough for canvas: rrweb's canvas plugin has
// to wrap the page's own 2d/webgl calls, which needs main-world injection. This
// design deliberately avoids main-world injection, so recordCanvas is false and
// canvas elements are blocked out entirely.
//
// NEVER LOGGED, NEVER SENT SEPARATELY
// The event stream is gzipped and uploaded as opaque chunks. The console logging
// in here reports SIZES and COUNTS only — bytes per chunk and running totals, so a
// human can read real data-volume numbers off the console during a live test —
// never event contents, never prompt text, never the URL path.

(function (global) {
  'use strict';

  // ── Recorder identity ─────────────────────────────────────────────────────
  // Sent to the server as `recorder` on every run so the replay side knows which
  // event schema to hand to which player build. Pinned in package.json as
  // @rrweb/record (the recorder-only build of the rrweb 2.0.0-alpha.20 release —
  // the full `rrweb` package also carries the player, which the extension must
  // never ship). tests/replay-vendor.test.mjs fails if this string and the
  // package.json pin drift apart, and scripts/build-vendor.mjs warns too.
  const RRWEB_VERSION = '2.0.0-alpha.20';
  const RECORDER_ID = 'rrweb@' + RRWEB_VERSION;

  const STATES = Object.freeze({ IDLE: 'IDLE', RECORDING: 'RECORDING', PAUSED: 'PAUSED' });

  // Defaults for the fields the worker's normalizeReplayPolicy() owns. Repeated
  // here (not duplicated logic — just the numbers) because this file cannot import
  // lib/recording.js and must still behave sanely before the first policy answer
  // arrives, or if the worker is asleep.
  const CLIENT_POLICY_DEFAULTS = Object.freeze({
    enabled: true,
    chunk_flush_ms: 10_000,
    chunk_max_bytes: 256 * 1024,
    max_run_ms: 60 * 60 * 1000,
    max_daily_ms: 4 * 60 * 60 * 1000,
    checkout_every_ms: 5 * 60 * 1000,
    mask_profile: 'composer_visible',
    retention_days: 30,
  });

  // Per-run hard caps. Kept at or below the server's own limits so a run ends on a
  // clean stop_reason instead of a surprise upload rejection.
  const MAX_CHUNKS_PER_RUN = 2000;
  const MAX_RUN_BYTES = 50 * 1024 * 1024;      // gzipped
  const MIN_USEFUL_BUDGET_MS = 10_000;

  // Ring-buffer bound for the pre-registration window (see THE RING BUFFER below).
  const RING_MAX_BYTES = 4 * 1024 * 1024;      // uncompressed JSON estimate
  // If a chunk cannot be handed to the worker we roll it back into the buffer
  // rather than burn a seq and leave a hole. That buffer still needs a ceiling.
  const REBUFFER_MAX_BYTES = 2 * 1024 * 1024;
  // …and the retry needs a floor. A chunk the SERVER refuses (a 413 over the size
  // cap, a 409 on a seq it already has) will be refused again on every retry, so
  // retrying forever means a run that observes the page, evicts its own oldest
  // events and never uploads anything — silently, until the tab closes. After this
  // many consecutive refusals the run ends with stop_reason 'chunk_rejected', which
  // the server files as an abort. An honest abort beats an invisible stall.
  const MAX_CHUNK_REJECTIONS = 3;

  const POLICY_POLL_MS = 30_000;               // how often to re-ask the worker
  const TICK_MS = 1_000;                       // state-machine cadence
  const REGISTER_RETRY_MS = 5_000;
  const REGISTER_MAX_ATTEMPTS = 6;

  // ── Stop reasons that LATCH ────────────────────────────────────────────────
  // nextReplayState() ends the current RUN and then, on the next pass, cold-starts a
  // fresh one while the gate is open. That is right for a run that hit a cap and
  // wrong for these two, which both mean "do not record this engagement any more":
  //
  //   user_stopped    the user clicked Stop on the banner. Restarting a run one tick
  //                   later, banner and all, ignores them.
  //   banner_removed  the fail-closed path: the indicator left the page. A page that
  //                   prunes the banner prunes it again, so restart → banner →
  //                   pruned → restart is an unbounded loop, one new run and one full
  //                   DOM snapshot upload per second, that no cap catches (the daily
  //                   ledger sees ~0ms per run and the per-run byte/chunk caps reset
  //                   on every restart).
  //
  // The latch is released when the tab's engagement genuinely rotates — the same
  // signal nextReplayState uses for 'engagement_rotated'. A full page navigation
  // needs no handling: it is a new content script and a new controller.
  const LATCHING_STOP_REASONS = Object.freeze(['user_stopped', 'banner_removed']);

  // ── Masking profile (security-critical) ───────────────────────────────────
  // maskAllInputs STAYS TRUE. Every <input>/<textarea>/<select> on any page is
  // masked by default — password fields, search boxes, unrelated forms. Only the
  // AI prompt composer is unmasked, because the typed prompt IS the governance
  // evidence. That was an explicit, informed product decision.
  //
  // NOTE ON THE API: the design called for rrweb's `unmaskInputSelector` /
  // `unmaskTextSelector`. Those options do not exist in any upstream rrweb 2.x
  // (verified against 2.0.0-alpha.4, alpha.11, alpha.20, 2.1.1 and @rrweb/record —
  // they are a PostHog-fork addition). The upstream mechanism for the same result
  // is `maskInputFn(text, element)`: rrweb calls it for every input it decided to
  // mask, and whatever it returns is what gets recorded. Returning `text` for the
  // composer and asterisks for everything else is exactly unmask-by-selector, and
  // it fails closed — an exception, a missing element or an unusable selector all
  // end up masked.
  //
  // Contenteditable composers (ChatGPT, Claude, Gemini, meta.ai) need no unmask
  // rule at all: rrweb only masks TEXT nodes that match maskTextSelector /
  // maskTextClass, and we set neither, so their text is captured as-is. The
  // selectors below therefore only matter for <textarea>-based composers.

  // THE PRIMARY UNMASK SIGNAL — and it is deliberately NOT a CSS selector.
  //
  // content.js's attach() marks every element its own composer detection found
  // (findPromptInputs → attach, including inside open shadow roots and same-origin
  // iframes) by setting this property on the element. That detection is what the DLP
  // layer already trusts to find the prompt box on arbitrary AI sites, so the unmask
  // rule inherits it instead of re-guessing CSS.
  //
  // WHY A JS PROPERTY AND NOT AN ATTRIBUTE. content.js and this file are both
  // classic content scripts in the SAME manifest content_scripts entry, so they share
  // one ISOLATED-WORLD JS realm: a property attach() sets is directly readable here
  // with no message passing. Critically, the page's own (main-world) JS cannot see or
  // set it. An ATTRIBUTE can: the previous version of this list unmasked
  // `[data-cfai-composer]` — which nothing ever set, so the composer was masked on
  // every host outside the fallback list below — alongside generic
  // `textarea[aria-label*="prompt"]` / `textarea[placeholder*="ask anything"]`
  // wildcards, which any hostile or compromised in-scope page could have put on a
  // password box or an API-key field with one setAttribute() to have it captured in
  // cleartext. Both of those are gone. tests/replay.test.mjs pins the property name
  // against content.js's attach().
  //
  // WHY THE NARROW MARK AND NOT `__cfaiAttached`. content.js sets TWO isolated-world
  // properties and they answer different questions. `__cfaiAttached` means "the DLP
  // layer is watching this element", and it is set on every hit of a deliberately
  // broad selector that includes [role="combobox"], [role="searchbox"] and bare
  // [contenteditable] — breadth that is right for scanning and wrong as permission to
  // record cleartext. This file used to read that one, so on an in-scope host every
  // Lightning lookup and notes field the broad selector found was captured verbatim,
  // and one setAttribute('role','combobox') on an API-key box was enough to opt it in.
  // `__cfaiComposer` is set only for elements that pass content.js's stricter
  // isPromptInput() — TEXTAREA, contenteditable="true", or role="textbox" — the same
  // test the enforcement path uses. Still isolated-world and still unforgeable; now
  // also composer-shaped.
  const COMPOSER_MARK = '__cfaiComposer';

  // FALLBACK ONLY, for the window between the first rrweb snapshot and attach()
  // running (rrweb takes its full snapshot at record() time, which is before the DLP
  // layer has finished its first scan on a slow page).
  //
  // Every entry must be NARROW and site-specific: an id, a custom element, a
  // product-specific class or name. Nothing generic, and nothing keyed on an
  // attribute whose value a page would plausibly set on an unrelated field — a
  // selector in this list is a page-forgeable path to cleartext capture, which is
  // exactly why the two wildcard entries that used to be here were removed.
  const COMPOSER_UNMASK_SELECTORS = Object.freeze([
    '#prompt-textarea',                              // ChatGPT (textarea era + current id)
    '[data-testid="prompt-textarea"]',               // ChatGPT
    'textarea[data-id="root"]',                      // ChatGPT (older builds)
    'rich-textarea textarea',                        // Gemini
    'ms-autosize-textarea textarea',                 // Google AI Studio
    'textarea#ask-input',                            // Perplexity
    'textarea#userInput',                            // Copilot
    'textarea[data-testid="chat-input"]',            // Copilot
    'textarea[class*="GrowingTextArea" i]',          // Poe
    'textarea#search-input-textarea',                // you.com
    'textarea[name="message.text"]',                 // Mistral Le Chat
    'textarea#chat',                                 // Groq
    'textarea#chat-input',                           // DeepSeek
    'textarea[aria-label*="grok" i]',                // grok.com
  ]);

  // Blocked outright: never serialized, replaced by a same-size placeholder. Keeps
  // pixels out of the payload and keeps chunks small.
  const BLOCK_SELECTOR = 'img,video,canvas,object,embed';

  // rrweb EventType / IncrementalSource values used here. Kept as literals so
  // this file has no dependency on rrweb's enum export.
  const RRWEB_TYPE_FULL_SNAPSHOT = 2;
  const RRWEB_TYPE_INCREMENTAL_SNAPSHOT = 3;
  const RRWEB_SOURCE_FONT = 10;

  // ── Pure: the state machine ───────────────────────────────────────────────
  // Three states, no grace period. Recording stops the moment the tab is hidden,
  // unconditionally — an earlier design kept recording through an in-flight AI
  // reply and that was explicitly removed.
  //
  // PRECEDENCE: completion beats everything, then registration, then pause/resume,
  // then a cold start. If a completing condition and a pause condition are both
  // true in the same tick, the run COMPLETES.
  //
  // The caller applies ONE transition and calls again (the controller loops a few
  // times per tick), so "session rotated" resolves as complete → then start.
  //
  // Actions:
  //   none      nothing to do
  //   start     begin observing into the ring buffer; nothing registered/uploaded
  //   register  a session_id exists — POST /replays, then flush the buffer as seq 0
  //   pause     flush, fully stop the recorder, accrue time; run stays open
  //   resume    restart the recorder (which re-snapshots), same run and seq counter
  //   complete  flush, POST /complete, close the run
  //   discard   close a run that was never registered — nothing was ever stored,
  //             so there is nothing to complete and nothing to delete
  function nextReplayState(input) {
    const {
      state = STATES.IDLE,
      visible = true,
      recordable = false,
      enabled = true,
      sessionId = null,
      registered = false,
      runSessionId = null,
      remainingDailyMs = 0,
      runMs = 0,
      maxRunMs = CLIENT_POLICY_DEFAULTS.max_run_ms,
      chunkCount = 0,
      runBytes = 0,
      maxChunks = MAX_CHUNKS_PER_RUN,
      maxRunBytes = MAX_RUN_BYTES,
      stopRequest = null,
    } = input || {};

    const idle = (action, reason) => ({ state: STATES.IDLE, action, stop_reason: reason || null });
    const stay = (action) => ({ state, action, stop_reason: null });

    // A run that was never registered has no server row: closing it means
    // throwing the ring buffer away, not completing anything.
    const close = (reason) => idle(registered ? 'complete' : 'discard', reason);

    if (state !== STATES.IDLE) {
      // 1. explicit terminating triggers (pagehide, banner removed, user Stop,
      //    navigated away, register gave up)
      if (stopRequest) return close(String(stopRequest));
      // 2. policy / gate / caps
      if (!enabled) return close('policy_disabled');
      if (!recordable) return close('navigated_away');
      if (chunkCount >= maxChunks || runBytes >= maxRunBytes) return close('chunk_cap');
      if (remainingDailyMs <= 0) return close('daily_cap');
      if (runMs >= maxRunMs) return close('max_run_ms');
      // 3. the tab's engagement rotated — one run is scoped to one session_id.
      //    (A chat switch no longer does this: the session survives it. What does
      //    is a different AI service, an idle timeout or the 12h cap.)
      if (sessionId && runSessionId && sessionId !== runSessionId) return close('engagement_rotated');
    }

    // 4. lazy registration: recording started before any session existed
    if (state === STATES.RECORDING && !registered && sessionId) return stay('register');

    // 5. visibility
    if (state === STATES.RECORDING && !visible) return { state: STATES.PAUSED, action: 'pause', stop_reason: null };
    if (state === STATES.PAUSED && visible) return { state: STATES.RECORDING, action: 'resume', stop_reason: null };

    // 6. cold start
    if (state === STATES.IDLE) {
      if (visible && recordable && enabled && remainingDailyMs >= MIN_USEFUL_BUDGET_MS) {
        return { state: STATES.RECORDING, action: 'start', stop_reason: null };
      }
      return idle('none');
    }

    return stay('none');
  }

  // ── Pure-ish helpers ──────────────────────────────────────────────────────

  /**
   * Join the unmask selectors, dropping any the engine refuses to parse.
   * element.matches() THROWS on an invalid selector, and one bad entry in a
   * comma-joined list poisons the whole list — which would silently mask the
   * composer on every site. Validated once, at controller construction.
   */
  function usableSelector(list, doc) {
    const ok = [];
    for (const sel of list) {
      try {
        if (doc && typeof doc.querySelector === 'function') doc.querySelector(sel);
        ok.push(sel);
      } catch (e) { /* engine cannot parse it — drop it */ }
    }
    return ok.join(',');
  }

  /**
   * rrweb's maskInputFn. Called for every input rrweb decided to mask; the return
   * value is what lands in the event stream.
   *
   * Two ways to be recognised as the composer, in this order:
   *   1. the COMPOSER_MARK property content.js's attach() set on it — unforgeable by
   *      the page, only set for elements that passed the stricter isPromptInput()
   *      shape test (NOT for everything the broad DLP selector attached to), and the
   *      only signal that works on hosts the admin registry or the classifier added
   *      (which no hardcoded selector can know about)
   *   2. a match against the narrow site-specific fallback list, for the window
   *      before attach() has run
   *
   * Fails closed on every other path: no element, no signal, an unparseable selector,
   * a thrown matches(), or the 'mask_all' profile all return asterisks. type=password
   * is masked unconditionally, under every profile, mark or selector match or not.
   */
  function makeMaskInputFn(selector, maskProfile) {
    const unmaskComposer = maskProfile !== 'mask_all';
    return function maskInput(text, element) {
      const value = typeof text === 'string' ? text : '';
      const masked = '*'.repeat(value.length);
      if (!unmaskComposer) return masked;
      try {
        if (!element) return masked;
        const type = String(
          (element.getAttribute && element.getAttribute('type')) || element.type || '',
        ).toLowerCase();
        if (type === 'password') return masked;
        // 1. the isolated-world mark. Strict === true: a page cannot reach this
        //    property at all, but a truthy string from some future refactor should
        //    still not count as proof.
        if (element[COMPOSER_MARK] === true) return value;
        // 2. the pre-attach() fallback list.
        if (!selector || typeof element.matches !== 'function') return masked;
        return element.matches(selector) ? value : masked;
      } catch (e) {
        return masked;
      }
    };
  }

  /** The rrweb record() options. Pure, so a test can assert the masking profile. */
  function buildRecordOptions({ policy, emit, doc, selectorList = COMPOSER_UNMASK_SELECTORS }) {
    const selector = usableSelector(selectorList, doc);
    return {
      emit,
      // Masking — see the block comment above.
      maskAllInputs: true,
      maskInputFn: makeMaskInputFn(selector, policy.mask_profile),
      blockSelector: BLOCK_SELECTOR,
      // No pixels, no main-world injection. Fonts ARE collected (inlined as
      // data: URLs): without the real @font-face, replay substitutes a fallback
      // font with different character widths, which overflows/overlaps any
      // fixed-size text the original page laid out assuming the real metrics —
      // that's what made ChatGPT/Gemini's sidebar and composer text garbled in
      // early testing. Fonts are typefaces, not user data, so there is no
      // masking/privacy tradeoff here — only a size one, handled the same way
      // the full-snapshot fix handles it: see isFontEvent() below.
      recordCanvas: false,
      inlineImages: false,
      inlineStylesheet: true,
      collectFonts: true,
      slimDOMOptions: 'all',
      sampling: { mousemove: 50, scroll: 150, input: 'last', media: 800 },
      checkoutEveryNms: policy.checkout_every_ms,
      // rrweb must never break the host page. Swallow and keep going.
      errorHandler: () => true,
    };
  }

  /** Base64 for a Uint8Array, chunked so a big array cannot blow the arg limit. */
  function bytesToBase64(bytes) {
    const CH = 0x8000;
    let out = '';
    for (let i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoaImpl(out);
  }

  function btoaImpl(binary) {
    if (typeof btoa === 'function') return btoa(binary);
    // Node (tests) — Buffer is present, browsers always have btoa.
    return global.Buffer.from(binary, 'binary').toString('base64');
  }

  /** gzip a string → Uint8Array. CompressionStream exists in content scripts. */
  async function gzipString(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** sha256 hex of raw bytes, for the server's cheap integrity check. */
  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

  function sanitizePolicy(raw) {
    const out = { ...CLIENT_POLICY_DEFAULTS };
    if (raw && typeof raw === 'object') {
      // The worker already clamped these with lib/recording.js. This is only a
      // "did something absurd survive the wire" check, not a second policy engine.
      for (const key of ['chunk_flush_ms', 'chunk_max_bytes', 'max_run_ms', 'max_daily_ms', 'checkout_every_ms']) {
        const v = Number(raw[key]);
        if (Number.isFinite(v) && v > 0) out[key] = v;
      }
      if (raw.enabled === false) out.enabled = false;
      if (raw.mask_profile === 'mask_all' || raw.mask_profile === 'composer_visible') {
        out.mask_profile = raw.mask_profile;
      } else if (raw.mask_profile) {
        out.mask_profile = 'mask_all';          // unknown profile → mask everything
      }
    }
    return out;
  }

  // ── The controller ────────────────────────────────────────────────────────

  /**
   * Everything impure, with its collaborators injected so the tests can drive it.
   *
   * deps:
   *   rrweb        { record } — window.rrweb from vendor/rrweb-record.js
   *   send         (payload) => Promise<response>  — chrome.runtime.sendMessage
   *   getSessionId () => string|null  — the session this tab is in, as content.js
   *                  last heard it from the service worker (which owns it).
   *                  A cached read: synchronous, and MUST NOT MINT.
   *   visible      () => boolean
   *   showBanner   (replayId) => void
   *   hideBanner   () => void
   *   host         hostname string (never the path — the path carries the conv id)
   *   uuid         () => string
   *   now          () => ms
   *   doc          document (selector validation only)
   *   log/warn     console.info / console.warn
   *   compress     (string) => Promise<Uint8Array>
   *   digest       (Uint8Array) => Promise<hex>
   *   setTimer/clearTimer
   */
  function createReplayController(deps) {
    const d = {
      now: () => Date.now(),
      uuid: () => (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Math.random().toString(36).slice(2)),
      visible: () => true,
      showBanner: () => {},
      hideBanner: () => {},
      getSessionId: () => null,
      doc: typeof document !== 'undefined' ? document : null,
      log: (...a) => console.info('[cfai/replay]', ...a),
      warn: (...a) => console.warn('[cfai/replay]', ...a),
      compress: gzipString,
      digest: sha256Hex,
      setTimer: (fn, ms) => setInterval(fn, ms),
      clearTimer: (id) => clearInterval(id),
      host: '',
      send: async () => ({ ok: false, error: 'no transport' }),
      rrweb: null,
      selectorList: COMPOSER_UNMASK_SELECTORS,
      ...(deps || {}),
    };

    let state = STATES.IDLE;
    let policy = sanitizePolicy(null);
    // What the worker told us: is this host recordable, is replay enabled, how much
    // daily budget is left. Nothing starts until the first answer arrives —
    // fail-closed, because the host gate and the budget both live over there.
    let gate = { ready: false, recordable: false, enabled: false, remaining_daily_ms: 0 };
    let gateAt = 0;
    let run = null;
    let stopRequest = null;
    // The latch (see LATCHING_STOP_REASONS). `stoppedSessionId` is the engagement
    // that was current when the latch closed, so a rotation to a DIFFERENT session
    // can release it.
    let userStopped = false;
    let stoppedSessionId = null;
    let ticking = false;
    let flushChain = Promise.resolve();
    let timer = null;
    let disposed = false;
    let noRecorderWarned = false;

    function newRun() {
      return {
        replayId: null,
        registered: false,
        registerAttempts: 0,
        registerAt: 0,
        runSessionId: null,
        sessionIds: [],
        startedAt: new Date(d.now()).toISOString(),
        buffer: [],
        pendingBytes: 0,
        seq: 0,
        chunkCount: 0,
        droppedChunks: 0,
        // Events evicted from the re-buffer during an outage. Counted in
        // flushChunk's rollback path, so it has to START at 0 — it used to be
        // absent, which made every eviction `undefined + 1` = NaN and turned the
        // "dropped N oldest" warning into "dropped NaN oldest".
        droppedEvents: 0,
        // Consecutive refusals of the chunk currently at the head of the buffer.
        // Reset by any accepted upload.
        rejectStreak: 0,
        runBytes: 0,
        rawBytes: 0,
        eventCount: 0,
        activeSince: 0,
        runMs: 0,
        accruedMs: 0,
        lastFlushAt: d.now(),
        stopFn: null,
      };
    }

    const activeMs = () => (run && run.activeSince ? Math.max(0, d.now() - run.activeSince) : 0);
    const runMsNow = () => (run ? run.runMs + activeMs() : 0);
    const remainingMs = () => Math.max(0, gate.remaining_daily_ms - activeMs());

    function observeSession(id) {
      if (!run || typeof id !== 'string') return;
      const s = id.trim();
      if (s && !run.sessionIds.includes(s)) run.sessionIds.push(s);
    }

    /** The cached session id, or null. Never throws — it is a dep, not our code. */
    function sessionIdNow() {
      try {
        const id = d.getSessionId();
        return typeof id === 'string' && id.trim() ? id.trim() : null;
      } catch (e) {
        return null;
      }
    }

    /**
     * Release the latch once the engagement has rotated to a different session than
     * the one that was current when the user (or the fail-closed banner path) stopped
     * recording. Same rule as nextReplayState's 'engagement_rotated': a new session id
     * is a new engagement, and stopping is scoped to an engagement, not to the tab
     * for all time.
     */
    function releaseLatchOnRotation(sid) {
      if (!userStopped) return;
      if (!sid || sid === stoppedSessionId) return;
      userStopped = false;
      stoppedSessionId = null;
      d.log('engagement rotated after a stop — recording may start again');
    }

    // ── policy / gate ───────────────────────────────────────────────────────
    // One RPC answers three questions the content script cannot answer itself:
    // the host allowlist (lib/recording.js lives in the worker), the server policy
    // (a content-script fetch would hit the page's CSP and has no JWT), and the
    // daily ledger (chrome.storage is the worker's).
    async function refreshGate(force) {
      if (!force && gate.ready && d.now() - gateAt < POLICY_POLL_MS) return;
      try {
        const resp = await d.send({ __cfai_kind: 'replayPolicy', host: d.host });
        if (resp && resp.ok) {
          policy = sanitizePolicy(resp.policy);
          gate = {
            ready: true,
            recordable: !!resp.recordable,
            enabled: !!resp.enabled && policy.enabled,
            remaining_daily_ms: Number.isFinite(resp.remaining_daily_ms) ? resp.remaining_daily_ms : 0,
          };
          gateAt = d.now();
        } else if (!gate.ready) {
          // Never answered → stay closed. Not recording is the safe state.
          gateAt = d.now();
        }
      } catch (e) {
        if (!gate.ready) gateAt = d.now();
      }
    }

    // ── rrweb attach / detach ───────────────────────────────────────────────

    function attachRecorder() {
      const record = d.rrweb && d.rrweb.record;
      if (typeof record !== 'function') {
        if (!noRecorderWarned) {
          noRecorderWarned = true;
          d.warn('rrweb recorder not present (vendor/rrweb-record.js did not load) — replay disabled on this page');
        }
        return false;
      }
      const opts = buildRecordOptions({ policy, emit: onEvent, doc: d.doc, selectorList: d.selectorList });
      try {
        run.stopFn = record(opts) || null;
      } catch (e) {
        d.warn('rrweb record() failed:', e && e.message ? e.message : e);
        return false;
      }
      run.activeSince = d.now();
      run.lastFlushAt = d.now();
      return true;
    }

    function detachRecorder() {
      if (!run) return;
      if (typeof run.stopFn === 'function') {
        try { run.stopFn(); } catch (e) { /* already stopped */ }
      }
      run.stopFn = null;
      run.runMs += activeMs();
      run.activeSince = 0;
    }

    // ── THE RING BUFFER ────────────────────────────────────────────────────
    // Recording starts on page load, BEFORE any session_id exists. Until one does,
    // events go into a buffer that is truncated back to the most recent full
    // snapshot on every rrweb checkout, and nothing is registered or uploaded. A
    // user who looked at the page and never typed a prompt leaves with the buffer
    // discarded — nothing about them is ever stored. That is the same rule the rest
    // of this codebase already enforces: asking about a session must never create
    // one.
    function onEvent(event, isCheckout) {
      if (!run) return;
      if (isCheckout && !run.registered) {
        run.buffer.length = 0;
        run.pendingBytes = 0;
      }
      run.buffer.push(event);
      let size = 0;
      try { size = JSON.stringify(event).length; } catch (e) { size = 256; }
      run.pendingBytes += size;

      if (!run.registered) {
        // Bound the un-registered buffer by forcing a fresh checkout, which the
        // branch above then truncates to. Cheaper and more correct than dropping
        // events from the middle, which would make the buffer unreplayable.
        if (run.pendingBytes > RING_MAX_BYTES) forceCheckout();
        return;
      }
      // A FULL SNAPSHOT GOES UP ON ITS OWN, IMMEDIATELY. It is the one event the
      // recording cannot be watched without — everything after it is a mutation
      // applied to it — and it is also by far the biggest. Waiting for the normal
      // chunk_max_bytes / chunk_flush_ms triggers lets incremental events pile on
      // top of it first, so the chunk carrying it is bigger than it had to be, and
      // every failed retry lets it grow again. Flushing here bounds the snapshot
      // chunk to (whatever accumulated since the last flush) + the snapshot itself,
      // which is what keeps it under the server's size allowance.
      if (isFullSnapshot(event)) { queueFlush('snapshot'); return; }
      // Font events are far smaller than a full snapshot, but the same "flush
      // it alone before anything piles on top" logic applies for the same
      // reason: a font stuck in a chunk that keeps getting refused is a font
      // that keeps getting re-evicted, and a replay missing its font is
      // exactly the garbled-text bug this exists to fix.
      if (isFontEvent(event)) { queueFlush('font'); return; }
      if (run.pendingBytes >= policy.chunk_max_bytes) queueFlush('bytes');
    }

    function isFullSnapshot(event) {
      return !!event && event.type === RRWEB_TYPE_FULL_SNAPSHOT;
    }

    function isFontEvent(event) {
      return !!event && event.type === RRWEB_TYPE_INCREMENTAL_SNAPSHOT
        && !!event.data && event.data.source === RRWEB_SOURCE_FONT;
    }

    function forceCheckout() {
      try {
        const record = d.rrweb && d.rrweb.record;
        if (record && typeof record.takeFullSnapshot === 'function') record.takeFullSnapshot(true);
        else { run.buffer.length = 0; run.pendingBytes = 0; }
      } catch (e) {
        run.buffer.length = 0;
        run.pendingBytes = 0;
      }
    }

    // ── chunk upload ───────────────────────────────────────────────────────
    // Serialized through one promise chain: seq must arrive in order, and
    // completeRun() has to be able to wait for the last chunk before it reports
    // chunk_count.
    function queueFlush(reason) {
      flushChain = flushChain
        .then(() => flushChunk(reason))
        .catch((e) => d.warn('chunk flush failed:', e && e.message ? e.message : e));
      return flushChain;
    }

    async function flushChunk(reason) {
      if (!run || !run.registered || run.buffer.length === 0) return;
      if (run.chunkCount >= MAX_CHUNKS_PER_RUN) { stopRequest = 'chunk_cap'; return; }

      const events = run.buffer;
      const rawBytes = run.pendingBytes;
      run.buffer = [];
      run.pendingBytes = 0;
      run.lastFlushAt = d.now();
      const seq = run.seq;

      // ONE failure path for the WHOLE build-and-send sequence. The buffer is already
      // drained at this point, so anything that throws between here and an accepted
      // response loses those events unless it rolls back — and stringify (a RangeError
      // on a huge snapshot), compress, digest (crypto.subtle is absent on a
      // non-secure origin) and send can all throw. Only send used to be guarded, so
      // the other three escaped to queueFlush()'s .catch(), which logged "chunk flush
      // failed" and dropped the events with no rollback, no droppedEvents and no
      // contribution to the rejectStreak — a chronically failing run never aborted, it
      // just silently lost everything, forever.
      let json = null;
      let gz = null;
      let failure = null;
      try {
        json = JSON.stringify(events);
        gz = await d.compress(json);
        const sha = await d.digest(gz);
        const payload = {
          __cfai_kind: 'replayChunk',
          replay_id: run.replayId,
          seq,
          encoding: 'gzip',
          chunk_b64: bytesToBase64(gz),
          event_count: events.length,
          first_ts: firstTs(events),
          last_ts: lastTs(events),
          has_full_snapshot: events.some(isFullSnapshot),
          has_font_event: events.some(isFontEvent),
          sha256: sha,
          byte_size: gz.length,
        };
        const resp = await d.send(payload);
        if (!resp || !resp.ok) failure = 'not accepted by the worker';
      } catch (e) {
        failure = `could not be built or sent (${(e && e.message) ? e.message : e})`;
      }

      if (failure) {
        // The run can be closed under us while the awaits above are in flight; there
        // is then nothing left to roll back into.
        if (!run) return;
        // Roll back so no seq is burned and the replay has no hole. Bounded: a
        // long outage drops the OLDEST events and says so.
        run.buffer = events.concat(run.buffer);
        run.pendingBytes += rawBytes;
        let evicted = 0;
        // EVICTION ORDER: OLDEST FIRST, BUT NEVER A FULL SNAPSHOT OR A FONT.
        //
        // This used to be a plain shift() off the front, which is exactly backwards
        // for the one event that matters: the full snapshot is always the OLDEST
        // thing in the buffer (rrweb emits it first, and again on every checkout),
        // so it was always the first thing thrown away. On a real site the refused
        // chunk IS the snapshot chunk, each retry cycle piles more incremental
        // events on top of it, the re-buffer goes over its ceiling, and the snapshot
        // is evicted to make room — leaving a run that uploads successfully and
        // replays as a blank page with a moving cursor. That was the live-test
        // finding, and it is worse than an outright failure because it looks fine.
        // Font events get the same protection for the same reason: evicting one
        // doesn't blank the page, but it silently reproduces the garbled-text bug
        // collectFonts was turned on specifically to fix.
        //
        // So: evict the oldest event that is neither, each pass. If nothing but
        // snapshots/fonts is left, evict nothing and let the buffer stay over its
        // ceiling — the rejectStreak below then ends the run honestly with
        // 'chunk_rejected'. A recording with no snapshot is not a recording, so
        // refusing to make one is the correct ending, not a softer failure mode.
        while (run.pendingBytes > REBUFFER_MAX_BYTES && run.buffer.length > 1) {
          const idx = run.buffer.findIndex((e) => !isFullSnapshot(e) && !isFontEvent(e));
          if (idx < 0) break;
          const gone = run.buffer.splice(idx, 1)[0];
          let s = 0;
          try { s = JSON.stringify(gone).length; } catch (e) { s = 256; }
          run.pendingBytes = Math.max(0, run.pendingBytes - s);
          run.droppedEvents += 1;
          evicted += 1;
        }
        run.rejectStreak += 1;
        d.warn(`chunk ${seq} ${failure} — ${events.length} event(s) re-buffered`,
               `(${kb(run.pendingBytes)} pending${evicted ? `, dropped ${evicted} oldest` : ''},`,
               `refusal ${run.rejectStreak}/${MAX_CHUNK_REJECTIONS})`);
        if (run.rejectStreak >= MAX_CHUNK_REJECTIONS) {
          // Not a transient outage: the server is refusing this chunk on its
          // merits. End the run rather than spin.
          d.warn(`chunk ${seq} refused ${run.rejectStreak} times in a row — ending the run`,
                 '(stop_reason=chunk_rejected) instead of retrying forever');
          stopRequest = 'chunk_rejected';
        }
        return;
      }

      run.rejectStreak = 0;
      run.seq += 1;
      run.chunkCount += 1;
      run.eventCount += events.length;
      run.runBytes += gz.length;
      run.rawBytes += json.length;

      // DATA-VOLUME LOG. Deliberately verbose and parseable: the first live test on
      // a real AI site is also the measurement of how much a replay actually costs.
      d.log(
        `chunk ${seq} — ${events.length} events, ${kb(gz.length)} gz (${kb(json.length)} raw,` +
        ` x${(json.length / Math.max(1, gz.length)).toFixed(1)}), reason=${reason} |` +
        ` run total: ${run.chunkCount} chunks, ${kb(run.runBytes)} gz, ${run.eventCount} events,` +
        ` ${Math.round(runMsNow() / 1000)}s observed`,
      );

      if (run.runBytes >= MAX_RUN_BYTES || run.chunkCount >= MAX_CHUNKS_PER_RUN) {
        stopRequest = 'chunk_cap';
      }
    }

    function firstTs(events) {
      for (const e of events) if (e && Number.isFinite(e.timestamp)) return e.timestamp;
      return null;
    }
    function lastTs(events) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e && Number.isFinite(e.timestamp)) return e.timestamp;
      }
      return null;
    }

    // ── daily ledger ───────────────────────────────────────────────────────
    // The worker is the ledger's ONLY writer (single-writer promise chain over
    // chrome.storage), so this reports a delta and subtracts it from the local
    // budget view so the cap still bites before the next poll.
    function reportAccrual() {
      if (!run) return;
      const delta = Math.round(run.runMs - run.accruedMs);
      if (delta <= 0) return;
      run.accruedMs = run.runMs;
      gate.remaining_daily_ms = Math.max(0, gate.remaining_daily_ms - delta);
      Promise.resolve(d.send({ __cfai_kind: 'replayDailyAccrued', ms: delta })).catch(() => {});
    }

    // ── actions ────────────────────────────────────────────────────────────

    async function doStart() {
      // Belt and braces with tick()'s latch check: nothing may re-arm the recorder
      // or put the banner back up while a stop is latched.
      if (userStopped) return false;
      run = newRun();
      if (!attachRecorder()) { run = null; gate.recordable = false; return false; }
      // showBanner is called from this exact point (recording start), not
      // deferred to registration — that ordering is unchanged so a future
      // deployment that DOES want a visible indicator gets one from the first
      // instant of observation. In THIS deployment d.showBanner is a no-op
      // (content.js's session-replay bootstrap, deliberately): recording is
      // governed under a policy employees are notified of outside this UI, and
      // there is intentionally no in-page indicator or stop control.
      d.showBanner(null);
      d.log(`observing ${d.host} — no session yet, buffering to the last full snapshot`,
            `(flush ${policy.chunk_flush_ms}ms, snapshot ${policy.checkout_every_ms}ms,`,
            `mask ${policy.mask_profile}, ${RECORDER_ID})`);
      return true;
    }

    async function doRegister() {
      const sid = d.getSessionId();
      if (!run || !sid) return;
      if (run.registerAt && d.now() - run.registerAt < REGISTER_RETRY_MS) return;
      run.registerAt = d.now();
      run.registerAttempts += 1;

      const replayId = d.uuid();
      let resp = null;
      try {
        resp = await d.send({
          __cfai_kind: 'replayRegister',
          replay_id: replayId,
          session_id: sid,
          tab_host: d.host,
          started_at: run.startedAt,
          recorder: RECORDER_ID,
          mask_profile: policy.mask_profile,
          capture: 'dom_events',
        });
      } catch (e) { resp = null; }

      if (!resp || !resp.ok) {
        d.warn(`could not register replay run (attempt ${run.registerAttempts}/${REGISTER_MAX_ATTEMPTS}):`,
               (resp && resp.error) || 'no response');
        if (run.registerAttempts >= REGISTER_MAX_ATTEMPTS) stopRequest = 'register_failed';
        return;
      }

      run.replayId = replayId;
      run.runSessionId = sid;
      run.registered = true;
      observeSession(sid);
      d.showBanner(replayId);
      d.log(`run ${replayId} registered for session ${sid}`);
      // seq 0 begins at the ring buffer's full snapshot, so it is independently
      // replayable on its own.
      await queueFlush('register');
    }

    async function doPause() {
      if (!run) return;
      detachRecorder();
      await flushChain;
      await queueFlush('pause');
      await flushChain;
      reportAccrual();
      d.log(`paused (tab hidden) — recorder stopped, run ${run.replayId || '(unregistered)'} stays open;`,
            `${run.chunkCount} chunks / ${kb(run.runBytes)} gz so far`);
    }

    async function doResume() {
      if (!run) return;
      if (!attachRecorder()) { stopRequest = 'recorder_unavailable'; return; }
      d.showBanner(run.replayId);
      d.log(`resumed — new full snapshot, continuing at seq ${run.seq}`);
    }

    async function doComplete(reason) {
      const r = run;
      if (!r) return;
      detachRecorder();
      await flushChain;
      await queueFlush('complete');
      await flushChain;
      reportAccrual();
      const summary = {
        __cfai_kind: 'replayComplete',
        replay_id: r.replayId,
        stop_reason: reason || 'requested',
        chunk_count: r.chunkCount,
        event_count: r.eventCount,
        session_ids: [...r.sessionIds],
        ended_at: new Date(d.now()).toISOString(),
        duration_ms: Math.round(r.runMs),
      };
      run = null;
      d.hideBanner();
      try { await d.send(summary); } catch (e) { d.warn('complete failed:', e && e.message ? e.message : e); }
      d.log(`run ${summary.replay_id} complete — reason=${summary.stop_reason},`,
            `${summary.chunk_count} chunks, ${kb(r.runBytes)} gz total,`,
            `${summary.event_count} events, ${Math.round(summary.duration_ms / 1000)}s observed`);
    }

    async function doDiscard(reason) {
      const r = run;
      if (!r) return;
      detachRecorder();
      reportAccrual();
      run = null;
      d.hideBanner();
      d.log(`discarded an unregistered run (reason=${reason || 'requested'}) —`,
            'no session was ever minted, so nothing was uploaded and nothing is stored');
    }

    async function applyAction(t) {
      switch (t.action) {
        case 'start':    return doStart();
        case 'register': return doRegister();
        case 'pause':    return doPause();
        case 'resume':   return doResume();
        case 'complete': return doComplete(t.stop_reason);
        case 'discard':  return doDiscard(t.stop_reason);
        default:         return undefined;
      }
    }

    // ── the tick ───────────────────────────────────────────────────────────

    async function tick(trigger) {
      if (disposed) return state;
      if (ticking) return state;
      ticking = true;
      // The reason taken out of `stopRequest` on the CURRENT iteration, so the catch
      // below can put it back. A stop must not be lost because something unrelated
      // threw while it was being applied — the failure mode of a dropped stop is a
      // recorder that keeps observing the page after the user pressed Stop.
      let inFlightStop = null;
      try {
        await refreshGate(false);
        for (let i = 0; i < 4; i++) {
          const sid = sessionIdNow();
          releaseLatchOnRotation(sid);
          // READ AND CLEAR, every iteration. It used to be cleared only on i===0,
          // but the actions applied inside this loop SET it too (doRegister on
          // register_failed, doResume on recorder_unavailable, flushChunk on
          // chunk_cap / chunk_rejected). One set on iteration >= 1 then survived the
          // whole tick and terminated the NEXT run as well.
          const req = stopRequest;
          stopRequest = null;
          inFlightStop = req;
          const t = nextReplayState({
            state,
            visible: !!d.visible(),
            recordable: gate.ready && gate.recordable,
            enabled: gate.ready && gate.enabled,
            sessionId: sid,
            registered: !!(run && run.registered),
            runSessionId: run ? run.runSessionId : null,
            remainingDailyMs: remainingMs(),
            runMs: runMsNow(),
            maxRunMs: policy.max_run_ms,
            chunkCount: run ? run.chunkCount : 0,
            runBytes: run ? run.runBytes : 0,
            stopRequest: req,
          });
          // THE LATCH. Deliberately here and not inside nextReplayState: that
          // function is pure, exhaustively tested and its PRECEDENCE contract is
          // relied on elsewhere. Swallowing just the cold start keeps the state
          // machine untouched — the state stays IDLE, doStart never runs, and no
          // banner goes back up.
          if (userStopped && t.action === 'start') break;
          state = t.state;
          if (t.action === 'none') break;
          await applyAction(t);
          inFlightStop = null;
        }
        // Time-based flush. Byte-based flushes fire from onEvent().
        if (state === STATES.RECORDING && run && run.registered &&
            d.now() - run.lastFlushAt >= policy.chunk_flush_ms) {
          queueFlush('interval');
        }
      } catch (e) {
        // tick() is called from the interval AND from four places in content.js,
        // none of which can catch an async rejection (a sync try/catch around a
        // call to an async function never sees one). So it catches its own: an
        // exception here used to become an unhandled rejection at five call sites,
        // and — worst case — one thrown by the very first tick('init') left the
        // controller with no timer, silently dead for the life of the page.
        d.warn(`tick(${trigger || 'unknown'}) failed:`, e && e.message ? e.message : e);
        if (inFlightStop && !stopRequest) stopRequest = inFlightStop;
      } finally {
        ticking = false;
      }
      return state;
    }

    return {
      // ---- lifecycle ----
      async init() {
        if (disposed) return;
        await refreshGate(true);
        if (!gate.recordable) {
          d.log(`not a recordable AI surface (${d.host}) — replay stays off`);
          // Still tick: an admin can add this host to the registry while the tab
          // is open, and the poll picks that up.
        }
        // The first tick must NEVER be able to skip arming the timer. tick() catches
        // its own failures now, so this is the second belt: a recorder with no timer
        // is dead for the whole life of the page, with `_replayController` still
        // non-null so nothing else notices.
        try {
          await tick('init');
        } catch (e) {
          d.warn('the first tick failed — arming the timer anyway:', e && e.message ? e.message : e);
        }
        if (disposed) return;
        timer = d.setTimer(() => { tick('timer'); }, TICK_MS);
      },
      /** document.visibilitychange — pause/resume happen on the very next tick. */
      onVisibilityChange() { return tick('visibility'); },
      /**
       * pagehide (NOT beforeunload — bfcache-safe). Best effort by nature: the
       * document is going away and gzip + sendMessage are async. Not awaited by
       * anything; the worker persists whatever lands.
       */
      onPageHide() {
        stopRequest = 'pagehide';
        return tick('pagehide');
      },
      /**
       * Banner Stop button, and the fail-closed banner-removed path.
       *
       * The default is 'user_stopped', NOT 'user_stop': the server's
       * CLEAN_STOP_REASONS set (server/src/routes/replays.js) contains the former
       * and not the latter, and a reason outside that set is filed as an ABORT. A
       * user deliberately clicking Stop is the cleanest ending a run has, and it
       * must not show up in the console as a failed recording.
       *
       * A LATCHING reason (see LATCHING_STOP_REASONS) also closes the latch, so this
       * really stops recording instead of ending one run and opening the next one a
       * tick later.
       */
      stop(reason) {
        const r = reason || 'user_stopped';
        if (LATCHING_STOP_REASONS.includes(r)) {
          userStopped = true;
          stoppedSessionId = sessionIdNow();
        }
        stopRequest = r;
        return tick('stop');
      },
      dispose() {
        disposed = true;
        if (timer !== null) { try { d.clearTimer(timer); } catch (e) {} timer = null; }
        detachRecorder();
        run = null;
        state = STATES.IDLE;
      },
      // ---- introspection (tests + console debugging; no event contents) ----
      tick,
      get state() { return state; },
      get policy() { return { ...policy }; },
      get gate() { return { ...gate }; },
      /** True while a latching stop is holding recording off for this engagement. */
      get stopped() { return userStopped; },
      stats() {
        if (!run) return null;
        return {
          replay_id: run.replayId,
          registered: run.registered,
          session_id: run.runSessionId,
          seq: run.seq,
          chunks: run.chunkCount,
          events: run.eventCount,
          gzip_bytes: run.runBytes,
          raw_bytes: run.rawBytes,
          buffered_events: run.buffer.length,
          buffered_bytes: run.pendingBytes,
          // How many of those buffered events are full snapshots. A COUNT, like
          // everything else here — never an event, never any content. It exists so
          // "the snapshot survived the eviction" is directly assertable instead of
          // being inferred from byte totals.
          buffered_snapshots: run.buffer.reduce((n, e) => n + (isFullSnapshot(e) ? 1 : 0), 0),
          buffered_fonts: run.buffer.reduce((n, e) => n + (isFontEvent(e) ? 1 : 0), 0),
          dropped_events: run.droppedEvents,
          reject_streak: run.rejectStreak,
          observed_ms: Math.round(runMsNow()),
        };
      },
    };
  }

  global.__cfaiReplay = {
    RRWEB_VERSION,
    RECORDER_ID,
    STATES,
    CLIENT_POLICY_DEFAULTS,
    COMPOSER_UNMASK_SELECTORS,
    COMPOSER_MARK,
    LATCHING_STOP_REASONS,
    BLOCK_SELECTOR,
    MAX_CHUNKS_PER_RUN,
    MAX_RUN_BYTES,
    MIN_USEFUL_BUDGET_MS,
    RING_MAX_BYTES,
    nextReplayState,
    usableSelector,
    makeMaskInputFn,
    buildRecordOptions,
    sanitizePolicy,
    bytesToBase64,
    gzipString,
    sha256Hex,
    createReplayController,
  };
})(typeof window !== 'undefined' ? window : globalThis);
