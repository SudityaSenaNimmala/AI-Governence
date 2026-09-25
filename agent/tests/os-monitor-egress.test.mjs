// Desktop-agent EGRESS guardrails — Microsoft Outlook (compose/attach) and the
// OneDrive/SharePoint sync roots.
//
// Modelled on os-monitor-host-files.test.mjs, and for the same reason: what
// matters is not that a function returns the right value but that NOTHING IS
// READ, SCANNED, HELD OR REPORTED in the ungoverned case. So the monitor is
// driven end to end with every child-process owner stubbed, and the assertions
// are about the observable outcome — what was enqueued, what was held, what was
// toasted, what reached the log.
//
// The five properties this file exists to protect, in order:
//
//   1. NO POLICY ⇒ SILENCE. With no governed ai_platforms row for a mail or
//      cloud-sync host, nothing is armed anywhere: no mail window is read, no
//      picker is recognised, and no FileSystemWatcher is opened on the user's
//      Documents folder. This is the state of every machine whose admin has said
//      nothing about email or OneDrive.
//   2. THE READING PANE IS NOT THE COMPOSE PANE. A filename in Outlook's message
//      list or reading pane — a subject line, an attachment a colleague sent —
//      is never reported as an outbound upload. The chip diff is taken against a
//      SCOPED ROOT or not at all.
//   3. ONE RECORD PER EMAIL. The compose body is captured exactly once, at the
//      send transition, not once per poll tick.
//   4. A DOWNLOAD IS NOT AN UPLOAD. A file the sync client materialised from the
//      cloud is never reported — that record would name this user as the person
//      who exfiltrated a file they never touched.
//   5. FAIL OPEN ON A MAIL CLIENT. An unscannable or unverifiable attachment is
//      REPORTED but never HELD. Escalating on "we could not read it" in a mail
//      client would mean nobody can email a legacy .doc or a password-protected
//      archive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

const { OsMonitor } = await import('../src/os_monitor/index.js');
const { SyncWatcher, discoverSyncRoots } = await import('../src/os_monitor/sync-watcher.js');
const {
  EGRESS_SURFACES,
  EGRESS_SYNC_ROOTS,
  synthesizeEgressSurfaces,
} = await import('../src/os_monitor/ai-processes.js');

const win = process.platform === 'win32';

// ── fixtures ────────────────────────────────────────────────────────────────

let dir = null;
async function tmp(name, contents) {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'cfai-egress-'));
  const p = join(dir, name);
  await writeFile(p, contents);
  return p;
}
test.after?.(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

// A file the shipped pattern catalog really flags — AWS key ids and secret keys
// are in it, so this scans CRITICAL through the ordinary utf8 path.
const SECRET_TEXT = [
  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
].join('\n');

// ── the monitor, with every child-process owner stubbed ─────────────────────

function makeMonitor({ enforcerEnabled = false, egressCaptureMode = { [SURFACE]: 'hold' } } = {}) {
  const calls = { attachHold: [], enqueued: [], toasts: [], logs: [], armedRoots: [], syncStarts: 0 };
  const log = {
    info: (m) => calls.logs.push(['info', String(m)]),
    warn: (m) => calls.logs.push(['warn', String(m)]),
    error: (m) => calls.logs.push(['error', String(m)]),
  };
  const monitor = new OsMonitor({
    serverUrl: 'http://127.0.0.1:1',
    token: 'test-token',
    log,
    enforcerEnabled,
  });

  const emitterStub = (extra = {}) => Object.assign(new EventEmitter(), {
    start() {}, stop() {}, ...extra,
  });

  monitor.poller = emitterStub();
  monitor.promptWatcher = emitterStub();
  monitor.enforcer = emitterStub({
    updateBlockPatterns() { return false; },
    attachHold(state, payload) { calls.attachHold.push({ state, ...payload }); return true; },
    tokenize() { return true; },
    tokenizeEditHold() { return true; },
  });
  monitor.attachmentWatcher = emitterStub({ hostArm() { return true; } });
  monitor.dialogWatcher = emitterStub({ hostArm() { return true; } });
  // The sync watcher is stubbed at the same seam as the others: what has to be
  // observable is WHETHER it was armed and started, never that a real
  // FileSystemWatcher was opened on this machine's OneDrive.
  monitor.syncWatcher = emitterStub({
    armedRoots: [],
    stopRequested: false,
    start() { calls.syncStarts += 1; },
    setArmedRoots(roots) { calls.armedRoots.push(roots); this.armedRoots = roots; return true; },
  });
  monitor.reporter = { start() {}, stop() {}, enqueue(e) { calls.enqueued.push(e); } };
  monitor.toast = { start() {}, stop() {}, show(t) { calls.toasts.push(t); } };
  monitor.policySync = { start() {}, stop() {} };
  monitor.featureSync = { start() {}, stop() {} };

  monitor.start();
  // Set AFTER start(): #syncEgressPolicy runs once synchronously inside it, and
  // with no real egress-surfaces.json on disk it would set this back to empty.
  // The policy #syncEgressPolicy would normally read off disk on its own 10s
  // tick — overridden directly here so a test does not need a real file on disk
  // to exercise the capture_mode-aware toast. Defaults to 'hold' so every
  // existing hold-focused test keeps its prior meaning; a test of 'observe'/
  // 'block_critical' passes its own map.
  monitor.egressCaptureModeById = new Map(Object.entries(egressCaptureMode));
  return { monitor, calls };
}

// The handlers are async and registered with .on(), so there is no promise to
// await. Poll for the observable outcome — generously, because a real extraction
// genuinely takes a moment.
async function waitFor(fn, { timeout = 20_000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
// "Nothing happened" needs a settling period, not a poll: there is no event to
// wait for, and returning early would pass for the wrong reason.
async function settle(ms = 700) { await new Promise((r) => setTimeout(r, ms)); }

const OUTLOOK = 'OUTLOOK';
const SURFACE = 'outlook_classic';

// ── 1. THE PROTECTION: no governed policy means total silence ───────────────

test('NO governed ai_platforms row: nothing about email or cloud sync is armed', () => {
  // The single most important assertion in this file, and it is a property of
  // the POLICY LAYER rather than of any watcher: synthesizeEgressSurfaces is
  // what every consumer reads, and with no governed row it produces an empty
  // payload — so there is nothing for a watcher to arm from.
  for (const rows of [[], [{ host: 'outlook.office.com' }], [{ host: 'outlook.office.com', blocked: true }]]) {
    const out = synthesizeEgressSurfaces(rows, null);
    assert.deepEqual(out.surfaces, []);
    assert.deepEqual(out.sync_roots, []);
  }
  // …and the two catalogs themselves ship completely closed, so even a governed
  // row arms nothing until a human live-probe pass flips the flags.
  const governed = synthesizeEgressSurfaces([
    { host: 'outlook.office.com', governed: true, capture_mode: 'hold', surface: 'desktop' },
    { host: 'onedrive.live.com', governed: true, capture_mode: 'hold', surface: 'desktop' },
  ], null);
  assert.ok(governed.surfaces.length > 0, 'a governed row should at least reach the payload');
  for (const s of governed.surfaces) assert.equal(s.verified, false);
  for (const r of governed.sync_roots) assert.equal(r.verified, false);
});

test('an UNGOVERNED mail client: no egress route reads, scans, holds or reports anything', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('ungoverned-egress.env', SECRET_TEXT);
  try {
    // Every existing AI/host-app route, driven with a mail process. None of them
    // may produce anything: OUTLOOK is in no AI catalog, so identifyAiProcess
    // answers null and each handler stops at its own `if (!ai) return`.
    monitor.poller.emit('clipboard', { process: OUTLOOK, title: 'RE: Q3 payroll - Sruthi Chimata', text: SECRET_TEXT, len: SECRET_TEXT.length, cause: 'seq_change' });
    monitor.poller.emit('clipboard_files', { process: OUTLOOK, title: 'RE: Q3 payroll', paths: [p] });
    monitor.attachmentWatcher.emit('attachment_appeared', { process: OUTLOOK, filename: 'ungoverned-egress.env', path: p });
    monitor.dialogWatcher.emit('file_dialog_pick', { process: OUTLOOK, title: 'Open', path: p, host_armed: true });
    monitor.promptWatcher.emit('prompt_text', { process: OUTLOOK, text: SECRET_TEXT, len: SECRET_TEXT.length, title: 'RE: Q3 payroll' });
    await settle();

    assert.deepEqual(calls.enqueued, [], 'nothing may be reported for a mail client through an AI route');
    assert.deepEqual(calls.attachHold, [], 'no send hold may be armed');
    assert.deepEqual(calls.toasts, [], 'no toast may fire');
    // The strongest statement available: the file was never read, so its bytes
    // never entered this process. buildFileUploadEvent is what reads it.
    const leaked = calls.logs.filter(([, m]) => m.includes('ungoverned-egress.env'));
    assert.deepEqual(leaked, [], `the filename must not even reach the log: ${JSON.stringify(leaked)}`);
    // And the SUBJECT LINE — which is what an Outlook window title is — must not
    // be anywhere near a log line.
    for (const [, m] of calls.logs) {
      assert.equal(m.includes('Q3 payroll'), false, `a message subject reached the log: ${m}`);
    }
  } finally { monitor.stop(); }
});

test('an event naming a surface this catalog does not carry is dropped', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('unknown-surface.env', SECRET_TEXT);
  try {
    // Defence in depth on the arriving side: the helper only produces these
    // when policy armed it, and this side still refuses an unrecognised id
    // rather than trusting the sender.
    monitor.attachmentWatcher.emit('egress_attachment_appeared', { surface: 'not_a_surface', process: 'NOTEPAD', filename: 'unknown-surface.env', path: p });
    monitor.dialogWatcher.emit('egress_file_dialog_pick', { surface: '', process: 'NOTEPAD', path: p });
    monitor.syncWatcher.emit('sync_file', { root_id: 'not_a_root', path: p, origin: 'local_new', size: 10 });
    monitor.promptWatcher.emit('egress_body', { surface: 'not_a_surface', process: 'NOTEPAD', text: SECRET_TEXT, len: SECRET_TEXT.length });
    await settle();
    assert.deepEqual(calls.enqueued, []);
    assert.deepEqual(calls.attachHold, []);
    assert.deepEqual(calls.toasts, []);
  } finally { monitor.stop(); }
});

// ── 2. the reading pane is not the compose pane ─────────────────────────────

test('a filename in the reading pane / message list is never reported as an attachment', async () => {
  // THE false positive this feature could otherwise produce at scale. Outlook's
  // message list and reading pane are full of filename-shaped text: subject
  // lines, and the attachments of every message the user has RECEIVED. A
  // whole-window chip diff would report each one the user scrolls past as an
  // outbound upload — a flood of false governance records that also discloses
  // the contents of their inbox.
  //
  // The mechanism that prevents it is the SCOPED ROOT: the diff is taken against
  // the compose pane resolved from `scopeWindow`, or not taken at all. Asserted
  // at the source, because the alternative would be to assert against a live
  // Outlook window.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');

  // The egress branch collects against $scopeRoot — never against the app
  // window element.
  const branch = code.slice(code.indexOf('$eg = Get-ForegroundEgressWindow'), code.indexOf('$fg = Get-ForegroundAiWindow'));
  assert.ok(branch.length > 0, 'expected an egress branch in the poll loop');
  assert.match(branch, /\$scopeRoot = Resolve-EgressScopeRoot \$eg\.Element \$eg\.Scope/);
  assert.match(branch, /Collect-FilenameLikeNames \$scopeRoot/);
  assert.equal(/Collect-FilenameLikeNames \$eg\.Element/.test(branch), false,
    'the chip diff must NEVER be taken against the whole mail window');
  // …and the collection is INSIDE the `if ($scopeRoot)` guard, so an unresolved
  // pane means nothing is collected and no baseline is taken either.
  const guard = branch.indexOf('if ($scopeRoot) {');
  const collect = branch.indexOf('Collect-FilenameLikeNames $scopeRoot');
  assert.ok(guard >= 0 && guard < collect, 'the scoped-root guard must precede the collection');

  // Resolve-EgressScopeRoot returns $null — not the window — when it cannot
  // resolve the pane, which is the fail-open-on-detection rule.
  const resolver = code.slice(code.indexOf('function Resolve-EgressScopeRoot'), code.indexOf('function Get-ForegroundAiWindow'));
  assert.ok(resolver.length > 0, 'expected a Resolve-EgressScopeRoot body');
  assert.match(resolver, /if \(-not \$sig -or -not \$windowElement\) \{ return \$null \}/);
  assert.equal(/return \$windowElement/.test(resolver), false,
    'an unresolved compose pane must never fall back to the whole window');

  // The existing Teams/AI state is untouched: the egress path uses its own
  // baseline tables, so an egress tick cannot seed, drop or shadow the baseline
  // the just-fixed Teams attachment detection depends on.
  assert.match(code, /\$EgressSeen = @\{\}/);
  assert.equal(/\$EgressSeen\[\$fg\.Hwnd\]|\$Seen\['egress/.test(code), false,
    'the two baselines must not share a table');
  assert.equal(/\$AiProcesses\s*\.\s*Add|\$AiProcesses\s*\+=/.test(code), false,
    'the catalog process list must never be mutated');
  assert.equal(/\$ArmedHostProcs\.Add\(\$?[A-Za-z]*[Ee]gress/.test(code), false,
    'an egress process must never enter the host-app armed set');

  // The existing regexes were NOT widened speculatively for Outlook's chip
  // vocabulary — over-stripping silently rewrites a real filename into a
  // different one and then scans the wrong file.
  assert.match(code, /\$ChromeVerbRegex\s+=\s+'\(\?i\)\^\(\?:remove\|delete\|dismiss\|discard\|detach\|unattach\|clear\|cancel\)/);
  assert.ok(code.includes("$ChromeShareNounRegex   = '(?i)^(?:shared|sent|attached|uploaded|added|posted)"),
    'the share-noun regex must be unchanged');
});

test('the egress watchers arm from POLICY only, and fail closed to nothing armed', async () => {
  // Each of the three .ps1 loaders: empty locals on every failure mode, built
  // fresh and assigned at the end so a malformed payload cannot half-arm.
  for (const [file, sets] of [
    ['attachment-watcher.ps1', ['$script:EgressProcs = $procs', '$script:EgressByProc = $byProc']],
    ['file-dialog-watcher.ps1', ['$script:EgressProcs = $procs', '$script:EgressIdByProc = $ids']],
    ['prompt-watcher.ps1', ['$script:EgressBySig = $bySig', '$script:EgressBodyIds = $bodyIds']],
  ]) {
    const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    const loader = src.slice(src.indexOf('function Load-EgressSurfaces'), src.indexOf('function Load-EgressSurfaces') + 4000);
    assert.ok(loader.length > 0, `${file}: expected a Load-EgressSurfaces body`);
    // The catch resets the locals to empty rather than leaving a partial build.
    assert.match(loader, /\} catch \{/, `${file}: the loader must swallow its own failures`);
    for (const assign of sets) {
      assert.ok(loader.includes(assign), `${file}: expected the final assignment ${assign}`);
      // The assignment comes AFTER the catch, i.e. only at the end.
      assert.ok(loader.indexOf(assign) > loader.indexOf('} catch {'), `${file}: ${assign} must be assigned at the end`);
    }
    // The policy path is overridable for tests but defaults to the real state dir.
    assert.match(src, /\$EgressPath = if \(\$env:CFAI_EGRESS_PATH\)/, `${file}: expected a policy path`);
    assert.match(src, /egress-surfaces\.json/, `${file}: expected the policy file name`);
  }
});

test('the two-flag gate is in EVERY loader, and a non-boolean flag cannot satisfy it', async () => {
  // The gate that decides whether a policy row may arm anything at all:
  // verified AND enforce, both REAL BOOLEANS. It has to be present in all four
  // readers of egress-surfaces.json, because any one of them missing it would
  // arm its own path off an admin's governed row alone — with no live probe
  // behind the signature it is about to trust.
  //
  // The `-isnot [bool]` half is not belt-and-braces: PowerShell coerces the
  // non-empty STRING "false" and the NUMBER 1 to $true, so a hand-edited or
  // half-written policy file carrying `"verified":"false"` would satisfy a
  // plain -eq $true test. Node-side coverage for the same coercions lives in
  // os-monitor-egress-qa.test.mjs.
  const gate = 'if (($s.verified -isnot [bool]) -or ($s.verified -ne $true)'
    + ' -or ($s.enforce -isnot [bool]) -or ($s.enforce -ne $true)) { continue }';
  for (const file of ['attachment-watcher.ps1', 'file-dialog-watcher.ps1', 'prompt-watcher.ps1']) {
    const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    const start = src.indexOf('function Load-EgressSurfaces');
    const loader = src.slice(start, src.indexOf('} catch {', start));
    assert.ok(loader.length > 0, `${file}: expected a Load-EgressSurfaces body`);
    assert.ok(loader.includes(gate), `${file}: the loader must refuse a row that is not verified AND enforcing`);
    // …and the gate comes BEFORE anything is added to the locals, so a refused
    // row cannot contribute a process, an id or a signature.
    const gateAt = loader.indexOf(gate);
    for (const arm of ['$procs.Add(', '$bySig[', '$byProc[', '$ids[', '$bodyIds.Add(']) {
      const armAt = loader.indexOf(arm);
      if (armAt < 0) continue;
      assert.ok(gateAt < armAt, `${file}: ${arm} must not run before the verified/enforce gate`);
    }
  }
  // The C# helper reads the same file for the send-chord hold and applies the
  // same two flags — through JsBool, which is the typed equivalent.
  const enf = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.ok(enf.includes('bool armable = JsBool(d, "verified") && JsBool(d, "enforce");'),
    'the C# loader must apply both flags');
  assert.ok(enf.includes('if (armable) sendKeys[name] = chords;'),
    'only a verified+enforcing surface may contribute a send chord');
});

// ── 3. body capture: exactly once per email ─────────────────────────────────

test('the compose body is emitted ONCE at the send transition, never per poll tick', async () => {
  // The single most important detail of the body path. The naive shape — emit
  // whatever the body holds on every ~1.2s tick — would produce roughly a
  // hundred near-duplicate records per email, each a growing prefix of the last
  // and each carrying its full text.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  // Anchored on the transition-2 sweep (which runs BEFORE $fgE is even read,
  // since it must fire on every tick regardless of what has the foreground —
  // the window is gone and can never become the foreground again), not on
  // $fgE itself, so this slice actually contains both send transitions.
  const arm = code.slice(code.indexOf('foreach ($k in @($EgressBody.Keys))'), code.indexOf('$fg = Get-ForegroundProc'));
  assert.ok(arm.length > 0, 'expected the egress arm in the poll loop');

  // While composing, the text is REMEMBERED and nothing is emitted.
  assert.match(arm, /\$EgressBody\[\$key\] = @\{/);
  const stillComposing = arm.slice(arm.indexOf('if ($text -and $text.Length -ge 2) {'), arm.indexOf('} elseif ($EgressBody.ContainsKey($key)) {'));
  assert.ok(stillComposing.length > 0, 'expected a still-composing branch');
  assert.equal(/Emit-EgressBody|Emit-Json/.test(stillComposing), false,
    'the still-composing branch must emit NOTHING — that is the once-per-email property');

  // There is exactly ONE emit site, and it deletes the slot, so "exactly once"
  // is structural rather than a rule two call sites have to remember.
  const emitter = code.slice(code.indexOf('function Emit-EgressBody'), code.indexOf('while ($true) {'));
  assert.ok(emitter.length > 0, 'expected an Emit-EgressBody body');
  assert.match(emitter, /\$script:EgressBody\.Remove\(\$key\)/);
  assert.ok(emitter.indexOf('.Remove($key)') < emitter.indexOf('Emit-Json'),
    'the slot must be dropped BEFORE the emit, so an exception cannot leave it emittable again');
  assert.equal((code.match(/kind\s*=\s*'egress_body'/g) || []).length, 1, 'exactly one egress_body emit site');
  // Called from the two send transitions and nowhere else: one definition, two
  // call sites.
  assert.equal((code.match(/Emit-EgressBody /g) || []).length, 2, 'one definition + two transitions');

  // TRANSITION 1 — the body went non-empty → empty. Exactly the signal tracker
  // mode already uses for a chat composer.
  assert.match(arm, /\} elseif \(\$EgressBody\.ContainsKey\(\$key\)\) \{\s*\r?\n[\s\S]{0,600}?Emit-EgressBody \$key/);
  // TRANSITION 2 — the compose window CLOSED while the body still held text. A
  // chat composer never needs this; an email is very often sent exactly this way,
  // and without it the record for every such send would simply never be emitted.
  assert.match(arm, /if \(\$h -ne \[System\.IntPtr\]::Zero -and \[CFAIE\.Win32\]::IsWindow\(\$h\)\) \{ continue \}/);

  // The cap is the EXISTING one, unchanged — not raised for email.
  assert.match(code, /\$MaxChars = 16000/);
  assert.match(arm, /if \(\$text -and \$text\.Length -gt \$MaxChars\) \{/);
  assert.match(arm, /\$truncated = \$true/);

  // The body is keyed on the COMPOSE WINDOW, not the process: several drafts can
  // be open at once, and one slot per process would lose all but one of them.
  assert.match(arm, /\$key = 'egress\|' \+ \$fgE\.hwnd\.ToString\(\)/);
});

test('the compose body is read only from an element matching bodySig, through the EXISTING matcher', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  const arm = code.slice(code.indexOf('foreach ($k in @($EgressBody.Keys))'), code.indexOf('$fg = Get-ForegroundProc'));

  // The gate is checked BEFORE any text is read — reading one character of an
  // unmatched element is already the leak.
  const matchIdx = arm.indexOf('$matchedId = Match-PanelSignature $base $ctName $nm $cls');
  const readIdx = arm.indexOf('$text = Read-FocusedText $focused');
  assert.ok(matchIdx >= 0 && readIdx >= 0, 'expected a signature match and a text read');
  assert.ok(matchIdx < readIdx, 'the signature must be matched BEFORE the body is read');
  // …and the match must be an EGRESS BODY, not an AI panel that shares the table.
  assert.match(arm, /if \(\$matchedId -and \$EgressBodyIds\.Contains\(\$matchedId\)\)/);
  // Match-PanelSignature is REUSED, not re-implemented: there is exactly one
  // definition of it in this file.
  assert.equal((code.match(/function Match-PanelSignature/g) || []).length, 1,
    'the panel matcher must not be duplicated for the egress path');
  // Read-FocusedText is reused too.
  assert.equal((code.match(/function Read-FocusedText/g) || []).length, 1);
  // The signatures reach the matcher as DATA, appended to $Panels — so no
  // signature literal appears in the .ps1, exactly as for the AI panels.
  assert.match(code, /\$panels \+= \[pscustomobject\]@\{/);
  assert.match(code, /\$PanelsAiOnly = @\(\$Panels\)/);
  // Rebuilt from a snapshot rather than appended to in place, so a reload cannot
  // accumulate duplicate or stale egress rows.
  assert.match(code, /\$panels = @\(\$script:PanelsAiOnly\)/);
  // A null bodySig — every entry as shipped — contributes no row at all, so the
  // arm can never match and never reads anything.
  assert.match(code, /if \(-not \$sig -or -not \$sig\.controlType\) \{ continue \}/);
  // captureBody must opt in.
  assert.match(code, /if \(\$captureBody -ne 'full'\) \{ continue \}/);
});

test('the egress body record carries recipient DOMAINS only — never an address, never a subject', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    // The helper is supposed to have reduced the recipient field already; this
    // side re-checks the SHAPE rather than trusting it, so a future helper
    // regression cannot put an address on a record.
    monitor.promptWatcher.emit('egress_body', {
      kind: 'egress_body', surface: SURFACE, process: OUTLOOK, pid: 99,
      text: SECRET_TEXT, len: SECRET_TEXT.length, truncated: false,
      recipient_domains: [
        '@gmail.com',                 // kept
        '@Sub.Example.CO.UK',         // kept, normalised
        'someone@gmail.com',          // REFUSED — a full address
        'Alex Morgan <a@b.com>',      // REFUSED — a display name
        'gmail.com',                  // REFUSED — no @
        '@',                          // REFUSED
        '',                           // REFUSED
      ],
    });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'egress_body'), { label: 'the egress_body record' });
    assert.deepEqual(ev.recipient_domains, ['@gmail.com', '@sub.example.co.uk']);
    // NOTHING resembling an address, on the record or in the log.
    const flat = JSON.stringify(ev);
    assert.equal(/someone@|a@b\.com|Alex Morgan/.test(flat), false, `an address survived onto the record: ${flat}`);
    for (const [, m] of calls.logs) {
      assert.equal(/someone@|a@b\.com|Alex Morgan/.test(m), false, `an address reached the log: ${m}`);
    }
    // NO window title — an Outlook title is the message subject plus, in a
    // reply, the recipient's display name. And no subject field of any kind.
    assert.equal(ev.window_title, '', 'windowTitle must be empty for every egress event');
    assert.equal('subject' in ev, false, 'there must be no subject field');
    // The record's own shape.
    assert.equal(ev.source, 'os_monitor_egress');
    assert.equal(ev.via, 'outlook_compose');
    assert.equal(ev.service, 'Microsoft Outlook');
    assert.equal(ev.body_truncated, false);
    assert.equal(ev.content_length, SECRET_TEXT.length);
    assert.equal(ev.content_text, SECRET_TEXT);
    assert.ok(ev.matches.length > 0, 'the existing scanner must have run');
    assert.equal(ev.highest_severity, 'critical');
  } finally { monitor.stop(); }
});

test('an ordinary email body is never recorded, and the truncation flag survives', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    // Only SENSITIVE bodies are recorded — the same policy every other capture
    // path here follows. An ordinary email is never stored.
    monitor.promptWatcher.emit('egress_body', {
      surface: SURFACE, process: OUTLOOK, text: 'Hi, please find the agenda attached. Thanks!', len: 43,
    });
    await settle(300);
    assert.deepEqual(calls.enqueued, [], 'a clean email body must not be recorded');
    assert.deepEqual(calls.toasts, []);

    monitor.promptWatcher.emit('egress_body', {
      surface: SURFACE, process: OUTLOOK, text: SECRET_TEXT, len: 16000, truncated: true, recipient_domains: [],
    });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'egress_body'), { label: 'a truncated record' });
    assert.equal(ev.body_truncated, true, 'a prefix must never be presented as the whole message');
    assert.deepEqual(ev.recipient_domains, []);
    // The toast says DETECTED, not blocked: the body capture fires at the send
    // transition, i.e. the message has already gone.
    const toast = calls.toasts.at(-1);
    assert.match(toast.message, /not blocked/i);
    assert.equal(/blocked:|held|stopped|prevented/i.test(toast.message.replace(/not blocked/i, '')), false,
      `the toast must not imply the send was stopped: ${toast.message}`);
  } finally { monitor.stop(); }
});

// ── 4. a download is never reported as an upload ────────────────────────────

test('a sync_down classified file is NEVER reported', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('came-down-from-cloud.env', SECRET_TEXT);
  try {
    // The helper already drops these, and this side refuses one too — reporting
    // a download as an upload would name this user as the person who
    // exfiltrated a file they never touched.
    monitor.syncWatcher.emit('sync_file', {
      root_id: 'onedrive_sharepoint', path: p, origin: 'sync_down', size: SECRET_TEXT.length,
    });
    await settle();
    assert.deepEqual(calls.enqueued, [], 'a sync_down file must not be reported');
    assert.deepEqual(calls.toasts, []);
    const leaked = calls.logs.filter(([, m]) => m.includes('came-down-from-cloud.env'));
    assert.deepEqual(leaked, [], 'a sync_down file must not even reach the log');
  } finally { monitor.stop(); }
});

test('sync-watcher.ps1 drops sync_down BEFORE it is ever emitted, on the placeholder bits', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'sync-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  // The three cloud-placeholder attribute bits, by value.
  assert.match(code, /\$FILE_ATTRIBUTE_OFFLINE\s+=\s+0x1000/);
  assert.match(code, /\$FILE_ATTRIBUTE_RECALL_ON_OPEN\s+=\s+0x00040000/);
  assert.match(code, /\$FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS\s+=\s+0x00400000/);
  // Read at FIRST SIGHT, before anything of ours opens the file — opening a
  // placeholder is what makes Windows hydrate it and clear the very bits being
  // tested.
  const note = code.slice(code.indexOf('function Note-Change'), code.indexOf('function Test-EmitBudget'));
  assert.match(note, /\$attrs = Get-RawAttributes \$path/);
  assert.match(note, /FirstAttrs = \$attrs/);
  // GetAttributes, never an open/read — that would trigger hydration and pull
  // the bytes down on the user's behalf.
  assert.match(code, /\[System\.IO\.File\]::GetAttributes\(\$path\)/);
  assert.equal(/\[System\.IO\.File\]::Open|Get-Content -LiteralPath \$path/.test(code), false,
    'the watcher must never open a watched file — that hydrates a placeholder');
  // The classification, and the drop.
  const origin = code.slice(code.indexOf('function Get-FileOrigin'), code.indexOf('$Pending = @{}'));
  assert.match(origin, /if \(\$null -ne \$first -and \(\$first -band \$CLOUD_BITS\) -ne 0\) \{ return 'sync_down' \}/);
  assert.match(code, /if \(\$origin -eq 'sync_down'\) \{ continue \}/);
  // The drop is BEFORE the emit and before the file is added to the reported set.
  const sweep = code.slice(code.indexOf('function Sweep-Pending'), code.indexOf('$Watchers = @()'));
  assert.ok(sweep.indexOf("if ($origin -eq 'sync_down') { continue }") < sweep.indexOf("kind    = 'sync_file'"),
    'sync_down must be dropped before the emit');
  // A zero-byte file is never scanned.
  assert.match(sweep, /if \(\$size -le 0\) \{ continue \}/);
});

test('OneDrive detection is OBSERVE/REPORT ONLY — no move, rename, quarantine or delete anywhere', async () => {
  // A CONFIRMED PRODUCT DECISION, asserted rather than trusted to review: a
  // governance agent that silently relocates a user's files is a data-loss
  // incident waiting to happen, and the blast radius in a synced folder is the
  // user's whole document set.
  for (const file of ['sync-watcher.ps1', 'sync-watcher.js']) {
    const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    const code = src.split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    for (const forbidden of [
      'Move-Item', 'Remove-Item', 'Rename-Item', 'Copy-Item', 'Set-Acl', 'Set-Content', 'Out-File',
      'File.Move', 'File.Delete', 'File.Copy', 'Directory.Move',
      'quarantine', 'Quarantine',
      'unlinkSync', 'renameSync', 'rmSync', 'writeFileSync', 'copyFileSync',
    ]) {
      assert.equal(code.includes(forbidden), false, `${file} must not contain ${forbidden} — this path is read-only`);
    }
  }
  // The toast copy must not imply an intervention either.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('onedrive-secrets.env', SECRET_TEXT);
  try {
    monitor.syncWatcher.emit('sync_file', {
      root_id: 'onedrive_sharepoint', path: p, origin: 'local_new', size: SECRET_TEXT.length,
    });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the sync file record' });
    assert.equal(ev.via, 'cloud_sync_root');
    assert.equal(ev.origin, 'local_new', 'the origin must travel onto the record');
    assert.equal(ev.egress_surface, 'onedrive_sharepoint');
    assert.equal(ev.window_title, '');
    assert.equal(ev.service, 'OneDrive / SharePoint');
    // NO HOLD. There is nothing to hold — the file is already in a folder that
    // uploads itself — and this feature explicitly does not move it.
    assert.deepEqual(calls.attachHold, [], 'a sync-root detection must never arm a send hold');
    const toast = await waitFor(() => calls.toasts.at(-1), { label: 'the sync toast' });
    assert.match(toast.title, /detected/i);
    assert.match(toast.message, /DETECTED AND REPORTED only/);
    assert.match(toast.message, /nothing was blocked, moved or removed/);
    // It must not claim a block, and it must be honest that the file may already
    // be gone.
    assert.equal(/\bheld\b|\bquarantined\b|\bstopped\b|\bprevented\b/i.test(toast.message), false,
      `the sync toast must not imply an intervention: ${toast.message}`);
    assert.match(toast.message, /may already have synced/);
  } finally { monitor.stop(); }
});

test('an overflow is reported as a coverage gap rather than silently dropped', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    monitor.syncWatcher.emit('overflow', { root_id: 'onedrive_sharepoint', reason: 'fsw_buffer' });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'coverage_gap'), { label: 'a coverage_gap record' });
    assert.equal(ev.via, 'cloud_sync_root');
    assert.equal(ev.reason, 'fsw_buffer');
    assert.equal(ev.source, 'os_monitor_egress');
  } finally { monitor.stop(); }
  // The helper emits it as a visible line rather than swallowing the drop.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'sync-watcher.ps1'), 'utf8');
  assert.match(src, /kind = 'overflow'; root_id = \$RootId; reason = 'fsw_buffer'/);
  assert.match(src, /Register-ObjectEvent -InputObject \$fsw -EventName Error/);
  // …and the per-minute ceiling emits one too, rather than dropping quietly.
  assert.match(src, /reason = 'emit_rate_limit'/);
});

// ── 5. FAIL OPEN on a mail client ───────────────────────────────────────────

test('an unverified / unscannable attachment is REPORTED but never HELD', async () => {
  // FAIL OPEN, achieved by OMISSION: #reportEgressFile has no `unverified` term
  // at all. The host-app fail-CLOSED rule is scoped to `inGovernedConversation`
  // (`!!governed || hostChip`), and an egress surface satisfies neither — it is
  // not a host app and no govstate ever names it.
  //
  // Escalating on "we could not read it" in a mail client would mean nobody can
  // email a legacy .doc or a password-protected archive, which nobody asked for.
  const { monitor, calls } = makeMonitor();
  // A .docx that is not a real docx — the extractor fails, so content_scan comes
  // back scanned:false with unverified:true (isDocumentLikeFormat is true for
  // .docx). This is exactly the shape that DOES trigger a hold inside a governed
  // Teams conversation.
  const p = await tmp('corrupt-contract.docx', 'not really a docx at all');
  try {
    monitor.attachmentWatcher.emit('egress_attachment_appeared', {
      surface: SURFACE, process: OUTLOOK, pid: 42, filename: 'corrupt-contract.docx', path: p,
    });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the attachment record' });
    assert.equal(ev.via, 'email_attachment_chip');
    assert.equal(ev.content_scan.scanned, false, 'the file really is unscannable');
    assert.equal(ev.content_scan.unverified, true, 'and it really is the fail-closed shape elsewhere');
    // REPORTED — the record exists.
    assert.ok(ev.filename === 'corrupt-contract.docx');
    // …but NOT HELD. The provisional hold armed before the scan is released, and
    // no confirmed hold is ever armed.
    await waitFor(() => calls.attachHold.some((c) => c.state === 'off'), { label: 'the provisional hold release' });
    const confirmed = calls.attachHold.filter((c) => c.state === 'on' && c.patterns);
    assert.deepEqual(confirmed, [], 'an unverifiable email attachment must never be HELD');
  } finally { monitor.stop(); }
  // Stated at the source too, so the omission cannot be re-added by accident.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async #reportEgressFile('), src.indexOf('#hostGovernedFor(processName)'));
  assert.ok(fn.length > 0, 'expected a #reportEgressFile body');
  const code = fn.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const forbidden of ['unverified', 'failClosed', 'inGovernedConversation', 'hostChip']) {
    assert.equal(code.includes(forbidden), false,
      `#reportEgressFile must not gain a ${forbidden} term — fail-open is the rule for a mail client`);
  }
  // …and the existing host-app rule is untouched: still scoped to a governed
  // conversation, which an egress surface can never be.
  assert.match(src, /const inGovernedConversation = !!governed \|\| hostChip;/);
  assert.match(src, /const failClosed = inGovernedConversation && unverified;/);
});

test('a FLAGGED email attachment is scanned, HELD, and toasted with the real limitations', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('payroll-secrets.env', SECRET_TEXT);
  try {
    monitor.dialogWatcher.emit('egress_file_dialog_pick', {
      surface: SURFACE, process: OUTLOOK, pid: 42, title: 'Attach File', path: p,
    });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the attach-dialog record' });
    assert.equal(ev.via, 'email_attach_dialog');
    assert.equal(ev.severity, 'critical');
    assert.equal(ev.window_title, '', 'never a mail window title — that is the subject line');
    // HELD, bound to the mail process so the hold cannot swallow a keystroke in
    // some other app the user alt-tabs to.
    const held = await waitFor(
      () => calls.attachHold.find((c) => c.state === 'on' && c.patterns),
      { label: 'a confirmed hold' },
    );
    assert.equal(held.process, OUTLOOK);
    assert.match(held.filename, /payroll-secrets\.env/);
    assert.ok(held.ttlMs >= 60_000, 'a real finding must outlive the provisional TTL');
    // THE TOAST. Both caveats have to be there, because both are true and the
    // copy rules in this repo forbid claiming a block that is narrower than it
    // sounds.
    const toast = await waitFor(() => calls.toasts.find((t) => /attachment/i.test(t.title)), { label: 'the attachment toast' });
    assert.match(toast.message, /mouse/i, 'the toast must say the mouse Send click is not covered');
    assert.match(toast.message, /NOT covered/);
    assert.match(toast.message, /setting some users have switched off/,
      'the toast must say Ctrl+Enter-to-send is a user preference');
    assert.match(toast.message, /remove the attachment/i, 'the only reliable remedy');
  } finally { monitor.stop(); }
});

test('capture_mode "observe" (or missing) NEVER claims a hold — the enforcer will not arm one', async () => {
  // The bug this guards against: `hold` on #reportEgressFile means "this is the
  // mail route, capable of holding" — it is NOT the policy answer. Only
  // capture_mode:'hold' is (captureModeFor in ai-processes.js is the one place
  // that decides which surfaces ever reach the enforcer's _egressHoldProcs). A
  // toast that says "Ctrl+Enter and Alt+S are held" while the surface is
  // actually 'observe' or 'block_critical' would tell an admin a control exists
  // that the enforcer never armed.
  let n = 0;
  for (const mode of [{}, { [SURFACE]: 'observe' }, { [SURFACE]: 'block_critical' }]) {
    n += 1;
    const { monitor, calls } = makeMonitor({ egressCaptureMode: mode });
    const p = await tmp(`observe-mode-${n}.env`, SECRET_TEXT);
    try {
      monitor.dialogWatcher.emit('egress_file_dialog_pick', {
        surface: SURFACE, process: OUTLOOK, pid: 42, title: 'Attach File', path: p,
      });
      const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the attach-dialog record' });
      assert.equal(ev.severity, 'critical', 'the file is still scanned and reported');
      // NO hold, confirmed or provisional — arming one would still send
      // attach_hold to the shared helper slot even though nothing will swallow
      // the chord, which is the exact interference the shared-slot design must
      // not invite needlessly.
      await settle(300);
      assert.deepEqual(calls.attachHold, [], `capture_mode=${JSON.stringify(mode)} must never arm a hold`);
      const toast = await waitFor(() => calls.toasts.find((t) => /attachment/i.test(t.title)), { label: 'the attachment toast' });
      assert.match(toast.message, /DETECTED AND REPORTED only/);
      assert.match(toast.message, /was not held/i, 'the toast must say plainly that nothing was held');
      assert.equal(/are held|is held|\bswallow/i.test(toast.message), false,
        `capture_mode=${JSON.stringify(mode)} must not claim a hold: ${toast.message}`);
    } finally { monitor.stop(); }
  }
});

test('removing one email attachment does not release the hold another still needs', async () => {
  const { monitor, calls } = makeMonitor();
  const flagged = await tmp('flagged.env', SECRET_TEXT);
  const clean = await tmp('clean.txt', 'nothing sensitive in here at all');
  try {
    monitor.attachmentWatcher.emit('egress_attachment_appeared', { surface: SURFACE, process: OUTLOOK, filename: 'flagged.env', path: flagged });
    await waitFor(() => calls.attachHold.some((c) => c.state === 'on' && c.patterns), { label: 'the flagged hold' });
    monitor.attachmentWatcher.emit('egress_attachment_appeared', { surface: SURFACE, process: OUTLOOK, filename: 'clean.txt', path: clean });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both records' });
    calls.attachHold.length = 0;
    // The CLEAN file is removed. The flagged one is still attached.
    monitor.attachmentWatcher.emit('egress_attachment_disappeared', { surface: SURFACE, process: OUTLOOK, filename: 'clean.txt' });
    await settle(200);
    assert.equal(calls.attachHold.some((c) => c.state === 'off'), false,
      'removing a clean attachment must not release the hold a sensitive one needs');
    assert.equal(monitor.attachHolds.has('flagged.env'), true);
    // …and removing the flagged one does release it.
    monitor.attachmentWatcher.emit('egress_attachment_disappeared', { surface: SURFACE, process: OUTLOOK, filename: 'flagged.env' });
    await waitFor(() => calls.attachHold.some((c) => c.state === 'off'), { label: 'the release' });
    assert.equal(monitor.attachHolds.size, 0);
  } finally { monitor.stop(); }
});

test('an egress send-chord block reports honestly and offers no override or access request', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    monitor.enforcer.emit('egressblock', {
      kind: 'egress_block', reason: 'attachment', process: OUTLOOK, surface: SURFACE,
      patterns: 'aws-access-key', filename: 'payroll-secrets.env',
    });
    const ev = await waitFor(() => calls.enqueued.find((e) => e.kind === 'enforcement_block'), { label: 'the block record' });
    assert.equal(ev.blocked_for, 'file_upload');
    assert.equal(ev.mechanism, 'attachment_hold');
    assert.equal(ev.blocked_by, 'egress_send_chord');
    assert.equal(ev.source, 'os_monitor_egress');
    assert.equal(ev.service, 'Microsoft Outlook');
    assert.deepEqual(ev.matches, [{ pattern: 'aws-access-key', severity: 'high', count: 1 }]);
    // NO window title, no recipient, no body on the record.
    assert.equal('window_title' in ev, false);
    const toast = await waitFor(() => calls.toasts.at(-1), { label: 'the block toast' });
    // Every clause of the honest framing.
    assert.match(toast.message, /NOT covered/, 'the mouse Send click is not covered');
    assert.match(toast.message, /setting some users have switched off/);
    assert.match(toast.message, /remove the attachment/i);
    assert.match(toast.message, /only stops the message being sent/, 'the draft may already be autosaved');
    // No override affordance is advertised, because none exists — "send this
    // attachment anyway" is not a coherent thing to offer.
    assert.equal(/Ctrl\+Alt\+Enter|override/i.test(toast.message), false,
      `an egress hold must not advertise an override: ${toast.message}`);
    assert.equal(/Request Access|ask for temporary access/i.test(toast.message), false,
      'an egress block is not "the org disallowed this app"');
  } finally { monitor.stop(); }
});

// ── the sync watcher's own policy gate ──────────────────────────────────────

test('SyncWatcher spawns NOTHING without an armed policy, even on Windows', () => {
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const w = new SyncWatcher({ log, armedRoots: [] });
  w.start();
  assert.equal(w.child, null, 'no helper may be spawned without a governed cloud-sync policy');
  assert.ok(logs.some((m) => /no governed cloud-sync policy/.test(m)),
    'the refusal must be visible in the log rather than silent');
  w.stop();
});

test('SyncWatcher stops immediately when the policy is withdrawn', () => {
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const w = new SyncWatcher({ log, armedRoots: [{ id: 'onedrive_sharepoint' }] });
  // No spawn is attempted here (no real child is wanted in a test), only the
  // policy transition — which is the thing that must be immediate: while a
  // policy is withdrawn, continuing to watch someone's Documents folder is
  // observation with no governance behind it.
  assert.equal(w.setArmedRoots([]), true, 'withdrawing the policy is a change');
  assert.equal(w.child, null);
  assert.ok(logs.some((m) => /policy withdrawn/.test(m)));
  // An unchanged policy is a NO-OP: tearing down a healthy FileSystemWatcher
  // every 10s poll would open a real gap for no reason.
  const w2 = new SyncWatcher({ log, armedRoots: [{ id: 'onedrive_sharepoint' }] });
  assert.equal(w2.setArmedRoots([{ id: 'onedrive_sharepoint' }]), false, 'an unchanged policy must not restart');
  w.stop(); w2.stop();
});

test('index.js arms the sync watcher only from a VERIFIED and ENFORCING policy row', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('#syncEgressPolicy()'), src.indexOf('// ── The shared reporting tail'));
  assert.ok(fn.length > 0, 'expected a #syncEgressPolicy body');
  // Both flags, both strictly true — the same two-flag gate every other surface
  // in this product is behind. As shipped both are false, so no filesystem
  // observation happens at all.
  assert.match(fn, /r\.verified === true && r\.enforce === true/);
  // A missing or unreadable file means NO POLICY here, which is the opposite of
  // the sync layer's convention for the same file — and deliberately so.
  assert.match(fn, /roots = \[\];/);
  assert.match(fn, /catch \(err\) \{/);
  // Only a real change touches the watcher.
  assert.match(fn, /if \(!changed\) return;/);

  // The catalogs as shipped: nothing arms.
  for (const root of EGRESS_SYNC_ROOTS) {
    assert.equal(root.verified, false, `${root.id} claims a live probe — update this test with the evidence`);
  }
  const payload = synthesizeEgressSurfaces([{ host: 'onedrive.live.com', governed: true, capture_mode: 'hold' }], null);
  const armed = payload.sync_roots.filter((r) => r.verified === true && r.enforce === true);
  assert.deepEqual(armed, [], 'even a governed policy row must arm nothing until a live pass');
});

test('discoverSyncRoots reuses paths.js and never invents a folder', async () => {
  // It must not create a directory, and it must go through the existing
  // OneDrive resolution rather than re-deriving it — that function already
  // handles the three env vars a real install can present and already knows
  // that Known Folder Move puts Desktop/Documents under the OneDrive root.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'sync-watcher.js'), 'utf8');
  assert.match(src, /import \{ getUserPaths \} from '\.\.\/util\/paths\.js';/);
  assert.match(src, /paths\?\.oneDriveRoot/);
  assert.equal(/mkdir|mkdirSync/.test(src), false, 'this path must never create a directory');
  // Non-Windows answers with nothing at all.
  assert.deepEqual(discoverSyncRoots('darwin'), []);
  assert.deepEqual(discoverSyncRoots('linux'), []);
  // On this machine the answer is whatever really exists — never a path that
  // does not.
  const roots = discoverSyncRoots();
  assert.ok(Array.isArray(roots));
  const { existsSync } = await import('node:fs');
  for (const r of roots) assert.equal(existsSync(r), true, `${r} does not exist`);
});

test('sync-watcher.ps1 filters churn cheapest-first and single-sources the extension gate', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'sync-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');

  // Every name pattern the design calls for.
  for (const pattern of ['~$*', '*.tmp', '*.partial', '*.crdownload', '*.laccdb', '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.lnk']) {
    assert.ok(code.includes(`'${pattern}'`), `the churn name filter is missing ${pattern}`);
  }
  for (const part of ['\\.git\\', '\\node_modules\\', '\\AppData\\']) {
    assert.ok(code.includes(`'${part}'`), `the churn path filter is missing ${part}`);
  }
  // Attribute filter: directories, hidden, system and temporary all skipped.
  assert.match(code, /\$SKIP_BITS = \$FILE_ATTRIBUTE_DIRECTORY -bor \$FILE_ATTRIBUTE_HIDDEN -bor \$FILE_ATTRIBUTE_SYSTEM -bor \$FILE_ATTRIBUTE_TEMPORARY/);
  assert.match(code, /if \(\(\$attrs -band \$SKIP_BITS\) -ne 0\) \{ return \}/);

  // Ordered cheapest-first: name, then path, then the extension gate, then the
  // attribute read (a syscall), and only then the 1.5s settle window.
  const note = code.slice(code.indexOf('function Note-Change'), code.indexOf('function Test-EmitBudget'));
  const order = ['Test-ChurnName', 'Test-ChurnPath', '$script:ExtGate', 'Get-RawAttributes'];
  let last = -1;
  for (const step of order) {
    const at = note.indexOf(step);
    assert.ok(at > last, `${step} must come after ${order[order.indexOf(step) - 1] || 'the start'}`);
    last = at;
  }

  // THE EXTENSION GATE IS SINGLE-SOURCED. The list of extensions worth reading
  // is written down exactly once in this repo, as $FilenameRegex in
  // attachment-watcher.ps1, and a second copy here would drift — silently, in
  // the direction of this watcher stopping coverage of a format the rest of the
  // product still handles.
  assert.match(code, /Join-Path \$PSScriptRoot 'attachment-watcher\.ps1'/);
  assert.match(code, /\$FilenameRegex\\s\*=\\s\*'\(\?<rx>\.\+\)'/);
  assert.equal(code.includes('env|csv|tsv|xlsx'), false,
    'the extension list must NOT be duplicated here — it is extracted from attachment-watcher.ps1');
  // FAIL CLOSED when the extraction fails: nothing passes the gate, so nothing
  // is reported, and the ready line makes that state visible.
  assert.match(code, /if \(-not \$script:ExtGate\) \{ return \}/);
  assert.match(code, /ext_gate = \[bool\]\$ExtGate/);

  // The settle window and the rate limit, by value.
  assert.match(code, /\$SETTLE_MS = 1500/);
  assert.match(code, /\$EMIT_PER_MINUTE = 20/);
  assert.match(code, /if \(\(\$now - \$entry\.LastChangeAt\)\.TotalMilliseconds -lt \$SETTLE_MS\) \{ continue \}/);

  // NOTHING is watched when there are no roots — no handle, no subscription.
  assert.match(code, /foreach \(\$root in \$Roots\) \{/);
  assert.ok(code.indexOf('$Watchers = @()') < code.indexOf('foreach ($root in $Roots) {'));
  // …and the roots themselves come from the env the policy-gated wrapper set.
  assert.match(code, /if \(\$env:CFAI_SYNC_ROOTS\) \{/);
});

// ── the .ps1 helpers are reapable and staged ────────────────────────────────

test('sync-watcher.ps1 is reapable as an orphan and staged into the packaged binary', async () => {
  const { HELPER_SCRIPTS, HELPER_SCRIPT_PATTERN } = await import('../src/os_monitor/reap-orphans.js');
  // An orphan holds live FileSystemWatcher subscriptions on the user's OneDrive
  // folders with nobody left to consume its output — observation with no
  // governance behind it, i.e. exactly the state the policy gate exists to
  // prevent.
  assert.ok(HELPER_SCRIPTS.includes('sync-watcher.ps1'));
  assert.equal(new RegExp(HELPER_SCRIPT_PATTERN).test('powershell -File C:\\x\\sync-watcher.ps1'), true);
  // Staged beside the binary. It also reads attachment-watcher.ps1 out of
  // $PSScriptRoot for its extension gate, so a build that shipped one without
  // the other would leave it reporting nothing, silently.
  const build = await readFile(join(AGENT_DIR, 'scripts', 'build-claude-tracker.mjs'), 'utf8');
  const list = build.slice(build.indexOf('const PS1_HELPERS = ['), build.indexOf('];', build.indexOf('const PS1_HELPERS = [')));
  assert.ok(list.includes("'sync-watcher.ps1'"));
  assert.ok(list.includes("'attachment-watcher.ps1'"), 'both must be staged together');
});
