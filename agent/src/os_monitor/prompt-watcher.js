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

import { buildIdeProcessConfig, buildAiPanelConfig } from './ai-processes.js';

// Resolved defensively: under a bundler that emits CJS (the SEA tracker build)
// import.meta.url is not available, so this must not throw at module load. The
// tracker passes an explicit scriptPath in that case.
const MODULE_DIR = (() => {
  try { return dirname(fileURLToPath(import.meta.url)); } catch { return null; }
})();
const WATCHER_SCRIPT = MODULE_DIR ? join(MODULE_DIR, 'prompt-watcher.ps1') : null;

export class PromptWatcher extends EventEmitter {
  // trackerMode=true switches the PS1 into Claude-tracker behaviour: browser
  // coverage behind a claude.ai URL gate, and prompt_submit events carrying only
  // a length instead of prompt_text carrying the text. Left false, the watcher
  // behaves exactly as it always has.
  // scriptPath overrides where prompt-watcher.ps1 is found. A SEA-built binary
  // has no real directory to resolve it from, so the tracker locates the script
  // next to the executable and passes it in.
  constructor({ log, aiProcessNames, trackerMode = false, browserProcessNames = null, scriptPath = null }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.trackerMode = trackerMode;
    this.browserProcessNames = browserProcessNames;
    this.scriptPath = scriptPath || WATCHER_SCRIPT;
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
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CFAI_AI_PROCESSES: this.aiProcessNames.join(','),
          // IDE panel scoping. These two payloads only ever REMOVE capture here
          // — they never add a process to the watched set (that is
          // CFAI_AI_PROCESSES' job alone, and no IDE name may be folded into
          // it). Cursor is in AI_PROCESSES for its host/exception mapping, which
          // used to mean this watcher read the FULL TEXT of whatever element had
          // focus in Cursor every ~1.2s — a plain code editor or a terminal
          // included — and reported it as a typed prompt. With this config the
          // .ps1 reads an IDE's focused element only when it matches a known AI
          // composer signature. Same JSON-over-env-var mechanism enforcer.js
          // uses, so ai-processes.js stays the single place a signature is
          // written down.
          CFAI_IDE_PROCESSES: JSON.stringify(buildIdeProcessConfig()),
          CFAI_AI_PANELS: JSON.stringify(buildAiPanelConfig()),
          ...(this.trackerMode ? { CFAI_CLAUDE_TRACKER: '1' } : {}),
          ...(this.browserProcessNames ? { CFAI_BROWSER_PROCESSES: this.browserProcessNames.join(',') } : {}),
        },
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
        this.log?.info(
          `prompt-watcher: ready (pid=${ev.pid}, ${ev.ai_count ?? '?'} app(s)` +
          // Counts only. A panel_count of 0 is the diagnostic that matters: it
          // means no IDE composer can be read at all (the fail-closed default),
          // so an in-IDE prompt going unseen has an explanation in the log.
          `, ${ev.panel_count ?? '?'} panel(s) in ${ev.ide_count ?? '?'} IDE(s)` +
          `${ev.tracker ? ', claude-tracker mode' : ''})`,
        );
        break;
      case 'prompt_text':
        this.emit('prompt_text', ev);
        break;
      case 'prompt_submit':
        // Tracker mode only: {service, len, process, pid} — no prompt text.
        this.emit('prompt_submit', ev);
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
