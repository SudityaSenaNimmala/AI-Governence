// CloudFuze AI Governance — Electron main process
// System tray app that wraps the existing OsMonitor for background DLP monitoring.

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

// ── Paths ──────────────────────────────────────────────────────────────────────
// In production (packaged), agent source lives in extraResources/agent-src.
// In dev, it's at ../src relative to electron/.
const isDev = !app.isPackaged;
const AGENT_SRC = isDev
  ? path.join(__dirname, '..', 'src')
  : path.join(process.resourcesPath, 'agent-src');
const BROWSER_EXT_DIR = isDev
  ? path.join(__dirname, '..', '..', 'browser-extension')
  : path.join(process.resourcesPath, 'browser-extension');
const CRED_DIR = path.join(os.homedir(), '.cloudfuze-aigov');
const CRED_PATH = path.join(CRED_DIR, 'credentials.json');
const SETTINGS_PATH = path.join(CRED_DIR, 'electron-settings.json');

// ── Icons ──────────────────────────────────────────────────────────────────────
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

function getTrayIcon() {
  const img = nativeImage.createFromPath(ICON_PATH);
  // Tray icons should be 16x16 on Windows (DPI-scaled automatically).
  return img.resize({ width: 16, height: 16 });
}

function getWindowIcon() {
  return nativeImage.createFromPath(ICON_PATH);
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.name === 'node_modules') continue; // skip node_modules
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── State ──────────────────────────────────────────────────────────────────────
let tray = null;
let mainWindow = null;
let monitorProcess = null;  // child_process running the OsMonitor
let isMonitoring = false;
let recentAlerts = [];      // last 100 DLP events for the dashboard
const MAX_ALERTS = 100;

// ── Settings ───────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:8787',
  enrollSecret: '',
  autoStart: true,
  monitorClipboard: true,
  monitorFileDialogs: true,
  monitorTypedPrompts: true,
  monitorAttachments: true,
  monitorEnforcer: true,
  startMonitorOnLaunch: true,
};

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(CRED_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
}

function loadCredentials() {
  try {
    const raw = fs.readFileSync(CRED_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Monitor bridge ─────────────────────────────────────────────────────────────
// We spawn the agent CLI with --monitor as a child process so it runs with full
// ESM module support. The Electron main process is CommonJS, and the agent src
// is ESM — spawning as a subprocess avoids require/import incompatibility.

function startMonitor() {
  if (monitorProcess) return;

  const creds = loadCredentials();
  const settings = loadSettings();
  if (!creds?.token || !creds?.serverUrl) {
    sendToRenderer('monitor-error', 'Not enrolled. Configure server URL and enrollment secret in Settings, then enroll.');
    return;
  }

  // Use the lightweight monitor runner that starts the OsMonitor directly,
  // bypassing the full machine scan. The agent CLI's --monitor requires a
  // scan + server upload to succeed first, so it fails when the server is down.
  const monitorRunner = path.join(__dirname, 'monitor-runner.mjs');
  if (!fs.existsSync(monitorRunner)) {
    sendToRenderer('monitor-error', `Monitor runner not found at ${monitorRunner}`);
    return;
  }

  monitorProcess = spawn('node', [monitorRunner], {
    cwd: path.join(__dirname, '..'),  // agent/ dir so relative imports work
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  isMonitoring = true;
  sendToRenderer('monitor-status', { running: true });
  updateTrayMenu();

  monitorProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      parseMonitorLine(line);
    }
  });

  monitorProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      parseMonitorLine(line);
    }
  });

  monitorProcess.on('exit', (code) => {
    monitorProcess = null;
    isMonitoring = false;
    sendToRenderer('monitor-status', { running: false, exitCode: code });
    updateTrayMenu();
  });

  monitorProcess.on('error', (err) => {
    monitorProcess = null;
    isMonitoring = false;
    sendToRenderer('monitor-error', err.message);
    updateTrayMenu();
  });
}

function stopMonitor() {
  if (!monitorProcess) return;
  monitorProcess.kill('SIGTERM');
  // Force kill after 3s if it hasn't exited
  const killTimer = setTimeout(() => {
    if (monitorProcess) {
      monitorProcess.kill('SIGKILL');
    }
  }, 3000);
  monitorProcess.on('exit', () => clearTimeout(killTimer));
}

function parseMonitorLine(line) {
  // Parse structured log lines from the agent's stderr.
  // Format: 2026-06-22T10:00:00.000Z INFO  [os_monitor] ...
  const alert = {
    timestamp: new Date().toISOString(),
    raw: line,
    type: 'info',
    message: line,
  };

  if (line.includes('pattern(s), severity=')) {
    alert.type = 'dlp_event';
    const sevMatch = line.match(/severity=(\w+)/);
    if (sevMatch) alert.severity = sevMatch[1];
    const patMatch = line.match(/\[([^\]]+)\]\s*$/);
    if (patMatch) alert.patterns = patMatch[1];
    const prodMatch = line.match(/(?:paste into|focus into|typed into)\s+(.+?)\s+—/);
    if (prodMatch) alert.product = prodMatch[1];
  } else if (line.includes('BLOCKED')) {
    alert.type = 'enforcement';
    alert.severity = 'high';
  } else if (line.includes('file') && (line.includes('severity=') || line.includes('file_class'))) {
    alert.type = 'file_event';
    const sevMatch = line.match(/severity=(\w+)/);
    if (sevMatch) alert.severity = sevMatch[1];
  }

  recentAlerts.unshift(alert);
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.length = MAX_ALERTS;
  sendToRenderer('alert', alert);
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── Auto-launch (Windows registry) ────────────────────────────────────────────
const AUTO_LAUNCH_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTO_LAUNCH_NAME = 'CloudFuzeAIGovernance';

function getAutoLaunchEnabled() {
  if (process.platform !== 'win32') return false;
  try {
    const result = execSync(
      `reg query "${AUTO_LAUNCH_KEY}" /v "${AUTO_LAUNCH_NAME}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.includes(AUTO_LAUNCH_NAME);
  } catch {
    return false;
  }
}

function setAutoLaunch(enable) {
  if (process.platform !== 'win32') return;
  const exePath = app.isPackaged ? app.getPath('exe') : process.execPath;
  try {
    if (enable) {
      execSync(
        `reg add "${AUTO_LAUNCH_KEY}" /v "${AUTO_LAUNCH_NAME}" /t REG_SZ /d "\\"${exePath}\\" --hidden" /f`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } else {
      execSync(
        `reg delete "${AUTO_LAUNCH_KEY}" /v "${AUTO_LAUNCH_NAME}" /f`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
    }
  } catch {
    // Silently fail — non-admin may not have reg write access
  }
}

// ── ASAR injection ─────────────────────────────────────────────────────────────
function runAsarInjection() {
  const creds = loadCredentials();
  if (!creds?.token) {
    sendToRenderer('inject-result', { success: false, error: 'Not enrolled. Enroll first in Settings.' });
    return;
  }

  const agentEntry = path.join(AGENT_SRC, 'index.js');
  const args = [
    agentEntry,
    '--inject-desktop',
    '--server', creds.serverUrl,
    '--dry-run',  // scan but skip report upload
  ];

  // ASAR injection needs admin on Windows (Store apps). Launch elevated.
  if (process.platform === 'win32') {
    // Use PowerShell Start-Process -Verb RunAs for UAC elevation
    const nodeExe = 'node';
    const argStr = args.map(a => `'${a}'`).join(',');
    const psCmd = `Start-Process -FilePath '${nodeExe}' -ArgumentList ${argStr} -Verb RunAs -Wait -PassThru`;

    const child = spawn('powershell', ['-Command', psCmd], {
      cwd: AGENT_SRC,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('exit', (code) => {
      sendToRenderer('inject-result', {
        success: code === 0,
        output: output.trim(),
        error: code !== 0 ? `Process exited with code ${code}` : null,
      });
    });
    child.on('error', (err) => {
      sendToRenderer('inject-result', { success: false, error: err.message });
    });
  } else {
    // Non-Windows: run directly
    const child = spawn('node', args, {
      cwd: AGENT_SRC,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('exit', (code) => {
      sendToRenderer('inject-result', {
        success: code === 0,
        output: output.trim(),
        error: code !== 0 ? `Process exited with code ${code}` : null,
      });
    });
  }
}

// ── Enrollment ─────────────────────────────────────────────────────────────────
async function enrollWithServer(serverUrl, enrollSecret) {
  try {
    const machineId = getMachineId();
    const hostname = os.hostname();
    const url = serverUrl.replace(/\/$/, '');

    const res = await fetch(`${url}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId, hostname, enrollSecret }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Server returned ${res.status}: ${text}` };
    }

    const body = await res.json();
    const creds = {
      serverUrl: url,
      machineId: body.machineId,
      token: body.token,
      enrolledAt: new Date().toISOString(),
    };

    fs.mkdirSync(CRED_DIR, { recursive: true });
    fs.writeFileSync(CRED_PATH, JSON.stringify(creds, null, 2), 'utf8');
    return { success: true, machineId: creds.machineId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getMachineId() {
  // Reuse the same logic as the agent — read from cached file or generate.
  const idPath = path.join(CRED_DIR, 'machine-id');
  try {
    return fs.readFileSync(idPath, 'utf8').trim();
  } catch {
    const crypto = require('crypto');
    const id = crypto.randomUUID();
    fs.mkdirSync(CRED_DIR, { recursive: true });
    fs.writeFileSync(idPath, id, 'utf8');
    return id;
  }
}

// ── Window ─────────────────────────────────────────────────────────────────────
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    title: 'CloudFuze AI Governance',
    icon: getWindowIcon(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Tray ───────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = getTrayIcon();

  tray = new Tray(icon);
  tray.setToolTip('CloudFuze AI Governance');
  updateTrayMenu();

  tray.on('double-click', () => {
    createMainWindow();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => createMainWindow(),
    },
    { type: 'separator' },
    {
      label: isMonitoring ? 'Stop Monitoring' : 'Start Monitoring',
      click: () => {
        if (isMonitoring) {
          stopMonitor();
        } else {
          startMonitor();
        }
      },
    },
    {
      label: `Status: ${isMonitoring ? 'Running' : 'Stopped'}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Governance Dashboard',
      click: () => shell.openExternal('http://localhost:8080'),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        stopMonitor();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-status', () => ({
    monitoring: isMonitoring,
    enrolled: !!loadCredentials()?.token,
    serverUrl: loadCredentials()?.serverUrl || null,
    machineId: loadCredentials()?.machineId || null,
    enrolledAt: loadCredentials()?.enrolledAt || null,
    platform: process.platform,
    agentSrcPath: AGENT_SRC,
    alertCount: recentAlerts.length,
  }));

  ipcMain.handle('get-alerts', () => recentAlerts);

  ipcMain.handle('get-settings', () => loadSettings());

  ipcMain.handle('save-settings', (_event, settings) => {
    saveSettings(settings);
    // Apply auto-launch change immediately
    setAutoLaunch(settings.autoStart);
    return { success: true };
  });

  ipcMain.handle('start-monitor', () => {
    startMonitor();
    return { success: true };
  });

  ipcMain.handle('stop-monitor', () => {
    stopMonitor();
    return { success: true };
  });

  ipcMain.handle('enroll', async (_event, { serverUrl, enrollSecret }) => {
    return enrollWithServer(serverUrl, enrollSecret);
  });

  ipcMain.handle('run-injection', () => {
    runAsarInjection();
    return { started: true };
  });

  ipcMain.handle('get-auto-launch', () => getAutoLaunchEnabled());

  ipcMain.handle('set-auto-launch', (_event, enable) => {
    setAutoLaunch(enable);
    return { success: true };
  });

  ipcMain.handle('download-extension', async () => {
    if (!fs.existsSync(BROWSER_EXT_DIR)) {
      return { success: false, error: 'Browser extension source not found.' };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where to save the extension',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { success: false, error: 'Cancelled.' };
    }
    const dest = path.join(result.filePaths[0], 'CloudFuze-Extension');
    try {
      copyDirSync(BROWSER_EXT_DIR, dest);
      shell.openPath(dest);
      return { success: true, path: dest };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-external', (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('open-dashboard', () => {
    shell.openExternal('http://localhost:8080');
  });

  ipcMain.handle('run-scan', () => {
    const creds = loadCredentials();
    if (!creds?.token) {
      sendToRenderer('scan-result', { success: false, error: 'Not enrolled' });
      return;
    }
    const agentEntry = path.join(AGENT_SRC, 'index.js');
    const child = spawn('node', [agentEntry, '--server', creds.serverUrl], {
      cwd: AGENT_SRC,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('exit', (code) => {
      sendToRenderer('scan-result', { success: code === 0, output: output.trim() });
    });
  });
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    createMainWindow();
  });

  app.whenReady().then(() => {
    setupIPC();
    createTray();

    const startHidden = process.argv.includes('--hidden');
    if (!startHidden) {
      createMainWindow();
    }

    // Auto-start monitoring if configured
    const settings = loadSettings();
    if (settings.startMonitorOnLaunch) {
      const creds = loadCredentials();
      if (creds?.token) {
        startMonitor();
      }
    }
  });

  app.on('window-all-closed', (e) => {
    // Don't quit — stay in tray
    e.preventDefault?.();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    stopMonitor();
  });

  app.on('activate', () => {
    createMainWindow();
  });
}
