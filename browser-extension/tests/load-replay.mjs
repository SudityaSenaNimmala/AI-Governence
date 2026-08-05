// Loads the REAL session-replay recorder (content/replay.js) into Node so the
// tests exercise shipped code instead of a reimplementation.
//
// Same technique as load-patterns.mjs: replay.js is a plain (non-module) IIFE that
// publishes onto `window`, so we evaluate it with a stub window and hand it the
// handful of browser globals it names. That is deliberate on replay.js's side —
// every impure collaborator of createReplayController() is injected, so the WHOLE
// pipeline (state machine → ring buffer → chunking → gzip → sha256 →
// register/chunk/complete) is drivable here with no browser and no rrweb.
//
// The globals it touches: crypto (Node 20+ has it), CompressionStream / Blob /
// Response (gzipString), btoa (bytesToBase64), console, setInterval/clearInterval
// and document (selector validation only). Everything else arrives through deps.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(here, '..', 'content', 'replay.js');
const src = readFileSync(SRC_PATH, 'utf8');

/** The raw source, for tests that assert on constants declared in it. */
export function replaySource() {
  return src;
}

/** Evaluate content/replay.js and hand back window.__cfaiReplay. */
export function loadReplay() {
  const win = { Buffer };
  const noopInterval = () => 0;
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'window', 'document', 'crypto', 'console', 'setInterval', 'clearInterval',
    'btoa', 'Blob', 'CompressionStream', 'Response',
    src,
  );
  run(
    win,
    makeFakeDoc(),
    globalThis.crypto,
    { info() {}, warn() {}, log() {} },
    noopInterval,
    () => {},
    globalThis.btoa,
    globalThis.Blob,
    globalThis.CompressionStream,
    globalThis.Response,
  );
  if (!win.__cfaiReplay) throw new Error('replay.js did not publish window.__cfaiReplay');
  return win.__cfaiReplay;
}

/**
 * A document stand-in for usableSelector(): only querySelector is used, and only
 * to find out whether the engine can PARSE a selector. `invalid` entries throw the
 * way a real engine throws on a malformed selector.
 */
export function makeFakeDoc({ invalid = [] } = {}) {
  return {
    querySelector(sel) {
      if (invalid.includes(sel)) throw new SyntaxError(`'${sel}' is not a valid selector`);
      return null;
    },
  };
}

/**
 * An <input>/<textarea> stand-in for maskInputFn.
 *   type            reported by both getAttribute('type') and .type
 *   attached        the element carries content.js attach()'s NARROW isolated-world
 *                   mark (replay.js's COMPOSER_MARK) — the PRIMARY unmask signal
 *   dlpAttached     the element carries only the BROAD DLP mark (DLP_BROAD_MARK,
 *                   `__cfaiAttached`) — "the scanner is watching this", which is NOT
 *                   permission to record it in cleartext. Every element the narrow
 *                   mark is on also has this one; the reverse is the interesting case.
 *   attrs           extra attributes getAttribute() reports. Used to prove that an
 *                   ATTRIBUTE a hostile page can set never unmasks anything.
 *   matchSelectors  the individual selectors this element claims to match (the fn
 *                   hands matches() the whole comma-joined list, so this splits it)
 *   throwOnMatches  matches() throws, which must fail closed
 */
export function makeFakeInput({
  type = 'text',
  attached = false,
  dlpAttached = false,
  attrs = {},
  matchSelectors = [],
  throwOnMatches = false,
} = {}) {
  const el = {
    type,
    getAttribute(name) {
      if (name === 'type') return type;
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    matches(selector) {
      if (throwOnMatches) throw new Error('matches() blew up');
      return String(selector).split(',').map((s) => s.trim()).some((s) => matchSelectors.includes(s));
    },
  };
  // Set through the shipped constant, not a copy of the string, so a rename in
  // replay.js cannot leave these tests silently asserting nothing.
  if (attached) el[composerMark()] = true;
  // The narrow mark implies the broad one in real life (attach() sets both), so a
  // narrow-marked fake carries both unless the test asked for the broad one alone.
  if (attached || dlpAttached) el[DLP_BROAD_MARK] = true;
  return el;
}

let _composerMark = null;
/** replay.js's COMPOSER_MARK — the property name content.js's attach() sets. */
export function composerMark() {
  if (_composerMark === null) _composerMark = loadReplay().COMPOSER_MARK;
  return _composerMark;
}

/**
 * content.js's BROAD mark — "the DLP layer is watching this element", set on every
 * hit of findPromptInputs()'s wide selector. replay.js must NOT treat it as an unmask
 * signal. Not exported from replay.js (that file has no reason to know the name), so
 * it is pinned against content.js's source in tests/replay.test.mjs instead.
 */
export const DLP_BROAD_MARK = '__cfaiAttached';

/** Deterministic stand-ins for the browser's CompressionStream / crypto.subtle. */
export async function gzip(str) { return new Uint8Array(zlib.gzipSync(Buffer.from(str, 'utf8'))); }
export async function sha256(bytes) { return createHash('sha256').update(Buffer.from(bytes)).digest('hex'); }

/** Let every pending microtask + timer-0 continuation settle. */
export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * A fully-instrumented controller, with every collaborator faked.
 *
 * The fake rrweb records the options it was handed and exposes emit(), so a test
 * plays the part of the browser: "here is a full snapshot", "here are 40 mouse
 * moves". compress/digest are real (node zlib + node crypto) so the bytes on the
 * wire are real bytes — only the transport and the clock are fake.
 *
 * options:
 *   policy        what the worker's replayPolicy RPC answers with
 *   recordable / enabled / remainingDailyMs   the rest of that answer
 *   responses     { [__cfai_kind]: value | (payload) => value } — a value, or a
 *                 function, or `null` to simulate no answer at all
 *   sessionId     what getSessionId() returns (settable via setSessionId)
 *   visible       initial tab visibility (settable via setVisible)
 *   now           starting fake clock
 *
 * Returns { ctl, sends, kinds, ... } plus controls:
 *   emit(event, isCheckout)   feed an event through rrweb's emit callback
 *   snapshot()                feed a type-2 full-snapshot checkout event
 *   noise(n, bytes)           feed n filler events of roughly `bytes` each
 *   advance(ms)               move the fake clock
 *   fireTimer()               run the controller's TICK_MS interval callback
 *   banners                   every showBanner/hideBanner call, in order
 */
export function makeReplayHarness({
  policy = {},
  recordable = true,
  enabled = true,
  remainingDailyMs = 4 * 60 * 60 * 1000,
  responses = {},
  sessionId = null,
  visible = true,
  now = 1_700_000_000_000,
  host = 'chatgpt.com',
  invalidSelectors = [],
  rrwebPresent = true,
  // Overridable so a test can make the BUILD half of a flush fail the way a browser
  // really can: crypto.subtle is undefined on a non-secure origin (digest), and
  // JSON.stringify throws a RangeError on a big enough snapshot.
  compress = gzip,
  digest = sha256,
  // Spread over the deps LAST, so a test can replace any single collaborator —
  // including with one that throws, which is how "tick() must never reject" is proved.
  extraDeps = {},
} = {}) {
  const api = loadReplay();

  const sends = [];
  const banners = [];
  const logs = { info: [], warn: [] };
  let clock = now;
  let currentSession = sessionId;
  let currentVisible = visible;
  let uuidN = 0;

  const gate = { recordable, enabled, remainingDailyMs };

  const defaultResponses = {
    replayPolicy: () => ({
      ok: true,
      recordable: gate.recordable,
      enabled: gate.enabled,
      remaining_daily_ms: gate.remainingDailyMs,
      policy,
    }),
    replayRegister: { ok: true },
    replayChunk: { ok: true },
    replayComplete: { ok: true },
    replayDailyAccrued: { ok: true },
  };

  async function send(payload) {
    sends.push(payload);
    const kind = payload && payload.__cfai_kind;
    const answer = Object.prototype.hasOwnProperty.call(responses, kind)
      ? responses[kind]
      : defaultResponses[kind];
    const value = typeof answer === 'function' ? answer(payload) : answer;
    if (value === undefined) return { ok: false, error: 'unhandled kind ' + kind };
    return value;
  }

  // --- the fake rrweb ---
  let recordOptions = null;
  let emitFn = null;
  let stopCalls = 0;
  let recordCalls = 0;
  const record = (opts) => {
    recordCalls += 1;
    recordOptions = opts;
    emitFn = opts.emit;
    return () => { stopCalls += 1; };
  };
  record.takeFullSnapshot = () => { emitFn && emitFn(fullSnapshotEvent(clock), true); };
  const rrweb = rrwebPresent ? { record } : {};

  let timerFn = null;
  const ctl = api.createReplayController({
    rrweb,
    send,
    host,
    doc: makeFakeDoc({ invalid: invalidSelectors }),
    getSessionId: () => currentSession,
    visible: () => currentVisible,
    showBanner: (id) => banners.push({ show: id === undefined ? null : id }),
    hideBanner: () => banners.push({ hide: true }),
    now: () => clock,
    uuid: () => `replay-uuid-${++uuidN}`,
    compress,
    digest,
    log: (...a) => logs.info.push(a.join(' ')),
    warn: (...a) => logs.warn.push(a.join(' ')),
    setTimer: (fn) => { timerFn = fn; return 1; },
    clearTimer: () => { timerFn = null; },
    ...extraDeps,
  });

  function fullSnapshotEvent(ts) {
    return { type: 2, timestamp: ts, data: { node: { id: 1 } } };
  }
  function fontEvent(ts, fontFace = 'x'.repeat(2000)) {
    // IncrementalSnapshot (type 3), IncrementalSource.Font (source 10).
    return { type: 3, timestamp: ts, data: { source: 10, fontFace, fontSource: 'data:font/woff2;base64,' + fontFace } };
  }

  return {
    api,
    ctl,
    sends,
    banners,
    logs,
    gate,
    /** Just the __cfai_kind sequence — the assertion most tests actually want. */
    get kinds() { return sends.map((s) => s && s.__cfai_kind); },
    sentOf(kind) { return sends.filter((s) => s && s.__cfai_kind === kind); },
    recordOptions() { return recordOptions; },
    recordCalls() { return recordCalls; },
    stopCalls() { return stopCalls; },
    hasEmit() { return typeof emitFn === 'function'; },
    emit(event, isCheckout = false) { if (emitFn) emitFn(event, isCheckout); },
    snapshot() { if (emitFn) emitFn(fullSnapshotEvent(clock), true); },
    font(bytes = 2000) { if (emitFn) emitFn(fontEvent(clock, 'x'.repeat(Math.max(1, bytes))), false); },
    noise(n = 1, bytes = 200) {
      const filler = 'x'.repeat(Math.max(1, bytes));
      for (let i = 0; i < n; i++) {
        if (emitFn) emitFn({ type: 3, timestamp: clock + i, data: { source: 1, filler } }, false);
      }
    },
    advance(ms) { clock += ms; return clock; },
    nowValue() { return clock; },
    setSessionId(id) { currentSession = id; },
    setVisible(v) { currentVisible = v; },
    fireTimer() { return timerFn ? timerFn() : undefined; },
    hasTimer() { return typeof timerFn === 'function'; },
    settle,
  };
}
