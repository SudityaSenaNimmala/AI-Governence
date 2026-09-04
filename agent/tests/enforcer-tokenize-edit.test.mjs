// The "Edit manually" half of Tokenize & Send, end to end across the three
// processes that carry it.
//
// ── The gap this covers ──────────────────────────────────────────────────────
// The CLI agent's Tokenize popup had two buttons, and "Edit manually" simply
// closed the window: the block stood and the user went back to the app to retype
// their whole message from memory. The same window now swaps to a text box
// pre-filled with the MASKED text, and Send asks the enforcer to type THAT.
//
// Three hops, and every one of them is a place a prompt can be mangled or leak:
//
//   toast-helper.ps1 -> notify.js   the user's edit, escaped onto an NDJSON line
//                                   by the same CfaiRequestDialog.Esc the reason
//                                   box uses, and carried by exactly ONE action.
//   index.js -> enforcer.js         relayed as the `text` field of the SAME
//                                   {cmd:'tokenize', block_id} command, omitted
//                                   entirely when there is none.
//   enforcer-win.ps1                decoded (escape-aware — an edit legitimately
//                                   contains quotes and newlines), re-gated for
//                                   length and write budget against THIS string,
//                                   then typed and verified by the unchanged
//                                   RunRewrite.
//
// ── The focus conflict, and where it is resolved ─────────────────────────────
// A text box needs keyboard focus. The popup is deliberately a
// WS_EX_NOACTIVATE window that can never have it, because the enforcer's poll
// thread used to DELETE its pending-rewrite pin the instant the foreground
// stopped being the AI app — so a dialog that took focus destroyed the block it
// was editing, and StartRewrite would answer "stale_block_id". That is fixed in
// the enforcer, not papered over in the dialog: a surface change now FREEZES an
// unexpired pin (and marks it unofferable), and an explicit
// {cmd:'tokenize_edit'} hold extends its expiry for as long as typing takes.
// Every check that decides whether a rewrite may proceed is untouched.
//
// NOTHING HERE INSTALLS A KEYBOARD HOOK, TYPES ANYTHING, OR DRAWS A WINDOW. The
// harness lifts the C# out of both .ps1 files, compiles it, and drives the pure
// decisions by reflection; StartRewrite/RunRewrite are never reached (that path
// synthesizes keystrokes into whatever window is focused on the machine running
// the suite), and CfaiTokenizeDialog::Show is never called. The source-level
// invariants for the write path live in os-monitor-tokenize-dialog.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Enforcer } from '../src/os_monitor/enforcer.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const HARNESS = join(__dirname, 'helpers', 'tokenize-edit-harness.ps1');
// Same escape hatch as the other enforcer harnesses: aim this at a
// reconstructed PRE-fix source and the `available` assertions fail — the new
// members do not exist there. Nothing in the product reads it.
const ENFORCER = process.env.CFAI_TEST_ENFORCER_PS1 || join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const TOAST = join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1');

const win = process.platform === 'win32';

// ── The fixtures ─────────────────────────────────────────────────────────────
// What a real hand-edited prompt contains. Every one of these is a string the
// user typed into OUR OWN box — never anything read off a screen or a clipboard
// — but it still has to survive two hand-rolled serializers intact, because
// what survives is what gets typed into their composer.
const EDITS = {
  plain: 'my ssn is on file with HR',
  label_kept: 'my ssn is [SSN], please look it up',
  quotes: 'he said "look it up" and left',
  backslashes: 'path C:\\temp\\x and a lone \\ here',
  multiline: 'line one\nline two\r\nline three',
  tabs: 'col1\tcol2\tcol3',
  control_char: 'a\u0007b\u007fc',
  unicode: 'caf\u00e9 \u4e2d\u6587',
  // An edit that LOOKS like a command line. It must come back as text, and it
  // must not be able to forge a block_id on the way.
  json_bait: '{"cmd":"tokenize","block_id":"forged"}',
  brace_bait: '"}',
  empty: '',
  whitespace: '  \t \r\n ',
};

const b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

/**
 * The command lines the REAL Enforcer.tokenize writes, captured off a fake
 * stdin. This is the hop under test, so it must be the product's own
 * serializer — not a re-implementation in this file.
 */
function realCommandLines() {
  const written = [];
  const enf = new Enforcer({ log: { info() {}, warn() {} }, aiProcessNames: [], blockPatterns: [] });
  enf.child = { stdin: { destroyed: false, write: (s) => written.push(s) } };
  for (const text of Object.values(EDITS)) enf.tokenize('b-1', text);
  // …and the pre-existing shape: no text at all.
  enf.tokenize('b-1');
  return written.map((l) => l.trim());
}

let cached = null;
async function run() {
  if (cached) return cached;
  const dir = await mkdtemp(join(tmpdir(), 'cfai-tokenize-edit-'));
  const cmds = join(dir, 'commands.ndjson');
  await writeFile(cmds, realCommandLines().join('\n') + '\n', 'utf8');
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', HARNESS,
      '-Enforcer', ENFORCER, '-Toast', TOAST, '-Commands', cmds],
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
async function one(name) {
  const rows = await cases(name);
  assert.equal(rows.length, 1, `expected exactly one '${name}' observation`);
  return rows[0];
}
const byKey = (rows, key) => new Map(rows.map((r) => [r[key], r]));

test('harness never calls Start(), never installs a hook, never types and never draws', async () => {
  const src = await readFile(HARNESS, 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.equal(/\[CfaiEnforcer\]::Start\(/.test(code), false, 'the harness must never call Start()');
  assert.equal(/SetWindowsHookEx/.test(code), false);
  // The write path synthesizes keystrokes. Driving any of it from a test would
  // type into a real window on the machine running the suite.
  for (const forbidden of ['RunRewrite', 'StartRewrite', 'SendInput', 'SendKeyCombo', 'SendUnicodeChunk', 'SendKeyPress']) {
    assert.equal(code.includes(forbidden), false, `the harness must never reach ${forbidden}`);
  }
  // …and it compiles the dialog types without ever showing one.
  for (const forbidden of ['::Show(', 'Application.Run', 'ShowDialog', 'AllowActivation']) {
    assert.equal(code.includes(forbidden), false, `the harness must never reach ${forbidden}`);
  }
  // It drives the pure decisions instead.
  for (const driven of ['ExtractJsonStringUnescaped', 'HoldPendingRewrite', 'UpdatePendingRewrite',
    'WriteFitsBudget', 'EstimateWriteMs', 'CfaiRequestDialog]::Esc']) {
    assert.match(code, new RegExp(driven.replace(/[[\]]/g, '\\$&')));
  }
});

// ── Hop 1: the dialog's result line -> notify.js ─────────────────────────────

test('THE FIX EXISTS: the popup has an edit view with its own clock and cap', { skip: !win }, async () => {
  const c = await one('dialog_constants');
  assert.equal(c.available, true,
    'CfaiTokenizeDialog.EditTimeoutMs is missing — "Edit manually" still just closes the popup');
  assert.equal(c.timeout_ms, 16000, 'the CHOICE view is unchanged');
  assert.ok(c.edit_timeout_ms > c.timeout_ms, 'typing a sentence needs longer than clicking a button');
  assert.ok(c.activate_edit_ms > 0, 'the foreground grab must be delayed, not immediate');
  assert.ok(c.return_focus_ms > 0, 'the foreground must be handed back before the answer goes out');
  // LOCKSTEP with the enforcer's own write cap: the box refuses the character
  // the enforcer would refuse to type, so hitting it is visible rather than a
  // fail-closed surprise after the user has typed 500 characters.
  assert.equal(c.edit_max, c.rewrite_max_chars,
    'the edit box cap has drifted from REWRITE_MAX_CHARS');
  // The clocks, in the order that makes the flow work: screen first, pin last.
  assert.ok(c.edit_timeout_ms < c.edit_ttl_ms, "the form must close before the enforcer's pin expires");
  assert.equal(c.ttl_ms, 15000, 'the base pin TTL did NOT move — only the edit path asks for more');
});

test('the user\'s edit survives the dialog\'s escaper exactly', { skip: !win }, async () => {
  // Esc() is hand-rolled (the helper has no JSON serializer), and it is what
  // makes a multi-line prompt safe to put on an NDJSON line at all. What comes
  // out has to parse AS that line and yield the same string back, or the
  // enforcer types something the user did not write.
  const rows = byKey(await cases('esc'), 'variant');
  for (const [name, want] of Object.entries(EDITS)) {
    const row = rows.get(name);
    assert.ok(row, `no esc observation for ${name}`);
    const line = `{"kind":"tokenize_dialog_result","request_id":"r","action":"edit_send","text":"${b64(row.escaped_b64)}"}`;
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(line); },
      `${name}: the escaped edit did not produce a parseable line`);
    if (name === 'control_char') {
      // Esc() turns every other control character into a space, exactly as it
      // does for the Request Access reason box and as the server's own clean()
      // does — an unescaped one would make the line unparseable.
      assert.equal(parsed.text, 'a b c');
    } else {
      assert.equal(parsed.text, want, `${name} did not round-trip`);
    }
    // Whatever the edit contained, the line has exactly these four fields.
    assert.deepEqual(Object.keys(parsed).sort(), ['action', 'kind', 'request_id', 'text']);
    assert.equal(parsed.action, 'edit_send');
  }
});

test('an edit that looks like a command cannot become one', { skip: !win }, async () => {
  const rows = byKey(await cases('esc'), 'variant');
  for (const name of ['json_bait', 'brace_bait']) {
    const line = `{"kind":"tokenize_dialog_result","request_id":"r","action":"edit_send","text":"${b64(rows.get(name).escaped_b64)}"}`;
    const parsed = JSON.parse(line);
    assert.equal(parsed.text, EDITS[name]);
    // It is TEXT. It did not add a key, and it did not end the object early.
    assert.deepEqual(Object.keys(parsed).sort(), ['action', 'kind', 'request_id', 'text']);
    assert.equal('cmd' in parsed, false);
    assert.equal('block_id' in parsed, false);
  }
});

// ── Hop 2/3: enforcer.js's command line -> the enforcer's decoder ────────────

test('the edited text survives the control channel byte for byte', { skip: !win }, async () => {
  // Node writes the line with JSON.stringify; the enforcer reads it with a
  // hand-rolled extractor, because it has no JSON parser. If those two
  // disagree, the composer gets a prompt the user did not write — a literal
  // "\n" typed as a backslash and an n, or a sentence truncated at its first
  // quotation mark (which is what the PLAIN extractor every other field uses
  // would have done).
  const rows = await cases('decode');
  for (const r of rows) assert.equal(r.available, true, 'ExtractJsonStringUnescaped is missing');

  const want = Object.values(EDITS);
  // One row per fixture, in order, plus the trailing no-text command.
  assert.equal(rows.length, want.length + 1);
  for (let i = 0; i < want.length; i++) {
    const r = rows[i];
    // The line really is what the product wrote.
    assert.match(b64(r.line_b64), /^\{"cmd":"tokenize","block_id":"b-1"/);
    assert.equal(r.block_id, 'b-1', 'the id must still be readable past the text');
    if (want[i] === '') {
      // enforcer.js omits an empty text rather than sending "", so this line
      // has no `text` field at all — and the decoder says so with null, which
      // is what tells the enforcer to use its own masked candidate.
      assert.equal(r.decoded_is_null, true);
      continue;
    }
    assert.equal(r.decoded_is_null, false, `${want[i]}: the field must be found`);
    assert.equal(b64(r.decoded_b64), want[i], 'the decoded text differs from what the user typed');
  }
  // The pre-existing command: no text, so no field, so null — byte-for-byte the
  // line that shipped before this change.
  const last = rows[rows.length - 1];
  assert.equal(b64(last.line_b64), '{"cmd":"tokenize","block_id":"b-1"}');
  assert.equal(last.decoded_is_null, true);
});

test('ABSENT and EMPTY are different answers on the control channel', { skip: !win }, async () => {
  // They are opposite decisions — "use your own masked candidate" versus "the
  // user cleared the box", which StartRewrite refuses ("edit_empty"). A decoder
  // that returned "" for both would silently turn a plain Tokenize & Send into
  // a refusal, or worse.
  const rows = await cases('decode');
  const noText = rows.filter((r) => !b64(r.line_b64).includes('"text"'));
  assert.ok(noText.length, 'expected at least one command with no text field');
  for (const r of noText) assert.equal(r.decoded_is_null, true);
  // The whitespace-only fixture DOES travel (it is a non-empty string), and is
  // refused by the enforcer's own Trim() gate rather than by the wire format.
  const ws = rows.find((r) => r.decoded_b64 !== null && b64(r.decoded_b64) === EDITS.whitespace);
  assert.ok(ws, 'a whitespace-only edit must reach the enforcer and be refused there');
  assert.match(await readFile(ENFORCER, 'utf8'), /editedText\.Trim\(\)\.Length == 0/);
});

// ── The fail-closed length/budget gates, for real ────────────────────────────

test('an edit too long to type is REFUSED, and the budget catches what the cap cannot', { skip: !win }, async () => {
  const c = await one('dialog_constants');
  const rows = byKey(await cases('budget'), 'variant');
  for (const r of rows.values()) assert.equal(r.available, true, 'WriteFitsBudget is missing');

  // An ordinary edit is fine.
  assert.equal(rows.get('short').fits, true);
  assert.equal(rows.get('short').over_cap, false);
  assert.equal(rows.get('multiline_that_fits').fits, true);

  // The coarse character cap, which the edit box also enforces visibly.
  assert.equal(rows.get('exactly_max').over_cap, false);
  assert.equal(rows.get('exactly_max').length, c.edit_max);
  assert.equal(rows.get('one_over_max').over_cap, true,
    'one character past the cap must be refused ("edit_too_long")');
  assert.equal(rows.get('far_over_max').over_cap, true);
  assert.equal(rows.get('far_over_max').fits, false);

  // THE CASE THE CAP CANNOT ANSWER, and the reason the budget is re-run against
  // the edited text rather than inherited from the mask that was pinned: a line
  // break costs ~25ms to type where a character costs ~15.4ms, so a string
  // SHORTER than the cap can still be untypeable. An edit is exactly where this
  // bites — the user may turn one line into fifty.
  const breaks = rows.get('under_cap_all_breaks');
  assert.equal(breaks.over_cap, false, 'this string is inside the character cap…');
  assert.equal(breaks.fits, false, '…and still cannot be typed inside the write budget');
  assert.ok(breaks.estimate_ms > rows.get('exactly_max').estimate_ms,
    'line breaks must cost more than the characters they replace');
});

// ── The pin hold ────────────────────────────────────────────────────────────

test('THE HOLD EXISTS, and it can only ever move one expiry', { skip: !win }, async () => {
  const c = await one('dialog_constants');
  const rows = byKey(await cases('hold'), 'variant');
  for (const r of rows.values()) assert.equal(r.available, true, 'HoldPendingRewrite is missing');

  // 'on' for the pinned, rewritable id: the expiry goes out to the edit TTL, so
  // the pin outlives the user typing a sentence.
  const on = rows.get('matching_on');
  assert.equal(on.moved, true);
  assert.ok(Math.abs(on.ahead_ms - c.edit_ttl_ms) < 1000,
    `expected ~${c.edit_ttl_ms}ms of pin, got ${on.ahead_ms}ms`);
  // 'off' puts it straight back to the normal TTL — a cancelled edit does not
  // leave a block pinned for two minutes.
  const off = rows.get('matching_off');
  assert.equal(off.moved, true);
  assert.ok(Math.abs(off.ahead_ms - c.ttl_ms) < 1000,
    `expected ~${c.ttl_ms}ms of pin, got ${off.ahead_ms}ms`);
  assert.ok(off.ahead_ms < on.ahead_ms);

  // A wrong, invented or empty id, and a block that is not rewritable at all:
  // NOTHING moves. The hold cannot create a pin or widen one, so a compromised
  // parent gains nothing by replaying it.
  for (const name of ['wrong_id', 'not_rewritable', 'no_pin_at_all', 'empty_id']) {
    assert.equal(rows.get(name).moved, false, `${name} must not move the expiry`);
  }
  // And in EVERY case it left the pin's identity alone — same rewritable flag,
  // same id, same original and masked text. It is one expiry and nothing else.
  for (const [name, r] of rows) {
    assert.equal(b64(r.original_b64), 'my ssn is 123-45-6789', `${name}: the pin's original changed`);
    assert.equal(b64(r.masked_b64), 'my ssn is [SSN]', `${name}: the pin's masked text changed`);
    assert.equal(r.frozen, false, `${name}: the hold must not touch the freeze flag`);
  }
  assert.equal(rows.get('not_rewritable').rewritable, false,
    'the hold must never make an unrewritable block rewritable');
});

// ── The freeze: what makes an activatable edit box possible ─────────────────

test('THE BUG, as a decision: a surface change no longer destroys the pin it is editing', { skip: !win }, async () => {
  const rows = byKey(await cases('freeze'), 'variant');
  for (const r of rows.values()) assert.equal(r.available, true, '_pendingFrozen is missing');

  // THIS IS THE FIX. _fgIsAi false is exactly what the poll thread sees the
  // instant the edit box takes keyboard focus. Before, this tick cleared
  // _pendingBlockId, so the id the popup was holding went dead and
  // StartRewrite answered "stale_block_id" — the edit was thrown away.
  const held = rows.get('unexpired_pin');
  assert.equal(held.survived, true,
    'an unexpired pin must survive the foreground leaving the AI app');
  assert.equal(held.rewritable, true);
  assert.equal(held.block_id, 'b-1', 'the SAME id the popup is holding');
  assert.equal(held.frozen, true, 'and it is marked unofferable while held');
  // A freeze is not a recompute: nothing about the pinned prompt changed.
  assert.equal(b64(held.original_b64), 'my ssn is 123-45-6789');
  assert.equal(b64(held.masked_b64), 'my ssn is [SSN]');

  // THE BOUND. It is the pin's own expiry that ends this, not the surface — so
  // a user who wandered off still loses the offer, on exactly the clock the
  // hold set.
  assert.equal(rows.get('expired_pin').survived, false, 'an EXPIRED pin is still dropped');
  assert.equal(rows.get('expired_pin').frozen, false);
  assert.equal(rows.get('no_pin').survived, false, 'nothing is conjured out of no pin');

  // THE PANIC HOTKEY STILL WINS. Disarmed() is the one term in that gate that
  // means "stop touching the keyboard", so it clears outright rather than
  // freezing — otherwise a disarmed enforcer would still be holding a
  // consumable pin.
  assert.equal(rows.get('disarmed').survived, false,
    'the panic hotkey must clear the pin, not freeze it');
  assert.equal(rows.get('disarmed').rewritable, false);
  assert.equal(rows.get('disarmed').block_id, '');
  assert.equal(rows.get('disarmed').frozen, false);
});
