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
import { AI_PROCESSES, identifyAiProcess, isAttachmentWatcherEligible, hostForProcess, hostsForPlatform } from './ai-processes.js';
import { scan, lengthBucket, BLOCK_PATTERNS, getBlockPatterns, isTextReadable, isBinaryParseable, isImage, isArchive } from './classifier.js';
import { PolicySync } from './policy-sync.js';
import { buildFileUploadEvent } from './file-handler.js';
import { FileDialogWatcher } from './file-dialog-watcher.js';
import { AttachmentWatcher } from './attachment-watcher.js';
import { PromptWatcher } from './prompt-watcher.js';
import { Enforcer } from './enforcer.js';
import { spawnEnforcerWatchdog } from './enforcer-watchdog.js';
import { Reporter } from './reporter.js';

// How long after firing a toast for a (clipboardSeq, processName) pair we
// suppress re-firing for the same pair. 10s prevents rapid-fire spam while
// still re-warning on repeated paste attempts.
const FIRE_DEDUP_TTL_MS = 10_000;

// Clipboard scrubbing was removed on 2026-06-15: the clipboard path now fires
// on the actual paste gesture, so the content is already in the app and
// overwriting the clipboard would only corrupt the user's next paste — and the
// standing preference is that the OS monitor must never overwrite the
// clipboard. The OS monitor is detect + notify + report only; real blocking is
// owned by the browser extension (web apps) and the proxy (API/CLI traffic).

export class OsMonitor {
  // `enforcerEnabled` is the desktop app's "Keystroke enforcer" setting,
  // plumbed through from Electron. False turns OFF only the active
  // keystroke-blocking piece — every passive DLP watcher (clipboard, file
  // dialogs, attachments, typed prompts) keeps running.
  constructor({ serverUrl, token, log, enforcerEnabled = true }) {
    this.log = log;
    this.enforcerEnabled = enforcerEnabled !== false;
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
    this.enforcer = new Enforcer({
      log,
      aiProcessNames: aiProcNames,
      blockPatterns: getBlockPatterns(),
      enabled: this.enforcerEnabled,
    });
    // Detached sibling that releases the keyboard hook if THIS process is
    // hard-killed. Handle kept so shutdown can reap it.
    this.enforcerWatchdog = null;
    // Keeps desktop detection aligned with deployed compliance policy packs. When
    // the policy changes we must push the new rule set to the keystroke blocker
    // too — otherwise a pattern could be reported as critical while the blocker
    // still ignores it, which looks like enforcement without being it.
    this.policySync = new PolicySync({
      serverUrl,
      log,
      onChange: ({ blockPatterns }) => {
        // updateBlockPatterns restarts the helper; skip entirely when the
        // enforcer is off so a policy poll can't start a hook the user
        // disabled. (Enforcer.start() also refuses — this is the outer gate.)
        if (!this.enforcerEnabled) return;
        this.enforcer.updateBlockPatterns(blockPatterns);
      },
    });
    this.currentFocus = null;  // { pid, process, title, aiInfo? }
    // Map<"seq|process", lastFiredAtMs> — used to suppress duplicate fires
    // when the user pastes the same clipboard contents repeatedly into the
    // same AI surface. Pruned periodically to bound memory.
    this.firedAt = new Map();
    // Filename currently held (Enter/send-click swallowed) by the
    // attachment-hold mechanism, or null. Single-slot by design for v1 — see
    // the attachment_appeared handler's comments for the provisional/
    // confirmed two-stage story; "more than one flagged attachment at once"
    // is a known simplification, not yet handled per-file.
    this.attachHoldFilename = null;
    // Keeps a CONFIRMED attach hold alive past its own TTL for as long as the
    // flagged file stays attached. attachment_appeared only fires once, on
    // first appearance — it does NOT keep firing while a chip just sits
    // there unchanged, so without an active refresh the hold silently
    // expires (60s) even though the sensitive file never left the composer,
    // and a send that should still be blocked goes through with no warning
    // at all. Confirmed live: exactly this happened when enough real time
    // passed between attaching a file and testing it (talking, reviewing a
    // separate change) with the file never removed and re-attached.
    this.attachHoldRefreshTimer = null;
    setInterval(() => this.#pruneFired(), 60_000).unref();
  }

  #pruneFired() {
    const cutoff = Date.now() - 2 * FIRE_DEDUP_TTL_MS;
    for (const [key, ts] of this.firedAt) {
      if (ts < cutoff) this.firedAt.delete(key);
    }
  }

  // Re-sends attach_hold('on', ...) on an interval well inside the C# side's
  // TTL, so a still-attached flagged file's hold never lapses on its own.
  // One timer at a time (single-slot hold, matching attachHoldFilename) —
  // starting a new one always clears whatever was running before.
  #startAttachHoldRefresh(filename, patterns, ttlMs) {
    this.#stopAttachHoldRefresh();
    this.attachHoldRefreshTimer = setInterval(() => {
      if (this.attachHoldFilename !== filename) { this.#stopAttachHoldRefresh(); return; }
      this.enforcer.attachHold('on', { filename, patterns, ttlMs });
    }, Math.max(5000, ttlMs / 3));
    this.attachHoldRefreshTimer.unref?.();
  }

  #stopAttachHoldRefresh() {
    if (this.attachHoldRefreshTimer) {
      clearInterval(this.attachHoldRefreshTimer);
      this.attachHoldRefreshTimer = null;
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
    this.policySync.start();

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
        // our search dirs. Skip — nothing to scan, and arming a hold on a
        // file we can't scan would be an unexplained permanent block, worse
        // than the miss.
        this.log?.info(`attachment-watcher: filename "${ev.filename}" appeared in ${ai.product} but not found on disk`);
        return;
      }

      // PROVISIONAL hold — armed BEFORE the scan below even starts, for any
      // extension the classifier can actually scan. This is what wins the
      // race against a fast Enter: the keystroke hook checks the hold flag
      // at keypress time, so arming it now (µs) beats a slow PDF/OCR
      // extraction (up to several seconds) that hasn't returned yet. A
      // 3s TTL on the helper side means a crash here never leaves Enter
      // permanently dead — see enforcer-win.ps1's CheckAttachHoldExpiry.
      // Not armed for unscannable extensions (media, unknown types) — same
      // "don't block what we can't explain" reasoning as the !ev.path case.
      const scannable = isTextReadable(ev.filename) || isBinaryParseable(ev.filename) || isImage(ev.filename) || isArchive(ev.filename);
      if (scannable) {
        this.attachHoldFilename = ev.filename;
        this.enforcer.attachHold('on', { filename: ev.filename, patterns: '', ttlMs: 3000 });
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
        if (!fileEvent) {
          if (scannable && this.attachHoldFilename === ev.filename) {
            this.attachHoldFilename = null;
            this.#stopAttachHoldRefresh();
            this.enforcer.attachHold('off', { filename: ev.filename });
          }
          return;
        }

        // CONFIRMED hold — only high/critical, matching the browser
        // extension's existing file-upload block threshold. A longer TTL
        // than the provisional one, and — unlike the provisional hold —
        // actively kept alive by #startAttachHoldRefresh for as long as the
        // attachment stays present, since this is a real finding that must
        // survive until the file actually disappears, not expire on its own.
        const cs = fileEvent.content_scan;
        const severity = fileEvent.severity;
        const shouldHold = severity === 'high' || severity === 'critical';
        if (shouldHold) {
          const patternNames = (cs?.matches || []).map((m) => m.pattern).join(',') || fileEvent.file_class;
          this.attachHoldFilename = ev.filename;
          const ttlMs = 60_000;
          this.enforcer.attachHold('on', { filename: ev.filename, patterns: patternNames, ttlMs });
          this.#startAttachHoldRefresh(ev.filename, patternNames, ttlMs);
        } else if (this.attachHoldFilename === ev.filename) {
          // Scan came back clean (or below the hold threshold) — release the
          // provisional hold armed above rather than letting it ride out its
          // TTL with the send needlessly stuck for up to 3 more seconds.
          this.attachHoldFilename = null;
          this.#stopAttachHoldRefresh();
          this.enforcer.attachHold('off', { filename: ev.filename });
        }
        const dedupKey = `file|${ev.path}|${ev.process}`;
        const lastFired = this.firedAt.get(dedupKey) ?? 0;
        if (Date.now() - lastFired < FIRE_DEDUP_TTL_MS) {
          this.log?.info(`os_monitor: suppressed duplicate attachment fire (${fileEvent.filename})`);
          return;
        }
        this.firedAt.set(dedupKey, Date.now());
        this.reporter.enqueue(fileEvent);
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

    // Release a hold when the flagged chip itself disappears (removed by the
    // user, or — a known limitation, see attachment-watcher.ps1's own
    // comment — scrolled out of the UIA tree in a long chat). Best-effort:
    // if this fires wrongly for a still-present file, the next
    // attachment_appeared poll tick will just re-observe it and re-arm.
    // Guarded on filename match so an unrelated file's disappearance can't
    // release a hold armed for a DIFFERENT, still-present flagged file.
    this.attachmentWatcher.on('attachment_disappeared', (ev) => {
      if (this.attachHoldFilename !== ev.filename) return;
      this.attachHoldFilename = null;
      this.#stopAttachHoldRefresh();
      this.enforcer.attachHold('off', { filename: ev.filename });
      this.log?.info(`os_monitor: attachment "${ev.filename}" removed — send hold released`);
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

    // Benign Enter-sends the enforcer lets through — captured from the SAME
    // reconstructed keystroke buffer the blocker uses (length only, no content).
    // This is what gives per-user prompt counts + token estimates for sealed
    // desktop apps like Claude Desktop, where UIA can't read the composer and
    // the DOM hook / proxy are both blocked. Sensitive sends never reach here —
    // they go through the 'block' path below — so there's no double counting.
    this.enforcer.on('prompt', (ev) => {
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;
      const len = Number(ev.len) || 0;
      if (len < 1) return;
      this.reporter.enqueue({
        kind: 'prompt_submit',
        source: 'os_monitor_enforcer',
        service: ai.product,
        vendor: ai.vendor,
        process_name: ev.process,
        content_length: len,
        length_bucket: lengthBucket(len),
      });
      this.log?.info(`os_monitor: prompt sent into ${ai.product} (${len} chars)`);
    });

    // Enforcer — the only real block for sealed desktop apps. When it swallows
    // a send/paste it emits a block event; we report it and toast the user.
    // Distinct dedup namespace ('enf|…') so the block notice always shows at
    // the moment of the block, independent of the detection toast.
    this.enforcer.on('block', (ev) => {
      const ai = identifyAiProcess(ev.process) || { product: ev.process, vendor: null };
      const patterns = (ev.patterns || '').split(',').filter(Boolean);
      const isAttachment = ev.reason === 'attachment';
      // A FULL PLATFORM BLOCK — the org disallowed this app outright, so
      // nothing about the message was scanned or is at fault. `patterns` on
      // this event is the enforcer's human-readable "Blocked agent: X" string,
      // NOT a pattern list, so it must not be reported as one; the browser
      // extension's equivalent (blocked_for:'platform') reports matches:[] too.
      const isPlatform = !!ev.platform_block;
      const matches = isPlatform ? [] : patterns.map((p) => ({ pattern: p, severity: 'high', count: 1 }));
      const agentName = ev.blocked_agent || ai.product;
      // The access-exception key. The process name is preferred over the
      // platform id because it names the app actually in the foreground; the
      // platform mapping is the fallback for a process the catalog does not
      // carry a host for.
      const toolHost = isPlatform
        ? (hostForProcess(ev.process) || hostsForPlatform(ev.blocked_platform)[0] || '')
        : '';
      // reason: 'send' (Enter) | 'paste' (Ctrl+V) | 'click' (send button) | 'attachment' (sensitive file attached).
      const reason = isPlatform ? 'platform' : isAttachment ? 'file_upload' : ev.reason === 'paste' ? 'prompt_paste' : 'prompt_submit';
      const how = isPlatform ? 'blocked platform' : isAttachment ? `attachment "${ev.filename}"` : ev.reason === 'paste' ? 'paste' : ev.reason === 'click' ? 'send-button click' : 'send';
      this.reporter.enqueue({
        kind: 'enforcement_block',
        blocked_for: reason,
        mechanism: isPlatform ? 'platform_block' : isAttachment ? 'attachment_hold' : 'keystroke_block',
        blocked_by: isAttachment ? 'attachment_hold' : undefined,
        filename: isAttachment ? ev.filename : undefined,
        source: 'os_monitor_enforcer',
        service: ai.product,
        vendor: ai.vendor,
        process_name: ev.process,
        // NOTE: the blocked platform id / agent id / tool_host are deliberately
        // NOT sent here. POST /api/v1/dlp maps enforcement metadata from an
        // explicit allowlist (see its metadata block), so extra keys would be
        // silently dropped — which reads as "we recorded it" when nothing was
        // recorded. They travel on the @@CFAI-BLOCK line below, which is where
        // they are actually consumed, and reach the server on the access request
        // itself. blocked_for/mechanism already carry "this was a platform block".
        matches,
        highest_severity: isPlatform ? 'critical' : 'high',
      });
      this.log?.info(`os_monitor: BLOCKED ${how} into ${ai.product} — [${ev.patterns}]`);
      if (this.#shouldFire(`enf|${ev.process}|${ev.patterns}|${ev.filename || ''}`)) {
        // Honest framing per the design decision: this stops the MESSAGE,
        // not necessarily the upload — several chat apps upload an attached
        // file to the vendor's backend the instant it's attached, well
        // before Send. Never imply the bytes never left the machine.
        this.toast.show(isPlatform ? {
          // The old copy here read "Send blocked: prompt contains Blocked
          // agent: Claude … Override (logged): Ctrl+Alt+Enter" — wrong on all
          // three counts: the prompt contains nothing, "Blocked agent" is not
          // a pattern name, and that override no longer applies to a platform
          // block. Say what is actually true and where the remedy is.
          title: `${ai.product} is blocked`,
          message: `Your organization has blocked ${agentName} on this device — nothing can be sent here.\n` +
            `Need it? Ask for temporary access in the CloudFuze window that just opened.`,
        } : isAttachment ? {
          title: `${ai.product} - attachment blocked`,
          message: `Send blocked: "${ev.filename}" contains ${ev.patterns}\n` +
            `Remove the attachment to send. If the app already uploaded it on attach, this only stops it from being used in the conversation.`,
        } : {
          title: `${ai.product} - BLOCKED`,
          message: `Send blocked: prompt contains ${ev.patterns}\n` +
            `Remove the sensitive data to send. Override (logged): Ctrl+Alt+Enter.`,
        });
      }
      // Structured relay for the Electron dialog — separate from the plain-text
      // log line above, which main.js's regex-scraper cannot parse reliably.
      // block_id/rewritable/preview travel ONLY on this line, never through
      // log.* (see notify.js/enforcer-win.ps1's "never log content" discipline).
      // platform_block routes main.js to the Request Access dialog instead of
      // the Tokenize one; tool_host/tool_name/tool_vendor are pre-resolved here
      // so the Electron layer never needs the process→host catalog itself, and
      // are named to match the /api/v1/access-requests body exactly.
      console.log('@@CFAI-BLOCK ' + JSON.stringify({
        app: ai.product, patterns: ev.patterns, block_id: ev.block_id || '',
        rewritable: !!ev.rewritable, preview: ev.preview || '', why_not: ev.why_not || '',
        reason: ev.reason || '', filename: ev.filename || '',
        platform_block: isPlatform,
        blocked_platform: ev.blocked_platform || '',
        blocked_agent: isPlatform ? agentName : '',
        agent_id: ev.blocked_agent_id || '',
        tool_host: toolHost,
        tool_name: isPlatform ? ai.product : '',
        tool_vendor: isPlatform ? (ai.vendor || '') : '',
        process_name: ev.process || '',
      }));
    });

    // Tier B mask-and-rewrite result. 'ok' means the composer was verified to
    // hold exactly the masked text before Enter was synthesized — report it
    // the same way the browser extension's Tokenize & Send reports
    // enforcement_redact, masked content only, original never sent here.
    this.enforcer.on('rewrite', (ev) => {
      console.log('@@CFAI-REWRITE ' + JSON.stringify(ev));
      if (ev.result !== 'ok') return;
      this.reporter.enqueue({
        kind: 'enforcement_redact',
        mechanism: 'keystroke_rewrite',
        source: 'os_monitor_enforcer',
        decision_for: ev.block_id,
        sent: true,
      });
      this.log?.info(`os_monitor: TOKENIZED + sent — block_id=${ev.block_id}`);
    });

    // Smart Model Router (desktop). Reported for every attempt, not just
    // successful ones — a route that silently stopped working (e.g. after a
    // target app's UI redesign) is the main operational risk, mirrored on
    // ui_changed so the dashboard can distinguish an actual switch from an
    // observed-but-not-applied decision. No prompt content ever travels on
    // this event: only an enum result, tier names, a public model label, and
    // a length — see enforcer-win.ps1's UpdateModelRouting/RunRoute.
    this.enforcer.on('route', (ev) => {
      console.log('@@CFAI-ROUTE ' + JSON.stringify(ev));
      const ai = identifyAiProcess(ev.process) || { product: ev.process, vendor: null };
      this.reporter.enqueue({
        kind: 'model_routed',
        mechanism: 'keystroke_route',
        source: 'os_monitor_enforcer',
        service: ai.product,
        vendor: ai.vendor,
        routed_ui_name: ev.to_label || null,
        complexity: ev.complexity || null,
        current_tier: ev.from_tier || null,
        provider: ev.provider || null,
        ui_changed: ev.result === 'ok',
      });
      this.log?.info(`os_monitor: model route ${ev.result} — ${ai.product} ${ev.from_tier}->${ev.to_tier} (${ev.complexity})`);
      if (ev.result === 'ok' && this.#shouldFire(`route|${ev.process}`)) {
        this.toast.show({
          title: `${ai.product} - model routed`,
          message: `Switched to ${ev.to_label} for this message (${ev.complexity} prompt).`,
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

    if (this.enforcerEnabled) {
      this.enforcer.start();
      // Spawn the watchdog alongside the enforcer — and only alongside it.
      // Nothing else in the monitor installs a keyboard hook, so there is
      // nothing for it to reap when the enforcer is off.
      this.enforcerWatchdog = spawnEnforcerWatchdog({ parentPid: process.pid, log: this.log });
    } else {
      this.log?.info('os_monitor: keystroke enforcer disabled by settings — passive DLP watchers still active');
    }

    if (process.platform === 'win32') {
      this.log?.info(
        'os_monitor: started (clipboard text + files + dialogs + drag-drop chips + typed prompts' +
        (this.enforcerEnabled ? ' + keystroke send-blocker)' : '; keystroke send-blocker OFF)')
      );
    } else {
      this.log?.info(
        `os_monitor: started on ${process.platform} ` +
        '(clipboard text + files + foreground; UIA file-dialog & drag-drop watchers are Windows-only — clipboard paste path still fully covered)'
      );
    }
  }

  /** Relay a Tokenize click from the Electron dialog down to the enforcer. */
  tokenize(blockId) {
    return this.enforcer.tokenize(blockId);
  }

  stop() {
    this.#stopAttachHoldRefresh();
    this.poller.stop();
    this.dialogWatcher.stop();
    this.attachmentWatcher.stop();
    this.promptWatcher.stop();
    // Order matters: stop the enforcer (kills the helper, clears the pid +
    // heartbeat files) BEFORE reaping the watchdog, so the watchdog has
    // nothing left to act on and exits without killing anything.
    this.enforcer.stop();
    if (this.enforcerWatchdog) {
      try { this.enforcerWatchdog.kill(); } catch {}
      this.enforcerWatchdog = null;
    }
    this.policySync.stop();
    this.reporter.stop();
    this.toast.stop();
  }
}
