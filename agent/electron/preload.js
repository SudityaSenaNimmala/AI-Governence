// Preload script — exposes a safe IPC bridge to the renderer via contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Status
  getStatus: () => ipcRenderer.invoke('get-status'),
  getAlerts: () => ipcRenderer.invoke('get-alerts'),

  // Monitor control
  startMonitor: () => ipcRenderer.invoke('start-monitor'),
  stopMonitor: () => ipcRenderer.invoke('stop-monitor'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Enrollment
  enroll: (serverUrl, enrollSecret) =>
    ipcRenderer.invoke('enroll', { serverUrl, enrollSecret }),

  // ASAR injection
  runInjection: () => ipcRenderer.invoke('run-injection'),

  // Tokenize & Send dialog
  tokenizeBlock: (blockId) => ipcRenderer.invoke('tokenize-block', blockId),

  // Request Access dialog (shown when an AI app is blocked outright).
  // The reason text goes straight into the POST body in the main process — it is
  // never scanned, logged or persisted locally except in the offline queue file.
  submitAccessRequest: (payload) => ipcRenderer.invoke('access-request', payload),
  getAccessRequestStatus: (toolHost) => ipcRenderer.invoke('access-request-status', toolHost),

  // Auto-launch
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),

  // Browser extension
  downloadExtension: () => ipcRenderer.invoke('download-extension'),

  // External
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openDashboard: () => ipcRenderer.invoke('open-dashboard'),

  // Scan
  runScan: () => ipcRenderer.invoke('run-scan'),

  // Events from main process
  onMonitorStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('monitor-status', handler);
    return () => ipcRenderer.removeListener('monitor-status', handler);
  },
  onMonitorError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('monitor-error', handler);
    return () => ipcRenderer.removeListener('monitor-error', handler);
  },
  onAlert: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('alert', handler);
    return () => ipcRenderer.removeListener('alert', handler);
  },
  onInjectResult: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('inject-result', handler);
    return () => ipcRenderer.removeListener('inject-result', handler);
  },
  onScanResult: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('scan-result', handler);
    return () => ipcRenderer.removeListener('scan-result', handler);
  },
  onBlockDialog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('block-dialog', handler);
    return () => ipcRenderer.removeListener('block-dialog', handler);
  },
  onRewriteResult: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('rewrite-result', handler);
    return () => ipcRenderer.removeListener('rewrite-result', handler);
  },
  onAccessRequestDialog: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('access-request-dialog', handler);
    return () => ipcRenderer.removeListener('access-request-dialog', handler);
  },
  // The standing blocked-platform bar. Receive-only, and the payload is a single
  // display name — there is no companion invoke() for it and there must not be
  // one: the bar has nothing to send back, and the window rendering it is
  // non-focusable and click-through, so it has no way to be interacted with.
  onBlockBanner: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('block-banner', handler);
    return () => ipcRenderer.removeListener('block-banner', handler);
  },
});
