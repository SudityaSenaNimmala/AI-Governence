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

import { EventEmitter } from 'node:events';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn as cpSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPoller } from './poller-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { createNotifier } from './notify-factory.js';
import {
  watcherProcessNames,
  identifyAiProcess,
  isHostAppProcess,
  isAttachmentWatcherEligible,
  hostForProcess,
  hostsForPlatform,
  identifyAiPanel,
  hostForPanel,
  filterBlockedAgents,
  synthesizePlatformBlocks,
  normalizeAgentRows,
  identifyEgressSurface,
} from './ai-processes.js';
import { scan, lengthBucket, BLOCK_PATTERNS, getBlockPatterns, isTextReadable, isBinaryParseable, isImage, isArchive } from './classifier.js';
import { PolicySync } from './policy-sync.js';
import { FeatureSync } from './feature-sync.js';
import { buildFileUploadEvent } from './file-handler.js';
import { FileDialogWatcher } from './file-dialog-watcher.js';
import { AttachmentWatcher } from './attachment-watcher.js';
import { PromptWatcher } from './prompt-watcher.js';
import { SyncWatcher } from './sync-watcher.js';
import { Enforcer } from './enforcer.js';
import { spawnEnforcerWatchdog } from './enforcer-watchdog.js';
import { saveCachedRoutingRules } from './model-router-config.js';
import { Reporter } from './reporter.js';
// The single-slot offline queue for a Request Access submission, and the poller
// that drains it. Owned by blocked-agents-sync.js — one path files these, one
// path retries them.
import { PENDING_REQUEST_PATH, EGRESS_PATH } from './blocked-agents-sync.js';
import { createHash } from 'node:crypto';

// How long after firing a toast for a (clipboardSeq, processName) pair we
// suppress re-firing for the same pair. 10s prevents rapid-fire spam while
// still re-warning on repeated paste attempts.
const FIRE_DEDUP_TTL_MS = 10_000;

// How long a block's match information stays available to the Tokenize & Send
// rewrite that may follow it (see #pinRewriteContext). Derived from the
// helper's own arithmetic rather than picked: enforcer-win.ps1 pins a
// rewritable block for REWRITE_TTL (15s), the write itself is budgeted at
// REWRITE_WRITE_BUDGET_MS (9s), and the "ok" line is only emitted after the
// composer read-back and the send confirmation on top of that. 60s clears all
// of it with room to spare, and expiry only costs the audit record its match
// fields — never the record itself.
const REWRITE_CONTEXT_TTL_MS = 60_000;

// Mirrors REASON_MAX in server/src/routes/access-requests.js. The server
// truncates past this; the dialog's own textbox refuses past it (see
// CfaiRequestDialog.ReasonMax in toast-helper.ps1), and this is the belt-and-
// braces cap on the value that actually leaves the machine.
const REASON_MAX = 500;

// How often index.js re-reads ~/.cloudfuze-aigov/egress-surfaces.json to decide
// whether the cloud-sync-root watcher may run at all.
//
// Matched to blocked-agents-sync.js's own 10s write cadence, so an admin turning
// the policy OFF stops the filesystem observation within about one interval of
// the sync noticing. The other direction (turning it on) is equally fast, but the
// off direction is the one this number is chosen for: while a policy is
// withdrawn, continuing to watch someone's Documents folder is observation with
// no governance behind it.
const EGRESS_POLICY_POLL_MS = 10_000;

// "Which agent is this block/request about", folded to a comparison key the
// same way the server folds it (agentKeyFor + normalizeAgentName in
// access-requests.js): the server-issued id when there is one, otherwise the
// display name with whitespace collapsed and case dropped. '' means host-wide.
//
// Used ONLY for local comparisons — the pending-request pre-check and the
// in-flight dedupe. The server derives its own key from what we post and never
// trusts one sent to it.
function agentMatchKey({ block_scope, agent_id, agent_name }) {
  if (block_scope !== 'agent') return '';
  const id = String(agent_id ?? '').trim();
  if (id) return id;
  return String(agent_name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Product identity for an enforcer event, panel FIRST.
//
// An event from an IDE-hosted AI panel carries process:"Code" (or "Cursor")
// plus panel:"claude_code". The process alone identifies nothing — "Code" is in
// no AI catalog and never will be (see the IDE-catalog comment in
// ai-processes.js for why adding it there would be a privacy regression),
// so before panels existed such an event could not even be produced, and
// resolving one by process would drop it at the `if (!ai) return` guard. The
// panel id is what names the product ("Claude Code" by Anthropic).
//
// Falls back to the existing process-based resolution when there is no panel:
// every pure chat app, and an IDE in its whole-app fallback mode (Cursor with no
// panel focused), where process:"Cursor" is the correct identity.
function identifyEventAi(ev) {
  // The PROCESS rides along so a pane hosted by several apps is named per host
  // ("Word Copilot", "Excel Copilot" — see office_copilot_pane.productByProc).
  return (ev?.panel ? identifyAiPanel(ev.panel, ev.process) : null) || identifyAiProcess(ev?.process);
}

// WHICH AGENT an enforcer 'block' event is about, as the four audit-record keys
// the server's enforcement-metadata allowlist maps: agent_name, agent_id,
// agent_scope, surface. Shared by the enforcement_block record and the rewrite
// pin, so enforcement_redact carries byte-identical values.
//
// PROVENANCE IS THE WHOLE POINT. enforcer-win.ps1 fills `agent` / `agent_id`
// from exactly two sources and says which one on `agent_src`:
//   'row'  — an agent-scoped blocked/governed POLICY ROW: the name an admin
//            typed and the id the server issued. → agent_scope 'agent'.
//   'sole' — our own catalog's soleAgent for the focused panel (no id).
//            → agent_scope 'panel', the same enum govstate uses for
//            "the composer signature alone identifies it".
//   anything else — no attribution, and NO agent key is emitted at all.
// A name read off another app's window or accessibility tree never reaches the
// event (the .ps1 only ever returns the row's value for it), and this function
// does not re-derive, guess or fall back to one: an unknown agent_src means the
// agent fields are omitted, never filled from `ai.product`.
//
// `surface` is OUR catalog id — the panel id when the block came from an IDE /
// host-app panel, else the agent-surface id (m365_copilot, …). Never a title.
//
// Keys whose value is unknown are OMITTED rather than sent empty, so a record
// can tell "no agent dimension" from "an agent with an empty name". Never
// logged — see the 'block' handler's log line.
function blockAgentAttribution(ev) {
  const out = {};
  const src = String(ev?.agent_src ?? '');
  const scope = src === 'row' ? 'agent' : src === 'sole' ? 'panel' : '';
  const name = String(ev?.agent ?? '').trim();
  const id = String(ev?.agent_id ?? '').trim();
  if (scope && (name || id)) {
    if (name) out.agent_name = name;
    if (id) out.agent_id = id;
    out.agent_scope = scope;
  }
  const surface = String(ev?.panel || ev?.surface || '').trim();
  if (surface) out.surface = surface;
  return out;
}

// The access-exception key for a platform/agent/panel block event. Most
// specific first: the PANEL names the exact AI surface inside an IDE (and
// "Code" has no host of its own), then the process name because it names the
// app actually in the foreground, then the platform mapping as the fallback for
// a process the catalog does not carry a host for.
//
// ONE function, two callers — the 'block' relay and the Request Access flow.
// They MUST agree: the host the dialog asks for an exception against is the same
// host /access-exceptions/check is later consulted with, and the same one
// filterBlockedAgents subtracts on. A second copy of this expression is a
// silent way for an approval to never lift the block it was granted for.
function blockToolHost(ev) {
  return hostForPanel(ev.panel) || hostForProcess(ev.process) || hostsForPlatform(ev.blocked_platform)[0] || '';
}

// ── WHICH governed conversation an arm is for, as an opaque digest ──────────
//
// Goes down the host_arm channel to both UIA watchers so the chip watcher can
// tell "focus bounced off the composer inside this conversation" from "a
// different conversation is now open", and only drop its filename baseline for
// the second. Without that distinction it dropped the baseline on every
// arm/disarm, and since attaching a file IS a focus bounce, the chip the diff
// was supposed to notice was always already in the fresh baseline — a Teams
// attachment could not be detected at all. See Reset-Baseline in
// attachment-watcher.ps1.
//
// HASHED, not the values themselves. Truncated sha256 over the admin-typed agent
// name + id and our own catalog panel id (the identity govstate already carries),
// so what actually crosses into the watcher process is an opaque token: it
// changes when the conversation changes and says nothing about which conversation
// it is. Same construction as reporter.js's client event id. No window title, no
// filename and no prompt text has any parameter here it could arrive through.
function hostArmKey(g) {
  if (!g) return '';
  const seed = `${g.agent || ''}|${g.agent_id || ''}|${g.panel || ''}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

// Clipboard scrubbing was removed on 2026-06-15: the clipboard path now fires
// on the actual paste gesture, so the content is already in the app and
// overwriting the clipboard would only corrupt the user's next paste — and the
// standing preference is that the OS monitor must never overwrite the
// clipboard. The OS monitor is detect + notify + report only; real blocking is
// owned by the browser extension (web apps) and the proxy (API/CLI traffic).

export class OsMonitor extends EventEmitter {
  // Sink for the legacy `@@CFAI-*` stdout relay lines. See the long comment on
  // #ui() for why the gate is a console-shaped sink rather than a condition
  // repeated at each relay site.
  #console;

  // `enforcerEnabled` is the desktop app's "Keystroke enforcer" setting,
  // plumbed through from Electron (and, for the CLI, from CFAI_ENFORCER_ENABLED).
  // False turns OFF only the active keystroke-blocking piece — every passive DLP
  // watcher (clipboard, file dialogs, attachments, typed prompts) keeps running.
  //
  // `legacyStdout` prints the machine-readable `@@CFAI-*` relay lines on stdout
  // for Electron's main.js, which scrapes this child's stdout. It is OFF by
  // default: the CLI has no scraper and consumes monitor.on('ui', …) instead, so
  // printing them there would dump relay lines into the user's console.
  //
  // `skipPromptWatcher` exists for one caller: the packaged agent, which already
  // runs a PromptWatcher of its own in Claude-tracker mode (CFAI_CLAUDE_TRACKER=1
  // switches the PS1 into browser-aware behaviour the Claude Usage dashboard
  // depends on). Two PromptWatchers would spawn two prompt-watcher.ps1 helpers
  // reading the same UI Automation tree and emit every typed prompt twice, so the
  // host widens its own watcher to cover every AI process instead and tells this
  // one to stand down. Everything else here — the enforcer, clipboard, dialogs,
  // attachments, policy and feature sync — still runs.
  constructor({ serverUrl, token, log, enforcerEnabled = true, skipPromptWatcher = false, legacyStdout = false, fleetStatePath = null }) {
    super();
    this.log = log;
    // The LOCAL setting. Written once, here, and never again — #applyFeatures
    // must not be able to overwrite it, or a fleet flag saying "allowed" would
    // silently re-enable an enforcer the user/admin switched off on this machine.
    this.localEnforcerEnabled = enforcerEnabled !== false;
    // The DERIVED, currently-effective value: local AND fleet. This is what gates
    // the enforcer and what policySync's onChange consults. Before the first
    // feature poll answers there is no fleet opinion, so it starts at the local
    // setting.
    this.enforcerEnabled = this.localEnforcerEnabled;
    this.skipPromptWatcher = skipPromptWatcher === true;
    // Where the last REAL fleet `dlp` value is remembered across restarts, so
    // the enforcer's AI-evidence routes start in the admin's last-known state
    // rather than on (security review L3). Overridable for tests.
    this.fleetStatePath = fleetStatePath || join(homedir(), '.cloudfuze-aigov', 'fleet-evidence-dlp.json');
    this.legacyStdout = legacyStdout === true;
    this.#console = this.legacyStdout ? console : { log() {} };
    // Lifecycle flag, distinct from the per-feature `this.running` map below:
    // false means start() has not run or stop() has already run, and
    // #applyFeatures must do nothing at all. An in-flight FeatureSync poll can
    // resolve AFTER stop() (its stop() only clears the interval — it cannot
    // abort a fetch already awaiting), and without this its onChange would
    // resurrect the keyboard hook on a monitor that had fully torn down.
    this.isRunning = false;
    // Kept for the Request Access flow, which is the one path here that makes
    // its own authenticated call instead of going through the Reporter's queue:
    // a request the user is standing in front of has to be answered now, and it
    // goes to a different route (/api/v1/access-requests, not /api/v1/dlp).
    // Same enrolment machine JWT either way — see #submitAccessRequest.
    this.serverUrl = String(serverUrl || '').replace(/\/$/, '');
    this.token = token || null;
    this._blockedAgentsInterval = null;
    this.poller = createPoller({ log });
    this.reporter = new Reporter({ serverUrl, token, log });
    this.toast = createNotifier({ log });
    // Bare process names (without regex) for the UIA watchers, the clipboard
    // poller and the keystroke enforcer.
    //
    // Built by watcherProcessNames() rather than inline off AI_PROCESSES,
    // because the derivation now carries a rule: `hostApp: true` entries
    // (Microsoft Teams) are EXCLUDED. Teams is in the catalog only for host /
    // exception resolution; letting its process name reach this list would turn
    // on clipboard scanning, attachment-chip watching and prompt-text reading
    // across a company's whole communications client — every DM and channel —
    // which is exactly what the narrow agent-conversation scoping exists to
    // avoid. Same separation, and the same reason, that keeps the IDE catalog
    // out of this file entirely.
    const aiProcNames = watcherProcessNames();
    // ── "A governed agent conversation is open in a host app" ─────────────────
    //
    // { process, pid, agent, agent_id, scope } while the enforcer's govstate says
    // so, null otherwise — and null is the state for the overwhelming majority of
    // Microsoft Teams use. Written ONLY by the enforcer's 'govstate' handler.
    //
    // This is the sole thing that lets any file route look at Teams at all. It is
    // read in exactly four places: the three file-capture routes (drag-drop chip,
    // file picker, clipboard file paste) and the watcher re-arm hook. Teams is
    // NOT in aiProcNames above and must never be — the watchers stay blind to it
    // by default, and this arms them for the narrow window the org's own policy
    // already asked to be governed.
    //
    // Declared before the watchers so their re-arm hooks can read it.
    this.hostGoverned = null;
    // The re-arm hook, shared by both UIA watchers. host_arm state lives in the
    // CHILD process, so a crashed-and-respawned helper comes up disarmed; without
    // this it would sit permanently blind to a governed conversation that was
    // already open, because index.js only sends host_arm on a govstate
    // TRANSITION and no further transition is coming.
    const reArm = (watcher) => {
      const proc = this.hostGoverned?.process;
      if (proc) {
        watcher.hostArm(proc, true, hostArmKey(this.hostGoverned));
        this.log?.info(`os_monitor: re-armed host capture for ${proc} after a watcher respawn`);
      }
    };
    this.dialogWatcher = new FileDialogWatcher({ log, aiProcessNames: aiProcNames, onRespawn: reArm });
    this.attachmentWatcher = new AttachmentWatcher({ log, aiProcessNames: aiProcNames, onRespawn: reArm });
    this.promptWatcher = new PromptWatcher({ log, aiProcessNames: aiProcNames });
    // ── The cloud-sync-root watcher (OneDrive / SharePoint) ──────────────────
    //
    // Deliberately given NO process list: it watches a FILESYSTEM location, not
    // an app, and it is the only watcher here whose subject is not something the
    // user did in a window. Constructed with an EMPTY armed-root set, so it does
    // nothing at all until #syncEgressPolicy reads a governed policy off disk —
    // which is the state of every machine whose admin governs no cloud-sync host.
    //
    // The re-arm hook is a SEPARATE one from `reArm` above, because the thing
    // that has to be re-stated is different: for the two UIA watchers it is the
    // host_arm command for a governed Teams conversation, and for this one it is
    // the sync-root policy, which lives in the dead child's env.
    this.syncWatcher = new SyncWatcher({
      log,
      armedRoots: [],
      onRespawn: (watcher) => {
        if (this.egressSyncRoots.length > 0) {
          watcher.armedRoots = this.egressSyncRoots;
        }
      },
    });
    // The `sync_roots` entries from egress-surfaces.json, i.e. the POLICY answer
    // to "may this machine's synced folders be observed at all". Empty until a
    // poll says otherwise, and re-emptied the moment an admin withdraws the
    // policy — see #syncEgressPolicy.
    this.egressSyncRoots = [];
    // Surface id -> capture_mode, from the SAME policy tick as egressSyncRoots.
    // Only 'hold' can ever swallow a send chord (see captureModeFor in
    // ai-processes.js) — 'observe' and 'block_critical' both leave it alone.
    // #reportEgressFile reads this so its toast never claims a hold that the
    // enforcer will not actually arm.
    this.egressCaptureModeById = new Map();
    this.egressPolicyTimer = null;
    // Keystroke send-blocker — actually prevents the send (swallows Enter /
    // Ctrl+V) when the focused AI prompt or clipboard holds a blocked pattern.
    this.enforcer = new Enforcer({
      log,
      aiProcessNames: aiProcNames,
      blockPatterns: getBlockPatterns(),
      // The Enforcer's own master switch is the LOCAL setting: a fleet flag can
      // start and stop it (via #applyFeatures), but it can never make a locally
      // disabled enforcer spawnable.
      enabled: this.localEnforcerEnabled,
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
    // ── Routing rules sync ────────────────────────────────────────────────────
    // Fetches admin-configured model routing rules from the same endpoint the
    // browser extension uses (/api/v1/routing/rules). When rules change the
    // enforcer is restarted so the C# ComputeRoute() picks up the new config.
    this._routingRulesHash = '';
    this._routingRulesTimer = setInterval(() => this.#refreshRoutingRules(), 60_000);
    this._routingRulesTimer.unref?.();
    // First fetch 5s after start (let enforcer settle first).
    setTimeout(() => this.#refreshRoutingRules(), 5000);

    // Fleet-wide feature switches, thrown from the dashboard's Settings page.
    //
    // WHAT THIS REPLACES. The keystroke enforcer used to be controlled ONLY by
    // CFAI_ENFORCER_ENABLED, an Electron checkbox passed into this child process
    // as an env var (see settings-env.js). That made it per-machine and invisible:
    // a user could switch blocking off locally and the dashboard would still show
    // it running. The env var is now only the value used until the first poll
    // answers — after that the server decides, for every machine at once.
    //
    // Every subsystem below already had start()/stop(), so a flag change starts or
    // stops the real thing rather than merely being recorded.
    this.featureSync = new FeatureSync({
      serverUrl,
      log,
      onChange: ({ features, changed }) => this.#applyFeatures(features, changed),
    });
    // Tracks what is actually running, so a poll that reports a flag we already
    // honour does not restart a healthy subsystem — restarting the enforcer means
    // tearing down and reinstalling a keyboard hook, which is not free.
    this.running = {
      clipboard_monitor: false,
      dlp: false,
      agent_enforcer: false,
    };
    this.currentFocus = null;  // { pid, process, title, aiInfo? }
    // Map<"seq|process", lastFiredAtMs> — used to suppress duplicate fires
    // when the user pastes the same clipboard contents repeatedly into the
    // same AI surface. Pruned periodically to bound memory.
    this.firedAt = new Map();
    // Filenames currently held (Enter/send-click swallowed) by the
    // attachment-hold mechanism: Map<filename, { patterns, severity, ttlMs }>.
    // The hold is in force while this map is non-empty.
    //
    // WAS A SINGLE STRING, and that was a real defect with two halves. A second
    // attachment overwrote the slot, so tracking of the first file was simply
    // lost; and — the half that actually let a sensitive file through — an
    // `attachment_disappeared` for a CLEAN file B released the hold that FLAGGED
    // file A still needed, because the guard only compared the one filename it
    // had room for. Removing one file now deletes only its own key, and the
    // pattern list re-stated on the hold is the UNION across every file still
    // held (see #syncAttachHold), so the block never under-reports what is
    // holding it.
    this.attachHolds = new Map();
    // Which app the current holds belong to. The helper has ONE hold slot, so
    // holds from two different apps cannot coexist in it: an arm from a
    // different process REPLACES the set rather than merging into it. The helper
    // independently refuses to apply a hold whose process is not the foreground
    // app — see AttachHoldActive in enforcer-win.ps1 — so this side and that
    // side have to agree on which app it is.
    this.attachHoldProcess = null;
    // Keeps an attach hold alive past its own TTL for as long as the flagged
    // file stays attached. attachment_appeared only fires once, on first
    // appearance — it does NOT keep firing while a chip just sits there
    // unchanged, so without an active refresh the hold silently expires even
    // though the sensitive file never left the composer, and a send that should
    // still be blocked goes through with no warning at all. Confirmed live:
    // exactly this happened when enough real time passed between attaching a
    // file and testing it (talking, reviewing a separate change) with the file
    // never removed and re-attached.
    //
    // NOW COVERS THE PROVISIONAL HOLD TOO. It used to start only for a CONFIRMED
    // hold, which left the 3s provisional one — the whole point of which is to
    // win the race against a fast Enter while the scan runs — able to lapse
    // BEFORE the scan that would have confirmed it returned. A slow extraction
    // (OCR, a big PDF, a deep zip: exactly the files most worth holding) is
    // precisely the case where 3s is not enough, so the hold expired and the
    // sensitive file went out un-scanned and un-blocked. #syncAttachHold starts
    // the ticker for every hold, and the interval is derived from the shortest
    // TTL in force rather than being a constant, so a 3s hold is refreshed every
    // ~1s instead of every 5.
    this.attachHoldRefreshTimer = null;
    // Blocks with a Request Access dialog already in flight, keyed on host +
    // agent identity. CONCURRENCY only, never a "we already asked once" memory:
    // the enforcer deliberately offers on EVERY blocked send (a user who was
    // declined must be able to ask again on their next attempt), so this covers
    // exactly the window where a second offer would race the first — including
    // the /mine pre-check, which is a network round trip. Released in the
    // finally, so the next blocked send opens a fresh dialog immediately.
    this.accessRequestInFlight = new Set();
    // The same idea for the Tokenize & Send popup, keyed on block_id. The helper
    // already refuses to draw a second window for a block it is showing one for,
    // so this exists to stop a held-down Enter piling up pending PROMISES on this
    // side (each of which would otherwise sit until its own timeout). Released in
    // the finally, so the next distinct block offers again.
    this.tokenizeOfferInFlight = new Set();
    // What the last REWRITABLE block knew, for the enforcement_redact record of
    // the Tokenize & Send that may follow it. Single slot, no content — see
    // #pinRewriteContext.
    this.rewriteContext = null;
    setInterval(() => this.#pruneFired(), 60_000).unref();
  }

  #pruneFired() {
    const cutoff = Date.now() - 2 * FIRE_DEDUP_TTL_MS;
    for (const [key, ts] of this.firedAt) {
      if (ts < cutoff) this.firedAt.delete(key);
    }
  }

  // ── The attachment hold: one helper slot, N held files ────────────────────
  //
  // The helper has exactly one hold (a flag, a filename, a pattern string and a
  // TTL), and this side may be holding several files at once. #syncAttachHold is
  // the single place that projects the map onto that slot, so arming and
  // releasing cannot disagree about what the helper currently believes.
  //
  // Re-sends attach_hold('on', ...) on an interval well inside the shortest TTL
  // in force, so a still-attached flagged file's hold never lapses on its own.

  // Push the CURRENT set of holds to the helper and (re)start the refresh
  // ticker. Returns the payload sent, or null when nothing is held.
  #syncAttachHold() {
    if (this.attachHolds.size === 0) { this.#stopAttachHoldRefresh(); return null; }
    const patterns = new Set();
    let ttlMs = 0;
    let shortestTtl = Infinity;
    for (const held of this.attachHolds.values()) {
      for (const p of String(held.patterns || '').split(',')) { if (p) patterns.add(p); }
      ttlMs = Math.max(ttlMs, held.ttlMs);
      shortestTtl = Math.min(shortestTtl, held.ttlMs);
    }
    const payload = {
      // EVERY held filename, not just the newest. The helper puts this on the
      // block it emits, and naming one of two flagged attachments would be a
      // false statement about the other.
      filename: [...this.attachHolds.keys()].join(', '),
      // The UNION of pattern names across every held file, for the same reason.
      patterns: [...patterns].join(','),
      // The LONGEST TTL in force — the hold must outlive its most durable
      // reason, and a shorter one being refreshed more often costs nothing.
      ttlMs,
      // Binds the hold to one app on the helper side. See attachHoldProcess.
      process: this.attachHoldProcess || '',
    };
    this.enforcer.attachHold('on', payload);
    // Derived from the SHORTEST TTL, not a constant: a 3s provisional hold
    // refreshed on a 5s interval — which is what the old Math.max(5000, …) did —
    // is a hold that expires.
    this.#startAttachHoldRefresh(payload, Math.max(500, Math.floor(shortestTtl / 3)));
    return payload;
  }

  // Add (or re-state) a hold for one file.
  #armAttachHold(filename, { patterns = '', severity = null, ttlMs = 3000, processName = '' } = {}) {
    if (processName && this.attachHoldProcess && processName !== this.attachHoldProcess) {
      // A different app's attachment. The helper has one slot, so the previous
      // app's holds cannot still be in it — drop them rather than report them
      // under this app's name.
      this.attachHolds.clear();
    }
    if (processName) this.attachHoldProcess = processName;
    this.attachHolds.set(filename, { patterns, severity, ttlMs });
    return this.#syncAttachHold();
  }

  // Drop the hold for ONE file. Returns true if that file was actually held.
  //
  // The other half of the multi-file fix: when other files are still held this
  // re-states the hold with the narrowed union instead of releasing it. Before,
  // any release released everything — so removing a clean attachment unblocked a
  // send that a sensitive one was still holding.
  #releaseAttachHold(filename) {
    if (!this.attachHolds.delete(filename)) return false;
    if (this.attachHolds.size === 0) {
      this.#stopAttachHoldRefresh();
      const processName = this.attachHoldProcess || '';
      this.attachHoldProcess = null;
      this.enforcer.attachHold('off', { filename, process: processName });
    } else {
      this.#syncAttachHold();
    }
    return true;
  }

  #startAttachHoldRefresh(payload, everyMs) {
    this.#stopAttachHoldRefresh();
    this.attachHoldRefreshTimer = setInterval(() => {
      // The map emptying is the one condition that stops the ticker on its own,
      // so a released hold can never be silently re-armed by a stale interval
      // nobody cleared. Every arm/release re-enters #syncAttachHold, which
      // replaces this timer with one carrying the fresh payload.
      if (this.attachHolds.size === 0) { this.#stopAttachHoldRefresh(); return; }
      this.enforcer.attachHold('on', payload);
    }, everyMs);
    this.attachHoldRefreshTimer.unref?.();
  }

  #stopAttachHoldRefresh() {
    if (this.attachHoldRefreshTimer) {
      clearInterval(this.attachHoldRefreshTimer);
      this.attachHoldRefreshTimer = null;
    }
  }

  // ── May a file route look at this HOST APP right now? ─────────────────────
  //
  // Returns the governed-conversation context ({ process, pid, agent, agent_id,
  // scope }) when the enforcer's govstate says a governed or blocked agent
  // conversation is the open one in THIS process, and null otherwise.
  //
  // Null for every non-host app, always — an ordinary AI app's file coverage
  // does not depend on this and must not start depending on it. Null for a host
  // app whenever govstate is inactive, which is the normal state of Microsoft
  // Teams: a DM, a channel, a meeting chat and the Activity tab all land here
  // and are never read, extracted, scanned or reported.
  //
  // The process comparison is what stops a govstate for one host app from
  // arming a route for a different one.
  // Stamp WHICH governed agent conversation a host-app file event came from.
  //
  // "Microsoft Teams" alone is not a useful attribution for a governance
  // record — the whole point of the host-app design is that only one narrow
  // conversation inside Teams was ever looked at, and the record has to say
  // which. The values are the admin-typed ones off govstate; nothing is derived
  // here and no conversation name read off a screen is ever used.
  //
  // Top-level agent_name / agent_id / agent_scope, the same shape
  // blocked-agents.json rows and normalizeAgentRows use — POST /api/v1/dlp's
  // file_upload metadata allowlist carries these through now (server/src/
  // routes/dlp.js), so this is the single place the attribution lives; no
  // content_scan mirror needed.
  #attributeToAgent(fileEvent, governed) {
    if (!fileEvent || !governed) return fileEvent;
    fileEvent.agent_name = governed.agent || '';
    fileEvent.agent_id = governed.agent_id || '';
    fileEvent.agent_scope = governed.scope || '';
    return fileEvent;
  }

  // ── May this machine's synced folders be observed at all? ─────────────────
  //
  // Reads ~/.cloudfuze-aigov/egress-surfaces.json — written only by
  // blocked-agents-sync.js, and only ever carrying a sync root when an admin
  // holds a GOVERNED ai_platforms row for a cloud-sync host — and pushes the
  // answer at the sync watcher, which spawns nothing while it is empty.
  //
  // A MISSING OR UNREADABLE FILE MEANS NO POLICY, i.e. an empty root set and no
  // observation. That is the correct fail direction and it is the opposite of the
  // convention the sync layer uses for the same file: over THERE, "I could not
  // reach the server" must leave the last known policy in force, because
  // rewriting the file could silently unblock something. Over HERE the question
  // is "may I open a handle on the user's Documents folder", and the answer to
  // that on no evidence is no. The file itself is the durable state; this side
  // never invents one.
  #syncEgressPolicy() {
    let roots = [];
    let captureModeById = new Map();
    try {
      if (existsSync(EGRESS_PATH)) {
        const payload = JSON.parse(readFileSync(EGRESS_PATH, 'utf8'));
        const list = Array.isArray(payload?.sync_roots) ? payload.sync_roots : [];
        // VERIFIED AND ENFORCING, both, exactly as every other two-flag surface
        // in this product: a sync root that has not had a live pass is inert even
        // when an admin governs its host. As shipped both flags are false, so
        // this filter empties the list and no filesystem observation happens at
        // all until a human flips them.
        roots = list.filter((r) => r && r.verified === true && r.enforce === true);
        // Same two-flag filter, for the mail-surface capture_mode this toast
        // reads below — an unverified surface's capture_mode is not policy yet.
        const surfaces = Array.isArray(payload?.surfaces) ? payload.surfaces : [];
        captureModeById = new Map(
          surfaces
            .filter((s) => s && s.id && s.verified === true && s.enforce === true)
            .map((s) => [String(s.id), String(s.capture_mode || 'observe')]),
        );
      }
    } catch (err) {
      // Unreadable or half-written (the sync rewrites it every 10s). No policy
      // this pass; the next one gets a complete file.
      roots = [];
      captureModeById = new Map();
    }
    this.egressCaptureModeById = captureModeById;
    const changed = JSON.stringify(roots.map((r) => r.id).sort())
      !== JSON.stringify(this.egressSyncRoots.map((r) => r.id).sort());
    this.egressSyncRoots = roots;
    if (!changed) return;
    // setArmedRoots decides for itself whether that means start, restart or
    // stop — see SyncWatcher. Only reached on a real change, so a healthy
    // FileSystemWatcher is never torn down by a poll that found nothing new.
    this.syncWatcher.setArmedRoots(roots);
    if (roots.length > 0 && this.running.dlp) {
      this.syncWatcher.stopRequested = false;
      this.syncWatcher.start();
    }
  }

  // ── The shared reporting tail for an egress FILE event ────────────────────
  //
  // The three egress file routes (an Outlook compose chip, an Outlook attach
  // dialog, a file appearing in a sync root) differ only in how they NOTICED the
  // file. Everything after that — build the event, dedupe it, enqueue it, toast
  // it — is identical, and writing it once is what keeps the three from drifting
  // apart on the one thing that matters: what the toast is allowed to claim.
  //
  // `hold` is what separates the mail routes from the sync route. For a mail
  // attachment there is a send chord to swallow, so a high/critical scan arms an
  // attachment hold. For a sync root there is NOTHING to hold — the file is
  // already in a folder that uploads itself, and this feature explicitly does not
  // move, rename or quarantine anything (a confirmed decision) — so the sync
  // route passes hold:false and the toast says so plainly.
  //
  // buildFileUploadEvent, #armAttachHold and #releaseAttachHold are all reused
  // UNCHANGED: this is a new call site, not a new mechanism.
  //
  // NOTE ON FAIL-OPEN, which is achieved here by OMISSION and is the point:
  // there is no `unverified`/`failClosed` term anywhere in this method. The
  // attachment_appeared handler's fail-closed rule is scoped to
  // `inGovernedConversation` (`!!governed || hostChip`), and both of those terms
  // are about a HOST-APP agent conversation — a condition an egress surface can
  // never satisfy, since it is not a host app and no govstate ever names it. So
  // an unscannable or unverifiable file attached to an email is REPORTED and
  // never HELD, automatically, with no exclusion to maintain. Escalating on "we
  // could not read it" in a mail client would mean blocking legacy .doc files and
  // password-protected archives from being emailed at all, which nobody asked
  // for. agent/tests/os-monitor-egress.test.mjs asserts it.
  async #reportEgressFile({ path, filename, via, surfaceId, processName, origin = null, hold = true }) {
    const ident = identifyEgressSurface(surfaceId) || { product: processName || surfaceId, vendor: null };
    // PROVISIONAL hold, armed BEFORE the scan for any extension the classifier
    // can actually read — the same race against a fast send chord the AI path
    // arms one for, and the same "don't hold what we cannot explain" exclusion
    // for media and unknown types.
    // `hold` says this came from a route CAPABLE of holding (mail, not sync) —
    // it is NOT the policy answer. Only capture_mode:'hold' is: that is the one
    // value captureModeFor() (ai-processes.js) ever lets the enforcer's
    // _egressHoldProcs actually swallow a send chord for, and this toast must
    // never claim more protection than that. Read from the SAME policy tick
    // that arms the sync watcher (#syncEgressPolicy), keyed on this surface.
    const reallyHeld = hold && this.egressCaptureModeById.get(surfaceId) === 'hold';
    const scannable = reallyHeld && (
      isTextReadable(filename) || isBinaryParseable(filename) || isImage(filename) || isArchive(filename)
    );
    if (scannable) {
      this.#armAttachHold(filename, { patterns: '', ttlMs: 3000, processName });
    }
    try {
      const fileEvent = await buildFileUploadEvent({
        path,
        via,
        service: ident.product,
        vendor: ident.vendor,
        processName,
        // ALWAYS EMPTY, and this is the strictest instance of the host-app rule
        // rather than an inherited one: an Outlook window title is the message
        // SUBJECT LINE, plus the recipient's display name in a reply. Both are
        // content and neither is what this record is about.
        windowTitle: '',
        log: this.log,
      });
      if (!fileEvent) {
        if (scannable) this.#releaseAttachHold(filename);
        return;
      }
      // Which egress surface, and — for a sync root — which DIRECTION we believe
      // the file was moving. `origin` is only ever 'local_new' or 'unknown' here:
      // sync-watcher.ps1 drops a 'sync_down' classification outright rather than
      // reporting a download as an upload.
      fileEvent.egress_surface = surfaceId || '';
      if (origin) fileEvent.origin = origin;

      const cs = fileEvent.content_scan;
      const severity = fileEvent.severity;
      // NO fail-closed term. See the long note above this method.
      const shouldHold = reallyHeld && (severity === 'high' || severity === 'critical');
      if (shouldHold) {
        const patternNames = (cs?.matches || []).map((m) => m.pattern).join(',') || fileEvent.file_class;
        this.#armAttachHold(filename, {
          patterns: patternNames, severity, ttlMs: 60_000, processName,
        });
      } else if (scannable) {
        this.#releaseAttachHold(filename);
      }

      const dedupKey = `egress|${path}|${surfaceId}`;
      const lastFired = this.firedAt.get(dedupKey) ?? 0;
      if (Date.now() - lastFired < FIRE_DEDUP_TTL_MS) {
        this.log?.info(`os_monitor: suppressed duplicate egress file fire (${fileEvent.filename})`);
        return;
      }
      this.firedAt.set(dedupKey, Date.now());
      this.reporter.enqueue(fileEvent);
      const matchCount = cs?.matchCount || 0;
      this.log?.info(
        `os_monitor: egress ${via} → ${ident.product} — ${fileEvent.filename} `
        + `[${fileEvent.file_class}, severity=${fileEvent.severity}${origin ? ', origin=' + origin : ''}`
        + `${cs?.scanned ? `, scanned, ${matchCount} match(es)` : ''}]`
      );

      const hasContentMatches = matchCount > 0;
      const risky = fileEvent.severity === 'high' || fileEvent.severity === 'critical';
      if (!hasContentMatches && !risky) return;
      const patternList = hasContentMatches
        ? cs.matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ')
        : fileEvent.file_class;
      const contains = hasContentMatches ? 'Contains: ' + patternList : 'File class: ' + patternList;
      if (reallyHeld) {
        // ── Outlook attachment: what is and is NOT covered ──────────────────
        //
        // Both caveats are stated because both are real, and the copy rules in
        // this file forbid claiming a block that is narrower than it sounds:
        //   * the MOUSE. UpdateSendRect never caches a rectangle for an egress
        //     process (it returns early for anything that is not an AI surface),
        //     so the mouse hook has no rectangle to swallow a click in. Clicking
        //     Send is NOT covered.
        //   * Ctrl+Enter-to-send is a USER PREFERENCE ("Send immediately when
        //     connected" / the Ctrl+Enter accelerator) that some people turn off.
        //     On such a machine the chord we swallow is not the chord they use.
        // So the honest instruction is "remove the attachment", and the hold is
        // described as what it is: a partial brake, not a seal.
        this.toast.show({
          title: `${ident.product} - ${fileEvent.severity.toUpperCase()} attachment`,
          message: `${fileEvent.filename}\n${contains}\n`
            + 'Ctrl+Enter and Alt+S are held. Clicking the Send button with the mouse is NOT covered, '
            + 'and Ctrl+Enter-to-send is a setting some users have switched off — so remove the '
            + 'attachment to be sure.\nReported to CloudFuze AI Governance.',
        });
        return;
      }
      if (hold) {
        // MAIL route, but capture_mode is 'observe' or 'block_critical' — the
        // enforcer will not arm _egressHoldProcs for this surface, so nothing
        // is actually held. Same honesty rule as the OneDrive copy below: never
        // claim a chord is swallowed when it is not.
        this.toast.show({
          title: `${ident.product} - ${fileEvent.severity.toUpperCase()} attachment`,
          message: `${fileEvent.filename}\n${contains}\n`
            + 'This was DETECTED AND REPORTED only — the send was not held, and clicking Send is not '
            + 'covered.\nReported to CloudFuze AI Governance.',
        });
        return;
      }
      // ── OneDrive / SharePoint: DETECTED, not stopped ───────────────────────
      //
      // This copy must not imply anything happened to the file, because nothing
      // did and nothing will: observe-and-report only is a confirmed decision,
      // there is no quarantine and no move anywhere in this feature. The file is
      // in a folder that syncs, so by the time this toast is on screen it may
      // well already be in the cloud. Saying "blocked", "held", "quarantined" or
      // "moved" here would each be false.
      this.toast.show({
        title: `${ident.product} - ${fileEvent.severity.toUpperCase()} file detected`,
        message: `${fileEvent.filename}\n${contains}\n`
          + 'This was DETECTED AND REPORTED only — nothing was blocked, moved or removed, and the file '
          + 'may already have synced to the cloud.\nReported to CloudFuze AI Governance.',
      });
    } catch (err) {
      if (scannable) this.#releaseAttachHold(filename);
      this.log?.warn(`os_monitor: egress file event build failed: ${err?.message || err}`);
    }
  }

  #hostGovernedFor(processName) {
    if (!processName || !isHostAppProcess(processName)) return null;
    const g = this.hostGoverned;
    if (!g || !g.process) return null;
    const base = String(processName).replace(/\.exe$/i, '').trim().toLowerCase();
    return String(g.process).replace(/\.exe$/i, '').trim().toLowerCase() === base ? g : null;
  }

  // ── Tokenize & Send: what the BLOCK knew, for the REWRITE that follows ─────
  //
  // The helper's `rewrite` line carries the outcome, the block id and (on a
  // verified send) the masked text — and nothing else: no process, no panel and
  // no pattern list (see EmitRewrite in enforcer-win.ps1). So the audit record
  // for a completed rewrite reuses the values the BLOCK that armed it already
  // derived and already reported, verbatim. Re-deriving them here would be a
  // second copy that could disagree with the block's own record; re-SCANNING is
  // not even an option, because the only text this side ever sees again is the
  // masked one, which by construction matches nothing.
  //
  // SINGLE SLOT, mirroring the helper: enforcer-win.ps1 pins exactly one
  // pending block (_pendingBlockId) and a rewrite is single-use and bound to
  // it, so once a second block is armed the first can no longer be rewritten.
  // It is keyed on block_id all the same, so a late or stale rewrite can never
  // be attributed to a different block's patterns.
  //
  // NO CONTENT, EVER. Only the fields the 'block' handler already enqueues: a
  // pattern-NAME list with severities and counts, a product identity, a
  // process name, and the block's agent attribution (admin-typed row values /
  // our own catalog ids — see blockAgentAttribution()). The composer text, the `preview` masked substring and the
  // masked prompt are all absent by construction — the masked prompt travels on
  // the rewrite event itself and is read there, at the one site that reports it.
  // One sensitive typed (or, for an evidence route, pasted) prompt → one
  // prompt_typed / prompt_paste record. Shared by the prompt watcher and the
  // enforcer's evidence routes so the two can never drift apart on what is sent.
  //
  // For an ENFORCER event (a Teams agent route or an Office / Outlook pane):
  //   * NO window_title. A Teams title carries a colleague's name and two
  //     addresses; an Outlook title is a mail subject. The enforcer does not
  //     send one, and nothing here derives one.
  //   * agent attribution — agent_name / agent_id / agent_scope / surface — by
  //     the same row / sole / none rules as enforcement_block
  //     (blockAgentAttribution), never a UI-read name.
  //   * kind prompt_paste when the enforcer saw a paste gesture within its paste
  //     window (cause:"paste"), else prompt_typed. Either way content_text is
  //     the composer text, the same data class the watcher sends.
  #reportPromptText(ev, { fromEnforcer }) {
    // Panel-first, same as the enforcer handlers: the watcher now only reads an
    // IDE's focused element when it matched an AI panel signature, and it says
    // which one — so a prompt typed into Claude Code inside Cursor is
    // attributed to Claude Code, not to the host editor.
    const ai = identifyEventAi(ev);
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

    const pasted = fromEnforcer && ev.cause === 'paste';
    this.reporter.enqueue({
      kind: pasted ? 'prompt_paste' : 'prompt_typed',
      source: 'os_monitor_uia',
      service: ai.product,
      vendor: ai.vendor,
      process_name: ev.process,
      // Only the watcher's own events carry a title; see the note above.
      ...(fromEnforcer ? {} : { window_title: ev.title }),
      content_length: ev.len,
      length_bucket: lengthBucket(ev.len),
      matches,
      highest_severity: highestSeverity,
      content_text: ev.text,
      ...(fromEnforcer ? blockAgentAttribution(ev) : {}),
    });
    // Product and pattern names only — no agent, no text.
    this.log?.info(
      `os_monitor: ${pasted ? 'pasted' : 'typed'} into ${ai.product} — ${matches.length} pattern(s), ` +
      `severity=${highestSeverity} [${matches.map((m) => m.pattern).join(', ')}]`
    );

    if (highestSeverity === 'critical' || highestSeverity === 'high') {
      const patterns = matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ');
      this.toast.show({
        title: `${ai.product} - ${highestSeverity.toUpperCase()}`,
        message: `Sensitive content ${pasted ? 'pasted' : 'typed'} into the prompt: ${patterns}\nReported to CloudFuze AI Governance.`,
      });
    }
  }

  // The persisted last-known fleet `dlp` value: true / false, or false when
  // there is no readable record. Never throws.
  #lastKnownFleetEvidenceDlp() {
    try {
      const v = JSON.parse(readFileSync(this.fleetStatePath, 'utf8'));
      return v?.dlp === true;
    } catch { return false; }
  }

  #persistFleetEvidenceDlp(on) {
    try {
      mkdirSync(dirname(this.fleetStatePath), { recursive: true });
      writeFileSync(this.fleetStatePath, JSON.stringify({ dlp: on === true, at: new Date().toISOString() }), 'utf8');
    } catch (err) {
      this.log?.warn(`os_monitor: could not persist the fleet dlp flag — ${err?.message || err}`);
    }
  }

  #pinRewriteContext(payload) {
    this.rewriteContext = { ...payload, pinnedAt: Date.now() };
  }

  // The matching pin, consumed. Returns null — never a partial guess — when
  // there is nothing pinned, when the ids disagree, or when the pin is older
  // than a rewrite could possibly take; the caller then omits the fields it
  // cannot determine rather than inventing them.
  #takeRewriteContext(blockId) {
    const ctx = this.rewriteContext;
    // A mismatch leaves the pin alone: it may belong to a NEWER block whose own
    // rewrite has not happened yet, and clearing it here would cost that one
    // its match fields.
    if (!ctx || !blockId || ctx.block_id !== blockId) return null;
    this.rewriteContext = null;  // single-use, like the helper's own pin
    if (Date.now() - ctx.pinnedAt > REWRITE_CONTEXT_TTL_MS) return null;
    return ctx;
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

  // ── Tokenize & Send (desktop, non-Electron) ────────────────────────────────
  //
  // The offer half of the feature. Everything that COMPUTES the mask and
  // performs the rewrite already existed and already worked
  // (enforcer-win.ps1's ComputeMaskCandidate / RunRewrite, reached by the
  // {cmd:'tokenize', block_id} stdin command Enforcer.tokenize writes) — but the
  // popup that asks the user had only ever been built for Electron
  // (electron/renderer/block-dialog.js, opened by main.js off the @@CFAI-BLOCK
  // line). On the CLI agent there is no Electron, so nothing ever opened it and
  // the whole feature was unreachable: the user got the plain "Send blocked …
  // Override (logged): Ctrl+Alt+Enter" toast and no way to choose. Confirmed by
  // live testing, across every app the enforcer covers. This is the missing
  // trigger, and NOTHING downstream of it changed.
  //
  // NO CONTENT LEAVES THE MACHINE ON THIS PATH, and none is logged. Two values
  // reach the popup: the matched pattern NAMES the block already reported, and
  // `ev.preview` — which is the enforcer's already-masked text, the same string
  // it would type into the composer. The original prompt is not on this side of
  // the pipe at all.
  //
  // What comes back is one word, plus — for the popup's "Edit manually" → Send
  // outcome only — the user's own rewording of that already-masked text. That
  // string is passed straight back to the enforcer as the thing to type and is
  // touched by nothing else here: not logged, not reported, not stored. The
  // audit record for the send still comes from the enforcer's own verified
  // rewrite line, as it always did (see the 'rewrite' handler).
  //
  // STALENESS is the enforcer's to judge, deliberately. Its pin is single-use,
  // bound to the exact element/window/text it was computed from, and expires
  // (REWRITE_TTL, 15s); StartRewrite answers a wrong or late id with
  // "stale_block_id"/"expired" and RunRewrite re-verifies foreground window,
  // element runtime id and composer text before it types anything. A second
  // clock here could only disagree with that one.
  async #offerTokenize(ev, ai) {
    const blockId = String(ev.block_id || '');
    if (this.tokenizeOfferInFlight.has(blockId)) return;
    this.tokenizeOfferInFlight.add(blockId);
    // Whether we asked the enforcer to hold its pin for a text box that opened.
    // Released on every path that does not go on to consume it, so a cancelled
    // edit does not leave a block pinned for the hold's full window.
    let editHold = false;
    try {
      const result = await this.toast.showTokenizeDialog({
        appName: ai.product || ev.process || '',
        categories: ev.patterns || '',
        preview: ev.preview || '',
        dedupeKey: blockId,
        // The popup's "Edit manually" box has opened. It has to hold keyboard
        // focus to be typed into, and the enforcer's poll thread used to drop
        // its pinned block the moment the foreground stopped being the AI app —
        // so it is told, and holds the pin for as long as typing takes instead.
        // An id and an on/off; no content on this call at all.
        onEditing: () => { editHold = this.enforcer.tokenizeEditHold(blockId, true); },
      });

      // "Edit manually" → the user reworded the masked text and pressed Send.
      // The SAME rewrite mechanism, asked to type THEIR string instead of the
      // enforcer's own masked candidate — which the enforcer re-gates for
      // length and write budget, re-verifies the target for, and rescans the
      // read-back of, exactly as it does its own. It consumes the hold.
      if (result.action === 'edit_send') {
        const text = typeof result.text === 'string' ? result.text : '';
        // Nothing to type. Fail closed rather than clearing the composer and
        // sending an empty message; the enforcer refuses this too.
        if (!text.trim()) {
          this.log?.warn('tokenize: the edit box came back empty — nothing was rewritten and the block stands');
          return;
        }
        // The hold is CONSUMED, not released: the command below reads the pin's
        // extended expiry, and the enforcer's own poll thread puts it back to
        // the normal TTL on its next tick over that surface.
        editHold = false;
        if (!this.tokenize(blockId, text)) {
          this.log?.warn('tokenize: enforcer stdin unavailable — nothing was rewritten and the block stands');
        }
        return;
      }

      // 'edit' / 'timeout' / 'suppressed' / 'unavailable' — DO NOTHING. The block
      // stands and the user edits the prompt themselves, which is exactly the
      // behaviour this path had before the popup existed, so every non-answer
      // degrades to the safe outcome rather than to a send.
      if (result.action !== 'tokenize') return;
      // The SAME command the Electron dialog's 'tokenize-block' IPC handler
      // writes, through the same wrapper — this is a second trigger for one
      // mechanism, not a second mechanism.
      if (!this.tokenize(blockId)) {
        this.log?.warn('tokenize: enforcer stdin unavailable — nothing was rewritten and the block stands');
      }
    } finally {
      // Every path that did NOT go on to use the hold gives it back — including
      // a popup that threw, which is why this lives in the finally rather than
      // next to each outcome.
      if (editHold) this.enforcer.tokenizeEditHold(blockId, false);
      this.tokenizeOfferInFlight.delete(blockId);
    }
  }

  // ── Request Access (desktop, non-Electron) ─────────────────────────────────
  //
  // Driven by the enforcer's request_access_offer line, i.e. by the instant a
  // platform/agent/panel block swallowed a send. Four steps, in this order,
  // because each one can end the flow without bothering the user:
  //   1. resolve the block's identity (host / agent / scope) from the ARMED ROW
  //      the enforcer reported — never from anything read off the screen;
  //   2. ask the server whether this device already has a request open for that
  //      exact agent, so a second block does not become a second ask;
  //   3. open the ephemeral dialog and wait for submit/cancel;
  //   4. POST it, or park it in the single-slot offline queue.
  //
  // NOTHING the user typed into the AI app travels on this path. The only free
  // text is the reason they type into the dialog, which is the whole point of it.
  async #offerAccessRequest(ev) {
    const ai = identifyEventAi(ev) || { product: ev.process, vendor: null };
    // The SAME resolver the 'block' relay uses — see blockToolHost().
    const toolHost = blockToolHost(ev);
    const agentId = String(ev.blocked_agent_id || '').trim();
    const agentName = String(ev.blocked_agent || '').trim();
    // 'agent' ONLY when the enforcer says it armed on a named agent AND it has
    // an identity to name. The server rejects block_scope:'agent' with neither
    // (400), and claiming agent scope for a whole-app block would mint an
    // agent-keyed exception that lifts nothing. A 'panel' block is passed
    // through as itself: the server accepts it and keys the grant on the host,
    // which is correct — a panel is not a named agent.
    const blockScope = ev.block_scope === 'agent' && (agentId || agentName)
      ? 'agent'
      : ev.block_scope === 'panel' ? 'panel' : 'app';

    if (!toolHost) {
      // Nothing to ask for: an exception is granted against a host, and this
      // catalog carries none for this process/panel/platform. Silent to the
      // user by design — a dialog whose Submit could only ever fail is worse
      // than no dialog.
      this.log?.warn(`access-request: no tool_host for ${ev.process || '(unknown process)'} — no dialog offered`);
      return;
    }

    const identity = { tool_host: toolHost, block_scope: blockScope, agent_id: agentId, agent_name: agentName };
    const key = `${toolHost.toLowerCase()}|${agentMatchKey(identity)}`;
    if (this.accessRequestInFlight.has(key)) return;
    this.accessRequestInFlight.add(key);
    try {
      const subject = blockScope === 'agent' && agentName ? agentName : (ai.product || ev.process || toolHost);
      if (!this.serverUrl || !this.token) {
        this.toast.show({
          title: `${subject} is blocked`,
          message: 'This device is not enrolled with CloudFuze AI Governance, so it cannot request access.\n'
            + 'Ask your administrator to enroll it.',
        });
        return;
      }

      const already = await this.#findOpenAccessRequest(identity);
      if (already) {
        this.toast.show({
          title: `${subject} - request already open`,
          message: already === 'queued'
            ? 'Your access request for this is saved and will be sent as soon as this device is back online.'
            : 'You already have a pending access request for this. Your administrator has not answered it yet.',
        });
        return;
      }

      const result = await this.toast.showRequestDialog({
        agentName: blockScope === 'agent' ? agentName : '',
        appName: ai.product || ev.process || toolHost,
        dedupeKey: key,
      });
      if (result.action === 'unavailable') {
        this.toast.show({
          title: `${subject} is blocked`,
          message: 'Access requests cannot be shown on this device right now.\n'
            + 'Ask your administrator for temporary access to it.',
        });
        return;
      }
      // 'cancel' / 'suppressed' / 'timeout' — the user said no, or a dialog for
      // this same block session is already on screen. Nothing is sent, and
      // nothing is said: they know what they just dismissed.
      if (result.action !== 'submit') return;

      await this.#submitAccessRequest({
        ...identity,
        tool_name: ai.product || ev.process || toolHost,
        tool_vendor: ai.vendor || '',
        platform: ev.blocked_platform || '',
        process_name: ev.process || '',
        reason: String(result.reason || '').slice(0, REASON_MAX),
      }, subject);
    } finally {
      this.accessRequestInFlight.delete(key);
    }
  }

  // 'server' | 'queued' | null. Fails OPEN (returns null) on any error: the
  // pre-check is a courtesy that saves the user a pointless dialog, and the
  // server enforces the real rule — a duplicate POST comes back 409 and is
  // surfaced as such. Refusing to show a dialog because /mine was unreachable
  // would be the wrong trade.
  async #findOpenAccessRequest(identity) {
    const wantKey = agentMatchKey(identity);
    const wantHost = String(identity.tool_host || '').toLowerCase();
    // The local queue first — it is free, and a request parked there has not
    // reached the server yet, so it can never come back on /mine.
    try {
      if (existsSync(PENDING_REQUEST_PATH)) {
        const queued = JSON.parse(readFileSync(PENDING_REQUEST_PATH, 'utf8'));
        if (String(queued?.tool_host || '').toLowerCase() === wantHost && agentMatchKey(queued) === wantKey) {
          return 'queued';
        }
      }
    } catch {
      // Unreadable queue file — blocked-agents-sync.js drops it on its own tick.
    }
    try {
      const res = await fetch(`${this.serverUrl}/api/v1/access-requests/mine`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows)) return null;
      const hit = rows.find((r) => r?.status === 'pending'
        && String(r.tool_host || '').toLowerCase() === wantHost
        // PER AGENT, not per host: "pending" for the finance bot is not an
        // answer about the IT help-desk bot, and the server's own 409 is keyed
        // the same way. Both sides fold the identity with agentMatchKey.
        && agentMatchKey(r) === wantKey);
      return hit ? 'server' : null;
    } catch (err) {
      this.log?.warn(`access-request: pre-check failed — ${err?.message || err}`);
      return null;
    }
  }

  // POST /api/v1/access-requests with the enrolment machine JWT — the same
  // bearer token the Reporter and blocked-agents-sync.js use. The server derives
  // machine_id and hostname from the verified claims and ignores anything the
  // body says about them, and it derives agent_key from block_scope + the agent
  // identity, so none of that is sent.
  async #submitAccessRequest(body, subject) {
    const payload = { ...body, surface: 'desktop' };
    try {
      const res = await fetch(`${this.serverUrl}/api/v1/access-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        this.log?.info(`access-request: submitted for ${payload.tool_host} (scope=${payload.block_scope})`);
        this.toast.show({
          title: `${subject} - access request sent`,
          message: 'Your administrator has been notified. You will be able to use it here if they approve.',
        });
        return;
      }
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) {
        this.toast.show({
          title: 'Access request not sent',
          message: 'This device needs to be enrolled again before it can request access.\nAsk your administrator.',
        });
      } else if (res.status === 409) {
        this.toast.show({
          title: `${subject} - request already open`,
          message: 'You already have a pending access request for this.',
        });
      } else if (res.status === 429) {
        // The server's own cooldown, with its own retry time — never a number
        // invented here, which would drift from the server's REJECT_COOLDOWN_MS.
        const when = err?.retry_after ? new Date(err.retry_after) : null;
        const whenText = when && !Number.isNaN(when.getTime()) ? ` You can ask again after ${when.toLocaleString()}.` : '';
        this.toast.show({
          title: `${subject} - request declined`,
          message: `This request was reviewed and declined recently.${whenText}`,
        });
      } else {
        this.toast.show({
          title: 'Access request not sent',
          message: String(err?.error || `The server returned ${res.status}.`).slice(0, 300),
        });
      }
      this.log?.warn(`access-request: server returned ${res.status} for ${payload.tool_host}`);
    } catch (netErr) {
      // Offline. Park it in the single slot blocked-agents-sync.js drains on its
      // 10s tick (24h TTL, and a second Submit overwrites rather than stacks).
      try {
        mkdirSync(dirname(PENDING_REQUEST_PATH), { recursive: true });
        writeFileSync(
          PENDING_REQUEST_PATH,
          JSON.stringify({ ...payload, queued_at: new Date().toISOString() }, null, 2),
          'utf8',
        );
        this.toast.show({
          title: `${subject} - access request saved`,
          message: 'This device is offline. Your request will be sent automatically once it can reach the server.',
        });
        this.log?.info(`access-request: offline — queued for ${payload.tool_host}`);
      } catch (writeErr) {
        this.toast.show({
          title: 'Access request not sent',
          message: 'This device could not reach the server and could not save the request. Please try again.',
        });
        this.log?.warn(`access-request: offline and could not queue — ${netErr.message} / ${writeErr.message}`);
      }
    }
  }

  /**
   * One UI relay, two channels.
   *
   * Emits the payload as a structured `ui` event — `monitor.on('ui', …)` — and
   * returns it unchanged so the caller can hand the very same object to the
   * legacy `@@CFAI-*` stdout line that Electron's main.js scrapes. The event is
   * the channel every non-Electron consumer uses (the CLI); the stdout copy only
   * prints when `legacyStdout` is set, because a CLI run has no scraper.
   *
   * `kind` is spread FIRST so a payload that already carries its own `kind`
   * (the raw enforcer events relayed on @@CFAI-REWRITE / @@CFAI-ROUTE) keeps it.
   *
   * WHY THE GATE IS A SINK, NOT AN `if` AT EACH SITE. The relay lines are a
   * pinned contract: main.js parses them byte-for-byte (its own comment says the
   * @@CFAI-BLOCK guard is "left byte-for-byte as it was" because a test pins its
   * exact text), and tests pin this side by slicing the source forward from each
   * relay call to read the payload literal that follows it. So the payload
   * literal has to stay inside that call — which is also what keeps it the single
   * source of truth for both channels instead of being duplicated per site.
   * #console is the real console when legacyStdout is set and a no-op sink
   * otherwise, so nothing is ever printed without a consumer, while the emit
   * above always happens.
   */
  #ui(kind, payload) {
    this.emit('ui', { kind, ...payload });
    return payload;
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

    // Set AFTER the platform guard, which starts nothing: on an unsupported
    // platform the monitor never runs, so it must never look like it did.
    this.isRunning = true;

    this.reporter.start();
    this.toast.start();
    this.policySync.start();

    this.poller.on('focus', (ev) => {
      const ai = identifyAiProcess(ev.process);
      this.currentFocus = { pid: ev.pid, process: ev.process, title: ev.title, aiInfo: ai };
      if (ai) {
        // NO TITLE FOR A HOST APP. A Microsoft Teams window title is measured to
        // read "Chat | Sruthi Chimata | CloudFuze, Inc | p@cloudfuze.com |
        // Microsoft Teams" (see the teams_desktop entry in ai-processes.js) — a
        // colleague's name plus two email-identifiable parties. Logging that for
        // every Teams focus wrote the user's private contact graph into the
        // agent's own log file. Everything else about the focus event still
        // logs, so the line stays useful for debugging.
        this.log?.info(
          isHostAppProcess(ev.process)
            ? `os_monitor: AI process focused — ${ai.product} (pid=${ev.pid}, title suppressed: host app)`
            : `os_monitor: AI process focused — ${ai.product} (pid=${ev.pid}, title="${ev.title}")`
        );
      }
    });

    this.poller.on('clipboard', (ev) => {
      // The poller emits clipboard events only when *some* process is focused;
      // we filter to AI processes here so non-AI activity is ignored.
      const ai = identifyAiProcess(ev.process);
      if (!ai) return;
      // …and a HOST APP is not an AI surface, even though identifyAiProcess
      // names one. This handler reports the FULL clipboard text (content_text
      // below) plus the window title, and the only thing it knows is "Teams is
      // focused" — not which conversation. That is a private 1:1 DM with a
      // colleague as often as it is an agent chat, so there is nothing to
      // narrow here and the whole path is skipped, exactly as
      // watcherProcessNames() already skips host apps for every watcher that
      // takes a process list. Narrow capture inside an already-identified
      // governed agent conversation is enforcer-win.ps1's job, gated on a
      // blocked agent actually being open.
      if (isHostAppProcess(ev.process)) return;

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
      // HOST APPS: excluded unless the enforcer says this exact conversation is
      // governed or blocked.
      //
      // The guard is BEFORE buildFileUploadEvent() rather than after, because
      // that helper reads the file off disk and puts its bytes on the event
      // (content_text / content_base64) — running it at all for a file pasted
      // into an unknown Teams conversation is already the leak. When
      // #hostGovernedFor() answers null nothing is read, extracted, scanned or
      // reported, exactly as before.
      //
      // This is the ONE clipboard site that governance opens. The clipboard-TEXT
      // handler above stays unconditionally excluded for host apps: typed and
      // pasted prompt text inside a governed Teams conversation is already
      // handled, narrowly and at the element level, by enforcer-win.ps1 — a
      // second, window-level copy of it here would report the whole clipboard
      // with the window title attached, which is what that exclusion exists to
      // prevent. Files are different: nothing else can see them.
      const governed = this.#hostGovernedFor(ev.process);
      if (isHostAppProcess(ev.process) && !governed) return;

      for (const p of (ev.paths || [])) {
        try {
          const fileEvent = await buildFileUploadEvent({
            path: p,
            via: 'clipboard_file_copy',
            service: ai.product,
            vendor: ai.vendor,
            processName: ev.process,
            // NO WINDOW TITLE for a host app — a Teams title carries a
            // colleague's name and two email addresses (see the focus handler).
            // The agent fields below say which conversation it was, which is the
            // part that has governance value.
            windowTitle: governed ? '' : ev.title,
            log: this.log,
          });
          if (!fileEvent) continue;
          if (governed) this.#attributeToAgent(fileEvent, governed);

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
      // Same eligibility gate the attachment-chip watcher already applies
      // below: an IDE's File > Open dialog is not an AI upload. Without this,
      // opening any file in Cursor got reported as if it had been uploaded to
      // an AI — the dialog fires for every "Open" the OS shows this process,
      // not just an AI app's own attach-file picker.
      //
      // A HOST APP reaches this through the second clause instead. It is
      // deliberately NOT in isAttachmentWatcherEligible's catalog answer (Teams
      // ships useAttachmentWatcher:false as well as hostApp:true) — the helper's
      // own $ArmedHostProcs is what let the dialog be tracked at all, and this is
      // the Node-side statement of the same rule. `host_armed` on the event is
      // the helper's LATCHED answer from when the picker opened, which is the
      // only correct time to ask: a picker steals focus from Teams, so
      // this.hostGoverned is usually already null by the time it closes.
      const governed = this.#hostGovernedFor(ev.process);
      const hostPick = isHostAppProcess(ev.process) && ev.host_armed === true;
      if (!isAttachmentWatcherEligible(ev.process) && !hostPick) return;
      try {
        const fileEvent = await buildFileUploadEvent({
          path: ev.path,
          via: 'open_file_dialog',
          service: ai.product,
          vendor: ai.vendor,
          processName: ev.process,
          // The dialog's own window Name ("Open"), and never a Teams window
          // title — see the clipboard_files handler for why that distinction
          // matters for a host app.
          windowTitle: hostPick ? '' : ev.title,
          log: this.log,
        });
        if (!fileEvent) return;
        // The conversation the picker was opened FROM, when we still know it.
        // Null when the user browsed long enough for the govstate to have
        // cleared — the file is still reported and still held, just without an
        // agent name, which is the honest outcome rather than a guess.
        if (hostPick && governed) this.#attributeToAgent(fileEvent, governed);

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
      //
      // A HOST APP is never eligible by catalog answer and never will be. It
      // reaches this handler at all only because a govstate armed the helper for
      // it, and only for as long as that arming lasts — so the second clause is
      // the Node-side statement of the same rule the helper's $ArmedHostProcs
      // enforces. In a plain Teams chat #hostGovernedFor() is null, the event
      // cannot even be produced, and if one somehow were it would stop here:
      // nothing read, nothing scanned, nothing held, nothing reported.
      //
      // The eligibility answer for a host app is the helper's LATCHED
      // `host_armed`, not a fresh read of this.hostGoverned — the same choice,
      // for the same reason, as the file-picker route above. govstate is
      // edge-triggered on the focused ELEMENT, and every way of attaching a file
      // moves focus off the composer (a drag makes Explorer the foreground
      // window; the paperclip opens a flyout or a picker), so by the time a chip
      // is visible this.hostGoverned has usually already gone null. Gating on it
      // rejected exactly the attachments this route exists to catch. `host_armed`
      // is the helper's answer from the tick the chip was actually seen, and the
      // helper only ever looks at Teams while armed.
      const governed = this.#hostGovernedFor(ev.process);
      const hostChip = isHostAppProcess(ev.process) && ev.host_armed === true;
      if (!isAttachmentWatcherEligible(ev.process) && !governed && !hostChip) {
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
      //
      // …and it is now REFRESHED while it is provisional (see
      // #syncAttachHold / attachHoldRefreshTimer). Before, only the confirmed
      // hold was, so a slow extraction — OCR, a large PDF, a deep zip, i.e.
      // exactly the files most worth holding — outlasted the provisional hold's
      // own 3s TTL and the send went through before the scan that would have
      // confirmed it had even returned.
      const scannable = isTextReadable(ev.filename) || isBinaryParseable(ev.filename) || isImage(ev.filename) || isArchive(ev.filename);
      if (scannable) {
        this.#armAttachHold(ev.filename, { patterns: '', ttlMs: 3000, processName: ev.process });
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
          if (scannable) this.#releaseAttachHold(ev.filename);
          return;
        }
        // Which governed Teams conversation this came from, when it came from
        // one. Null for every ordinary AI app.
        if (governed) this.#attributeToAgent(fileEvent, governed);

        // CONFIRMED hold — high/critical, matching the browser extension's
        // existing file-upload block threshold, PLUS the fail-closed case
        // below. A longer TTL than the provisional one, and kept alive for as
        // long as the attachment stays present, since this is a real finding
        // that must survive until the file actually disappears.
        const cs = fileEvent.content_scan;
        const severity = fileEvent.severity;
        // ── FAIL CLOSED on a file we could not verify ──────────────────────
        //
        // `severity` cannot express this: a file that was never scanned has no
        // contentSeverity to raise, so an encrypted PDF or a password-protected
        // workbook full of customer data scores exactly what an empty one does.
        // content_scan.unverified is the fact (set in file-handler.js — it is
        // true only for a format that SHOULD have been readable, so media and
        // unknown extensions are untouched and still fail OPEN).
        //
        // ONLY INSIDE A GOVERNED OR BLOCKED CONVERSATION. Everywhere else the
        // severity threshold is exactly what it was: escalating on "we could not
        // read it" for every app would start blocking .7z archives and legacy
        // .doc files across the board, which nobody asked for. Where the org HAS
        // asked for the conversation to be governed, "we could not verify this"
        // is a reason to hold the send rather than a reason to wave it through.
        const unverified = cs?.scanned !== true && cs?.unverified === true;
        // `|| hostChip` for the same reason the eligibility gate above carries it:
        // inside a governed conversation is the condition, and the helper's latch
        // is the reliable statement of it. A live-only read would fail OPEN on an
        // unscannable file whenever the govstate had already bounced — i.e. on
        // nearly every real attachment. Still false for every non-host app, so
        // "fail closed is governed-only" is unchanged.
        const inGovernedConversation = !!governed || hostChip;
        const failClosed = inGovernedConversation && unverified;
        const shouldHold = severity === 'high' || severity === 'critical' || failClosed;
        if (shouldHold) {
          // For a fail-closed hold there are no pattern names to report, so the
          // reason itself is what the block names — the toast has to be able to
          // say WHY, and "high" would be a claim about content nobody read.
          const patternNames = failClosed && !(cs?.matches || []).length
            ? `unscannable file (${cs?.reason || 'not readable'})`
            : (cs?.matches || []).map((m) => m.pattern).join(',') || fileEvent.file_class;
          this.#armAttachHold(ev.filename, {
            patterns: patternNames, severity, ttlMs: 60_000, processName: ev.process,
          });
        } else {
          // Scan came back clean (or below the hold threshold) — release the
          // provisional hold armed above rather than letting it ride out its
          // TTL with the send needlessly stuck. A no-op when this file was
          // never held, and it releases ONLY this file: other flagged files
          // still in the map keep the hold in force.
          this.#releaseAttachHold(ev.filename);
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
        // Release the PROVISIONAL hold on the way out. Without this an
        // extraction that threw left Enter dead until the helper's own TTL
        // lapsed, with nothing on screen to explain it — and the refresh ticker
        // now keeps that TTL from lapsing at all, so the leak became permanent.
        if (scannable) this.#releaseAttachHold(ev.filename);
        this.log?.warn(`os_monitor: attachment event build failed: ${err?.message || err}`);
      }
    });

    // Release a hold when the flagged chip itself disappears (removed by the
    // user, or — a known limitation, see attachment-watcher.ps1's own
    // comment — scrolled out of the UIA tree in a long chat). Best-effort:
    // if this fires wrongly for a still-present file, the next
    // attachment_appeared poll tick will just re-observe it and re-arm.
    //
    // PER FILE, via the hold map: removing one attachment deletes only its own
    // key and re-states the hold with the remaining files' patterns. The old
    // single-slot version released EVERYTHING here, so removing a clean
    // attachment unblocked a send that a sensitive one was still holding.
    this.attachmentWatcher.on('attachment_disappeared', (ev) => {
      if (!this.#releaseAttachHold(ev.filename)) return;
      this.log?.info(
        `os_monitor: attachment "${ev.filename}" removed — ` +
        (this.attachHolds.size === 0
          ? 'send hold released'
          : `hold still active for ${this.attachHolds.size} other file(s)`)
      );
    });

    // ── EGRESS: a file attached to an email ──────────────────────────────────
    //
    // Its OWN handler, sharing no condition with the AI/host-app attachment
    // handler above — which is left byte-for-byte untouched. The events cannot
    // even reach that handler: attachment-watcher.ps1 emits a different kind for
    // an egress chip, and the watcher wrapper dispatches it under a different
    // name.
    //
    // There is NO eligibility test here beyond "the event exists", and that is
    // correct rather than lax: the helper only ever produced this event because
    // ~/.cloudfuze-aigov/egress-surfaces.json armed the process (which requires a
    // governed ai_platforms row) AND the compose pane resolved as a scoped root.
    // Both gates are upstream, in the process that did the reading, so a
    // duplicate test here would only be a second thing to keep in step. What IS
    // re-tested is the surface itself: an event naming a surface this catalog
    // does not carry is dropped.
    this.attachmentWatcher.on('egress_attachment_appeared', async (ev) => {
      if (!identifyEgressSurface(ev.surface)) return;
      if (!ev.path) {
        // A filename-shaped string in the compose pane that resolves to no file
        // on disk. Nothing to scan, and arming a hold on a file we cannot read
        // would be an unexplained dead send chord in a mail client — strictly
        // worse than the miss. Same reasoning as the AI path's !ev.path case.
        this.log?.info(`egress: "${ev.filename}" appeared in a compose window but was not found on disk`);
        return;
      }
      await this.#reportEgressFile({
        path: ev.path,
        filename: ev.filename,
        via: 'email_attachment_chip',
        surfaceId: ev.surface,
        processName: ev.process,
        hold: true,
      });
    });

    // The attachment was removed from the draft — release its hold. PER FILE,
    // through the same map the AI path uses: removing one attachment must not
    // unblock a send another, still-attached, flagged file is holding.
    this.attachmentWatcher.on('egress_attachment_disappeared', (ev) => {
      if (!this.#releaseAttachHold(ev.filename)) return;
      this.log?.info(
        `os_monitor: egress attachment "${ev.filename}" removed — `
        + (this.attachHolds.size === 0 ? 'send hold released' : `hold still active for ${this.attachHolds.size} other file(s)`)
      );
    });

    // ── EGRESS: a file picked in a mail client's Attach dialog ───────────────
    //
    // The more reliable of the two mail attachment routes, and the one that needs
    // no live-probed signature at all: a file picker only ever opens because the
    // user deliberately clicked Attach, so there is no "is this the compose
    // window or the reading pane" question to answer. Separate handler from
    // file_dialog_pick for the same reason as above.
    this.dialogWatcher.on('egress_file_dialog_pick', async (ev) => {
      if (!identifyEgressSurface(ev.surface)) return;
      if (!ev.path) return;
      await this.#reportEgressFile({
        path: ev.path,
        filename: basename(ev.path),
        via: 'email_attach_dialog',
        surfaceId: ev.surface,
        processName: ev.process,
        hold: true,
      });
    });

    // ── EGRESS: a file appearing in a OneDrive / SharePoint sync root ────────
    //
    // OBSERVE AND REPORT ONLY — hold:false, and there is no code anywhere in this
    // feature that moves, renames or quarantines the file. That is a confirmed
    // product decision, and the toast copy states it plainly rather than implying
    // an intervention that did not happen.
    //
    // `origin` is the direction heuristic, and the helper has ALREADY dropped
    // every file it classified `sync_down`: reporting a download as an upload
    // would be a false governance record naming this user as the person who sent
    // a file they never touched. What arrives here is 'local_new' or 'unknown',
    // and the label travels onto the record so the dashboard can weigh a
    // confident local write differently from an ambiguous one.
    this.syncWatcher.on('sync_file', async (ev) => {
      // Defence in depth on the surface too, matching the two attachment routes
      // above: an event naming a root this catalog does not carry is dropped
      // rather than reported under an invented identity.
      if (!identifyEgressSurface(ev.root_id)) return;
      // Defence in depth: the helper does not emit sync_down, and if some future
      // build ever did, this side refuses it too rather than trusting the sender.
      //
      // NORMALIZED BEFORE COMPARING, because a case-sensitive === against one
      // spelling is not defence in depth at all: the whole premise of this line
      // is that the sender might not be the helper we shipped, and 'Sync_Down'
      // from such a sender would have sailed straight through a `=== 'sync_down'`
      // test and been filed as an upload — the exact false record the check
      // exists to prevent.
      const origin = String(ev.origin ?? '').trim().toLowerCase();
      if (origin === 'sync_down') return;
      if (!ev.path) return;
      await this.#reportEgressFile({
        path: ev.path,
        filename: basename(ev.path),
        via: 'cloud_sync_root',
        surfaceId: ev.root_id,
        // No process: nothing was in the foreground when this happened, and
        // inventing one would be a claim about who did it.
        processName: '',
        // CLAMPED to the two labels #reportEgressFile's own contract promises.
        // Anything else lands on 'unknown' rather than travelling onto a
        // governance record as an uninterpretable string: 'unknown' is already
        // the honest answer for "we could not establish the direction", and a
        // dashboard filtering on origin must not have to know every spelling a
        // future helper might invent.
        origin: (origin === 'local_new' || origin === 'unknown') ? origin : 'unknown',
        hold: false,
      });
    });

    // A COVERAGE GAP, recorded rather than swallowed. The FileSystemWatcher's
    // buffer overflowed (or our own per-minute ceiling engaged), so files really
    // did appear in a watched folder without being observed. This is reported as
    // its own event precisely because the honest thing a governance product can
    // say about a window it did not see is "I did not see it".
    this.syncWatcher.on('overflow', (ev) => {
      const ident = identifyEgressSurface(ev.root_id) || { product: 'OneDrive / SharePoint', vendor: 'Microsoft' };
      this.reporter.enqueue({
        kind: 'coverage_gap',
        source: 'os_monitor_egress',
        service: ident.product,
        vendor: ident.vendor,
        via: 'cloud_sync_root',
        reason: String(ev.reason || 'unknown'),
      });
    });

    // ── EGRESS: the body of an email, captured ONCE at its send ──────────────
    //
    // Not a prompt, and deliberately not routed through the prompt_text handler:
    // that one resolves an AI product identity, which a mail client has none of.
    //
    // prompt-watcher.ps1 guarantees the ONCE: it holds the body between ticks and
    // emits only at the send transition (the body going non-empty → empty, or the
    // compose window closing while it still had text). Emitting per poll tick —
    // the naive shape — would produce roughly a hundred growing-prefix copies of
    // every email, each carrying its full text.
    this.promptWatcher.on('egress_body', (ev) => {
      const ident = identifyEgressSurface(ev.surface);
      if (!ident) return;
      const text = typeof ev.text === 'string' ? ev.text : '';
      if (!text) return;
      const { matches, highestSeverity } = scan(text);
      // Only sensitive bodies are recorded — the same policy every other capture
      // path here follows. An ordinary email is never stored.
      if (matches.length === 0) return;
      const sig = matches.map((m) => m.pattern).sort().join(',');
      if (!this.#shouldFire(`egress|${ev.surface}|${sig}`)) return;

      // DOMAINS ONLY. prompt-watcher.ps1 reduces the recipient field to bare
      // @domain tokens in the same expression that reads it, so a full address
      // has no parameter it could arrive through — and this side re-checks the
      // shape rather than trusting it, dropping anything that still looks like
      // an address. There is no subject-line field on this event, by construction.
      const recipientDomains = (Array.isArray(ev.recipient_domains) ? ev.recipient_domains : [])
        .map((d) => String(d || '').trim().toLowerCase())
        .filter((d) => /^@[a-z0-9.-]+\.[a-z]{2,}$/.test(d))
        .slice(0, 8);

      this.reporter.enqueue({
        kind: 'egress_body',
        source: 'os_monitor_egress',
        via: 'outlook_compose',
        service: ident.product,
        vendor: ident.vendor,
        process_name: ev.process || '',
        egress_surface: ev.surface,
        // ALWAYS EMPTY, exactly like every host-app file event: an Outlook
        // window title is the message subject plus, in a reply, the recipient's
        // display name.
        window_title: '',
        content_length: Number(ev.len) || text.length,
        length_bucket: lengthBucket(Number(ev.len) || text.length),
        // Set when the read hit prompt-watcher.ps1's $MaxChars (16000, unchanged
        // — deliberately not raised for email), so a prefix is never presented
        // as the whole message.
        body_truncated: ev.truncated === true,
        matches,
        highest_severity: highestSeverity,
        recipient_domains: recipientDomains,
        content_text: text,
      });
      this.log?.info(
        `os_monitor: egress body sent from ${ident.product} — ${matches.length} pattern(s), `
        + `severity=${highestSeverity} [${matches.map((m) => m.pattern).join(', ')}]`
        // The DOMAIN is loggable; a recipient is not, and no path here has one.
        + (recipientDomains.length ? ` to ${recipientDomains.join(', ')}` : '')
      );
      if (highestSeverity !== 'critical' && highestSeverity !== 'high') return;
      const patterns = matches.map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ');
      this.toast.show({
        title: `${ident.product} - ${highestSeverity.toUpperCase()}`,
        // DETECTED, not stopped. The body capture fires at the send transition,
        // i.e. the message has already gone. Nothing here blocked anything.
        message: `Sensitive content in an email that was just sent: ${patterns}\n`
          + 'This was detected and reported — the message was not blocked.\nReported to CloudFuze AI Governance.',
      });
    });

    // UIA typed-prompt watcher — reads what the user TYPES into an AI app's
    // prompt box (Claude Desktop, ChatGPT Desktop, etc.) and scans it. This is
    // the only coverage for typed (not pasted) secrets in vendor-sealed apps:
    // they pin TLS (proxy blind) and enforce ASAR integrity (no DOM hook).
    // Detect + notify + report only — UIA can't block another app's send.
    this.promptWatcher.on('prompt_text', (ev) => this.#reportPromptText(ev, { fromEnforcer: false }));

    // The SAME record for the AI-EVIDENCE routes — the Teams agent 1:1 chat and
    // Copilot tab, and the Word / Excel / PowerPoint / OneNote / Outlook Copilot
    // panes — which the prompt watcher cannot see (those apps are, and must
    // stay, out of its process list: every DM, email and document would be
    // read). enforcer-win.ps1 emits it behind exactly the gate that decides
    // scanning and blocking there (EmitEvidencePrompt), and only for a composer
    // that already holds an active pattern. Reported by the one shared method,
    // so the content fields are identical to ChatGPT/Claude desktop's.
    //
    // Gated on BOTH fleet flags the prompt-watcher path lives under: dlp (the
    // evidence routes) AND clipboard_monitor (typed-prompt capture itself —
    // the watcher is stopped when it is off). Either off: nothing is uploaded.
    this.enforcer.on('prompt_text', (ev) => {
      if (!this.running.dlp || !this.running.clipboard_monitor) return;
      this.#reportPromptText(ev, { fromEnforcer: true });
    });

    // Benign Enter-sends the enforcer lets through — captured from the SAME
    // reconstructed keystroke buffer the blocker uses (length only, no content).
    // This is what gives per-user prompt counts + token estimates for sealed
    // desktop apps like Claude Desktop, where UIA can't read the composer and
    // the DOM hook / proxy are both blocked. Sensitive sends never reach here —
    // they go through the 'block' path below — so there's no double counting.
    this.enforcer.on('prompt', (ev) => {
      // Panel-first: a prompt sent from the Claude Code panel arrives as
      // process:"Code" + panel:"claude_code", and "Code" resolves to nothing on
      // its own — this guard would have silently dropped it.
      const ai = identifyEventAi(ev);
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
      const ai = identifyEventAi(ev) || { product: ev.process, vendor: null };
      const patterns = (ev.patterns || '').split(',').filter(Boolean);
      const isAttachment = ev.reason === 'attachment';
      // A FULL PLATFORM BLOCK — the org disallowed this app outright, so
      // nothing about the message was scanned or is at fault. `patterns` on
      // this event is the enforcer's human-readable "Blocked agent: X" string,
      // NOT a pattern list, so it must not be reported as one; the browser
      // extension's equivalent (blocked_for:'platform') reports matches:[] too.
      const isPlatform = !!ev.platform_block;
      const matches = isPlatform ? [] : patterns.map((p) => ({ pattern: p, severity: 'high', count: 1 }));
      // Named rather than written inline in the enqueue below, so the rewrite
      // pin can carry the SAME value instead of a second copy of the same
      // expression that could later drift from it.
      const highestSeverity = isPlatform ? 'critical' : 'high';
      const agentName = ev.blocked_agent || ai.product;
      // The access-exception key — see blockToolHost(), which the Request
      // Access flow below shares so the two can never resolve a different host.
      const toolHost = isPlatform ? blockToolHost(ev) : '';
      // reason: 'send' (Enter) | 'paste' (Ctrl+V) | 'click' (send button) | 'attachment' (sensitive file attached).
      const reason = isPlatform ? 'platform' : isAttachment ? 'file_upload' : ev.reason === 'paste' ? 'prompt_paste' : 'prompt_submit';
      const how = isPlatform ? 'blocked platform' : isAttachment ? `attachment "${ev.filename}"` : ev.reason === 'paste' ? 'paste' : ev.reason === 'click' ? 'send-button click' : 'send';
      // Which agent this block is about — admin-typed row values or our own
      // catalog ids only; see blockAgentAttribution(). Computed once so the
      // record and the rewrite pin below carry the SAME object's values.
      const agentAttr = blockAgentAttribution(ev);
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
        // NOTE: the blocked PLATFORM id and tool_host are deliberately NOT sent
        // here. POST /api/v1/dlp maps enforcement metadata from an explicit
        // allowlist (see its metadata block), so extra keys would be silently
        // dropped — which reads as "we recorded it" when nothing was recorded.
        // They travel on the @@CFAI-BLOCK line below, which is where they are
        // actually consumed, and reach the server on the access request itself.
        // blocked_for/mechanism already carry "this was a platform block".
        matches,
        highest_severity: highestSeverity,
        // agent_name / agent_id / agent_scope / surface — the four keys the
        // server's enforcement-metadata allowlist maps for agent attribution.
        // Present only when known; see blockAgentAttribution().
        ...agentAttr,
        // THE PAIRING KEY, in the browser extension's exact shape
        // (content.js emitEnforcement): snake_case `client_event_id` on the
        // block, which POST /api/v1/dlp stores as metadata.correlation_id, and
        // `decision_for: <same id>` on the enforcement_redact below, stored as
        // metadata.decision_for. The id is the enforcer's block_id — the same
        // value the rewrite answers with — so a redact pairs with its block
        // exactly instead of by time and service.
        //
        // NOT the Reporter's camelCase `clientEventId`: that is the server's
        // dedupe/upsert key, and a block and its outcome sharing it would make
        // the outcome overwrite the block (see dlp.js's correlation_id note).
        // Omitted when there is no block_id (a non-rewritable block, which can
        // never have a redact to pair with).
        client_event_id: ev.block_id || undefined,
      });
      // Everything the enforcement_redact record will need if the user takes the
      // Tokenize & Send offer this block just made. Pinned only when the block
      // is actually rewritable — EmitBlock clears block_id for an attachment
      // hold and for a platform block, neither of which can ever be masked — and
      // pinned AFTER the enqueue above so the two carry identical values.
      if (ev.rewritable && ev.block_id) {
        this.#pinRewriteContext({
          block_id: ev.block_id,
          service: ai.product,
          vendor: ai.vendor,
          process_name: ev.process,
          matches,
          highest_severity: highestSeverity,
          // Same object's values as the record above, so the redact pairs with
          // its block on agent too. Identity only — never content.
          ...agentAttr,
        });
      }
      this.log?.info(`os_monitor: BLOCKED ${how} into ${ai.product} — [${ev.patterns}]`);
      if (this.#shouldFire(`enf|${ev.process}|${ev.patterns}|${ev.filename || ''}`)) {
        // Honest framing per the design decision: this stops the MESSAGE,
        // not necessarily the upload — several chat apps upload an attached
        // file to the vendor's backend the instant it's attached, well
        // before Send. Never imply the bytes never left the machine.
        // Platform blocks: NO toast — clicking the toast X steals focus and
        // disarms the enforcer, letting the next keystroke through. The banner
        // already tells the user the app is blocked.
        if (isPlatform) {
          // skip toast for platform blocks
        } else this.toast.show(isAttachment ? {
          title: `${ai.product} - attachment blocked`,
          message: `Send blocked: "${ev.filename}" contains ${ev.patterns}\n` +
            `Remove the attachment to send. If the app already uploaded it on attach, this only stops it from being used in the conversation.` +
            // HOST APPS: one extra sentence, and it names a real gap rather
            // than glossing it. UpdateSendRect returns early for every host app
            // (a descendant-wide UIA search of a Teams window is too expensive,
            // and its send button is not reliably locatable), so the mouse hook
            // has no rectangle to swallow a click in — Enter is covered, the
            // Send button is not. Saying "blocked" without that qualifier would
            // be the overclaim this file's copy rules exist to prevent.
            (isHostAppProcess(ev.process)
              ? `\nPressing Enter is blocked; clicking Send is not yet covered — remove the attachment to be safe.`
              : ''),
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
      this.#console.log('@@CFAI-BLOCK ' + JSON.stringify(this.#ui('block', {
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
        panel: ev.panel || '',
        block_scope: ev.block_scope || '',
      })));

      // ── The Tokenize & Send offer, for the CLI agent ──────────────────────
      //
      // Narrowly scoped to the ONE case that previously had nothing actionable
      // to offer: a plain content-pattern block the enforcer says it can mask.
      //   - isPlatform blocks are not maskable (EmitBlock clears block_id for
      //     them) and already route to the Request Access dialog via the
      //     enforcer's request_access_offer line;
      //   - isAttachment holds are never rewritable — Tokenize & Send masks
      //     TEXT and cannot remove a file, and the enforcer refuses to offer
      //     one. Both are asserted on `rewritable` alone as well, so the two
      //     exclusions below are the second, independent statement of a rule
      //     the .ps1 already enforces.
      //   - ev.preview must be non-empty: it IS the popup's whole content, and
      //     a popup showing an empty "This is what gets sent" box would be
      //     worse than the toast it accompanies.
      // Electron users are unaffected — main.js still opens its own dialog off
      // the @@CFAI-BLOCK line above, and this popup only ever draws when the
      // toast helper is running, which the Electron path does not use for it.
      //
      // Errors are swallowed into a log line on purpose: this runs off an
      // enforcer stdout line, so an unhandled rejection here would be an
      // unhandled rejection in the monitor.
      if (ev.rewritable && ev.block_id && !isPlatform && !isAttachment && ev.preview) {
        this.#offerTokenize(ev, ai).catch((err) => {
          this.log?.warn(`tokenize: offer failed — ${err?.message || err}`);
        });
      }
    });

    // ── EGRESS: the send chord in a mail client was swallowed ────────────────
    //
    // A SEPARATE handler from 'block', and the 'block' handler is untouched. That
    // one resolves an AI product identity, a Request Access tool_host and a Tier
    // B rewrite offer — none of which exists here: a mail client is in no AI
    // catalog, an egress block is not "the org disallowed this app" (so there is
    // nothing to request access to), and Tokenize & Send masks text and cannot
    // detach a file.
    //
    // The remedy is one thing and the toast says only that thing: remove the
    // attachment. There is deliberately no override hotkey — see the block in
    // enforcer-win.ps1 for why "send this attachment anyway" is not a coherent
    // affordance.
    this.enforcer.on('egressblock', (ev) => {
      const ident = identifyEgressSurface(ev.surface) || { product: ev.process, vendor: null };
      const patterns = String(ev.patterns || '').split(',').filter(Boolean);
      this.reporter.enqueue({
        kind: 'enforcement_block',
        blocked_for: 'file_upload',
        mechanism: 'attachment_hold',
        blocked_by: 'egress_send_chord',
        filename: ev.filename || undefined,
        source: 'os_monitor_egress',
        service: ident.product,
        vendor: ident.vendor,
        process_name: ev.process || '',
        matches: patterns.map((p) => ({ pattern: p, severity: 'high', count: 1 })),
        highest_severity: 'high',
      });
      this.log?.info(`os_monitor: BLOCKED email send chord in ${ident.product} — [${ev.patterns}]`);
      if (!this.#shouldFire(`egress-enf|${ev.process}|${ev.patterns}|${ev.filename || ''}`)) return;
      this.toast.show({
        title: `${ident.product} - send held`,
        // HONEST FRAMING, and every clause of it is load-bearing:
        //   * the mouse Send button is NOT covered — UpdateSendRect caches no
        //     rectangle for a non-AI surface, so the mouse hook has nothing to
        //     swallow a click in;
        //   * Ctrl+Enter-to-send is a user PREFERENCE some people switch off, so
        //     on their machine the chord being held is not the one they use;
        //   * the file may already be uploaded — a draft with an attachment is
        //     autosaved to the mailbox, so this holds the SEND, not the upload.
        message: `"${ev.filename}" contains ${ev.patterns}\n`
          + 'Ctrl+Enter and Alt+S are held. Clicking Send with the mouse is NOT covered, and '
          + 'Ctrl+Enter-to-send is a setting some users have switched off — remove the attachment to be sure.\n'
          + 'If the draft was already autosaved to your mailbox, this only stops the message being sent.',
      });
    });

    // ── Request Access, at the moment of the block ────────────────────────────
    //
    // The enforcer emits ONE of these per block session, from the same instant
    // it swallowed the send (see OfferAccessRequest in enforcer-win.ps1). This
    // is the only visible UI the agent ever produces, and it exists for the
    // seconds the dialog is on screen — mirroring how the browser extension
    // already asks. There is no window, no tray icon and no standing surface.
    //
    // Errors are swallowed into a log line on purpose: this runs off an
    // enforcer stdout line, so an unhandled rejection here would be an
    // unhandled rejection in the monitor.
    this.enforcer.on('requestaccessoffer', (ev) => {
      this.#offerAccessRequest(ev).catch((err) => {
        this.log?.warn(`access-request: offer failed — ${err?.message || err}`);
      });
    });

    // Standing blocked-platform bar (desktop) — the counterpart of the browser
    // extension's showPlatformBanner(). STATE, not an event: it says the org has
    // disallowed the app that currently has focus.
    //
    // Deliberately NOT reported to the server. An enforcement_block record means
    // "a send was actually refused", which the 'block' handler above already
    // writes; enqueueing a record every time a blocked window gains focus would
    // inflate the block count with things the user never attempted. Nothing here
    // is logged either — see enforcer.js's dispatch case.
    //
    // PII: the helper only ever puts a bool, a scope enum, admin-typed names, a
    // process name, a pid and a window rect on this event, and this relay
    // narrows rather than widens that. No prompt text can reach the renderer
    // that consumes it.
    this.enforcer.on('blockstate', (ev) => {
      const active = !!ev.active;
      const ai = active ? (identifyEventAi(ev) || { product: ev.process, vendor: null }) : null;
      this.#console.log('@@CFAI-BLOCKSTATE ' + JSON.stringify(this.#ui('blockstate', {
        active,
        scope: ev.scope || '',
        name: active ? (ev.agent || ai?.product || '') : '',
        agent_id: active ? (ev.agent_id || '') : '',
        process_name: active ? (ev.process || '') : '',
        pid: Number(ev.pid) || 0,
        win_x: Number(ev.win_x) || 0,
        win_y: Number(ev.win_y) || 0,
        win_w: Number(ev.win_w) || 0,
        win_h: Number(ev.win_h) || 0,
      })));
    });

    this.enforcer.on('disarmed', () => {
      // The one relay site that does not pass its payload through #ui() inline:
      // the literal `JSON.stringify({ active: false })` is itself pinned, so the
      // emit is a separate call over the same (trivially small) payload.
      this.#ui('blockstate', { active: false });
      this.#console.log('@@CFAI-BLOCKSTATE ' + JSON.stringify({ active: false }));
    });

    // ── govstate: arm the file routes for a governed host-app conversation ────
    //
    // The enforcer says a governed or blocked agent conversation is (or is no
    // longer) the open one in a host app — Microsoft Teams. STATE, on transitions
    // only, and the ONLY thing that ever lets a file route look at Teams.
    //
    // Two effects, and nothing else happens here:
    //   1. this.hostGoverned is set or cleared. The three file routes consult it
    //      through #hostGovernedFor() before they read a single byte off disk.
    //   2. the two UIA watchers are armed or disarmed for that process, so the
    //      drag-drop chip watcher and the file-picker watcher start (and stop)
    //      seeing it. Teams stays out of watcherProcessNames() — this is a
    //      separate, explicitly-armed set inside each helper.
    //
    // Deliberately NOT reported to the server and NOT logged with its identity:
    // "a governed conversation is open" is not an enforcement event, and a log
    // line per Teams conversation switch would write the user's agent-usage
    // timeline into the agent's own log file. The file events that may follow
    // are the records.
    this.enforcer.on('govstate', (ev) => {
      const active = !!ev.active;
      const processName = String(ev.process || '').trim();
      const previous = this.hostGoverned;
      if (active && processName) {
        this.hostGoverned = {
          process: processName,
          pid: Number(ev.pid) || 0,
          // Admin-typed row values, straight off the event — the same pair the
          // 'block' and Request Access paths already carry. Never re-derived
          // here, and never a conversation name read off a screen.
          agent: String(ev.agent || ''),
          agent_id: String(ev.agent_id || ''),
          scope: String(ev.scope || ''),
          panel: String(ev.panel || ''),
        };
      } else {
        this.hostGoverned = null;
      }
      // Arm/disarm on the PROCESS. When a transition moves from one host app to
      // another (not possible today — Teams is the only one — but the state
      // machine allows it), the previous process is disarmed first so it can
      // never be left armed by a transition that only mentioned the new one.
      if (previous?.process && previous.process !== this.hostGoverned?.process) {
        this.attachmentWatcher.hostArm(previous.process, false);
        this.dialogWatcher.hostArm(previous.process, false);
      }
      if (this.hostGoverned) {
        // …with WHICH conversation, as an opaque digest. govstate is edge-
        // triggered on the focused element, so these arms arrive in rapid
        // on/off/on bursts as focus moves around the app; the key is how the chip
        // watcher tells that burst apart from a real conversation switch. See
        // hostArmKey().
        const key = hostArmKey(this.hostGoverned);
        this.attachmentWatcher.hostArm(this.hostGoverned.process, true, key);
        this.dialogWatcher.hostArm(this.hostGoverned.process, true, key);
      }
      // Process + scope only. No agent name, so the line cannot become the
      // usage timeline described above.
      this.log?.info(
        `os_monitor: host file capture ${this.hostGoverned ? 'ARMED' : 'disarmed'}` +
        ` for ${processName || previous?.process || '?'} (scope=${String(ev.scope || '')})`
      );
    });

    // Tier B mask-and-rewrite result. 'ok' means the composer was verified to
    // hold exactly the masked text before Enter was synthesized — report it
    // the same way the browser extension's Tokenize & Send reports
    // enforcement_redact, masked content only, original never sent here.
    this.enforcer.on('rewrite', (ev) => {
      this.#console.log('@@CFAI-REWRITE ' + JSON.stringify(this.#ui('rewrite', ev)));
      if (ev.result !== 'ok') return;
      // The block that armed this rewrite — its pattern list, severity and
      // product identity, exactly as that block reported them. null when the
      // pin is gone (ids disagree, or it expired), and then every field it
      // would have supplied is OMITTED rather than guessed: "we do not know
      // what was matched" is a different and honest claim from "nothing was".
      const ctx = this.#takeRewriteContext(ev.block_id);
      // The MASKED prompt, and the only content field on this event. It is the
      // string the helper typed into the composer, read back and verified
      // pattern-free before Enter was synthesized (see EmitRewrite: `masked` is
      // present ONLY on result:"ok", the original text has no parameter it could
      // arrive through, and this is the only place it is read on this side).
      // Deliberate parity with the browser extension's Tokenize & Send, which
      // has always recorded the masked prompt for an enforcement_redact event.
      const masked = typeof ev.masked === 'string' && ev.masked.length > 0 ? ev.masked : null;
      this.reporter.enqueue({
        kind: 'enforcement_redact',
        mechanism: 'keystroke_rewrite',
        source: 'os_monitor_enforcer',
        decision_for: ev.block_id,
        sent: true,
        // Same field names and same shapes as the 'block' handler above, so the
        // block and its outcome pair up field-for-field on the dashboard, and
        // the same ones content.js sends for mechanism:'extension_dom'.
        ...(ctx ? {
          service: ctx.service,
          vendor: ctx.vendor,
          process_name: ctx.process_name,
          matches: ctx.matches,
          highest_severity: ctx.highest_severity,
          // The block's agent attribution, verbatim off the pin — each key only
          // when the block had it (see blockAgentAttribution()).
          ...(ctx.agent_name !== undefined ? { agent_name: ctx.agent_name } : {}),
          ...(ctx.agent_id !== undefined ? { agent_id: ctx.agent_id } : {}),
          ...(ctx.agent_scope !== undefined ? { agent_scope: ctx.agent_scope } : {}),
          ...(ctx.surface !== undefined ? { surface: ctx.surface } : {}),
        } : {}),
        // Length OF THE MASKED TEXT — the text this record actually carries and
        // the text that was actually sent. (The browser side reports the
        // pre-mask length here; the desktop enforcer never hands the original's
        // length across its stdout contract, and inferring one would be a
        // number nobody measured.) lengthBucket is the shared helper every other
        // reported event uses.
        ...(masked ? {
          content_length: masked.length,
          length_bucket: lengthBucket(masked.length),
          content_text: masked,
        } : {}),
        // Unconditional, exactly as content.js sets it: it is a statement about
        // the EVENT — any prompt text on it has been masked — not about whether
        // this particular one happened to carry text.
        content_redacted: true,
      });
      this.log?.info(
        `os_monitor: TOKENIZED + sent — block_id=${ev.block_id}` +
        (ctx ? ` [${ctx.matches.map((m) => m.pattern).join(', ')}]` : '')
      );
    });

    // Smart Model Router (desktop). Reported for every attempt, not just
    // successful ones — a route that silently stopped working (e.g. after a
    // target app's UI redesign) is the main operational risk, mirrored on
    // ui_changed so the dashboard can distinguish an actual switch from an
    // observed-but-not-applied decision. No prompt content ever travels on
    // this event: only an enum result, tier names, a public model label, and
    // a length — see enforcer-win.ps1's UpdateModelRouting/RunRoute.
    // Process-based resolution only, deliberately: model routing is excluded
    // from every IDE panel (see UpdateModelRouting in enforcer-win.ps1), so a
    // route event can never carry a panel id. Using the panel-first resolver
    // here would imply support that does not exist.
    this.enforcer.on('route', (ev) => {
      this.#console.log('@@CFAI-ROUTE ' + JSON.stringify(this.#ui('route', ev)));
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
      const ai = identifyEventAi(ev) || { product: ev.process, vendor: null };
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

    // Start from what we know before the server has answered: everything on,
    // which is also FeatureSync's own pre-first-fetch stance. Waiting for the
    // first poll instead would leave a minute of every boot ungoverned. These are
    // FLEET values — an enforcer the local setting disabled still does not start,
    // because #applyFeatures ANDs the fleet flag with the local one.
    this.#applyFeatures(
      { clipboard_monitor: true, dlp: true, agent_enforcer: true },
      ['clipboard_monitor', 'dlp', 'agent_enforcer'],
      { fromFleet: false },
    );
    // Then let the fleet setting take over. It reports every flag as changed on
    // its first successful fetch, so anything the admin has turned off stops
    // within a poll of startup.
    this.featureSync.start();

    // ── Blocked agents + access request sync (10s interval) ──────────────
    // Same logic as electron/monitor-runner.mjs — syncs blocked agents,
    // platform blocks, and access exceptions to blocked-agents.json, and
    // flushes any offline access-request queue.
    const tick = () => { this._refreshBlockedAgents(); this._flushPendingAccessRequest(); };
    tick(); // immediate first sync
    this._blockedAgentsInterval = setInterval(tick, 10_000);

    // ── Routing rules sync (60s interval, 5s first check) ─────────────────
    // Fetches server-defined routing rules and caches them locally so the
    // enforcer can apply them even when the server is unreachable.
    this._routingRulesTimer = setTimeout(() => {
      this.#refreshRoutingRules();
      this._routingRulesInterval = setInterval(() => this.#refreshRoutingRules(), 60_000);
    }, 5_000);

    // Kill any orphaned banner processes from a previous agent run
    this._hideBannerProc();
    // Spawn ui-helper for instant access request popups (WPF pre-loaded)
    this._ensureUiHelper();

    // ── The cloud-sync policy poll ───────────────────────────────────────────
    //
    // Started AFTER #applyFeatures, so the first pass sees the real
    // this.running.dlp rather than deciding against a half-initialised monitor.
    //
    // It runs even when no policy exists, and that is the cheap case by design:
    // a missing egress-surfaces.json is one existsSync per 10s and the watcher
    // stays unspawned. What it buys is the WITHDRAWAL path — an admin turning the
    // policy off stops filesystem observation within one interval, instead of at
    // the next agent restart.
    if (process.platform === 'win32') {
      this.#syncEgressPolicy();
      this.egressPolicyTimer = setInterval(() => {
        // Guarded on isRunning as well as cleared in stop(): the interval is
        // unref'd, but a tick that lands between stop() clearing state and the
        // process exiting must not re-spawn a watcher on a torn-down monitor.
        if (!this.isRunning) return;
        this.#syncEgressPolicy();
      }, EGRESS_POLICY_POLL_MS);
      this.egressPolicyTimer.unref?.();
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

  /**
   * Relay a Tokenize click down to the enforcer. TWO callers, one mechanism:
   * the Electron dialog (via monitor-runner.mjs's stdin relay) and, on the CLI
   * agent, #offerTokenize's own popup.
   *
   * `text` is only ever passed by the latter, for the popup's "Edit manually"
   * → Send path: it is the user's own rewording of the masked text, and the
   * enforcer re-gates and re-verifies it exactly as it does its own candidate.
   * The Electron caller never sends it, so that path is byte-for-byte unchanged.
   */
  tokenize(blockId, text = '') {
    return this.enforcer.tokenize(blockId, text);
  }

  /**
   * May the keystroke enforcer run, given the fleet flag?
   *
   * The two switches COMPOSE AS AND — they do not override each other. The fleet
   * flag says what the org allows on every machine; the local setting says what
   * this machine's user/admin allows. Either one saying "off" is a no, so a fleet
   * flag that merely says "allowed" can never re-enable an enforcer that was
   * disabled locally (via the Electron checkbox or CFAI_ENFORCER_ENABLED).
   */
  #enforcerAllowed(fleetOn) {
    return this.localEnforcerEnabled && fleetOn !== false;
  }

  /**
   * Start or stop subsystems to match the fleet settings.
   *
   * Only keys in `changed` are acted on. Re-applying an unchanged flag would tear
   * down and reinstall a working keyboard hook every poll — expensive, and a
   * window in which sends are not blocked.
   */
  #applyFeatures(features, changed, { fromFleet = true } = {}) {
    // A FeatureSync poll already in flight when stop() ran still resolves and
    // still calls onChange — its stop() clears the interval, it cannot abort the
    // pending fetch. Without this guard that late callback would start the
    // keyboard hook and its watchdog again on a monitor that has torn down.
    if (!this.isRunning) return;

    const want = (key) => features[key] !== false;   // unknown → keep governing

    // Clipboard + typed-prompt capture. These are the passive watchers: they see
    // what is going into an AI app but never stop it.
    if (changed.includes('clipboard_monitor')) {
      const on = want('clipboard_monitor');
      if (on !== this.running.clipboard_monitor) {
        if (on) { this.poller.start(); if (!this.skipPromptWatcher) this.promptWatcher.start(); }
        else    { this.poller.stop();  if (!this.skipPromptWatcher) this.promptWatcher.stop(); }
        this.running.clipboard_monitor = on;
        this.log?.info(`os_monitor: clipboard + prompt monitoring ${on ? 'ON' : 'OFF'} (fleet setting)`);
      }
    }

    // File-based DLP — the Open dialog and drag-drop watchers exist only to catch
    // files on their way into an AI app.
    if (changed.includes('dlp')) {
      const on = want('dlp');
      // The SAME fleet flag licenses the enforcer's AI-evidence routes (agent
      // chats / Copilot panes scanned with no governed row). Pushed on every
      // change, before the file-watcher toggle below, and remembered by the
      // Enforcer so a respawn starts in the same state.
      //
      // NOT the pre-fetch "everything on" default (security review L3): until
      // FeatureSync has actually answered, the evidence routes use the
      // persisted last-known FLEET value, and OFF when there is none.
      if (fromFleet) {
        this.enforcer?.setEvidenceDlp?.(on);
        this.#persistFleetEvidenceDlp(on);
      } else {
        this.enforcer?.setEvidenceDlp?.(this.#lastKnownFleetEvidenceDlp());
      }
      if (on !== this.running.dlp) {
        if (on) { this.dialogWatcher.start(); this.attachmentWatcher.start(); }
        else    { this.dialogWatcher.stop();  this.attachmentWatcher.stop(); }
        // The cloud-sync-root watcher rides the SAME fleet flag: it is file DLP,
        // in the same sense the two watchers above are. Two independent gates
        // compose as AND — the fleet flag AND a governed sync-root policy — and
        // start() refuses on its own when the policy set is empty, so turning
        // `dlp` on can never begin observing a machine whose admin has governed
        // no cloud-sync host. Turning it OFF stops the observation immediately.
        if (on) { this.syncWatcher.stopRequested = false; this.syncWatcher.start(); }
        else    { this.syncWatcher.stop(); }
        this.running.dlp = on;
        this.log?.info(`os_monitor: file DLP watchers ${on ? 'ON' : 'OFF'} (fleet setting)`);
      }
    }

    // The keystroke send-blocker, and its watchdog. The watchdog exists solely to
    // release the keyboard hook if this process is hard-killed, so it lives and
    // dies with the enforcer — leaving it running with no hook to reap would have
    // it watching for something that cannot happen.
    if (changed.includes('agent_enforcer')) {
      // AND, not override: the fleet flag alone is not enough — see
      // #enforcerAllowed. Everything below this line reads the composed value.
      const on = this.#enforcerAllowed(want('agent_enforcer'));
      if (on !== this.running.agent_enforcer) {
        if (on) {
          this.enforcer.start();
          this.enforcerWatchdog = spawnEnforcerWatchdog({ parentPid: process.pid, log: this.log });
        } else {
          // Order matters, and it is the same order stop() uses: kill the hook
          // BEFORE reaping the watchdog, so the watchdog finds nothing to act on
          // and exits without killing anything.
          this.enforcer.stop();
          if (this.enforcerWatchdog) {
            try { this.enforcerWatchdog.kill(); } catch {}
            this.enforcerWatchdog = null;
          }
        }
        this.running.agent_enforcer = on;
        // enforcerEnabled is what policySync's onChange consults before pushing
        // new patterns to the hook; leaving it stale would let a policy poll
        // restart a hook the admin just switched off. It holds the DERIVED value
        // — localEnforcerEnabled is never written here.
        this.enforcerEnabled = on;
        this.log?.info(
          `os_monitor: keystroke send-blocker ${on ? 'ON' : 'OFF'} (fleet setting)`
          + (on ? '' : ' — passive DLP watchers still active'),
        );
      }
    }
  }

  // ── WPF UI windows (banner, block dialog, access request) ──────────────
  // On Windows, spawn PowerShell WPF scripts to show native-looking UI that
  // matches the Electron app's block overlay, tokenize dialog, and access
  // request form. On other platforms, the console.log relay is the only path
  // (the Electron app handles it there).

  // ── Simple spawn-on-demand UI ──
  // Under the Node test runner (NODE_TEST_CONTEXT is set for every file
  // `node --test` runs) no desktop UI process is ever launched: tests redirect
  // HOME to a temp dir that is deleted on exit, so a late-starting wscript.exe
  // pops a "Can not find script file" error box, or a real hidden ui-helper.ps1
  // is left running. CFAI_DISABLE_UI_SPAWN=1 does the same outside the runner.
  _uiSpawnDisabled() {
    return !!process.env.NODE_TEST_CONTEXT || process.env.CFAI_DISABLE_UI_SPAWN === '1';
  }

  // Spawn a fresh PowerShell for each UI window. Kill it to hide.
  // Uses ShellExecute for desktop access from headless context.
  // Accepts ~3-5s delay on first show in exchange for 100% reliability.
  _spawnUi(script, inputData) {
    if (process.platform !== 'win32' || this._uiSpawnDisabled()) return null;
    try {
      const scriptPath = join(__dirname, script);
      const tmpDir = join(homedir(), '.cloudfuze-aigov');
      mkdirSync(tmpDir, { recursive: true });
      const inputFile = join(tmpDir, `ui-${Date.now()}.json`);
      const vbsFile = join(tmpDir, `ui-${Date.now()}.vbs`);
      writeFileSync(inputFile, JSON.stringify(inputData), 'utf8');
      const vbs = `CreateObject("Shell.Application").ShellExecute "powershell.exe", "-NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}"" ""${inputFile}""", "", "open", 0`;
      writeFileSync(vbsFile, vbs, 'utf8');
      cpSpawn('wscript.exe', [vbsFile], { stdio: 'ignore', detached: true }).unref();
      setTimeout(() => { try { rmSync(vbsFile, { force: true }); } catch {} }, 5000);
      // Return the input file path as a handle — PS1 writes its PID there after reading
      return inputFile;
    } catch {
      return null;
    }
  }

  _showBanner(data) {
    if (this._bannerName === data.name) return;
    // After hide, suppress for 15s while enforcer catches up
    if (this._bannerHideAt && Date.now() - this._bannerHideAt < 15000) return;
    this._hideBannerProc(); // kill old banner if any
    this._bannerName = data.name;
    this._bannerHideAt = 0;
    this._spawnUi('block-banner.ps1', data);
    // Start the persistent UI helper for instant popups
    this._ensureUiHelper();
  }

  _ensureUiHelper() {
    if (this._uiHelperAlive) return;
    if (process.platform !== 'win32' || this._uiSpawnDisabled()) return;
    try {
      const tmpDir = join(homedir(), '.cloudfuze-aigov');
      mkdirSync(tmpDir, { recursive: true });
      // Kill old helper
      const pidFile = join(tmpDir, 'ui-helper.pid');
      try {
        if (existsSync(pidFile)) {
          const oldPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
          if (oldPid > 0) try { process.kill(oldPid); } catch {}
        }
      } catch {}
      // Clear IPC files
      writeFileSync(join(tmpDir, 'ui-cmd.jsonl'), '', 'utf8');
      writeFileSync(join(tmpDir, 'ui-rsp.jsonl'), '', 'utf8');
      // Spawn via ShellExecute for desktop access
      const scriptPath = join(__dirname, 'ui-helper.ps1');
      const vbsFile = join(tmpDir, `ui-helper-${Date.now()}.vbs`);
      const vbs = `CreateObject("Shell.Application").ShellExecute "powershell.exe", "-NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}"" ""${tmpDir}""", "", "open", 0`;
      writeFileSync(vbsFile, vbs, 'utf8');
      cpSpawn('wscript.exe', [vbsFile], { stdio: 'ignore', detached: true }).unref();
      setTimeout(() => { try { rmSync(vbsFile, { force: true }); } catch {} }, 5000);
      this._uiHelperAlive = true;
      this._uiCmdFile = join(tmpDir, 'ui-cmd.jsonl');
    } catch {}
  }

  _sendToUiHelper(cmd) {
    try {
      this._ensureUiHelper();
      if (this._uiCmdFile) {
        const { appendFileSync: appendFS } = require('fs');
        appendFS(this._uiCmdFile, JSON.stringify(cmd) + '\n', 'utf8');
      }
    } catch {}
  }

  _hideBanner() {
    this._bannerName = null;
    this._bannerHideAt = Date.now();
    this._hideBannerProc();
    // DO NOT kill ui-helper here — it handles popups independently
  }

  _hideBannerProc() {
    // Kill ALL powershell processes that have block-banner.ps1 in their command line
    if (this._uiSpawnDisabled()) return;
    try {
      cpSpawn('powershell.exe', ['-NoProfile', '-Command',
        "Get-WmiObject Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*block-banner.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ], { stdio: 'ignore', windowsHide: true });
    } catch {}
  }

  _showBlockDialog(data) {
    this._spawnUi('block-dialog.ps1', data);
  }

  _showAccessRequest(data) {
    this._spawnUi('access-request.ps1', data);
  }

  async _handleAccessRequestStatus(ps, toolHost) {
    const serverUrl = String(this.serverUrl || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${serverUrl}/api/v1/access-requests?tool_host=${encodeURIComponent(toolHost)}&status=pending`, {
        headers: { authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const rows = await res.json();
        const pending = Array.isArray(rows) && rows.length > 0;
        const response = pending
          ? { pending: true, requested_at: rows[0].requested_at || rows[0].created_at }
          : { pending: false };
        try { ps.stdin.write(JSON.stringify(response) + '\n'); } catch {}
      } else {
        try { ps.stdin.write(JSON.stringify({ pending: false }) + '\n'); } catch {}
      }
    } catch {
      try { ps.stdin.write(JSON.stringify({ pending: false }) + '\n'); } catch {}
    }
  }

  async _handleAccessRequestSubmit(ps, msg) {
    const serverUrl = String(this.serverUrl || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${serverUrl}/api/v1/access-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          tool_host: msg.tool_host, tool_name: msg.tool_name,
          tool_vendor: msg.tool_vendor, reason: msg.reason || '',
        }),
      });
      if (res.status < 500) {
        try { ps.stdin.write(JSON.stringify({ submitted: true }) + '\n'); } catch {}
      } else {
        // Queue offline
        const pendingPath = join(homedir(), '.cloudfuze-aigov', 'pending-access-request.json');
        writeFileSync(pendingPath, JSON.stringify({ ...msg, queued_at: new Date().toISOString() }));
        try { ps.stdin.write(JSON.stringify({ submitted: false, queued: true }) + '\n'); } catch {}
      }
    } catch {
      const pendingPath = join(homedir(), '.cloudfuze-aigov', 'pending-access-request.json');
      writeFileSync(pendingPath, JSON.stringify({ ...msg, queued_at: new Date().toISOString() }));
      try { ps.stdin.write(JSON.stringify({ submitted: false, queued: true }) + '\n'); } catch {}
    }
  }

  // ── Blocked agents + platform blocks → blocked-agents.json ─────────────
  // Ported from electron/monitor-runner.mjs so the bare Node.js agent path
  // (install.bat / VBS auto-start) gets the same enforcement as Electron.
  async _refreshBlockedAgents() {
    const serverUrl = String(this.serverUrl || '').replace(/\/+$/, '');
    if (!serverUrl) return;
    const headers = this.token ? { authorization: `Bearer ${this.token}` } : {};

    // Fetch access exceptions (fail → null → keep previous file)
    let exceptions = null;
    try {
      const r = await fetch(`${serverUrl}/api/v1/access-exceptions/mine`, { headers });
      if (r.ok) { const rows = await r.json(); if (Array.isArray(rows)) exceptions = rows; }
    } catch {}

    // Fetch ai_platforms (fail → null → keep previous file)
    let platforms = null;
    try {
      const r = await fetch(`${serverUrl}/api/v1/ai-platforms`, { headers });
      if (r.ok) { const rows = await r.json(); if (Array.isArray(rows)) platforms = rows; }
    } catch {}

    try {
      const r = await fetch(`${serverUrl}/api/lifecycle/blocked-agents`);
      if (!r.ok) return;
      const agentRows = await r.json();
      if (platforms === null) return; // fail closed
      const list = normalizeAgentRows(Array.isArray(agentRows) ? agentRows : [], this.log)
        .concat(synthesizePlatformBlocks(platforms));
      const effective = exceptions === null ? list : filterBlockedAgents(list, exceptions, this.log);
      const blockedPath = join(homedir(), '.cloudfuze-aigov', 'blocked-agents.json');
      mkdirSync(join(homedir(), '.cloudfuze-aigov'), { recursive: true });
      writeFileSync(blockedPath, JSON.stringify(effective), 'utf8');
      const lifted = list.length - effective.length;
      this.log?.info?.(`blocked-agents: synced ${effective.length} blocked agent(s)` + (lifted > 0 ? ` (${lifted} lifted by access exception)` : ''));
      // Compare with previous sync — if any entry was removed, hide the banner.
      // Name matching is unreliable (display name vs process name vs agent name).
      const curSet = new Set(effective.map(r => (r.process_name || r.agent_name || '').toLowerCase()).filter(Boolean));
      if (this._prevBlockedSet) {
        const removed = [...this._prevBlockedSet].filter(n => !curSet.has(n));
        if (removed.length > 0 && this._bannerName) {
          this.log?.info?.(`blocked-agents: ${removed.join(', ')} unblocked — hiding banner`);
          this._hideBanner();
        }
        const added = [...curSet].filter(n => !this._prevBlockedSet.has(n));
        if (added.length > 0) {
          this._bannerHideAt = 0; // clear suppression — new block detected
        }
      }
      this._prevBlockedSet = curSet;
    } catch (err) {
      this.log?.warn?.(`blocked-agents: sync failed — ${err.message}`);
    }
  }

  // ── Offline access-request queue flush ────────────────────────────────────
  async _flushPendingAccessRequest() {
    const pendingPath = join(homedir(), '.cloudfuze-aigov', 'pending-access-request.json');
    if (!existsSync(pendingPath)) return;
    let payload;
    try { payload = JSON.parse(readFileSync(pendingPath, 'utf8')); } catch { rmSync(pendingPath, { force: true }); return; }
    const queuedAt = Date.parse(payload?.queued_at || '');
    if (Number.isFinite(queuedAt) && Date.now() - queuedAt > 24 * 3600 * 1000) {
      rmSync(pendingPath, { force: true });
      return;
    }
    const { queued_at, ...body } = payload || {};
    const serverUrl = String(this.serverUrl || '').replace(/\/+$/, '');
    try {
      const res = await fetch(`${serverUrl}/api/v1/access-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify(body),
      });
      if (res.status < 500) {
        rmSync(pendingPath, { force: true });
        this.log?.info?.(`access-request: queued request submitted (${res.status})`);
      }
    } catch {}
  }

  // ── Routing rules sync ──────────────────────────────────────────────────────
  // Mirrors the browser extension's service-worker refreshRoutingRules():
  // fetch /api/v1/routing/rules every 60s, cache to disk, restart the enforcer
  // when rules change so the C# ComputeRoute() picks up server overrides.
  async #refreshRoutingRules() {
    if (!this.serverUrl) return;
    try {
      const res = await fetch(`${this.serverUrl}/api/v1/routing/rules`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return;
      const rules = await res.json();
      if (!Array.isArray(rules)) return;
      // Only enabled rules, sorted by priority (lower = higher priority).
      const active = rules.filter(r => r.enabled !== false).sort((a, b) => (a.priority || 50) - (b.priority || 50));
      const hash = JSON.stringify(active);
      if (hash === this._routingRulesHash) return; // no change
      this._routingRulesHash = hash;
      saveCachedRoutingRules(active);
      this.log?.info?.(`routing-rules: synced ${active.length} rule(s) — restarting enforcer`);
      // Restart enforcer to pick up new CFAI_MODEL_ROUTER_CONFIG (which
      // includes serverRules from the cached file). Same pattern as
      // policySync's onChange → updateBlockPatterns.
      if (this.enforcerEnabled && this.enforcer) {
        const blockPatterns = getBlockPatterns();
        this.enforcer.updateBlockPatterns(blockPatterns);
      }
    } catch (err) {
      this.log?.warn?.(`routing-rules: fetch failed (${err?.message}) — keeping cached rules`);
    }
  }

  stop() {
    // FIRST, before anything else is torn down: a FeatureSync poll already
    // awaiting its fetch will still fire onChange after this returns, and
    // #applyFeatures no-ops on this flag rather than restarting the hook.
    this.isRunning = false;
    if (this._blockedAgentsInterval) { clearInterval(this._blockedAgentsInterval); this._blockedAgentsInterval = null; }
    if (this._routingRulesTimer) { clearInterval(this._routingRulesTimer); this._routingRulesTimer = null; }
    try { this._hideBannerProc(); } catch {}
    this.#stopAttachHoldRefresh();
    if (this.egressPolicyTimer) {
      clearInterval(this.egressPolicyTimer);
      this.egressPolicyTimer = null;
    }
    this.featureSync.stop();
    this.poller.stop();
    this.dialogWatcher.stop();
    this.attachmentWatcher.stop();
    // Before the enforcer, with the other file watchers: an orphaned
    // FileSystemWatcher on someone's OneDrive folder is observation with nothing
    // left to govern with it.
    this.syncWatcher.stop();
    if (!this.skipPromptWatcher) this.promptWatcher.stop();
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
