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

// The same idea for the Tokenize & Send popup, but two orders of magnitude
// shorter, because that popup answers a question with a deadline: the enforcer
// only holds a rewritable block for REWRITE_TTL (15s), and the helper closes its
// own form at CfaiTokenizeDialog.TimeoutMs (16s) and writes a 'timeout' line.
// This is purely the backstop for a helper that never wrote that line at all —
// 20s, so it can only ever fire after the helper's own expiry has been missed.
//
// A late answer is harmless either way: enforcer-win.ps1's StartRewrite
// validates the block id against its own single-use pin and answers a stale one
// with "stale_block_id"/"expired" instead of touching the composer. There is
// deliberately no second staleness clock on this side.
const TOKENIZE_DIALOG_TIMEOUT_MS = 20 * 1000;

// The same backstop, re-armed once the helper reports that the user opened the
// popup's "Edit manually" text box. 20s is the right budget for reading two
// buttons and clicking one; it is not a budget for typing a sentence, so from
// that moment on the clocks are:
//   helper's CfaiTokenizeDialog.EditTimeoutMs  90s   (the form closes itself)
//   this                                      100s   (backstop, as above: it
//                                                     can only fire after the
//                                                     helper missed its line)
//   enforcer's REWRITE_EDIT_TTL               120s   (the pin outlives both)
// Nothing here re-decides staleness — same reasoning as above, the enforcer
// still owns it, and a late answer still gets "stale_block_id"/"expired".
const TOKENIZE_EDIT_TIMEOUT_MS = 100 * 1000;

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
          } else if (ev.kind === 'tokenize_dialog_editing') {
            // The user opened the popup's "Edit manually" text box. NOT an
            // answer — the dialog is still open — so nothing is settled here.
            // Two things happen instead: this side's give-up clock is re-armed
            // for how long typing takes, and the caller is told, so it can ask
            // the enforcer to hold the pinned block for the same reason.
            //
            // Correlation id only. This line carries no content by construction
            // (see toast-helper.ps1) and nothing about it is logged.
            this.#extendDialog(ev.request_id);
          } else if (ev.kind === 'tokenize_dialog_result') {
            // The user chose, or the helper refused a second popup for the same
            // block, or one of its own expiries fired.
            //
            // `text` is present for exactly one action — 'edit_send' — and is
            // what the user typed into our own box: the string the enforcer is
            // being asked to type, and the only reason that action exists. It is
            // read here and passed to the caller, never logged. The masked
            // preview is still not echoed back for any other action (see the
            // helper's own note on that line): this side already has it, and it
            // is content.
            //
            // Anything that is not exactly 'tokenize' or 'edit_send' is a no-op
            // for the caller, so an unrecognised value degrades to "leave the
            // block standing".
            const action = String(ev.action || 'edit');
            this.#settleDialog(ev.request_id, {
              action,
              // Only ever carried off the one action, so a helper that put text
              // on some other line could not smuggle it into a rewrite.
              text: action === 'edit_send' && typeof ev.text === 'string' ? ev.text : '',
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

  /**
   * Open the ephemeral Tokenize & Send popup and resolve with what the user
   * chose. The CLI agent's counterpart of the Electron block dialog
   * (electron/renderer/block-dialog.js), which is unreachable on this path
   * because there is no Electron process to host it — the popup simply never
   * appeared for anyone running `ai-gov-agent --monitor`, so the feature's
   * enforcer-side machinery had no trigger at all.
   *
   * Resolves { action, text } where action is:
   *   'tokenize'    — mask the sensitive values and send anyway.
   *   'edit_send'   — they took "Edit manually", reworded the masked text
   *                   themselves and pressed Send. `text` is that wording, and
   *                   is the string the caller asks the enforcer to type; it is
   *                   empty on every other action.
   *   'edit'        — they cancelled the edit box, or closed the window.
   *   'timeout'     — nobody answered (the helper's own expiry for whichever
   *                   view was up, or this side's backstop).
   *   'suppressed'  — a popup for this same block is already on screen.
   *   'unavailable' — no helper, not Windows, or the helper could not build its
   *                   dialog type.
   * Every one of those except 'tokenize' and 'edit_send' means "leave the block
   * standing", which is exactly what happened before this popup existed.
   *
   * `onEditing`, if given, is called once if and when the user opens the edit
   * box — before this promise settles. It exists so the caller can hold the
   * enforcer's pinned block for as long as typing takes; see index.js's
   * #offerTokenize. It is handed nothing, and a throw from it is swallowed.
   *
   * `preview` is the ALREADY-MASKED text the enforcer computed and put on the
   * block event — the same string it would type into the composer. The original
   * prompt is not on this side of the pipe and must never be passed here.
   *
   * `dedupeKey` must be the BLOCK ID: the enforcer keeps that id stable while
   * the composer text is unchanged, so repeated Enter-presses against the same
   * prompt all resolve to the one popup, while a genuinely new prompt gets a
   * fresh one. Same concurrency-only guard as showRequestDialog's.
   */
  showTokenizeDialog({ appName = '', categories = '', preview = '', dedupeKey = '', onEditing = null } = {}) {
    if (process.platform !== 'win32') return Promise.resolve({ action: 'unavailable', text: '' });
    // Not queued behind `ready`, for a sharper version of the reason
    // showRequestDialog is not: this popup offers to rewrite a composer whose
    // exact contents the enforcer pinned seconds ago, and that pin expires.
    if (!this.ready || !this.dialogSupported || !this.child) {
      return Promise.resolve({ action: 'unavailable', text: '' });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#settleDialog(requestId, { action: 'timeout', text: '' });
      }, TOKENIZE_DIALOG_TIMEOUT_MS);
      timer.unref?.();
      this.pendingDialogs.set(requestId, { resolve, timer, onEditing });
      this.#write({
        cmd: 'show_tokenize_dialog',
        request_id: requestId,
        dedupe_key: dedupeKey || requestId,
        app_name: appName,
        categories,
        preview,
      });
    });
  }

  /**
   * The popup moved into its edit view: re-arm the give-up clock for how long
   * typing takes and tell the caller, once. Nothing is resolved — the dialog is
   * still on screen — and an unknown/already-settled id is ignored, same as
   * #settleDialog's.
   */
  #extendDialog(requestId) {
    const id = String(requestId || '');
    const entry = this.pendingDialogs.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.#settleDialog(id, { action: 'timeout', text: '' });
    }, TOKENIZE_EDIT_TIMEOUT_MS);
    entry.timer.unref?.();
    // At most once per dialog, and a throw from the caller's callback must not
    // take down the helper's stdout reader.
    const cb = entry.onEditing;
    entry.onEditing = null;
    if (typeof cb === 'function') {
      try { cb(); } catch (err) { this.log?.warn('toast: onEditing failed: ' + err.message); }
    }
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
