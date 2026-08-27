// Behavioural regression tests for the IDE-panel platform block in
// enforcer-win.ps1.
//
// NOTHING HERE INSTALLS A KEYBOARD HOOK — same invariant as
// os-monitor-safety.test.mjs. The harness lifts the C# out of the .ps1,
// compiles it, and drives the poll-thread state machine and the Enter
// predicate by reflection; [CfaiEnforcer]::Start() is never called, so there is
// no hook, no mouse hook and no thread.
//
// ── What this exists to catch ────────────────────────────────────────────────
// A platform block on an IDE-hosted AI panel (claude.ai blocked → a
// `panel:"claude_code"` row in blocked-agents.json) stopped applying: Enter in
// Claude Code's VS Code composer submitted the message anyway, 3 live rounds
// out of 3, with the block correctly configured.
//
// It was NOT the focused-element race it looked like. A read-only UIA probe of
// the real window measured the claude_code composer read as completely stable —
// 30 matching reads out of 30 over 7.5s, empty composer and typed alike — so the
// sticky window never expired and no latch was ever involved. What the same
// probe DID measure is that one VS Code window hosts several AI composers at
// once (two live Claude Code composers AND a GitHub Copilot Chat input, all
// Edit controls, all matching the signature table, all reporting keyboard focus
// inside their own webview), and that AutomationElement.FocusedElement is a
// GLOBAL read that is not scoped to the foreground window — it returned an
// element from a background window in a different process entirely.
//
// So a single poll tick's read can land on a NEIGHBOURING panel. When that
// neighbour is `vscode_chat` (enforce:false, detection-only) the old code did
// two fatal things on that one tick: CheckFgBlocked found no row for it and
// cleared both _fgIsBlocked and the latch — with no grace period at all, since
// a different panel is still an AI surface and so RESET the sticky timer — and
// PanelEnforceOk() went false, which was ANDed over the whole Enter decision.
// Either one alone lets the blocked Enter through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const HARNESS = join(__dirname, 'helpers', 'panel-block-harness.ps1');
// CFAI_TEST_ENFORCER_PS1 points the harness at a different copy of the script.
// Its only purpose is to let a reviewer aim these tests at a reconstructed
// PRE-fix source and watch them fail — which is how they were validated:
// pre-fix, `neighbour_panel_wins_all` let Enter through on 29 of 30 ticks
// across the whole 4.5s window, and `neighbour_panel_steals_read` leaked on
// 10 of 10 stolen ticks. Nothing in the product reads this variable.
const ENFORCER = process.env.CFAI_TEST_ENFORCER_PS1 || join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');

// The harness needs PowerShell + Add-Type; the source-level invariants that
// guard the same fix on every platform live in os-monitor-safety.test.mjs.
const win = process.platform === 'win32';

let cached = null;
async function run() {
  if (cached) return cached;
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', HARNESS, '-Ps1', ENFORCER],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const junk = lines.filter((l) => !l.startsWith('{'));
  assert.deepEqual(junk, [], `harness wrote non-JSON to stdout:\n${junk.join('\n')}`);
  const rows = lines.map((l) => JSON.parse(l));
  const byScenario = new Map();
  for (const r of rows) {
    if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []);
    byScenario.get(r.scenario).push(r);
  }
  cached = byScenario;
  return cached;
}

async function scenario(name) {
  const all = await run();
  const rows = all.get(name);
  assert.ok(rows && rows.length, `harness produced no ticks for scenario '${name}'`);
  return rows;
}

test('harness never calls Start() — no keyboard hook can be installed by these tests', async () => {
  const src = await readFile(HARNESS, 'utf8');
  // Comment lines stripped: the header explains that Start() is never called,
  // and naming it there must not trip the check on the code below.
  const code = src
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  assert.equal(/\[CfaiEnforcer\]::Start\(/.test(code), false, 'the harness must never call Start()');
  assert.equal(/SetWindowsHookEx/.test(code), false);
  // It drives the state machine by reflection instead.
  assert.match(src, /ApplyForegroundTick/);
  assert.match(src, /EnterBlockActive/);
});

test('baseline: a stable, matching composer read blocks Enter on every tick', { skip: !win }, async () => {
  const rows = await scenario('stable_composer');
  assert.equal(rows.length, 30);
  for (const r of rows) {
    assert.equal(r.matched, 'claude_code');
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockedByElement, true, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
});

test('REGRESSION: a neighbouring detection-only panel stealing the odd read must not unblock Enter', { skip: !win }, async () => {
  // The live failure. Every third tick's focused-element read lands on the
  // Copilot Chat input that shares the window; the claude_code block must hold
  // straight through, on the stolen ticks too.
  const rows = await scenario('neighbour_panel_steals_read');
  assert.equal(rows.length, 30);
  const stolen = rows.filter((r) => r.matched === 'vscode_chat');
  assert.ok(stolen.length >= 9, `expected the neighbour to win several reads, got ${stolen.length}`);
  for (const r of rows) {
    assert.equal(r.enterBlocked, true, `tick ${r.tick} (read matched '${r.matched}') let Enter through`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick} lost _fgIsBlocked`);
  }
  // On a stolen tick the block is held by the latch, which still names the
  // panel it was armed for — not the neighbour the read landed on.
  for (const r of stolen) {
    assert.equal(r.latchHeld, true, `tick ${r.tick}: the latch must survive a neighbouring-panel read`);
    assert.equal(r.latchKey, 'panel:claude_code', `tick ${r.tick}`);
  }
});

test('REGRESSION: the neighbouring panel winning EVERY read for 4.5s must not unblock Enter', { skip: !win }, async () => {
  // The deterministic form — and the one no grace period covered, because a
  // neighbouring panel is still an AI surface and so kept resetting the sticky
  // timer to 0. 30 ticks at the real 150ms cadence is the 4.5s the live repro
  // waited before pressing Enter.
  const rows = await scenario('neighbour_panel_wins_all');
  assert.equal(rows.length, 30);
  for (const r of rows.slice(1)) {
    assert.equal(r.matched, 'vscode_chat', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick} let Enter through after ${r.tick * 150}ms`);
  }
  // …and it is still bounded by the latch TTL, not forever.
  assert.equal(rows[rows.length - 1].latchHeld, true);
});

test('a blocked panel is attributed to the panel the block was armed for, not the read that stole the tick', { skip: !win }, async () => {
  // index.js resolves tool_host from `panel`, and tool_host is what Request
  // Access asks an exception for. Reporting the neighbour (vscode_chat →
  // github.com) made the user file a request that could never lift the
  // claude.ai block they were actually hitting.
  const rows = await scenario('neighbour_panel_steals_read');
  for (const r of rows.filter((x) => x.matched === 'vscode_chat')) {
    assert.match(r.panelField, /"panel":"claude_code"/, `tick ${r.tick} misattributed the block`);
  }
});

test('unreadable focused-element reads keep the block alive, and the latch stays bounded', { skip: !win }, async () => {
  // The originally-modelled case. Kept as a regression: 29 consecutive
  // unreadable reads with the sticky window aged out in the middle.
  const rows = await scenario('unreadable_reads');
  for (const r of rows) assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  const late = rows[rows.length - 1];
  assert.equal(late.fgIsAi, false, 'the sticky window must really have expired');
  assert.equal(late.latchHeld, true, 'only the latch can still be holding the block here');

  const [expired] = await scenario('latch_expires');
  assert.equal(expired.latchHeld, false, 'the latch must be bounded by its TTL');
  assert.equal(expired.enterBlocked, false, 'a host whose reads never recover must not leave Enter dead');
});

test('NO COLLATERAL: once the read says the caret is in the code editor, Enter works again', { skip: !win }, async () => {
  // The one thing that must not regress. A readable non-match is still the
  // authoritative "left the panel" answer: it retires the latch at once, and
  // the block ends when the pre-existing 3s sticky window lapses — exactly as
  // it did before any of this.
  for (const name of ['moved_to_code_editor', 'moved_to_terminal']) {
    const rows = await scenario(name);
    assert.equal(rows[0].enterBlocked, true, `${name}: the composer tick must block`);
    assert.equal(rows[1].latchHeld, false, `${name}: a readable non-match must retire the latch immediately`);
    const last = rows[rows.length - 1];
    assert.equal(last.fgIsBlocked, false, `${name}: the block must not outlive the sticky window`);
    assert.equal(last.enterBlocked, false, `${name}: Enter must work in the editor/terminal`);
  }
});

test('a detection-only panel still never CAUSES a block, even with a row of its own', { skip: !win }, async () => {
  const rows = await scenario('detection_only_never_blocks');
  for (const r of rows) {
    assert.equal(r.matched, 'vscode_chat');
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}: enforce:false must never arm a block`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
  }
});

test('a real app switch retires the latch, and the block ends with the sticky window', { skip: !win }, async () => {
  const rows = await scenario('app_switch');
  assert.equal(rows[1].latchHeld, false, 'a pid change must retire the latch at once');
  const last = rows[rows.length - 1];
  assert.equal(last.fgIsBlocked, false);
  assert.equal(last.enterBlocked, false);
});

test('an admin lifting the block takes effect immediately, not after the latch TTL', { skip: !win }, async () => {
  for (const name of ['admin_unblocks', 'admin_unblocks_one_row']) {
    const rows = await scenario(name);
    assert.equal(rows[0].enterBlocked, true, `${name}: blocked to begin with`);
    assert.equal(rows[1].fgIsBlocked, false, `${name}: the block must drop on the next tick`);
    assert.equal(rows[1].latchHeld, false, `${name}: and take the latch with it`);
    assert.equal(rows[1].enterBlocked, false, `${name}`);
  }
});

// ── Cursor's own composer (cursor_composer) ─────────────────────────────────
//
// A SECOND live failure, on a different panel entry, in a window that the fix
// above provably cannot cover: a disposable Cursor instance on an empty folder,
// probed read-only, containing exactly TWO Edit controls — the composer
// (ClassName "aislash-editor-input") and Cursor's own Monaco code-editor input
// (ClassName "inputarea monaco-mouse-cursor-text"). No Copilot Chat, no
// vscode_chat, no second AI panel of any kind.
//
// Live result across 3 fully-verified rounds (continuous foreground-title
// checks, zero focus drift, block re-applied fresh each time): 2 leaked — the
// composer emptied on Enter — and 1 blocked, with an instrumented log proving
// the state was genuinely correct on the round that blocked. So detection and
// configuration were right; the leak was a race.
//
// Two things are different about this panel, and both mattered:
//
//   1. The element that steals the global FocusedElement read here matches NO
//      signature. That arrives as a readable NON-match, and a readable non-match
//      was treated as the authoritative "the user left the panel" answer —
//      unconditionally, with no grace period, retiring the latch in
//      ApplyForegroundTick before CheckFgBlocked's panel-id scoping (the fix
//      above) ever ran. Three seconds later the sticky window lapsed and the
//      blocked Enter went through. Fixed by requiring that focus COULD have
//      moved: a click, or a chorded/navigation key. Focus does not move on its
//      own, and the live round waited 4.5s touching nothing.
//
//   2. cursor_composer is the one signature with a single signal — an EXACT
//      ClassName, an empty Name, no prefix rule. A web-hosted element's UIA
//      ClassName is the DOM class ATTRIBUTE (the Monaco input's own two-class
//      value proves the provider reports the list verbatim), so a second class
//      on the composer used to stop it matching at all. claude_code is immune:
//      its ARIA-driven Name matches independently of any class.

test('baseline: a stable Cursor composer read blocks Enter on every tick', { skip: !win }, async () => {
  const rows = await scenario('cursor_stable_composer');
  assert.equal(rows.length, 30);
  for (const r of rows) {
    assert.equal(r.matched, 'cursor_composer');
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockedByElement, true, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
});

test("REGRESSION: Cursor's own code editor stealing the odd read must not unblock Enter", { skip: !win }, async () => {
  const rows = await scenario('cursor_monaco_steals_read');
  assert.equal(rows.length, 30);
  const stolen = rows.filter((r) => r.matched === '');
  assert.ok(stolen.length >= 9, `expected the Monaco input to win several reads, got ${stolen.length}`);
  // The point that separates this from the claude_code bug: the stealing read
  // matched NOTHING, so no panel-id comparison could have saved it.
  for (const r of stolen) {
    assert.equal(r.readable, true, `tick ${r.tick}: this must be a READABLE non-match, not an unreadable read`);
    assert.equal(r.focusMoved, false, `tick ${r.tick}: nobody touched anything`);
    assert.equal(r.latchHeld, true, `tick ${r.tick}: the latch must survive a read about another element`);
    assert.equal(r.latchKey, 'panel:cursor_composer', `tick ${r.tick}`);
  }
  for (const r of rows) {
    assert.equal(r.enterBlocked, true, `tick ${r.tick} (matched '${r.matched}') let Enter through`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick} lost _fgIsBlocked`);
  }
});

test('REGRESSION: the code editor winning EVERY read for 4.5s must not unblock Enter', { skip: !win }, async () => {
  // The shape that actually leaked live. 30 ticks at the real 150ms cadence is
  // the 4.5s the round waited before pressing Enter, and the sticky window is
  // aged out at tick 20 so the assertion really does cover past it — past the
  // point where, pre-fix, nothing at all was left holding the block.
  const rows = await scenario('cursor_monaco_wins_all');
  assert.equal(rows.length, 30);
  for (const r of rows.slice(1)) {
    assert.equal(r.matched, '', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick} let Enter through after ${r.tick * 150}ms`);
  }
  const late = rows[rows.length - 1];
  assert.equal(late.fgIsAi, false, 'the sticky window must really have expired');
  assert.equal(late.latchHeld, true, 'only the latch can still be holding the block here');
  assert.equal(late.blockedByElement, true);
});

test('REGRESSION: a second CSS class on the Cursor composer must not stop it matching', { skip: !win }, async () => {
  const rows = await scenario('cursor_composer_multiclass');
  assert.equal(rows.length, 30);
  for (const r of rows) {
    assert.equal(r.matched, 'cursor_composer', `tick ${r.tick}: the composer must match on a class TOKEN`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
});

test('NO COLLATERAL: a real click into Cursor\'s code editor still frees Enter', { skip: !win }, async () => {
  const rows = await scenario('cursor_click_into_editor');
  assert.equal(rows[0].enterBlocked, true, 'the composer tick must block');
  assert.equal(rows[1].focusMoved, true, 'the click is the evidence');
  assert.equal(rows[1].latchHeld, false, 'a readable non-match WITH input behind it retires the latch at once');
  const last = rows[rows.length - 1];
  assert.equal(last.fgIsBlocked, false, 'the block must not outlive the sticky window');
  assert.equal(last.enterBlocked, false, 'Enter must work in the code editor');
});

test('stale input is not licence to retire the latch, and the latch is still bounded', { skip: !win }, async () => {
  const stale = await scenario('cursor_stale_input');
  assert.equal(stale[1].focusMoved, false, 'a click 30s ago cannot explain this read');
  assert.equal(stale[1].latchHeld, true);
  assert.equal(stale[1].enterBlocked, true);

  // Fail-closed must not become fail-stuck: with no input ever, the block still
  // ends at PANEL_BLOCK_LATCH_TTL rather than leaving Enter dead in the editor.
  const [expired] = await scenario('cursor_latch_expires');
  assert.equal(expired.latchHeld, false, 'the latch must be bounded by its TTL');
  assert.equal(expired.enterBlocked, false);
});

test("Cursor's agent-history search box still never arms a block", { skip: !win }, async () => {
  // The guard that the class-token matching widened nothing: same ControlType,
  // same process, and filtering past sessions is not sending a prompt.
  const rows = await scenario('cursor_search_box');
  for (const r of rows) {
    assert.equal(r.matched, '', `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
  }
});

test('the panic hotkey still releases a latched panel platform block', { skip: !win }, async () => {
  const rows = await scenario('panic_hotkey');
  assert.equal(rows[0].enterBlocked, true);
  assert.equal(rows[1].enterBlocked, false, 'Disarmed() must win over every other signal');
  // The block state itself is untouched — only the decision is suppressed, so
  // enforcement resumes on its own when the disarm window lapses.
  assert.equal(rows[1].fgIsBlocked, true);
});

// ── Agent-scoped blocks (agent_scope:'agent') ───────────────────────────────
//
// A blocked_agents row names ONE agent ({ agent_name: "AI Learning Advisor",
// platform: "personal_agent" }), but the enforcer matched it against the whole
// PROCESS set the platform maps to and used agent_name only as display text. So
// blocking one agent disabled the entire Microsoft 365 Copilot app — generic
// Copilot chat and every other agent in it included.
//
// The signal, measured live: the composer Edit's UIA Name is "Message Copilot"
// with no specific agent open and "Message AI Learning Advisor" with that agent
// open. The WINDOW TITLE is useless (always the static "Microsoft 365 Copilot")
// and is used by nothing here.
//
// m365_copilot passed its live verification pass on 2026-08-27 against a real
// Microsoft 365 Copilot install with a real added agent ("AI Learning Advisor"):
// blocking that agent blocked only that agent — Enter swallowed with the composer
// text preserved, the Request Access modal naming the agent rather than the whole
// app — while generic Copilot chat and a different agent kept sending, including
// immediately after switching away. So the narrowing scenarios below run the
// SHIPPED catalog and are the shipping behaviour.
//
// The two-flag safety GATE is still under test, using a second, hypothetical
// surface for the STANDALONE Copilot app that has NOT had a live pass — because
// the gate is a rule about every future entry, not about m365_copilot.

test('SAFETY GATE: an UNVERIFIED surface never narrows — the row still blocks the whole app', { skip: !win }, async () => {
  // The rule every future AGENT_SURFACES entry ships under, asserted rather than
  // asserted-by-absence. The harness loads the verified m365_copilot entry AND a
  // hypothetical copilot_standalone entry with both flags false, then drives the
  // unverified one: an agent_scope:'agent' row there must behave EXACTLY as it did
  // before this feature existed — the whole process blocked, scope "app", no
  // element attribution — regardless of which agent the composer says is open,
  // and regardless of whether the read succeeded at all.
  const rows = await scenario('agent_unverified_surface_whole_app');
  assert.equal(rows.length, 4);
  // The reads really did land on all three interesting outcomes, so this is not
  // passing because nothing was read.
  assert.deepEqual(rows.map((r) => r.agentOutcome), ['Named', 'Generic', 'Unreadable', 'Named']);
  for (const r of rows) {
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}: the whole-app block must still fire`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'app', `tick ${r.tick}: nothing may be narrowed by an unverified surface`);
    assert.equal(r.blockedByElement, false, `tick ${r.tick}`);
    assert.equal(r.latchKey, '', `tick ${r.tick}: no element latch may be armed`);
  }
  // Including on tick 0, where the composer named the very agent the row names —
  // a verified surface would have narrowed to it. And on tick 3, where a
  // DIFFERENT agent was open: narrowing would have let that one through.
  assert.equal(rows[0].enterBlocked, true);
  assert.equal(rows[3].enterBlocked, true);
});

test('PRIVACY GATE: a platform-scoped row performs no focused-element read at all', { skip: !win }, async () => {
  // Reading another app's accessibility tree to learn which agent someone has
  // open is only justified by a policy that needs the answer. With no
  // agent-scoped row covering the process, no read happens — the outcome stays
  // Unreadable even though the composer would have read cleanly.
  const rows = await scenario('agent_no_policy_no_read');
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Unreadable', `tick ${r.tick}: no read may be performed`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}: and the platform block is unchanged`);
    assert.equal(r.blockScope, 'app', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
});

test('FAIL CLOSED: an agent-scoped row on a process with no surface still blocks the whole app', { skip: !win }, async () => {
  // Nothing can tell which agent is open inside ChatGPT — there is no
  // AGENT_SURFACES entry for it — and "cannot tell" must never mean "block
  // nothing". Same rule that keeps the feature inert while the flags are false.
  const rows = await scenario('agent_no_surface_whole_app');
  for (const r of rows) {
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'app', `tick ${r.tick}`);
    assert.equal(r.blockedByElement, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
});

test('the blocked agent being open blocks Enter on every tick, agent-scoped', { skip: !win }, async () => {
  const rows = await scenario('agent_stable_named');
  assert.equal(rows.length, 30);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Named', `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}: a matched agent block is never app-scoped`);
    assert.equal(r.blockedByElement, true, `tick ${r.tick}`);
    assert.equal(r.latchKey, 'agent:m365_copilot', `tick ${r.tick}`);
    // Attribution: an agent block carries no `panel`. index.js resolves a
    // tool_host from that field, and an agent-surface id is not a panel id.
    assert.equal(r.panelField, '', `tick ${r.tick}`);
  }
});

test('unreadable reads keep an agent-scoped block alive, and the latch stays bounded', { skip: !win }, async () => {
  // Unreadable is NO EVIDENCE — the element was gone, or belonged to another
  // process. Treating it as "no blocked agent is open" would tear the block down
  // on the first bad read while the user sits in the very agent an admin blocked.
  const intermittent = await scenario('agent_intermittent_unreadable');
  assert.ok(intermittent.filter((r) => r.agentOutcome === 'Unreadable').length >= 9);
  for (const r of intermittent) {
    assert.equal(r.enterBlocked, true, `tick ${r.tick} (outcome ${r.agentOutcome}) let Enter through`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}`);
  }

  const all = await scenario('agent_all_unreadable');
  for (const r of all.slice(1)) {
    assert.equal(r.agentOutcome, 'Unreadable', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick} let Enter through after ${r.tick * 150}ms`);
    assert.equal(r.latchHeld, true, `tick ${r.tick}: only the latch can be holding this`);
  }

  // …but bounded. A host whose reads never recover must not leave Enter dead.
  const [expired] = await scenario('agent_latch_expires');
  assert.equal(expired.latchHeld, false);
  assert.equal(expired.fgIsBlocked, false);
  assert.equal(expired.enterBlocked, false);
});

test('a NotComposer read holds the block exactly as an unreadable one does', { skip: !win }, async () => {
  // Focus on the transcript above the composer: readable, correctly attributed
  // to the foreground process, and says nothing about which agent is open.
  const rows = await scenario('agent_not_composer');
  for (const r of rows.slice(1)) {
    assert.equal(r.agentOutcome, 'NotComposer', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
    assert.equal(r.latchHeld, true, `tick ${r.tick}`);
    assert.equal(r.latchKey, 'agent:m365_copilot', `tick ${r.tick}`);
  }
});

test('switching to generic Copilot chat clears the block in ONE tick', { skip: !win }, async () => {
  // The other half of the bug: generic chat was blocked too. A Generic read comes
  // from the composer itself, correctly pid-attributed, so it is AUTHORITATIVE
  // and gets no grace period — unlike the Cursor case, where the read that stole
  // the tick came from an unrelated element.
  const rows = await scenario('agent_switch_to_generic');
  assert.equal(rows[0].enterBlocked, true, 'blocked while the agent is open');
  assert.equal(rows[1].agentOutcome, 'Generic');
  assert.equal(rows[1].latchHeld, false, 'an authoritative Generic read retires the latch at once');
  assert.equal(rows[1].fgIsBlocked, false, 'and clears the block on the same tick');
  assert.equal(rows[1].enterBlocked, false, 'generic Copilot chat must be usable');
  assert.equal(rows[2].enterBlocked, false);
});

test('switching to a DIFFERENT blocked agent re-arms under that agent', { skip: !win }, async () => {
  const rows = await scenario('agent_switch_to_other_blocked');
  assert.equal(rows[0].blockedAgent, 'AI Learning Advisor');
  for (const r of rows.slice(1)) {
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}`);
    // Re-attributed, so Request Access names the agent actually being hit.
    assert.equal(r.blockedAgent, 'Finance Analyst', `tick ${r.tick}`);
    assert.equal(r.latchHeld, true, `tick ${r.tick}`);
  }
});

test('switching to an agent nobody blocked clears the block in one tick', { skip: !win }, async () => {
  const rows = await scenario('agent_switch_to_unblocked');
  assert.equal(rows[0].enterBlocked, true);
  for (const r of rows.slice(1)) {
    assert.equal(r.agentOutcome, 'Named', `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}: a Named read for an unblocked agent is authoritative`);
    assert.equal(r.latchHeld, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
  }
});

test('an admin lifting an agent-scoped block takes effect immediately', { skip: !win }, async () => {
  const rows = await scenario('agent_admin_unblocks');
  assert.equal(rows[0].enterBlocked, true);
  assert.equal(rows[1].fgIsBlocked, false, 'the block must drop on the next tick, not after the latch TTL');
  assert.equal(rows[1].latchHeld, false);
  assert.equal(rows[1].enterBlocked, false);
});

test('the panic hotkey still overrides an agent-scoped block', { skip: !win }, async () => {
  const rows = await scenario('agent_panic_hotkey');
  assert.equal(rows[0].enterBlocked, true);
  assert.equal(rows[1].enterBlocked, false, 'Disarmed() must win over every other signal');
  assert.equal(rows[1].fgIsBlocked, true, 'the state is untouched — only the decision is suppressed');
});

test('a real app switch retires the agent latch at once', { skip: !win }, async () => {
  const rows = await scenario('agent_app_switch');
  assert.equal(rows[0].latchHeld, true);
  assert.equal(rows[1].latchHeld, false, 'a pid change must retire the latch');
  assert.equal(rows[1].fgIsBlocked, false);
  assert.equal(rows[1].enterBlocked, false);
});

test('generic Copilot chat is never blocked at all when only an agent is blocked', { skip: !win }, async () => {
  // Confirmed live: with "AI Learning Advisor" blocked, generic Copilot chat sent
  // normally. The switch-away case is covered above; this is the cold start, where
  // there is no latch to retire and so nothing but the block decision itself can
  // be keeping Enter alive.
  const rows = await scenario('agent_generic_never_blocks');
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Generic', `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}: generic chat must be usable`);
    assert.equal(r.blockedByElement, false, `tick ${r.tick}`);
    // blockScope is only meaningful while a block is up; what matters here is
    // that no element latch was ever armed to hold one.
    assert.equal(r.latchKey, '', `tick ${r.tick}`);
  }
});

test('a DIFFERENT named agent is never blocked at all when only one agent is blocked', { skip: !win }, async () => {
  // The other half of the same live observation: a different chat/agent kept
  // sending. A Named read for an agent no row names is authoritative, so nothing
  // arms — this is the whole point of narrowing.
  const rows = await scenario('agent_other_named_never_blocks');
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Named', `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
    assert.equal(r.blockedByElement, false, `tick ${r.tick}`);
  }
});

test('LIVE ROUND replayed: blocked throughout, then unblocked immediately on switching away', { skip: !win }, async () => {
  // The 2026-08-27 verification round at the real 150ms cadence: ~3s in the
  // blocked agent's composer (the live read was clean 17/17; two transient
  // misreads are injected anyway, since the latch has to survive them), then a
  // switch to generic chat and to a different agent — both of which must send at
  // once, with no lingering block.
  const rows = await scenario('agent_live_round');
  assert.equal(rows.length, 23);
  const blocked = rows.slice(0, 20);
  // The transient misreads really happened, so the pass is not vacuous.
  assert.equal(blocked[7].agentOutcome, 'Unreadable');
  assert.equal(blocked[13].agentOutcome, 'NotComposer');
  for (const r of blocked) {
    assert.equal(r.enterBlocked, true, `tick ${r.tick} (outcome ${r.agentOutcome}) let Enter through`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}: never the whole app`);
    assert.equal(r.blockedAgent, 'AI Learning Advisor', `tick ${r.tick}`);
    assert.equal(r.latchKey, 'agent:m365_copilot', `tick ${r.tick}`);
    // No panel attribution: index.js resolves a tool_host from that field, and an
    // agent-surface id is not a panel id.
    assert.equal(r.panelField, '', `tick ${r.tick}`);
  }
  // Generic chat, on the very next tick — no grace period, because the read came
  // from the composer itself and is authoritative.
  for (const r of rows.slice(20)) {
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
    assert.equal(r.latchHeld, false, `tick ${r.tick}: no lingering block`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
  }
  assert.equal(rows[22].agentOutcome, 'Named', 'the last ticks are a different, unblocked agent');
});

test('WEBVIEW2 REGRESSION: an element in a DIRECT CHILD process still reads as the open agent', { skip: !win }, async () => {
  // THE bug the live pass found. M365Copilot.exe hosts its UI in WebView2, so the
  // focused composer element is UIA-owned by a child msedgewebview2.exe process,
  // not by the foreground window's own process. ReadFocusedAgentName required an
  // exact pid match, so every tick came back Unreadable and the narrowing could
  // never arm at all — an agent-scoped block silently enforced nothing.
  //
  // Driven with REAL processes: the harness spawns genuine children of itself and
  // asks the REAL ElementPidBelongsToForeground about the pid relationships, so
  // the parent-pid lookup (CreateToolhelp32Snapshot) actually runs.
  const rows = await scenario('agent_webview_child_pid');
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Named', `tick ${r.tick}: a child process's element must be readable`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}`);
    assert.equal(r.blockedByElement, true, `tick ${r.tick}`);
    assert.equal(r.latchKey, 'agent:m365_copilot', `tick ${r.tick}`);
  }
});

test('…and the check it preserves still rejects a genuinely unrelated process', { skip: !win }, async () => {
  // The safety half of the same fix. FocusedElement is a GLOBAL read that was
  // measured returning an element from another window in another process, so
  // accepting one generation must not have become "accept anything". Two shapes,
  // both a real live process and neither a child of the foreground pid: a SIBLING
  // process, and the foreground process's own PARENT (the rule is one-directional).
  // Both must land on Unreadable and arm nothing, even though the element's
  // properties would have read as the blocked agent.
  const rows = await scenario('agent_unrelated_pid_rejected');
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Unreadable', `tick ${r.tick}: an unrelated process is no evidence`);
    assert.equal(r.blockedByElement, false, `tick ${r.tick}`);
    assert.equal(r.latchKey, '', `tick ${r.tick}: nothing may be armed off a rejected read`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
  }
});
