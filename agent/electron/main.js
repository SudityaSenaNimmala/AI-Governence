// CloudFuze AI Governance — Electron main process
// System tray app that wraps the existing OsMonitor for background DLP monitoring.

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog, screen } = require('electron');
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
// Single-slot offline queue for a Request Access submission. Written here when
// the POST cannot reach the server; monitor-runner.mjs retries and deletes it on
// its 30s tick. See flushPendingAccessRequest() there.
const PENDING_ACCESS_REQUEST_PATH = path.join(CRED_DIR, 'pending-access-request.json');
// Mirrors REASON_MAX in server/src/routes/access-requests.js. The server caps
// independently — this is the client being well-behaved, not the enforcement.
const REASON_MAX = 500;

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
let dialogWindow = null;  // the non-activating Tokenize & Send popup — see showBlockDialogWindow()
let accessWindow = null;  // the FOCUSABLE Request Access dialog — see showAccessRequestWindow()
let bannerWindow = null;  // the click-through "this app is blocked" bar — see showBlockBanner()
let monitorProcess = null;  // child_process running the OsMonitor
let isMonitoring = false;
let recentAlerts = [];      // last 100 DLP events for the dashboard
const MAX_ALERTS = 100;

// ── Settings ───────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  serverUrl: 'https://cfagentgovernence.cloudfuzehost.com',
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

  // Settings reach the monitor child through the environment — there is no IPC
  // channel to it (its stdio is child → parent log lines only). Mirrors
  // src/os_monitor/settings-env.js, which is the decoding side; that file is
  // ESM and this process is CommonJS, so the encoding is repeated here rather
  // than imported. 'false' is the only value that disables the enforcer.
  // Model routing has no setting at all — it is always on whenever the
  // enforcer itself runs, same as the rest of its keystroke-level behavior.
  monitorProcess = spawn('node', [monitorRunner], {
    cwd: path.join(__dirname, '..'),  // agent/ dir so relative imports work
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      CFAI_ENFORCER_ENABLED: settings.monitorEnforcer === false ? 'false' : 'true',
      CFAI_MODEL_ROUTER_ENABLED: 'true',
    },
    // stdin is 'pipe' (not 'ignore') so the Tokenize dialog can send
    // {cmd:"tokenize", block_id} down through monitor-runner.mjs to the
    // enforcer — see tokenizeBlock() / the 'tokenize-block' IPC handler below.
    stdio: ['pipe', 'pipe', 'pipe'],
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
    // Nothing is enforcing any more, so nothing may still be claiming to. See
    // destroyBlockBanner().
    destroyBlockBanner();
    sendToRenderer('monitor-status', { running: false, exitCode: code });
    updateTrayMenu();
  });

  monitorProcess.on('error', (err) => {
    monitorProcess = null;
    isMonitoring = false;
    destroyBlockBanner();
    sendToRenderer('monitor-error', err.message);
    updateTrayMenu();
  });
}

function stopMonitor() {
  // Before the kill, not after: the bar must be gone the moment the user asks
  // for monitoring to stop, whether or not the child exits cleanly.
  destroyBlockBanner();
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

// ── The standing "this app is blocked" bar ────────────────────────────────────
// Desktop counterpart of the browser extension's showPlatformBanner()
// (browser-extension/content/content.js). The modal that already exists is
// REACTIVE — it appears after a send is refused. This is STATE: while a
// whole-app-blocked window has focus, the bar is up, so the org's decision is
// visible before the first keystroke instead of only after it.
//
// Admin-controlled only. There is deliberately no entry for it in
// DEFAULT_SETTINGS: a user who could switch off the indicator for a block they
// cannot switch off would only be hiding the explanation.
//
// Scope: whole-app blocks ONLY (block_scope 'app'). An IDE-panel block (Claude
// Code / Cursor composer) gets nothing beyond the existing per-attempt modal —
// the enforcer never even emits a bar state for one. Same exclusion as the
// extension's IS_EMBEDDED_AI early-return, and for the same reason: blocking one
// AI panel inside an editor is not blocking the editor.
const BANNER_HEIGHT = 36;              // DIP; workArea-anchored, so DPI-scaled by Electron
// Alt-tabbing THROUGH a blocked app (or a single flapping focus read) must not
// flash a red bar across the display.
const BANNER_SHOW_DEBOUNCE_MS = 200;

let bannerState = null;        // { name, origin:{x,y} } while a block is in force
let bannerVisible = false;
let bannerShowTimer = null;
// Which tool_host the Request Access modal has already explained during the
// current bar session. See the guard in showAccessRequestWindow().
let platformModalShownForHost = null;

// DISPLAY-anchored, not window-docked. The rect on the event is used for one
// thing only: choosing which monitor the bar belongs to. Nothing tracks the
// blocked window afterwards — no polling, no coordinate-space conversion, no
// window-follow. Drag a blocked app to another monitor and the bar stays where
// it was until the next state transition. Accepted and documented, not a bug:
// a follower would have to reconcile Win32 physical pixels with Electron DIPs on
// every tick, which is precisely the fragility this avoids.
function bannerBoundsFor(origin) {
  try {
    const display = origin
      ? screen.getDisplayNearestPoint({ x: Math.round(origin.x), y: Math.round(origin.y) })
      : screen.getPrimaryDisplay();
    if (!display) return null;
    // workArea, NOT bounds — a top-docked taskbar must not be covered by a bar
    // the user cannot move or click through to.
    const wa = display.workArea;
    return { x: wa.x, y: wa.y, width: wa.width, height: BANNER_HEIGHT };
  } catch {
    // The stored origin no longer resolves to a display (monitor unplugged,
    // session change). Better no bar than a bar at coordinates that don't exist.
    return null;
  }
}

function renderBlockBanner() {
  if (!bannerState) return;
  const bounds = bannerBoundsFor(bannerState.origin);
  if (!bounds) { hideBlockBanner(); return; }
  // A transparent, non-resizable window cannot be RESIZED reliably on Windows —
  // resizable:false makes setBounds ignore size changes, and Electron documents
  // setResizable(true) on a transparent window as liable to break it outright.
  // MOVING one is fine. So a display change that alters the WIDTH (a monitor
  // added, removed or rescaled) is handled by recreating the window rather than
  // by resizing it; ordinary re-anchoring on the same display just moves it.
  if (bannerWindow && !bannerWindow.isDestroyed()) {
    const cur = bannerWindow.getBounds();
    if (cur.width !== bounds.width || cur.height !== bounds.height) {
      bannerWindow.destroy();
      bannerWindow = null;
    }
  }
  const send = () => {
    if (bannerWindow && !bannerWindow.isDestroyed() && bannerState) {
      bannerWindow.webContents.send('block-banner', { name: bannerState.name });
    }
  };
  if (!bannerWindow || bannerWindow.isDestroyed()) {
    bannerWindow = new BrowserWindow({
      ...bounds,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // focusable:false + showInactive() is NOT a style choice here — it is the
      // same hard requirement documented on showBlockDialogWindow below. Taking
      // focus off the AI app makes the enforcer's own foreground tracking see
      // the user leave it, which is how the Tokenize popup once ended up
      // permanently stuck on "Masking…". A bar that stole focus would do worse:
      // it would tear down the very block it is announcing.
      focusable: false,
      show: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    });
    bannerWindow.loadFile(path.join(__dirname, 'renderer', 'block-banner.html'));
    bannerWindow.webContents.once('did-finish-load', send);
    bannerWindow.on('closed', () => { bannerWindow = null; bannerVisible = false; });
    // The native equivalent of the extension bar's pointer-events:none. It is a
    // notice, not a control, and must never swallow a click meant for the app
    // underneath — the "the whole Gmail is blocked, I can't click any button"
    // report that exclusion came from.
    bannerWindow.setIgnoreMouseEvents(true);
    // Above full-screen AI apps too, not just ordinary windows.
    bannerWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    // Same size, possibly a different position — a move, which is allowed.
    bannerWindow.setBounds(bounds);
    send();
  }
  bannerWindow.showInactive();
  bannerVisible = true;
}

function showBlockBanner(data) {
  const name = String(data?.name || '').trim() || 'This AI platform';
  bannerState = {
    name,
    origin: { x: Number(data?.win_x) || 0, y: Number(data?.win_y) || 0 },
  };
  if (bannerVisible) { renderBlockBanner(); return; }   // already up — refresh copy/monitor
  if (bannerShowTimer) return;                          // a show is pending; the newest state above wins
  bannerShowTimer = setTimeout(() => {
    bannerShowTimer = null;
    if (bannerState) renderBlockBanner();
  }, BANNER_SHOW_DEBOUNCE_MS);
}

function hideBlockBanner() {
  if (bannerShowTimer) { clearTimeout(bannerShowTimer); bannerShowTimer = null; }
  bannerState = null;
  bannerVisible = false;
  // The bar is what makes the modal a one-shot explanation. With the bar gone
  // (focus left the blocked app) the next block is a new situation and has to
  // explain itself again — see showAccessRequestWindow().
  platformModalShownForHost = null;
  if (bannerWindow && !bannerWindow.isDestroyed()) bannerWindow.hide();
}

// An always-on-top, click-through, un-closeable bar with no process behind it is
// by far the worst failure mode this feature has: nothing would be blocking, and
// the user would have no way to dismiss the claim that something is. So it is
// destroyed unconditionally on EVERY path that ends the monitor — helper exit,
// spawn error, Stop Monitoring, and quit.
function destroyBlockBanner() {
  hideBlockBanner();
  if (bannerWindow && !bannerWindow.isDestroyed()) bannerWindow.destroy();
  bannerWindow = null;
}

// A monitor going away (undock, RDP resize, resolution change) must not leave
// the bar drawn across coordinates that no longer exist.
function repositionBlockBanner() {
  if (bannerVisible && bannerState) renderBlockBanner();
}

// The Tokenize & Send popup. This must NEVER take keyboard focus — confirmed
// live that bringing the MAIN window forward instead (mainWindow.focus())
// stole focus from the AI app, and after the enforcer's 3s "focus left the AI
// app" grace period, it cleared the pending rewrite entirely: the dialog was
// then holding a block_id for an offer that no longer existed, which is
// exactly the permanently-stuck "Masking…" button this replaces.
// focusable:false + showInactive() is what keeps the AI app itself focused
// the whole time the popup is visible.
function showBlockDialogWindow(data) {
  const send = () => { if (dialogWindow && !dialogWindow.isDestroyed()) dialogWindow.webContents.send('block-dialog', data); };
  if (!dialogWindow || dialogWindow.isDestroyed()) {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const w = 440, h = 480;
    dialogWindow = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round((sw - w) / 2),
      y: Math.round((sh - h) / 2),
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      backgroundColor: '#1c1f2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    });
    dialogWindow.loadFile(path.join(__dirname, 'renderer', 'block-dialog.html'));
    dialogWindow.webContents.once('did-finish-load', send);
    dialogWindow.on('closed', () => { dialogWindow = null; });
  } else {
    send();
  }
  dialogWindow.showInactive();
}

// The Request Access dialog, shown when the org has blocked this AI app
// OUTRIGHT (not because of anything in the message).
//
// Unlike showBlockDialogWindow above, this window IS focusable, and must be: the
// user has to type a reason into it. That is safe here for the exact reason the
// other one isn't — there is no pending rewrite to protect. A platform block
// offers no Tokenize & Send (see EmitBlock's platformBlock override in
// enforcer-win.ps1), so no block_id is being held, and nothing expires if focus
// leaves the AI app. Do NOT "unify" the two windows: making the Tokenize popup
// focusable is the bug that left it stuck on "Masking…".
//
// PII: this is an ordinary Electron window and the Electron app is not in
// AI_PROCESSES, so the enforcer's typed-buffer capture (gated on _fgIsAi) and
// the clipboard watcher both ignore it. The reason text is never scanned,
// reported or logged — it travels only in the POST body below.
let accessWindowHost = null;   // which tool the open dialog is about

function showAccessRequestWindow(data) {
  // ONCE per (host, bar session) — suppression, not de-duplication. The
  // raise-only guard further down stops an OPEN dialog being re-rendered, but a
  // dialog the user had already read and CLOSED came straight back on the next
  // swallowed keystroke, and a blocked app emits one of those per Enter and per
  // send-button click. That is what made a governed app feel broken.
  //
  // Deliberately conditional on the bar actually being up for this host: the bar
  // is the standing explanation, so the modal only needs to say it once. With no
  // bar (bar hidden, or a panel-scoped block, which never raises one) the modal
  // is the ONLY signal there is, and the old every-attempt behaviour is kept
  // exactly as it was.
  //
  // Reset when the bar clears (focus left the blocked app) or when tool_host
  // changes — see hideBlockBanner().
  const host = data?.tool_host || null;
  if (bannerVisible
      && platformModalShownForHost === host
      && (!accessWindow || accessWindow.isDestroyed())) {
    return;
  }
  platformModalShownForHost = host;
  const send = () => { if (accessWindow && !accessWindow.isDestroyed()) accessWindow.webContents.send('access-request-dialog', data); };
  // A blocked app keeps emitting blocks — every swallowed Enter and every
  // swallowed send-button click is another @@CFAI-BLOCK line. Re-sending the
  // payload would re-render the dialog and DISCARD whatever reason the user has
  // typed so far, so an already-open dialog for the same tool is just raised.
  if (accessWindow && !accessWindow.isDestroyed() && accessWindowHost === (data?.tool_host || null)) {
    accessWindow.show();
    accessWindow.focus();
    return;
  }
  accessWindowHost = data?.tool_host || null;
  if (!accessWindow || accessWindow.isDestroyed()) {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const w = 460, h = 520;
    accessWindow = new BrowserWindow({
      width: w,
      height: h,
      x: Math.round((sw - w) / 2),
      y: Math.round((sh - h) / 2),
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#1c1f2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    });
    accessWindow.loadFile(path.join(__dirname, 'renderer', 'access-request.html'));
    accessWindow.webContents.once('did-finish-load', send);
    accessWindow.on('closed', () => { accessWindow = null; accessWindowHost = null; });
  } else {
    send();
  }
  accessWindow.show();
  accessWindow.focus();
}

function parseMonitorLine(line) {
  // Standing blocked-platform bar. Checked BEFORE the '@@CFAI-BLOCK ' guard so
  // that guard is left byte-for-byte as it was (a test pins its exact text), and
  // so the two prefixes are visibly distinguished at the top of the function
  // rather than relying on the trailing space in the shorter one.
  //
  // Presentation only: no reporting, no logging, no recentAlerts row. A blocked
  // window gaining focus is not an event, and index.js does not report it either.
  if (line.startsWith('@@CFAI-BLOCKSTATE ')) {
    try {
      const parsed = JSON.parse(line.slice('@@CFAI-BLOCKSTATE '.length));
      // scope is asserted rather than assumed. The enforcer only ever raises the
      // bar for a whole-app block, but if a panel-scoped state ever reaches here
      // it must be ignored, not rendered — an editor-wide red bar for one
      // blocked panel is the exact false claim this feature must not make.
      if (parsed.active && parsed.scope === 'app') showBlockBanner(parsed);
      else hideBlockBanner();
    }
    catch { /* malformed — drop; the line pump must never crash */ }
    return;
  }
  // Structured lines (block dialog / rewrite result) are a distinct, always-
  // JSON channel — checked first so they never fall into the plain-text
  // regex heuristics below, which cannot parse them reliably.
  if (line.startsWith('@@CFAI-BLOCK ')) {
    try {
      const parsed = JSON.parse(line.slice('@@CFAI-BLOCK '.length));
      // Only show the center dialog when it has something ACTIONABLE to
      // offer — the "Tokenize & Send" button, which requires rewritable:true.
      // A non-rewritable block's dialog is just "Got it" restating what the
      // toast (fired independently by index.js for the same event) already
      // said, and confirmed live twice now — once for an attachment block,
      // once for an ordinary non-maskable guardrail/prompt-injection block —
      // that showing both reads as a redundant double pop-up, not two
      // pieces of information. rewritable is always false for an attachment
      // block already (Tokenize & Send masks text, not files — see
      // EmitBlock's own override), so this single condition covers that
      // case too without needing a reason-specific check.
      //
      // A FULL PLATFORM BLOCK is the one non-rewritable case that DOES have
      // something actionable, and it is not Tokenize & Send: the whole app is
      // disallowed, so the only move is to ask for a temporary exception. It
      // gets its own focusable dialog. (Before this, such a block showed a
      // toast and nothing else — there was no way to act on it at all.)
      if (parsed.platform_block) { showAccessRequestWindow(parsed); return; }
      if (parsed.rewritable) showBlockDialogWindow(parsed);
    }
    catch { /* malformed — drop, nothing else can be done with it */ }
    return;
  }
  if (line.startsWith('@@CFAI-REWRITE ')) {
    try {
      const parsed = JSON.parse(line.slice('@@CFAI-REWRITE '.length));
      if (dialogWindow && !dialogWindow.isDestroyed()) dialogWindow.webContents.send('rewrite-result', parsed);
      if (parsed.result === 'ok' && dialogWindow && !dialogWindow.isDestroyed()) dialogWindow.close();
    }
    catch { /* malformed — drop */ }
    return;
  }
  if (line.startsWith('@@CFAI-ROUTE ')) {
    // Model routing is silent by design — no dialog, nothing for the user to
    // act on. index.js already reports it to the server; this channel exists
    // so the line is never mis-parsed by the plain-text heuristics below.
    return;
  }

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
      click: () => {
        const creds = loadCredentials();
        const base = creds?.serverUrl || 'https://cfagentgovernence.cloudfuzehost.com';
        shell.openExternal(`${base}/CloudFuze`);
      },
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

  // Tokenize & Send button in the block dialog. Only a block_id ever crosses
  // this path — see enforcer.js's tokenize() for why that's the whole point.
  ipcMain.handle('tokenize-block', (_event, blockId) => {
    if (!monitorProcess?.stdin || monitorProcess.stdin.destroyed) return { sent: false };
    try {
      monitorProcess.stdin.write(JSON.stringify({ cmd: 'tokenize', block_id: blockId }) + '\n');
      return { sent: true };
    } catch (err) {
      return { sent: false, error: err.message };
    }
  });

  // ── Request Access (desktop platform block) ────────────────────────────────
  // Submits to the SAME /api/v1/access-requests the browser extension uses, so
  // one admin queue and one approval cover both surfaces. The difference is the
  // bearer token: this device is enrolled, so the server derives machine_id and
  // hostname from the verified claims and ignores whatever the body says.
  //
  // Only the block's identity and the reason the user typed are sent. No prompt
  // text, no clipboard, no window title.
  ipcMain.handle('access-request', async (_event, payload) => {
    const creds = loadCredentials();
    if (!creds?.token || !creds?.serverUrl) {
      return { ok: false, code: 'not_enrolled', error: 'This device is not enrolled. Open CloudFuze AI Governance → Settings and enroll.' };
    }
    const p = payload || {};
    if (!p.tool_host) {
      return { ok: false, code: 'no_tool_host', error: 'Could not identify which AI app to request access for.' };
    }

    const body = {
      machine_id: creds.machineId || null,   // ignored by the server when the token verifies; kept for the offline queue
      tool_host: String(p.tool_host),
      tool_name: p.tool_name ? String(p.tool_name) : undefined,
      tool_vendor: p.tool_vendor ? String(p.tool_vendor) : undefined,
      reason: String(p.reason || '').slice(0, REASON_MAX),
      surface: 'desktop',
      platform: p.platform ? String(p.platform) : undefined,
      process_name: p.process_name ? String(p.process_name) : undefined,
      agent_id: p.agent_id ? String(p.agent_id) : undefined,
    };

    try {
      const res = await fetch(`${creds.serverUrl.replace(/\/$/, '')}/api/v1/access-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const out = await res.json().catch(() => ({}));
        return { ok: true, id: out.id || null };
      }
      const err = await res.json().catch(() => ({}));
      // 401 is NOT a network problem and must not be reported as one — the
      // machine token is expired or was minted against a different JWT_SECRET,
      // and the fix is re-enrolling this device, not retrying later.
      if (res.status === 401) {
        return { ok: false, code: 'reenroll', error: 'This device needs to re-enroll before it can request access. Open CloudFuze AI Governance → Settings and enroll again.' };
      }
      return { ok: false, code: err.code || `http_${res.status}`, error: err.error || `Server returned ${res.status}.` };
    } catch (netErr) {
      // Offline: park it in the single slot and let monitor-runner.mjs submit it
      // on its next successful tick. A second Submit while still offline
      // overwrites this file rather than adding to it.
      try {
        fs.mkdirSync(CRED_DIR, { recursive: true });
        fs.writeFileSync(
          PENDING_ACCESS_REQUEST_PATH,
          JSON.stringify({ ...body, queued_at: new Date().toISOString() }, null, 2),
          'utf8',
        );
        return { ok: true, queued: true };
      } catch (writeErr) {
        return { ok: false, code: 'offline', error: `Could not reach the server (${netErr.message}) and could not save the request (${writeErr.message}).` };
      }
    }
  });

  // What this device has already asked for, so the dialog can render an
  // "already pending" state instead of submitting into a 409.
  ipcMain.handle('access-request-status', async (_event, toolHost) => {
    const creds = loadCredentials();
    if (!creds?.token || !creds?.serverUrl) return { ok: false, code: 'not_enrolled' };
    try {
      const res = await fetch(`${creds.serverUrl.replace(/\/$/, '')}/api/v1/access-requests/mine`, {
        headers: { authorization: `Bearer ${creds.token}` },
      });
      if (res.status === 401) return { ok: false, code: 'reenroll' };
      if (!res.ok) return { ok: false, code: `http_${res.status}` };
      const rows = await res.json();
      const host = String(toolHost || '').toLowerCase();
      const mine = Array.isArray(rows) ? rows.filter((r) => String(r.tool_host || '').toLowerCase() === host) : [];
      return {
        ok: true,
        pending: mine.find((r) => r.status === 'pending') || null,
        latest: mine[0] || null,
        // A locally queued submission has not reached the server yet, so it
        // cannot come back on /mine — surface it so the dialog does not invite
        // the user to submit the same thing twice.
        queued: fs.existsSync(PENDING_ACCESS_REQUEST_PATH),
      };
    } catch (err) {
      return { ok: false, code: 'offline', error: err.message, queued: fs.existsSync(PENDING_ACCESS_REQUEST_PATH) };
    }
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
    const creds = loadCredentials();
    const base = creds?.serverUrl || 'https://cfagentgovernence.cloudfuzehost.com';
    shell.openExternal(`${base}/CloudFuze`);
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

    // The bar is anchored to a display, and displays come and go (undock, RDP
    // resize, resolution change). Recompute against the stored origin point;
    // bannerBoundsFor() hides the bar rather than guess if it no longer
    // resolves. Registered here because the screen module needs the app ready.
    screen.on('display-removed', repositionBlockBanner);
    screen.on('display-added', repositionBlockBanner);
    screen.on('display-metrics-changed', repositionBlockBanner);

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
    // stopMonitor() already does this; repeated deliberately, because an
    // orphaned always-on-top click-through bar surviving the app is the one
    // outcome here that the user cannot recover from without Task Manager.
    destroyBlockBanner();
  });

  app.on('activate', () => {
    createMainWindow();
  });
}
