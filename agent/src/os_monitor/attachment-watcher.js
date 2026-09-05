// Wraps attachment-watcher.ps1 — a long-running STA PowerShell process
// that watches focused AI windows' UIA tree for filename-like elements
// appearing in their attachment chips. Catches drag-and-drop uploads
// (and double-checks file-picker + clipboard-paste uploads).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helperScript } from './helper-path.js';
import { EventEmitter } from 'node:events';

// Resolved through helperScript() rather than import.meta.url: this module is
// bundled to CommonJS for the packaged binary, where import.meta does not exist
// and the old expression threw at load time — killing the whole agent before it
// printed anything. See helper-path.js.
const WATCHER_SCRIPT = helperScript('attachment-watcher.ps1');

export class AttachmentWatcher extends EventEmitter {
  /**
   * `onRespawn` is called after every (re)start of the helper, including the
   * automatic one after a crash. It exists for exactly one reason: the host_arm
   * state below lives in the CHILD's memory, so a respawned helper comes up
   * DISARMED. Without this hook a crash inside a governed Teams conversation
   * would leave the new helper permanently blind to it — silently, because
   * nothing else would ever send host_arm again (index.js only sends on a
   * govstate transition, and the conversation is already open). The owner
   * re-states the current arm state from here.
   */
  constructor({ log, aiProcessNames, onRespawn = null }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.onRespawn = onRespawn;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
    // Has the helper's POLL LOOP ever reported in? See #dispatch's heartbeat case.
    this.sawHeartbeat = false;
  }

  start() {
    if (process.platform !== 'win32') return;
    if (this.child) return;
    this.log?.info('attachment-watcher: starting UIA helper');
    // Per-helper, so a respawn that comes up wedged is visible too.
    this.sawHeartbeat = false;
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', WATCHER_SCRIPT],
      {
        windowsHide: true,
        // stdin is 'pipe', not 'ignore' — see hostArm(). The ONE command that
        // goes down it carries a process name and an on/off, nothing else.
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CFAI_AI_PROCESSES: this.aiProcessNames.join(',') },
      }
    );
    // A write that is still in flight when the helper dies raises EPIPE
    // ASYNCHRONOUSLY, after hostArm() has already returned. An unhandled 'error'
    // on a stream is an uncaughtException, so without this a helper that exited
    // between "arm it" and the flush would take the whole agent down — the one
    // process that has to still be alive to block a send.
    this.child.stdin.on('error', (err) => {
      this.log?.warn(`attachment-watcher: stdin write failed — ${err?.message || err}`);
    });
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
    // AFTER the child exists, so the callback can write to its stdin. The fresh
    // helper is disarmed by construction — see the constructor's onRespawn note.
    try { this.onRespawn?.(this); } catch (err) {
      this.log?.warn(`attachment-watcher: re-arm hook failed — ${err?.message || err}`);
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
   * Add or remove a HOST APP (Microsoft Teams) from the set of processes the
   * helper looks at, for as long as a governed/blocked agent conversation is the
   * open one there.
   *
   * `key` is an opaque, non-reversible digest of the governed conversation this
   * arm is for (see OsMonitor#hostArmKey). It is what stops the helper from
   * resetting its filename baseline every time focus bounces off the composer —
   * which it did on every arm/disarm, and which made a Teams attachment
   * undetectable, because attaching a file IS a focus bounce.
   *
   * The helper keeps this in a SEPARATE set from its CFAI_AI_PROCESSES list and
   * never modifies that list, so the default — Teams is not watched at all — is
   * unchanged, and the armed window is exactly the window the org's own policy
   * already asked to be governed. Carries a bare process name and an on/off:
   * no path, no filename, no window title, no free text of any kind.
   */
  hostArm(processName, on, key = '') {
    if (!processName) return false;
    if (!this.child?.stdin || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(JSON.stringify({
        cmd: 'host_arm', process: String(processName), state: on ? 'on' : 'off',
        // Opaque digest of WHICH governed conversation, so the helper can tell a
        // focus bounce inside one conversation from a switch to another and only
        // drop its baseline for the latter — see Reset-Baseline in the .ps1. Not
        // reversible and not an identifier of anything outside this machine.
        key: String(key || ''),
      }) + '\n');
      return true;
    } catch (err) {
      this.log?.warn(`attachment-watcher: host_arm command failed — ${err?.message || err}`);
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
      case 'attachment_disappeared':
        this.emit('attachment_disappeared', ev);
        break;
      case 'heartbeat':
        // The FIRST one is logged, once, and nothing after it. `ready` only
        // proves the process started — a helper wedged before its first poll (as
        // one was, on a blocking stdin read) still says ready and then goes
        // silent forever. This line is the difference between that failure being
        // visible and being an absence of lines nobody can grep for.
        if (!this.sawHeartbeat) {
          this.sawHeartbeat = true;
          this.log?.info('attachment-watcher: poll loop live');
        }
        break;
      case 'error':
        this.log?.warn('attachment-watcher error: ' + ev.message);
        break;
      default:
        this.log?.warn('attachment-watcher: unknown kind: ' + ev.kind);
    }
  }
}
