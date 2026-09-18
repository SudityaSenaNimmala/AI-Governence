// Loads the REAL "which conversation did this event belong to" region out of
// content/content.js, so the stamping rules are tested against shipped code.
//
// WHY A SLICE AND NOT AN IMPORT. content/content.js is one enormous classic
// content script inside a single IIFE that touches document, location and
// chrome.* at load time, so it can neither be imported in Node nor evaluated
// whole. Same technique the repo already uses for the other regions of this file
// (load-content-injection.mjs, load-recording-banner.mjs, load-replay-bootstrap.mjs):
// slice the self-contained region between two sentinel comments and evaluate
// exactly that, with its free variables handed in as parameters. If either
// sentinel moves the slice THROWS, rather than silently testing nothing.
//
// The region owns: CONV_ID_PATTERNS, currentConvId(), _lastConvId/checkConvUrl(),
// USER_ACTION_KINDS, LIVE_CONV_ID_KINDS/readsLiveConvId(), _activeConvId and
// emit(). Its free variables are `location` (the URL is the only place a
// conversation id can be read from), `chrome` (the transport), `SERVICE` (the
// display label) and `_cachedSessionId` (declared just below the region and
// WRITTEN by emit's response callback — a parameter is assignable, so it models
// that faithfully).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Conversation identity (Session Replay) ─';
const END = '// ── end conversation identity ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

/** The raw source, for tests that assert on the region's own declarations. */
export function contentSource() {
  return src;
}

/**
 * Every `kind` literal this file hands to emit() — and nothing else.
 *
 * WHY NOT A REGEX OVER THE WHOLE FILE. emit() is the ONLY function that stamps
 * external_conv_id, so it is the only thing the LIVE_CONV_ID_KINDS /
 * USER_ACTION_KINDS split can be checked against. content.js also talks to the
 * service worker DIRECTLY in places — `access_request` is a bare
 * chrome.runtime.sendMessage that the worker relays to /api/v1/access-requests
 * and that never reaches dlp_events — and a whole-file scan for `kind: '...'`
 * cannot tell the two apart. That is exactly how a dead LIVE_CONV_ID_KINDS entry
 * survived: the pinning test "expected" it and found it, and passed for the
 * wrong reason.
 *
 * The scan anchors on the emit call itself. `kind` is the first property of
 * every emit object in this file, and that assumption is ASSERTED rather than
 * hoped for: if a call ever puts something else first, this throws instead of
 * quietly checking one kind fewer.
 */
export function emittedKinds() {
  const calls = [...src.matchAll(/\bemit\(\s*\{/g)];
  const heads = [...src.matchAll(/\bemit\(\s*\{\s*kind:\s*([^,\n]+)/g)];
  if (!calls.length || heads.length !== calls.length) {
    throw new Error(
      `content.js: ${calls.length} emit({...}) call(s) but ${heads.length} start with \`kind:\` — `
      + 'this scanner assumes kind is the first property of every emit object.',
    );
  }

  const kinds = new Set();
  for (const m of heads) {
    const literal = /^'([a-z_]+)'$/.exec(m[1].trim());
    // `emit({ kind: 'enforcement_' + action, … })` is a COMPUTED kind and has no
    // literal to pin. That is precisely why readsLiveConvId() prefix-matches
    // every enforcement_* kind instead of listing them, and the prefix rule has
    // its own test.
    if (literal) kinds.add(literal[1]);
  }
  return kinds;
}

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js conversation-identity sentinels are out of order');
  return src.slice(from, to);
}

/**
 * One page, with one URL that a test can move.
 *
 * options:
 *   pathname   where the browser starts. Move it with world.navigate(path) —
 *              which is a bare navigation, exactly like an SPA route change:
 *              nothing about it is a user action.
 *   service    what SERVICE resolved to for this host
 *   respond    what the worker answers each sendMessage with
 *
 * Returns the region's own functions plus:
 *   sent           every message handed to chrome.runtime.sendMessage, in order
 *   last           the most recent one
 *   navigate(p)    move the URL without interacting
 */
export function makeConvIdentityWorld({
  pathname = '/',
  service = 'ChatGPT',
  respond = () => ({ ok: true }),
} = {}) {
  const sent = [];
  const location = { hostname: 'chatgpt.com', pathname };
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        sent.push(msg);
        if (typeof cb === 'function') cb(respond(msg));
      },
    },
  };
  const document = { visibilityState: 'visible' };

  const body = region() + `
    return {
      emit,
      currentConvId,
      activeConvIdCached,
      checkConvUrl,
      readsLiveConvId,
      USER_ACTION_KINDS,
      LIVE_CONV_ID_KINDS,
      CONV_ID_PATTERNS,
    };
  `;

  // eslint-disable-next-line no-new-func
  const run = new Function('location', 'chrome', 'document', 'SERVICE', '_cachedSessionId', body);
  const api = run(location, chrome, document, service, null);

  return {
    ...api,
    sent,
    location,
    get last() { return sent[sent.length - 1]; },
    navigate(p) { location.pathname = p; },
  };
}
