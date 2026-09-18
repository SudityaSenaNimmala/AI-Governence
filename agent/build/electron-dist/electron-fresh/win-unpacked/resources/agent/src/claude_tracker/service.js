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
import { copyFile, mkdir, appendFile, rename, rm, writeFile } from 'node:fs/promises';
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

// ── machine-wide (fleet) install ──────────────────────────────────────────────
// The double-click path above is per-user (LOCALAPPDATA + HKCU) and opens a
// console. That is wrong for a silent Intune/SYSTEM-context push, which has no
// interactive user and must cover EVERY account on the machine. The fleet path
// instead copies to ProgramData (readable by all users) and registers ONE
// Scheduled Task that fires at logon for any interactive user, running in THAT
// user's session — which is the only place the keystroke/UIA capture can see
// anything. Requires admin, which SYSTEM (how Intune runs) already has.
export const SYSTEM_INSTALL_DIR = join(
  process.env.ProgramData || 'C:\\ProgramData',
  'CloudFuze', 'ClaudeTracker',
);
export const SYSTEM_INSTALLED_EXE = join(SYSTEM_INSTALL_DIR, EXE_NAME);
export const TASK_NAME = 'CloudFuze\\ClaudeTracker';

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

// ── superseding a per-user pilot install ─────────────────────────────────────
//
// THE PROBLEM THIS SOLVES, which is not hypothetical — it was reproduced on a
// machine from the pilot. The double-click path installs per-user (LOCALAPPDATA +
// an HKCU Run value). The fleet path installs machine-wide and registers a logon
// task. Deploying the second over the first leaves BOTH autostarts in place, and
// at the next logon they race:
//
//   1. the old HKCU copy starts, binds the 19531 single-instance lock, and binds
//      identity-beacon port 19532;
//   2. the fleet copy starts, finds the lock held, logs "another tracker instance
//      is already running" and EXITS.
//
// So the machine keeps running the pilot build forever. Worse, the pilot build
// serves the OS username from the beacon, and the extension takes the first port
// that answers — so every pilot machine silently keeps the duplicate-row bug that
// the corporate-UPN change exists to fix, while the dashboard shows an agent
// present and healthy.
//
// Removing the HKCU value from the SYSTEM-context installer cannot fix it alone:
// HKCU under SYSTEM is SYSTEM's own hive, not the user's. Hence two mechanisms —
// a sweep of the loaded user hives at install time, and a stand-down at startup
// for whichever copy is not the machine-wide one.

// Delete our per-user Run value from every LOADED user hive.
//
// Runs as SYSTEM from the installer, where HKCU is the wrong hive, so it goes
// through HKEY_USERS instead. Only loaded hives are visible — which covers the
// user logged in when Intune deploys, the case that matters. A profile that is
// not loaded is handled by the startup stand-down below instead.
export async function sweepPerUserAutostart() {
  const removed = [];
  let sids = [];
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKU']);
    // WHICH SIDS ARE REAL USERS. Two prefixes, and missing the second one makes
    // this a silent no-op on the estate it was written for: S-1-5-21-… is a local
    // or on-prem-AD account, but an ENTRA-joined account is S-1-12-1-… . Verified
    // on a CloudFuze machine — its only user hive is S-1-12-1-…, so matching just
    // S-1-5-21 found nobody and swept nothing while reporting success.
    //
    // Excluded: .DEFAULT (the profile template) and the service accounts
    // S-1-5-18/19/20 (SYSTEM, LOCAL SERVICE, NETWORK SERVICE), which never ran a
    // double-click install; and the _Classes shadow of each user hive, which holds
    // COM registration rather than a Run key.
    //
    // Deliberately liberal otherwise: deleting a value that is not there is a
    // no-op, so a SID form we failed to anticipate costs nothing, whereas one we
    // filter out too eagerly leaves a pilot running forever.
    sids = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /\\(S-1-5-21|S-1-12-1)-[\d-]+$/.test(l))
      .filter((l) => !l.endsWith('_Classes'))
      .map((l) => l.slice(l.lastIndexOf('\\') + 1));
  } catch {
    return removed;   // no reg.exe or no access — nothing we can do here
  }
  for (const sid of sids) {
    const key = `HKU\\${sid}\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
    try {
      await execFileAsync('reg', ['delete', key, '/v', RUN_VALUE, '/f']);
      removed.push(sid);
    } catch { /* value not present in this hive — the normal case */ }
  }
  return removed;
}

// True when this process IS the machine-wide copy.
export function isSystemCopy() {
  return process.execPath.toLowerCase() === SYSTEM_INSTALLED_EXE.toLowerCase();
}

/**
 * Called by the machine-wide copy at startup, BEFORE it tries the lock, so that
 * it always wins the race against a pilot copy rather than politely exiting.
 *
 * Runs in the user's own session (the logon task's whole point), so HKCU here is
 * genuinely that user's hive — which is why this is the mechanism that reaches a
 * profile the installer's sweep could not see.
 */
export async function supersedePerUserInstall() {
  const removedKey = await unregisterAutostart();   // this user's HKCU, correctly
  const killed = await stopRunningInstances();      // any other tracker, incl. the pilot
  if (killed) await waitForLockRelease();           // give the OS time to free 19531
  return { removedKey, killed };
}

// ── fleet install (silent, all users) ─────────────────────────────────────────

// The Scheduled Task definition. Two choices make it work fleet-wide:
//   • a GROUP principal (BUILTIN\Users, SID S-1-5-32-545) with a bare LogonTrigger
//     (no UserId) → the task fires for EVERY user at their logon, not just one;
//   • LeastPrivilege + the implicit InteractiveToken → each run lands in that
//     user's own interactive session, which is where keystrokes/UIA are visible.
// ExecutionTimeLimit PT0S removes the default 72h kill, since this is long-running.
export function buildLogonTaskXml(exePath) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>CloudFuze Claude Usage Tracker - starts at logon for every user.</Description>
    <URI>\\${esc(TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <GroupId>S-1-5-32-545</GroupId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${esc(exePath)}</Command>
      <Arguments>--service</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

// Copy the binary + helper to the machine-wide ProgramData location.
export async function installFilesSystem(watcherScriptSource) {
  await mkdir(SYSTEM_INSTALL_DIR, { recursive: true });

  const alreadyInPlace = process.execPath.toLowerCase() === SYSTEM_INSTALLED_EXE.toLowerCase();
  if (!alreadyInPlace) await copyFile(process.execPath, SYSTEM_INSTALLED_EXE);

  if (!watcherScriptSource || !existsSync(watcherScriptSource)) {
    throw new Error('prompt-watcher.ps1 not found next to the executable — keep both files together');
  }
  const watcherDest = join(SYSTEM_INSTALL_DIR, 'prompt-watcher.ps1');
  if (watcherScriptSource.toLowerCase() !== watcherDest.toLowerCase()) {
    await copyFile(watcherScriptSource, watcherDest);
  }
  return { dir: SYSTEM_INSTALL_DIR, exe: SYSTEM_INSTALLED_EXE, watcher: watcherDest, skipped: alreadyInPlace };
}

// Register (or replace) the all-users logon task. schtasks reads a /XML file as
// UTF-16 and rejects it as "malformed" without a byte-order mark, so write the
// BOM (﻿) explicitly — Node's 'utf16le' encoder does not add one.
export async function registerSystemAutostart(exePath) {
  const xml = buildLogonTaskXml(exePath);
  const xmlPath = join(SYSTEM_INSTALL_DIR, 'logon-task.xml');
  await writeFile(xmlPath, String.fromCharCode(0xFEFF) + xml, 'utf16le');
  await execFileAsync('schtasks', ['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F']);
}

export async function unregisterSystemAutostart() {
  try {
    await execFileAsync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
    return true;
  } catch {
    return false;   // not present is fine
  }
}

export async function isSystemAutostartRegistered() {
  try {
    await execFileAsync('schtasks', ['/Query', '/TN', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

// Kick the task now so a user already logged in when Intune deploys does not have
// to wait until their next logon. Best-effort: no interactive session → no-op.
export async function runSystemTaskNow() {
  try {
    await execFileAsync('schtasks', ['/Run', '/TN', TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

export async function uninstallSystem() {
  const removedTask = await unregisterSystemAutostart();
  await stopRunningInstances();
  return { removedTask, dir: SYSTEM_INSTALL_DIR };
}
