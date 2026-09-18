// Model-menu option lookup — which element a routed model name resolves to.
//
// THE REGRESSION THIS PINS DOWN. changeModelInUI() picked its target with a
// whole-document scan that took the SHORTEST text containing the model name,
// with no visibility check and no notion of an open menu. That is wrong exactly
// where it hurt: Gemini's target tier is named "Thinking", and Gemini also
// renders "Thinking" as a generation status while a reply streams. The status
// label is shorter than the menu row, so it won, got clicked, and nothing
// changed — 9 of 10 Gemini routings reported ui_changed:false in production
// while Claude managed 34 of 34.
//
// The rules now are: open menus first, invisible nodes never, and never the
// trigger button itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadMenuLookup, el, doc } from './load-menu-lookup.mjs';

test('a menu row beats a shorter status label with the same word', () => {
  // Gemini in the middle of answering: "Thinking" appears as a status, AND as a
  // row in the open model picker. The row must win even though it is longer.
  const status = el({ tag: 'span', text: 'Thinking' });
  const row = el({ tag: 'button', role: 'menuitem', text: '2.5 Pro Thinking' });
  const menu = el({ className: 'mat-mdc-menu-panel', children: [row] });
  const d = doc([status, menu]);

  const { findClickableByText } = loadMenuLookup(d);
  const hit = findClickableByText('Thinking');

  assert.equal(hit, row, 'picked the status label instead of the menu row');
  assert.notEqual(hit, status);
});

test('a closed dropdown yields nothing, though its rows are still in the DOM', () => {
  // A closed picker hides the panel AND the rows inside it — that is the state
  // the old whole-document scan happily clicked into.
  const hidden = el({ tag: 'button', role: 'menuitem', text: 'Thinking', visible: false });
  const menu = el({ role: 'menu', visible: false, children: [hidden] });
  const { findClickableByText } = loadMenuLookup(doc([menu]));
  assert.equal(findClickableByText('Thinking'), null);
});

test('aria-hidden and inert subtrees are skipped', () => {
  const ariaHidden = el({ tag: 'button', text: 'Thinking', attrs: { 'aria-hidden': 'true' } });
  const inert = el({ tag: 'button', text: 'Thinking', attrs: { inert: '' } });
  const { findClickableByText } = loadMenuLookup(doc([ariaHidden, inert]));
  assert.equal(findClickableByText('Thinking'), null);
});

test('the trigger button is never chosen as its own target', () => {
  // Tested on the FALLBACK path, where it actually bites: with a recognised menu
  // present the row wins on scope alone (see the first test), so the exclusion
  // only decides things when the search reaches the whole document — a platform
  // whose picker uses none of the standard roles. The trigger's own label
  // contains a model name, making it the shortest match, and clicking it just
  // closes the picker again.
  const trigger = el({ tag: 'button', text: 'Thinking' });
  const option = el({ tag: 'div', text: 'Thinking mode' });
  const { findClickableByText } = loadMenuLookup(doc([trigger, option]));

  assert.equal(findClickableByText('Thinking'), trigger, 'precondition: trigger wins on length');
  assert.equal(findClickableByText('Thinking', { exclude: trigger }), option);
});

test('falls back to the whole document when no standard menu container exists', () => {
  // Platforms that render a picker without any of the standard roles must still
  // work — the fallback is why this is a narrowing, not a restriction.
  const plain = el({ tag: 'div', text: 'GPT-4o' });
  const { findClickableByText } = loadMenuLookup(doc([plain]));
  assert.equal(findClickableByText('GPT-4o'), plain);
});

test('within one menu the most specific row still wins', () => {
  const row = el({ tag: 'span', text: 'Sonnet' });
  const wrapper = el({ tag: 'div', children: [row, el({ tag: 'span', text: 'extra copy here' })] });
  const menu = el({ role: 'menu', children: [wrapper] });
  const { findClickableByText } = loadMenuLookup(doc([menu]));
  assert.equal(findClickableByText('Sonnet'), row);
});

test('visibleMenuOptions reports what an open menu offered, for the failure log', () => {
  const menu = el({ role: 'menu', children: [
    el({ tag: 'button', role: 'menuitem', text: '2.5 Flash' }),
    el({ tag: 'button', role: 'menuitem', text: '2.5 Pro' }),
    el({ tag: 'button', role: 'menuitem', text: 'Hidden option', visible: false }),
  ] });
  const { visibleMenuOptions } = loadMenuLookup(doc([menu]));
  const offered = visibleMenuOptions();
  assert.deepEqual(offered, ['2.5 Flash', '2.5 Pro']);
});

test('no open menu reports nothing offered — the "picker never opened" signal', () => {
  const { visibleMenuOptions } = loadMenuLookup(doc([el({ tag: 'div', text: 'page content' })]));
  assert.deepEqual(visibleMenuOptions(), []);
});

// Gemini is Angular Material; without this class its picker is not recognised as
// a menu at all and the lookup falls back to the whole-document scan that caused
// the original bug.
test('the Angular Material panel class Gemini uses is a recognised container', () => {
  const { MENU_CONTAINER_SELECTOR } = loadMenuLookup(doc([]));
  assert.match(MENU_CONTAINER_SELECTOR, /mat-mdc-menu-panel/);
  for (const role of ['menu', 'listbox', 'dialog']) {
    assert.match(MENU_CONTAINER_SELECTOR, new RegExp(`\\[role="${role}"\\]`));
  }
});
