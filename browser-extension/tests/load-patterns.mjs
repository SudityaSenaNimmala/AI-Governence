// Loads the REAL browser-extension pattern catalog (content/patterns.js) into
// Node so tests exercise shipped code instead of a reimplementation.
//
// patterns.js is a plain (non-module) IIFE that publishes onto `window`, so we
// evaluate it with a stub window. The only other globals it touches are
// `crypto` (present in Node 20) and `setInterval` — which it uses for the token
// vault's GC timer. We hand it a no-op timer so a test run doesn't hang for
// five minutes waiting on that interval.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'patterns.js'), 'utf8');

export function loadPatterns() {
  const win = {};
  const noopInterval = () => 0;
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'setInterval', 'clearInterval', 'crypto', src);
  run(win, noopInterval, () => {}, globalThis.crypto);
  if (!win.__cfaiPatterns) throw new Error('patterns.js did not publish window.__cfaiPatterns');
  return win.__cfaiPatterns;
}

/** Luhn-valid digit string of `len` digits starting with `prefix`. */
export function luhnify(prefix, len) {
  const body = (prefix + '0'.repeat(Math.max(0, len - prefix.length - 1))).slice(0, len - 1);
  for (let d = 0; d <= 9; d++) {
    const candidate = body + String(d);
    if (luhnValid(candidate)) return candidate;
  }
  throw new Error('no luhn check digit found for ' + prefix);
}

export function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
