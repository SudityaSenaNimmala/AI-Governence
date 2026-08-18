#!/usr/bin/env node
// CloudFuze Claude Usage Tracker — a Claude-only, metering-only endpoint agent.
//
// What it does, in order:
//   1. Enrols with the governance server (baked-in URL + secret) and caches a token.
//   2. Merges Claude Code CLI telemetry settings so the CLI reports REAL token
//      counts and cost to the server.
//   3. Watches for Claude prompts via UI Automation:
//        - Claude Desktop (process 'claude')
//        - claude.ai in Chrome / Edge / Brave / Firefox, behind a URL gate
//      and splits claude.ai/code into its own surface.
//   4. Batches prompt events to /api/v1/dlp every 15s.
//
// HOW IT RUNS. Double-clicking the exe installs it (see service.js) and hands
// off to a detached, windowless copy that starts again at every logon. Tracking
// therefore does not depend on a console window staying open — closing the
// install window, or any window, stops nothing. Modes:
//   (none)        install, relaunch in the background, report, exit
//   --service     the background run: no console, logs to tracker.log
//   --console     run in this window, logging to stdout (debugging)
//   --status      report whether it is installed, running, and where the log is
//   --uninstall   stop it and remove the logon entry
//
// What it deliberately does NOT do: no prompt text leaves the machine (only a
// character count), no DLP scanning, no file/attachment watching, no traffic
// interception, no browser-history reading. Prompt counts and lengths only.

import os from 'node:os';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PromptWatcher } from '../os_monitor/prompt-watcher.js';
// Shared with the full agent, deliberately: the extension probes one fixed set of
// localhost ports, so two implementations would be two chances to drift apart.
import { startIdentityBeacon } from '../identity-beacon.js';
import { ensureClaudeCodeTelemetry } from './claude-code-settings.js';
import { detectClaudeAccount } from './claude-account.js';
import { readNewActivity } from './transcript-reader.js';
import {
  SERVER_URL, ENROLL_SECRET, VERSION,
  DESKTOP_PROCESSES, BROWSER_PROCESSES, FLUSH_INTERVAL_MS,
} from './config.js';
import {
  IS_PACKAGED, INSTALL_DIR, INSTALLED_EXE, LOG_PATH,
  acquireSingleInstanceLock, waitForLockRelease, fileLogger,
  registerAutostart, isAutostartRegistered, stopRunningInstances,
  installFiles, relaunchDetached, uninstall,
} from './service.js';

const STATE_DIR = join(os.homedir(), '.cloudfuze-claude-tracker');
const CREDS_PATH = join(STATE_DIR, 'credentials.json');

// Swapped for a file writer in --service mode, where there is no console to
// write to. Kept behind a function rather than reassigning `log` so that every
// module already holding a reference to `log` follows the switch.
let sink = null;
const log = {
  info: (m) => (sink ? sink(`[claude-tracker] ${m}`) : console.log(`[claude-tracker] ${m}`)),
  warn: (m) => (sink ? sink(`[claude-tracker] WARN ${m}`) : console.warn(`[claude-tracker] WARN ${m}`)),
  error: (m) => (sink ? sink(`[claude-tracker] ERROR ${m}`) : console.error(`[claude-tracker] ERROR ${m}`)),
};

// Locate prompt-watcher.ps1. In a SEA build there is no source tree, so we look
// beside the executable first; in a dev run we fall back to the module's own
// directory. Returning null lets main() fail with a clear message instead of a
// confusing PowerShell error.
function findWatcherScript() {
  const candidates = [
    join(dirname(process.execPath), 'prompt-watcher.ps1'),
    join(dirname(process.execPath), 'resources', 'prompt-watcher.ps1'),
    // The installed copy, for a --service start from the logon entry. Listed
    // after the exe's own folder so a developer running the build output still
    // gets the script sitting next to it rather than a stale installed one.
    join(INSTALL_DIR, 'prompt-watcher.ps1'),
  ];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), '..', 'os_monitor', 'prompt-watcher.ps1'));
  } catch { /* import.meta.url is unavailable in some bundled contexts */ }
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// Stable per-machine+user id so re-runs land on the same machine record.
function machineId() {
  const seed = `${os.hostname()}|${os.userInfo().username}|claude-tracker`;
  return 'clautrk:' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

async function loadCreds() {
  try { return JSON.parse(await readFile(CREDS_PATH, 'utf8')); } catch { return null; }
}

async function saveCreds(creds) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(CREDS_PATH, JSON.stringify(creds, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

// Enrols on every start rather than trusting the cache blindly. This keeps the
// machine record current — the signed-in Claude account can change, and that link
// is what makes one person appear as one user. The cached token is kept as an
// offline fallback so a machine with no connectivity still records prompts.
async function enroll({ quiet = false } = {}) {
  const id = machineId();

  // Report the signed-in Claude account so the server can show this machine's
  // Claude Code usage and its desktop/browser usage as ONE person.
  const account = await detectClaudeAccount();
  if (!quiet) {
    if (account) log.info(`Claude account on this machine: ${account.email}`);
    else log.info('no signed-in Claude account found — reporting under OS username only');
  }

  const body = {
    machineId: id,
    hostname: os.hostname(),
    user: os.userInfo().username,
    claudeAccountEmail: account?.email || undefined,
    displayName: account?.displayName || undefined,
    enrollSecret: ENROLL_SECRET,
  };

  try {
    const res = await fetch(`${SERVER_URL}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const creds = await res.json();
    await saveCreds({ ...creds, machineId: id });
    if (!quiet) log.info(`enrolled as ${id}`);
    return { ...creds, machineId: id };
  } catch (err) {
    const cached = await loadCreds();
    if (cached?.token && cached?.machineId === id) {
      log.warn(`enrol failed (${err?.message || err}) — using cached token, will retry on next 401`);
      return cached;
    }
    throw new Error(`enrol failed and no cached token available: ${err?.message || err}`);
  }
}

// Batching poster. Events are re-queued on failure so a flaky network or a
// server restart doesn't silently lose prompt counts.
class Poster {
  constructor(token) {
    this.token = token;
    this.queue = [];
    this.sending = false;
    this.reAuthAttempts = 0;
  }

  add(ev) { this.queue.push(ev); }

  // Token usage goes to its own endpoint (it is not a DLP event). Re-auth is
  // handled the same way as event delivery.
  async postTokens(rows) {
    if (!rows?.length) return;
    const send = () => fetch(`${SERVER_URL}/api/v1/claude-usage/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
      body: JSON.stringify({ rows }),
    });
    try {
      let res = await send();
      if (res.status === 401 && await this.#reAuth()) res = await send();
      if (!res.ok) log.warn(`POST /claude-usage/tokens -> HTTP ${res.status} (${rows.length} rows dropped)`);
      else log.info(`reported ${rows.length} Claude Code usage record(s)`);
    } catch (err) {
      log.warn(`POST /claude-usage/tokens failed: ${err?.message || err}`);
    }
  }

  // A 401 means our machine token is no longer accepted — typically because the
  // server's signing secret changed. Re-enrol once and retry; without this the
  // tracker would retry a dead token forever and silently bank prompts it can
  // never deliver.
  async #reAuth() {
    if (this.reAuthAttempts >= 3) return false;
    this.reAuthAttempts++;
    try {
      const fresh = await enroll({ quiet: true });
      this.token = fresh.token;
      log.info('re-enrolled after 401 — retrying delivery');
      return true;
    } catch (err) {
      log.warn(`re-enrolment failed: ${err?.message || err}`);
      return false;
    }
  }

  async flush() {
    if (this.sending || this.queue.length === 0) return;
    this.sending = true;
    const batch = this.queue.splice(0, 200);
    try {
      let res = await fetch(`${SERVER_URL}/api/v1/dlp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
        body: JSON.stringify({ events: batch }),
      });

      if (res.status === 401 && await this.#reAuth()) {
        res = await fetch(`${SERVER_URL}/api/v1/dlp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
          body: JSON.stringify({ events: batch }),
        });
      }

      if (!res.ok) {
        this.queue.unshift(...batch);
        log.warn(`POST /api/v1/dlp -> HTTP ${res.status}; re-queued ${batch.length}`);
      } else {
        this.reAuthAttempts = 0;   // a good delivery clears the re-auth budget
        log.info(`reported ${batch.length} prompt event(s)`);
      }
    } catch (err) {
      this.queue.unshift(...batch);
      log.warn(`POST /api/v1/dlp failed (${err?.message || err}); re-queued ${batch.length}`);
    } finally {
      this.sending = false;
    }
  }
}

async function runTracker() {
  log.info(`CloudFuze Claude Usage Tracker v${VERSION}`);
  log.info(`server: ${SERVER_URL}`);

  const watcherScript = findWatcherScript();
  if (!watcherScript) {
    log.error('prompt-watcher.ps1 not found next to the executable.');
    log.error('Keep prompt-watcher.ps1 in the same folder as this .exe and re-run.');
    process.exit(1);
  }

  const creds = await enroll();

  // Identity beacon — the same localhost server the full agent runs.
  //
  // Without it a browser extension on this machine cannot discover which machine
  // it is on. Its enrolment falls back to navigator.userAgent, so it registers as
  // "Mozilla-browser-extension" with no OS user — and the Claude Usage table
  // either lists that person as a second, differently-named row or, when Chrome
  // supplies no profile email, drops them into unattributed and shows nothing at
  // all. With the beacon the extension enrols as "<HOSTNAME>-browser-extension",
  // which is what routes/identity.js matches back to this machine's profile and
  // what folds both enrolments into one person.
  //
  // Worth doing before a rollout rather than after: the hostname is baked at the
  // extension's FIRST enrolment and never revisited, so an extension that
  // enrolled while no beacon was listening keeps calling itself Mozilla until its
  // storage is cleared.
  //
  // Listens on 127.0.0.1 only, serves one GET, and returns hostname / user /
  // machineId — the same three fields this tracker just sent to the server.
  try {
    // This log object is a plain {info,warn,error}; the beacon calls through
    // optional chaining, so it needs no child-logger support.
    startIdentityBeacon({ machineId: creds.machineId, log });
  } catch (err) {
    // Never fatal: the beacon is a convenience for the extension, and prompt
    // tracking — the reason this binary exists — does not depend on it.
    log.warn(`identity beacon not started: ${err?.message || err}`);
  }

  // Claude Code CLI -> real tokens + cost.
  try {
    const r = await ensureClaudeCodeTelemetry(SERVER_URL, log);
    if (r.changed) {
      log.info(`Claude Code telemetry enabled in ${r.path}${r.backedUp ? ' (previous file backed up)' : ''}`);
      log.info('Restart any open Claude Code session for it to take effect.');
    } else {
      log.info(`Claude Code telemetry: no change needed (${r.reason})`);
    }
  } catch (err) {
    log.warn(`could not configure Claude Code telemetry: ${err?.message || err}`);
  }

  const poster = new Poster(creds.token);
  const user = os.userInfo().username;

  const watcher = new PromptWatcher({
    log,
    aiProcessNames: DESKTOP_PROCESSES,
    browserProcessNames: BROWSER_PROCESSES,
    trackerMode: true,
    scriptPath: watcherScript,
  });

  watcher.on('prompt_submit', (ev) => {
    // ev = { t, kind, pid, process, service, len } — no prompt text.
    poster.add({
      source: 'claude_tracker',
      service: ev.service,          // 'Claude' | 'Claude Code (web)'
      kind: 'prompt_submit',
      content_length: ev.len ?? 0,
      user,
      occurredAt: ev.t || new Date().toISOString(),
      metadata: { via: 'uia', process: ev.process, tracker_version: VERSION },
    });
    log.info(`prompt: ${ev.service} (${ev.len} chars) via ${ev.process}`);
  });

  watcher.start();
  log.info(`watching: Claude Desktop + claude.ai in ${BROWSER_PROCESSES.join(', ')}`);
  log.info('Prompt text is never sent — only a character count. Ctrl+C to stop.');

  const timer = setInterval(() => poster.flush(), FLUSH_INTERVAL_MS);

  // Claude Code CLI usage, read from local transcripts. This is the reliable
  // path: OTel drops whatever it emits while the server is unreachable, whereas
  // the transcripts persist and are replayed here (deduped by message uuid).
  const scanTranscripts = async () => {
    try {
      const { prompts, usage } = await readNewActivity({ log });
      const email = lastSeenAccount || undefined;

      for (const p of prompts) {
        poster.add({
          source: 'claude_tracker',
          service: 'Claude Code',
          kind: 'prompt_submit',
          content_length: p.length,
          user,
          occurredAt: p.occurredAt || new Date().toISOString(),
          clientEventId: p.uuid,          // makes replay idempotent
          metadata: { via: 'transcript', tracker_version: VERSION },
        });
      }

      if (usage.length) {
        await poster.postTokens(usage.map((u) => ({ ...u, user_email: email })));
      }
      if (prompts.length) poster.flush();
    } catch (err) {
      log.warn(`transcript scan failed: ${err?.message || err}`);
    }
  };

  // Re-check which Claude account is signed in. People switch accounts (a
  // /login mid-session), and each new account must be registered against this
  // machine or its Claude Code usage shows up as a separate person.
  let lastSeenAccount = (await detectClaudeAccount())?.email || null;
  const accountTimer = setInterval(async () => {
    try {
      const current = (await detectClaudeAccount())?.email || null;
      if (current && current !== lastSeenAccount) {
        lastSeenAccount = current;
        log.info(`Claude account changed to ${current} — re-registering this machine`);
        const fresh = await enroll({ quiet: true });
        poster.token = fresh.token;
      }
    } catch (err) {
      log.warn(`account re-check failed: ${err?.message || err}`);
    }
  }, 60_000);

  // First scan immediately so existing history is picked up, then poll.
  await scanTranscripts();
  const transcriptTimer = setInterval(scanTranscripts, 20_000);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down — flushing pending events');
    clearInterval(timer);
    clearInterval(accountTimer);
    clearInterval(transcriptTimer);
    watcher.stop();
    await poster.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── modes ────────────────────────────────────────────────────────────────────

// The double-click path. Everything it does is per-user: LOCALAPPDATA for the
// files, HKCU for the logon entry. No admin prompt, which is what lets the
// person who downloaded it install it themselves.
async function runInstaller() {
  const line = (m) => console.log(m);
  line('');
  line(`  CloudFuze Claude Usage Tracker v${VERSION}`);
  line(`  Server: ${SERVER_URL}`);
  line('');

  // Locate the helper BEFORE touching anything: installing a binary that cannot
  // start is worse than not installing, because autostart would then fail
  // invisibly at every logon.
  const watcherScript = findWatcherScript();
  if (!watcherScript) {
    line('  SETUP FAILED');
    line('  prompt-watcher.ps1 is missing. Extract the whole ZIP and keep both');
    line('  files in the same folder, then double-click the .exe again.');
    return await hold(20);
  }

  try {
    line('  Installing…');
    await stopRunningInstances();
    await waitForLockRelease();

    const files = await installFiles(watcherScript);
    line(`    files      ${files.dir}`);

    await registerAutostart(files.exe);
    line('    autostart  registered for this user (starts at logon)');

    const pid = relaunchDetached(files.exe);
    line(`    running    background process ${pid ?? '(started)'}`);
    line('');
    line('  Done. Tracking is running in the background.');
    line('  You can close this window — it does NOT stop tracking.');
    line('');
    line(`  Log:       ${LOG_PATH}`);
    line('  Stop it:   run the exe with  --uninstall');
    line('');
  } catch (err) {
    line('');
    line(`  SETUP FAILED: ${err?.message || err}`);
    line('  Nothing was left running. Send the message above to IT.');
    line('');
  }

  await hold(20);
}

// Double-clicking gives a window that vanishes the instant the process exits, so
// a summary nobody can read is the same as no summary. Counts down instead.
async function hold(seconds) {
  for (let s = seconds; s > 0; s--) {
    process.stdout.write(`\r  This window closes in ${s}s…   `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write('\r'.padEnd(40) + '\n');
}

async function runStatus() {
  const installed = existsSync(INSTALLED_EXE);
  const autostart = await isAutostartRegistered();
  // The lock is held by a live tracker, so failing to take it means one is up.
  const free = await acquireSingleInstanceLock();
  if (free) free.close();

  console.log('');
  console.log(`  installed   ${installed ? INSTALLED_EXE : 'no'}`);
  console.log(`  autostart   ${autostart ? 'registered (HKCU Run)' : 'not registered'}`);
  console.log(`  running     ${free ? 'no' : 'yes'}`);
  console.log(`  log         ${existsSync(LOG_PATH) ? LOG_PATH : '(none yet)'}`);
  console.log('');
}

async function main() {
  if (process.platform !== 'win32') {
    log.error('This tracker relies on Windows UI Automation and only runs on Windows.');
    process.exit(1);
  }

  const argv = new Set(process.argv.slice(2));

  if (argv.has('--uninstall')) {
    const r = await uninstall();
    console.log('');
    console.log(`  Stopped and removed from logon startup.`);
    console.log(`  Files left in place: ${r.dir}`);
    console.log('');
    return;
  }

  if (argv.has('--status')) return await runStatus();

  // A dev run (`node src/claude_tracker/index.js`) has nothing sensible to
  // install, so it behaves as it always did: foreground, logging to the console.
  const background = argv.has('--service');
  if (!background && (argv.has('--console') || !IS_PACKAGED)) return await runTracker();
  if (!background) return await runInstaller();

  // --service: the detached run.
  sink = fileLogger();
  const lock = await acquireSingleInstanceLock();
  if (!lock) {
    log.info('another tracker instance is already running — exiting');
    return;
  }
  await runTracker();
}

main().catch((err) => {
  log.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
