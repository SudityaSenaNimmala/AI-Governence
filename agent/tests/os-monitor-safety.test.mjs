// Safety hardening for the desktop keystroke enforcer (Phase 0).
//
// NOTE: nothing in this file may install a keyboard hook. The enforcer is only
// ever constructed with { enabled: false }, and the watchdog CLI is only ever
// pointed at state files that name PIDs it will refuse to kill. If you add a
// case here, keep that property.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { HELPER_SCRIPTS, HELPER_SCRIPT_PATTERN } from '../src/os_monitor/reap-orphans.js';
import {
  ENFORCER_ENV_VAR,
  enforcerEnvValue,
  enforcerEnabledFromEnv,
} from '../src/os_monitor/settings-env.js';
import {
  readEnforcerPid,
  writeEnforcerState,
  reapEnforcer,
} from '../src/os_monitor/enforcer-watchdog.js';
import { Enforcer } from '../src/os_monitor/enforcer.js';
import { OsMonitor } from '../src/os_monitor/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const WATCHDOG = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-watchdog.js');
// The blocked-agents / platform-block / access-exception sync. Shared by BOTH
// agent entry points; it used to live inline in electron/monitor-runner.mjs,
// which is why the bare-Node CLI / .exe install enforced no server-driven block
// at all. The behavioural assertions below moved here with it.
const BLOCKED_SYNC = join(AGENT_DIR, 'src', 'os_monitor', 'blocked-agents-sync.js');

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'cfai-enforcer-test-'));
}

// ── Bug 2a: the orphan reaper must know about enforcer-win.ps1 ────────────────

test('reap-orphans covers enforcer-win.ps1', () => {
  assert.ok(
    HELPER_SCRIPTS.includes('enforcer-win.ps1'),
    'an orphaned enforcer holds a system-wide keyboard hook — it MUST be reapable'
  );
});

test('reap-orphans pattern matches a real enforcer command line', () => {
  const re = new RegExp(HELPER_SCRIPT_PATTERN);
  const cmdline =
    'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    'C:\\Users\\x\\AI-Governence\\agent\\src\\os_monitor\\enforcer-win.ps1';
  assert.equal(re.test(cmdline), true);
});

test('reap-orphans pattern still matches the pre-existing helpers', () => {
  const re = new RegExp(HELPER_SCRIPT_PATTERN);
  for (const script of ['win-poller.ps1', 'toast-helper.ps1', 'file-dialog-watcher.ps1', 'attachment-watcher.ps1']) {
    assert.equal(re.test(`powershell -File C:\\x\\${script}`), true, script);
  }
});

test('reap-orphans pattern does not kill unrelated powershell processes', () => {
  const re = new RegExp(HELPER_SCRIPT_PATTERN);
  assert.equal(re.test('powershell -File C:\\work\\deploy.ps1'), false);
  assert.equal(re.test('powershell -Command Get-Process'), false);
  // Dots are escaped, so a look-alike name cannot match.
  assert.equal(re.test('powershell -File C:\\x\\enforcer-winXps1'), false);
});

// ── Bug 2b: watchdog orphan-kill logic ───────────────────────────────────────

test('watchdog: state file round-trips through write/read', async () => {
  const dir = await tempDir();
  try {
    const statePath = join(dir, 'enforcer.pid');
    await writeEnforcerState({ statePath, pid: 4242, parentPid: 17 });
    assert.equal(await readEnforcerPid(statePath), 4242);
    const raw = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(raw.parentPid, 17);
    assert.ok(raw.spawnedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog: reads a bare-integer pid file too', async () => {
  const dir = await tempDir();
  try {
    const statePath = join(dir, 'enforcer.pid');
    await writeFile(statePath, '  9182\n', 'utf8');
    assert.equal(await readEnforcerPid(statePath), 9182);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog: missing / garbage state file yields no pid', async () => {
  const dir = await tempDir();
  try {
    assert.equal(await readEnforcerPid(join(dir, 'nope.pid')), null);
    const bad = join(dir, 'bad.pid');
    await writeFile(bad, 'not a pid', 'utf8');
    assert.equal(await readEnforcerPid(bad), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog: kills the recorded helper and clears the state file', async () => {
  const dir = await tempDir();
  try {
    const statePath = join(dir, 'enforcer.pid');
    await writeEnforcerState({ statePath, pid: 4242, parentPid: 17 });

    const killed = [];
    const res = await reapEnforcer(statePath, {
      verify: async (pid) => pid === 4242,
      kill: (pid) => { killed.push(pid); return true; },
    });

    assert.deepEqual(killed, [4242]);
    assert.equal(res.killed, true);
    assert.equal(res.reason, 'killed');
    await assert.rejects(() => stat(statePath), 'state file must be removed after the kill');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog: no state file → nothing killed', async () => {
  const dir = await tempDir();
  try {
    const killed = [];
    const res = await reapEnforcer(join(dir, 'absent.pid'), {
      verify: async () => true,
      kill: (pid) => { killed.push(pid); return true; },
    });
    assert.deepEqual(killed, []);
    assert.equal(res.killed, false);
    assert.equal(res.reason, 'no-state');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog: refuses to kill a pid that is no longer our enforcer', async () => {
  // Windows recycles PIDs and this runs unattended after the parent died, so
  // an unverified pid must never be killed.
  const dir = await tempDir();
  try {
    const statePath = join(dir, 'enforcer.pid');
    await writeEnforcerState({ statePath, pid: 4242 });

    const killed = [];
    const res = await reapEnforcer(statePath, {
      verify: async () => false,
      kill: (pid) => { killed.push(pid); return true; },
    });

    assert.deepEqual(killed, [], 'must not kill an unverified pid');
    assert.equal(res.killed, false);
    assert.equal(res.reason, 'not-enforcer');
    await assert.rejects(() => stat(statePath), 'stale state file must still be cleared');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog: never kills itself', async () => {
  const dir = await tempDir();
  try {
    const statePath = join(dir, 'enforcer.pid');
    await writeEnforcerState({ statePath, pid: process.pid });
    const killed = [];
    const res = await reapEnforcer(statePath, {
      verify: async () => true,
      kill: (pid) => { killed.push(pid); return true; },
    });
    assert.deepEqual(killed, []);
    assert.equal(res.reason, 'self');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog CLI: dead parent + no state file → exits 0 immediately', async () => {
  // Exercises the real CLI entry (spawn → runWatcher → reapEnforcer → exit).
  // Parent pid 999999 does not exist, and the state path is absent, so the
  // watchdog has nothing to kill. No keyboard hook is involved.
  const dir = await tempDir();
  try {
    const child = spawn(process.execPath, [WATCHDOG, '999999', join(dir, 'absent.pid')], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += String(c); });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(stderr, '');
    assert.equal(code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('watchdog CLI: rejects a missing parent pid argument', async () => {
  const child = spawn(process.execPath, [WATCHDOG], { stdio: ['ignore', 'ignore', 'pipe'] });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(code, 2);
});

// ── Bug 3: the "disable enforcer" setting is actually wired ───────────────────

test('settings-env: monitorEnforcer false encodes to the disabling value', () => {
  assert.equal(enforcerEnvValue({ monitorEnforcer: false }), 'false');
  assert.equal(enforcerEnvValue({ monitorEnforcer: true }), 'true');
  // Absent setting must never silently disable enforcement.
  assert.equal(enforcerEnvValue({}), 'true');
  assert.equal(enforcerEnvValue(undefined), 'true');
});

test('settings-env: child decodes the env var, defaulting to enabled', () => {
  assert.equal(enforcerEnabledFromEnv({ [ENFORCER_ENV_VAR]: 'false' }), false);
  assert.equal(enforcerEnabledFromEnv({ [ENFORCER_ENV_VAR]: 'true' }), true);
  assert.equal(enforcerEnabledFromEnv({}), true);            // CLI agent, no Electron
  assert.equal(enforcerEnabledFromEnv({ [ENFORCER_ENV_VAR]: '0' }), true);  // only 'false' disables
});

test('settings-env: encode → decode round trip', () => {
  for (const monitorEnforcer of [true, false]) {
    const env = { [ENFORCER_ENV_VAR]: enforcerEnvValue({ monitorEnforcer }) };
    assert.equal(enforcerEnabledFromEnv(env), monitorEnforcer);
  }
});

test('Electron main.js passes the enforcer setting into the monitor child env', async () => {
  // Source-level guard: main.js is CommonJS + Electron, so it cannot be
  // imported here. This asserts the one line that used to be missing — the
  // spawn env carrying the setting — so it cannot be dropped again unnoticed.
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  assert.match(src, /CFAI_ENFORCER_ENABLED:\s*settings\.monitorEnforcer === false \? 'false' : 'true'/);
  assert.equal(ENFORCER_ENV_VAR, 'CFAI_ENFORCER_ENABLED', 'env var name must match settings-env.js');
});

test('monitor-runner forwards the decoded setting into OsMonitor', async () => {
  // monitor-runner.mjs has top-level side effects (reads credentials, acquires
  // the singleton lock), so it is checked at the source level rather than
  // imported.
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
  assert.match(src, /enforcerEnabledFromEnv\(process\.env\)/);
  assert.match(src, /new OsMonitor\(\{[\s\S]*enforcerEnabled[\s\S]*\}\)/);
});

test('Enforcer with enabled:false never spawns the helper', () => {
  const logged = [];
  const enforcer = new Enforcer({
    log: { info: (m) => logged.push(m), warn: (m) => logged.push(m) },
    aiProcessNames: ['Claude'],
    blockPatterns: [{ name: 'x', source: 'x' }],
    enabled: false,
  });

  enforcer.start();

  assert.equal(enforcer.child, null, 'no PowerShell helper — and therefore no keyboard hook');
  assert.equal(enforcer.heartbeatTimer, null, 'no heartbeat when there is nothing to keep alive');
  assert.ok(logged.some((m) => /disabled by settings/.test(m)));
});

test('Enforcer with enabled:false stays down across a policy update', () => {
  // updateBlockPatterns() calls start() when no child is running. Without the
  // gate inside start(), a routine policy poll would install the hook the user
  // had switched off.
  const enforcer = new Enforcer({
    log: { info() {}, warn() {} },
    aiProcessNames: ['Claude'],
    blockPatterns: [],
    enabled: false,
  });

  enforcer.updateBlockPatterns([{ name: 'aws-access-key', source: 'AKIA[0-9A-Z]{16}' }]);

  assert.equal(enforcer.child, null);
  assert.equal(enforcer.heartbeatTimer, null);
});

test('OsMonitor only spawns the enforcer + watchdog when enabled', async () => {
  // Constructing OsMonitor starts pollers, so assert on the source instead.
  //
  // The gate MOVED but did not weaken. It used to be `if (this.enforcerEnabled)`
  // inside start(), fed by an Electron checkbox via CFAI_ENFORCER_ENABLED. It is
  // now the `agent_enforcer` branch of #applyFeatures, fed by the fleet setting —
  // which means the same switch can also be thrown from the dashboard, for every
  // machine at once, instead of only locally on one.
  //
  // The property under test is unchanged, and is the one that matters: the
  // keyboard hook and its watchdog live behind the flag together, and the passive
  // watchers — which observe but never block — do not.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');

  const from = src.indexOf("changed.includes('agent_enforcer')");
  assert.ok(from > 0, 'expected an agent_enforcer branch in #applyFeatures');
  const to = src.indexOf('  stop() {', from);
  assert.ok(to > from, 'could not find the end of the feature applier');
  const gated = src.slice(from, to);

  assert.match(gated, /this\.enforcer\.start\(\)/);
  assert.match(gated, /spawnEnforcerWatchdog\(/);

  // Started in exactly one place, so there is no second path that could install
  // the hook while the flag says off.
  assert.equal(src.split('this.enforcer.start()').length - 1, 1,
    'the enforcer must start in exactly one place, or the gate can be bypassed');
  assert.equal(src.split('spawnEnforcerWatchdog(').length - 1, 1,
    'the watchdog must be spawned in exactly one place — a second site could outlive the hook');

  for (const passive of ['this.poller.start()', 'this.dialogWatcher.start()', 'this.attachmentWatcher.start()', 'this.promptWatcher.start()']) {
    assert.equal(gated.includes(passive), false, `${passive} must NOT be gated on the enforcer flag`);
  }
});

test('turning the enforcer off also clears enforcerEnabled, so a policy poll cannot restart it', async () => {
  // policy-sync's onChange calls enforcer.updateBlockPatterns(), which RESTARTS
  // the helper — and it skips that only when this.enforcerEnabled is false. If the
  // fleet setting switched the hook off without updating that flag, the next
  // pattern-policy poll (every 5 minutes) would quietly reinstall the keyboard
  // hook an admin had just disabled.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const from = src.indexOf("changed.includes('agent_enforcer')");
  const to = src.indexOf('  stop() {', from);
  assert.match(src.slice(from, to), /this\.enforcerEnabled = on/);
});

// ── Model routing (desktop): always on, no setting ────────────────────────────
// There is no monitorModelRouter setting and no on/off env var of its own to
// decode — model routing runs whenever the enforcer does, the same as its
// other keystroke-level behavior. These tests just confirm the wiring always
// enables it rather than gating it behind something that could be missed.

test('Electron main.js always enables model routing in the monitor child env', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  assert.match(src, /CFAI_MODEL_ROUTER_ENABLED:\s*'true'/);
  assert.equal(/monitorModelRouter/.test(src), false, 'no setting should gate this any more');
});

test('Enforcer always sends CFAI_MODEL_ROUTER_ENABLED and CFAI_MODEL_ROUTER_CONFIG', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /CFAI_MODEL_ROUTER_ENABLED:\s*'true'/);
  assert.match(src, /CFAI_MODEL_ROUTER_CONFIG:\s*JSON\.stringify\(buildModelRouterConfig\(\)\)/);
  assert.equal(/modelRouterEnabled/.test(src), false, 'no per-instance flag should gate this any more');
});

test('Enforcer dispatches a route event for {"kind":"route"} NDJSON', async () => {
  // #dispatch/#onStdout are private — matches the existing testing style in
  // this file for the same reason (no way to reach them without actually
  // spawning a child, which this file's own header forbids). Source-level
  // check that 'route' is wired the same way 'block'/'rewrite'/'override' are.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /case 'route':\s*\n\s*this\.emit\('route', ev\);/);
});

test('OsMonitor reports model_routed and relays @@CFAI-ROUTE without dropping content', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const routeHandler = src.match(/this\.enforcer\.on\('route',[\s\S]*?\n\s{4}\}\);/);
  assert.ok(routeHandler, "expected an enforcer.on('route', ...) handler");
  assert.match(routeHandler[0], /kind:\s*'model_routed'/);
  assert.match(routeHandler[0], /mechanism:\s*'keystroke_route'/);
  // Privacy invariant: no prompt text field anywhere in the reported event.
  assert.equal(/prompt_text|original|masked/.test(routeHandler[0]), false);
});

test('Electron main.js swallows @@CFAI-ROUTE without falling into the plain-text scraper', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  const guard = src.match(/if \(line\.startsWith\('@@CFAI-ROUTE '\)\) \{[\s\S]*?\n {2}\}/);
  assert.ok(guard, 'expected an explicit @@CFAI-ROUTE guard before the plain-text heuristics');
});

// ── Bug 1: PowerShell-side invariants (static checks — the hook is never run) ─

test('enforcer-win.ps1: every Regex is constructed with a match timeout', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const ctors = src.match(/new Regex\([^)]*\)/g) || [];
  assert.ok(ctors.length > 0, 'expected at least one Regex construction');
  for (const c of ctors) {
    assert.match(c, /REGEX_TIMEOUT/, `Regex built without a timeout: ${c}`);
  }
  assert.match(src, /REGEX_TIMEOUT = TimeSpan\.FromMilliseconds\(25\)/);
});

test('classifier.js: getBlockPatterns propagates each pattern\'s real case-sensitivity', async () => {
  // Regression for a real bug found live (2026-08): p.regex.source never
  // carries the JS /i flag, and the C# side used to compile every pattern
  // case-sensitive regardless. Guardrail patterns are authored assuming /i
  // (see their /ig suffixes), so a naturally-capitalized sentence like
  // "Ignore all previous instructions" silently failed to match — while an
  // exact-lowercase copy of the same phrase matched fine, which is exactly
  // why this was missed until a real user's natural typing exposed it.
  const { getBlockPatterns } = await import('../src/os_monitor/classifier.js');
  const patterns = getBlockPatterns();
  assert.ok(patterns.length > 0, 'expected at least one block pattern');
  for (const p of patterns) {
    assert.equal(typeof p.ignoreCase, 'boolean', `${p.name} is missing an ignoreCase field`);
  }
  const guardrail = patterns.find((p) => p.name === 'injection-ignore-instructions');
  assert.ok(guardrail, 'expected injection-ignore-instructions in the block set');
  assert.equal(guardrail.ignoreCase, true, 'guardrail patterns are authored with /i and must report ignoreCase: true');

  const awsKey = patterns.find((p) => p.name === 'aws-access-key');
  assert.ok(awsKey, 'expected aws-access-key in the block set');
  assert.equal(awsKey.ignoreCase, false, 'AWS keys are fixed-case by format and must stay case-sensitive');
});

test('enforcer-win.ps1: block patterns compile with per-pattern case-sensitivity, not blanket case-sensitive', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // The old, buggy line compiled every pattern with RegexOptions.CultureInvariant
  // alone — never IgnoreCase. Assert the fixed per-pattern branch exists instead
  // of the old blanket form.
  assert.match(src, /RegexOptions\.CultureInvariant \| \(ic \? RegexOptions\.IgnoreCase : RegexOptions\.None\)/);
  assert.doesNotMatch(
    src,
    /new Regex\(patSources\[i\], RegexOptions\.CultureInvariant, REGEX_TIMEOUT\)/,
    'pattern compilation regressed to the old always-case-sensitive form'
  );
  // The ignoreCase flag must actually travel end-to-end: PowerShell parses it
  // off the JSON payload, and Start() receives it as a parallel bool[].
  assert.match(src, /\[void\]\$patIgnoreCase\.Add\(\[bool\]\$p\.ignoreCase\)/);
  assert.match(src, /bool\[\] patIgnoreCase/);
});

test('enforcer-win.ps1: regex timeouts are caught per-rule and reported by name', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /catch \(RegexMatchTimeoutException\)/);
  assert.match(src, /NoteRegexTimeout\(p\.Name\)/);
  // Rule NAME only — the scanned text must never be emitted.
  assert.match(src, /"regex match timeout — rule skipped: " \+ rule/);
});

test('enforcer-win.ps1: the keyboard hook does no scanning', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  assert.ok(hook.length > 0);
  assert.equal(/Rescan\(\)/.test(hook), false, 'Rescan() must not run on the hook thread');
  assert.equal(/ScanNames\(/.test(hook), false, 'no scanning on the hook thread');
  assert.match(hook, /_typedDirty = true/, 'the hook should only flag the buffer dirty');
  // …and the poll thread is what acts on the flag.
  const poll = src.slice(src.indexOf('static void PollLoop('));
  assert.match(poll, /if \(_typedDirty\)[\s\S]{0,120}Rescan\(\)/);
});

test('enforcer-win.ps1: only the tail of the typed buffer is scanned', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /const int SCAN_TAIL = 512;/);
  assert.match(src, /const int TYPED_MAX = 4096;/);
  assert.match(src, /string tail = TypedTail\(out gen\);/);
  assert.match(src, /string hits = ScanNames\(tail\);/);
});

test('enforcer-win.ps1: a verdict from a cleared buffer is not published', async () => {
  // Otherwise a secret typed-and-sent inside the scan window would arm a block
  // against the user's next, innocent message.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /if \(gen != _typedGen\) return;/);
  assert.match(src, /_typed\.Length = 0; _typedGen\+\+;/);
});

test('enforcer-win.ps1: panic hotkey disarms every block decision for 10 minutes', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /const int VK_F12 = 0x7B;/);
  assert.match(src, /vk == VK_F12 && ctrl && alt && shift/);
  assert.match(src, /DISARM_SECONDS = 600/);
  assert.match(src, /Emit\("enforcement_disarmed"/);
  // Guard present on the Enter path and on both BlockActive helpers. The Enter
  // path's predicate now lives in EnterBlockActive (factored out so the
  // behavioural harness in enforcer-panel-block.test.mjs can assert the real
  // decision without installing a hook); Disarmed() is its first line.
  assert.match(src, /bool block = EnterBlockActive\(attachHold, uiaBlock, clipBlock, cooldown\);/);
  const enterPred = src.slice(src.indexOf('static bool EnterBlockActive('), src.indexOf('static string ActivePatterns()'));
  assert.ok(enterPred.length > 0, 'expected an EnterBlockActive body');
  assert.match(enterPred, /if \(Disarmed\(\)\) return false;/);
  const forMouse = src.slice(src.indexOf('static bool BlockActiveForMouse()'));
  assert.match(forMouse.slice(0, 400), /if \(Disarmed\(\)\) return false;/);
});

test('enforcer-win.ps1: deadman releases the hook on a stale parent heartbeat', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /HEARTBEAT_MAX_STALE = TimeSpan\.FromSeconds\(30\)\.Ticks/);
  assert.match(src, /UnhookWindowsHookEx/);
  assert.match(src, /Shutdown\("parent heartbeat stale"\)/);
  assert.match(src, /CFAI_ENFORCER_HEARTBEAT/);
});

test('Enforcer passes the heartbeat path to the helper and beats every 5s', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /CFAI_ENFORCER_HEARTBEAT: ENFORCER_HEARTBEAT_PATH/);
  assert.match(src, /const HEARTBEAT_MS = 5000;/);
  assert.match(src, /setInterval\(\(\) => this\.#beat\(\), HEARTBEAT_MS\)/);
  // Heartbeat content is a timestamp — never anything about the user's prompt.
  assert.match(src, /writeFileSync\(ENFORCER_HEARTBEAT_PATH, String\(Date\.now\(\)\), 'utf8'\)/);
});

// ── Attachment hold: block the send while a sensitive file is attached ───────

test('Enforcer.attachHold writes only cmd/state/filename/patterns/ttl_ms/process to stdin — no file content', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  // `process` was added when the hold gained a process BINDING — a hold armed
  // for one app used to swallow the next Enter in whatever app the user
  // alt-tabbed to. It is a bare process name, which is the same class of value
  // the filename and pattern-name fields already are; still no file content and
  // still no free text.
  assert.match(src, /attachHold\(state, \{ filename = '', patterns = '', ttlMs = 3000, process: processName = '' \} = \{\}\)/);
  assert.match(src, /cmd: 'attach_hold', state, filename, patterns, ttl_ms: ttlMs, process: processName/);
});

test('enforcer-win.ps1: attach_hold ORs into both the Enter and mouse-click block decisions', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // Declared state.
  assert.match(src, /static volatile bool _attachHoldActive = false;/);
  // Mouse-click gate (BlockActiveForMouse). The platform block is checked on its
  // own line ahead of the content signals (see _blockedByElement), so the hold is
  // asserted on the content OR-chain it actually belongs to.
  const mouseGate = src.slice(src.indexOf('static bool BlockActiveForMouse()'), src.indexOf('// Precedence matches the Enter path'));
  assert.ok(mouseGate.length > 0, 'expected a BlockActiveForMouse body');
  // Both gates now read the hold through AttachHoldActive() rather than the raw
  // flag. That accessor is the PROCESS BINDING: the flag alone had no process
  // identity, so a hold armed for a flagged attachment in one app swallowed the
  // next Enter in whatever app the user alt-tabbed to. Every keystroke decision
  // goes through the accessor so the binding cannot be forgotten at one site.
  assert.match(mouseGate, /return AttachHoldActive\(\) \|\| TypedBlockFresh\(\) \|\| _blockUia \|\| \(recentPaste && _blockPaste\) \|\| cooldown;/);
  assert.match(mouseGate, /if \(_fgIsBlocked && \(_blockedByElement \|\| PanelEnforceOk\(\)\)\) return true;/);
  // Enter-decision gate.
  assert.match(src, /bool attachHold = AttachHoldActive\(\);/);
  // The accessor itself: the raw flag AND a case-insensitive match against the
  // foreground app, with "unbound" (no process on the command) still counting so
  // a missing field can never silently stop holding a sensitive attachment.
  const holdGate = src.slice(src.indexOf('static bool AttachHoldActive()'), src.indexOf('static bool BlockActiveForSend('));
  assert.ok(holdGate.length > 0, 'expected an AttachHoldActive body');
  assert.match(holdGate, /if \(!_attachHoldActive\) return false;/);
  assert.match(holdGate, /return string\.Equals\(owner, _app \?\? "", StringComparison\.OrdinalIgnoreCase\);/);
  // Every keystroke-decision read goes through the accessor. The only places the
  // raw flag may still be touched are its declaration, the stdin command, the
  // TTL sweep and the accessor itself.
  const rawReads = (psCodeOnly(src).match(/_attachHoldActive/g) || []).length;
  assert.equal(rawReads, 6, `_attachHoldActive gained a raw reference (${rawReads}) — it must be read through AttachHoldActive()`);
  const enterPred = src.slice(src.indexOf('static bool EnterBlockActive('), src.indexOf('static string ActivePatterns()'));
  assert.match(enterPred, /return attachHold \|\| TypedBlockFresh\(\) \|\| uiaBlock \|\| clipBlock \|\| cooldown;/);
  assert.match(enterPred, /if \(_fgIsBlocked && \(_blockedByElement \|\| PanelEnforceOk\(\)\)\) return true;/);
});

test('enforcer-win.ps1: attach_hold has an auto-expiring TTL so a crashed parent cannot leave Enter dead', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static void CheckAttachHoldExpiry\(\)/);
  assert.match(src, /CheckAttachHoldExpiry\(\);/);
  // Called from the poll loop, not the hook thread — same "no scanning on the
  // hook thread" invariant the rest of this file already holds to.
  const hookCallbackBody = src.match(/static IntPtr HookCallback[\s\S]*?\n    static void Rescan\(\)/);
  assert.ok(hookCallbackBody, 'expected to find the HookCallback body');
  assert.equal(hookCallbackBody[0].includes('CheckAttachHoldExpiry()'), false);
});

test('enforcer-win.ps1: an attachment hold is never offered as rewritable', async () => {
  // Tokenize & Send masks TEXT; it has no way to remove a file attachment.
  // Offering "Tokenize & Send" for an attachment-caused block would look like
  // an action that unblocks the send, but masking the composer text does
  // nothing to the file still holding it.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /if \(reason == "attachment"\) \{ rewritable = false; blockId = ""; \}/);
});

test('enforcer-win.ps1: a full platform block is never offered as rewritable either', async () => {
  // The bug: RunRewrite ends by SYNTHESIZING an Enter, and the Enter-decision
  // code swallows every Enter while _fgIsBlocked is set — it does not exempt
  // injected keys. So "Tokenize & Send" on a platform-blocked app cleared the
  // composer, retyped the masked text, and then failed with not_submitted.
  // Same technique as the attachment override one line above.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /bool platformBlock = _fgIsBlocked && reason != "attachment";/);
  assert.match(src, /if \(platformBlock\) \{ rewritable = false; blockId = ""; \}/);
});

test('enforcer-win.ps1: a platform block reports the platform + agent it was blocked by', async () => {
  // Field names come from blocked-agents.json (written by monitor-runner.mjs,
  // parsed by UpdateBlockedAgents) — platform / agent_name / agent_id. The
  // Request Access dialog cannot name what to ask for without them.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /d\["agent_id"\] = ExtractJsonString\(item, "agent_id"\);/);
  assert.match(src, /_blockedPlatform = agent\["platform"\]/);
  assert.match(src, /_blockedAgentId = agent\["agent_id"\]/);
  assert.match(src, /"platform_block\\":true/);
  assert.match(src, /blocked_platform/);
  assert.match(src, /blocked_agent_id/);
  // Cleared with the flag — a stale agent name must not be attributed to an
  // unrelated later block.
  assert.match(src, /static void ClearFgBlocked\(\)/);
  const clear = src.slice(src.indexOf('static void ClearFgBlocked()'));
  assert.match(clear.slice(0, 300), /_blockedPlatform = "";/);
  assert.match(clear.slice(0, 300), /_blockedAgentName = "";/);
});

test('enforcer-win.ps1: Ctrl+Alt+Enter no longer overrides a full platform block', async () => {
  // Once Request Access exists as the sanctioned path, a hotkey that silently
  // walks through an org-wide block would make the approval optional. The
  // panic hotkey (Ctrl+Alt+Shift+F12) is untouched and still disarms
  // everything — that is the deliberate escape hatch.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /if \(ctrl && alt && !attachHold && !_fgIsBlocked\) \{ Emit\("override"/);
  assert.doesNotMatch(
    src,
    /if \(ctrl && alt && !attachHold\) \{ Emit\("override"/,
    'the override exclusion regressed to attachment-only',
  );
});

test('enforcer-win.ps1: a send-button click during a platform block reports the block, not an empty patterns field', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static string ActivePatterns\(\) \{ return _fgIsBlocked \? _blockedReason :/);
});

test('enforcer-win.ps1: attach_hold stdin command only accepts on/off + a numeric ttl_ms, never free-form text', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const stdinLoop = src.slice(src.indexOf('static void StdinLoop()'), src.indexOf('static void PumpLoop()'));
  assert.match(stdinLoop, /cmd == "attach_hold"/);
  assert.match(stdinLoop, /state == "on"/);
  assert.match(stdinLoop, /state == "off"/);
  assert.match(stdinLoop, /ExtractJsonNumber\(line, "ttl_ms", 3000\)/);
});

test('attachment-watcher.ps1 emits attachment_disappeared, not just attachment_appeared', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.ps1'), 'utf8');
  assert.match(src, /kind\s*=\s*'attachment_disappeared'/);
});

test('attachment-watcher.ps1 seeds a silent baseline on first sight of a window instead of diffing against empty', async () => {
  // Regression for a real bug found live (2026-08): $Seen lives only in this
  // process's memory, so a fresh watcher restart always starts with an empty
  // $prev for every hwnd. Without a seed step, any filename-shaped chip
  // already sitting in a long chat's scrollback got treated as a brand-new
  // attachment on every single restart, firing a false attachment_appeared
  // (and re-arming a block hold) for a file the user never touched.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.ps1'), 'utf8');
  assert.match(src, /if \(-not \$Seen\.ContainsKey\(\$fg\.Hwnd\)\)/);
});

test('attachment-watcher.js dispatches attachment_disappeared instead of dropping it as unknown', async () => {
  // Same class of bug this repo already hit once for enforcer.js's 'route'
  // kind (a missing switch case silently discarded every event) — guard the
  // same mistake here.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'attachment-watcher.js'), 'utf8');
  assert.match(src, /case 'attachment_disappeared':\s*\n\s*this\.emit\('attachment_disappeared', ev\);/);
});

test('OsMonitor arms a provisional hold before the file scan resolves, and only escalates on high/critical', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  // Provisional: armed before buildFileUploadEvent is even called.
  const appearedHandler = src.slice(
    src.indexOf("this.attachmentWatcher.on('attachment_appeared'"),
    src.indexOf("this.attachmentWatcher.on('attachment_disappeared'"),
  );
  // Arming now goes through #armAttachHold, which owns the hold MAP (several
  // files can be held at once) and the refresh ticker. The 3s TTL and the
  // arm-before-the-scan ORDERING are unchanged, and the ordering is still the
  // property under test.
  const provisionalIdx = appearedHandler.indexOf("this.#armAttachHold(ev.filename, { patterns: '', ttlMs: 3000, processName: ev.process })");
  const scanIdx = appearedHandler.indexOf('buildFileUploadEvent(');
  assert.ok(provisionalIdx >= 0, 'expected a provisional #armAttachHold call');
  assert.ok(scanIdx >= 0, 'expected a buildFileUploadEvent call');
  assert.ok(provisionalIdx < scanIdx, 'the provisional hold must be armed BEFORE the scan starts, not after');
  // Escalation threshold matches the browser extension's existing file-block
  // severity (high/critical only, not moderate) — PLUS the fail-closed case,
  // which is gated on the conversation being governed/blocked so that nothing
  // changes for any ordinary AI app.
  assert.match(appearedHandler, /shouldHold = severity === 'high' \|\| severity === 'critical' \|\| failClosed/);
  assert.match(appearedHandler, /const failClosed = !!governed && unverified;/);
});

test('OsMonitor refreshes EVERY attach hold — provisional included — so one cannot lapse while the file stays attached', async () => {
  // Regression: attachment_appeared only fires once, on first appearance —
  // it does not keep firing while a chip just sits there unchanged.
  // Confirmed live: a confirmed hold (60s TTL) silently expired with the
  // sensitive file never removed, and the next Enter went through
  // unblocked, because nothing was re-sending attach_hold('on', ...) to
  // keep it alive. #startAttachHoldRefresh is the fix.
  //
  // SECOND HALF of the same bug, fixed later: the ticker used to start only for
  // a CONFIRMED hold, so the 3s PROVISIONAL one — whose entire job is to win the
  // race against a fast Enter while the scan runs — could lapse before the scan
  // returned. A slow extraction (OCR, a big PDF, a deep zip) is exactly the case
  // where that happens, and exactly the file most worth holding. #syncAttachHold
  // is now the single arming path and it always starts the ticker.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /#startAttachHoldRefresh\(payload, everyMs\)/);
  assert.match(src, /this\.attachHoldRefreshTimer = setInterval\(/);
  // Every arm goes through #syncAttachHold, and it starts the ticker
  // unconditionally — there is no "only if confirmed" branch left.
  const sync = src.slice(src.indexOf('#syncAttachHold()'), src.indexOf('#armAttachHold('));
  assert.ok(sync.length > 0, 'expected a #syncAttachHold body');
  assert.match(sync, /this\.enforcer\.attachHold\('on', payload\);/);
  assert.match(sync, /this\.#startAttachHoldRefresh\(payload, Math\.max\(500, Math\.floor\(shortestTtl \/ 3\)\)\);/);
  // The interval is derived from the SHORTEST TTL in force. The old
  // Math.max(5000, ttlMs/3) refreshed a 3s hold every 5s, i.e. never in time.
  assert.match(sync, /shortestTtl = Math\.min\(shortestTtl, held\.ttlMs\)/);
  // The refresh timer stops itself once nothing is held — otherwise a released
  // hold could get silently re-armed by a stale interval nobody cleared.
  assert.match(src, /if \(this\.attachHolds\.size === 0\) \{ this\.#stopAttachHoldRefresh\(\); return; \}/);
});

test('OsMonitor tracks holds PER FILE, so releasing one never releases another', async () => {
  // The multi-file defect. attachHoldFilename was a single string, so a second
  // attachment overwrote the first's tracking, and — the half that actually let
  // a sensitive file through — an attachment_disappeared for a CLEAN file B
  // released the hold that FLAGGED file A still needed.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /this\.attachHolds = new Map\(\);/);
  // The single-string field is gone entirely — no call site can resurrect the
  // "one slot" assumption.
  assert.equal(codeOnly(src).includes('attachHoldFilename'), false,
    'the single-slot hold field must not come back');
  // Release deletes ONE key, and only tells the helper to release when nothing
  // is left; otherwise it re-states the hold with the narrowed union.
  const release = src.slice(src.indexOf('#releaseAttachHold(filename)'), src.indexOf('#startAttachHoldRefresh(payload, everyMs)'));
  assert.ok(release.length > 0, 'expected a #releaseAttachHold body');
  assert.match(release, /if \(!this\.attachHolds\.delete\(filename\)\) return false;/);
  assert.match(release, /if \(this\.attachHolds\.size === 0\) \{/);
  assert.match(release, /this\.enforcer\.attachHold\('off', \{ filename, process: processName \}\);/);
  assert.match(release, /\} else \{\s*\r?\n\s*this\.#syncAttachHold\(\);/);
  // The pattern list and the filename the helper is told about are the UNION
  // across every file still held, so a block never under-reports what holds it.
  const sync = src.slice(src.indexOf('#syncAttachHold()'), src.indexOf('#armAttachHold('));
  assert.match(sync, /filename: \[\.\.\.this\.attachHolds\.keys\(\)\]\.join\(', '\)/);
  assert.match(sync, /patterns: \[\.\.\.patterns\]\.join\(','\)/);
  // …and the hold is bound to the app it was armed for.
  assert.match(sync, /process: this\.attachHoldProcess \|\| ''/);
});

test('OsMonitor releases the hold when the flagged attachment disappears, and stops refreshing it', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const disappearedHandler = src.slice(src.indexOf("this.attachmentWatcher.on('attachment_disappeared'"));
  // Both the 'off' command and the ticker stop now live in #releaseAttachHold —
  // which is what makes the release PER FILE. The handler's own job is only to
  // ask for this one file to be released, and to say nothing when it was not
  // held (an unrelated file's disappearance must change nothing at all).
  assert.match(disappearedHandler.slice(0, 400), /if \(!this\.#releaseAttachHold\(ev\.filename\)\) return;/);
  const release = src.slice(src.indexOf('#releaseAttachHold(filename)'), src.indexOf('#startAttachHoldRefresh(payload, everyMs)'));
  assert.match(release, /attachHold\('off', \{ filename, process: processName \}\)/);
  assert.match(release, /this\.#stopAttachHoldRefresh\(\);/);
});

test('a blocked attachment reports blocked_for:file_upload and never claims the upload itself was prevented', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const blockHandler = src.slice(src.indexOf("this.enforcer.on('block'"), src.indexOf("this.enforcer.on('override'"));
  assert.match(blockHandler, /blocked_for: reason/);
  assert.match(blockHandler, /isAttachment \? 'file_upload'/);
  assert.match(blockHandler, /blocked_by: isAttachment \? 'attachment_hold' : undefined/);
  // Honest framing per the design decision — must not claim the bytes never
  // left the machine, since several chat apps upload on attach, before Send.
  assert.match(blockHandler, /already uploaded it on attach/);
});

test('main.js relays reason/filename to the block dialog without needing to parse them itself', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  // index.js is the one place that builds the @@CFAI-BLOCK payload; main.js
  // just JSON.parses and forwards it whole, so the new fields only need to
  // exist on THIS side to reach the renderer.
  const relayStart = src.indexOf("console.log('@@CFAI-BLOCK '");
  const relay = src.slice(relayStart, relayStart + 400);
  assert.match(relay, /reason: ev\.reason \|\| ''/);
  assert.match(relay, /filename: ev\.filename \|\| ''/);
});

test('block-dialog.js never offers Tokenize & Send copy for an attachment block, and states the honest limitation', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'renderer', 'block-dialog.js'), 'utf8');
  assert.match(src, /const isAttachment = ev\.reason === 'attachment';/);
  assert.match(src, /This attachment can't be sent/);
  // The one sentence that matters most in this whole feature: never imply
  // the upload itself was prevented.
  assert.match(src, /does not undo an upload that already happened/);
});

test('main.js only shows the center dialog when the block is actually rewritable — never a bare "Got it" duplicate of the toast', async () => {
  // Confirmed live TWICE: once for an attachment block, once for an
  // ordinary non-maskable guardrail/prompt-injection block — both fired the
  // toast (from index.js's enforcer.on('block') handler) AND this center
  // dialog, with the dialog having nothing actionable to add (no Tokenize
  // option, no retraction button) — just a "Got it" restating what the
  // toast already said. The fix generalizes on rewritable, not on reason,
  // so it covers every non-maskable block, not just attachments.
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  const blockHandler = src.slice(src.indexOf("line.startsWith('@@CFAI-BLOCK '"), src.indexOf("line.startsWith('@@CFAI-REWRITE '"));
  assert.match(blockHandler, /if \(parsed\.rewritable\) showBlockDialogWindow\(parsed\);/);
  // …and nothing else may open that dialog from this path.
  const opens = blockHandler.match(/showBlockDialogWindow\(/g) || [];
  assert.equal(opens.length, 1);
});

// ── Desktop Request Access: a full platform block gets an actionable dialog ───

test('main.js routes a platform block to the FOCUSABLE Request Access dialog, not the Tokenize one', async () => {
  // The bug this fixes: a clean platform block (nothing sensitive in the
  // message) is rewritable:false, so the guard above dropped it and the user
  // saw a toast with nothing to act on. It now gets its own dialog, checked
  // BEFORE the rewritable guard so it can never fall through to Tokenize.
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  const blockHandler = src.slice(src.indexOf("line.startsWith('@@CFAI-BLOCK '"), src.indexOf("line.startsWith('@@CFAI-REWRITE '"));
  const platformIdx = blockHandler.indexOf('if (parsed.platform_block)');
  const rewritableIdx = blockHandler.indexOf('if (parsed.rewritable)');
  assert.ok(platformIdx >= 0, 'expected a platform_block branch');
  assert.ok(platformIdx < rewritableIdx, 'the platform-block branch must come first');
  assert.match(blockHandler, /if \(parsed\.platform_block\) \{ showAccessRequestWindow\(parsed\); return; \}/);
});

test('the Request Access window is focusable, and showBlockDialogWindow stays non-focusable', async () => {
  // The reason box needs keyboard focus. The Tokenize popup must NOT take it —
  // focusable:true there is the regression that left it stuck on "Masking…"
  // (the enforcer clears a pending rewrite 3s after focus leaves the AI app).
  // Both properties are asserted together so a future "let's unify these two
  // windows" change cannot quietly take the focusable flag with it.
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');

  const tokenize = src.slice(src.indexOf('function showBlockDialogWindow('), src.indexOf('function showAccessRequestWindow('));
  assert.match(tokenize, /focusable: false/);
  assert.match(tokenize, /showInactive\(\)/);

  const access = src.slice(src.indexOf('function showAccessRequestWindow('), src.indexOf('function parseMonitorLine('));
  assert.ok(access.length > 0, 'expected a showAccessRequestWindow function');
  assert.equal(/focusable: false/.test(access), false, 'the reason textarea cannot be typed into without focus');
  assert.match(access, /accessWindow\.focus\(\)/);
  assert.match(access, /renderer', 'access-request\.html'/);
});

test('enforcer-win.ps1: keystrokes are only captured while an AI app is REALLY foreground', async () => {
  // PII invariant for the Request Access dialog, and a real capture bug in its
  // own right. _fgIsAi stays true for 3s after focus leaves an AI app (the
  // sticky window that closes the dismiss-toast-then-quick-send bypass), and
  // the typed buffer used to accumulate on that flag — so text typed into
  // whatever the user alt-tabbed to was appended and regex-scanned. The new
  // dialog opens squarely inside that window.
  //
  // The split that must hold: CAPTURE uses FgIsAiNow(), every block DECISION
  // still uses the sticky _fgIsAi.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // PanelEnforceOk() joined this gate when IDE panels landed: a detection-only
  // panel must not accumulate keystrokes either. The sticky/now split it exists
  // for is unchanged.
  assert.match(src, /static bool FgIsAiNow\(\) \{ return _fgIsAi && _fgLeftAiTicks == 0 && PanelEnforceOk\(\); \}/);
  assert.match(src, /if \(FgIsAiNow\(\)\)\s*\r?\n\s*\{\s*\r?\n\s*char c = MapKey\(vk, shift, caps\);/);
  assert.match(src, /if \(FgIsAiNow\(\)\) \{ TypedBackspace\(\);/);
  // The Enter decision must NOT have been narrowed to FgIsAiNow — that would
  // reopen the bypass the sticky flag exists to close. Neither the call site nor
  // the predicate it now delegates to may mention it.
  const enterPred = src.slice(src.indexOf('static bool EnterBlockActive('), src.indexOf('static string ActivePatterns()'));
  assert.ok(enterPred.length > 0, 'expected an EnterBlockActive body');
  assert.equal(/FgIsAiNow/.test(enterPred), false, 'block decisions stay on the sticky flag');
  const enterBranch = src.slice(src.indexOf('if (vk == VK_RETURN && !shift)'), src.indexOf('else if (vk == VK_ESCAPE)'));
  assert.equal(/FgIsAiNow/.test(enterBranch), false, 'block decisions stay on the sticky flag');
});

test('main.js does not re-render an open Request Access dialog and discard the typed reason', async () => {
  // A blocked app keeps emitting blocks (every swallowed Enter, every swallowed
  // send-button click), so the naive "send the payload again" path would wipe
  // the textarea mid-sentence.
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  const fn = src.slice(src.indexOf('function showAccessRequestWindow('), src.indexOf('function parseMonitorLine('));
  assert.match(fn, /accessWindowHost === \(data\?\.tool_host \|\| null\)/);
  const guardIdx = fn.indexOf('accessWindowHost ===');
  const sendIdx = fn.indexOf('accessWindowHost = data?.tool_host');
  assert.ok(guardIdx >= 0 && guardIdx < sendIdx, 'the raise-only guard must come before the re-render path');
});

test('the access-request IPC handler caps the reason, tells 401 apart from offline, and queues one slot', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  const handler = src.slice(src.indexOf("ipcMain.handle('access-request',"), src.indexOf("ipcMain.handle('access-request-status',"));
  assert.ok(handler.length > 0, "expected an 'access-request' IPC handler");
  assert.match(handler, /reason: String\(p\.reason \|\| ''\)\.slice\(0, REASON_MAX\)/);
  assert.match(handler, /surface: 'desktop'/);
  assert.match(handler, /authorization: `Bearer \$\{creds\.token\}`/);
  // A 401 is a re-enrolment problem, not a network problem, and must not be
  // reported as one (nor queued for retry — retrying cannot fix it).
  assert.match(handler, /if \(res\.status === 401\)[\s\S]{0,200}code: 'reenroll'/);
  // The offline path writes the single slot; only the catch branch does.
  assert.match(handler, /catch \(netErr\)[\s\S]{0,400}writeFileSync\(\s*PENDING_ACCESS_REQUEST_PATH/);
  assert.equal(/prompt|preview|clipboard/i.test(handler), false, 'no prompt content may travel on this path');
  assert.match(src, /const REASON_MAX = 500;/);
});

test('access-request.js never captures or forwards anything but the typed reason', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'renderer', 'access-request.js'), 'utf8');
  // Same escapeHtml helper as block-dialog.js, and every interpolated value
  // goes through it.
  assert.match(src, /function escapeHtml\(str\)/);
  assert.match(src, /maxlength="\$\{REASON_MAX\}"/);
  assert.match(src, /const REASON_MAX = 500;/);
  assert.match(src, /\$reason\.value\.slice\(0, REASON_MAX\)/);
  // A platform block never inspected the message, so the dialog must not even
  // reference prompt content — there is none to show.
  assert.equal(/ev\.preview|ev\.patterns|block_id/.test(src), false);
  // On load it asks what this device already requested, instead of submitting
  // into a 409.
  assert.match(src, /getAccessRequestStatus\(current\.tool_host\)/);
});

test('the preload bridge exposes only the two access-request calls plus the event', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'preload.js'), 'utf8');
  assert.match(src, /submitAccessRequest: \(payload\) => ipcRenderer\.invoke\('access-request', payload\)/);
  assert.match(src, /getAccessRequestStatus: \(toolHost\) => ipcRenderer\.invoke\('access-request-status', toolHost\)/);
  assert.match(src, /ipcRenderer\.on\('access-request-dialog', handler\)/);
});

// ── Both entry points must actually START the sync ───────────────────────────
// The bug these two pin: the sync lived inline in monitor-runner.mjs, so it ran
// ONLY under the Electron app. Installed via install.ps1 / build:sea (bare-Node
// CLI, `ai-gov-agent --monitor`), blocked-agents.json was never written, the
// enforcer read a file that did not exist, and every agent-scoped block,
// platform block and access exception silently enforced nothing — while the
// keystroke enforcer itself kept running, so the install looked healthy.
//
// Source-level, like the other entry-point tests here: both files have top-level
// side effects (credentials, singleton lock, spawning watchers) and cannot be
// imported.

test('the bare-Node CLI --monitor path starts the blocked-agents sync', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'index.js'), 'utf8');
  const monitorBlock = src.slice(src.indexOf('if (values.monitor) {'), src.indexOf('// Deferred background scan'));
  assert.ok(monitorBlock.length > 0, 'expected an `if (values.monitor)` block in main()');
  assert.match(monitorBlock, /startBlockedAgentsSync\b/, 'the CLI/.exe install enforces no server-driven block without this');
  assert.match(monitorBlock, /await import\('\.\/os_monitor\/blocked-agents-sync\.js'\)/);
  // Credentials come from loadCredentials() here, not from reading
  // credentials.json — with --server as the fallback the OsMonitor above uses.
  assert.match(monitorBlock, /serverUrl: creds\?\.serverUrl \|\| values\.server/);
  assert.match(monitorBlock, /token: creds\?\.token/);
  // It must be started, not merely imported.
  const importIdx = monitorBlock.indexOf("blocked-agents-sync.js'");
  assert.ok(monitorBlock.indexOf('startBlockedAgentsSync({', importIdx) > importIdx, 'imported but never called');
});

test('the Electron monitor-runner starts the blocked-agents sync from the SAME shared module', async () => {
  // …and holds no copy of its own. One implementation, two callers: a fix or a
  // fail-closed guard added to the module must reach both installs.
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
  assert.match(src, /import \{ startBlockedAgentsSync \} from '\.\.\/src\/os_monitor\/blocked-agents-sync\.js';/);
  assert.match(src, /startBlockedAgentsSync\(\{ serverUrl: creds\.serverUrl, token: creds\.token, log \}\);/);
  // No duplicated implementation left behind.
  for (const moved of ['async function refreshBlockedAgents', 'async function fetchAiPlatforms', 'async function fetchMyExceptions', 'async function flushPendingAccessRequest', 'setInterval(tick']) {
    assert.equal(src.includes(moved), false, `${moved} must live only in blocked-agents-sync.js`);
  }
  // The Electron-only pieces stay HERE and are deliberately NOT shared — the CLI
  // has no Electron dialog to relay a tokenize command from.
  assert.match(src, /msg\.cmd === 'tokenize' && msg\.block_id/);
  assert.match(src, /acquireMonitorLock\(\)/);
  assert.match(src, /reapOrphans\(/);
});

test('blocked-agents-sync subtracts access exceptions from blocked-agents.json, and fails CLOSED', async () => {
  // The whole desktop un-blocking path: enforcer-win.ps1 is unchanged and just
  // re-reads the file, so if this filter does not run an approved exception
  // does nothing on the desktop.
  const src = await readFile(BLOCKED_SYNC, 'utf8');
  assert.match(src, /access-exceptions\/mine/);
  assert.match(src, /filterBlockedAgents\(list, exceptions, log\)/);
  // null (could not ask) must keep the blocklist intact; [] (no exceptions) is
  // a real answer and does filter.
  assert.match(src, /exceptions === null \? list : filterBlockedAgents/);
  assert.match(src, /return null;/);
  // Both the sync and the queued-request flush run on the same tick — shortened
  // from 30s to 10s so it matches enforcer-win.ps1's own BLOCKED_CHECK_INTERVAL
  // and a block/approval reaches the keyboard hook in ~20s worst case.
  assert.match(src, /setInterval\(tick, 10_000\)/);
  assert.match(src, /flushPendingAccessRequest\(serverUrl, token, log\)/);
  // The timer must stay unref()'d — this poller may never be the reason the
  // process refuses to exit.
  assert.match(src, /blockedInterval\.unref\(\)/);
});

test('the offline access-request queue is one slot and is not retried forever', async () => {
  const src = await readFile(BLOCKED_SYNC, 'utf8');
  assert.match(src, /pending-access-request\.json/);
  // A 4xx is a verdict (already pending / rejected in cooldown / bad payload) —
  // clear the slot. Only 5xx or a thrown network error keeps it.
  assert.match(src, /if \(res\.status < 500\)[\s\S]{0,160}rmSync\(PENDING_REQUEST_PATH/);
  assert.match(src, /PENDING_REQUEST_TTL_MS = 24 \* 3600 \* 1000/);
});

// ── Inventory host-block → desktop enforcement bridge ────────────────────────
// The admin Inventory page's per-host `blocked` toggle used to be enforced by
// the browser extension ONLY. These assertions pin the three pieces that carry
// it into the desktop keystroke enforcer, none of which can be exercised
// without spawning a keyboard hook.

test('blocked-agents-sync fetches ai-platforms unfiltered and merges synthesised platform blocks', async () => {
  const src = await readFile(BLOCKED_SYNC, 'utf8');
  assert.match(src, /synthesizePlatformBlocks/);
  // Unfiltered on purpose: no admin UI has ever set `surface`, so every row is
  // 'browser' and ?surface=desktop would return nothing useful.
  assert.match(src, /\/api\/v1\/ai-platforms`/);
  assert.equal(/ai-platforms\?/.test(src), false, 'the ai-platforms fetch must carry no query string');
  // Authenticated even though the route ignores it today, matching the
  // extension's precedent, so requiring auth later needs no agent change.
  const fetcher = src.slice(src.indexOf('async function fetchAiPlatforms('), src.indexOf('async function refreshBlockedAgents('));
  assert.ok(fetcher.length > 0, 'expected a fetchAiPlatforms function');
  assert.match(fetcher, /authorization: `Bearer \$\{token\}`/);
  // Agent rows FIRST — CheckFgBlocked returns on its first match, so array
  // order is the precedence between the two sources.
  assert.match(src, /agentRows[\s\S]{0,80}\.concat\(synthesizePlatformBlocks\(platforms\)\)/);
});

test('blocked-agents-sync fails CLOSED when EITHER source is unreachable — never a partial rewrite', async () => {
  // A file built from only one source silently drops every block the other
  // source contributed. A stale file keeps enforcing the last known policy.
  const src = await readFile(BLOCKED_SYNC, 'utf8');
  const fn = src.slice(src.indexOf('async function refreshBlockedAgents('), src.indexOf('// ── Offline access-request queue'));
  assert.ok(fn.length > 0, 'expected a refreshBlockedAgents function');
  // blocked-agents unreachable → bail before any write. `null`, not a bare
  // return: the function's result is now the blocked set the governed sync
  // filters against, and null is what tells it "unknown — write nothing".
  assert.match(fn, /if \(!res\.ok\) return null;/);
  // ai-platforms unreachable → bail before any write, too.
  const platformGuard = fn.indexOf('if (platforms === null) {');
  const write = fn.indexOf('writeFileSync(BLOCKED_PATH');
  assert.ok(platformGuard >= 0, 'expected an explicit platforms === null guard');
  assert.ok(platformGuard < write, 'the fail-closed guard must come before the write');
  assert.match(fn.slice(platformGuard, write), /return null;/);
});

// ── governed-agents.json — DLP-monitored, NOT blocked ───────────────────────
// The SECOND file blocked-agents-sync.js writes, from GET
// /api/lifecycle/governed-agents. These cases are BEHAVIOURAL rather than
// source-level, because what matters is what lands on disk: the shape the
// enforcer will parse, and the blocked-wins precedence, which is a property of
// the written file and not of any one function.
//
// Nothing here spawns anything (the module is file I/O plus four fetches, all
// stubbed) and nothing touches the real ~/.cloudfuze-aigov: homedir() is
// repointed at a temp dir for the duration of each case.

const SYNC_SERVER = 'http://127.0.0.1:1';
const SYNC_TOKEN = 'test-token';
const GOVERNED_ROUTE = '/api/lifecycle/governed-agents';
const BLOCKED_ROUTE = '/api/lifecycle/blocked-agents';

/** Records everything the sync logged, so a fail-closed path can be asserted on. */
function recordingLog() {
  const lines = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
}

const jsonOk = (body) => () => ({ ok: true, status: 200, json: async () => body });
const jsonStatus = (code) => () => ({ ok: false, status: code, json: async () => ({}) });
const offline = () => () => { throw new Error('getaddrinfo ENOTFOUND'); };

/** Route fetch by URL fragment; an unexpected URL is a test bug, not a 500. */
function stubFetch(routes) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [fragment, handler] of Object.entries(routes)) if (u.includes(fragment)) return handler();
    throw new Error(`unexpected fetch: ${u}`);
  };
  return () => { globalThis.fetch = real; };
}

/**
 * Import a FRESH copy of blocked-agents-sync.js with homedir() pointed at a temp
 * directory — the module resolves BLOCKED_PATH / GOVERNED_PATH once, at import
 * time, so the env has to be set before the import and the URL needs a
 * cache-buster. os.homedir() reads USERPROFILE on Windows and HOME on POSIX;
 * both are set so this behaves identically on either.
 */
async function withSyncModule(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'cfai-govsync-'));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  try {
    const mod = await import(`${pathToFileURL(BLOCKED_SYNC).href}?home=${encodeURIComponent(dir)}`);
    return await fn(mod, dir);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

/** One full tick: the blocked write, then the governed write it feeds. */
async function runTick(mod, log) {
  const blocked = await mod.refreshBlockedAgents(SYNC_SERVER, SYNC_TOKEN, log);
  await mod.refreshGovernedAgents(SYNC_SERVER, SYNC_TOKEN, log, blocked);
  return blocked;
}

test('governed-agents.json is a SEPARATE file, written field-for-field in the blocked rows shape', async () => {
  const restore = stubFetch({
    '/api/v1/access-exceptions/mine': jsonOk([]),
    '/api/v1/ai-platforms': jsonOk([]),
    [BLOCKED_ROUTE]: jsonOk([]),
    [GOVERNED_ROUTE]: jsonOk([{
      agent_id: 'ag-1',
      agent_name: 'IT Help Desk Agent',
      platform: 'teams_chat_agent',
      reason: 'Monitored by policy',
      oauth_key_id: 'k1',
      agent_scope: 'agent',
      dlp_monitor: true,
      dlp_monitor_at: '2026-09-01T10:00:00.000Z',
      orphaned: false,
    }]),
  });
  try {
    await withSyncModule(async (mod, dir) => {
      const log = recordingLog();
      await runTick(mod, log);

      assert.equal(mod.GOVERNED_PATH, join(dir, '.cloudfuze-aigov', 'governed-agents.json'));
      assert.notEqual(mod.GOVERNED_PATH, mod.BLOCKED_PATH, 'the two lists must never share one file');
      const written = JSON.parse(await readFile(mod.GOVERNED_PATH, 'utf8'));
      // Exactly the server's identity + enforcement fields, same names as the
      // blocked rows, agent_scope normalised to the enum. No invented fields.
      assert.deepEqual(written, [{
        agent_id: 'ag-1',
        agent_name: 'IT Help Desk Agent',
        platform: 'teams_chat_agent',
        reason: 'Monitored by policy',
        oauth_key_id: 'k1',
        agent_scope: 'agent',
        dlp_monitor: true,
        dlp_monitor_at: '2026-09-01T10:00:00.000Z',
        orphaned: false,
      }]);
      // The blocked file is written from its own sources and stays empty.
      assert.deepEqual(JSON.parse(await readFile(mod.BLOCKED_PATH, 'utf8')), []);
      assert.match(log.lines.join('\n'), /governed-agents: synced 1 DLP-monitored agent\(s\)/);
    });
  } finally {
    restore();
  }
});

test('BLOCKED WINS at the SYNC layer: an agent on both lists never reaches governed-agents.json', async () => {
  // The race this defends against: the two lists are two separate GETs a
  // fraction of a second apart, so an admin flipping a block between them (or
  // one list being a poll cycle stale) can hand the agent two overlapping
  // lists even though the server excludes blocked rows from /governed-agents.
  // Filtering here makes the overlap impossible ON DISK.
  const restore = stubFetch({
    '/api/v1/access-exceptions/mine': jsonOk([]),
    '/api/v1/ai-platforms': jsonOk([]),
    [BLOCKED_ROUTE]: jsonOk([
      { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
      { agent_id: '', agent_name: 'Roaming Agent', platform: 'teams_chat_agent', agent_scope: 'agent' },
    ]),
    [GOVERNED_ROUTE]: jsonOk([
      // Same agent_id as a blocked row — the server should never send this, and
      // if it ever does it must still not be governed.
      { agent_id: 'ag-1', agent_name: 'IT Help Desk Agent', platform: 'teams_chat_agent', agent_scope: 'agent', dlp_monitor: true },
      // No id on the blocked side: the normalized, case-insensitive name is the
      // fallback key, and it must still collide.
      { agent_id: 'ag-9', agent_name: 'roaming  agent', platform: 'teams_chat_agent', agent_scope: 'agent', dlp_monitor: true },
      { agent_id: 'ag-2', agent_name: 'Finance Bot', platform: 'teams_chat_agent', agent_scope: 'agent', dlp_monitor: true },
    ]),
  });
  try {
    await withSyncModule(async (mod) => {
      const log = recordingLog();
      await runTick(mod, log);

      const governed = JSON.parse(await readFile(mod.GOVERNED_PATH, 'utf8'));
      assert.deepEqual(governed.map((r) => r.agent_id), ['ag-2'],
        'a blocked agent must never appear in the governed file, by id or by name');
      // …and the intersection of the two files on disk is empty, stated as the
      // property the enforcer depends on rather than as a row list.
      const blocked = JSON.parse(await readFile(mod.BLOCKED_PATH, 'utf8'));
      const keyOf = (r) => `${String(r.agent_id || '').trim()}|${String(r.agent_name || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
      const blockedKeys = new Set(blocked.map(keyOf));
      for (const row of governed) {
        assert.equal(blockedKeys.has(keyOf(row)), false, `${row.agent_id} is in BOTH files`);
      }
      assert.match(log.lines.join('\n'), /blocked wins/);
    });
  } finally {
    restore();
  }
});

test('governed-agents fetch failure leaves the existing file UNTOUCHED — never an empty list', async () => {
  // An empty file reads as "nothing is monitored", which would silently switch
  // off prompt scanning for every governed agent. A stale file keeps enforcing
  // the last known policy until the next tick, 10s away.
  for (const failure of [jsonStatus(500), jsonStatus(404), offline()]) {
    const restore = stubFetch({
      '/api/v1/access-exceptions/mine': jsonOk([]),
      '/api/v1/ai-platforms': jsonOk([]),
      [BLOCKED_ROUTE]: jsonOk([]),
      [GOVERNED_ROUTE]: failure,
    });
    try {
      await withSyncModule(async (mod, dir) => {
        // A previous tick's good file, already on disk.
        const good = '[{"agent_id":"ag-1","agent_name":"Finance Bot","platform":"personal_agent","agent_scope":"agent"}]';
        await mkdir(join(dir, '.cloudfuze-aigov'), { recursive: true });
        await writeFile(mod.GOVERNED_PATH, good, 'utf8');

        const log = recordingLog();
        await runTick(mod, log);

        assert.equal(await readFile(mod.GOVERNED_PATH, 'utf8'), good,
          'a transient failure must not overwrite good data');
        assert.match(log.lines.join('\n'), /governed-agents: (server returned|fetch failed)/);
      });
    } finally {
      restore();
    }
  }
});

test('an UNKNOWN blocked list stops the governed write too — precedence cannot be proven without it', async () => {
  // Fail closed in the other direction: if this tick could not establish what is
  // blocked, writing a governed list that might name an agent the (stale)
  // blocked file also names would let the enforcer offer to tokenize a prompt
  // for an agent it is meant to refuse outright.
  for (const [label, routes] of [
    ['blocked-agents unreachable', { [BLOCKED_ROUTE]: jsonStatus(503), '/api/v1/ai-platforms': jsonOk([]) }],
    ['ai-platforms unreachable', { [BLOCKED_ROUTE]: jsonOk([]), '/api/v1/ai-platforms': jsonStatus(500) }],
  ]) {
    const restore = stubFetch({
      '/api/v1/access-exceptions/mine': jsonOk([]),
      ...routes,
      // Perfectly healthy — and still must not be written.
      [GOVERNED_ROUTE]: jsonOk([{ agent_id: 'ag-1', agent_name: 'Finance Bot', platform: 'personal_agent', dlp_monitor: true }]),
    });
    try {
      await withSyncModule(async (mod) => {
        const log = recordingLog();
        const blocked = await runTick(mod, log);
        assert.equal(blocked, null, `${label}: the blocked set must be reported as unknown`);
        await assert.rejects(() => readFile(mod.GOVERNED_PATH, 'utf8'), /ENOENT/,
          `${label}: nothing may be written when the blocked set is unknown`);
        await assert.rejects(() => readFile(mod.BLOCKED_PATH, 'utf8'), /ENOENT/,
          `${label}: the blocked file is left alone too`);
        assert.match(log.lines.join('\n'), /governed-agents: the blocked list is unknown this tick/);
      });
    } finally {
      restore();
    }
  }
});

test('the poll runs on the SAME 10s tick, chained so the governed write sees the fresh blocked set', async () => {
  const src = await readFile(BLOCKED_SYNC, 'utf8');
  // One route, one interval, one file each.
  assert.match(src, /\/api\/lifecycle\/governed-agents`/);
  assert.match(src, /governed-agents\.json'\)/);
  assert.match(src, /setInterval\(tick, 10_000\)/);
  // Chained, not parallel: the governed write consumes refreshBlockedAgents'
  // return value, which is what makes the precedence filter use this tick's
  // blocked set rather than a list it fetched independently.
  assert.match(src, /refreshBlockedAgents\(serverUrl, token, log\)\r?\n\s*\.then\(\(blocked\) => refreshGovernedAgents\(serverUrl, token, log, blocked\)\)/);
  // Fail-closed guard before the write, same discipline as the blocked list.
  const fn = src.slice(src.indexOf('async function refreshGovernedAgents('), src.indexOf('// ── Offline access-request queue'));
  assert.ok(fn.length > 0, 'expected a refreshGovernedAgents function');
  const guard = fn.indexOf('if (!Array.isArray(blockedRows))');
  const fetchGuard = fn.indexOf('if (rows === null) return;');
  const write = fn.indexOf('writeFileSync(GOVERNED_PATH');
  assert.ok(guard >= 0 && guard < write, 'the unknown-blocked-set guard must come before the write');
  assert.ok(fetchGuard >= 0 && fetchGuard < write, 'the fetch-failure guard must come before the write');
  // The filter runs on the way to the write, and on the blocked rows passed in.
  assert.match(fn, /filterGovernedAgents\(normalized, blockedRows, log\)/);
  assert.ok(fn.indexOf('filterGovernedAgents(') < write, 'blocked-wins must be applied before the write');
});

test('enforcer-win.ps1: a host-keyed platform block matches on process_name, keeping the sentinel out of PLATFORM_PROCS', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // Hunk 1: the new field is parsed off each row alongside the existing ones.
  assert.match(src, /d\["process_name"\] = ExtractJsonString\(item, "process_name"\);/);
  // The non-empty-platform guard is untouched — the sentinel satisfies it, so
  // no synthesised row is dropped at parse time.
  assert.match(src, /if \(!string\.IsNullOrEmpty\(d\["platform"\]\)\) list\.Add\(d\);/);

  // Hunk 2: a second match branch inside the SAME loop iteration, so
  // first-match-wins ordering across the file is preserved.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  assert.ok(check.length > 0, 'expected a CheckFgBlocked body');
  assert.match(check, /PLATFORM_PROCS\.TryGetValue\(agent\["platform"\], out procs\)/);
  assert.match(check, /string\.Equals\(agent\["process_name"\], _app, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(check, /if \(!string\.IsNullOrEmpty\(agent\["process_name"\]\)\)/);
  assert.match(check, /_blockedPlatform = "ai_platform";/);
  assert.match(check, /_blockedReason = "Blocked platform: " \+ _blockedAgentName;/);
  // All FOUR arm sites (the agent-scoped narrowing of the PLATFORM_PROCS branch,
  // PLATFORM_PROCS whole-app, process_name, panel) must feed the same fields
  // EmitBlock already reports, or the Request Access dialog cannot name what to
  // ask for. Was three before agent_scope:'agent' added the narrowing modifier.
  assert.equal((check.match(/_fgIsBlocked = true;/g) || []).length, 4);
  assert.equal((check.match(/_blockedAgentId = agent\["agent_id"\] \?\? "";/g) || []).length, 4);
  // The whole point of the sentinel: PLATFORM_PROCS stays untouched.
  assert.equal(/"ai_platform",\s*new HashSet/.test(src), false, 'ai_platform must NOT be added to PLATFORM_PROCS');
});

test('the ai_platform sentinel cannot collide with a real platform id', async () => {
  const { PLATFORM_PROCS, PLATFORM_BLOCK_SENTINEL } = await import('../src/os_monitor/ai-processes.js');
  assert.equal(PLATFORM_BLOCK_SENTINEL, 'ai_platform');
  // A collision would make CheckFgBlocked's FIRST branch match a synthesised
  // row against the wrong process set.
  assert.equal(Object.keys(PLATFORM_PROCS).includes(PLATFORM_BLOCK_SENTINEL), false);
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const block = src.slice(src.indexOf('PLATFORM_PROCS = new Dictionary'));
  const keys = (block.slice(0, block.indexOf('};')).match(/\{\s*"([a-z_]+)"/g) || []).map((s) => s.replace(/[{"\s]/g, ''));
  assert.ok(keys.length > 0, 'could not parse PLATFORM_PROCS keys out of enforcer-win.ps1');
  assert.equal(keys.includes(PLATFORM_BLOCK_SENTINEL), false);
});

// ── IDE-hosted AI panels (Claude Code / Copilot Chat in VS Code, Cursor) ─────
// Static source assertions, same reason as every other .ps1 check in this file:
// exercising these paths for real means installing a system-wide keyboard hook.
// The pure-function half of this feature is covered in ai-panels.test.mjs.

test('enforcer-win.ps1: the typed-buffer owner key includes panel identity, not just the pid', async () => {
  // The bug this pins: an IDE hosts the AI composer, the code editor and a
  // terminal in ONE process, so a pid-only owner key never changed when focus
  // moved between them. Keystrokes typed in the editor between two panel visits
  // stayed in the scan buffer and were treated as part of the next AI prompt —
  // a real privacy/correctness defect, not a style nit.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /if \(_fgOwnerKey != _typedOwnerKey\)/);
  assert.match(src, /TypedClear\(\); _typedOwnerKey = _fgOwnerKey;/);
  // The key is composed on the POLL thread and carries pid + panel + element.
  assert.match(src, /_fgOwnerKey = pid\.ToString\(\) \+ "\|" \+ \(isPanel \? panelId : "none"\) \+ "\|" \+ panelRid;/);
  // The old pid-only comparison must be gone entirely.
  assert.equal(/_typedOwnerPid/.test(src), false, 'the pid-only owner key regressed');
  assert.equal(/_fgPid != _typedOwnerKey|_fgPid != _typedOwnerPid/.test(src), false);
  // Composing it must NOT happen on the hook thread — the hook only compares.
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  assert.equal(/ReadFocusedPanel|MatchPanelSignature/.test(hook), false, 'panel matching must stay on the poll thread');
  assert.equal(/_fgOwnerKey = /.test(hook), false, 'the hook must not compose the owner key');
});

test('enforcer-win.ps1: _ideApps is gone, replaced by the data-driven _ideProcs', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.equal(/_ideApps/.test(src), false, '_ideApps must not survive anywhere in the file');
  // The old hardcoded set is not restated either. "Copilot" in it was a
  // pre-existing bug (standalone Microsoft Copilot is a chat app, not an IDE)
  // and "VSCode" was never a real process name.
  assert.equal(/"Cursor", "Code", "VSCode", "Copilot"/.test(src), false);
  assert.match(src, /static HashSet<string> _ideProcs = new HashSet<string>\(StringComparer\.OrdinalIgnoreCase\);/);
  assert.match(src, /static HashSet<string> _ideFallbackProcs/);
});

test('enforcer-win.ps1: PanelUiaOk gates the Enter decision and Tokenize & Send, replacing the blanket IDE exclusion', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static bool PanelUiaOk\(\)/);
  // Trusted only while a panel is focused RIGHT NOW — not merely within the 3s
  // sticky window, during which the caret may already be back in the editor and
  // a UIA read would return source code or terminal output.
  const fn = src.slice(src.indexOf('static bool PanelUiaOk()'), src.indexOf('// ── Model routing'));
  // A HOST APP (Microsoft Teams) gets the same element scoping an IDE gets, for
  // the same reason: the process being in the foreground says nothing about
  // whether the one governed composer is what has focus, and between them sit
  // every DM and every channel whose content must never be read.
  assert.match(fn, /if \(!_ideProcs\.Contains\(_app\) && !_hostAppProcs\.Contains\(_app\)\) return true;/);
  assert.match(fn, /return _fgIsPanel && _fgPanelEnforce && _fgLeftAiTicks == 0;/);
  // PanelEnforceOk states the host-app case POSITIVELY rather than inheriting
  // the "not a panel → fine" default, so a future change has to opt out of it
  // deliberately instead of falling out of it by accident.
  const enforceOk = src.slice(src.indexOf('static bool PanelEnforceOk()'), src.indexOf('static bool PanelUiaOk()'));
  assert.match(enforceOk, /if \(_hostAppProcs\.Contains\(_app\)\) return _fgIsPanel && _fgPanelEnforce;/);
  // Enter decision: the old `!isIde && _blockUia` is replaced.
  assert.match(src, /bool uiaBlock = PanelUiaOk\(\) && _blockUia;/);
  // The old blanket `bool isIde = _ideProcs.Contains(...)` local inside the
  // Enter branch must stay gone. UpdateForeground has an `isIde` of its own now
  // (it feeds ApplyForegroundTick), so scope the check to the hook.
  const hookBody = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  assert.equal(/bool isIde = /.test(hookBody), false, 'the old isIde local must be gone from the hook');
  // Tokenize & Send: same replacement, so it is now available in a focused,
  // enforcing panel and still refused in the editor.
  // A HOST APP is excluded from it unless the tick is DLP-GOVERNED. The blanket
  // exclusion was the right answer while a host app could only ever be BLOCKED
  // (Tokenize & Send is the only path in the file that WRITES into another app's
  // composer, and the "composer" inside a general-purpose chat client could be a
  // message to a colleague); it is now scoped to the ticks where that cannot be
  // the case, i.e. where ApplyForegroundTick has already proved the user is
  // typing at a DLP-monitored agent. `&& !_fgDlpGoverned` is the whole of the
  // widening, and _fgDlpGoverned is false on every non-host-app tick, on every
  // ungoverned Teams tick, and on every BLOCKED tick.
  assert.match(src, /if \(!_fgIsAi \|\| !PanelUiaOk\(\) \|\| \(_hostAppProcs\.Contains\(_app\) && !_fgDlpGoverned\) \|\| Disarmed\(\)\)/);
  // …and the UIA read itself is gated, so the PII patterns never run over the
  // user's source code on the poll loop in the first place.
  assert.match(src, /if \(!_fgIsAi \|\| !PanelUiaOk\(\)\) \{ _blockUia = false; _uiaPatterns = ""; return; \}/);
});

test('enforcer-win.ps1: model routing still excludes IDE and HOST-APP processes ENTIRELY (not panel-scoped)', async () => {
  // Explicitly out of scope for IDE panels: there is no probed model-picker
  // signature for any of them. This must not have been "helpfully" widened.
  // A host app (Microsoft Teams) is excluded on the same terms and for a
  // stronger reason — there is no picker there to detect or drive at all, and
  // the picker search is a descendant-wide UIA walk on the poll thread.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const routing = src.slice(src.indexOf('static void UpdateModelRouting()'), src.indexOf('static void ClearPendingRoute()'));
  assert.ok(routing.length > 0, 'expected an UpdateModelRouting body');
  assert.match(routing, /if \(!_fgIsAi \|\| _ideProcs\.Contains\(_app\) \|\| _hostAppProcs\.Contains\(_app\) \|\| Disarmed\(\)\) \{ ClearPendingRoute\(\); return; \}/);
  // Not PanelUiaOk / _fgIsPanel — that would make routing panel-aware.
  assert.equal(/PanelUiaOk|_fgIsPanel/.test(routing), false, 'model routing must not become panel-aware');
});

test('enforcer-win.ps1: send-rect detection skips IDE processes instead of walking their UIA tree', async () => {
  // Attempt 1 there is FindAll(TreeScope.Descendants) over the whole foreground
  // window — a real performance hazard against a VS Code tree, on the same poll
  // thread that guards the DLP scan. Attempt 2's bottom-right heuristic is
  // meaningless in an IDE (status bar / terminal, not a send button).
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('static void UpdateSendRect()'), src.indexOf('static void UpdateUia()'));
  assert.ok(fn.length > 0, 'expected an UpdateSendRect body');
  // A HOST APP is skipped too: attempt 2's "the bottom-right corner is the send
  // button" heuristic is just as wrong in Teams, where which composer that
  // corner belongs to depends on which conversation is open — so a cached rect
  // would swallow an ordinary click in an ordinary chat.
  const skip = fn.indexOf('if (_ideProcs.Contains(_app) || _hostAppProcs.Contains(_app)) { _hasRect = false; return; }');
  const search = fn.indexOf('win.FindAll(TreeScope.Descendants');
  assert.ok(skip >= 0, 'expected an IDE + host-app skip in UpdateSendRect');
  assert.ok(search >= 0, 'expected the UIA descendant search to still exist for chat apps');
  assert.ok(skip < search, 'the skip must come BEFORE the expensive search');
});

test('enforcer-win.ps1: a panel-keyed platform block matches the focused panel and honours enforce', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // Parsed off each row alongside process_name.
  assert.match(src, /d\["panel"\] = ExtractJsonString\(item, "panel"\);/);
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  // Third branch, same loop iteration → first-match-wins ordering preserved.
  assert.match(check, /if \(_fgIsPanel && !string\.IsNullOrEmpty\(agent\["panel"\]\)\)/);
  assert.match(check, /string\.Equals\(agent\["panel"\], _fgPanelId, StringComparison\.OrdinalIgnoreCase\)/);
  // The enforce gate: a detection-only panel never blocks, even with a matching
  // row present.
  assert.match(check, /if \(_fgPanelEnforce\) \{/);
});

// ── The IDE-panel platform-block race ───────────────────────────────────────
// Reproduced live: a platform block on claude.ai swallowed Enter in the Claude
// Code composer twice and then let the third message through. VS Code stayed in
// the foreground the whole time — what flickered was the FOCUSED ELEMENT read
// that _fgIsPanel/_fgIsAi are derived from for a panel. Once the miss outlasted
// FG_STICKY_TTL, UpdateForeground tore down _fgIsAi/_fgIsPanel, CheckFgBlocked's
// `if (!_fgIsAi) ClearFgBlocked()` dropped the block, and HookCallback's
// `if (_fgIsAi)` gate meant the Enter decision was never even evaluated.
//
// A chat app cannot hit this: there _fgIsAi comes from "is this PROCESS the
// foreground window", which does not flicker.

test('enforcer-win.ps1: a platform block established in an IDE panel is latched, not dropped on one bad UIA read', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static volatile bool _panelBlockLatch = false;/);
  assert.match(src, /static volatile uint _panelBlockPid = 0;/);
  assert.match(src, /static readonly long PANEL_BLOCK_LATCH_TTL = TimeSpan\.FromSeconds\(\d+\)\.Ticks;/);

  // Armed ONLY by the panel branch of CheckFgBlocked — the two process-keyed
  // branches must not arm it, because a foreground PROCESS cannot flicker and
  // latching one would keep a whole chat app blocked after the user left it.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  assert.ok(check.length > 0, 'expected a CheckFgBlocked body');
  // TWO arming sites now, both ELEMENT-scoped: the panel branch and the
  // agent-scoped narrowing of the PLATFORM_PROCS branch. Each passes a
  // NAMESPACED key ("panel:<id>" / "agent:<id>"), which is what keeps a panel id
  // and an agent-surface id from ever being confused for one another.
  const armKinds = (check.match(/ArmPanelBlockLatch\("(panel|agent):/g) || [])
    .map((m) => m.slice('ArmPanelBlockLatch("'.length, -1));
  assert.deepEqual(armKinds, ['agent', 'panel'], 'exactly two arming sites, one per element-scoped branch');
  assert.equal((check.match(/ArmPanelBlockLatch\(/g) || []).length, 2, 'no unkeyed arming site may exist');
  const panelBranchIdx = check.indexOf('if (_fgIsPanel && !string.IsNullOrEmpty(agent["panel"]))');
  const panelArmIdx = check.indexOf('ArmPanelBlockLatch("panel:');
  assert.ok(panelBranchIdx >= 0 && panelBranchIdx < panelArmIdx, 'the latch must be armed inside the panel branch');
  // The agent arm sits behind BOTH the verified+enforcing surface check and a
  // Named read, so no unverified surface and no failed read can arm it.
  const agentArmIdx = check.indexOf('ArmPanelBlockLatch("agent:');
  const surfaceIdx = check.indexOf('AgentSurface surface = EnforcingAgentSurface(_app);');
  assert.ok(surfaceIdx >= 0 && surfaceIdx < agentArmIdx, 'the agent arm must sit behind EnforcingAgentSurface');
  assert.match(check, /if \(_fgAgentOutcome == AgentReadOutcome\.Named\r?\n\s*&& AgentNameMatches\(_fgAgentName, agent\["agent_name"\]\)\)/);
  // …and both arm only on a tick whose focused-element read really succeeded,
  // reusing the existing sticky signal rather than inventing a second counter.
  // Arming inside the sticky window would stack the two grace periods.
  assert.equal((check.match(/if \(_fgLeftAiTicks == 0\) ArmPanelBlockLatch\(/g) || []).length, 2);

  // The block decision consults the latch instead of being torn down.
  assert.match(src, /if \(_fgIsAi \|\| PanelBlockLatchHeld\(\)\)/);
  assert.match(check, /if \(PanelBlockLatchHeld\(\)\) return;/);
});

test('enforcer-win.ps1: the original race pattern — an immediate, unconditional ClearFgBlocked — is gone', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // The exact pre-fix line. It cleared the platform block the instant _fgIsAi
  // read false for one tick, with no grace-period check of any kind.
  assert.equal(
    /if \(!_fgIsAi \|\| _blockedList\.Count == 0\) \{ ClearFgBlocked\(\); return; \}/.test(src),
    false,
    'the unconditional early-exit clear regressed',
  );
  // …and the pre-fix hook gate, which skipped the Enter decision outright.
  assert.equal(
    /\n\s*if \(_fgIsAi\)\r?\n\s*\{\r?\n\s*\/\/ Reset the typed buffer/.test(src),
    false,
    'the hook gate regressed to the bare sticky flag',
  );
  // Every clear inside CheckFgBlocked is now behind a latch check.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  const clears = (check.match(/ClearFgBlocked\(\);/g) || []).length;
  assert.equal(clears, 3, 'expected exactly three clear sites: empty list, !_fgIsAi, no-row-matched');
  for (const seg of check.split('ClearFgBlocked();').slice(0, clears)) {
    assert.match(
      seg,
      /PanelBlockLatchHeld\(\)|_blockedList\.Count == 0/,
      `a ClearFgBlocked() site has no grace-period guard: ...${seg.slice(-160)}`,
    );
  }
});

test('enforcer-win.ps1: the platform-block latch is bounded, pid-scoped, and yields to an authoritative non-panel read', async () => {
  // Fail-closed must not become fail-stuck: this is the file that installs a
  // system-wide keyboard hook, and a latch with no way out would leave Enter
  // dead in the user's code editor.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const held = src.slice(src.indexOf('static bool PanelBlockLatchHeld()'), src.indexOf('static void CheckFgBlocked()'));
  assert.ok(held.length > 0, 'expected a PanelBlockLatchHeld body');
  assert.match(held, /if \(\(DateTime\.UtcNow\.Ticks - armed\) > PANEL_BLOCK_LATCH_TTL\) return false;/);
  assert.match(held, /if \(_fgPid != _panelBlockPid\) return false;/);
  // The hook thread calls this, so it must not write poll-thread state.
  assert.equal(/ClearPanelBlockLatch\(\)|_panelBlockLatch = |_panelBlockLatchTicks = /.test(held), false,
    'PanelBlockLatchHeld must stay side-effect free — the hook thread calls it');

  // An admin un-blocking drops it at once rather than letting it outlive its row.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  assert.match(check, /if \(_blockedList\.Count == 0\) \{ ClearPanelBlockLatch\(\); ClearFgBlocked\(\); return; \}/);

  // A read that SUCCEEDED and did not match is authoritative — the caret really
  // is in the editor — so UpdateForeground retires the latch there, keeping
  // "genuinely left the panel" behaving exactly as it did before the fix. It is
  // authoritative only when the user could actually have moved the caret, which
  // is the cursor_composer fix; see the FocusCouldHaveMoved test below.
  const fg = src.slice(src.indexOf('static void UpdateForeground()'), src.indexOf('static void UpdateSendRect()'));
  assert.ok(fg.length > 0, 'expected an UpdateForeground body');
  // The IDE read keeps `allowChildProcess: false` — VS Code and Cursor were
  // verified live with the exact-pid rule, and widening a code editor's read is
  // a separate decision with its own false-positive surface.
  assert.match(fg, /if \(isIde\) hit = ReadFocusedPanel\(proc, pid, out panelRid, out panelReadable, false\);/);
  assert.match(fg, /else if \(panelReadable\)\r?\n\s*\{[\s\S]{0,2600}?if \(FocusCouldHaveMoved\(\)\) ClearPanelBlockLatch\(\);/);
  // …and a real app switch drops it on the very next poll tick.
  assert.match(fg, /if \(_panelBlockLatch && pid != _panelBlockPid\) ClearPanelBlockLatch\(\);/);

  // "readable" mirrors MatchPanelSignature's own preconditions, so a read that
  // could not have matched anything is never mistaken for a fact.
  const read = src.slice(src.indexOf('static PanelSig ReadFocusedPanel('), src.indexOf('static bool PanelEnforceOk()'));
  assert.match(read, /readable = ctName\.Trim\(\)\.Length > 0 && \(name\.Trim\(\)\.Length > 0 \|\| cls\.Trim\(\)\.Length > 0\);/);
  assert.match(read, /readable = false;/);
});

test('enforcer-win.ps1: a focused element from another process is a read FAILURE, not evidence', async () => {
  // AutomationElement.FocusedElement is a GLOBAL read and is NOT scoped to the
  // foreground window. Measured 2026-08-25 with a read-only UIA probe: with a
  // plain console window in the foreground it returned a terminal element
  // belonging to a background VS Code window in a different process, while
  // three elements in three different windows all reported HasKeyboardFocus.
  //
  // Both directions of trusting that are bugs: a MATCH on a background window's
  // composer reports a panel as focused while the user types in the foreground
  // window's code editor, and a readable NON-match on a background window's
  // terminal is what retires the platform-block latch. Neither is evidence about
  // the foreground, so an unattributable element must land in the "no evidence"
  // state (readable stays false, no panel).
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const read = src.slice(src.indexOf('static PanelSig ReadFocusedPanel('), src.indexOf('static bool PanelEnforceOk()'));
  assert.match(read, /static PanelSig ReadFocusedPanel\(string proc, uint fgPid, out string runtimeIdKey, out bool readable, bool allowChildProcess\)/);
  // The DEFAULT stays exact-pid. `allowChildProcess` widens it to one
  // generation, and it is passed `true` from exactly one place — the host-app
  // read, whose composer really does live in a child WebView2 process (measured
  // via Win32_Process ParentProcessId on ms-teams.exe). Every IDE call site
  // passes `false`.
  assert.match(read, /if \(allowChildProcess\) \{ if \(!ElementPidBelongsToForeground\(el\.Current\.ProcessId, fgPid\)\) return null; \}/);
  assert.match(read, /else if \(el\.Current\.ProcessId != \(int\)fgPid\) return null;/);
  const code = codeOnly(src);
  assert.equal((code.match(/ReadFocusedPanel\(proc, pid, out panelRid, out panelReadable, true\)/g) || []).length, 1,
    'exactly one call site may widen the panel read to a child process');
  // The ownership check must come BEFORE any property is trusted, or a
  // background window's element could still set `readable`.
  const ownIdx = read.indexOf('el.Current.ProcessId');
  const readableIdx = read.indexOf('readable = ctName.Trim().Length > 0');
  assert.ok(ownIdx >= 0 && ownIdx < readableIdx, 'the ownership check must precede the readable computation');
});

test('enforcer-win.ps1: a neighbouring panel in the same window cannot tear down another panel\'s platform block', async () => {
  // The live bug: one VS Code window hosts several AI composers at once (two
  // Claude Code composers AND a Copilot Chat input, measured), and a single
  // poll tick's global focused-element read can land on any of them. When it
  // landed on the detection-only `vscode_chat` composer, the old code cleared
  // _fgIsBlocked and the latch on that one tick with NO grace period at all —
  // a different panel is still an AI surface, so it RESET the sticky timer to
  // 0, which the fall-through then read as "authoritative". Behavioural
  // reproduction and proof: tests/enforcer-panel-block.test.mjs.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  assert.ok(check.length > 0, 'expected a CheckFgBlocked body');
  // Compared against LatchedPanelId(), not the raw key: the key is namespaced
  // now, so a bare compare would never match and the fall-through would silently
  // stop being scoped by panel.
  assert.match(check, /bool sameSurface = !_fgIsPanel\r?\n\s*\|\| string\.Equals\(_fgPanelId \?\? "", LatchedPanelId\(\), StringComparison\.OrdinalIgnoreCase\);/);
  assert.match(check, /if \(!sameSurface && PanelBlockLatchHeld\(\)\) return;/);
  // The latch records WHICH panel it was armed for, and gives it up on release.
  assert.match(src, /static volatile string _elementBlockKey = "";/);
  const arm = src.slice(src.indexOf('static void ArmPanelBlockLatch(string key)'), src.indexOf('static bool PanelBlockLatchHeld()'));
  assert.ok(arm.length > 0, 'expected an ArmPanelBlockLatch body');
  assert.match(arm, /_elementBlockKey = key \?\? "";/);
  assert.match(arm, /_elementBlockKey = "";/, 'ClearPanelBlockLatch must drop the latch key too');
  // The two namespaces are read back through their own accessors, so neither can
  // be mistaken for the other.
  assert.match(arm, /k\.StartsWith\("panel:", StringComparison\.Ordinal\) \? k\.Substring\(6\) : ""/);
  assert.match(arm, /return k\.StartsWith\("agent:", StringComparison\.Ordinal\);/);
  // A same-surface miss stays authoritative, so an admin un-blocking is still
  // immediate rather than waiting out the 10s latch TTL.
  const sameIdx = check.indexOf('bool sameSurface');
  const clearIdx = check.indexOf('ClearPanelBlockLatch();\n        ClearFgBlocked();'.replace('\n', '\r\n'));
  assert.ok(sameIdx >= 0);
  assert.ok(clearIdx < 0 || sameIdx < clearIdx);
});

test('enforcer-win.ps1: a "you left the panel" read with no user input behind it is a bad read, not a fact', async () => {
  // The cursor_composer leak. The neighbouring-PANEL fix above scopes the
  // fall-through by panel id, which only helps when the read that stole the tick
  // MATCHED a panel. Cursor's window has no second AI panel at all — the element
  // beside `aislash-editor-input` is Cursor's own Monaco input
  // ("inputarea monaco-mouse-cursor-text"), which matches nothing — so a stolen
  // tick arrived as a readable NON-match and retired the latch outright in
  // ApplyForegroundTick, before CheckFgBlocked ever ran. 3s later the sticky
  // window lapsed and the blocked Enter went through, mid-way through a 4.5s
  // wait in which the user touched nothing.
  //
  // Behavioural reproduction and proof: tests/enforcer-panel-block.test.mjs.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static long _lastFocusMoveInputTicks = 0;/);
  assert.match(src, /static readonly long PANEL_LEAVE_INPUT_WINDOW = TimeSpan\.FromMilliseconds\(\d+\)\.Ticks;/);

  // Pure, and bounded by a recency window — a click from a minute ago is not
  // evidence about this tick's read.
  const moved = src.slice(src.indexOf('static bool FocusCouldHaveMoved()'), src.indexOf('static bool PanelBlockLatchHeld()'));
  assert.ok(moved.length > 0, 'expected a FocusCouldHaveMoved body');
  assert.match(moved, /if \(t == 0\) return false;/);
  assert.match(moved, /return \(DateTime\.UtcNow\.Ticks - t\) < PANEL_LEAVE_INPUT_WINDOW;/);
  assert.equal(/_lastFocusMoveInputTicks = /.test(moved), false, 'FocusCouldHaveMoved must not write the field it reads');

  // Consulted in exactly ONE place: whether to retire an armed panel platform
  // block. It must never widen capture or a content block.
  const codeOnly = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal((codeOnly.match(/FocusCouldHaveMoved\(\)/g) || []).length, 2, 'one definition, one call site');
  for (const [name, from, to] of [
    ['FgIsAiNow', 'static bool FgIsAiNow()', 'static bool TypedBlockFresh()'],
    ['EnterBlockActive', 'static bool EnterBlockActive(', 'static string ActivePatterns()'],
    ['BlockActiveForMouse', 'static bool BlockActiveForMouse()', '// The Enter-decision predicate'],
    ['PanelUiaOk', 'static bool PanelUiaOk()', '// ── Model routing'],
    ['CheckFgBlocked', 'static void CheckFgBlocked()', 'static void ClearFgBlocked()'],
  ]) {
    const fn = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(fn.length > 0, `expected a ${name} body`);
    assert.equal(/FocusCouldHaveMoved|_lastFocusMoveInputTicks/.test(fn), false, `${name} must not consult focus-move input`);
  }

  // The hooks record a TIMESTAMP only — never which key, which button, or where
  // — and never treat our own synthetic input (Tier B's Ctrl+A) as the user
  // navigating away.
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  assert.match(hook, /if \(ctrl \|\| alt \|\| vk == VK_TAB \|\| vk == VK_ESCAPE \|\| \(vk >= VK_F1 && vk <= VK_F24\)\)/);
  assert.match(hook, /if \(\(fmFlags & LLKHF_INJECTED\) == 0\) _lastFocusMoveInputTicks = DateTime\.UtcNow\.Ticks;/);
  const mouse = src.slice(src.indexOf('static IntPtr MouseCallback('), src.indexOf('static IntPtr HookCallback('));
  assert.match(mouse, /if \(\(fmFlags & LLMHF_INJECTED\) == 0\) _lastFocusMoveInputTicks = DateTime\.UtcNow\.Ticks;/);
  // A plain character key cannot move focus out of a text box, and must not be
  // recorded — that would make ordinary typing in the composer look like leaving it.
  assert.equal(/vk == VK_A \|\| .*_lastFocusMoveInputTicks/.test(hook), false);
});

test('enforcer-win.ps1: a className rule matches a class TOKEN, so a second class cannot hide a composer', async () => {
  // cursor_composer is the one signature with a single signal: an EXACT
  // ClassName, an empty Name, no prefix rule. A web-hosted element's UIA
  // ClassName is the DOM class ATTRIBUTE — Cursor's own Monaco input reports
  // "inputarea monaco-mouse-cursor-text", two classes in one string — so a
  // whole-string compare stopped matching a genuinely focused composer the
  // moment Cursor put a second class on it, and a readable NON-match is what
  // tears an IDE-panel platform block down.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const rule = src.slice(src.indexOf('static bool ClassRuleMatches('), src.indexOf('// Port of ai-processes.js'));
  assert.ok(rule.length > 0, 'expected a ClassRuleMatches body');
  // Still plain string comparison on the poll thread — no Regex, which would
  // need REGEX_TIMEOUT for a reason that must not be reintroduced here.
  assert.equal(/Regex|IsMatch/.test(rule), false, 'panel matching must stay Regex-free');
  // Not a substring test: "xx-messageInput_abc" must not satisfy "messageInput_".
  assert.match(rule, /StartsWith\(want, StringComparison\.OrdinalIgnoreCase\)/);
  assert.equal(/IndexOf\(want/.test(rule), false, 'a substring test would match unrelated controls');

  const match = src.slice(src.indexOf('static PanelSig MatchPanelSignature('), src.indexOf('// ONE property read'));
  assert.match(match, /ClassRuleMatches\(cls, p\.ClassEquals, false\)/);
  assert.match(match, /ClassRuleMatches\(cls, p\.ClassPrefix, true\)/);
  // The Name rules stay whole-string: a Name is prose, not a token list.
  assert.match(match, /string\.Equals\(nm, p\.NameEquals, StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(match, /nm\.StartsWith\(p\.NamePrefix, StringComparison\.OrdinalIgnoreCase\)/);

  // And the JS side, which is the single source of truth for the signatures,
  // must implement the same rule — matchPanelSignature and this C# port are
  // asserted to agree case by case in ai-panels.test.mjs.
  const js = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'ai-processes.js'), 'utf8');
  assert.match(js, /function classRuleMatches\(cls, want, prefix\)/);
  assert.match(js, /classRuleMatches\(cls, panel\.classEquals\.toLowerCase\(\), false\)/);
  assert.match(js, /classRuleMatches\(cls, panel\.classPrefix\.toLowerCase\(\), true\)/);
});

test('enforcer-win.ps1: a detection-only panel can never CANCEL another panel\'s platform block', async () => {
  // PanelEnforceOk() answers a question about the element THIS tick's read
  // landed on. ANDing it over the whole Enter decision meant one read landing
  // on the detection-only Copilot Chat composer in the same window let the
  // blocked Enter through. "Detection-only" must mean "never causes a block",
  // not "cancels other panels' blocks".
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static volatile bool _blockedByElement = false;/);
  const enterPred = src.slice(src.indexOf('static bool EnterBlockActive('), src.indexOf('static string ActivePatterns()'));
  assert.match(enterPred, /if \(_fgIsBlocked && \(_blockedByElement \|\| PanelEnforceOk\(\)\)\) return true;/);
  // …but every CONTENT signal is still gated on the current surface.
  assert.match(enterPred, /if \(!PanelEnforceOk\(\)\) return false;\r?\n\s*return attachHold \|\| TypedBlockFresh\(\)/);

  // Only the panel branch may set _blockedByElement, and it still sits behind
  // _fgPanelEnforce — so a detection-only panel cannot arm a block either way.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  const panelBranchIdx = check.indexOf('if (_fgPanelEnforce) {');
  const panelArmIdx = check.lastIndexOf('_blockedByElement = true;');
  assert.ok(panelBranchIdx >= 0 && panelArmIdx > panelBranchIdx, '_blockedByElement must be set inside the _fgPanelEnforce branch');
  // TWO places set it now, one per element-scoped branch — the panel branch
  // (gated on _fgPanelEnforce) and the agent-scoped narrowing (gated on a
  // verified AND enforcing AGENT_SURFACES entry). Both gates encode the same
  // rule: an unverified surface can never arm a block.
  assert.equal((check.match(/_blockedByElement = true;/g) || []).length, 2, 'exactly one arm per element-scoped branch');
  assert.equal((check.match(/_blockedByElement = false;/g) || []).length, 2, 'both process-keyed branches must clear it');
  // Cleared with the block itself, so it can never outlive it.
  const clear = src.slice(src.indexOf('static void ClearFgBlocked()'), src.indexOf('static string ExtractJsonString('));
  assert.match(clear, /_blockedByElement = false;/);

  // Attribution: a platform block reports the panel it was ARMED for, so
  // Request Access asks for an exception on the right host.
  assert.match(src, /static string PlatformBlockPanelField\(\)/);
  assert.match(src, /\(platformBlock \? PlatformBlockPanelField\(\) : PanelField\(\)\)/);
  const attr = src.slice(src.indexOf('static string PlatformBlockPanelField()'), src.indexOf('static void Emit(string kind'));
  // Via LatchedPanelId(), so an AGENT-scoped block carries no panel field at
  // all: index.js resolves a tool_host from it, and an agent-surface id is not a
  // panel id.
  assert.match(attr, /if \(_blockedByElement\)/);
  assert.match(attr, /string panelId = LatchedPanelId\(\);/);
  assert.equal(/Esc\(_elementBlockKey\)/.test(attr), false, 'the raw namespaced key must never be emitted');
});

test('enforcer-win.ps1: the platform-block latch does NOT widen capture or content blocks', async () => {
  // The invariant that must not regress while fixing the block side: keystroke
  // capture and every UIA/clipboard-derived block still fail OPEN on the FIRST
  // bad read. Only the already-established platform block is latched.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // Unchanged, character for character — same assertion as the capture test above.
  assert.match(src, /static bool FgIsAiNow\(\) \{ return _fgIsAi && _fgLeftAiTicks == 0 && PanelEnforceOk\(\); \}/);
  assert.match(src, /return _fgIsPanel && _fgPanelEnforce && _fgLeftAiTicks == 0;/);
  for (const [name, from, to] of [
    ['FgIsAiNow', 'static bool FgIsAiNow()', 'static bool TypedBlockFresh()'],
    ['PanelEnforceOk', 'static bool PanelEnforceOk()', 'static bool PanelUiaOk()'],
    ['PanelUiaOk', 'static bool PanelUiaOk()', '// ── Model routing'],
  ]) {
    const fn = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(fn.length > 0, `expected a ${name} body`);
    assert.equal(/PanelBlockLatch/.test(fn), false, `${name} must not consult the latch`);
  }
  // PanelEnforceOk's `!_fgIsPanel → true` branch is PERMISSIVE — it lets a block
  // proceed — so it was never a bypass and must not be "hardened" into
  // returning false, which would silently remove blocking for pure chat apps
  // and for the IDE whole-app fallback.
  const enforce = src.slice(src.indexOf('static bool PanelEnforceOk()'), src.indexOf('static bool PanelUiaOk()'));
  assert.match(enforce, /if \(!_fgIsPanel\) return true;/);
  // Capture and clipboard/UIA gates keep asking _fgIsAi / FgIsAiNow, not the latch.
  assert.match(src, /if \(!_fgIsAi \|\| !PanelUiaOk\(\)\) \{ _blockUia = false; _uiaPatterns = ""; return; \}/);
  assert.match(src, /if \(!_fgIsAi\) \{ _blockPaste = false; return; \}/);
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  // Comment lines stripped — the count is about real call sites, and the gate
  // carries a long explanatory comment that names the function.
  const hookCode = hook.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal((hookCode.match(/PanelBlockLatchHeld\(\)/g) || []).length, 1, 'the hook may consult the latch in exactly one place');
  assert.match(hookCode, /if \(_fgIsAi \|\| PanelBlockLatchHeld\(\)\)/);
});

test('enforcer-win.ps1: the enforce gate is applied on BOTH the capture and the blocking side', async () => {
  // A detection-only panel must have genuinely zero live effect — not "no
  // effect in one of the two places".
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  assert.match(src, /static bool PanelEnforceOk\(\)/);
  const fn = src.slice(src.indexOf('static bool PanelEnforceOk()'), src.indexOf('static bool PanelUiaOk()'));
  assert.match(fn, /if \(!_fgIsPanel\) return true;/);
  assert.match(fn, /return _fgPanelEnforce;/);
  // Capture side (via FgIsAiNow), Enter side, mouse side, UIA side. On both
  // block-decision sides the gate now covers every CONTENT signal, with a
  // platform block armed by an enforcing panel checked ahead of it — see
  // _blockedByElement and the "can never CANCEL" test below.
  assert.match(src, /static bool FgIsAiNow\(\) \{ return _fgIsAi && _fgLeftAiTicks == 0 && PanelEnforceOk\(\); \}/);
  const enterPred = src.slice(src.indexOf('static bool EnterBlockActive('), src.indexOf('static string ActivePatterns()'));
  assert.match(enterPred, /if \(!PanelEnforceOk\(\)\) return false;/);
  const forMouse = src.slice(src.indexOf('static bool BlockActiveForMouse()'), src.indexOf('// The Enter-decision predicate'));
  assert.match(forMouse, /if \(!PanelEnforceOk\(\)\) return false;/);
  assert.match(src, /return _fgIsPanel && _fgPanelEnforce && _fgLeftAiTicks == 0;/);
});

test('enforcer-win.ps1: panel detection is a single focused-element read, never a tree walk', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const fn = src.slice(src.indexOf('static PanelSig ReadFocusedPanel('), src.indexOf('static bool PanelEnforceOk()'));
  assert.ok(fn.length > 0, 'expected a ReadFocusedPanel body');
  assert.match(fn, /AutomationElement\.FocusedElement/);
  // No FindAll / TreeWalker / descendant enumeration on this path.
  assert.equal(/FindAll|TreeWalker|GetFirstChild/.test(fn), false, 'panel detection must not walk the tree');
  // Every property read is individually try/caught — reading another process's
  // accessibility tree throws routinely.
  assert.match(fn, /try \{ name = el\.Current\.Name \?\? ""; \} catch \{ \}/);
  assert.match(fn, /try \{ cls = el\.Current\.ClassName \?\? ""; \} catch \{ \}/);
  // ProgrammaticName, not LocalizedControlType — culture-independent.
  assert.match(fn, /ProgrammaticName/);
});

test('enforcer-win.ps1: panel matching adds no Regex, and every Regex still carries the timeout', async () => {
  // Signatures are fixed literals, so the C# port is plain string comparison.
  // (The blanket "every Regex has REGEX_TIMEOUT" check lives above; this pins
  // that the panel code did not introduce one at all.)
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  const panelSection = src.slice(src.indexOf('static string StripExe('), src.indexOf('// ── Model routing'));
  assert.ok(panelSection.length > 0);
  assert.equal(/new Regex\(|Regex\.(IsMatch|Match|Replace)/.test(panelSection), false, 'no regex in the panel path');
  // …and the global invariant still holds, panel code included.
  for (const c of src.match(/new Regex\([^)]*\)/g) || []) {
    assert.match(c, /REGEX_TIMEOUT/, `Regex built without a timeout: ${c}`);
  }
});

test('enforcer-win.ps1: no window title or element text is ever emitted for a panel', async () => {
  // VS Code's window title carries the open file path and the workspace name;
  // an element Name/ClassName in an IDE can too. Panel detection reads them and
  // must never let them out.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // The only panel value that reaches stdout is the catalog id.
  assert.match(src, /static string PanelField\(\)/);
  const emitField = src.slice(src.indexOf('static string PanelField()'), src.indexOf('static void Emit(string kind'));
  assert.match(emitField, /",\\"panel\\":\\"" \+ Esc\(_fgPanelId\) \+ "\\""/);
  // …and the read-only locals of ReadFocusedPanel never reach an emitter.
  const fn = src.slice(src.indexOf('static PanelSig ReadFocusedPanel('), src.indexOf('static bool PanelEnforceOk()'));
  assert.equal(/Emit\(|EmitBlock\(|Console\.Out/.test(fn), false, 'panel detection must emit nothing');
});

test('enforcer-win.ps1: the ONLY window-title read is the gated agent read, and the title never leaves it', async () => {
  // NARROWED, deliberately. This used to assert that NO window title could be
  // read anywhere in the file at all. Microsoft Teams broke that premise: its
  // composer's UIA Name is the literal "Type a message" in every conversation,
  // so the title is the only thing that can say WHICH conversation is open, and
  // without it agent-scoped enforcement in Teams is impossible.
  //
  // A Teams title carries a colleague's display name, the tenant and the
  // signed-in user's email address. So the rule is no longer "never read one" —
  // it is "read one in exactly one gated place, compare it against the
  // blocklist, and never let it out". That is what this asserts, and it is a
  // stronger statement than the old blanket ban would have been if it had simply
  // been deleted.
  const src = await enforcerSrc();
  const code = codeOnly(src);

  // 1. EXACTLY ONE read site, and it is inside ReadFocusedAgentName.
  const read = src.slice(src.indexOf('static AgentReadOutcome ReadFocusedAgentName('), src.indexOf('static readonly char[] CLASS_TOKEN_SEP'));
  assert.ok(read.length > 0, 'expected a ReadFocusedAgentName body');
  assert.equal((code.match(/GetWindowText\(/g) || []).length, 2, 'exactly one GetWindowText call site (plus its DllImport)');
  assert.equal((code.match(/GetWindowTextLength\(/g) || []).length, 2, 'exactly one GetWindowTextLength call site (plus its DllImport)');
  assert.ok(read.includes('GetWindowText(fgHwnd, sb, cap)'), 'the only title read must be the agent read');
  assert.ok(read.includes('GetWindowTextLength(fgHwnd)'));
  // Nothing reads a title through the OTHER routes either — Process.MainWindowTitle
  // would bypass every gate here.
  assert.equal(/MainWindowTitle|WindowTitle\b/.test(code), false, 'no other window-title route may exist');

  // 2. It is behind the read-mode branch, so a composer-name surface (every
  //    pre-Teams entry, m365_copilot included) never reaches it at all.
  const titleIdx = read.indexOf('if (string.Equals(surface.ReadFrom, "window_title", StringComparison.OrdinalIgnoreCase))');
  assert.ok(titleIdx >= 0 && titleIdx < read.indexOf('GetWindowTextLength(fgHwnd)'),
    'the title read must sit inside the window_title branch');
  // …and it reuses the foreground HWND the tick already has: no second
  // GetForegroundWindow(), so it can never read a different window than the one
  // every other decision on this tick was made about.
  // `panelId` was added 2026-09-04 and is DATA, not a gate: the Copilot-tab
  // heading cache needs it as part of its pane key, because both Teams routes
  // can now present the same title kind in the same window. See _copilotCachePane.
  assert.match(read, /static AgentReadOutcome ReadFocusedAgentName\(AgentSurface surface, uint fgPid, IntPtr fgHwnd, string panelId, out string agentName\)/);
  assert.equal(/GetForegroundWindow\(\)/.test(read), false, 'the title read must reuse the tick\'s HWND');

  // 3. THE PII RULE: the title never reaches an emitter. Not the raw title, not
  //    the parsed conversation name. Every name that reaches stdout comes from
  //    the blocked ROW (admin-typed), never from a read.
  assert.equal(/Emit\(|EmitBlock\(|EmitBlockState\(|Console\.Out/.test(read), false,
    'the title read must emit nothing');
  // The parsed name leaves the reader only through `out agentName`, which flows
  // into _fgAgentName — already pinned at exactly three code references, none of
  // them an emitter, by its own test below.
  for (const [name, from, to] of [
    ['Emit', 'static void Emit(string kind', 'static string Esc(string s)'],
    ['EmitBlock', 'static void EmitBlock(', 'static void EmitRewrite('],
    ['EmitBlockState', 'static void EmitBlockState(', 'static void ClearFgBlocked()'],
    ['EmitRoute', 'static void EmitRoute(', 'static readonly object _routeLock'],
  ]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(body.length > 0, `expected a ${name} body`);
    for (const forbidden of ['GetWindowText', 'title', 'Title']) {
      assert.equal(body.includes(forbidden), false, `${name} must not carry a window title (${forbidden})`);
    }
  }
  // 4. The parse itself is bounded and allocates a bounded buffer, so another
  //    process's window title can never make this expensive.
  assert.match(src, /const int WINDOW_TITLE_MAX = 1024;/);
  assert.match(src, /const int TITLE_PARSE_MAX = 512;/);
  assert.match(read, /if \(cap > WINDOW_TITLE_MAX\) cap = WINDOW_TITLE_MAX;/);
  // 5. An empty or failed read is Unreadable — NO EVIDENCE — never the
  //    authoritative "no agent is open". Same distinction the composer read
  //    draws, and the one the latch keys on.
  const titleBlock = read.slice(titleIdx, read.indexOf('AutomationElement el;'));
  assert.equal((titleBlock.match(/return AgentReadOutcome\.Unreadable;/g) || []).length, 5,
    'every failure path in the title read must be Unreadable');
  assert.equal(/AgentReadOutcome\.(Generic|NotComposer|Named)/.test(titleBlock), false,
    'the read site must not decide an outcome the pure parser owns');
});

test('enforcer.js passes the IDE process and panel payloads, built from the catalog', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /CFAI_IDE_PROCESSES:\s*JSON\.stringify\(buildIdeProcessConfig\(\)\)/);
  assert.match(src, /CFAI_AI_PANELS:\s*JSON\.stringify\(buildAiPanelConfig\(\)\)/);
  // Third payload: the agent-surface catalog, for agent_scope:'agent' rows.
  assert.match(src, /CFAI_AGENT_SURFACES:\s*JSON\.stringify\(buildAgentSurfaceConfig\(\)\)/);
  assert.match(src, /import \{ buildIdeProcessConfig, buildAiPanelConfig, buildAgentSurfaceConfig \} from '\.\/ai-processes\.js';/);
  // The IDE names must NOT have been folded into CFAI_AI_PROCESSES, which is
  // what the clipboard/attachment/file-dialog watchers key on.
  assert.match(src, /CFAI_AI_PROCESSES: this\.aiProcessNames\.join\(','\)/);
});

test('IDE_PROCESSES never reaches aiProcNames or any passive watcher', async () => {
  // The core privacy-scoping guarantee of keeping the two catalogs separate: an
  // IDE process name in aiProcNames would silently turn on clipboard scanning
  // and attachment-chip watching across the whole editor, reporting every file
  // opened while coding as an AI file upload.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.equal(/IDE_PROCESSES/.test(src), false, 'index.js must not import the IDE catalog at all');
  // The derivation moved into ai-processes.js as watcherProcessNames(), because
  // it now carries a RULE (exclude `hostApp: true` entries — Microsoft Teams)
  // that must not be re-implemented, or forgotten, at a call site. index.js must
  // not go back to mapping the raw catalog.
  assert.match(src, /const aiProcNames = watcherProcessNames\(\);/);
  assert.equal(/AI_PROCESSES\s*\.?\s*map\(/.test(src), false,
    'index.js must not derive the watcher list from the raw catalog — a host app would leak in');
  const { watcherProcessNames, AI_PROCESSES } = await import('../src/os_monitor/ai-processes.js');
  const names = watcherProcessNames().map((n) => n.toLowerCase());
  for (const entry of AI_PROCESSES) {
    if (entry.hostApp !== true) continue;
    const literal = entry.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '').toLowerCase();
    assert.equal(names.includes(literal), false, `${literal} is a host app and must never reach a passive watcher`);
  }
  // aiProcNames is derived from AI_PROCESSES only, and nothing is concatenated.
  const build = src.slice(src.indexOf('const aiProcNames ='), src.indexOf('this.dialogWatcher ='));
  assert.equal(/IDE|PANEL|concat/.test(build), false, `aiProcNames construction grew a second source: ${build}`);
  for (const watcher of ['FileDialogWatcher', 'AttachmentWatcher', 'PromptWatcher']) {
    const line = src.match(new RegExp(`new ${watcher}\\(\\{[^}]*\\}\\)`));
    assert.ok(line, `expected a ${watcher} construction`);
    assert.match(line[0], /aiProcessNames: aiProcNames/, `${watcher} must only get the AI catalog`);
  }
  // The chip/dialog watchers only ever forward CFAI_AI_PROCESSES.
  for (const file of ['file-dialog-watcher.js', 'attachment-watcher.js']) {
    const w = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    assert.equal(/CFAI_IDE_PROCESSES|CFAI_AI_PANELS|IDE_PROCESSES/.test(w), false, `${file} must know nothing about IDE panels`);
  }
  // prompt-watcher.js is the ONE exception, and only in the restricting
  // direction: it forwards the panel payloads so its .ps1 can refuse to read a
  // code editor. What it still must not do is widen the watched process set —
  // the IDE names may never reach CFAI_AI_PROCESSES.
  const pw = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.js'), 'utf8');
  assert.match(pw, /CFAI_AI_PROCESSES: this\.aiProcessNames\.join\(','\)/);
  assert.equal(
    /aiProcessNames.*(IDE|buildIdeProcessConfig)|(IDE|buildIdeProcessConfig).*aiProcessNames/.test(pw),
    false,
    'the IDE catalog must never be mixed into prompt-watcher.js aiProcessNames',
  );
});

// ── The host-app guard on index.js's OWN handlers ────────────────────────────
//
// watcherProcessNames() (asserted above) covers every watcher that is HANDED a
// process list. Three handlers are not: the clipboard poller emits for whatever
// process is focused, and index.js filters those events itself with
// identifyAiProcess() — which resolves a host app by design, because that
// function is product ATTRIBUTION, not capture permission. Until
// isHostAppProcess() was added at those three sites, "Microsoft Teams is
// focused" was enough to
//   * report the FULL clipboard text of a paste into a private 1:1 DM,
//   * read, extract, scan and upload a file pasted into one, and
//   * write a window title carrying a colleague's name and both parties' email
//     addresses into the agent's own log file
// with no way for any of it to know which conversation was open. There is
// nothing to narrow at these sites, so host apps are excluded outright — the
// same treatment they already get from every other passive path here. The
// narrow, gated read inside an identified governed agent conversation stays
// where it belongs, in enforcer-win.ps1.
//
// NOTHING here spawns anything: enforcerEnabled:false, every subsystem replaced
// with an inert stub before start(), and no network I/O (PolicySync/FeatureSync
// never start, the Reporter is a stub). Same convention as
// os-monitor-redact-audit.test.mjs.

const HOST_APP_PROC = 'ms-teams';
// Verbatim shape from ai-processes.js' teams_desktop entry (measured live): a
// colleague's display name, the tenant, and the signed-in user's email.
const TEAMS_DM_TITLE = 'Sruthi Chimata | CloudFuze, Inc | p@cloudfuze.com | Microsoft Teams';
const SECRET_TEXT = 'my aws key is AKIAIOSFODNN7EXAMPLE and my ssn is 123-45-6789';

function inertWatcher() {
  const stub = new EventEmitter();
  stub.start = () => {};
  stub.stop = () => {};
  return stub;
}

/** A started monitor whose every subsystem is inert, plus its captured output. */
function inertMonitor() {
  const reported = [];
  const logged = [];
  const push = (m) => { logged.push(String(m)); };
  const log = { info: push, warn: push, error: push };
  log.child = () => log;
  const monitor = new OsMonitor({
    serverUrl: '', token: '', log, enforcerEnabled: false,
  });
  monitor.poller = inertWatcher();
  monitor.dialogWatcher = inertWatcher();
  monitor.attachmentWatcher = inertWatcher();
  monitor.promptWatcher = inertWatcher();
  monitor.enforcer = Object.assign(new EventEmitter(), {
    start() {}, stop() {}, attachHold() {}, updateBlockPatterns() {}, tokenize() {},
  });
  monitor.toast = { start() {}, stop() {}, show() {} };
  monitor.reporter = { start() {}, stop() {}, enqueue: (e) => reported.push(e) };
  monitor.policySync.start = () => {};
  monitor.featureSync.start = () => {};
  monitor.start();
  return { monitor, reported, logged };
}

/** The clipboard_files handler is async — wait for it to settle. */
async function settle(pred, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Every catalog process name that is NOT a host app, as a bare literal. */
async function nonHostAppProcs() {
  const { AI_PROCESSES } = await import('../src/os_monitor/ai-processes.js');
  return AI_PROCESSES
    .filter((e) => e.hostApp !== true)
    .map((e) => e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, ''));
}

test('isHostAppProcess answers the capture question identifyAiProcess does not', async () => {
  const { isHostAppProcess, identifyAiProcess, AI_PROCESSES } =
    await import('../src/os_monitor/ai-processes.js');
  // The two questions are separate on purpose. Attribution still resolves Teams
  // — removing it from the catalog is NOT the fix, because a narrowly-gated
  // Teams event still needs a product name.
  assert.deepEqual(identifyAiProcess(HOST_APP_PROC), { product: 'Microsoft Teams', vendor: 'Microsoft' });
  assert.equal(isHostAppProcess(HOST_APP_PROC), true);
  assert.equal(isHostAppProcess('MS-Teams.exe'), true, 'same .exe/case folding as the rest of the catalog');
  // Every host-app entry, so a second one added later is covered without a test edit.
  for (const entry of AI_PROCESSES) {
    if (entry.hostApp !== true) continue;
    const literal = entry.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '');
    assert.equal(isHostAppProcess(literal), true, `${literal} must read as a host app`);
  }
  for (const name of await nonHostAppProcs()) {
    assert.equal(isHostAppProcess(name), false, `${name} is a real AI app — it must not be gated`);
  }
  // "Is this a host app", not "is this an AI app": an unknown process is not one.
  assert.equal(isHostAppProcess('Code'), false);
  assert.equal(isHostAppProcess(''), false);
  assert.equal(isHostAppProcess(null), false);
});

test('a paste into a host app reports nothing — no clipboard text, no window title', () => {
  const h = inertMonitor();
  try {
    h.monitor.poller.emit('clipboard', {
      process: HOST_APP_PROC, title: TEAMS_DM_TITLE, text: SECRET_TEXT,
      len: SECRET_TEXT.length, cause: 'seq_change',
    });
    // Not "an event without content_text" — no event at all, the same as every
    // other passive path a host app is excluded from.
    assert.deepEqual(h.reported, [], 'a paste into an unknown Teams conversation must report nothing');
    const serialized = JSON.stringify(h.reported) + '\n' + h.logged.join('\n');
    for (const forbidden of [SECRET_TEXT, 'AKIAIOSFODNN7EXAMPLE', '123-45-6789', TEAMS_DM_TITLE, 'Sruthi Chimata', 'p@cloudfuze.com']) {
      assert.equal(serialized.includes(forbidden), false, `leaked into a report or a log line: ${forbidden}`);
    }
  } finally { h.monitor.stop(); }
});

test('a file pasted into a host app is never read, scanned or reported', async () => {
  const dir = await tempDir();
  try {
    // A ".bin" is the branch that base64s the whole file for dashboard preview
    // (file-handler.js' last-resort else), so this is the content_base64 path.
    const p = join(dir, 'payroll.bin');
    await writeFile(p, SECRET_TEXT, 'utf8');

    const teams = inertMonitor();
    try {
      teams.monitor.poller.emit('clipboard_files', {
        process: HOST_APP_PROC, title: TEAMS_DM_TITLE, paths: [p],
      });
      // The handler is async; give it longer than it would need to finish.
      await new Promise((r) => setTimeout(r, 250));
      assert.deepEqual(teams.reported, [], 'no file_upload event may be built for a host app');
      const serialized = JSON.stringify(teams.reported) + '\n' + teams.logged.join('\n');
      for (const forbidden of [
        Buffer.from(SECRET_TEXT, 'utf8').toString('base64'),
        'AKIAIOSFODNN7EXAMPLE', TEAMS_DM_TITLE, 'p@cloudfuze.com',
      ]) {
        assert.equal(serialized.includes(forbidden), false, `leaked: ${forbidden}`);
      }
    } finally { teams.monitor.stop(); }

    // Positive control, same file: a real AI app still gets the full event,
    // bytes included. Without this the test above would also pass if the whole
    // path were broken.
    const claude = inertMonitor();
    try {
      claude.monitor.poller.emit('clipboard_files', {
        process: 'Claude', title: 'Claude', paths: [p],
      });
      await settle(() => claude.reported.length > 0);
      const ev = claude.reported.find((e) => e.kind === 'file_upload');
      assert.ok(ev, 'a real AI app must still report a pasted file');
      assert.equal(ev.filename, 'payroll.bin');
      assert.equal(ev.service, 'Claude');
      assert.equal(ev.content_base64, Buffer.from(SECRET_TEXT, 'utf8').toString('base64'));
    } finally { claude.monitor.stop(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the focus log line drops the window title for a host app, and keeps it for AI apps', async () => {
  const h = inertMonitor();
  try {
    h.monitor.poller.emit('focus', { pid: 4242, process: HOST_APP_PROC, title: TEAMS_DM_TITLE });
    const line = h.logged.find((l) => l.includes('AI process focused'));
    assert.ok(line, 'the focus event must still be logged — only the title is withheld');
    // Everything else about the event survives: product and pid.
    assert.match(line, /Microsoft Teams/);
    assert.match(line, /pid=4242/);
    // The title, and each PII field inside it, does not.
    for (const forbidden of [TEAMS_DM_TITLE, 'Sruthi Chimata', 'p@cloudfuze.com', 'CloudFuze, Inc']) {
      assert.equal(line.includes(forbidden), false, `the focus log line still carries ${forbidden}`);
    }
    assert.equal(/title="/.test(line), false, 'no title field at all for a host app');
  } finally { h.monitor.stop(); }

  // Unchanged for every non-host-app entry in the catalog.
  for (const proc of await nonHostAppProcs()) {
    const g = inertMonitor();
    try {
      g.monitor.poller.emit('focus', { pid: 7, process: proc, title: `${proc} — window` });
      const line = g.logged.find((l) => l.includes('AI process focused'));
      assert.ok(line, `${proc} must still log a focus line`);
      assert.match(line, new RegExp(`title="${proc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — window"`),
        `${proc} lost its window title from the focus log line`);
    } finally { g.monitor.stop(); }
  }
});

test('every non-host-app process still gets its paste scanned and reported in full', async () => {
  // The regression net for the guard: it must have changed behaviour for host
  // apps ONLY. One monitor per process so the fire-dedup map cannot mask a miss.
  const { scan } = await import('../src/os_monitor/classifier.js');
  const expected = scan(SECRET_TEXT);
  assert.ok(expected.matches.length > 0, 'the fixture must be detectable at all');
  for (const proc of await nonHostAppProcs()) {
    const h = inertMonitor();
    try {
      h.monitor.poller.emit('clipboard', {
        process: proc, title: `${proc} window`, text: SECRET_TEXT,
        len: SECRET_TEXT.length, cause: 'seq_change',
      });
      const ev = h.reported.find((e) => e.kind === 'prompt_paste');
      assert.ok(ev, `${proc} must still report a sensitive paste`);
      assert.equal(ev.process_name, proc);
      assert.equal(ev.content_text, SECRET_TEXT, `${proc} lost its content capture`);
      assert.equal(ev.window_title, `${proc} window`);
      assert.deepEqual(ev.matches, expected.matches, `${proc} lost its match detail`);
      assert.equal(ev.highest_severity, expected.highestSeverity);
    } finally { h.monitor.stop(); }
  }
});

test('the host-app guard sits at all three capture sites, before anything is read', async () => {
  // Source-level, because the ORDER is the property: a guard placed after the
  // read, the scan or the enqueue would still leak.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /^\s*isHostAppProcess,$/m, 'index.js must import the shared predicate');
  // Never re-implemented at a call site — one definition, in the catalog module.
  assert.equal(/hostApp/.test(codeOnly(src).replace(/isHostAppProcess/g, '')), false,
    'index.js must not read the hostApp field itself — use isHostAppProcess()');

  const clip = src.slice(src.indexOf("this.poller.on('clipboard', ("), src.indexOf("this.poller.on('clipboard_files', "));
  assert.ok(clip.length > 0, "expected a poller.on('clipboard') handler");
  const clipCode = codeOnly(clip);
  assert.match(clipCode, /if \(isHostAppProcess\(ev\.process\)\) return;/);
  assert.ok(
    clipCode.indexOf('isHostAppProcess') < clipCode.indexOf('scan(ev.text)'),
    'the host-app guard must precede the clipboard scan',
  );
  assert.ok(
    clipCode.indexOf('isHostAppProcess') < clipCode.indexOf('content_text: ev.text'),
    'the host-app guard must precede the content capture',
  );

  const files = src.slice(src.indexOf("this.poller.on('clipboard_files', "), src.indexOf("this.poller.on('poller-error'"));
  assert.ok(files.length > 0, "expected a poller.on('clipboard_files') handler");
  const filesCode = codeOnly(files);
  // THE ONE SITE GOVERNANCE OPENS. A host app is still excluded here by
  // default; the `&& !governed` clause lets a file pasted into an
  // already-verified governed/blocked agent conversation through, and nothing
  // else. #hostGovernedFor() answers null for every non-host app and for every
  // ungoverned tick in Teams, so the exclusion is unchanged everywhere the org
  // has not asked for governance.
  //
  // The clipboard-TEXT site above deliberately keeps its unconditional guard —
  // asserted separately, a few lines up.
  assert.match(filesCode, /const governed = this\.#hostGovernedFor\(ev\.process\);/);
  assert.match(filesCode, /if \(isHostAppProcess\(ev\.process\) && !governed\) return;/);
  assert.ok(
    filesCode.indexOf('isHostAppProcess') < filesCode.indexOf('buildFileUploadEvent'),
    'the host-app guard must precede buildFileUploadEvent — that call is what reads the file',
  );

  const focus = codeOnly(src.slice(src.indexOf("this.poller.on('focus', ("), src.indexOf("this.poller.on('clipboard', (")));
  assert.ok(focus.length > 0, "expected a poller.on('focus') handler");
  assert.match(focus, /isHostAppProcess\(ev\.process\)/);
  // Exactly one branch carries the title, and it is the non-host-app one.
  const titled = focus.split('\n').filter((l) => l.includes('title="'));
  assert.equal(titled.length, 1, `exactly one titled log line expected, got ${titled.length}`);
  assert.ok(
    focus.indexOf('isHostAppProcess') < focus.indexOf('title="'),
    'the title must only be reachable through the host-app branch',
  );
});

// ── prompt-watcher.ps1 panel scoping ─────────────────────────────────────────
//
// Same static-source convention this file already uses for enforcer-win.ps1:
// the script needs a live desktop, a focused UIA element and an AI app running,
// so the invariants are pinned against the source instead.

test('prompt-watcher.js hands the panel payloads to its .ps1, built from the catalog', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.js'), 'utf8');
  assert.match(src, /import \{ buildIdeProcessConfig, buildAiPanelConfig \} from '\.\/ai-processes\.js';/);
  assert.match(src, /CFAI_IDE_PROCESSES:\s*JSON\.stringify\(buildIdeProcessConfig\(\)\)/);
  assert.match(src, /CFAI_AI_PANELS:\s*JSON\.stringify\(buildAiPanelConfig\(\)\)/);
  // Passed unconditionally — not behind trackerMode or any other flag, or the
  // full agent (the case that actually has Cursor in its process list) would
  // keep reading code editors.
  const envBlock = src.slice(src.indexOf('env: {'), src.indexOf('this.child.stdout.setEncoding'));
  assert.equal(/trackerMode \? \{ CFAI_IDE_PROCESSES/.test(envBlock), false);
});

test('prompt-watcher.ps1 will not read an IDE element that is not a known AI panel', async () => {
  // The bug this closes: Cursor is legitimately in AI_PROCESSES (host
  // cursor.com), so every ~1.2s this watcher read the FULL TEXT of whatever
  // element had focus in Cursor — a source file or a terminal included — and
  // emitted it as a typed prompt.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.ps1'), 'utf8');
  assert.match(src, /\$env:CFAI_IDE_PROCESSES/);
  assert.match(src, /\$env:CFAI_AI_PANELS/);
  assert.match(src, /function Match-PanelSignature\(/);
  assert.match(src, /function Get-CaptureGate\(/);
  assert.match(src, /function Is-IdeProcess\(/);
  // The gate is what a non-matching element hits: no panel id => not allowed.
  const gate = src.slice(src.indexOf('function Get-CaptureGate('), src.indexOf('# ── Claude-tracker mode'));
  assert.match(gate, /if \(-not \(Is-IdeProcess \$proc\)\) \{\s*\r?\n\s*return \[pscustomobject\]@\{ allowed = \$true; panel = '' \}/);
  assert.match(gate, /return \[pscustomobject\]@\{ allowed = \$false; panel = '' \}/);
  // No whole-app fallback here, unlike the keystroke enforcer: falling back
  // would mean reading and transmitting arbitrary IDE content.
  assert.equal(/panelFallback|IdeFallback/.test(gate), false, 'a read path must never have a whole-app fallback');
  // Both read sites gate BEFORE Read-FocusedText — reading one character of a
  // source file is already the leak.
  const loop = src.slice(src.indexOf('while ($true)'));
  const gateCalls = loop.match(/\$gate = Get-CaptureGate \$focused \$fg\.process/g) || [];
  assert.equal(gateCalls.length, 2, 'both the tracker and the normal branch must gate');
  for (const branch of loop.split('$gate = Get-CaptureGate').slice(1)) {
    const readIdx = branch.indexOf('Read-FocusedText $focused');
    const checkIdx = branch.indexOf('$gate.allowed');
    assert.ok(checkIdx >= 0 && readIdx >= 0, 'expected a gate check and a text read in each branch');
    assert.ok(checkIdx < readIdx, 'the gate must be checked BEFORE any text is read');
  }
  // The signature values stay data, exactly as for enforcer-win.ps1.
  for (const literal of ['Message input', 'aislash-editor-input', 'messageInput_', 'Chat Input']) {
    assert.equal(src.includes(literal), false, `${literal} is hardcoded in prompt-watcher.ps1 — it must arrive as data`);
  }
});

test('prompt-watcher.ps1 leaves non-IDE AI apps exactly as they were', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.ps1'), 'utf8');
  // Claude Desktop / ChatGPT are not IDE processes, so Get-CaptureGate returns
  // allowed:true before it ever looks at a signature — no new way for the
  // watcher to go silent on the apps it was built for.
  const { IDE_PROCESSES } = await import('../src/os_monitor/ai-processes.js');
  for (const name of ['Claude', 'ChatGPT', 'Comet', 'Gemini', 'Poe']) {
    assert.equal(IDE_PROCESSES.some((e) => e.match.test(name)), false, `${name} must not be an IDE process`);
  }
  // The gating is keyed on the IDE list only — never on Is-AiProcess, which is
  // still what decides whether a window is looked at at all.
  assert.match(src, /if \(\$fg -and \(Is-AiProcess \$fg\.process\)\)/);
  // The hardcoded fallback list (used only when the env payload is missing or
  // unparseable) must stay in step with the catalog, and it must be non-empty:
  // an empty list would restore the old read-everything behaviour.
  const fallback = src.match(/if \(@\(\$IdeProcesses\)\.Count -eq 0\) \{ \$IdeProcesses = @\(([^)]*)\) \}/);
  assert.ok(fallback, 'expected a hardcoded IDE fallback list');
  const names = fallback[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '').toLowerCase());
  assert.deepEqual(
    names,
    IDE_PROCESSES.map((e) => e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\/]i?$/, '').toLowerCase()),
    'the .ps1 fallback IDE list has drifted from IDE_PROCESSES',
  );
});

test('prompt-watcher.ps1 emits the matched panel id, and index.js attributes on it', async () => {
  const ps1 = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'prompt-watcher.ps1'), 'utf8');
  const emit = ps1.slice(ps1.indexOf("kind    = 'prompt_text'"), ps1.indexOf("kind    = 'prompt_text'") + 700);
  assert.match(emit, /panel\s*=\s*\$gate\.panel/);
  // Never the raw UIA reads the gate performed — a ClassName or an element name
  // in an IDE can carry a file path or a workspace name.
  assert.equal(/ClassName|ProgrammaticName|\$cls/.test(emit), false, 'panel detection reads must not be emitted');
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const handler = src.slice(src.indexOf("this.promptWatcher.on('prompt_text'"));
  assert.match(handler.slice(0, 600), /const ai = identifyEventAi\(ev\);/);
  const { identifyAiPanel } = await import('../src/os_monitor/ai-processes.js');
  assert.deepEqual(identifyAiPanel('cursor_composer'), { product: 'Cursor', vendor: 'Anysphere' });
});

test('index.js resolves a panel event panel-first, so a process:"Code" prompt is not dropped', async () => {
  // "Code" is in no AI catalog and never will be, so identifyAiProcess returns
  // null for it and the `if (!ai) return` guard would silently discard every
  // prompt sent from a VS Code AI panel.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /function identifyEventAi\(ev\) \{\s*\r?\n\s*return \(ev\?\.panel \? identifyAiPanel\(ev\.panel\) : null\) \|\| identifyAiProcess\(ev\?\.process\);/);
  for (const handler of ['prompt', 'block', 'override']) {
    const h = src.slice(src.indexOf(`this.enforcer.on('${handler}'`));
    assert.match(h.slice(0, 400), /identifyEventAi\(ev\)/, `the '${handler}' handler must resolve panel-first`);
  }
  // tool_host: panel host first, then the process host, then the platform map.
  assert.match(src, /hostForPanel\(ev\.panel\) \|\| hostForProcess\(ev\.process\) \|\| hostsForPlatform\(ev\.blocked_platform\)\[0\] \|\| ''/);
  // Model routing is excluded from IDE panels, so its handler stays
  // process-based on purpose.
  const route = src.slice(src.indexOf("this.enforcer.on('route'"));
  assert.match(route.slice(0, 300), /identifyAiProcess\(ev\.process\)/);

  // …and the resolution really does work for a real panel event shape.
  const { identifyAiPanel, hostForPanel, identifyAiProcess } = await import('../src/os_monitor/ai-processes.js');
  assert.equal(identifyAiProcess('Code'), null, '"Code" must stay out of the AI process catalog');
  assert.deepEqual(identifyAiPanel('claude_code'), { product: 'Claude Code', vendor: 'Anthropic' });
  assert.equal(hostForPanel('claude_code'), 'claude.ai');
});

test('index.js relays the panel id to the Request Access dialog', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const relayStart = src.indexOf("console.log('@@CFAI-BLOCK '");
  const relay = src.slice(relayStart, relayStart + 900);
  assert.match(relay, /panel: ev\.panel \|\| ''/);
  // A catalog id only — nothing read out of the app.
  assert.equal(/window_title|title:|className/.test(relay), false);
});

test('index.js resolves the Request Access tool_host from the PROCESS, so the sentinel still works', async () => {
  // The downstream assumption the whole bridge rests on: hostsForPlatform
  // ('ai_platform') is legitimately [], so if tool_host resolution depended on
  // blocked_platform the Request Access dialog would have nothing to ask for.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /hostForProcess\(ev\.process\) \|\| hostsForPlatform\(ev\.blocked_platform\)\[0\] \|\| ''/);
  const { hostsForPlatform, hostForProcess, PLATFORM_BLOCK_SENTINEL } = await import('../src/os_monitor/ai-processes.js');
  assert.deepEqual(hostsForPlatform(PLATFORM_BLOCK_SENTINEL), []);
  assert.equal(hostForProcess('Claude'), 'claude.ai');   // …and the primary path answers
});

// ── The standing blocked-platform bar (desktop) ───────────────────────────────
// The desktop counterpart of the browser extension's showPlatformBanner(). These
// cases guard the CONTRACT (scope discrimination, payload contents, when the bar
// is allowed to be up) — the overlay window itself is Electron and cannot be
// exercised here, so everything that can be asserted statically is.

async function enforcerSrc() {
  return readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
}

// Comments in this repo deliberately NAME the thing the code must not do ("must
// not wait out FG_STICKY_TTL", "must never write _fgIsBlocked"). Strip them
// before any "this identifier does not appear" assertion, or the explanation
// trips the very test it explains. Line comments only — both the C# inside
// enforcer-win.ps1 and the JS use //.
function codeOnly(src) {
  return src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
}

// Assignment, not comparison: `_fgLeftAiTicks == 0` contains `_fgLeftAiTicks =`
// as a substring, and reading a field is exactly what the bar is supposed to do.
function assignsTo(src, field) {
  return new RegExp(`${field}\\s*=(?!=)`).test(src);
}

// codeOnly()'s sibling for a .ps1 that embeds C#: PowerShell comments with #,
// the compiled dialog type's with //. Both have to go before any "this
// identifier does not appear" assertion.
function psCodeOnly(src) {
  return src
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('//'))
    .join('\n');
}

function bannerStateFn(src) {
  const start = src.indexOf('static void UpdateBannerState()');
  const end = src.indexOf('static void EmitBlockState(');
  assert.ok(start >= 0 && end > start, 'expected an UpdateBannerState body followed by EmitBlockState');
  return src.slice(start, end);
}

test('enforcer-win.ps1: a platform block declares its SCOPE, taken from _blockedByElement and not from the panel field', async () => {
  // Scope must not be inferred from `panel`. That field is ATTRIBUTION —
  // PlatformBlockPanelField falls back to PanelField, so the day any
  // IDE_PROCESSES entry sets panelFallback:true an APP-scoped block can legally
  // carry a panel id, and anything keyed on `!panel` silently flips.
  const src = await enforcerSrc();
  // Straight from _blockScope, via the one accessor — NOT from _blockedByElement
  // (which cannot tell "panel" from "agent") and NOT from the panel field.
  assert.ok(
    src.includes('",\\"block_scope\\":\\"" + Esc(BlockScope()) + "\\""'),
    'EmitBlock must emit block_scope straight from _blockScope via BlockScope()',
  );
  const scopeFn = src.slice(src.indexOf('static string BlockScope()'), src.indexOf('static void UpdateBannerState()'));
  assert.ok(scopeFn.length > 0, 'expected a BlockScope body');
  assert.match(scopeFn, /string s = _blockScope;/);
  assert.match(scopeFn, /return \(s != null && s\.Length > 0\) \? s : "app";/);
  // The bar's own payload must emit the REAL scope too, never a hardcoded "app" —
  // main.js only renders for scope === 'app', and that guard is a real second
  // line of defence only if what it checks can actually differ.
  const barEmit = src.slice(src.indexOf('static void EmitBlockState('), src.indexOf('static void ClearFgBlocked()'));
  assert.match(barEmit, /",\\"scope\\":\\"" \+ Esc\(BlockScope\(\)\) \+ "\\""/);
  assert.equal(/\\"scope\\":\\"app\\"/.test(barEmit), false, 'the bar must not hardcode its scope');
  // Cleared with the block itself, so a stale scope can never outlive it.
  assert.match(src.slice(src.indexOf('static void ClearFgBlocked()'), src.indexOf('static string ExtractJsonString(')), /_blockScope = "";/);
  // …emitted inside the platform-block group, alongside the other identity
  // fields, so it can never appear on a content block.
  const emitBlock = codeOnly(src.slice(src.indexOf('static void EmitBlock('), src.indexOf('static void EmitRewrite(')));
  const scopeIdx = emitBlock.indexOf('block_scope');
  const groupIdx = emitBlock.indexOf('platform_block\\":true');
  assert.ok(groupIdx >= 0, 'expected the platform_block group in EmitBlock');
  assert.ok(scopeIdx > groupIdx, 'block_scope belongs in the platform_block group');

  // All FOUR arm sites in CheckFgBlocked, in file order: the agent-scoped
  // narrowing, the two process-keyed whole-app ones, then the panel-keyed one.
  // Every site must declare BOTH flags together, so a fifth arm site fails this
  // until its scope is decided deliberately.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static string BlockScope()'));
  const arms = [...check.matchAll(/_fgIsBlocked = true;\s*\r?\n\s*_blockedByElement = (true|false);[^\r\n]*\r?\n\s*_blockScope = "(app|panel|agent)";/g)]
    .map((m) => [m[1], m[2]]);
  assert.deepEqual(arms, [['true', 'agent'], ['false', 'app'], ['false', 'app'], ['true', 'panel']],
    'the four CheckFgBlocked arm sites must keep their scopes');
});

test('index.js relays block_scope to Electron without inventing it', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const relayStart = src.indexOf("console.log('@@CFAI-BLOCK '");
  const relay = src.slice(relayStart, relayStart + 1400);
  assert.match(relay, /block_scope: ev\.block_scope \|\| ''/);
});

test('the blocked-platform bar payload carries NO prompt content — a bool, a scope, admin-typed names, a pid and a rect', async () => {
  // The strictest PII rule in this feature, because a BrowserWindow renders
  // this. There must be no route at all from the bar to anything the user
  // typed: no window title, no UIA element Name, no pattern list, no preview.
  const src = await enforcerSrc();
  const emit = src.slice(src.indexOf('static void EmitBlockState('), src.indexOf('static void ClearFgBlocked()'));
  assert.ok(emit.length > 0, 'expected an EmitBlockState body');

  const keys = [...emit.matchAll(/\\"([a-z_]+)\\":/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [
    'active', 'agent', 'agent_id', 'kind', 'pid', 'platform', 'process',
    'scope', 'win_h', 'win_w', 'win_x', 'win_y',
  ], 'the bar payload gained or lost a field — every addition must be re-reviewed for PII');

  for (const forbidden of [
    'patterns', '_blockedReason', '_pendingPreview', 'preview', 'block_id',
    'GetWindowText', '.Current.Name', '_typed', 'ActivePatterns',
  ]) {
    assert.equal(emit.includes(forbidden), false, `${forbidden} must never reach the bar payload`);
  }
  // The rect is read with the SAME Win32 pair UpdateSendRect already uses — no
  // new interop was added for this, and it is read once per transition rather
  // than tracked.
  assert.match(emit, /GetForegroundWindow\(\)/);
  assert.match(emit, /GetWindowRect\(fg, out wr\)/);
});

test('enforcer-win.ps1: the bar is off whenever the panic hotkey has disarmed enforcement', async () => {
  // Disarmed() is checked inside the block DECISION functions and NOT inside
  // CheckFgBlocked, so _fgIsBlocked stays true across a disarm. Without this
  // term the bar would keep asserting that prompts are being stopped while
  // every Enter is in fact going through — the worst kind of wrong for a
  // governance indicator.
  const src = await enforcerSrc();
  const fn = bannerStateFn(src);
  assert.match(fn, /!Disarmed\(\)/, 'the bar-active condition must include !Disarmed()');
  assert.match(fn, /bool want = _fgIsBlocked && BlockScope\(\) == "app" && !Disarmed\(\)/);
  // …and Disarmed() really is absent from CheckFgBlocked, which is the whole
  // reason the term is needed here. If that ever changes, this term becomes
  // redundant rather than wrong — but the assumption should be re-checked.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void UpdateBannerState()'));
  assert.equal(check.includes('Disarmed()'), false, 'CheckFgBlocked gained a Disarmed() gate — re-read UpdateBannerState');
});

test('enforcer-win.ps1: the bar is whole-app only — an IDE-panel block never raises it', async () => {
  // Mirrors showPlatformBanner()'s IS_EMBEDDED_AI early-return in the browser
  // extension, and for the same reason: blocking one AI panel inside VS Code is
  // not blocking VS Code, and a display-wide red bar would say that it was.
  const src = await enforcerSrc();
  // Tested against the POSITIVE scope rather than !_blockedByElement: agent- and
  // panel-scoped blocks are both excluded, and a future third element-scoped kind
  // has to state its intent here instead of inheriting "no bar" silently.
  assert.match(bannerStateFn(src), /BlockScope\(\) == "app"/);
});

test('enforcer-win.ps1: the bar clears immediately and never borrows the 3s enforcement sticky window', async () => {
  // The bug this prevents: alt-tab from a blocked app to Outlook. _fgIsBlocked
  // stays true for FG_STICKY_TTL by design, so a bar keyed on it would sit red
  // over Outlook for 3 seconds. The bar therefore keeps its OWN pid and clears
  // on the first tick the foreground pid changes.
  const src = await enforcerSrc();
  const fn = bannerStateFn(src);
  const code = codeOnly(fn);
  assert.match(code, /pid != _bannerPid/, 'expected a pid-keyed fast clear of its own');
  // Its own state, not the enforcement latch's.
  assert.equal(code.includes('_panelBlockPid'), false, 'the bar must not reuse the enforcement latch pid');
  // No grace period of any kind may appear in here.
  for (const ttl of ['FG_STICKY_TTL', 'PANEL_BLOCK_LATCH_TTL', 'PANEL_LEAVE_INPUT_WINDOW']) {
    assert.equal(code.includes(ttl), false, `the bar must not wait out ${ttl}`);
  }
  // And it may only ARM on a first-hand tick — otherwise the fast clear above
  // is undone one tick later, with the bar re-armed over whatever the user
  // switched to. Measured: this exact regression.
  assert.match(fn, /bool firstHand = _fgLeftAiTicks == 0;/);
  assert.match(fn, /&& firstHand/);
});

test('enforcer-win.ps1: the bar OBSERVES enforcement state and never writes it', async () => {
  // _fgIsBlocked / _blockedByElement / the panel latch release deliberately
  // slowly, for correctness reasons the bar does not share (see the
  // platform-block-latch fix). A presentation feature must not be able to
  // shorten or extend any of them.
  const code = codeOnly(bannerStateFn(await enforcerSrc()));
  for (const field of [
    '_fgIsBlocked', '_blockedByElement', '_blockedPlatform', '_blockedAgentName',
    '_blockedAgentId', '_fgLeftAiTicks', '_fgPid', '_panelBlockLatch', '_blockScope',
  ]) {
    assert.equal(assignsTo(code, field), false, `UpdateBannerState must not write ${field}`);
  }
  for (const call of ['ClearFgBlocked(', 'ArmPanelBlockLatch(', 'ClearPanelBlockLatch(']) {
    assert.equal(code.includes(call), false, `UpdateBannerState must not call ${call})`);
  }
  // …while the bar's OWN state is of course written here, and only here.
  for (const own of ['_bannerActive', '_bannerPid', '_bannerAgent']) {
    assert.equal(assignsTo(code, own), true, `expected UpdateBannerState to own ${own}`);
  }
  const src = await enforcerSrc();
  // It runs on the poll thread, straight after the block decision it reads.
  assert.match(src, /UpdateForeground\(\); UpdateBlockedAgents\(\); UpdateBannerState\(\);/);
});

test('enforcer.js dispatches blockstate instead of warning about an unknown kind', async () => {
  // A missing case would not merely drop the event: the default branch logs
  // "unknown kind", that warning reaches Electron's plain-text line scraper,
  // and every focus change onto a blocked app would add a bogus row to
  // recentAlerts. Same class of bug this file already hit for 'route'.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /case 'blockstate':[\s\S]{0,700}?this\.emit\('blockstate', ev\);/);
  const dispatch = src.slice(src.indexOf('#dispatch(ev)'));
  const caseIdx = dispatch.indexOf("case 'blockstate':");
  const body = dispatch.slice(caseIdx, dispatch.indexOf('break;', caseIdx));
  assert.equal(/this\.log/.test(body), false, 'a log line per focus change is noise, and this event is presentation-only');
  // Source-level, in the same style (and for the same reason) as the 'route'
  // dispatch case above: #dispatch/#onStdout are private and unreachable
  // without spawning a real child, which this file's header forbids. What CAN
  // be checked live is that constructing the Enforcer still installs no hook.
  const enforcer = new Enforcer({ aiProcessNames: [], blockPatterns: [], enabled: false });
  enforcer.start();
  assert.equal(enforcer.child, null, 'a disabled enforcer must never spawn the helper');
});

test('index.js relays @@CFAI-BLOCKSTATE and NEVER reports the bar to the server', async () => {
  // An enforcement_block record means "a send was actually refused". A blocked
  // window merely GAINING FOCUS is not that, and enqueueing one would inflate
  // every block count with attempts the user never made.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const start = src.indexOf("this.enforcer.on('blockstate'");
  assert.ok(start >= 0, "expected an enforcer.on('blockstate') handler");
  const handler = codeOnly(src.slice(start, src.indexOf("this.enforcer.on('disarmed'")));
  assert.match(handler, /console\.log\('@@CFAI-BLOCKSTATE '/);
  assert.equal(handler.includes('reporter.enqueue'), false, 'the bar must never become a server record');
  assert.equal(handler.includes('this.log'), false, 'and must never be logged');
  assert.equal(handler.includes('toast.show'), false, 'the bar IS the notification');
  // No content field can be relayed, whatever the helper sends.
  assert.equal(/patterns|preview|block_id|filename|title/.test(handler), false);

  // The panic hotkey takes the bar down on the same presentation-only channel.
  // Bounded at the NEXT handler, not by a character count — the handler after it
  // does enqueue, legitimately.
  const dStart = src.indexOf("this.enforcer.on('disarmed'");
  const dEnd = src.indexOf('this.enforcer.on(', dStart + 20);
  const disarmed = codeOnly(src.slice(dStart, dEnd > dStart ? dEnd : undefined));
  assert.match(disarmed, /@@CFAI-BLOCKSTATE ' \+ JSON\.stringify\(\{ active: false \}\)/);
  assert.equal(disarmed.includes('reporter.enqueue'), false);
});

async function electronMain() {
  return readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
}

function bannerSection(src) {
  const start = src.indexOf('const BANNER_HEIGHT');
  const end = src.indexOf('function showBlockDialogWindow(');
  assert.ok(start >= 0 && end > start, 'expected the banner section to sit above showBlockDialogWindow');
  return src.slice(start, end);
}

test('main.js handles @@CFAI-BLOCKSTATE before the pinned @@CFAI-BLOCK guard, and never crashes the line pump', async () => {
  const src = await electronMain();
  const stateIdx = src.indexOf("line.startsWith('@@CFAI-BLOCKSTATE '");
  const blockIdx = src.indexOf("line.startsWith('@@CFAI-BLOCK '");
  assert.ok(stateIdx >= 0, 'expected an @@CFAI-BLOCKSTATE guard');
  assert.ok(stateIdx < blockIdx, 'the BLOCKSTATE guard must come first');
  const guard = src.slice(stateIdx, blockIdx);
  // Malformed JSON is dropped, exactly like every other structured channel here.
  assert.match(guard, /catch \{ \/\* malformed/);
  // Scope is asserted, not assumed: a panel-scoped state must never draw a bar.
  assert.match(guard, /parsed\.active && parsed\.scope === 'app'/);
  assert.match(guard, /else hideBlockBanner\(\);/);
  // Presentation only — nothing on this path may report, log or alert.
  const code = codeOnly(guard);
  for (const forbidden of ['recentAlerts', 'sendToRenderer', 'fetch(']) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not appear on the bar path`);
  }

  // …and the real thing does not throw on the shapes it will actually see.
  const parse = (line) => {
    if (!line.startsWith('@@CFAI-BLOCKSTATE ')) return 'not-ours';
    try {
      const parsed = JSON.parse(line.slice('@@CFAI-BLOCKSTATE '.length));
      return (parsed.active && parsed.scope === 'app') ? 'show' : 'hide';
    } catch { return 'dropped'; }
  };
  assert.equal(parse('@@CFAI-BLOCKSTATE {"active":true,"scope":"app","name":"Claude"}'), 'show');
  assert.equal(parse('@@CFAI-BLOCKSTATE {"active":true,"scope":"panel","name":"Claude Code"}'), 'hide');
  assert.equal(parse('@@CFAI-BLOCKSTATE {"active":false}'), 'hide');
  assert.equal(parse('@@CFAI-BLOCKSTATE {"active":true,'), 'dropped');
  assert.equal(parse('@@CFAI-BLOCKSTATE '), 'dropped');
  // The shorter prefix must not swallow the longer one — the trailing space in
  // '@@CFAI-BLOCK ' is what keeps them apart.
  assert.equal('@@CFAI-BLOCKSTATE {"active":false}'.startsWith('@@CFAI-BLOCK '), false);
});

test('the banner window is non-focusable, click-through and never docked to the blocked window', async () => {
  // focusable:true here would be worse than it was for the Tokenize popup:
  // stealing focus from the AI app makes the enforcer see the user leave it, so
  // the bar would tear down the very block it is announcing.
  const section = bannerSection(await electronMain());
  assert.match(section, /focusable: false/);
  assert.match(section, /showInactive\(\)/);
  assert.match(section, /setIgnoreMouseEvents\(true\)/);
  assert.match(section, /setAlwaysOnTop\(true, 'screen-saver'\)/);
  assert.match(section, /skipTaskbar: true/);
  assert.match(section, /frame: false/);
  assert.match(section, /renderer', 'block-banner\.html'/);
  // Anchored to the display's workArea so a top-docked taskbar is not covered by
  // something the user can neither move nor click through.
  assert.match(section, /screen\.getDisplayNearestPoint/);
  assert.match(section, /display\.workArea/);
  assert.equal(/display\.bounds/.test(codeOnly(section)), false, 'workArea, not bounds');
  // Explicitly NOT a window follower: no polling of the blocked window.
  const code = codeOnly(section);
  for (const forbidden of ['setInterval', 'GetWindowRect', 'win_w', 'win_h']) {
    assert.equal(code.includes(forbidden), false, `${forbidden} would make this a window-follower`);
  }
  // A show-debounce so alt-tabbing THROUGH a blocked app does not flash it.
  assert.match(section, /BANNER_SHOW_DEBOUNCE_MS/);
  assert.match(section, /setTimeout\(/);
  // A transparent, non-resizable window cannot be resized on Windows, and the
  // bar's WIDTH has to follow the display's workArea. So a size change recreates
  // the window; only a move goes through setBounds. Getting this wrong leaves a
  // bar of the old monitor's width stretched across, or short of, the new one.
  assert.match(section, /cur\.width !== bounds\.width \|\| cur\.height !== bounds\.height/);
  assert.match(section, /transparent: true/);
});

test('the banner is destroyed on every path that ends the monitor', async () => {
  // The worst failure mode of this whole feature: an always-on-top,
  // click-through bar with no enforcer behind it, claiming a block that is not
  // happening and offering the user no way to dismiss it.
  const src = await electronMain();
  assert.match(src, /function destroyBlockBanner\(\)/);
  const destroy = src.slice(src.indexOf('function destroyBlockBanner()'), src.indexOf('function repositionBlockBanner()'));
  assert.match(destroy, /bannerWindow\.destroy\(\)/);
  assert.match(destroy, /bannerWindow = null;/);

  // Child exit, spawn error, Stop Monitoring, and quit.
  const exitHandler = src.slice(src.indexOf("monitorProcess.on('exit'"), src.indexOf('function stopMonitor()'));
  assert.match(exitHandler, /destroyBlockBanner\(\);/);
  const errHandler = exitHandler.slice(exitHandler.indexOf("monitorProcess.on('error'"));
  assert.match(errHandler, /destroyBlockBanner\(\);/);
  const stop = src.slice(src.indexOf('function stopMonitor()'), src.indexOf('// ── The standing'));
  assert.match(stop, /destroyBlockBanner\(\);/);
  const beforeQuit = src.slice(src.indexOf("app.on('before-quit'"));
  assert.match(beforeQuit.slice(0, 500), /destroyBlockBanner\(\);/);

  // A display disappearing must not leave it drawn at coordinates that are gone.
  assert.match(src, /screen\.on\('display-removed', repositionBlockBanner\)/);
  assert.match(src, /screen\.on\('display-metrics-changed', repositionBlockBanner\)/);
});

test('the banner is admin-controlled — it is NOT a user-toggleable setting', async () => {
  // A user who could switch off the indicator for a block they cannot switch off
  // would only be hiding the explanation. Deliberate product decision.
  const src = await electronMain();
  const defaults = src.slice(src.indexOf('const DEFAULT_SETTINGS = {'), src.indexOf('function loadSettings()'));
  assert.equal(/banner|Banner/.test(defaults), false, 'the bar must not become a setting');
});

test('block-banner.js renders one admin-supplied name as TEXT, and has no route to prompt content', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'renderer', 'block-banner.js'), 'utf8');
  // textContent, never innerHTML — no markup path at all for a value that is
  // admin-typed but untrusted by the time it reaches a BrowserWindow.
  assert.match(src, /\$bar\.textContent =/);
  assert.equal(/innerHTML/.test(codeOnly(src)), false);
  // The exact approved copy, including the remediation pointer.
  assert.match(src, /is blocked by CloudFuze AI Governance/);
  assert.match(src, /prompts cannot be sent here/);
  assert.match(src, /Request access from the CloudFuze tray icon/);
  assert.match(src, /\\u\{1F512\}/, 'the lock glyph is escaped, as in the extension banner');
  // One field in, nothing out.
  const code = codeOnly(src);
  for (const forbidden of ['preview', 'patterns', 'block_id', 'tokenize', 'invoke', 'submitAccessRequest']) {
    assert.equal(code.includes(forbidden), false, `${forbidden} must not appear in the bar renderer`);
  }
  // Same palette/copy structure as the extension's own bar, so the two surfaces
  // read as one control.
  const html = await readFile(join(AGENT_DIR, 'electron', 'renderer', 'block-banner.html'), 'utf8');
  assert.match(html, /#b91c1c/);
  assert.match(html, /600 13px\/1\.4 system-ui/);
  assert.match(html, /pointer-events: none/);
  const ext = await readFile(join(AGENT_DIR, '..', 'browser-extension', 'content', 'content.js'), 'utf8');
  assert.ok(ext.includes('background:#b91c1c'), 'the extension banner colour moved — the desktop bar has drifted from it');
});

test('the preload bridge exposes the banner as receive-only, with no matching invoke', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'preload.js'), 'utf8');
  assert.match(src, /onBlockBanner: \(callback\) => \{/);
  assert.match(src, /ipcRenderer\.on\('block-banner', handler\)/);
  assert.equal(/invoke\('block-banner/.test(src), false, 'the bar has nothing to send back');
});

// ── §5d: the bar changes what the Request Access modal is for ─────────────────

test('the Request Access modal is shown ONCE per host while the bar is up, and the pinned guard line is untouched', async () => {
  // DELIBERATE UPDATE to the coverage around the platform_block guard. Before
  // the bar existed, every swallowed Enter and every swallowed send-button click
  // re-raised (and re-focused) this dialog — the behaviour that made a blocked
  // app feel broken rather than governed. Now the bar is the standing
  // explanation and the modal explains it once.
  //
  // The guard line itself is unchanged and still asserted byte-for-byte below:
  // the suppression is separate logic INSIDE showAccessRequestWindow, not a
  // rewrite of the call site.
  const src = await electronMain();
  const blockHandler = src.slice(src.indexOf("line.startsWith('@@CFAI-BLOCK '"), src.indexOf("line.startsWith('@@CFAI-REWRITE '"));
  assert.match(blockHandler, /if \(parsed\.platform_block\) \{ showAccessRequestWindow\(parsed\); return; \}/);

  const fn = src.slice(src.indexOf('function showAccessRequestWindow('), src.indexOf('function parseMonitorLine('));
  assert.match(fn, /platformModalShownForHost === host/);
  // Conditional on the bar being up. With no bar (a panel-scoped block raises
  // none) the modal is the only signal there is, so every-attempt behaviour must
  // survive — this is the term that guarantees it.
  assert.match(fn, /bannerVisible\s*\r?\n?\s*&& platformModalShownForHost === host/);
  // An OPEN dialog is still raised by the existing guard rather than suppressed.
  assert.match(fn, /\(!accessWindow \|\| accessWindow\.isDestroyed\(\)\)/);
  const suppressIdx = fn.indexOf('platformModalShownForHost === host');
  const raiseIdx = fn.indexOf('accessWindowHost === (data?.tool_host || null)');
  assert.ok(suppressIdx >= 0 && raiseIdx > suppressIdx, 'the suppression check comes first, then the raise-only guard');

  // Reset when the bar clears — otherwise the next real block would go
  // unexplained.
  const hide = src.slice(src.indexOf('function hideBlockBanner()'), src.indexOf('function destroyBlockBanner()'));
  assert.match(hide, /platformModalShownForHost = null;/);

  // The behaviour itself, on a copy of exactly those conditions.
  const decide = (bannerUp, shownFor, host, dialogOpen) =>
    (bannerUp && shownFor === host && !dialogOpen) ? 'suppressed' : 'shown';
  assert.equal(decide(true, null, 'claude.ai', false), 'shown');          // first block: always explained
  assert.equal(decide(true, 'claude.ai', 'claude.ai', false), 'suppressed'); // repeat while the bar is up
  assert.equal(decide(true, 'claude.ai', 'chat.openai.com', false), 'shown'); // different tool
  assert.equal(decide(false, 'claude.ai', 'claude.ai', false), 'shown');  // no bar → the modal is the only signal
  assert.equal(decide(true, 'claude.ai', 'claude.ai', true), 'shown');    // open dialog is still raised
});

// ── §6: agent-scoped desktop blocks (agent_scope:'agent') ────────────────────
//
// A blocked_agents row names ONE agent, but the enforcer matched it against the
// whole PROCESS set its platform maps to and used agent_name only as display
// text — so blocking "AI Learning Advisor" disabled the entire Microsoft 365
// Copilot app. The behavioural half of this feature is driven for real in
// tests/enforcer-panel-block.test.mjs; these are the source invariants, same
// convention as every other .ps1 check in this file.

test('AGENT_SURFACES: an entry may only enforce once a live pass verified it', async () => {
  // THE safety gate of this feature, in its general form. A new surface ships
  // enforce:false AND verified:false — matched and unit-tested, so the whole
  // bridge is exercised, but arming nothing — until a human runs a live
  // verification pass against a real installation and flips BOTH. While they are
  // false an agent-scoped row behaves exactly as it did before the feature
  // existed (a whole-app block), asserted behaviourally against the hypothetical
  // unverified surface in tests/enforcer-panel-block.test.mjs.
  //
  // Two entries are PAST that gate, each verified live against a real install
  // with a real blocked agent:
  //   m365_copilot   — 2026-08-27, Microsoft 365 Copilot with a real added agent
  //   teams_desktop  — 2026-08-30, Microsoft Teams desktop with a real blocked
  //                    Copilot Studio agent ("IT Help Desk Agent"): the send was
  //                    swallowed only in that agent's conversation, while a 1:1
  //                    DM, a group chat and a channel post were all unaffected,
  //                    and switching conversations released then re-armed it.
  // If you are here because this test failed after you flipped a flag on a NEW
  // entry: that is the point. Confirm the live verification actually happened and
  // record it, rather than loosening this.
  const { AGENT_SURFACES, buildAgentSurfaceConfig } = await import('../src/os_monitor/ai-processes.js');
  assert.ok(AGENT_SURFACES.length > 0, 'expected at least one agent surface');
  for (const surface of AGENT_SURFACES) {
    assert.equal(typeof surface.enforce, 'boolean', `${surface.id} must state enforce explicitly`);
    assert.equal(typeof surface.verified, 'boolean', `${surface.id} must state verified explicitly`);
    if (surface.enforce) {
      assert.equal(surface.verified, true, `${surface.id} enforces without a recorded live verification`);
    }
  }
  const m365 = AGENT_SURFACES.find((s2) => s2.id === 'm365_copilot');
  assert.ok(m365, 'the m365_copilot surface is missing');
  assert.equal(m365.enforce, true, 'm365_copilot was live-verified 2026-08-27 and must stay enforcing');
  assert.equal(m365.verified, true);
  // …and both flags must survive the env-var handoff, because the C# side
  // narrows only when a surface is verified AND enforcing. Dropping either from
  // the payload would silently move the surface to the wrong side of that gate.
  for (const entry of buildAgentSurfaceConfig()) {
    const src = AGENT_SURFACES.find((s2) => s2.id === entry.id);
    assert.ok(src, `${entry.id} is not in the catalog`);
    assert.equal(entry.enforce, src.enforce === true, `${entry.id} enforce must survive the handoff`);
    assert.equal(entry.verified, src.verified === true, `${entry.id} verified must survive the handoff`);
    assert.ok(Array.isArray(entry.genericNames));
    // The read mode and its data must survive too — the C# side branches on
    // `read`, so losing it would silently move a title surface onto the
    // composer-name path and make it read nothing at all.
    assert.equal(entry.read, src.read === 'window_title' ? 'window_title' : 'composer_name', entry.id);
    assert.equal(entry.hostApp, src.hostApp === true, `${entry.id} hostApp must survive the handoff`);
    if (entry.read === 'window_title') {
      assert.equal(entry.titleSeparator, src.titleSeparator);
      assert.equal(entry.titleSuffix, src.titleSuffix);
      assert.ok(Array.isArray(entry.titleKinds) && entry.titleKinds.length > 0, entry.id);
    } else {
      assert.ok(Array.isArray(entry.composerNamePrefixes) && entry.composerNamePrefixes.length > 0);
    }
  }
  // teams_desktop is past the gate too, live-verified 2026-08-30. Its hostApp
  // flag is now LOAD-BEARING rather than latent: with enforcement armed, that
  // flag is the only thing standing between "block one agent inside Teams" and
  // "the user cannot message a colleague". It must stay true for as long as this
  // surface enforces.
  const teams = AGENT_SURFACES.find((s2) => s2.id === 'teams_desktop');
  assert.ok(teams, 'the teams_desktop surface is missing');
  assert.equal(teams.enforce, true, 'teams_desktop was live-verified 2026-08-30 and must stay enforcing');
  assert.equal(teams.verified, true);
  assert.equal(teams.hostApp, true, 'teams_desktop enforces, so it must still fail OPEN as a host app');
});

test('a HOST-APP surface can never fall back to a whole-app block', async () => {
  // THE inversion this feature turns on, stated as a source invariant. For an
  // AI-only app, "cannot tell which agent is open → block the whole app" is a
  // safe fail-CLOSED default; the user loses an AI tool. For Microsoft Teams the
  // same default means the user cannot message a colleague, post in a channel or
  // reply in a meeting — because ONE agent inside the app is blocked. The
  // correct direction there is fail-OPEN: no block at all.
  //
  // Driven behaviourally in tests/enforcer-panel-block.test.mjs; these are the
  // source invariants, same convention as every other .ps1 check in this file.
  const src = await enforcerSrc();
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static void ClearFgBlocked()'));
  assert.ok(check.length > 0, 'expected a CheckFgBlocked body');
  // Computed once per call, from the PROCESS — deliberately not from the surface
  // being verified, because an UNVERIFIED host-app surface must produce no block
  // either. That is the opposite of what an unverified chat-app surface does.
  assert.match(check, /bool hostApp = _hostAppProcs\.Contains\(_app\);/);
  // All THREE coarse arms are guarded. Each one is a route to a whole-app block.
  assert.match(check, /if \(!narrowed && !hostApp\) \{/);
  assert.match(check, /if \(!hostApp && string\.Equals\(agent\["process_name"\], _app, StringComparison\.OrdinalIgnoreCase\)\)/);
  assert.match(check, /if \(!hostApp && string\.Equals\(agent\["panel"\], _fgPanelId, StringComparison\.OrdinalIgnoreCase\)\)/);
  // …and the guard really does cover every arm site: each `_fgIsBlocked = true;`
  // other than the agent-scoped narrowing sits behind a `!hostApp` term.
  const armSegments = check.split('_fgIsBlocked = true;').slice(0, -1);
  assert.equal(armSegments.length, 4, 'expected four arm sites');
  for (const [i, seg] of armSegments.entries()) {
    if (i === 0) continue;   // the agent-scoped narrowing — element-scoped by construction
    assert.match(seg.slice(-800), /!hostApp/, `arm site ${i} has no host-app guard`);
  }
  // The set itself is derived from the catalog, in one place, and empty by
  // default — so a malformed payload means "no process is a host app", i.e.
  // exactly the behaviour this file had before host apps existed.
  assert.match(src, /static HashSet<string> _hostAppProcs = new HashSet<string>\(StringComparer\.OrdinalIgnoreCase\);/);
  const code = codeOnly(src);
  assert.equal((code.match(/_hostAppProcs = hostApps;/g) || []).length, 1, 'exactly one place may write the host-app set');
  assert.equal((code.match(/^\s*_hostAppProcs = /gm) || []).length, 1, 'no second assignment site may exist');
  const load = src.slice(src.indexOf('static void LoadAgentSurfaces(string json)'), src.indexOf('static AgentSurface MatchAgentSurface(string proc)'));
  assert.match(load, /if \(hostApp\) \{ foreach \(string p in procs\) hostApps\.Add\(p\); \}/);
  assert.match(load, /_hostAppProcs = hostApps;\s*\r?\n\s*_agentSurfaces = surfaces;\s*\r?\n\s*\}/);
});

// ── GOVERNED FOR DLP ONLY: the third state, and its one safety property ─────
//
// A Teams conversation can now be blocked (every send swallowed), GOVERNED
// (prompts scanned, Tokenize & Send offered, nothing ever swallowed) or
// untouched. The behavioural cases live in tests/enforcer-panel-block.test.mjs;
// these are the SOURCE invariants for the property that matters most —
// a governed-only tick must never be able to produce a block, by any route.

test('THE SAFETY PROPERTY: a DLP-governed tick can never contribute to a block', async () => {
  const src = await enforcerSrc();
  // psCodeOnly, not codeOnly: this file's own header documents the flag in a
  // PowerShell (#) comment, and the reference count below has to be of CODE.
  const code = psCodeOnly(src);

  // 1. BLOCKED WINS STRUCTURALLY. dlpGoverned requires !blockGoverned, so the
  //    two states are mutually exclusive at the point they are computed — not by
  //    a later precedence check that a future edit could reorder.
  const tick = src.slice(src.indexOf('static void ApplyForegroundTick('), src.indexOf('// When a block is active, locate the send button'));
  assert.ok(tick.length > 0, 'expected an ApplyForegroundTick body');
  assert.match(tick, /bool blockGoverned = hostSurfaceOk\r?\n\s*&& agentOutcome == AgentReadOutcome\.Named\r?\n\s*&& BlockedListHasMatchingAgentRow\(proc, agentName\);/);
  assert.match(tick, /dlpGoverned = !blockGoverned && hostSurfaceOk\r?\n\s*&& \(PanelDlpMatchesOnPanelAlone\(hit\)\r?\n\s*\|\| \(agentOutcome == AgentReadOutcome\.Named\r?\n\s*&& GovernedListHasMatchingAgentRow\(proc, agentName\)\)\);/);
  // The block half is EXACTLY the pre-existing rule: a Named read plus a
  // matching row in the BLOCKED list. The governed list is not part of it.
  const blockLine = tick.slice(tick.indexOf('bool blockGoverned ='), tick.indexOf('dlpGoverned = !blockGoverned'));
  assert.equal(/Governed(List|Agents)/.test(blockLine), false,
    'the block decision must not consult the governed list');

  // 2. THE FLAG IS READ IN EXACTLY ONE PLACE, and it is not a block decision.
  //    Counted the same way _fgAgentName is, so a new reference has to be
  //    re-reviewed rather than sliding in: the declaration, the per-tick
  //    assignment in ApplyForegroundTick, and the UpdatePendingRewrite gate.
  const uses = (code.match(/_fgDlpGoverned/g) || []).length;
  assert.equal(uses, 3, `_fgDlpGoverned gained a reference (${uses}) — every use must be re-reviewed`);
  assert.match(code, /static volatile bool _fgDlpGoverned = false;/);
  assert.match(code, /_fgDlpGoverned = dlpGoverned;/);
  assert.match(code, /if \(!_fgIsAi \|\| !PanelUiaOk\(\) \|\| \(_hostAppProcs\.Contains\(_app\) && !_fgDlpGoverned\) \|\| Disarmed\(\)\)/);

  // 3. NO BLOCK-DECISION CODE MENTIONS IT — or the governed list, or the
  //    governed privacy-gate set. CheckFgBlocked is the only place a block is
  //    armed; EnterBlockActive and BlockActiveForMouse are the only places one is
  //    acted on; the hook is where a keystroke is actually swallowed.
  const regions = [
    ['CheckFgBlocked', 'static void CheckFgBlocked()', 'static string BlockScope()'],
    ['EnterBlockActive', 'static bool EnterBlockActive(', 'static string ActivePatterns()'],
    ['HookCallback', 'static IntPtr HookCallback(', '// Scans the typed buffer'],
    ['EmitBlock', 'static void EmitBlock(', 'static void EmitRewrite('],
    ['OfferAccessRequest', 'static void OfferAccessRequest(', '// ── Tier B rewrite'],
  ];
  for (const [name, from, to] of regions) {
    const body = codeOnly(src.slice(src.indexOf(from), src.indexOf(to)));
    assert.ok(body.length > 0, `expected a ${name} body`);
    for (const forbidden of ['_fgDlpGoverned', '_governedList', '_dlpScopedProcs', 'GovernedListHasMatchingAgentRow', 'dlpGoverned']) {
      assert.equal(body.includes(forbidden), false, `${name} must not consult ${forbidden}`);
    }
  }

  // 4. The governed read writes NONE of the block state. Not _fgIsBlocked, not
  //    the scope, not the latch — it cannot even clear one, which is what keeps
  //    a governed-list refresh from disturbing an armed block.
  const gov = src.slice(src.indexOf('static void UpdateGovernedAgents()'), src.indexOf('// Does the CURRENT governed list hold'));
  assert.ok(gov.length > 0, 'expected an UpdateGovernedAgents body');
  for (const forbidden of ['_fgIsBlocked', 'ClearFgBlocked', '_blockScope', '_blockedByElement', 'ArmPanelBlockLatch', 'ClearPanelBlockLatch', '_blockedList']) {
    assert.equal(codeOnly(gov).includes(forbidden), false, `the governed read must not touch ${forbidden}`);
  }
  // …and it FAILS CLOSED in the DLP direction: a missing, malformed or
  // mid-write file governs nothing rather than half of something. Capturing
  // prompt content nobody asked for is the failure mode that matters here.
  assert.match(gov, /\{ _governedList\.Clear\(\); RebuildDlpScopedProcs\(\); return; \}/);
  assert.match(gov, /catch \{[\s\S]{0,400}_governedList = new List<Dictionary<string, string>>\(\);\r?\n\s*RebuildDlpScopedProcs\(\);/);
  // Only agent_scope:'agent' rows count. A platform-scoped governed row would
  // mean "monitor every prompt typed anywhere in this app", which for a host app
  // is exactly the whole-app capture the design exists to prevent.
  assert.match(gov, /d\["agent_scope"\] = ExtractJsonString\(item, "agent_scope"\);/);
  const rebuild = src.slice(src.indexOf('static void RebuildDlpScopedProcs()'), src.indexOf('// Does the CURRENT governed list hold'));
  assert.match(rebuild, /if \(!string\.Equals\(agent\["agent_scope"\], "agent", StringComparison\.OrdinalIgnoreCase\)\) continue;/);
  const match = src.slice(src.indexOf('static bool GovernedListHasMatchingAgentRow('), src.indexOf('// Is this panel one whose DLP governance'));
  assert.match(match, /if \(!string\.Equals\(agent\["agent_scope"\], "agent", StringComparison\.OrdinalIgnoreCase\)\) continue;/);
  // Same matching semantics as the blocked list — no second convention.
  assert.match(match, /if \(!PLATFORM_PROCS\.TryGetValue\(agent\["platform"\], out procs\)\) continue;/);
  assert.match(match, /if \(AgentNameMatches\(agentName, agent\["agent_name"\]\)\) return true;/);
  // The gate set is written in exactly one place, like _agentScopedProcs.
  assert.equal((code.match(/_dlpScopedProcs = procs;/g) || []).length, 1, 'exactly one place may write the DLP gate set');
  // A SEPARATE file, never merged with the blocked one: one wrong parse of a
  // merged file would either block a monitored agent or monitor a blocked one.
  assert.match(src, /"\.cloudfuze-aigov", "governed-agents\.json"\);/);
  assert.notEqual(src.indexOf('"blocked-agents.json"'), -1);
});

test('the Copilot tab\'s panel-alone DLP rule is CATALOG DATA, not a special case in the .ps1', async () => {
  // The .ps1 owns the comparison, ai-processes.js owns the data — the same rule
  // every panel signature already follows. A hardcoded "teams_copilot_composer"
  // in the C# would be a second place the catalog is written down, and the one
  // that silently stops matching when an id changes.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  assert.equal(code.includes('teams_copilot_composer'), false,
    'the panel id must arrive as data, never as a C# literal');
  assert.equal(code.includes('teams_composer'), false);
  const fn = src.slice(src.indexOf('static bool PanelDlpMatchesOnPanelAlone('), src.indexOf('// Does the CURRENT blocklist hold'));
  assert.ok(fn.length > 0, 'expected a PanelDlpMatchesOnPanelAlone body');
  // POSITIVE-ONLY: only the one literal opts in, so a null panel, an older
  // payload or a typo lands on the strict "a named row is required" side.
  assert.match(fn, /return hit != null && string\.Equals\(hit\.DlpMatch, "panel", StringComparison\.OrdinalIgnoreCase\);/);
  const load = src.slice(src.indexOf('static void LoadAiPanels(string json)'), src.indexOf('// CFAI_AGENT_SURFACES'));
  assert.match(load, /DlpMatch = string\.Equals\(JsStr\(d, "dlpMatch"\), "panel", StringComparison\.OrdinalIgnoreCase\) \? "panel" : "agent",/);

  // The catalog side: exactly ONE entry may carry the panel-alone rule, and it
  // is the composer with no non-AI use at all. Every other entry — above all
  // teams_composer, which is shared by every DM and channel post in Teams —
  // must require a named row.
  const { AI_PANELS, buildAiPanelConfig } = await import('../src/os_monitor/ai-processes.js');
  const panelAlone = AI_PANELS.filter((p2) => p2.dlpMatch === 'panel').map((p2) => p2.id);
  assert.deepEqual(panelAlone, ['teams_copilot_composer'],
    'only Teams\' embedded Copilot tab may be DLP-governed by panel match alone');
  assert.equal(AI_PANELS.find((p2) => p2.id === 'teams_composer').dlpMatch, 'agent');
  // …and the field survives the handoff for every entry, resolved to one of the
  // two words so the C# default and the JS default cannot drift.
  for (const entry of buildAiPanelConfig()) {
    assert.ok(['agent', 'panel'].includes(entry.dlpMatch), `${entry.id}.dlpMatch must be resolved`);
    const source = AI_PANELS.find((p2) => p2.id === entry.id);
    assert.equal(entry.dlpMatch, source.dlpMatch === 'panel' ? 'panel' : 'agent', `${entry.id}.dlpMatch`);
  }
});

test('the rewrite event carries the MASKED text only, and only on a verified send', async () => {
  // A deliberate, reviewed change to this channel's contract — it previously
  // carried no prompt content at all — made so the tokenization audit trail
  // matches the browser extension's, which has always recorded the masked
  // prompt for an enforcement_redact event. The narrowness is the safety:
  const src = await enforcerSrc();
  // NOTE the end marker: "// ── Request Access offer" also appears in the field
  // declarations far above, so slicing to it would produce an empty string.
  const fn = src.slice(src.indexOf('static void EmitRewrite('), src.indexOf('static void OfferAccessRequest('));
  assert.ok(fn.length > 0, 'expected an EmitRewrite body');
  // The parameter is `masked`, defaulted to null, and OMITTED from the JSON when
  // absent — so a consumer can tell "no content on this event" from "an empty
  // prompt", and every pre-existing failure line is byte-for-byte unchanged.
  assert.match(fn, /static void EmitRewrite\(string blockId, string result, string reason, string masked = null\)/);
  assert.match(fn, /\(masked != null \? ",\\"masked\\":\\"" \+ Esc\(masked\) \+ "\\"" : ""\)/);
  // There is NO parameter the original text could arrive through, and the
  // function reads no field that holds it.
  for (const forbidden of ['_pendingOriginalFull', 'original', '_typed', 'ReadText']) {
    assert.equal(codeOnly(fn).includes(forbidden), false, `EmitRewrite must not reach ${forbidden}`);
  }
  // EXACTLY ONE call site passes content, and it is the final verified-send line.
  const code = codeOnly(src);
  const withMasked = code.match(/EmitRewrite\([^)]*,\s*masked\)/g) || [];
  assert.deepEqual(withMasked, ['EmitRewrite(blockId, "ok", "sent", masked)'],
    'only the verified-send line may carry prompt content');
  // …and no call site anywhere passes the ORIGINAL.
  assert.equal(/EmitRewrite\([^)]*original[^)]*\)/.test(code), false,
    'the original text must never be emitted');

  // Esc() must escape control characters, or a multi-line masked prompt does not
  // merely produce invalid JSON — it SPLITS the NDJSON line, so the Node side
  // sees a truncated event followed by garbage. This protects `preview` (also a
  // masked substring) on the block event too.
  const esc = src.slice(src.indexOf('static string Esc(string s)'), src.indexOf('// Extended "block" event'));
  assert.ok(esc.length > 0, 'expected an Esc body');
  assert.match(esc, /if \(c == '\\\\'\) sb\.Append\("\\\\\\\\"\);/);
  assert.match(esc, /else if \(c == '"'\) sb\.Append\("\\\\\\""\);/);
  assert.match(esc, /else if \(c == '\\n'\) sb\.Append\("\\\\n"\);/);
  assert.match(esc, /else if \(c == '\\r'\) sb\.Append\("\\\\r"\);/);
  assert.match(esc, /else if \(c < ' ' \|\| c == \(char\)0x7f\) sb\.Append\("\\\\u"\)/);
});

test('enforcer.js forwards the rewrite event WHOLE, and logs no prompt content', async () => {
  // The wrapper is a transport: the event's shape is the .ps1's contract, so the
  // new `masked` field travels through untouched with nothing picked out or
  // reshaped. The audit record for it is the enforcement_redact event index.js
  // reports — never a log line, which is why this branch must stay log-free.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  const idx = src.indexOf("case 'rewrite':");
  assert.ok(idx >= 0, 'the wrapper must know this kind');
  const branch = codeOnly(src.slice(idx, src.indexOf("case 'route':")));
  assert.match(branch, /this\.emit\('rewrite', ev\);/);
  assert.equal(/this\.log/.test(branch), false, 'the masked prompt must never be logged');
  // No reshaping: the whole event object, not a picked-apart copy.
  assert.equal(/ev\.masked|ev\['masked'\]/.test(branch), false,
    'the wrapper must not read the content field at all');
});

test('the agent catalog is separate from AI_PANELS and adds no process to any watcher', async () => {
  // Same separation AI_PANELS/IDE_PROCESSES already keep, for the same reason: a
  // process name landing in the wrong catalog silently turns on clipboard and
  // attachment watching for a whole app. AGENT_SURFACES narrows an existing
  // block; it must never widen what is watched or scanned.
  const { AGENT_SURFACES, AI_PANELS } = await import('../src/os_monitor/ai-processes.js');
  const panelIds = new Set(AI_PANELS.map((p2) => p2.id));
  for (const surface of AGENT_SURFACES) {
    assert.equal(panelIds.has(surface.id), false, `${surface.id} collides with a panel id`);
  }
  const index = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.equal(/AGENT_SURFACES|buildAgentSurfaceConfig/.test(index), false,
    'index.js (which builds aiProcNames for every passive watcher) must not know about agent surfaces');
  for (const file of ['file-dialog-watcher.js', 'attachment-watcher.js', 'prompt-watcher.js']) {
    const w = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    assert.equal(/CFAI_AGENT_SURFACES|AGENT_SURFACES/.test(w), false,
      `${file} must know nothing about agent surfaces`);
  }
});

test('enforcer-win.ps1: the agent-surface catalog FAILS CLOSED on a bad payload', async () => {
  // The opposite direction from LoadAiPanels, and deliberately so. An empty PANEL
  // catalog means "do not scan an editor", which is safe. An empty AGENT-SURFACE
  // catalog means "do not NARROW a block" — also safe, because an agent-scoped
  // row then falls back to the whole-app block it produces today.
  const src = await enforcerSrc();
  assert.match(src, /static List<AgentSurface> _agentSurfaces = new List<AgentSurface>\(\);/);
  const load = src.slice(src.indexOf('static void LoadAgentSurfaces(string json)'), src.indexOf('static AgentSurface MatchAgentSurface(string proc)'));
  assert.ok(load.length > 0, 'expected a LoadAgentSurfaces body');
  // Assigned only at the very end, so a throw leaves the list empty rather than
  // half-populated.
  assert.match(load, /_agentSurfaces = surfaces;\s*\r?\n\s*\}/);
  assert.equal((load.match(/_agentSurfaces = /g) || []).length, 1, 'exactly one assignment, at the end');
  // A surface with nothing to match on can never match, so it is dropped rather
  // than kept as a half-entry.
  assert.match(load, /if \(procs\.Count == 0\) continue;/);
  assert.match(load, /if \(prefixes\.Count == 0\) continue;/);
  // The caller catches, so a malformed payload cannot take the helper down.
  assert.match(src, /try \{ LoadAgentSurfaces\(agentSurfacesJson\); \}\r?\n\s*catch \(Exception ex\) \{ Emit\("error", "", "", "agent_surfaces_load_failed"/);
  // Narrowing requires BOTH flags, in one place, so no call site can forget one.
  const enforcing = src.slice(src.indexOf('static AgentSurface EnforcingAgentSurface(string proc)'), src.indexOf('// Trim + collapse internal whitespace'));
  assert.match(enforcing, /return \(s\.Verified && s\.Enforce\) \? s : null;/);
});

test('enforcer-win.ps1: the agent read is ONE property read, pid-checked, and never a tree walk', async () => {
  const src = await enforcerSrc();
  const read = src.slice(src.indexOf('static AgentReadOutcome ReadFocusedAgentName('), src.indexOf('static readonly char[] CLASS_TOKEN_SEP'));
  assert.ok(read.length > 0, 'expected a ReadFocusedAgentName body');
  assert.match(read, /AutomationElement\.FocusedElement/);
  assert.equal((read.match(/AutomationElement\.FocusedElement/g) || []).length, 1, 'exactly one read');
  assert.equal(/FindAll|TreeWalker|GetFirstChild/.test(read), false, 'agent detection must not walk the tree');
  // The pid check is non-negotiable: FocusedElement is a GLOBAL read that was
  // measured returning an element from another window in another process, and
  // nothing it says is evidence about the foreground surface unless the element
  // belongs to it. It is delegated to ElementPidBelongsToForeground — one place,
  // so the panel path's own exact-match check cannot drift into it by accident —
  // and a rejection is Unreadable (no evidence), never "no agent open".
  assert.match(read, /if \(!ElementPidBelongsToForeground\(el\.Current\.ProcessId, fgPid\)\) return AgentReadOutcome\.Unreadable;/);
  assert.match(read, /catch \{ return AgentReadOutcome\.Unreadable; \}/);
  const ownIdx = read.indexOf('ElementPidBelongsToForeground(');
  assert.ok(ownIdx >= 0 && ownIdx < read.indexOf('el.Current.Name'), 'the ownership check must precede any property read');
  // Every property read is individually try/caught — reading another process's
  // accessibility tree throws routinely.
  assert.match(read, /try \{ name = el\.Current\.Name \?\? ""; \} catch \{ \}/);
  // A missing control type or Name is a READ FAILURE, never the authoritative
  // "no agent is open" — that distinction is what the latch keys on.
  assert.match(read, /if \(ctName\.Trim\(\)\.Length == 0 \|\| name\.Trim\(\)\.Length == 0\) return AgentReadOutcome\.Unreadable;/);
  // Nothing read here may ever reach an emitter.
  assert.equal(/Emit\(|EmitBlock\(|Console\.Out/.test(read), false, 'agent detection must emit nothing');
});

test('enforcer-win.ps1: the WebView2 pid rule accepts a DIRECT child and nothing further', async () => {
  // The bug the 2026-08-27 live pass found. M365Copilot.exe hosts its UI in
  // WebView2, so the composer element is UIA-owned by a CHILD msedgewebview2.exe
  // process; an exact pid match against the foreground window's process therefore
  // read Unreadable on every single tick and the narrowing could never arm.
  //
  // The fix must not become "accept any ancestor": one generation is what a
  // Chromium host needs, and walking further would start accepting whatever an
  // unrelated app happened to launch. Driven behaviourally with real child
  // processes in tests/enforcer-panel-block.test.mjs.
  const src = await enforcerSrc();
  const own = src.slice(
    src.indexOf('static bool ElementPidBelongsToForeground(int elPid, uint fgPid)'),
    src.indexOf('// Returns the parent pid of `pid`'),
  );
  assert.ok(own.length > 0, 'expected an ElementPidBelongsToForeground body');
  assert.match(own, /if \(elPid == \(int\)fgPid\) return true;/);
  assert.match(own, /return GetParentProcessId\(elPid\) == \(int\)fgPid;/);
  // ONE generation: no ancestor walk, no recursion.
  assert.equal(/while|for \(|ElementPidBelongsToForeground\(/.test(own.slice(own.indexOf('{'))), false,
    'the ownership rule must not walk further than one generation');

  // The parent lookup itself: snapshot-based, handle always released, and it can
  // only ever fail CLOSED (-1 matches no pid, so the element is rejected).
  const parent = src.slice(
    src.indexOf('static int GetParentProcessId(int pid)'),
    src.indexOf('struct MSG {'),
  );
  assert.ok(parent.length > 0, 'expected a GetParentProcessId body');
  assert.match(parent, /if \(snap == IntPtr\.Zero\) return -1;/);
  assert.match(parent, /catch \{ return -1; \}/);
  assert.match(parent, /finally \{ if \(snap != IntPtr\.Zero\) CloseHandle\(snap\); \}/);
  // Enumeration only — nothing opens, reads or touches another process.
  assert.equal(/OpenProcess|ReadProcessMemory|TerminateProcess/.test(parent), false,
    'the parent lookup must only enumerate, never open another process');
  // And the snapshot is taken in exactly one place, on the poll thread's path.
  const code = codeOnly(src);
  assert.equal((code.match(/CreateToolhelp32Snapshot\(TH32CS_SNAPPROCESS/g) || []).length, 1,
    'exactly one snapshot site');
  assert.equal((code.match(/ElementPidBelongsToForeground\(/g) || []).length, 4,
    'the rule is declared once and called three times — the agent read, the host-app panel '
    + 'read, and the Copilot-tab heading search. Every call site must go through THIS rule; '
    + 'a new one that rolls its own pid check is what this count exists to catch');
  // The third call site: the background heading search for Teams' Copilot tab.
  // It starts from AutomationElement.FocusedElement like the other two, so it
  // needs the identical ownership rule — the same GLOBAL-read hazard, and the
  // same WebView2 child process.
  const search = src.slice(
    src.indexOf('static void SearchCopilotHeadingsBackground('),
    src.indexOf('static void CollectCopilotHeadings('),
  );
  assert.ok(search.length > 0, 'expected a SearchCopilotHeadingsBackground body');
  assert.match(search, /if \(ElementPidBelongsToForeground\(el\.Current\.ProcessId, fgPid\)\)/);
  assert.ok(search.indexOf('ElementPidBelongsToForeground(') < search.indexOf('GetParent('),
    'the ownership check must precede any tree walk');
  // The PANEL read's DEFAULT stays exact-pid: VS Code and Cursor were verified
  // live with it, and widening a code editor's read is a separate decision with
  // its own false-positive surface. The one-generation rule is reachable there
  // only via `allowChildProcess`, which only the HOST-APP call site passes —
  // ms-teams.exe hosts its composer in a child msedgewebview2.exe, confirmed
  // live via Win32_Process ParentProcessId, exactly as M365Copilot does.
  const panelRead = src.slice(src.indexOf('static PanelSig ReadFocusedPanel('), src.indexOf('static bool PanelEnforceOk()'));
  assert.ok(panelRead.length > 0, 'expected a ReadFocusedPanel body');
  assert.match(panelRead, /if \(allowChildProcess\) \{ if \(!ElementPidBelongsToForeground\(el\.Current\.ProcessId, fgPid\)\) return null; \}/);
  assert.match(panelRead, /else if \(el\.Current\.ProcessId != \(int\)fgPid\) return null;/);
  assert.equal(/GetParentProcessId/.test(panelRead), false,
    'the panel read must go through the shared rule, never its own parent lookup');
  // Every IDE call site still passes false.
  const fg = src.slice(src.indexOf('static void UpdateForeground()'), src.indexOf('static void ApplyForegroundTick('));
  assert.match(fg, /if \(isIde\) hit = ReadFocusedPanel\(proc, pid, out panelRid, out panelReadable, false\);/);
  assert.match(fg, /else if \(hostAppArmed\) hit = ReadFocusedPanel\(proc, pid, out panelRid, out panelReadable, true\);/);
});

test('enforcer-win.ps1: the agent name read out of another app is never emitted or logged', async () => {
  // The strictest rule in this feature. _fgAgentName holds a display string read
  // from ANOTHER APP's accessibility tree. It is compared against the blocklist
  // and nothing else. Every name that reaches stdout comes from the blocked ROW
  // (admin-typed) — _blockedAgentName — never from the read.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  const uses = (code.match(/_fgAgentName/g) || []).length;
  assert.ok(uses > 0, 'expected _fgAgentName to exist');
  // Exactly three code references: the declaration, the per-tick assignment in
  // ApplyForegroundTick, and the one comparison in CheckFgBlocked.
  assert.equal(uses, 3, `_fgAgentName gained a reference (${uses}) — every use must be re-reviewed for PII`);
  assert.match(code, /static volatile string _fgAgentName = "";/);
  assert.match(code, /_fgAgentName = agentName \?\? "";/);
  assert.match(code, /AgentNameMatches\(_fgAgentName, agent\["agent_name"\]\)/);
  // And it appears in no emitter at all.
  for (const [name, from, to] of [
    ['Emit', 'static void Emit(string kind', 'static string Esc(string s)'],
    ['EmitBlock', 'static void EmitBlock(', 'static void EmitRewrite('],
    ['EmitBlockState', 'static void EmitBlockState(', 'static void ClearFgBlocked()'],
  ]) {
    const fn = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(fn.length > 0, `expected a ${name} body`);
    assert.equal(/_fgAgentName|_fgAgentOutcome/.test(fn), false, `${name} must not carry the read agent name`);
  }
});

// ── The SECOND Teams UI route: the embedded Copilot tab ─────────────────────
//
// Teams' Copilot tab keeps a GENERIC, CONSTANT window title regardless of which
// agent is open (measured live 2026-09), so the title parse correctly reads NO
// EVIDENCE there and that route was a silent detection gap. Closing it needs a
// tree walk, which is exactly what the poll-thread read path must never do — so
// the mechanism is a background search plus a cache, modelled on the model
// picker's, and it sits behind its OWN two flags, separate from the Chat-list
// route's. It shipped inert behind them and went live on its own pass
// (2026-09-02); the gate itself is what these tests pin.

test('enforcer-win.ps1: the Copilot-tab fallback is INERT unless BOTH of its own flags are true', async () => {
  // The whole point of a second flag pair. teams_desktop itself has been
  // Verified+Enforce for the Chat-list route since 2026-08-30; this route had to
  // do NOTHING — no tree walk, no thread, no cache write — until its OWN pair was
  // flipped by its own live pass. Both flags are read in ONE place, mirroring
  // EnforcingAgentSurface, so no call site can forget one. The gate stays exactly
  // as strict now that the flags are true: it is what keeps the NEXT route inert.
  const src = await enforcerSrc();
  const armed = src.slice(
    src.indexOf('static bool FallbackReadArmed(AgentSurface surface, string kind)'),
    src.indexOf('// The title-mode read, in two stages.'),
  );
  assert.ok(armed.length > 0, 'expected a FallbackReadArmed body');
  assert.match(armed, /if \(!\(surface\.FallbackVerified && surface\.FallbackEnforce\)\) return false;/);
  // …and the mode opt-in, so a surface with no fallback block (m365_copilot)
  // can never reach any of this even if the flags were somehow set.
  assert.match(armed, /if \(!string\.Equals\(surface\.FallbackMode, "message_heading", StringComparison\.OrdinalIgnoreCase\)\) return false;/);
  // The KIND gate is the third condition, and it is checked against
  // FallbackPaneKinds — NOT TitleKinds. Conflating the two would make the primary
  // parse read this route's tenant/org segment as the open agent's name.
  assert.match(armed, /return surface\.FallbackPaneKinds\.Contains\(kind\);/);
  assert.equal(/TitleKinds/.test(armed), false, 'the pane gate must not consult TitleKinds');

  // The gate is the FIRST thing the fallback path does, before any search: the
  // stage-B branch returns the primary outcome untouched when it is not armed.
  const stage = src.slice(
    src.indexOf('static AgentReadOutcome ReadTitleModeAgentName('),
    src.indexOf('// The poll thread\'s half: read the cache, never wait on a search.'),
  );
  assert.ok(stage.length > 0, 'expected a ReadTitleModeAgentName body');
  // Stage A first, and anything AUTHORITATIVE returns immediately — the fallback
  // can only ever ADD coverage on no evidence, never override a title that DID
  // name a conversation.
  assert.match(stage, /AgentReadOutcome outcome = ExtractAgentName\(surface, "", title, out agentName\);/);
  assert.match(stage, /if \(outcome != AgentReadOutcome\.NotComposer\) return outcome;/);
  assert.match(stage, /if \(!FallbackReadArmed\(surface, kind\)\) return outcome;/);
  assert.ok(stage.indexOf('FallbackReadArmed(') < stage.indexOf('GetCachedCopilotHeadings('),
    'nothing may be searched before the gate is decided');
  // Exactly one caller of the search-and-cache entry point, and it is behind that
  // gate. A second call site would be a way around it.
  const code = codeOnly(src);
  assert.equal((code.match(/GetCachedCopilotHeadings\(/g) || []).length, 2,
    'declared once, called once — only the gated stage-B branch may reach the cache');
  // And the catalog really does ship both flags true, so the gated path above is
  // the live one — which is exactly why the gate's shape is pinned so tightly.
  const { AGENT_SURFACES } = await import('../src/os_monitor/ai-processes.js');
  const fb = AGENT_SURFACES.find((s2) => s2.id === 'teams_desktop').fallbackRead;
  assert.ok(fb, 'the fallbackRead block is missing');
  assert.equal(fb.enforce, true, 'the Copilot-tab route enforces after its 2026-09-02 live pass');
  assert.equal(fb.verified, true, 'enforce may only be true because that pass was recorded');
});

test('enforcer-win.ps1: the Copilot-tab walk reads ClassName FIRST and never keeps message text', async () => {
  // THE privacy rule of this mechanism, and it has to be enforced in code, not by
  // convention: in a Chromium accessibility tree an ordinary message body's Name
  // IS the message text. A walk that read every Name would be reading the user's
  // conversation with the agent.
  const src = await enforcerSrc();
  const collect = src.slice(
    src.indexOf('static void CollectCopilotHeadings('),
    src.indexOf('// ── Model routing'),
  );
  assert.ok(collect.length > 0, 'expected a CollectCopilotHeadings body');
  // ClassName is read first, unconditionally; the class decision is made from it
  // before any Name read exists at all.
  const clsIdx = collect.indexOf('cls = el.Current.ClassName');
  const nameIdx = collect.indexOf('nm = el.Current.Name');
  assert.ok(clsIdx >= 0 && nameIdx >= 0, 'expected both property reads');
  assert.ok(clsIdx < nameIdx, 'ClassName must be read before Name');
  assert.match(collect, /bool isHeading = headingClass\.Length > 0 && cls\.Length > 0\r?\n\s*&& ClassRuleMatches\(cls, headingClass, false\);/);
  // A Name is read only for a class-matched heading or a Text control, and is
  // KEPT only when the class matched or the landing infix is present. Everything
  // else is a local that goes out of scope unreferenced.
  assert.match(collect, /if \(isHeading \|\| isText\)/);
  assert.match(collect, /if \(nm\.Length > 0\r?\n\s*&& \(isHeading \|\| nm\.IndexOf\(infix, StringComparison\.OrdinalIgnoreCase\) > 0\)\)/);
  // Exactly ONE place appends to the collected lists.
  assert.equal((codeOnly(collect).match(/names\.Add\(/g) || []).length, 1,
    'exactly one place may keep a Name');
  // The walk is bounded three independent ways — depth, node count and how many
  // candidates may be kept — so a long transcript cannot make it expensive.
  assert.match(collect, /if \(cur\.Value > COPILOT_WALK_MAX_DEPTH\) continue;/);
  assert.match(collect, /if \(\+\+visited > COPILOT_WALK_MAX_NODES\) break;/);
  assert.match(collect, /if \(names\.Count < COPILOT_MAX_HEADINGS\)/);
  assert.match(src, /const int COPILOT_WALK_MAX_DEPTH = 30;/);
});

test('enforcer-win.ps1: nothing read off a Copilot-tab heading may ever be emitted or logged', async () => {
  // Same rule the window-title read already follows, and for the same reason: the
  // strings collected here come out of another app's accessibility tree. They are
  // compared against the blocklist and dropped. Every name that reaches stdout
  // comes from the blocked ROW (admin-typed).
  const src = await enforcerSrc();
  const section = src.slice(
    src.indexOf('// ── Copilot-tab heading fallback: background search + cache ──'),
    src.indexOf('// ── Model routing'),
  );
  assert.ok(section.length > 0, 'expected the Copilot-tab fallback section');
  // codeOnly, because the comments in this section deliberately NAME the thing
  // the code must not do — the explanation must not trip the test it explains.
  assert.equal(/Emit\(|EmitBlock\(|EmitBlockState\(|EmitRewrite\(|EmitRoute\(|Console\.Out|Console\.Error/.test(codeOnly(section)), false,
    'the Copilot-tab fallback must emit nothing at all');
  // The pure extractor likewise.
  const extract = src.slice(
    src.indexOf('static AgentReadOutcome ExtractAgentNameFromHeading('),
    src.indexOf('// C# port of agentNameMatches()'),
  );
  assert.ok(extract.length > 0, 'expected an ExtractAgentNameFromHeading body');
  assert.equal(/Emit\(|EmitBlock\(|Console\.Out/.test(extract), false);
  // The collected strings live in exactly two fields, and neither reaches an
  // emitter. Counted the same way _fgAgentName is, so a new reference has to be
  // re-reviewed for PII rather than sliding in.
  const code = codeOnly(src);
  // _copilotCacheNames: the declaration, the cache-validity check, the
  // invalidation, the hand-off to the poll thread, and the one write in the
  // background search. _copilotCacheClasses is the same minus the validity check
  // (only the names array is tested for null).
  for (const [field, expected] of [['_copilotCacheNames', 5], ['_copilotCacheClasses', 4]]) {
    const uses = (code.match(new RegExp(field, 'g')) || []).length;
    assert.ok(uses > 0, `expected ${field} to exist`);
    assert.equal(uses, expected, `${field} gained a reference (${uses}) — every use must be re-reviewed for PII`);
  }
  for (const [name, from, to] of [
    ['Emit', 'static void Emit(string kind', 'static string Esc(string s)'],
    ['EmitBlock', 'static void EmitBlock(', 'static void EmitRewrite('],
    ['EmitBlockState', 'static void EmitBlockState(', 'static void ClearFgBlocked()'],
    ['EmitRoute', 'static void EmitRoute(', 'static readonly object _routeLock'],
  ]) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(body.length > 0, `expected a ${name} body`);
    for (const forbidden of ['_copilotCache', 'heading', 'Heading']) {
      assert.equal(body.includes(forbidden), false, `${name} must not carry a pane heading (${forbidden})`);
    }
  }
  // The extracted name still leaves through `out agentName` into _fgAgentName,
  // which its own test pins at exactly three references, none an emitter.
});

test('enforcer-win.ps1: the Copilot-tab search runs OFF the poll thread and is throttled', async () => {
  // Two measured facts in this file force the shape, and both are about cost and
  // reliability rather than taste: a full FindAll(Descendants) walk was 1.4-5.8s
  // live (so it cannot run inline in a 150ms loop), and a property-FILTERED
  // FindAll against a Chromium-hosted app's own web-rendered controls found
  // nothing at all while a plain TreeWalker found the target easily.
  const src = await enforcerSrc();
  const section = src.slice(
    src.indexOf('// ── Copilot-tab heading fallback: background search + cache ──'),
    src.indexOf('// ── Model routing'),
  );
  // A manual TreeWalker, never a filtered FindAll. codeOnly, because the section
  // header explains WHY FindAll is wrong here and must not trip its own check.
  assert.match(section, /TreeWalker\.ControlViewWalker/);
  assert.equal(/FindAll\(|PropertyCondition|OrCondition/.test(codeOnly(section)), false,
    'a property-filtered FindAll is measured unreliable against this app');
  // Its own background STA thread, with the same reentrancy guard + min-interval
  // shape GetCachedModelPicker uses. The poll thread never waits on it.
  assert.match(section, /var t = new Thread\(\(\) => SearchCopilotHeadingsBackground\(surface, fg, paneKey\)\);/);
  assert.match(section, /t\.SetApartmentState\(ApartmentState\.STA\);/);
  assert.match(section, /if \(!_copilotSearchInProgress && \(newPane \|\| \(now - _copilotLastSearchTicks\) > interval\)\)/);
  assert.match(section, /finally \{ _copilotSearchInProgress = false; \}/);
  // Throttled to ~1s, backing off to 5s once the pane has repeatedly yielded
  // nothing, so an idle Copilot home view never spins.
  assert.match(src, /static readonly long COPILOT_SEARCH_MIN_INTERVAL = TimeSpan\.FromSeconds\(1\)\.Ticks;/);
  assert.match(src, /static readonly long COPILOT_SEARCH_BACKOFF_INTERVAL = TimeSpan\.FromSeconds\(5\)\.Ticks;/);
  // The cached answer EXPIRES — the fail-OPEN bound a host app requires, since
  // switching agents inside the Copilot tab changes neither the window handle
  // nor the title kind.
  assert.match(src, /static readonly long COPILOT_CACHE_TTL = TimeSpan\.FromSeconds\(5\)\.Ticks;/);
  assert.match(section, /&& \(now - _copilotCacheTicks\) <= COPILOT_CACHE_TTL\)/);
  // A search that found nothing must not half-apply: the cache is written only
  // when there is something to write.
  assert.match(section, /if \(names\.Count > 0\)\r?\n\s*\{\r?\n\s*_copilotCacheClasses = classes\.ToArray\(\);/);
});

test('enforcer-win.ps1: the heading cache is keyed per PANE, not per title kind', async () => {
  // WHY. Observed live 2026-09-04: Teams served the four-segment Copilot-tab
  // title shape ("Copilot | <tenant> | <email> | Microsoft Teams", no
  // conversation name at all) for a CHAT-LIST conversation the user had not
  // navigated away from. Both Teams routes live in ONE window, so from that
  // moment (window handle, title kind) was the SAME key for two genuinely
  // different panes, and a cache filled from one could be served to the other
  // for up to the TTL. Naming the WRONG agent is as wrong as naming none.
  //
  // The focused panel id is what still separates them: teams_composer is the
  // Chat-list CKEditor, teams_copilot_composer is the Copilot tab's Fluent
  // editor, and no element can match both (no shared class token — asserted in
  // ai-processes.test.mjs).
  const src = await enforcerSrc();
  const code = codeOnly(src);
  // ONE definition of the pane key, so the cache read, the search key and the
  // cache write cannot drift apart.
  assert.match(code, /static string PaneKeyOf\(string kind, string panelId\)/);
  assert.equal((code.match(/PaneKeyOf\(/g) || []).length, 2,
    'declared once, called once — the single stage-B call site');
  assert.match(code, /GetCachedCopilotHeadings\(surface, fgHwnd, PaneKeyOf\(kind, panelId\), out classes, out names\)/);
  // The kind alone must no longer be a cache key anywhere.
  assert.equal(/_copilotCacheKind|_copilotSearchKind/.test(code), false,
    'the kind-only cache key is what the 2026-09-04 title collision broke');
  const section = src.slice(
    src.indexOf('// ── Copilot-tab heading fallback: background search + cache ──'),
    src.indexOf('// ── Model routing'),
  );
  assert.match(section, /string\.Equals\(_copilotCachePane \?\? "", paneKey \?\? "", StringComparison\.OrdinalIgnoreCase\)/);
  assert.match(section, /\|\| !string\.Equals\(_copilotSearchPane \?\? "", paneKey \?\? "", StringComparison\.OrdinalIgnoreCase\);/);
  // `newPane` is also what resets the empty-runs backoff, which is the second
  // half of the same defect: with kind alone, an idle Copilot home view's three
  // empty runs carried over into a re-titled Chat-list conversation and delayed
  // the block there by up to the 5s backoff.
  assert.match(section, /if \(newPane\) _copilotEmptyRuns = 0;/);
  // The panel id reaches the read as DATA, not as a gate — the gate stays the
  // title's kind, so a DM or a renamed group chat can still never be walked.
  const fg = src.slice(src.indexOf('static void UpdateForeground()'), src.indexOf('static void ApplyForegroundTick('));
  assert.match(fg, /ReadFocusedAgentName\(surface, pid, fg, hit != null \? hit\.Id : "", out agentName\)/);
  const stage = src.slice(
    src.indexOf('static AgentReadOutcome ReadTitleModeAgentName('),
    src.indexOf('// The poll thread\'s half: read the cache, never wait on a search.'),
  );
  assert.equal(/if \(panelId/.test(stage), false, 'the panel id must not become a second gate');
});

test('enforcer-win.ps1: the ancestor search is depth-agnostic and shares ONE node budget', async () => {
  // The old shape hopped exactly COPILOT_PANE_PARENT_HOPS parents and collected
  // from that one ancestor — an assumption about how deeply ONE route nests its
  // composer, measured only for the Copilot tab. From 2026-09-04 the same search
  // also serves the Chat-list CKEditor, whose nesting was never measured, so it
  // collects at each hop from the nearest outward and stops at the first
  // ancestor that yields a heading.
  const src = await enforcerSrc();
  const search = src.slice(
    src.indexOf('static void SearchCopilotHeadingsBackground('),
    src.indexOf('static void CollectCopilotHeadings('),
  );
  assert.ok(search.length > 0, 'expected a SearchCopilotHeadingsBackground body');
  // Collect INSIDE the hop loop, and stop as soon as something was found.
  assert.match(search, /for \(int i = 0; i < COPILOT_PANE_PARENT_HOPS && names\.Count == 0; i\+\+\)/);
  assert.match(search, /CollectCopilotHeadings\(surface, cur, classes, names, ref visited\);/);
  // The budget is declared once for the whole ancestor search and passed by
  // reference, so N ancestors cost ONE node cap in total rather than N.
  // Otherwise the cap — the only thing bounding this walk against a long
  // transcript — would stop bounding anything.
  assert.match(search, /int visited = 0;/);
  const collect = src.slice(
    src.indexOf('static void CollectCopilotHeadings('),
    src.indexOf('// ── Model routing'),
  );
  assert.match(collect, /List<string> names, ref int visited\)/);
  assert.equal(/int visited = 0;/.test(collect), false,
    'the walk must not reset the shared budget it was handed');
  // Strategy 2 discards strategy 1's result, so it gets its own budget.
  assert.match(search, /int winVisited = 0;/);
  assert.match(search, /CollectCopilotHeadings\(surface, win, classes, names, ref winVisited\);/);
});

test('enforcer-win.ps1: the Copilot-tab route leaves the primary title path untouched', async () => {
  // The stage-B branch may only ADD an outcome on no evidence. Everything
  // downstream — CheckFgBlocked, the governed gate, the host-app whole-app-block
  // exclusion, PanelUiaOk/PanelEnforceOk, the latch and its retirement rules —
  // consumes the same AgentReadOutcome enum and is deliberately unchanged.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  // Still exactly one window-title read site, still inside ReadFocusedAgentName.
  assert.equal((code.match(/GetWindowText\(/g) || []).length, 2);
  // The read site hands off to the two-stage reader, which begins with the
  // unchanged primary parse. No new outcome value, no new consumer.
  const read = src.slice(src.indexOf('static AgentReadOutcome ReadFocusedAgentName('), src.indexOf('static readonly char[] CLASS_TOKEN_SEP'));
  assert.match(read, /return ReadTitleModeAgentName\(surface, fgHwnd, title, panelId, out agentName\);/);
  assert.match(code, /enum AgentReadOutcome \{ Unreadable = 0, NotComposer = 1, Generic = 2, Named = 3 \}/);
  // …and the poll-thread read really is still one property read and no tree walk:
  // every walk lives in the background section, which is outside this slice.
  assert.equal(/FindAll|TreeWalker|GetFirstChild/.test(read), false);
  // m365_copilot's payload never carries the nested block at all, so the C# side
  // parses nothing new for it and its fallback fields stay empty/false — while
  // teams_desktop's nested pair ships true/true and really does arm the route.
  const { buildAgentSurfaceConfig } = await import('../src/os_monitor/ai-processes.js');
  const [m365, teams] = buildAgentSurfaceConfig();
  assert.equal(m365.id, 'm365_copilot');
  assert.equal('fallbackRead' in m365, false, 'm365_copilot must not gain a fallbackRead key');
  assert.equal(m365.read, 'composer_name');
  assert.equal(teams.id, 'teams_desktop');
  assert.equal(teams.fallbackRead.enforce, true);
  assert.equal(teams.fallbackRead.verified, true);
  // A malformed / partial fallback block is DROPPED, never half-applied — the
  // same "assign only at the end" discipline the rest of this parser uses.
  const load = src.slice(src.indexOf('static void LoadAgentSurfaces(string json)'), src.indexOf('static AgentSurface MatchAgentSurface(string proc)'));
  assert.match(load, /bool ok = string\.Equals\(mode, "message_heading", StringComparison\.OrdinalIgnoreCase\)\r?\n\s*&& paneKinds\.Count > 0\r?\n\s*&& headingClass\.Length > 0\r?\n\s*&& headingSuffix\.Length > 0\r?\n\s*&& landingInfix\.Length > 0;/);
  assert.match(load, /if \(ok\)\r?\n\s*\{\r?\n\s*fbMode = "message_heading";/);
  // The two delimiters must NOT be normalised on load: " said:" and " Created by "
  // carry the spaces that make them delimiters, and NormalizeAgentName would trim
  // exactly those.
  assert.match(load, /string headingSuffix = JsStr\(fb, "headingSuffix"\);/);
  assert.match(load, /string landingInfix = JsStr\(fb, "landingInfix"\);/);
});

test('enforcer-win.ps1: the extra accessibility read happens ONLY when an agent-scoped policy needs it', async () => {
  // PRIVACY GATE. Reading another app's accessibility tree to learn which agent
  // someone has open is justified only by a policy that needs the answer. Three
  // conditions, all required, and keyed on the CURRENT process rather than the
  // sticky _app so a tick can never read the wrong app.
  const src = await enforcerSrc();
  const fg = src.slice(src.indexOf('static void UpdateForeground()'), src.indexOf('// Everything UpdateForeground does once the focused-element read is in.'));
  assert.ok(fg.length > 0, 'expected an UpdateForeground body');
  assert.match(fg, /if \(\(!isIde && proc != null && _aiProcs != null && _aiProcs\.Contains\(proc\)\r?\n\s*&& _agentScopedProcs\.Contains\(proc\)\) \|\| hostAppArmed\)/);
  // `hit.Id` is handed down purely as part of the heading cache's pane key (see
  // _copilotCachePane), never as a gate — all gating on `hit` happens once, in
  // ApplyForegroundTick, which this same file pins separately.
  assert.match(fg, /if \(surface != null\) agentOutcome = ReadFocusedAgentName\(surface, pid, fg, hit != null \? hit\.Id : "", out agentName\);/);
  // A HOST APP reaches the read through hostAppArmed instead of _aiProcs — it is
  // deliberately absent from that set — and hostAppArmed is the STRICTER of the
  // two gates: it additionally requires the surface to have passed its live
  // pass. That is what makes an unverified host-app surface completely inert
  // (no title read, no accessibility read, no state at all) rather than merely
  // non-blocking, which is what an unverified CHAT-app surface is.
  // Either list satisfies the "is there a policy about an agent in this app"
  // half of the gate: a BLOCKED row (swallow the send) or a GOVERNED row (scan
  // the prompt and offer to tokenize). Both are an org instruction about an
  // agent inside this app; neither list naming it still means nothing is read.
  assert.match(fg, /bool hostAppArmed = !isIde && proc != null && _hostAppProcs\.Contains\(proc\)\r?\n\s*&& \(_agentScopedProcs\.Contains\(proc\) \|\| _dlpScopedProcs\.Contains\(proc\)\)\r?\n\s*&& EnforcingAgentSurface\(proc\) != null;/);
  const armedIdx = fg.indexOf('bool hostAppArmed =');
  assert.ok(armedIdx >= 0 && armedIdx < fg.indexOf('ReadFocusedPanel('),
    'the host-app gate must be decided before any read happens');
  // The gate's data is rebuilt with the blocklist, and only there.
  const rebuild = src.slice(src.indexOf('static void RebuildAgentScopedProcs()'), src.indexOf('// Arm the platform-block latch'));
  assert.ok(rebuild.length > 0, 'expected a RebuildAgentScopedProcs body');
  assert.match(rebuild, /if \(!string\.Equals\(agent\["agent_scope"\], "agent", StringComparison\.OrdinalIgnoreCase\)\) continue;/);
  assert.match(rebuild, /_agentScopedProcs = procs;/);
  const codeSrc = codeOnly(src);
  assert.ok(codeSrc.includes('static HashSet<string> _agentScopedProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);'));
  assert.equal((codeSrc.match(/_agentScopedProcs = procs;/g) || []).length, 1, 'exactly one place may write the gate set');
  // Dropping the file must drop the gate with it, or a removed policy would keep
  // licensing the read.
  assert.match(src, /_blockedList\.Clear\(\); RebuildAgentScopedProcs\(\); ClearFgBlocked\(\); return;/);
  // …and the scope really is parsed off each row.
  assert.match(src, /d\["agent_scope"\] = ExtractJsonString\(item, "agent_scope"\);/);
});

test('enforcer-win.ps1: an agent surface is NOT a panel, so M365Copilot capture is untouched', async () => {
  // PanelUiaOk/PanelEnforceOk decide whether this app's UIA content scanning and
  // typed-buffer capture may run. Making an agent surface set _fgIsPanel would
  // change both for Microsoft 365 Copilot — a capture regression dressed up as a
  // blocking feature. The chat-app branch must leave isPanel alone.
  const src = await enforcerSrc();
  const tick = src.slice(src.indexOf('static void ApplyForegroundTick('), src.indexOf('// When a block is active, locate the send button'));
  assert.ok(tick.length > 0, 'expected an ApplyForegroundTick body');
  const chatBranch = tick.slice(tick.indexOf('else if (proc != null && _aiProcs != null && _aiProcs.Contains(proc))'));
  assert.ok(chatBranch.length > 0, 'expected the chat-app branch');
  const chatCode = codeOnly(chatBranch.slice(0, chatBranch.indexOf('if (isAi)')));
  assert.equal(/isPanel = |panelEnforce = |panelId = /.test(chatCode), false,
    'the chat-app branch must not touch panel state');
  assert.match(chatCode, /isAi = true;/);
  // Only an AUTHORITATIVE outcome retires an agent latch, and only an agent one.
  assert.match(chatCode, /if \(AgentBlockLatched\(\)\r?\n\s*&& \(agentOutcome == AgentReadOutcome\.Generic \|\| agentOutcome == AgentReadOutcome\.Named\)\)/);
  assert.match(chatCode, /ClearPanelBlockLatch\(\);/);
  // The two NO-EVIDENCE outcomes must not appear as latch-retiring conditions.
  assert.equal(/Unreadable\)\s*\|\|/.test(chatCode), false, 'an unreadable read must not retire the latch');
  assert.equal(/NotComposer/.test(chatCode), false, 'a NotComposer read must not retire the latch');
  // And the two no-evidence outcomes are what the tail guard protects.
  const check = src.slice(src.indexOf('static void CheckFgBlocked()'), src.indexOf('static string BlockScope()'));
  assert.match(check, /bool noAgentEvidence = _fgAgentOutcome == AgentReadOutcome\.Unreadable\r?\n\s*\|\| _fgAgentOutcome == AgentReadOutcome\.NotComposer;/);
  assert.match(check, /if \(noAgentEvidence && AgentBlockLatched\(\) && PanelBlockLatchHeld\(\)\) return;/);
});

test('enforcer-win.ps1: agent-name matching is whole-string, normalised, and Regex-free', async () => {
  // WHOLE-STRING equality, not the substring test the browser extension uses: its
  // signal is a name found somewhere in a page header, this one is an exact
  // composer label, and a substring test here would let a row for "Advisor"
  // block "AI Learning Advisor".
  const src = await enforcerSrc();
  const match = src.slice(src.indexOf('static bool AgentNameMatches(string extracted, string blockedName)'), src.indexOf('// A SINGLE property read of the currently-focused element'));
  assert.ok(match.length > 0, 'expected an AgentNameMatches body');
  assert.match(match, /return string\.Equals\(a, b, StringComparison\.OrdinalIgnoreCase\);/);
  assert.equal(/IndexOf|Contains|StartsWith/.test(match), false, 'matching must not become a substring test');
  assert.match(match, /if \(a\.Length == 0 \|\| b\.Length == 0\) return false;/);
  // The Generic filter runs BEFORE matching, so an agent literally named
  // "Copilot" can never be matched through this mechanism.
  const extract = src.slice(src.indexOf('static AgentReadOutcome ExtractAgentName('), src.indexOf('static bool AgentNameMatches('));
  const genericIdx = extract.indexOf('return AgentReadOutcome.Generic;');
  const namedIdx = extract.indexOf('return AgentReadOutcome.Named;');
  assert.ok(genericIdx >= 0 && namedIdx > genericIdx, 'the Generic filter must precede the Named result');
  // Fixed literals, so no Regex — same rule the panel matcher holds to, and every
  // Regex in this file has to carry REGEX_TIMEOUT for a reason that must not be
  // reintroduced here.
  const section = src.slice(src.indexOf('static void LoadAgentSurfaces(string json)'), src.indexOf('static readonly char[] CLASS_TOKEN_SEP'));
  assert.equal(/new Regex\(|Regex\.(IsMatch|Match|Replace)/.test(section), false, 'no regex in the agent path');
  // The prefix list is DATA from the catalog, never a literal in here — the
  // English-only "Message " prefix is a locale limitation to be fixed by adding
  // an array element, not by editing C#.
  assert.equal(section.includes('"Message "'), false, 'the composer prefix must come from the catalog, not the .ps1');
});

test("blocked-agents-sync sanitises the server's per-agent rows before they reach the enforcer", async () => {
  // The latent bug this feature makes load-bearing. The .ps1 parses
  // blocked-agents.json with a hand-rolled extractor that derails on the WHOLE
  // FILE for one stray quote/backslash/brace in one value — silently dropping
  // every other block too. synthesizePlatformBlocks has always sanitised its
  // fields; the server's per-agent rows were sent RAW. That only risked a
  // corrupted display string before; now agent_name is the MATCHING KEY.
  const src = await readFile(BLOCKED_SYNC, 'utf8');
  // One import statement from the catalog module, carrying at least these three.
  // Matched by name rather than as a literal list so adding a helper (the
  // governed-agents pair did) cannot fail this case for the wrong reason.
  const catalogImports = src.match(/import \{[\s\S]*?\} from '\.\/ai-processes\.js';/g) || [];
  assert.equal(catalogImports.length, 1, 'the catalog must be imported once, in one statement');
  for (const name of ['filterBlockedAgents', 'synthesizePlatformBlocks', 'normalizeAgentRows']) {
    assert.match(catalogImports[0], new RegExp(`\\b${name}\\b`), `${name} must be imported from the catalog`);
  }
  assert.match(src, /const list = normalizeAgentRows\(Array\.isArray\(agentRows\) \? agentRows : \[\], log\)\r?\n\s*\.concat\(synthesizePlatformBlocks\(platforms\)\);/);
  // Agent rows still come FIRST, so a more specific per-agent block still wins:
  // CheckFgBlocked returns on its first match, so array order IS the precedence.
  const fn = src.slice(src.indexOf('async function refreshBlockedAgents('), src.indexOf('// ── Offline access-request queue'));
  assert.ok(fn.indexOf('normalizeAgentRows(') < fn.indexOf('synthesizePlatformBlocks('), 'agent rows must stay first');
  // And the exception filter still runs on the combined list, after this.
  assert.ok(fn.indexOf('const list =') < fn.indexOf('filterBlockedAgents(list'));
});

// ── Request Access at the moment of the block (non-Electron desktop) ─────────
//
// The Electron app is retired, and with it the ONLY trigger the desktop Request
// Access flow ever had. These pin the replacement, which is deliberately narrow:
// the enforcer offers a dialog from the send site it already blocks at, the
// long-lived hidden toast helper draws it on its own STA thread, and Node files
// the request with the enrolment token it already holds.
//
// THE STANDING RULE THIS FEATURE LIVES UNDER: this agent shows no persistent
// window, no taskbar entry and no tray icon. The dialog is the one exception,
// it exists for the length of one blocked send-attempt, and the assertions
// below are what keep it that way.

test('enforcer-win.ps1: the send site offers a Request Access dialog ALONGSIDE EmitBlock, not instead of it', async () => {
  const src = await enforcerSrc();
  const code = codeOnly(src);
  // The existing block emit is untouched and still first.
  assert.match(code, /string blockReason = attachHold \? "attachment" : "send";/);
  assert.match(code, /EmitBlock\(_app, pats, blockReason\);/);
  const emitIdx = code.indexOf('EmitBlock(_app, pats, blockReason);');
  const offerIdx = code.indexOf('OfferAccessRequest(_app, blockReason);');
  assert.ok(emitIdx >= 0 && offerIdx > emitIdx, 'the offer must come after EmitBlock, never replace it');
  // …and the swallow still happens.
  assert.match(code.slice(offerIdx, offerIdx + 200), /return \(IntPtr\)1;/);
  // EXACTLY TWO offer call sites, and they are the two sites that already
  // swallow a send: Enter (keyboard hook) and the send-button click (mouse
  // hook). A third would mean a new trigger, which is what "reuse the existing
  // block-emit hooks, add no new detection" rules out.
  assert.equal((code.match(/OfferAccessRequest\(/g) || []).length, 3,
    'exactly two OfferAccessRequest call sites (plus its definition)');
});

test('enforcer-win.ps1: the send-BUTTON click site offers the same dialog, on the same session latch', async () => {
  // Clicking the send arrow is a send attempt too — the common one in Teams and
  // Copilot — so a user who clicks instead of pressing Enter must not be left
  // with a block and no way to ask.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  // The pre-existing mouse-path emit is untouched, and the offer sits after it.
  assert.match(code, /EmitBlock\(_app, ActivePatterns\(\), "click"\);/);
  const emitIdx = code.indexOf('EmitBlock(_app, ActivePatterns(), "click");');
  const offerIdx = code.indexOf('OfferAccessRequest(_app, "click");');
  assert.ok(emitIdx >= 0 && offerIdx > emitIdx, 'the click offer must come after its EmitBlock, never replace it');
  // Both still live behind the same WM_LBUTTONDOWN guard and the same swallow,
  // so the offer cannot fire on button-UP (which would double it per click).
  const site = code.slice(code.indexOf('if (BlockActiveForMouse())'), offerIdx + 200);
  assert.match(site, /if \(msg == WM_LBUTTONDOWN\)/);
  assert.match(site, /return \(IntPtr\)1;/);
  // "click", never an attachment variant: this path has never drawn that
  // distinction, and changing the literal would change the blocked_for/how
  // index.js reports off the same event.
  assert.equal(/OfferAccessRequest\(_app, attachHold/.test(site), false);
  // Both sites call the SAME stateless function, so neither can drift into
  // having its own suppression rule. Rapid clicks cannot stack windows —
  // that is the helper's `Open` guard, which releases when the dialog closes —
  // and a click after one was answered offers again, exactly like Enter.
  const fn = src.slice(src.indexOf('static void OfferAccessRequest('), src.indexOf('// ── Tier B rewrite'));
  assert.equal(/_accessOffer|ACCESS_OFFER|DateTime\.UtcNow/.test(codeOnly(fn)), false,
    'no per-session or time-based suppression may live in the shared offer path');
});

test('enforcer-win.ps1: EVERY blocked send offers — the Request Access offer is stateless and self-gating', async () => {
  // MEASURED IN LIVE USE, and the reason the old one-per-block-session latch is
  // gone. A user got the dialog, submitted, was DECLINED by the admin, typed
  // their next message, pressed Enter, was blocked again — and got nothing,
  // because the latch remembered it had already offered for that block. They
  // were still blocked and now had no visible way to ask. A blocked send is
  // exactly the moment the offer is wanted, every time.
  const src = await enforcerSrc();
  const code = codeOnly(src);
  const fn = src.slice(src.indexOf('static void OfferAccessRequest('), src.indexOf('// ── Tier B rewrite'));
  assert.ok(fn.length > 0, 'expected an OfferAccessRequest body');
  // Only a real platform/agent/panel block, never an attachment hold and never
  // a pattern-based content block — asking for "access" makes no sense there.
  assert.match(fn, /if \(!_fgIsBlocked\) return;/);
  assert.match(fn, /if \(reason == "attachment"\) return;/);
  // EXACTLY those two early returns. A third is how a latch comes back: any new
  // "have we offered already?" gate has to fail this test and be argued for.
  assert.equal((codeOnly(fn).match(/return;/g) || []).length, 2,
    'the only gates are the block check and the attachment check');
  // NO PERSISTENT STATE, anywhere in the file — not a key, not a timestamp, not
  // a minimum interval.
  assert.equal(/_accessOffer|ACCESS_OFFER/.test(code), false,
    'the per-session offer latch must not come back');
  // …and the function itself keeps no clock and writes no field: it reads the
  // block that is in force right now and emits.
  assert.equal(/DateTime\.UtcNow/.test(codeOnly(fn)), false, 'the offer must not be time-gated');
  assert.equal(/^\s*_\w+ =(?!=)/m.test(codeOnly(fn)), false, 'the offer must assign to no static field');
  // ClearFgBlocked has nothing of its own to clear here any more — the block
  // identity it already resets is the only thing the offer reads.
  const clear = codeOnly(src.slice(src.indexOf('static void ClearFgBlocked()'), src.indexOf('static string ExtractJsonString(')));
  assert.equal(/_accessOffer/.test(clear), false);
  assert.match(clear, /_blockedAgentId = "";/);
});

test('enforcer-win.ps1: the Request Access offer carries ONLY blocklist-row identity — no read name, no title', async () => {
  // Same PII rule as EmitBlock/EmitBlockState, and for a stronger reason: these
  // values are what the user's access request is FILED under, so a parsed
  // conversation name here would be sent to the server and shown to an admin.
  const src = await enforcerSrc();
  const fn = src.slice(src.indexOf('static void OfferAccessRequest('), src.indexOf('// ── Tier B rewrite'));
  // The admin-typed / server-issued row values, and the block's own scope.
  assert.match(fn, /",\\"blocked_agent\\":\\"" \+ Esc\(_blockedAgentName\) \+ "\\""/);
  assert.match(fn, /",\\"blocked_agent_id\\":\\"" \+ Esc\(_blockedAgentId\) \+ "\\""/);
  assert.match(fn, /",\\"block_scope\\":\\"" \+ Esc\(scope\) \+ "\\""/);
  // NEVER the read one, and never a window title.
  for (const forbidden of ['_fgAgentName', '_fgAgentOutcome', '_copilotCache', 'GetWindowText', 'title', 'Title', 'heading', 'Heading', 'pats', 'preview']) {
    assert.equal(fn.includes(forbidden), false, `the offer must not carry ${forbidden}`);
  }
  // Emitted under the same stdout lock every other emit in this file uses, so a
  // line can never interleave with a block or a bar transition.
  assert.match(fn, /lock \(_emitLock\) \{ Console\.Out\.WriteLine\(json\); Console\.Out\.Flush\(\); \}/);
});

test('enforcer.js dispatches request_access_offer without logging it', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  const idx = src.indexOf("case 'request_access_offer':");
  assert.ok(idx >= 0, 'the enforcer wrapper must know this kind — otherwise it lands in the unknown-kind warn');
  const branch = codeOnly(src.slice(idx, src.indexOf("case 'enforcement_disarmed':")));
  assert.match(branch, /this\.emit\('requestaccessoffer', ev\);/);
  assert.equal(/this\.log/.test(branch), false, 'the block itself is already recorded by the block path');
});

test('toast-helper.ps1: show_request_dialog runs on its own STA thread and never blocks the stdin loop', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  // The command exists and is wired into the main switch.
  assert.match(src, /'show_request_dialog' \{ Show-CFAIRequestDialog \$cmd \}/);
  // A DEDICATED STA thread with its own message loop — never ShowDialog() on the
  // thread that owns the stdin read, which must keep pumping toasts while a
  // dialog is up.
  assert.match(src, /new Thread\(delegate\(\) \{ Run\(requestId, key, agentName, appName\); \}\)/);
  assert.match(src, /t\.SetApartmentState\(ApartmentState\.STA\);/);
  assert.match(src, /t\.IsBackground = true;/);
  assert.match(src, /Application\.Run\(form\);/);
  // Comments stripped BOTH ways — this file is PowerShell (#) wrapping C# (//),
  // and its header explains WHY there is no ShowDialog. Naming it there must not
  // trip the check on the code, same convention as codeOnly().
  assert.equal(/ShowDialog\(/.test(psCodeOnly(src)), false, 'a blocking ShowDialog would freeze the command loop');
  // The stdin loop is still a bare blocking ReadLine, unchanged.
  assert.match(src, /\$line = \[Console\]::In\.ReadLine\(\)/);
});

test('toast-helper.ps1: every stdout write goes through ONE lock', async () => {
  // Two writers now (the stdin loop and the dialog thread), so a half-written
  // result line could otherwise land inside a {"kind":"pong"}.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  assert.match(src, /lock \(OutLock\)\s*\r?\n\s*\{\s*\r?\n\s*Console\.Out\.WriteLine\(line\);/);
  // The PowerShell side writes only through that same path…
  assert.match(src, /function Write-CFAILine\(\[string\]\$line\) \{/);
  assert.match(src, /\[CfaiRequestDialog\]::Write\(\$line\)/);
  // …and the only remaining raw [Console]::Out use is Write-CFAILine's own
  // fallback for a build where the dialog type could not be compiled.
  const raw = psCodeOnly(src).match(/\[Console\]::Out\.WriteLine/g) || [];
  assert.equal(raw.length, 1, `raw stdout writes outside the lock: ${raw.length}`);
});

test('toast-helper.ps1: the dialog is ephemeral — no taskbar entry, one at a time, capped reason', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'toast-helper.ps1'), 'utf8');
  // The user's standing requirement: nothing this process shows may look like a
  // running app.
  assert.match(src, /form\.ShowInTaskbar = false;/);
  assert.equal(/NotifyIcon|ContextMenuStrip|TrayIcon/.test(src), false, 'no tray icon may ever be created here');
  // CONCURRENCY dedupe, and since the enforcer's per-session latch was removed
  // this is the guard that carries the weight: the enforcer now offers on every
  // blocked send, so holding Enter down would stack windows without it. Scoped
  // to "already on screen" only — the key is released when the form closes, so
  // the next attempt opens a fresh dialog. index.js keeps its own in-flight set
  // for the same window, but this is the layer that actually draws.
  assert.match(src, /if \(Open\.ContainsKey\(key\)\) return false;/);
  assert.match(src, /"action":"suppressed"/);
  // Client-side cap matching REASON_MAX in server/src/routes/access-requests.js.
  assert.match(src, /public const int ReasonMax = 500;/);
  assert.match(src, /box\.MaxLength = ReasonMax;/);
  // Submit / cancel are the only two outcomes, and cancel is also what a closed
  // window produces (the result is written after Application.Run returns).
  assert.match(src, /string action = "cancel";/);
  assert.match(src, /action = "submit";/);
  assert.match(src, /access_request_result/);
});

test('notify.js exposes the dialog without queueing it, and settles every waiter on helper exit', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'notify.js'), 'utf8');
  assert.match(src, /showRequestDialog\(\{ agentName = '', appName = '', dedupeKey = '' \} = \{\}\)/);
  // NOT queued behind `ready` like a toast is: a dialog that arrives after the
  // moment of the block has lost its context and would appear over whatever the
  // user moved on to.
  const fn = src.slice(src.indexOf('showRequestDialog({'), src.indexOf('#settleDialog(requestId, result)'));
  assert.equal(/queueBeforeReady/.test(fn), false, 'a dialog must never be queued for later');
  assert.match(fn, /if \(!this\.ready \|\| !this\.dialogSupported \|\| !this\.child\)/);
  assert.match(fn, /action: 'unavailable'/);
  // Correlated by a generated id, so two dialogs can never cross their answers.
  assert.match(fn, /const requestId = randomUUID\(\);/);
  assert.match(fn, /this\.pendingDialogs\.set\(requestId, \{ resolve, timer \}\);/);
  // A helper crash answers every waiter rather than leaving a promise that can
  // never settle.
  const exit = src.slice(src.indexOf("this.child.on('exit'"), src.indexOf("this.child.on('error'"));
  assert.match(exit, /this\.#settleDialog\(id, \{ action: 'unavailable', reason: '' \}\)/);
});

test('index.js files the access request with the enrolment token and the block scope', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  // Triggered by the enforcer's offer, never by anything this file detects.
  assert.match(src, /this\.enforcer\.on\('requestaccessoffer', \(ev\) => \{/);
  // ONE host resolver, shared with the block relay — a second copy is how an
  // approval silently fails to lift the block it was granted for.
  assert.match(src, /function blockToolHost\(ev\) \{\s*\r?\n\s*return hostForPanel\(ev\.panel\) \|\| hostForProcess\(ev\.process\) \|\| hostsForPlatform\(ev\.blocked_platform\)\[0\] \|\| '';/);
  assert.equal((src.match(/blockToolHost\(ev\)/g) || []).length, 3,
    'blockToolHost must have exactly two callers (plus its definition)');
  // block_scope is 'agent' ONLY with an identity to name — the server 400s
  // otherwise, and claiming agent scope for a whole-app block would mint an
  // agent-keyed exception that lifts nothing.
  const offer = src.slice(src.indexOf('async #offerAccessRequest(ev)'), src.indexOf('async #findOpenAccessRequest('));
  assert.match(offer, /ev\.block_scope === 'agent' && \(agentId \|\| agentName\)/);
  assert.match(offer, /ev\.block_scope === 'panel' \? 'panel' : 'app'/);
  // The identity comes from the enforcer's ARMED ROW fields, never from a title.
  assert.match(offer, /String\(ev\.blocked_agent_id \|\| ''\)\.trim\(\)/);
  assert.match(offer, /String\(ev\.blocked_agent \|\| ''\)\.trim\(\)/);
  assert.equal(/window_title|ev\.title|ev\.patterns|ev\.preview/.test(offer), false,
    'no prompt content or window title may reach the access request');
  // Cancel sends nothing.
  assert.match(offer, /if \(result\.action !== 'submit'\) return;/);
  // The POST reuses the machine bearer token, and does not invent machine_id.
  const post = src.slice(src.indexOf('async #submitAccessRequest(body, subject)'));
  assert.match(post, /authorization: `Bearer \$\{this\.token\}`/);
  assert.match(post, /\$\{this\.serverUrl\}\/api\/v1\/access-requests/);
  assert.match(post, /surface: 'desktop'/);
  assert.equal(/agent_key/.test(post), false, 'agent_key is server-derived — sending one is ignored at best');
  // Offline → the SAME single slot blocked-agents-sync.js already drains.
  assert.match(post, /PENDING_REQUEST_PATH/);
  assert.match(post, /queued_at: new Date\(\)\.toISOString\(\)/);
  // The 429 retry time comes from the server's body, never from a local guess.
  assert.match(post, /err\?\.retry_after/);
});

test('index.js pre-checks for an open request per AGENT, not per host', async () => {
  // Host-only, a pending request for the finance bot would suppress the dialog
  // for the IT help-desk bot — and the server's own 409 is agent-keyed, so the
  // pre-check would be answering a different question than the POST.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('async #findOpenAccessRequest('), src.indexOf('async #submitAccessRequest('));
  assert.match(fn, /\/api\/v1\/access-requests\/mine/);
  assert.match(fn, /r\?\.status === 'pending'/);
  assert.match(fn, /agentMatchKey\(r\) === wantKey/);
  // Fails OPEN: a dialog withheld because /mine was unreachable is the wrong
  // trade — the server still enforces the real rule with a 409.
  assert.match(fn, /return null;/);
  // The local offline slot counts as "already open" too, since a queued request
  // has not reached the server and can never come back on /mine.
  assert.match(fn, /return 'queued';/);
  // The fold matches the server's agentKeyFor: id first, then the normalized name.
  assert.match(src, /function agentMatchKey\(\{ block_scope, agent_id, agent_name \}\) \{/);
  assert.match(src, /if \(block_scope !== 'agent'\) return '';/);
});

// ── govstate: the FILE-SCANNING arm signal ───────────────────────────────────
//
// Behaviour is driven in tests/enforcer-panel-block.test.mjs (govstate_*
// scenarios) and tests/os-monitor-host-files.test.mjs. These are the SOURCE
// invariants, same convention as every other .ps1 check in this file.

test('the govstate payload carries NO content — a bool, a scope, a panel id, admin-typed names, a process and a pid', async () => {
  // The strictest PII rule in this feature, and stricter than EmitBlockState's
  // for a reason: this event's whole job is to ARM a file watcher inside a
  // company's chat client. If it could carry a window title, a UIA element
  // Name, a message heading, a filename or a path, the act of arming would
  // itself be the leak it exists to make unnecessary.
  const src = await enforcerSrc();
  const emit = src.slice(src.indexOf('static void EmitGovState('), src.indexOf('static void UpdateForeground()'));
  assert.ok(emit.length > 0, 'expected an EmitGovState body');

  const keys = [...emit.matchAll(/\\"([a-z_]+)\\":/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [
    'active', 'agent', 'agent_id', 'kind', 'panel', 'pid', 'process', 'scope',
  ], 'the govstate payload gained or lost a field — every addition must be re-reviewed for PII');

  for (const forbidden of [
    // Titles and accessibility reads — the two things this file goes out of its
    // way never to emit anywhere else either.
    'GetWindowText', '.Current.Name', '_fgAgentName', '_copilotHeading', 'heading',
    // File identity, which is what the armed watchers themselves report.
    'filename', 'path', '_attachHoldFilename',
    // Prompt content, in any of its forms.
    'patterns', '_blockedReason', 'preview', '_pendingPreview', '_typed', 'ActivePatterns', 'block_id',
    // No window rect either: nothing renders from this event, unlike the bar.
    'GetWindowRect',
  ]) {
    assert.equal(emit.includes(forbidden), false, `${forbidden} must never reach the govstate payload`);
  }
  // Every string field goes through the same escaper every other emit uses, so
  // an admin-typed name containing a quote cannot break the line.
  assert.equal((emit.match(/Esc\(/g) || []).length, 5, 'every string field must be escaped');
});

test('govstate is emitted on TRANSITIONS only, from the poll thread, and decides nothing', async () => {
  const src = await enforcerSrc();
  const fn = src.slice(src.indexOf('static void UpdateGovState()'), src.indexOf('static void EmitGovState('));
  assert.ok(fn.length > 0, 'expected an UpdateGovState body');
  const code = codeOnly(fn);

  // FIRST-HAND ONLY, and it is the SAME term UpdateBannerState uses. Inside the
  // 3s sticky window _fgIsAi is still (correctly) true, so without this the
  // event would stay "active" after the user left the governed conversation —
  // leaving Teams' file watchers armed over whatever they moved to.
  assert.match(code, /bool firstHand = _fgLeftAiTicks == 0;/);
  assert.match(code, /bool want = _fgHostGoverned && firstHand && !Disarmed\(\);/);

  // Exactly two emit sites: one clear, one arm. Anything else would be a line
  // per 150ms poll tick.
  assert.equal((code.match(/EmitGovState\(/g) || []).length, 2, 'exactly one clear and one arm');
  assert.match(code, /if \(_govActive\)\s*\r?\n\s*\{/);
  assert.match(code, /if \(!want\) return;/);

  // OBSERVES, NEVER DECIDES. It may not touch a single field a block decision
  // owns — the same read-only rule UpdateBannerState/EmitBlockState hold to.
  const emit = src.slice(src.indexOf('static void EmitGovState('), src.indexOf('static void UpdateForeground()'));
  for (const region of [code, codeOnly(emit)]) {
    for (const forbidden of ['ClearFgBlocked', 'ArmPanelBlockLatch', 'ClearPanelBlockLatch']) {
      assert.equal(region.includes(forbidden), false, `UpdateGovState/EmitGovState must not call ${forbidden}`);
    }
    // assignsTo, not a substring test: `_fgLeftAiTicks == 0` contains
    // `_fgLeftAiTicks =`, and READING that field is exactly what the first-hand
    // guard above is supposed to do.
    for (const field of ['_fgIsBlocked', '_blockScope', '_blockedByElement', '_attachHoldActive', '_fgIsAi', '_fgLeftAiTicks', '_fgDlpGoverned']) {
      assert.equal(assignsTo(region, field), false, `UpdateGovState/EmitGovState must not write ${field}`);
    }
  }
  // Runs on the POLL thread, right after the bar state, so it reads this tick's
  // freshly decided block rather than the previous one's.
  const poll = src.slice(src.indexOf('static void PollLoop('), src.indexOf('static void CheckAttachHoldExpiry()'));
  assert.match(poll, /UpdateBannerState\(\); UpdateGovState\(\);/);
  // …and never from the hook thread, which must do no work at all.
  const hook = src.slice(src.indexOf('static IntPtr HookCallback('), src.indexOf('// Scans the typed buffer'));
  assert.equal(hook.includes('UpdateGovState'), false, 'the hook thread must not run the govstate sweep');
});

test('govstate carries the ADMIN-TYPED agent identity, never a name read out of another app', async () => {
  const src = await enforcerSrc();
  // The per-tick fields UpdateGovState reads are filled from GovernedRowIdentity
  // — the matched POLICY ROW's agent_name/agent_id, i.e. values an administrator
  // typed into the dashboard. `agentName`, the string parsed out of the other
  // app's window title or accessibility tree, is only ever the LOOKUP KEY.
  const rowFn = src.slice(src.indexOf('static void GovernedRowIdentity('), src.indexOf('// Arm the platform-block latch'));
  assert.ok(rowFn.length > 0, 'expected a GovernedRowIdentity body');
  assert.match(rowFn, /rowName = agent\["agent_name"\] \?\? "";/);
  assert.match(rowFn, /rowId = agent\["agent_id"\] \?\? "";/);
  // No new matching semantics — the existing pair, exactly as both list checks
  // already use them.
  assert.match(rowFn, /if \(!PLATFORM_PROCS\.TryGetValue\(agent\["platform"\], out procs\)\) continue;/);
  assert.match(rowFn, /if \(!AgentNameMatches\(agentName, agent\["agent_name"\]\)\) continue;/);
  assert.match(rowFn, /if \(!string\.Equals\(agent\["agent_scope"\], "agent", StringComparison\.OrdinalIgnoreCase\)\) continue;/);
  // Read-only: it decides nothing and writes no field.
  assert.equal(/^\s*_\w+ =(?!=)/m.test(codeOnly(rowFn)), false, 'the row lookup must assign to no static field');

  // The govstate state fields are assigned on EVERY branch of the tick, exactly
  // as _fgDlpGoverned is, so a governed tick's identity cannot outlive it.
  const tick = src.slice(src.indexOf('static void ApplyForegroundTick('), src.indexOf('// When a block is active, locate the send button'));
  assert.match(tick, /_fgHostGoverned = hostGoverned;/);
  assert.match(tick, /_fgHostGovAgent = hostGovAgent;/);
  assert.match(tick, /GovernedRowIdentity\(blockGoverned, proc, agentName, out hostGovAgent, out hostGovAgentId\);/);
  // Set ONLY inside the host-app branch's governed arm, so no chat app and no
  // IDE panel can ever arm host file capture.
  assert.equal((codeOnly(tick).match(/hostGoverned = true;/g) || []).length, 1,
    'exactly one place may arm host file capture');
  // The blocked row's identity is preferred, mirroring the tick's own precedence.
  const fn = codeOnly(src.slice(src.indexOf('static void UpdateGovState()'), src.indexOf('static void EmitGovState(')));
  assert.match(fn, /bool blockedAgent = _fgIsBlocked && BlockScope\(\) == "agent";/);
  assert.match(fn, /string agent = blockedAgent \? _blockedAgentName : _fgHostGovAgent;/);
});

test('enforcer.js dispatches govstate without logging it', async () => {
  // Same class of bug this repo already hit for 'route' and 'blockstate': a
  // missing switch case silently discards every event AND lands in Electron's
  // plain-text line scraper as an "unknown kind" warning.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /case 'govstate':/);
  assert.match(src, /this\.emit\('govstate', ev\);/);
  const c = src.slice(src.indexOf("case 'govstate':"), src.indexOf("case 'request_access_offer':"));
  // Not logged: it carries an admin-typed agent name, and a line per Teams
  // conversation switch would write the user's agent-usage timeline into the
  // agent's own log file.
  assert.equal(/this\.log/.test(c), false, 'govstate must not be logged in the dispatcher');
});

// ── The host-app file routes: armed at runtime, never by the catalog ─────────

test('the two UIA watchers keep Teams out of their DEFAULT process set — arming is a separate set', async () => {
  // The pinned property the whole host-app design rests on, restated at the
  // level of the two helpers that actually walk another app's UI. The env var
  // comes from watcherProcessNames() (asserted above); these are the FALLBACK
  // lists each .ps1 uses when it is absent, and the armed set that is OR'd in.
  const { AI_PROCESSES } = await import('../src/os_monitor/ai-processes.js');
  const hostLiterals = AI_PROCESSES
    .filter((e) => e.hostApp === true)
    .map((e) => e.match.source.replace(/^\^/, '').replace(/\$$/, '').toLowerCase());
  assert.ok(hostLiterals.length > 0, 'expected at least one host app in the catalog');

  for (const file of ['attachment-watcher.ps1', 'file-dialog-watcher.ps1']) {
    const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    const fallback = src.slice(src.indexOf('$AiProcesses = if ($env:CFAI_AI_PROCESSES)'), src.indexOf('# ── Runtime-armed HOST APPS'));
    assert.ok(fallback.length > 0, `expected an $AiProcesses default in ${file}`);
    for (const literal of hostLiterals) {
      assert.equal(fallback.toLowerCase().includes(literal), false,
        `${file}'s default process list must never contain the host app ${literal}`);
    }
    // The armed set starts EMPTY and is a SECOND set — $AiProcesses is never
    // modified, so the default (unarmed) answer for a host app stays a flat no
    // even while the arming path exists.
    assert.match(src, /\$ArmedHostProcs = New-Object 'System\.Collections\.Generic\.HashSet\[string\]' -ArgumentList @\(\[System\.StringComparer\]::OrdinalIgnoreCase\)/,
      `${file} must declare an empty armed-host set`);
    const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.equal(/\$AiProcesses\s*\.\s*Add|\$AiProcesses\s*\+=|\$AiProcesses\s*=\s*\$AiProcesses/.test(code), false,
      `${file} must never mutate the catalog process list`);
    // host_arm is the only command either helper accepts, and it carries a
    // process name and an on/off — no path, no filename, no free text.
    assert.match(code, /if \(\$cmd\.cmd -eq 'host_arm' -and \$cmd\.process\)/);
    assert.equal((code.match(/\$cmd\.cmd -eq/g) || []).length, 1, `${file} must accept exactly one command`);
  }
});

test('the govstate handler arms both file watchers and nothing else — and never reports the state', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const start = src.indexOf("this.enforcer.on('govstate'");
  assert.ok(start >= 0, "expected an enforcer.on('govstate') handler");
  const handler = codeOnly(src.slice(start, src.indexOf("this.enforcer.on('rewrite'")));
  // "A governed conversation is open" is not an enforcement event. The file
  // events that may follow are the records.
  assert.equal(handler.includes('reporter.enqueue'), false, 'govstate must never become a server record');
  assert.equal(handler.includes('toast.show'), false, 'and must never toast');
  // Both file watchers, and NOT the prompt watcher: typed prompt text in Teams
  // is enforcer-win.ps1's job, at the element level, and was never asked for
  // here — arming a window-level prompt reader would be the capture the
  // host-app design exists to prevent.
  assert.match(handler, /this\.attachmentWatcher\.hostArm\(this\.hostGoverned\.process, true\);/);
  assert.match(handler, /this\.dialogWatcher\.hostArm\(this\.hostGoverned\.process, true\);/);
  assert.equal(handler.includes('promptWatcher'), false, 'the prompt watcher must never be armed for a host app');
  // The state is taken verbatim off the event — nothing is re-derived, and no
  // conversation name read off a screen can enter it.
  assert.match(handler, /agent: String\(ev\.agent \|\| ''\)/);
  assert.match(handler, /agent_id: String\(ev\.agent_id \|\| ''\)/);
  assert.equal(/GetWindowText|window_title|ev\.title/.test(handler), false, 'no title may reach this state');
  // The log line names the process and the scope, never the agent.
  const logLine = handler.slice(handler.indexOf('this.log?.info('));
  assert.equal(/ev\.agent\b|hostGoverned\.agent\b/.test(logLine), false,
    'the agent name must not be logged — that would be the user\'s agent-usage timeline');
});

test('#hostGovernedFor is the ONLY gate the three file routes consult, and it is process-matched', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('#hostGovernedFor(processName) {'), src.indexOf('  // Stamp WHICH governed agent') >= 0
    ? src.indexOf('#hostGovernedFor(processName) {') + 900
    : undefined);
  assert.ok(fn.length > 0, 'expected a #hostGovernedFor body');
  // Null for every non-host app, always: an ordinary AI app's file coverage does
  // not depend on this and must not start depending on it.
  assert.match(fn, /if \(!processName \|\| !isHostAppProcess\(processName\)\) return null;/);
  // …and the process must MATCH, so a govstate for one host app cannot arm a
  // route for a different one.
  assert.match(fn, /\.replace\(\/\\\.exe\$\/i, ''\)\.trim\(\)\.toLowerCase\(\)/);

  // Exactly three call sites — the three file routes — plus the declaration.
  const code = codeOnly(src);
  assert.equal((code.match(/#hostGovernedFor\(/g) || []).length, 4,
    '#hostGovernedFor gained a call site — every one must be re-reviewed');
  for (const [route, from, to] of [
    ['clipboard_files', "this.poller.on('clipboard_files', ", "this.poller.on('poller-error'"],
    ['file_dialog_pick', "this.dialogWatcher.on('file_dialog_pick'", "this.attachmentWatcher.on('attachment_appeared'"],
    ['attachment_appeared', "this.attachmentWatcher.on('attachment_appeared'", "this.attachmentWatcher.on('attachment_disappeared'"],
  ]) {
    const body = codeOnly(src.slice(src.indexOf(from), src.indexOf(to)));
    assert.ok(body.length > 0, `expected a ${route} handler`);
    assert.match(body, /#hostGovernedFor\(ev\.process\)/, `${route} must consult the governance gate`);
    // …BEFORE buildFileUploadEvent, which is the call that reads the file off
    // disk and puts its bytes on the event. A gate after it would still leak.
    assert.ok(
      body.indexOf('#hostGovernedFor') < body.indexOf('buildFileUploadEvent'),
      `${route}: the governance gate must precede the read`,
    );
  }
});

test('file-handler.js bounds every read it does and puts a deadline on every extraction', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-handler.js'), 'utf8');
  // readFile() has no size argument, so the capture sites used to read whole
  // files into memory — including in the `too_large` branch, which had ALREADY
  // decided the file was too big to look at. A multi-GB file dropped into a chat
  // window could take down the one process that has to still be alive to block
  // the send.
  assert.match(src, /CONTENT_CAPTURE_MAX_BYTES/);
  assert.match(src, /async function readCapped\(path, max, size\)/);
  assert.match(src, /const \{ bytesRead \} = await fh\.read\(buf, 0, max, 0\);/);
  // No unbounded read is left on any capture path. The one remaining plain
  // readFile is the text-readable branch, which is already gated by
  // CONTENT_SCAN_MAX_BYTES and needs the whole text to scan it.
  const captures = (src.match(/await readCapped\(path, CONTENT_CAPTURE_MAX_BYTES, st\.size\)/g) || []).length;
  assert.equal(captures, 4, 'every binary/archive/oversize/unknown capture must be bounded');
  // Two whole-file reads remain, and both are already size-bounded:
  //   * the text-readable SCAN path, which is gated by CONTENT_SCAN_MAX_BYTES
  //     and needs the whole text to run the pattern catalog over it;
  //   * readCapped's own fast path, taken only when the file is already known to
  //     be at or under the cap, so there is nothing to bound.
  assert.equal((src.match(/await readFile\(path\)/g) || []).length, 2,
    'a new unbounded read appeared — every read of a user file must be size-bounded');
  assert.match(src, /if \(size != null && size <= max\) return \{ buf: await readFile\(path\), truncated: false \};/);

  // A DEADLINE on extraction, for the same reason REWRITE_WRITE_BUDGET_MS
  // exists: the attachment hold needs an answer within a bounded time, and an
  // extraction that never returns leaves the send in limbo.
  assert.match(src, /export const EXTRACTION_BUDGET_MS = 8000;/);
  assert.match(src, /await withExtractionBudget\(extractTextFromBinary\(path, ext\)\)/);
  assert.match(src, /await withExtractionBudget\(extractZip\(\{ path, scan, log \}\)\)/);
  assert.match(src, /reason: 'extraction_timeout'/);
  // The timeout is a SENTINEL, not a message match, so a parser error and a
  // deadline can never be confused for each other.
  assert.match(src, /const TIMED_OUT = Symbol\('extraction_timeout'\);/);
  assert.match(src, /extraction === TIMED_OUT/);

  // …and the timing plumbing never touches the file's contents.
  // Block comments are not stripped by codeOnly, and readCapped's own JSDoc
  // legitimately explains why readFile() had to be replaced — so the slice ends
  // at that doc comment rather than at the function it documents.
  const budget = src.slice(src.indexOf('async function withExtractionBudget'), src.indexOf(' * Read at most'));
  assert.ok(budget.length > 0 && budget.length < 1200, 'expected a tight withExtractionBudget slice');
  for (const forbidden of ['readFile', 'toString', 'content_', 'scan(']) {
    assert.equal(budget.includes(forbidden), false, `the deadline wrapper must not touch ${forbidden}`);
  }
});

test('the scan result says WHETHER WE COULD VERIFY the file, and only for formats that should be readable', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'file-handler.js'), 'utf8');
  // The one fact `severity` cannot express: a file that was never scanned has no
  // contentSeverity to raise, so an encrypted PDF full of customer data scores
  // exactly what an empty one does.
  assert.match(src, /if \(contentScan && contentScan\.scanned !== true\) \{\s*\r?\n\s*contentScan\.unverified = isDocumentLikeFormat\(filename\);/);

  const cls = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'classifier.js'), 'utf8');
  assert.match(cls, /export function isDocumentLikeFormat\(filename\)/);
  // A SUPERSET of the three "we have an extractor" predicates, because a format
  // we cannot open at all is the strongest version of "unverified", not an
  // exemption from it.
  assert.match(cls, /if \(isTextReadable\(filename\) \|\| isBinaryParseable\(filename\) \|\| isArchive\(filename\)\) return true;/);
  assert.match(cls, /return UNREADABLE_DOCUMENT_EXTENSIONS\.has\(extOf\(filename\)\);/);

  const { isDocumentLikeFormat } = await import('../src/os_monitor/classifier.js');
  // FAIL CLOSED side: formats that carry text by definition. An encrypted PDF, a
  // password-protected workbook, an archive we cannot open, a legacy .doc.
  for (const name of [
    'q3.pdf', 'salaries.docx', 'salaries.doc', 'book.xlsx', 'book.xls', 'deck.pptx',
    'notes.odt', 'archive.zip', 'archive.7z', 'archive.rar', 'archive.tar', 'db.sqlite',
    'dump.bak', 'export.parquet', 'session.har', 'mail.msg', 'store.pfx', 'creds.p12',
    'secrets.env', 'people.csv', 'config.yaml', 'main.py',
  ]) {
    assert.equal(isDocumentLikeFormat(name), true, `${name} should have been readable — it must fail CLOSED`);
  }
  // FAIL OPEN side, unchanged: nothing here was ever going to yield text, and
  // blocking it would be an unexplainable permanent block on a video. Images are
  // deliberately on this side even though they DO get an OCR attempt — a failed
  // OCR says nothing about hidden text, because there was none to extract.
  for (const name of [
    'standup.mp4', 'call.mov', 'song.mp3', 'clip.webm', 'audio.wav',
    'photo.png', 'photo.jpg', 'scan.jpeg', 'anim.gif', 'icon.bmp', 'shot.webp',
    'binary.exe', 'lib.dll', 'thing.unknownext', 'noextension',
  ]) {
    assert.equal(isDocumentLikeFormat(name), false, `${name} must keep today's fail-OPEN behaviour`);
  }

  // The capture ceiling is the server's own storage limit, so we never read
  // bytes only to have them truncated on arrival.
  const { CONTENT_CAPTURE_MAX_BYTES, CONTENT_SCAN_MAX_BYTES } = await import('../src/os_monitor/classifier.js');
  assert.equal(CONTENT_CAPTURE_MAX_BYTES, 25 * 1024 * 1024);
  assert.ok(CONTENT_CAPTURE_MAX_BYTES > CONTENT_SCAN_MAX_BYTES, 'we may capture more than we parse');
  const dlp = await readFile(join(AGENT_DIR, '..', 'server', 'src', 'routes', 'dlp.js'), 'utf8').catch(() => '');
  if (dlp) {
    assert.match(dlp, /const MAX_CONTENT_BYTES = 25 \* 1024 \* 1024;/,
      'the agent capture cap is derived from the server ceiling — re-check both if this changed');
  }
});

test('the fail-closed hold is scoped to a governed conversation and names its own reason', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const handler = src.slice(
    src.indexOf("this.attachmentWatcher.on('attachment_appeared'"),
    src.indexOf("this.attachmentWatcher.on('attachment_disappeared'"),
  );
  // Escalating on "we could not read it" for EVERY app would start blocking .7z
  // archives and legacy .doc files across the board, which nobody asked for.
  assert.match(handler, /const unverified = cs\?\.scanned !== true && cs\?\.unverified === true;/);
  assert.match(handler, /const failClosed = !!governed && unverified;/);
  // The block has to be able to say WHY, and "high" would be a claim about
  // content nobody read.
  assert.match(handler, /\? `unscannable file \(\$\{cs\?\.reason \|\| 'not readable'\}\)`/);
});

test('the attach hold is bound to ONE app on both sides of the stdin channel', async () => {
  // The defect: _attachHoldActive was a global bool with no process identity, so
  // a hold armed for a flagged attachment in one app swallowed the next Enter in
  // whatever app the user alt-tabbed to — a dead Enter in an unrelated window
  // with nothing on screen to explain it.
  const ps = await enforcerSrc();
  assert.match(ps, /static string _attachHoldProcess = "";/);
  assert.match(ps, /_attachHoldProcess = ExtractJsonString\(line, "process"\);/);
  // Cleared with the hold, on BOTH release paths, so a stale owner cannot
  // outlive it.
  const stdin = ps.slice(ps.indexOf('static void StdinLoop()'), ps.indexOf('static void PumpLoop()'));
  assert.match(stdin, /_attachHoldFilename = ""; _attachHoldPatterns = ""; _attachHoldProcess = "";/);
  const expiry = ps.slice(ps.indexOf('static void CheckAttachHoldExpiry()'), ps.indexOf('static void CheckHeartbeat()'));
  assert.match(expiry, /_attachHoldFilename = ""; _attachHoldPatterns = ""; _attachHoldProcess = "";/);

  const js = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(js, /this\.attachHoldProcess = null;/);
  // An arm from a different app REPLACES the set rather than merging into it:
  // the helper has one hold slot, so the previous app's holds cannot still be in
  // it, and reporting them under this app's name would be a lie.
  assert.match(js, /if \(processName && this\.attachHoldProcess && processName !== this\.attachHoldProcess\) \{/);
  assert.match(js, /this\.attachHolds\.clear\(\);/);
});

test('an in-flight stdin write to a dead helper cannot crash the agent', async () => {
  // EPIPE arrives ASYNCHRONOUSLY, after the write call has already returned
  // true, and an unhandled 'error' on a stream is an uncaughtException — which
  // would take down the very process that is supposed to outlive a dead helper
  // and respawn it. Observed while exercising the host_arm channel.
  for (const file of ['enforcer.js', 'attachment-watcher.js', 'file-dialog-watcher.js']) {
    const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', file), 'utf8');
    assert.match(src, /this\.child\.stdin\.on\('error', \(err\) => \{/, `${file} must handle stdin errors`);
    assert.match(src, /stdin write failed/, `${file} must log rather than throw`);
  }
});
