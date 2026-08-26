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
    assert.equal(r.blockedByPanel, true, `tick ${r.tick}`);
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
    assert.equal(r.latchPanel, 'claude_code', `tick ${r.tick}`);
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
    assert.equal(r.blockedByPanel, true, `tick ${r.tick}`);
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
    assert.equal(r.latchPanel, 'cursor_composer', `tick ${r.tick}`);
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
  assert.equal(late.blockedByPanel, true);
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
