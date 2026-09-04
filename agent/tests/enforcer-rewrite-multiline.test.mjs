// Behavioural tests for Tier B's MULTI-LINE mask-and-send path in
// enforcer-win.ps1.
//
// NOTHING HERE INSTALLS A KEYBOARD HOOK AND NOTHING HERE TYPES ANYTHING —
// [CfaiEnforcer]::Start() is never called, and neither is RunRewrite (it calls
// SendInput, which would type into whatever window is focused on the machine
// running the suite). The harness lifts the C# out of the .ps1, compiles it, and
// drives every PURE decision RunRewrite makes by reflection; the source-level
// checks at the bottom cover the one part that cannot be executed offline.
//
// ── What this exists to catch ────────────────────────────────────────────────
// ComputeMaskCandidate rejected any composer text containing \n or \r with
// reason "multiline". That made Tokenize & Send nearly inert exactly where it
// is most needed: a Microsoft Teams message is routinely more than one line, and
// an IDE panel prompt almost always is. Nothing about the MASKING needed the
// restriction — span collection, cluster resolution and the splice are ordinary
// string/regex operations. What genuinely could not handle a line break was the
// WRITE: typing a literal newline into a chat composer submits the message
// half-written, which is the very keystroke the enforcer exists to intercept.
//
// So the fix is in the write path: type each line as text, and send the
// SURFACE'S OWN newline key combination between the segments. Which combination
// is catalog data (AI_PANELS' `newlineKeys`, default Shift+Enter), and a surface
// declaring one this file cannot synthesize gets no multi-line offer at all —
// guessing wrong there sends half a message.
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
const HARNESS = join(__dirname, 'helpers', 'rewrite-multiline-harness.ps1');
// Same escape hatch as enforcer-panel-block.test.mjs: aim these at a
// reconstructed PRE-fix source and the multi-line cases fail (they report
// ok:false / reason:"multiline"). Nothing in the product reads this variable.
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

/** Every observation with this `case`, in harness order. */
async function cases(name) {
  const rows = (await run()).filter((r) => r.case === name);
  assert.ok(rows.length, `harness produced no observations for case '${name}'`);
  return rows;
}
async function one(name) {
  const rows = await cases(name);
  assert.equal(rows.length, 1, `expected exactly one '${name}' observation`);
  return rows[0];
}

test('harness never calls Start(), never installs a hook, and never types anything', async () => {
  const src = await readFile(HARNESS, 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.equal(/\[CfaiEnforcer\]::Start\(/.test(code), false, 'the harness must never call Start()');
  assert.equal(/SetWindowsHookEx/.test(code), false);
  // THE rule for this harness specifically: RunRewrite/StartRewrite call
  // SendInput. Driving either from a test would type into a real window on the
  // machine running the suite.
  for (const forbidden of ['RunRewrite', 'StartRewrite', 'SendInput', 'SendKeyCombo', 'SendUnicodeChunk', 'SendKeyPress']) {
    assert.equal(code.includes(forbidden), false, `the harness must never reach ${forbidden}`);
  }
  // It drives the pure decisions instead.
  assert.match(code, /ComputeMaskCandidate/);
  assert.match(code, /SplitMaskedLines/);
  assert.match(code, /ResolveNewlineKeys/);
});

test('single-line masking is byte-for-byte what it was', { skip: !win }, async () => {
  const r = await one('single_line');
  assert.equal(r.ok, true);
  assert.equal(r.masked, 'my ssn is [SSN] ok');
  assert.equal(r.reason, '');
});

test('THE FIX: multi-line text is maskable, and the line structure survives exactly', { skip: !win }, async () => {
  // Pre-fix this returned ok:false, reason:"multiline".
  const r = await one('multi_line');
  assert.equal(r.ok, true, 'multi-line text must be maskable');
  assert.notEqual(r.reason, 'multiline');
  // The mask replaces the VALUE, never the layout: same line count, same lines,
  // only the secret substituted.
  assert.equal(r.masked, 'hello team\nmy ssn is [SSN]\nthanks');
  assert.equal(r.lines_out, r.lines_in);

  // CRLF, which is what a Windows composer read routinely returns.
  const crlf = await one('multi_line_crlf');
  assert.equal(crlf.ok, true);
  assert.equal(crlf.masked, 'line one\r\nkey [AWS-KEY]\r\nline three');

  // Several regions across several lines, including a blank line, resolve
  // exactly as several regions within one line do.
  const many = await one('multi_line_many_spans');
  assert.equal(many.ok, true);
  assert.equal(many.masked, '[SSN]\n\n[AWS-KEY] and [SSN]');
});

test('a pattern still cannot match ACROSS a line break, and the other refusals are unchanged', { skip: !win }, async () => {
  // The conservative direction, and a property of the regexes rather than of an
  // explicit check: no RegexOptions.Singleline, so `.` cannot cross a break.
  // Half an SSN on each of two lines is therefore not an SSN — no mask, no
  // offer, rather than a mask that silently spanned two lines.
  const split = await one('multi_line_span_cannot_cross');
  assert.equal(split.ok, false);
  assert.equal(split.reason, 'nothing_to_mask');

  // A guardrail pattern carries no label — there is nothing to substitute for
  // "ignore all previous instructions" — so it never makes text maskable.
  const guard = await one('multi_line_guardrail_only');
  assert.equal(guard.ok, false);
  assert.equal(guard.reason, 'nothing_to_mask');

  // REWRITE_MAX_CHARS still applies, measured over the whole text including its
  // line breaks. Removing the multiline check did not remove the length bound.
  const long = await one('multi_line_too_long');
  assert.ok(long.len > 456, 'the fixture must actually exceed the ceiling');
  assert.equal(long.ok, false);
  assert.equal(long.reason, 'too_long');
});

// ── The character budget IS the write budget ─────────────────────────────────
//
// THE BUG THIS PINS. REWRITE_MAX_CHARS was a hand-written 2000, with a comment
// beside it doing the arithmetic for a pacing that no longer existed ("4ms
// apart, so 2000 * 4ms = 8s, inside the 9s budget"). SendUnicodeChunk had since
// been changed to sleep 15ms per character — measured, and deliberately, because
// bursting corrupted the typed text — so the real cap was ~580 characters.
// Between 580 and 2000 the file OFFERED a rewrite it could not finish: Ctrl+A
// and Delete cleared the composer, typing ran out of budget partway, and the
// user was left looking at half a masked message with reason
// "interrupted_mid_write". Multi-line support made that range routine rather
// than rare, since a break costs more than a character and prompts got longer.
//
// The fix is structural, so these tests are about the RELATIONSHIP rather than
// about any one number: the sleeps are the constants, the cap is computed from
// them, and the admission check models the write loop from the same constants.

test('the character cap is DERIVED from the real per-char/per-chunk pacing, not written down', { skip: !win }, async () => {
  const c = await one('timing_constants');
  // The measured pacing. If any of these change, the cap below changes with
  // them — that is the whole point — but they may not change silently, because
  // REWRITE_CHAR_DELAY_MS in particular is what makes the typed text land
  // uncorrupted and the read-back verification trustworthy.
  assert.equal(c.char_delay_ms, 15, 'SendUnicodeChunk paces one character per 15ms');
  assert.equal(c.chunk_delay_ms, 10);
  assert.equal(c.key_delay_ms, 5);
  assert.equal(c.chunk, 24);
  // …and they are DERIVED into the chunk cost and the cap, in that order.
  assert.equal(c.chunk_ms, c.chunk * c.char_delay_ms + c.chunk_delay_ms, 'a full chunk costs 24*15+10');
  assert.equal(c.chunk_ms, 370);
  assert.equal(c.usable_ms, Math.floor(c.budget_ms * c.margin_num / c.margin_den), 'the slow-clock margin');
  assert.equal(c.max_chars, c.chunk * Math.floor(c.usable_ms / c.chunk_ms),
    'REWRITE_MAX_CHARS must be the derived value, never a hand-written one');
  assert.equal(c.max_chars, 456, 'the real cap at the current pacing');
  // The budget is one number in two representations — the loop compares ticks.
  assert.equal(c.budget_ticks, c.budget_ms * 10000);

  // THE INVARIANT THAT WAS VIOLATED, stated directly: the cap must be typeable
  // inside the budget. At the old values this read 2000 * 15.4ms = 30.8s > 9s.
  const worstMsPerTypedChar = c.chunk_ms / c.chunk;             // 15.42
  assert.ok(c.max_chars * worstMsPerTypedChar <= c.usable_ms,
    `${c.max_chars} chars at ${worstMsPerTypedChar}ms each must fit ${c.usable_ms}ms`);
  // …and it is not needlessly small either: one more chunk would NOT fit, so
  // the cap is the largest whole-chunk value the pacing allows.
  assert.ok((c.max_chars + c.chunk) * worstMsPerTypedChar > c.usable_ms,
    'the cap should be the largest chunk-aligned length that fits');
  // The margin really is a margin: the accepted worst case still leaves the
  // full 9s budget headroom over the 7.2s it is admitted against.
  assert.ok(c.usable_ms < c.budget_ms);
});

test('EstimateWriteMs models the write loop exactly, breaks included', { skip: !win }, async () => {
  const c = await one('timing_constants');
  // The model, recomputed HERE from the constants read out of the compiled
  // enforcer. Two independent implementations of the same arithmetic: if the C#
  // one drifts (or the loop stops matching it), these disagree.
  const expect = (s) => {
    const segments = s.split(/\r\n|\n|\r/);
    let ms = 0;
    segments.forEach((seg, i) => {
      if (i > 0) ms += 3 * c.key_delay_ms + c.chunk_delay_ms;
      ms += seg.length * c.char_delay_ms;
      ms += Math.ceil(seg.length / c.chunk) * c.chunk_delay_ms;
    });
    return ms;
  };
  const shapes = {
    empty: '',
    one_char: 'x',
    exactly_one_chunk: 'x'.repeat(24),
    one_chunk_plus_1: 'x'.repeat(25),
    one_break: 'x\nx',
    crlf_one_break: 'x\r\nx',
    ten_breaks: ('x'.repeat(10) + '\n').repeat(10),
    at_cap: 'x'.repeat(c.max_chars),
    cap_of_breaks: '\n'.repeat(c.max_chars),
  };
  const rows = new Map((await cases('estimate_write_ms')).map((r) => [r.variant, r]));
  for (const [name, value] of Object.entries(shapes)) {
    assert.equal(rows.get(name).estimate_ms, expect(value), `${name}: the model must match`);
  }
  // The terms, spelled out so a wrong one is obvious rather than merely unequal:
  assert.equal(rows.get('exactly_one_chunk').estimate_ms, 370, '24 chars = one whole chunk');
  assert.equal(rows.get('one_chunk_plus_1').estimate_ms, 395, 'the 25th char starts a second chunk settle');
  // A LINE BREAK IS THE EXPENSIVE CHARACTER: 25ms (3 key pauses + the settle)
  // against ~15.4ms for a typed one. This is why a pure character cap cannot
  // answer the question and the estimate exists.
  assert.equal(rows.get('one_break').estimate_ms - rows.get('one_char').estimate_ms * 2 + 0,
    3 * c.key_delay_ms + c.chunk_delay_ms - 0, 'a break costs one combo plus one settle');
  // CRLF is ONE break, not two — same estimate as a bare \n with the same text.
  assert.equal(rows.get('crlf_one_break').estimate_ms, rows.get('one_break').estimate_ms);

  // And the two ends of the admission decision.
  assert.equal(rows.get('at_cap').fits, true, 'the derived cap must fit the budget it was derived from');
  assert.ok(rows.get('at_cap').estimate_ms <= c.usable_ms);
  assert.equal(rows.get('cap_of_breaks').fits, false,
    'the same number of characters, all line breaks, does NOT fit — the cap alone cannot decide');
  assert.ok(rows.get('cap_of_breaks').estimate_ms > c.usable_ms);
});

test('a rewrite is only ever OFFERED when it can actually be finished', { skip: !win }, async () => {
  // The promise the old cap broke, asserted through the real admission path
  // (ComputeMaskCandidate) with a genuinely maskable secret in every fixture.
  const c = await one('timing_constants');
  const rows = new Map((await cases('admission')).map((r) => [r.variant, r]));

  // Exactly at the cap, single line: offered.
  assert.equal(rows.get('at_cap_single_line').len, c.max_chars);
  assert.equal(rows.get('at_cap_single_line').ok, true, 'the cap itself must be usable');
  // One character past it: refused by the coarse pre-filter, which also exists
  // to bound the regex cost before any masking runs.
  assert.equal(rows.get('one_over_cap').len, c.max_chars + 1);
  assert.equal(rows.get('one_over_cap').ok, false);
  assert.equal(rows.get('one_over_cap').reason, 'too_long');
  // AT the cap but full of line breaks: passes the character pre-filter and is
  // still refused, by the write-time check, with its own diagnosable reason.
  // Pre-fix this was the shape that got offered and then died mid-write.
  const breaks = rows.get('at_cap_many_breaks');
  assert.ok(breaks.len <= c.max_chars, 'the fixture must pass the character pre-filter');
  assert.ok(breaks.estimate_ms > c.usable_ms, 'and genuinely not fit the budget');
  assert.equal(breaks.ok, false);
  assert.equal(breaks.reason, 'too_long_to_write');
  // The realistic case this feature exists for — a short multi-line Teams
  // message with a secret in it — is nowhere near the limit.
  const real = rows.get('realistic_teams_message');
  assert.equal(real.ok, true);
  assert.ok(real.estimate_ms < c.usable_ms / 4, `a normal message should be well inside the budget (was ${real.estimate_ms}ms)`);
});

test('the write loop SLEEPS on the same constants the estimate charges for', async () => {
  // The anti-drift rule, and the one that actually failed: the arithmetic lived
  // in a comment while the sleeps were literals, so changing a sleep silently
  // invalidated the cap. Every sleep in the write path now names its constant,
  // which is what makes EstimateWriteMs a model of the code rather than a
  // parallel guess about it.
  const src = await readFile(ENFORCER, 'utf8');
  const unicode = src.slice(src.indexOf('static void SendUnicodeChunk('), src.length);
  assert.match(unicode, /Thread\.Sleep\(REWRITE_CHAR_DELAY_MS\);/);
  const combo = src.slice(src.indexOf('static void SendKeyPress('), src.indexOf('static void SendUnicodeChunk('));
  assert.equal((combo.match(/Thread\.Sleep\(REWRITE_KEY_DELAY_MS\)/g) || []).length, 4,
    'SendKeyPress (1) + SendKeyCombo (3) — the three the estimate charges per break');
  const fn = src.slice(src.indexOf('static void RunRewrite('), src.indexOf('// SendInput\'s return value is the count'));
  assert.equal((fn.match(/Thread\.Sleep\(REWRITE_CHUNK_DELAY_MS\)/g) || []).length, 2,
    'the per-chunk settle and the post-newline settle');
  // No naked millisecond literal may reappear in the paced write path.
  const writeLoop = fn.slice(fn.indexOf('var segments = SplitMaskedLines(masked);'), fn.indexOf('// Verify by positive identification'));
  assert.ok(writeLoop.length > 0, 'expected the write loop');
  assert.equal(/Thread\.Sleep\(\d+\)/.test(writeLoop), false,
    'the write loop must not sleep on a literal — the estimate could not see it');
  // The estimate is built from the constants, and is the thing the admission
  // check consults.
  const est = src.slice(src.indexOf('static int EstimateWriteMs('), src.indexOf('static bool WriteFitsBudget('));
  assert.match(est, /if \(i > 0\) ms \+= 3 \* REWRITE_KEY_DELAY_MS \+ REWRITE_CHUNK_DELAY_MS;/);
  assert.match(est, /ms \+= len \* REWRITE_CHAR_DELAY_MS;/);
  assert.match(est, /ms \+= \(\(len \+ REWRITE_CHUNK - 1\) \/ REWRITE_CHUNK\) \* REWRITE_CHUNK_DELAY_MS;/);
  assert.equal(/\d{2,}/.test(codeOnlyLines(est)), false, 'the estimate must contain no magic numbers');
  assert.match(src, /static bool WriteFitsBudget\(string masked\)\r?\n\s*\{\r?\n\s*return EstimateWriteMs\(masked\) <= REWRITE_USABLE_BUDGET_MS;/);
  assert.match(src, /if \(!WriteFitsBudget\(masked\)\) \{ result\.Reason = "too_long_to_write"; return result; \}/);
  // …and the cap really is an expression over the constants, not a literal.
  assert.match(src, /const int REWRITE_MAX_CHARS = REWRITE_CHUNK \* \(REWRITE_USABLE_BUDGET_MS \/ REWRITE_CHUNK_MS\);/);
  assert.match(src, /const int REWRITE_CHUNK_MS = REWRITE_CHUNK \* REWRITE_CHAR_DELAY_MS \+ REWRITE_CHUNK_DELAY_MS;/);
  assert.match(src, /static readonly long REWRITE_WRITE_BUDGET = TimeSpan\.FromMilliseconds\(REWRITE_WRITE_BUDGET_MS\)\.Ticks;/);
  // The stale arithmetic that caused this must not come back. (Not a blanket
  // "4ms" search — the corrected comments quote the old claim to explain the
  // bug, and 15.4ms contains it.)
  assert.equal(/REWRITE_MAX_CHARS\(2000\)/.test(src), false,
    'the "2000 chars * 4ms = 8s" arithmetic was never true of the shipped pacing');
  assert.equal(/REWRITE_MAX_CHARS = \d/.test(src), false, 'the cap may not be a literal again');
  assert.equal(/REWRITE_WRITE_BUDGET = TimeSpan\.FromSeconds/.test(src), false,
    'the budget must be the same milliseconds the cap is derived from');
});

// Line comments only, for the "no magic numbers" check above: the explanation
// beside the estimate legitimately quotes 24*15+10 and 25ms.
function codeOnlyLines(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
}

test('the write is SPLIT INTO SEGMENTS with no terminator in any of them', { skip: !win }, async () => {
  // This is what makes "a literal newline is never typed" true rather than
  // asserted: the only thing handed to SendUnicodeChunk is a segment, and no
  // segment can contain a break. A newline KEY is what goes between them.
  const rows = await cases('split_lines');
  for (const r of rows) {
    assert.equal(r.any_segment_has_break, false, `${r.variant}: a segment must never carry a line break`);
  }
  const byVariant = new Map(rows.map((r) => [r.variant, r]));
  assert.deepEqual(byVariant.get('lf').segments, ['a', 'b', 'c']);
  assert.deepEqual(byVariant.get('crlf').segments, ['a', 'b'], 'CRLF is ONE break, not two');
  assert.deepEqual(byVariant.get('bare_cr').segments, ['a', 'b']);
  // A blank line in the middle of a prompt is content: the empty segment is
  // kept, so the typed line count matches what was read.
  assert.deepEqual(byVariant.get('blank_mid').segments, ['a', '', 'b']);
  assert.deepEqual(byVariant.get('trailing').segments, ['a', '']);
  assert.deepEqual(byVariant.get('leading').segments, ['', 'a']);
  // Single-line text is ONE segment — the same single pass through the same
  // chunk loop it always took, with no key combination sent at all.
  assert.deepEqual(byVariant.get('none').segments, ['just one line']);
  assert.equal(byVariant.get('none').count, 1);
});

test('which newline combination is CATALOG DATA, and an unknown one is refused', { skip: !win }, async () => {
  const resolved = new Map((await cases('resolve_keys')).map((r) => [r.keys, r]));
  // Shift+Enter → VK_SHIFT (0x10) + VK_RETURN (0x0D). Case-insensitive, like
  // every other catalog comparison in the file.
  for (const key of ['shift_enter', 'SHIFT_ENTER']) {
    assert.equal(resolved.get(key).resolved, true);
    assert.equal(resolved.get(key).vk_mod, 0x10);
    assert.equal(resolved.get(key).vk_key, 0x0d);
  }
  assert.equal(resolved.get('ctrl_enter').resolved, true);
  assert.equal(resolved.get('ctrl_enter').vk_mod, 0x11);
  assert.equal(resolved.get('ctrl_enter').vk_key, 0x0d);
  // FAIL CLOSED. A bare "enter" is not a newline — it is the send key this whole
  // feature intercepts — and an unknown or empty value must never fall back to
  // a combination that might submit the message.
  for (const key of ['enter', 'alt_enter', '']) {
    assert.equal(resolved.get(key).resolved, false, `'${key}' must not resolve`);
    assert.equal(resolved.get(key).vk_mod, 0);
    assert.equal(resolved.get(key).vk_key, 0);
  }

  const panels = new Map((await cases('newline_for_panel')).map((r) => [r.panel, r]));
  // The shipped Teams entries — both composers, both Shift+Enter.
  assert.equal(panels.get('teams_composer').keys, 'shift_enter');
  assert.equal(panels.get('teams_composer').can_insert, true);
  assert.equal(panels.get('teams_copilot_composer').keys, 'shift_enter');
  assert.equal(panels.get('teams_copilot_composer').can_insert, true);
  // A per-entry OVERRIDE really is honoured — this is what makes the value data
  // rather than a hardcoded assumption.
  assert.equal(panels.get('fixture_ctrl_newline').keys, 'ctrl_enter');
  assert.equal(panels.get('fixture_ctrl_newline').can_insert, true);
  // A surface declaring something unsynthesizable keeps saying so, and cannot
  // insert a newline — UpdatePendingRewrite then refuses multi-line text there.
  assert.equal(panels.get('fixture_unknown_newline').keys, 'enter');
  assert.equal(panels.get('fixture_unknown_newline').can_insert, false);
  // An entry that states nothing, a panel id in no catalog, and no panel at all
  // (a pure chat app has no AI_PANELS row) all get the default.
  for (const id of ['fixture_no_newline_field', 'not_in_catalog', '(none)', 'claude_code']) {
    assert.equal(panels.get(id).keys, 'shift_enter', `${id} must get the default`);
    assert.equal(panels.get(id).can_insert, true);
  }
});

test('the read-back and rescan verification still holds for a MULTI-LINE rewrite', { skip: !win }, async () => {
  // RunRewrite's two verification tests, run for real:
  //   matches — NormalizeWs(read-back) == NormalizeWs(masked)
  //   clean   — a full rescan of the read-back finds no active pattern
  // Both must pass before the Enter is ever synthesized, and both are unchanged
  // by this work. What the multi-line cases show is that NO NEW ALLOWANCE was
  // needed: NormalizeWs already collapses every terminator, so a composer that
  // stores "\r\n" where Shift+Enter was pressed still compares equal.
  const rows = new Map((await cases('verify_readback')).map((r) => [r.variant, r]));
  for (const v of ['identical', 'crlf_readback', 'reflowed']) {
    assert.equal(rows.get(v).matches, true, `${v}: a whitespace-only difference must still verify`);
    assert.equal(rows.get(v).clean, true, `${v}`);
  }
  // ACCEPTED CONSEQUENCE, stated so it is a decision and not a surprise: the
  // pre-existing whitespace allowance means a read-back whose line breaks became
  // spaces also verifies. If a surface's newline combination silently did
  // nothing, the message would be sent on one line — the content is identical
  // and every sensitive span is still masked, so this loses formatting, never
  // secrecy. It is the same allowance single-line rewrites have always relied on
  // for a composer that reflows on read-back.
  assert.equal(rows.get('newlines_collapsed').matches, true);
  // A real difference still fails, so the allowance has not become "anything
  // goes".
  assert.equal(rows.get('text_actually_different').matches, false);
  assert.equal(rows.get('empty').matches, false, 'an empty/failed read is never a match');
  // And the rescan is what catches the worst case: a read-back that still holds
  // the original secret is NOT clean, so the send never happens.
  assert.equal(rows.get('still_the_secret').clean, false);
  assert.equal(rows.get('still_the_secret').matches, false);
});

test('Esc escapes control characters, so a multi-line value cannot split the NDJSON line', { skip: !win }, async () => {
  // Before this, Esc handled backslash and quote only — sufficient while no
  // emitted field could contain a control character. A multi-line masked prompt
  // can, and an unescaped newline does not merely produce invalid JSON: it
  // splits the line, so the Node side sees a truncated event plus garbage. Every
  // field routes through Esc, so this also protects `preview` (a masked
  // substring) on the block event.
  const r = await one('esc');
  assert.equal(r.escaped, 'a\\nb\\r\\nc\\td\\"e\\\\f');
});

test('the rewrite event carries the MASKED text on success, and no content otherwise', { skip: !win }, async () => {
  const rewrites = (await run()).filter((r) => r.kind === 'rewrite');
  const byId = new Map(rewrites.map((r) => [r.block_id, r]));
  assert.equal(rewrites.length, 4);

  // SUCCESS carries the masked text — the string that was verified and sent.
  const ok = byId.get('blk-ok');
  assert.equal(ok.result, 'ok');
  assert.equal(ok.reason, 'sent');
  assert.equal(ok.masked, 'hello team\nmy ssn is [SSN]\nthanks',
    'the masked text must survive the stdout hop intact, line breaks included');
  // It is the MASKED text: the category label is there and no sensitive value
  // is. The original never reaches this function — there is no parameter it
  // could arrive through.
  assert.match(ok.masked, /\[SSN\]/);
  assert.equal(/\d{3}-\d{2}-\d{4}/.test(ok.masked), false, 'no unmasked value may appear');

  // Every abort/failure path carries NO content field at all — OMITTED, not
  // empty, so a consumer can tell "no content on this event" from "an empty
  // prompt", and every pre-existing failure line is byte-for-byte what it was.
  for (const id of ['blk-fail', 'blk-abort']) {
    assert.equal('masked' in byId.get(id), false, `${id} must carry no prompt content`);
  }
  assert.equal(byId.get('blk-fail').result, 'failed');
  assert.equal(byId.get('blk-abort').reason, 'no_newline_key');
  // An empty string is still a value, and travels as one.
  assert.equal(byId.get('blk-empty-masked').masked, '');
});

// ── Source-level invariants for the part that cannot be executed offline ─────

test('RunRewrite types SEGMENTS and sends the newline COMBINATION, never a literal newline', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fn = src.slice(src.indexOf('static void RunRewrite('), src.indexOf('// SendInput\'s return value is the count'));
  assert.ok(fn.length > 0, 'expected a RunRewrite body');
  // The write loop is over SEGMENTS, and the only thing typed as text is a
  // segment (which SplitMaskedLines guarantees carries no terminator).
  assert.match(fn, /var segments = SplitMaskedLines\(masked\);/);
  assert.match(fn, /SendUnicodeChunk\(line\.Substring\(i, len\)\);/);
  assert.equal(/SendUnicodeChunk\(masked/.test(fn), false,
    'the whole masked string must never be typed in one piece — a newline in it would submit the message');
  // The break between segments is a KEY COMBINATION resolved from the catalog,
  // sent only between segments (seg > 0), never before the first one.
  assert.match(fn, /if \(seg > 0\)/);
  assert.match(fn, /SendKeyCombo\(nlMod, nlKey\);/);
  // …and the combination is resolved BEFORE anything is typed or cleared, so a
  // refusal costs nothing: the composer is untouched and the block stays armed.
  const resolveIdx = fn.indexOf('ResolveNewlineKeys(NewlineKeysFor()');
  assert.ok(resolveIdx > 0, 'expected the multi-line pre-flight');
  assert.match(fn.slice(resolveIdx, resolveIdx + 300), /EmitRewrite\(blockId, "aborted", "no_newline_key"\); return;/);
  assert.ok(resolveIdx < fn.indexOf('SendKeyCombo(VK_CONTROL, VK_A)'),
    'the newline combination must be resolved before Ctrl+A clears the composer');
  // The per-chunk abort/budget/foreground re-check still guards every write,
  // and now guards the key combination too — a line break is input to the target
  // app just as much as a character is.
  assert.equal((fn.match(/_rewriteAbort \|\| DateTime\.UtcNow\.Ticks > budgetEnd \|\| GetForegroundWindow\(\) != pinnedHwnd/g) || []).length, 2,
    'both the segment break and the chunk loop must re-check');
  // The verify/send tail is untouched: read back, rescan, settle, re-pin, send,
  // confirm the composer cleared.
  assert.match(fn, /matches = NormalizeWs\(after\) == NormalizeWs\(masked\);/);
  assert.match(fn, /clean = string\.IsNullOrEmpty\(ScanNames\(after \?\? ""\)\);/);
  assert.match(fn, /if \(!matches \|\| !clean\) \{ EmitRewrite\(blockId, "failed", "verify_mismatch"\); return; \}/);
  assert.match(fn, /bool stillThere = NormalizeWs\(postSend\) == NormalizeWs\(masked\);/);
  assert.match(fn, /EmitRewrite\(blockId, "ok", "sent", masked\);/);
});

test('ComputeMaskCandidate no longer rejects multi-line text, and the gate moved to the SURFACE', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fn = src.slice(src.indexOf('static MaskResult ComputeMaskCandidate('), src.indexOf('static void NoteRegexTimeout('));
  assert.ok(fn.length > 0, 'expected a ComputeMaskCandidate body');
  // The rejection is gone…
  assert.equal(/result\.Reason = "multiline"/.test(fn), false,
    'multi-line text must no longer be refused by the masker');
  // …and the function stays PURE over the text: whether a line break can be
  // TYPED is a property of the surface, so it is not decided here.
  assert.equal(/NewlineKeysFor|ResolveNewlineKeys|_fgPanelId/.test(fn), false,
    'the masker must not consult surface state');
  // The other fail-closed steps are all still in place.
  assert.match(fn, /result\.Reason = "empty"/);
  assert.match(fn, /if \(text\.Length > REWRITE_MAX_CHARS\) \{ result\.Reason = "too_long"; return result; \}/);
  assert.match(fn, /if \(masked == text\) \{ result\.Reason = "masked_equals_original"; return result; \}/);
  assert.match(fn, /if \(residual\.Length > 0\) \{ result\.Reason = "residual_match"; return result; \}/);

  // The surface gate lives in UpdatePendingRewrite, so a multi-line candidate is
  // never even pinned for a surface that cannot type a line break.
  const pending = src.slice(src.indexOf('static void UpdatePendingRewrite()'), src.indexOf('static string _pastePatternsValue'));
  assert.match(pending, /bool newlineOk = !HasLineBreak\(mask\.Masked\) \|\| CanInsertNewline\(\);/);
  assert.match(pending, /if \(mask\.Ok && rid != null && newlineOk\)/);
  assert.match(pending, /: "multiline_no_newline_key";/);
});

test('the newline default is catalog data, mirrored in exactly one C# constant', async () => {
  // Same lockstep discipline PLATFORM_PROCS is held under: the value is written
  // down in ai-processes.js, and the .ps1 carries ONE mirror of it for the
  // surfaces that have no panel entry at all (a pure chat app). If these drift,
  // a chat app would start pressing a combination its composer treats as send.
  const { DEFAULT_NEWLINE_KEYS, NEWLINE_KEY_COMBOS, AI_PANELS, buildAiPanelConfig } =
    await import('../src/os_monitor/ai-processes.js');
  assert.equal(DEFAULT_NEWLINE_KEYS, 'shift_enter');
  const src = await readFile(ENFORCER, 'utf8');
  assert.match(src, new RegExp(`const string NEWLINE_KEYS_DEFAULT = "${DEFAULT_NEWLINE_KEYS}";`));
  assert.equal((src.match(/NEWLINE_KEYS_DEFAULT = /g) || []).length, 1, 'exactly one mirror may exist');
  // Every combination the catalog is allowed to name must be one the .ps1 can
  // actually synthesize, or an entry could ship a value that silently disables
  // multi-line masking for its surface.
  for (const combo of NEWLINE_KEY_COMBOS) {
    assert.match(src, new RegExp(`string\\.Equals\\(keys, "${combo}", StringComparison\\.OrdinalIgnoreCase\\)`),
      `${combo} is in the catalog's vocabulary but the enforcer cannot synthesize it`);
  }
  // Teams' two composers state it explicitly, because they are the surfaces
  // where a literal newline would submit a message to a real conversation.
  for (const id of ['teams_composer', 'teams_copilot_composer']) {
    const entry = AI_PANELS.find((p) => p.id === id);
    assert.ok(entry, `${id} is missing from AI_PANELS`);
    assert.equal(entry.newlineKeys, 'shift_enter', `${id} must state its newline combination`);
  }
  // …and the field survives the env-var handoff for EVERY entry, resolved to a
  // string so the C# side never has to tell missing from empty.
  for (const entry of buildAiPanelConfig()) {
    assert.equal(typeof entry.newlineKeys, 'string', `${entry.id}.newlineKeys must be a string`);
    const source = AI_PANELS.find((p) => p.id === entry.id);
    assert.equal(entry.newlineKeys,
      source.newlineKeys === undefined ? DEFAULT_NEWLINE_KEYS : source.newlineKeys,
      `${entry.id}.newlineKeys must travel verbatim`);
  }
});
