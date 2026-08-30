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

// ── HOST APPS: agent-scoped enforcement inside Microsoft Teams ───────────────
//
// Teams is NOT an AI app. It is a general-purpose communications client that
// happens to host one Copilot Studio agent among a company's DMs, channels and
// meetings, and the composer's UIA Name is the literal "Type a message" in every
// one of them — so the composer-name mechanism the M365Copilot surface uses
// cannot work here at all. The WINDOW TITLE is what names the conversation.
//
// Two properties are under test, and the second matters more than the first:
//   1. when it CAN prove a blocked agent's conversation is open, enforcement is
//      confined to exactly that conversation;
//   2. when it CANNOT prove it, there is NO BLOCK AT ALL. Never a whole-app
//      fallback. A whole-app block here means the user cannot message a
//      colleague, post in a channel or reply in a meeting — because one agent
//      inside the app is blocked. That is the inversion this feature exists for,
//      and `teams_unverified_never_whole_app` below is its proof.

test('SHIPPING STATE: the Teams surface is completely inert — no block, and no read at all', { skip: !win }, async () => {
  // Stages 1-2 ship the mechanism, not the enforcement: teams_desktop and
  // teams_composer both carry enforce:false/verified:false, pinned in
  // ai-processes.test.mjs. With a real agent-scoped row present, the blocked
  // agent's conversation open and its composer focused, nothing whatsoever may
  // happen.
  const rows = await scenario('teams_shipped_is_inert');
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
    assert.equal(r.fgIsAi, false, `tick ${r.tick}: Teams must not become an AI surface`);
    assert.equal(r.fgIsPanel, false, `tick ${r.tick}`);
    // Unreadable proves NO READ HAPPENED — not that a read failed. An
    // unverified host-app surface must not even look at the window title.
    assert.equal(r.agentOutcome, 'Unreadable', `tick ${r.tick}: no read may occur at all`);
    assert.equal(r.matched, '', `tick ${r.tick}: no accessibility read either`);
  }
});

test('THE INVERSION: an unverified HOST-APP surface produces NO BLOCK, never a whole-app one', { skip: !win }, async () => {
  // THE most important test in this feature.
  //
  // Compare with `agent_unverified_surface_whole_app` above, which is the same
  // question asked of a CHAT app: there, "cannot narrow to one agent" correctly
  // falls back to blocking the whole application, because the whole application
  // is an AI product and the user only loses an AI tool.
  //
  // Here the same fallback would disable Microsoft Teams. So it must not exist:
  // the row's agent is genuinely open, the surface genuinely cannot narrow, and
  // the answer is no block — no app scope, no panel scope, no agent scope.
  const rows = await scenario('teams_unverified_never_whole_app');
  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}: a host app must NEVER be blocked whole`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'app', `tick ${r.tick}: 'app' is only the no-block default here`);
    assert.equal(r.blockedAgent, '', `tick ${r.tick}: nothing may be attributed`);
    assert.equal(r.latchKey, '', `tick ${r.tick}`);
  }
});

test('a PLATFORM-scoped row against Teams blocks nothing, armed catalog or not', { skip: !win }, async () => {
  // An absent agent_scope is the pre-existing row shape and means "block the
  // whole platform". Against a host app that is precisely the outcome this
  // feature prevents, so the coarse arm is guarded on the PROCESS being a host
  // app — not on the surface being verified.
  for (const name of ['teams_platform_row_never_blocks', 'teams_platform_row_no_read']) {
    const rows = await scenario(name);
    assert.equal(rows.length, 3, name);
    for (const r of rows) {
      assert.equal(r.fgIsBlocked, false, `${name} tick ${r.tick}`);
      assert.equal(r.enterBlocked, false, `${name} tick ${r.tick}`);
      // …and it does not license the accessibility/title read either: only
      // agent_scope:'agent' puts a process into _agentScopedProcs.
      assert.equal(r.agentOutcome, 'Unreadable', `${name} tick ${r.tick}: no read may occur`);
      assert.equal(r.matched, '', `${name} tick ${r.tick}`);
    }
  }
});

test('a host-keyed process_name or panel row against Teams is refused outright', { skip: !win }, async () => {
  // Neither row can be synthesised: processesForHost() excludes a host app, and
  // teams_composer carries host:null so panelForHost() cannot resolve it
  // (both asserted in ai-processes.test.mjs / ai-panels.test.mjs). These prove
  // the .ps1 refuses such a row even if a bug in the other file produced one —
  // the two guards are independent, which is the point.
  for (const name of ['teams_process_row_never_blocks', 'teams_panel_row_never_blocks']) {
    const rows = await scenario(name);
    assert.equal(rows.length, 3, name);
    for (const r of rows) {
      assert.equal(r.fgIsBlocked, false, `${name} tick ${r.tick}: a host app takes no coarse block`);
      assert.equal(r.enterBlocked, false, `${name} tick ${r.tick}`);
    }
  }
});

test('PRIVACY GATE: with no agent-scoped policy for Teams, nothing about Teams is read', { skip: !win }, async () => {
  // Reading a company's chat window titles to learn what is open is justified
  // only by a policy that needs the answer. The catalog here is fully ARMED and
  // the blocked agent's own composer is focused — the only thing missing is a
  // row whose platform covers ms-teams, and that alone must stop every read.
  const rows = await scenario('teams_no_policy_no_read');
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Unreadable', `tick ${r.tick}: no window title may be read`);
    assert.equal(r.matched, '', `tick ${r.tick}: no accessibility read either`);
    assert.equal(r.fgIsAi, false, `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
  }
});

test('ARMED: the blocked agent conversation is blocked, at AGENT scope, via the composer', { skip: !win }, async () => {
  // The mechanism Stage 3 will turn on, driven with the TEST-ONLY armed flags.
  // Both the title read (the conversation) and the element read (the composer)
  // have to agree before anything is governed.
  const rows = await scenario('teams_agent_blocked');
  assert.equal(rows.length, 20);
  for (const r of rows) {
    assert.equal(r.agentOutcome, 'Named', `tick ${r.tick}`);
    assert.equal(r.matched, 'teams_composer', `tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
    // AGENT scope, never app: this is what keeps the standing "this app is
    // blocked" bar off the screen and the Request Access modal naming the agent.
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}`);
    assert.equal(r.blockedByElement, true, `tick ${r.tick}`);
    assert.equal(r.latchKey, 'agent:teams_desktop', `tick ${r.tick}`);
    // The name that reaches a block event is the ADMIN-TYPED one from the row,
    // never the string parsed out of the window title.
    assert.equal(r.blockedAgent, 'IT Help Desk Agent', `tick ${r.tick}`);
  }
});

test('ARMED: the same agent reached through copilot_studio is covered too', { skip: !win }, async () => {
  // A Copilot Studio agent added to Teams keeps its own platform id.
  // PLATFORM_PROCS maps copilot_studio to both Copilot builds AND to ms-teams,
  // which is why the row reaches the Teams process at all.
  const rows = await scenario('teams_agent_via_copilot_studio');
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
});

test('ARMED: a 1:1 DM, a default-named group chat, a channel and the Activity tab are untouched', { skip: !win }, async () => {
  // The collateral this feature must never cause, on the four measured title
  // shapes. Every one of them has the blocked agent's row live and the composer
  // focused — the ONLY difference is which conversation the title names.

  // A DM's title has NO leading kind segment: segment 0 is the colleague's
  // display name. Without the kind check this would read as an agent named
  // after a person, so it must land in NO EVIDENCE.
  const dm = await scenario('teams_dm_never_blocks');
  assert.equal(dm.length, 5);
  for (const r of dm) {
    assert.equal(r.agentOutcome, 'NotComposer', `dm tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `dm tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `dm tick ${r.tick}`);
    assert.equal(r.fgIsAi, false, `dm tick ${r.tick}: no capture in a colleague DM`);
  }

  // A human group chat's title has the IDENTICAL 5-segment shape as the agent's
  // — kind alone cannot separate them. Teams' own participant naming is what
  // does, and it is AUTHORITATIVE "no agent open" rather than no evidence.
  const group = await scenario('teams_group_chat_never_blocks');
  assert.equal(group.length, 5);
  for (const r of group) {
    assert.equal(r.agentOutcome, 'Generic', `group tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `group tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `group tick ${r.tick}`);
    assert.equal(r.fgIsAi, false, `group tick ${r.tick}`);
  }

  // A channel post view, the Activity tab, and Teams' generic Copilot panel.
  const other = await scenario('teams_other_surfaces_never_block');
  assert.equal(other.length, 3);
  for (const r of other) {
    assert.equal(r.agentOutcome, 'NotComposer', `other tick ${r.tick}`);
    assert.equal(r.fgIsBlocked, false, `other tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `other tick ${r.tick}`);
    assert.equal(r.fgIsAi, false, `other tick ${r.tick}`);
  }
});

test('ARMED: leaving the blocked conversation releases the block within ONE tick', { skip: !win }, async () => {
  // The FAIL-OPEN direction, and the reason a host app's latch rule is wider
  // than a chat app's. For M365Copilot a NotComposer read is no evidence (the
  // global focused-element read landed on the transcript) and the latch survives
  // it. In window-title mode NotComposer comes from a title that WAS read and
  // simply is not a nameable Chat — positive evidence the blocked conversation
  // is not open. Holding the block past it would leave Enter dead in a channel.
  for (const name of ['teams_release_to_channel', 'teams_release_to_activity', 'teams_release_to_dm']) {
    const rows = await scenario(name);
    assert.equal(rows.length, 3, name);
    assert.equal(rows[0].fgIsBlocked, true, `${name}: the block must be established first`);
    assert.equal(rows[0].enterBlocked, true, name);
    for (const r of rows.slice(1)) {
      assert.equal(r.fgIsBlocked, false, `${name} tick ${r.tick}: must release on the very next tick`);
      assert.equal(r.enterBlocked, false, `${name} tick ${r.tick}`);
      assert.equal(r.latchHeld, false, `${name} tick ${r.tick}: no lingering latch`);
      assert.equal(r.latchKey, '', `${name} tick ${r.tick}`);
    }
  }
});

test('ARMED: switching to a different, unblocked agent clears in one tick', { skip: !win }, async () => {
  const rows = await scenario('teams_other_agent_clears');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].fgIsBlocked, true);
  for (const r of rows.slice(1)) {
    assert.equal(r.agentOutcome, 'Named', `tick ${r.tick}: a different agent is still authoritative`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
  }
});

test('ARMED: the composer losing focus stops CAPTURE at once and the block soon after', { skip: !win }, async () => {
  // The user scrolls the blocked agent's transcript. The title still says the
  // agent conversation is open, so the block is correct to stand through the
  // pre-existing 3s sticky window — but _fgIsPanel goes false immediately, and
  // PanelUiaOk/PanelEnforceOk deny every content read from that instant.
  //
  // Tick 2 ages the sticky window out and shows the block does NOT stand
  // indefinitely on an unfocused composer. That is the fail-open direction
  // again: a host app gives the block up rather than holding it on weak evidence.
  const rows = await scenario('teams_composer_not_focused');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].matched, 'teams_composer');
  assert.equal(rows[0].fgIsBlocked, true);
  assert.equal(rows[0].fgIsPanel, true);
  // Focus moved to the message list: no signature match, so no capture surface.
  assert.equal(rows[1].matched, '', 'the message list is not the composer');
  assert.equal(rows[1].latchHeld, false, 'an authoritative read retires the latch');
  assert.equal(rows[1].fgIsBlocked, true, 'the sticky window still holds the block');
  // …and once it lapses, the block is gone rather than stuck.
  assert.equal(rows[2].fgIsBlocked, false);
  assert.equal(rows[2].enterBlocked, false);
  assert.equal(rows[2].fgIsAi, false);
});

test('ARMED: an unreadable TITLE is no evidence — the latch survives it, and is bounded', { skip: !win }, async () => {
  // The one outcome in window-title mode that is a genuine read failure rather
  // than a fact about the open conversation: no window handle, or GetWindowText
  // returned nothing. That, and only that, holds the block.
  const rows = await scenario('teams_unreadable_title');
  assert.equal(rows.length, 6);
  assert.equal(rows[0].agentOutcome, 'Named');
  for (const r of rows.slice(1)) {
    assert.equal(r.agentOutcome, 'Unreadable', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}: a failed read must not unblock`);
    assert.equal(r.latchHeld, true, `tick ${r.tick}`);
    assert.equal(r.latchKey, 'agent:teams_desktop', `tick ${r.tick}`);
  }
  // Fail-closed must not become fail-stuck: a Teams whose title reads never
  // recover cannot leave Enter dead in a chat client forever.
  const [expired] = await scenario('teams_latch_expires');
  assert.equal(expired.latchHeld, false);
  assert.equal(expired.fgIsBlocked, false);
  assert.equal(expired.enterBlocked, false);
});

test('ARMED: an admin lifting the block takes effect at once, and stops the reads too', { skip: !win }, async () => {
  const rows = await scenario('teams_admin_unblocks');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fgIsBlocked, true);
  assert.equal(rows[1].fgIsBlocked, false, 'un-blocking must be immediate');
  assert.equal(rows[1].enterBlocked, false);
  // Dropping the row also drops the PRIVACY GATE with it — no policy, no read.
  assert.equal(rows[1].agentOutcome, 'Unreadable', 'a lifted policy must stop licensing the read');
  assert.equal(rows[1].matched, '');
});

test('ARMED: the panic hotkey still releases a Teams block', { skip: !win }, async () => {
  const rows = await scenario('teams_panic_hotkey');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].enterBlocked, true);
  assert.equal(rows[1].enterBlocked, false, 'Ctrl+Alt+Shift+F12 must release everything');
});

test('ARMED: the Teams WebView2 child-process composer matches, unrelated processes do not', { skip: !win }, async () => {
  // ms-teams.exe hosts its real UI in a child msedgewebview2.exe — confirmed
  // live via Win32_Process ParentProcessId, exactly as M365Copilot does. With
  // ReadFocusedPanel's default exact-pid rule the composer could never be
  // matched at all, so the whole feature would be unreachable. Driven with REAL
  // child processes, so the parent-pid lookup actually runs.
  const child = await scenario('teams_webview_child_pid');
  assert.equal(child.length, 3);
  for (const r of child) {
    assert.equal(r.matched, 'teams_composer', `tick ${r.tick}: a child process element must match`);
    assert.equal(r.fgIsBlocked, true, `tick ${r.tick}`);
    assert.equal(r.blockScope, 'agent', `tick ${r.tick}`);
    assert.equal(r.enterBlocked, true, `tick ${r.tick}`);
  }
  // …and widening to one generation must not have become "accept anything".
  // A sibling process and the foreground process's own parent are both rejected,
  // so a global FocusedElement read landing in another app can never govern a
  // Teams tick. Note the TITLE still reads Named — it is a property of the
  // foreground WINDOW, not of the stolen element — which is exactly why the
  // element match is required as a separate condition.
  const rejected = await scenario('teams_unrelated_pid_rejected');
  assert.equal(rejected.length, 2);
  for (const r of rejected) {
    assert.equal(r.matched, '', `tick ${r.tick}: an unrelated process element is not evidence`);
    assert.equal(r.fgIsBlocked, false, `tick ${r.tick}: and cannot govern the tick`);
    assert.equal(r.enterBlocked, false, `tick ${r.tick}`);
    assert.equal(r.fgIsAi, false, `tick ${r.tick}`);
  }
});

test('REGRESSION: M365Copilot behaves exactly as before, with host apps in the catalog', { skip: !win }, async () => {
  // Run last in the harness, with the SHIPPED catalog reloaded, so a
  // fixture-only payload cannot be what makes it pass. Every outcome here is
  // identical to the pre-host-app behaviour: the composer-name read, the
  // one-tick clear on Generic, and the latch surviving both no-evidence
  // outcomes (NotComposer and Unreadable).
  const rows = await scenario('m365_unaffected_by_host_apps');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.agentOutcome),
    ['Named', 'Generic', 'Named', 'NotComposer', 'Unreadable']);
  assert.deepEqual(rows.map((r) => r.fgIsBlocked), [true, false, true, true, true]);
  assert.deepEqual(rows.map((r) => r.enterBlocked), [true, false, true, true, true]);
  for (const r of rows) {
    // An agent surface is NOT a panel — making one would change PanelUiaOk /
    // PanelEnforceOk for M365Copilot and silently alter its content scanning.
    assert.equal(r.fgIsPanel, false, `tick ${r.tick}: the chat-app branch must not touch panel state`);
    assert.equal(r.panelField, '', `tick ${r.tick}`);
  }
  // NotComposer and Unreadable are still NO EVIDENCE for a composer-name
  // surface — the wider host-app latch rule must not have leaked into it.
  assert.equal(rows[3].latchKey, 'agent:m365_copilot');
  assert.equal(rows[4].latchKey, 'agent:m365_copilot');
});
