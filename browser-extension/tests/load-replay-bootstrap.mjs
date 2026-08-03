// Loads the REAL session-replay bootstrap region out of content/content.js.
//
// Same sentinel-slice approach as load-recording-banner.mjs / load-session.mjs:
// content.js is one big IIFE that touches document/chrome at load time, so we slice
// the self-contained bootstrap region between two sentinel comments and evaluate
// just that against stubs. If a sentinel moves, the slice throws instead of
// silently testing nothing.
//
// WHAT THIS REGION IS SUPPOSED TO BE: wiring, and nothing else. Every decision
// belongs to content/replay.js (covered by replay.test.mjs). So the assertions here
// are about the CONTRACT — top frame only, both globals required, the RPC wrapper
// never rejects, and the controller gets the right collaborators — not about
// recording behaviour.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── session replay bootstrap ─';
const END = '// ── end session replay bootstrap ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function sliceBootstrapRegion() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js sentinels are out of order');
  return src.slice(from, to);
}

/**
 * Evaluate the bootstrap region with fakes for everything it reaches for.
 *
 * options:
 *   topFrame     false simulates the content script running inside an iframe
 *                (content.js is injected with all_frames:true)
 *   replayApi    null simulates content/replay.js not having loaded
 *   rrweb        null simulates vendor/rrweb-record.js not having loaded
 *   throwOnCreate / throwOnInit / rejectOnInit
 *                createReplayController() / init() blowing up — the host page must
 *                never see an exception out of this region. The REAL init() is
 *                `async`, so its realistic failure is rejectOnInit (a rejected
 *                promise, which a sync try/catch around the call cannot see);
 *                throwOnInit keeps covering the other shape, a controller object
 *                whose init() is not async at all.
 *   lastError    what chrome.runtime.lastError reports for the NEXT sendMessage
 *   response     what the worker answers a sendReplayRpc with
 *   sendThrows   sendMessage itself throws (extension context invalidated)
 *   sessionId    what currentSessionIdCached() returns
 *   visible      what isTabVisible() returns
 *
 * Returns the region's own functions plus test controls:
 *   created          the deps object handed to createReplayController (or null)
 *   controller()     the fake controller the region is holding
 *   sent             every sendMessage payload
 *   pagehide()       fire the window 'pagehide' listener the region registered
 *   listeners        every (target, type) pair the region registered
 */
export function loadReplayBootstrap({
  topFrame = true,
  replayApi = undefined,
  rrweb = undefined,
  throwOnCreate = false,
  throwOnInit = false,
  rejectOnInit = false,
  lastError = undefined,
  response = { ok: true },
  sendThrows = false,
  sessionId = 'sess-cached',
  visible = true,
} = {}) {
  const created = [];
  const fakeController = {
    initCalls: 0,
    visibilityCalls: 0,
    pageHideCalls: 0,
    stops: [],
    // Sync-throwing, to cover a controller whose init() is not a promise at all.
    init() {
      this.initCalls += 1;
      if (throwOnInit) throw new Error('init blew up');
      // The real init() is async: it can only ever REJECT. Returning a rejected
      // promise is what the shipped controller's failure actually looks like.
      if (rejectOnInit) return Promise.reject(new Error('init rejected'));
      return Promise.resolve();
    },
    onVisibilityChange() { this.visibilityCalls += 1; },
    onPageHide() { this.pageHideCalls += 1; },
    stop(reason) { this.stops.push(reason); },
  };

  const defaultApi = {
    createReplayController(deps) {
      created.push(deps);
      if (throwOnCreate) throw new Error('createReplayController blew up');
      return fakeController;
    },
  };

  const window = {};
  window.self = window;
  window.top = topFrame ? window : { notThisFrame: true };
  window.__cfaiReplay = replayApi === undefined ? defaultApi : replayApi;
  window.rrweb = rrweb === undefined ? { record: () => () => {} } : rrweb;

  const listeners = [];
  window.addEventListener = (type, fn) => listeners.push({ target: 'window', type, fn });

  const document = {
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener: (type, fn) => listeners.push({ target: 'document', type, fn }),
  };

  const sent = [];
  const chrome = {
    runtime: {
      get lastError() { return lastError; },
      sendMessage(msg, cb) {
        sent.push(msg);
        if (sendThrows) throw new Error('Extension context invalidated');
        if (typeof cb === 'function') cb(response);
      },
    },
  };

  const banners = [];
  const logs = { info: [], warn: [] };
  const location = { hostname: 'chatgpt.com', pathname: '/c/abc' };

  // `_replayController` is declared up in content.js's recording-banner region (next
  // to the banner state that reads it — see the TDZ note there), NOT in this slice, so
  // it arrives as a parameter. The region assigns to it; `controller()` closes over
  // the same binding and sees that assignment.
  const body = sliceBootstrapRegion() +
    '\nreturn { sendReplayRpc, startSessionReplay, controller: () => _replayController };\n';

  // eslint-disable-next-line no-new-func
  const run = new Function(
    'window', 'document', 'chrome', 'console', 'location',
    'isTopFrame', 'isTabVisible', 'currentSessionIdCached',
    'showRecordingBanner', 'hideRecordingBanner', '_replayController',
    body,
  );
  const api = run(
    window,
    document,
    chrome,
    {
      info: (...a) => logs.info.push(a.join(' ')),
      warn: (...a) => logs.warn.push(a.join(' ')),
      log() {},
    },
    location,
    () => topFrame,
    () => visible,
    () => sessionId,
    (id) => { banners.push({ show: id ?? null }); return null; },
    () => { banners.push({ hide: true }); },
    null,
  );

  return {
    ...api,
    window,
    document,
    sent,
    logs,
    banners,
    listeners,
    fakeController,
    createdDeps() { return created.length ? created[created.length - 1] : null; },
    createCalls() { return created.length; },
    fire(target, type, event = {}) {
      const hits = listeners.filter((l) => l.target === target && l.type === type);
      for (const l of hits) l.fn(event);
      return hits.length;
    },
    pagehide() { return this.fire('window', 'pagehide'); },
  };
}
