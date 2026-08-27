// Singleton lock for the OS monitor. Prevents two --monitor invocations
// from running on the same machine — which would cause duplicate toasts
// and double-write events to the governance server.
//
// Mechanism: a PID file at ~/.cloudfuze-aigov/monitor.lock. On startup we
// check if a live process owns the lock; if yes, refuse to start. If the
// PID is stale (process died without releasing), we steal the lock.

import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

const LOCK_DIR  = join(os.homedir(), '.cloudfuze-aigov');
const LOCK_PATH = join(LOCK_DIR, 'monitor.lock');

/** System uptime in seconds — used to detect reboots. */
function bootTimestamp() {
  return Date.now() - os.uptime() * 1000;
}

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);  // signal 0 = "test if alive", throws if not
    return true;
  } catch (err) {
    // EPERM = process exists but we can't signal it (still counts as alive)
    return err.code === 'EPERM';
  }
}

/**
 * Try to acquire the lock. Returns { acquired: true } on success or
 * { acquired: false, heldByPid } if another live process owns it.
 *
 * Lock file format: "PID\nBOOT_TS" where BOOT_TS is the approximate system
 * boot epoch ms. After a reboot Windows may reuse the old PID for an unrelated
 * process — comparing boot timestamps lets us detect this and steal the lock.
 */
export async function acquireMonitorLock() {
  await mkdir(LOCK_DIR, { recursive: true });

  // Check for existing lock
  try {
    const content = await readFile(LOCK_PATH, 'utf8');
    const lines = content.trim().split('\n');
    const heldByPid = parseInt(lines[0], 10);
    const lockBootTs = parseInt(lines[1], 10);

    if (Number.isFinite(heldByPid) && heldByPid !== process.pid) {
      // If the lock was written during a previous boot, the PID is definitely
      // stale even if Windows reused it for a different process.
      const currentBootTs = bootTimestamp();
      const sameBootSession = Number.isFinite(lockBootTs) &&
        Math.abs(currentBootTs - lockBootTs) < 120_000; // 2 min tolerance

      if (sameBootSession && isProcessAlive(heldByPid)) {
        return { acquired: false, heldByPid };
      }
    }
    // PID is stale (dead, or from a previous boot) — fall through and steal it.
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await writeFile(LOCK_PATH, `${process.pid}\n${bootTimestamp()}`, 'utf8');
  return { acquired: true };
}

export async function releaseMonitorLock() {
  try {
    const content = await readFile(LOCK_PATH, 'utf8');
    if (parseInt(content.trim(), 10) !== process.pid) return;  // not ours
    await unlink(LOCK_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Best-effort — log via stderr since this runs during shutdown.
      process.stderr.write(`monitor.lock release failed: ${err.message}\n`);
    }
  }
}
