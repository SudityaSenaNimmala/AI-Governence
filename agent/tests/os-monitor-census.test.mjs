// The composer census + hold-while-attached (2026-09-28) — the Node half.
//
// Pure name/path helpers (attach-census.js) and the OsMonitor reconciliation of
// {"kind":"attachcensus"} lines into KEYED attach holds and file_upload records.
// Nothing here spawns a helper: the monitor is constructed and started for real
// with every child-process owner replaced by a recording stub (same pattern as
// os-monitor-host-files.test.mjs), and the name -> file resolver is scripted
// where a test needs a cloud-only or missing file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const {
  chipToFilename, nameVariants, PathHints, parseLnkTarget, resolveAttachment, isCloudPlaceholder, safeLeafName,
} = await import('../src/os_monitor/attach-census.js');
const { buildFileUploadEvent } = await import('../src/os_monitor/file-handler.js');
const { OsMonitor } = await import('../src/os_monitor/index.js');
const { ATTACH_CENSUS_SURFACES, buildAttachCensusConfig, attachCensusSurfaceFor } = await import('../src/os_monitor/ai-processes.js');

let dir = null;
async function tmp(name, contents) {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'cfai-census-'));
  const p = join(dir, name);
  await writeFile(p, contents);
  return p;
}
test.after?.(async () => {
  // The D7 image scan starts the shared OCR thread (ocr-service.js); under CPU
  // load its init can outlast the test, and a live worker keeps this file's
  // process from exiting. Stop it explicitly.
  try { (await import('../src/os_monitor/ocr-service.js')).shutdownOcr(); } catch { /* not loaded */ }
  if (dir) await rm(dir, { recursive: true, force: true });
});

const SECRET_TEXT = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n';
const CLEAN_TEXT = 'minutes of the tuesday standup\n';

function makeMonitor() {
  const calls = { attachHold: [], enqueued: [], toasts: [], logs: [], paneArm: [], hostArm: [], ui: [] };
  const log = {
    info: (m) => calls.logs.push(['info', String(m)]),
    warn: (m) => calls.logs.push(['warn', String(m)]),
    error: (m) => calls.logs.push(['error', String(m)]),
  };
  const monitor = new OsMonitor({ serverUrl: 'http://127.0.0.1:1', token: 't', log, enforcerEnabled: false });
  const stub = (extra = {}) => Object.assign(new EventEmitter(), { start() {}, stop() {}, ...extra });
  monitor.poller = stub();
  monitor.promptWatcher = stub();
  monitor.enforcer = stub({
    updateBlockPatterns() { return false; },
    attachHold(state, payload) { calls.attachHold.push({ state, ...payload }); return true; },
    tokenize() { return true; }, tokenizeEditHold() { return true; },
  });
  monitor.attachmentWatcher = stub({ hostArm(proc, on, key) { calls.hostArm.push({ proc, on, key }); return true; } });
  monitor.dialogWatcher = stub({
    hostArm(proc, on, key) { calls.hostArm.push({ proc, on, key }); return true; },
    paneArm(proc, on) { calls.paneArm.push({ proc, on }); return true; },
  });
  monitor.reporter = { start() {}, stop() {}, enqueue(e) { calls.enqueued.push(e); } };
  monitor.toast = { start() {}, stop() {}, show(t) { calls.toasts.push(t); } };
  monitor.policySync = { start() {}, stop() {} };
  monitor.featureSync = { start() {}, stop() {} };
  monitor.start();
  // The fleet dlp flag licenses file DLP; these tests model a fleet with it on.
  monitor.running.dlp = true;
  return { monitor, calls };
}
async function waitFor(fn, { timeout = 20_000, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const KEY = 'p:0123456789abcdef0123456789abcdef';
function census(monitor, { names = [], readable = true, key = KEY, process = 'WINWORD', panel = 'office_copilot_pane', surface = 'word_copilot_pane', enforce = true } = {}) {
  monitor.enforcer.emit('attachcensus', { kind: 'attachcensus', process, pid: 4242, panel, surface, surface_key: key, enforce, readable, names });
}
const holdKeyWord = (key = KEY) => `WINWORD|office_copilot_pane|${key}`;
// A path handed to THIS app's picker moments ago -- the only kind of hint whose
// content the census may read (security finding 2).
const bind = (monitor, path, proc = 'WINWORD', pid = 4242) => monitor.pathHints.remember(path, 'pane_file_dialog', { process: proc, pid });

// ── pure helpers ────────────────────────────────────────────────────────────

test('chip labels parse to the file name: dismiss buttons, Word\'s "<ext> <name> <name> <state>" label, plain names', () => {
  assert.equal(chipToFilename('Remove attachment secrets.txt'), 'secrets.txt');
  assert.equal(chipToFilename('txt secrets.txt secrets.txt upload finished'), 'secrets.txt');
  assert.equal(chipToFilename('pdf Q3 plan.pdf Q3 plan.pdf uploading'), 'Q3 plan.pdf');
  assert.equal(chipToFilename('secrets 1.txt'), 'secrets 1.txt');
  assert.equal(chipToFilename('  report.docx  '), 'report.docx');
  assert.equal(chipToFilename(''), '');
});

test('Teams\' " N" rename resolves back to the local name', () => {
  assert.deepEqual(nameVariants('secrets 1.txt'), ['secrets 1.txt', 'secrets.txt']);
  assert.deepEqual(nameVariants('budget 12.xlsx'), ['budget 12.xlsx', 'budget.xlsx']);
  assert.deepEqual(nameVariants('plain.txt'), ['plain.txt']);
  const hints = new PathHints();
  hints.remember('C:\\Users\\x\\Desktop\\secrets.txt', 'clipboard_file_copy');
  assert.equal(hints.lookup('secrets 1.txt')?.path, 'C:\\Users\\x\\Desktop\\secrets.txt');
  assert.equal(hints.lookup('other.txt'), null);
});

test('parseLnkTarget reads a shortcut\'s local base path and refuses anything else', () => {
  // Minimal ShellLinkHeader (0x4C) + LinkInfo with VolumeIDAndLocalBasePath.
  const header = Buffer.alloc(0x4c); header.writeUInt32LE(0x4c, 0); header.writeUInt32LE(0x2, 0x14);   // HasLinkInfo
  const base = Buffer.from('C:\\Users\\x\\Desktop\\secrets.txt\0', 'latin1');
  const info = Buffer.alloc(28); info.writeUInt32LE(28 + base.length + 1, 0); info.writeUInt32LE(28, 4);
  info.writeUInt32LE(1, 8); info.writeUInt32LE(28, 16); info.writeUInt32LE(28 + base.length, 24);
  const lnk = Buffer.concat([header, info, base, Buffer.from([0])]);
  assert.equal(parseLnkTarget(lnk), 'C:\\Users\\x\\Desktop\\secrets.txt');
  assert.equal(parseLnkTarget(Buffer.from('not a shortcut')), null);
  assert.equal(parseLnkTarget(null), null);
});

test('resolveAttachment: hint -> local; OneDrive placeholder -> cloud (never opened); nothing -> not_found', async () => {
  const local = await tmp('resolve-me.txt', CLEAN_TEXT);
  const hints = new PathHints(); hints.remember(local, 'open_file_dialog', { process: 'ChatGPT', pid: 7 });
  const notCloud = async () => false;
  const r1 = await resolveAttachment('Remove attachment resolve-me.txt', { hints, process: 'ChatGPT', pid: 7, searchDirs: [], recent: '', roots: [], placeholder: notCloud });
  assert.deepEqual([r1.status, r1.path, r1.trust], ['local', local, 'bound'], 'a picker path for THIS app is bound');
  const r1b = await resolveAttachment('resolve-me.txt', { hints, process: 'Claude', pid: 9, searchDirs: [], recent: '', roots: [], placeholder: notCloud });
  assert.equal(r1b.trust, 'weak', 'the same path seen for ANOTHER app is not bound');
  // The same file, but under a "OneDrive root" whose attributes say placeholder.
  let asked = 0;
  const r2 = await resolveAttachment('resolve-me.txt', { hints, process: 'ChatGPT', pid: 7, searchDirs: [], recent: '', roots: [], placeholder: async () => { asked++; return true; } });
  assert.equal(r2.status, 'cloud', 'EVERY candidate is attribute-checked, not only under a OneDrive root');
  assert.equal(asked, 1, 'the attribute check ran instead of a read');
  const r3 = await resolveAttachment('no-such-file-7f3a.txt', { hints, searchDirs: [dir], recent: '', roots: [], placeholder: notCloud });
  assert.equal(r3.status, 'not_found');
  // a " 1" rename found by search
  await tmp('renamed.txt', CLEAN_TEXT);
  const r4 = await resolveAttachment('renamed 1.txt', { hints: new PathHints(), searchDirs: [dir], recent: '', roots: [], placeholder: notCloud });
  assert.equal(r4.status, 'local');
  assert.equal(r4.trust, 'weak', 'a folder-search match is never content-trusted');
});

// ── catalog ─────────────────────────────────────────────────────────────────

test('attachCensus flags: enforcing for the armed surfaces only (Teams Copilot tab armed 2026-10-01 at the owner\'s request); the rest report-only', () => {
  const armed = ATTACH_CENSUS_SURFACES.filter((s) => s.enforce && s.verified).map((s) => s.id).sort();
  assert.deepEqual(armed, ['m365_copilot_app', 'teams_agent_chat', 'teams_copilot_tab', 'word_copilot_pane']);
  for (const s of ATTACH_CENSUS_SURFACES) assert.equal(s.enforce, s.verified, `${s.id}: enforce only together with verified`);
  assert.equal(attachCensusSurfaceFor('EXCEL', 'office_copilot_pane').enforce, false, 'Excel: report-only');
  assert.equal(attachCensusSurfaceFor('OUTLOOK', 'outlook_copilot_pane').enforce, false, 'Outlook pane: report-only');
  assert.equal(attachCensusSurfaceFor('ms-teams', 'teams_copilot_composer').enforce, true, 'Teams Copilot tab: enforcing');
  assert.equal(attachCensusSurfaceFor('WINWORD', 'office_copilot_pane').enforce, true);
  assert.deepEqual(buildAttachCensusConfig().map((s) => s.id), ATTACH_CENSUS_SURFACES.map((s) => s.id));
  const enf = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(enf, /CFAI_ATTACH_CENSUS: JSON\.stringify\(buildAttachCensusConfig\(\)\)/);
});

// ── reconciliation ──────────────────────────────────────────────────────────

test('a sensitive file in the Word pane: provisional hold at once, then HELD, reported with attachment_id + enforcement', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('deck-secrets.env', SECRET_TEXT);
  bind(monitor, p);
  try {
    census(monitor, { names: ['Remove attachment deck-secrets.env'] });
    const first = calls.attachHold.find((c) => c.state === 'on');
    assert.ok(first, 'a provisional hold the moment the name appears');
    assert.equal(first.key, holdKeyWord());
    assert.equal(first.surfaceKey, KEY);
    assert.equal(first.panel, 'office_copilot_pane');
    assert.equal(first.ttlMs, 15_000, 'the dead-man TTL');
    assert.equal(first.patterns, '', 'still scanning');
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.via, 'composer_census');
    assert.equal(rec.service, 'Word Copilot');
    assert.equal(rec.surface, 'word_copilot_pane');
    assert.match(rec.attachment_id, /^[0-9a-f-]{36}$/);
    assert.equal(rec.enforcement, 'held');
    assert.equal(rec.hold_reason, 'sensitive_content');
    assert.equal(rec.window_title, '');
    assert.ok(rec.content_text, 'content is uploaded as today');
    const held = calls.attachHold.filter((c) => c.state === 'on').at(-1);
    assert.ok(held.patterns.length > 0, 'the confirmed hold names its patterns');
    assert.ok(!calls.logs.some(([, m]) => m.includes('deck-secrets.env')), 'the census never logs a file name');
    // A send attempt now: the block pairs with the record and reports the real severity.
    calls.enqueued.length = 0;
    monitor.enforcer.emit('block', { kind: 'block', process: 'WINWORD', panel: 'office_copilot_pane', patterns: held.patterns, reason: 'attachment', filename: 'deck-secrets.env' });
    const blk = calls.enqueued.find((e) => e.kind === 'enforcement_block');
    assert.equal(blk.client_event_id, rec.attachment_id);
    assert.equal(blk.highest_severity, rec.severity);
  } finally { monitor.stop(); }
});

test('a clean file is released after its scan; an unreadable census never releases; absent twice releases', async () => {
  const { monitor, calls } = makeMonitor();
  const sec = await tmp('keep-secrets.env', SECRET_TEXT);
  const ok = await tmp('notes.txt', CLEAN_TEXT);
  bind(monitor, sec); bind(monitor, ok);
  try {
    census(monitor, { names: ['Remove attachment keep-secrets.env', 'Remove attachment notes.txt'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both records' });
    const recs = calls.enqueued.filter((e) => e.kind === 'file_upload');
    assert.equal(recs.find((e) => e.filename === 'notes.txt').enforcement, 'reported');
    assert.equal(recs.find((e) => e.filename === 'keep-secrets.env').enforcement, 'held');
    assert.deepEqual([...monitor.attachHolds.keys()], ['keep-secrets.env'], 'only the sensitive file is held');

    calls.attachHold.length = 0;
    for (let i = 0; i < 5; i++) census(monitor, { names: [], readable: false });
    assert.equal(calls.attachHold.filter((c) => c.state === 'off').length, 0, 'unreadable reads never release');
    assert.ok(monitor.attachHolds.has('keep-secrets.env'));

    census(monitor, { names: [] });
    assert.ok(monitor.attachHolds.has('keep-secrets.env'), 'one absent read is not enough');
    census(monitor, { names: [] });
    assert.equal(monitor.attachHolds.has('keep-secrets.env'), false, 'absent on two readable reads -> released');
    assert.deepEqual(calls.attachHold.filter((c) => c.state === 'off').map((c) => c.key), [holdKeyWord()]);
  } finally { monitor.stop(); }
});

test('conversation switch suspends (holds kept under their own key) and returning resumes', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('suspend-secrets.env', SECRET_TEXT);
  bind(monitor, p, 'ms-teams');
  const A = 't:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; const B = 't:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const teams = { process: 'ms-teams', panel: 'teams_composer', surface: 'teams_agent_chat' };
  try {
    census(monitor, { ...teams, key: A, names: ['suspend-secrets 1.env'] });   // Teams " 1" rename
    await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(calls.enqueued.find((e) => e.kind === 'file_upload').service, 'Microsoft Teams (agent)');
    assert.ok(monitor.attachHolds.has('suspend-secrets 1.env'), 'held under the displayed name');
    census(monitor, { ...teams, key: B, names: [] });
    census(monitor, { ...teams, key: B, names: [] });
    assert.equal(monitor.censusSurfaces.get(A).suspended, true, 'the first conversation is suspended');
    assert.ok(monitor.attachHolds.has('suspend-secrets 1.env'), 'another conversation\'s empty draft releases nothing');
    assert.equal(monitor.attachHoldGroups.get(`ms-teams|teams_composer|${A}`)?.surfaceKey, A, 'the hold stays keyed to its conversation');
    census(monitor, { ...teams, key: A, names: ['suspend-secrets 1.env'] });
    assert.equal(monitor.censusSurfaces.get(A).suspended, false, 'returning resumes');
    assert.ok(monitor.attachHolds.has('suspend-secrets 1.env'));
  } finally { monitor.stop(); }
});

test('a REPORT-ONLY surface (Excel pane) reports and never holds', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('excel-secrets.env', SECRET_TEXT);
  bind(monitor, p, 'EXCEL');
  try {
    census(monitor, { process: 'EXCEL', surface: 'office_copilot_pane', enforce: false, names: ['Remove attachment excel-secrets.env'], key: 'p:excel' });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.enforcement, 'reported');
    assert.equal(rec.service, 'Excel Copilot');
    assert.deepEqual(calls.attachHold, [], 'no hold, not even a provisional one');
  } finally { monitor.stop(); }
});

test('browser parity: a cloud-only file and a missing file are ALLOWED and REPORTED with their hold_reason, content never read', async () => {
  const { monitor, calls } = makeMonitor();
  const answers = { 'cloud.docx': { status: 'cloud' }, 'missing.pdf': { status: 'not_found' } };
  monitor.resolveAttachmentFn = async (name) => answers[chipToFilename(name)];
  try {
    census(monitor, { names: ['Remove attachment cloud.docx', 'Remove attachment missing.pdf'] });
    assert.ok(calls.attachHold.some((c) => c.state === 'on'), 'provisional holds while locating');
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both records' });
    const byName = Object.fromEntries(calls.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(byName['cloud.docx'].enforcement, 'reported');
    assert.equal(byName['cloud.docx'].hold_reason, 'cloud_reference');
    assert.equal(byName['missing.pdf'].enforcement, 'reported');
    assert.equal(byName['missing.pdf'].hold_reason, 'not_found');
    for (const e of Object.values(byName)) { assert.equal(e.content_text, null); assert.equal(e.content_base64, null); }
    assert.deepEqual([...monitor.attachHolds.keys()], [], 'the provisional holds were released');
    assert.equal(calls.toasts.length, 0, 'nothing held, nothing to explain');
  } finally { monitor.stop(); }
});

test('browser parity: an unsupported / unreadable local file is ALLOWED and REPORTED with a specific hold_reason', async () => {
  const { monitor, calls } = makeMonitor();
  const blob = await tmp('mystery.qqq', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  const corrupt = await tmp('corrupt.docx', 'not really a docx at all');
  bind(monitor, blob); bind(monitor, corrupt);
  try {
    census(monitor, { names: ['Remove attachment mystery.qqq', 'Remove attachment corrupt.docx'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both records' });
    const byName = Object.fromEntries(calls.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(byName['mystery.qqq'].enforcement, 'reported');
    assert.equal(byName['mystery.qqq'].hold_reason, 'unsupported_type');
    assert.equal(byName['corrupt.docx'].enforcement, 'reported');
    assert.ok(['extraction_failed', 'extraction_timeout', 'encrypted'].includes(byName['corrupt.docx'].hold_reason),
      `unexpected ${byName['corrupt.docx'].hold_reason}`);
    assert.deepEqual([...monitor.attachHolds.keys()], []);
  } finally { monitor.stop(); }
});

test('the scanner\'s not-scanned reasons map to the census hold_reason codes', () => {
  const m = (r) => OsMonitor.censusNotScannedReason(r);
  assert.equal(m('unsupported_format'), 'unsupported_type');
  assert.equal(m('too_large'), 'too_large');
  assert.equal(m('encrypted'), 'encrypted');
  assert.equal(m('extraction_timeout'), 'extraction_timeout');
  assert.equal(m('extraction_failed'), 'extraction_failed');
  assert.equal(m('read_failed'), 'extraction_failed', 'anything unrecognised is an extraction failure');
  assert.equal(m(undefined), 'extraction_failed');
  // The toast copy only ever explains sensitive content now.
  assert.equal(OsMonitor.holdReasonText('sensitive_content', 'aws_access_key_id'), 'contains sensitive data: aws_access_key_id.');
  const src = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('static holdReasonText('), src.indexOf('// The census record for a block'));
  assert.equal(/could not be checked|cloud file with no readable copy/.test(fn), false, 'no fail-closed copy left');
});

test('a text file over the scan cap is partially scanned: clean -> reported (partially_scanned); sensitive in the first part -> held', async () => {
  const { monitor, calls } = makeMonitor();
  // Sized from the scanner's own cap (raised 5 -> 25 MB on 2026-09-30), so the
  // test keeps exercising the partial path whatever the cap is.
  const { CONTENT_SCAN_MAX_BYTES } = await import('../src/os_monitor/classifier.js');
  const big = 'x'.repeat(CONTENT_SCAN_MAX_BYTES + 100) + '\n';
  const clean = await tmp('big-clean.txt', big);
  const dirty = await tmp('big-secret.txt', SECRET_TEXT + big);
  bind(monitor, clean); bind(monitor, dirty);
  try {
    census(monitor, { names: ['Remove attachment big-clean.txt', 'Remove attachment big-secret.txt'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both records' });
    const byName = Object.fromEntries(calls.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(byName['big-clean.txt'].enforcement, 'reported');
    assert.equal(byName['big-clean.txt'].hold_reason, 'partially_scanned');
    assert.equal(byName['big-clean.txt'].content_scan.partial, true);
    assert.equal(byName['big-secret.txt'].enforcement, 'held');
    assert.deepEqual([...monitor.attachHolds.keys()], ['big-secret.txt']);
  } finally { monitor.stop(); }
});

test('the popup payload carries the attachment state: scanning, then held + reason + cloud copy', async () => {
  const { monitor, calls } = makeMonitor();
  const lines = [];
  const p = await tmp('slow-secrets.env', SECRET_TEXT);
  try {
    let release;
    monitor.resolveAttachmentFn = () => new Promise((r) => { release = r; });
    monitor.on('ui', (ev) => { if (ev.kind === 'block') lines.push(ev); });
    census(monitor, { names: ['Remove attachment slow-secrets.env'] });
    monitor.enforcer.emit('block', { kind: 'block', process: 'WINWORD', panel: 'office_copilot_pane', patterns: '', reason: 'attachment', filename: 'slow-secrets.env' });
    assert.equal(lines.at(-1).attach_state, 'scanning');
    release({ status: 'local', path: p, source: 'hint', trust: 'bound' });
    await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    monitor.enforcer.emit('block', { kind: 'block', process: 'WINWORD', panel: 'office_copilot_pane', patterns: 'x', reason: 'attachment', filename: 'slow-secrets.env' });
    const last = lines.at(-1);
    assert.equal(last.attach_state, 'held');
    assert.equal(last.hold_reason, 'sensitive_content');
    assert.equal(last.cloud_copy, true);
    assert.equal(last.text_patterns, '', 'no text finding on this block');
    assert.match(calls.toasts[0].title, /still checking/, 'the block while scanning never claims "contains"');
    const toast = calls.toasts.find((t) => /can't be sent/.test(t.title));
    assert.ok(toast, 'the held toast');
    assert.match(toast.message, /Remove the attachment from the chat before sending\./, 'the browser\'s instruction');
    assert.match(toast.message, /already uploaded a copy to OneDrive\/SharePoint/, 'honest about the cloud copy');
  } finally { monitor.stop(); }
});

test('the provisional hold while scanning is RELEASED when the scan comes back non-sensitive', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('slow-clean.txt', CLEAN_TEXT);
  try {
    let release;
    monitor.resolveAttachmentFn = () => new Promise((r) => { release = r; });
    census(monitor, { names: ['Remove attachment slow-clean.txt'] });
    assert.ok(monitor.attachHolds.has('slow-clean.txt'), 'held while scanning');
    release({ status: 'local', path: p, source: 'hint', trust: 'bound' });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.enforcement, 'reported');
    assert.equal(monitor.attachHolds.has('slow-clean.txt'), false, 'released');
  } finally { monitor.stop(); }
});

test('govstate scope:"pane" arms ONLY the dialog watcher\'s pane route, never Teams\' host arms', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    monitor.enforcer.emit('govstate', { kind: 'govstate', active: true, process: 'WINWORD', pid: 1, scope: 'pane', panel: 'office_copilot_pane', agent: '', agent_id: '' });
    assert.deepEqual(calls.paneArm, [{ proc: 'WINWORD', on: true }]);
    assert.deepEqual(calls.hostArm, []);
    assert.equal(monitor.hostGoverned, null);
    assert.equal(monitor.paneGoverned.process, 'WINWORD');
    monitor.enforcer.emit('govstate', { kind: 'govstate', active: false, process: 'WINWORD', pid: 0, scope: 'pane', panel: '', agent: '', agent_id: '' });
    assert.deepEqual(calls.paneArm.at(-1), { proc: 'WINWORD', on: false });
    assert.equal(monitor.paneGoverned, null);
    assert.deepEqual(calls.hostArm, []);
  } finally { monitor.stop(); }
});

test('a pane picker on an ENFORCING surface only remembers the path; on a report-only pane it reports', async () => {
  const { monitor, calls } = makeMonitor();
  const w = await tmp('word-pick.txt', CLEAN_TEXT);
  const x = await tmp('excel-pick.env', SECRET_TEXT);
  try {
    monitor.dialogWatcher.emit('pane_file_dialog_pick', { kind: 'pane_file_dialog_pick', process: 'WINWORD', pid: 1, path: w });
    await settle(300);
    assert.equal(calls.enqueued.length, 0, 'the census owns Word pane uploads');
    assert.equal(monitor.pathHints.lookup('word-pick.txt')?.path, w);
    monitor.dialogWatcher.emit('pane_file_dialog_pick', { kind: 'pane_file_dialog_pick', process: 'EXCEL', pid: 2, path: x });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the Excel record' });
    assert.equal(rec.via, 'pane_file_dialog');
    assert.equal(rec.service, 'Excel Copilot');
    assert.equal(rec.enforcement, 'reported');
  } finally { monitor.stop(); }
});

test('source: the helper census is gated, bounded, off the poll thread, and never logs names', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const gate = src.slice(src.indexOf('static CensusSurface CensusGovernedNow()'), src.indexOf('static string Sha256Hex('));
  assert.match(gate, /if \(!_fgIsAi \|\| _fgLeftAiTicks != 0 \|\| Disarmed\(\) \|\| string\.IsNullOrEmpty\(_app\)\) return null;/);
  assert.match(gate, /if \(!_fgHostGoverned \|\| !_fgIsPanel\) return null;/, 'Teams: only a governed (agent) conversation');
  assert.match(gate, /if \(!_fgIsPanel \|\| !_fgPanelEnforce \|\| !_fgContentOk\) return null;/, 'panes: enforcing + content-licensed');
  const upd = src.slice(src.indexOf('static void UpdateAttachCensus()'), src.indexOf('static void CensusBackground('));
  assert.match(upd, /var t = new Thread\(\(\) => CensusBackground\(run, gen\)\);/, 'the walk runs on its own thread');
  assert.equal(/FindAll|FindFirst|TreeWalker/.test(upd), false, 'the poll thread never walks the tree');
  assert.match(upd, /if \(cs == null && target\.Style == "teams"\)/, 'Teams continuation is the send-button carry only');
  assert.match(upd, /try \{ var f = _censusRootFinder; ri = f != null \? f\(target\.Style\) : null; \}/, 'the root is resolved on the poll tick and handed to the read');
  assert.match(gate, /if \(!_evidenceDlpOn\) return null;/, 'the M365 app needs the fleet dlp licence');
  const teams = src.slice(src.indexOf('static CensusSnapshot ReadTeamsDraftChips('), src.indexOf('// ── govstate for the Office / Outlook Copilot PANES'));
  assert.match(teams, /aid\.StartsWith\("message-body-", StringComparison\.Ordinal\) \|\| aid\.StartsWith\("attachments-", StringComparison\.Ordinal\)\) continue;/, 'sent (transcript) attachments are never entered');
  assert.match(teams, /if \(\+\+visited > CENSUS_NODE_CAP\) \{ snap\.Readable = false;/, 'a capped walk is unreadable, never "absent"');
  const emit = src.slice(src.indexOf('static void EmitAttachCensus('), src.indexOf('// ── The live read (background thread)'));
  assert.equal(/Emit\("|Console\.Error|log/i.test(emit.replace(/lock \(_emitLock\)/, '')), false, 'names go only to the attachcensus line');
  const js = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  const disp = js.slice(js.indexOf("case 'attachcensus':"), js.indexOf("case 'request_access_offer':"));
  assert.equal(/this\.log/.test(disp), false, 'the dispatcher does not log the census');
});

// ── Security review 2026-09-28 ──────────────────────────────────────────────

test('SEC 1: the placeholder check passes the path out of band -- a U+2019 quote payload cannot run a command', { skip: process.platform !== 'win32' }, async () => {
  const markerName = 'cfai-pwned-' + Date.now() + '.txt';
  const marker = join(process.cwd(), markerName);
  const evil = await tmp(`x\u2019; New-Item -ItemType File -Name ${markerName} ; \u2019.txt`, 'x');
  const r = await isCloudPlaceholder(evil);
  assert.equal(typeof r, 'boolean');
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(marker), false, 'the injected command must not have run');
  const src = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'attach-census.js'), 'utf8');
  assert.match(src, /-LiteralPath \$env:CFAI_ATTR_PATH/);
});

test('SEC 2 / D2: a SENSITIVE same-named file found by search is scanned locally and HELD -- its content is never uploaded', async () => {
  const { monitor, calls } = makeMonitor();
  const namesake = await tmp('namesake-secrets.env', SECRET_TEXT);
  monitor.resolveAttachmentFn = async () => ({ status: 'local', path: namesake, source: 'search', trust: 'weak' });
  try {
    census(monitor, { names: ['Remove attachment namesake-secrets.env'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.content_text, null, 'no content from an unbound name match');
    assert.equal(rec.content_base64, null);
    assert.equal(rec.content_scan.scanned, true, 'scanned locally');
    assert.ok(rec.content_scan.matches.length > 0, 'the scan result (pattern names) travels');
    assert.equal(JSON.stringify(rec).includes('AKIAIOSFODNN7EXAMPLE'), false, 'not one byte of the content leaves');
    assert.equal(rec.enforcement, 'held');
    assert.equal(rec.hold_reason, 'sensitive_content');
    assert.equal(rec.binding, 'weak');
    assert.ok(monitor.attachHolds.has('namesake-secrets.env'));
  } finally { monitor.stop(); }
});

test('D2: a CLEAN same-named file found by search is ALLOWED and reported unverified_location, content never uploaded', async () => {
  const { monitor, calls } = makeMonitor();
  const namesake = await tmp('namesake-notes.txt', CLEAN_TEXT);
  monitor.resolveAttachmentFn = async () => ({ status: 'local', path: namesake, source: 'recent', trust: 'weak' });
  try {
    census(monitor, { names: ['Remove attachment namesake-notes.txt'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.enforcement, 'reported');
    assert.equal(rec.hold_reason, 'unverified_location');
    assert.equal(rec.binding, 'weak');
    assert.equal(rec.content_text, null);
    assert.equal(rec.content_base64, null);
    assert.equal(monitor.attachHolds.has('namesake-notes.txt'), false);
  } finally { monitor.stop(); }
});

test('SEC 2: suffix stripping never beats an exact name; names with separators / traversal are refused', async () => {
  const exact = await tmp('twin 1.txt', CLEAN_TEXT);
  await tmp('twin.txt', SECRET_TEXT);
  const r = await resolveAttachment('twin 1.txt', { hints: new PathHints(), searchDirs: [dir], recent: '', roots: [], placeholder: async () => false });
  assert.equal(r.path, exact, 'the exact name wins over the stripped one');
  for (const bad of ['..\\x.txt', 'a/b.txt', 'C:x.txt', '..', 'x..y.txt']) assert.equal(safeLeafName(bad), false, bad);
  assert.equal((await resolveAttachment('Remove attachment ..\\..\\secret.txt', { searchDirs: [dir], recent: dir, roots: [] })).status, 'not_found');
});

test('SEC 3: with the fleet dlp flag off a census is not acted on at all', async () => {
  const { monitor, calls } = makeMonitor();
  monitor.running.dlp = false;
  try {
    census(monitor, { names: ['Remove attachment x.env'] });
    await settle(200);
    assert.deepEqual(calls.attachHold, []);
    assert.deepEqual(calls.enqueued, []);
    assert.equal(monitor.censusSurfaces.size, 0);
  } finally { monitor.stop(); }
});

test('SEC 5: binary extraction runs in a worker with limits -- the event loop (and the hold refresh) stays free', async () => {
  const src = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'file-handler.js'), 'utf8');
  assert.match(src, /new Worker\(WORKER_URL, \{ workerData: \{ path, ext, maxChars \}, resourceLimits: WORKER_RESOURCE_LIMITS \}\)/);
  assert.match(src, /setTimeout\(\(\) => finish\(TIMED_OUT\), EXTRACTION_BUDGET_MS\)/, 'terminated on budget');
  const idx = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  // Every census match is scanned in the worker; a weak one then has its
  // content stripped before it is reported (D2).
  assert.match(idx, /isolate: true, quiet: true, metadataOnly: false,/);
  assert.match(idx, /if \(weak\) OsMonitor\.stripCensusContent\(fileEvent, \{ weak: true \}\);/);
  // A real worker round-trip on a bogus .xlsx, while the main loop keeps ticking.
  const bogus = await tmp('bogus.xlsx', Buffer.alloc(6 * 1024 * 1024, 7));
  let ticks = 0; const t = setInterval(() => { ticks++; }, 20);
  const ev = await buildFileUploadEvent({ path: bogus, via: 'composer_census', service: 's', vendor: 'v', processName: 'WINWORD', windowTitle: '', partialScan: true, isolate: true, quiet: true });
  clearInterval(t);
  assert.ok(ev, 'an event is still produced');
  assert.ok(ticks > 0, 'the main loop ran during the extraction');
});

test('SEC 5/9 (browser parity): a census file that could not be scanned is provisionally held, then RELEASED and reported; a real hold keeps refreshing', async () => {
  const { monitor, calls } = makeMonitor();
  const noext = await tmp('NOEXTENSION', 'AKIAIOSFODNN7EXAMPLE');
  const sec = await tmp('refresh-secrets.env', SECRET_TEXT);
  bind(monitor, noext); bind(monitor, sec);
  try {
    census(monitor, { names: ['Remove attachment NOEXTENSION'] });
    const first = calls.attachHold.find((c) => c.state === 'on');
    assert.ok(first, 'a provisional hold for EVERY new name, scannable extension or not');
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.enforcement, 'reported');
    assert.equal(rec.hold_reason, 'unsupported_type');
    assert.equal(monitor.attachHolds.has('NOEXTENSION'), false, 'an unscannable file is allowed');
    census(monitor, { names: ['Remove attachment NOEXTENSION', 'Remove attachment refresh-secrets.env'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'the second record' });
    assert.ok(monitor.attachHolds.has('refresh-secrets.env'));
    const before = calls.attachHold.length;
    await settle(3300);
    assert.ok(calls.attachHold.length > before, 'the hold is re-stated (dead-man TTL never lapses)');
  } finally { monitor.stop(); }
});

// ── 2026-09-30: attribution, the double record, pasted images ───────────────

test('A6: the census line\'s agent attribution lands on the M365 Copilot app file row', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('m365-notes.txt', CLEAN_TEXT);
  bind(monitor, p, 'M365Copilot', 4242);
  try {
    census(monitor, {
      process: 'M365Copilot', panel: '', surface: 'm365_copilot_app', key: 'm:abc', names: ['Remove attachment m365-notes.txt'],
    });
    // the attribution arrives on the census line itself
    bind(monitor, await tmp('m365-agent.txt', CLEAN_TEXT), 'M365Copilot', 4242);
    monitor.enforcer.emit('attachcensus', {
      kind: 'attachcensus', process: 'M365Copilot', pid: 4242, panel: '', surface: 'm365_copilot_app', surface_key: 'm:abc2',
      enforce: true, readable: true, names: ['Remove attachment m365-agent.txt'], agent: 'Researcher', agent_id: 'row-17', agent_src: 'row',
    });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload' && e.filename === 'm365-agent.txt'), { label: 'the attributed record' });
    assert.equal(rec.agent_name, 'Researcher');
    assert.equal(rec.agent_id, 'row-17');
    assert.equal(rec.agent_scope, 'agent');
    assert.equal(rec.surface, 'm365_copilot_app', 'the census surface id, not overwritten');
    const plain = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload' && e.filename === 'm365-notes.txt'), { label: 'the plain record' });
    assert.equal(plain.agent_name, undefined, 'no agent_src -> no agent keys at all');
  } finally { monitor.stop(); }
});

test('A5: an attachment block whose prompt text is ALSO sensitive files a second prompt_submit record, same attribution, names only', async () => {
  const { monitor, calls } = makeMonitor();
  const lines = [];
  monitor.on('ui', (ev) => { if (ev.kind === 'block') lines.push(ev); });
  try {
    monitor.enforcer.emit('block', {
      kind: 'block', process: 'M365Copilot', patterns: 'aws_access_key_id', reason: 'attachment', filename: 'keys.env',
      text_patterns: 'us_ssn,credit_card,us_ssn', agent: 'Researcher', agent_id: 'row-17', agent_src: 'row', surface: 'm365_copilot',
    });
    const blocks = calls.enqueued.filter((e) => e.kind === 'enforcement_block');
    assert.equal(blocks.length, 2);
    const [file, text] = [blocks.find((b) => b.blocked_for === 'file_upload'), blocks.find((b) => b.blocked_for === 'prompt_submit')];
    assert.equal(file.mechanism, 'attachment_hold');
    assert.equal(text.mechanism, 'keystroke_block');
    assert.deepEqual(text.matches.map((m) => m.pattern), ['us_ssn', 'credit_card']);
    for (const k of ['agent_name', 'agent_id', 'agent_scope', 'surface']) assert.equal(text[k], file[k], k);
    assert.equal(text.agent_name, 'Researcher');
    assert.equal(lines.at(-1).text_patterns, 'us_ssn,credit_card', 'the dialog is told');
    assert.match(calls.toasts.at(-1).message, /also contains us_ssn, credit_card/);
    // …and a plain attachment block stays ONE record.
    calls.enqueued.length = 0;
    monitor.enforcer.emit('block', { kind: 'block', process: 'M365Copilot', patterns: 'aws_access_key_id', reason: 'attachment', filename: 'keys2.env' });
    assert.equal(calls.enqueued.filter((e) => e.kind === 'enforcement_block').length, 1);
  } finally { monitor.stop(); }
  const dlg = readFileSync(join(AGENT_DIR, 'electron', 'renderer', 'block-dialog.js'), 'utf8');
  assert.match(dlg, /Your message also contains \$\{textPatterns\.join\(', '\)\}/);
  assert.match(dlg, /title: "This file can't be sent"/);
  assert.match(dlg, /Remove the attachment from the chat before sending\./);
  assert.equal(/HOLD_REASON_TEXT|could not be checked/.test(dlg), false, 'the fail-closed copy is gone');
});

test('D7: a pasted image binds to the next image chip in THAT app, is scanned, then deleted; a stranger path is refused', async () => {
  const { mkdir } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const { randomUUID } = await import('node:crypto');
  const { isPasteImagePath, sweepPasteDir, PathHints: PH } = await import('../src/os_monitor/attach-census.js');
  const { monitor, calls } = makeMonitor();
  if (!dir) await tmp('seed.txt', 'x');
  const pdir = join(dir, 'paste');
  await mkdir(pdir, { recursive: true });
  monitor.pasteDir = pdir;
  const img = join(pdir, randomUUID() + '.png');
  // a valid 1x1 PNG
  await writeFile(img, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  try {
    assert.equal(isPasteImagePath(img, pdir), true);
    assert.equal(isPasteImagePath(join(dir, 'seed.txt'), pdir), false, 'outside the paste dir');
    assert.equal(isPasteImagePath(join(pdir, 'evil.png'), pdir), false, 'not a uuid name');
    // a stranger path is ignored
    monitor.enforcer.emit('pastehint', { kind: 'pastehint', via: 'clipboard_image', process: 'M365Copilot', pid: 4242, path: join(dir, 'seed.txt') });
    assert.equal(monitor.pathHints.get('seed.txt'), null);
    monitor.enforcer.emit('pastehint', { kind: 'pastehint', via: 'clipboard_image', process: 'M365Copilot', pid: 4242, path: img });
    const hint = monitor.pathHints.lookup(img.split(/[\\/]/).pop());
    assert.equal(hint?.via, 'clipboard_image');
    assert.equal(PH.isBound(hint, { process: 'M365Copilot', pid: 4242 }), true, 'clipboard_image is a bound via');
    assert.equal(PH.isBound(hint, { process: 'ChatGPT', pid: 1 }), false, 'but only for the app it was pasted into');
    // a non-image chip does not claim it
    const nonImage = await resolveAttachment('notes.txt', { hints: monitor.pathHints, process: 'M365Copilot', pid: 4242, searchDirs: [], recent: '', roots: [], placeholder: async () => false });
    assert.equal(nonImage.status, 'not_found');
    // the image chip does -- through the real census path
    monitor.resolveAttachmentFn = (name, opts) => resolveAttachment(name, { ...opts, searchDirs: [], recent: '', roots: [], placeholder: async () => false });
    census(monitor, { process: 'M365Copilot', panel: '', surface: 'm365_copilot_app', key: 'm:img', names: ['Remove attachment image.png'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the image record' });
    assert.equal(rec.filename, 'image.png', 'the chip name, not our temp name');
    assert.equal(rec.binding, undefined, 'bound -- not a weak match');
    assert.notEqual(rec.hold_reason, 'not_found');
    assert.equal(existsSync(img), false, 'the temp file is deleted after the scan');
    assert.ok(!calls.logs.some(([, m]) => m.includes(pdir)), 'the paste path is never logged');
    // the startup sweep clears leftovers
    const stale = join(pdir, randomUUID() + '.bmp');
    await writeFile(stale, 'BM');
    assert.equal(sweepPasteDir({ dir: pdir }), 1);
    assert.equal(existsSync(stale), false);
  } finally { monitor.stop(); }
});

test('SEC 6: a file that leaves a draft and comes back is re-held from its verdict at once, without a rescan or second report', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('return-secrets.env', SECRET_TEXT);
  bind(monitor, p);
  try {
    census(monitor, { names: ['Remove attachment return-secrets.env'] });
    await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    census(monitor, { names: [] }); census(monitor, { names: [] });
    assert.equal(monitor.attachHolds.has('return-secrets.env'), false);
    calls.enqueued.length = 0; calls.attachHold.length = 0;
    census(monitor, { names: ['Remove attachment return-secrets.env'] });
    const re = calls.attachHold.find((c) => c.state === 'on');
    assert.ok(re && re.patterns.length > 0, 're-held with its known patterns immediately');
    await settle(300);
    assert.equal(calls.enqueued.length, 0, 'no second report');
  } finally { monitor.stop(); }
});

test('SEC 12: the census routes put no file name or path in any log line', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('quiet-secrets.env', SECRET_TEXT);
  bind(monitor, p);
  monitor.resolveAttachmentFn = async () => { throw Object.assign(new Error('boom ' + p), { code: 'EBOOM' }); };
  try {
    census(monitor, { names: ['Remove attachment quiet-secrets.env'] });
    await settle(300);
    assert.ok(calls.logs.some(([, m]) => m.includes('EBOOM')), 'the error CODE is logged');
    assert.equal(calls.logs.some(([, m]) => m.includes('quiet-secrets') || m.includes(dir)), false, 'never the name or path');
  } finally { monitor.stop(); }
  const js = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(js, /else if \(line\.includes\('"kind":"attachcensus"'\)\) this\.log\?\.warn\('enforcer: malformed attachcensus line dropped'\);/);
});

test('SEC 13: the .lnk parser prefers the Unicode base path and refuses UNC targets', () => {
  const header = Buffer.alloc(0x4c); header.writeUInt32LE(0x4c, 0); header.writeUInt32LE(0x2, 0x14);
  const uni = Buffer.from('C:\\Users\\x\\D\u00e9sktop\\f.txt\0', 'utf16le');
  const ansi = Buffer.from('C:\\WRONG.txt\0', 'latin1');
  const hsize = 0x24;
  const info = Buffer.alloc(hsize);
  info.writeUInt32LE(hsize + ansi.length + uni.length, 0); info.writeUInt32LE(hsize, 4); info.writeUInt32LE(1, 8);
  info.writeUInt32LE(hsize, 16); info.writeUInt32LE(0, 24); info.writeUInt32LE(hsize + ansi.length, 0x1c); info.writeUInt32LE(0, 0x20);
  assert.equal(parseLnkTarget(Buffer.concat([header, info, ansi, uni])), 'C:\\Users\\x\\D\u00e9sktop\\f.txt');
  const unc = Buffer.from('\\\\server\\share\\f.txt\0', 'latin1');
  const info2 = Buffer.alloc(28); info2.writeUInt32LE(28 + unc.length, 0); info2.writeUInt32LE(28, 4); info2.writeUInt32LE(1, 8); info2.writeUInt32LE(28, 16);
  assert.equal(parseLnkTarget(Buffer.concat([header, info2, unc])), null);
});

test('SEC 11/16: pane picker latch binds to the pane window; the helper builds the hold key itself', () => {
  const ps = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'file-dialog-watcher.ps1'), 'utf8');
  assert.match(ps, /if \(\$want -ne 0 -and \$ownerHwnd -ne \$want\) \{ return \$false \}/);
  assert.match(ps, /Is-PaneArmedForNewDialog \$pn \(Get-OwnerHwnd \$hwnd\)/);
  const enf = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const stdin = enf.slice(enf.indexOf('static void StdinLoop()'), enf.indexOf('static void PumpLoop()'));
  assert.equal(/ExtractJsonString\(line, "key"\)/.test(stdin), false, 'the caller-supplied key is ignored');
  assert.match(enf, /static string AttachHoldKey\(bool egress, string egressSurface, string process, string panel, string surfaceKey\)/);
});

// ── Round 2 (2026-09-30): review fixes ──────────────────────────────────────

const M365 = { process: 'M365Copilot', panel: '', surface: 'm365_copilot_app' };
const fakeScan = (path, { sensitive = false, cs = null } = {}) => ({
  kind: 'file_upload', via: 'composer_census', service: 's', vendor: null, process_name: 'M365Copilot', window_title: '',
  filename: path.split(/[\\/]/).pop(), size: 10, size_bucket: '<1KB', mime_type: 'image/png', extension: '.png',
  file_class: 'image', severity: sensitive ? 'critical' : 'low', reason: 'r',
  content_scan: cs || (sensitive
    ? { scanned: true, via: 'ocr', matchCount: 1, matches: [{ pattern: 'aws-access-key', severity: 'critical', count: 1 }], contentSeverity: 'critical' }
    : { scanned: true, via: 'ocr', matchCount: 0, matches: [], contentSeverity: null }),
  content_text: null, content_base64: 'QUFBQQ==',
});
async function pasteSetup(monitor) {
  const { mkdir } = await import('node:fs/promises');
  const { randomUUID } = await import('node:crypto');
  if (!dir) await tmp('seed.txt', 'x');
  const pdir = join(dir, 'paste-' + randomUUID().slice(0, 8));
  await mkdir(pdir, { recursive: true });
  monitor.pasteDir = pdir;
  const make = async () => { const p = join(pdir, randomUUID() + '.png'); await writeFile(p, 'png'); return p; };
  const hint = (extra) => monitor.enforcer.emit('pastehint', { kind: 'pastehint', via: 'clipboard_image', process: 'M365Copilot', pid: 4242, ...extra });
  return { pdir, make, hint };
}

test('M3 correction: content severity decides, never the merged filename class; credential file types hold by name alone', async () => {
  const { workbook } = await import('./helpers/office-fixtures.mjs');
  const { monitor, calls } = makeMonitor();
  const csv = await tmp('team.csv', 'name,role\nann,dev\nbob,qa\n');
  const xlsx = await tmp('budget.xlsx', workbook([['item', 'cost'], ['chairs', 120]], 'xlsx'));
  const pfx = await tmp('certs.pfx', Buffer.from([0x30, 0x82, 0x01, 0x02, 9, 9, 9]));
  for (const p of [csv, xlsx, pfx]) bind(monitor, p);
  try {
    census(monitor, { names: ['Remove attachment team.csv', 'Remove attachment budget.xlsx', 'Remove attachment certs.pfx'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 3, { label: 'three records' });
    const by = Object.fromEntries(calls.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(by['team.csv'].enforcement, 'reported', 'a clean table is not "sensitive content"');
    assert.equal(by['budget.xlsx'].enforcement, 'reported');
    assert.equal(by['certs.pfx'].enforcement, 'held');
    assert.equal(by['certs.pfx'].hold_reason, 'sensitive_filename');
    assert.deepEqual([...monitor.attachHolds.keys()], ['certs.pfx']);
    assert.equal(calls.toasts.some((t) => /tabular_data/.test(t.message)), false, 'no "contains sensitive data: tabular_data"');
  } finally { monitor.stop(); }
  // A cloud-only key file holds by name too; a keyword name does not.
  const { monitor: m2, calls: c2 } = makeMonitor();
  const answers = { id_rsa: { status: 'cloud' }, 'secret-santa.txt': { status: 'cloud' } };
  m2.resolveAttachmentFn = async (name) => answers[chipToFilename(name)];
  try {
    census(m2, { names: ['Remove attachment id_rsa', 'Remove attachment secret-santa.txt'] });
    await waitFor(() => c2.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'two records' });
    const by = Object.fromEntries(c2.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(by.id_rsa.hold_reason, 'sensitive_filename');
    assert.equal(by['secret-santa.txt'].enforcement, 'reported');
    assert.equal(by['secret-santa.txt'].hold_reason, 'cloud_reference');
  } finally { m2.stop(); }
});

test('S2: a scanner that THROWS is reported extraction_failed and its provisional hold released', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('boom.docx', 'x'); bind(monitor, p);
  monitor.buildFileUploadEventFn = async () => { throw Object.assign(new Error('boom ' + p), { code: 'EBOOM2' }); };
  try {
    census(monitor, { names: ['Remove attachment boom.docx'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.enforcement, 'reported');
    assert.equal(rec.hold_reason, 'extraction_failed');
    assert.equal(monitor.attachHolds.has('boom.docx'), false);
    assert.equal(calls.logs.some(([, m]) => m.includes('boom.docx') || m.includes(p)), false);
  } finally { monitor.stop(); }
});

test('(a) a SUSPICIOUS unscannable file is held suspicious_unscannable; a plain unsupported one passes', async () => {
  const { monitor, calls } = makeMonitor();
  const bomb = await tmp('bomb.zip', 'x'); const odd = await tmp('odd.qqq', 'x');
  bind(monitor, bomb); bind(monitor, odd);
  monitor.buildFileUploadEventFn = async ({ path }) => fakeScan(path, {
    cs: path.endsWith('.zip')
      ? { scanned: false, reason: 'extraction_failed', suspicious: true, suspicious_reason: 'decompression_ratio' }
      : { scanned: false, reason: 'unsupported_format' },
  });
  try {
    census(monitor, { names: ['Remove attachment bomb.zip', 'Remove attachment odd.qqq'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'two records' });
    const by = Object.fromEntries(calls.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(by['bomb.zip'].enforcement, 'held');
    assert.equal(by['bomb.zip'].hold_reason, 'suspicious_unscannable');
    assert.equal(monitor.attachHolds.get('bomb.zip').patterns, 'decompression_ratio');
    assert.equal(by['odd.qqq'].enforcement, 'reported');
    assert.equal(by['odd.qqq'].hold_reason, 'unsupported_type');
    assert.match(calls.toasts.at(-1).message, /could not be safely checked \(decompression_ratio\)/);
  } finally { monitor.stop(); }
  const idx = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const chip = idx.slice(idx.indexOf("this.attachmentWatcher.on('attachment_appeared'"), idx.indexOf("this.attachmentWatcher.on('attachment_disappeared'"));
  assert.match(chip, /const suspicious = cs\?\.suspicious === true;/, 'the chip route holds on it too');
});

test('S3: a failed placeholder check is its own reported reason, never "cloud"; resolveAttachment says so', async () => {
  const p = await tmp('ph.txt', CLEAN_TEXT);
  const hints = new PathHints(); hints.remember(p, 'open_file_dialog', { process: 'ChatGPT', pid: 7 });
  const r = await resolveAttachment('ph.txt', { hints, process: 'ChatGPT', pid: 7, searchDirs: [], recent: '', roots: [], placeholder: async () => 'error' });
  assert.equal(r.status, 'placeholder_check_failed');
  const { monitor, calls } = makeMonitor();
  monitor.resolveAttachmentFn = async () => ({ status: 'placeholder_check_failed', source: 'hint' });
  try {
    census(monitor, { names: ['Remove attachment ph.txt'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.deepEqual([rec.enforcement, rec.hold_reason], ['reported', 'placeholder_check_failed']);
  } finally { monitor.stop(); }
});

test('(b) a pasted image is scanned locally: content uploaded ONLY when held; temp files deleted; no name search', async () => {
  const { existsSync } = await import('node:fs');
  const { monitor, calls } = makeMonitor();
  const { make, hint } = await pasteSetup(monitor);
  const clean = await make(); const dirty = await make();
  let resolverCalls = 0;
  monitor.resolveAttachmentFn = async () => { resolverCalls++; return { status: 'not_found' }; };
  monitor.buildFileUploadEventFn = async ({ path }) => fakeScan(path, { sensitive: path === dirty });
  try {
    hint({ state: 'saved', path: clean, paste_ms: Date.now() - 50 });
    census(monitor, { ...M365, key: 'm:b1', names: ['Remove attachment image.png'] });
    const r1 = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'clean record' });
    assert.equal(r1.enforcement, 'reported');
    assert.equal(r1.content_base64, null, 'clean paste: content NOT uploaded');
    assert.equal(r1.binding, undefined, 'not a weak match');
    assert.equal(r1.filename, 'image.png');
    assert.equal(existsSync(clean), false);
    hint({ state: 'saved', path: dirty, paste_ms: Date.now() - 50 });
    census(monitor, { ...M365, key: 'm:b2', names: ['Remove attachment image.png'] });
    const r2 = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload' && e.enforcement === 'held'), { label: 'held record' });
    assert.equal(r2.content_base64, 'QUFBQQ==', 'held paste: content uploaded');
    assert.equal(existsSync(dirty), false);
    assert.equal(resolverCalls, 0, 'a bound paste never reaches the name search (or its placeholder check)');
  } finally { monitor.stop(); }
});

test('M1: clean paste -> removed -> a SENSITIVE paste under the same name is rescanned and held; two image.png are two records', async () => {
  const { monitor, calls } = makeMonitor();
  const { make, hint } = await pasteSetup(monitor);
  const a = await make(); const b = await make();
  monitor.resolveAttachmentFn = async () => ({ status: 'not_found' });
  monitor.buildFileUploadEventFn = async ({ path }) => fakeScan(path, { sensitive: path === b });
  const K = 'm:m1';
  try {
    hint({ state: 'saved', path: a, paste_ms: Date.now() - 50 });
    census(monitor, { ...M365, key: K, names: ['Remove attachment image.png'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 1, { label: 'first' });
    census(monitor, { ...M365, key: K, names: [] }); census(monitor, { ...M365, key: K, names: [] });
    hint({ state: 'saved', path: b, paste_ms: Date.now() - 50 });
    census(monitor, { ...M365, key: K, names: ['Remove attachment image.png'] });
    const r2 = await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload')[1], { label: 'second (rescanned)' });
    assert.equal(r2.enforcement, 'held');
    assert.ok(monitor.attachHolds.has('image.png'));
  } finally { monitor.stop(); }
  const { monitor: m2, calls: c2 } = makeMonitor();
  const s2 = await pasteSetup(m2);
  const x = await s2.make(); const y = await s2.make();
  m2.resolveAttachmentFn = async () => ({ status: 'not_found' });
  m2.buildFileUploadEventFn = async ({ path }) => fakeScan(path, { sensitive: path === y });
  try {
    s2.hint({ state: 'saved', path: x, paste_ms: Date.now() - 80 });
    s2.hint({ state: 'saved', path: y, paste_ms: Date.now() - 40 });
    census(m2, { ...M365, key: 'm:two', names: ['Remove attachment image.png', 'Remove attachment image.png'] });
    await waitFor(() => c2.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both scanned' });
    const recs = c2.enqueued.filter((e) => e.kind === 'file_upload');
    assert.deepEqual(recs.map((e) => e.enforcement).sort(), ['held', 'reported']);
    assert.notEqual(recs[0].attachment_id, recs[1].attachment_id);
    assert.deepEqual([...m2.attachHolds.keys()], ['image.png (2)'], 'the second instance is held on its own');
  } finally { m2.stop(); }
});

test('M1: a cached FILE verdict is only kept when path + size + mtime still match', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('changing.txt', CLEAN_TEXT); bind(monitor, p);
  try {
    census(monitor, { names: ['Remove attachment changing.txt'] });
    await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'first' });
    census(monitor, { names: [] }); census(monitor, { names: [] });
    await writeFile(p, SECRET_TEXT); bind(monitor, p);
    calls.enqueued.length = 0;
    census(monitor, { names: ['Remove attachment changing.txt'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'rescanned' });
    assert.equal(rec.enforcement, 'held', 'the changed file was rescanned, not waved through on the old verdict');
  } finally { monitor.stop(); }
});

test('M2: chip BEFORE the saved hint waits (held) and binds; a stale / staged hint never binds photo.png; too_large skips the name search', async () => {
  const { monitor, calls } = makeMonitor();
  const { make, hint } = await pasteSetup(monitor);
  const late = await make();
  let resolverCalls = 0;
  monitor.resolveAttachmentFn = async () => { resolverCalls++; return { status: 'not_found' }; };
  monitor.buildFileUploadEventFn = async ({ path }) => fakeScan(path, { sensitive: true });
  try {
    const t0 = Date.now();
    hint({ state: 'pending', paste_ms: t0 });
    census(monitor, { ...M365, key: 'm:m2', names: ['Remove attachment image.png'] });
    assert.ok(monitor.attachHolds.has('image.png'), 'provisionally held while the image is saved');
    await settle(300);
    assert.equal(calls.enqueued.length, 0, 'still waiting for the saved file');
    hint({ state: 'saved', path: late, paste_ms: t0 });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'bound record' });
    assert.equal(rec.enforcement, 'held');
    assert.equal(resolverCalls, 0, 'no weak name search for a pasted chip');
  } finally { monitor.stop(); }

  const { monitor: m2, calls: c2 } = makeMonitor();
  const s2 = await pasteSetup(m2);
  const stale = await s2.make();
  let resolved = 0;
  m2.resolveAttachmentFn = async () => { resolved++; return { status: 'not_found' }; };
  try {
    s2.hint({ state: 'saved', path: stale, paste_ms: Date.now() - 30_000 });
    census(m2, { ...M365, key: 'm:stale', names: ['Remove attachment photo.png'] });
    await waitFor(() => c2.enqueued.find((e) => e.kind === 'file_upload'), { label: 'photo record' });
    assert.equal(resolved, 1, 'resolved by name, not by the stale paste');
    const staged = await s2.make();
    s2.hint({ state: 'saved', path: staged, paste_ms: Date.now() - 100, staged: true });
    census(m2, { ...M365, key: 'm:staged', names: ['Remove attachment photo2.png'] });
    await waitFor(() => c2.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'second photo record' });
    assert.equal(resolved, 2, 'a staged clipboard image never claims a real file name');
    const h = m2.pathHints.takeClipboardImage({ process: 'M365Copilot', pid: 4242, appearedAt: Date.now(), chipName: 'image.png' });
    assert.ok(h && h.staged, 'but it does bind a generically named chip');
  } finally { m2.stop(); }

  const { monitor: m3, calls: c3 } = makeMonitor();
  await pasteSetup(m3);
  let r3 = 0;
  m3.resolveAttachmentFn = async () => { r3++; return { status: 'not_found' }; };
  try {
    const t = Date.now();
    m3.enforcer.emit('pastehint', { kind: 'pastehint', via: 'clipboard_image', process: 'M365Copilot', pid: 4242, state: 'pending', paste_ms: t });
    m3.enforcer.emit('pastehint', { kind: 'pastehint', via: 'clipboard_image', process: 'M365Copilot', pid: 4242, state: 'too_large', paste_ms: t });
    census(m3, { ...M365, key: 'm:big', names: ['Remove attachment image.png'] });
    const rec = await waitFor(() => c3.enqueued.find((e) => e.kind === 'file_upload'), { label: 'too_large record' });
    assert.deepEqual([rec.enforcement, rec.hold_reason], ['reported', 'too_large']);
    assert.equal(r3, 0);
  } finally { m3.stop(); }
});

test('S5: a block while the file is still being checked is provisional: attach_state scanning, no matches, no severity', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    monitor.resolveAttachmentFn = () => new Promise(() => {});
    census(monitor, { names: ['Remove attachment pending.pdf'] });
    monitor.enforcer.emit('block', { kind: 'block', process: 'WINWORD', panel: 'office_copilot_pane', patterns: '', reason: 'attachment', filename: 'pending.pdf' });
    const blk = calls.enqueued.find((e) => e.kind === 'enforcement_block');
    assert.equal(blk.attach_state, 'scanning');
    assert.deepEqual(blk.matches, []);
    assert.equal(blk.highest_severity, null);
  } finally { monitor.stop(); }
});

test('L1/L3: the paste dir is swept on a timer, cleared on stop; stop() shuts the OCR thread; archive entries stripped', () => {
  const src = readFileSync(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /this\.pasteSweepTimer = setInterval\(\(\) => sweepPasteDir\(\{ dir: this\.pasteDir, olderThanMs: PASTE_SWEEP_AGE_MS \}\), PASTE_SWEEP_EVERY_MS\);/);
  assert.match(src, /if \(this\.pasteSweepTimer\) \{ clearInterval\(this\.pasteSweepTimer\); this\.pasteSweepTimer = null; \}/);
  assert.match(src, /try \{ shutdownOcr\(\); \} catch/);
  // stop() clears BOTH routing timers (the leaked 60s interval kept test processes alive)
  assert.match(src, /if \(this\._routingRulesInterval\) \{ clearInterval\(this\._routingRulesInterval\); this\._routingRulesInterval = null; \}/);
  assert.match(src, /const \{ error: _err, captureTruncated: _trunc, entries: _entries, \.\.\.rest \} = fileEvent\.content_scan;/);
});
