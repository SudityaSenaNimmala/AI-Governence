// Loads the REAL "one bootstrap per document" guard out of content/content.js,
// together with the REAL session-replay bootstrap region, so double injection can be
// simulated against shipped code.
//
// WHY THIS EXISTS. content.js lands in a document twice on some hosts: chatgpt.com is
// in manifest.json's hardcoded content_scripts[0].matches AND is recognised by the
// service worker's classifier/registry path, which injects the same file list again
// through chrome.scripting (injectDlpStack). The worker's _injectedTabs Set only
// stops IT from injecting twice; it cannot see what the manifest already did. Live on
// chatgpt.com that produced two "content script v2 loaded" lines and two replay
// controllers registering two runs for ONE session id.
//
// A second injection is a second, completely separate EVALUATION of the file in the
// same isolated world — so the only state the two share is the window. That is
// exactly what this harness models: one `world` (one window/document/chrome), and
// inject() evaluates the sliced regions from scratch each time it is called.
//
// Same sentinel-slice approach as load-recording-banner.mjs / load-replay-bootstrap.mjs:
// content.js is one big IIFE that touches document/chrome at load time, so we slice
// the self-contained regions between sentinel comments. If a sentinel moves, the
// slice throws instead of silently testing nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GUARD_START = '// ── one bootstrap per document ─';
// The load banner is the first thing after the guard, and it is also the line the
// live test saw twice — so the slice ends with it and the test can count it.
const GUARD_END = "console.info('[cfai] content script v2 loaded on', location.hostname);";

const BOOT_START = '// ── session replay bootstrap ─';
const BOOT_END = '// ── end session replay bootstrap ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function slice(startMarker, endMarker, { inclusive = false } = {}) {
  const from = src.indexOf(startMarker);
  const to = src.indexOf(endMarker);
  if (from < 0) throw new Error(`content.js sentinel not found: ${startMarker}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${endMarker}`);
  if (to <= from) throw new Error(`content.js sentinels are out of order: ${startMarker}`);
  return src.slice(from, inclusive ? to + endMarker.length : to);
}

/** The guard must come FIRST in the file, or a second injection re-runs whatever precedes it. */
export function guardIsFirstStatement() {
  const iife = src.indexOf('(function () {');
  const guard = src.indexOf(GUARD_START);
  if (iife < 0 || guard < 0) throw new Error('content.js: could not locate the IIFE or the guard');
  // Only comments and whitespace may sit between the IIFE opening and the guard.
  const between = src.slice(iife + '(function () {'.length, guard);
  return /^\s*(\/\/[^\n]*\n\s*)*$/.test(between);
}

/**
 * One document, injectable more than once.
 *
 * options:
 *   topFrame   the recorder is top-frame only (content.js is injected all_frames)
 *   sessionId  what currentSessionIdCached() returns
 *
 * Returns:
 *   inject()            evaluate the guard + bootstrap regions once, as one
 *                       injection of content.js would. Returns null when the guard
 *                       short-circuited it, or { controller } when setup really ran.
 *   window/document     the SHARED document state both injections see
 *   created             the deps object of every createReplayController() call
 *   controllers         every controller handed back
 *   listeners           every (target, type) pair registered, across injections
 *   logs                console.info / console.warn lines, across injections
 *   loadedLines         just the "content script v2 loaded" lines
 */
export function makeDocumentWorld({ topFrame = true, sessionId = 'sess-1' } = {}) {
  const created = [];
  const controllers = [];
  const banners = [];
  const sent = [];
  const listeners = [];
  const logs = { info: [], warn: [] };

  const window = {};
  window.self = window;
  window.top = topFrame ? window : { notThisFrame: true };
  window.rrweb = { record: () => () => {} };
  window.addEventListener = (type, fn) => listeners.push({ target: 'window', type, fn });
  window.__cfaiReplay = {
    createReplayController(deps) {
      created.push(deps);
      const ctl = {
        id: created.length,
        init() { return Promise.resolve(); },
        onVisibilityChange() {},
        onPageHide() { ctl.pageHides = (ctl.pageHides || 0) + 1; },
        stop() {},
      };
      controllers.push(ctl);
      return ctl;
    },
  };

  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.push({ target: 'document', type, fn }),
  };

  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) { sent.push(msg); if (typeof cb === 'function') cb({ ok: true }); },
    },
  };

  const location = { hostname: 'chatgpt.com', pathname: '/c/abc' };
  const consoleStub = {
    info: (...a) => logs.info.push(a.join(' ')),
    warn: (...a) => logs.warn.push(a.join(' ')),
    log() {},
  };

  // Guard first, then the bootstrap it has to protect. `_replayController` is
  // declared in content.js's recording-banner region (outside both slices), so it
  // arrives as a parameter — and it is per-EVALUATION here, which is precisely the
  // bug: a second injection gets its own, and without the guard it would build its
  // own controller into it.
  const body = slice(GUARD_START, GUARD_END, { inclusive: true }) +
    '\n' + slice(BOOT_START, BOOT_END) +
    '\nreturn { controller: _replayController };\n';

  return {
    window,
    document,
    created,
    controllers,
    banners,
    sent,
    listeners,
    logs,
    get loadedLines() { return logs.info.filter((l) => l.includes('content script v2 loaded')); },
    get skippedLines() { return logs.info.filter((l) => l.includes('already bootstrapped')); },
    inject() {
      // eslint-disable-next-line no-new-func
      const run = new Function(
        'window', 'document', 'chrome', 'console', 'location',
        'isTopFrame', 'isTabVisible', 'currentSessionIdCached', 'activeConvIdCached',
        'showRecordingBanner', 'hideRecordingBanner', '_replayController',
        body,
      );
      const out = run(
        window,
        document,
        chrome,
        consoleStub,
        location,
        () => topFrame,
        () => true,
        () => sessionId,
        // The conversation the user last actually interacted in. Declared in
        // content.js's conversation-identity region, which is outside both
        // slices, so it arrives as a parameter like the session-id reader.
        () => 'conv-abc',
        (id) => { banners.push({ show: id ?? null }); return null; },
        () => { banners.push({ hide: true }); },
        null,
      );
      return out === undefined ? null : out;
    },
    fire(target, type, event = {}) {
      const hits = listeners.filter((l) => l.target === target && l.type === type);
      for (const l of hits) l.fn(event);
      return hits.length;
    },
  };
}
