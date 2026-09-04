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
    hostArm(proc, on) { calls.hostArm.push({ watcher: 'attachment', proc, on }); return true; },
  });
  monitor.dialogWatcher = emitterStub({
    hostArm(proc, on) { calls.hostArm.push({ watcher: 'dialog', proc, on }); return true; },
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
    assert.deepEqual(calls.hostArm, [
      { watcher: 'attachment', proc: 'ms-teams', on: true },
      { watcher: 'dialog', proc: 'ms-teams', on: true },
    ]);

    calls.hostArm.length = 0;
    govOff(monitor);
    assert.equal(monitor.hostGoverned, null);
    assert.deepEqual(calls.hostArm, [
      { watcher: 'attachment', proc: 'ms-teams', on: false },
      { watcher: 'dialog', proc: 'ms-teams', on: false },
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
  assert.match(src, /watcher\.hostArm\(proc, true\);/);
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
  // Both transitions drop the per-window BASELINE. One Teams window holds every
  // conversation, so a baseline taken while an ungoverned one was on screen
  // describes that conversation's history — diffing a newly-governed view
  // against it would report every filename in it as a new attachment.
  assert.match(code, /Reset-Baseline \$procName/);
  assert.match(code, /foreach \(\$h in \$stale\) \{ \$Seen\.Remove\(\$h\); \$SeenProc\.Remove\(\$h\) \}/);
  // …and the only command accepted is host_arm.
  const drain = src.slice(src.indexOf('Drain stdin'), src.indexOf('$fg = Get-ForegroundAiWindow'));
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
  assert.match(code, /hostArmed = \(-not \(Is-AiProcess \$proc\.ProcessName\)\)/);
  assert.match(code, /host_armed = \[bool\]\$entry\.hostArmed/);
  // An already-tracked dialog is never re-gated.
  assert.match(code, /\$known = \$Tracked\.ContainsKey\(\$hwnd\)/);
  assert.match(code, /if \(-not \$known -and -not \(Is-AiProcess \$proc\.ProcessName\) `\r?\n\s*-and -not \(Is-HostArmedForNewDialog \$proc\.ProcessName\)\) \{ continue \}/);
  // The grace window is bounded and short: its only cost is that a picker
  // opened within 5s of leaving a governed conversation is also tracked.
  assert.match(code, /\$HOST_ARM_GRACE_MS = 5000/);
  assert.match(code, /\$HostDisarmedAt\[\$procName\] = \[DateTime\]::UtcNow/);
});
