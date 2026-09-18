// Resolve "which process owns this local TCP port" on Windows.
//
// Used at CONNECT time in the proxy to decide whether the connecting client
// is a browser (bridge — the browser extension handles DLP) or some other
// process (intercept — desktop AI apps, CLIs, etc.).
//
// Mechanism: a long-lived PowerShell helper (process-resolver-win32.ps1) is
// spawned once at start. Node sends 'snapshot' commands to its stdin every
// REFRESH_MS; the helper enumerates Get-NetTCPConnection + Get-Process and
// streams one JSON line per established connection, ending with a '---END---'
// sentinel. Node accumulates per-snapshot and atomically swaps into _portMap.
//
// Why long-lived: cold `powershell` startup costs ~5-20s on AV-scanned
// machines (16s on the target laptop). A long-lived helper sidesteps that
// entirely; each snapshot is then sub-second.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER_SCRIPT = join(__dirname, 'process-resolver-win32.ps1');

let _portMap = new Map();   // port -> { pid, name }
let _child = null;
let _ready = false;
let _timer = null;
let _running = false;
let _pendingSnapshot = [];  // accumulator for the currently-building snapshot
let _logRef = null;
// On-demand `lookup <port>` requests. Keyed by port, value = { resolve, timer }.
// Snapshots are async + periodic; lookups give us point-query semantics for
// the race-prone case where a brand-new browser connection arrives before the
// next snapshot has it.
let _pendingLookups = new Map();

// With the P/Invoke backend a full snapshot is sub-50ms, so refresh
// frequently. The helper coalesces overlapping requests via stdin queueing.
const REFRESH_MS = 400;
const STARTUP_TIMEOUT_MS = 30_000;   // tolerate slow Windows startups

export function start({ log } = {}) {
  if (_running) return;
  _running = true;
  _logRef = log;
  startHelper(log);
  // Drive periodic snapshots. The helper does the work, Node just kicks it.
  _timer = setInterval(() => {
    if (_child && _ready && _child.stdin.writable) {
      try { _child.stdin.write('snapshot\n'); } catch {}
    }
  }, REFRESH_MS);
  _timer.unref();
}

export function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _running = false;
  if (_child) {
    try { _child.stdin.write('shutdown\n'); } catch {}
    try { _child.stdin.end(); } catch {}
    _child = null;
  }
  _portMap.clear();
  _ready = false;
}

/** Returns { pid, name } for a local TCP port, or null on miss. Sync, cache-only. */
export function getProcessByLocalPort(port) {
  return _portMap.get(port) || null;
}

/**
 * Async on-demand lookup for a single port. Use this when the sync cache
 * misses — typical for brand-new browser ephemeral ports that haven't been
 * picked up by a periodic snapshot yet. Sends `lookup <port>` to the helper
 * and awaits the matching `lookup-result` response. Falls back to null on
 * timeout so callers can default to a safe behavior.
 */
export function resolveOnDemand(port, timeoutMs = 200) {
  return new Promise((resolve) => {
    if (!_child || !_ready || !_child.stdin || !_child.stdin.writable) {
      if (process.env.CFAI_RESOLVER_DEBUG) console.log(`[debug] resolveOnDemand(${port}) early-null: ready=${_ready} child=${!!_child} writable=${_child?.stdin?.writable}`);
      return resolve(null);
    }
    if (process.env.CFAI_RESOLVER_DEBUG) console.log(`[debug] resolveOnDemand(${port}) sending lookup`);
    // If we already have an in-flight lookup for this port (e.g. two CONNECTs
    // raced for the same ephemeral) coalesce: the second caller will get the
    // same answer via the resolver chain.
    const existing = _pendingLookups.get(port);
    if (existing) {
      existing.resolvers.push(resolve);
      return;
    }
    const entry = {
      resolvers: [resolve],
      timer: setTimeout(() => {
        const e = _pendingLookups.get(port);
        if (!e) return;
        _pendingLookups.delete(port);
        for (const r of e.resolvers) r(null);
      }, timeoutMs),
    };
    _pendingLookups.set(port, entry);
    try {
      _child.stdin.write(`lookup ${port}\n`);
    } catch {
      clearTimeout(entry.timer);
      _pendingLookups.delete(port);
      resolve(null);
    }
  });
}

// ---- helper lifecycle ----

function startHelper(log) {
  if (process.platform !== 'win32') {
    log?.warn?.('process-resolver: not win32, skipping');
    return;
  }
  log?.info?.('process-resolver: starting helper');
  _child = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER_SCRIPT],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );

  let stdoutBuf = '';
  _child.stdout.setEncoding('utf8');
  _child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk;
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
      stdoutBuf = stdoutBuf.slice(idx + 1);
      handleHelperLine(line, log);
    }
  });

  _child.stderr.setEncoding('utf8');
  _child.stderr.on('data', (chunk) => {
    const s = String(chunk).trim();
    if (s) log?.warn?.(`process-resolver helper stderr: ${s.slice(0, 200)}`);
  });

  _child.on('exit', (code, signal) => {
    log?.warn?.(`process-resolver: helper exited code=${code} signal=${signal}`);
    _ready = false;
    _child = null;
    if (_running) {
      // Auto-restart after a brief backoff
      setTimeout(() => { if (_running) startHelper(log); }, 2000);
    }
  });

  _child.on('error', (err) => {
    log?.warn?.(`process-resolver: spawn error: ${err.message}`);
  });

  // Safety net: if 'ready' never fires within the startup budget, log it.
  // (We don't fail-fast; the cache stays empty and lookups return null.)
  setTimeout(() => {
    if (_running && !_ready) {
      log?.warn?.(`process-resolver: helper did not signal ready within ${STARTUP_TIMEOUT_MS}ms`);
    }
  }, STARTUP_TIMEOUT_MS);
}

let _snapshotsCompleted = 0;
let _lastSnapshotLog = 0;

function handleHelperLine(line, log) {
  if (!line) return;
  if (line === '---END---') {
    // Atomic swap: replace _portMap with everything collected this round.
    const next = new Map();
    for (const obj of _pendingSnapshot) {
      if (!next.has(obj.port)) next.set(obj.port, { pid: obj.pid, name: obj.name });
    }
    _portMap = next;
    _pendingSnapshot = [];
    _snapshotsCompleted++;
    // Heartbeat log every ~20s so we can verify snapshots are landing.
    const now = Date.now();
    if (now - _lastSnapshotLog > 20_000) {
      log?.info?.(`process-resolver: snapshot #${_snapshotsCompleted} ${next.size} entries`);
      _lastSnapshotLog = now;
    }
    return;
  }
  if (line[0] !== '{') return;
  let obj;
  try { obj = JSON.parse(line); } catch (e) {
    log?.warn?.(`process-resolver: JSON parse failed: ${line.slice(0, 100)}`);
    return;
  }
  if (obj && obj.kind === 'ready') {
    _ready = true;
    log?.info?.('process-resolver: helper ready, kicking first snapshot');
    try { _child?.stdin?.write('snapshot\n'); } catch {}
    return;
  }
  if (obj && obj.kind === 'lookup-result') {
    if (process.env.CFAI_RESOLVER_DEBUG) console.log(`[debug] lookup-result received: port=${obj.port} pid=${obj.pid} name=${obj.name} pending=${_pendingLookups.has(obj.port)}`);
    const entry = _pendingLookups.get(obj.port);
    if (!entry) return;
    _pendingLookups.delete(obj.port);
    clearTimeout(entry.timer);
    const result = obj.name ? { pid: obj.pid, name: obj.name } : null;
    if (result) _portMap.set(obj.port, result);
    for (const r of entry.resolvers) r(result);
    return;
  }
  if (obj && typeof obj.port === 'number') {
    _pendingSnapshot.push(obj);
  }
}
