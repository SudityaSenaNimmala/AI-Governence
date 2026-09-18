// Loads the REAL "which tier is this model button" region out of
// content/content.js, so model-tier detection is tested against shipped code.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as load-conv-identity.mjs and the
// other loaders in this directory: content.js is one giant classic-script IIFE
// that touches document/chrome/window at load time and cannot be imported or
// evaluated whole in Node. detectModelInfo() is a rare pure function in this
// file — no free variables at all beyond its own `text` parameter — so its
// region needs no globals handed in.
//
// The region owns exactly one thing: detectModelInfo(). This is the function
// that reads an AI site's model-selector button text and decides which
// provider/tier it is — the thing that broke silently when Gemini renamed its
// lineup from Flash/Pro/Ultra to Flash/Thinking/Pro (a real regression this
// test suite did not previously catch).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Model tier detection (Smart Model Router) ────────────────────────────';
const END = '// ── end model tier detection ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

/** The raw source, for tests that assert on nearby declarations directly. */
export function contentSource() {
  return src;
}

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js model-tier-detection sentinels are out of order');
  return src.slice(from, to);
}

/** detectModelInfo(text) -> { provider, tier } | null, straight off the shipped file. */
export function loadDetectModelInfo() {
  const body = region() + '\n  return detectModelInfo;';
  // eslint-disable-next-line no-new-func
  const run = new Function(body);
  return run();
}

/**
 * TIER_UI_NAME is declared elsewhere in content.js (not inside the pure
 * region above — it sits alongside stateful router code that touches
 * chrome.storage). Rather than widen the slice to pull in that machinery,
 * read the one line we need directly off the source: this is the same
 * technique load-conv-identity.mjs's emittedKinds() uses, and for the same
 * reason — a narrow, source-anchored read is safer than executing code with
 * dependencies a test has no business standing up.
 */
export function tierUiNameFor(provider) {
  // Scope to the TIER_UI_NAME declaration specifically — ROUTE_TABLE (dead
  // code, still present in the file) ALSO has a top-level `google: {...}`
  // entry, and a bare `google:\s*\{...\}` search would happily match that
  // one instead if it appears first, silently checking the wrong object.
  const decl = src.indexOf('const TIER_UI_NAME = {');
  if (decl < 0) throw new Error('content.js: TIER_UI_NAME declaration not found');
  const end = src.indexOf('};', decl);
  if (end < 0) throw new Error('content.js: TIER_UI_NAME declaration never closes');
  const block = src.slice(decl, end);

  const m = new RegExp(`${provider}:\\s*\\{([^}]*)\\}`).exec(block);
  if (!m) throw new Error(`content.js: TIER_UI_NAME has no entry for '${provider}'`);
  const out = {};
  for (const pair of m[1].matchAll(/(\d)\s*:\s*'([^']+)'/g)) out[Number(pair[1])] = pair[2];
  return out;
}
