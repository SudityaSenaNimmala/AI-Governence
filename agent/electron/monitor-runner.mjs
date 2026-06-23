// Lightweight monitor runner for the Electron app.
// Starts the OsMonitor directly without running a full machine scan first.
// The agent CLI's --monitor flag requires a scan + server upload to succeed
// before entering monitor mode — this script skips that so the monitor works
// even when the server is temporarily unreachable.

import { join } from 'node:path';
import { readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { createLogger } from '../src/util/logger.js';
import { OsMonitor } from '../src/os_monitor/index.js';
import { acquireMonitorLock, releaseMonitorLock } from '../src/os_monitor/lock.js';
import { reapOrphans } from '../src/os_monitor/reap-orphans.js';

const CRED_PATH = join(homedir(), '.cloudfuze-aigov', 'credentials.json');

let creds;
try {
  creds = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
} catch {
  console.error('No credentials found. Enroll first.');
  process.exit(2);
}

if (!creds.token || !creds.serverUrl) {
  console.error('Credentials missing token or serverUrl.');
  process.exit(2);
}

const log = createLogger({ verbose: process.argv.includes('--verbose') });

// Singleton lock
const lockResult = await acquireMonitorLock();
if (!lockResult.acquired) {
  log.error(`Another monitor is already running (pid=${lockResult.heldByPid}).`);
  process.exit(3);
}
log.info(`Acquired singleton lock (pid=${process.pid})`);

await reapOrphans({ log: log.child('reap-orphans') });

const monitor = new OsMonitor({
  serverUrl: creds.serverUrl,
  token: creds.token,
  log: log.child('os_monitor'),
});
monitor.start();
log.info('Monitor running. Ctrl+C to stop.');

const shutdown = async (sig) => {
  log.info(`Received ${sig} — shutting down…`);
  monitor.stop();
  await releaseMonitorLock();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const lockPath = join(homedir(), '.cloudfuze-aigov', 'monitor.lock');
process.on('exit', () => {
  try {
    const content = readFileSync(lockPath, 'utf8');
    if (parseInt(content.trim(), 10) === process.pid) unlinkSync(lockPath);
  } catch {}
});
