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

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'fetch-blocker.js'), 'utf8');

function sliceCaptureRegion() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`fetch-blocker.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`fetch-blocker.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('fetch-blocker.js sentinels are out of order');
  return src.slice(from, to);
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
