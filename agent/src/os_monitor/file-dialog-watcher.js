// Wraps file-dialog-watcher.ps1 — a long-running STA PowerShell process
// that uses UIAutomation to detect Open File dialogs owned by AI apps and
// emits the user's selected file path(s) on dialog close.
//
// This covers the "click attach button in ChatGPT → pick file → Open"
// flow which CF_HDROP doesn't catch.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helperScript } from './helper-path.js';
import { EventEmitter } from 'node:events';

// Resolved through helperScript() rather than import.meta.url: this module is
// bundled to CommonJS for the packaged binary, where import.meta does not exist
// and the old expression threw at load time — killing the whole agent before it
// printed anything. See helper-path.js.
const WATCHER_SCRIPT = helperScript('file-dialog-watcher.ps1');

export class FileDialogWatcher extends EventEmitter {
  /**
   * `onRespawn` — see AttachmentWatcher's constructor for the full reasoning.
   * The host_arm state lives in the CHILD, so a respawned helper comes up
   * disarmed and needs the current state re-stated or it stays blind for as long
   * as the already-open governed conversation lasts.
   */
  constructor({ log, aiProcessNames, onRespawn = null }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.onRespawn = onRespawn;
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
        // stdin is 'pipe', not 'ignore' — see hostArm().
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CFAI_AI_PROCESSES: this.aiProcessNames.join(',') },
      }
    );

    // See AttachmentWatcher's copy of this: an in-flight write to a helper that
    // has just died raises EPIPE asynchronously, and an unhandled stream 'error'
    // is an uncaughtException.
    this.child.stdin.on('error', (err) => {
      this.log?.warn(`file-dialog-watcher: stdin write failed — ${err?.message || err}`);
    });
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
    // AFTER the child exists, so the callback can write to its stdin.
    try { this.onRespawn?.(this); } catch (err) {
      this.log?.warn(`file-dialog-watcher: re-arm hook failed — ${err?.message || err}`);
    }
  }

  stop() {
    this.stopRequested = true;
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
  }

  /**
   * Add or remove a HOST APP (Microsoft Teams) from the set of processes whose
   * file pickers this helper tracks. Same contract, same payload and the same
   * privacy reasoning as AttachmentWatcher.hostArm() — a bare process name and
   * an on/off, nothing else.
   *
   * The helper LATCHES this onto each dialog when the dialog is first seen,
   * because a picker steals focus and so the arm is already gone by the time it
   * closes. See $HostDisarmedAt in file-dialog-watcher.ps1.
   */
  hostArm(processName, on) {
    if (!processName) return false;
    if (!this.child?.stdin || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(JSON.stringify({
        cmd: 'host_arm', process: String(processName), state: on ? 'on' : 'off',
      }) + '\n');
      return true;
    } catch (err) {
      this.log?.warn(`file-dialog-watcher: host_arm command failed — ${err?.message || err}`);
      return false;
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
