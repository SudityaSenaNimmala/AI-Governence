// OS-level AI monitor — universal baseline that works for every AI desktop
// process regardless of install method (Microsoft Store, regular .exe,
// portable, snap, flatpak). Observes from outside the app.
//
// Pipeline:
//   PowerShell poller  →  WinPoller (Node)  →  this orchestrator
//        └─ emits NDJSON: focus / clipboard / heartbeat
//   On a `clipboard` event whose focused process matches our AI catalog,
//   we scan the text with the shared patterns, and:
//     1. enqueue an event for the governance server (Reporter)
//     2. fire a native Windows toast if severity is high/critical (notify)

import { createPoller } from './poller-factory.js';
import { createNotifier } from './notify-factory.js';
import { AI_PROCESSES, identifyAiProcess, isAttachmentWatcherEligible } from './ai-processes.js';
import { scan, lengthBucket, BLOCK_PATTERNS } from './classifier.js';
import { buildFileUploadEvent } from './file-handler.js';
import { FileDialogWatcher } from './file-dialog-watcher.js';
import { AttachmentWatcher } from './attachment-watcher.js';
import { PromptWatcher } from './prompt-watcher.js';
import { Enforcer } from './enforcer.js';
import { Reporter } from './reporter.js';

// How long after firing a toast for a (clipboardSeq, processName) pair we
// suppress re-firing for the same pair. 30s is long enough to prevent focus-
// thrash spam, short enough that returning to an AI surface after a break
// re-warns the user.
const FIRE_DEDUP_TTL_MS = 30_000;

// Clipboard scrubbing was removed on 2026-06-15: the clipboard path now fires
// on the actual paste gesture, so the content is already in the app and
// overwriting the clipboard would only corrupt the user's next paste — and the
// standing preference is that the OS monitor must never overwrite the
// clipboard. The OS monitor is detect + notify + report only; real blocking is
// owned by the browser extension (web apps) and the proxy (API/CLI traffic).

export class OsMonitor {
  constructor({ serverUrl, token, log }) {
    this.log = log;
    this.poller = createPoller({ log });
    this.reporter = new Reporter({ serverUrl, token, log });
    this.toast = createNotifier({ log });
    // Extract bare process names (without regex) for the UIA watcher.
    const aiProcNames = AI_PROCESSES.map((e) =>
      e.match.source.replace(/^\^/, '').replace(/\$$/, '').replace(/[\\\/]i?$/, '')
    );
    this.dialogWatcher = new FileDialogWatcher({ log, aiProcessNames: aiProcNames });
    this.attachmentWatcher = new AttachmentWatcher({ log, aiProcessNames: aiProcNames });
    this.promptWatcher = new PromptWatcher({ log, aiProcessNames: aiProcNames });
    // Keystroke send-blocker — actually prevents the send (swallows Enter /
    // Ctrl+V) when the focused AI prompt or clipboard holds a blocked pattern.
    this.enforcer = new Enforcer({ log, aiProcessNames: aiProcNames, blockPatterns: BLOCK_PATTERNS });
    this.currentFocus = null;  // { pid, process, title, aiInfo? }
    // Map<"seq|process", lastFiredAtMs> — used to suppress duplicate fires
    // when the user pastes the same clipboard contents repeatedly into the
    // same AI surface. Pruned periodically to bound memory.
    this.firedAt = new Map();
    setInterval(() => this.#pruneFired(), 60_000).unref();
  }

  #pruneFired() {
    const cutoff = Date.now() - 2 * FIRE_DEDUP_TTL_MS;
    for (const [key, ts] of this.firedAt) {
      if (ts < cutoff) this.firedAt.delete(key);
    }
  }

  // Shared one-shot gate. Returns true at most once per key per TTL. Used by
  // BOTH the clipboard-paste and typed-prompt paths so a single paste (which
  // the clipboard watcher AND the UIA prompt watcher both observe) only fires
  // one notification. Key is process + matched-pattern signature.
  #shouldFire(key) {
    const lastFired = this.firedAt.get(key) ?? 0;
    if (Date.now() - lastFired < FIRE_DEDUP_TTL_MS) return false;
    this.firedAt.set(key, Date.now());
    return true;
  }

  start() {
    // Universal coverage: clipboard text + foreground + notifications work on
    // Windows, macOS, and Linux. The two UIA-based watchers (file dialog +
    // attachment chip) are Windows-only enhancements and silently no-op on
    // other platforms — clipboard pasting still gets full DLP coverage.
    if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') {
      this.log?.warn(`os_monitor: unsupported platform ${process.platform} — monitor inert`);
      return;
    }

    this.reporter.start();
    this.toast.start();

    this.poller.on('focus', (ev) => {
      const ai = identifyAiProcess(ev.process);
      this.currentFocus = { pid: ev.pid, process: ev.process, title: ev.title, aiInfo: ai };
      if (ai) {
        this.log?.info(`os_monitor: AI process focused — ${ai.product} (pid=${ev.pid}, title="${ev.title}")`);
      }
    });

    this.poller.on('clipboard', (ev) => {
      // The poller emits clipboard events only when *some* process is focused;
      // we filter to AI processes here so non-AI activity is ignored.
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;

      const { matches, highestSeverity } = scan(ev.text);
      if (matches.length === 0) {
        // No sensitive content detected — record nothing. (Same policy as
        // browser extension: we don't log innocuous prompts.)
        return;
      }

      // Dedup on (AI process, matched-pattern signature) within the TTL. This
      // is shared with the typed-prompt path so a single paste — which the
      // clipboard watcher AND the UIA prompt watcher both see — only fires one
      // notification. (The poller now emits this event only on an actual paste
      // gesture into the focused window, not on a mere copy.)
      const sig = matches.map((m) => m.pattern).sort().join(',');
      if (!this.#shouldFire(`${ev.process}|${sig}`)) {
        this.log?.info(`os_monitor: suppressed duplicate fire for ${ai.product} (cause=${ev.cause})`);
        return;
      }

      const reportEvent = {
        kind: 'prompt_paste',
        service: ai.product,
        vendor: ai.vendor,
        process_name: ev.process,
        window_title: ev.title,
        content_length: ev.len,
        length_bucket: lengthBucket(ev.len),
        matches,
        highest_severity: highestSeverity,
        cause: ev.cause,  // 'seq_change' = fresh copy; 'focus_change' = re-entered AI surface
        // Full clipboard text for inline dashboard preview. Server caps at 25 MB.
        content_text: ev.text,
      };
      this.reporter.enqueue(reportEvent);
      this.log?.info(
        `os_monitor: ${ev.cause === 'focus_change' ? 'focus into' : 'paste into'} ${ai.product} — ` +
        `${matches.length} pattern(s), severity=${highestSeverity} ` +
        `[${matches.map((m) => m.pattern).join(', ')}]`
      );

      // Native toast for the user (severity gate matches browser+hook layers).
      // Uses the persistent helper — sub-100ms from paste to toast in steady state.
      //
      // We deliberately do NOT scrub the clipboard: the event now fires on the
      // actual paste, so the content is already in the app and overwriting the
      // clipboard would only corrupt the user's clipboard for their next paste
      // elsewhere (and the standing preference is that the OS monitor must
      // never overwrite the clipboard). Detection + notification + reporting
      // only on this path.
      if (highestSeverity === 'critical' || highestSeverity === 'high') {
        const patterns = matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ');
        this.toast.show({
          title: `${ai.product} - ${highestSeverity.toUpperCase()}`,
          message: `Sensitive content pasted into ${ai.product}: ${patterns}\nReported to CloudFuze AI Governance.`,
        });
      }
    });

    this.poller.on('clipboard_files', async (ev) => {
      // User copied one or more files in Explorer (CF_HDROP) and is focused
      // on an AI window — typical pre-upload step for ChatGPT Store, Claude
      // Desktop, etc. Classify each file, content-scan text-readable ones,
      // emit one file_upload event per path.
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;

      for (const p of (ev.paths || [])) {
        try {
          const fileEvent = await buildFileUploadEvent({
            path: p,
            via: 'clipboard_file_copy',
            service: ai.product,
            vendor: ai.vendor,
            processName: ev.process,
            windowTitle: ev.title,
            log: this.log,
          });
          if (!fileEvent) continue;

          // Dedup: same file path + same AI process within TTL. Path is a
          // good identity for files (filename collisions in different dirs
          // are still distinct, content-hashing is overkill here).
          const dedupKey = `file|${p}|${ev.process}`;
          const lastFired = this.firedAt.get(dedupKey) ?? 0;
          if (Date.now() - lastFired < FIRE_DEDUP_TTL_MS) {
            this.log?.info(
              `os_monitor: suppressed duplicate file fire for ${ai.product} (${fileEvent.filename})`
            );
            continue;
          }
          this.firedAt.set(dedupKey, Date.now());

          this.reporter.enqueue(fileEvent);

          const cs = fileEvent.content_scan;
          const matchCount = cs?.matchCount || 0;
          this.log?.info(
            `os_monitor: file copy → ${ai.product} — ${fileEvent.filename} ` +
            `[${fileEvent.file_class}, severity=${fileEvent.severity}` +
            `${cs?.scanned ? `, scanned, ${matchCount} match(es)` : ''}]`
          );

          // Toast policy mirrors browser extension: fire on content matches
          // OR risky filename heuristic (env/key/credentials/etc.).
          const hasContentMatches = matchCount > 0;
          const risky = fileEvent.severity === 'high' || fileEvent.severity === 'critical';
          if (hasContentMatches || risky) {
            const patternList = hasContentMatches
              ? cs.matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ')
              : fileEvent.file_class;
            this.toast.show({
              title: `${ai.product} - ${fileEvent.severity.toUpperCase()} file`,
              message: `${fileEvent.filename}\n${hasContentMatches ? 'Contains: ' + patternList : 'File class: ' + patternList}\nReported to CloudFuze AI Governance.`,
            });
          }
        } catch (err) {
          this.log?.warn(`os_monitor: file event build failed for ${p}: ${err?.message || err}`);
        }
      }
    });

    this.poller.on('poller-error', () => { /* logged by poller itself */ });

    // UIA-based file dialog watcher — covers the "click attach button in
    // ChatGPT → pick file → Open" flow that CF_HDROP doesn't see.
    this.dialogWatcher.on('file_dialog_pick', async (ev) => {
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;
      try {
        const fileEvent = await buildFileUploadEvent({
          path: ev.path,
          via: 'open_file_dialog',
          service: ai.product,
          vendor: ai.vendor,
          processName: ev.process,
          windowTitle: ev.title,
          log: this.log,
        });
        if (!fileEvent) return;

        const dedupKey = `file|${ev.path}|${ev.process}`;
        const lastFired = this.firedAt.get(dedupKey) ?? 0;
        if (Date.now() - lastFired < FIRE_DEDUP_TTL_MS) {
          this.log?.info(`os_monitor: suppressed duplicate file_dialog_pick (${fileEvent.filename})`);
          return;
        }
        this.firedAt.set(dedupKey, Date.now());

        this.reporter.enqueue(fileEvent);
        const cs = fileEvent.content_scan;
        const matchCount = cs?.matchCount || 0;
        this.log?.info(
          `os_monitor: file picker → ${ai.product} — ${fileEvent.filename} ` +
          `[${fileEvent.file_class}, severity=${fileEvent.severity}` +
          `${cs?.scanned ? `, scanned, ${matchCount} match(es)` : ''}]`
        );

        const hasContentMatches = matchCount > 0;
        const risky = fileEvent.severity === 'high' || fileEvent.severity === 'critical';
        if (hasContentMatches || risky) {
          const patternList = hasContentMatches
            ? cs.matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ')
            : fileEvent.file_class;
          this.toast.show({
            title: `${ai.product} - ${fileEvent.severity.toUpperCase()} file`,
            message: `${fileEvent.filename}\n${hasContentMatches ? 'Contains: ' + patternList : 'File class: ' + patternList}\nReported to CloudFuze AI Governance.`,
          });
        }
      } catch (err) {
        this.log?.warn(`os_monitor: file_dialog_pick build failed: ${err?.message || err}`);
      }
    });

    // UIA attachment-chip watcher — catches drag-drop into AI windows
    // (the case where the user dragged a file from Explorer onto the
    // AI window — no clipboard write, no file dialog).
    this.attachmentWatcher.on('attachment_appeared', async (ev) => {
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;

      // Skip IDE-like AI apps (Cursor, GitHub Copilot, Claude Desktop) whose
      // UI exposes filenames continuously — tab strips, file trees, etc.
      // For those apps the asar-injected desktop hook handles actual uploads
      // at the DOM level. The OS-level watcher would just generate false
      // positives for every file the user happens to be editing.
      if (!isAttachmentWatcherEligible(ev.process)) {
        return;
      }

      if (!ev.path) {
        // Filename was visible but we couldn't resolve it to a file on disk.
        // Could be a remote URL, a recent-history label, or a path outside
        // our search dirs. Skip — nothing to scan.
        this.log?.info(`attachment-watcher: filename "${ev.filename}" appeared in ${ai.product} but not found on disk`);
        return;
      }
      try {
        const fileEvent = await buildFileUploadEvent({
          path: ev.path,
          via: 'drag_drop_or_chip',
          service: ai.product,
          vendor: ai.vendor,
          processName: ev.process,
          windowTitle: '',
          log: this.log,
        });
        if (!fileEvent) return;
        const dedupKey = `file|${ev.path}|${ev.process}`;
        const lastFired = this.firedAt.get(dedupKey) ?? 0;
        if (Date.now() - lastFired < FIRE_DEDUP_TTL_MS) {
          this.log?.info(`os_monitor: suppressed duplicate attachment fire (${fileEvent.filename})`);
          return;
        }
        this.firedAt.set(dedupKey, Date.now());
        this.reporter.enqueue(fileEvent);
        const cs = fileEvent.content_scan;
        const matchCount = cs?.matchCount || 0;
        this.log?.info(
          `os_monitor: attachment chip → ${ai.product} — ${fileEvent.filename} ` +
          `[${fileEvent.file_class}, severity=${fileEvent.severity}` +
          `${cs?.scanned ? `, scanned via ${cs.via}, ${matchCount} match(es)` : ''}]`
        );
        const hasContentMatches = matchCount > 0;
        const risky = fileEvent.severity === 'high' || fileEvent.severity === 'critical';
        if (hasContentMatches || risky) {
          const patternList = hasContentMatches
            ? cs.matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ')
            : fileEvent.file_class;
          this.toast.show({
            title: `${ai.product} - ${fileEvent.severity.toUpperCase()} file`,
            message: `${fileEvent.filename}\n${hasContentMatches ? 'Contains: ' + patternList : 'File class: ' + patternList}\nReported to CloudFuze AI Governance.`,
          });
        }
      } catch (err) {
        this.log?.warn(`os_monitor: attachment event build failed: ${err?.message || err}`);
      }
    });

    // UIA typed-prompt watcher — reads what the user TYPES into an AI app's
    // prompt box (Claude Desktop, ChatGPT Desktop, etc.) and scans it. This is
    // the only coverage for typed (not pasted) secrets in vendor-sealed apps:
    // they pin TLS (proxy blind) and enforce ASAR integrity (no DOM hook).
    // Detect + notify + report only — UIA can't block another app's send.
    this.promptWatcher.on('prompt_text', (ev) => {
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;

      const { matches, highestSeverity } = scan(ev.text);
      if (matches.length === 0) return;  // only record sensitive prompts

      // Dedup on the SET of matched patterns (not the full text): as the user
      // keeps typing, the text changes every poll but the secret is the same,
      // so we'd otherwise re-fire constantly. Re-warn only when a new pattern
      // appears or after the TTL lapses. Shares the gate with the clipboard
      // path so a paste isn't reported twice (once as paste, once as typed).
      const sig = matches.map((m) => m.pattern).sort().join(',');
      if (!this.#shouldFire(`${ev.process}|${sig}`)) return;

      this.reporter.enqueue({
        kind: 'prompt_typed',
        source: 'os_monitor_uia',
        service: ai.product,
        vendor: ai.vendor,
        process_name: ev.process,
        window_title: ev.title,
        content_length: ev.len,
        length_bucket: lengthBucket(ev.len),
        matches,
        highest_severity: highestSeverity,
        content_text: ev.text,
      });
      this.log?.info(
        `os_monitor: typed into ${ai.product} — ${matches.length} pattern(s), ` +
        `severity=${highestSeverity} [${matches.map((m) => m.pattern).join(', ')}]`
      );

      if (highestSeverity === 'critical' || highestSeverity === 'high') {
        const patterns = matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ');
        this.toast.show({
          title: `${ai.product} - ${highestSeverity.toUpperCase()}`,
          message: `Sensitive content typed into the prompt: ${patterns}\nReported to CloudFuze AI Governance.`,
        });
      }
    });

    // Enforcer — the only real block for sealed desktop apps. When it swallows
    // a send/paste it emits a block event; we report it and toast the user.
    // Distinct dedup namespace ('enf|…') so the block notice always shows at
    // the moment of the block, independent of the detection toast.
    this.enforcer.on('block', (ev) => {
      const ai = identifyAiProcess(ev.process) || { product: ev.process, vendor: null };
      const patterns = (ev.patterns || '').split(',').filter(Boolean);
      const matches = patterns.map((p) => ({ pattern: p, severity: 'high', count: 1 }));
      // reason: 'send' (Enter) | 'paste' (Ctrl+V) | 'click' (send button).
      const reason = ev.reason === 'paste' ? 'prompt_paste' : 'prompt_submit';
      const how = ev.reason === 'paste' ? 'paste' : ev.reason === 'click' ? 'send-button click' : 'send';
      this.reporter.enqueue({
        kind: 'enforcement_block',
        blocked_for: reason,
        mechanism: 'keystroke_block',
        source: 'os_monitor_enforcer',
        service: ai.product,
        vendor: ai.vendor,
        process_name: ev.process,
        matches,
        highest_severity: 'high',
      });
      this.log?.info(`os_monitor: BLOCKED ${how} into ${ai.product} — [${ev.patterns}]`);
      if (this.#shouldFire(`enf|${ev.process}|${ev.patterns}`)) {
        this.toast.show({
          title: `${ai.product} - BLOCKED`,
          message: `Send blocked: prompt contains ${ev.patterns}\n` +
            `Remove the sensitive data to send. Override (logged): Ctrl+Alt+Enter.`,
        });
      }
    });

    this.enforcer.on('override', (ev) => {
      const ai = identifyAiProcess(ev.process) || { product: ev.process, vendor: null };
      this.reporter.enqueue({
        kind: 'enforcement_override',
        blocked_for: 'prompt_submit',
        mechanism: 'keystroke_block',
        source: 'os_monitor_enforcer',
        service: ai.product,
        vendor: ai.vendor,
        process_name: ev.process,
        matches: (ev.patterns || '').split(',').filter(Boolean).map((p) => ({ pattern: p, severity: 'high', count: 1 })),
        highest_severity: 'high',
      });
      this.log?.info(`os_monitor: OVERRIDE send into ${ai.product} — [${ev.patterns}]`);
    });

    this.poller.start();
    this.dialogWatcher.start();
    this.attachmentWatcher.start();
    this.promptWatcher.start();
    this.enforcer.start();

    if (process.platform === 'win32') {
      this.log?.info('os_monitor: started (clipboard text + files + dialogs + drag-drop chips + typed prompts + keystroke send-blocker)');
    } else {
      this.log?.info(
        `os_monitor: started on ${process.platform} ` +
        '(clipboard text + files + foreground; UIA file-dialog & drag-drop watchers are Windows-only — clipboard paste path still fully covered)'
      );
    }
  }

  stop() {
    this.poller.stop();
    this.dialogWatcher.stop();
    this.attachmentWatcher.stop();
    this.promptWatcher.stop();
    this.enforcer.stop();
    this.reporter.stop();
    this.toast.stop();
  }
}
