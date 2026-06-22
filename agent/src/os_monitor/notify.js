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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HELPER_SCRIPT = join(__dirname, 'toast-helper.ps1');

export class ToastService {
  constructor({ log }) {
    this.log = log;
    this.child = null;
    this.ready = false;
    this.queueBeforeReady = [];
    this.stopRequested = false;
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
            this.log?.info(`toast: helper ready (aumid=${ev.aumid})`);
            // Flush any toasts queued before ready
            for (const c of this.queueBeforeReady) this.#write(c);
            this.queueBeforeReady.length = 0;
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
      this.child = null;
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

  #write(cmd) {
    if (!this.child || !this.child.stdin.writable) return;
    try {
      this.child.stdin.write(JSON.stringify(cmd) + '\n');
    } catch (err) {
      this.log?.warn('toast: stdin write failed: ' + err.message);
    }
  }
}
