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
test.after?.(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

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

test('attachCensus flags: enforcing for the three live-verified surfaces only; the rest report-only', () => {
  const armed = ATTACH_CENSUS_SURFACES.filter((s) => s.enforce && s.verified).map((s) => s.id).sort();
  assert.deepEqual(armed, ['m365_copilot_app', 'teams_agent_chat', 'word_copilot_pane']);
  for (const s of ATTACH_CENSUS_SURFACES) assert.equal(s.enforce, s.verified, `${s.id}: enforce only together with verified`);
  assert.equal(attachCensusSurfaceFor('EXCEL', 'office_copilot_pane').enforce, false, 'Excel: report-only');
  assert.equal(attachCensusSurfaceFor('OUTLOOK', 'outlook_copilot_pane').enforce, false, 'Outlook pane: report-only');
  assert.equal(attachCensusSurfaceFor('ms-teams', 'teams_copilot_composer').enforce, false, 'Teams Copilot tab: report-only');
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

test('fail closed: a cloud-only file and a missing file are HELD with their hold_reason, content never read', async () => {
  const { monitor, calls } = makeMonitor();
  const answers = { 'cloud.docx': { status: 'cloud' }, 'missing.pdf': { status: 'not_found' } };
  monitor.resolveAttachmentFn = async (name) => answers[chipToFilename(name)];
  try {
    census(monitor, { names: ['Remove attachment cloud.docx', 'Remove attachment missing.pdf'] });
    await waitFor(() => calls.enqueued.filter((e) => e.kind === 'file_upload').length === 2, { label: 'both records' });
    const byName = Object.fromEntries(calls.enqueued.filter((e) => e.kind === 'file_upload').map((e) => [e.filename, e]));
    assert.equal(byName['cloud.docx'].enforcement, 'held');
    assert.equal(byName['cloud.docx'].hold_reason, 'cloud_reference');
    assert.equal(byName['missing.pdf'].hold_reason, 'not_found');
    for (const e of Object.values(byName)) { assert.equal(e.content_text, null); assert.equal(e.content_base64, null); }
    assert.deepEqual([...monitor.attachHolds.keys()].sort(), ['cloud.docx', 'missing.pdf']);
    const toast = calls.toasts.at(-1);
    assert.match(toast.message, /already uploaded a copy to OneDrive\/SharePoint/, 'honest about the cloud copy');
  } finally { monitor.stop(); }
});

test('a >5 MB text file is partially scanned: clean -> reported (partially_scanned); sensitive in the first part -> held', async () => {
  const { monitor, calls } = makeMonitor();
  const big = 'x'.repeat(5 * 1024 * 1024 + 100) + '\n';
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
  try {
    let release;
    monitor.resolveAttachmentFn = () => new Promise((r) => { release = r; });
    monitor.on('ui', (ev) => { if (ev.kind === 'block') lines.push(ev); });
    census(monitor, { names: ['Remove attachment slow.pdf'] });
    monitor.enforcer.emit('block', { kind: 'block', process: 'WINWORD', panel: 'office_copilot_pane', patterns: '', reason: 'attachment', filename: 'slow.pdf' });
    assert.equal(lines.at(-1).attach_state, 'scanning');
    release({ status: 'not_found' });
    await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    monitor.enforcer.emit('block', { kind: 'block', process: 'WINWORD', panel: 'office_copilot_pane', patterns: 'x', reason: 'attachment', filename: 'slow.pdf' });
    const last = lines.at(-1);
    assert.equal(last.attach_state, 'held');
    assert.equal(last.hold_reason, 'not_found');
    assert.equal(last.cloud_copy, true);
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

test('SEC 2: a same-named file found by search is metadata only and HELD unverified -- never uploaded', async () => {
  const { monitor, calls } = makeMonitor();
  const namesake = await tmp('namesake-secrets.env', SECRET_TEXT);
  monitor.resolveAttachmentFn = async () => ({ status: 'local', path: namesake, source: 'search', trust: 'weak' });
  try {
    census(monitor, { names: ['Remove attachment namesake-secrets.env'] });
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.content_text, null, 'no content from an unbound name match');
    assert.equal(rec.content_base64, null);
    assert.equal(rec.content_scan.scanned, false);
    assert.equal(rec.enforcement, 'held');
    assert.equal(rec.hold_reason, 'unverified');
    assert.ok(monitor.attachHolds.has('namesake-secrets.env'));
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
  assert.match(idx, /isolate: true, quiet: true, metadataOnly: !bound,/);
  // A real worker round-trip on a bogus .xlsx, while the main loop keeps ticking.
  const bogus = await tmp('bogus.xlsx', Buffer.alloc(6 * 1024 * 1024, 7));
  let ticks = 0; const t = setInterval(() => { ticks++; }, 20);
  const ev = await buildFileUploadEvent({ path: bogus, via: 'composer_census', service: 's', vendor: 'v', processName: 'WINWORD', windowTitle: '', partialScan: true, isolate: true, quiet: true });
  clearInterval(t);
  assert.ok(ev, 'an event is still produced');
  assert.ok(ticks > 0, 'the main loop ran during the extraction');
});

test('SEC 5/9: a census file that could not be scanned (worker failure, unknown extension) is HELD, and holds keep refreshing', async () => {
  const { monitor, calls } = makeMonitor();
  const noext = await tmp('NOEXTENSION', 'AKIAIOSFODNN7EXAMPLE');
  bind(monitor, noext);
  try {
    census(monitor, { names: ['Remove attachment NOEXTENSION'] });
    const first = calls.attachHold.find((c) => c.state === 'on');
    assert.ok(first, 'a provisional hold for EVERY new name, scannable extension or not');
    const rec = await waitFor(() => calls.enqueued.find((e) => e.kind === 'file_upload'), { label: 'the record' });
    assert.equal(rec.enforcement, 'held');
    assert.equal(rec.hold_reason, 'unverified');
    const before = calls.attachHold.length;
    await settle(3300);
    assert.ok(calls.attachHold.length > before, 'the hold is re-stated (dead-man TTL never lapses)');
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
