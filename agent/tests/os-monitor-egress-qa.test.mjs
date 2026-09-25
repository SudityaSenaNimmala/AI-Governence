// QA pass over the Outlook + OneDrive/SharePoint egress surfaces.
//
// A COMPANION to os-monitor-egress.test.mjs, not a replacement: that file
// establishes the feature's contract, this one attacks the edges of it. Every
// test here exists because it was written while trying to break something, and
// three of them are regressions for bugs that were live when this pass started
// (see the REGRESSION notes).
//
// ── WHY THE HOME DIRECTORY IS REDIRECTED FIRST ──────────────────────────────
//
// The Node side's EGRESS_PATH is derived from homedir() at module load and has
// no env override (the three .ps1 watchers do, via CFAI_EGRESS_PATH). Driving
// #syncEgressPolicy for real therefore means writing egress-surfaces.json — and
// writing the REAL one would stamp on the policy of whatever agent is running on
// the machine running the tests. Redirecting USERPROFILE/HOME before the import
// puts that file inside this test's own temp dir instead, which is what lets the
// malformed-policy cases below be EXERCISED rather than asserted about by
// reading the source. It must happen before the first import of index.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE_HOME = mkdtempSync(join(tmpdir(), 'cfai-qa-home-'));
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

const { OsMonitor } = await import('../src/os_monitor/index.js');
const { EGRESS_PATH } = await import('../src/os_monitor/blocked-agents-sync.js');
const { SyncWatcher } = await import('../src/os_monitor/sync-watcher.js');

// The redirect has to have actually taken, or every policy test below would be
// writing to the developer's real state directory and passing for that reason.
assert.ok(EGRESS_PATH.startsWith(FAKE_HOME),
  `the policy path must be inside the test sandbox, got ${EGRESS_PATH}`);
mkdirSync(dirname(EGRESS_PATH), { recursive: true });

// ── fixtures ────────────────────────────────────────────────────────────────

let dir = null;
async function tmp(name, contents) {
  if (!dir) dir = await mkdtemp(join(tmpdir(), 'cfai-qa-'));
  const p = join(dir, name);
  await writeFile(p, contents);
  return p;
}
test.after?.(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  try { rmSync(FAKE_HOME, { recursive: true, force: true }); } catch {}
});

// Flags through the shipped pattern catalog (AWS key id + secret) — CRITICAL via
// the ordinary utf8 read, no OCR or archive path involved.
const SECRET_TEXT = [
  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
].join('\n');

function makeMonitor() {
  const calls = {
    attachHold: [], enqueued: [], toasts: [], logs: [],
    armedRoots: [], starts: [],
  };
  const log = {
    info: (m) => calls.logs.push(['info', String(m)]),
    warn: (m) => calls.logs.push(['warn', String(m)]),
    error: (m) => calls.logs.push(['error', String(m)]),
  };
  const monitor = new OsMonitor({
    serverUrl: 'http://127.0.0.1:1', token: 'test-token', log, enforcerEnabled: false,
  });
  const stub = (extra = {}) => Object.assign(new EventEmitter(), { start() {}, stop() {}, ...extra });
  monitor.poller = stub();
  monitor.promptWatcher = stub();
  monitor.enforcer = stub({
    updateBlockPatterns() { return false; },
    attachHold(state, payload) { calls.attachHold.push({ state, ...payload }); return true; },
    tokenize() { return true; },
    tokenizeEditHold() { return true; },
  });
  monitor.attachmentWatcher = stub({ hostArm() { return true; } });
  monitor.dialogWatcher = stub({ hostArm() { return true; } });
  // start() records the root set IN FORCE AT THE CALL, which is the assertion
  // that matters: #applyFeatures calls start() once at boot (file DLP defaults
  // on) before any policy has been read, so counting starts would only ever
  // measure that. "Was it ever started with a non-empty policy" is the question.
  monitor.syncWatcher = stub({
    armedRoots: [], stopRequested: false,
    start() { calls.starts.push(this.armedRoots.length); },
    setArmedRoots(roots) { calls.armedRoots.push(roots); this.armedRoots = roots; return true; },
  });
  monitor.reporter = { start() {}, stop() {}, enqueue(e) { calls.enqueued.push(e); } };
  monitor.toast = { start() {}, stop() {}, show(t) { calls.toasts.push(t); } };
  monitor.policySync = { start() {}, stop() {} };
  monitor.featureSync = { start() {}, stop() {} };
  monitor.start();
  // Set AFTER start(): #syncEgressPolicy runs once synchronously inside it and
  // would otherwise read the (redirected, empty) real policy file and reset
  // this back to empty. Only capture_mode:'hold' ever lets #reportEgressFile
  // treat a mail attachment as really held — see index.js's `reallyHeld`.
  // Defaulted to 'hold' here so every pre-existing hold-behavior assertion in
  // this file keeps its original meaning.
  monitor.egressCaptureModeById = new Map([[SURFACE, 'hold']]);
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
async function settle(ms = 700) { await new Promise((r) => setTimeout(r, ms)); }

const OUTLOOK = 'OUTLOOK';
const SURFACE = 'outlook_classic';
const ROOT = 'onedrive_sharepoint';

// ── 1. the policy file, driven for real ─────────────────────────────────────

test('a malformed, empty or hostile egress-surfaces.json arms NOTHING', async () => {
  // Every shape a half-written, hand-edited or wrong-version file could take.
  // The two flags must be STRICTLY true booleans: "true", 1 and a missing
  // partner must each leave the root set empty, because each of them is a file
  // that does not actually carry a human's live-probe decision.
  const cases = [
    ['an empty file', ''],
    ['whitespace', '   \n  '],
    ['not JSON at all', 'not json at all'],
    ['a truncated write', '{"sync_roots":[{"id":"onedrive_sha'],
    ['a bare array', '[]'],
    ['an empty object', '{}'],
    ['JSON null', 'null'],
    ['a number', '42'],
    ['an array of numbers', '[1,2,3]'],
    ['sync_roots as an object', '{"sync_roots":{}}'],
    ['a null entry', '{"sync_roots":[null]}'],
    ['a string entry', '{"sync_roots":["onedrive_sharepoint"]}'],
    ['no flags at all', `{"sync_roots":[{"id":"${ROOT}"}]}`],
    ['STRING flags', `{"sync_roots":[{"id":"${ROOT}","verified":"true","enforce":"true"}]}`],
    ['NUMERIC flags', `{"sync_roots":[{"id":"${ROOT}","verified":1,"enforce":1}]}`],
    ['verified only', `{"sync_roots":[{"id":"${ROOT}","verified":true}]}`],
    ['enforce only', `{"sync_roots":[{"id":"${ROOT}","enforce":true}]}`],
    ['enforce true, verified false', `{"sync_roots":[{"id":"${ROOT}","verified":false,"enforce":true}]}`],
    ['the surfaces key only', '{"surfaces":[{"id":"outlook_classic","verified":true,"enforce":true}]}'],
  ];
  for (const [label, body] of cases) {
    writeFileSync(EGRESS_PATH, body, 'utf8');
    const { monitor, calls } = makeMonitor();
    try {
      assert.deepEqual(monitor.egressSyncRoots, [], `${label}: no root may be armed`);
      // The strongest available statement: the watcher was never started while
      // holding a policy, so no directory handle on the user's files was opened.
      assert.deepEqual(calls.starts.filter((n) => n > 0), [],
        `${label}: the sync watcher was started with a non-empty policy`);
      for (const roots of calls.armedRoots) {
        assert.deepEqual(roots, [], `${label}: a non-empty root set reached the watcher`);
      }
    } finally { monitor.stop(); }
  }
  // And a completely ABSENT file — the state of every machine whose admin has
  // said nothing about cloud sync.
  rmSync(EGRESS_PATH, { force: true });
  const { monitor, calls } = makeMonitor();
  try {
    assert.deepEqual(monitor.egressSyncRoots, []);
    assert.deepEqual(calls.starts.filter((n) => n > 0), []);
  } finally { monitor.stop(); }
});

test('a policy file that IS verified and enforcing is the only shape that arms', async () => {
  // The positive control for the test above: without this, "nothing armed"
  // could be passing because the reader is broken rather than because the
  // filter is right. This is the only file shape in this whole test file that
  // arms anything, and it is one a human must hand-author today — the shipped
  // catalog cannot produce it (every entry is verified:false).
  writeFileSync(EGRESS_PATH, JSON.stringify({
    sync_roots: [{ id: ROOT, host: 'onedrive.live.com', capture_mode: 'observe', verified: true, enforce: true }],
  }), 'utf8');
  const { monitor, calls } = makeMonitor();
  try {
    assert.equal(monitor.egressSyncRoots.length, 1, 'a verified+enforcing row must arm');
    assert.ok(calls.armedRoots.some((r) => r.length === 1), 'the root set must reach the watcher');
  } finally { monitor.stop(); rmSync(EGRESS_PATH, { force: true }); }
});

// ── 2. multi-file attachment hold ───────────────────────────────────────────

test('three email attachments: removing the middle one keeps the other two held', async () => {
  // The scenario one step past the pair the contract file covers. What must
  // hold: the released file leaves the union, the two survivors stay in it, and
  // the hold is never released while either survivor is still attached.
  const { monitor, calls } = makeMonitor();
  const a = await tmp('a-flagged.env', SECRET_TEXT);
  const b = await tmp('b-clean.txt', 'minutes of the tuesday standup\n');
  const c = await tmp('c-flagged.env', SECRET_TEXT);
  try {
    for (const [filename, path] of [['a-flagged.env', a], ['b-clean.txt', b], ['c-flagged.env', c]]) {
      monitor.attachmentWatcher.emit('egress_attachment_appeared', { surface: SURFACE, process: OUTLOOK, filename, path });
      await waitFor(() => calls.enqueued.some((e) => e.filename === filename), { label: filename });
    }
    await settle(300);
    assert.deepEqual([...monitor.attachHolds.keys()].sort(), ['a-flagged.env', 'c-flagged.env'],
      'only the two FLAGGED files may still be held — the clean one is released after its scan');
    assert.equal(monitor.attachHoldProcess, OUTLOOK);

    // Removing the CLEAN one is a no-op on the hold: it was already released,
    // so this must not disturb the two that matter.
    monitor.attachmentWatcher.emit('egress_attachment_disappeared', { surface: SURFACE, process: OUTLOOK, filename: 'b-clean.txt' });
    await settle(200);
    assert.deepEqual([...monitor.attachHolds.keys()].sort(), ['a-flagged.env', 'c-flagged.env']);
    assert.notEqual(calls.attachHold.at(-1).state, 'off', 'the hold must NOT be released while flagged files remain');

    // Now the middle-in-time flagged one. The hold must narrow, not lift.
    monitor.attachmentWatcher.emit('egress_attachment_disappeared', { surface: SURFACE, process: OUTLOOK, filename: 'a-flagged.env' });
    await settle(200);
    assert.deepEqual([...monitor.attachHolds.keys()], ['c-flagged.env']);
    const narrowed = calls.attachHold.at(-1);
    assert.equal(narrowed.state, 'on', 'one file remaining is still a hold');
    assert.equal(narrowed.filename, 'c-flagged.env', 'the released file must not still be named on the hold');
    assert.equal(narrowed.process, OUTLOOK);

    // The last one lifts it, and the binding is cleared with it.
    monitor.attachmentWatcher.emit('egress_attachment_disappeared', { surface: SURFACE, process: OUTLOOK, filename: 'c-flagged.env' });
    await settle(200);
    assert.equal(monitor.attachHolds.size, 0);
    assert.equal(monitor.attachHoldProcess, null, 'the process binding must not outlive the last hold');
    assert.equal(calls.attachHold.at(-1).state, 'off');
  } finally { monitor.stop(); }
});

test('an egress hold and an AI-app hold never coexist in the helper\'s one slot', async () => {
  // The isolation question. The helper has ONE hold slot, so the invariant is
  // not "both are kept" but "the slot is never a MIXTURE": a hold must never be
  // pushed naming one app's process while carrying another app's file.
  const { monitor, calls } = makeMonitor();
  const teamsFile = await tmp('teams-secret.env', SECRET_TEXT);
  const mailFile = await tmp('mail-secret.env', SECRET_TEXT);
  try {
    // An AI/host-app hold first, armed through the PRE-EXISTING path.
    monitor.hostGoverned = { process: 'ms-teams', agent: '', kind: 'dlp' };
    monitor.attachmentWatcher.emit('attachment_appeared', {
      process: 'ms-teams', filename: 'teams-secret.env', path: teamsFile, governed: true,
    });
    await settle(1200);
    const teamsArmed = monitor.attachHolds.size > 0;

    // Then the mail client's.
    monitor.attachmentWatcher.emit('egress_attachment_appeared', {
      surface: SURFACE, process: OUTLOOK, filename: 'mail-secret.env', path: mailFile,
    });
    await waitFor(() => calls.enqueued.some((e) => e.filename === 'mail-secret.env'), { label: 'mail file' });
    await settle(300);

    assert.equal(monitor.attachHoldProcess, OUTLOOK, 'the binding must move to the app that armed last');
    assert.ok(!monitor.attachHolds.has('teams-secret.env'),
      'a previous app\'s file may not remain held under the mail client\'s name');
    for (const push of calls.attachHold) {
      if (push.state !== 'on') continue;
      const names = String(push.filename || '').split(', ').filter(Boolean);
      const mixed = names.includes('teams-secret.env') && names.includes('mail-secret.env');
      assert.equal(mixed, false,
        `the helper was handed a hold mixing two apps' files: ${push.filename} (process=${push.process})`);
    }
    if (teamsArmed) {
      assert.ok(calls.attachHold.some((p) => p.state === 'on' && p.process === 'ms-teams'),
        'the pre-existing Teams hold must still have been armed under its OWN process name');
    }
  } finally { monitor.stop(); }
});

test('the egress send-chord branch does not arm the AI path\'s 30s block cooldown', async () => {
  // REGRESSION. The branch used to open with
  //     _lastBlockFiredTicks = DateTime.UtcNow.Ticks;
  //     _lastBlockPatterns = _attachHoldPatterns;
  // copied from the AI block branch below it. Those two fields ARE the AI
  // path's BLOCK_COOLDOWN, they carry no process binding, and EnterBlockActive
  // reads the resulting `cooldown` as sufficient on its own. So a swallowed
  // Ctrl+Enter in Outlook made the next Enter in ANY AI app — on a prompt with
  // nothing wrong with it — get swallowed for up to 30 seconds and reported
  // under the email attachment's pattern names. Nothing on the egress path
  // reads either field, so the writes bought nothing.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const start = src.indexOf('if (EgressHoldArmed(_fgProcAny) && MatchesEgressChord(');
  assert.ok(start > 0, 'expected the egress chord branch');
  const branch = src.slice(start, src.indexOf('if (_fgIsAi || PanelBlockLatchHeld())', start));
  assert.ok(branch.length > 0 && branch.length < 2000, 'expected to isolate just the egress branch');
  assert.equal(/_lastBlockFiredTicks\s*=/.test(branch), false,
    'the egress branch must not arm the AI path\'s block cooldown');
  assert.equal(/_lastBlockPatterns\s*=/.test(branch), false,
    'the egress branch must not overwrite the AI path\'s cooldown pattern attribution');
  // It must still do its own two jobs.
  assert.match(branch, /EmitEgressBlock\(/);
  assert.match(branch, /return \(IntPtr\)1;/);
  // And the AI branch must still arm the cooldown for its OWN blocks — this is
  // a removal from new code, not a change to the existing decision.
  const aiBranch = src.slice(src.indexOf('if (_fgIsAi || PanelBlockLatchHeld())'));
  assert.match(aiBranch, /_lastBlockFiredTicks = DateTime\.UtcNow\.Ticks;/);
  assert.match(aiBranch, /_lastBlockPatterns = pats;/);
});

// ── 3. the OneDrive origin heuristic ────────────────────────────────────────

test('a sync_down classification is refused in ANY spelling', async () => {
  // REGRESSION. The guard was `ev.origin === 'sync_down'`, a case-sensitive
  // compare — which is not defence in depth, since the premise of the guard is
  // that the sender might not be the helper we shipped. 'Sync_Down' sailed
  // through it and was filed as an upload: a governance record naming this user
  // as the sender of a file they only downloaded.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('came-down.env', SECRET_TEXT);
  try {
    for (const origin of ['sync_down', 'Sync_Down', 'SYNC_DOWN', ' sync_down ', 'sync_down\n']) {
      monitor.syncWatcher.emit('sync_file', { root_id: ROOT, path: p, origin, size: 128 });
    }
    await settle(1200);
    assert.deepEqual(calls.enqueued, [],
      `a download was reported as an upload: ${JSON.stringify(calls.enqueued.map((e) => e.origin))}`);
    assert.deepEqual(calls.toasts, []);
  } finally { monitor.stop(); }
});

test('an unrecognised origin lands on `unknown` rather than travelling onto the record', async () => {
  // The record must carry one of the two labels the reporting method's own
  // contract promises. A dashboard filtering on origin must not have to know
  // every spelling a future helper might invent, and an uninterpretable string
  // on a governance record is worse than an honest "unknown".
  const { monitor, calls } = makeMonitor();
  const p = await tmp('ambiguous.env', SECRET_TEXT);
  try {
    for (const origin of [undefined, null, '', 'local_edit', 'whatever', 42, {}, 'LOCAL_NEW']) {
      calls.enqueued.length = 0;
      // A distinct path per case: #reportEgressFile dedupes on path+surface.
      const path = await tmp(`amb-${String(origin).replace(/\W/g, '') || 'blank'}.env`, SECRET_TEXT);
      monitor.syncWatcher.emit('sync_file', { root_id: ROOT, path, origin, size: 128 });
      await waitFor(() => calls.enqueued.length > 0, { label: `origin ${String(origin)}` });
      const rec = calls.enqueued[0];
      assert.ok(['local_new', 'unknown'].includes(rec.origin),
        `origin ${JSON.stringify(origin)} reached the record as ${JSON.stringify(rec.origin)}`);
    }
    // 'local_new' itself must survive intact — the clamp must not flatten the
    // one confident answer into the weak one.
    calls.enqueued.length = 0;
    const good = await tmp('confident.env', SECRET_TEXT);
    monitor.syncWatcher.emit('sync_file', { root_id: ROOT, path: good, origin: 'local_new', size: 128 });
    await waitFor(() => calls.enqueued.length > 0, { label: 'local_new' });
    assert.equal(calls.enqueued[0].origin, 'local_new');
    assert.ok(p);
  } finally { monitor.stop(); }
});

test('a OneDrive file event NEVER claims anything was blocked, moved or removed', async () => {
  // The single most dangerous copy in this feature. OneDrive detection is
  // observe-and-report only — there is no quarantine and no move anywhere — and
  // by the time the toast is on screen the file may already be in the cloud. A
  // toast implying an intervention would be a false statement to the user's
  // face, and it would also teach them to trust a brake that does not exist.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('payroll-sync.env', SECRET_TEXT);
  try {
    monitor.syncWatcher.emit('sync_file', { root_id: ROOT, path: p, origin: 'local_new', size: 512 });
    await waitFor(() => calls.toasts.length > 0, { label: 'sync toast' });
    const t = calls.toasts.at(-1);
    const copy = `${t.title}\n${t.message}`;
    for (const claim of [
      /\bblocked\b/i, /\bprevented\b/i, /\bstopped\b/i, /\bquarantined?\b/i,
      /\bmoved\b/i, /\bremoved the file\b/i, /\bheld\b/i, /\bhold\b/i,
      /\bcancell?ed\b/i, /\bdeleted\b/i, /\breverted\b/i, /\bupload (?:was )?(?:blocked|stopped)\b/i,
    ]) {
      // "nothing was blocked, moved or removed" is the one legitimate use of
      // those words, so the negated sentence is excluded before matching.
      const positive = copy.replace(/nothing was blocked, moved or removed/i, '');
      assert.equal(claim.test(positive), false,
        `the OneDrive toast implies an intervention that never happens (${claim}): ${copy}`);
    }
    assert.match(copy, /DETECTED AND REPORTED only/);
    assert.match(copy, /may already have synced/);
    // No hold may be armed for a sync-root file: there is no send chord to
    // swallow, and arming one would kill an unrelated Enter somewhere else.
    assert.deepEqual(calls.attachHold, [], 'a sync-root file must never arm a hold');
  } finally { monitor.stop(); }
});

test('a file event for a sync root this catalog does not carry is dropped', async () => {
  const { monitor, calls } = makeMonitor();
  const p = await tmp('bad-root.env', SECRET_TEXT);
  try {
    for (const root_id of ['not_a_root', '', null, undefined, 'ONEDRIVE_SHAREPOINT ']) {
      monitor.syncWatcher.emit('sync_file', { root_id, path: p, origin: 'local_new', size: 1 });
    }
    await settle(1000);
    assert.deepEqual(calls.enqueued, [], 'an unrecognised root id must not be reported under an invented identity');
  } finally { monitor.stop(); }
});

// ── 4. the recipient-domain contract, attacked ──────────────────────────────

test('nothing address-shaped survives the recipient-domain filter', async () => {
  // The privacy contract: a recipient's full address is PII about a third party
  // who is not the subject of the record. The .ps1 reduces to @domain tokens in
  // the same expression that reads the field; this side re-checks the shape. So
  // the assertion is on the RE-CHECK: hand it everything the reduction could
  // conceivably fail to catch and require that nothing with a local part, an
  // embedded @, whitespace or a display name gets through.
  const { monitor, calls } = makeMonitor();
  try {
    monitor.promptWatcher.emit('egress_body', {
      surface: SURFACE, process: OUTLOOK, text: SECRET_TEXT, len: SECRET_TEXT.length,
      recipient_domains: [
        'jane.doe@contoso.com',            // a full address
        '@jane.doe@contoso.com',           // an address wearing the prefix
        'Jane Doe <jane@contoso.com>',     // a display name
        '@CONTOSO.COM',                    // case
        '@ contoso.com',                   // whitespace
        '@contoso.com; @gmail.com',        // two in one token
        '@localhost',                      // no TLD
        '@192.168.1.1',                    // an IP is not a domain
        '@',                               // degenerate
        '',
        null,
        undefined,
        42,
        { host: '@evil.com' },             // → "[object Object]", refused
        ['@evil.com'],                     // → "@evil.com": see the note below
        '@ok-one.com',
        '@ok-two.co.uk',
      ],
    });
    await waitFor(() => calls.enqueued.length > 0, { label: 'egress body' });
    const rec = calls.enqueued.at(-1);
    for (const d of rec.recipient_domains) {
      assert.match(d, /^@[a-z0-9.-]+\.[a-z]{2,}$/, `a malformed domain survived: ${JSON.stringify(d)}`);
      assert.equal(d.indexOf('@'), 0, `an embedded @ survived: ${JSON.stringify(d)}`);
      assert.equal(/\s/.test(d), false, `whitespace survived: ${JSON.stringify(d)}`);
      // The decisive one: no LOCAL PART may appear anywhere in the output.
      assert.equal(/jane|doe/i.test(d), false, `a local part leaked: ${JSON.stringify(d)}`);
    }
    // A ONE-ELEMENT ARRAY survives, and that is fine rather than a hole:
    // String(['@evil.com']) is '@evil.com', so what reaches the record is still
    // a bare domain with no local part — the contract is "nothing
    // address-shaped", not "nothing that was ever a non-string". A multi-element
    // array coerces to '@a.com,@b.com' and is refused by the shape test, and an
    // object coerces to '[object Object]' and is refused too. Pinned so a future
    // change to the filter has to think about the coercion deliberately.
    assert.deepEqual(rec.recipient_domains, ['@contoso.com', '@evil.com', '@ok-one.com', '@ok-two.co.uk']);
    // No subject-line field exists on the record, by construction, and the
    // window title is always empty.
    assert.equal(rec.window_title, '');
    assert.equal('subject' in rec, false);
    // Nor may an address reach the log line that names the domains.
    for (const [, m] of calls.logs) {
      assert.equal(/jane\.doe@|jane@/.test(m), false, `an address reached the log: ${m}`);
    }
  } finally { monitor.stop(); }
});

test('the ceiling on recipient domains holds against a flooded field', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    monitor.promptWatcher.emit('egress_body', {
      surface: SURFACE, process: OUTLOOK, text: SECRET_TEXT, len: SECRET_TEXT.length,
      recipient_domains: Array.from({ length: 500 }, (_, i) => `@d${i}.example.com`),
    });
    await waitFor(() => calls.enqueued.length > 0, { label: 'egress body' });
    assert.ok(calls.enqueued.at(-1).recipient_domains.length <= 8,
      'a flooded recipient field must not put 500 domains on one record');
  } finally { monitor.stop(); }
});

test('the email-body toast never claims the message was blocked', async () => {
  // The body is captured AT the send transition — the message has already gone.
  // Claiming otherwise would be the same lie the OneDrive toast is forbidden.
  const { monitor, calls } = makeMonitor();
  try {
    monitor.promptWatcher.emit('egress_body', {
      surface: SURFACE, process: OUTLOOK, text: SECRET_TEXT, len: SECRET_TEXT.length, recipient_domains: [],
    });
    await waitFor(() => calls.toasts.length > 0, { label: 'body toast' });
    const t = calls.toasts.at(-1);
    const copy = `${t.title}\n${t.message}`;
    const positive = copy.replace(/the message was not blocked/i, '');
    for (const claim of [/\bblocked\b/i, /\bprevented\b/i, /\bstopped\b/i, /\brecalled\b/i, /\bheld\b/i]) {
      assert.equal(claim.test(positive), false, `the body toast implies a block: ${copy}`);
    }
    assert.match(copy, /was not blocked/i);
  } finally { monitor.stop(); }
});

test('an empty or non-string compose body is never reported', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    for (const text of ['', null, undefined, 42, {}, []]) {
      monitor.promptWatcher.emit('egress_body', { surface: SURFACE, process: OUTLOOK, text, len: 0 });
    }
    // …nor a body with nothing sensitive in it, however long.
    monitor.promptWatcher.emit('egress_body', {
      surface: SURFACE, process: OUTLOOK, text: 'thanks, that works for me\n'.repeat(600), len: 15600,
    });
    await settle(900);
    assert.deepEqual(calls.enqueued, [], 'an ordinary email must never be stored');
    assert.deepEqual(calls.toasts, []);
  } finally { monitor.stop(); }
});

// ── 5. concurrency and churn ────────────────────────────────────────────────

test('the same attachment arriving many times concurrently produces one record', async () => {
  // The chip watcher re-observes a compose pane every tick, and both mail routes
  // can see the same file (the picker AND the chip that follows it). The dedupe
  // is what keeps one attachment from becoming a dozen records.
  const { monitor, calls } = makeMonitor();
  const p = await tmp('concurrent.env', SECRET_TEXT);
  try {
    for (let i = 0; i < 12; i += 1) {
      monitor.attachmentWatcher.emit('egress_attachment_appeared', {
        surface: SURFACE, process: OUTLOOK, filename: 'concurrent.env', path: p,
      });
      monitor.dialogWatcher.emit('egress_file_dialog_pick', { surface: SURFACE, process: OUTLOOK, path: p });
    }
    await waitFor(() => calls.enqueued.length > 0, { label: 'first record' });
    await settle(1500);
    assert.equal(calls.enqueued.length, 1,
      `one attachment produced ${calls.enqueued.length} records: ${calls.enqueued.map((e) => e.via).join(', ')}`);
    // The hold is still in force — dedupe suppresses the RECORD, never the brake.
    assert.ok(monitor.attachHolds.has('concurrent.env'), 'the send hold must survive record dedupe');
  } finally { monitor.stop(); }
});

test('a chip that resolves to no file on disk reports nothing and holds nothing', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    // Filename-shaped text in a compose pane that is not an attachment at all.
    monitor.attachmentWatcher.emit('egress_attachment_appeared', {
      surface: SURFACE, process: OUTLOOK, filename: 'Q3-payroll-final.xlsx', path: '',
    });
    monitor.dialogWatcher.emit('egress_file_dialog_pick', { surface: SURFACE, process: OUTLOOK, path: '' });
    await settle(900);
    assert.deepEqual(calls.enqueued, []);
    assert.deepEqual(calls.attachHold, [], 'an unresolvable chip must never kill a send chord');
    assert.equal(monitor.attachHolds.size, 0);
  } finally { monitor.stop(); }
});

test('a disappeared event for a file that was never held is a no-op', async () => {
  const { monitor, calls } = makeMonitor();
  try {
    for (const filename of ['never-attached.env', '', null, undefined]) {
      monitor.attachmentWatcher.emit('egress_attachment_disappeared', { surface: SURFACE, process: OUTLOOK, filename });
    }
    await settle(400);
    assert.deepEqual(calls.attachHold, [], 'an unknown filename must not push an "off" at the helper');
  } finally { monitor.stop(); }
});

test('an unreadable / vanished path is reported-or-dropped but never leaves a hold armed', async () => {
  // The failure mode that matters: a provisional hold armed before the scan,
  // then an extraction that throws or a file that is gone. A leaked hold in a
  // mail client is a dead send chord with nothing on screen to explain it.
  const { monitor, calls } = makeMonitor();
  try {
    const gone = join(dir || tmpdir(), 'does-not-exist-at-all.env');
    monitor.attachmentWatcher.emit('egress_attachment_appeared', {
      surface: SURFACE, process: OUTLOOK, filename: 'does-not-exist-at-all.env', path: gone,
    });
    await settle(1500);
    assert.equal(monitor.attachHolds.size, 0,
      `a hold was left armed for a file that could not be read: ${[...monitor.attachHolds.keys()]}`);
  } finally { monitor.stop(); }
});

test('a zero-byte and a very large attachment are both handled without leaking a hold', async () => {
  const { monitor, calls } = makeMonitor();
  const empty = await tmp('empty.txt', '');
  // 8 MB, with the secret at the very end so a truncating reader would miss it.
  const big = await tmp('big.env', 'x'.repeat(8 * 1024 * 1024) + '\n' + SECRET_TEXT);
  try {
    monitor.attachmentWatcher.emit('egress_attachment_appeared', {
      surface: SURFACE, process: OUTLOOK, filename: 'empty.txt', path: empty,
    });
    await settle(1200);
    assert.equal(monitor.attachHolds.has('empty.txt'), false, 'an empty file must not hold a send');

    monitor.attachmentWatcher.emit('egress_attachment_appeared', {
      surface: SURFACE, process: OUTLOOK, filename: 'big.env', path: big,
    });
    await waitFor(() => calls.enqueued.some((e) => e.filename === 'big.env'), { timeout: 30_000, label: 'big file' });
    await settle(500);
    // Whatever the scan concluded, the hold state must be self-consistent: held
    // means the record said high/critical, not held means it did not.
    const rec = calls.enqueued.find((e) => e.filename === 'big.env');
    const risky = rec.severity === 'high' || rec.severity === 'critical';
    assert.equal(monitor.attachHolds.has('big.env'), risky,
      `hold state disagrees with the record (severity=${rec.severity})`);
  } finally { monitor.stop(); }
});

// ── 6. the sync-watcher spawn/respawn machinery ─────────────────────────────

test('SyncWatcher policy churn cannot leave a watcher running with a withdrawn policy', () => {
  // The race between the 10s policy poll, the 2s crash-respawn and a withdrawal.
  // The property that must hold: after the dust settles on an EMPTY policy,
  // nothing is watching — start() has to refuse on its own, because the exit
  // handler's respawn timer does not know the policy changed.
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const w = new SyncWatcher({ log, armedRoots: [{ id: ROOT }] });
  // Arm → withdraw → arm → withdraw, faster than any timer.
  assert.equal(w.setArmedRoots([]), true);
  assert.equal(w.setArmedRoots([{ id: ROOT }]), true);
  assert.equal(w.setArmedRoots([]), true);
  assert.equal(w.armedRoots.length, 0);
  // The respawn path the exit handler schedules ends up here, and this is the
  // gate that makes the race safe rather than the timer being cancelled.
  w.start();
  assert.equal(w.child, null, 'a respawn with a withdrawn policy must not open a handle');
  assert.ok(logs.some((m) => /no governed cloud-sync policy/.test(m)));
  // An identical re-statement is still a no-op after all that churn.
  assert.equal(w.setArmedRoots([]), false);
  w.stop();
});

test('the sync-root paths are never logged — a OneDrive path carries the tenant and user name', () => {
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const w = new SyncWatcher({ log, armedRoots: [{ id: ROOT }] });
  w.start();   // refuses or spawns depending on whether this machine has OneDrive
  for (const m of logs) {
    assert.equal(/[A-Za-z]:\\/.test(m), false, `a filesystem path reached the log: ${m}`);
  }
  w.stop();
});
