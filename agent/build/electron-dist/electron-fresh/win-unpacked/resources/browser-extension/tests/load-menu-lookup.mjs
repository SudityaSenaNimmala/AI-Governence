// Loads the REAL "which element is this model option" region out of
// content/content.js, so the menu lookup is tested against shipped code.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as load-model-router.mjs and the
// other loaders here: content.js is one giant classic-script IIFE that touches
// document/chrome/window at load time and cannot be evaluated whole in Node.
//
// This region's only free variable is `document`, so the loader hands in a fake
// one. That is the entire dependency — which is what makes the region worth
// slicing rather than mocking a browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Model-menu option lookup ─';
const END = '// ── end model-menu option lookup ─';

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
  if (to <= from) throw new Error('content.js menu-lookup sentinels are out of order');
  return src.slice(from, to);
}

/**
 * Instantiate the region against a fake document.
 * @returns {{findClickableByText:Function, isVisibleEl:Function, visibleMenuOptions:Function}}
 */
export function loadMenuLookup(fakeDocument) {
  const body = 'const document = arguments[0];\n' + region()
    + '\n  return { findClickableByText, isVisibleEl, visibleMenuOptions, MENU_CONTAINER_SELECTOR };';
  // eslint-disable-next-line no-new-func
  return new Function(body)(fakeDocument);
}

// ── A DOM small enough to reason about, real enough to exercise the rules ────
//
// Nodes are plain objects. `matches` is a substring test over a comma-separated
// selector list, which is all the region asks of a selector — deliberately not a
// selector engine, so the test cannot pass because of a clever fake.

export function el(spec) {
  const node = {
    nodeType: 1,
    tag: spec.tag || 'div',
    text: spec.text || '',
    role: spec.role || null,
    className: spec.className || '',
    attrs: spec.attrs || {},
    children: spec.children || [],
    visible: spec.visible !== false,
    clicked: 0,
  };
  node.textContent = node.text || node.children.map((c) => c.textContent).join(' ');
  node.click = () => { node.clicked++; };
  node.getAttribute = (k) => {
    if (k === 'aria-hidden') return node.attrs['aria-hidden'] ?? null;
    if (k === 'hidden') return node.attrs.hidden ?? null;
    if (k === 'role') return node.role;
    return node.attrs[k] ?? null;
  };
  node.hasAttribute = (k) => node.getAttribute(k) !== null;
  // Hidden nodes report no boxes, exactly as a display:none element does.
  node.getClientRects = () => (node.visible ? [{ width: 10, height: 10 }] : []);
  node.getBoundingClientRect = () => (node.visible
    ? { width: 10, height: 10 }
    : { width: 0, height: 0 });
  node.matches = (selector) => selector.split(',').some((raw) => {
    const s = raw.trim();
    if (s.startsWith('[role="')) return node.role === s.slice(7, -2);
    if (s.startsWith('[') && s.endsWith(']')) return node.hasAttribute(s.slice(1, -1));
    if (s.startsWith('.')) return String(node.className).split(/\s+/).includes(s.slice(1));
    return node.tag === s;
  });
  node.querySelectorAll = (selector) => descendants(node).filter((d) => selector === '*' || d.matches(selector));
  return node;
}

function descendants(node) {
  const out = [];
  for (const c of node.children) { out.push(c); out.push(...descendants(c)); }
  return out;
}

export function doc(children) {
  const root = el({ tag: '#document', children });
  root.nodeType = 9;
  return root;
}
