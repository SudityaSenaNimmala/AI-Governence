// Behavioural tests for Tier B's FOCUSED-ELEMENT PIN and RICH-CONTENT refusal
// in enforcer-win.ps1.
//
// NOTHING HERE INSTALLS A KEYBOARD HOOK AND NOTHING HERE TYPES ANYTHING. The
// harness drives RunRewriteCore — the real write path — through a SCRIPTED FAKE
// of its I/O seam (IRewriteIo), which records every key it is asked to send and
// sends none. LiveRewriteIo, the only implementation that reaches SendInput, is
// never constructed by the harness; the first two tests below pin both halves of
// that (the harness never names it, and RunRewriteCore has no side effect that
// bypasses the seam).
//
// ── The gap this exists to catch ─────────────────────────────────────────────
// RunRewrite compared the focused element's runtime id to the pinned one ONCE,
// then waited up to 2.5s for the confirm chord to be released, then sent Ctrl+A,
// Delete and the retype — re-checking only the WINDOW after that. Focus moving
// to another element in the same window during the wait (a search box, a second
// composer) meant Ctrl+A + Delete wiped THAT element and the masked prompt was
// typed into it. Now the pin is re-read before Ctrl+A, before every segment and
// every N chunks, and before Enter; a mismatch sends not one more key, and each
// point has its own reason (element_changed_before_write / _mid_write /
// _before_send). The verified text is also re-read one final time right before
// the Enter, so a paste landing after the verify can never be sent by our Enter
// and audited as a clean redact.
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
const HARNESS = join(__dirname, 'helpers', 'rewrite-focus-pin-harness.ps1');
// Same escape hatch as the other enforcer harnesses: aim this at a PRE-fix
// source and the `available` assertion fails first. Nothing in the product
// reads it.
const ENFORCER = process.env.CFAI_TEST_ENFORCER_PS1 || join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');

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
  cached = lines.map((l) => JSON.parse(l));
  return cached;
}
async function cases(name) {
  const rows = (await run()).filter((r) => r.case === name);
  assert.ok(rows.length, `harness produced no observations for case '${name}'`);
  return rows;
}
async function variant(caseName, v) {
  const row = (await cases(caseName)).find((r) => r.variant === v);
  assert.ok(row, `no '${caseName}' observation for '${v}'`);
  return row;
}

const CTRL_A = 'combo:17:65';
const DELETE = 'press:46';
const ENTER = 'press:13';
const NEWLINE = 'combo:16:13';
const typed = (log) => log.filter((e) => e.startsWith('type:')).map((e) => e.slice(5));
const sentAnyKey = (log) => log.some((e) => e.startsWith('combo:') || e.startsWith('press:') || e.startsWith('type:'));

function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|#)/.test(l)).join('\n');
}

// ── Safety of the harness itself ─────────────────────────────────────────────

test('harness never calls Start(), never installs a hook, and never constructs the live I/O', async () => {
  const src = await readFile(HARNESS, 'utf8');
  const code = codeOnly(src);
  assert.equal(/\[CfaiEnforcer\]::Start\(/.test(code), false, 'the harness must never call Start()');
  assert.equal(/SetWindowsHookEx/.test(code), false);
  // The fake is the ONLY I/O it may hand the write path. LiveRewriteIo is what
  // reaches SendInput; RunRewrite constructs it; StartRewrite spawns RunRewrite.
  for (const forbidden of ['LiveRewriteIo', "'RunRewrite'", 'StartRewrite', 'SendInput', 'SendKeyCombo', 'SendUnicodeChunk', 'SendKeyPress']) {
    assert.equal(code.includes(forbidden), false, `the harness must never reach ${forbidden}`);
  }
  assert.match(code, /RunRewriteCore/);
  assert.match(code, /class FakeRewriteIo : CfaiEnforcer\.IRewriteIo/);
});

test('RunRewriteCore has NO side effect that bypasses the I/O seam', async () => {
  // What makes the fake-driven tests below meaningful AND safe: if the core
  // could call SendInput / Thread.Sleep / GetForegroundWindow / UIA directly,
  // the fake would neither see it nor stop it.
  const src = await readFile(ENFORCER, 'utf8');
  const core = codeOnly(src.slice(src.indexOf('static void RunRewriteCore('), src.indexOf('// ── Rich content in the composer')));
  assert.ok(core.length > 0, 'expected a RunRewriteCore body');
  for (const forbidden of ['SendInput', 'SendKeyCombo(', 'SendKeyPress(', 'SendUnicodeChunk(', 'SendKeyEvent(',
    'Thread.Sleep', 'GetForegroundWindow', 'AutomationElement', 'ReadText(', 'Down(']) {
    assert.equal(core.includes(forbidden), false, `RunRewriteCore must go through IRewriteIo, not ${forbidden}`);
  }
  // …and the live wrapper is exactly: construct the real I/O, run the core,
  // report an exception, release the in-progress flag.
  const wrapper = src.slice(src.indexOf('static void RunRewrite(string blockId'), src.indexOf('static void RunRewriteCore('));
  assert.match(wrapper, /RunRewriteCore\(new LiveRewriteIo\(\), blockId, original, masked, pinnedRid, pinnedHwnd\);/);
  assert.match(wrapper, /finally \{ _rewriteInProgress = false; \}/);
  // LiveRewriteIo is constructed in exactly one place.
  assert.equal((codeOnly(src).match(/new LiveRewriteIo\(\)/g) || []).length, 1);
  // The live implementation's calls are the ones RunRewrite used to make inline.
  const live = src.slice(src.indexOf('sealed class LiveRewriteIo'), src.indexOf('// ── The FOCUSED-ELEMENT PIN'));
  assert.match(live, /public IntPtr ForegroundWindow\(\) \{ return GetForegroundWindow\(\); \}/);
  assert.match(live, /return Down\(VK_CONTROL\) \|\| Down\(VK_MENU\) \|\| Down\(VK_SHIFT\) \|\| Down\(VK_RETURN\);/);
  assert.match(live, /public void KeyCombo\(int vkMod, int vkKey\) \{ SendKeyCombo\(vkMod, vkKey\); \}/);
  assert.match(live, /public void TypeChunk\(string chunk\) \{ SendUnicodeChunk\(chunk\); \}/);
  // A FRESH focused element on every pin read -- through the same WebView2Holder
  // resolver the panel read uses (2026-09-24), so the pin agrees with the panel.
  assert.match(live, /var f = EffectiveFocusedElement\(\);/, 'the pin check must read a FRESH focused element');
});

test('THE FIX EXISTS: the pin check and the rich-content walk are real members', { skip: !win }, async () => {
  const [c] = await cases('constants');
  assert.equal(c.available, true, 'RunRewriteCore / FocusStillPinned / SubtreeHasRichContent are missing');
  assert.equal(c.pin_read_ms, 15, 'each pin read is charged at the top of the 5-15ms estimate');
  assert.equal(c.pin_every_chunks, 4);
  assert.equal(c.rich_max_nodes, 50, 'the rich-content walk is bounded at 50 nodes');
});

// ── The happy path is unchanged ──────────────────────────────────────────────

test('a rewrite whose focus never moves sends exactly Ctrl+A, Delete, the text and Enter', { skip: !win }, async () => {
  const r = await variant('rewrite', 'happy_single');
  assert.equal(r.result, 'ok');
  assert.equal(r.reason, 'sent');
  const keys = r.log.filter((e) => e !== 'rid_read' && e !== 'selectall');
  assert.deepEqual(keys, [CTRL_A, DELETE, 'type:my ssn is [SSN]', ENTER]);
  // (a) before Ctrl+A, (b) before the one segment, (c) before Enter.
  assert.equal(r.log.filter((e) => e === 'rid_read').length, 3);
  assert.ok(r.log.indexOf('rid_read') < r.log.indexOf(CTRL_A), 'the pin is re-read BEFORE Ctrl+A');
  assert.equal(r.log[r.log.length - 2], 'rid_read', 'and immediately before Enter');

  const ml = await variant('rewrite', 'happy_multiline');
  assert.equal(ml.result, 'ok');
  assert.deepEqual(typed(ml.log), ['hello team', 'my ssn is [SSN]', 'thanks']);
  assert.equal(ml.log.filter((e) => e === NEWLINE).length, 2);
  // One read per segment, each BEFORE that segment's newline combination.
  assert.equal(ml.log.filter((e) => e === 'rid_read').length, 1 + 3 + 1);
  const firstNl = ml.log.indexOf(NEWLINE);
  assert.equal(ml.log[firstNl - 1], 'rid_read', 'a line break is input too — the pin is checked before it');

  const long = await variant('rewrite', 'happy_long_line');
  assert.equal(long.result, 'ok');
  // 130 characters = 6 chunks: segment read + one before chunk index 4.
  assert.equal(long.log.filter((e) => e === 'rid_read').length, 1 + 2 + 1);
});

// ── (a) focus moves during the modifier wait ────────────────────────────────

test('focus moves during the modifier wait → abort with NO Ctrl+A, no Delete, nothing typed', { skip: !win }, async () => {
  const r = await variant('rewrite', 'focus_moves_during_modifier_wait');
  assert.equal(r.result, 'aborted');
  // Its OWN reason: nothing was typed, so the dialog offers a plain retry and
  // NOT the copy-masked fallback (see the safety test's reason mirror).
  assert.equal(r.reason, 'element_changed_before_write');
  assert.equal(r.prompt_emitted, false, 'nothing was sent, so nothing is counted as a send');
  assert.equal(r.log.includes(CTRL_A), false, 'Ctrl+A must never be sent after a mismatch');
  assert.equal(sentAnyKey(r.log), false, 'no key of any kind may be sent');
  assert.equal(r.composer, 'my ssn is 123-45-6789', 'whatever the element held is untouched');
});

test('an unreadable pin read is retried ONCE, and a second failure fails closed', { skip: !win }, async () => {
  const twice = await variant('rewrite', 'unreadable_twice_before_ctrl_a');
  assert.equal(twice.result, 'aborted');
  assert.equal(twice.reason, 'element_changed_before_write');
  assert.equal(sentAnyKey(twice.log), false);
  assert.equal(twice.log.filter((e) => e === 'rid_read').length, 2, 'exactly one retry');

  const once = await variant('rewrite', 'unreadable_once_then_ok');
  assert.equal(once.result, 'ok', 'a single UIA hiccup must not cost the user the rewrite');
});

test('the WINDOW changing during the modifier wait still aborts before Ctrl+A', { skip: !win }, async () => {
  const r = await variant('rewrite', 'window_changes_during_modifier_wait');
  assert.equal(r.result, 'aborted');
  assert.equal(r.reason, 'focus_changed');
  assert.equal(sentAnyKey(r.log), false);
});

test('a REAL keystroke during the modifier wait aborts BEFORE Ctrl+A / Delete', { skip: !win }, async () => {
  // Previously the first sign of it was the write loop's own _rewriteAbort
  // check — after Ctrl+A + Delete had cleared the composer.
  const r = await variant('rewrite', 'keypress_during_modifier_wait');
  assert.equal(r.result, 'aborted');
  assert.equal(r.reason, 'interrupted_before_write');
  assert.equal(sentAnyKey(r.log), false, 'no key of any kind may be sent');
  assert.equal(r.log.includes('rid_read'), false, 'the abort flag is checked before any further UIA work');
  assert.equal(r.composer, 'my ssn is 123-45-6789', 'the composer is untouched');
});

// ── (b) focus moves mid-write ────────────────────────────────────────────────

test('focus moves between line segments → abort before the newline, never Enter', { skip: !win }, async () => {
  const r = await variant('rewrite', 'focus_moves_mid_write_multiline');
  assert.equal(r.result, 'aborted');
  assert.equal(r.reason, 'element_changed_mid_write');
  assert.deepEqual(typed(r.log), ['hello team'], 'nothing after the mismatch is typed');
  assert.equal(r.log.includes(NEWLINE), false, 'not even the newline combination');
  assert.equal(r.log.includes(ENTER), false, 'Enter is never sent after a mismatch');
  assert.equal(r.log[r.log.length - 1], 'rid_read', 'the mismatching read is the LAST thing that happened');
});

test('focus moves inside one long line → abort at the every-N-chunks check, never Enter', { skip: !win }, async () => {
  const r = await variant('rewrite', 'focus_moves_mid_write_long_line');
  assert.equal(r.result, 'aborted');
  assert.equal(r.reason, 'element_changed_mid_write');
  const [c] = await cases('constants');
  assert.equal(typed(r.log).length, c.pin_every_chunks, 'exactly the chunks before the check were typed');
  assert.equal(r.log.includes(ENTER), false);
  assert.equal(r.log[r.log.length - 1], 'rid_read');
});

// ── (c) focus moves before Enter ─────────────────────────────────────────────

test('focus moves after a verified write → no Enter into the other element', { skip: !win }, async () => {
  const r = await variant('rewrite', 'focus_moves_before_enter');
  // "failed", like focus_changed_before_send: the write verified, the send did not happen.
  assert.equal(r.result, 'failed');
  assert.equal(r.reason, 'element_changed_before_send');
  assert.equal(r.log.includes(ENTER), false);
  assert.equal(r.prompt_emitted, false);
  assert.equal(r.composer, 'my ssn is [SSN]', 'the masked text is left in the composer, unsent');
});

// ── The last gate before Enter ───────────────────────────────────────────────

test('a keystroke after the verify refuses the send — our Enter is never pressed', { skip: !win }, async () => {
  const r = await variant('rewrite', 'keypress_before_enter');
  assert.equal(r.result, 'failed');
  assert.equal(r.reason, 'interrupted_before_send');
  assert.equal(r.log.includes(ENTER), false);
  assert.equal(r.prompt_emitted, false);
});

test('THE RACE: a sensitive paste after the verify is never sent by our Enter, and re-arms the block', { skip: !win }, async () => {
  const r = await variant('rewrite', 'sensitive_paste_before_enter');
  assert.equal(r.result, 'failed');
  assert.equal(r.reason, 'content_changed_before_send');
  assert.equal(r.log.includes(ENTER), false, 'the pasted SSN must not be sent by the enforcer\'s own Enter');
  assert.equal(r.prompt_emitted, false, 'and it is not counted as a send');
  // The latches were cleared just before this gate; the final read re-arms the
  // UIA one, so the user's OWN next Enter is blocked immediately.
  assert.equal(r.block_uia, true);
  assert.equal(r.uia_patterns, 'ssn');
  // A benign change still refuses (it is not the verified text) but arms nothing.
  const benign = await variant('rewrite', 'benign_change_before_enter');
  assert.equal(benign.result, 'failed');
  assert.equal(benign.reason, 'content_changed_before_send');
  assert.equal(benign.log.includes(ENTER), false);
  assert.equal(benign.block_uia, false);
});

test('every successful send passes the final gate, and only a successful one is counted', { skip: !win }, async () => {
  for (const v of ['happy_single', 'happy_multiline', 'happy_long_line', 'unreadable_once_then_ok']) {
    const r = await variant('rewrite', v);
    assert.equal(r.result, 'ok', v);
    assert.equal(r.prompt_emitted, true, v);
    assert.equal(r.log[r.log.length - 1], ENTER, `${v}: Enter is the last thing sent`);
  }
});

test('the final gate sits AFTER the latch clear and IMMEDIATELY before the Enter', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const core = src.slice(src.indexOf('static void RunRewriteCore('), src.indexOf('// ── Rich content in the composer'));
  const code = codeOnly(core);
  const clearIdx = code.indexOf('_blockPaste = false; _lastPasteTicks = 0;');
  const abortIdx = code.indexOf('if (_rewriteAbort) { EmitRewrite(blockId, "failed", "interrupted_before_send"); return; }');
  const readIdx = code.indexOf('string finalRead = io.ReadPinned();');
  const emitIdx = code.indexOf('Emit("prompt", _app, "", "send", masked.Length);');
  const enterIdx = code.indexOf('io.KeyPress(VK_RETURN);');
  for (const [n, i] of Object.entries({ clearIdx, abortIdx, readIdx, emitIdx, enterIdx })) assert.ok(i > 0, n);
  assert.ok(clearIdx < abortIdx && abortIdx < readIdx && readIdx < emitIdx && emitIdx < enterIdx,
    'latch clear → abort flag → final read → count → Enter');
  // Nothing that sleeps or does UIA work between the final read and the Enter.
  const between = code.slice(readIdx, enterIdx);
  assert.equal(/io\.(Sleep|FocusedRuntimeId|PinFocused|KeyCombo|TypeChunk)/.test(between), false);
  assert.match(between, /NormalizeWs\(finalRead\) != NormalizeWs\(masked\) \|\| !string\.IsNullOrEmpty\(finalHits\)/);
  assert.match(between, /_uiaPatterns = finalHits; _blockUia = finalHits\.Length > 0;/);
  // Pin check (a) reads the abort flag before any UIA work.
  const a = code.slice(code.indexOf('io.Sleep(20);'), code.indexOf('io.KeyCombo(VK_CONTROL, VK_A);'));
  assert.ok(a.indexOf('_rewriteAbort') < a.indexOf('FocusStillPinned'), 'the abort flag is checked first');
  assert.match(a, /"element_changed_before_write"/);
  assert.match(code, /EmitRewrite\(blockId, "failed", "element_changed_before_send"\)/);
});

// ── Rich content ─────────────────────────────────────────────────────────────

test('a rich-content composer is refused at write time before anything is cleared', { skip: !win }, async () => {
  const r = await variant('rewrite', 'rich_content_composer');
  assert.equal(r.result, 'aborted');
  assert.equal(r.reason, 'rich_content');
  assert.equal(sentAnyKey(r.log), false);
  assert.equal(r.composer, 'my ssn is 123-45-6789');
});

test('the rich-content walk finds Hyperlink / Image / Table / List, and nothing else', { skip: !win }, async () => {
  const rows = new Map((await cases('rich_walk')).map((r) => [r.variant, r]));
  for (const r of rows.values()) assert.equal(r.available, true);
  for (const v of ['mention_pill_hyperlink', 'inline_image', 'table', 'code_block_list', 'deep_hyperlink']) {
    assert.equal(rows.get(v).rich, true, `${v} must be refused`);
  }
  for (const v of ['plain_composer', 'empty_composer', 'root_itself_is_list']) {
    assert.equal(rows.get(v).rich, false, `${v} must still be offered`);
  }
});

test('the rich-content walk is BOUNDED at 50 nodes, and reaching the cap without a verdict FAILS CLOSED', { skip: !win }, async () => {
  const [c] = await cases('constants');
  const rows = new Map((await cases('rich_walk')).map((r) => [r.variant, r]));
  for (const r of rows.values()) {
    assert.ok(r.visited <= c.rich_max_nodes, `${r.variant} visited ${r.visited} nodes`);
  }
  // A node past the cap is never visited — and the composer is refused anyway,
  // because "we did not look at all of it" is not "it is plain".
  assert.equal(rows.get('rich_beyond_cap').visited, c.rich_max_nodes);
  assert.equal(rows.get('rich_beyond_cap').rich, true);
  assert.equal(rows.get('plain_hits_cap').rich, true, 'a cap hit with nodes unvisited counts as rich');
  assert.equal(rows.get('rich_at_cap').rich, true, 'the 50th descendant IS reached');
  // Exactly the cap and no more: fully walked, so plain is plain.
  assert.equal(rows.get('plain_exactly_cap').visited, c.rich_max_nodes);
  assert.equal(rows.get('plain_exactly_cap').rich, false);
});

test('no Tokenize & Send OFFER is pinned for a rich composer, and the walk reads structure only', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const pending = src.slice(src.indexOf('static void UpdatePendingRewrite()'), src.indexOf('static string _pastePatternsValue'));
  // Walked only for a candidate that would otherwise be offered, OUTSIDE the
  // pin lock, and folded into the offer gate with its own why_not.
  assert.match(pending, /bool rich = mask\.Ok && rid != null && ComposerHasRichContentCached\(el, rid, text\);/);
  const richIdx = pending.indexOf('bool rich =');
  const lockIdx = pending.indexOf('lock (_pendingLock)', pending.indexOf('var mask = ComputeMaskCandidate(text);'));
  assert.ok(richIdx > 0 && lockIdx > 0 && richIdx < lockIdx, 'the UIA walk must run BEFORE (outside) the pin lock');
  assert.match(pending, /if \(mask\.Ok && rid != null && newlineOk && !rich\)/);
  assert.match(pending, /: rich \? "rich_content"/);
  // The walk classifies CONTROL TYPES and reads nothing else — no Name, no
  // Value, no text of any node.
  const walk = codeOnly(src.slice(src.indexOf('// ── Rich content in the composer'), src.indexOf('// Offer-time cache')));
  assert.match(walk, /const int RICH_WALK_MAX_NODES = 50;/);
  assert.match(walk, /\.Current\.ControlType/);
  for (const forbidden of ['.Current.Name', 'ValuePattern', 'TextPattern', 'ReadText', 'Emit(', 'Console.Out']) {
    assert.equal(walk.includes(forbidden), false, `the rich-content walk must not touch ${forbidden}`);
  }
  // A walk that throws is fail-CLOSED (treated as rich), in both callers.
  assert.match(walk, /catch \{ return true; \}/);
});

// ── The budget ───────────────────────────────────────────────────────────────

test('EstimateWriteMs charges every in-write pin read, so offers still fit the budget', { skip: !win }, async () => {
  const [c] = await cases('constants');
  const est = new Map((await cases('estimate')).map((r) => [r.variant, r.estimate_ms]));
  // 1 char: 15 pace + 10 settle + 15 pin read.
  assert.equal(est.get('one_char'), 15 + 10 + c.pin_read_ms);
  // 120 chars = 5 chunks → pin reads: 1 per segment + floor(4/4) = 2.
  assert.equal(est.get('five_chunks'), 120 * 15 + 5 * 10 + 2 * c.pin_read_ms);
  // 130 chars = 6 chunks → still 2 reads (floor(5/4) = 1, plus the segment).
  assert.equal(est.get('six_chunks'), 130 * 15 + 6 * 10 + 2 * c.pin_read_ms);
  // 3 lines: a read per segment + two newline combos.
  assert.equal(est.get('three_lines'), 3 * (15 + 10 + c.pin_read_ms) + 2 * 25);
  // The derived cap still fits the usable budget WITH the pin reads — asserted
  // on the COMPILED EstimateWriteMs / WriteFitsBudget over a REWRITE_MAX_CHARS
  // string, not recomputed here. The character cap is unchanged, so nothing the
  // enforcer used to offer is lost; 7105 is the figure the .ps1's derivation
  // comment quotes.
  const cap = (await cases('estimate')).find((r) => r.variant === 'max_chars_line');
  assert.equal(cap.len, c.max_chars);
  assert.equal(cap.fits, true, 'a REWRITE_MAX_CHARS single line must still be offerable');
  assert.ok(cap.estimate_ms <= c.usable_ms, `the cap (${cap.estimate_ms}ms) must fit ${c.usable_ms}ms`);
  assert.equal(cap.estimate_ms, 7105);
  const src = await readFile(ENFORCER, 'utf8');
  assert.match(src, /19\*370 \+ 75 = 7105ms <= 7200ms usable/, 'the derivation comment quotes the same figure');
});

// ── BUG B (live 2026-09-24): invisible editor characters stopped the send ────
// Measured by read-only UIA: Teams' CKEditor composer value carried U+2060
// WORD JOINER x7 (CKEditor's inline filler) and M365 Copilot's composer read
// U+FFFC. NormalizeWs only collapsed whitespace, so the pinned original, the
// read-back verify and the pre-Enter check all compared unequal.
test('BUG B: invisible editor characters in every composer read no longer stop the send', { skip: !win }, async () => {
  for (const v of ['teams_ckeditor_inline_filler', 'teams_ckeditor_filler_at_end', 'm365_object_replacement_char', 'zero_width_mix']) {
    const r = await variant('rewrite', v);
    assert.equal(r.result, 'ok', `${v}: ${r.reason}`);
    assert.equal(r.reason, 'sent');
    assert.equal(r.log[r.log.length - 1], ENTER, `${v}: the Enter is sent automatically`);
    assert.deepEqual(typed(r.log), ['my ssn is [SSN]'], `${v}: no invisible character is typed back`);
  }
});

test('BUG B: StripInvisible is applied by ReadText and NormalizeWs; a button RELEASE no longer aborts a rewrite', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const read = src.slice(src.indexOf('static string ReadText(AutomationElement el)'), src.indexOf('static string StripInvisible(string s)'));
  assert.equal((read.match(/StripInvisible\(/g) || []).length, 2, 'both the ValuePattern and the TextPattern read');
  const strip = src.slice(src.indexOf('static string StripInvisible(string s)'), src.indexOf('static string ReadClipboard()'));
  for (const cp of ['0x200B', '0x200C', '0x200D', '0x2060', '0xFEFF', '0x00AD', '0xFFFC']) assert.ok(strip.includes(cp), cp);
  assert.ok(src.includes('return Regex.Replace(StripInvisible(s).Trim(), "\\\\s+", " ");'), 'NormalizeWs strips invisible characters');
  assert.match(src, /msg != WM_MOUSEMOVE && !IsMouseButtonUp\(msg\)\)/);
  assert.match(src, /return msg == 0x0202 \|\| msg == 0x0205 \|\| msg == 0x0208 \|\| msg == 0x020C;/);
});
