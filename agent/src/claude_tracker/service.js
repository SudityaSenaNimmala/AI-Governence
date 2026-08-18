// Background-service plumbing for the Claude Usage Tracker.
//
// WHY THIS EXISTS. The tracker is a console program, so double-clicking it
// opened a window that had to stay open for tracking to continue. In the field
// that window gets closed within the minute — and the failure is silent and
// indistinguishable from a healthy install: the machine has already enrolled, so
// it appears in the dashboard with a fresh "last seen" and zero prompts forever.
// A colleague's enrolment died 86 seconds after install and nobody could tell
// from the UI. Requiring people to launch it from a terminal is not a fix; it is
// the same fragility with a longer instruction sheet.
//
// So the first double-click INSTALLS rather than runs:
//   1. copy the exe + prompt-watcher.ps1 into %LOCALAPPDATA%\CloudFuze\ClaudeTracker
//   2. register HKCU\...\Run so it starts at every logon
//   3. relaunch the installed copy detached and windowless
//   4. print what happened and close
// Every later start is `--service`: no console, no window, logs to a file.
//
// No admin rights are needed anywhere here: HKCU and LOCALAPPDATA both belong to
// the user, which is what keeps this deployable by the person themselves.

import os from 'node:os';
import net from 'node:net';
import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, appendFile, rename, rm } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Running as the SEA binary, or as `node src/claude_tracker/index.js`? A dev run
// must never install itself — it would copy node.exe and register THAT to start
// at logon, which does nothing useful and is confusing to undo.
export const IS_PACKAGED = !/^node(\.exe)?$/i.test(basename(process.execPath));

export const EXE_NAME = 'CloudFuzeClaudeTracker.exe';
export const INSTALL_DIR = join(
  process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local'),
  'CloudFuze', 'ClaudeTracker',
);
export const INSTALLED_EXE = join(INSTALL_DIR, EXE_NAME);
export const LOG_PATH = join(INSTALL_DIR, 'tracker.log');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'CloudFuzeClaudeTracker';

// A port of its own, deliberately outside the identity beacon's 19532-19536
// range. Binding it IS the single-instance lock: the OS releases it when the
// process dies, however it dies, so there is no stale lock file to reap after a
// crash or a hard power-off.
const LOCK_PORT = 19531;

const MAX_LOG_BYTES = 5 * 1024 * 1024;

// ── single instance ──────────────────────────────────────────────────────────

// Resolves to a server handle when this process may run, or null when another
// instance already holds the lock. The handle is kept (never closed) for the
// lifetime of the process.
export function acquireSingleInstanceLock() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(LOCK_PORT, '127.0.0.1', () => {
      server.unref();          // must not hold the event loop open by itself
      resolve(server);
    });
  });
}

// Poll until the lock port is free, so an install that just stopped the previous
// copy does not race its own relaunch against a socket still in TIME_WAIT.
export async function waitForLockRelease(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const held = await acquireSingleInstanceLock();
    if (held) { held.close(); return true; }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ── file logging ─────────────────────────────────────────────────────────────

// A detached process has no console, so without this the log goes nowhere and a
// silent tracker cannot be diagnosed at all — which is the exact hole that let
// the old failure hide. Appends are fire-and-forget: losing a log line must
// never take down prompt capture.
export function fileLogger() {
  let rotating = false;
  return (line) => {
    const stamped = `${new Date().toISOString()} ${line}\n`;
    (async () => {
      try {
        if (!rotating && existsSync(LOG_PATH) && statSync(LOG_PATH).size > MAX_LOG_BYTES) {
          rotating = true;
          await rm(`${LOG_PATH}.1`, { force: true });
          await rename(LOG_PATH, `${LOG_PATH}.1`);
          rotating = false;
        }
        await mkdir(INSTALL_DIR, { recursive: true });
        await appendFile(LOG_PATH, stamped, 'utf8');
      } catch { /* logging must never be fatal */ }
    })();
  };
}

// ── autostart ────────────────────────────────────────────────────────────────

export async function registerAutostart(exePath) {
  // The quotes around the path are part of the stored value, not shell quoting:
  // without them Windows splits an install path containing a space and launches
  // nothing. execFile passes each argument verbatim, so no shell is involved.
  await execFileAsync('reg', [
    'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ',
    '/d', `"${exePath}" --service`, '/f',
  ]);
}

export async function unregisterAutostart() {
  try {
    await execFileAsync('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f']);
    return true;
  } catch {
    return false;   // not registered is a success for uninstall purposes
  }
}

export async function isAutostartRegistered() {
  try {
    await execFileAsync('reg', ['query', RUN_KEY, '/v', RUN_VALUE]);
    return true;
  } catch {
    return false;
  }
}

// ── install / relaunch ───────────────────────────────────────────────────────

// Stop any copy that is already running, EXCEPT this process. Needed so that
// double-clicking a freshly downloaded build replaces an older running one
// instead of silently doing nothing because the lock was held.
export async function stopRunningInstances() {
  try {
    await execFileAsync('taskkill', [
      '/F', '/IM', EXE_NAME, '/FI', `PID ne ${process.pid}`,
    ]);
    return true;
  } catch {
    return false;   // "not found" exits non-zero; nothing to stop is fine
  }
}

// Copy the binary and its PowerShell helper into the install directory.
// Returns { copied, skipped } — skipped when we are already running from there,
// since a file cannot be copied over itself.
export async function installFiles(watcherScriptSource) {
  await mkdir(INSTALL_DIR, { recursive: true });

  const alreadyInPlace = process.execPath.toLowerCase() === INSTALLED_EXE.toLowerCase();
  if (!alreadyInPlace) await copyFile(process.execPath, INSTALLED_EXE);

  // prompt-watcher.ps1 is not optional — the tracker exits without it, so a
  // partial install is worse than a failed one: it would register autostart for
  // a binary that dies at every logon.
  if (!watcherScriptSource || !existsSync(watcherScriptSource)) {
    throw new Error('prompt-watcher.ps1 not found next to the executable — keep both files together and re-run');
  }
  const watcherDest = join(INSTALL_DIR, 'prompt-watcher.ps1');
  if (watcherScriptSource.toLowerCase() !== watcherDest.toLowerCase()) {
    await copyFile(watcherScriptSource, watcherDest);
  }

  return { dir: INSTALL_DIR, exe: INSTALLED_EXE, watcher: watcherDest, skipped: alreadyInPlace };
}

// Start the installed copy with no console and no parent. DETACHED_PROCESS plus
// CREATE_NO_WINDOW (what libuv sets for detached + windowsHide) is what makes
// this survive the launching window closing, with nothing visible on screen.
export function relaunchDetached(exePath) {
  const child = spawn(exePath, ['--service'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: dirname(exePath),
  });
  child.unref();
  return child.pid;
}

export async function uninstall() {
  const removedKey = await unregisterAutostart();
  await stopRunningInstances();
  return { removedKey, dir: INSTALL_DIR };
}
