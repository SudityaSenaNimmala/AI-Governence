// Windows system-proxy registration.
//
// Sets HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings so
// every WinINet-using app (Edge, Chrome, every Electron app — Claude Desktop,
// Cursor, Slack, Discord, etc.) routes outbound HTTPS through our proxy at
// 127.0.0.1:8443. Then any other DLP layer (asar hook, OS monitor, browser
// extension) becomes "in addition to" rather than "instead of".
//
// Two activation modes:
//
//   - 'pac' (DEFAULT, recommended): writes AutoConfigURL to a localhost PAC
//     server. The PAC returns "PROXY 127.0.0.1:8443; DIRECT" — browsers fall
//     back to DIRECT if the MITM is unreachable, so a crashed proxy degrades
//     gracefully (AI traffic temporarily unproxied) instead of bricking ALL
//     browsing (ERR_PROXY_CONNECTION_FAILED). This is the right mode for
//     real users.
//
//   - 'static' (legacy / tests): writes ProxyServer=host:port directly. No
//     graceful fallback — if the MITM dies, every browser breaks until we
//     restore the registry. Use only when you control the lifecycle (tests,
//     dev with --proxy-mode static).
//
// Safety contract — read before changing anything here:
//
//   1. ALWAYS save existing values FIRST and write them to
//      ~/.cloudfuze-aigov/proxy-state.json. If our process dies hard
//      (kill -9, BSOD), the watchdog OR the user via
//      `node src/index.js --proxy --uninstall` recovers via this file.
//
//   2. ALWAYS register process-exit hooks (SIGINT/SIGTERM/uncaughtException)
//      that restore. Even Ctrl+C must leave the system in the original state.
//
//   3. In 'static' mode, NEVER activate without first verifying the proxy
//      port is actually accepting connections — otherwise we'd brick all
//      outbound HTTPS the moment the user Ctrl+Cs without uninstalling.
//      In 'pac' mode the listen-probe is still done but treated as a warning,
//      since PAC's DIRECT fallback covers the case.
//
//   4. Group Policy in enterprise environments can pin proxy settings;
//      our HKCU writes get reverted on next refresh. That's the right
//      behavior — IT has chosen its own proxy strategy. We log the
//      conflict but don't fight it.

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import { connect as netConnect } from 'node:net';
import os from 'node:os';

const STATE_DIR  = join(os.homedir(), '.cloudfuze-aigov');
const STATE_PATH = join(STATE_DIR, 'proxy-state.json');

const REG_PATH = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

// Bypass list — anything matching these does NOT go through our proxy.
// `<local>` skips any host without a dot (intranet shortnames). `<-loopback>`
// is a special v10 token meaning "don't bypass loopback even though we'd
// normally short-circuit it" — IMPORTANT, since our proxy itself is on
// localhost and we need other localhost services to still bypass.
//
// Tradeoff: with <-loopback> set, all 127.x traffic flows through our
// proxy too (including this very proxy talking to localhost services from
// the same Node process — but Node uses its own non-WinINet HTTP stack so
// that's fine). Without it, some Electron apps with embedded localhost UIs
// would never see the proxy at all. We choose to intercept loopback because
// some AI apps use localhost helpers we want to cover (e.g., Cursor's
// internal language servers don't talk to AI vendors anyway so this is
// safe).
const DEFAULT_BYPASS = [
  '<local>',
  '127.*',
  '10.*',
  '172.16.*', '172.17.*', '172.18.*', '172.19.*',
  '172.20.*', '172.21.*', '172.22.*', '172.23.*',
  '172.24.*', '172.25.*', '172.26.*', '172.27.*',
  '172.28.*', '172.29.*', '172.30.*', '172.31.*',
  '192.168.*',
  '*.local',
  // Keep loopback in proxy path so localhost AI helpers route through us:
  // (NO <-loopback> — we WANT WinINet's default loopback bypass here, which
  // protects this proxy from infinite-looping when it calls back to itself
  // through the system proxy. Our outbound https.request inside the proxy
  // bypasses WinINet anyway because Node uses its own TLS stack.)
].join(';');

let _exitHooksInstalled = false;
let _restoreOnExit = null;

/**
 * Activate the system proxy.
 *
 * @param {object} opts
 * @param {'pac'|'static'} [opts.mode='pac']  PAC (graceful fallback) or static (no fallback).
 * @param {string} [opts.host='127.0.0.1']    MITM host. Used by listen-probe and static mode.
 * @param {number} [opts.port=8443]           MITM port.
 * @param {string} [opts.pacUrl]              REQUIRED in 'pac' mode. e.g. http://127.0.0.1:8445/proxy.pac
 *
 * Returns the saved original state for inspection / logging. On any failure
 * in 'static' mode, throws WITHOUT having modified the registry. In 'pac'
 * mode, a failing listen-probe is logged but does not abort (PAC fallback
 * keeps users browsing).
 */
export async function activateSystemProxy({
  mode = 'pac',
  host = '127.0.0.1',
  port = 8443,
  pacUrl,
  log,
} = {}) {
  if (process.platform !== 'win32') {
    log?.warn?.(`proxy/system: skipped — not win32 (${process.platform})`);
    return { activated: false, reason: 'not-win32' };
  }
  if (mode !== 'pac' && mode !== 'static') {
    throw new Error(`proxy/system: unknown mode '${mode}' (expected 'pac' or 'static')`);
  }
  if (mode === 'pac' && !pacUrl) {
    throw new Error(`proxy/system: mode='pac' requires pacUrl`);
  }

  // 1. Confirm the proxy is actually listening. In static mode, this is a
  //    hard requirement — without it, the user's browsing would brick. In
  //    PAC mode, it's a soft check: PAC's DIRECT fallback covers the case
  //    of a non-listening proxy, so we log and continue.
  try {
    await ensureListening(host, port, 2000);
  } catch (e) {
    if (mode === 'static') throw e;
    log?.warn?.(`proxy/system: MITM not listening at activation time (${e.message}). ` +
                `PAC fallback will keep traffic flowing direct until proxy is up.`);
  }

  // 2. Capture current settings BEFORE writing anything.
  const original = await readSettings();
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify({
    savedAt: new Date().toISOString(),
    activatedBy: process.pid,
    mode,
    proxyHostPort: `${host}:${port}`,
    pacUrl: mode === 'pac' ? pacUrl : null,
    original,
  }, null, 2), 'utf8');
  log?.info?.(`proxy/system: saved original settings to ${STATE_PATH}`);

  // 3. Write the new settings. PAC mode uses AutoConfigURL (with ProxyEnable=0
  //    so the static fields don't shadow PAC). Static mode uses ProxyServer.
  if (mode === 'pac') {
    await writeSettings({
      ProxyEnable:   0,            // static off — PAC is the source of truth
      ProxyServer:   '',
      ProxyOverride: DEFAULT_BYPASS,
      AutoConfigURL: pacUrl,
    });
    log?.info?.(`proxy/system: activated PAC mode -> ${pacUrl}`);
  } else {
    await writeSettings({
      ProxyEnable:   1,
      ProxyServer:   `${host}:${port}`,
      ProxyOverride: DEFAULT_BYPASS,
      AutoConfigURL: '',           // empty out any PAC URL (would shadow ProxyServer)
    });
    log?.info?.(`proxy/system: activated STATIC mode -> ${host}:${port}`);
  }
  await notifyWinInet();

  // 4. Register restore hooks so Ctrl+C, SIGTERM, uncaughtException ALL
  //    revert the registry before exit.
  _restoreOnExit = async (signal) => {
    log?.info?.(`proxy/system: restoring original settings (signal=${signal || 'normal'})`);
    try {
      await restoreFromState(log);
    } catch (e) {
      log?.warn?.(`proxy/system: restore failed: ${e?.message || e}`);
    }
  };
  installExitHooks();

  return { activated: true, mode, original, proxy: `${host}:${port}`, pacUrl: mode === 'pac' ? pacUrl : null };
}

/**
 * Restore the system proxy to what it was before activate(). Idempotent.
 * Reads ~/.cloudfuze-aigov/proxy-state.json — if missing, this is a no-op.
 */
export async function deactivateSystemProxy({ log } = {}) {
  if (process.platform !== 'win32') return { restored: false, reason: 'not-win32' };
  return restoreFromState(log);
}

async function restoreFromState(log) {
  try {
    await access(STATE_PATH, fsConstants.R_OK);
  } catch {
    log?.info?.('proxy/system: no proxy-state.json — nothing to restore');
    return { restored: false, reason: 'no-state' };
  }
  const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
  await writeSettings(state.original);
  await notifyWinInet();
  await unlink(STATE_PATH).catch(() => {});
  log?.info?.(`proxy/system: restored (was enable=${state.original.ProxyEnable}, server=${state.original.ProxyServer || '<none>'})`);
  return { restored: true, restoredOriginal: state.original };
}

// ---- Registry helpers (PowerShell) ----

/** Snapshot the four keys we'll modify. Missing keys come back as null. */
async function readSettings() {
  const script = [
    `$p = Get-ItemProperty -Path '${REG_PATH}' -ErrorAction SilentlyContinue;`,
    `ConvertTo-Json -Compress -InputObject @{`,
    `  ProxyEnable   = if ($null -ne $p.ProxyEnable)   { [int]$p.ProxyEnable }   else { 0 };`,
    `  ProxyServer   = if ($null -ne $p.ProxyServer)   { [string]$p.ProxyServer } else { '' };`,
    `  ProxyOverride = if ($null -ne $p.ProxyOverride) { [string]$p.ProxyOverride } else { '' };`,
    `  AutoConfigURL = if ($null -ne $p.AutoConfigURL) { [string]$p.AutoConfigURL } else { '' };`,
    `};`,
  ].join(' ');
  const out = (await runPwsh(script)).trim();
  if (!out) return { ProxyEnable: 0, ProxyServer: '', ProxyOverride: '', AutoConfigURL: '' };
  return JSON.parse(out);
}

async function writeSettings({ ProxyEnable, ProxyServer, ProxyOverride, AutoConfigURL }) {
  // Set-ItemProperty for each. We use New-ItemProperty -Force fallback for
  // values that may not exist yet — Set-ItemProperty refuses to create them.
  const script = [
    `if (-not (Test-Path '${REG_PATH}')) { New-Item -Path '${REG_PATH}' -Force | Out-Null };`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'ProxyEnable'   -PropertyType DWord  -Value ${Number(ProxyEnable) ? 1 : 0} -Force | Out-Null;`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'ProxyServer'   -PropertyType String -Value '${escapeSingle(String(ProxyServer || ''))}' -Force | Out-Null;`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'ProxyOverride' -PropertyType String -Value '${escapeSingle(String(ProxyOverride || ''))}' -Force | Out-Null;`,
    `New-ItemProperty -Path '${REG_PATH}' -Name 'AutoConfigURL' -PropertyType String -Value '${escapeSingle(String(AutoConfigURL || ''))}' -Force | Out-Null;`,
  ].join(' ');
  await runPwsh(script);
}

/** Tell WinINet to re-read settings so apps using the same cache pick them up. */
async function notifyWinInet() {
  const script = `
Add-Type -Name CFAIWinInet -Namespace W -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("wininet.dll", SetLastError=true)]
public static extern bool InternetSetOption(System.IntPtr h, int o, System.IntPtr b, int l);
"@ -ErrorAction SilentlyContinue;
$null = [W.CFAIWinInet]::InternetSetOption([System.IntPtr]::Zero, 39, [System.IntPtr]::Zero, 0);  # INTERNET_OPTION_SETTINGS_CHANGED
$null = [W.CFAIWinInet]::InternetSetOption([System.IntPtr]::Zero, 37, [System.IntPtr]::Zero, 0);  # INTERNET_OPTION_REFRESH
'ok'
`;
  try { await runPwsh(script); } catch { /* notification is best-effort */ }
}

function escapeSingle(s) {
  // PowerShell single-quoted strings escape ' by doubling it.
  return s.replace(/'/g, "''");
}

function runPwsh(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`powershell exit ${code}: ${stderr || stdout}`));
    });
  });
}

// ---- Listen probe ----

function ensureListening(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, host);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`proxy not listening on ${host}:${port} after ${timeoutMs}ms`));
    }, timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve();
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`proxy listen probe failed: ${err.code || err.message}`));
    });
  });
}

// ---- Exit hooks ----

function installExitHooks() {
  if (_exitHooksInstalled) return;
  _exitHooksInstalled = true;
  // Synchronous-ish wrapper — Node lets async handlers run on SIGINT/SIGTERM
  // because the default action (terminate) is deferred while the handler runs.
  const handle = async (signal) => {
    if (_restoreOnExit) {
      try { await _restoreOnExit(signal); } catch {}
    }
    process.exit(signal === 'uncaughtException' ? 1 : 0);
  };
  process.once('SIGINT',  () => handle('SIGINT'));
  process.once('SIGTERM', () => handle('SIGTERM'));
  process.once('SIGHUP',  () => handle('SIGHUP'));
  process.on('uncaughtException', (err) => {
    process.stderr.write(`\n[cfai-proxy] uncaught: ${err?.stack || err}\n`);
    handle('uncaughtException');
  });
}

export { STATE_PATH };
