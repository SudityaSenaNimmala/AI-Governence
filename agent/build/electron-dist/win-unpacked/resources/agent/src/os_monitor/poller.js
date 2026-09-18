// Wraps the PowerShell long-running poller. Spawns it as a child process,
// parses NDJSON from stdout, emits typed events to listeners.
//
// On non-Windows platforms this is a no-op for v1 (we'll add macOS/Linux
// equivalents later — AXObserver on darwin, X11/Wayland on linux).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLLER_SCRIPT = join(__dirname, 'win-poller.ps1');

export class WinPoller extends EventEmitter {
  constructor({ log }) {
    super();
    this.log = log;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
    this.lastHeartbeatAt = null;
  }

  start() {
    if (process.platform !== 'win32') {
      this.log?.warn('os_monitor: not supported on platform ' + process.platform + ' (v1 is Windows-only)');
      return;
    }
    if (this.child) return;

    this.log?.info('os_monitor: starting PowerShell poller');
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', POLLER_SCRIPT],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onStdout(chunk));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      // PowerShell error stream — surface as warnings.
      const s = String(chunk).trim();
      if (s) this.log?.warn('os_monitor poller stderr: ' + s);
    });

    this.child.on('exit', (code, signal) => {
      this.log?.warn(`os_monitor: poller exited code=${code} signal=${signal}`);
      this.child = null;
      // Restart after a short delay unless we asked it to stop.
      if (!this.stopRequested) {
        setTimeout(() => this.start(), 2000);
      }
    });
  }

  stop() {
    this.stopRequested = true;
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
  }

  #onStdout(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let ev = null;
      try { ev = JSON.parse(line); } catch {
        this.log?.warn('os_monitor: non-JSON line from poller: ' + line.slice(0, 120));
        continue;
      }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info(`os_monitor: poller ready (pid=${ev.pid}, sta=${ev.sta})`);
        this.emit('ready', ev);
        break;
      case 'heartbeat':
        this.lastHeartbeatAt = Date.now();
        this.emit('heartbeat', ev);
        break;
      case 'focus':
        this.emit('focus', ev);
        break;
      case 'clipboard':
        this.emit('clipboard', ev);
        break;
      case 'clipboard_files':
        this.emit('clipboard_files', ev);
        break;
      case 'error':
        this.log?.warn('os_monitor: poller error: ' + ev.message);
        this.emit('poller-error', ev);
        break;
      default:
        this.log?.warn('os_monitor: unknown event kind: ' + ev.kind);
    }
  }
}
