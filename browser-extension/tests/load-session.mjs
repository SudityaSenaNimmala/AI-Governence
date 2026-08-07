// Loads the REAL conversation-identity block out of content/content.js so the
// tests exercise shipped code instead of a reimplementation.
//
// WHAT MOVED: this used to load the session MINT/ROTATE logic. Session identity
// no longer lives in the content script at all — it is an engagement record owned
// by background/service-worker.js and persisted in chrome.storage.local, because
// content-script memory dies on every page load and that was exactly why a reload
// or a chat switch silently started a new session. The pure decision logic is in
// lib/recording.js and is covered by tests/engagement.test.mjs.
//
// What is LEFT here is the part only a content script can do — read the page URL
// for the AI site's own conversation id — plus emit(), which must no longer stamp
// session_id / client_seq itself. Both are worth pinning down, so the same
// sentinel-slice approach is kept.
//
// content.js is one large IIFE that touches document/chrome/MutationObserver at
// load time, so we cannot evaluate the whole file in Node. Instead we slice the
// self-contained region between two sentinel comments and evaluate just that with
// stubs. If either sentinel ever moves, the slice throws instead of silently
// testing nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Conversation identity (Session Replay)';
const END = '// ── Programmatic-send window';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function sliceSessionRegion() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js sentinels are out of order');
  return src.slice(from, to);
}

/**
 * Evaluate the region with stubbed browser globals.
 *
 * Returns { emit, checkConvUrl, currentConvId, refreshSessionId,
 *           currentSessionIdCached, sent, asks, setPath, setVisibility,
 *           answerSessionId }
 *   sent            every payload handed to chrome.runtime.sendMessage that is a
 *                   governance event (i.e. not the currentSessionId control RPC)
 *   asks            every currentSessionId control RPC
 *   answerSessionId reply to the NEXT ask (and to every event send) with this id
 *   setPath         change the fake location.pathname (simulates SPA navigation)
 *   setVisibility   'visible' | 'hidden'
 */
export function loadSession({ service = 'ChatGPT', pathname = '/', visibility = 'visible' } = {}) {
  const sent = [];
  const asks = [];
  let nextSessionId = null;

  const location = { pathname, hostname: 'chatgpt.com' };
  const document = { get visibilityState() { return visibility; } };

  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => {
        if (msg && msg.__cfai_kind === 'currentSessionId') asks.push(msg);
        else sent.push(msg);
        // The worker answers synchronously here; in Chrome it is a callback, and
        // the code under test must not depend on when it lands.
        if (typeof cb === 'function') cb({ ok: true, session_id: nextSessionId });
      },
    },
  };
  const quietConsole = { info() {}, warn() {}, log() {} };

  const body = sliceSessionRegion() +
    '\nreturn { emit, checkConvUrl, currentConvId, emitSessionBind, refreshSessionId,' +
    ' currentSessionIdCached, activeConvIdCached, isTabVisible };\n';

  // eslint-disable-next-line no-new-func
  const run = new Function('chrome', 'location', 'document', 'console', 'crypto', 'SERVICE', body);
  const api = run(chrome, location, document, quietConsole, globalThis.crypto, service);

  return {
    ...api,
    sent,
    asks,
    setPath(p) { location.pathname = p; },
    setVisibility(v) { visibility = v; },
    answerSessionId(id) { nextSessionId = id; },
  };
}
