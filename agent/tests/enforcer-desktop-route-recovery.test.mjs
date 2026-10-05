// Desktop model routing (Claude Desktop, RunRoute) -- RECOVERY regressions.
//
// Live evidence (Windows, build 8788646, Claude Desktop, v2 policy synced, a
// moderate prompt on Opus correctly decided -> Sonnet). Every attempt failed:
//
//   element_changed_no_fallback_text_changed
//   route_or_rewrite_already_in_progress     (complexity null, tiers undefined)
//   interrupted_before_select_no_fallback_text_changed
//   switch_not_verified_no_fallback_text_changed
//
// Root causes pinned here:
//   1. The composer was identified by RuntimeId ALONE. Claude Desktop re-renders
//      it, so the same composer holding the same prompt read as "changed" -- and
//      the fallback reported that RuntimeId mismatch as "text_changed".
//   2. The fallback read FocusedElement as-is. After any picker interaction focus
//      is in the model menu, so the fallback NEVER sent: the user's Enter was
//      swallowed and nothing happened.
//   3. A held/second Enter while a route ran set _routeAbort (killing the route
//      mid-switch) and re-entered StartRoute, which emitted a route event with
//      empty tiers/complexity.
//   4. Verification polled ONE picker reference fetched once; a later re-render
//      leaves it reporting the pre-switch label until the deadline.
//   5. The poll thread's dedup kept the first tick's RuntimeId and never
//      refreshed the 15s TTL, so an untouched prompt's pin went stale/expired --
//      and an expired pin still ate the Enter.
//
// Driven through tests/helpers/desktop-route-recovery-harness.ps1 (the REAL C#,
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
const HARNESS = join(HERE, 'helpers', 'desktop-route-recovery-harness.ps1');
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
const present = (rows, name) => {
  const h = rows.find((r) => r.t === 'has' && r.name === name);
  assert.ok(h && h.present, `${name} must exist in the enforcer C#`);
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

// ── 1. the composer verdict ──────────────────────────────────────────────────

test('desktop route: a RE-RENDERED composer holding the same prompt is still the composer', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteComposerVerdict');
  for (const c of ['same_element_same_text', 'same_element_ws_zw_nbsp', 'rerendered_same_text', 'rerendered_ws_differs']) {
    const v = one(rows, 'verdict', c);
    assert.equal(v.ok, true, `${c}: must proceed, got reason '${v.reason}'`);
  }
});

test('desktop route: only a REAL change of the user\'s text, or focus outside the composer, refuses', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteComposerVerdict');
  assert.equal(one(rows, 'verdict', 'user_edited_same_element').reason, 'text_changed');
  assert.equal(one(rows, 'verdict', 'composer_emptied').reason, 'text_changed');
  // Focus parked in the model menu is NOT a text change -- it is recoverable by
  // putting focus back, and it must be named for what it is.
  assert.equal(one(rows, 'verdict', 'focus_on_menu_item').reason, 'focus_not_in_composer');
  assert.equal(one(rows, 'verdict', 'focus_on_menu_item_no_text').reason, 'focus_not_in_composer');
  assert.equal(one(rows, 'verdict', 'other_textbox_other_text').reason, 'element_changed');
  assert.equal(one(rows, 'verdict', 'no_runtime_id').ok, false);
});

// ── 2. switch verification ──────────────────────────────────────────────────

test('desktop route: the catalog reads every effort-suffixed Claude Desktop button shape', winOnly, async () => {
  const rows = await runHarness();
  const tierOf = (l) => rows.find((r) => r.t === 'tierof' && r.label === l)?.tier;
  assert.equal(tierOf('Model: Sonnet 5 Medium'), 'standard');
  assert.equal(tierOf('Model: Sonnet 5 High'), 'standard');
  assert.equal(tierOf('Model: Sonnet 5 · High'), 'standard');
  assert.equal(tierOf('Model: Sonnet 5, Extended thinking'), 'standard');
  assert.equal(tierOf('Model: Claude Sonnet 5'), 'standard');
  assert.equal(tierOf('Model: Opus 5 High'), 'premium');
  assert.equal(tierOf('Model: Haiku 4.5'), 'economy');
});

test('desktop route: switch verification is by TIER; an effort-only change is not a switch', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteSwitchVerified');
  assert.equal(one(rows, 'switch', 'switched_to_target').verified, true);
  assert.equal(one(rows, 'switch', 'label_unchanged').verified, false);
  assert.equal(one(rows, 'switch', 'effort_only_change').verified, false);
  assert.equal(one(rows, 'switch', 'unreadable_but_changed').verified, true);
  assert.equal(one(rows, 'switch', 'unreadable_unchanged').verified, false);
  assert.equal(one(rows, 'switch', 'empty_label').verified, false);
});

test('desktop route SOURCE: verification re-finds the picker button DURING the poll, not once', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  const loop = run.slice(run.indexOf('verifyDeadline'));
  const doBody = loop.slice(loop.indexOf('do'), loop.indexOf('while (DateTime.UtcNow.Ticks < verifyDeadline)'));
  assert.ok(/FindModelPickerButton\(/.test(doBody),
    'a picker reference fetched once goes stale when Claude Desktop re-renders it; the poll must re-find it');
  assert.ok(/RouteSwitchVerified\(/.test(doBody), 'the poll must use the pure, tested verdict');
});

test('desktop route SOURCE: a Select() that only highlights is followed by Invoke(), and the menu is not collapsed before verification', async () => {
  // Live: "the model menu opened but the model didn't change". Select() returned
  // without throwing, and the collapse 300ms later closed the menu unchosen.
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  const fromSelect = run.slice(run.indexOf('SelectionItemPattern)selObj).Select()'));
  const loopStart = fromSelect.indexOf('verifyDeadline');
  const loopEnd = fromSelect.indexOf('while (DateTime.UtcNow.Ticks < verifyDeadline)');
  const loop = fromSelect.slice(loopStart, loopEnd);
  assert.ok(/InvokePattern\)invObj\)\.Invoke\(\)/.test(loop), 'the verify poll must retry activation with Invoke()');
  const beforeLoop = fromSelect.slice(fromSelect.indexOf('select_failed') + 20, loopStart);
  assert.ok(!/TryCollapsePicker\(picker\)/.test(beforeLoop), 'collapsing before verification closes the menu with nothing chosen');
  assert.ok(/TryCollapsePicker\(picker\)/.test(fromSelect.slice(loopEnd, fromSelect.indexOf('"switch_not_verified"'))),
    'the picker is collapsed once verification is over');
});

// ── 3. a second Enter while routing ─────────────────────────────────────────

test('desktop route: a second Enter while a route runs is swallowed SILENTLY (no malformed event)', winOnly, async () => {
  const rows = await runHarness();
  const r = one(rows, 'start', 'second_enter_in_progress');
  assert.equal(r.events, 0, `no route event may be emitted, got: ${JSON.stringify(r.lines)}`);
  assert.equal(r.ret, 'True', 'StartRoute must tell the hook to swallow it');
  assert.equal(r.armedAfter, true, 'the in-flight route\'s pin is not disturbed');
});

test('desktop route: an EXPIRED or STALE pin never eats the Enter', winOnly, async () => {
  const rows = await runHarness();
  const e = one(rows, 'start', 'expired_pin');
  assert.equal(e.ret, 'False', 'an expired pin must let the Enter through as an ordinary send');
  assert.equal(e.inProgress, false);
  const s = one(rows, 'start', 'stale_id');
  assert.equal(s.ret, 'False', 'a stale route id must let the Enter through');
  assert.equal(s.inProgress, false);
  assert.equal(s.events, 0, 'a stale id is an internal race, not a reportable route outcome');
});

test('desktop route: the hook swallows a repeat Enter without aborting the route', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteHookSwallowsEnter');
  assert.equal(one(rows, 'hook', 'repeat_enter_same_window').swallow, true);
  assert.equal(one(rows, 'hook', 'our_own_synthetic_enter').swallow, false, 'our own Enter must reach the app');
  assert.equal(one(rows, 'hook', 'shift_enter_newline').swallow, false, 'Shift+Enter edits the text: still an abort');
  assert.equal(one(rows, 'hook', 'enter_in_another_window').swallow, false, 'never swallow Enter in another window');
  assert.equal(one(rows, 'hook', 'enter_no_route_running').swallow, false);
  assert.equal(one(rows, 'hook', 'enter_during_rewrite').swallow, false, 'rewrite semantics unchanged');
  assert.equal(one(rows, 'hook', 'letter_key_during_route').swallow, false);
});

test('desktop route SOURCE: the hook consults RouteHookSwallowsEnter BEFORE setting _routeAbort, and only uses StartRoute\'s answer', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const code = stripComments(src);
  const kAt = code.indexOf('uint kflags = (uint)Marshal.ReadInt32(lParam, 8);');
  assert.ok(kAt > 0, 'keyboard-hook abort block not found');
  const abortAt = code.indexOf('if (_routeInProgress) _routeAbort = true;', kAt);
  const swallowAt = code.indexOf('RouteHookSwallowsEnter(', kAt);
  assert.ok(swallowAt > 0 && abortAt > swallowAt, 'the repeat-Enter swallow must sit before the keyboard abort');
  assert.ok(/if \(StartRoute\(routeId\)\) return \(IntPtr\)1;/.test(code),
    'the hook must swallow only when StartRoute took the Enter');
  // The hook route branch is still UIA-free.
  const hookBranch = src.slice(src.indexOf('lock (_routeLock) { routeId = _pendingRouteId')).slice(0, 400);
  assert.ok(!/Automation|FindAll|TreeWalker/.test(hookBranch));
});

// ── 4. the fallback actually sends ──────────────────────────────────────────

test('desktop route SOURCE: the fallback puts focus back on the composer before deciding, and names its reason honestly', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fb = stripComments(sliceFn(src, 'static void FallbackSendOrReport('));
  assert.ok(/AcquireRouteComposer\(/.test(fb), 'the fallback must re-acquire the composer (refocus), not read FocusedElement as-is');
  assert.ok(!/"_no_fallback_text_changed"/.test(fb),
    'a RuntimeId mismatch / focus in the menu must not be reported as text_changed');
  // Enter is sent only after the composer was re-verified.
  const beforeEnter = fb.slice(0, fb.indexOf('SendKeyPress(VK_RETURN)'));
  assert.ok(/AcquireRouteComposer\(/.test(beforeEnter));
  assert.ok(/GetForegroundWindow\(\) != pinnedHwnd/.test(beforeEnter), 'never send into another window');
  // Exactly one synthetic Enter: no retry.
  assert.equal((fb.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1);
});

test('desktop route SOURCE: RunRoute pre-flight and post-switch use the verdict, not a bare RuntimeId compare', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  assert.ok(!/RuntimeIdEquals\(/.test(run), 'RunRoute must not decide on RuntimeId alone');
  assert.ok((run.match(/AcquireRouteComposer\(/g) || []).length >= 2, 'pre-flight AND post-switch re-acquire the composer');
});

// ── 5. the pin follows the composer ─────────────────────────────────────────

test('desktop route: an unchanged prompt keeps its pin FRESH (RuntimeId + TTL) across dedup ticks', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'MrRefreshPinOnDedup');
  const a = one(rows, 'refresh', 'same_text_new_rid');
  assert.deepEqual(a.rid, [42, 1001, 9], 'the re-rendered composer\'s id replaces the dead one');
  assert.equal(a.ttlExtended, true);
  assert.equal(a.id, 'route-4', 'the route id is NOT rotated (StartRoute would no-op on the mismatch)');
  const b = one(rows, 'refresh', 'different_text_untouched');
  assert.deepEqual(b.rid, [42, 1001, 7]);
  assert.equal(b.ttlExtended, false);
  const w = one(rows, 'refresh', 'other_window_untouched');
  assert.deepEqual(w.rid, [42, 1001, 7], 'same text in ANOTHER window is a different prompt');
  assert.equal(w.ttlExtended, false);
  const c = one(rows, 'refresh', 'unarmed_untouched');
  assert.deepEqual(c.rid, [42, 1001, 7]);
  assert.equal(c.armed, false);
});

test('desktop route SOURCE: the desktop arm refreshes the pin on its dedup early-return', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const arm = stripComments(sliceFn(src, 'static void UpdateModelRouting('));
  assert.ok(/if \(dedupKey == _mrLastObservedKey\) \{ MrRefreshPinOnDedup\(text, composerRid, el, fg\); return; \}/.test(arm),
    'the dedup return must refresh the pin first');
});
