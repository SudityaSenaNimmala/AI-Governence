// Wraps prompt-watcher.ps1 — a long-running STA PowerShell process that uses
// UIAutomation to read the text a user TYPES into an AI desktop app's prompt
// box (Claude Desktop, ChatGPT Desktop, etc.) without injecting into the app.
//
// This is the only coverage for TYPED (not pasted) secrets in vendor-sealed
// apps: they pin TLS (proxy can't read traffic) and enforce ASAR integrity
// (DOM hook can't be injected). UIA reads from the OS side. Detect + notify
// only — UIA can't block another app's send.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WATCHER_SCRIPT = join(__dirname, 'prompt-watcher.ps1');

export class PromptWatcher extends EventEmitter {
  constructor({ log, aiProcessNames }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
  }

  start() {
    if (process.platform !== 'win32') return;   // UIA helper is Windows-only
    if (this.child) return;

    this.log?.info('prompt-watcher: starting UIA helper (typed-prompt capture)');
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
      if (s) this.log?.warn('prompt-watcher stderr: ' + s.slice(0, 200));
    });

    this.child.on('exit', (code, signal) => {
      this.log?.warn(`prompt-watcher: exited code=${code} signal=${signal}`);
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
      catch { this.log?.warn('prompt-watcher: non-JSON: ' + line.slice(0, 120)); continue; }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info(`prompt-watcher: ready (pid=${ev.pid}, ai=${(ev.ai_processes || []).length} procs)`);
        break;
      case 'prompt_text':
        this.emit('prompt_text', ev);
        break;
      case 'heartbeat':
        break;
      case 'error':
        this.log?.warn('prompt-watcher error: ' + ev.message);
        break;
      default:
        this.log?.warn('prompt-watcher: unknown kind: ' + ev.kind);
    }
  }
}
