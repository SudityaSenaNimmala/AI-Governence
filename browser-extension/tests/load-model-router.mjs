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

// tierUiNameFor() was removed with content.js's TIER_UI_NAME table. Which label
// to click for a tier now comes from the shared catalog (shared/model-catalog.json),
// pinned by tests/shared-routing.test.mjs.
