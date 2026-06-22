#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { runScan } from './scanner.js';
import { loadConfig } from './config.js';
import { createLogger } from './util/logger.js';
import { loadCredentials, enroll } from './util/credentials.js';
import { runInjector } from './desktop_injector/index.js';
import { OsMonitor } from './os_monitor/index.js';
import { acquireMonitorLock, releaseMonitorLock } from './os_monitor/lock.js';
import { reapOrphans } from './os_monitor/reap-orphans.js';

const { values } = parseArgs({
  options: {
    output: { type: 'string', short: 'o' },
    server: { type: 'string', short: 's' },
    'enroll-secret': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    pretty: { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    only: { type: 'string' },
    skip: { type: 'string' },
    monitor: { type: 'boolean', default: false },
    'inject-desktop': { type: 'boolean', default: false },
    proxy: { type: 'boolean', default: false },
    'proxy-port': { type: 'string' },
    uninstall: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`
CloudFuze AI Governance Agent

Usage: ai-gov-agent [options]

Options:
  -o, --output <file>          Write report JSON to file
  -s, --server <url>           POST report to backend server
      --enroll-secret <secret> Enrollment secret (only needed on first --server run)
      --dry-run                Run all detectors but skip output/upload
      --pretty                 Pretty-print JSON output
      --only <names>           Comma-separated detector names to run exclusively
      --skip <names>           Comma-separated detector names to skip
      --monitor                After the scan, stay alive and run the OS-level
                               AI monitor (foreground + clipboard). Captures
                               sensitive pastes into any AI desktop app
                               regardless of install method (Store, .exe, etc.)
      --inject-desktop         Opt-in: inject the DOM hook into Electron AI apps
                               by modifying app.asar. OFF by default — modifying
                               the asar BRICKS apps that enforce ASAR integrity
                               (current Claude Desktop). Use only for apps known
                               not to enforce it. Desktop block-on-send is better
                               served by --proxy (network-level, no bundle edits).
      --proxy                  Start the local HTTPS DLP proxy on 127.0.0.1
                               (default port 8443). Intercepts outbound HTTPS to
                               known AI vendors and blocks requests containing
                               high/critical patterns. Universal — covers every
                               app, including Store-installed ones we can't hook.
      --proxy-port <port>      Override the proxy listen port (default 8443)
      --uninstall              With --proxy: remove the CloudFuze CA from the
                               user trust store and exit.
  -v, --verbose                Verbose logging
  -h, --help                   Show this help

On first --server run, an enrollment secret is required. The resulting token
is persisted at ~/.cloudfuze-aigov/credentials.json and reused on subsequent runs.
`);
  process.exit(0);
}

const log = createLogger({ verbose: values.verbose });

// --proxy is a standalone subcommand: it does not run the scan, does not need
// --server (unless reporting is enabled), and stays alive until SIGINT.
if (values.proxy) {
  const { runProxy, runProxyUninstall } = await import('./proxy/index.js');
  if (values.uninstall) {
    await runProxyUninstall({ log: log.child('proxy') });
    process.exit(0);
  }
  // Best-effort: use saved creds if present, else run as a local-only proxy
  // (no event upload) so the user can try it before wiring it to the server.
  const { loadCredentials } = await import('./util/credentials.js');
  const creds = await loadCredentials();
  await runProxy({
    serverUrl: creds?.serverUrl || values.server,
    token: creds?.token,
    port: values['proxy-port'] ? Number(values['proxy-port']) : 8443,
    log: log.child('proxy'),
  });
  log.info('Proxy running. Ctrl+C to stop.');
  // process stays alive on the listening socket
} else {

main().catch((err) => {
  log.error('Scan failed:', err.stack || err.message);
  process.exit(1);
});

async function main() {
  const config = await loadConfig({
    only: values.only?.split(',').map((s) => s.trim()).filter(Boolean),
    skip: values.skip?.split(',').map((s) => s.trim()).filter(Boolean),
  });

  log.info(`Starting scan — agent v${config.agentVersion} on ${config.platform}`);
  const report = await runScan({ config, log });
  log.info(
    `Scan complete: ${report.findings.length} findings across ${report.summary.detectorsRun} detectors in ${report.summary.durationMs}ms`
  );

  if (values['dry-run']) {
    log.info('--dry-run set, skipping output');
    process.exit(0);
  }

  const json = values.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);

  if (values.output) {
    const path = resolve(values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, json, 'utf8');
    log.info(`Report written to ${path}`);
  }

  if (values.server) {
    let creds = await loadCredentials();
    if (!creds || creds.serverUrl !== values.server.replace(/\/$/, '')) {
      if (!values['enroll-secret']) {
        log.error('No credentials found. First-time run requires --enroll-secret.');
        process.exit(2);
      }
      log.info('Enrolling with server…');
      creds = await enroll({
        serverUrl: values.server,
        machineId: config.machineId,
        hostname: config.hostname,
        enrollSecret: values['enroll-secret'],
      });
      log.info(`Enrolled. Token stored at ~/.cloudfuze-aigov/credentials.json`);
    }

    const res = await fetch(`${creds.serverUrl}/api/v1/reports`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${creds.token}`,
      },
      body: json,
    });
    if (!res.ok) {
      log.error(`Server returned ${res.status}: ${await res.text()}`);
      process.exit(2);
    }
    log.info(`Report uploaded to ${creds.serverUrl}`);

    // Desktop hook injector — OPT-IN ONLY (--inject-desktop).
    //
    // Modifying an Electron app's app.asar bricks any app that enforces ASAR
    // integrity validation (current Claude Desktop builds do): the modified
    // archive fails the embedded hash check and the app refuses to launch.
    // We learned this the hard way, so injection no longer runs on a normal
    // --server scan. Desktop coverage is provided by the OS monitor (detect +
    // notify) and the HTTPS proxy (network-level block) — neither of which
    // touches the app bundle. Use --inject-desktop only for Electron apps
    // known NOT to enforce integrity (e.g. Cursor, older builds).
    //
    // Runs AFTER report upload so we have a valid enrolled token to embed.
    if (values['inject-desktop']) {
      try {
        const injectorFindings = await runInjector({
          platform: config.platform,
          serverUrl: creds.serverUrl || values.server,
          token: creds.token,
          log: log.child('desktop_injector'),
        });
        log.info(`Desktop injector: ${injectorFindings.length} app(s) processed`);
      } catch (err) {
        log.warn('desktop_injector failed: ' + (err?.message || err));
      }
    }
  }

  if (!values.output && !values.server) {
    process.stdout.write(json + '\n');
  }

  // --monitor: stay alive and run the OS-level AI monitor. Captures sensitive
  // pastes into any AI desktop app regardless of how it was installed.
  // Requires server + a valid token (enrolled above).
  if (values.monitor) {
    if (!values.server) {
      log.error('--monitor requires --server (the OS monitor reports events to /api/v1/dlp)');
      process.exit(2);
    }
    const creds = await loadCredentials();
    if (!creds?.token) {
      log.error('--monitor requires an enrolled token. Run with --enroll-secret first.');
      process.exit(2);
    }

    // Singleton check — only one --monitor instance per machine. Without this,
    // background restarts can leave orphan pollers alive that fire duplicate
    // toasts and double-write events to the server.
    const lockResult = await acquireMonitorLock();
    if (!lockResult.acquired) {
      log.error(`Another --monitor instance is already running (pid=${lockResult.heldByPid}). Stop it first, or remove ~/.cloudfuze-aigov/monitor.lock if you're sure it's stale.`);
      process.exit(3);
    }
    log.info(`Acquired singleton lock (pid=${process.pid})`);

    // Reap any orphan poller/toast-helper processes left by prior crashes.
    // Safe to do this now because the lock guarantees no other monitor is alive.
    await reapOrphans({ log: log.child('reap-orphans') });

    const monitor = new OsMonitor({
      serverUrl: creds.serverUrl || values.server,
      token: creds.token,
      log: log.child('os_monitor'),
    });
    monitor.start();
    log.info('Monitor running. Ctrl+C to stop.');

    const shutdown = async (sig) => {
      log.info(`Received ${sig} — flushing pending events and exiting…`);
      monitor.stop();
      await releaseMonitorLock();
      // Give the reporter a moment to drain the final flush.
      setTimeout(() => process.exit(0), 500);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Best-effort release on hard exit (uncaught exception etc.).
    // 'exit' handlers must be synchronous, so we use sync fs calls.
    const lockPath = join(homedir(), '.cloudfuze-aigov', 'monitor.lock');
    process.on('exit', () => {
      try {
        const content = readFileSync(lockPath, 'utf8');
        if (parseInt(content.trim(), 10) === process.pid) unlinkSync(lockPath);
      } catch {}
    });
    return; // do not fall through to process.exit
  }
}

} // end of !proxy branch
