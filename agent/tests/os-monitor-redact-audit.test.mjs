// The audit record for a desktop "Tokenize & Send": the enforcement_redact
// event OsMonitor reports when the enforcer confirms it masked a prompt and
// sent it.
//
// What is pinned here:
//   A. the enriched fields are present and shaped exactly like the hard-block
//      event's (matches / highest_severity / service / vendor / process_name),
//      because the two are meant to pair up on the dashboard;
//   B. content_text is the MASKED text and nothing else — never the original,
//      never the block's preview, and absent entirely when the enforcer sent
//      no masked text (i.e. anything other than a verified send);
//   C. a rewrite with no pinned block behind it degrades — it still reports,
//      minus the fields it cannot determine — instead of throwing inside a
//      stdout handler, where a throw would be an unhandled rejection in the
//      monitor.
//
// NOTHING here may spawn a subprocess: no enforcer-win.ps1 (a system-wide
// keyboard hook), no PowerShell watcher, no toast helper, no detached watchdog.
// Every subsystem is replaced with an inert stub BEFORE start(), and
// enforcerEnabled:false keeps start() from reaching enforcer.start() or
// spawnEnforcerWatchdog() at all — the handlers under test are registered
// unconditionally, so they are still live. No network I/O either: PolicySync /
// FeatureSync are never started and the Reporter is a stub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OsMonitor } from '../src/os_monitor/index.js';
import { lengthBucket } from '../src/os_monitor/classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

const silentLog = { info() {}, warn() {}, error() {}, child: () => silentLog };

function inertWatcher() {
  const stub = new EventEmitter();
  stub.start = () => {};
  stub.stop = () => {};
  return stub;
}

/** A started monitor whose every subsystem is inert. */
function makeMonitor() {
  const reported = [];
  const toasts = [];
  const monitor = new OsMonitor({
    serverUrl: '', token: '', log: silentLog, enforcerEnabled: false,
  });
  monitor.poller = inertWatcher();
  monitor.dialogWatcher = inertWatcher();
  monitor.attachmentWatcher = inertWatcher();
  monitor.promptWatcher = inertWatcher();
  monitor.enforcer = Object.assign(new EventEmitter(), {
    start() {}, stop() {}, attachHold() {}, updateBlockPatterns() {}, tokenize() {},
  });
  monitor.toast = { start() {}, stop() {}, show: (t) => toasts.push(t) };
  monitor.reporter = { start() {}, stop() {}, enqueue: (e) => reported.push(e) };
  monitor.policySync.start = () => {};
  monitor.featureSync.start = () => {};
  monitor.start();
  return { monitor, reported, toasts };
}

// The real enforcer lines, as enforcer-win.ps1's EmitBlock / EmitRewrite write
// them (see their JSON literals) and as enforcer.js forwards them: whole and
// untouched.
const ORIGINAL = 'my aws key is AKIAIOSFODNN7EXAMPLE and my ssn is 123-45-6789';
const MASKED = 'my aws key is [AWS-KEY] and my ssn is [SSN]';

const BLOCK = {
  kind: 'block', reason: 'send', process: 'Claude',
  patterns: 'aws-access-key,ssn', block_id: 'b-1',
  rewritable: true, preview: '[AWS-KEY]',
};
const REWRITE_OK = { kind: 'rewrite', block_id: 'b-1', result: 'ok', reason: 'sent', masked: MASKED };

/** Drives block → rewrite and returns the enforcement_redact record. */
function tokenizeAndSend({ block = BLOCK, rewrite = REWRITE_OK } = {}) {
  const h = makeMonitor();
  try {
    if (block) h.monitor.enforcer.emit('block', block);
    h.monitor.enforcer.emit('rewrite', rewrite);
  } finally {
    h.monitor.stop();
  }
  return { ...h, redact: h.reported.find((e) => e.kind === 'enforcement_redact') };
}

// ── A. parity with the hard-block event ───────────────────────────────────────

test('a completed rewrite reports the block\'s matches and severity, in the block\'s own shape', () => {
  const { reported, redact } = tokenizeAndSend();
  const block = reported.find((e) => e.kind === 'enforcement_block');

  assert.ok(redact, 'a verified send must produce an enforcement_redact record');
  assert.equal(redact.mechanism, 'keystroke_rewrite');
  assert.equal(redact.decision_for, 'b-1', 'the pairing key back to the block');
  assert.equal(redact.sent, true);

  // Not merely "some matches" — the SAME value the block reported, so the block
  // and its outcome cannot disagree about what was detected.
  assert.deepEqual(redact.matches, [
    { pattern: 'aws-access-key', severity: 'high', count: 1 },
    { pattern: 'ssn', severity: 'high', count: 1 },
  ]);
  assert.deepEqual(redact.matches, block.matches);
  assert.equal(redact.highest_severity, block.highest_severity);
  assert.equal(redact.highest_severity, 'high');

  // Identity resolved the same way, by the same resolver, for both events.
  assert.equal(redact.service, block.service);
  assert.equal(redact.vendor, block.vendor);
  assert.equal(redact.process_name, block.process_name);
  assert.equal(redact.service, 'Claude');
  assert.equal(redact.process_name, 'Claude');
});

test('an IDE-panel block\'s identity survives into the rewrite record', () => {
  // process:"Code" resolves to nothing on its own — the panel id is what names
  // the product. Whatever identifyEventAi() decided for the BLOCK is what the
  // outcome must claim, since it is the same send.
  const { reported, redact } = tokenizeAndSend({
    block: { ...BLOCK, process: 'Code', panel: 'claude_code' },
  });
  const block = reported.find((e) => e.kind === 'enforcement_block');
  assert.equal(redact.service, block.service);
  assert.equal(redact.vendor, block.vendor);
  assert.notEqual(redact.service, 'Code');
  assert.equal(redact.process_name, 'Code');
});

test('the enriched field names are the ones POST /api/v1/dlp already maps', async () => {
  // The route maps enforcement metadata from an explicit allowlist, so a
  // renamed or invented key is silently dropped — which reads as "we recorded
  // it" when nothing was recorded. These names come from that allowlist and
  // from content.js's extension_dom emit; the server needs no change for them.
  const { redact } = tokenizeAndSend();
  for (const field of [
    'kind', 'mechanism', 'decision_for', 'matches', 'highest_severity',
    'content_length', 'length_bucket', 'content_text', 'content_redacted', 'service',
  ]) {
    assert.ok(field in redact, `missing ${field}`);
  }
  const route = await readFile(
    join(AGENT_DIR, '..', 'server', 'src', 'routes', 'dlp.js'), 'utf8',
  );
  for (const mapped of [
    'matches: e.matches', 'length_bucket: e.length_bucket',
    'highest_severity: e.highest_severity', 'decision_for:   e.decision_for',
    'mechanism:      e.mechanism',
  ]) {
    assert.ok(route.includes(mapped), `dlp.js no longer maps ${mapped}`);
  }
  // content_text is persisted by insertContent(), not by the metadata map.
  assert.match(route, /typeof e\.content_text === 'string'/);
});

// ── B. the content field: masked only ─────────────────────────────────────────

test('content_text is the MASKED text, and the original never appears anywhere', () => {
  const { redact } = tokenizeAndSend();
  assert.equal(redact.content_text, MASKED);
  assert.equal(redact.content_redacted, true);

  // Nothing resembling the original — neither the whole string nor either
  // secret inside it — may appear in ANY field of the record.
  const serialized = JSON.stringify(redact);
  for (const secret of [ORIGINAL, 'AKIAIOSFODNN7EXAMPLE', '123-45-6789']) {
    assert.equal(serialized.includes(secret), false,
      `the original text leaked into the audit record: ${secret}`);
  }
  // …and the masked text is genuinely masked: the labels are there.
  assert.match(redact.content_text, /\[AWS-KEY\]/);
  assert.match(redact.content_text, /\[SSN\]/);
});

test('content_length / length_bucket describe the masked text that was sent', () => {
  const { redact } = tokenizeAndSend();
  assert.equal(redact.content_length, MASKED.length);
  assert.equal(redact.length_bucket, lengthBucket(MASKED.length));
  assert.equal(redact.length_bucket, '<100');
  // Not the original's length — that number never crosses the enforcer's stdout
  // contract, so claiming it would be inventing a measurement.
  assert.notEqual(redact.content_length, ORIGINAL.length);
});

test('a long masked prompt buckets like every other reported length', () => {
  const long = '[SSN] '.repeat(200);
  const { redact } = tokenizeAndSend({ rewrite: { ...REWRITE_OK, masked: long } });
  assert.equal(redact.content_length, long.length);
  assert.equal(redact.length_bucket, lengthBucket(long.length));
  assert.equal(redact.length_bucket, '1k-10k');
});

test('no masked field on the event ⇒ no content field on the record', () => {
  // EmitRewrite omits `masked` rather than sending "" when there is none, so
  // "no content on this event" stays distinguishable from "an empty prompt".
  for (const rewrite of [
    { kind: 'rewrite', block_id: 'b-1', result: 'ok', reason: 'sent' },
    { kind: 'rewrite', block_id: 'b-1', result: 'ok', reason: 'sent', masked: '' },
  ]) {
    const { redact } = tokenizeAndSend({ rewrite });
    assert.ok(redact, 'the record itself must still be written');
    assert.equal('content_text' in redact, false);
    assert.equal('content_length' in redact, false);
    assert.equal('length_bucket' in redact, false);
    // Still true of the event: any content it carried would have been masked.
    assert.equal(redact.content_redacted, true);
    // The match information does not depend on the content field.
    assert.equal(redact.matches.length, 2);
  }
});

test('an aborted or failed rewrite reports nothing at all', () => {
  for (const result of ['aborted', 'failed', 'not_offered']) {
    const { reported } = tokenizeAndSend({
      // A masked field on a non-ok line cannot happen (EmitRewrite only passes
      // one on the verified-send line) — supplied here anyway, so a future
      // regression on that side still cannot publish unsent content.
      rewrite: { kind: 'rewrite', block_id: 'b-1', result, reason: 'x', masked: MASKED },
    });
    assert.equal(reported.some((e) => e.kind === 'enforcement_redact'), false,
      `result:"${result}" must not produce a redaction record`);
    assert.equal(
      reported.some((e) => JSON.stringify(e).includes(MASKED)), false,
      `result:"${result}" must not report any prompt content`,
    );
  }
});

test('the block\'s preview substring is not what gets reported as content', () => {
  // `preview` is a masked SUBSTRING for the dialog's copy; the audit record must
  // carry the full masked prompt the composer was verified to hold.
  const { redact } = tokenizeAndSend();
  assert.notEqual(redact.content_text, BLOCK.preview);
  assert.equal('preview' in redact, false);
});

// ── C. graceful degradation ───────────────────────────────────────────────────

test('a rewrite with no block behind it still reports, minus what it cannot know', () => {
  const { redact } = tokenizeAndSend({ block: null });
  assert.ok(redact, 'the outcome must be recorded even with no pinned block');
  assert.equal(redact.decision_for, 'b-1');
  assert.equal(redact.sent, true);
  assert.equal(redact.content_text, MASKED, 'the masked text does not depend on the pin');
  // Omitted, not null and not []: "we do not know what was matched" is a
  // different claim from "nothing was matched".
  for (const field of ['matches', 'highest_severity', 'service', 'vendor', 'process_name']) {
    assert.equal(field in redact, false, `${field} must be omitted, not guessed`);
  }
});

test('a rewrite for a DIFFERENT block borrows no other block\'s patterns', () => {
  const { redact } = tokenizeAndSend({
    rewrite: { ...REWRITE_OK, block_id: 'someone-else' },
  });
  assert.equal(redact.decision_for, 'someone-else');
  assert.equal('matches' in redact, false);
  assert.equal('service' in redact, false);
});

test('a mismatched rewrite does not consume the pin the NEXT rewrite needs', () => {
  const h = makeMonitor();
  try {
    h.monitor.enforcer.emit('block', BLOCK);
    h.monitor.enforcer.emit('rewrite', { ...REWRITE_OK, block_id: 'stale' });
    h.monitor.enforcer.emit('rewrite', REWRITE_OK);
  } finally { h.monitor.stop(); }
  const [stale, real] = h.reported.filter((e) => e.kind === 'enforcement_redact');
  assert.equal('matches' in stale, false);
  assert.equal(real.matches.length, 2, 'the live pin must survive a stale rewrite');
});

test('the pin is single-use — a replayed ok line cannot re-attribute it', () => {
  const h = makeMonitor();
  try {
    h.monitor.enforcer.emit('block', BLOCK);
    h.monitor.enforcer.emit('rewrite', REWRITE_OK);
    h.monitor.enforcer.emit('rewrite', REWRITE_OK);
  } finally { h.monitor.stop(); }
  const [first, second] = h.reported.filter((e) => e.kind === 'enforcement_redact');
  assert.equal(first.matches.length, 2);
  assert.equal('matches' in second, false);
});

test('an expired pin is dropped rather than reported as current', () => {
  const h = makeMonitor();
  try {
    h.monitor.enforcer.emit('block', BLOCK);
    // The helper's pin is 15s and the write budget 9s; anything older than the
    // Node-side TTL cannot belong to this rewrite.
    h.monitor.rewriteContext.pinnedAt -= 10 * 60_000;
    h.monitor.enforcer.emit('rewrite', REWRITE_OK);
  } finally { h.monitor.stop(); }
  const redact = h.reported.find((e) => e.kind === 'enforcement_redact');
  assert.equal('matches' in redact, false);
  assert.equal(redact.content_text, MASKED);
});

test('a non-rewritable block pins nothing, so its patterns can never be borrowed', () => {
  for (const block of [
    { ...BLOCK, rewritable: false, block_id: '', reason: 'attachment', filename: 'payroll.xlsx' },
    { ...BLOCK, rewritable: false, block_id: '', platform_block: true, block_scope: 'app' },
  ]) {
    const h = makeMonitor();
    try {
      h.monitor.enforcer.emit('block', block);
      assert.equal(h.monitor.rewriteContext, null);
    } finally { h.monitor.stop(); }
  }
});

test('a malformed rewrite event cannot throw out of the stdout handler', () => {
  const h = makeMonitor();
  try {
    for (const bad of [
      { kind: 'rewrite' },
      { kind: 'rewrite', result: 'ok' },
      { kind: 'rewrite', result: 'ok', block_id: null, masked: null },
      { kind: 'rewrite', result: 'ok', block_id: 'b-1', masked: 42 },
      { kind: 'rewrite', result: 'ok', block_id: 'b-1', masked: { text: MASKED } },
    ]) {
      assert.doesNotThrow(() => h.monitor.enforcer.emit('rewrite', bad));
    }
  } finally { h.monitor.stop(); }
  // A non-string masked field is not content we can vouch for — it is dropped,
  // never stringified into the record.
  for (const e of h.reported) {
    assert.equal(typeof e.content_text === 'string' || e.content_text === undefined, true);
    assert.equal(JSON.stringify(e).includes('[object Object]'), false);
  }
});

// ── The pin itself carries no content ────────────────────────────────────────

test('the pinned block context holds pattern names and identity only — never text', () => {
  const h = makeMonitor();
  try {
    h.monitor.enforcer.emit('block', BLOCK);
    const ctx = h.monitor.rewriteContext;
    assert.deepEqual(Object.keys(ctx).sort(), [
      'block_id', 'highest_severity', 'matches', 'pinnedAt', 'process_name', 'service', 'vendor',
    ]);
    const serialized = JSON.stringify(ctx);
    for (const forbidden of [ORIGINAL, MASKED, BLOCK.preview, 'AKIAIOSFODNN7EXAMPLE']) {
      assert.equal(serialized.includes(forbidden), false, `the pin must not hold ${forbidden}`);
    }
  } finally { h.monitor.stop(); }
});

test('the rewrite handler reads exactly one content field, and it is the masked one', async () => {
  // Source-level, to pin the boundary itself: this handler is the only place on
  // the Node side that touches prompt content from the enforcer, and `masked`
  // is the only field it may read (EmitRewrite has no parameter the original
  // could arrive through — see os-monitor-safety.test.mjs).
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const handler = src.match(/this\.enforcer\.on\('rewrite',[\s\S]*?\n {4}\}\);/);
  assert.ok(handler, "expected an enforcer.on('rewrite', ...) handler");
  const code = handler[0]
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /kind: 'enforcement_redact'/);
  assert.match(code, /content_text: masked/);
  assert.match(code, /content_redacted: true/);
  // No other content-bearing field of the enforcer's events is read here.
  for (const forbidden of ['ev.preview', 'ev.original', 'ev.text', 'ev.patterns']) {
    assert.equal(code.includes(forbidden), false, `the rewrite handler must not read ${forbidden}`);
  }
  // The masked prompt is reported, never logged.
  assert.equal(/this\.log[^\n]*masked/.test(code), false,
    'the masked prompt must not reach a log line');
});
