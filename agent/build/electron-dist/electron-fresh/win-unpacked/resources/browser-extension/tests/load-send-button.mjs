// Loads the REAL "is this the send button" region out of content/content.js, so
// the rules are tested against shipped code rather than a paraphrase.
//
// WHY A SLICE AND NOT AN IMPORT. Same reason as the other load-*.mjs loaders:
// content.js is one classic-script IIFE that touches document/chrome/window at
// load time and cannot be evaluated whole in Node.
//
// This region has no free variables at all — it reads everything off the button
// object it is handed — which is what makes it worth slicing rather than mocking
// a browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const START = '// ── Send-button identification ─';
const END = '// ── end send-button identification ─';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');

function region() {
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0) throw new Error(`content.js sentinel not found: ${START}`);
  if (to < 0) throw new Error(`content.js sentinel not found: ${END}`);
  if (to <= from) throw new Error('content.js send-button sentinels are out of order');
  return src.slice(from, to);
}

/** @returns {{looksLikeSendButton:Function, isNonSendControl:Function, NON_SEND_LABEL:RegExp}} */
export function loadSendButton() {
  const body = region()
    + '\n  return { looksLikeSendButton, isNonSendControl, NON_SEND_LABEL };';
  // eslint-disable-next-line no-new-func
  return new Function(body)();
}

// ── A button object shaped like the DOM asks, and no more ────────────────────
//
// The region only ever calls getAttribute, hasAttribute, querySelector, closest,
// and reads innerText / type / className / previousElementSibling /
// parentElement. Everything here backs exactly those, so a test cannot pass
// because the fake was generous.

/**
 * @param {object} spec
 *  - label/title/testid/name: the name-ish attributes
 *  - text: innerText
 *  - type: button type ("submit" self-identifies)
 *  - haspopup/expanded: presence of the menu-semantics attributes
 *  - svg: has an <svg> child; svgHtml: that svg's innerHTML
 *  - fileInput: wraps an <input type="file">
 *  - inComposer: closest() resolves the composer container
 *  - inFileLabel: closest('label') wraps a file input
 *  - nextToTextbox: previousElementSibling/parentElement contains the composer
 */
export function btn(spec = {}) {
  const attrs = {};
  if (spec.label !== undefined) attrs['aria-label'] = spec.label;
  if (spec.title !== undefined) attrs.title = spec.title;
  if (spec.testid !== undefined) attrs['data-testid'] = spec.testid;
  if (spec.name !== undefined) attrs.name = spec.name;
  if (spec.haspopup) attrs['aria-haspopup'] = spec.haspopup === true ? 'menu' : spec.haspopup;
  if (spec.expanded) attrs['aria-expanded'] = spec.expanded === true ? 'false' : spec.expanded;

  const svgNode = spec.svg || spec.svgHtml !== undefined
    ? { innerHTML: spec.svgHtml || '<path d="M2 21l21-9L2 3v7l15 2-15 2z"/>' }
    : null;

  const node = {
    innerText: spec.text || '',
    className: spec.className || '',
    type: spec.type || 'button',
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    querySelector: (sel) => {
      if (sel === 'svg') return svgNode;
      if (sel === 'input[type="file"]') return spec.fileInput ? { type: 'file' } : null;
      return null;
    },
    closest: (sel) => {
      if (sel === 'label') {
        return spec.inFileLabel
          ? { querySelector: (s) => (s === 'input[type="file"]' ? { type: 'file' } : null) }
          : null;
      }
      // Any composer-container selector; the region passes one long OR list.
      if (sel.includes('composer') || sel.includes('form')) return spec.inComposer ? {} : null;
      return null;
    },
  };

  const holder = spec.nextToTextbox
    ? { querySelector: (s) => (s.includes('textarea') ? { tag: 'textarea' } : null) }
    : { querySelector: () => null };
  node.previousElementSibling = null;
  node.parentElement = holder;
  return node;
}
