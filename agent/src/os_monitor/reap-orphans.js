// Reaper for orphan helper PowerShell processes.
//
// Called once at monitor startup (after we acquire the singleton lock and
// before we spawn our own helpers). Kills any powershell.exe instances
// running our scripts — they can only be orphans at this point, since the
// lock guarantees no other --monitor agent is alive to own them.
//
// enforcer-win.ps1 is the one that MUST be reaped: it holds a system-wide
// WH_KEYBOARD_LL hook that swallows keystrokes, so an orphan of it degrades
// the whole machine's keyboard, not just our own monitoring.
//
// On non-Windows this is a no-op.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Helper scripts we own. Kept as a list (and exported) so it's testable and so
// adding a helper is a one-line change that can't drift from the reaper.
export const HELPER_SCRIPTS = [
  'win-poller.ps1',
  'toast-helper.ps1',
  'file-dialog-watcher.ps1',
  'attachment-watcher.ps1',
  'enforcer-win.ps1',
];

// PowerShell -match pattern (a .NET regex source) matching any helper's
// command line. Dots escaped so 'win-pollerXps1' can't match.
export const HELPER_SCRIPT_PATTERN = HELPER_SCRIPTS
  .map((s) => s.replace(/\./g, '\\.'))
  .join('|');

export async function reapOrphans({ log }) {
  if (process.platform !== 'win32') return;

  try {
    // Get-CimInstance is the modern, reliable way to enumerate processes
    // on Windows 11. (wmic is deprecated and absent on newer builds.) We
    // ask for ProcessId+CommandLine, filter to our scripts, and emit one
    // PID per line on stdout for easy parsing.
    const psCommand = `
      Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -match '${HELPER_SCRIPT_PATTERN}' } |
        ForEach-Object { $_.ProcessId }
    `;
    const { stdout } = await execFileP(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', psCommand],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    );

    const orphanPids = stdout
      .split(/\r?\n/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((p) => Number.isFinite(p) && p > 0 && p !== process.pid);

    if (orphanPids.length === 0) {
      log?.info('reap-orphans: no orphan helpers found');
      return;
    }

    log?.warn(`reap-orphans: killing ${orphanPids.length} orphan helper(s): ${orphanPids.join(', ')}`);
    for (const pid of orphanPids) {
      try { process.kill(pid); } catch {
        // Ignore — race with helper exiting on its own is fine.
      }
    }
  } catch (err) {
    log?.warn('reap-orphans: query failed: ' + (err?.message || err));
  }
}
