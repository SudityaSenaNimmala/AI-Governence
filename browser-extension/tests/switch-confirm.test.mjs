// Claude's own "Switch model?" confirmation dialog, on claude.ai.
//
// Live 2026-10-05 (Claude Desktop, which renders claude.ai): in an EXISTING
// conversation on "Opus 5.5 Medium", selecting Sonnet in the picker did not
// switch. Claude opened a modal -- title "Switch model?", body "...This task is
// cached for the current model...", buttons "Cancel" and "Switch to Sonnet 5.5"
// (focused) -- and the route stalled with the message unsent. Routing must
// switch automatically: the "Switch to <target>" button is clicked; a dialog
// that cannot be confirmed is dismissed so the paused prompt still goes once.
//
// Driven against the REAL region of content.js (tests/load-menu-lookup.mjs) and
// the REAL catalog signature (shared/model-catalog.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadMenuLookup, contentSource, el, doc } from './load-menu-lookup.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(path.join(here, '..', '..', 'shared', 'model-catalog.json'), 'utf8'));
const CFG = catalog.hosts['claude.ai'].confirm_dialog;
const SONNET = ['Sonnet 5.5'];
const FAST = { appearMs: 120, settleMs: 200, stepMs: 5, reclickMs: 40 };

/** The live dialog, as a fake DOM. `onConfirm` runs when "Switch to ..." is clicked. */
function liveDialog({ confirmText = 'Switch to Sonnet 5.5', withCancel = true, title = 'Switch model?', visible = true } = {}) {
  const heading = el({ tag: 'h2', text: title });
  const body = el({ tag: 'p', text: 'Your next response will be slower and use more tokens. This task is cached for the current model.' });
  const cancel = withCancel ? el({ tag: 'button', text: 'Cancel' }) : null;
  const confirm = confirmText ? el({ tag: 'button', text: confirmText }) : null;
  const dialog = el({ role: 'dialog', visible, children: [heading, body, ...(cancel ? [cancel] : []), ...(confirm ? [confirm] : [])] });
  return { dialog, cancel, confirm };
}

test('catalog: claude.ai declares the dialog signature', () => {
  assert.equal(CFG.button_name_prefix, 'Switch to ');
  assert.equal(CFG.title_contains, 'Switch model');
  assert.equal(CFG.cancel_button_name, 'Cancel');
  for (const h of ['chatgpt.com', 'gemini.google.com', 'perplexity.ai']) assert.equal(catalog.hosts[h].confirm_dialog, undefined, h);
});

test('label boundary: "Sonnet 5" never matches "Sonnet 5.5"; "Sonnet 5.5" and the family do', () => {
  const { confirmLabelHit, confirmButtonMatches } = loadMenuLookup(doc([]));
  assert.equal(confirmLabelHit('Sonnet 5.5', 'Sonnet 5'), false);
  assert.equal(confirmLabelHit('Sonnet 5.5', 'Sonnet 5.5'), true);
  assert.equal(confirmLabelHit('Sonnet 5.5', 'Sonnet'), true);
  assert.equal(confirmButtonMatches('Switch to Sonnet 5.5', 'Switch to ', ['Sonnet 5.5']), true);
  assert.equal(confirmButtonMatches('Switch to Sonnet 5.5', 'Switch to ', ['Sonnet 5']), true, 'by family');
  assert.equal(confirmButtonMatches('Switch to Opus 5.5', 'Switch to ', ['Sonnet 5.5']), false);
  assert.equal(confirmButtonMatches('Cancel', 'Switch to ', ['Sonnet 5.5']), false);
  assert.equal(confirmButtonMatches('Switch toSonnet', 'Switch to ', ['Sonnet']), false);
});

test('findSwitchConfirm: the live dialog yields its "Switch to Sonnet 5.5" and its Cancel', () => {
  const d = liveDialog();
  const { findSwitchConfirm } = loadMenuLookup(doc([d.dialog]));
  const f = findSwitchConfirm(CFG, SONNET);
  assert.equal(f.confirm, d.confirm);
  assert.equal(f.cancel, d.cancel);
});

test('findSwitchConfirm: a dialog naming ANOTHER model has no confirm; closed or unrelated dialogs are not it', () => {
  const wrong = liveDialog({ confirmText: 'Switch to Opus 5.5' });
  let f = loadMenuLookup(doc([wrong.dialog])).findSwitchConfirm(CFG, SONNET);
  assert.ok(f, 'the dialog is recognised by its title');
  assert.equal(f.confirm, null);
  assert.equal(f.cancel, wrong.cancel);

  assert.equal(loadMenuLookup(doc([liveDialog({ visible: false }).dialog])).findSwitchConfirm(CFG, SONNET), null);

  const other = el({ role: 'dialog', children: [el({ tag: 'h2', text: 'Settings' }), el({ tag: 'button', text: 'Switch to dark mode' })] });
  assert.equal(loadMenuLookup(doc([other])).findSwitchConfirm(CFG, SONNET), null, 'an unrelated "Switch to" dialog is ignored');

  const loose = el({ tag: 'button', text: 'Switch to Sonnet 5.5' });   // not inside any dialog
  assert.equal(loadMenuLookup(doc([loose])).findSwitchConfirm(CFG, SONNET), null);
});

test('confirmModelSwitch: dialog appears -> "Switch to Sonnet 5.5" clicked ONCE -> confirmed; Cancel never touched', async () => {
  const d = liveDialog();
  d.dialog.visible = false;
  let switched = false;
  d.confirm.click = () => { d.confirm.clicked++; d.dialog.visible = false; switched = true; };
  const { confirmModelSwitch } = loadMenuLookup(doc([d.dialog]));
  setTimeout(() => { d.dialog.visible = true; }, 15);   // Claude renders it shortly after the menu click
  const out = await confirmModelSwitch(CFG, SONNET, () => switched, FAST);
  assert.equal(out, 'confirmed');
  assert.equal(d.confirm.clicked, 1);
  assert.equal(d.cancel.clicked, 0);
});

test('confirmModelSwitch: no dialog (new conversation) -> switched or no_dialog, bounded, nothing clicked', async () => {
  const { confirmModelSwitch } = loadMenuLookup(doc([]));
  assert.equal(await confirmModelSwitch(CFG, SONNET, () => true, FAST), 'switched');
  const t0 = Date.now();
  assert.equal(await confirmModelSwitch(CFG, SONNET, () => false, FAST), 'no_dialog');
  assert.ok(Date.now() - t0 < 1000, 'bounded by appearMs');
});

test('confirmModelSwitch: a dialog that will not confirm -> two clicks, then Cancel -> not_confirmed', async () => {
  const d = liveDialog();
  d.cancel.click = () => { d.cancel.clicked++; d.dialog.visible = false; };
  const { confirmModelSwitch } = loadMenuLookup(doc([d.dialog]));
  const out = await confirmModelSwitch(CFG, SONNET, () => false, FAST);
  assert.equal(out, 'not_confirmed');
  assert.equal(d.confirm.clicked, 2, 'bounded retries');
  assert.equal(d.cancel.clicked, 1, 'dismissed exactly once');
  assert.equal(d.dialog.visible, false, 'the user is never left with the modal up');
});

test('confirmModelSwitch: a dialog naming another model is dismissed, its button never clicked', async () => {
  const d = liveDialog({ confirmText: 'Switch to Opus 5.5' });
  const { confirmModelSwitch } = loadMenuLookup(doc([d.dialog]));
  assert.equal(await confirmModelSwitch(CFG, SONNET, () => false, FAST), 'not_confirmed');
  assert.equal(d.confirm.clicked, 0);
  assert.equal(d.cancel.clicked, 1);
});

test('confirmModelSwitch: no Cancel button -> Escape', async () => {
  const d = liveDialog({ confirmText: 'Switch to Opus 5.5', withCancel: false });
  const root = doc([d.dialog]);
  const sent = [];
  root.dispatchEvent = (ev) => { sent.push(ev); d.dialog.visible = false; };
  const hadKE = 'KeyboardEvent' in globalThis;
  const prev = globalThis.KeyboardEvent;
  globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  try {
    const { confirmModelSwitch } = loadMenuLookup(root);
    assert.equal(await confirmModelSwitch(CFG, SONNET, () => false, FAST), 'not_confirmed');
  } finally {
    if (hadKE) globalThis.KeyboardEvent = prev; else delete globalThis.KeyboardEvent;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, 'Escape');
});

test('content.js SOURCE: changeModelInUI confirms after the menu click and reports a declined dialog', () => {
  const src = contentSource();
  const start = src.indexOf('async function changeModelInUI(');
  const fn = src.slice(start, src.indexOf('function showRoutingToast(', start));
  const clickAt = fn.indexOf('targetEl.click();');
  const confirmAt = fn.indexOf('confirmModelSwitch(confirmCfg');
  assert.ok(clickAt > 0 && confirmAt > clickAt, 'the dialog is handled after the menu item click');
  assert.ok(/routingConfirmDialogCfg\(\)/.test(fn), 'only when the catalog declares it for this host');
  assert.ok(/'not_confirmed'[\s\S]{0,200}return SWITCH_CONFIRM_DECLINED/.test(fn));
  assert.ok(!/Enter/.test(fn.slice(confirmAt, fn.indexOf('// Verify', confirmAt))), 'the confirm path never presses Enter');
});
