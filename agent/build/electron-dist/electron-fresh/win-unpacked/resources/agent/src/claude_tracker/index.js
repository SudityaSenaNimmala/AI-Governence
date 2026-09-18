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
// The full governance stack: keystroke send-blocker, clipboard scanning, file
// dialog + drag-drop capture, DLP pattern policy sync, and the fleet feature
// toggles. Previously this binary shipped without any of it — it counted Claude
// prompts and nothing else — so desktop AI use outside Claude was invisible and
// nothing was ever BLOCKED on the desktop.
import { OsMonitor } from '../os_monitor/index.js';
import { watcherProcessNames } from '../os_monitor/ai-processes.js';
// Shared with the full agent, deliberately: the extension probes one fixed set of
// localhost ports, so two implementations would be two chances to drift apart.
import { startIdentityBeacon } from '../identity-beacon.js';
// Resolves the corporate UPN ("satya.pinniti@cloudfuze.com") rather than the OS
// account name ("SatyaPinniti"). Shared with the full agent so the two cannot
// drift apart, for the same reason the beacon itself is shared.
import { resolveCorporateIdentity } from '../util/corporate-identity.js';
import { ensureClaudeCodeTelemetry } from './claude-code-settings.js';
import { detectClaudeAccount } from './claude-account.js';
import { readNewActivity } from './transcript-reader.js';
import {
  SERVER_URL, ENROLL_SECRET, VERSION, IDENTITY_DOMAIN,
  DESKTOP_PROCESSES, BROWSER_PROCESSES, FLUSH_INTERVAL_MS,
} from './config.js';
import {
  IS_PACKAGED, INSTALL_DIR, INSTALLED_EXE, LOG_PATH,
  SYSTEM_INSTALL_DIR, SYSTEM_INSTALLED_EXE,
  acquireSingleInstanceLock, waitForLockRelease, fileLogger,
  registerAutostart, isAutostartRegistered, stopRunningInstances,
  installFiles, relaunchDetached, uninstall,
  installFilesSystem, registerSystemAutostart, unregisterSystemAutostart,
  isSystemAutostartRegistered, runSystemTaskNow, uninstallSystem,
  sweepPerUserAutostart, supersedePerUserInstall, isSystemCopy,
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

  // WHY A UPN AND NOT THE OS USERNAME. The browser extension enrols with the
  // Intune enrolment UPN pushed as managed policy, and the Claude Code CLI
  // attributes by user.email over OpenTelemetry. Reporting os.userInfo().username
  // here made this machine a THIRD spelling of the same person, and
  // server/src/routes/ai-usage.js groups by machines.user — so one human showed
  // up as two rows with nothing to say they were one. Resolve the same email
  // every other surface already uses.
  const identity = resolveCorporateIdentity({ domain: IDENTITY_DOMAIN });

  // Report the signed-in Claude account so the server can show this machine's
  // Claude Code usage and its desktop/browser usage as ONE person.
  const account = await detectClaudeAccount();
  if (!quiet) {
    if (account) log.info(`Claude account on this machine: ${account.email}`);
    else log.info('no signed-in Claude account found — reporting under OS username only');
    // Logged because os_user is the one value that will NOT merge with the browser
    // extension. Seeing it here is the cheapest way to catch a machine that is not
    // Entra-joined, or a UPN outside the configured domain, before it turns up as
    // a mystery second row in the dashboard.
    log.info(`reporting as: ${identity.user} (source: ${identity.source})`);
    if (identity.source === 'os_user') {
      log.warn('no corporate UPN found — this machine will NOT merge with its browser extension');
    }
  }

  const body = {
    machineId: id,
    hostname: os.hostname(),
    user: identity.user,
    identitySource: identity.source,
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
    // The SAME identity this process just enrolled with, so an extension reading
    // the beacon cannot attribute to a different string than the agent beside it.
    const identity = resolveCorporateIdentity({ domain: IDENTITY_DOMAIN });
    startIdentityBeacon({
      machineId: creds.machineId,
      user: identity.user,
      identitySource: identity.source,
      log,
    });
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
  const user = resolveCorporateIdentity({ domain: IDENTITY_DOMAIN }).user;

  // EVERY AI desktop app, not just Claude.
  //
  // This list used to be DESKTOP_PROCESSES (['Claude']), which is what made the
  // binary a Claude-only tracker: Cursor, ChatGPT Desktop and Copilot-in-IDE
  // typed prompts were never seen. watcherProcessNames() is the same catalog the
  // OS monitor uses, so the two cannot drift.
  //
  // trackerMode stays on. It sets CFAI_CLAUDE_TRACKER=1, which the PS1 uses for
  // its browser-side behaviour, and the Claude Usage dashboard depends on the
  // events that produces.
  const watcher = new PromptWatcher({
    log,
    aiProcessNames: watcherProcessNames(),
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
  log.info(`watching: ${watcherProcessNames().length} AI desktop apps + claude.ai in ${BROWSER_PROCESSES.join(', ')}`);
  log.info('Prompt text is never sent — only a character count. Ctrl+C to stop.');

  // The governance half. skipPromptWatcher because `watcher` above already covers
  // typed prompts for the same process list — two watchers would double-count
  // every prompt and run two copies of the PowerShell helper.
  //
  // Non-fatal by design: if the enforcer cannot arm (a locked-down machine, a
  // missing helper), prompt counting and the identity beacon must still work.
  // A machine that reports nothing is worse than one that reports without
  // blocking.
  let monitor = null;
  try {
    monitor = new OsMonitor({
      serverUrl: SERVER_URL,
      token: creds.token,
      log,
      skipPromptWatcher: true,
    });
    monitor.start();
    log.info('governance: clipboard + file dialogs + drag-drop + send-blocker armed');
  } catch (err) {
    monitor = null;
    log.warn(`governance stack not started: ${err?.message || err}`);
    log.warn('prompt counting and identity still active');
  }

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
          // Lets the server tell a VS Code / Cursor session from a terminal one.
          // Transcripts do not record that; only Claude Code's OTel does, so the
          // server joins the two on this id. Named claude_session_id rather than
          // session_id deliberately — the latter drives Session Replay.
          claude_session_id: p.sessionId || null,
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
    // Before the poster flush: stopping the monitor releases the low-level
    // keyboard hook, and leaving that installed after exit is what the enforcer
    // watchdog exists to clean up.
    try { monitor?.stop(); } catch { /* best effort — never block shutdown */ }
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

// The Intune / silent path. NO console UI, NO countdown, NO HKCU: everything is
// machine-wide (ProgramData + an all-users logon Scheduled Task) so a single
// SYSTEM-context push covers every account on the box with zero clicks. Prints
// terse lines (captured in the Intune install log) and exits 0 on success so
// Intune records it as installed. Refuses to run from a dev `node` process, which
// would register a task pointing at node.exe.
async function runSystemInstaller() {
  if (!IS_PACKAGED) {
    console.error('--install-system requires the packaged .exe, not a dev node run.');
    process.exitCode = 1;
    return;
  }
  const watcherScript = findWatcherScript();
  if (!watcherScript) {
    console.error('SETUP FAILED: prompt-watcher.ps1 missing next to the .exe. Package both files together.');
    process.exitCode = 1;
    return;
  }
  try {
    await stopRunningInstances();
    // A machine from the pilot still has a per-user HKCU autostart pointing at the
    // old build. Left in place it starts first at the next logon, takes the
    // single-instance lock and the beacon port, and the fleet copy exits — so the
    // machine keeps reporting the OS username and never merges with its extension.
    const swept = await sweepPerUserAutostart();
    if (swept.length) console.log(`superseded ${swept.length} per-user pilot autostart(s)`);
    const files = await installFilesSystem(watcherScript);
    console.log(`files      ${files.dir}`);
    await registerSystemAutostart(files.exe);
    console.log(`autostart  all-users logon task "${'CloudFuze\\ClaudeTracker'}" registered`);
    // Start now for anyone already logged in; harmless no-op if nobody is.
    const started = await runSystemTaskNow();
    console.log(`running    ${started ? 'started in the active session' : 'will start at next logon'}`);
    console.log('Done. Silent fleet install complete.');
  } catch (err) {
    console.error(`SETUP FAILED: ${err?.message || err}`);
    process.exitCode = 1;
  }
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
  const systemInstalled = existsSync(SYSTEM_INSTALLED_EXE);
  const systemAutostart = await isSystemAutostartRegistered();
  // The lock is held by a live tracker, so failing to take it means one is up.
  const free = await acquireSingleInstanceLock();
  if (free) free.close();

  console.log('');
  console.log(`  installed        ${installed ? INSTALLED_EXE : 'no'}`);
  console.log(`  autostart        ${autostart ? 'registered (HKCU Run)' : 'not registered'}`);
  console.log(`  fleet installed  ${systemInstalled ? SYSTEM_INSTALLED_EXE : 'no'}`);
  console.log(`  fleet autostart  ${systemAutostart ? 'registered (all-users logon task)' : 'not registered'}`);
  console.log(`  running          ${free ? 'no' : 'yes'}`);
  console.log(`  log              ${existsSync(LOG_PATH) ? LOG_PATH : '(none yet)'}`);
  console.log('');
}

async function main() {
  if (process.platform !== 'win32') {
    log.error('This tracker relies on Windows UI Automation and only runs on Windows.');
    process.exit(1);
  }

  // THE WATCHDOG RE-ENTRY, checked before anything else.
  //
  // The keystroke enforcer installs a WH_KEYBOARD_LL hook. If this process is
  // hard-killed the hook outlives it, so a detached sibling watches the parent
  // and releases it. From source that sibling is enforcer-watchdog.js run by
  // node; in the packaged binary there is no such file, so the agent re-execs
  // ITSELF with this flag and lands here.
  //
  // First in main() deliberately: this path must not enrol, start a beacon, take
  // the single-instance lock, or do anything else the real agent does.
  if (process.argv.includes('--enforcer-watchdog')) {
    const i = process.argv.indexOf('--enforcer-watchdog');
    const parentPid = parseInt(process.argv[i + 1], 10);
    const statePath = process.argv[i + 2] || undefined;
    if (!parentPid) {
      process.stderr.write('usage: --enforcer-watchdog <parentPid> [statePath]\n');
      process.exit(2);
    }
    const { runWatcher, ENFORCER_PID_PATH } = await import('../os_monitor/enforcer-watchdog.js');
    await runWatcher(parentPid, statePath || ENFORCER_PID_PATH).catch((e) => {
      process.stderr.write(`enforcer-watchdog fatal: ${e?.stack || e}\n`);
      process.exit(1);
    });
    return;
  }

  const argv = new Set(process.argv.slice(2));

  // Silent, all-users install/uninstall — how Intune (SYSTEM context) deploys it.
  if (argv.has('--install-system')) return await runSystemInstaller();
  if (argv.has('--uninstall-system')) {
    const r = await uninstallSystem();
    console.log(`Removed all-users logon task (${r.removedTask ? 'was present' : 'not present'}).`);
    console.log(`Files left in place: ${r.dir}`);
    return;
  }

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
  // THE MACHINE-WIDE COPY TAKES PRECEDENCE, it does not queue behind a pilot.
  // Deferring to whoever holds the lock is right between two equal copies and
  // wrong here: the other holder may be an old per-user pilot build that will
  // hold it forever, keeping the machine on the pre-UPN identity. So claim the
  // ground first — drop this user's stale HKCU autostart and stop any other
  // instance — and only then take the lock.
  if (isSystemCopy()) {
    const r = await supersedePerUserInstall();
    if (r.removedKey || r.killed) {
      log.info(`superseded a per-user install (autostart removed: ${r.removedKey}, process stopped: ${r.killed})`);
    }
  }
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
