// Proxy watchdog sidecar.
//
// Spawned by the main agent as a detached child node process. Its only job:
// poll the parent PID, and if the parent disappears unexpectedly (kill -9,
// BSOD, OOM), restore the Windows proxy registry from the state file written
// by system-proxy-win32 at activation time. Then exit.
//
// Why a separate process:
//
//   Node's SIGINT / SIGTERM / uncaughtException hooks cover graceful shutdown,
//   but they DO NOT fire on:
//     - SIGKILL on POSIX (we are Windows-only, but for completeness)
//     - taskkill /F  → instant termination, no chance to run handlers
//     - power loss, BSOD
//     - Node process becoming unresponsive (event loop blocked)
//   In all those cases the registry stays pointing at the dead MITM and the
//   user's machine is bricked for HTTPS until they uninstall by hand.
//   A detached sibling that watches the parent PID covers the residual risk.
//
// Why this file is BOTH a module AND a CLI entry:
//
//   - As a module: `spawnWatchdog({ parentPid, statePath })` is called from
//     the orchestrator to start a detached child node process.
//   - As a CLI:    `node watchdog.js <parentPid> <statePath>` is what the
//     spawned child actually runs. Keeping them in one file means the
//     watchdog can find itself via import.meta.url — no path math, no
//     packaging surprises after esbuild/pkg.

import { spawn } from 'node:child_process';
import { readFile, unlink, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POLL_MS = 2000;
const REG_PATH = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/**
 * Spawn the watchdog as a detached child node process. Returns the child
 * handle. Caller does NOT need to wait on or unref the result — we do both.
 */
export function spawnWatchdog({ parentPid = process.pid, statePath, log } = {}) {
  if (process.platform !== 'win32') {
    log?.warn?.('proxy/watchdog: skipped — not win32');
    return null;
  }
  if (!statePath) throw new Error('proxy/watchdog: statePath is required');

  const selfPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [selfPath, String(parentPid), statePath], {
    // detached + stdio:ignore = child survives parent death cleanly.
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  log?.info?.(`proxy/watchdog: spawned pid=${child.pid} watching parent=${parentPid}`);
  return child;
}

/**
 * Watch loop — runs in the detached child. Polls parent existence; when the
 * parent is gone, restores the registry from statePath and exits.
 */
async function runWatcher(parentPid, statePath) {
  // If the parent already isn't there (race on spawn), restore immediately.
  // Otherwise poll until it goes away.
  while (parentAlive(parentPid)) {
    await sleep(POLL_MS);
  }
  await restoreFromState(statePath);
  process.exit(0);
}

function parentAlive(pid) {
  try {
    // Signal 0 on Windows: existence check only. Throws if no such pid OR
    // we lack rights — for our own child case we always have rights.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function restoreFromState(statePath) {
  try {
    await access(statePath, fsConstants.R_OK);
  } catch {
    // Nothing to restore — orchestrator already cleaned up gracefully.
    return;
  }
  let state;
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return;
  }
  const o = state?.original;
  if (!o) return;

  // NOTE: this whole script runs as a single `-Command` line. PowerShell
  // here-strings would need a real newline after the `@"` opener, which we
  // don't have — so the Add-Type uses a regular single-quoted string instead.
  const winInetSig =
    '[System.Runtime.InteropServices.DllImport("wininet.dll", SetLastError=true)] ' +
    'public static extern bool InternetSetOption(System.IntPtr h, int o, System.IntPtr b, int l);';
  const script = [
    `if (-not (Test-Path '${REG_PATH}')) { New-Item -Path '${REG_PATH}' -Force | Out-Null };`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'ProxyEnable'   -PropertyType DWord  -Value ${Number(o.ProxyEnable) ? 1 : 0} -Force | Out-Null;`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'ProxyServer'   -PropertyType String -Value '${escapeSingle(String(o.ProxyServer   || ''))}' -Force | Out-Null;`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'ProxyOverride' -PropertyType String -Value '${escapeSingle(String(o.ProxyOverride || ''))}' -Force | Out-Null;`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'AutoConfigURL' -PropertyType String -Value '${escapeSingle(String(o.AutoConfigURL || ''))}' -Force | Out-Null;`,
    // Best-effort: notify WinINet so already-running apps re-read.
    `try { Add-Type -Name CFAIWinInetW -Namespace W -MemberDefinition '${winInetSig}' -ErrorAction Stop; $null = [W.CFAIWinInetW]::InternetSetOption([System.IntPtr]::Zero, 39, [System.IntPtr]::Zero, 0); $null = [W.CFAIWinInetW]::InternetSetOption([System.IntPtr]::Zero, 37, [System.IntPtr]::Zero, 0); } catch {};`,
  ].join(' ');

  await runPwsh(script);
  await unlink(statePath).catch(() => {});
}

function escapeSingle(s) {
  return s.replace(/'/g, "''");
}

function runPwsh(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`powershell exit ${code}: ${stderr}`));
    });
  });
}

// CLI entry — runs when node is invoked with this file as argv[1].
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const parentPid = parseInt(process.argv[2], 10);
  const statePath = process.argv[3];
  if (!parentPid || !statePath) {
    process.stderr.write('usage: watchdog.js <parentPid> <statePath>\n');
    process.exit(2);
  }
  runWatcher(parentPid, statePath).catch((e) => {
    process.stderr.write(`watchdog fatal: ${e?.stack || e}\n`);
    process.exit(1);
  });
}
