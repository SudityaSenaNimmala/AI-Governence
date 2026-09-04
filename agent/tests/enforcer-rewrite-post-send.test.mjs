// Behavioural tests for Tier B's POST-SEND CONFIRMATION in enforcer-win.ps1 —
// the check that decides whether a mask-and-send actually submitted.
//
// NOTHING HERE INSTALLS A KEYBOARD HOOK AND NOTHING HERE TYPES ANYTHING. The
// harness lifts the C# out of the .ps1, compiles it, and drives the pure
// decisions by reflection; the source-level checks at the bottom cover the loop
// itself, which cannot be executed offline (it reads a live UIA element).
//
// ── The bug this exists to catch ─────────────────────────────────────────────
// After typing the masked text, the rewrite synthesizes an Enter and then reads
// the composer back: if it STILL holds exactly the masked text, the send did not
// land and the result is "failed"/"not_submitted" rather than a claim that the
// prompt was sent. That is the right check — reporting a phantom success is the
// worst failure mode available here.
//
// It was a SINGLE FIXED READ at +200ms, and that is all a native composer needs
// (M365 Copilot, Claude Desktop). Confirmed live 2026-09 against Microsoft
// Teams: the masked message was genuinely in the conversation, with the value
// masked, and this check still said "not_submitted". Teams renders both of its
// composers in a WebView2 child process, so "the composer is empty now" has to
// cross a Chromium accessibility serialization before UIA can report it — the
// same class of lag the read-back verify poll was already given a 400ms window
// for after a one-shot read at +60ms was found catching a mid-write composer.
//
// The consequence was a GOVERNANCE GAP, not a cosmetic one: index.js's 'rewrite'
// handler returns early on any non-'ok' result, so a governed send that really
// happened produced no `os_monitor: TOKENIZED + sent` log line and no
// enforcement_redact audit event at all.
//
// The fix: the post-send check polls, and HOW LONG is catalog data per surface
// (AI_PANELS' `postSendVerifyMs`), so no other app waits any longer than it did.
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
const HARNESS = join(__dirname, 'helpers', 'rewrite-post-send-harness.ps1');
// Same escape hatch as the other enforcer harnesses: aim this at a reconstructed
// PRE-fix source and the `available` assertions fail — the constants and
// PostSendVerifyMsFor do not exist there. Nothing in the product reads it.
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
async function one(name) {
  const rows = await cases(name);
  assert.equal(rows.length, 1, `expected exactly one '${name}' observation`);
  return rows[0];
}
const byKey = (rows, key) => new Map(rows.map((r) => [r[key], r]));

/**
 * The read schedule the post-send loop actually produces for a window, modelled
 * from the constants read out of the compiled enforcer. The loop sleeps
 * `first_read_ms`, reads, then re-reads every `poll_ms` while the composer still
 * holds the masked text and the deadline has not passed — so it checks the
 * deadline BEFORE sleeping, which is why the last read can land one poll beyond
 * the window.
 */
function readTimes(windowMs, { first_read_ms: first, poll_ms: poll }) {
  const times = [first];
  let t = first;
  while (t < windowMs) { t += poll; times.push(t); }
  return times;
}

test('harness never calls Start(), never installs a hook, and never types anything', async () => {
  const src = await readFile(HARNESS, 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.equal(/\[CfaiEnforcer\]::Start\(/.test(code), false, 'the harness must never call Start()');
  assert.equal(/SetWindowsHookEx/.test(code), false);
  // The write path synthesizes keystrokes. Driving any of it from a test would
  // type into a real window on the machine running the suite.
  for (const forbidden of ['RunRewrite', 'StartRewrite', 'SendInput', 'SendKeyCombo', 'SendUnicodeChunk', 'SendKeyPress']) {
    assert.equal(code.includes(forbidden), false, `the harness must never reach ${forbidden}`);
  }
  // It drives the pure decisions instead.
  assert.match(code, /PostSendVerifyMsFor/);
  assert.match(code, /LoadAiPanels/);
  assert.match(code, /NormalizeWs/);
});

test('THE FIX EXISTS: the post-send confirmation is a catalogued WINDOW, not one fixed read', { skip: !win }, async () => {
  // Pre-fix there is no window at all — the read site slept a literal 200 and
  // read once — so neither the constants nor the resolver exist and this fails
  // first, with a diagnosable message rather than a compile error.
  const c = await one('post_send_constants');
  assert.equal(c.available, true,
    'REWRITE_POST_SEND_MS / PostSendVerifyMsFor are missing — the post-send check is still a single fixed read');
  // The first read is UNCHANGED. This is the number a native composer needs and
  // the whole point of keeping it a separate constant from the window: the fix
  // does not make anybody's successful send slower to confirm.
  assert.equal(c.first_read_ms, 200, 'the first post-send read must stay at +200ms');
  // The re-read cadence, same as the read-back verify poll's.
  assert.equal(c.poll_ms, 40);
  assert.ok(c.poll_ms > 0 && c.poll_ms < c.first_read_ms, 'the poll must be finer than the first read');
  assert.equal(c.max_ms, 1500, 'the ceiling any catalog value is clamped to');
  assert.ok(c.max_ms > c.first_read_ms);
});

test('THE BUG, as a decision: a composer that clears late is SEEN to have cleared on Teams and was not before', { skip: !win }, async () => {
  const c = await one('post_send_constants');
  const panels = byKey(await cases('post_send_for_panel'), 'panel');

  // The default window admits EXACTLY ONE read, at +200ms — byte-for-byte the
  // behaviour that shipped, for every surface that does not ask for more.
  assert.deepEqual(readTimes(panels.get('claude_code').ms, c), [200],
    'a surface with no catalog value must still take exactly one read');

  // Teams' window admits many, out to ~1.5s.
  const teams = readTimes(panels.get('teams_composer').ms, c);
  assert.ok(teams.length > 30, `Teams' window should admit many reads (got ${teams.length})`);
  assert.equal(teams[0], 200, 'the FIRST read is still at +200ms — nothing is slower in the common case');

  // THE FAILING CASE, stated as the observable it is. A composer whose cleared
  // state only becomes visible to UIA at +600ms (a Chromium accessibility hop):
  const clearedAt = 600;
  const sees = (windowMs) => readTimes(windowMs, c).some((t) => t >= clearedAt);
  assert.equal(sees(panels.get('teams_composer').ms), true,
    'Teams must now see the cleared composer and report ok');
  assert.equal(sees(panels.get('teams_copilot_composer').ms), true,
    'the Copilot-tab composer is behind the same WebView2 hop');
  assert.equal(sees(c.first_read_ms), false,
    'and this is the bug: with only the +200ms read, that same successful send read as not_submitted');

  // A send that genuinely did NOT land is still caught, however long we wait —
  // this is what makes the longer window a tolerance rather than a loosening.
  // The text stays in the composer for every read in the schedule, so the last
  // read still finds it and the verdict is still not_submitted.
  const stillThere = byKey(await cases('still_there'), 'variant');
  assert.equal(stillThere.get('still_the_masked_text').still_there, true);
  assert.equal(stillThere.get('still_it_reflowed').still_there, true,
    'a composer that merely reflowed the whitespace still HOLDS the text — not a send');
});

test('the post-send window is per-surface CATALOG DATA, and only Teams asks for more', { skip: !win }, async () => {
  const c = await one('post_send_constants');
  const panels = byKey(await cases('post_send_for_panel'), 'panel');
  for (const r of panels.values()) {
    assert.equal(r.available, true, `${r.panel}: PostSendVerifyMsFor must exist`);
  }
  // The two shipped Teams composers, the surfaces the live failure was measured
  // on. Two different editors (CKEditor and Fluent's fai-EditorInput__input),
  // one shared reason: both are rendered in Teams' WebView2 child process.
  assert.equal(panels.get('teams_composer').ms, 1500);
  assert.equal(panels.get('teams_copilot_composer').ms, 1500);
  // EVERYTHING ELSE IS UNTOUCHED. An IDE panel, a panel id in no catalog, no
  // panel at all (a pure chat app has no AI_PANELS row), and a stale panel id
  // left set while the surface is not a panel — all keep the single read.
  for (const id of ['claude_code', 'fixture_absent', 'not_in_catalog', '(none)', '(id_without_panel_flag)']) {
    assert.equal(panels.get(id).ms, c.first_read_ms, `${id} must keep the default single read`);
    assert.deepEqual(readTimes(panels.get(id).ms, c), [c.first_read_ms]);
  }
  // A legal in-range value is honoured, which is what makes this DATA rather
  // than a hardcoded Teams special case.
  assert.equal(panels.get('fixture_middle').ms, 700);
});

test('the catalog value is CLAMPED on the way in, so no payload can break the time budget', { skip: !win }, async () => {
  const c = await one('post_send_constants');
  const clamped = byKey(await cases('post_send_clamp'), 'panel');
  for (const r of clamped.values()) {
    assert.equal(r.available, true, `${r.panel}: PanelSig.PostSendVerifyMs must exist`);
    assert.ok(r.ms >= c.first_read_ms && r.ms <= c.max_ms,
      `${r.panel}: ${r.ms}ms is outside [${c.first_read_ms}, ${c.max_ms}]`);
  }
  // An entry may only ever LENGTHEN the window: shortening it below the first
  // read would take away the read native composers rely on, so 50, 0, a
  // negative and a non-numeric value all land on the default rather than
  // disabling the confirmation.
  for (const id of ['fixture_below', 'fixture_zero', 'fixture_negative', 'fixture_garbage', 'fixture_absent']) {
    assert.equal(clamped.get(id).ms, c.first_read_ms, `${id} must not shorten the confirmation`);
  }
  // …and it may not lengthen it past the ceiling the budget was reasoned
  // against — 30s would outlive the dialog waiting for the answer.
  assert.equal(clamped.get('fixture_huge').ms, c.max_ms);
  assert.equal(clamped.get('teams_composer').ms, 1500);
  assert.equal(clamped.get('fixture_middle').ms, 700);
});

test('the longer window still fits the rewrite time budget it was reasoned against', { skip: !win }, async () => {
  // Requirement carried over from the write-budget work: the whole rewrite must
  // report before block-dialog.js closes itself, or the user gets no answer at
  // all. The 16s is read from that file rather than restated here.
  const c = await one('post_send_constants');
  const dialog = await readFile(join(AGENT_DIR, 'electron', 'renderer', 'block-dialog.js'), 'utf8');
  const m = dialog.match(/setTimeout\(\(\) => window\.close\(\), (\d+)\)/);
  assert.ok(m, "expected block-dialog.js's self-close timeout");
  const dialogMs = Number(m[1]);
  assert.equal(dialogMs, 16000);

  // The tail, at the WORST case the loop can produce: the deadline is checked
  // before sleeping, so the last read can land one poll beyond the window.
  const modifiersWaitMs = 2500;   // the "modifiers_stuck" ceiling
  const clearComposerMs = 80;     // Ctrl+A + Delete
  const verifyPollMs = 400;       // the read-back poll
  const settleMs = 300;           // the pre-Enter settle
  const worstTail = verifyPollMs + settleMs + c.max_ms + c.poll_ms;
  const worstTotal = modifiersWaitMs + clearComposerMs + c.write_budget_ms + worstTail;
  assert.ok(worstTotal < dialogMs,
    `the worst-case rewrite (${worstTotal}ms) must report before the dialog closes (${dialogMs}ms)`);
  // …and inside the 15s pin TTL the same arithmetic quotes.
  assert.equal(c.ttl_ticks, 15000 * 10000, 'REWRITE_TTL is 15s');
  assert.ok(worstTotal < c.ttl_ticks / 10000,
    `the worst-case rewrite (${worstTotal}ms) must fit REWRITE_TTL`);
  // The DEFAULT case did not get slower: same total as before this change.
  const defaultTotal = modifiersWaitMs + clearComposerMs + c.write_budget_ms
    + verifyPollMs + settleMs + c.first_read_ms;
  assert.equal(defaultTotal, 12480, 'the default worst case is unchanged at ~12.6s');
});

test('a CLEARED composer is never mistaken for a failed send, however it reads', { skip: !win }, async () => {
  // The other half of the comparison, and the reason waiting longer is safe: a
  // composer that has cleared reads as empty, whitespace, a failed read (null),
  // its placeholder, or whatever the user typed next — none of which equal the
  // masked text, so the loop exits on the first read that sees any of them.
  const rows = byKey(await cases('still_there'), 'variant');
  for (const v of ['cleared_empty', 'cleared_whitespace', 'cleared_null', 'placeholder', 'next_message_typed']) {
    assert.equal(rows.get(v).still_there, false, `${v} must not read as an unsent message`);
  }
});

// ── Source-level invariants for the loop that cannot be executed offline ─────

test('the post-send check POLLS, and the one-shot read is gone', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fn = src.slice(src.indexOf('static void RunRewrite('), src.indexOf('// SendInput\'s return value is the count'));
  assert.ok(fn.length > 0, 'expected a RunRewrite body');
  const tail = fn.slice(fn.indexOf('SendKeyPress(VK_RETURN);'));
  assert.ok(tail.length > 0, 'expected the post-send tail');

  // THE REGRESSION GUARD. The literal that was the whole bug: a fixed 200ms
  // sleep followed by exactly one read, with no way for a slower composer to
  // catch up. No naked millisecond literal may reappear in this tail — the
  // budget arithmetic cannot see one.
  assert.equal(/Thread\.Sleep\(\d+\)/.test(tail), false,
    'the post-send tail must not sleep on a literal — it is what made this a one-shot read');
  assert.match(tail, /Thread\.Sleep\(REWRITE_POST_SEND_MS\);/);
  assert.match(tail, /Thread\.Sleep\(REWRITE_POST_SEND_POLL_MS\);/);

  // The loop: bounded by a deadline derived from THIS SURFACE's window, re-reads
  // the same pinned element, and exits the moment the text is gone.
  assert.match(tail, /long postSendDeadline = DateTime\.UtcNow\.Ticks\s*\r?\n?\s*\+ TimeSpan\.FromMilliseconds\(postSendMs - REWRITE_POST_SEND_MS\)\.Ticks;/);
  assert.match(tail, /while \(stillThere && DateTime\.UtcNow\.Ticks < postSendDeadline\)/);
  assert.equal((tail.match(/postSend = ReadText\(el\);/g) || []).length, 2,
    'the first read plus the re-read inside the loop');
  // The VERDICT is unchanged, and is still reached from the same comparison —
  // waiting longer changed when we look, never what counts as sent.
  assert.match(tail, /bool stillThere = NormalizeWs\(postSend\) == NormalizeWs\(masked\);/);
  assert.match(tail, /if \(stillThere\) \{ EmitRewrite\(blockId, "failed", "not_submitted"\); return; \}/);
  assert.match(tail, /EmitRewrite\(blockId, "ok", "sent", masked\);/);
  // …and it is still the LAST thing that has to pass before "ok" is claimed.
  assert.ok(tail.indexOf('"not_submitted"') < tail.indexOf('EmitRewrite(blockId, "ok", "sent", masked);'));

  // The window is PINNED in the pre-flight, before anything is typed, for the
  // same reason the newline combination is: the poll thread keeps rewriting
  // _fgPanelId while we clear and retype the composer.
  const pinIdx = fn.indexOf('int postSendMs = PostSendVerifyMsFor();');
  assert.ok(pinIdx > 0, 'expected the post-send window to be pinned in the pre-flight');
  assert.ok(pinIdx < fn.indexOf('SendKeyCombo(VK_CONTROL, VK_A)'),
    'the window must be resolved before Ctrl+A clears the composer');
  assert.equal((fn.match(/PostSendVerifyMsFor\(\)/g) || []).length, 1,
    'it must be read exactly once, not re-resolved at the read site');
});

test('the post-send window resolves from the panel catalog, the same way the newline combo does', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const fn = src.slice(src.indexOf('static int PostSendVerifyMsFor()'), src.indexOf('static void StartRewrite('));
  assert.ok(fn.length > 0, 'expected a PostSendVerifyMsFor body');
  // Panel state, case-insensitive id comparison, default for everything else —
  // deliberately the same shape as NewlineKeysFor so there is one way to read a
  // per-surface fact.
  assert.match(fn, /if \(_fgIsPanel && !string\.IsNullOrEmpty\(_fgPanelId\)\)/);
  assert.match(fn, /string\.Equals\(p\.Id, _fgPanelId, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(fn, /return REWRITE_POST_SEND_MS;/);
  // Belt and braces on the lower bound, so the read site can never be handed a
  // window shorter than the read every surface used to get.
  assert.match(fn, /p\.PostSendVerifyMs < REWRITE_POST_SEND_MS \? REWRITE_POST_SEND_MS : p\.PostSendVerifyMs/);
  // The load path clamps too — the C# side must not trust an env var it did not
  // build, even though buildAiPanelConfig already clamped.
  assert.match(src, /PostSendVerifyMs = JsIntClamped\(d, "postSendVerifyMs",\s*\r?\n?\s*REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MS, REWRITE_POST_SEND_MAX_MS\),/);
  // The value is DATA — the numbers live in ai-processes.js, so neither 1500 nor
  // a panel id may be written into the .ps1 as a Teams special case. Comment
  // lines are excluded: the explanations legitimately name teams_composer and
  // quote the arithmetic.
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/"teams_composer"|"teams_copilot_composer"/.test(code), false,
    'panel ids arrive as data, never as C# literals');
  assert.equal(/PostSendVerifyMs\w* = 1500|REWRITE_POST_SEND_MS = 1500/.test(code), false,
    'the Teams window must come from the catalog, not from a literal in the enforcer');
});

test('the post-send default and ceiling are catalog data, mirrored in exactly one C# constant each', async () => {
  // Same lockstep discipline DEFAULT_NEWLINE_KEYS and PLATFORM_PROCS are held
  // under. If these drift, either every app silently gets Teams' longer wait or
  // Teams silently goes back to the single read that lost the audit event.
  const { DEFAULT_POST_SEND_VERIFY_MS, MAX_POST_SEND_VERIFY_MS, AI_PANELS, buildAiPanelConfig, clampPostSendVerifyMs } =
    await import('../src/os_monitor/ai-processes.js');
  assert.equal(DEFAULT_POST_SEND_VERIFY_MS, 200);
  assert.equal(MAX_POST_SEND_VERIFY_MS, 1500);
  const src = await readFile(ENFORCER, 'utf8');
  assert.match(src, new RegExp(`const int REWRITE_POST_SEND_MS = ${DEFAULT_POST_SEND_VERIFY_MS};`));
  assert.match(src, new RegExp(`const int REWRITE_POST_SEND_MAX_MS = ${MAX_POST_SEND_VERIFY_MS};`));
  assert.equal((src.match(/REWRITE_POST_SEND_MS = /g) || []).length, 1, 'exactly one mirror may exist');
  assert.equal((src.match(/REWRITE_POST_SEND_MAX_MS = /g) || []).length, 1, 'exactly one mirror may exist');

  // Teams' two composers state it explicitly — they are the surfaces the live
  // false failure was measured on.
  for (const id of ['teams_composer', 'teams_copilot_composer']) {
    const entry = AI_PANELS.find((p) => p.id === id);
    assert.ok(entry, `${id} is missing from AI_PANELS`);
    assert.equal(entry.postSendVerifyMs, MAX_POST_SEND_VERIFY_MS,
      `${id} must state its post-send confirmation window`);
  }
  // No other entry asks for more than the default, so nothing else changed.
  for (const entry of AI_PANELS) {
    if (entry.id.startsWith('teams_')) continue;
    assert.equal(entry.postSendVerifyMs, undefined,
      `${entry.id} must not have acquired a longer post-send window`);
  }
  // The field survives the env-var handoff for EVERY entry, resolved to a NUMBER
  // so the C# side never has to tell missing from empty, and already clamped.
  for (const entry of buildAiPanelConfig()) {
    assert.equal(typeof entry.postSendVerifyMs, 'number', `${entry.id}.postSendVerifyMs must be a number`);
    const source = AI_PANELS.find((p) => p.id === entry.id);
    assert.equal(entry.postSendVerifyMs, clampPostSendVerifyMs(source.postSendVerifyMs),
      `${entry.id}.postSendVerifyMs must travel as the clamped catalog value`);
    assert.ok(entry.postSendVerifyMs >= DEFAULT_POST_SEND_VERIFY_MS
      && entry.postSendVerifyMs <= MAX_POST_SEND_VERIFY_MS);
  }
  // The JS clamp agrees with the C# one on every edge the harness drives.
  assert.equal(clampPostSendVerifyMs(undefined), 200);
  assert.equal(clampPostSendVerifyMs(50), 200);
  assert.equal(clampPostSendVerifyMs(0), 200);
  assert.equal(clampPostSendVerifyMs(-5000), 200);
  assert.equal(clampPostSendVerifyMs('soon'), 200);
  assert.equal(clampPostSendVerifyMs(30000), 1500);
  assert.equal(clampPostSendVerifyMs(700), 700);
});

test('index.js still reports the audit event off result:"ok" alone — the fix is in the enforcer', async () => {
  // The other end of the gap, pinned so the diagnosis stays true: the Node side
  // was never wrong. It reports enforcement_redact for exactly the sends the
  // enforcer confirmed, and drops everything else. Making it report a "failed"
  // rewrite would have been the wrong fix — that is the phantom-success failure
  // mode the post-send check exists to prevent.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const handler = src.slice(src.indexOf("this.enforcer.on('rewrite'"), src.indexOf("this.enforcer.on('route'"));
  assert.ok(handler.length > 0, 'expected the rewrite handler');
  assert.match(handler, /if \(ev\.result !== 'ok'\) return;/);
  assert.match(handler, /kind: 'enforcement_redact'/);
  assert.match(handler, /os_monitor: TOKENIZED \+ sent/);
});
