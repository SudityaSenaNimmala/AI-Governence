// The Tokenize & Send OFFER on the CLI agent (no Electron).
//
// THE GAP THIS COVERS, found by live testing: everything that computes the mask
// and performs the rewrite already existed and worked — enforcer-win.ps1's
// ComputeMaskCandidate / RunRewrite, driven by the {cmd:'tokenize', block_id}
// stdin command Enforcer.tokenize has written for a long time. What did NOT
// exist outside Electron was the popup that asks the user which they want. It
// lived only in electron/renderer/block-dialog.js, opened by electron/main.js
// off the @@CFAI-BLOCK line, so on `ai-gov-agent --monitor` — the path this
// product is migrating to, and the one the user runs — nothing ever opened it.
// The user saw a toast and had no way to choose Tokenize & Send at all.
//
// What is pinned here:
//   A. the popup is offered for EXACTLY the case that previously had nothing
//      actionable to offer — a rewritable, non-platform, non-attachment block
//      with a masked preview — and for no other;
//   B. choosing "Tokenize & Send" sends the pre-existing enforcer command and
//      nothing else; every other outcome ('edit', timeout, suppressed,
//      unavailable) leaves the block standing, which is what happened before
//      this popup existed;
//   C. only a pattern-NAME list and the ALREADY-MASKED preview reach the popup —
//      never the original prompt — and nothing about the content is logged;
//   D. the helper-side command and the Node-side promise are shaped like the
//      Request Access dialog's, which is the pattern they both follow.
//
// NOTHING here may spawn a subprocess: no enforcer-win.ps1 (a system-wide
// keyboard hook), no PowerShell toast helper, no detached watchdog. Every
// subsystem is an inert stub before start(), and enforcerEnabled:false keeps
// start() away from enforcer.start() — the handlers under test are registered
// unconditionally, so they are still live. No window is ever drawn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OsMonitor } from '../src/os_monitor/index.js';
import { ToastService } from '../src/os_monitor/notify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

function inertWatcher() {
  const stub = new EventEmitter();
  stub.start = () => {};
  stub.stop = () => {};
  return stub;
}

// Comments in this repo deliberately NAME the thing the code must not do, so
// strip them before any "this identifier does not appear" assertion. Line
// comments only — both the C# inside toast-helper.ps1 and the JS use //.
function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
}

/**
 * A started monitor whose every subsystem is inert, with the toast helper
 * replaced by a recorder that answers the popup with `answer`.
 */
function makeMonitor({ answer = { action: 'edit' }, editing = false } = {}) {
  const reported = [];
  const toasts = [];
  const dialogs = [];
  const tokenized = [];
  const holds = [];
  const logged = [];
  const log = {
    info: (m) => logged.push(String(m)),
    warn: (m) => logged.push(String(m)),
    error: (m) => logged.push(String(m)),
    child: () => log,
  };

  const monitor = new OsMonitor({ serverUrl: '', token: '', log, enforcerEnabled: false });
  monitor.poller = inertWatcher();
  monitor.dialogWatcher = inertWatcher();
  monitor.attachmentWatcher = inertWatcher();
  monitor.promptWatcher = inertWatcher();
  monitor.enforcer = Object.assign(new EventEmitter(), {
    start() {}, stop() {}, attachHold() {}, updateBlockPatterns() {},
    tokenize(blockId, text = '') { tokenized.push({ blockId, text }); return true; },
    tokenizeEditHold(blockId, on) { holds.push({ blockId, on }); return true; },
  });
  monitor.toast = {
    start() {}, stop() {},
    show: (t) => toasts.push(t),
    showRequestDialog: async () => ({ action: 'cancel', reason: '' }),
    showTokenizeDialog: async (opts) => {
      dialogs.push(opts);
      // The real helper reports the edit view opening on its own stdout line,
      // BEFORE the answer; notify.js turns that into this callback. Driven here
      // by the fixture so the hold half of the flow is exercised too.
      if (editing) await opts.onEditing?.();
      return typeof answer === 'function' ? answer(opts) : answer;
    },
  };
  monitor.reporter = { start() {}, stop() {}, enqueue: (e) => reported.push(e) };
  monitor.policySync.start = () => {};
  monitor.featureSync.start = () => {};
  monitor.start();
  return { monitor, reported, toasts, dialogs, tokenized, holds, logged };
}

// #offerTokenize is async and awaits the popup, so let the microtask queue drain
// before asserting on what it did.
const flush = () => new Promise((r) => setImmediate(r));

/** Emit one enforcer block line and return what the monitor did with it. */
async function blocked(block, opts) {
  const h = makeMonitor(opts);
  try {
    h.monitor.enforcer.emit('block', block);
    await flush();
    await flush();
    await flush();
  } finally {
    h.monitor.stop();
  }
  return h;
}

// The real enforcer lines, as enforcer-win.ps1's EmitBlock writes them. `preview`
// is already the MASKED text (see _pendingPreview / ComputeMaskCandidate) — the
// original never crosses this boundary.
const CONTENT_BLOCK = {
  kind: 'block', reason: 'send', process: 'Claude',
  patterns: 'us-ssn', block_id: 'b-1',
  rewritable: true, preview: 'my ssn is [SSN]',
};

// ── A. the popup is offered for exactly one case ─────────────────────────────

test('a rewritable content block opens the Tokenize & Send popup', async () => {
  const { dialogs } = await blocked(CONTENT_BLOCK);
  assert.equal(dialogs.length, 1, 'the CLI agent must now offer the choice, not just a toast');
  const { onEditing, ...values } = dialogs[0];
  assert.deepEqual(values, {
    appName: 'Claude',
    categories: 'us-ssn',
    preview: 'my ssn is [SSN]',
    dedupeKey: 'b-1',
  });
  // The one non-value: a callback for the edit view opening. It carries nothing
  // in either direction — see the edit_send tests below.
  assert.equal(typeof onEditing, 'function');
});

test('the popup is keyed on the BLOCK ID, so held-down Enter cannot stack windows', async () => {
  // The enforcer emits a block per swallowed send and keeps block_id stable
  // while the composer text is unchanged, so every repeat must dedupe onto the
  // one popup — and the key it dedupes on has to be that id, not a fresh one.
  const { dialogs } = await blocked(CONTENT_BLOCK);
  assert.equal(dialogs[0].dedupeKey, CONTENT_BLOCK.block_id);
});

test('a second block for the SAME id while the popup is open does not open another', async () => {
  // The in-flight guard on this side: the helper refuses to draw a second
  // window, but without this each repeat would leave a pending promise behind.
  let release;
  const h = makeMonitor({ answer: () => new Promise((r) => { release = r; }) });
  try {
    h.monitor.enforcer.emit('block', CONTENT_BLOCK);
    await flush();
    h.monitor.enforcer.emit('block', CONTENT_BLOCK);
    await flush();
    assert.equal(h.dialogs.length, 1, 'one popup per in-flight block');
    release({ action: 'edit' });
    await flush();
  } finally {
    h.monitor.stop();
  }
});

test('a PLATFORM block never opens the Tokenize popup — that case is Request Access', async () => {
  const { dialogs } = await blocked({
    ...CONTENT_BLOCK, platform_block: true, blocked_agent: 'Claude',
    // Belt and braces: even if a future change let a platform block through as
    // rewritable, the isPlatform exclusion must still hold.
    rewritable: true, preview: 'anything',
  });
  assert.equal(dialogs.length, 0);
});

test('an ATTACHMENT hold never opens the Tokenize popup — masking text cannot remove a file', async () => {
  const { dialogs } = await blocked({
    ...CONTENT_BLOCK, reason: 'attachment', filename: 'payroll.xlsx',
    rewritable: true, preview: 'anything',
  });
  assert.equal(dialogs.length, 0);
});

test('a non-rewritable block opens no popup — there is nothing to offer', async () => {
  // e.g. a guardrail / prompt-injection match, which has no maskable span.
  const { dialogs } = await blocked({
    ...CONTENT_BLOCK, rewritable: false, preview: '', why_not: 'no_maskable_span',
  });
  assert.equal(dialogs.length, 0);
});

test('a rewritable block with an empty preview opens no popup', async () => {
  // The preview IS the popup's content — an empty "This is what gets sent" box
  // would be worse than the toast it accompanies.
  const { dialogs } = await blocked({ ...CONTENT_BLOCK, preview: '' });
  assert.equal(dialogs.length, 0);
});

test('a rewritable block with no block_id opens no popup', async () => {
  const { dialogs } = await blocked({ ...CONTENT_BLOCK, block_id: '' });
  assert.equal(dialogs.length, 0);
});

test('the popup is offered ALONGSIDE the existing toast and report, never instead of them', async () => {
  const h = await blocked(CONTENT_BLOCK);
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.toasts.length, 1, 'the block toast must still fire');
  assert.ok(h.reported.find((e) => e.kind === 'enforcement_block'), 'the block must still be reported');
});

// ── B. what each answer does ─────────────────────────────────────────────────

test('"Tokenize & Send" sends the pre-existing {cmd:tokenize, block_id} command', async () => {
  const { tokenized, holds } = await blocked(CONTENT_BLOCK, { answer: { action: 'tokenize' } });
  assert.deepEqual(tokenized, [{ blockId: 'b-1', text: '' }],
    'the block id, unchanged and with NO text — the enforcer computes and validates the mask itself');
  assert.deepEqual(holds, [], 'no edit box opened, so no pin was held');
});

test('"Edit manually" sends nothing — the block stands', async () => {
  const { tokenized } = await blocked(CONTENT_BLOCK, { answer: { action: 'edit' } });
  assert.deepEqual(tokenized, []);
});

test('every non-answer degrades to leaving the block standing', async () => {
  // This is the whole safety argument for adding the popup: before it existed,
  // "do nothing" was the only behaviour, so every path that fails to get a
  // clear yes must land back exactly there.
  for (const action of ['timeout', 'suppressed', 'unavailable', 'error', '', undefined]) {
    const { tokenized } = await blocked(CONTENT_BLOCK, { answer: { action } });
    assert.deepEqual(tokenized, [], `action=${String(action)} must not send`);
  }
});

// ── B2. "Edit manually" → Send: the user's own wording ───────────────────────
//
// THE GAP THIS COVERS: "Edit manually" used to just close the popup, leaving
// the user to go back to the app and retype their whole message from memory.
// The same window now swaps to a text box pre-filled with the MASKED text, and
// Send asks the enforcer to type THAT instead of its own masked candidate —
// through the same command, with every one of its gates re-run against the new
// string.

const EDITED = 'my ssn is on file with HR, please look it up there';

test('"Edit manually" → Send relays the edited text on the SAME tokenize command', async () => {
  const { tokenized } = await blocked(CONTENT_BLOCK, {
    editing: true,
    answer: { action: 'edit_send', text: EDITED },
  });
  assert.deepEqual(tokenized, [{ blockId: 'b-1', text: EDITED }],
    'the pinned block id plus the user\'s wording — one mechanism, not a second one');
});

test('opening the edit box holds the enforcer\'s pin, and Send consumes it', async () => {
  // The pin is what the whole rewrite hangs off, and the enforcer's poll thread
  // used to drop it the instant the foreground stopped being the AI app — which
  // is the instant a text box takes keyboard focus. So it is told.
  const { holds, tokenized } = await blocked(CONTENT_BLOCK, {
    editing: true,
    answer: { action: 'edit_send', text: EDITED },
  });
  assert.deepEqual(holds, [{ blockId: 'b-1', on: true }],
    'held once on the way in; a consumed hold is NOT released — the rewrite reads its expiry');
  assert.equal(tokenized.length, 1);
});

test('a cancelled or abandoned edit gives the pin straight back', async () => {
  for (const action of ['edit', 'timeout', 'cancel', 'suppressed', 'unavailable', '', undefined]) {
    const { holds, tokenized } = await blocked(CONTENT_BLOCK, {
      editing: true,
      answer: { action, text: EDITED },
    });
    assert.deepEqual(tokenized, [], `action=${String(action)} must not send`);
    assert.deepEqual(holds, [{ blockId: 'b-1', on: true }, { blockId: 'b-1', on: false }],
      `action=${String(action)} must release the hold it took`);
  }
});

test('a popup that throws after the edit box opened still releases the hold', async () => {
  const { holds, tokenized, logged } = await blocked(CONTENT_BLOCK, {
    editing: true,
    answer: () => Promise.reject(new Error('helper died')),
  });
  assert.deepEqual(tokenized, []);
  assert.deepEqual(holds, [{ blockId: 'b-1', on: true }, { blockId: 'b-1', on: false }]);
  assert.ok(logged.some((m) => /tokenize: offer failed/.test(m)));
});

test('an EMPTY edit fails closed — nothing is typed and the block stands', async () => {
  // Never "send an empty message": clearing the composer and submitting nothing
  // is a message the user did not write, under their name.
  for (const text of ['', '   ', '\n\t ', undefined, null, 42, { text: EDITED }]) {
    const { tokenized, logged } = await blocked(CONTENT_BLOCK, {
      editing: true,
      answer: { action: 'edit_send', text },
    });
    assert.deepEqual(tokenized, [], `text=${JSON.stringify(text)} must not be typed`);
    assert.ok(logged.some((m) => /the edit box came back empty/.test(m)),
      `text=${JSON.stringify(text)} must say why it refused`);
  }
});

test('a non-string text on an edit_send is dropped, never stringified into a command', async () => {
  const { tokenized } = await blocked(CONTENT_BLOCK, {
    editing: true,
    answer: { action: 'edit_send', text: { toString: () => 'ssn 123-45-6789' } },
  });
  assert.deepEqual(tokenized, []);
});

test('edit_send is refused for a block that was never offered one', async () => {
  // The gate that decides whether the popup opens at all is the same gate for
  // both answers — there is no path to an edit box for a platform block or an
  // attachment hold, so there is no path to typing one's edited text either.
  for (const block of [
    { ...CONTENT_BLOCK, platform_block: true, blocked_agent: 'Claude' },
    { ...CONTENT_BLOCK, reason: 'attachment', filename: 'payroll.xlsx' },
    { ...CONTENT_BLOCK, rewritable: false },
    { ...CONTENT_BLOCK, block_id: '' },
  ]) {
    const { dialogs, tokenized, holds } = await blocked(block, {
      editing: true,
      answer: { action: 'edit_send', text: EDITED },
    });
    assert.deepEqual(dialogs, []);
    assert.deepEqual(tokenized, []);
    assert.deepEqual(holds, []);
  }
});

test('the edited text is not logged, reported or stored — only relayed', async () => {
  // Mirrors the "no raw value" rule this file already holds the preview to. The
  // edited text is content: the ONE thing it may be used for is being typed.
  const secretish = 'call me on 555-0100 about [SSN]';
  const { logged, reported, monitor } = await blocked(CONTENT_BLOCK, {
    editing: true,
    answer: { action: 'edit_send', text: secretish },
  });
  for (const line of logged) {
    assert.equal(line.includes(secretish), false, `the edited text leaked into a log line: ${line}`);
    assert.equal(/555-0100/.test(line), false, `the edited text leaked into a log line: ${line}`);
  }
  const out = JSON.stringify(reported);
  assert.equal(out.includes(secretish), false, 'the edited text must never be enqueued for the server');
  assert.equal(out.includes('555-0100'), false);
  // Nor parked on the monitor for later — the audit record still comes from the
  // enforcer's own verified rewrite line (see os-monitor-redact-audit).
  assert.equal(JSON.stringify(monitor.rewriteContext ?? null).includes(secretish), false);
});

test('a popup failure cannot become an unhandled rejection in the monitor', async () => {
  // It runs off an enforcer stdout line, so a throw here would take the
  // monitor's event handler with it.
  const { tokenized, logged } = await blocked(CONTENT_BLOCK, {
    answer: () => Promise.reject(new Error('helper died')),
  });
  assert.deepEqual(tokenized, []);
  assert.ok(logged.some((m) => /tokenize: offer failed/.test(m)));
});

// ── C. no prompt content escapes ─────────────────────────────────────────────

test('only pattern NAMES and the already-masked preview reach the popup', async () => {
  const { dialogs } = await blocked(CONTENT_BLOCK);
  const sent = JSON.stringify(dialogs[0]);
  // The masked preview is the point of the popup and must be there…
  assert.match(sent, /\[SSN\]/);
  // …and nothing that could be the raw value may be.
  assert.equal(/123-45-6789/.test(sent), false);
  assert.deepEqual(Object.keys(dialogs[0]).sort(),
    ['appName', 'categories', 'dedupeKey', 'onEditing', 'preview']);
});

test('nothing about the prompt is logged by the offer path', async () => {
  const { logged } = await blocked(CONTENT_BLOCK, { answer: { action: 'tokenize' } });
  for (const line of logged) {
    assert.equal(/\[SSN\]/.test(line), false, `masked prompt text leaked into a log line: ${line}`);
    assert.equal(/my ssn is/.test(line), false, `prompt text leaked into a log line: ${line}`);
  }
});

test('the offer reports no second event — the block record already exists', async () => {
  const before = (await blocked(CONTENT_BLOCK, { answer: { action: 'edit' } })).reported.length;
  const after = (await blocked(CONTENT_BLOCK, { answer: { action: 'tokenize' } })).reported.length;
  assert.equal(after, before, 'clicking Tokenize must not enqueue anything by itself');
  // The audit record for a completed rewrite is enforcement_redact, written by
  // the 'rewrite' handler when the enforcer confirms the send — see
  // os-monitor-redact-audit.test.mjs. Nothing here anticipates it.
});

// ── D. notify.js: the promise, the correlation, the command ──────────────────

test('showTokenizeDialog answers unavailable when there is no helper, instead of hanging', async () => {
  const svc = new ToastService({ log: { info() {}, warn() {} } });
  const result = await svc.showTokenizeDialog({ appName: 'Claude', preview: '[SSN]' });
  assert.deepEqual(result, { action: 'unavailable', text: '' });
  assert.equal(svc.pendingDialogs.size, 0, 'nothing may be left waiting for a reply that cannot come');
});

test('showTokenizeDialog writes the helper command and correlates on a generated id', { skip: process.platform !== 'win32' ? 'windows-only path' : false }, async () => {
  const written = [];
  const svc = new ToastService({ log: { info() {}, warn() {} } });
  // A fake child — the real one is a PowerShell process this file may not spawn.
  svc.child = { stdin: { writable: true, write: (s) => written.push(s) } };
  svc.ready = true;
  svc.dialogSupported = true;

  const pending = svc.showTokenizeDialog({
    appName: 'Claude', categories: 'us-ssn', preview: 'my ssn is [SSN]', dedupeKey: 'b-1',
  });

  assert.equal(written.length, 1);
  const cmd = JSON.parse(written[0]);
  assert.equal(cmd.cmd, 'show_tokenize_dialog');
  assert.equal(cmd.dedupe_key, 'b-1');
  assert.equal(cmd.app_name, 'Claude');
  assert.equal(cmd.categories, 'us-ssn');
  assert.equal(cmd.preview, 'my ssn is [SSN]');
  assert.match(cmd.request_id, /^[0-9a-f-]{36}$/, 'a generated uuid, so two popups cannot cross answers');
  assert.equal(svc.pendingDialogs.has(cmd.request_id), true);

  // The waiter is settled by the helper's reply in real use; drain it here so
  // the test does not leave a live timer behind.
  svc.child = null;
  svc.pendingDialogs.get(cmd.request_id).resolve({ action: 'edit' });
  clearTimeout(svc.pendingDialogs.get(cmd.request_id).timer);
  svc.pendingDialogs.clear();
  assert.deepEqual(await pending, { action: 'edit' });
});

test('an unanswered popup times out rather than leaking a pending promise', { skip: process.platform !== 'win32' ? 'windows-only path' : false }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const svc = new ToastService({ log: { info() {}, warn() {} } });
  svc.child = { stdin: { writable: true, write: () => {} } };
  svc.ready = true;
  svc.dialogSupported = true;

  const pending = svc.showTokenizeDialog({ appName: 'Claude', preview: '[SSN]' });
  assert.equal(svc.pendingDialogs.size, 1);
  // The helper closes its own form at 16s; this side's backstop is 20s, so it
  // can only fire after that line was missed entirely.
  t.mock.timers.tick(16_000);
  assert.equal(svc.pendingDialogs.size, 1, 'must not give up before the helper does');
  t.mock.timers.tick(5_000);
  assert.deepEqual(await pending, { action: 'timeout', text: '' });
  assert.equal(svc.pendingDialogs.size, 0);
});

test('notify.js settles a tokenize_dialog_result and gives up nothing to a helper crash', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'notify.js'), 'utf8');
  // The stdout branch — a missing case here would silently drop every answer,
  // the same class of bug enforcer.js already hit once for its 'route' kind.
  assert.match(src, /ev\.kind === 'tokenize_dialog_result'/);
  assert.match(src, /const action = String\(ev\.action \|\| 'edit'\);/);
  // `text` is read off exactly ONE action, so a helper line that put it on any
  // other could not smuggle a string into a rewrite.
  assert.match(src, /text: action === 'edit_send' && typeof ev\.text === 'string' \? ev\.text : '',/);
  // Not queued behind `ready` like a toast is: this popup offers to rewrite a
  // composer whose contents the enforcer pinned seconds ago, and that pin expires.
  const fn = src.slice(src.indexOf('showTokenizeDialog({'), src.indexOf('#settleDialog(requestId, result)'));
  assert.ok(fn.length > 0, 'expected a showTokenizeDialog body');
  assert.equal(/queueBeforeReady/.test(fn), false, 'a popup must never be queued for later');
  assert.match(fn, /if \(!this\.ready \|\| !this\.dialogSupported \|\| !this\.child\)/);
  assert.match(fn, /const requestId = randomUUID\(\);/);
  // A helper crash answers every waiter — shared with the Request Access dialog,
  // which is the point of one pendingDialogs map.
  const exit = src.slice(src.indexOf("this.child.on('exit'"), src.indexOf("this.child.on('error'"));
  assert.match(exit, /this\.#settleDialog\(id, \{ action: 'unavailable', reason: '' \}\)/);
  // No second staleness clock: the enforcer owns that judgement.
  assert.match(src, /const TOKENIZE_DIALOG_TIMEOUT_MS = 20 \* 1000;/);
});

// ── E. toast-helper.ps1: the dialog itself ───────────────────────────────────

test('toast-helper.ps1: show_tokenize_dialog is wired into the stdin switch', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  assert.match(src, /'show_tokenize_dialog' \{ Show-CFAITokenizeDialog \$cmd \}/);
  // …and the pre-existing command is untouched.
  assert.match(src, /'show_request_dialog' \{ Show-CFAIRequestDialog \$cmd \}/);
  // The stdin loop is still a bare blocking ReadLine.
  assert.match(src, /\$line = \[Console\]::In\.ReadLine\(\)/);
});

test('toast-helper.ps1: the tokenize popup runs on its own STA thread and never blocks the stdin loop', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  assert.match(src, /new Thread\(delegate\(\) \{ Run\(requestId, key, appName, categories, preview\); \}\)/);
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  assert.match(fn, /t\.SetApartmentState\(ApartmentState\.STA\);/);
  assert.match(fn, /t\.IsBackground = true;/);
  assert.match(fn, /Application\.Run\(form\);/);
  // A blocking ShowDialog would freeze the command loop — asserted globally by
  // os-monitor-safety.test.mjs, restated here for the type this file owns.
  assert.equal(/ShowDialog\(/.test(codeOnly(fn)), false);
});

test('toast-helper.ps1: the tokenize popup\'s CHOICE view never takes the foreground', async () => {
  // THE load-bearing property of this dialog's first view. The enforcer
  // re-verifies GetForegroundWindow() against the window it pinned at block
  // time before it types anything (RunRewrite's "focus_changed" abort). A popup
  // that stole focus while the user is choosing would guarantee that clicking
  // its own primary button does nothing — which is exactly why the Electron
  // popup is focusable:false + showInactive().
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  assert.match(src, /public class CfaiNoActivateForm : Form/);
  assert.match(src, /const int WS_EX_NOACTIVATE = 0x08000000;/);
  // The style is now CONDITIONAL on the form's own one-way flag, which starts
  // true — so a form that is never told otherwise behaves exactly as before.
  assert.match(src, /bool _noActivate = true;/);
  assert.match(src, /protected override bool ShowWithoutActivation \{ get \{ return _noActivate; \} \}/);
  assert.match(src, /if \(_noActivate\) cp\.ExStyle \|= WS_EX_NOACTIVATE;/);
  assert.match(src, /cp\.ExStyle \|= WS_EX_TOPMOST \| WS_EX_TOOLWINDOW;/);
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  assert.match(fn, /CfaiNoActivateForm form = new CfaiNoActivateForm\(\);/);
  // The Request Access dialog DOES activate (its reason box needs typing), so
  // the two must not be unified — assert it still builds a plain Form.
  const request = src.slice(src.indexOf('public static class CfaiRequestDialog'), src.indexOf('public class CfaiNoActivateForm'));
  assert.match(request, /Form form = new Form\(\);/);
  assert.match(request, /form\.Activate\(\); box\.Focus\(\);/);

  // …and the CHOICE view still grabs nothing: not while it is being built, and
  // not from the button the user is expected to click. A stray keypress from
  // their own swallowed Enter has nowhere in this window to land.
  const built = codeOnly(fn.slice(fn.indexOf('static void Run('), fn.indexOf("// ── The edit view's controls")));
  assert.ok(built.length > 0, 'expected a choice-view construction region');
  assert.equal(/Activate\(\)|\.Focus\(\)|AllowActivation\(\)|SetForegroundWindow/.test(built), false,
    'the choice view must never grab focus — the rewrite it offers depends on not having it');
  const onTokenize = codeOnly(fn.slice(fn.indexOf('tokenize.Click += delegate'), fn.indexOf('edit.Click += delegate')));
  assert.ok(onTokenize.length > 0, 'expected the Tokenize handler');
  assert.equal(/Activate\(\)|\.Focus\(\)|AllowActivation\(\)|SetForegroundWindow/.test(onTokenize), false,
    'Tokenize & Send must close, not focus — the rewrite starts the moment it does');
  // Nor is the form ever shown activated: Application.Run on a
  // CfaiNoActivateForm is the whole mechanism, and there is no Show()/Shown
  // handler doing what the Request Access dialog's does.
  assert.equal(/form\.Shown \+=/.test(codeOnly(fn)), false);
});

test('toast-helper.ps1: ONLY the edit view takes focus, and it hands it back before anything is typed', async () => {
  // THE CONFLICT AND ITS RESOLUTION. A text box the user types into needs
  // keyboard focus, which a WS_EX_NOACTIVATE window cannot have. So the edit
  // view — and only it — drops the style. That is safe because of WHEN each
  // thing happens, and this test pins the ordering that makes it so.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));

  // 1. Exactly one way to drop the style, it is one-way, and it comes off the
  //    LIVE window (CreateParams is only read at handle creation).
  const form = src.slice(src.indexOf('public class CfaiNoActivateForm : Form'),
                         src.indexOf('public static class CfaiTokenizeDialog'));
  assert.match(form, /public void AllowActivation\(\)/);
  assert.match(form, /if \(!_noActivate\) return;\s*\r?\n\s*_noActivate = false;/);
  assert.match(form, /SetWindowLong\(h, GWL_EXSTYLE, ex & ~WS_EX_NOACTIVATE\);/);
  assert.match(form, /SetForegroundWindow\(h\);/);
  assert.equal((fn.match(/AllowActivation\(\)/g) || []).length, 1,
    'exactly one caller — the edit view');

  // 2. It happens on a DELAY, so the enforcer has been told to hold its pin
  //    before this window is allowed to steal the foreground.
  assert.match(fn, /activate\.Interval = ActivateEditMs;/);
  assert.match(fn, /activate\.Stop\(\);\s*\r?\n\s*form\.AllowActivation\(\);/);
  assert.match(fn, /editBox\.Focus\(\); editBox\.SelectionStart = editBox\.Text\.Length;/);
  // …and the editing line goes out FIRST, inside the same click handler.
  const click = fn.slice(fn.indexOf('edit.Click += delegate'), fn.indexOf('editBox.TextChanged'));
  assert.ok(click.length > 0, 'expected the Edit-manually handler');
  assert.ok(click.indexOf('tokenize_dialog_editing') < click.indexOf('activate.Start()'),
    'the caller must be told before this window takes the foreground, not after');

  // 3. On Send the window HIDES first and closes on a timer, so the foreground
  //    is back on the AI app before the answer is even written — the enforcer's
  //    own focus_changed abort is the net, this is what makes it not fire.
  const send = fn.slice(fn.indexOf('send.Click += delegate'), fn.indexOf('cancel.Click += delegate'));
  assert.ok(send.length > 0, 'expected the Send handler');
  assert.match(send, /form\.Hide\(\);/);
  assert.match(send, /closer\.Start\(\);/);
  assert.equal(/form\.Close\(\)/.test(codeOnly(send)), false,
    'Send must not close the window synchronously — hiding it is what returns the foreground');
  assert.match(fn, /closer\.Interval = ReturnFocusMs;/);
  assert.match(fn, /closer\.Tick \+= delegate\(object s, EventArgs e\) \{ closer\.Stop\(\); form\.Close\(\); \};/);
});

test('toast-helper.ps1: the tokenize popup is ephemeral — no taskbar entry, one per block, self-expiring', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  // The standing rule: nothing this process shows may look like a running app.
  assert.match(fn, /form\.ShowInTaskbar = false;/);
  assert.equal(/NotifyIcon|ContextMenuStrip|TrayIcon/.test(fn), false);
  // Concurrency guard, released when the form closes.
  assert.match(fn, /if \(Open\.ContainsKey\(key\)\) return false;/);
  assert.match(fn, /lock \(Open\) \{ Open\.Remove\(key\); \}/);
  assert.match(src, /"action":"suppressed"/);
  // Self-closes at 16s, derived from the Electron popup's own 16s, itself
  // derived from REWRITE_TTL (15s).
  assert.match(fn, /public const int TimeoutMs = 16000;/);
  assert.match(fn, /if \(action == "edit"\) action = "timeout";/);
  // The preview LABEL is capped for display. `preview` itself is not sliced any
  // more — the edit box is pre-filled from it and its contents are what gets
  // typed, so a truncated pre-fill would let the user send half a message.
  assert.match(fn, /public const int PreviewMax = 300;/);
  assert.match(fn, /string shownPreview = preview\.Length > PreviewMax\s*\r?\n\s*\? preview\.Substring\(0, PreviewMax\) \+ "\.\.\." : preview;/);
  assert.match(fn, /previewText\.Text = shownPreview;/);
  assert.match(fn, /editBox\.Text = preview;/);
});

test('toast-helper.ps1: the buttons produce exactly three actions, and "edit" is still the default', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  // "edit" is the SAFE default: it is also what closing the window produces,
  // since the result is written after Application.Run returns — and it is still
  // what the edit view's own Cancel produces, so that path is unchanged.
  assert.match(fn, /string action = "edit";/);
  assert.match(fn, /action = "tokenize";/);
  assert.match(fn, /action = "edit_send";/);
  assert.match(fn, /tokenize\.Text = "Tokenize && Send";/);
  assert.match(fn, /edit\.Text = "Edit manually";/);
  assert.match(fn, /send\.Text = "Send";/);
  assert.match(fn, /cancel\.Text = "Cancel";/);
  // The ONLY assignments to `action` in the whole type (the "edit" one being
  // its initial value), so a new outcome cannot appear without being reviewed
  // here.
  assert.deepEqual([...fn.matchAll(/\baction = "(\w+)";/g)].map((m) => m[1]).sort(),
    ['edit', 'edit_send', 'error', 'timeout', 'tokenize']);
  // Tokenize & Send is the primary/default-marked action, matching the browser
  // extension's own convention…
  assert.match(fn, /form\.AcceptButton = tokenize;/);
  // …and it is CLEARED for the edit view, where the multi-line box owns Enter —
  // the same rule the Request Access dialog's reason box already follows.
  assert.match(fn, /form\.AcceptButton = null;/);
  assert.match(fn, /form\.CancelButton = cancel;/);
});

test('toast-helper.ps1: the edit view is the SAME window, swapped in place', async () => {
  // Not a second window: a second one would be a second thing on screen for a
  // process that owns no standing UI, and it would have to re-derive the
  // dedupe/expiry/stdout-lock arrangement this one already has.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  assert.equal((fn.match(/new CfaiNoActivateForm\(\)/g) || []).length, 1, 'exactly one Form');
  assert.equal((fn.match(/Application\.Run\(/g) || []).length, 1, 'exactly one message loop');
  assert.equal(/new Thread\(/.test(fn.slice(fn.indexOf('static void Run('))), false,
    'the edit view must not spawn a thread of its own');

  // The swap is a Visible flip, both ways, over the controls of each view.
  const click = fn.slice(fn.indexOf('edit.Click += delegate'), fn.indexOf('editBox.TextChanged'));
  for (const hidden of ['body', 'chip', 'previewLabel', 'previewText', 'hint', 'foot', 'tokenize', 'edit']) {
    assert.match(click, new RegExp(`${hidden}\\.Visible = false;`), `${hidden} must be hidden`);
  }
  for (const shown of ['editLabel', 'editHint', 'editBox', 'editCount', 'send', 'cancel']) {
    assert.match(click, new RegExp(`${shown}\\.Visible = true;`), `${shown} must be shown`);
  }
  // The edit controls are built hidden up front, so the swap cannot half-fail.
  const build = fn.slice(fn.indexOf('Label editLabel = new Label();'), fn.indexOf('edit.Click += delegate'));
  for (const c of ['editLabel', 'editHint', 'editBox', 'editCount', 'send', 'cancel']) {
    assert.match(build, new RegExp(`${c}\\.Visible = false;`), `${c} must start hidden`);
  }
});

test('toast-helper.ps1: the edit box is capped at the enforcer\'s own write limit', async () => {
  // LOCKSTEP. EditMax mirrors REWRITE_MAX_CHARS in enforcer-win.ps1, which is
  // DERIVED from that file's write-loop constants — so it is recomputed here
  // from those same constants rather than restated as a number. If the pacing
  // ever changes, this fails instead of the box silently allowing more
  // characters than the enforcer can type (which fails closed, but only after
  // the user has typed them).
  const helper = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const enf = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const num = (re, what) => {
    const m = enf.match(re);
    assert.ok(m, `expected ${what} in enforcer-win.ps1`);
    return Number(m[1]);
  };
  const charDelay = num(/const int REWRITE_CHAR_DELAY_MS = (\d+);/, 'REWRITE_CHAR_DELAY_MS');
  const chunkDelay = num(/const int REWRITE_CHUNK_DELAY_MS = (\d+);/, 'REWRITE_CHUNK_DELAY_MS');
  const chunk = num(/const int REWRITE_CHUNK = (\d+);/, 'REWRITE_CHUNK');
  const budget = num(/const int REWRITE_WRITE_BUDGET_MS = (\d+);/, 'REWRITE_WRITE_BUDGET_MS');
  const marginNum = num(/const int REWRITE_BUDGET_MARGIN_NUM = (\d+);/, 'REWRITE_BUDGET_MARGIN_NUM');
  const marginDen = num(/const int REWRITE_BUDGET_MARGIN_DEN = (\d+);/, 'REWRITE_BUDGET_MARGIN_DEN');
  // The .ps1's own arithmetic, in integer division exactly as C# does it.
  const chunkMs = chunk * charDelay + chunkDelay;
  const usable = Math.trunc(budget * marginNum / marginDen);
  const maxChars = chunk * Math.trunc(usable / chunkMs);
  assert.equal(maxChars, 456, 'the derivation itself moved — re-check EditMax');
  assert.match(helper, new RegExp(`public const int EditMax = ${maxChars};`));
  assert.match(helper, /editBox\.MaxLength = EditMax;/);
  // Shown to the user, so hitting the cap is visible rather than a dead key.
  assert.match(helper, /editCount\.Text = editBox\.Text\.Length \+ " \/ " \+ EditMax;/);
});

test('toast-helper.ps1: the edit view\'s clock is longer than the choice view\'s, and shorter than every clock behind it', async () => {
  // Ordered so the SCREEN gives up first and the enforcer's pin last: a dialog
  // that outlived its own pin would leave the user typing into a box whose
  // answer can only ever come back "expired".
  const helper = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const notify = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'notify.js'), 'utf8');
  const enf = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');

  const choiceMs = Number(helper.match(/public const int TimeoutMs = (\d+);/)[1]);
  const editMs = Number(helper.match(/public const int EditTimeoutMs = (\d+);/)[1]);
  const backstopM = notify.match(/const TOKENIZE_EDIT_TIMEOUT_MS = (\d+) \* 1000;/);
  assert.ok(backstopM, 'expected notify.js to have its own edit backstop');
  const backstopMs = Number(backstopM[1]) * 1000;
  const pinM = enf.match(/REWRITE_EDIT_TTL = TimeSpan\.FromSeconds\((\d+)\)\.Ticks;/);
  assert.ok(pinM, 'expected REWRITE_EDIT_TTL in enforcer-win.ps1');
  const pinMs = Number(pinM[1]) * 1000;

  assert.equal(choiceMs, 16000, 'the choice view is unchanged');
  assert.ok(editMs > choiceMs, 'typing a sentence needs longer than clicking a button');
  assert.ok(editMs < backstopMs, 'the form must give up before the Node backstop does');
  assert.ok(backstopMs < pinMs, "the enforcer's pin must outlive every client clock");
  // The choice view's expiry is REUSED with the longer interval rather than a
  // second timer racing it.
  assert.match(helper, /expiry\.Interval = EditTimeoutMs;/);
  const click = helper.slice(helper.indexOf('edit.Click += delegate'), helper.indexOf('editBox.TextChanged'));
  assert.match(click, /expiry\.Stop\(\);/);
  // The base TTL is NOT what moved — the plain Tokenize & Send path still
  // answers inside it.
  assert.match(enf, /REWRITE_TTL = TimeSpan\.FromSeconds\(15\)\.Ticks;/);
});

test('toast-helper.ps1: the popup mirrors the browser extension\'s wording', async () => {
  // The desktop and browser experiences have to read as one product — the
  // browser modal's copy is the source of truth (browser-extension/content).
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  assert.match(fn, /"This is what gets sent"/);
  assert.match(fn, /The original values are never sent, and cannot be /);
  assert.match(fn, /recovered from the label\./);
  // The matched category is SHOWN, and comes from the caller — this type must
  // not re-derive it (it has no patterns and no original text to derive from).
  assert.match(fn, /chip\.Text = cats;/);
  assert.equal(/Regex|new Regex/.test(fn), false, 'the popup must not scan anything itself');
  // '&' in the hint is literal text, not a WinForms access key.
  assert.match(fn, /hint\.UseMnemonic = false;/);
});

test('toast-helper.ps1: the result line carries the choice, and text on exactly one action', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  assert.match(fn, /"\{\\"kind\\":\\"tokenize_dialog_result\\""/);
  assert.match(fn, /",\\"request_id\\":\\"" \+ CfaiRequestDialog\.Esc\(requestId\) \+ "\\""/);
  assert.match(fn, /",\\"action\\":\\"" \+ CfaiRequestDialog\.Esc\(action\) \+ "\\""/);
  const from = fn.indexOf('CfaiRequestDialog.Write("{\\"kind\\":\\"tokenize_dialog_result');
  assert.ok(from >= 0, 'expected the result-line write');
  const write = fn.slice(from, fn.indexOf('+ "}");', from));
  // The masked preview is still NOT echoed back for any action: it is content,
  // the caller already has it, and Node must never receive prompt text it did
  // not send. The `text` field is the user's OWN edit of it and is the whole
  // point of edit_send — CONDITIONAL on that action, so nothing else can carry
  // it, and escaped through the same Esc() the reason box uses.
  assert.match(write, /\(action == "edit_send" \? ",\\"text\\":\\"" \+ CfaiRequestDialog\.Esc\(editedText\) \+ "\\"" : ""\)/);
  assert.equal(/preview|shownPreview|categories|appName|app_name/.test(write), false,
    `the result line must carry only the id, the action and the edit: ${write}`);
  // editedText is set in exactly one place, from the box, and cleared on error.
  assert.deepEqual([...fn.matchAll(/editedText = ([^;]+);/g)].map((m) => m[1]),
    ['""', 'editBox.Text', '""']);
});

test('toast-helper.ps1: the editing line is a correlation id and nothing else', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  const from = fn.indexOf('CfaiRequestDialog.Write("{\\"kind\\":\\"tokenize_dialog_editing');
  assert.ok(from >= 0, 'expected the editing-line write');
  const write = fn.slice(from, fn.indexOf('+ "}");', from));
  const keys = [...write.matchAll(/\\"([a-z_]+)\\":/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ['kind', 'request_id'],
    'the editing line gained a field — every addition must be re-reviewed for PII');
  // Documented in the protocol header alongside the others.
  assert.match(src, /#   \{"kind":"tokenize_dialog_editing","request_id":"…"\}/);
});

test('toast-helper.ps1: the tokenize popup writes through the SAME single stdout lock', async () => {
  // Three writers now (the stdin loop and both dialog threads), so a result line
  // could otherwise land inside a {"kind":"pong"}.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('public static class CfaiTokenizeDialog'));
  assert.match(fn, /CfaiRequestDialog\.Write\("\{\\"kind\\":\\"tokenize_dialog_result\\""/);
  assert.equal(/Console\.Out\.WriteLine/.test(fn), false,
    'the tokenize popup must not write stdout directly — one writer, one lock');
  // Both types compile in ONE Add-Type call, which is what keeps that lock single.
  assert.equal((src.match(/Add-Type -TypeDefinition/g) || []).length, 1);
  assert.match(src, /\$DialogReady = \$true/);
});

test('toast-helper.ps1: a build that could not compile the dialogs answers unavailable, not silence', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('function Show-CFAITokenizeDialog'), src.indexOf('# Signal ready'));
  assert.match(fn, /if \(-not \$DialogReady\) \{/);
  assert.match(fn, /"action":"unavailable"/);
  // A command with no request_id is dropped rather than answered — there is
  // nothing to correlate it to.
  assert.match(fn, /tokenize-dialog-skipped: no request_id/);
});

// ── F. Electron is untouched ─────────────────────────────────────────────────

test('the Electron path still opens its own dialog off @@CFAI-BLOCK', async () => {
  // This is a NEW trigger for the CLI agent, not a replacement. Anyone still
  // running Electron must see exactly what they saw before.
  const main = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  assert.match(main, /if \(parsed\.rewritable\) showBlockDialogWindow\(parsed\);/);
  assert.match(main, /cmd: 'tokenize', block_id: blockId/);
  // …and the CLI path reaches the same command through the same wrapper, so
  // there is one mechanism with two triggers rather than two mechanisms.
  const index = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(index, /if \(!this\.tokenize\(blockId\)\) \{/);
  const enforcer = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(enforcer, /cmd: 'tokenize', block_id: blockId/);
});

test('index.js gates the popup on rewritable AND not platform AND not attachment', async () => {
  // Source-pinned as well as behaviour-tested: this one condition is the entire
  // scope of the change, and widening it is how the popup would start appearing
  // for blocks it cannot help with.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /if \(ev\.rewritable && ev\.block_id && !isPlatform && !isAttachment && ev\.preview\) \{/);
  // Exactly one call site.
  assert.equal((src.match(/this\.#offerTokenize\(/g) || []).length, 1);
  // The offer never reports anything of its own and never enqueues.
  const fn = src.slice(src.indexOf('async #offerTokenize(ev, ai)'), src.indexOf('// ── Request Access (desktop, non-Electron)'));
  assert.ok(fn.length > 0, 'expected an #offerTokenize body');
  assert.equal(/this\.reporter\.enqueue/.test(fn), false);
  assert.match(fn, /if \(result\.action !== 'tokenize'\) return;/);
  // No prompt content on any log line in the offer path — the preview OR the
  // user's own edit of it.
  assert.equal(/log\.\w+\(`?[^)]*\$\{[^}]*preview/.test(fn), false);
  assert.equal(/log\.\w+\(`?[^)]*\$\{[^}]*\btext\b/.test(fn), false);
});

// ── G. the edited text's route to the composer, hop by hop ───────────────────

test('index.js relays the edit through the SAME wrapper, and only for edit_send', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async #offerTokenize(ev, ai)'), src.indexOf('// ── Request Access (desktop, non-Electron)'));
  assert.ok(fn.length > 0, 'expected an #offerTokenize body');
  // Read as a string or not at all — a non-string is not content we can vouch
  // for and must never be stringified into a command.
  assert.match(fn, /const text = typeof result\.text === 'string' \? result\.text : '';/);
  // Fails closed on an empty box rather than clearing the composer and sending
  // nothing.
  assert.match(fn, /if \(!text\.trim\(\)\) \{/);
  assert.match(fn, /if \(!this\.tokenize\(blockId, text\)\) \{/);
  // ONE statement reads result.text, and it is inside the edit_send branch.
  assert.equal((fn.match(/const text = typeof result\.text === 'string' \? result\.text : '';/g) || []).length, 1);
  assert.equal((fn.match(/result\.text/g) || []).length, 2, 'the one ternary, and nothing else');
  const branch = fn.slice(fn.indexOf("if (result.action === 'edit_send')"), fn.indexOf("// 'edit' / 'timeout'"));
  assert.ok(branch.includes('result.text'), 'result.text must only be read for edit_send');
  // The wrapper defaults to no text, so the Electron caller is untouched.
  assert.match(src, /tokenize\(blockId, text = ''\) \{\s*\r?\n\s*return this\.enforcer\.tokenize\(blockId, text\);/);
  // The hold is taken on the editing callback and given back in the finally, so
  // a throw cannot leave a block pinned.
  assert.match(fn, /onEditing: \(\) => \{ editHold = this\.enforcer\.tokenizeEditHold\(blockId, true\); \},/);
  assert.match(fn, /\} finally \{\s*(?:\r?\n\s*\/\/[^\n]*)*\s*\r?\n?\s*if \(editHold\) this\.enforcer\.tokenizeEditHold\(blockId, false\);/);
});

test('enforcer.js omits `text` entirely when there is none, and never logs it', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  // The pre-existing command shape is byte-for-byte what it was; the field is
  // ADDED only when present, so the helper can tell "use your own masked
  // candidate" from "the user cleared the box" (which it refuses).
  assert.match(src, /const cmd = \{ cmd: 'tokenize', block_id: blockId \};/);
  assert.match(src, /if \(text\) cmd\.text = String\(text\);/);
  const fn = src.slice(src.indexOf('tokenize(blockId, text = \'\') {'), src.indexOf('tokenizeEditHold('));
  assert.ok(fn.length > 0, 'expected a tokenize() body');
  assert.equal(/this\.log[^\n]*text/.test(codeOnly(fn)), false,
    'the edited text must never reach a log line');
  // The hold command is an id and an enum, nothing else.
  // Just the method: the next 2-space-indented closing brace ends it.
  const holdAt = src.indexOf('tokenizeEditHold(blockId, on) {');
  assert.ok(holdAt > 0, 'expected a tokenizeEditHold() body');
  const hold = src.slice(holdAt, src.indexOf('\n  }', holdAt));
  assert.match(hold, /cmd: 'tokenize_edit', block_id: blockId, state: on \? 'on' : 'off',/);
  assert.equal(/text|preview|patterns/.test(codeOnly(hold)), false,
    'the hold command must carry no content at all');
});

test('enforcer-win.ps1: the edited text is re-gated for length and write budget, and never truncated', async () => {
  // THE FAIL-CLOSED REQUIREMENT. An edit can be longer, shorter, or turn one
  // line into five, and a line break costs more wall time to type than a
  // character does — so both of ComputeMaskCandidate's gates are re-run against
  // THIS string rather than inherited from the mask that was pinned. A silently
  // shortened prompt is a message the user did not write, sent under their name.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('static void StartRewrite('), src.indexOf('static void RunRewrite('));
  assert.ok(fn.length > 0, 'expected a StartRewrite body');
  assert.match(fn, /static void StartRewrite\(string blockId, string editedText = null\)/);
  // The gates, in the same order ComputeMaskCandidate applies them.
  assert.match(fn, /if \(editedText\.Trim\(\)\.Length == 0\) \{ EmitRewrite\(blockId, "aborted", "edit_empty"\); return; \}/);
  assert.match(fn, /if \(editedText\.Length > REWRITE_MAX_CHARS\) \{ EmitRewrite\(blockId, "aborted", "edit_too_long"\); return; \}/);
  assert.match(fn, /if \(!WriteFitsBudget\(editedText\)\) \{ EmitRewrite\(blockId, "aborted", "edit_too_long_to_write"\); return; \}/);
  assert.match(fn, /masked = editedText;/);

  // NOTHING IS TRUNCATED and nothing is typed on a refusal: every gate returns
  // before _rewriteInProgress is set and before the write thread is started.
  const block = fn.slice(fn.indexOf('if (editedText != null)'), fn.indexOf('_rewriteInProgress = true;'));
  assert.ok(block.length > 0, 'the edit gates must come before the write thread is started');
  assert.equal(/Substring|Remove\(|\.Take\(/.test(block), false,
    'the edited text must never be truncated — refuse instead');
  // …and they come AFTER the pinned-id and expiry checks, so a wrong or late id
  // is still answered the way it always was.
  assert.ok(fn.indexOf('"stale_block_id"') < fn.indexOf('if (editedText != null)'));
  assert.ok(fn.indexOf('"expired"') < fn.indexOf('if (editedText != null)'));

  // RunRewrite is UNCHANGED in what it verifies: the edited text goes through
  // the same `masked` parameter, so every pre-flight, the newline-key gate, the
  // read-back rescan and the post-send confirmation apply to it identically.
  const run = src.slice(src.indexOf('static void RunRewrite('), src.indexOf('// SendInput\'s return value is the count'));
  assert.equal(/editedText|edit_send|editBox/.test(run), false,
    'RunRewrite must not know an edit from a computed mask — one write path, one set of checks');
  assert.match(run, /bool multiline = HasLineBreak\(masked\);/);
  assert.match(run, /clean = string\.IsNullOrEmpty\(ScanNames\(after \?\? ""\)\);/);
  assert.match(run, /if \(!matches \|\| !clean\) \{ EmitRewrite\(blockId, "failed", "verify_mismatch"\); return; \}/);
});

test('enforcer-win.ps1: the control channel decodes free text properly, and only for one field', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const loop = src.slice(src.indexOf('static void StdinLoop()'), src.indexOf('static void PumpLoop()'));
  assert.ok(loop.length > 0, 'expected a StdinLoop body');
  // The escape-aware extractor is used for `text` and NOTHING else — every
  // other field is an id or an enum and keeps the plain one.
  assert.match(loop, /string edited = ExtractJsonStringUnescaped\(line, "text"\);/);
  assert.equal((loop.match(/ExtractJsonStringUnescaped\(/g) || []).length, 1);
  assert.match(loop, /if \(!string\.IsNullOrEmpty\(bid\)\) StartRewrite\(bid, edited\);/);
  assert.match(loop, /if \(!string\.IsNullOrEmpty\(bid\)\) HoldPendingRewrite\(bid, state == "on"\);/);
  // Absent must be distinguishable from empty, which is why it returns null.
  const fn = src.slice(src.indexOf('static string ExtractJsonStringUnescaped('), src.indexOf('// Bare (unquoted) numeric field'));
  assert.ok(fn.length > 0, 'expected an ExtractJsonStringUnescaped body');
  assert.match(fn, /if \(i < 0\) return null;/);
  // It must not throw on a malformed line — this runs on the stdin thread.
  assert.equal(/throw/.test(codeOnly(fn)), false);
});

test('enforcer-win.ps1: the edit hold can only ever move one expiry', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('static void HoldPendingRewrite('), src.indexOf('static string _pastePatternsValue'));
  assert.ok(fn.length > 0, 'expected a HoldPendingRewrite body');
  // It cannot create a pin, cannot make an unrewritable block rewritable, and
  // cannot touch the window/element/text/id a pin was computed from.
  assert.match(fn, /if \(!_pendingRewritable \|\| _pendingBlockId != blockId\) return;/);
  assert.match(fn, /_pendingExpiresAt = DateTime\.UtcNow\.Ticks \+ \(on \? REWRITE_EDIT_TTL : REWRITE_TTL\);/);
  const code = codeOnly(fn);
  for (const forbidden of [
    '_pendingRewritable =', '_pendingBlockId =', '_pendingOriginalFull', '_pendingMaskedFull',
    '_pendingRuntimeId', '_pendingHwnd', '_pendingPid', '_pendingPreview', '_pendingFrozen',
    'StartRewrite', 'SendInput', 'EmitRewrite',
  ]) {
    assert.equal(code.includes(forbidden), false, `the hold must not touch ${forbidden}`);
  }
  // Guarded by the same lock the pin always was.
  assert.match(fn, /lock \(_pendingLock\)/);
});

test('enforcer-win.ps1: a FROZEN pin is held but never offered', async () => {
  // The fix that makes an activatable edit box possible at all: the poll thread
  // used to DELETE the pin the instant the foreground stopped being the AI app,
  // which is the instant a text box takes keyboard focus. It freezes it now —
  // and a frozen pin describes another surface's composer, so nothing new may
  // be offered off it.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const pending = src.slice(src.indexOf('static void UpdatePendingRewrite()'), src.indexOf('static void HoldPendingRewrite('));
  assert.ok(pending.length > 0, 'expected an UpdatePendingRewrite body');
  // The exclusion CONDITION is unchanged — only what it does changed.
  assert.match(pending, /if \(!_fgIsAi \|\| !PanelUiaOk\(\) \|\| \(_hostAppProcs\.Contains\(_app\) && !_fgDlpGoverned\) \|\| Disarmed\(\)\)/);
  assert.match(pending, /if \(!_pendingRewritable \|\| Disarmed\(\) \|\| DateTime\.UtcNow\.Ticks > _pendingExpiresAt\)\s*\r?\n\s*\{ _pendingRewritable = false; _pendingBlockId = ""; _pendingFrozen = false; \}\s*\r?\n\s*else _pendingFrozen = true;/);
  // THE PANIC HOTKEY STILL CLEARS OUTRIGHT — it is the one term that means
  // "stop touching the keyboard", so it may not freeze.
  assert.match(pending, /Disarmed\(\) \|\| DateTime\.UtcNow\.Ticks > _pendingExpiresAt/);
  // Recomputing on the real surface unfreezes it.
  assert.match(pending, /_pendingRewritable = true;\s*\r?\n(?:\s*\/\/[^\n]*\r?\n)*\s*_pendingFrozen = false;/);

  // A frozen pin is refused by BOTH things that can offer one.
  const emit = src.slice(src.indexOf('static void EmitBlock('), src.indexOf('static void EmitRewrite('));
  assert.match(emit, /rewritable = _pendingRewritable && !_pendingFrozen && blockId\.Length > 0;/);
  assert.match(emit, /if \(!rewritable\) blockId = "";/);
  const hotkey = src.slice(src.indexOf('if (_fgIsAi && vk == VK_T && ctrl && alt && !shift)'),
                           src.indexOf('// Panic hotkey — Ctrl+Alt+Shift+F12.'));
  assert.match(hotkey, /rewritable = _pendingRewritable && !_pendingFrozen;/);

  // StartRewrite does NOT consult it, deliberately: by the time the user clicks
  // Send the pin is still frozen (the poll thread has not ticked yet), and what
  // decides whether the rewrite may proceed is RunRewrite's pre-flight, not the
  // freeze flag.
  const start = src.slice(src.indexOf('static void StartRewrite('), src.indexOf('static void RunRewrite('));
  assert.equal(/_pendingFrozen/.test(start), false);
});
