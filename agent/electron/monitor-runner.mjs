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
import { enforcerEnabledFromEnv } from '../src/os_monitor/settings-env.js';
import { startBlockedAgentsSync } from '../src/os_monitor/blocked-agents-sync.js';

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

// Electron passes the "Keystroke enforcer" checkbox down as CFAI_ENFORCER_ENABLED.
// Unset (agent launched from the CLI) means enabled, as before.
const enforcerEnabled = enforcerEnabledFromEnv(process.env);
if (!enforcerEnabled) {
  log.info('Keystroke enforcer disabled in settings — passive DLP watchers only.');
}

const monitor = new OsMonitor({
  serverUrl: creds.serverUrl,
  token: creds.token,
  log: log.child('os_monitor'),
  enforcerEnabled,
});
monitor.start();
log.info('Monitor running. Ctrl+C to stop.');

// Control channel from Electron main (ultimately the block dialog's Tokenize
// button). The only accepted message is {cmd:"tokenize", block_id} — relayed
// straight through to the enforcer, which independently validates the id
// against its own pinned state. No text ever flows down this path.
let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk;
  let idx;
  while ((idx = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, idx).trim();
    stdinBuf = stdinBuf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.cmd === 'tokenize' && msg.block_id) {
        monitor.tokenize(msg.block_id);
      }
    } catch { /* ignore malformed input */ }
  }
});

// ── Blocked agents poller ──────────────────────────────────────────────────
// The whole sync (blocked-agents + ai-platforms + access exceptions, and the
// offline access-request flush) lives in src/os_monitor/blocked-agents-sync.js
// so the bare-Node CLI entry point (src/index.js --monitor, which build:sea
// compiles into the standalone .exe) runs the exact same code. It used to be
// inline HERE only, which silently made every server-driven block inert for
// anyone who installed the CLI/.exe distribution instead of the Electron app.
startBlockedAgentsSync({ serverUrl: creds.serverUrl, token: creds.token, log });

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
