// Gemini "Extended thinking" follows prompt complexity (desktop agent web arm).
//
// Live 2026-10-07 (agent 6323ae9 / version 1f88c414): routing switched Gemini's
// MODEL correctly but never touched "Extended thinking", so the button read
// "Flash Extended" and complex prompts looked like they landed on "flash
// extended". Now the toggle is Gemini's effort axis (catalog
// hosts["gemini.google.com"].effort, kind 'toggle'):
//   simple   -> 3.5 Flash-Lite, Extended thinking OFF
//   moderate -> 3.6 Flash,      Extended thinking OFF
//   complex  -> 3.1 Pro,        Extended thinking ON
// set in the SAME menu session as the model switch, or on its own (a
// toggle-only route) when the model is already right.
//
// Driven through tests/helpers/route-effort-toggle-harness.ps1 (the REAL C#,
// compiled out of the .ps1, called by reflection; no hook, no window).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'route-effort-toggle-harness.ps1');
const CATALOG = join(AGENT_DIR, '..', 'shared', 'model-catalog.json');

const win = process.platform === 'win32';
const winOnly = { skip: !win && 'harness compiles the enforcer C# and needs Windows PowerShell' };

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', HARNESS, '-Ps1', ENFORCER, '-Catalog', CATALOG,
    ], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const rows = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      if (!rows.some((r) => r.t === 'done')) {
        reject(new Error(`harness did not complete (exit ${code})\n${err}\n${out}`));
        return;
      }
      resolve(rows);
    });
  });
  return cached;
}

const one = (rows, t, c) => {
  const hit = rows.filter((r) => r.t === t && r.case === c);
  assert.equal(hit.length, 1, `expected exactly one ${t}/${c} row, got ${hit.length}`);
  return hit[0];
};

function sliceFn(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `could not find ${signature} in enforcer-win.ps1`);
  const openBrace = src.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`${signature} never closes`);
}
const stripComments = (s) => s.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

test('effort toggle: every new function exists in the enforcer C#', winOnly, async () => {
  const rows = await runHarness();
  for (const r of rows.filter((x) => x.t === 'has')) assert.ok(r.present, `${r.name} must exist`);
});

test('effort toggle: the button label\'s "Extended" suffix is the toggle state; the tier read is unchanged', winOnly, async () => {
  const rows = await runHarness();
  const at = (l) => rows.find((r) => r.t === 'labelstate' && r.label === l);
  assert.deepEqual([at('Open mode picker, currently Flash Extended').state, at('Open mode picker, currently Flash Extended').tier], [1, 'standard']);
  assert.deepEqual([at('Open mode picker, currently Flash').state, at('Open mode picker, currently Flash').tier], [0, 'standard']);
  assert.deepEqual([at('Open mode picker, currently Pro Extended').state, at('Open mode picker, currently Pro Extended').tier], [1, 'premium']);
  assert.deepEqual([at('Open mode picker, currently Flash-Lite').state, at('Open mode picker, currently Flash-Lite').tier], [0, 'economy']);
  assert.equal(at('Flash Extended').state, 1);
  // Boundary-matched: a longer word is not the suffix.
  assert.equal(at('Open mode picker, currently Flash Extendedx').state, 0);
  assert.equal(at('').state, -1);
  // Reported on the effort scale: on -> High, off -> Low (route-event.js lower-cases).
  assert.equal(at('Open mode picker, currently Flash Extended').effort, 'High');
  assert.equal(at('Open mode picker, currently Pro').effort, 'Low');
  assert.equal(at('').effort, '');
});

test('effort toggle: only gemini.google.com has a toggle; Claude\'s effort token is read exactly as before', winOnly, async () => {
  const rows = await runHarness();
  const cfg = (h) => rows.find((r) => r.t === 'togglecfg' && r.host === h).present;
  assert.equal(cfg('gemini.google.com'), true);
  assert.equal(cfg('claude.ai'), false);
  assert.equal(cfg('aistudio.google.com'), false);
  assert.equal(cfg('claude_desktop'), false);
  assert.equal(rows.find((r) => r.t === 'claudeeffort').effort, 'High');
});

test('effort toggle: the plan -- noop only when model AND toggle already match; a toggle-only change routes', winOnly, async () => {
  const rows = await runHarness();
  const plan = (c) => one(rows, 'plan', c).plan;
  assert.equal(plan('switch_and_toggle'), 'model+toggle');
  // A switch can carry the toggle with it: re-read in the same session, never assumed.
  assert.equal(plan('switch_toggle_already_ok'), 'model+toggle');
  assert.equal(plan('switch_no_toggle_surface'), 'model');
  assert.equal(plan('toggle_only_on_to_off'), 'toggle');
  assert.equal(plan('toggle_only_off_to_on'), 'toggle');
  assert.equal(plan('both_on_target_off'), 'none');
  assert.equal(plan('both_on_target_on'), 'none');
  // Nothing is clicked blind.
  assert.equal(plan('toggle_label_unreadable'), 'none');
  assert.equal(plan('no_toggle_on_target'), 'none');
});

test('effort toggle: on -> off after a model switch, in the SAME menu session (no reopen), menu closed after', winOnly, async () => {
  const rows = await runHarness();
  const r = one(rows, 'toggle', 'after_switch_menu_open_on_to_off');
  assert.equal(r.ok, true);
  assert.equal(r.activations, 1);
  assert.equal(r.opensCalled, 0, 'the menu was still showing: it must be reused, not reopened');
  assert.equal(r.toggleAtEnd, 0);
  assert.equal(r.stateAfter, 0);
  assert.equal(r.menuOpenAtEnd, false);
  // Material closed the menu on the model click: reopened once, toggled once, closed.
  const c = one(rows, 'toggle', 'after_switch_menu_closed_on_to_off');
  assert.deepEqual([c.ok, c.opened, c.opensCalled, c.activations, c.toggleAtEnd, c.menuOpenAtEnd], [true, true, 1, 1, 0, false]);
});

test('effort toggle: off -> on is verified by the "Extended" suffix appearing on the button label', winOnly, async () => {
  const rows = await runHarness();
  const r = one(rows, 'toggle', 'off_to_on_verified_by_suffix');
  assert.equal(r.ok, true);
  assert.equal(r.activations, 1);
  assert.equal(r.stateAfter, 1);
  assert.ok(r.elapsed >= 200 && r.elapsed < 1500, `verified when the label caught up, got ${r.elapsed}ms`);
  assert.equal(r.menuOpenAtEnd, false);
  // A label that only re-renders once the overlay is gone: verified after closing, fast.
  const late = one(rows, 'toggle', 'label_updates_only_after_close');
  assert.equal(late.ok, true);
  assert.equal(late.activations, 1);
  assert.ok(late.elapsed < 600, `closes after the grace and reads the label, got ${late.elapsed}ms`);
  assert.equal(late.menuOpenAtEnd, false);
});

test('effort toggle: toggle-only route (model already right) clicks once and leaves no menu', winOnly, async () => {
  const rows = await runHarness();
  const r = one(rows, 'toggle', 'toggle_only_on_to_off');
  assert.deepEqual([r.ok, r.activations, r.toggleAtEnd, r.menuOpenAtEnd], [true, 1, 0, false]);
});

test('effort toggle: already right -> NO click (and no open when the menu is closed)', winOnly, async () => {
  const rows = await runHarness();
  const a = one(rows, 'toggle', 'already_off_menu_closed');
  assert.deepEqual([a.ok, a.activations, a.opensCalled, a.closesCalled], [true, 0, 0, 0]);
  const b = one(rows, 'toggle', 'already_on_menu_open');
  assert.deepEqual([b.ok, b.activations, b.menuOpenAtEnd], [true, 0, false]);
  // The menu ITEM's state wins over a label that does not carry the suffix.
  const i = one(rows, 'toggle', 'item_state_wins_over_silent_label');
  assert.deepEqual([i.ok, i.activations, i.toggleAtEnd], [true, 1, 0]);
});

test('effort toggle: a click that does not take is NEVER repeated (a second click undoes the first) and is reported', winOnly, async () => {
  const rows = await runHarness();
  const r = one(rows, 'toggle', 'click_does_nothing');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'toggle_not_verified');
  assert.equal(r.activations, 1);
  assert.equal(r.menuOpenAtEnd, false);
  assert.ok(r.elapsed <= 1500, 'bounded by ROUTE_TOGGLE_VERIFY_MS, inside the 6s watchdog');
});

test('effort toggle: never leaves the menu open -- every failure closes it, and a menu that will not close is reported', winOnly, async () => {
  const rows = await runHarness();
  for (const c of ['item_missing', 'menu_will_not_open', 'click_does_nothing']) {
    const r = one(rows, 'toggle', c);
    assert.equal(r.menuOpenAtEnd, false, `${c}: menu left open`);
    assert.equal(r.closesCalled, 1, `${c}: CloseMenu must run`);
    assert.equal(r.ok, false);
  }
  assert.equal(one(rows, 'toggle', 'item_missing').reason, 'toggle_item_not_found');
  assert.equal(one(rows, 'toggle', 'menu_will_not_open').reason, 'toggle_menu_not_open');
  const stuck = one(rows, 'toggle', 'menu_will_not_close');
  assert.equal(stuck.closeReason, 'menu_still_open', 'a menu that will not close is surfaced to the route (no Enter into it)');
});

test('effort toggle: the pin -- a Gemini toggle-only change ARMS; Claude effort-only stays a noop', winOnly, async () => {
  const rows = await runHarness();
  const p = (c) => one(rows, 'pin', c);
  const a = p('gemini_moderate_flash_extended_toggle_only');
  assert.deepEqual([a.armed, a.reason, a.toTier, a.effort, a.targetEffort], [true, 'effort_only', 'standard', 'low', 'low']);
  const b = p('gemini_complex_pro_off_toggle_only');
  assert.deepEqual([b.armed, b.reason, b.toTier, b.effort], [true, 'effort_only', 'premium', 'high']);
  const n = p('gemini_moderate_flash_off_noop');
  assert.deepEqual([n.armed, n.reason], [false, 'already_on_target']);
  assert.deepEqual([p('gemini_complex_flash_extended_switch').toTier, p('gemini_complex_flash_extended_switch').effort], ['premium', 'high']);
  assert.deepEqual([p('gemini_simple_flash_extended_switch').toTier, p('gemini_simple_flash_extended_switch').effort], ['economy', 'low']);
  assert.deepEqual([p('claude_desktop_effort_only_still_noop').armed, p('claude_desktop_effort_only_still_noop').reason], [false, 'effort_unverified']);
  assert.deepEqual([p('claude_web_effort_only_still_noop').armed, p('claude_web_effort_only_still_noop').reason], [false, 'effort_unverified']);
});

test('SOURCE: RunWebRoute plans with WebRoutePlan, toggles after the switch and BEFORE the collapse / gate / one send', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const body = stripComments(sliceFn(src, 'static void RunWebRoute('));
  const plan = body.indexOf('WebRoutePlan(');
  const noop = body.indexOf('"already_on_target"');
  const expand = body.indexOf('.Expand()');
  const awaitSwitch = body.indexOf('RouteAwaitSwitch(');
  const toggle = body.indexOf('WebApplyEffortToggleUia(');
  const collapse = body.indexOf('WebCollapseMenuUia(pinnedHwnd, ctx)');
  const send = body.indexOf('WebSendAndReport(');
  assert.ok(plan > 0 && plan < noop && noop < expand, 'the noop (model AND toggle match) is decided before the picker opens');
  assert.ok(awaitSwitch > 0 && awaitSwitch < toggle, 'the toggle follows the model switch');
  assert.ok(toggle < collapse && collapse < send, 'toggle, then menu closed, then the one send');
  // A toggle-only route that cannot set the toggle sends once, unrouted.
  assert.match(body, /if \(!tierNeeded\)\s*\{ WebFallbackSendOrReport\([^;]*effortWhy, composerEl\); return; \}/);
});

test('SOURCE: the toggle item is activated through exactly ONE pattern', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const body = stripComments(sliceFn(src, 'static bool WebActivateToggleItem('));
  // Each pattern returns immediately; an exception after a call is "may have acted" -> true, never another pattern.
  assert.match(body, /TogglePattern\)p\)\.Toggle\(\); return true;/);
  assert.match(body, /InvokePattern\)p\)\.Invoke\(\); return true;/);
  assert.match(body, /catch \{ return true; \}/);
});

test('SOURCE: the pure toggle loop rethrows the watchdog\'s abandonment instead of swallowing it', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const body = stripComments(sliceFn(src, 'static RouteToggleOutcome RouteApplyEffortToggle('));
  assert.match(body, /catch \(RouteAbandonedException\) \{ throw; \}/);
  assert.ok(body.includes('RouteToggleClose(io, o, ref closed);'), 'the menu is closed on the way out');
});
