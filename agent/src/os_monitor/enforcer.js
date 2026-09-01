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
import { helperScript } from './helper-path.js';
import { EventEmitter } from 'node:events';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import {
  STATE_DIR,
  ENFORCER_PID_PATH,
  ENFORCER_HEARTBEAT_PATH,
  writeEnforcerState,
  clearEnforcerState,
} from './enforcer-watchdog.js';
import { buildModelRouterConfig } from './model-router-config.js';
import { buildIdeProcessConfig, buildAiPanelConfig, buildAgentSurfaceConfig } from './ai-processes.js';

// Resolved through helperScript() rather than import.meta.url: this module is
// bundled to CommonJS for the packaged binary, where import.meta does not exist
// and the old expression threw at load time — killing the whole agent before it
// printed anything. See helper-path.js.
const ENFORCER_SCRIPT = helperScript('enforcer-win.ps1');

// How often we refresh the liveness heartbeat the PowerShell deadman reads.
// The helper gives up on us at 30s stale, so 5s leaves 6 missed beats of slack
// before a healthy-but-busy monitor gets its hook released out from under it.
const HEARTBEAT_MS = 5000;

export class Enforcer extends EventEmitter {
  constructor({ log, aiProcessNames, blockPatterns, enabled = true }) {
    super();
    this.log = log;
    this.aiProcessNames = aiProcessNames;
    this.blockPatterns = blockPatterns;   // [{ name, source }]
    // Master switch — the desktop app's "Keystroke enforcer" setting. When
    // false the helper is never spawned, so no keyboard hook is ever installed.
    // Checked inside start() (not just at the call site) so no other path —
    // policy-driven restarts, respawn-after-exit — can bring it up behind the
    // user's back.
    this.enabled = enabled !== false;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
    this.heartbeatTimer = null;
  }

  start() {
    if (!this.enabled) {
      this.log?.info('enforcer: disabled by settings — keystroke send-blocker not started');
      return;
    }
    if (process.platform !== 'win32') return;   // WH_KEYBOARD_LL + UIA are Windows-only
    if (this.child) return;

    // Write the first heartbeat BEFORE the helper exists, so its deadman never
    // sees a missing file on a healthy start.
    this.#beat();
    this.#startHeartbeat();

    this.log?.info('enforcer: starting keystroke send-blocker (Enter/Ctrl+V swallow)');
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ENFORCER_SCRIPT],
      {
        windowsHide: true,
        // stdin is now 'pipe', not 'ignore' — see tokenize() below. The only
        // thing ever written to it is {cmd:"tokenize", block_id}; the helper
        // validates the id against its own pinned pending block before doing
        // anything, so a compromised parent can at most replay a stale/wrong
        // id, which the helper already refuses.
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CFAI_AI_PROCESSES: this.aiProcessNames.join(','),
          CFAI_BLOCK_PATTERNS: JSON.stringify(this.blockPatterns || []),
          CFAI_ENFORCER_HEARTBEAT: ENFORCER_HEARTBEAT_PATH,
          // Model routing has no on/off switch of its own — it runs whenever
          // the enforcer does, same as the rest of its keystroke-level
          // behavior. CFAI_MODEL_ROUTER_ENABLED still travels as its own env
          // var (rather than being folded into the enforcer flag) because
          // the C# side treats it as an independent gate internally.
          CFAI_MODEL_ROUTER_ENABLED: 'true',
          CFAI_MODEL_ROUTER_CONFIG: JSON.stringify(buildModelRouterConfig()),
          // IDE-hosted AI panels (Claude Code / Copilot Chat in VS Code,
          // Cursor's own composer). Two payloads, same JSON-over-env-var
          // mechanism as CFAI_MODEL_ROUTER_CONFIG above: the helper owns the
          // comparison code, ai-processes.js owns the data, so a signature is
          // written down exactly once. Deliberately NOT folded into
          // CFAI_AI_PROCESSES — an IDE process name in that list would turn on
          // clipboard/attachment/file-dialog watching across the whole editor.
          CFAI_IDE_PROCESSES: JSON.stringify(buildIdeProcessConfig()),
          CFAI_AI_PANELS: JSON.stringify(buildAiPanelConfig()),
          // Agent surfaces — "which named agent is open inside this app", for
          // agent_scope:'agent' blocked rows. Third payload, same mechanism, and
          // deliberately a THIRD catalog: it neither widens which processes are
          // watched (that stays CFAI_AI_PROCESSES) nor which elements are
          // scanned (that stays CFAI_AI_PANELS). Each entry carries its own
          // enforce/verified pair: m365_copilot is live-verified and arming,
          // every FUTURE surface ships both false until a human runs its own
          // live pass and flips them. See AGENT_SURFACES in ai-processes.js.
          CFAI_AGENT_SURFACES: JSON.stringify(buildAgentSurfaceConfig()),
        },
      }
    );

    // Publish the helper PID for the detached watchdog, which is what kills
    // this process if we are hard-killed before we can.
    writeEnforcerState({ pid: this.child.pid, parentPid: process.pid }).catch((err) => {
      this.log?.warn(`enforcer: could not write pid state — ${err?.message || err}`);
    });

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
      // The recorded PID is dead — drop it so the watchdog can't act on a
      // recycled PID. start() rewrites it on respawn.
      clearEnforcerState().catch(() => {});
      if (!this.stopRequested) setTimeout(() => this.start(), 2000);
    });
  }

  // Liveness signal for the PowerShell deadman. Content is an epoch-ms
  // timestamp — nothing about the user, the prompt, or the machine.
  #beat() {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(ENFORCER_HEARTBEAT_PATH, String(Date.now()), 'utf8');
    } catch (err) {
      this.log?.warn(`enforcer: heartbeat write failed — ${err?.message || err}`);
    }
  }

  #startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.#beat(), HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  #stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Swap in a new block-pattern set (server policy changed).
   *
   * The helper receives its rules once, via CFAI_BLOCK_PATTERNS at spawn time, so
   * there is no way to update a running child. Killing it is the update: the exit
   * handler above respawns after 2s with the new env. `stopRequested` stays false
   * so that restart happens.
   *
   * A no-op when the rules are unchanged — otherwise a policy poll that found
   * nothing new would still drop keystroke protection for a couple of seconds
   * each time.
   */
  updateBlockPatterns(blockPatterns) {
    const next = JSON.stringify(blockPatterns || []);
    if (next === JSON.stringify(this.blockPatterns || [])) return false;

    this.blockPatterns = blockPatterns;
    this.log?.info(`enforcer: block patterns changed (${(blockPatterns || []).length} rules) — restarting helper`);
    if (this.child) {
      try { this.child.kill(); } catch {}
      // Deliberately not clearing this.child here: the 'exit' handler does that
      // and schedules the respawn.
    } else if (!this.stopRequested) {
      this.start();
    }
    return true;
  }

  stop() {
    this.stopRequested = true;
    this.#stopHeartbeat();
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
    // Symmetric cleanup. Removing the heartbeat is also a belt-and-braces kill
    // switch: if the helper somehow survived the kill above, its deadman sees
    // the file missing and unhooks itself within 30s.
    try { unlinkSync(ENFORCER_PID_PATH); } catch {}
    try { unlinkSync(ENFORCER_HEARTBEAT_PATH); } catch {}
  }

  /**
   * Ask the helper to mask-and-rewrite the pending block identified by
   * blockId. This is the ONLY thing ever written to the helper's stdin — no
   * text ever crosses this channel, just an id the helper independently
   * validates against its own pinned pending-block state (single-use, 15s
   * TTL, bound to the exact element/window/text it was computed from). A
   * stale or wrong id is simply ignored by the helper; there is nothing more
   * for a compromised caller to exploit here than that.
   */
  tokenize(blockId) {
    if (!this.child?.stdin || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(JSON.stringify({ cmd: 'tokenize', block_id: blockId }) + '\n');
      return true;
    } catch (err) {
      this.log?.warn(`enforcer: tokenize command failed — ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Arm or release the attachment-send hold — swallows Enter/send-button
   * clicks while a sensitive file attachment is present. Only ever carries a
   * filename and pattern NAMES, never file content or the scan's matched
   * text, same "no content on this channel" rule tokenize() documents above.
   * ttlMs is a safety net on the helper side (see enforcer-win.ps1's
   * CheckAttachHoldExpiry) — the caller is still responsible for calling this
   * again to refresh a hold that should outlive the TTL, or to release it
   * once the file is gone / scanned clean.
   */
  attachHold(state, { filename = '', patterns = '', ttlMs = 3000 } = {}) {
    if (!this.child?.stdin || this.child.stdin.destroyed) return false;
    try {
      this.child.stdin.write(JSON.stringify({ cmd: 'attach_hold', state, filename, patterns, ttl_ms: ttlMs }) + '\n');
      return true;
    } catch (err) {
      this.log?.warn(`enforcer: attach_hold command failed — ${err?.message || err}`);
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
      case 'prompt':
        this.emit('prompt', ev);
        break;
      case 'override':
        this.emit('override', ev);
        break;
      case 'rewrite':
        this.emit('rewrite', ev);
        break;
      case 'route':
        this.emit('route', ev);
        break;
      case 'blockstate':
        // Standing "this whole app is blocked" bar state, for the desktop
        // overlay. Presentation only, and deliberately NOT logged: the block it
        // reflects is already recorded by the 'block' path, and a log line per
        // focus change would be pure noise. The case itself is not optional
        // either — without it every transition would fall into the default
        // "unknown kind" warn, which lands in Electron's plain-text line
        // scraper and pollutes recentAlerts. (Same class of bug this file
        // already hit once for 'route'.)
        this.emit('blockstate', ev);
        break;
      case 'enforcement_disarmed':
        // Panic hotkey (Ctrl+Alt+Shift+F12) — all blocking off for ev.seconds,
        // then it resumes by itself. Worth an audit record: it is a deliberate,
        // user-initiated suspension of enforcement.
        this.log?.warn(`enforcer: DISARMED by panic hotkey for ${ev.seconds ?? '?'}s`);
        this.emit('disarmed', ev);
        break;
      case 'error':
        this.log?.warn('enforcer error: ' + ev.message);
        break;
      default:
        this.log?.warn('enforcer: unknown kind: ' + ev.kind);
    }
  }
}
