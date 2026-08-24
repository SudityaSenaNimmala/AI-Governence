// Loads the REAL AI-surface scope gate out of content/content.js, so the privacy
// guarantee is tested against shipped code rather than a reimplementation.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as the other loaders here: content.js
// is one giant classic-script IIFE that touches document/chrome/window at load
// time and cannot be evaluated whole in Node.
//
// This region's free variables are `document`, `chrome`, `window` and `console`,
// all injected below. It reads window.location.hostname AT EVALUATION TIME to
// decide the scope for the page, which is why the host is a parameter here: each
// call builds a fresh instance of the region as if the script had just been
// injected into that host.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── AI surface scope ─';
const END = '// ── end AI surface scope ─';

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
  if (to <= from) throw new Error('content.js surface-scope sentinels are out of order');
  return src.slice(from, to);
}

/**
 * Instantiate the gate as if content.js had just been injected into `host`.
 *
 * @param {string} host           window.location.hostname
 * @param {object} fakeDocument   must implement querySelectorAll(selector)
 * @param {object} [synced]       the server map, as chrome.storage would hold it
 * @returns {{captureAllowed:Function, aiPanels:Function, IS_EMBEDDED_AI:boolean,
 *            surfaceSelectorsForHost:Function, EMBEDDED_AI_FLOOR:object}}
 */
export function loadSurfaceScope(host, fakeDocument, synced) {
  const chrome = {
    storage: {
      local: {
        get(_keys, cb) { cb(synced ? { 'cfai.ai_surfaces': synced } : {}); },
      },
      onChanged: { addListener() {} },
    },
  };
  const win = { location: { hostname: host } };
  const quiet = { info() {}, warn() {}, log() {} };

  const body = region()
    + '\n  return { captureAllowed, aiPanels, IS_EMBEDDED_AI, surfaceSelectorsForHost, EMBEDDED_AI_FLOOR };';
  // eslint-disable-next-line no-new-func
  const run = new Function('document', 'chrome', 'window', 'console', body);
  return run(fakeDocument, chrome, win, quiet);
}

// ── A DOM small enough to reason about ──────────────────────────────────────
//
// `matches` is a substring/attribute test over the selector forms this region
// actually uses — attribute-contains, id, and tag. Deliberately not a selector
// engine, so a test cannot pass because the fake was clever.

function walk(node, out = []) {
  for (const c of node.children) { out.push(c); walk(c, out); }
  return out;
}

export function el(spec = {}) {
  const node = {
    nodeType: 1,
    tag: spec.tag || 'div',
    id: spec.id || '',
    className: spec.className || '',
    attrs: spec.attrs || {},
    children: spec.children || [],
    visible: spec.visible !== false,
    shadowHost: null,
  };
  for (const c of node.children) c.parent = node;
  // VISIBILITY CASCADES, as in a real DOM: a descendant of a display:none node
  // reports no client rects either. Without this the fake lets an element inside
  // a collapsed panel look visible, which is precisely the case the gate has to
  // reject — the fake would have quietly certified the wrong behaviour.
  node.getClientRects = () => {
    let n = node;
    while (n) {
      if (n.visible === false) return [];
      n = n.parent || null;
    }
    return [{ width: 20, height: 20 }];
  };
  node.contains = (other) => {
    let n = other;
    while (n) { if (n === node) return true; n = n.parent || null; }
    return false;
  };
  // A shadow root reports its host, which is how the gate hops out of one.
  node.getRootNode = () => (node.shadowHost ? { host: node.shadowHost } : { host: null });
  node.matches = (selector) => {
    const s = selector.trim();
    let m = /^\[([a-zA-Z-]+)\*=\s*"([^"]+)"\s*i?\]$/.exec(s);
    if (m) {
      const v = node.attrs[m[1]];
      return typeof v === 'string' && v.toLowerCase().includes(m[2].toLowerCase());
    }
    m = /^\[([a-zA-Z-]+)\]$/.exec(s);
    if (m) return m[1] in node.attrs;
    if (s.startsWith('#')) return node.id === s.slice(1);
    if (s.startsWith('.')) return String(node.className).split(/\s+/).includes(s.slice(1));
    // `[contenteditable]:not([contenteditable="false"])` — the composer selector
    // uses it, so the fake has to understand the negation rather than silently
    // never matching, which would make every composer test pass for free.
    m = /^\[contenteditable\]:not\(\[contenteditable="false"\]\)$/.exec(s);
    if (m) return 'contenteditable' in node.attrs && node.attrs.contenteditable !== 'false';
    m = /^\[([a-zA-Z-]+)="([^"]+)"\]$/.exec(s);
    if (m) return node.attrs[m[1]] === m[2];
    return node.tag === s;
  };
  // The composer test asks whether a panel CONTAINS an input, so an element needs
  // to be able to search its own subtree, not just the document.
  node.querySelectorAll = (selector) => {
    const parts = selector.split(',').map((x) => x.trim()).filter(Boolean);
    return walk(node).filter((d) => selector === '*' || parts.some((x) => d.matches(x)));
  };
  node.querySelector = (selector) => node.querySelectorAll(selector)[0] || null;
  return node;
}


export function doc(children = []) {
  const root = el({ tag: '#document', children });
  root.nodeType = 9;
  root.querySelectorAll = (selector) => {
    const parts = selector.split(',').map((p) => p.trim()).filter(Boolean);
    return walk(root).filter((n) => parts.some((p) => n.matches(p)));
  };
  return root;
}
