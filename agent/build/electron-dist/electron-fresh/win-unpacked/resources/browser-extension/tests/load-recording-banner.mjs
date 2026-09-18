// Loads the REAL recording-indicator region out of content/content.js so the
// "no in-page indicator, no in-page stop control" decision is pinned against
// shipped code rather than a reimplementation.
//
// WHAT THIS REGION IS NOW. It used to paint a fixed banner ("This tab is being
// recorded for AI governance") with a Stop recording button, plus a fail-closed
// watcher that stopped the recorder if the host page pruned that banner. All of
// that was REMOVED ON PURPOSE: this deployment governs employee AI usage under a
// policy employees are notified of through other channels (handbook / IT policy /
// onboarding), not through page chrome. showRecordingBanner / hideRecordingBanner
// survive only as no-ops, because the replay controller's dependency-injection
// contract (`d.showBanner` / `d.hideBanner`, see the bootstrap region and
// content/replay.js) calls them at run start / registration / pause / resume /
// complete and expects them to exist and be safely callable.
//
// So the harness's job flipped. It no longer drives a banner; it proves the
// region cannot touch the DOM, cannot arm a watcher, and — the regression that
// actually matters — contains NO reachable path that stops the recorder. Two
// independent ways:
//   * dynamically — a spy `document` (a Proxy that logs every property touched,
//     not just the handful the old code used) and a spy replay controller whose
//     stop() records, driven through every entry point the region exposes;
//   * statically — `bannerRegionCode()` hands back the region with comments
//     stripped, so a test can assert the shipped source has no createElement, no
//     click listener, no stop() call. If someone re-adds a Stop button without
//     realising recording is meant to be non-stoppable here, that fails even if
//     their new code happens not to run under this harness's stubs.
//
// Same sentinel-slice approach as load-replay-bootstrap.mjs / load-session.mjs:
// content.js is one big IIFE that touches document/chrome at load time, so we
// slice the self-contained region between two sentinel comments and evaluate just
// that. If a sentinel moves, the slice throws instead of silently testing nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Recording indicator (Session Replay) ─';
// First occurrence only — there is a second "Blocked Agent Enforcement
// (DOM-level)" heading further down, and indexOf stops at the first.
const END = '// ── Blocked Agent Enforcement ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function sliceBannerRegion() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js sentinels are out of order');
  return src.slice(from, to);
}

/** The raw region source, comments and all. */
export function bannerRegionSource() {
  return sliceBannerRegion();
}

/** The whole of content.js — for "this function exists nowhere any more" checks. */
export function contentSource() {
  return src;
}

/**
 * Strip // and /* *\/ comments so a test can pattern-match the region's actual
 * CODE. Necessary because the region's comments legitimately discuss the removed
 * banner and its "Stop recording" button, and a naive grep would match the
 * explanation of the removal as if it were the thing removed.
 *
 * Quote-aware (', ", `) so a string containing // is not mistaken for a comment.
 */
export function stripComments(code) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The region's code with its (extensive) explanatory comments removed. */
export function bannerRegionCode() {
  return stripComments(sliceBannerRegion());
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = '';
    this.className = '';
    this.id = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    if (child.parentNode === this) child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains(node));
  }
  /** Every element in this subtree, root first. */
  get descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants]);
  }
  findById(id) {
    if (this.id === id) return this;
    for (const c of this.children) {
      const hit = c.findById(id);
      if (hit) return hit;
    }
    return null;
  }
}

/**
 * Evaluate the recording-indicator region against a fully spied environment.
 *
 * options:
 *   topFrame          false simulates the content script inside an iframe
 *                     (content.js is injected with all_frames:true)
 *   cachedSessionId   what currentSessionIdCached() — which lives in the
 *                     conversation-identity region, outside this slice — returns.
 *                     A plain cached read of what the SERVICE WORKER last said
 *                     this tab's session is; the region can report it, never mint.
 *   replayController  what _replayController is holding. Defaults to a spy whose
 *                     stop() records into `replayStops`; pass null to simulate a
 *                     page where replay never started.
 *
 * Returns the region's own functions plus test controls:
 *   state()          { recordingId, hasController } — the region's live bookkeeping
 *   domCalls         every DOM METHOD the region invoked (must stay empty)
 *   domTouches       every DOM PROPERTY the region even read (growth-proofing:
 *                    catches a future querySelector/innerHTML the old spies missed)
 *   replayStops      every reason handed to the controller's stop() (must stay empty)
 *   sent             every chrome.runtime.sendMessage payload (must stay empty —
 *                    the on-load "are we already recording?" query is gone too)
 *   message(msg)     deliver a runtime message as the service worker would
 *   timerCalls       set/clearInterval + set/clearTimeout the region installed
 *   observersCreated how many MutationObservers the region constructed
 *   elementsCreated  every element the region built via document.createElement
 */
export function loadRecordingBanner({
  topFrame = true,
  cachedSessionId = null,
  replayController = undefined,
} = {}) {
  const html = new FakeElement('html');
  html.id = 'html';

  const domCalls = [];
  const domTouches = [];
  const elementsCreated = [];

  // Any append into the document tree is a DOM mutation, so spy the one node the
  // old banner code reached for.
  const protoAppend = FakeElement.prototype.appendChild;
  html.appendChild = function appendChildSpy(child) {
    domCalls.push({ fn: 'appendChild', arg: child && child.tagName });
    return protoAppend.call(this, child);
  };

  // isTopFrame() compares window.top with window.self.
  const window = {};
  window.self = window;
  window.top = topFrame ? window : { notThisFrame: true };
  window.addEventListener = (type) => { domCalls.push({ fn: 'window.addEventListener', arg: type }); };

  const baseDocument = {
    documentElement: html,
    body: null,
    head: null,
    visibilityState: 'visible',
    createElement(tag) {
      domCalls.push({ fn: 'createElement', arg: tag });
      const el = new FakeElement(tag);
      elementsCreated.push(el);
      return el;
    },
    createTextNode(text) {
      domCalls.push({ fn: 'createTextNode', arg: text });
      return new FakeElement('#text');
    },
    getElementById(id) {
      domCalls.push({ fn: 'getElementById', arg: id });
      return html.findById(id);
    },
    querySelector(sel) { domCalls.push({ fn: 'querySelector', arg: sel }); return null; },
    querySelectorAll(sel) { domCalls.push({ fn: 'querySelectorAll', arg: sel }); return []; },
    contains(node) { domCalls.push({ fn: 'contains' }); return html.contains(node); },
    addEventListener(type) { domCalls.push({ fn: 'document.addEventListener', arg: type }); },
  };

  // A Proxy rather than a plain object so the harness stays honest as the region
  // evolves: reading ANY document property is recorded, and an API nobody stubbed
  // returns a recording function instead of throwing — the test fails on the
  // recorded touch, which is a far clearer failure than a TypeError.
  const document = new Proxy(baseDocument, {
    get(target, prop) {
      domTouches.push(String(prop));
      if (prop in target) return target[prop];
      return (...args) => { domCalls.push({ fn: String(prop), arg: args[0] }); return null; };
    },
  });

  const sent = [];
  const messageHandlers = [];
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        sent.push(msg);
        if (typeof cb === 'function') cb(undefined);
      },
      onMessage: { addListener(fn) { messageHandlers.push(fn); } },
    },
  };

  const observers = [];
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; this.connected = false; observers.push(this); }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
  }

  const timerCalls = [];
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimerId = 1;
  const setInterval = (fn) => {
    const id = nextTimerId++;
    timerCalls.push({ fn: 'setInterval', id });
    intervals.set(id, fn);
    return id;
  };
  const clearInterval = (id) => { timerCalls.push({ fn: 'clearInterval', id }); intervals.delete(id); };
  const setTimeout = (fn) => {
    const id = nextTimerId++;
    timerCalls.push({ fn: 'setTimeout', id });
    timeouts.set(id, fn);
    return id;
  };
  const clearTimeout = (id) => { timerCalls.push({ fn: 'clearTimeout', id }); timeouts.delete(id); };

  const logs = { info: [], warn: [] };
  const quietConsole = {
    info: (...a) => logs.info.push(a.join(' ')),
    warn: (...a) => logs.warn.push(a.join(' ')),
    log() {},
  };

  const replayStops = [];
  const defaultController = { stop: (reason) => replayStops.push(reason) };
  const controller = replayController === undefined ? defaultController : replayController;

  // `_recRecordingId` and `_replayController` are both DECLARED inside this region
  // (the controller lives here, 300 lines above the bootstrap that assigns it,
  // because the visibilitychange handler reads it and `let` has no hoisted value).
  // So the controller cannot arrive as a parameter — that would be a
  // redeclaration — and is assigned right after the slice instead.
  const body = sliceBannerRegion() +
    '\n_replayController = __injectedController;\n' +
    '\nreturn { showRecordingBanner, hideRecordingBanner, isTopFrame,' +
    ' state: () => ({ recordingId: _recRecordingId, hasController: !!_replayController }) };\n';

  // eslint-disable-next-line no-new-func
  const run = new Function(
    'document', 'chrome', 'console', 'MutationObserver',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'window',
    'currentSessionIdCached', '__injectedController',
    body,
  );
  const api = run(
    document,
    chrome,
    quietConsole,
    FakeMutationObserver,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    window,
    () => cachedSessionId,
    controller,
  );

  return {
    ...api,
    document,
    html,
    sent,
    logs,
    domCalls,
    domTouches,
    elementsCreated,
    timerCalls,
    /** Every reason string handed to the replay controller's stop(), in order. */
    replayStops,
    /** Nodes anywhere under <html> — the region must never add one. */
    domNodes() { return html.descendants; },
    observersCreated() { return observers.length; },
    activeObservers() { return observers.filter((o) => o.connected).length; },
    activeIntervals() { return intervals.size; },
    /** Run whatever timers the region installed (there should be none). */
    tickPoll(times = 1) {
      for (let i = 0; i < times; i++) {
        for (const fn of [...intervals.values()]) fn();
        for (const fn of [...timeouts.values()]) fn();
      }
    },
    /** Fire every MutationObserver the region armed (there should be none). */
    fireMutation() { for (const o of observers) if (o.connected) o.cb([], o); },
    message(msg) {
      let response;
      for (const fn of messageHandlers) fn(msg, {}, (r) => { response = r; });
      return response;
    },
    messageHandlerCount() { return messageHandlers.length; },
  };
}
