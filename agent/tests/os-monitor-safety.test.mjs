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
  assert.match(src, /static bool FgIsAiNow\(\) \{ return _fgIsAi && _fgLeftAiTicks == 0; \}/);
  assert.match(src, /if \(FgIsAiNow\(\)\)\s*\r?\n\s*\{\s*\r?\n\s*char c = MapKey\(vk, shift, caps\);/);
  assert.match(src, /if \(FgIsAiNow\(\)\) \{ TypedBackspace\(\);/);
  // The Enter decision must NOT have been narrowed to FgIsAiNow — that would
  // reopen the bypass the sticky flag exists to close.
  assert.match(src, /bool block = !Disarmed\(\) &&\s*\r?\n\s*\(_fgIsBlocked \|\| attachHold/);
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

test('monitor-runner subtracts access exceptions from blocked-agents.json, and fails CLOSED', async () => {
  // The whole desktop un-blocking path: enforcer-win.ps1 is unchanged and just
  // re-reads the file, so if this filter does not run an approved exception
  // does nothing on the desktop.
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
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
  assert.match(src, /flushPendingAccessRequest\(\)/);
});

test('the offline access-request queue is one slot and is not retried forever', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
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

test('monitor-runner fetches ai-platforms unfiltered and merges synthesised platform blocks', async () => {
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
  assert.match(src, /synthesizePlatformBlocks/);
  // Unfiltered on purpose: no admin UI has ever set `surface`, so every row is
  // 'browser' and ?surface=desktop would return nothing useful.
  assert.match(src, /\/api\/v1\/ai-platforms`/);
  assert.equal(/ai-platforms\?/.test(src), false, 'the ai-platforms fetch must carry no query string');
  // Authenticated even though the route ignores it today, matching the
  // extension's precedent, so requiring auth later needs no agent change.
  const fetcher = src.slice(src.indexOf('async function fetchAiPlatforms('), src.indexOf('async function refreshBlockedAgents('));
  assert.ok(fetcher.length > 0, 'expected a fetchAiPlatforms function');
  assert.match(fetcher, /authorization: `Bearer \$\{creds\.token\}`/);
  // Agent rows FIRST — CheckFgBlocked returns on its first match, so array
  // order is the precedence between the two sources.
  assert.match(src, /agentRows[\s\S]{0,80}\.concat\(synthesizePlatformBlocks\(platforms\)\)/);
});

test('monitor-runner fails CLOSED when EITHER source is unreachable — never a partial rewrite', async () => {
  // A file built from only one source silently drops every block the other
  // source contributed. A stale file keeps enforcing the last known policy.
  const src = await readFile(join(AGENT_DIR, 'electron', 'monitor-runner.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('async function refreshBlockedAgents('), src.indexOf('// ── Offline access-request queue'));
  assert.ok(fn.length > 0, 'expected a refreshBlockedAgents function');
  // blocked-agents unreachable → bail before any write.
  assert.match(fn, /if \(!res\.ok\) return;/);
  // ai-platforms unreachable → bail before any write, too.
  const platformGuard = fn.indexOf('if (platforms === null) {');
  const write = fn.indexOf('writeFileSync(BLOCKED_PATH');
  assert.ok(platformGuard >= 0, 'expected an explicit platforms === null guard');
  assert.ok(platformGuard < write, 'the fail-closed guard must come before the write');
  assert.match(fn.slice(platformGuard, write), /return;/);
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
  // Both branches must feed the same fields EmitBlock already reports, or the
  // Request Access dialog cannot name what to ask for.
  assert.equal((check.match(/_fgIsBlocked = true;/g) || []).length, 2);
  assert.equal((check.match(/_blockedAgentId = agent\["agent_id"\] \?\? "";/g) || []).length, 2);
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
