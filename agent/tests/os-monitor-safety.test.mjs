// Safety hardening for the desktop keystroke enforcer (Phase 0).
//
// NOTE: nothing in this file may install a keyboard hook. The enforcer is only
// ever constructed with { enabled: false }, and the watchdog CLI is only ever
// pointed at state files that name PIDs it will refuse to kill. If you add a
// case here, keep that property.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(__dirname, '..');
const WATCHDOG = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-watchdog.js');

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
  // Constructing OsMonitor starts pollers, so assert on the source of start()
  // instead: the enforcer and its watchdog must both sit behind the flag, and
  // the passive watchers must not.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const gated = src.match(/if \(this\.enforcerEnabled\) \{([\s\S]*?)\n    \} else \{/);
  assert.ok(gated, 'expected an `if (this.enforcerEnabled)` block in start()');
  assert.match(gated[1], /this\.enforcer\.start\(\)/);
  assert.match(gated[1], /spawnEnforcerWatchdog\(/);
  for (const passive of ['this.poller.start()', 'this.dialogWatcher.start()', 'this.attachmentWatcher.start()', 'this.promptWatcher.start()']) {
    assert.equal(gated[1].includes(passive), false, `${passive} must NOT be gated on the enforcer flag`);
  }
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
  // Guard present on the Enter path and on both BlockActive helpers.
  assert.match(src, /bool block = !Disarmed\(\) &&/);
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

test('Enforcer.attachHold writes only cmd/state/filename/patterns/ttl_ms to stdin — no file content', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer.js'), 'utf8');
  assert.match(src, /attachHold\(state, \{ filename = '', patterns = '', ttlMs = 3000 \} = \{\}\)/);
  assert.match(src, /cmd: 'attach_hold', state, filename, patterns, ttl_ms: ttlMs/);
});

test('enforcer-win.ps1: attach_hold ORs into both the Enter and mouse-click block decisions', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1'), 'utf8');
  // Declared state.
  assert.match(src, /static volatile bool _attachHoldActive = false;/);
  // Mouse-click gate (BlockActiveForMouse).
  const mouseGate = src.slice(src.indexOf('static bool BlockActiveForMouse()'));
  assert.match(mouseGate.slice(0, 400), /_fgIsBlocked \|\| _attachHoldActive \|\|/);
  // Enter-decision gate.
  assert.match(src, /bool attachHold = _attachHoldActive;/);
  assert.match(src, /\(_fgIsBlocked \|\| attachHold \|\| TypedBlockFresh\(\)/);
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
  const provisionalIdx = appearedHandler.indexOf("attachHold('on', { filename: ev.filename, patterns: '', ttlMs: 3000 })");
  const scanIdx = appearedHandler.indexOf('buildFileUploadEvent(');
  assert.ok(provisionalIdx >= 0, 'expected a provisional attachHold(on) call');
  assert.ok(scanIdx >= 0, 'expected a buildFileUploadEvent call');
  assert.ok(provisionalIdx < scanIdx, 'the provisional hold must be armed BEFORE the scan starts, not after');
  // Escalation threshold matches the browser extension's existing file-block
  // severity (high/critical only, not moderate).
  assert.match(appearedHandler, /shouldHold = severity === 'high' \|\| severity === 'critical'/);
});

test('OsMonitor refreshes a confirmed attach hold so it survives past its own TTL while the file stays attached', async () => {
  // Regression: attachment_appeared only fires once, on first appearance —
  // it does not keep firing while a chip just sits there unchanged.
  // Confirmed live: a confirmed hold (60s TTL) silently expired with the
  // sensitive file never removed, and the next Enter went through
  // unblocked, because nothing was re-sending attach_hold('on', ...) to
  // keep it alive. #startAttachHoldRefresh is the fix.
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  assert.match(src, /#startAttachHoldRefresh\(filename, patterns, ttlMs\)/);
  assert.match(src, /this\.attachHoldRefreshTimer = setInterval\(/);
  const appearedHandler = src.slice(
    src.indexOf("this.attachmentWatcher.on('attachment_appeared'"),
    src.indexOf("this.attachmentWatcher.on('attachment_disappeared'"),
  );
  assert.match(appearedHandler, /this\.#startAttachHoldRefresh\(ev\.filename, patternNames, ttlMs\);/);
  // The refresh timer must stop itself once the hold it was refreshing is no
  // longer the active one — otherwise a released hold could get silently
  // re-armed a few seconds later by a stale interval nobody cleared.
  assert.match(src, /if \(this\.attachHoldFilename !== filename\) \{ this\.#stopAttachHoldRefresh\(\); return; \}/);
});

test('OsMonitor releases the hold when the flagged attachment disappears, and stops refreshing it', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const disappearedHandler = src.slice(src.indexOf("this.attachmentWatcher.on('attachment_disappeared'"));
  assert.match(disappearedHandler.slice(0, 500), /attachHold\('off', \{ filename: ev\.filename \}\)/);
  assert.match(disappearedHandler.slice(0, 500), /this\.#stopAttachHoldRefresh\(\);/);
  // Guarded on filename match, not a blanket release — an unrelated file
  // disappearing must not release a hold armed for a different, still-
  // present flagged file.
  assert.match(disappearedHandler.slice(0, 300), /if \(this\.attachHoldFilename !== ev\.filename\) return;/);
});

test('a blocked attachment reports blocked_for:file_upload and never claims the upload itself was prevented', async () => {
  const src = await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'index.js'), 'utf8');
  const blockHandler = src.slice(src.indexOf("this.enforcer.on('block'"), src.indexOf("this.enforcer.on('override'"));
  assert.match(blockHandler, /blocked_for: reason/);
  assert.match(blockHandler, /reason = isAttachment \? 'file_upload'/);
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

test('main.js does not show the center dialog for an attachment block — the toast already covers it', async () => {
  // Confirmed live: an attachment block fired both the toast (from
  // index.js's enforcer.on('block') handler) AND this center dialog, and the
  // dialog had nothing actionable to add (no Tokenize option, no retraction
  // button) — just a "Got it" restating what the toast already said.
  const src = await readFile(join(AGENT_DIR, 'electron', 'main.js'), 'utf8');
  const blockHandler = src.slice(src.indexOf("line.startsWith('@@CFAI-BLOCK '"));
  assert.match(blockHandler.slice(0, 1200), /if \(parsed\.reason !== 'attachment'\) showBlockDialogWindow\(parsed\);/);
});
