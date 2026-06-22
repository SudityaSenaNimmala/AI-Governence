// Wraps attachment-watcher.ps1 — a long-running STA PowerShell process
// that watches focused AI windows' UIA tree for filename-like elements
// appearing in their attachment chips. Catches drag-and-drop uploads
// (and double-checks file-picker + clipboard-paste uploads).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER_SCRIPT = join(__dirname, 'attachment-watcher.ps1');

export class AttachmentWatcher extends EventEmitter {
  constructor({ log, aiProcessNames }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
  }

  start() {
    if (process.platform !== 'win32') return;
    if (this.child) return;
    this.log?.info('attachment-watcher: starting UIA helper');
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', WATCHER_SCRIPT],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CFAI_AI_PROCESSES: this.aiProcessNames.join(',') },
      }
    );
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) this.log?.warn('attachment-watcher stderr: ' + s.slice(0, 200));
    });
    this.child.on('exit', (code, signal) => {
      this.log?.warn(`attachment-watcher: exited code=${code} signal=${signal}`);
      this.child = null;
      if (!this.stopRequested) setTimeout(() => this.start(), 2000);
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
      let ev;
      try { ev = JSON.parse(line); }
      catch { this.log?.warn('attachment-watcher: non-JSON: ' + line.slice(0, 120)); continue; }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info(`attachment-watcher: ready (pid=${ev.pid}, search_dirs=${(ev.search_dirs || []).length})`);
        break;
      case 'attachment_appeared':
        this.emit('attachment_appeared', ev);
        break;
      case 'heartbeat':
        break;
      case 'error':
        this.log?.warn('attachment-watcher error: ' + ev.message);
        break;
      default:
        this.log?.warn('attachment-watcher: unknown kind: ' + ev.kind);
    }
  }
}
