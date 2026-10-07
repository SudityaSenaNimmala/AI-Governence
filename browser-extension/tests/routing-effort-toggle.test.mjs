// Gemini "Extended thinking" follows prompt complexity (browser extension).
//
// Live 2026-10-07: routing switched Gemini's MODEL but never touched "Extended
// thinking", so the button read "Flash Extended" and complex prompts looked
// like they landed on "flash extended". The toggle is now Gemini's effort axis
// (shared catalog hosts["gemini.google.com"].effort, kind 'toggle'):
//   simple -> 3.5 Flash-Lite OFF, moderate -> 3.6 Flash OFF, complex -> 3.1 Pro ON.
// Mirrors agent/tests/enforcer-route-effort-toggle.test.mjs. Driven on shipped
// code: content.js's routing region + the shared bundle + the real classifier
// (tests/load-routing-flow.mjs; its Gemini menu fake is `toggleMenu`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadRoutingFlow } from './load-routing-flow.mjs';

const SIMPLE = 'thanks';
const MODERATE = 'explain what an API is';
const COMPLEX = 'Write a literature review on transformer models and cite sources';

// What the button reads after a model click (the toggle suffix rides along in the fake).
const GEMINI = {
  '3.5 Flash-Lite': 'Flash-Lite',
  '3.6 Flash': 'Flash',
  '3.1 Pro': 'Pro',
};

function gemini(buttonText, toggleMenu = {}, extra = {}) {
  const flow = loadRoutingFlow({
    host: 'gemini.google.com', pathname: '/app/abc', buttonText,
    onSwitch: (label) => GEMINI[label] || null,
    toggleMenu,
    ...extra,
  });
  flow.observePicker();
  return flow;
}
// Until the ONE model_routed event is out (bounded), then a little more so any
// late second event or send would show up.
const settleLong = async (flow) => {
  for (let i = 0; i < 8 && !flow.env.events.some((e) => e.kind === 'model_routed'); i++) await flow.settle();
  await flow.settle();
};

test('reading: the "Extended" suffix is the toggle (on = high, off = low); the tier read is unchanged', () => {
  const on = gemini('Flash Extended');
  assert.deepEqual([on.readPickerState().tier, on.readPickerState().effort], ['standard', 'high']);
  const off = gemini('Flash-Lite');
  assert.deepEqual([off.readPickerState().tier, off.readPickerState().effort], ['economy', 'low']);
  const pro = gemini('Pro');
  assert.deepEqual([pro.readPickerState().tier, pro.readPickerState().effort], ['premium', 'low']);
});

test('decisions: simple / moderate -> OFF, complex -> ON, on every tier', () => {
  const cases = [
    ['Flash Extended', SIMPLE, 'economy', 'low', 'downgrade'],
    ['Pro Extended', MODERATE, 'standard', 'low', 'downgrade'],
    ['Flash', COMPLEX, 'premium', 'high', 'upgrade'],
    ['Flash Extended', MODERATE, 'standard', 'low', 'effort_only'],
    ['Pro', COMPLEX, 'premium', 'high', 'effort_only'],
  ];
  for (const [btn, text, tier, effort, reason] of cases) {
    const d = gemini(btn).routeDecisionFor(text).decision;
    assert.equal(d.result, 'routed', `${btn} / ${text}`);
    assert.equal(d.target_tier, tier, `${btn} / ${text}`);
    assert.equal(d.effort, effort, `${btn} / ${text}`);
    assert.equal(d.reason, reason, `${btn} / ${text}`);
  }
  // Model AND toggle already right: noop, nothing paused.
  for (const [btn, text] of [['Flash', MODERATE], ['Pro Extended', COMPLEX], ['Flash-Lite', SIMPLE]]) {
    const flow = gemini(btn);
    const { r, paused } = flow.send(text);
    assert.equal(r.decision.result, 'noop', `${btn} / ${text}`);
    assert.equal(paused, false);
  }
});

test('model switch + toggle ON -> OFF in the SAME menu session: one model click, one toggle click, no reopen', async () => {
  const flow = gemini('Pro Extended');
  const { r, paused } = flow.send(SIMPLE);
  assert.equal(paused, true);
  assert.equal(r.decision.effort, 'low');
  await settleLong(flow);
  assert.deepEqual(flow.env.switchCalls, ['3.5 Flash-Lite']);
  assert.equal(flow.env.keptOpen, 1, 'the switch left the menu showing for the toggle');
  assert.equal(flow.env.menuOpens, 0, 'no second menu session');
  assert.equal(flow.env.toggleClicks, 1);
  assert.equal(flow.env.button.textContent, 'Flash-Lite');
  assert.equal(flow.env.menuState, null, 'no menu left open');
  assert.equal(flow.env.sent, 1, 'exactly one send');
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'applied');
  assert.equal(ev.effort_from, 'high');
  assert.equal(ev.effort_to, 'low');
});

test('model switch + toggle OFF -> ON for a complex prompt (3.1 Pro + Extended thinking)', async () => {
  const flow = gemini('Flash');
  flow.send(COMPLEX);
  await settleLong(flow);
  assert.deepEqual(flow.env.switchCalls, ['3.1 Pro']);
  assert.equal(flow.env.toggleClicks, 1);
  assert.equal(flow.env.button.textContent, 'Pro Extended');
  const ev = flow.env.events.at(-1);
  assert.deepEqual([ev.result, ev.to_tier, ev.effort_from, ev.effort_to], ['applied', 'premium', 'low', 'high']);
  assert.equal(flow.env.sent, 1);
  assert.equal(flow.env.menuState, null);
});

test('toggle-only: model already right, toggle wrong -> routed effort_only, menu opened once, closed after, one send', async () => {
  const flow = gemini('Flash Extended');
  const { r, paused } = flow.send(MODERATE);
  assert.equal(r.decision.reason, 'effort_only');
  assert.equal(paused, true, 'a toggle-only change is not a noop any more');
  await settleLong(flow);
  assert.deepEqual(flow.env.switchCalls, [], 'no model click');
  assert.equal(flow.env.menuOpens, 1);
  assert.equal(flow.env.toggleClicks, 1);
  assert.equal(flow.env.button.textContent, 'Flash');
  assert.equal(flow.env.menuState, null, 'never leaves the menu open');
  assert.equal(flow.env.sent, 1);
  const ev = flow.env.events.at(-1);
  assert.deepEqual([ev.result, ev.reason, ev.effort_from, ev.effort_to], ['applied', 'effort_only', 'high', 'low']);
});

test('verify via the menu row\'s aria-checked when it carries one; Material closing the menu on click is fine', async () => {
  const flow = gemini('Pro', { aria: true, closeOnClick: true });
  flow.send(COMPLEX);
  await settleLong(flow);
  assert.equal(flow.env.toggleClicks, 1);
  assert.equal(flow.env.button.textContent, 'Pro Extended');
  assert.equal(flow.env.events.at(-1).effort_to, 'high');
  assert.equal(flow.env.menuState, null);
});

test('a toggle click that does not take is NEVER repeated; reported failed with what actually applies; prompt sent once', async () => {
  const flow = gemini('Flash Extended', { clickWorks: false });
  flow.send(MODERATE);
  await settleLong(flow);
  assert.equal(flow.env.toggleClicks, 1, 'a second click would undo the first');
  assert.equal(flow.env.menuState, null);
  assert.equal(flow.env.sent, 1);
  const ev = flow.env.events.at(-1);
  assert.equal(ev.result, 'failed');
  assert.equal(ev.reason, 'effort_not_applied');
  assert.equal(ev.effort_to, 'high');
});

test('Claude is unaffected: no toggle config, moderate leaves effort alone', () => {
  const flow = loadRoutingFlow({ host: 'claude.ai', pathname: '/chat/c', buttonText: 'Opus 5.5 High', onSwitch: () => null });
  flow.observePicker();
  const d = flow.routeDecisionFor(MODERATE).decision;
  assert.equal(d.target_tier, 'standard');
  assert.equal(d.effort, null);
  assert.equal(flow.readPickerState().effort, 'high', 'the trailing effort token is read as before');
});

test('content.js SOURCE: the toggle is clicked once, the switch keeps the menu only for it, and every path closes menus', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '..', 'content', 'content.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function setEffortToggleInUI('), src.indexOf('function showSuggestionToast('));
  assert.equal((fn.match(/item\.click\(\)/g) || []).length, 1, 'exactly one toggle click site');
  assert.ok(/try \{ await closeOpenMenus\(\); \} catch \{\}\s*_modelBtnCache = null;/.test(fn), 'menus closed on the way out');
  assert.ok(fn.includes('routeCancelToken()'), 'honours the watchdog cancel token');
  assert.ok(src.includes('changeModelInUI(label, { keepMenuOpen })'));
  assert.ok(src.includes('if (anyModelMenuOpen() && !(keepMenuOpen && landed)) await closeOpenMenus();'));
});
