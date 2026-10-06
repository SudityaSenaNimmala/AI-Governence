// AI-216: model routing on claude.ai, desktop agent only.
//
// THREE classes of assertion live here, and all three matter:
//
//   1. SOURCE INVARIANTS, asserted by parsing enforcer-win.ps1 — the same
//      technique enforcer-browser-block.test.mjs and os-monitor-safety.test.mjs
//      use. These pin the things that cannot be observed from outside: that the
//      picker and its menu items are matched by NAME ONLY and never by
//      AutomationId, that the poll thread does no tree walk, that the hook
//      thread gained nothing at all, and that the pin-clearing asymmetry
//      between the web and desktop arms is still there.
//
//   2. JS ↔ C# LOCKSTEP. The item matcher, the effort parser and the three
//      picker constants exist in BOTH ai-processes.js and the embedded C#. The
//      same table is run through both and the answers compared, so a change to
//      one that is not made to the other fails here rather than in the field.
//
//   3. BEHAVIOUR, driven through tests/helpers/model-routing-harness.ps1, which
//      compiles the REAL C# out of the .ps1 and drives the REAL functions
//      (LoadWebSurfaces / EnforcingWebPicker / UpdateWebModelRouting /
//      MaybeSearchWebPicker). Nothing installs a keyboard hook. The only things
//      substituted are the two READS: the picker element (supplied as ABSENT by
//      leaving the cache empty, which is exactly what an account with no picker
//      produces) and the foreground window handle.
//
// THE MOST IMPORTANT TESTS IN THIS FILE are the four under 'AN ARMED PIN MUST
// NOT SURVIVE THE PICKER DISAPPEARING'. Without that fix a pin armed on an
// earlier tick stays armed for the full 15s ROUTE_TTL, the hook keeps swallowing
// Enter on it, and every one of those Enters becomes a synthetic re-send on a
// page with no picker to drive — which on a web surface is precisely the
// swallow-and-maybe-lose-the-prompt case this ticket exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  MODEL_PICKER_NAME_PREFIX_DEFAULT,
  MODEL_PICKER_CONTROL_TYPE_DEFAULT,
  MODEL_PICKER_ITEM_CONTROL_TYPES_DEFAULT,
  MODEL_EFFORT_TOKENS,
  modelItemNameMatches,
  parseModelPickerLabel,
} from '../src/os_monitor/ai-processes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'model-routing-harness.ps1');

const win = process.platform === 'win32';

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', HARNESS, '-Ps1', ENFORCER,
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

function pick(rows, t, key, val) {
  const hit = rows.filter((r) => r.t === t && (key === undefined || r[key] === val));
  return hit.length === 1 ? hit[0] : hit;
}

// ══ 1. SOURCE INVARIANTS ═══════════════════════════════════════════════════

// Slice out the functions that identify the picker and its menu items, so the
// AutomationId assertion is scoped to exactly the code the rule is about rather
// than to the whole 11k-line file.
function sliceFn(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `could not find ${signature} in enforcer-win.ps1`);
  const openBrace = src.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${signature} never closes`);
}

// THE INVERTED RULE, and the reason this test exists at all.
//
// Everywhere else in this file an AutomationId is the RIGHT signature: m365's
// 'm365-chat-editor-target-element' and Gemini Enterprise's
// 'agent-search-prosemirror-editor' are semantic, stable ids, and the catalog
// comments argue at length that a ClassName or a Name alone is weaker.
//
// ON claude.ai THAT IS EXACTLY BACKWARDS. The measured ids are React render
// counters ('base-ui-_r_36_' for the picker, '_r_8t_' for an item) and change on
// every render, so an id match would work once in testing and then silently stop
// matching in the field — the worst failure shape there is, because the feature
// looks armed and does nothing.
//
// So this test must fail CI if someone "improves" the picker code to match on
// the id, because doing so looks like following the house style.
test('AI-216 SOURCE: the picker and its items are matched by NAME ONLY, never by AutomationId', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fns = [
    'static void SearchWebPickerBackground(',
    'static AutomationElement FindWebPickerButton(',
    'static AutomationElement FindWebPickerItemUnique(',
    'static AutomationElement VerifiedWebPicker(',
    'static bool ModelItemNameMatches(',
  ];
  for (const sig of fns) {
    const body = sliceFn(src, sig);
    // Strip comments first: the comments here deliberately DISCUSS
    // AutomationId in order to explain why it is not used, and quoting the
    // rule must not break the rule.
    const code = body.split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    assert.ok(
      !/AutomationId/.test(code),
      `${sig} reads or compares an AutomationId. On claude.ai those are `
      + 'React-generated and change per render — Name is the only stable signal. '
      + 'This inverts the rule the rest of the file follows, which is exactly why '
      + 'it is pinned here.',
    );
  }
});

test('AI-216 SOURCE: the poll thread never walks a tree, and the hook thread gained nothing', async () => {
  const src = await readFile(ENFORCER, 'utf8');

  // The poll thread's ONLY picker work is the re-verify, and it must be one
  // property read. A tree walk or a FindAll there would put a browser-wide
  // descendant search inside the 150ms loop, ahead of UpdateUia's PII scan.
  const verify = sliceFn(src, 'static AutomationElement VerifiedWebPicker(');
  assert.ok(!/FindAll|TreeWalker/.test(verify),
    'VerifiedWebPicker runs on the poll thread and must not walk the tree');
  assert.equal((verify.match(/\.Current\.Name/g) || []).length, 1,
    'VerifiedWebPicker must pay exactly ONE Name read per tick');

  // Both tree-walking functions must run only where they are allowed to.
  // SearchWebPickerBackground is spawned on its own STA thread.
  const kick = sliceFn(src, 'static void MaybeSearchWebPicker(');
  assert.ok(/new Thread\(/.test(kick) && /ApartmentState\.STA/.test(kick),
    'the picker search must run on its own background STA thread');

  // THE HOOK THREAD. Its route branch reads two fields under a lock and calls
  // StartRoute — exactly what it did before AI-216. No UIA, no allocation, no
  // new call. LowLevelHooksTimeout is not negotiable.
  const hookBranch = src.slice(src.indexOf('lock (_routeLock) { routeId = _pendingRouteId'));
  const hookSnippet = hookBranch.slice(0, 400);
  assert.ok(!/Automation|FindAll|TreeWalker|EnforcingWebPicker|ModelEffort/.test(hookSnippet),
    'the keyboard hook must not have gained any UIA or catalog work');
});

test('AI-216 SOURCE: the pin-clearing asymmetry between the web and desktop arms is real', async () => {
  const src = await readFile(ENFORCER, 'utf8');

  // WEB: clears the pin when the picker is gone. This is the fix.
  const webArm = sliceFn(src, 'static void UpdateWebModelRouting(');
  const webPickerBlock = webArm.slice(webArm.indexOf('AutomationElement picker = VerifiedWebPicker('));
  const webDecision = webPickerBlock.slice(0, webPickerBlock.indexOf('string label'));
  assert.ok(/ClearPendingRoute\(\);/.test(webDecision),
    'the WEB arm must CLEAR the pin when the picker is absent — otherwise an '
    + 'armed pin survives for the full ROUTE_TTL and the hook keeps swallowing '
    + 'Enter on a page with no picker to drive');

  // DESKTOP: keeps the bare return, on purpose, so Claude Desktop is unchanged.
  const desktopArm = sliceFn(src, 'static void UpdateModelRouting(');
  assert.ok(
    /AutomationElement picker = GetCachedModelPicker\(fg\);\s*\r?\n\s*if \(picker == null\) return;/.test(desktopArm),
    'the DESKTOP arm must keep its BARE return — the asymmetry is deliberate and '
    + 'keeps Claude Desktop byte-identical',
  );
  // And the asymmetry must be explained at the call site, not just done.
  assert.ok(/THE BARE `return` IS DELIBERATE HERE/.test(desktopArm),
    'the deliberate asymmetry must be commented where it happens');
});

test('AI-216 SOURCE: a browser reads its cached composer, never FocusedElement', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  for (const sig of [
    'static void UpdateWebModelRouting(',
    'static void RunWebRoute(',
    'static void WebFallbackSendOrReport(',
  ]) {
    const body = sliceFn(src, sig);
    const code = body.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.ok(!/AutomationElement\.FocusedElement/.test(code),
      `${sig} must read the composer through CachedWebComposer(), never `
      + 'FocusedElement — in a browser that is whatever text box has the caret');
    assert.ok(/CachedWebComposer\(\)/.test(code),
      `${sig} must use the one composer door every other browser path uses`);
  }
});

test('AI-216 SOURCE: the web route never sends after a foreground, host or nav change', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const send = sliceFn(src, 'static void WebSendAndReport(');
  // Both guards must sit BEFORE the synthetic Enter.
  const beforeEnter = send.slice(0, send.indexOf('SendKeyPress(VK_RETURN)'));
  assert.ok(/GetForegroundWindow\(\) != pinnedHwnd/.test(beforeEnter),
    'the send must re-check the foreground window immediately before Enter');
  assert.ok(/_browserNavGen != ctx\.NavGen/.test(beforeEnter),
    'the send must re-check the navigation generation immediately before Enter');
  // NO RETRY after a failed send — that is how one prompt becomes two.
  const afterEnter = send.slice(send.indexOf('SendKeyPress(VK_RETURN)'));
  assert.ok(!/SendKeyPress\(VK_RETURN\)/.test(afterEnter.slice(30)),
    'a failed send must never be retried — double-send risk');
});

test('AI-216 SOURCE: no prompt content, URL, path or title can reach a route event', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const emit = sliceFn(src, 'static void EmitRoute(');
  // The ONLY host source is BrowserHostField(), which is structurally
  // catalog-host-only: it can return our own catalog value or nothing.
  assert.ok(/BrowserHostField\(\)/.test(emit),
    'browser_host must come from the existing BrowserHostField()');
  for (const forbidden of ['_browserUrl', 'url', 'Title', 'originalText', 'text']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(emit.replace(/\/\/.*$/gm, '')),
      `EmitRoute must never carry ${forbidden}`);
  }
  // Length only, never content — the pre-existing rule, restated.
  assert.ok(/",\\"len\\":" \+ len/.test(emit) || /len/.test(emit));
});

// ══ 2. JS ↔ C# LOCKSTEP ════════════════════════════════════════════════════

test('AI-216 LOCKSTEP: the three picker constants agree between JS and C#', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  const c = pick(rows, 'constants');
  assert.equal(c.namePrefix, MODEL_PICKER_NAME_PREFIX_DEFAULT);
  assert.equal(c.controlType, MODEL_PICKER_CONTROL_TYPE_DEFAULT);
  // The C# side carries the list '|'-joined so it can be a const; the JS side
  // carries an array. Same values, same order.
  assert.deepEqual(c.itemTypes.split('|'), MODEL_PICKER_ITEM_CONTROL_TYPES_DEFAULT);
  assert.deepEqual(c.effortTokens, MODEL_EFFORT_TOKENS);
  // The desktop path runs off these exact values, which is what keeps Claude
  // Desktop byte-identical now that the literals are named.
  assert.equal(c.namePrefix, 'Model:');
  assert.deepEqual(c.itemTypes.split('|'), ['RadioButton', 'MenuItem']);
});

test('AI-216 LOCKSTEP: the item matcher gives the same answer in JS and C#', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  const cases = rows.filter((r) => r.t === 'match');
  assert.ok(cases.length >= 14, 'the harness must exercise the whole table');
  for (const c of cases) {
    assert.equal(
      c.result, modelItemNameMatches(c.name, c.label),
      `matcher drift for name=${JSON.stringify(c.name)} label=${JSON.stringify(c.label)}: `
      + `C# said ${c.result}, JS said ${modelItemNameMatches(c.name, c.label)}`,
    );
  }
  // And spot-check that the table actually contains the cases that matter, so
  // a truncated harness cannot pass this vacuously.
  const byName = Object.fromEntries(cases.map((c) => [c.name, c.result]));
  assert.equal(byName['Sonnet 5 Most efficient for everyday tasks'], true);
  assert.equal(byName['Sonnet 5.5 Something'], false);
  assert.equal(byName['Sonnet 50 Something'], false);
  // The two non-model entries in the measured menu must never match a tier.
  assert.equal(byName['Effort High'], false);
  assert.equal(byName['More models'], false);
});

test('AI-216 LOCKSTEP: the effort parser gives the same answer in JS and C#', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  const cases = rows.filter((r) => r.t === 'effort');
  assert.ok(cases.length >= 6);
  for (const c of cases) {
    assert.equal(c.result, parseModelPickerLabel(c.label, 'Model:').effort,
      `effort drift for ${JSON.stringify(c.label)}`);
  }
  const byLabel = Object.fromEntries(cases.map((c) => [c.label, c.result]));
  // Both sides of a REAL measured switch.
  assert.equal(byLabel['Model: Opus 5 High'], 'High');
  assert.equal(byLabel['Model: Sonnet 5 Medium'], 'Medium');
  // A CLOSED SET, not "the last word" — arbitrary site text must not become a
  // governance event field.
  assert.equal(byLabel['Model: Opus 5 Turbo'], '');
});

// ══ 3. BEHAVIOUR ═══════════════════════════════════════════════════════════

test('AI-216: the picker gate reads BOTH its flags, independently of the surface', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  const g = (c) => pick(rows, 'gate', 'case', c);

  assert.equal(g('claude_armed').found, true, 'claude.ai ships armed');
  // chatgpt.com has NO block. It must resolve to "no routing" — and this is the
  // entry that carries chatgpt.com's blocking and DLP coverage, so it is also
  // the one that must be left alone.
  assert.equal(g('chatgpt_none').found, false);
  assert.equal(g('unknown_host').found, false);

  // enforce-only and verified-only arm NOTHING, while the SURFACE stays fully
  // armed in both — which is the point of the pair being separate. A host can
  // be cleared to BLOCK without being cleared to DRIVE ITS UI.
  for (const c of ['enforce_only', 'verified_only']) {
    assert.equal(g(c).found, false, `${c} must not arm routing`);
    assert.equal(g(c).surfaceStillArmed, true,
      `${c} must leave the surface's own blocking gate untouched`);
  }
  // A block with no findable signature is refused, not defaulted.
  assert.equal(g('no_signature').found, false);
  assert.equal(g('no_signature').surfaceStillArmed, true);
});

test('AI-216: the tier labels come from the catalog, versioned', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  const byTier = Object.fromEntries(rows.filter((r) => r.t === 'tierlabel').map((r) => [r.tier, r.label]));
  // The payload's flattened labels are the shared catalog's first click label
  // per tier (ai-processes.js catalogTierLabels). The route itself reads every
  // catalog label (MrClickLabelsFor), not these.
  assert.deepEqual(byTier, { 3: 'Opus 5.5', 2: 'Sonnet 5.5', 1: 'Haiku 4.5' });
});

// ══ THE PIN-SURVIVAL BUG ═══════════════════════════════════════════════════

test('AI-216 CRITICAL: AN ARMED PIN MUST NOT SURVIVE THE PICKER DISAPPEARING', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();

  // (a) No pin is armed when the picker is absent.
  const noArm = pick(rows, 'pin', 'case', 'absent_no_arm');
  assert.equal(noArm.armed, false, 'an absent picker must arm nothing');
  assert.equal(noArm.id, '');

  // (b) THE BUG. A pin armed on an EARLIER tick is CLEARED.
  //
  // Without this the pin stays armed for the full 15s ROUTE_TTL, the hook keeps
  // swallowing Enter on it, StartRoute accepts it, and RunWebRoute reaches
  // picker_not_found — turning every one of those Enters into a synthetic
  // re-send on a page this code cannot drive.
  const stale = pick(rows, 'pin', 'case', 'absent_clears_stale');
  assert.equal(stale.armedBefore, true, 'the fixture must actually arm a pin first');
  assert.equal(stale.armedAfter, false,
    'a pin armed on an earlier tick MUST be cleared when the picker goes away');
  assert.equal(stale.idAfter, '', 'the route id must be cleared too');
  assert.equal(stale.ctxAfter, false, 'the web context must be cleared too');

  // (c) The hook's route branch is therefore not taken, and the ordinary
  // clean-send path runs. This is the user-visible consequence: Enter passes
  // through untouched.
  const hook = pick(rows, 'hook', 'case', 'absent_branch_not_taken');
  assert.equal(hook.routeBranchTaken, false,
    'with no pin armed the hook must fall through to the clean-send path, so '
    + 'Enter is never swallowed on an account with no picker');
});

test('AI-216 CRITICAL: "no picker on this account" emits NO EVENT AT ALL', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  // The harness emits its own observation lines with a `t` field; a route event
  // from the production code would be a {"kind":"route",...} line and would
  // carry no `t`. There must be none.
  const productionLines = rows.filter((r) => r.kind !== undefined);
  assert.deepEqual(productionLines, [],
    'the picker-absent path must emit NOTHING. It is the expected state for most '
    + 'of a fleet, and a per-session event would leak a plan-tier signal into '
    + 'governance telemetry for no governance benefit. "No picker on this '
    + 'account" must be indistinguishable from "routing disabled".');
});

test('AI-216: the picker search GIVES UP after N empty runs, and resumes only on a new page instance', {
  skip: win ? false : 'windows only (compiles the embedded C#)',
}, async () => {
  const rows = await runHarness();
  const c = pick(rows, 'constants');
  assert.equal(c.giveUp, 3, 'three consecutive empty searches per (hwnd, host, navGen) triple');
  // The backoff engages BEFORE the give-up, or it would be dead code.
  assert.ok(c.backoff < c.giveUp,
    'the empty-run backoff must engage before the give-up, or it never engages at all');

  const s = (name) => pick(rows, 'search', 'case', name);

  // AT the give-up count, on the SAME triple: STOPPED. Not slower — stopped.
  // A Free/Go account's page will never grow a picker within one page instance,
  // so continuing to walk it is pure cost with zero-probability payoff.
  assert.equal(s('giveup_same_key').started, false,
    'at the give-up count the search must stop entirely');
  // One below: still searching.
  assert.equal(s('below_giveup').started, true);

  // RESUMPTION is exactly the two events that can change the answer.
  assert.equal(s('navgen_bump_resumes').started, true,
    'a navigation or tab switch is a different page instance, which genuinely '
    + 'might have a picker — the search must resume');
  assert.equal(s('window_change_resumes').started, true,
    'a window change must resume the search for the same reason');

  // And a picker that is not past both flags never searches at all.
  assert.equal(s('unarmed_picker_never_searches').started, false,
    'an unarmed picker must never kick a descendant walk over a browser window');
});
