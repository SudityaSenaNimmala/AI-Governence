// Generates agent/src/proxy/complexity.js from the CANONICAL classifier,
// browser-extension/content/complexity.js.
//
// WHY A GENERATOR AND NOT A HAND-PORT, AND NOT A RUNTIME READ.
//
// Before this existed there were two classifiers. The extension scored a
// weighted lexicon; the proxy had its own pair of flat regexes in front of a
// length test (`tokenEstimate < 100 -> simple`). Both fed the SAME routing
// rules from /api/v1/routing/rules, so one admin rule reading
// `complexity: simple` matched two different definitions of the word — and
// "what's our architecture for the billing service?" came out complex in the
// browser (Opus) and simple through the proxy (Haiku). Same prompt, opposite
// tier, on the customer's invoice.
//
// A hand-port would fix it once and drift by the first lexicon edit. Reading
// the extension file at runtime is worse: the agent installs on endpoints and
// is packaged as a Node SEA binary, neither of which has browser-extension/
// next to it. So: generate at build time from one source, check the output in,
// and pin behaviour with agent/tests/complexity-parity.test.mjs — which loads
// BOTH implementations and fails the moment a verdict diverges.
//
// Run after ANY edit to content/complexity.js:
//   node scripts/gen-proxy-complexity.mjs
//
// The transformation is three anchored string edits, and every anchor must
// appear exactly once. If complexity.js is restructured so an anchor moves,
// this script fails loudly rather than emitting something subtly wrong.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'browser-extension', 'content', 'complexity.js');
const OUT = path.join(root, 'agent', 'src', 'proxy', 'complexity.js');
const OUT_INLINE = path.join(root, 'agent', 'src', 'desktop_injector', 'complexity.inline.js');

/** Replace `find` with `replace`, asserting it occurs exactly once. */
function once(text, find, replace, label) {
  const parts = text.split(find);
  if (parts.length !== 2) {
    throw new Error(
      `gen-proxy-complexity: anchor "${label}" appeared ${parts.length - 1} times, expected exactly 1.\n` +
      `content/complexity.js was restructured — update this script before shipping.`,
    );
  }
  return parts.join(replace);
}

// Normalise to LF before matching. The checked-in sources use CRLF, which would
// make every multi-line anchor below miss for a reason that has nothing to do
// with the code it is trying to find.
const rawSrc = readFileSync(SRC, 'utf8');
const src = rawSrc.replace(/\r\n/g, '\n');

// 1. Drop the IIFE opener. Top-level const/function in an ES module is already
//    scoped to the module, so the wrapper has nothing left to do.
let out = once(src, '(function () {', '', 'IIFE opener');

// 2. Drop the double-injection guard. It exists because some hosts appear in
//    both manifest content_scripts and injectDlpStack(); an ES module is
//    evaluated once per process by the loader, so there is nothing to guard.
out = once(
  out,
  `  if (window.__cfaiComplexityLoaded) return;
  window.__cfaiComplexityLoaded = true;`,
  '  // (browser double-injection guard removed — ES modules evaluate once.)',
  'load guard',
);

// 3. Publish as a named export instead of onto `window`.
out = once(out, '  window.__cfaiComplexity = {', '  export const __cfaiComplexity = {', 'window publish');

// 4. Drop the IIFE closer.
out = once(out, '})();', '', 'IIFE closer');

const header = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth:  browser-extension/content/complexity.js
// Regenerate with:  node scripts/gen-proxy-complexity.mjs
// Pinned by:        agent/tests/complexity-parity.test.mjs
//
// This is the SAME classifier the browser extension runs, mechanically
// translated from its content-script IIFE into an ES module so the HTTPS proxy
// can import it. One definition of simple / moderate / complex now governs both
// routing paths; see the generator's header for why the proxy's own regex-plus-
// length classifier was removed.
//
// Edit content/complexity.js and re-run the generator. Editing this file
// directly will be overwritten and the parity test will fail.

`;

writeFileSync(OUT, header + out.trimStart().replace(/\n{3,}$/, '\n'), 'utf8');

// Verify by USING it, not by pattern-matching it. Any `window` reference the
// translation failed to remove throws "window is not defined" on evaluation, and
// a mangled lexicon shows up immediately in the verdicts. Static checks on this
// file are unreliable — it is ~200 regexes and heavy prose, and both mention
// `window` legitimately (the analysis window).
const mod = await import(pathToFileURL(OUT).href + `?v=${Date.now()}`);
const api = mod.__cfaiComplexity;
if (!api || typeof api.classify !== 'function') {
  throw new Error('gen-proxy-complexity: generated module did not export a usable __cfaiComplexity.');
}
const CHECKS = [
  ['hi', 'simple'],
  ['2+2', 'simple'],
  ['define idempotent', 'simple'],
  ['explain cloud computing in simple words', 'simple'],
  ['summarize this email', 'moderate'],
  ['42', 'moderate'],
  ['architecture', 'complex'],
  ["what's our architecture for the billing service?", 'complex'],
  ['why does this deadlock', 'complex'],
];
for (const [prompt, expected] of CHECKS) {
  const got = api.classify(prompt);
  if (got !== expected) {
    throw new Error(
      `gen-proxy-complexity: generated classifier returned "${got}" for ${JSON.stringify(prompt)}, ` +
      `expected "${expected}". The translation changed behaviour — do not ship this file.`,
    );
  }
}

// ── Third consumer: the Claude Desktop / Electron renderer ──────────────────
//
// hook-renderer.js is read as TEXT by hook-template.js and evaluated inline in
// the renderer, so it can carry no import and no export — it had its OWN copy of
// the length-first classifier for exactly that reason. But the renderer has a
// real `window`, which means the canonical file needs no translation at all: it
// is already an IIFE that publishes window.__cfaiComplexity, and its own
// double-injection guard makes re-injection into the same renderer safe.
//
// So this artifact is the source verbatim, emitted here only so the desktop
// injector can embed it without reaching into browser-extension/ at runtime.
const inlineHeader = `// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth:  browser-extension/content/complexity.js  (copied verbatim)
// Regenerate with:  node scripts/gen-proxy-complexity.mjs
// Pinned by:        agent/tests/complexity-parity.test.mjs
//
// Embedded as text by hook-template.js and evaluated in every Claude Desktop
// renderer before hook-renderer.js runs, so the desktop routing path classifies
// prompts identically to the browser extension and the HTTPS proxy.

`;
// The RAW source, not the LF-normalised copy: the parity test asserts this file
// ends with the canonical bytes exactly, and "verbatim" should mean verbatim.
// The header adopts the source's line endings so the file is not mixed.
const eol = rawSrc.includes('\r\n') ? '\r\n' : '\n';
writeFileSync(OUT_INLINE, inlineHeader.replace(/\n/g, eol) + rawSrc, 'utf8');

// Verify the inline copy the same way the extension's own tests do — evaluate it
// against a bare window stub and check it publishes a working classifier.
const inlineWin = {};
// eslint-disable-next-line no-new-func
new Function('window', readFileSync(OUT_INLINE, 'utf8'))(inlineWin);
if (!inlineWin.__cfaiComplexity || typeof inlineWin.__cfaiComplexity.classify !== 'function') {
  throw new Error('gen-proxy-complexity: inline copy did not publish window.__cfaiComplexity.');
}
for (const [prompt, expected] of CHECKS) {
  const got = inlineWin.__cfaiComplexity.classify(prompt);
  if (got !== expected) {
    throw new Error(
      `gen-proxy-complexity: inline copy returned "${got}" for ${JSON.stringify(prompt)}, expected "${expected}".`,
    );
  }
}

console.log(
  `generated from ${path.relative(root, SRC)} (classifier v${api.VERSION}, ` +
  `${CHECKS.length} smoke checks passed against each output):\n` +
  `  ${path.relative(root, OUT)}         — ES module, imported by the HTTPS proxy\n` +
  `  ${path.relative(root, OUT_INLINE)}  — verbatim IIFE, embedded in the desktop renderer`,
);
