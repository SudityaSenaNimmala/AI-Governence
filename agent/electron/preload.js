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
});
