// Windows port → PID, by reusing the existing desktop-agent resolver.
//
// The resolver is a long-lived PowerShell helper that snapshots
// Get-NetTCPConnection + Get-Process every ~400ms, with an on-demand
// point-query fallback. See agent/src/proxy/process-resolver-win32.js
// for the rationale (cold powershell startup costs).
//
// We require the caller to `start()` the resolver once at daemon boot.

import {
  start as startResolver,
  getProcessByLocalPort,
  resolveOnDemand,
} from '../proxy/process-resolver-win32.js';

let started = false;

export function ensureStarted({ log } = {}) {
  if (started) return;
  startResolver({ log });
  started = true;
}

export async function pidForLocalPort(port) {
  if (!Number.isFinite(port) || port <= 0) return null;
  // First try the warm cache snapshot.
  let proc = getProcessByLocalPort(port);
  // Cache miss → on-demand point query (~5-50ms with the P/Invoke backend).
  if (!proc) proc = await resolveOnDemand(port, 300);
  return proc?.pid || null;
}
