// Behavioural tests for FILE governance inside a HOST APP (Microsoft Teams),
// and for the attachment-hold hardening the feature is built on.
//
// NOTHING HERE SPAWNS A HELPER on the OsMonitor paths. The monitor is
// constructed for real and start() is called for real — so the handler wiring,
// the guards and their ORDER are production code — but every child-process owner
// (the poller, the enforcer, the three watchers) is replaced with a recording
// stub first, so no PowerShell runs, no keyboard hook is installed and no UIA
// tree is read. The two watcher tests at the bottom DO spawn their real helper,
// deliberately: the host_arm stdin channel and the respawn re-arm cannot be
// tested any other way, and both are the exact failure modes that would leave a
// governed conversation silently uncovered.
//
// ── What this exists to catch ────────────────────────────────────────────────
// Three properties, in descending order of how bad getting them wrong is:
//
//   1. A file attached in an UNGOVERNED Teams conversation — a 1:1 DM, a
//      channel, a meeting chat — must never be read, scanned, held or reported.
//      Teams is a general-purpose chat client; this is the whole reason the
//      host-app design exists, and every other property is subordinate to it.
//   2. A file attached in a GOVERNED or BLOCKED agent conversation must go
//      through the identical pipeline a Copilot file event does, including a
//      send hold when it is sensitive AND when it could not be verified.
//   3. The hold itself must be per-file and bound to one app, because the two
//      defects it used to have both ended with a sensitive file being sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

const { OsMonitor } = await import('../src/os_monitor/index.js');
const { AttachmentWatcher } = await import('../src/os_monitor/attachment-watcher.js');
const { FileDialogWatcher } = await import('../src/os_monitor/file-dialog-watcher.js');

const win = process.platform === 'win32';

// ── fixtures ────────────────────────────────────────────────────────────────

let dir = null;
async function tmp(name, contents) {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'cfai-hostfiles-'));
  const p = join(dir, name);
  await writeFile(p, contents);
  return p;
}
test.after?.(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

// A file the pattern catalog really flags. AWS key ids and secret keys are in
// the shipped catalog, so this scans CRITICAL through the ordinary utf8 path.
const SECRET_TEXT = [
  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
].join('\n');

// ── the monitor, with every child-process owner stubbed ─────────────────────

function makeMonitor({ enforcerEnabled = false } = {}) {
  const calls = { attachHold: [], hostArm: [], enqueued: [], toasts: [], logs: [] };
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
  monitor.attachmentWatcher = emitterStub({
    hostArm(proc, on, key) { calls.hostArm.push({ watcher: 'attachment', proc, on, key }); return true; },
  });
  monitor.dialogWatcher = emitterStub({
    hostArm(proc, on, key) { calls.hostArm.push({ watcher: 'dialog', proc, on, key }); return true; },
  });
  monitor.reporter = { start() {}, stop() {}, enqueue(e) { calls.enqueued.push(e); } };
  monitor.toast = { start() {}, stop() {}, show(t) { calls.toasts.push(t); } };
  monitor.policySync = { start() {}, stop() {} };
  monitor.featureSync = { start() {}, stop() {} };

  monitor.start();
  return { monitor, calls };
}

// The handlers are async and registered with .on(), so there is no promise to
// await. Poll for the observable outcome instead — generously, because a real
// extraction (mammoth's first import, a zip walk) genuinely takes a moment.
async function waitFor(fn, { timeout = 20_000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
// "Nothing happened" needs a settling period rather than a poll: there is no
// event to wait for, and returning too early would pass for the wrong reason.
async function settle(ms = 700) { await new Promise((r) => setTimeout(r, ms)); }

// govstate, exactly as the enforcer emits it.
function govOn(monitor, { agent = 'IT Help Desk Agent', agentId = 'agent-ithelp', scope = 'agent', panel = 'teams_composer', pid = 13472 } = {}) {
  monitor.enforcer.emit('govstate', {
    kind: 'govstate', active: true, process: 'ms-teams', pid, scope, panel, agent, agent_id: agentId,
  });
}
function govOff(monitor) {
  monitor.enforcer.emit('govstate', {
    kind: 'govstate', active: false, process: '', pid: 0, scope: '', panel: '', agent: '', agent_id: '',
  });
}

// ── 1. THE PROTECTION: an ungoverned Teams conversation is never touched ────

test('an UNGOVERNED Teams conversation: no file route reads, scans, holds or reports anything', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('ungoverned-secrets.env', SECRET_TEXT);
  try {
    // All three routes, with no govstate ever emitted — the state Teams is in
    // for a DM, a channel, a meeting chat and every other ordinary use.
    monitor.poller.emit('clipboard_files', { process: 'ms-teams', title: 'Chat | Sruthi | Microsoft Teams', paths: [p] });
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ms-teams', filename: 'ungoverned-secrets.env', path: p });
    monitor.dialogWatcher.emit('file_dialog_pick', { process: 'ms-teams', title: 'Open', path: p });
    // …and the picker route with the helper's latch explicitly false, which is
    // what it reports for a dialog first seen while Teams was not armed.
    monitor.dialogWatcher.emit('file_dialog_pick', { process: 'ms-teams', title: 'Open', path: p, host_armed: false });
    await settle();

    assert.deepEqual(calls.enqueued, [], 'nothing may be reported for an ungoverned Teams conversation');
    assert.deepEqual(calls.attachHold, [], 'no send hold may be armed');
    assert.deepEqual(calls.toasts, [], 'no toast may fire');
    // The strongest statement available here: the file was never even read, so
    // its bytes never entered this process. buildFileUploadEvent is what reads
    // it, and it is what puts content_base64/content_text on an event.
    const leaked = calls.logs.filter(([, m]) => m.includes('ungoverned-secrets.env'));
    assert.deepEqual(leaked, [], `the filename must not even reach the log: ${JSON.stringify(leaked)}`);
  } finally { monitor.stop(); }
});

test('the clipboard TEXT route stays excluded for Teams even while a conversation IS governed', async () => {
  // Deliberate asymmetry, and the reason it is deliberate: prompt text inside a
  // governed Teams conversation is already captured narrowly, at the element
  // level, by enforcer-win.ps1. This handler would report the WHOLE clipboard
  // plus the window title off nothing more than "Teams is focused", which is the
  // capture the host-app design exists to prevent. Files are different — nothing
  // else can see them.
  const { monitor, calls } = makeMonitor();
  try {
    govOn(monitor);
    monitor.poller.emit('clipboard', {
      process: 'ms-teams',
      title: 'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams',
      text: SECRET_TEXT,
      len: SECRET_TEXT.length,
      cause: 'seq_change',
    });
    await settle(300);
    assert.deepEqual(calls.enqueued, [], 'clipboard TEXT must stay excluded for a host app');
  } finally { monitor.stop(); }
});

// ── 2. govstate arms and disarms the watchers ───────────────────────────────

test('govstate arms BOTH UIA watchers for the process, and disarms them on the way out', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    assert.equal(monitor.hostGoverned, null, 'nothing is governed before the first govstate');
    govOn(monitor);
    assert.deepEqual(monitor.hostGoverned, {
      process: 'ms-teams', pid: 13472, agent: 'IT Help Desk Agent',
      agent_id: 'agent-ithelp', scope: 'agent', panel: 'teams_composer',
    });
    assert.equal(calls.hostArm.length, 2);
    assert.deepEqual(calls.hostArm.map((c) => [c.watcher, c.proc, c.on]), [
      ['attachment', 'ms-teams', true],
      ['dialog', 'ms-teams', true],
    ]);
    // Both watchers get the SAME opaque conversation key, and it is a digest —
    // never the agent name. See hostArmKey().
    assert.match(calls.hostArm[0].key, /^[0-9a-f]{16}$/);
    assert.equal(calls.hostArm[0].key, calls.hostArm[1].key);

    calls.hostArm.length = 0;
    govOff(monitor);
    assert.equal(monitor.hostGoverned, null);
    assert.deepEqual(calls.hostArm.map((c) => [c.watcher, c.proc, c.on]), [
      ['attachment', 'ms-teams', false],
      ['dialog', 'ms-teams', false],
    ]);
  } finally { monitor.stop(); }
});

test('govstate never reports to the server and never logs the agent name', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    govOn(monitor, { agent: 'Payroll Assistant', agentId: 'agent-payroll' });
    govOff(monitor);
    assert.deepEqual(calls.enqueued, [], '"a governed conversation is open" is not an enforcement event');
    // A log line per Teams conversation switch, naming the agent, would write
    // the user's agent-usage timeline into the agent's own log file.
    for (const [, m] of calls.logs) {
      assert.equal(m.includes('Payroll Assistant'), false, `the agent name must not be logged: ${m}`);
      assert.equal(m.includes('agent-payroll'), false, `nor its id: ${m}`);
    }
    // The process and the scope are fine, and are what makes the line useful.
    assert.ok(calls.logs.some(([, m]) => m.includes('host file capture ARMED') && m.includes('ms-teams')));
    assert.ok(calls.logs.some(([, m]) => m.includes('host file capture disarmed')));
  } finally { monitor.stop(); }
});

// ── 3. a governed conversation gets the full pipeline ───────────────────────

test('a sensitive file attached in a GOVERNED Chat-list conversation is scanned, HELD and reported', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('governed-secrets.env', SECRET_TEXT);
  try {
    govOn(monitor);
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'governed-secrets.env', path: p,
    });

    // PROVISIONAL hold first, before the scan can possibly have finished.
    await waitFor(() => calls.attachHold.length >= 1, { label: 'the provisional hold' });
    assert.equal(calls.attachHold[0].state, 'on');
    assert.equal(calls.attachHold[0].patterns, '', 'the provisional hold knows no patterns yet');
    assert.equal(calls.attachHold[0].ttlMs, 3000);
    assert.equal(calls.attachHold[0].process, 'ms-teams', 'the hold must be bound to the app');

    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.kind, 'file_upload');
    assert.equal(ev.via, 'drag_drop_or_chip');
    assert.equal(ev.severity, 'critical');
    assert.equal(ev.content_scan.scanned, true);
    assert.ok(ev.content_scan.matchCount > 0);
    // DECISION #2: full content IS forwarded for a host app, exactly as for any
    // other app. No host-app-specific stripping.
    assert.equal(ev.content_text, SECRET_TEXT);
    // …and the record says WHICH conversation, from the admin-typed row values.
    assert.equal(ev.agent_name, 'IT Help Desk Agent');
    assert.equal(ev.agent_id, 'agent-ithelp');
    assert.equal(ev.agent_scope, 'agent');
    // NO WINDOW TITLE for a host app — a Teams title carries a colleague's name
    // and two email addresses.
    assert.equal(ev.window_title, '');

    // CONFIRMED hold, with the pattern names and the long TTL.
    const confirmed = await waitFor(
      () => calls.attachHold.find((c) => c.state === 'on' && c.ttlMs === 60_000),
      { label: 'the confirmed hold' },
    );
    assert.ok(confirmed.patterns.length > 0);
    assert.equal(confirmed.filename, 'governed-secrets.env');
    assert.equal(confirmed.process, 'ms-teams');
    assert.equal(monitor.attachHolds.size, 1);
  } finally { monitor.stop(); }
});

test('a file attached in the COPILOT TAB with NO named agent is still scanned and held', async () => {
  // DECISION #1: the Copilot tab is governed by panel match alone, so a
  // conversation with the generic unnamed assistant is covered too. The event
  // then carries no agent name — which is honest, not a gap.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('copilot-tab-secrets.env', SECRET_TEXT);
  try {
    govOn(monitor, { agent: '', agentId: '', scope: 'panel', panel: 'teams_copilot_composer' });
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'copilot-tab-secrets.env', path: p,
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.severity, 'critical');
    assert.equal(ev.agent_name, '');
    assert.equal(ev.agent_scope, 'panel');
    await waitFor(() => calls.attachHold.some((c) => c.state === 'on' && c.ttlMs === 60_000),
      { label: 'the confirmed hold' });
  } finally { monitor.stop(); }
});

test('a file picked through the FILE DIALOG is reported using the latch the helper captured at open time', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('picked.csv', 'name,ssn\nAlice,123-45-6789\n');
  try {
    govOn(monitor);
    // A picker steals focus from Teams, so in real life govstate has usually
    // already gone false by the time the dialog closes. host_armed is the
    // helper's answer from when the dialog OPENED, and it is what decides.
    govOff(monitor);
    monitor.dialogWatcher.emit('file_dialog_pick', {
      process: 'ms-teams', title: 'Open', path: p, host_armed: true,
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported pick' });
    assert.equal(ev.via, 'open_file_dialog');
    assert.equal(ev.window_title, '', 'no Teams window title may travel');
    assert.equal(ev.content_scan.scanned, true);
    // The conversation is no longer known by the time the dialog closed, so the
    // record omits the agent rather than guessing one.
    assert.equal(ev.agent_name, undefined);
  } finally { monitor.stop(); }
});

test('a FILE PASTED into a governed conversation goes through the same pipeline', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('pasted-secrets.env', SECRET_TEXT);
  try {
    govOn(monitor);
    monitor.poller.emit('clipboard_files', {
      process: 'ms-teams',
      title: 'Chat | IT Help Desk Agent | filefuze | erik@filefuze.co | Microsoft Teams',
      paths: [p],
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported paste' });
    assert.equal(ev.via, 'clipboard_file_copy');
    assert.equal(ev.agent_name, 'IT Help Desk Agent');
    assert.equal(ev.window_title, '', 'the Teams window title must never travel');
    assert.equal(ev.content_text, SECRET_TEXT, 'full content, same as every other app');
  } finally { monitor.stop(); }
});

// ── 4. DECISION #3: fail closed on a file we could not verify ──────────────

test('FAIL CLOSED: an unopenable archive in a governed conversation is HELD even though nothing was scanned', async () => {
  const { monitor, calls } = makeMonitor();
  // .7z has no extractor here at all, so there is no scan result and no
  // contentSeverity — the file classifies as `archive`/moderate, which is BELOW
  // the hold threshold. Before the fail-closed rule this went out unexamined.
  const p = await tmp('quarterly.7z', Buffer.from('377ABCAF271C0004', 'hex'));
  try {
    govOn(monitor);
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'quarterly.7z', path: p,
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.severity, 'moderate', 'the severity alone would NOT have held this');
    assert.equal(ev.content_scan.scanned, false);
    assert.equal(ev.content_scan.unverified, true, 'a .7z should have been readable');
    const held = await waitFor(
      () => calls.attachHold.find((c) => c.state === 'on' && c.ttlMs === 60_000),
      { label: 'the fail-closed hold' },
    );
    // The block has to be able to say WHY, and "high" would be a claim about
    // content nobody read.
    assert.match(held.patterns, /^unscannable file \(/);
  } finally { monitor.stop(); }
});

test('FAIL CLOSED: a corrupt/encrypted .docx in a governed conversation is HELD', async () => {
  const { monitor, calls } = makeMonitor();
  // Not a real zip container, so mammoth throws exactly as it does for an
  // encrypted or password-protected document: reason 'extraction_failed' on a
  // format the extractors are supposed to handle.
  const p = await tmp('salaries.docx', Buffer.from('not a real docx container at all', 'utf8'));
  try {
    govOn(monitor);
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'salaries.docx', path: p,
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.content_scan.scanned, false);
    assert.ok(
      ['extraction_failed', 'extraction_timeout'].includes(ev.content_scan.reason),
      `unexpected reason ${ev.content_scan.reason}`,
    );
    assert.equal(ev.content_scan.unverified, true);
    assert.equal(ev.severity, 'moderate', 'a document classifies moderate — below the threshold');
    await waitFor(() => calls.attachHold.some((c) => c.state === 'on' && c.ttlMs === 60_000),
      { label: 'the fail-closed hold' });
  } finally { monitor.stop(); }
});

test('FAIL OPEN, unchanged: a media file in a governed conversation is NOT held', async () => {
  const { monitor, calls } = makeMonitor();
  // Nothing was ever going to yield text here. Holding it would be an
  // unexplainable permanent block on a video, so this side of the distinction
  // must stay exactly as it is today.
  const p = await tmp('standup.mp4', Buffer.alloc(2048, 7));
  try {
    govOn(monitor);
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'standup.mp4', path: p,
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.content_scan.scanned, false);
    assert.equal(ev.content_scan.unverified, false, 'a media file is not a document we failed to read');
    await settle(400);
    assert.equal(calls.attachHold.filter((c) => c.state === 'on').length, 0,
      'an unscannable non-document must not arm a hold at all');
    assert.equal(monitor.attachHolds.size, 0);
  } finally { monitor.stop(); }
});

test('FAIL CLOSED IS GOVERNED-ONLY: the same unopenable archive in ChatGPT is not held', async () => {
  // The fail-closed rule is a behaviour change and it is scoped to conversations
  // the org asked to govern. Escalating on "we could not read it" everywhere
  // would start blocking .7z archives and legacy .doc files across every app,
  // which nobody asked for.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('chatgpt-quarterly.7z', Buffer.from('377ABCAF271C0004', 'hex'));
  try {
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ChatGPT', filename: 'chatgpt-quarterly.7z', path: p,
    });
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.content_scan.unverified, true, 'the SIGNAL is still set — only the decision is scoped');
    await settle(400);
    assert.equal(calls.attachHold.filter((c) => c.state === 'on').length, 0);
  } finally { monitor.stop(); }
});

// ── 5. the hold itself: per file, and bound to one app ─────────────────────

test('two flagged attachments are tracked independently — releasing one does not release the other', async () => {
  const { monitor, calls } = makeMonitor();
  const a = await tmp('alpha-secrets.env', SECRET_TEXT);
  const b = await tmp('beta-secrets.env', SECRET_TEXT);
  try {
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ChatGPT', filename: 'alpha-secrets.env', path: a });
    await waitFor(() => monitor.attachHolds.has('alpha-secrets.env') && monitor.attachHolds.get('alpha-secrets.env').severity,
      { label: 'file A confirmed' });
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ChatGPT', filename: 'beta-secrets.env', path: b });
    await waitFor(() => monitor.attachHolds.size === 2, { label: 'file B confirmed' });

    // ONE helper slot, N files: the hold names both, and its pattern list is the
    // union — naming one of two flagged attachments would be a false statement
    // about the other.
    const both = calls.attachHold.filter((c) => c.state === 'on').at(-1);
    assert.equal(both.filename, 'alpha-secrets.env, beta-secrets.env');
    assert.ok(both.patterns.length > 0);

    calls.attachHold.length = 0;
    monitor.attachmentWatcher.emit('attachment_disappeared', { process: 'ChatGPT', filename: 'alpha-secrets.env' });
    // NOT released — re-stated with the narrowed union. This is the defect: the
    // single-slot version released everything here.
    assert.equal(monitor.attachHolds.size, 1);
    assert.deepEqual(calls.attachHold.map((c) => c.state), ['on']);
    assert.equal(calls.attachHold[0].filename, 'beta-secrets.env');

    calls.attachHold.length = 0;
    monitor.attachmentWatcher.emit('attachment_disappeared', { process: 'ChatGPT', filename: 'beta-secrets.env' });
    assert.equal(monitor.attachHolds.size, 0);
    assert.deepEqual(calls.attachHold.map((c) => c.state), ['off']);
  } finally { monitor.stop(); }
});

test('a CLEAN file disappearing does not release the hold a FLAGGED file still needs', async () => {
  // The exact live failure the single-slot field produced: file B (clean) was
  // attached after file A (flagged), so it overwrote the one tracking slot, and
  // B's removal then released A's hold. The send went out with A attached.
  const { monitor, calls } = makeMonitor();
  const flagged = await tmp('flagged-secrets.env', SECRET_TEXT);
  const clean = await tmp('notes.txt', 'a perfectly ordinary sentence about nothing\n');
  try {
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ChatGPT', filename: 'flagged-secrets.env', path: flagged });
    await waitFor(() => monitor.attachHolds.get('flagged-secrets.env')?.severity, { label: 'the flagged file confirmed' });
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ChatGPT', filename: 'notes.txt', path: clean });
    // The clean file's provisional hold is released on its own scan result, and
    // that release must not take the flagged file's hold with it.
    await waitFor(() => monitor.attachHolds.size === 1 && monitor.attachHolds.has('flagged-secrets.env'),
      { label: 'the clean file to release its own provisional hold' });

    calls.attachHold.length = 0;
    monitor.attachmentWatcher.emit('attachment_disappeared', { process: 'ChatGPT', filename: 'notes.txt' });
    await settle(200);
    assert.equal(monitor.attachHolds.size, 1, 'the flagged file must still be held');
    assert.deepEqual(calls.attachHold, [], 'an unheld file disappearing must change nothing at all');
  } finally { monitor.stop(); }
});

test('a hold armed in one app is replaced, not merged, when a different app attaches a file', async () => {
  const { monitor, calls } = makeMonitor();
  const a = await tmp('one-secrets.env', SECRET_TEXT);
  const b = await tmp('two-secrets.env', SECRET_TEXT);
  try {
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ChatGPT', filename: 'one-secrets.env', path: a });
    await waitFor(() => monitor.attachHolds.get('one-secrets.env')?.severity, { label: 'the ChatGPT hold' });
    assert.equal(monitor.attachHoldProcess, 'ChatGPT');

    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'Claude', filename: 'two-secrets.env', path: b });
    await waitFor(() => monitor.attachHoldProcess === 'Claude', { label: 'the Claude hold' });
    // The helper has ONE slot, so the previous app's holds cannot still be in
    // it. Reporting them under this app's name would be a lie.
    assert.deepEqual([...monitor.attachHolds.keys()], ['two-secrets.env']);
    const last = calls.attachHold.filter((c) => c.state === 'on').at(-1);
    assert.equal(last.process, 'Claude');
    assert.equal(last.filename, 'two-secrets.env');
  } finally { monitor.stop(); }
});

test('the provisional hold is refreshed while the extraction is still in flight', async () => {
  // The second half of the refresh bug. The ticker used to start only for a
  // CONFIRMED hold, so the 3s provisional one — whose whole job is to win the
  // race against a fast Enter — could lapse before the scan returned. A slow
  // extraction is exactly when that happens, and exactly the file most worth
  // holding.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('slow-secrets.env', SECRET_TEXT);
  try {
    monitor.attachmentWatcher.emit('attachment_appeared', { process: 'ChatGPT', filename: 'slow-secrets.env', path: p });
    await waitFor(() => calls.attachHold.length >= 1, { label: 'the provisional hold' });
    // The interval is derived from the SHORTEST TTL in force, so a 3s hold is
    // refreshed about every second — the old Math.max(5000, ttl/3) refreshed it
    // every 5s, i.e. never in time.
    assert.ok(monitor.attachHoldRefreshTimer, 'the ticker must be running for a provisional hold');
    const confirmed = await waitFor(
      () => calls.attachHold.find((c) => c.state === 'on' && c.ttlMs === 60_000),
      { label: 'the confirmed hold' },
    );
    assert.ok(confirmed);
    assert.ok(monitor.attachHoldRefreshTimer, 'and must keep running for the confirmed one');
  } finally { monitor.stop(); }
});

test('a file that vanishes mid-scan releases its provisional hold instead of leaving Enter dead', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    // A path that does not exist: buildFileUploadEvent returns null (ENOENT),
    // which is the "the user deleted or moved it" race.
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ChatGPT', filename: 'vanished.env', path: join(tmpdir(), 'cfai-does-not-exist-12345.env'),
    });
    await waitFor(() => calls.attachHold.some((c) => c.state === 'off'), { label: 'the provisional release' });
    assert.equal(monitor.attachHolds.size, 0);
    assert.equal(monitor.attachHoldRefreshTimer, null, 'and the ticker must stop with it');
  } finally { monitor.stop(); }
});

// ── 6. the block toast tells the truth about the Enter-only limitation ─────

test('a Teams attachment block toast states the Enter-only limitation; other apps are unchanged', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    monitor.enforcer.emit('block', {
      kind: 'block', process: 'ms-teams', patterns: 'aws_access_key_id',
      reason: 'attachment', filename: 'payroll.xlsx',
    });
    const teams = calls.toasts.at(-1);
    assert.match(teams.message, /already uploaded it on attach/, 'the existing honest framing must stay');
    assert.match(
      teams.message,
      /Pressing Enter is blocked; clicking Send is not yet covered — remove the attachment to be safe\./,
      'a Teams attachment block must name the Send-button gap',
    );

    calls.toasts.length = 0;
    monitor.enforcer.emit('block', {
      kind: 'block', process: 'ChatGPT', patterns: 'aws_access_key_id',
      reason: 'attachment', filename: 'payroll.xlsx',
    });
    const other = calls.toasts.at(-1);
    assert.match(other.message, /already uploaded it on attach/);
    assert.equal(other.message.includes('clicking Send is not yet covered'), false,
      'the send-button click IS covered for an ordinary AI app — saying otherwise would be wrong');
  } finally { monitor.stop(); }
});

// ── 7. the watchers' host_arm channel, end to end ─────────────────────────
//
// These two DO spawn the real PowerShell helper. There is no other way to prove
// stdin is a pipe rather than 'ignore' (it used to be 'ignore', so a host_arm
// would have gone nowhere at all) or that a respawned helper gets re-armed.

test('AttachmentWatcher: host_arm reaches the real helper, and a respawn re-arms it', async () => {
  if (!win) return;
  const warns = [];
  const respawns = [];
  const watcher = new AttachmentWatcher({
    // The helper's `error` kind is deliberately LOGGED rather than emitted —
    // emitting 'error' on an EventEmitter with no listener throws — so the log
    // is where a bad-command report shows up.
    log: { info() {}, warn: (m) => warns.push(String(m)) },
    aiProcessNames: ['ChatGPT', 'Claude'],
    onRespawn: (w) => { respawns.push(w); w.hostArm('ms-teams', true); },
  });
  try {
    watcher.start();
    // onRespawn fires on EVERY start, including the first — that is what makes
    // the arm state recoverable at all.
    assert.equal(respawns.length, 1, 'the re-arm hook must run on start');
    assert.equal(respawns[0], watcher);
    // stdin must be a pipe. With the old stdio:['ignore',…] this returns false
    // and every host_arm silently disappears.
    assert.equal(watcher.hostArm('ms-teams', true), true, 'stdin must be writable');
    assert.equal(watcher.hostArm('ms-teams', false), true);

    // A malformed line must be reported, not fatal — the helper has to survive
    // anything on this channel.
    watcher.child.stdin.write('{not json at all\n');
    await waitFor(
      () => warns.some((m) => m.includes('bad stdin command')),
      { timeout: 20_000, label: 'the bad-command error line' },
    );

    // Crash it, and the automatic respawn must re-arm.
    const firstPid = watcher.child.pid;
    respawns.length = 0;
    watcher.child.kill();
    await waitFor(() => watcher.child && watcher.child.pid !== firstPid && respawns.length >= 1,
      { timeout: 30_000, label: 'the respawn and its re-arm' });
    assert.equal(watcher.hostArm('ms-teams', true), true, 'the fresh helper must be writable too');
  } finally {
    watcher.stop();
  }
});

test('FileDialogWatcher: host_arm reaches the real helper and the re-arm hook runs on start', async () => {
  if (!win) return;
  const respawns = [];
  const watcher = new FileDialogWatcher({
    log: { info() {}, warn() {} },
    aiProcessNames: ['ChatGPT', 'Claude'],
    onRespawn: (w) => { respawns.push(w); },
  });
  try {
    watcher.start();
    assert.equal(respawns.length, 1);
    assert.equal(watcher.hostArm('ms-teams', true), true, 'stdin must be writable');
    assert.equal(watcher.hostArm('ms-teams', false), true);
    assert.equal(watcher.hostArm('', true), false, 'an empty process name arms nothing');
  } finally {
    watcher.stop();
  }
});

// ── 8. source invariants for the arming, held where the code is ───────────

test('index.js passes the SAME re-arm hook to both watchers, and it reads the live govstate', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  // The state lives in the CHILD, so a respawned helper comes up disarmed.
  // Without this it would sit permanently blind to an already-open governed
  // conversation, because index.js only sends host_arm on a govstate TRANSITION
  // and no further transition is coming.
  assert.match(src, /const reArm = \(watcher\) => \{/);
  assert.match(src, /const proc = this\.hostGoverned\?\.process;/);
  // …and it re-states WHICH conversation too, or the fresh helper immediately
  // drops the baseline of the one still on screen. See section 9.
  assert.match(src, /watcher\.hostArm\(proc, true, hostArmKey\(this\.hostGoverned\)\);/);
  assert.match(src, /new FileDialogWatcher\(\{ log, aiProcessNames: aiProcNames, onRespawn: reArm \}\)/);
  assert.match(src, /new AttachmentWatcher\(\{ log, aiProcessNames: aiProcNames, onRespawn: reArm \}\)/);
  // The prompt watcher is deliberately NOT armed: typed prompt text in Teams is
  // enforcer-win.ps1's job, at the element level, and was never asked for here.
  assert.match(src, /new PromptWatcher\(\{ log, aiProcessNames: aiProcNames \}\)/);
});

test('attachment-watcher.ps1: Teams is armed through a SEPARATE set, and $AiProcesses is never touched', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.ps1'), 'utf8');
  // Empty at startup, always — the default answer for Teams stays a flat no,
  // which is what keeps the "Teams never reaches a passive watcher" property
  // describing the shipped, unarmed state correctly.
  assert.match(src, /\$ArmedHostProcs = New-Object 'System\.Collections\.Generic\.HashSet\[string\]'/);
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  // The catalog list itself is read-only. Adding to it would turn on watching
  // across the whole chat client rather than for one governed conversation.
  assert.equal(/\$AiProcesses\s*\.\s*Add|\$AiProcesses\s*\+=/.test(code), false,
    'the catalog process list must never be mutated');
  // Exactly two mutation sites for the armed set, and both are the host_arm
  // command.
  assert.equal((code.match(/\$ArmedHostProcs\.Add\(/g) || []).length, 1);
  assert.equal((code.match(/\$ArmedHostProcs\.Remove\(/g) || []).length, 1);
  // OR'd into the existing predicate, checked second.
  assert.match(code, /if \(\$ArmedHostProcs\.Contains\(\$base\)\) \{ return \$true \}/);
  // The per-window BASELINE is dropped on a change of CONVERSATION — one Teams
  // window holds every conversation, so conversation A's baseline diffed against
  // conversation B's view would report every filename in B as a new attachment.
  //
  // NOT on a change of ARM STATE, which is what it used to be and what made an
  // attachment undetectable: focus leaving the composer to attach a file is a
  // disarm, and the baseline is what the resulting chip has to be diffed
  // against. See section 9.
  assert.match(code, /Sync-BaselineForArm \$procName \(\[string\]\$cmd\.key\)/);
  assert.match(code, /foreach \(\$h in \$stale\) \{ \$Seen\.Remove\(\$h\); \$SeenProc\.Remove\(\$h\) \}/);
  // Exactly one call site, and it is under the `on` branch — a disarm must not
  // reach it.
  assert.equal((code.match(/Sync-BaselineForArm/g) || []).length, 2, 'one definition, one call');
  const onBranch = code.slice(code.indexOf("if (\$cmd.state -eq 'on')"), code.indexOf('} else {', code.indexOf("if (\$cmd.state -eq 'on')")));
  assert.match(onBranch, /Sync-BaselineForArm/);
  // …and the only command accepted is host_arm.
  const drain = src.slice(src.indexOf('The one command this watcher accepts'), src.indexOf('$tick = 0'));
  assert.match(drain, /if \(\$cmd\.cmd -eq 'host_arm' -and \$cmd\.process\)/);
  assert.equal(/\$cmd\.(path|filename|text)/.test(drain), false, 'no path or free text may arrive on this channel');
});

test('file-dialog-watcher.ps1: the arm state is LATCHED when a dialog opens, not re-checked when it closes', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-dialog-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /\$ArmedHostProcs = New-Object 'System\.Collections\.Generic\.HashSet\[string\]'/);
  assert.equal(/\$AiProcesses\s*\.\s*Add|\$AiProcesses\s*\+=/.test(code), false);
  // A picker steals focus, so govstate has already gone false by the time the
  // dialog closes. Re-asking at the close event would answer "no" for every
  // picker ever opened from Teams — the latch is the fix.
  // The latch now rides on Resolve-GovernedProcess's answer — `Catalog` is true
  // for an ordinary AI app and false for an armed host app, which is the same
  // distinction the old inline (-not (Is-AiProcess ...)) drew, decided once at
  // first sighting instead of recomputed from a process name.
  assert.match(code, /hostArmed = \(-not \$owner\.Catalog\)/);
  assert.match(code, /host_armed = \[bool\]\$entry\.hostArmed/);
  // An already-tracked dialog is never re-gated: the resolve happens only inside
  // the `-not $entry` branch, so a tracked hwnd never consults the arm state again.
  assert.match(code, /\$entry = \$Tracked\[\$hwnd\]\s*\r?\n\s*if \(-not \$entry\) \{/);
  const newEntry = code.slice(code.indexOf('$entry = $Tracked[$hwnd]'), code.indexOf('$sel = Get-DialogSelection'));
  assert.match(newEntry, /\$owner = Resolve-GovernedProcess \$hwnd \(\[int\]\$d\.ProcessId\)/);
  assert.match(newEntry, /if \(-not \$owner\) \{ continue \}/);
  // …and the gate itself is Resolve-GovernedProcess, which consults BOTH rules.
  const resolver = code.slice(code.indexOf('function Resolve-GovernedProcess'), code.indexOf('$FILENAME_FIELD_ID'));
  assert.match(resolver, /if \(Is-AiProcess \$name\) \{ return @\{ Name = \$name; Pid = \$cur; Catalog = \$true \} \}/);
  assert.match(resolver, /if \(Is-HostArmedForNewDialog \$name\) \{ return @\{ Name = \$name; Pid = \$cur; Catalog = \$false \} \}/);
  // The walk is bounded — an unbounded one would reach services.exe and start
  // attributing unrelated dialogs to whatever sits above them.
  assert.match(code, /\$PROC_WALK_MAX = 4/);
  assert.match(resolver, /\$hop -le \$PROC_WALK_MAX/);
  // The grace window is bounded and short: its only cost is that a picker
  // opened within 5s of leaving a governed conversation is also tracked.
  assert.match(code, /\$HOST_ARM_GRACE_MS = 5000/);
  assert.match(code, /\$HostDisarmedAt\[\$procName\] = \[DateTime\]::UtcNow/);
});

// ── 9. the two bugs that made a live Teams attachment go through unblocked ───
//
// Both were found by testing the real helpers rather than the command channel,
// which is what the section-7 tests above check and what let these ship: the
// channel worked perfectly in both cases.

// BUG 1, and the total one: the helpers never polled at all.
//
// Both read stdin through `[Console]::In.ReadLineAsync()`, which is not
// asynchronous. [Console]::In is a System.IO.TextReader+SyncTextReader whose
// override is literally `Task.FromResult(ReadLine())` — the read runs on the
// CALLING thread and the Task it hands back is already complete. So the
// "not finished, carry on polling" branch was unreachable, the drain loop blocked
// on its first iteration, and the UIA scan underneath it ran ZERO times for the
// life of the process. Measured before the fix, with the heartbeat forced to
// every tick: zero heartbeats in six seconds, three of them after a host_arm had
// been delivered and applied.
//
// `ready` could never catch this — it is emitted BEFORE the loop. A heartbeat is
// the only output that proves the loop body executed, which is why these two
// tests wait for one and why the helpers now emit one on tick 1.

// Taps the helper's RAW stdout. The wrappers swallow `heartbeat` and only log
// `ready`, and what has to be observed here is what the helper actually printed,
// not what the wrapper chose to re-emit. One tap per child, installed once.
function tapHelper(watcher) {
  const seen = [];
  let buf = '';
  watcher.child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { seen.push(JSON.parse(line)); } catch {}
    }
  });
  return {
    all: seen,
    // Wait for a line of this kind printed AFTER this call — the point of the
    // second wait in each test below.
    next(kind, { timeout = 30_000 } = {}) {
      const from = seen.length;
      return waitFor(() => seen.slice(from).find((e) => e && e.kind === kind),
        { timeout, label: `a ${kind} from the helper` });
    },
    first(kind, { timeout = 30_000 } = {}) {
      return waitFor(() => seen.find((e) => e && e.kind === kind),
        { timeout, label: `a ${kind} from the helper` });
    },
  };
}

// The default cadence is 40s (attachment) / 30s (dialog) between heartbeats, so
// a test that waits for a SECOND one would time out on a perfectly healthy
// helper. The env knob exists for exactly this.
async function withFastHeartbeat(fn) {
  const prev = process.env.CFAI_WATCHER_HEARTBEAT_TICKS;
  process.env.CFAI_WATCHER_HEARTBEAT_TICKS = '3';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.CFAI_WATCHER_HEARTBEAT_TICKS;
    else process.env.CFAI_WATCHER_HEARTBEAT_TICKS = prev;
  }
}

test('attachment-watcher.ps1: the POLL LOOP runs — a heartbeat, not just `ready`', async () => {
  if (!win) return;
  await withFastHeartbeat(async () => {
    const watcher = new AttachmentWatcher({
      log: { info() {}, warn() {} },
      aiProcessNames: ['ChatGPT', 'Claude'],
    });
    try {
      watcher.start();
      const tap = tapHelper(watcher);
      const hb = await tap.first('heartbeat');
      assert.equal(hb.tick, 1, 'the first poll tick must report in, or a wedged loop is invisible');
      // …and it KEEPS running while commands arrive. The blocking reader
      // unblocked for exactly as long as it took to consume one line and then
      // stalled again, so this is the assertion that fails for it.
      assert.equal(watcher.hostArm('ms-teams', true, 'aaaaaaaaaaaaaaaa'), true);
      assert.equal(watcher.hostArm('ms-teams', false, 'aaaaaaaaaaaaaaaa'), true);
      const later = await tap.next('heartbeat');
      assert.ok(later.tick > 1, 'the loop must still be polling after a host_arm');
    } finally { watcher.stop(); }
  });
});

test('file-dialog-watcher.ps1: the POLL LOOP runs — a heartbeat, not just `ready`', async () => {
  if (!win) return;
  await withFastHeartbeat(async () => {
    const watcher = new FileDialogWatcher({
      log: { info() {}, warn() {} },
      aiProcessNames: ['ChatGPT', 'Claude'],
    });
    try {
      watcher.start();
      const tap = tapHelper(watcher);
      const hb = await tap.first('heartbeat');
      assert.equal(hb.tick, 1);
      assert.equal(watcher.hostArm('ms-teams', true, 'aaaaaaaaaaaaaaaa'), true);
      const later = await tap.next('heartbeat');
      assert.ok(later.tick > 1, 'the dialog scan must still be running after a host_arm');
    } finally { watcher.stop(); }
  });
});

test('both wrappers log the first heartbeat, so a wedged poll loop is a visible line', async () => {
  if (!win) return;
  await withFastHeartbeat(async () => {
    for (const [Cls, needle] of [
      [AttachmentWatcher, 'attachment-watcher: poll loop live'],
      [FileDialogWatcher, 'file-dialog-watcher: poll loop live'],
    ]) {
      const infos = [];
      const watcher = new Cls({
        log: { info: (m) => infos.push(String(m)), warn() {} },
        aiProcessNames: ['ChatGPT'],
      });
      try {
        watcher.start();
        await waitFor(() => infos.some((m) => m.includes(needle)),
          { timeout: 30_000, label: needle });
        // ONCE, not once per heartbeat — this must not become log spam.
        await settle(2000);
        assert.equal(infos.filter((m) => m.includes(needle)).length, 1);
      } finally { watcher.stop(); }
    }
  });
});

test('NEITHER watcher may read stdin through [Console]::In — that reader blocks', async () => {
  for (const f of ['attachment-watcher.ps1', 'file-dialog-watcher.ps1']) {
    const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', f), 'utf8');
    const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
    // SyncTextReader.ReadLineAsync is `Task.FromResult(ReadLine())`. Any use of
    // it here re-wedges the poll loop, silently, with the command channel still
    // working — the exact shape of the shipped bug.
    assert.equal(/\[Console\]::In/.test(code), false, `${f} must not use [Console]::In`);
    assert.equal(/ReadLineAsync/.test(code), false, `${f} must not use ReadLineAsync`);
    // The raw stream has no such override: __ConsoleStream inherits the real
    // threadpool-backed Stream.ReadAsync, which returns an INCOMPLETE task.
    assert.match(code, /\[Console\]::OpenStandardInput\(\)/, `${f} must read the raw stdin stream`);
    assert.match(code, /\$script:StdinStream\.ReadAsync\(/, `${f} must use Stream.ReadAsync`);
    // A completed read of 0 bytes is the parent going away — stop re-issuing
    // rather than spinning on a dead pipe every tick.
    assert.match(code, /if \(\$n -le 0\) \{ \$script:StdinClosed = \$true; return \$null \}/, f);
    // The loop's liveness signal has to fire on the FIRST tick. Every 50th (or
    // 75th) alone is 40s/30s of silence, which is indistinguishable from wedged.
    assert.match(code, /\$tick -eq 1 -or \$tick % \$HeartbeatTicks -eq 0/, `${f} must heartbeat on tick 1`);
    assert.match(code, /\$HeartbeatTicks = \d+/, `${f} must define its heartbeat cadence`);
  }
});

// BUG 2: with the loop running, the chip was still undetectable — the baseline
// it had to be diffed against was being dropped at the exact moment the chip
// appeared.
//
// govstate is edge-triggered on the FOCUSED ELEMENT (UpdateGovState requires
// _fgLeftAiTicks == 0, a first-hand composer read on that very tick), so it drops
// the instant focus leaves the composer and returns when focus comes back. Every
// way of attaching a file does exactly that — a drag makes Explorer the
// foreground window, the paperclip opens a flyout or a picker. Observed live as
// ARMED/disarmed pairs under a second apart. The helper reset its per-window
// filename baseline on BOTH transitions, so the sequence was always: arm (silent
// baseline, no chip) → disarm → chip appears → arm → baseline reset → next tick
// silently re-baselines WITH the chip in it → the chip is never new.

test('attachment-watcher.ps1: a focus flicker inside ONE conversation KEEPS the baseline, so the chip is still new', async () => {
  if (!win) return;
  const obs = await runArmHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // The first armed tick snapshots the conversation's existing history silently.
  assert.equal(at('A1-armed-and-seeded').armed, true);
  assert.deepEqual(arr(at('A1-armed-and-seeded').baseline), ['Policy.pdf']);

  // Focus leaves the composer to attach a file. A DISARM MUST NOT DROP THE
  // BASELINE — while disarmed the loop takes no reads at all, so it cannot
  // drift, and it is exactly what the chip has to be compared against.
  assert.equal(at('A2-focus-left-composer').armed, false);
  assert.equal(at('A2-focus-left-composer').has_baseline, true, 'a disarm must not drop the baseline');

  // Focus returns, same conversation. This is the assertion that fails for the
  // shipped code: it reset here, and everything downstream went blind.
  assert.equal(at('A3-focus-returned-same-conversation').has_baseline, true,
    're-arming for the SAME conversation must keep the baseline');
  assert.deepEqual(arr(at('A3-focus-returned-same-conversation').baseline), ['Policy.pdf']);

  // …and so the file the user actually attached is reportable.
  assert.deepEqual(arr(at('A4-diff-after-attachment').new_files), ['Test.docx'],
    'the attached file must be seen as NEW — with the old reset this list was empty');
  // Repeated sub-second flickers must not erode it either.
  assert.deepEqual(arr(at('A5-after-three-flickers').new_files), ['Test.docx']);
});

test('attachment-watcher.ps1: a real conversation SWITCH still resets, so no false attachment is reported', async () => {
  if (!win) return;
  const obs = await runArmHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // The false positive the reset exists to prevent, and it is still prevented:
  // ONE Teams window holds every conversation, so conversation A's baseline
  // diffed against conversation B's view would report every filename visible in
  // B as a brand-new attachment — files the user never touched.
  assert.equal(at('B1-different-conversation').has_baseline, false,
    'a different conversation key must drop the baseline');
  assert.deepEqual(arr(at('B1-different-conversation').new_files), [],
    'and the fresh baseline is taken SILENTLY — nothing from the new view is reported');

  // No key at all (an older or unknown caller) falls back to the old
  // always-reset behaviour: a miss, never a false report.
  assert.equal(at('C1-arm-without-a-key').has_baseline, false);

  // Arming a DIFFERENT process leaves this one's baseline alone.
  assert.equal(at('D1-other-process-armed').has_baseline, true);
  assert.equal(at('D1-other-process-armed').other_armed, true);

  // Garbage on the channel is reported and survived, exactly as before.
  assert.equal(at('E1-survived-garbage').has_baseline, true);
  assert.ok(obs.some((o) => o.kind === 'error' && o.message === 'bad stdin command'));
});

// The Node side of bug 2, and the third place the flicker bit: the chip route
// gated its host-app eligibility on a LIVE read of this.hostGoverned. By the
// time a chip is visible the govstate has usually already bounced, so that read
// rejected precisely the attachments the route exists to catch. It now uses the
// helper's latched `host_armed`, the same way the file-picker route already did.
test('a chip reported after the govstate has FLICKERED OFF is still scanned, held and reported', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('flickered-secrets.env', SECRET_TEXT);
  try {
    govOn(monitor);
    // Focus left the composer — a drag from Explorer, or the paperclip's flyout.
    // In the live log this happened within a second, repeatedly.
    govOff(monitor);
    assert.equal(monitor.hostGoverned, null, 'the live govstate really is gone');

    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'flickered-secrets.env', path: p, host_armed: true,
    });

    // The provisional hold, then the confirmed one — the send must be blocked.
    await waitFor(() => calls.attachHold.length >= 1, { label: 'the provisional hold' });
    const confirmed = await waitFor(
      () => calls.attachHold.find((c) => c.state === 'on' && c.ttlMs === 60_000),
      { label: 'the confirmed hold' },
    );
    assert.equal(confirmed.process, 'ms-teams');
    const ev = await waitFor(() => calls.enqueued[0], { label: 'the reported file event' });
    assert.equal(ev.via, 'drag_drop_or_chip');
    assert.equal(ev.severity, 'critical');
    assert.equal(ev.window_title, '', 'still no Teams window title');
    // The conversation is no longer known, so the record OMITS the agent rather
    // than guessing — the same honest outcome the picker route already gives.
    assert.equal(ev.agent_name, undefined);
  } finally { monitor.stop(); }
});

test('an unarmed Teams chip is STILL ignored — the latch is the gate, not a bypass', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('unarmed-latch-secrets.env', SECRET_TEXT);
  try {
    // No govstate, and host_armed false / absent: the state an ordinary DM or
    // channel is in. Nothing may be read, scanned, held or reported.
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'unarmed-latch-secrets.env', path: p, host_armed: false,
    });
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'unarmed-latch-secrets.env', path: p,
    });
    await settle();
    assert.deepEqual(calls.enqueued, []);
    assert.deepEqual(calls.attachHold, []);
    const leaked = calls.logs.filter(([, m]) => m.includes('unarmed-latch-secrets.env'));
    assert.deepEqual(leaked, [], `the filename must not even reach the log: ${JSON.stringify(leaked)}`);
  } finally { monitor.stop(); }
});

// ── 9b. the DEFAULT path: no host_arm, ever ─────────────────────────────────
//
// Everything in section 9 drives the arm state machine, and the harness it uses
// stops above the poll loop and re-implements the loop's baseline bookkeeping by
// hand. That suite went green — 595 of 598 — while the shipped watcher was, for
// every ordinary AI app, in a permanent error loop.
//
// Fixing the stdin wedge made the poll loop body execute for the first time, and
// it executed straight into a latent null-reference. Collect-FilenameLikeNames
// returns a HashSet, but PowerShell ENUMERATES a collection returned from a
// function, so the caller got the CONTENTS: $null for an empty set, a bare
// [string] for one name. $null went into $Seen as the window's baseline, the next
// tick called $prev.Contains(...) on it, and that is
//
//     WARN [os_monitor] attachment-watcher error: You cannot call a method on a
//     null-valued expression.
//
// once a second, from the moment a file was attached — because the throw lands
// before the loop's own `$Seen[...] = $current` write, so the $null baseline is
// never replaced and the next tick does it again. Observed live attaching
// Test.docx to Microsoft Copilot, which never sends a host_arm at all.
//
// These tests therefore drive the loop body VERBATIM, with no host_arm ever sent.
// See tests/helpers/attachment-poll-harness.ps1.

test('attachment-watcher.ps1: a normal AI-app attachment tick with NO host_arm ever sent does not throw', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // Nothing armed anywhere. This is Copilot, not Teams — the arm channel is not
  // part of this path and must not need to be.
  for (const step of ['A1-focused-nothing-attached', 'A2-user-attaches-Test.docx', 'A3-still-attached', 'A4-user-removes-it']) {
    assert.equal(at(step).armed, 0, `${step}: nothing may be armed on the default path`);
    assert.equal(at(step).arm_keys, 0, `${step}: no conversation key may exist on the default path`);
  }

  // The error the user actually saw, as the watcher itself reports it.
  const errs = obs.filter((o) => o.kind === 'error');
  assert.deepEqual(errs.map((e) => e.message), [],
    `the poll loop must not error on the default path; got ${JSON.stringify(errs)}`);
  assert.equal(obs.filter((o) => o.threw).length, 0, 'no tick may throw out of the loop');

  // The direct cause: an AI window showing nothing filename-shaped must seed an
  // EMPTY baseline, not a $null one.
  assert.equal(at('A1-focused-nothing-attached').baseline_null, false,
    'a window with no filename-shaped element must baseline as an empty set, not $null');
  assert.deepEqual(arr(at('A1-focused-nothing-attached').baseline), []);

  // …and the attachment is actually reported, which is the thing that was broken
  // for the user: the file was never scanned, never held, never blocked.
  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'Copilot');
  assert.deepEqual(appeared.map((a) => a.filename), ['Test.docx'],
    'the attached file must be reported exactly once');
  assert.equal(appeared[0].host_armed, false, 'a catalog AI app is never host_armed');

  // Baseline carries forward, so a still-present chip is not re-reported…
  assert.deepEqual(arr(at('A3-still-attached').baseline), ['Test.docx']);
  // …and removing it releases exactly once.
  const gone = obs.filter((o) => o.kind === 'attachment_disappeared' && o.process === 'Copilot');
  assert.deepEqual(gone.map((g) => g.filename), ['Test.docx']);
});

test('attachment-watcher.ps1: a ONE-file baseline is a set, not a string — no substring false-negative', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  assert.deepEqual(arr(at('B1-one-file-on-screen').baseline), ['Quarterly-Report.pdf']);

  // The same enumeration bug with a silent symptom instead of a loud one. A
  // baseline of exactly one name came back as a bare [string], and
  // [string]::Contains is SUBSTRING matching — so "Report.pdf" tested as already
  // present in "Quarterly-Report.pdf" and the new attachment was dropped without
  // a single log line. A miss is worse than a crash here: the crash was noticed.
  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'ChatGPT');
  assert.deepEqual(appeared.map((a) => a.filename), ['Report.pdf'],
    'a new chip whose name is a SUBSTRING of the baselined one must still be new');
});

// Live, Microsoft Copilot, Test.docx attached by drag-drop. Detection fired —
// the two bugs above were fixed — and the watcher logged:
//
//     attachment-watcher: filename "Remove attachment Test.docx" appeared in
//     Microsoft Copilot but not found on disk
//
// The captured string is the accessible name of the chip's REMOVE BUTTON, which
// Fluent UI labels "Remove attachment <filename>". It ends in `.docx`, so the
// extension regex matched and the element was collected — but the WHOLE string
// was then handed to Resolve-Path-ByBasename, and no such file exists on disk.
// So every drag-drop attachment into Copilot resolved to $null: reported with a
// nonsense filename, never scanned, never held, never blocked.
test('attachment-watcher.ps1: a chip name wrapped in UI chrome resolves to the FILENAME, not the whole accessible name', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  assert.deepEqual(arr(at('D1-copilot-idle').baseline), []);
  // The exact string seen live.
  assert.deepEqual(arr(at('D2-remove-button-chrome').baseline), ['Test.docx'],
    'the baseline must hold the extracted filename, not "Remove attachment Test.docx"');

  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'Cursor');
  assert.deepEqual(appeared.map((a) => a.filename), ['Test.docx'],
    'the reported filename is what Resolve-Path-ByBasename searches for on disk');

  // The same attachment also exposes a plain "Test.docx" element. Both extract
  // to one filename, so the set dedupes and D3 is not a second attachment.
  assert.deepEqual(arr(at('D3-same-chip-plain-label').baseline), ['Test.docx']);

  const gone = obs.filter((o) => o.kind === 'attachment_disappeared' && o.process === 'Cursor');
  assert.deepEqual(gone.map((g) => g.filename), ['Test.docx'],
    'removing the chip releases exactly once, under the same filename');
});

test('attachment-watcher.ps1: a bare filename is passed through untouched — no over-stripping', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // The simple case every other AI app already relied on: the chip's accessible
  // name IS the filename. A2 covers the no-space form; this covers a name with a
  // space in it, which is where a "take the last token" extraction would quietly
  // start scanning the wrong file (or none). Over-stripping is the worse
  // failure of the two, so it gets its own guard.
  assert.deepEqual(arr(at('E2-spaced-filename').baseline), ['Quarterly Report.docx']);
  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'Claude');
  assert.deepEqual(appeared.map((a) => a.filename), ['Quarterly Report.docx']);
});

// Live, Microsoft Teams, the governed "IT Help Desk Agent" conversation, the
// very same Test.docx that Microsoft Copilot had just blocked end to end:
//
//     attachment-watcher: filename "Test 1.docx" appeared in Microsoft Teams
//     but not found on disk
//     attachment-watcher: filename "Test%201.docx" appeared in Microsoft Teams
//     but not found on disk
//     os_monitor: prompt sent into Microsoft Teams (7 chars)   <- UNBLOCKED
//     attachment-watcher: filename "You've shared Test 1.docx" appeared in
//     Microsoft Teams but not found on disk
//
// ONLY `Test.docx` exists on disk. Teams renames the CHIP, not the bytes: a
// filename that has already appeared in the conversation is displayed as
// "<base> <N><ext>" so the transcript can tell the two apart. Every element of
// the chip therefore carried a name no file on disk has, nothing resolved,
// nothing was scanned, no hold was armed, and the send went through.
test('attachment-watcher.ps1: a Teams-disambiguated chip name ("Test 1.docx") resolves to the REAL file on disk', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // The baseline still holds the DISPLAY name — that is what the next UIA read
  // produces, so the diff has to compare like with like.
  assert.deepEqual(arr(at('F2-disambiguated-chip').baseline), ['Test 1.docx']);

  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'ms-teams' && o.pid === 4242 && o.path);
  const f = appeared.find((a) => a.path === 'C:\\FakeDisk\\Test.docx') || assert.fail('Test.docx never resolved');
  // The EVENT carries the true on-disk name: that is the file the scan reads,
  // so that is the name the governance record and the hold have to be about.
  assert.equal(f.filename, 'Test.docx',
    'the reported filename must be the real file, not Teams\' disambiguated display name');
  assert.equal(f.host_armed, true, 'a host app chip is always host_armed');

  // …and the release names the same file the hold was ARMED under. The Node
  // side keys attachHolds on this string; a release under "Test 1.docx" would
  // match nothing and Enter would stay dead in Teams.
  const gone = obs.filter((o) => o.kind === 'attachment_disappeared' && o.process === 'ms-teams');
  assert.ok(gone.some((g) => g.filename === 'Test.docx'),
    `the release must use the true on-disk name; got ${JSON.stringify(gone.map((g) => g.filename))}`);
  assert.equal(gone.some((g) => g.filename === 'Test 1.docx'), false,
    'a release under the display name would leak the hold forever');
});

test('attachment-watcher.ps1: Teams\' "You\'ve shared X" chrome is stripped like a remove-button label', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // "shared" is not a REMOVAL verb, so the Copilot-era verb list left the whole
  // phrase intact and it was sent to disk lookup as if it were a filename.
  assert.deepEqual(arr(at('G2-youve-shared-chrome').baseline), ['Test 1.docx'],
    'the pronoun+verb announcement must be stripped down to the display filename');

  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'ms-teams' && o.path);
  assert.ok(appeared.some((a) => a.filename === 'Test.docx' && a.path === 'C:\\FakeDisk\\Test.docx'),
    'and then the disambiguation fallback resolves it, same as the bare label');
});

test('attachment-watcher.ps1: an EXACT match always wins — a file really called "Report 1.docx" is never redirected', async () => {
  if (!win) return;
  const obs = await runPollHarness();

  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'ms-teams');
  const h = appeared.find((a) => a.path && a.path.includes('Report')) || assert.fail('Report 1.docx never resolved');
  // Both "Report 1.docx" and "Report.docx" exist side by side on the fake disk.
  // The literal name is tried across every search dir BEFORE the disambiguation
  // fallback is even computed, so the trailing number is part of a real name
  // here and must be left alone. Getting this wrong scans a different document
  // than the user attached and records it under the wrong name.
  assert.equal(h.filename, 'Report 1.docx');
  assert.equal(h.path, 'C:\\FakeDisk\\Report 1.docx');
  assert.equal(appeared.some((a) => a.path === 'C:\\FakeDisk\\Report.docx'), false,
    'the fallback must never be preferred over, or tried alongside, an exact match');
});

test('attachment-watcher.ps1: a percent-encoded sibling element that cannot resolve does not block the one that can', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // "Test%201.docx" is the same disambiguated name exposed href-style by a
  // different UIA element on the same chip. Deliberately NOT url-decoded: `%` is
  // legal in a Windows filename and decoding would resolve — and therefore scan,
  // record and hold — the same file twice.
  const i2 = obs.find((o) => o.kind === 'attachment_appeared' && o.filename === 'Test%201.docx')
    || assert.fail('the percent-encoded element was not reported at all');
  assert.equal(i2.path, null, 'it resolves to nothing, and says so');
  assert.deepEqual(arr(at('I2-percent-encoded').baseline), ['Test%201.docx']);

  // The point: its failure is inert. Each name in the diff is handled
  // independently — no shared state, no early exit — so the sibling element
  // that DOES resolve still gets the file scanned and held.
  assert.deepEqual(arr(at('I3-plain-sibling').baseline), ['Test 1.docx']);
  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'ms-teams' && o.path);
  assert.ok(appeared.some((a) => a.filename === 'Test.docx'),
    'one element resolving is all it takes for the file to be held');

  // No error, no throw, anywhere in the run — including every new scenario.
  assert.deepEqual(obs.filter((o) => o.kind === 'error').map((e) => e.message), []);
  assert.equal(obs.filter((o) => o.threw).length, 0);
});

test('attachment-watcher.ps1: a real filename that STARTS with a share verb is not over-stripped', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);

  // The guard on the chrome widening. "Sent" and "Shared" are ordinary English
  // words and ordinary first words of ordinary filenames, so a bare share verb
  // only strips when an explicit generic noun follows it ("Shared file X").
  // Over-stripping silently rewrites a real filename into a different one.
  assert.deepEqual(arr(at('J2-sent-items').baseline), ['Sent Items.pdf']);
  assert.deepEqual(arr(at('J3-shared-drive-map').baseline), ['Shared Drive Map.xlsx']);
  const appeared = obs.filter((o) => o.kind === 'attachment_appeared' && o.process === 'Gemini');
  assert.deepEqual(appeared.map((a) => a.filename), ['Sent Items.pdf', 'Shared Drive Map.xlsx']);
});

test('attachment-watcher.ps1: a tick with no AI window in the foreground is a quiet no-op', async () => {
  if (!win) return;
  const obs = await runPollHarness();
  const c1 = obs.find((o) => o.obs === 'C1-no-ai-window') || assert.fail('no observation C1');
  assert.equal(c1.threw, null);
});

test('attachment-watcher.ps1: the name-collecting functions may not leak their collection to enumeration', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  // `return $names` is one character away from the crash above and reads as
  // correct, so pin the comma at the source too — the behavioural tests can only
  // catch it on Windows, and this is the whole mechanism of the bug.
  assert.match(code, /return ,\$names/, 'Collect-FilenameLikeNames must return the SET, not its contents');
  assert.equal(/return \$names\b/.test(code), false,
    'a bare `return $names` is enumerated by PowerShell and hands the caller $null for an empty set');
  assert.match(code, /function ConvertTo-NameSet/);
  // The raw accessible name may never be what enters the set — it is the button
  // label "Remove attachment Test.docx", not a path anything can be found at.
  assert.match(code, /function Get-FilenameFromAccessibleName/);
  assert.equal(/\$names\.Add\(\$name\)/.test(code), false,
    'the EXTRACTED filename goes in the set, never the raw accessible name');
  // Both sides of the diff normalised, so neither a fresh collect nor a baseline
  // written by an older build can be what .Contains() is called on.
  assert.match(code, /\$current = ConvertTo-NameSet \(Collect-FilenameLikeNames \$fg\.Element\)/);
  assert.match(code, /\$prev = ConvertTo-NameSet \$Seen\[\$fg\.Hwnd\]/);

  // The poll loop must go through the resolver that tries the LITERAL name
  // first and only then the disambiguation fallback — calling the raw
  // basename lookup from the loop is the pre-fix behaviour that let every
  // Teams re-attachment through unscanned.
  assert.match(code, /function Resolve-AttachmentFile/);
  assert.match(code, /\$resolved = Resolve-AttachmentFile \$name/);
  assert.equal(/\$resolved = Resolve-Path-ByBasename \$name/.test(code), false,
    'the loop must not resolve by literal basename alone');
  // Exact-match-first, stated at the source: the fallback is only reachable
  // inside the `-not $hit` branch.
  assert.match(code, /\$hit = Resolve-Path-ByBasename \$basename\s*\n\s*if \(-not \$hit\) \{/);

  // Same defect class in the sibling watcher. Get-DialogFileNames is gone — its
  // ControlType+ValuePattern query could never find the File name field, whose
  // UIA ControlType is Pane — but every function there that still returns a
  // COLLECTION has to carry the same comma, for the same reason.
  const dlg = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-dialog-watcher.ps1'), 'utf8');
  const dlgCode = dlg.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(dlgCode, /return ,\$out\b/,
    'Get-OpenCommonDialogs must return the LIST, not its contents');
  assert.match(dlgCode, /return ,\$out\.ToArray\(\)/,
    'Split-FileNameField must return the array, not its contents');
  assert.equal(/return \$out\b/.test(dlgCode), false,
    'a bare `return $out` is enumerated by PowerShell and hands the caller $null for an empty list');
  // The dead extractor must be gone, not merely bypassed.
  assert.equal(/function Get-DialogFileNames/.test(dlgCode), false,
    'the ControlType-based extractor never matched the real dialog; it must not linger');
});

// ── 10. the conversation key, and what may travel on the arm channel ─────────

test('the host_arm key is a DIGEST: stable per conversation, different across conversations, never the agent name', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    const keysFor = (opts) => {
      calls.hostArm.length = 0;
      govOn(monitor, opts);
      const k = calls.hostArm.filter((c) => c.on).map((c) => c.key);
      govOff(monitor);
      return k;
    };

    const a1 = keysFor({ agent: 'IT Help Desk Agent', agentId: 'agent-ithelp', panel: 'teams_composer' });
    const a2 = keysFor({ agent: 'IT Help Desk Agent', agentId: 'agent-ithelp', panel: 'teams_composer' });
    const b1 = keysFor({ agent: 'Payroll Assistant', agentId: 'agent-payroll', panel: 'teams_composer' });
    const c1 = keysFor({ agent: '', agentId: '', scope: 'panel', panel: 'teams_copilot_composer' });

    // Stable — otherwise every re-arm looks like a conversation switch and the
    // baseline is dropped again, which is bug 2 all over again.
    assert.deepEqual(a1, a2, 'the same conversation must produce the same key');
    // …and distinct, or a real switch would keep a stale baseline and report
    // files the user never attached.
    assert.notEqual(a1[0], b1[0], 'a different agent must produce a different key');
    assert.notEqual(a1[0], c1[0], 'a different panel must produce a different key');
    // The unnamed Copilot-tab conversation still gets a key.
    assert.match(c1[0], /^[0-9a-f]{16}$/);

    // NOT REVERSIBLE, and not the values themselves. This channel arms a watcher
    // inside a company's chat client; if it carried the conversation's identity
    // in the clear, the act of arming would be the leak it exists to avoid.
    for (const k of [...a1, ...b1, ...c1]) {
      assert.match(k, /^[0-9a-f]{16}$/);
      assert.equal(k.includes('IT Help Desk'), false);
      assert.equal(k.includes('Payroll'), false);
      assert.equal(k.includes('teams_'), false);
      assert.equal(k.includes('agent-'), false);
    }
  } finally { monitor.stop(); }
});

test('index.js derives the arm key by HASHING, and sends nothing else down the channel', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /function hostArmKey\(g\) \{/);
  assert.match(src, /createHash\('sha256'\)\.update\(seed\)\.digest\('hex'\)\.slice\(0, 16\)/);
  // Both watchers, one key, one call site.
  assert.match(src, /this\.attachmentWatcher\.hostArm\(this\.hostGoverned\.process, true, key\);/);
  assert.match(src, /this\.dialogWatcher\.hostArm\(this\.hostGoverned\.process, true, key\);/);
  // …and the respawn re-arm carries it too, or a crashed helper comes back and
  // immediately drops the baseline of the conversation still on screen.
  assert.match(src, /watcher\.hostArm\(proc, true, hostArmKey\(this\.hostGoverned\)\);/);

  for (const f of ['attachment-watcher.js', 'file-dialog-watcher.js']) {
    const w = await readFile(join(AGENT_DIR, 'src', 'os_monitor', f), 'utf8');
    const payload = w.slice(w.indexOf("cmd: 'host_arm'"), w.indexOf("}) + '\\n'"));
    // The whole payload: a process name, an on/off and the digest. A path, a
    // filename, a window title or any free text must have no parameter here it
    // could arrive through.
    assert.equal(/path|filename|title|text|agent/.test(payload), false,
      `${f} must not put anything but process/state/key on the arm channel: ${payload}`);
  }
});

// ── 11. the OneDrive-redirected Desktop ─────────────────────────────────────

test('attachment-watcher.ps1 resolves the REAL Desktop, not a hardcoded $env:USERPROFILE\\Desktop', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.ps1'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
  // On a OneDrive-managed machine the Desktop and Documents special folders are
  // REDIRECTED — here to "C:\Users\<u>\OneDrive - CloudFuze, Inc\Desktop" — so
  // "$env:USERPROFILE\Desktop" points at a stub directory the user's files are
  // not in, and a chip resolved by basename against it silently finds nothing.
  // GetFolderPath is the only thing that answers this correctly.
  assert.match(code, /\[Environment\]::GetFolderPath\('Desktop'\)/);
  assert.match(code, /\[Environment\]::GetFolderPath\('MyDocuments'\)/);
  assert.equal(/\$env:USERPROFILE\\Desktop/.test(code), false,
    'a literal USERPROFILE\\Desktop misses every OneDrive-redirected Desktop');
  assert.equal(/\$env:USERPROFILE\\Documents/.test(code), false,
    'and the same is true of Documents');
  // The recursive fallback has to resolve it the same way, or it reintroduces the
  // bug one function lower down.
  const fallback = code.slice(code.indexOf('function Resolve-Path-ByBasename'));
  assert.match(fallback, /\[Environment\]::GetFolderPath\('Desktop'\)/);
});

test('the running helper reports the OS\'s actual Desktop among its search dirs', async () => {
  if (!win) return;
  // The source check above cannot prove the resolution WORKS on this machine.
  // The helper states its search dirs on its `ready` line, so compare them
  // against what .NET says the Desktop is right now — which on this machine is
  // the OneDrive-redirected one.
  const watcher = new AttachmentWatcher({
    log: { info() {}, warn() {} },
    aiProcessNames: ['ChatGPT'],
  });
  try {
    watcher.start();
    const ready = await tapHelper(watcher).first('ready');
    const dirs = (ready.search_dirs || []).map((d) => String(d).toLowerCase());
    const realDesktop = await desktopPath();
    assert.ok(realDesktop, 'could not determine the Desktop path');
    assert.ok(dirs.includes(realDesktop.toLowerCase()),
      `the real Desktop (${realDesktop}) must be searched; got ${JSON.stringify(ready.search_dirs)}`);
  } finally { watcher.stop(); }
});

// ── harness plumbing ────────────────────────────────────────────────────────

// ── 9c. file-dialog-watcher.ps1's poll loop ─────────────────────────────────
//
// The paperclip path, which had never worked for ANY app. Three stacked defects,
// each on its own enough to emit nothing, all of them unreachable until the stdin
// wedge above was fixed and the loop body ran for the first time:
//
//  1. ATTRIBUTION. Microsoft 365 Copilot and Microsoft Teams are WebView2 shells.
//     The paperclip is an HTML <input type=file>, and Chromium shows that dialog
//     from its BROWSER process — so the #32770 belongs to msedgewebview2.exe, a
//     child of the app, and `Is-AiProcess 'msedgewebview2'` is false. Confirmed
//     live: HKCU\...\Explorer\ComDlg32\LastVisitedPidlMRU, which is where Windows
//     records the executable that opened each common dialog, had
//     msedgewebview2.exe as its most-recent entry, written at the same second as
//     Recent\Test.lnk and the picked .docx's LastAccessTime.
//  2. THE FIELD. The File name control's UIA ControlType is Pane, not Edit or
//     ComboBox, and it supports no ValuePattern/TextPattern/LegacyIAccessible.
//     The old ControlType+ValuePattern query therefore returned the file LIST's
//     grid cells ('Name', 'Size', 'Date modified', …) and never the field.
//  3. THE VALUE. The field holds a bare, extension-hidden basename ('Test'),
//     never a path, so the old Looks-LikePath gate rejected it regardless. The
//     folder lives only in the address breadcrumb.
//
// See tests/helpers/file-dialog-poll-harness.ps1.

test('file-dialog-watcher.ps1: a WebView2 app\'s picker is attributed to the APP, not to msedgewebview2', async () => {
  if (!win) return;
  const obs = await runDialogHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);
  const picks = obs.filter((o) => o.kind === 'file_dialog_pick');

  // The old gate, stated as the harness measured it: this is why every Copilot
  // and Teams pick was dropped.
  assert.equal(at('old-gate-msedgewebview2').is_ai, false,
    'msedgewebview2 is not itself a governed app — which is exactly why the dialog must be resolved through its ancestors');

  // A dialog owned by msedgewebview2(10940), whose parent is M365Copilot(9476).
  assert.equal(at('A1-webview2-dialog-open').tracked, 1, 'the WebView2 picker must be tracked');
  const a = picks.filter((p) => p.pid === 9476 && p.title === 'Open');
  assert.ok(a.length >= 1, 'the WebView2 picker must emit a file_dialog_pick');
  assert.equal(a[0].process, 'M365Copilot',
    'the event must name the governed app — index.js feeds ev.process to identifyAiProcess(), which answers null for msedgewebview2 and would drop it');
  assert.equal(a[0].host_armed, false, 'a catalog AI app is never host_armed');
});

test('file-dialog-watcher.ps1: the picked path is rebuilt from an extension-hidden name plus the breadcrumb', async () => {
  if (!win) return;
  const obs = await runDialogHarness();
  const tmp = (obs.find((o) => o.obs === 'tmpdir') || {}).path;
  assert.ok(tmp, 'harness must report its temp dir');
  const picks = obs.filter((o) => o.kind === 'file_dialog_pick');

  // The field said 'Test'. The answer must be the real file on disk.
  const p = picks.find((x) => x.pid === 9476);
  assert.equal(p.path, join(tmp, 'Test.docx'),
    'a bare, extension-hidden basename must resolve against the address breadcrumb to a real file');

  // Multi-select, quoted — both files, both resolved.
  const multi = picks.filter((x) => x.path === join(tmp, 'Second.xlsx'));
  assert.equal(multi.length, 1, '"a" "b" multi-select must emit each file once');

  // A name that resolves to nothing on disk emits nothing: a half-typed name in a
  // dialog the user then cancelled must never be reported as an upload.
  const bogus = picks.filter((x) => /NoSuchFileAnywhere/.test(x.path || ''));
  assert.deepEqual(bogus, [], 'an unresolvable name must not be emitted');
});

test('file-dialog-watcher.ps1: the ancestor walk stays bounded and does not widen coverage', async () => {
  if (!win) return;
  const obs = await runDialogHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);
  const picks = obs.filter((o) => o.kind === 'file_dialog_pick');

  // An unrelated app's Open dialog is still ignored.
  assert.equal(at('C1-notepad-open').tracked, 0, 'notepad\'s Open dialog must not be tracked');
  assert.deepEqual(picks.filter((p) => p.process === 'notepad'), []);

  // Five hops under a governed app is beyond PROC_WALK_MAX. Without this cap the
  // walk would eventually reach services.exe and attribute arbitrary dialogs to
  // whatever sits above them.
  assert.equal(at('D1-too-deep-open').tracked, 0, 'a governed ancestor beyond the hop cap must not resolve');

  // A brokered picker (PickerHost.exe, whose parent is a service) resolves only
  // through the dialog's OWNER window.
  assert.equal(at('E1-pickerhost-open').tracked, 1, 'a brokered picker must resolve via its owner window');

  // No tick may throw out of the loop — the failure mode that wedged the
  // attachment watcher for a whole day.
  assert.deepEqual(obs.filter((o) => o.threw).map((o) => [o.obs, o.threw]), []);
  assert.deepEqual(obs.filter((o) => o.kind === 'error').map((e) => e.message), []);
});

test('file-dialog-watcher.ps1: Teams pickers stay invisible until armed, then resolve through its WebView2 child', async () => {
  if (!win) return;
  const obs = await runDialogHarness();
  const at = (name) => obs.find((o) => o.obs === name) || assert.fail(`no observation ${name}`);
  const picks = obs.filter((o) => o.kind === 'file_dialog_pick');

  // Unarmed, a Teams picker is an ordinary "send a colleague a file" dialog.
  assert.equal(at('H1-teams-unarmed-open').tracked, 0, 'an UNARMED host app\'s picker must not be tracked');

  // Armed, it resolves — through msedgewebview2(15600) up to ms-teams(15176),
  // the same one-hop shape as Copilot.
  assert.equal(at('H3-teams-armed-open').tracked, 1);
  const t = picks.filter((p) => p.process === 'ms-teams');
  assert.equal(t.length, 1, 'an armed Teams picker must emit exactly once');
  assert.equal(t[0].pid, 15176, 'attributed to the Teams process, not to its WebView2 child');
  assert.equal(t[0].host_armed, true, 'a host-app pick must carry the latched arm state');
});

// A HashSet or list of one serializes as a bare scalar through ConvertTo-Json,
// and an empty one as {}. Normalize before comparing.
function arr(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return [];
  return [v];
}

const harnessRuns = new Map();
function runHarness(name, watcher = 'attachment-watcher.ps1') {
  if (harnessRuns.has(name)) return harnessRuns.get(name);
  const run = new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass',
      '-File', join(AGENT_DIR, 'tests', 'helpers', name),
      '-Ps1', join(AGENT_DIR, 'src', 'os_monitor', watcher),
    ], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`${name} exited ${code}: ${err || out}`));
      const obs = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return { raw: l }; }
      });
      if (!obs.some((o) => o.obs === 'done')) return reject(new Error(`${name} did not finish: ${out}\n${err}`));
      resolve(obs);
    });
  });
  harnessRuns.set(name, run);
  return run;
}

// The arm/baseline state machine, above the poll loop.
const runArmHarness = () => runHarness('attachment-arm-harness.ps1');
// The poll loop body itself, lifted verbatim and driven a tick at a time.
const runPollHarness = () => runHarness('attachment-poll-harness.ps1');
// file-dialog-watcher.ps1's poll loop, same construction.
const runDialogHarness = () => runHarness('file-dialog-poll-harness.ps1', 'file-dialog-watcher.ps1');

// What .NET says the Desktop is on THIS machine — the same call the helper makes,
// so the assertion is "the helper agrees with the OS" rather than a hardcoded
// path that would pass on a non-redirected machine for the wrong reason.
function desktopPath() {
  return new Promise((resolve) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', '[Environment]::GetFolderPath("Desktop")',
    ], { windowsHide: true });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => resolve(''));
    child.on('exit', () => resolve(out.trim()));
  });
}
