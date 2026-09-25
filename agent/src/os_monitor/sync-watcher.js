// Wraps sync-watcher.ps1 — a long-running PowerShell process that watches the
// OneDrive / SharePoint sync roots with .NET FileSystemWatcher and reports files
// that appear to be going UP.
//
// OBSERVE AND REPORT ONLY. Neither this file nor the helper moves, renames,
// quarantines or otherwise touches a file. That is a confirmed product decision,
// not an unfinished piece — see the header of sync-watcher.ps1.
//
// ── THE POLICY GATE LIVES HERE ──────────────────────────────────────────────
//
// start() resolves the roots and REFUSES TO SPAWN when there are none, so on a
// machine whose admin governs no cloud-sync host there is no PowerShell process,
// no FileSystemWatcher, no directory handle and no stat of the user's Documents
// folder. `armedRoots` is what decides that, and the caller sets it from
// egress-surfaces.json (which the sync layer writes only for a governed
// ai_platforms row). Verified behaviourally in
// agent/tests/os-monitor-egress.test.mjs.
//
// Modelled on AttachmentWatcher's spawn / 2s-backoff respawn / heartbeat /
// NDJSON pattern, including the onRespawn hook — the helper's whole
// configuration lives in its env, so a respawn that came up with a stale root
// set would watch the wrong thing silently. The owner re-states the current
// policy from there.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { helperScript } from './helper-path.js';
import { EventEmitter } from 'node:events';
import { getUserPaths } from '../util/paths.js';

// Resolved through helperScript() rather than import.meta.url, for the reason
// spelled out in helper-path.js: import.meta has no meaning in the CommonJS
// bundle the packaged binary is built from.
const WATCHER_SCRIPT = helperScript('sync-watcher.ps1');

// The subfolders of a OneDrive root that are worth watching, and NOTHING else.
//
// The root itself is deliberately not watched wholesale: an enterprise OneDrive
// root also holds "Microsoft Teams Chat Files", "Attachments", per-app state and
// (with Known Folder Move on) the Pictures library — high-churn locations that
// are not where somebody puts a document they are working on. Watching the two
// folders a person actually saves work into keeps the notification volume, and
// therefore the FileSystemWatcher overflow risk, proportionate.
//
// Absent folders are skipped rather than created: this feature never writes to
// the filesystem, including creating a directory.
const SYNC_SUBFOLDERS = ['Documents', 'Desktop'];

/**
 * Every OneDrive / SharePoint sync directory worth watching on this machine.
 *
 * REUSES agent/src/util/paths.js's existing OneDrive resolution rather than
 * re-deriving it: that function already handles the three env vars a real
 * install can present it with (OneDriveCommercial for M365, OneDrive, and
 * OneDriveConsumer) and already knows that with Known Folder Move enabled
 * Desktop/Documents live UNDER the OneDrive root instead of under
 * %USERPROFILE%. Re-implementing any of that here would be a second answer to a
 * question that already has one.
 *
 * Read-only: paths.js does no I/O of its own, and the only filesystem call here
 * is the existence check.
 */
export function discoverSyncRoots(platform = process.platform) {
  if (platform !== 'win32') return [];
  let paths;
  try { paths = getUserPaths(platform); }
  catch { return []; }
  const root = paths?.oneDriveRoot;
  if (!root) return [];
  const out = [];
  for (const sub of SYNC_SUBFOLDERS) {
    const dir = join(root, sub);
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) out.push(dir);
    } catch { /* unreadable — skip it rather than hand the helper a bad path */ }
  }
  // The root itself only when neither known folder exists, so a plain consumer
  // OneDrive with files at the top level is still covered.
  if (out.length === 0) {
    try { if (existsSync(root) && statSync(root).isDirectory()) out.push(root); }
    catch { /* nothing to watch */ }
  }
  return out;
}

export class SyncWatcher extends EventEmitter {
  /**
   * `armedRoots` is the POLICY answer, supplied by the owner: the `sync_roots`
   * entries from ~/.cloudfuze-aigov/egress-surfaces.json. An empty array (the
   * state of every machine whose admin governs no cloud-sync host) means this
   * watcher never spawns anything.
   *
   * `onRespawn` is called after every (re)start, including the automatic one
   * after a crash — same contract, and same reason, as AttachmentWatcher's: the
   * helper's configuration lives in the env of the process that just died, so
   * the owner re-states the current policy from here.
   */
  constructor({ log, armedRoots = [], onRespawn = null }) {
    super();
    this.log = log;
    this.armedRoots = Array.isArray(armedRoots) ? armedRoots : [];
    this.onRespawn = onRespawn;
    this.child = null;
    this.buffer = '';
    this.stopRequested = false;
    // Has the helper's POLL LOOP ever reported in? `ready` only proves the
    // process started — see AttachmentWatcher's copy of this note and the
    // wedged-on-a-blocking-read history behind it.
    this.sawHeartbeat = false;
  }

  /**
   * Replace the armed policy. Restarts the helper only when the effective root
   * set actually changed, because the helper's configuration is its env and
   * there is no way to update a running child — killing it IS the update, and
   * tearing down a healthy FileSystemWatcher every 10s poll would open a real
   * gap for no reason.
   */
  setArmedRoots(armedRoots) {
    const next = Array.isArray(armedRoots) ? armedRoots : [];
    const before = JSON.stringify(this.armedRoots.map((r) => r?.id || r).sort());
    const after = JSON.stringify(next.map((r) => r?.id || r).sort());
    this.armedRoots = next;
    if (before === after) return false;
    if (next.length === 0) {
      // Policy withdrawn. Stop watching immediately rather than at some later
      // restart: an admin turning the policy off is an instruction to stop
      // observing the user's files now.
      this.log?.info('sync-watcher: cloud-sync policy withdrawn — stopping the sync-root watcher');
      const wasStopped = this.stopRequested;
      this.stop();
      this.stopRequested = wasStopped;   // stop() is a policy stop, not a shutdown
      return true;
    }
    this.log?.info(`sync-watcher: cloud-sync policy changed (${next.length} armed root(s)) — restarting the helper`);
    if (this.child) {
      try { this.child.kill(); } catch {}
      // The exit handler clears this.child and schedules the respawn, which
      // picks up the new roots from start().
    } else if (!this.stopRequested) {
      this.start();
    }
    return true;
  }

  start() {
    if (process.platform !== 'win32') return;   // FileSystemWatcher + the helper are Windows-only
    if (this.child) return;
    // THE GATE. No governed cloud-sync policy means no process, so nothing about
    // the user's synced folders is observed at all.
    if (this.armedRoots.length === 0) {
      this.log?.info('sync-watcher: no governed cloud-sync policy — sync-root watching stays OFF');
      return;
    }
    const roots = discoverSyncRoots();
    if (roots.length === 0) {
      // A governed policy but no OneDrive on this machine. Nothing to watch, and
      // saying so beats spawning a helper that would sit idle forever.
      this.log?.info('sync-watcher: no OneDrive/SharePoint sync root found on this machine — nothing to watch');
      return;
    }

    this.sawHeartbeat = false;
    // Ids and counts only. The root PATHS are not logged: under Known Folder
    // Move a OneDrive root path carries the tenant name and the user's own
    // display name.
    this.log?.info(`sync-watcher: starting sync-root watcher (${roots.length} root(s), policy=${this.armedRoots.map((r) => r?.id || r).join(',')})`);
    this.child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WATCHER_SCRIPT],
      {
        windowsHide: true,
        // stdin 'ignore': this watcher accepts NO commands. Its whole
        // configuration is the env below and it is restarted, never
        // reconfigured — so there is no channel for anything to be told to it.
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CFAI_SYNC_ROOTS: roots.join(';'),
          CFAI_SYNC_ROOT_ID: String(this.armedRoots[0]?.id || 'onedrive_sharepoint'),
        },
      },
    );

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      const s = String(chunk).trim();
      if (s) this.log?.warn('sync-watcher stderr: ' + s.slice(0, 200));
    });
    this.child.on('exit', (code, signal) => {
      this.log?.warn(`sync-watcher: exited code=${code} signal=${signal}`);
      this.child = null;
      if (!this.stopRequested) setTimeout(() => this.start(), 2000);
    });
    // AFTER the child exists, matching AttachmentWatcher. The fresh helper is
    // configured from whatever start() just read, so the owner's hook is its
    // chance to correct that if the policy moved in between.
    try { this.onRespawn?.(this); } catch (err) {
      this.log?.warn(`sync-watcher: re-arm hook failed — ${err?.message || err}`);
    }
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
      catch { this.log?.warn('sync-watcher: non-JSON: ' + line.slice(0, 120)); continue; }
      this.#dispatch(ev);
    }
  }

  #dispatch(ev) {
    switch (ev.kind) {
      case 'ready':
        this.log?.info(
          `sync-watcher: ready (pid=${ev.pid}, ${ev.roots ?? '?'} root(s) watched`
          // ext_gate:false means the extension gate could not be single-sourced
          // from attachment-watcher.ps1, so the helper will report NOTHING. A
          // visible warning rather than silent zero coverage.
          + `${ev.ext_gate === false ? ', EXTENSION GATE UNAVAILABLE — nothing will be reported' : ''})`,
        );
        break;
      case 'sync_file':
        this.emit('sync_file', ev);
        break;
      case 'overflow':
        // A COVERAGE GAP, deliberately loud. The OS dropped notifications (or
        // our own per-minute ceiling did), so files really did go up unobserved
        // in that window. Emitted as an event as well as logged so the owner can
        // record it rather than leaving it in a log nobody reads.
        this.log?.warn(`sync-watcher: COVERAGE GAP — notifications dropped for ${ev.root_id || 'a sync root'} (${ev.reason || 'unknown'})`);
        this.emit('overflow', ev);
        break;
      case 'heartbeat':
        if (!this.sawHeartbeat) {
          this.sawHeartbeat = true;
          this.log?.info('sync-watcher: poll loop live');
        }
        break;
      case 'error':
        this.log?.warn('sync-watcher error: ' + ev.message);
        break;
      default:
        this.log?.warn('sync-watcher: unknown kind: ' + ev.kind);
    }
  }
}
