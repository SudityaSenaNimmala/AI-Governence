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
 */
export async function acquireMonitorLock() {
  await mkdir(LOCK_DIR, { recursive: true });

  // Check for existing lock
  try {
    const content = await readFile(LOCK_PATH, 'utf8');
    const heldByPid = parseInt(content.trim(), 10);
    if (Number.isFinite(heldByPid) && heldByPid !== process.pid && isProcessAlive(heldByPid)) {
      return { acquired: false, heldByPid };
    }
    // PID is stale — fall through and steal it.
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await writeFile(LOCK_PATH, String(process.pid), 'utf8');
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
