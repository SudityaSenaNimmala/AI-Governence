// Wraps enforcer-win.ps1 — a long-running process that installs a low-level
// keyboard hook and SWALLOWS the send keystroke (Enter) / paste (Ctrl+V) when
// the focused AI desktop app's prompt box (or the clipboard) contains a
// high/critical pattern. This is the only way to actually BLOCK a send in a
// vendor-sealed app (Claude/ChatGPT/Gemini desktop) that pins TLS and enforces
// ASAR integrity — no app modification, no network interception.
//
// Windows-only (UIA + WH_KEYBOARD_LL). Emits 'block' / 'override' events that
// the orchestrator reports to the governance server and surfaces as toasts.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENFORCER_SCRIPT = join(__dirname, 'enforcer-win.ps1');

export class Enforcer extends EventEmitter {
  constructor({ log, aiProcessNames, blockPatterns }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.blockPatterns = blockPatterns;   // [{ name, source }]
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
  }

  start() {
    if (process.platform !== 'win32') return;   // WH_KEYBOARD_LL + UIA are Windows-only
    if (this.child) return;

    this.log?.info('enforcer: starting keystroke send-blocker (Enter/Ctrl+V swallow)');
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ENFORCER_SCRIPT],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CFAI_AI_PROCESSES: this.aiProcessNames.join(','),
          CFAI_BLOCK_PATTERNS: JSON.stringify(this.blockPatterns || []),
        },
      }
    );

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onStdout(chunk));

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) this.log?.warn('enforcer stderr: ' + s.slice(0, 300));
    });

    this.child.on('exit', (code, signal) => {
      this.log?.warn(`enforcer: exited code=${code} signal=${signal}`);
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
      catch { this.log?.warn('enforcer: non-JSON: ' + line.slice(0, 120)); continue; }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info('enforcer: ready — send-blocker armed');
        this.emit('ready', ev);
        break;
      case 'block':
        this.emit('block', ev);
        break;
      case 'override':
        this.emit('override', ev);
        break;
      case 'error':
        this.log?.warn('enforcer error: ' + ev.message);
        break;
      default:
        this.log?.warn('enforcer: unknown kind: ' + ev.kind);
    }
  }
}
