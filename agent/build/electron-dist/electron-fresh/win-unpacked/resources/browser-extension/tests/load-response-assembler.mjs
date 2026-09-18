// Loads the REAL AI-response reassembly code out of content/fetch-blocker.js
// so the tests exercise shipped page-world code instead of a copy.
//
// fetch-blocker.js is an IIFE that patches window.fetch / XMLHttpRequest at load
// time, so it cannot be evaluated in Node. Instead we slice the self-contained
// capture region between two sentinel comments and evaluate just that. The
// region is deliberately pure — no window, document, location or console — so it
// needs no stubs at all. If a sentinel ever moves, the slice throws rather than
// silently testing nothing.
//
// Same pattern as tests/load-session.mjs for content.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── AI response capture (Session Replay, phase 3)';
const END = '// ── end AI response capture';

// The transport half: conversation-id capture, body draining, publishing.
const PLUMBING_START = '// ── AI response capture — page-side plumbing ─';
const PLUMBING_END = '// ── end AI response capture plumbing ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'fetch-blocker.js'), 'utf8');

function sliceRegion(startMarker, endMarker) {
  const from = src.indexOf(startMarker);
  const to = src.indexOf(endMarker);
  if (from < 0) throw new Error(`fetch-blocker.js sentinel not found: ${startMarker}`);
  if (to < 0) throw new Error(`fetch-blocker.js sentinel not found: ${endMarker}`);
  if (to <= from) throw new Error(`fetch-blocker.js sentinels are out of order: ${startMarker}`);
  return src.slice(from, to);
}

function sliceCaptureRegion() {
  return sliceRegion(START, END);
}

/**
 * Evaluate the capture region.
 * Returns { assembleAiResponseText, responseSiteFor, collectStreamEvents, parseSseFrames }.
 */
export function loadResponseAssembler() {
  const body = sliceCaptureRegion()
    + '\nreturn { assembleAiResponseText, responseSiteFor, collectStreamEvents, parseSseFrames, hostOf };\n';
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

/**
 * Evaluate the reassembly region PLUS the transport plumbing that wraps it, with
 * stubs for the three globals the plumbing names (window, location, fetch's own
 * Response is supplied by the caller). This is what makes "the conversation id is
 * captured when the request is TEED, not when the stream ends" a real behavioural
 * test rather than a source-shape assertion.
 *
 * options:
 *   pathname   the fake location.pathname, changeable via setPath() — moving it
 *              mid-stream is exactly the switched-chats case
 *
 * Returns { withResponseCapture, currentConvId, publishAiResponse, published,
 *           setPath }
 *   published  the detail of every 'cfai-ai-response' CustomEvent dispatched
 */
export function loadResponseCapture({ pathname = '/' } = {}) {
  const published = [];
  const location = { pathname, hostname: 'chatgpt.com' };
  const window = {
    dispatchEvent(ev) { published.push(ev.detail); return true; },
  };
  // The page world's CustomEvent, reduced to what this code uses.
  class FakeCustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }

  const body = sliceCaptureRegion() + '\n' + sliceRegion(PLUMBING_START, PLUMBING_END)
    + '\nreturn { withResponseCapture, currentConvId, publishAiResponse };\n';

  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'location', 'CustomEvent', 'TextDecoder', body);
  const api = run(window, location, FakeCustomEvent, globalThis.TextDecoder);

  return {
    ...api,
    published,
    setPath(p) { location.pathname = p; },
  };
}

/** A Response stand-in whose body streams `chunks` and whose clone() shares them,
 * the way response.clone()'s internal tee does. */
export function fakeStreamingResponse(chunks, { contentType = 'text/event-stream', ok = true } = {}) {
  const encoder = new TextEncoder();
  const make = () => {
    let i = 0;
    return {
      ok,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType : null) },
      body: {
        getReader: () => ({
          read: async () => (i < chunks.length
            ? { done: false, value: encoder.encode(chunks[i++]) }
            : { done: true, value: undefined }),
        }),
      },
      clone: () => make(),
    };
  };
  return make();
}

/**
 * Feed a stream to the assembler the way the browser would: as many small
 * chunks, buffered and joined, then parsed once at end of stream. Mirrors
 * captureResponseStream()'s buffering so tests cover chunk-boundary splits.
 */
export function assembleFromChunks(api, chunks, site) {
  const buffered = [];
  for (const c of chunks) buffered.push(c);
  return api.assembleAiResponseText(buffered.join(''), site);
}

/** Split a string into fixed-size pieces — simulates arbitrary network framing. */
export function chunkify(text, size = 7) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
