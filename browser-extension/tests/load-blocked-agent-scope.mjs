// Loads the REAL blocked-agent enforcement region out of content/content.js and
// drives it against the REAL AI-surface scope gate from the same file.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as every other load-*.mjs here:
// content.js is one classic-script IIFE that touches document/chrome/window at
// load time and cannot be evaluated whole in Node.
//
// WHY captureAllowed IS NOT STUBBED. The defect being pinned down is precisely
// "the per-agent block ignores the panel boundary". Stubbing the boundary would
// test a paraphrase of it. So the fixture below builds one fake DOM, hands it to
// loadSurfaceScope() to get the shipped captureAllowed()/aiPanels() for a given
// hostname, and hands that same function to the enforcement region — exactly the
// wiring the shipped IIFE has, where both regions are closures over one document.
//
// The region's free variables are the seven injected below. If it grows an
// eighth, this loader throws a ReferenceError the moment a test calls it, which
// is the intended alarm: this region decides how much of a customer's app a
// single blocked bot is allowed to disable.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadSurfaceScope, el as baseEl, doc as baseDoc } from './load-surface-scope.mjs';

const START = '// ── blocked-agent enforcement scope ─';
const END = '// ── end blocked-agent enforcement scope ─';

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
  if (to <= from) throw new Error('content.js blocked-agent-scope sentinels are out of order');
  return src.slice(from, to);
}

// ── The fake DOM ────────────────────────────────────────────────────────────
//
// Built on load-surface-scope.mjs's el()/doc() so the scope gate under test sees
// the same node objects it already has tests against — matches(), contains(),
// getClientRects() and the shadow hop are that file's, unmodified. Enforcement
// additionally mutates nodes, so the decoration here adds only the mutable parts
// a real element has: style, dataset, attribute setters, closest(), and a
// document-level addEventListener that records capture-phase handlers.

function walk(node, out = []) {
  for (const c of node.children || []) { out.push(c); walk(c, out); }
  return out;
}

function decorate(node) {
  node.style = { pointerEvents: '', opacity: '' };
  node.dataset = {};
  node.textContent = node.textContent || '';
  // className and the class ATTRIBUTE are one thing in a real element, and the
  // two regions under test read it both ways — `.cfai-block-modal` (className in
  // the base fake) and `[class*="composer"]` (the attribute). Keeping them in
  // sync here means a fixture cannot accidentally pass by being invisible to one
  // of the two selector forms.
  if (node.className && !('class' in node.attrs)) node.attrs.class = String(node.className);
  if (!node.className && typeof node.attrs.class === 'string') node.className = node.attrs.class;
  Object.defineProperty(node, 'parentElement', {
    configurable: true,
    get: () => (node.parent && node.parent.nodeType === 1 ? node.parent : null),
  });
  node.setAttribute = (k, v) => {
    node.attrs[k] = String(v);
    if (k === 'class') node.className = String(v);
  };
  node.removeAttribute = (k) => { delete node.attrs[k]; };
  node.getAttribute = (k) => (k in node.attrs ? node.attrs[k] : null);
  // A comma-list closest(), because the shipped code calls it with one:
  // `MODAL_HOST_SELECTOR + ', .cfai-toast'` and `'button, [role="button"]'`.
  // matches() in the base fake is single-selector only, so the split is here.
  node.closest = (selector) => {
    const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
    let n = node;
    while (n && n.nodeType === 1) {
      if (parts.some((p) => n.matches(p))) return n;
      n = n.parent || null;
    }
    return null;
  };
  return node;
}

/** An element, with everything both regions under test need. */
export function el(spec = {}) {
  return decorate(baseEl(spec));
}

/** A document whose whole tree is decorated, plus a capture-handler registry. */
export function doc(children = []) {
  const root = baseDoc(children);
  for (const n of walk(root)) decorate(n);
  root.handlers = { keydown: [], click: [] };
  root.addEventListener = (type, fn, capture) => {
    if (!capture) throw new Error(`enforcement must install ${type} at capture phase`);
    (root.handlers[type] || (root.handlers[type] = [])).push(fn);
  };
  return root;
}

/** A DOM event as the capture-phase handlers read it. */
export function evt(target, over = {}) {
  const e = {
    key: 'Enter',
    shiftKey: false,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { e.defaultPrevented = true; },
    stopPropagation() { e.propagationStopped = true; },
    stopImmediatePropagation() { e.propagationStopped = true; },
    ...over,
  };
  return e;
}

/**
 * Instantiate enforcement as if content.js had just been injected into `host`.
 *
 * @param {object} opts
 *  - host:     window.location.hostname (decides whole_site vs embedded_ai)
 *  - document: a doc() from this module
 *  - agent:    what isBlockedAgentActive() returns (null ⇒ nothing blocked)
 *  - ownUi:    backs isCfaiOwnUiEvent(e); default "never ours"
 * @returns {{
 *   enforceBlockedAgent: Function,
 *   captureAllowed: Function,
 *   IS_EMBEDDED_AI: boolean,
 *   keydown: Function,          // fire the installed capture handler
 *   click: Function,
 *   popups: object[],           // every showBlockedAgentPopup() arg, in order
 * }}
 */
export function loadBlockedAgentScope(opts = {}) {
  const document = opts.document || doc([]);
  const scope = loadSurfaceScope(opts.host || 'teams.microsoft.com', document, opts.synced);
  const popups = [];
  const state = { agent: opts.agent === undefined ? null : opts.agent };

  const body = region() + '\n  return { enforceBlockedAgent };';
  // eslint-disable-next-line no-new-func
  const api = new Function(
    'document', 'isBlockedAgentActive', 'MODAL_HOST_SELECTOR', 'captureAllowed',
    '_blockEnforcerInstalled', 'isCfaiOwnUiEvent', 'showBlockedAgentPopup',
    body,
  )(
    document,
    () => state.agent,
    '.cfai-block-host, .cfai-block-modal',
    scope.captureAllowed,
    false,
    opts.ownUi || (() => false),
    (agent) => { popups.push(agent); },
  );

  const fire = (type, e) => {
    for (const fn of document.handlers[type] || []) fn(e);
    return e;
  };

  return {
    ...api,
    captureAllowed: scope.captureAllowed,
    aiPanels: scope.aiPanels,
    IS_EMBEDDED_AI: scope.IS_EMBEDDED_AI,
    document,
    state,
    popups,
    keydown: (e) => fire('keydown', e),
    click: (e) => fire('click', e),
  };
}

/** True if enforcement has this element disabled right now. */
export function isDisabled(node) {
  return node.style.pointerEvents === 'none'
    && node.dataset.cfaiBlocked === '1'
    && node.attrs['aria-disabled'] === 'true';
}

/** True if enforcement left this element completely alone. */
export function isUntouched(node) {
  return node.style.pointerEvents === ''
    && node.style.opacity === ''
    && !('cfaiBlocked' in node.dataset)
    && !('aria-disabled' in node.attrs);
}
