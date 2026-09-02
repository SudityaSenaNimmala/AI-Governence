// Phase 0 of the Electron→CLI migration, for OsMonitor:
//
//   A. the local "Keystroke enforcer" setting and the fleet `agent_enforcer`
//      flag COMPOSE AS AND — neither overrides the other;
//   B. a FeatureSync poll that resolves after stop() cannot resurrect anything;
//   C. every `@@CFAI-*` stdout relay is also a structured `ui` event, and the
//      stdout copy only prints under `legacyStdout: true` (the Electron runner).
//
// NOTHING in this file may spawn a subprocess. In particular: no
// enforcer-win.ps1 (that is a system-wide keyboard hook), no PowerShell watcher
// or toast helper, and no detached enforcer watchdog. Two rules keep that true,
// and any new case here must keep them:
//
//   1. Every subsystem is replaced with an inert stub BEFORE start() is called,
//      so the real poller / watchers / toast / enforcer are never started.
//   2. spawnEnforcerWatchdog() is a module import, so it cannot be stubbed from
//      out here — it is neutralised instead by its own `!== 'win32'` guard, via
//      withPlatform('linux', …) around the only calls that reach it.
//
// Nothing here performs network I/O either: PolicySync / FeatureSync are never
// started, and the one FeatureSync case that needs a poll uses a scoped
// globalThis.fetch stub that is restored in a finally block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { OsMonitor } from '../src/os_monitor/index.js';
import { FeatureSync } from '../src/os_monitor/feature-sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');

const silentLog = { info() {}, warn() {}, error() {}, child: () => silentLog };

/** Runs `fn` with process.platform reported as `value`, then restores it. */
function withPlatform(value, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...original, value });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', original); }
}

/** An inert stand-in for a PowerShell-backed watcher: records start/stop only. */
function inertWatcher(name, calls) {
  const stub = new EventEmitter();
  stub.start = () => calls.push(`${name}.start`);
  stub.stop = () => calls.push(`${name}.stop`);
  return stub;
}

/** An inert stand-in for Enforcer — same surface, never spawns the helper. */
function inertEnforcer(calls) {
  const stub = new EventEmitter();
  stub.start = () => calls.push('enforcer.start');
  stub.stop = () => calls.push('enforcer.stop');
  stub.attachHold = (state) => calls.push(`enforcer.attachHold:${state}`);
  stub.updateBlockPatterns = () => calls.push('enforcer.updateBlockPatterns');
  stub.tokenize = () => calls.push('enforcer.tokenize');
  return stub;
}

/**
 * Build an OsMonitor whose every subsystem is inert. `calls` records what the
 * monitor tried to start/stop, `stdout` records what reached console.log, and
 * `ui` records the structured events.
 *
 * The real FeatureSync instance is kept (its `onChange` is the only way into the
 * private #applyFeatures) but its start() is neutered so it never polls.
 */
function makeMonitor(opts = {}) {
  const calls = [];
  const ui = [];
  const reported = [];
  const toasts = [];

  const monitor = new OsMonitor({
    serverUrl: '',            // FeatureSync/PolicySync refuse to fetch without one
    token: '',
    log: silentLog,
    ...opts,
  });

  monitor.poller = inertWatcher('poller', calls);
  monitor.dialogWatcher = inertWatcher('dialogWatcher', calls);
  monitor.attachmentWatcher = inertWatcher('attachmentWatcher', calls);
  monitor.promptWatcher = inertWatcher('promptWatcher', calls);
  monitor.enforcer = inertEnforcer(calls);
  monitor.toast = { start() {}, stop() {}, show: (t) => toasts.push(t) };
  monitor.reporter = { start() {}, stop() {}, enqueue: (e) => reported.push(e) };
  monitor.policySync.start = () => {};
  monitor.featureSync.start = () => {};

  monitor.on('ui', (e) => ui.push(e));

  return { monitor, calls, ui, reported, toasts, onChange: monitor.featureSync.onChange };
}

/** Shape FeatureSync actually passes to onChange: booleans, plus what flipped. */
function fleet(features) {
  return { version: 'v1', features, changed: Object.keys(features) };
}

// ── Task A: the local setting and the fleet flag compose as AND ───────────────

test('a fleet agent_enforcer:true does NOT re-enable a locally disabled enforcer', () => {
  // The bug this pins: #applyFeatures used to assign the raw fleet flag to
  // this.enforcerEnabled, so a fleet "allowed" silently overrode a user/admin
  // who had switched the keystroke blocker off on this machine.
  const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled: false });
  monitor.isRunning = true;

  onChange(fleet({ agent_enforcer: true }));

  assert.equal(calls.includes('enforcer.start'), false, 'the keyboard hook must stay down');
  assert.equal(monitor.running.agent_enforcer, false);
  assert.equal(monitor.enforcerEnabled, false, 'the derived value must stay off');
  assert.equal(monitor.localEnforcerEnabled, false, 'the local setting must be untouched');
  assert.equal(monitor.enforcerWatchdog, null, 'no watchdog without a hook to reap');
});

test('a fleet agent_enforcer:false stops a locally enabled enforcer', () => {
  const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled: true });
  monitor.isRunning = true;
  // As if the initial apply had already brought it up.
  monitor.running.agent_enforcer = true;

  onChange(fleet({ agent_enforcer: false }));

  assert.deepEqual(calls, ['enforcer.stop']);
  assert.equal(monitor.running.agent_enforcer, false);
  assert.equal(monitor.enforcerEnabled, false);
  assert.equal(monitor.localEnforcerEnabled, true, 'the local setting still says "allowed"');
});

test('both allowing it starts the enforcer', () => {
  const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled: true });
  monitor.isRunning = true;

  // 'linux' only so spawnEnforcerWatchdog short-circuits on its own platform
  // guard — this test must not leave a detached node watchdog behind.
  withPlatform('linux', () => onChange(fleet({ agent_enforcer: true })));

  assert.deepEqual(calls, ['enforcer.start']);
  assert.equal(monitor.running.agent_enforcer, true);
  assert.equal(monitor.enforcerEnabled, true);
  assert.equal(monitor.enforcerWatchdog, null, 'watchdog skipped off-win32, so nothing was spawned');
});

test('with no local restriction the derived value tracks the fleet flag exactly', () => {
  // The default must behave precisely as it did before AND-composition existed.
  const { monitor, calls, onChange } = makeMonitor();   // enforcerEnabled defaults to true
  assert.equal(monitor.localEnforcerEnabled, true);
  monitor.isRunning = true;

  withPlatform('linux', () => onChange(fleet({ agent_enforcer: true })));
  assert.equal(monitor.enforcerEnabled, true);
  assert.equal(monitor.running.agent_enforcer, true);

  onChange(fleet({ agent_enforcer: false }));
  assert.equal(monitor.enforcerEnabled, false);
  assert.equal(monitor.running.agent_enforcer, false);

  withPlatform('linux', () => onChange(fleet({ agent_enforcer: true })));
  assert.equal(monitor.enforcerEnabled, true);
  assert.deepEqual(calls, ['enforcer.start', 'enforcer.stop', 'enforcer.start']);
});

test('no number of fleet polls can ever rewrite the local setting', () => {
  const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled: false });
  monitor.isRunning = true;

  for (const on of [true, false, true, true, false, true]) {
    onChange(fleet({ agent_enforcer: on }));
    assert.equal(monitor.localEnforcerEnabled, false, 'localEnforcerEnabled is write-once');
    assert.equal(monitor.enforcerEnabled, false);
  }
  assert.deepEqual(calls, [], 'a locally disabled enforcer is never started or stopped');
});

test('the derived value is what policySync consults, for both ways of being off', () => {
  // policy-sync's onChange calls enforcer.updateBlockPatterns(), which RESTARTS
  // the helper. It must see the AND-composed value, or a routine pattern poll
  // would reinstall a hook that either switch had disabled.
  for (const [enforcerEnabled, fleetOn] of [[false, true], [true, false]]) {
    const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled });
    monitor.isRunning = true;
    // Pretend it was up, so the branch actually runs and has to write the
    // derived value rather than short-circuiting on unchanged state.
    monitor.running.agent_enforcer = true;

    onChange(fleet({ agent_enforcer: fleetOn }));
    assert.equal(monitor.enforcerEnabled, false, `derived value (local=${enforcerEnabled}, fleet=${fleetOn})`);
    monitor.policySync.onChange({ blockPatterns: [{ name: 'x', source: 'x' }] });

    assert.equal(
      calls.includes('enforcer.updateBlockPatterns'), false,
      `a policy poll must not restart the hook (local=${enforcerEnabled}, fleet=${fleetOn})`,
    );
  }
});

test('the passive DLP watchers are unaffected by either enforcer switch', () => {
  const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled: false });
  monitor.isRunning = true;

  onChange(fleet({ clipboard_monitor: true, dlp: true, agent_enforcer: true }));

  for (const started of ['poller.start', 'promptWatcher.start', 'dialogWatcher.start', 'attachmentWatcher.start']) {
    assert.ok(calls.includes(started), `${started} must not be gated on the enforcer setting`);
  }
  assert.equal(calls.includes('enforcer.start'), false);
});

// ── Task B: an in-flight feature poll that lands after stop() ─────────────────

test('FeatureSync.stop() cannot cancel an in-flight poll — its onChange still fires', async () => {
  // This is the race the OsMonitor guard exists for. stop() only clears the
  // interval; a refresh() already awaiting fetch resolves afterwards and calls
  // onChange regardless. Proven here against the real FeatureSync so the guard
  // is not defending against an imaginary problem.
  const realFetch = globalThis.fetch;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const fired = [];

  try {
    globalThis.fetch = async () => {
      await pending;
      return { ok: true, json: async () => ({ version: 'v1', features: { agent_enforcer: { status: 'enabled' } } }) };
    };
    const sync = new FeatureSync({
      serverUrl: 'http://127.0.0.1:1',
      log: silentLog,
      onChange: (payload) => fired.push(payload),
    });

    const inFlight = sync.refresh();
    sync.stop();                 // ← the poll is already awaiting fetch
    release();
    await inFlight;

    assert.equal(fired.length, 1, 'onChange fires AFTER stop() — the race is real');
    assert.deepEqual(fired[0].changed, ['agent_enforcer']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a feature poll landing after OsMonitor.stop() starts nothing', () => {
  const { monitor, calls, onChange } = makeMonitor({ enforcerEnabled: true });
  monitor.isRunning = true;
  monitor.running.agent_enforcer = true;
  monitor.running.clipboard_monitor = true;
  monitor.running.dlp = true;

  monitor.stop();
  const afterStop = calls.length;

  // The stale callback a still-awaiting fetch would deliver.
  onChange(fleet({ clipboard_monitor: true, dlp: true, agent_enforcer: true }));

  assert.equal(calls.length, afterStop, 'nothing may be started or stopped after stop()');
  assert.equal(calls.slice(afterStop).includes('enforcer.start'), false);
  assert.equal(monitor.isRunning, false);
  assert.equal(monitor.enforcerWatchdog, null);
});

test('stop() clears the lifecycle flag before it tears anything down', async () => {
  // Order matters: featureSync.stop() is not a fence, so the flag has to be
  // false before any teardown runs, not after.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const stop = src.slice(src.indexOf('  stop() {'));
  const flagIdx = stop.indexOf('this.isRunning = false;');
  const firstTeardown = stop.indexOf('this.featureSync.stop();');
  assert.ok(flagIdx > 0, 'expected stop() to clear the lifecycle flag');
  assert.ok(flagIdx < firstTeardown, 'the flag must be cleared FIRST');
  // …and #applyFeatures must actually honour it.
  const apply = src.slice(src.indexOf('#applyFeatures(features, changed) {'));
  assert.match(apply.slice(0, 700), /if \(!this\.isRunning\) return;/);
});

// ── Task C: the @@CFAI-* relays as EventEmitter events ───────────────────────

const BLOCK_EVENT = {
  kind: 'block',
  process: 'Claude',
  patterns: 'aws-access-key',
  block_id: 'b-1',
  rewritable: true,
  preview: 'AKIA…',
  reason: 'send',
};
const BLOCKSTATE_EVENT = {
  kind: 'blockstate',
  active: true,
  scope: 'app',
  agent: 'Claude',
  agent_id: 'a-1',
  process: 'Claude',
  pid: 4242,
  win_x: 1, win_y: 2, win_w: 3, win_h: 4,
};
const REWRITE_EVENT = { kind: 'rewrite', result: 'ok', block_id: 'b-1' };
const ROUTE_EVENT = {
  kind: 'route', result: 'ok', process: 'Claude', from_tier: 'pro', to_tier: 'max',
  to_label: 'Opus', complexity: 'high', provider: 'anthropic',
};

/**
 * Start a fully stubbed monitor and drive the four enforcer events that own the
 * relay sites, capturing both channels.
 *
 * enforcerEnabled:false keeps the derived enforcer flag off, so start() cannot
 * reach enforcer.start()/spawnEnforcerWatchdog at all — the relay handlers are
 * registered unconditionally, so the sites under test are still live.
 */
function driveRelays({ legacyStdout }) {
  const harness = makeMonitor({ enforcerEnabled: false, legacyStdout });
  const stdout = [];
  const realLog = console.log;
  console.log = (...args) => stdout.push(args.join(' '));
  try {
    harness.monitor.start();
    harness.monitor.enforcer.emit('block', BLOCK_EVENT);
    harness.monitor.enforcer.emit('blockstate', BLOCKSTATE_EVENT);
    harness.monitor.enforcer.emit('disarmed', { kind: 'enforcement_disarmed', seconds: 600 });
    harness.monitor.enforcer.emit('rewrite', REWRITE_EVENT);
    harness.monitor.enforcer.emit('route', ROUTE_EVENT);
  } finally {
    console.log = realLog;
    harness.monitor.stop();
  }
  return { ...harness, stdout };
}

test('by default (no legacyStdout) the relays are events only — nothing on stdout', () => {
  const { ui, stdout } = driveRelays({ legacyStdout: false });

  assert.deepEqual(
    stdout.filter((l) => l.startsWith('@@CFAI-')), [],
    'a CLI run has no scraper — relay lines must not be printed',
  );
  assert.deepEqual(ui.map((e) => e.kind), ['block', 'blockstate', 'blockstate', 'rewrite', 'route']);
});

test('the ui event for a block carries the same payload the relay line does', () => {
  const { ui } = driveRelays({ legacyStdout: false });
  const block = ui.find((e) => e.kind === 'block');

  assert.equal(block.app, 'Claude');
  assert.equal(block.patterns, 'aws-access-key');
  assert.equal(block.block_id, 'b-1');
  assert.equal(block.rewritable, true);
  assert.equal(block.reason, 'send');
  assert.equal(block.platform_block, false);
  assert.equal(block.tool_host, '', 'tool_host is resolved only for a platform block');
  assert.equal(block.process_name, 'Claude');
  // The payload is narrowed at the relay site, and the event must not widen it.
  assert.equal('text' in block, false);
  assert.equal('window_title' in block, false);
});

test('the ui events for blockstate, the panic hotkey, rewrite and route keep their shapes', () => {
  const { ui } = driveRelays({ legacyStdout: false });
  const [state, disarmed] = ui.filter((e) => e.kind === 'blockstate');

  assert.equal(state.active, true);
  assert.equal(state.scope, 'app');
  assert.equal(state.name, 'Claude');
  assert.equal(state.pid, 4242);
  assert.deepEqual([state.win_x, state.win_y, state.win_w, state.win_h], [1, 2, 3, 4]);
  // The bar payload is the strictest one — no content field may ride along.
  for (const forbidden of ['patterns', 'preview', 'block_id', 'filename', 'title']) {
    assert.equal(forbidden in state, false, `blockstate must not carry ${forbidden}`);
  }
  assert.deepEqual(disarmed, { kind: 'blockstate', active: false });

  // rewrite/route relay the raw enforcer event, whose own `kind` must survive.
  assert.deepEqual(ui.find((e) => e.kind === 'rewrite'), { ...REWRITE_EVENT });
  assert.deepEqual(ui.find((e) => e.kind === 'route'), { ...ROUTE_EVENT });
});

test('with legacyStdout the relay lines print AND the ui events fire', () => {
  const { ui, stdout } = driveRelays({ legacyStdout: true });
  const relayed = stdout.filter((l) => l.startsWith('@@CFAI-'));

  assert.deepEqual(ui.map((e) => e.kind), ['block', 'blockstate', 'blockstate', 'rewrite', 'route']);
  assert.deepEqual(relayed.map((l) => l.split(' ')[0]), [
    '@@CFAI-BLOCK', '@@CFAI-BLOCKSTATE', '@@CFAI-BLOCKSTATE', '@@CFAI-REWRITE', '@@CFAI-ROUTE',
  ]);
});

test('the printed lines satisfy main.js\'s real parsing contract', () => {
  // Asserted against what electron/main.js's parseMonitorLine actually does —
  // prefix incl. trailing space, then JSON.parse of the remainder — rather than
  // an assumed shape.
  const { stdout } = driveRelays({ legacyStdout: true });
  const parse = (prefix) => {
    const line = stdout.find((l) => l.startsWith(prefix));
    assert.ok(line, `expected a ${prefix.trim()} line`);
    return JSON.parse(line.slice(prefix.length));
  };

  const block = parse('@@CFAI-BLOCK ');
  assert.equal(block.platform_block, false);   // main.js: routes to Request Access
  assert.equal(block.rewritable, true);        // main.js: shows the Tokenize dialog
  assert.equal(block.app, 'Claude');

  const state = parse('@@CFAI-BLOCKSTATE ');
  assert.equal(state.active && state.scope === 'app', true);   // main.js: shows the bar

  assert.equal(parse('@@CFAI-REWRITE ').result, 'ok');         // main.js: closes the dialog
  assert.deepEqual(parse('@@CFAI-ROUTE '), ROUTE_EVENT);       // main.js: swallowed silently
});

test('the ui event and the printed line carry byte-identical payloads', () => {
  // One payload, two channels. If they ever diverge, a future CLI UI would show
  // something different from what the Electron app shows for the same block.
  const { ui, stdout } = driveRelays({ legacyStdout: true });
  for (const [prefix, kind] of [['@@CFAI-BLOCK ', 'block'], ['@@CFAI-REWRITE ', 'rewrite'], ['@@CFAI-ROUTE ', 'route']]) {
    const line = stdout.find((l) => l.startsWith(prefix));
    const printed = JSON.parse(line.slice(prefix.length));
    // `kind` is the event label; on the two raw-enforcer relays the payload
    // already carries the identical value, which is why it must not be dropped.
    assert.deepEqual(
      ui.find((e) => e.kind === kind), { kind, ...printed },
      `${prefix.trim()} payload drifted from its ui event`,
    );
  }
});

test('the panic-hotkey relay prints exactly the line main.js expects', () => {
  const { stdout } = driveRelays({ legacyStdout: true });
  const lines = stdout.filter((l) => l.startsWith('@@CFAI-BLOCKSTATE '));
  assert.equal(lines[1], '@@CFAI-BLOCKSTATE {"active":false}');
});

test('OsMonitor is an EventEmitter, so a consumer can subscribe instead of scraping', () => {
  const { monitor } = makeMonitor();
  assert.ok(monitor instanceof EventEmitter);
  assert.equal(typeof monitor.on, 'function');
});

// ── Wiring: which entry point keeps the legacy stdout channel ────────────────

test('monitor-runner (Electron) passes legacyStdout: true', async () => {
  // monitor-runner.mjs has top-level side effects (reads credentials, acquires
  // the singleton lock), so it is checked at the source level rather than
  // imported — same reason as the existing runner assertions.
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
  const ctor = src.match(/new OsMonitor\(\{[\s\S]*?\n\}\);/);
  assert.ok(ctor, 'expected a new OsMonitor({…}) call');
  assert.match(ctor[0], /legacyStdout:\s*true/);
});

test('the CLI entry point does NOT pass legacyStdout, so it relies on the default', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'index.js'), 'utf8');
  assert.doesNotMatch(src, /legacyStdout:\s*true/, 'a CLI run has no stdout scraper');
});

test('legacyStdout defaults to off', () => {
  assert.equal(makeMonitor().monitor.legacyStdout, false);
  assert.equal(makeMonitor({ legacyStdout: true }).monitor.legacyStdout, true);
});
