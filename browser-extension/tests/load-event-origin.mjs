// Loads the REAL "did this event come from that element" region out of
// content/content.js.
//
// WHY A SLICE AND NOT AN IMPORT: same as the other load-*.mjs loaders —
// content.js is one classic-script IIFE that touches document/chrome/window at
// load time and cannot be evaluated whole in Node.
//
// The region's free variables are the two resolvers it delegates to
// (findActivePromptInput, findPromptInputs) and captureAllowed. The loader
// injects those, which keeps the test about origin/scope logic rather than
// about DOM traversal that is covered elsewhere.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Event origin ─';
const END = '// ── end event origin ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

export function contentSource() {
  return src;
}

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js event-origin sentinels are out of order');
  return src.slice(from, to);
}

/**
 * @param {object} deps {captureAllowed, findActivePromptInput, findPromptInputs}
 * @returns {{eventCameFrom:Function, governedPromptInput:Function}}
 */
export function loadEventOrigin(deps) {
  const body = 'const { captureAllowed, findActivePromptInput, findPromptInputs } = arguments[0];\n'
    + region()
    + '\n  return { eventCameFrom, governedPromptInput };';
  // eslint-disable-next-line no-new-func
  return new Function(body)(deps);
}

// ── Minimal nodes: containment and a composed path, nothing else ─────────────

export function node(name, children = []) {
  const n = {
    name,
    children,
    contains(other) {
      if (other === n) return true;
      return children.some((c) => c.contains && c.contains(other));
    },
  };
  return n;
}

/** An event whose composedPath is the chain from target up through ancestors. */
export function evt(target, pathChain = null) {
  return {
    target,
    composedPath: () => (pathChain === null ? [target] : pathChain),
  };
}

/** An event with NO composedPath — exercises the contains() fallback. */
export function legacyEvt(target) {
  return { target };
}
