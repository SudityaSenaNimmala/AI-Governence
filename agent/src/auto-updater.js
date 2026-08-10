// Auto-updater — silently checks for agent updates and applies them.
//
// Every hour, fetches /api/v1/installations/agent-version from the server.
// If the version hash differs from the running version, downloads the new
// agent zip, extracts it, and restarts the process. The employee never
// sees anything — it's fully automatic.
//
// The update is atomic:
//   1. Download new zip to a temp file
//   2. Extract to a staging folder alongside the current install
//   3. Kill the old monitor (via lock file PID)
//   4. Launch the new install script (which starts the new monitor)
//   5. This process exits
//
// If anything fails (network, disk, bad zip), the current agent keeps running.

import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const VERSION_FILE = join(homedir(), '.cloudfuze-aigov', 'agent-version');

export function startAutoUpdater({ serverUrl, token, log }) {
  if (!serverUrl) {
    log?.info?.('auto-updater: no server URL — disabled');
    return null;
  }

  const currentVersion = readCurrentVersion();
  log?.info?.(`auto-updater: current version ${currentVersion || 'unknown'}, checking every hour`);

  // Check immediately, then every hour
  const check = () => checkForUpdate({ serverUrl, token, log }).catch(e => {
    log?.warn?.(`auto-updater: check failed: ${e?.message || e}`);
  });

  setTimeout(check, 30000); // first check 30s after start (let agent settle)
  const timer = setInterval(check, CHECK_INTERVAL_MS);

  return { stop: () => clearInterval(timer) };
}

function readCurrentVersion() {
  try { return readFileSync(VERSION_FILE, 'utf8').trim(); } catch { return null; }
}

function saveCurrentVersion(version) {
  try {
    mkdirSync(dirname(VERSION_FILE), { recursive: true });
    writeFileSync(VERSION_FILE, version, 'utf8');
  } catch {}
}

async function checkForUpdate({ serverUrl, token, log }) {
  const url = `${serverUrl.replace(/\/$/, '')}/api/v1/installations/agent-version`;
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return;

  const { version: serverVersion } = await res.json();
  if (!serverVersion) return;

  const currentVersion = readCurrentVersion();

  if (currentVersion === serverVersion) {
    log?.info?.(`auto-updater: up to date (${serverVersion})`);
    return;
  }

  log?.info?.(`auto-updater: update available! ${currentVersion || 'none'} → ${serverVersion}`);
  await applyUpdate({ serverUrl, token, serverVersion, log });
}

async function applyUpdate({ serverUrl, token, serverVersion, log }) {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const downloadUrl = `${serverUrl.replace(/\/$/, '')}/api/v1/installations/agent-installer?platform=${platform}`;

  // Download to temp file
  const tempDir = join(homedir(), '.cloudfuze-aigov', 'update-staging');
  mkdirSync(tempDir, { recursive: true });
  const zipPath = join(tempDir, 'agent-update.zip');

  log?.info?.('auto-updater: downloading update...');
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(downloadUrl, { headers, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  // Write zip to disk
  const body = await res.arrayBuffer();
  writeFileSync(zipPath, Buffer.from(body));
  log?.info?.(`auto-updater: downloaded ${(body.byteLength / 1024 / 1024).toFixed(1)} MB`);

  // Extract zip using OS tools
  const extractDir = join(tempDir, 'extracted');
  if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  if (process.platform === 'win32') {
    // Use PowerShell to extract on Windows
    const ps = spawn('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
    ], { stdio: 'pipe' });
    await new Promise((resolve, reject) => {
      ps.on('exit', code => code === 0 ? resolve() : reject(new Error(`Extract failed: exit ${code}`)));
      ps.on('error', reject);
    });
  } else {
    // Use unzip on Mac/Linux
    const uz = spawn('unzip', ['-o', zipPath, '-d', extractDir], { stdio: 'pipe' });
    await new Promise((resolve, reject) => {
      uz.on('exit', code => code === 0 ? resolve() : reject(new Error(`Extract failed: exit ${code}`)));
      uz.on('error', reject);
    });
  }

  log?.info?.('auto-updater: extracted, applying update...');

  // Save new version BEFORE restarting
  saveCurrentVersion(serverVersion);

  // Run the install script from the extracted update
  // This will: kill old agent → npm install → start new agent
  const scriptName = process.platform === 'win32' ? 'install.bat' : 'install.sh';
  const scriptPath = join(extractDir, scriptName);

  if (!existsSync(scriptPath)) {
    log?.warn?.('auto-updater: install script not found in update package');
    return;
  }

  log?.info?.('auto-updater: launching install script — this process will exit');

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', scriptPath], {
      cwd: extractDir,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn('bash', [scriptPath], {
      cwd: extractDir,
      detached: true,
      stdio: 'ignore',
    }).unref();
  }

  // Give the new process time to start before we exit
  setTimeout(() => process.exit(0), 3000);
}
