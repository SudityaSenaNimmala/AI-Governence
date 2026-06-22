// CloudFuze AI Governance — Renderer script
// Drives the tabbed dashboard UI via the preload-exposed window.api bridge.

// ── Tab navigation ─────────────────────────────────────────────────────────────
const navItems = document.querySelectorAll('.nav-item');
const tabs = document.querySelectorAll('.tab-content');

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const tabId = item.dataset.tab;
    navItems.forEach((n) => n.classList.remove('active'));
    tabs.forEach((t) => t.classList.remove('active'));
    item.classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

// ── DOM references ─────────────────────────────────────────────────────────────
const $monitorBtn = document.getElementById('btn-toggle-monitor');
const $scanBtn = document.getElementById('btn-run-scan');
const $dashboardBtn = document.getElementById('btn-open-dashboard');
const $cardMonitor = document.getElementById('card-monitor-status');
const $cardEnroll = document.getElementById('card-enrollment');
const $cardServer = document.getElementById('card-server');
const $cardEvents = document.getElementById('card-events');
const $alertsContainer = document.getElementById('alerts-container');
const $statusBadge = document.getElementById('status-badge');
const $statusText = document.getElementById('status-text');

// Settings
const $serverUrl = document.getElementById('input-server-url');
const $enrollSecret = document.getElementById('input-enroll-secret');
const $enrollBtn = document.getElementById('btn-enroll');
const $enrollStatus = document.getElementById('enroll-status');
const $saveBtn = document.getElementById('btn-save-settings');
const $saveStatus = document.getElementById('save-status');

// Toggles
const toggleMap = {
  'toggle-startOnLaunch': 'startMonitorOnLaunch',
  'toggle-clipboard': 'monitorClipboard',
  'toggle-fileDialogs': 'monitorFileDialogs',
  'toggle-typedPrompts': 'monitorTypedPrompts',
  'toggle-attachments': 'monitorAttachments',
  'toggle-enforcer': 'monitorEnforcer',
  'toggle-autoStart': 'autoStart',
};

// Extension
const $downloadExtBtn = document.getElementById('btn-download-ext');
const $downloadExtStatus = document.getElementById('download-ext-status');

// Injection
const $injectBtn = document.getElementById('btn-inject');
const $injectOutput = document.getElementById('inject-output');
const $injectOutputText = document.getElementById('inject-output-text');

// ── State ──────────────────────────────────────────────────────────────────────
let isMonitoring = false;
let alertCount = 0;

// ── Initialize ─────────────────────────────────────────────────────────────────
async function init() {
  await refreshStatus();
  await loadSettings();
  await loadAlerts();
  setupListeners();
  setupIPCListeners();
}

async function refreshStatus() {
  const status = await window.api.getStatus();
  isMonitoring = status.monitoring;
  updateMonitorUI(status.monitoring);

  if (status.enrolled) {
    $cardEnroll.textContent = 'Enrolled';
    $cardEnroll.style.color = 'var(--success)';
    $cardServer.textContent = status.serverUrl || '--';
    $cardServer.classList.remove('text-muted');
  } else {
    $cardEnroll.textContent = 'Not enrolled';
    $cardEnroll.style.color = 'var(--warning)';
    $cardServer.textContent = '--';
    $cardServer.classList.add('text-muted');
  }

  $cardEvents.textContent = String(status.alertCount || 0);
  alertCount = status.alertCount || 0;
}

function updateMonitorUI(running) {
  isMonitoring = running;

  $cardMonitor.textContent = running ? 'Running' : 'Stopped';
  $cardMonitor.className = `card-value ${running ? 'status-running' : 'status-stopped'}`;

  $monitorBtn.textContent = running ? 'Stop Monitoring' : 'Start Monitoring';
  $monitorBtn.className = `btn ${running ? 'btn-danger' : 'btn-primary'}`;

  $statusBadge.className = `status-badge ${running ? 'running' : 'stopped'}`;
  $statusText.textContent = running ? 'Monitoring' : 'Stopped';

  // Update monitor grid badges. The --monitor flag starts ALL sub-monitors,
  // so when running they are all active regardless of toggle state.
  const monitorKeys = ['clipboard', 'fileDialogs', 'typedPrompts', 'attachments', 'enforcer'];
  for (const key of monitorKeys) {
    const el = document.getElementById(`mon-${key}`);
    if (!el) continue;
    if (running) {
      el.textContent = 'Active';
      el.className = 'monitor-status active';
    } else {
      el.textContent = 'Ready';
      el.className = 'monitor-status inactive';
    }
  }
}

function getCurrentToggles() {
  const result = {};
  for (const [toggleId, key] of Object.entries(toggleMap)) {
    const el = document.getElementById(toggleId);
    result[key] = el ? el.checked : true;
  }
  return result;
}

async function loadSettings() {
  const settings = await window.api.getSettings();
  $serverUrl.value = settings.serverUrl || '';

  for (const [toggleId, key] of Object.entries(toggleMap)) {
    const el = document.getElementById(toggleId);
    if (el && settings[key] !== undefined) {
      el.checked = settings[key];
    }
  }
}

async function loadAlerts() {
  const alerts = await window.api.getAlerts();
  renderAlerts(alerts);
}

function renderAlerts(alerts) {
  if (!alerts || alerts.length === 0) {
    $alertsContainer.innerHTML = '<div class="empty-state">No alerts yet. Start monitoring to see DLP events.</div>';
    return;
  }

  $alertsContainer.innerHTML = alerts.map((a) => {
    const time = new Date(a.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const severity = a.severity || (a.type === 'enforcement' ? 'high' : 'info');
    const badgeClass = severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'info';

    let message = a.message || a.raw || '';
    // Trim long lines
    if (message.length > 200) message = message.slice(0, 200) + '...';

    // Extract meaningful info from the raw log line
    if (a.product) {
      message = `${a.product}${a.patterns ? ': ' + a.patterns : ''}`;
    } else if (a.type === 'enforcement') {
      message = 'Send blocked — sensitive content detected';
    }

    const typeLabel = a.type === 'dlp_event' ? 'DLP' : a.type === 'enforcement' ? 'BLOCK' : a.type === 'file_event' ? 'FILE' : 'INFO';

    return `<div class="alert-row">
      <span class="alert-time">${time}</span>
      <span class="alert-badge ${badgeClass}">${typeLabel}</span>
      <span class="alert-message">${escapeHtml(message)}</span>
    </div>`;
  }).join('');
}

function addAlert(alert) {
  alertCount++;
  $cardEvents.textContent = String(alertCount);

  // If the container only has the empty state, clear it
  if ($alertsContainer.querySelector('.empty-state')) {
    $alertsContainer.innerHTML = '';
  }

  const time = new Date(alert.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const severity = alert.severity || (alert.type === 'enforcement' ? 'high' : 'info');
  const badgeClass = severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'info';

  let message = alert.message || alert.raw || '';
  if (message.length > 200) message = message.slice(0, 200) + '...';
  if (alert.product) {
    message = `${alert.product}${alert.patterns ? ': ' + alert.patterns : ''}`;
  } else if (alert.type === 'enforcement') {
    message = 'Send blocked — sensitive content detected';
  }

  const typeLabel = alert.type === 'dlp_event' ? 'DLP' : alert.type === 'enforcement' ? 'BLOCK' : alert.type === 'file_event' ? 'FILE' : 'INFO';

  const row = document.createElement('div');
  row.className = 'alert-row';
  row.innerHTML = `
    <span class="alert-time">${time}</span>
    <span class="alert-badge ${badgeClass}">${typeLabel}</span>
    <span class="alert-message">${escapeHtml(message)}</span>
  `;
  $alertsContainer.prepend(row);

  // Cap at 100 visible rows
  while ($alertsContainer.children.length > 100) {
    $alertsContainer.removeChild($alertsContainer.lastChild);
  }
}

// ── Event listeners ────────────────────────────────────────────────────────────
function setupListeners() {
  // Monitor start/stop
  $monitorBtn.addEventListener('click', async () => {
    $monitorBtn.disabled = true;
    if (isMonitoring) {
      await window.api.stopMonitor();
    } else {
      await window.api.startMonitor();
    }
    setTimeout(() => { $monitorBtn.disabled = false; }, 1000);
  });

  // Run scan
  $scanBtn.addEventListener('click', async () => {
    $scanBtn.disabled = true;
    $scanBtn.textContent = 'Scanning...';
    await window.api.runScan();
  });

  // Open web dashboard
  $dashboardBtn.addEventListener('click', () => {
    window.api.openDashboard();
  });

  // Enroll
  $enrollBtn.addEventListener('click', async () => {
    const serverUrl = $serverUrl.value.trim();
    const secret = $enrollSecret.value.trim();
    if (!serverUrl || !secret) {
      showStatus($enrollStatus, 'Server URL and enrollment secret are required.', 'error');
      return;
    }
    $enrollBtn.disabled = true;
    $enrollBtn.textContent = 'Enrolling...';
    const result = await window.api.enroll(serverUrl, secret);
    $enrollBtn.disabled = false;
    $enrollBtn.textContent = 'Enroll';
    if (result.success) {
      showStatus($enrollStatus, `Enrolled successfully (machine: ${result.machineId})`, 'success');
      $enrollSecret.value = '';
      await refreshStatus();
    } else {
      showStatus($enrollStatus, result.error, 'error');
    }
  });

  // Save settings
  $saveBtn.addEventListener('click', async () => {
    const settings = {
      serverUrl: $serverUrl.value.trim() || 'http://localhost:8787',
      startMonitorOnLaunch: document.getElementById('toggle-startOnLaunch').checked,
      monitorClipboard: document.getElementById('toggle-clipboard').checked,
      monitorFileDialogs: document.getElementById('toggle-fileDialogs').checked,
      monitorTypedPrompts: document.getElementById('toggle-typedPrompts').checked,
      monitorAttachments: document.getElementById('toggle-attachments').checked,
      monitorEnforcer: document.getElementById('toggle-enforcer').checked,
      autoStart: document.getElementById('toggle-autoStart').checked,
    };
    await window.api.saveSettings(settings);
    showStatus($saveStatus, 'Settings saved.', 'success');
    updateMonitorUI(isMonitoring);
    setTimeout(() => { $saveStatus.textContent = ''; }, 3000);
  });

  // Download extension
  $downloadExtBtn.addEventListener('click', async () => {
    $downloadExtBtn.disabled = true;
    $downloadExtBtn.textContent = 'Saving...';
    const result = await window.api.downloadExtension();
    $downloadExtBtn.disabled = false;
    $downloadExtBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Download Extension`;
    if (result.success) {
      showStatus($downloadExtStatus, `Saved to ${result.path}`, 'success');
    } else if (result.error !== 'Cancelled.') {
      showStatus($downloadExtStatus, result.error, 'error');
    }
  });

  // Extension page links
  document.getElementById('link-chrome-ext')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('chrome://extensions');
  });
  document.getElementById('link-chatgpt')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://chatgpt.com');
  });
  document.getElementById('link-claude')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal('https://claude.ai');
  });

  // ASAR injection
  $injectBtn.addEventListener('click', async () => {
    $injectBtn.disabled = true;
    $injectBtn.textContent = 'Running...';
    $injectOutput.style.display = 'block';
    $injectOutputText.textContent = 'Launching ASAR injection (may prompt for admin)...\n';
    await window.api.runInjection();
  });
}

// ── IPC listeners from main process ────────────────────────────────────────────
function setupIPCListeners() {
  window.api.onMonitorStatus((data) => {
    updateMonitorUI(data.running);
  });

  window.api.onMonitorError((message) => {
    // Show error in alerts
    addAlert({
      timestamp: new Date().toISOString(),
      type: 'info',
      severity: 'high',
      message: `Monitor error: ${message}`,
    });
  });

  window.api.onAlert((alert) => {
    addAlert(alert);
  });

  window.api.onInjectResult((data) => {
    $injectBtn.disabled = false;
    $injectBtn.textContent = 'Run ASAR Injection (Admin)';
    if (data.success) {
      $injectOutputText.textContent += 'Injection completed successfully.\n';
      if (data.output) $injectOutputText.textContent += data.output + '\n';
    } else {
      $injectOutputText.textContent += `Injection failed: ${data.error}\n`;
      if (data.output) $injectOutputText.textContent += data.output + '\n';
    }
  });

  window.api.onScanResult((data) => {
    $scanBtn.disabled = false;
    $scanBtn.textContent = 'Run Scan';
    if (data.success) {
      addAlert({
        timestamp: new Date().toISOString(),
        type: 'info',
        message: 'Machine scan completed and uploaded.',
      });
    } else {
      addAlert({
        timestamp: new Date().toISOString(),
        type: 'info',
        severity: 'high',
        message: `Scan failed: ${data.error || 'unknown error'}`,
      });
    }
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className = `form-status ${type}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Boot ───────────────────────────────────────────────────────────────────────
init();
