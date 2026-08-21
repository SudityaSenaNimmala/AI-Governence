// Enforcer watchdog sidecar.
//
// Spawned by the OS monitor as a detached child node process. Its only job:
// poll the parent PID, and if the parent disappears unexpectedly (taskkill /F,
// BSOD, OOM), kill the orphaned enforcer-win.ps1 helper so the system-wide
// WH_KEYBOARD_LL hook is released. Then exit.
//
// Why a separate process (same reasoning as proxy/watchdog.js):
//
//   Node's SIGINT / SIGTERM / uncaughtException hooks cover graceful shutdown,
//   but they DO NOT fire on:
//     - taskkill /F  → instant termination, no chance to run handlers
//     - power loss, BSOD
//     - Node process becoming unresponsive (event loop blocked)
//   In those cases the PowerShell helper keeps running with a low-level
//   keyboard hook installed, still swallowing Enter/Ctrl+V in AI apps, with
//   nothing left alive to report or stop it. That is the worst failure mode
//   this product has — a detached sibling that watches the parent PID covers
//   the residual risk.
//
// This watchdog is the FIRST of two independent safety nets. The second lives
// inside enforcer-win.ps1: a deadman that unhooks if the parent's heartbeat
// file goes stale for 30s. They cover different failures — the watchdog kills a
// helper whose parent is DEAD; the deadman covers a parent that is merely HUNG,
// which process.kill(pid, 0) cannot distinguish from a healthy one.
//
// Why this file is BOTH a module AND a CLI entry:
//
//   - As a module: `spawnEnforcerWatchdog({ parentPid, statePath })` is called
//     from the orchestrator to start a detached child node process.
//   - As a CLI:    `node enforcer-watchdog.js <parentPid> <statePath>` is what
//     the spawned child actually runs. Keeping them in one file means the
//     watchdog can find itself via import.meta.url — no path math, no
//     packaging surprises after esbuild/pkg.

import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);

const POLL_MS = 2000;

export const STATE_DIR = join(homedir(), '.cloudfuze-aigov');
// PID of the running enforcer-win.ps1 helper, written by Enforcer.start().
export const ENFORCER_PID_PATH = join(STATE_DIR, 'enforcer.pid');
// Parent liveness heartbeat, rewritten by Enforcer every 5s and read by the
// PowerShell deadman.
export const ENFORCER_HEARTBEAT_PATH = join(STATE_DIR, 'enforcer.parent');

/**
 * Spawn the watchdog as a detached child node process. Returns the child
 * handle. Caller does NOT need to wait on or unref the result — we do both.
 */
export function spawnEnforcerWatchdog({ parentPid = process.pid, statePath = ENFORCER_PID_PATH, log } = {}) {
  if (process.platform !== 'win32') {
    log?.warn?.('enforcer/watchdog: skipped — not win32');
    return null;
  }

  const selfPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [selfPath, String(parentPid), statePath], {
    // detached + stdio:ignore = child survives parent death cleanly.
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  log?.info?.(`enforcer/watchdog: spawned pid=${child.pid} watching parent=${parentPid}`);
  return child;
}

// ── State file ───────────────────────────────────────────────────────────────

/** Record the live helper PID so the watchdog knows what to kill. */
export async function writeEnforcerState({ statePath = ENFORCER_PID_PATH, pid, parentPid = process.pid } = {}) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ pid, parentPid, spawnedAt: new Date().toISOString() }), 'utf8');
}

export async function clearEnforcerState(statePath = ENFORCER_PID_PATH) {
  await unlink(statePath).catch(() => {});
}

/**
 * Read the helper PID out of the state file. Accepts either the JSON we write
 * or a bare integer, so a hand-written enforcer.pid still works.
 */
export async function readEnforcerPid(statePath = ENFORCER_PID_PATH) {
  let raw;
  try {
    raw = (await readFile(statePath, 'utf8')).trim();
  } catch {
    return null;   // nothing to reap — orchestrator already cleaned up
  }
  if (!raw) return null;
  let pid = null;
  try {
    const parsed = JSON.parse(raw);
    // JSON.parse('9182') succeeds and yields a number, so a bare pid file goes
    // down this branch too — don't assume an object.
    pid = (typeof parsed === 'number') ? parsed : parsed?.pid;
  } catch {
    pid = parseInt(raw, 10);
  }
  pid = Number(pid);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

// ── Kill path ────────────────────────────────────────────────────────────────

/**
 * Is `pid` actually our PowerShell enforcer? Windows recycles PIDs, and this
 * watchdog runs unattended after its parent died — possibly long after — so we
 * confirm the command line before killing anything. If we cannot confirm, we do
 * NOT kill: the PowerShell-side deadman still releases the hook within 30s, so
 * declining here costs a short delay, while a wrong kill costs the user an
 * unrelated process.
 */
export async function isEnforcerProcess(pid) {
  if (process.platform !== 'win32') return false;
  try {
    const psCommand =
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; ` +
      `if ($p -and $p.CommandLine -match 'enforcer-win\\.ps1') { 'yes' } else { 'no' }`;
    const { stdout } = await execFileP(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psCommand],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    return stdout.trim() === 'yes';
  } catch {
    return false;
  }
}

function killPid(pid) {
  try { process.kill(pid); return true; } catch { return false; }
}

/**
 * Kill the enforcer helper recorded in `statePath` and clear the state file.
 * Returns a small result object so this is testable without a real hook.
 *
 * `verify` and `kill` are injectable purely for tests.
 */
export async function reapEnforcer(statePath = ENFORCER_PID_PATH, {
  verify = isEnforcerProcess,
  kill = killPid,
  log,
} = {}) {
  const pid = await readEnforcerPid(statePath);
  if (pid == null) return { killed: false, reason: 'no-state' };

  if (pid === process.pid) return { killed: false, reason: 'self', pid };

  if (!(await verify(pid))) {
    // Either already gone, or the PID now belongs to something else.
    await clearEnforcerState(statePath);
    return { killed: false, reason: 'not-enforcer', pid };
  }

  const ok = kill(pid);
  log?.warn?.(`enforcer/watchdog: killed orphaned enforcer helper pid=${pid}`);
  await clearEnforcerState(statePath);
  return { killed: ok, reason: ok ? 'killed' : 'kill-failed', pid };
}

// ── Watch loop ───────────────────────────────────────────────────────────────

/**
 * Runs in the detached child. Polls parent existence; when the parent is gone,
 * kills the orphaned helper and exits.
 */
async function runWatcher(parentPid, statePath) {
  // If the parent already isn't there (race on spawn), reap immediately.
  // Otherwise poll until it goes away.
  while (parentAlive(parentPid)) {
    await sleep(POLL_MS);
  }
  await reapEnforcer(statePath);
  process.exit(0);
}

function parentAlive(pid) {
  try {
    // Signal 0 on Windows: existence check only. Throws if no such pid OR
    // we lack rights — for our own parent case we always have rights.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// CLI entry — runs when node is invoked with this file as argv[1].
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const parentPid = parseInt(process.argv[2], 10);
  const statePath = process.argv[3] || ENFORCER_PID_PATH;
  if (!parentPid) {
    process.stderr.write('usage: enforcer-watchdog.js <parentPid> [statePath]\n');
    process.exit(2);
  }
  runWatcher(parentPid, statePath).catch((e) => {
    process.stderr.write(`enforcer-watchdog fatal: ${e?.stack || e}\n`);
    process.exit(1);
  });
}
