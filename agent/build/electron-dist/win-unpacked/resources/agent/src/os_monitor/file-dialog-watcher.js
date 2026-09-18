// Wraps file-dialog-watcher.ps1 — a long-running STA PowerShell process
// that uses UIAutomation to detect Open File dialogs owned by AI apps and
// emits the user's selected file path(s) on dialog close.
//
// This covers the "click attach button in ChatGPT → pick file → Open"
// flow which CF_HDROP doesn't catch.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER_SCRIPT = join(__dirname, 'file-dialog-watcher.ps1');

export class FileDialogWatcher extends EventEmitter {
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

    this.log?.info('file-dialog-watcher: starting UIA helper');
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
      if (s) this.log?.warn('file-dialog-watcher stderr: ' + s.slice(0, 200));
    });

    this.child.on('exit', (code, signal) => {
      this.log?.warn(`file-dialog-watcher: exited code=${code} signal=${signal}`);
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
      catch { this.log?.warn('file-dialog-watcher: non-JSON: ' + line.slice(0, 120)); continue; }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info(`file-dialog-watcher: ready (pid=${ev.pid}, ai=${(ev.ai_processes || []).length} procs)`);
        break;
      case 'file_dialog_pick':
        this.emit('file_dialog_pick', ev);
        break;
      case 'heartbeat':
        break;
      case 'error':
        this.log?.warn('file-dialog-watcher error: ' + ev.message);
        break;
      default:
        this.log?.warn('file-dialog-watcher: unknown kind: ' + ev.kind);
    }
  }
}
