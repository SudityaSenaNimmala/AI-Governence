// MODEL ROUTING CAN NEVER GET STUCK -- the end-of-route invariant, on every
// stuck mode, desktop arm and web arm.
//
// Live evidence (2026-10-06, agent 35d74860 = 3a51259, desktop agent's web arm
// driving gemini.google.com in Edge/Chrome, no extension):
//   07:24:11Z gemini failed complex "3.5 Flash-Lite" -> "3.1 Pro"  reason "not_submitted"
//   05:58:03Z gemini failed interrupted_after_expand_no_fallback_navigated
//   User: "sometimes the model routing gets stuck -- it just opens the model
//   window but doesn't change, and gets stuck there."
//
// Root causes pinned here:
//   1. RouteClickInto clicked a FIXED point 12px in from the composer's right
//      edge to put focus back. Gemini's mode picker sits at the composer's
//      right, so the "refocus" click OPENED THE MODEL MENU; a SetFocus then put
//      UIA focus back on the composer, the single focus check passed, and the
//      Enter went into a page with the menu open -> not_submitted, menu stuck.
//   2. Focus was verified with ONE read. Angular Material hands focus back to
//      the menu trigger when its menu closes; an Enter after that lands on the
//      trigger and reopens the menu instead of sending.
//   3. WebFallbackSendOrReport's focus/nav/host exits returned BEFORE it closed
//      the menu -- interrupted_after_expand_no_fallback_navigated left the menu
//      open on screen.
//   4. Nothing bounded a route end to end: a UIA call that hangs, or an
//      exception escaping the route thread, could leave _routeInProgress set --
//      and with it every Enter in that window swallowed.
//
// The invariant at the end of ANY attempt: (a) no model menu / submenu /
// confirm dialog left open; (b) the prompt sent exactly once, or -- when that
// is not safe -- left intact with focus back on the composer; (c) one event
// with a precise reason. Never two sends; never zero when it was safe to send.
//
// Driven through tests/helpers/route-watchdog-harness.ps1 (the REAL C#,
// compiled out of the .ps1, called by reflection; real threads for the
// watchdog; no hook, no keystrokes, no window).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'route-watchdog-harness.ps1');
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
  const openBrace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`${signature} never closes`);
}
const stripComments = (s) => s.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// ── 1. the pre-Enter focus gate ─────────────────────────────────────────────

test('gate: focus already on the composer, no menu -> ONE Enter, after a settle re-check', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteFocusGate');
  const g = one(rows, 'gate', 'focus_ok_stable');
  assert.equal(g.ok, true);
  assert.equal(g.enters, 1);
  assert.equal(g.settles, 1, 'focus is checked twice, ROUTE_GATE_SETTLE_MS apart');
  assert.equal(g.refocuses + g.collapses, 0, 'nothing to do');
});

test('gate: Material hands focus back to the picker trigger after the menu closes -> refocus, then ONE Enter', winOnly, async () => {
  // THE GEMINI not_submitted: a single read said "composer", the Enter then
  // landed on the trigger and reopened the menu.
  const rows = await runHarness();
  const g = one(rows, 'gate', 'material_handback');
  assert.equal(g.ok, true);
  assert.equal(g.refocuses, 1, 'the hand-back is caught by the second read and undone');
  assert.equal(g.focusAtEnd, 'composer');
  assert.equal(g.menuOpenAtEnd, false);
  const every = one(rows, 'gate', 'handback_every_time');
  assert.equal(every.ok, false, 'focus that never stays put: no Enter');
  assert.equal(every.enters, 0);
  assert.equal(every.reason, 'focus_not_in_composer');
  assert.ok(every.elapsed <= 1000, 'bounded, got ' + every.elapsed);
});

test('gate: a model menu left open is closed BEFORE the Enter; one that will not close means no Enter', winOnly, async () => {
  const rows = await runHarness();
  const open = one(rows, 'gate', 'menu_left_open_closes');
  assert.equal(open.ok, true);
  assert.equal(open.menuOpenAtEnd, false);
  assert.ok(open.collapses >= 1);
  const stuck = one(rows, 'gate', 'menu_never_closes');
  assert.equal(stuck.ok, false);
  assert.equal(stuck.reason, 'menu_still_open');
  assert.equal(stuck.enters, 0, 'never an Enter into an open menu (it would activate the highlighted item)');
});

test('gate: a refocus that itself OPENED the menu (the old Gemini click) is caught, the menu closed, then ONE Enter', winOnly, async () => {
  const rows = await runHarness();
  const g = one(rows, 'gate', 'refocus_opened_the_menu');
  assert.equal(g.ok, true);
  assert.equal(g.collapses, 1, 'the menu the refocus opened is closed before the Enter');
  assert.equal(g.menuOpenAtEnd, false);
  assert.equal(g.focusAtEnd, 'composer');
});

test('gate: an upsell / usage-limit dialog holding focus gets ONE Escape, then focus back, then ONE Enter', winOnly, async () => {
  const rows = await runHarness();
  const g = one(rows, 'gate', 'upsell_dialog_holds_focus');
  assert.equal(g.ok, true);
  assert.equal(g.dismissals, 1);
  assert.equal(g.focusAtEnd, 'composer');
  const stuck = one(rows, 'gate', 'dialog_will_not_close');
  assert.equal(stuck.ok, false);
  assert.equal(stuck.dismissals, 1, 'exactly one Escape, never a loop of them');
  assert.equal(stuck.enters, 0);
});

test('gate: the user edited the text, or another window is in front -> no Enter, nothing clicked', winOnly, async () => {
  const rows = await runHarness();
  const e = one(rows, 'gate', 'user_edited');
  assert.equal(e.ok, false);
  assert.equal(e.reason, 'text_changed');
  assert.equal(e.refocuses, 0, 'the user\'s own edit is theirs');
  const w = one(rows, 'gate', 'window_changed');
  assert.equal(w.ok, false);
  assert.equal(w.reason, 'focus_changed');
  assert.equal(w.collapses, 0, 'never an Escape into another window');
  const n = one(rows, 'gate', 'focus_never_returns');
  assert.equal(n.ok, false);
  assert.equal(n.enters, 0);
  assert.equal(n.refocuses, 2, 'bounded: ROUTE_GATE_MAX_ROUNDS - 1 refocus attempts');
});

// ── 2. after the ONE Enter ──────────────────────────────────────────────────

test('after Enter: sent -> done, nothing else pressed', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteAfterEnter');
  const a = one(rows, 'after', 'sent_first_time');
  assert.equal(a.submitted, true);
  assert.equal(a.enters, 1);
  assert.equal(a.sends, 1);
  assert.equal(a.resends, 0);
});

test('after Enter: the Enter hit the picker trigger and REOPENED the menu -> menu closed, ONE re-send, ONE prompt sent', winOnly, async () => {
  const rows = await runHarness();
  const a = one(rows, 'after', 'enter_hit_trigger_then_sent');
  assert.equal(a.submitted, true);
  assert.equal(a.resends, 1);
  assert.equal(a.sends, 1, 'the prompt went out exactly once');
  assert.equal(a.menuOpenAtEnd, false);
  const twice = one(rows, 'after', 'menu_reopened_twice');
  assert.equal(twice.submitted, false);
  assert.equal(twice.resends, 1, 'never a second re-send');
  assert.equal(twice.enters, 2, 'one Enter + one re-send, never more');
  assert.equal(twice.verdict, 'menu_reopened_after_resend');
  assert.equal(twice.menuOpenAtEnd, false, 'and the menu is closed');
  assert.equal(twice.restores, 1, 'focus back on the composer, the prompt left there');
});

test('after Enter: switch landed but the page would not send (disabled send, limit notice) -> reported, NO second Enter', winOnly, async () => {
  const rows = await runHarness();
  const b = one(rows, 'after', 'switch_landed_send_blocked');
  assert.equal(b.submitted, false);
  assert.equal(b.verdict, 'in_composer');
  assert.equal(b.resends, 0, 'a send that only LOOKS unsent is never repeated');
  assert.equal(b.enters, 1);
  const e = one(rows, 'after', 'enter_went_elsewhere');
  assert.equal(e.verdict, 'focus_not_in_composer');
  assert.equal(e.resends, 0);
  assert.equal(e.restores, 1, 'focus is put back on the composer (never an Enter)');
});

test('after Enter: no re-send when the menu cannot be closed, the watchdog owns the send, or the gate fails', winOnly, async () => {
  const rows = await runHarness();
  const c = one(rows, 'after', 'menu_reopened_cannot_close');
  assert.equal(c.resends, 0);
  assert.equal(c.menuLeftOpen, true, 'reported as such');
  assert.equal(c.verdict, 'menu_reopened_menu_still_open');
  for (const k of ['resend_not_claimable', 'resend_gate_fails']) {
    const r = one(rows, 'after', k);
    assert.equal(r.resends, 0, k);
    assert.equal(r.enters, 1, k);
    assert.equal(r.menuOpenAtEnd, false, k + ': the menu is still closed');
  }
  assert.equal(one(rows, 'resendallowed', 'menu_first').allowed, true);
  for (const k of ['menu_second', 'in_composer', 'elsewhere']) assert.equal(one(rows, 'resendallowed', k).allowed, false, k);
  assert.equal(one(rows, 'postverdict', 'sent').verdict, '');
  assert.equal(one(rows, 'postverdict', 'menu').verdict, 'menu_reopened');
  assert.equal(one(rows, 'postverdict', 'elsewhere').verdict, 'focus_not_in_composer');
  assert.equal(one(rows, 'postverdict', 'composer').verdict, 'in_composer');
});

// ── 3. the refocus click lands only on the composer ─────────────────────────

test('refocus click: Gemini\'s picker at the composer\'s right is never clicked; an overlay means no click at all', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'RouteHitIsComposer');
  const pts = rows.find((r) => r.t === 'clickpoints').points;
  assert.deepEqual(pts, [[688, 524], [112, 524], [400, 524]], 'right end, left end, middle');
  assert.equal(rows.find((r) => r.t === 'clickpoints_tiny').count, 0);
  assert.equal(one(rows, 'hit', 'composer_itself').ok, true);
  assert.equal(one(rows, 'hit', 'inside_composer').ok, true);
  assert.equal(one(rows, 'hit', 'composer_wrapper').ok, true);
  assert.equal(one(rows, 'hit', 'picker_button').ok, false);
  assert.equal(one(rows, 'hit', 'menu_item_overlay').ok, false);
  const g = one(rows, 'clickchoice', 'gemini_picker_at_right');
  assert.equal(g.clickedPicker, false, 'THE GEMINI ROOT CAUSE: the right-end point is over the picker');
  assert.equal(g.x, 112, 'the left end is clicked instead');
  assert.equal(one(rows, 'clickchoice', 'menu_covers_composer').clicked, false);
});

// ── 4. the watchdog ─────────────────────────────────────────────────────────

test('watchdog: a UIA call hanging past the budget -> Enter released, ONE timeout event, the thread can never send later', winOnly, async () => {
  const rows = await runHarness();
  present(rows, 'StartRouteThread');
  const w = one(rows, 'watch', 'uia_hang_past_budget');
  assert.equal(w.started, true);
  assert.equal(w.midInProgress, false, 'the swallowed Enter is released at the deadline, while the thread is still hung');
  assert.equal(w.midClaim, 2, 'the watchdog owns the route');
  assert.deepEqual(w.reasons, ['watchdog_timeout_await_switch'], 'one event, naming the stage it died in');
  assert.deepEqual(w.results, ['failed']);
  assert.match(w.log, /send_refused/, 'the woken thread cannot claim the send: never a late Enter');
  assert.match(w.log, /not_owned/);
  assert.match(w.log, /checkpoint_threw_RouteAbandonedException/, 'the next checkpoint stops it dead');
  assert.equal(w.events, 1, 'the zombie thread\'s own report is dropped');
  assert.equal(w.endInProgress, false);
});

test('watchdog: an exception escaping the route -> reported once, Enter released, process alive', winOnly, async () => {
  const rows = await runHarness();
  const w = one(rows, 'watch', 'exception_mid_route');
  assert.deepEqual(w.reasons, ['exception_unhandled_select']);
  assert.equal(w.events, 1);
  assert.equal(w.finished, true);
  assert.equal(w.endInProgress, false);
});

test('watchdog: the send went out, then the read-back hung -> Enter released, reported once, never a second send', winOnly, async () => {
  const rows = await runHarness();
  const w = one(rows, 'watch', 'hang_after_send');
  assert.equal(w.midClaim, 1, 'the route thread owns its send; the watchdog does not take it over');
  assert.equal(w.midInProgress, false);
  assert.deepEqual(w.reasons, ['send_unverified_watchdog_send']);
  assert.equal(w.events, 1, 'the late report from the thread is dropped');
  assert.equal(w.log, 'sent;');
});

test('watchdog: a fast route is untouched -- one send, one event, a second claim refused', winOnly, async () => {
  const rows = await runHarness();
  const w = one(rows, 'watch', 'fast_route');
  assert.deepEqual(w.results, ['ok']);
  assert.equal(w.events, 1, 'one event per route, even if a path reports twice');
  assert.equal(w.log, 'sent;second_send_refused;', 'RouteClaimSend is true exactly once');
});

test('hook backstop: a route "in progress" past the deadline is released by the hook itself', winOnly, async () => {
  const rows = await runHarness();
  const s = one(rows, 'stale', 'no_watchdog_ran');
  assert.equal(s.live, false, 'the hook must stop swallowing Enter');
  assert.equal(s.inProgressAfter, false);
  const f = one(rows, 'stale', 'fresh_route');
  assert.equal(f.live, true);
  const p = one(rows, 'stale', 'pure');
  assert.equal(p.fresh, false);
  assert.equal(p.old, true);
  assert.equal(p.never, false);
  const c = one(rows, 'claims', 'off_route_thread');
  assert.equal(c.send, true);
  assert.equal(c.resend, false, 'a re-send only ever happens on a route thread that owns its send');
});

// ── 5. SOURCE: every path wired to the invariant ────────────────────────────

test('SOURCE: every route Enter goes through the gate and the one-send claim; the only re-send is RouteAfterEnter\'s', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const senders = [
    ['static void FallbackSendOrReport(', 'DesktopGateUia(', 'DesktopAfterEnterUia('],
    ['static void RunRoute(', 'DesktopGateUia(', 'DesktopAfterEnterUia('],
    ['static void WebFallbackSendOrReport(', 'WebGateUia(', 'WebAfterEnterUia('],
    ['static void WebSendAndReport(', 'WebGateUia(', 'WebAfterEnterUia('],
  ];
  for (const [sig, gate, after] of senders) {
    const body = stripComments(sliceFn(src, sig));
    const enter = body.indexOf('SendKeyPress(VK_RETURN)');
    assert.ok(enter > 0, sig + ' sends');
    assert.equal((body.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1, sig + ': exactly one Enter');
    const iGate = body.indexOf(gate);
    const iClaim = body.indexOf('RouteClaimSend()');
    assert.ok(iGate > 0 && iClaim > iGate && enter > iClaim, sig + ': gate -> claim -> Enter');
    assert.ok(body.indexOf(after) > enter, sig + ': the after-Enter check follows the Enter');
  }
  // The re-send lives only in the after-Enter hands, behind RouteAfterEnter.
  for (const sig of ['static RouteAfterEnterOutcome DesktopAfterEnterUia(', 'static RouteAfterEnterOutcome WebAfterEnterUia(']) {
    const body = stripComments(sliceFn(src, sig));
    assert.ok(/io\.ClaimResend = delegate/.test(body) && /RouteClaimResend\(\)/.test(body), sig);
    assert.ok(/RouteAfterEnter\(io\)/.test(body), sig);
  }
  const loop = stripComments(sliceFn(src, 'static RouteAfterEnterOutcome RouteAfterEnter('));
  assert.ok(/RouteResendAllowed\(v, o\.Resends\)/.test(loop), 'the re-send is gated by the pure rule');
  assert.ok(/pass < 2/.test(loop), 'at most one re-send pass');
});

test('SOURCE: the watchdog and its cleanup never press Enter; the hook and StartRoute use the live flag', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  for (const sig of ['static void RouteWatchdogFire(', 'static void RouteWatchdogCleanup(', 'static void RouteWatchdog(', 'static void RouteThreadBody(']) {
    assert.ok(!/VK_RETURN/.test(stripComments(sliceFn(src, sig))), sig + ' never presses Enter');
  }
  const fire = stripComments(sliceFn(src, 'static void RouteWatchdogFire('));
  assert.ok(fire.indexOf('RouteRelease(run)') < fire.indexOf('new Thread('), 'the Enter is released BEFORE any UIA cleanup');
  const code = stripComments(src);
  assert.ok(/RouteHookSwallowsEnter\(vk, ctrl, alt, shift, \(kflags & LLKHF_INJECTED\) != 0,\s*RouteInProgressLive\(\)/.test(code),
    'the hook reads the stale-aware flag');
  const start = stripComments(sliceFn(src, 'static bool StartRoute('));
  assert.ok(/if \(RouteInProgressLive\(\) \|\| _rewriteInProgress\) return true;/.test(start));
  assert.ok(/StartRouteThread\(run, body\)/.test(start), 'every route runs under the watchdog');
  for (const sig of ['static void RunRoute(', 'static void RunWebRoute(']) {
    const body = stripComments(sliceFn(src, sig));
    assert.ok(/catch \(RouteAbandonedException\)/.test(body), sig + ' stops silently once the watchdog owns it');
    assert.ok(/finally\s*\{\s*RouteRelease\(_tsRun\);\s*\}/.test(body), sig + ' releases only its own run');
    assert.ok(!/_routeInProgress = false/.test(body), sig + ' never clears the flag for a newer route');
  }
});

test('SOURCE: the web fallback closes the menu BEFORE its no-fallback exits (interrupted_after_expand_no_fallback_navigated)', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fb = stripComments(sliceFn(src, 'static void WebFallbackSendOrReport('));
  const iCollapse = fb.indexOf('WebCollapseMenuUia(');
  const iFirstExit = fb.indexOf('"_no_fallback_focus_changed"');
  const iNav = fb.indexOf('"_no_fallback_navigated"');
  assert.ok(iCollapse > 0 && iCollapse < iFirstExit && iCollapse < iNav, 'collapse first, whatever the checks decide');
  const navLine = fb.slice(fb.lastIndexOf('\n', iNav), iNav);
  assert.ok(/WebRestoreFocusNoSend\(/.test(navLine), 'navigated: focus back on the composer, no Enter');
  const col = stripComments(sliceFn(src, 'static string WebCollapseMenuUia('));
  assert.ok(/if \(GetForegroundWindow\(\) == pinnedHwnd\) SendKeyPress\(VK_ESCAPE\)/.test(col), 'Escape only into the pinned window');
});

test('SOURCE: the refocus click is hit-tested -- never a fixed point that can land on the picker', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const click = stripComments(sliceFn(src, 'static bool RouteClickInto('));
  const iHit = click.indexOf('AutomationElement.FromPoint(');
  const iOk = click.indexOf('RouteHitIsComposer(');
  const iDown = click.indexOf('MOUSEEVENTF_LEFTDOWN');
  assert.ok(iHit > 0 && iOk > iHit && iDown > iOk, 'hit-test -> verdict -> click');
  assert.ok(/RouteClickCandidates\(/.test(click));
  assert.ok(/!RouteOwned\(\)/.test(click), 'no click once the watchdog owns the route');
  assert.ok(!/VK_RETURN/.test(click));
});
