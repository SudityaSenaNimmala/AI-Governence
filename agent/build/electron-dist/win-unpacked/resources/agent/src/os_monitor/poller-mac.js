// macOS adapter for the OS-level AI monitor.
//
// Spawns a long-running osascript (JXA) child that emits NDJSON lines —
// same architecture and event schema as the Windows PowerShell poller.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'mac-poller.osa.js');

export class MacPoller extends EventEmitter {
  constructor({ log }) {
    super();
    this.log = log;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
    this.lastHeartbeatAt = null;
  }

  start() {
    if (process.platform !== 'darwin') return;
    if (this.child) return;

    this.log?.info('os_monitor: starting macOS JXA poller');
    this.child = spawn('osascript', ['-l', 'JavaScript', SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onStdout(chunk));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) this.log?.warn('os_monitor mac poller stderr: ' + s);
    });

    this.child.on('exit', (code, signal) => {
      this.log?.warn(`os_monitor: mac poller exited code=${code} signal=${signal}`);
      this.child = null;
      if (!this.stopRequested) setTimeout(() => this.start(), 2000);
    });

    this.child.on('error', (err) => {
      this.log?.error('os_monitor: failed to spawn osascript: ' + err.message);
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
        this.log?.warn('os_monitor: non-JSON from mac poller: ' + line.slice(0, 120));
        continue;
      }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info(`os_monitor: mac poller ready (pid=${ev.pid})`);
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
        this.log?.warn('os_monitor: mac poller error: ' + ev.message);
        this.emit('poller-error', ev);
        break;
      default:
        this.log?.warn('os_monitor: unknown event kind from mac poller: ' + ev.kind);
    }
  }
}
