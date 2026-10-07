// NEVER SEND BEFORE THE DECISION + a manual model switch no longer stops
// routing (enforcer-win.ps1, 2026-10-07).
//
// Live evidence (agent 35419d9f = 74e47cc, Gemini in Edge, desktop agent web
// arm, no extension), UTC:
//   04:47:40.601 prompt_submit Gemini                   <- "hi"/"hello" on 3.1 Pro
//   04:47:42.127 model_routed applied simple 3.1 Pro -> 3.5 Flash-Lite
//   04:47:48.299 model_routed user_override              <- the user picked a model
//   04:47:50/53  prompt_submit, no routing               <- suppressed for the conversation
// "there is a lag for each model routing change" / "it changed after the prompt
// was sent" / a simple prompt did not route down after a manual switch.
//
// Root causes pinned here:
//   1. The keyboard hook swallowed Enter only when SOME pin was armed. It had
//      no way to know whether the poll thread's pin was for the text being
//      sent: an Enter that beat the poll thread went out unrouted, one right
//      after an edit routed on the previous text's decision.
//   2. RouteAfterEnter slept the WHOLE post-send window (1.5s on the web)
//      before its first read, so the route's report -- and the release of the
//      held Enter -- trailed its own send by 1.5s.
//   3. respect_user_override defaulted to true: one manual switch stood
//      routing down for the rest of the conversation.
//
// Driven through tests/helpers/route-held-enter-harness.ps1 (the REAL C#,
// compiled out of the .ps1, called by reflection; no hook, no keystrokes, no
// window) plus source checks for what only the source can show.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'route-held-enter-harness.ps1');
const CATALOG = join(AGENT_DIR, '..', 'shared', 'model-catalog.json');

const win = process.platform === 'win32';
const winOnly = { skip: !win && 'harness compiles the enforcer C# and needs Windows PowerShell' };

const { buildLexiconConfig } = await import(
  pathToFileURL(join(AGENT_DIR, 'src', 'os_monitor', 'model-router-config.js')).href);

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfai-held-'));
    const cfg = join(dir, 'router-config.json');
    await writeFile(cfg, JSON.stringify(buildLexiconConfig()), 'utf8');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', HARNESS, '-Ps1', ENFORCER, '-Catalog', CATALOG, '-RouterConfig', cfg,
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
  })();
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
  const openBrace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`${signature} never closes`);
}
const stripComments = (s) => s.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

// ── 1. the hook's plan ──────────────────────────────────────────────────────

test('held Enter: every new function exists in the enforcer C#', winOnly, async () => {
  const rows = await runHarness();
  for (const r of rows.filter((x) => x.t === 'has')) assert.ok(r.present, `${r.name} must exist`);
});

test('held Enter: Enter pressed before ANY pin exists is HELD, not sent unrouted (the live bug)', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'plan', 'enter_before_any_pin').plan, 'hold');
});

test('held Enter: a pin for the PREVIOUS text is not used -- the Enter is held and the decision recomputed', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'plan', 'pin_for_previous_text').plan, 'hold');
  assert.equal(one(rows, 'plan', 'pin_for_this_text').plan, 'pin', 'a pin for exactly this text is the fast path');
  assert.equal(one(rows, 'plan', 'no_route_decided_for_this_text').plan, 'pass', 'a no-route decision for this text: straight through');
  assert.equal(one(rows, 'plan', 'no_route_decided_for_older_text').plan, 'hold');
});

test('held Enter: never held after a send with nothing typed, never for an injected Enter, never off an eligible surface', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'plan', 'nothing_typed_since_send').plan, 'pass');
  assert.equal(one(rows, 'plan', 'injected_enter_no_pin').plan, 'pass', 'our own synthetic Enter must reach the app');
  assert.equal(one(rows, 'plan', 'injected_enter_with_pin').plan, 'pin', 'injected: exactly the old behaviour');
  assert.equal(one(rows, 'plan', 'not_eligible_no_pin').plan, 'pass');
  assert.equal(one(rows, 'plan', 'not_eligible_with_pin').plan, 'pin', 'not eligible: exactly the old behaviour');
});

test('held Enter: the edit sequence counts every key that can change the text, never the send or a bare modifier', winOnly, async () => {
  const rows = await runHarness();
  for (const c of ['letter', 'shift_enter', 'backspace', 'v_for_paste', 'delete']) assert.equal(one(rows, 'key', c).edits, true, c);
  for (const c of ['enter', 'shift', 'lshift', 'ctrl', 'alt', 'win', 'capslock']) assert.equal(one(rows, 'key', c).edits, false, c);
});

test('held Enter: eligibility is per window and goes stale; an empty composer keeps it fresh', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'eligible', 'nothing_published').eligible, false);
  assert.equal(one(rows, 'eligible', 'published_same_window').eligible, true);
  assert.equal(one(rows, 'eligible', 'published_other_window').eligible, false);
  assert.equal(one(rows, 'eligible', 'stale').eligible, false, 'a stalled poll thread must not keep holding Enters');
  assert.equal(one(rows, 'eligible', 'touched_on_empty_composer').eligible, true,
    'the tick before a fast "hi" + Enter reads an EMPTY composer -- it must still count');
});

// ── 2. the held run decides at send time ────────────────────────────────────

test('held Enter: "hi" / "hello" on 3.1 Pro are decided at send time and routed down to 3.5 Flash-Lite', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(rows.find((r) => r.t === 'lexicon').loaded, true, 'the real classifier lexicon is loaded');
  assert.equal(one(rows, 'tierof', 'gemini_pro').tier, 'premium');
  for (const c of ['hi_on_pro_routes_down', 'hello_on_pro_routes_down']) {
    const h = one(rows, 'held', c);
    assert.equal(h.complexity, 'simple', c);
    assert.equal(h.verdict, 'route', c);
    assert.equal(h.toTier, 'economy', c);
    assert.equal(h.toLabel, '3.5 Flash-Lite', c);
    assert.ok(h.decideMs < 400, `${c}: decided inside the budget, took ${h.decideMs}ms`);
  }
});

test('held Enter: no route -> ONE unrouted send; too late -> unrouted; nothing readable -> the user\'s own Enter put back', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'held', 'already_on_target_sends_once').verdict, 'send');
  assert.equal(one(rows, 'held', 'decided_too_late_sends_unrouted').verdict, 'send',
    'a decision past MR_HELD_DECIDE_BUDGET_MS is not acted on -- the prompt is not kept waiting');
  for (const c of ['empty_composer_releases_enter', 'unreadable_releases_enter', 'extension_owned_releases']) {
    assert.equal(one(rows, 'held', c).verdict, 'release', c);
  }
  for (const c of ['window_changed_abandons', 'navigated_abandons']) {
    assert.equal(one(rows, 'held', c).verdict, 'abandon', `${c}: never sent into what is in front now`);
  }
});

// ── 3. never route a submitted prompt ───────────────────────────────────────

test('held Enter: no route ever starts for a prompt that has already been sent', winOnly, async () => {
  const rows = await runHarness();
  const s = one(rows, 'submitted', 'hook_send_drops_pin');
  assert.equal(s.planBefore, 'pin');
  assert.equal(s.pinArmedAfter, false, 'the user\'s own send drops the pin it did not take');
  assert.equal(s.planAfter, 'pass', 'the next Enter with nothing typed is the user\'s, never a route');
  assert.equal(one(rows, 'submitted', 'lagging_read_not_pinned').isSubmitted, true,
    'a lagging accessibility read of the sent prompt is never pinned');
  assert.equal(one(rows, 'submitted', 'typed_since_is_new').isSubmitted, false);
  assert.equal(one(rows, 'submitted', 'different_text_is_new').isSubmitted, false);
  assert.equal(one(rows, 'held', 'submitted_prompt_never_routed').verdict, 'release',
    'a held Enter on the just-submitted text is released, never routed');
  assert.equal(one(rows, 'held', 'same_words_long_after_send').verdict, 'route',
    'the same words typed again later are a new prompt');
});

test('held Enter: the poll thread\'s dedup keeps decisions exact to the edit sequence', winOnly, async () => {
  const rows = await runHarness();
  assert.equal(one(rows, 'dedup', 'no_route_decision_carries').decidedSeq, 52);
  const r = one(rows, 'dedup', 'routed_without_pin_holds');
  assert.equal(r.decidedSeq, 50, 'a routed decision whose pin is gone covers nothing');
  assert.equal(r.plan, 'hold', 'so the Enter is decided again rather than sent unrouted');
  assert.equal(one(rows, 'dedup', 'pin_follows_sequence').pinSeq, 54);
});

// ── 4. a manual model switch, then "hi" ─────────────────────────────────────

test('user override: after a manual switch to 3.1 Pro, "hi" routes DOWN by default; only an explicit true suppresses', winOnly, async () => {
  const rows = await runHarness();
  const rec = one(rows, 'manual', 'switch_recorded');
  assert.equal(rec.overridden, true, 'the manual switch is still recorded');
  assert.equal(rec.userTier, 'premium', 'and it becomes the user\'s choice / current model');
  for (const c of ['server_default_routes_down', 'settings_missing_routes_down']) {
    const m = one(rows, 'manual', c);
    assert.equal(m.complexity, 'simple', c);
    assert.equal(m.routed, true, `${c}: the next simple prompt is routed`);
    assert.equal(m.toTier, 'economy', c);
    assert.equal(m.toLabel, '3.5 Flash-Lite', c);
    assert.equal(m.reportsOverride, false, `${c}: no user_override event (telemetry stays minimal)`);
  }
  const keep = one(rows, 'manual', 'explicit_respect_still_suppresses');
  assert.equal(keep.routed, false, 'respect_user_override: true keeps the old stand-down');
  assert.equal(keep.reportsOverride, true);
});

// ── 5. SOURCE: what only the source can show ────────────────────────────────

test('SOURCE: the hook decides with RouteEnterPlan and holds via StartHeldRoute -- no UIA, no classify on the hook thread', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const hook = stripComments(src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('static void Rescan()')));
  assert.match(hook, /if \(MrKeyMayEdit\(vk, shift\)\) Interlocked\.Increment\(ref _mrEditSeq\);/);
  assert.match(hook, /RouteEnterPlan\(enterInjected, MrEligibleNow\(enterFg\)/);
  assert.match(hook, /if \(StartRoute\(routeId\)\) return \(IntPtr\)1;/);
  assert.match(hook, /if \(StartHeldRoute\(enterFg\)\) return \(IntPtr\)1;/);
  assert.match(hook, /if \(!enterInjected\) MrNoteSubmittedFromHook\(\);/, 'the clean send drops the pin it did not take');
  assert.ok(!/ClassifyComplexity|ReadText\(|AutomationElement/.test(hook), 'the keyboard hook must not read UIA or classify');
  for (const sig of ['static int RouteEnterPlan(', 'static bool MrKeyMayEdit(', 'static bool MrEligibleNow(',
    'static void MrNoteSubmittedFromHook(', 'static bool StartHeldRoute(']) {
    const body = stripComments(sliceFn(src, sig));
    assert.ok(!/Automation|ReadText\(|ClassifyComplexity|Thread\.Sleep/.test(body), `${sig} runs on the hook thread: no UIA, no sleep`);
  }
});

test('SOURCE: the held run is a RouteRun under the watchdog and sends at most once, through the gate', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const start = stripComments(sliceFn(src, 'static bool StartHeldRoute('));
  assert.match(start, /if \(RouteInProgressLive\(\) \|\| _rewriteInProgress\) return true;/);
  assert.match(start, /StartRouteThread\(run, \(\) => RunHeldEnter\(s\)\)/, 'every held run is under the watchdog');
  const run = stripComments(sliceFn(src, 'static void RunHeldEnter('));
  assert.ok(!/SendKeyPress/.test(run), 'RunHeldEnter itself never presses a key');
  assert.match(run, /catch \(RouteAbandonedException\)/);
  assert.match(run, /finally\s*\{\s*RouteRelease\(_tsRun\);\s*\}/);
  // Every outcome is exactly one of the four.
  for (const exit of ['HeldReleaseEnter(snap)', 'HeldSendUnrouted(snap, rd)', 'RunWebRoute(routeId', 'RunRoute(routeId']) {
    assert.ok(run.includes(exit), `RunHeldEnter must reach ${exit}`);
  }
  const send = stripComments(sliceFn(src, 'static void HeldSendUnrouted('));
  assert.equal((send.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1, 'exactly one Enter');
  const iGate = send.indexOf('HeldGateUia(');
  const iClaim = send.indexOf('RouteClaimSend()');
  const iEnter = send.indexOf('SendKeyPress(VK_RETURN)');
  assert.ok(iGate > 0 && iClaim > iGate && iEnter > iClaim, 'gate -> claim -> Enter');
  assert.ok(send.indexOf('HeldAfterEnterUia(') > iEnter, 'the after-Enter check follows the Enter');
  const rel = stripComments(sliceFn(src, 'static void HeldReleaseEnter('));
  assert.equal((rel.match(/SendKeyPress\(VK_RETURN\)/g) || []).length, 1, 'the released Enter is exactly one Enter');
  assert.ok(rel.indexOf('RouteClaimSend()') < rel.indexOf('SendKeyPress(VK_RETURN)'), 'claimed before it is pressed');
  assert.ok(rel.indexOf('GetForegroundWindow() != snap.Hwnd') < rel.indexOf('SendKeyPress(VK_RETURN)'), 'never into another window');
});

test('SOURCE: the held run reads a browser through the one composer door, never FocusedElement', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const web = stripComments(sliceFn(src, 'static MrHeldRead MrHeldReadWeb('));
  assert.match(web, /CachedWebComposer\(\)/);
  assert.ok(!/AutomationElement\.FocusedElement/.test(web));
  assert.match(web, /RoutingOwnedByExtension\(_app\)/, 'an extension-owned browser is never routed by the agent');
  assert.match(web, /WriteFitsBudget\(text\)/, 'the web restore budget gates routing exactly as it gates arming');
});

test('SOURCE: a pinned route re-decides when the composer no longer holds the pinned text', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const start = stripComments(sliceFn(src, 'static bool StartRoute('));
  assert.match(start, /RunPinnedRoute\(true, \(\) => RunWebRoute\(/);
  assert.match(start, /RunPinnedRoute\(false, \(\) => RunRoute\(/);
  const pinned = stripComments(sliceFn(src, 'static void RunPinnedRoute('));
  assert.match(pinned, /!MrPinTextIsLive\(web, originalText\)/);
  assert.match(pinned, /RunHeldEnter\(snap\)/);
});

test('SOURCE: both routing arms stamp the edit sequence BEFORE the text, and never pin a submitted prompt', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  for (const sig of ['static void UpdateModelRouting(', 'static void UpdateWebModelRouting(']) {
    const body = stripComments(sliceFn(src, sig));
    const iSeq = body.lastIndexOf('long seqAtRead = Interlocked.Read(ref _mrEditSeq);');
    const iText = body.lastIndexOf('text = ReadText(el)');
    assert.ok(iSeq > 0 && iText > iSeq, `${sig}: the sequence is read before the text`);
    assert.match(body, /MrIsSubmittedText\(text, seqAtRead\)/, sig);
    assert.match(body, /_pendingRouteSeq = seqAtRead;/, sig);
    assert.match(body, /MrMarkNoRoute\(seqAtRead\)/, sig);
    assert.match(body, /MrPublishEligible\(/, sig);
  }
  // Every route send records what it sent.
  for (const sig of ['static void RunRoute(', 'static void FallbackSendOrReport(', 'static void WebFallbackSendOrReport(', 'static void WebSendAndReport(', 'static void HeldSendUnrouted(']) {
    assert.match(stripComments(sliceFn(src, sig)), /MrNoteSubmitted\(/, sig);
  }
});

test('SOURCE: respect_user_override is opt-in in the C# port (lockstep with shared/decide-route.js)', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  assert.match(src, /RespectUserOverride = DrIsTrue\(DrGet\(settings, "respect_user_override"\)\)/);
  assert.match(src, /public bool AllowUpgrade = true, RespectUserOverride = false, FleetEnabled = true;/);
  const js = await readFile(join(AGENT_DIR, '..', 'shared', 'decide-route.js'), 'utf8');
  assert.match(js, /respect_user_override: settings\.respect_user_override === true,/);
});
