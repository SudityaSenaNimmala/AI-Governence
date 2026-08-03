// Loads the REAL ai_response listener out of content/content.js, wired to the
// REAL conversation-identity block (emit + the conversation-id reader).
//
// Both regions are sliced out of the shipped file between sentinel comments and
// evaluated together, so the test proves the actual thing we care about: a reply
// handed over by the page world becomes exactly one emitted event. Neither region
// is reimplemented here.
//
// NOTE: session_id / client_seq are NOT part of that event any more. The service
// worker stamps both from the engagement record it owns for the tab (see
// lib/recording.js and tests/engagement.test.mjs) — content-script memory dies on
// every page load, which is why it can no longer be the source of session
// identity.
//
// Same approach as load-session.mjs; if a sentinel moves, the slice throws.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

const REGIONS = {
  listener: {
    start: '// ── AI response capture (Session Replay, phase 3)',
    end: '// ── Full-platform block',
  },
  session: {
    start: '// ── Conversation identity (Session Replay)',
    end: '// ── Programmatic-send window',
  },
};

function slice(name) {
  const { start, end } = REGIONS[name];
  const from = src.indexOf(start);
  const to = src.indexOf(end);
  if (from < 0) throw new Error(`content.js sentinel not found: ${start}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${end}`);
  if (to <= from) throw new Error(`content.js sentinels out of order for region '${name}'`);
  return src.slice(from, to);
}

/**
 * Evaluate the session block + the ai_response listener with stubbed browser
 * globals.
 * Returns { fire, sent, logs }:
 *   fire(detail) — dispatch a synthetic 'cfai-ai-response' CustomEvent detail
 *   sent         — every payload handed to chrome.runtime.sendMessage
 */
export function loadAiResponseListener({ service = 'ChatGPT', pathname = '/', visibility = 'visible' } = {}) {
  const sent = [];
  const logs = [];
  const handlers = new Map();

  const location = { pathname, hostname: 'chatgpt.com' };
  const document = { get visibilityState() { return visibility; } };
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => {
        sent.push(msg);
        // The worker answers an event with the session it landed in; nothing in
        // this region depends on the answer arriving.
        if (typeof cb === 'function') cb({ ok: true, session_id: null });
      },
    },
  };
  const quietConsole = { info: (...a) => logs.push(a.join(' ')), warn() {}, log() {} };
  const window = {
    addEventListener(type, fn) { handlers.set(type, fn); },
  };
  // content.js's own bucketing helper, stubbed — its exact thresholds are
  // covered elsewhere and are not what this test is about.
  const lengthBucket = (n) => (n < 1000 ? '100-1k' : '1k-10k');

  const body = slice('session') + '\n' + slice('listener')
    + '\nreturn { emit, currentConvId, currentSessionIdCached };\n';

  // eslint-disable-next-line no-new-func
  const run = new Function('chrome', 'location', 'document', 'console', 'crypto', 'SERVICE', 'window', 'lengthBucket', body);
  const api = run(chrome, location, document, quietConsole, globalThis.crypto, service, window, lengthBucket);

  const handler = handlers.get('cfai-ai-response');
  if (typeof handler !== 'function') throw new Error('the ai_response listener was not registered');

  return {
    ...api,
    sent,
    logs,
    fire(detail) { handler({ detail }); },
  };
}
