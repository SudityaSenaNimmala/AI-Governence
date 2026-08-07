// Loads the REAL prompt-complexity classifier (content/complexity.js) into Node
// so tests exercise shipped code instead of a reimplementation.
//
// complexity.js is a plain (non-module) IIFE that publishes onto `window`, and
// unlike patterns.js it touches no other global at all — no timers, no crypto —
// so a bare stub window is the whole environment it needs. Same convention as
// tests/load-patterns.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'complexity.js'), 'utf8');

export function loadComplexity() {
  const win = {};
  // eslint-disable-next-line no-new-func
  const run = new Function('window', src);
  run(win);
  if (!win.__cfaiComplexity) throw new Error('complexity.js did not publish window.__cfaiComplexity');
  return win.__cfaiComplexity;
}

/** The raw window the module was evaluated against (for load-guard assertions). */
export function loadComplexityWindow() {
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', src)(win);
  return win;
}
