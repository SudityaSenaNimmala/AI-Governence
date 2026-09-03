// Persistent Windows toast notifier.
//
// Spawns ONE long-lived STA PowerShell process at startup (toast-helper.ps1)
// and pipes JSON commands to its stdin. Each toast is then a ~5-byte stdin
// write — no powershell.exe cold-start, no WinRT-load cost per notification.
//
// The helper also registers a custom AUMID (CloudFuze.AIGovernance) in HKCU
// the first time it runs, so toasts are attributed to "CloudFuze AI
// Governance" instead of "Windows PowerShell".

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helperScript } from './helper-path.js';

// helperScript() rather than import.meta.url — see helper-path.js. Bundled to
// CommonJS this expression threw at load and took the whole agent with it.
const HELPER_SCRIPT = helperScript('toast-helper.ps1');

// How long a Request Access dialog may stay unanswered before this side stops
// waiting for it. The dialog is ephemeral by design; if the user walks away with
// it open, the correlation entry must not live forever. The helper's form is NOT
// closed by this — it is still theirs to submit, and a late submit simply finds
// no correlation entry and is dropped, which is the correct outcome: by then the
// pre-check the caller ran is stale.
const REQUEST_DIALOG_TIMEOUT_MS = 5 * 60 * 1000;

export class ToastService {
  constructor({ log }) {
    this.log = log;
    this.child = null;
    this.ready = false;
    this.queueBeforeReady = [];
    this.stopRequested = false;
    // request_id -> { resolve, timer }. In memory only, deliberately: a dialog
    // is answered within seconds of the block that opened it, and a request that
    // outlives the process was never submitted.
    this.pendingDialogs = new Map();
    // Whether the helper managed to compile its dialog type at startup. False
    // means every showRequestDialog() answers 'unavailable' immediately instead
    // of waiting on a form that can never appear.
    this.dialogSupported = false;
  }

  start() {
    if (process.platform !== 'win32') return;
    if (this.child) return;

    this.log?.info('toast: starting persistent helper');
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', HELPER_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdoutBuf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.kind === 'ready') {
            this.ready = true;
            this.dialogSupported = ev.dialog === true;
            this.log?.info(`toast: helper ready (aumid=${ev.aumid}, dialog=${this.dialogSupported})`);
            // Flush any toasts queued before ready
            for (const c of this.queueBeforeReady) this.#write(c);
            this.queueBeforeReady.length = 0;
          } else if (ev.kind === 'access_request_result') {
            // The user answered (or the helper refused to open a second dialog
            // for the same block session). Only the action and the reason THEY
            // typed come back — see toast-helper.ps1.
            this.#settleDialog(ev.request_id, {
              action: String(ev.action || 'cancel'),
              reason: typeof ev.reason === 'string' ? ev.reason : '',
            });
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });

    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) this.log?.warn('toast helper stderr: ' + s.slice(0, 200));
    });

    this.child.on('exit', (code, signal) => {
      this.log?.warn(`toast: helper exited code=${code} signal=${signal}`);
      this.ready = false;
      this.dialogSupported = false;
      this.child = null;
      // Any dialog that was on screen died with the helper. Answer every
      // waiting caller now rather than leaving it holding a promise that can
      // never settle — 'unavailable' is truthful and makes no request.
      for (const id of [...this.pendingDialogs.keys()]) {
        this.#settleDialog(id, { action: 'unavailable', reason: '' });
      }
      if (!this.stopRequested) {
        // Auto-restart after a short delay so a one-off crash doesn't
        // silently disable notifications for the rest of the agent's life.
        setTimeout(() => this.start(), 2000);
      }
    });

    this.child.on('error', (err) => {
      this.log?.warn('toast: helper spawn error: ' + err.message);
    });
  }

  stop() {
    this.stopRequested = true;
    if (this.child) {
      try { this.#write({ cmd: 'shutdown' }); } catch {}
      try { this.child.stdin.end(); } catch {}
      this.child = null;
    }
  }

  show({ title, message }) {
    if (process.platform !== 'win32') return;
    const cmd = { cmd: 'show', title, message };
    if (!this.ready) {
      this.queueBeforeReady.push(cmd);
      return;
    }
    this.#write(cmd);
  }

  // Replace the system clipboard with the given text. Used by the OS monitor's
  // narrow enforcement path for sandboxed Store AI apps that pin TLS certs.
  // See os_monitor/index.js + ai-processes.js (`unhookableSandbox`).
  scrubClipboard(replacement) {
    if (process.platform !== 'win32') return;
    const cmd = { cmd: 'scrub_clipboard', replacement };
    if (!this.ready) {
      this.queueBeforeReady.push(cmd);
      return;
    }
    this.#write(cmd);
  }

  /**
   * Open the ephemeral Request Access dialog and resolve with what the user
   * did. The ONLY visible UI this agent ever produces: it appears at the moment
   * a blocked send was swallowed and disappears on submit/cancel — no window,
   * no taskbar entry, no tray icon (toast-helper.ps1 sets ShowInTaskbar=false
   * and this process is spawned windowsHide:true).
   *
   * Resolves { action, reason } where action is:
   *   'submit'      — the user typed a reason and asked. `reason` is that text
   *                   and nothing else; no prompt content exists on this path.
   *   'cancel'      — they dismissed it (or closed the window, or pressed Esc).
   *   'suppressed'  — a dialog for this same block session is already on screen,
   *                   so nothing new was shown.
   *   'unavailable' — no helper, not Windows, or the helper could not build its
   *                   dialog type. The caller should fall back to a toast.
   *   'timeout'     — left unanswered past REQUEST_DIALOG_TIMEOUT_MS.
   *
   * `dedupeKey` is what the helper dedupes on, and must identify the BLOCK
   * (agent id / host), not the individual attempt — so repeated Enter-presses
   * while a dialog is up all resolve to the one form. The guard is CONCURRENCY
   * only: the helper releases the key when the form closes, and the next
   * blocked send legitimately opens a new dialog.
   */
  showRequestDialog({ agentName = '', appName = '', dedupeKey = '' } = {}) {
    if (process.platform !== 'win32') return Promise.resolve({ action: 'unavailable', reason: '' });
    // Deliberately NOT queued behind `ready` like a toast is: a dialog that
    // arrives after the moment of the block has lost its whole context, and
    // would appear over whatever the user moved on to.
    if (!this.ready || !this.dialogSupported || !this.child) {
      return Promise.resolve({ action: 'unavailable', reason: '' });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#settleDialog(requestId, { action: 'timeout', reason: '' });
      }, REQUEST_DIALOG_TIMEOUT_MS);
      timer.unref?.();
      this.pendingDialogs.set(requestId, { resolve, timer });
      this.#write({
        cmd: 'show_request_dialog',
        request_id: requestId,
        dedupe_key: dedupeKey || requestId,
        agent_name: agentName,
        app_name: appName,
      });
    });
  }

  #settleDialog(requestId, result) {
    const id = String(requestId || '');
    const entry = this.pendingDialogs.get(id);
    if (!entry) return;              // unknown / already settled / timed out
    this.pendingDialogs.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(result);
  }

  #write(cmd) {
    if (!this.child || !this.child.stdin.writable) return;
    try {
      this.child.stdin.write(JSON.stringify(cmd) + '\n');
    } catch (err) {
      this.log?.warn('toast: stdin write failed: ' + err.message);
    }
  }
}
