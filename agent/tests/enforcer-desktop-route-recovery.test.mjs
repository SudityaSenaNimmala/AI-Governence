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
  // The poll is RouteAwaitSwitch; RunRoute hands it a ReadLabel that re-finds.
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  const readLabel = run.slice(run.indexOf('io.ReadLabel = delegate'), run.indexOf('io.TierOf ='));
  assert.ok(/FindModelPickerButton\(/.test(readLabel),
    'a picker reference fetched once goes stale when Claude Desktop re-renders it; the poll must re-find it');
  const wait = stripComments(sliceFn(src, 'static RouteSwitchOutcome RouteAwaitSwitch('));
  const doBody = wait.slice(wait.indexOf('do'), wait.indexOf('while (io.NowMs() < deadline)'));
  assert.ok(/io\.ReadLabel\(\)/.test(doBody), 'the label is read on every poll tick');
  assert.ok(/RouteSwitchVerified\(/.test(doBody), 'the poll must use the pure, tested verdict');
  assert.ok(/RouteAwaitSwitch\(io,/.test(run), 'RunRoute must wait through RouteAwaitSwitch');
});

test('desktop route SOURCE: a Select() that only highlights is followed by Invoke(), and the menu is not collapsed before verification', async () => {
  // Live: "the model menu opened but the model didn't change". Select() returned
  // without throwing, and the collapse 300ms later closed the menu unchosen.
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  const fromSelect = run.slice(run.indexOf('SelectionItemPattern)selObj).Select()'));
  const retry = fromSelect.slice(fromSelect.indexOf('io.RetryActivate = delegate'), fromSelect.indexOf('io.ProbeConfirm ='));
  assert.ok(/InvokePattern\)invObj\)\.Invoke\(\)/.test(retry), 'the verify poll must retry activation with Invoke()');
  const wait = stripComments(sliceFn(src, 'static RouteSwitchOutcome RouteAwaitSwitch('));
  assert.ok(/io\.RetryActivate\(\)/.test(wait.slice(wait.indexOf('do'), wait.indexOf('while (io.NowMs() < deadline)'))));
  const awaitAt = fromSelect.indexOf('RouteAwaitSwitch(io,');
  const beforeWait = fromSelect.slice(fromSelect.indexOf('select_failed') + 20, awaitAt);
  assert.ok(!/TryCollapsePicker\(picker\)/.test(beforeWait), 'collapsing before verification closes the menu with nothing chosen');
  assert.ok(/TryCollapsePicker\(picker\)/.test(fromSelect.slice(awaitAt, fromSelect.indexOf('!waited.Switched'))),
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
  assert.ok(/RouteRefocusUia\(/.test(fb), 'the fallback must put focus back on the composer (RouteRefocusUia), not read FocusedElement as-is');
  assert.ok(!/"_no_fallback_text_changed"/.test(fb),
    'a RuntimeId mismatch / focus in the menu must not be reported as text_changed');
  // Enter is sent only after the composer was re-verified.
  const beforeEnter = fb.slice(0, fb.indexOf('SendKeyPress(VK_RETURN)'));
  assert.ok(/RouteRefocusUia\(/.test(beforeEnter));
  assert.ok(/GetForegroundWindow\(\) != pinnedHwnd/.test(beforeEnter), 'never send into another window');
  // Exactly one synthetic Enter: no retry.
  assert.equal((fb.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1);
});

test('desktop route SOURCE: RunRoute pre-flight and post-switch use the verdict, not a bare RuntimeId compare', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  assert.ok(!/RuntimeIdEquals\(/.test(run), 'RunRoute must not decide on RuntimeId alone');
  assert.ok(/AcquireRouteComposer\(/.test(run), 'pre-flight re-acquires the composer by what it holds');
  assert.ok(/RouteRefocusUia\(/.test(run.slice(run.indexOf('!waited.Switched'))), 'post-switch puts focus back on the composer');
  const refocus = stripComments(sliceFn(src, 'static AutomationElement RouteRefocusUia('));
  assert.ok(/AcquireRouteComposer\(/.test(refocus), 'the refocus verifies focus through the same composer verdict');
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

// ── 6. Claude's own "Switch model?" confirmation ────────────────────────────
//
// Live 2026-10-05 (Claude Desktop, existing conversation on "Opus 5.5 Medium",
// "explain what an API is" + Enter): the agent selected Sonnet and Claude put up
// its OWN modal -- "Switch model?" with "Cancel" and "Switch to Sonnet 5.5"
// (focused). The route failed switch_not_verified_no_fallback_focus_not_in_composer
// and the message was never sent. Routing must switch automatically.

test('desktop route: Claude now shows "Opus 5.5" / "Sonnet 5.5" -- tier and effort still read', winOnly, async () => {
  const rows = await runHarness();
  const tierOf = (l) => rows.find((r) => r.t === 'tierof' && r.label === l)?.tier;
  const effortOf = (l) => rows.find((r) => r.t === 'effort' && r.label === l)?.effort;
  assert.equal(tierOf('Model: Opus 5.5 Medium'), 'premium');
  assert.equal(tierOf('Opus 5.5 Medium'), 'premium');
  assert.equal(tierOf('Model: Sonnet 5.5 Medium'), 'standard');
  assert.equal(tierOf('Model: Sonnet 5.5'), 'standard');
  assert.equal(tierOf('Model: Sonnet 5.5 High'), 'standard');
  assert.equal(tierOf('Model: Haiku 4.5'), 'economy');
  assert.equal(effortOf('Model: Opus 5.5 Medium'), 'Medium', 'the effort suffix must still parse');
  assert.equal(effortOf('Opus 5.5 Medium'), 'Medium');
  assert.equal(effortOf('Model: Sonnet 5.5 High'), 'High');
  assert.equal(effortOf('Model: Sonnet 5.5'), '', '"5.5" is not an effort token');
});

test('catalog: Claude click labels lead with the 5.5 names, keep the old names and families as fallbacks', async () => {
  const cat = JSON.parse(await readFile(CATALOG, 'utf8'));
  for (const entry of [cat.apps.claude_desktop, cat.hosts['claude.ai']]) {
    assert.deepEqual(entry.tiers.premium.click_labels, ['Opus 5.5', 'Opus 5', 'Opus']);
    assert.deepEqual(entry.tiers.standard.click_labels, ['Sonnet 5.5', 'Sonnet 5', 'Sonnet']);
    assert.deepEqual(entry.tiers.economy.click_labels, ['Haiku 4.5', 'Haiku']);
    assert.equal(entry.confirm_dialog.button_name_prefix, 'Switch to ');
    assert.equal(entry.confirm_dialog.title_contains, 'Switch model');
    assert.equal(entry.confirm_dialog.cancel_button_name, 'Cancel');
  }
  // No other desktop app declares the dialog: the probe never runs there.
  for (const [k, v] of Object.entries(cat.apps)) if (k !== 'claude_desktop') assert.equal(v.confirm_dialog, undefined, k);
});

test('desktop route: the confirm signature comes from the catalog, for the surfaces that declare one', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteAwaitSwitch');
  const c = rows.find((r) => r.t === 'cfg' && r.app === 'claude_desktop');
  assert.equal(c.present, true);
  assert.equal(c.prefix, 'Switch to ');
  assert.equal(c.title, 'Switch model');
  assert.equal(c.cancel, 'Cancel');
  assert.equal(rows.find((r) => r.t === 'cfg' && r.app === 'chatgpt_desktop').present, false);
  // Changed 2026-10-06: the enforcer's WEB arm (claude.ai in a browser with no
  // extension) runs the same RouteAwaitSwitch, so it reads claude.ai's own
  // catalog confirm_dialog. Where the extension is installed it owns routing
  // and this arm stands down (routing-ownership.js), as before.
  assert.equal(rows.find((r) => r.t === 'cfg' && r.app === 'browser_claude_ai').present, true,
    'claude.ai shows the same "Switch model?" modal as Claude Desktop; the web arm confirms it too');
});

// ── 8. the WEB arm on the desktop arm's machinery ───────────────────────────
//
// Live 2026-10-06 (agent 1307630, version 826be5d8; no extension in the
// browser, so the desktop enforcer's web arm handled claude.ai):
//   desktop_uia claude_desktop applied simple Sonnet 5.5 -> Haiku 4.5   (works)
//   desktop_web_uia claude.ai failed simple Sonnet 5.5 -> Haiku 4.5
//     reason from_tier_not_confirmed_fallback_not_submitted
// The model menu was left OPEN ("Sonnet 5.5 ...", "Effort Medium >", "More
// models >") and the prompt was never sent. Requirement: the browser behaves
// EXACTLY like the desktop app.

test('web route: "Sonnet 5.5" is read as standard on claude.ai, through the shared catalog', winOnly, async () => {
  const rows = await runHarness();
  const tierOf = (l) => rows.find((r) => r.t === 'webtierof' && r.label === l).tier;
  assert.equal(tierOf('Model: Sonnet 5.5 Medium'), 'standard');
  assert.equal(tierOf('Model: Sonnet 5.5'), 'standard');
  assert.equal(tierOf('Model: Haiku 4.5'), 'economy');
  assert.equal(tierOf('Model: Opus 5.5 High'), 'premium');
  assert.equal(tierOf('Model: Opus 5 High'), 'premium');
  present(rows, 'MrClickLabelsFor');
  const labels = (host, tier) => rows.find((r) => r.t === 'weblabels' && r.host === host && r.tier === tier).labels;
  assert.deepEqual(labels('claude.ai', 'standard'), ['Sonnet 5.5', 'Sonnet 5', 'Sonnet']);
  assert.deepEqual(labels('claude.ai', 'economy'), ['Haiku 4.5', 'Haiku']);
  assert.deepEqual(labels('claude.ai', 'premium'), ['Opus 5.5', 'Opus 5', 'Opus']);
  assert.deepEqual(labels('gemini.google.com', 'standard'), ['3.6 Flash', '3.8 Flash', 'Flash']);
  assert.deepEqual(labels('nowhere.example', 'standard'), []);
});

test('web route: the from-tier item is FOUND by the catalog labels (the live root cause)', winOnly, async () => {
  const rows = await runHarness();
  const from = one(rows, 'webitem', 'from_standard_top');
  assert.equal(from.found, true, 'the live top-level item "Sonnet 5.5 Most efficient..." must be found');
  assert.equal(from.label, 'Sonnet 5.5');
  // The OLD label the web arm used (ai-processes.js tierLabels 2026-09-22) can
  // never match it -- that is from_tier_not_confirmed.
  assert.equal(one(rows, 'webitem', 'old_label_sonnet_5').found, false);
});

test('web route: Haiku / Opus live behind "More models" -- top-level miss, submenu hit', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'webitem', 'target_economy_top').found, false, 'Haiku is not a top-level item');
  const sub = one(rows, 'webitem', 'target_economy_sub');
  assert.equal(sub.found, true);
  assert.equal(sub.label, 'Haiku 4.5');
  assert.equal(one(rows, 'webitem', 'target_premium_top').found, false);
  const op = one(rows, 'webitem', 'target_premium_sub');
  assert.equal(op.found, true);
  assert.equal(op.label, 'Opus 5.5', 'the most specific label wins; "Opus 5" never matches "Opus 5.5 ..."');
  assert.ok(op.item.startsWith('Opus 5.5'));
  const more = rows.find((r) => r.t === 'webmore');
  assert.equal(more.label, 'More models', 'the same submenu literal the desktop arm hovers');
  assert.equal(more.matchesItem, true);
  assert.equal(more.anyTierMatches, false, '"More models" is never a tier');
});

test('web route SOURCE: target search -> "More models" hover -> search again, as the desktop arm does', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunWebRoute('));
  const firstSearch = run.indexOf('WebFindTargetItem(win, ctx.Picker, labels');
  const hover = run.indexOf('WebOpenMoreModelsAndFind(');
  assert.ok(firstSearch > 0 && hover > firstSearch, 'top-level search first, then the submenu');
  assert.ok(/if \(targetItem == null\)\s*\{\s*bool openedMore;\s*targetItem = WebOpenMoreModelsAndFind/.test(run),
    'the submenu is opened only when the top-level search misses');
  const more = stripComments(sliceFn(src, 'static AutomationElement WebOpenMoreModelsAndFind('));
  assert.ok(/SetCursorPos\(p\.X, p\.Y\)/.test(more), 'a real hover: the flyout opens on pointer position');
  assert.ok(/GetAncestor\(at, GA_ROOT_WINDOW\) == pinnedHwnd/.test(more), 'the cursor only moves over the pinned browser window');
  assert.ok(/SetCursorPos\(savedPos\.X, savedPos\.Y\)/.test(more), 'the cursor is put back');
  // The catalog, not the stale surface table, names the items.
  assert.ok(!/WebPickerTierLabel\(/.test(run), 'the route no longer reads ai-processes.js tierLabels');
  assert.ok(/MrClickLabelsFor\("browser", surfaceHost, fromTier\)/.test(run));
  // Refuse only on POSITIVE evidence: the item is there and says it is not selected.
  assert.ok(/if \(fromItem != null && WebItemSelectionState\(fromItem\) == WEB_SEL_NO\)/.test(run));
});

test('web route: claude.ai\'s "Switch model?" dialog is auto-confirmed with the same loop', winOnly, async () => {
  const rows = await runHarness();
  const cfg = (h) => rows.find((r) => r.t === 'webcfg' && r.host === h);
  assert.equal(cfg('claude.ai').present, true);
  assert.equal(cfg('claude.ai').prefix, 'Switch to ');
  assert.equal(cfg('www.claude.ai').present, true);
  assert.equal(cfg('gemini.google.com').present, false, 'no dialog declared: never probed');
  assert.equal(cfg('chatgpt.com').present, false);
  assert.equal(cfg('api_proxy').present, false);
  const a = one(rows, 'await', 'web_dialog_confirmed');
  assert.equal(a.switched, true);
  assert.equal(a.confirmInvokes, 1);
  assert.deepEqual(a.invokedNames, ['Switch to Sonnet 5.5']);
  assert.equal(a.sendPath, 'routed');
  const n = one(rows, 'await', 'web_dialog_never_confirms');
  assert.equal(n.switched, false);
  assert.equal(n.reason, 'confirm_dialog_not_confirmed');
  assert.equal(n.dismissals, 1);
  assert.equal(n.dialogOpenAtEnd, false);
  assert.equal(n.sendPath, 'fallback');
  assert.equal(one(rows, 'await', 'web_no_dialog_switches').switched, true);
});

test('web route: a menu left OPEN is closed (Escape, one per level) before the ONE send', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteCollapseMenu');
  const none = one(rows, 'collapse', 'menu_not_open');
  assert.equal(none.closed, true);
  assert.equal(none.escapes, 0, 'no Escape into a page with no menu showing');
  assert.equal(none.patterns, 0);
  // THE LIVE CASE: Collapse() leaves claude.ai's menu up.
  const live = one(rows, 'collapse', 'live_menu_left_open');
  assert.equal(live.closed, true);
  assert.equal(live.patterns, 1, 'the pattern is tried first');
  assert.equal(live.escapes, 1);
  assert.equal(live.menuOpenAtEnd, false);
  assert.equal(live.enters, 1, 'then exactly one Enter');
  const sub = one(rows, 'collapse', 'submenu_and_menu_open');
  assert.equal(sub.closed, true);
  assert.equal(sub.escapes, 2, 'submenu, then menu');
  assert.equal(one(rows, 'collapse', 'pattern_closes_it').escapes, 0);
  for (const c of Object.values({ a: 'menu_not_open', b: 'live_menu_left_open', c: 'submenu_and_menu_open', d: 'pattern_closes_it' })) {
    assert.equal(one(rows, 'collapse', c).escapesWhenClosed, 0, c + ': never an Escape once the menu is gone');
  }
});

test('web route: a menu that will not close -> reported, NO Enter (it would land in the menu)', winOnly, async () => {
  const rows = await runHarness();
  const stuck = one(rows, 'collapse', 'escape_ignored');
  assert.equal(stuck.closed, false);
  assert.equal(stuck.reason, 'menu_still_open');
  assert.equal(stuck.escapes, 3, 'bounded');
  assert.equal(stuck.enters, 0);
  const other = one(rows, 'collapse', 'other_window_in_front');
  assert.equal(other.closed, false);
  assert.equal(other.reason, 'focus_changed');
  assert.equal(other.escapes, 0, 'never an Escape into another window');
  assert.equal(other.enters, 0);
});

test('web route SOURCE: collapse -> refocus -> exactly ONE Enter, on the routed and the fallback path', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunWebRoute('));
  const fb = stripComments(sliceFn(src, 'static void WebFallbackSendOrReport('));
  const send = stripComments(sliceFn(src, 'static void WebSendAndReport('));
  // RunWebRoute itself never presses Enter: it hands off to exactly one sender.
  assert.equal((run.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 0);
  assert.equal((fb.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1, 'one Enter in the fallback');
  assert.equal((send.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1, 'one Enter in the routed send');
  // Fallback order: close the menu, then refocus, then the Enter.
  const iCollapse = fb.indexOf('WebCollapseMenuUia(');
  const iRefocus = fb.indexOf('WebRefocusUia(');
  const iEnter = fb.indexOf('SendKeyPress(VK_RETURN)');
  assert.ok(iCollapse > 0 && iRefocus > iCollapse && iEnter > iRefocus, 'collapse -> refocus -> Enter');
  assert.ok(/if \(menuWhy != null\)\s*\{[^}]*"_no_fallback_" \+ menuWhy[^}]*return; \}/.test(fb), 'a menu that will not close: no Enter');
  assert.ok(/if \(el == null\)\s*\{[^}]*"_no_fallback_" \+ whyNot[^}]*return; \}/.test(fb), 'focus that will not return: no Enter');
  // Routed path: wait (with the dialog) -> collapse -> refocus -> the one send.
  const iWait = run.indexOf('RouteAwaitSwitch(io, confirmCfg');
  const iCol = run.indexOf('WebCollapseMenuUia(pinnedHwnd, ctx)', iWait);
  const iRef = run.indexOf('WebRefocusUia(', iCol);
  const iSend = run.indexOf('WebSendAndReport(', iRef);
  assert.ok(iWait > 0 && iCol > iWait && iRef > iCol && iSend > iRef, 'wait -> collapse -> refocus -> send');
  assert.ok(/if \(!waited\.Switched\)\s*\{ WebFallbackSendOrReport\([^;]*waited\.Reason/.test(run),
    'an unconfirmed switch goes to the fallback with the wait\'s reason (desktop vocabulary)');
  assert.ok(/"focus_lost_after_switch_" \+ afterWhy/.test(run), 'the desktop arm\'s post-switch reason');
  // The menu is not collapsed between the select and the end of the wait.
  const between = run.slice(run.indexOf('usedSelect = true'), iWait);
  assert.ok(!/TryCollapsePicker\(picker\); *\r?\n\s*\r?\n\s*AutomationElement verifyEl/.test(between));
  assert.ok(!/Thread\.Sleep\(300\);\s*TryCollapsePicker/.test(between), 'no collapse right after the select');
  // Collapse and refocus never press Enter; Escape only into the pinned window.
  for (const sig of ['static RouteCollapseOutcome RouteCollapseMenu(', 'static string WebCollapseMenuUia(', 'static AutomationElement WebRefocusUia(', 'static bool WebFocusIsInComposer(']) {
    assert.ok(!/VK_RETURN/.test(stripComments(sliceFn(src, sig))), sig + ' never presses Enter');
  }
  const col = stripComments(sliceFn(src, 'static string WebCollapseMenuUia('));
  assert.ok(/if \(GetForegroundWindow\(\) == pinnedHwnd\) SendKeyPress\(VK_ESCAPE\)/.test(col));
  const dismiss = run.slice(run.indexOf('io.DismissConfirm = delegate'), run.indexOf('io.NowMs ='));
  assert.ok(/if \(GetForegroundWindow\(\) == pinnedHwnd\) SendKeyPress\(VK_ESCAPE\)/.test(dismiss));
  assert.ok(!/pidA == pidB/.test(dismiss), 'another window of the browser process is another browser window, not a modal');
});

test('web route SOURCE: refocus reads only the composer -- the focused element is compared by RuntimeId, never read', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const focus = stripComments(sliceFn(src, 'static bool WebFocusIsInComposer('));
  assert.ok(/AutomationElement\.FocusedElement/.test(focus));
  assert.ok(!/ReadText\(/.test(focus), 'the focused element\'s text is never read (a password box, the omnibox)');
  const ref = stripComments(sliceFn(src, 'static AutomationElement WebRefocusUia('));
  assert.ok(!/AutomationElement\.FocusedElement/.test(ref));
  assert.ok(/CachedWebComposer\(\)/.test(ref), 'the one door when the pinned reference died');
  assert.ok(/RouteRefocusComposer\(io\)/.test(ref), 'the SAME bounded loop as the desktop arm');
  assert.ok(/RouteClickInto\(cand, pinnedHwnd\)/.test(ref), 'the click is refused outside the pinned browser window');
  assert.ok(/io\.WindowState = delegate \{ return GetForegroundWindow\(\) == pinnedHwnd \? "same" : "other"; \}/.test(ref),
    'a same-process window is another browser window: focus_changed, never pulled back');
});

test('desktop route: only a "Switch to <TARGET>" button is ever pressed -- never Cancel, never another model', winOnly, async () => {
  const rows = await runHarness();
  const m = (c) => one(rows, 'btn', c).match;
  assert.equal(m('target_55'), true);
  assert.equal(m('target_family_only'), true);
  assert.equal(m('lowercase'), true);
  assert.equal(m('override_label_old'), true, 'an override label "Sonnet 5" still confirms "Switch to Sonnet 5.5" by family');
  assert.equal(m('other_model'), false);
  assert.equal(m('cancel'), false);
  assert.equal(m('no_prefix_boundary'), false);
  assert.equal(m('bare_prefix'), false);
});

test('desktop route: the confirm dialog appears -> auto-confirmed -> verified -> ONE routed send', winOnly, async () => {
  const rows = await runHarness();
  const a = one(rows, 'await', 'dialog_confirmed');
  assert.equal(a.switched, true);
  assert.equal(a.dialogSeen, true);
  assert.equal(a.confirmInvokes, 1, 'confirmed exactly once');
  assert.deepEqual(a.invokedNames, ['Switch to Sonnet 5.5'], 'the "Switch to" button, never Cancel');
  assert.equal(a.dismissals, 0);
  assert.equal(a.retries, 0, 'the menu item is not re-activated behind the modal');
  assert.equal(a.sendPath, 'routed');
  assert.equal(a.labelAfter, 'Model: Sonnet 5.5 Medium');

  // Claude only shows the dialog after the Select()->Invoke() retry: still confirmed.
  const r = one(rows, 'await', 'dialog_after_retry');
  assert.equal(r.switched, true);
  assert.equal(r.retries, 1);
  assert.equal(r.confirmInvokes, 1);
  assert.equal(r.sendPath, 'routed');
});

test('desktop route: no dialog (a new conversation) switches exactly as before', winOnly, async () => {
  const rows = await runHarness();
  const a = one(rows, 'await', 'no_dialog_switches');
  assert.equal(a.switched, true);
  assert.equal(a.dialogSeen, false);
  assert.equal(a.confirmInvokes, 0);
  assert.equal(a.dismissals, 0);
  assert.ok(a.elapsed < 1000, 'no fixed wait for a dialog that never comes');
  const n = one(rows, 'await', 'no_dialog_no_switch');
  assert.equal(n.switched, false);
  assert.equal(n.reason, 'switch_not_verified');
  assert.equal(n.dismissals, 0, 'nothing to dismiss: no Escape sent into the app');
  assert.ok(n.probes <= 12, 'the dialog probe is a tree walk and must be bounded, got ' + n.probes);
  const x = one(rows, 'await', 'no_cfg_app');
  assert.equal(x.probes, 0, 'an app without a catalog confirm_dialog is never probed');
  assert.equal(x.reason, 'switch_not_verified');
});

test('desktop route: a dialog that cannot be confirmed is dismissed, then ONE unrouted send', winOnly, async () => {
  const rows = await runHarness();
  for (const c of ['dialog_never_confirms', 'dialog_wrong_target', 'dialog_title_only', 'late_dialog_dismissed']) {
    const a = one(rows, 'await', c);
    assert.equal(a.switched, false, c);
    assert.equal(a.reason, 'confirm_dialog_not_confirmed', c);
    assert.equal(a.dismissals, 1, c + ': dismissed exactly once (Cancel, else Escape)');
    assert.equal(a.dialogOpenAtEnd, false, c + ': the user is never left with the modal up');
    assert.equal(a.sendPath, 'fallback', c);
  }
  const nv = one(rows, 'await', 'dialog_never_confirms');
  assert.equal(nv.confirmInvokes, 2, 'bounded: two confirm attempts, then give up');
  assert.ok(nv.elapsed <= 3000, 'bounded wait, got ' + nv.elapsed + 'ms');
  assert.equal(one(rows, 'await', 'dialog_wrong_target').confirmInvokes, 0, '"Switch to Opus" is never pressed when routing to Sonnet');
  // An unrelated "Switch to ..." button with no dialog title is not the dialog.
  const u = one(rows, 'await', 'unrelated_switch_button');
  assert.equal(u.confirmInvokes, 0);
  assert.equal(u.dismissals, 0);
  assert.equal(u.reason, 'switch_not_verified');
});

test('desktop route SOURCE: the switch wait never sends; RunRoute sends once routed, else via the fallback with the wait\'s reason', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const wait = stripComments(sliceFn(src, 'static RouteSwitchOutcome RouteAwaitSwitch('));
  assert.ok(!/SendKeyPress\(VK_RETURN\)/.test(wait), 'RouteAwaitSwitch must never press Enter');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  assert.equal((run.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1, 'exactly one routed Enter in RunRoute');
  assert.ok(/if \(!waited\.Switched\)\s*\{ FallbackSendOrReport\([^;]*waited\.Reason/.test(run),
    'an unconfirmed switch goes to the fallback (refocus + one Enter) with the wait\'s reason');
  // Dismissal: Escape only into Claude's own process, and never Enter.
  const dismiss = run.slice(run.indexOf('io.DismissConfirm = delegate'), run.indexOf('io.NowMs ='));
  assert.ok(/SendKeyPress\(VK_ESCAPE\)/.test(dismiss));
  assert.ok(/pidA == pidB/.test(dismiss), 'never send Escape into another app');
  assert.ok(!/VK_RETURN/.test(dismiss), 'never confirm by pressing Enter on the focused button');
});

// ── 7. focus back on the composer, then the ONE Enter ───────────────────────
//
// Live (e32cf4d, Claude Desktop, existing conversation, 2026-10-05T15:09:15Z):
// the "Switch model?" dialog was confirmed and the model switched to Sonnet 5.5,
// then model_routed failed focus_lost_after_switch_no_fallback_focus_not_in_composer
// and the prompt was never sent -- the user had to press Enter again. Closing
// Claude's menu/modal leaves focus on the picker, and a bare UIA SetFocus() did
// not move keyboard focus back into the Chromium composer.

test('desktop route: verified switch with focus left in the menu -> refocus -> ONE send', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteRefocusComposer');
  const a = one(rows, 'refocus', 'already_focused');
  assert.equal(a.ok, true);
  assert.equal(a.focuses + a.clicks, 0, 'nothing to do when focus is already there');
  const f = one(rows, 'refocus', 'focus_in_menu_setfocus_ok');
  assert.equal(f.ok, true);
  assert.equal(f.focuses, 1);
  assert.equal(f.enters, 1);
  // THE LIVE CASE: SetFocus is ignored by Chromium; a click inside the composer works.
  const c = one(rows, 'refocus', 'setfocus_ignored_click_ok');
  assert.equal(c.ok, true, 'a SetFocus that does not move keyboard focus must not end the route');
  assert.equal(c.clicks, 1);
  assert.equal(c.enters, 1, 'exactly one Enter');
  const m = one(rows, 'refocus', 'same_process_modal');
  assert.equal(m.ok, true, 'a same-process window in front is put back, then focus restored');
  assert.equal(m.restores, 1);
});

test('desktop route: refocus that cannot be verified -> reported, NO Enter, text left intact', winOnly, async () => {
  const rows = await runHarness();
  const n = one(rows, 'refocus', 'refocus_never_works');
  assert.equal(n.ok, false);
  assert.equal(n.reason, 'focus_not_in_composer');
  assert.equal(n.enters, 0, 'never an Enter into the wrong control');
  assert.ok(n.elapsed <= 1000, 'bounded (~800ms), got ' + n.elapsed);
  assert.ok(n.focuses >= 1 && n.clicks >= 1, 'both SetFocus and a click were tried');
  for (const [c, why] of [['user_edited', 'text_changed'], ['composer_text_changed', 'text_changed'],
    ['composer_gone', 'no_element'], ['other_app_foreground', 'focus_changed'], ['same_process_stuck', 'focus_changed']]) {
    const r = one(rows, 'refocus', c);
    assert.equal(r.ok, false, c);
    assert.equal(r.reason, why, c);
    assert.equal(r.enters, 0, c);
  }
  assert.equal(one(rows, 'refocus', 'user_edited').clicks, 0, 'the user\'s own edit is never clicked over');
  assert.equal(one(rows, 'refocus', 'other_app_foreground').clicks, 0, 'never click into another app');
});

test('desktop route SOURCE: post-switch refocus failure reports and sends nothing; success sends exactly once', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const run = stripComments(sliceFn(src, 'static void RunRoute('));
  const post = run.slice(run.indexOf('RouteRefocusUia('));
  const failBranch = post.slice(post.indexOf('if (composerAfter == null)'), post.indexOf('if (GetForegroundWindow() != pinnedHwnd)'));
  assert.ok(/"focus_lost_after_switch_"/.test(failBranch));
  assert.ok(!/SendKeyPress|FallbackSendOrReport/.test(failBranch), 'the switch happened: no unrouted re-send, no Enter');
  const enterAt = post.indexOf('SendKeyPress(VK_RETURN)');
  assert.ok(enterAt > post.indexOf('if (composerAfter == null)'), 'the Enter comes only after the verified refocus');
  assert.ok(/"ok"/.test(post.slice(enterAt)), 'reported ok (route-event.js maps it to applied) after the send');
  const loop = stripComments(sliceFn(src, 'static RouteRefocusOutcome RouteRefocusComposer('));
  const uia = stripComments(sliceFn(src, 'static AutomationElement RouteRefocusUia('));
  const click = stripComments(sliceFn(src, 'static bool RouteClickInto('));
  for (const body of [loop, uia, click]) assert.ok(!/VK_RETURN/.test(body), 'refocus never presses Enter');
  assert.ok(/GetAncestor\(at, GA_ROOT_WINDOW\) != pinnedHwnd/.test(click), 'the click is refused outside Claude\'s window');
});
