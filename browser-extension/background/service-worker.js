// MV3 service worker — batches events from content scripts and POSTs to the
// governance server. Survives termination by persisting queue + token to
// chrome.storage.local, using chrome.alarms for periodic flushes.

// Both halves of lib/recording.js are used here now: the session boundary
// (engagements) and the recorder half — policy clamps, the host allowlist and the
// daily-cap ledger — which this worker serves to content/replay.js over the
// replay* control RPCs at the bottom of this file.
//
// There is deliberately NO persistent offline queue for replay chunks (and so no
// queue helper to import for one) — parking gzipped, UNMASKED composer text in
// chrome.storage.local at rest is a worse governance outcome than losing the tail
// of one run, and the recorder already has a bounded in-memory rollback for a
// transient outage (see flushChunk in content/replay.js).
import {
  DEFAULT_REPLAY_POLICY,
  nextEngagement,
  engagementExpiry,
  normalizeReplayPolicy,
  isRecordableHost,
  remainingDailyMs,
  accrueDaily,
} from '../lib/recording.js';

const STORAGE = {
  CONFIG:    'cfai.config',
  TOKEN:     'cfai.token',
  USER:      'cfai.user',              // last identity sent to the server
  MACHINE_ID:'cfai.machineId',
  FIRST_ENROLL_AT:'cfai.firstEnrollAt', // when we first tried to enroll — used to
                                        // wait for the desktop agent beacon before
                                        // enrolling as an unattributable UA hostname

  QUEUE:     'cfai.queue',
  PLATFORMS: 'cfai.platforms',         // mirror of GET /api/v1/ai-platforms
  PLATFORMS_AT: 'cfai.platforms_at',   // timestamp of last refresh
  BLOCKED:   'cfai.blocked',          // blocked agents list from governance
  BLOCKED_AT:'cfai.blocked_at',
  SESSIONS:  'cfai.sessions',          // tabId → engagement (THE session boundary)
  // The daily observation budget, { day, ms }. Same key the video phase used, on
  // purpose: what is measured changed (video wall-clock → DOM-observation
  // wall-clock) but the ledger shape did not, and a stale entry from a previous day
  // normalizes to zero anyway (see normalizeDailyLedger in lib/recording.js), so
  // there is nothing to migrate or clear.
  RECORDING_DAILY: 'cfai.recordingDaily',
  // GONE WITH THE VIDEO PIPELINE: 'cfai.recordings' (tabId → live video capture).
  // Nothing reads it any more.
  ROUTING_RULES: 'cfai.routing_rules',     // model routing rules from server
  ROUTING_RULES_AT: 'cfai.routing_rules_at',
  AI_SURFACES:  'cfai.ai_surfaces',   // mirror of GET /api/v1/ai-surfaces
  DLP_POLICY:   'cfai.dlp_policy',    // mirror of GET /api/policy-packs/extension-config
  DLP_POLICY_AT:'cfai.dlp_policy_at',
};

const FLUSH_ALARM = 'cfai-flush';
const FLUSH_INTERVAL_MIN = 1;       // chrome.alarms minimum
const BATCH_SIZE = 50;

// How long to keep retrying the desktop agent's identity beacon before giving up
// and enrolling this browser as an unlinked (browser-only) machine. Covers a slow
// agent start at logon so the extension attributes to the real user, not "Mozilla".
const ENROLL_BEACON_GRACE_MS = 5 * 60 * 1000;

// Identity beacon ports — agent tries these in order, we check all to find it
const BEACON_PORTS = [19532, 19533, 19534, 19535, 19536];
async function fetchBeacon() {
  for (const port of BEACON_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/cfai/identity`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return res.json();
    } catch {}
  }
  return null;
}

const PLATFORMS_ALARM = 'cfai-platforms-refresh';
const PLATFORMS_REFRESH_MIN = 1;    // how often to pull the registry (1 = chrome.alarms min) so block/allow changes propagate fast

const BLOCKED_ALARM = 'cfai-blocked-refresh';
const BLOCKED_REFRESH_MIN = 2;     // poll blocked agents every 2 min

const ROUTING_ALARM = 'cfai-routing-refresh';
const ROUTING_REFRESH_MIN = 1;     // poll routing rules every 1 min
const DLP_POLICY_ALARM = 'cfai-dlp-policy-refresh';
const DLP_POLICY_REFRESH_MIN = 5;  // pattern policy changes rarely; 5 min is ample

// --- helpers ---

async function getStored(key, fallback = null) {
  const obj = await chrome.storage.local.get([key]);
  return obj[key] ?? fallback;
}
async function setStored(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
// Enterprise policy (Intune / Group Policy / Jamf) is delivered to the extension
// through chrome.storage.managed — a READ-ONLY area the admin populates via the
// browser's ExtensionSettings/3rdparty policy, keyed to this extension's ID. It is
// only present when such a policy exists; otherwise .get() rejects or returns {}.
// These are the only keys an admin may push (see managed_schema.json).
// browserOnly is a BOOLEAN and the only non-string key: it declares that this
// fleet has no desktop agent, so the extension should not wait for a beacon
// that will never arrive (see ENROLL_BEACON_GRACE_MS).
const MANAGED_KEYS = ['serverUrl', 'enrollSecret', 'userEmail', 'employeeEmail', 'computerName', 'browserOnly'];
async function getManagedConfig() {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.managed) return {};
    const all = await chrome.storage.managed.get(MANAGED_KEYS);
    const out = {};
    for (const k of MANAGED_KEYS) {
      const v = all?.[k];
      // Some policy transports (registry REG_DWORD, older ADMX tooling) deliver a
      // boolean as the string "true"/"1", so accept both rather than silently
      // ignoring a policy the admin did set.
      if (k === 'browserOnly') {
        if (v === true || v === 'true' || v === '1' || v === 1) out[k] = true;
        continue;
      }
      if (typeof v === 'string' && v.trim() !== '') out[k] = v.trim();
    }
    return out;
  } catch {
    // No managed policy configured on this machine — normal for unmanaged installs.
    return {};
  }
}

// Config precedence: admin-enforced managed policy WINS over locally-saved values
// for the fields it defines (serverUrl/enrollSecret/userEmail/employeeEmail/
// computerName). Runtime-detected fields the beacon writes to local
// (detectedUser, detectedMachineId, and computerName when policy omits it) survive
// because managed simply doesn't carry them.
async function getConfig() {
  const local = await getStored(STORAGE.CONFIG, {});
  const managed = await getManagedConfig();
  return { serverUrl: '', enrollSecret: '', userEmail: '', ...local, ...managed };
}
// Resolve a real user identity so usage attributes to a person, not the browser.
// 1) admin/user-configured identity (works in every browser, incl. Firefox);
// 2) Chrome signed-in profile email (best-effort — needs the "identity"/"identity.email"
//    permission; if absent it just returns null and we fall through).
async function resolveUserIdentity(config) {
  return (await resolveIdentity(config)).user;
}

/**
 * The same lookup, but it also reports WHERE the identity came from — or why
 * there wasn't one.
 *
 * WHY PROVENANCE IS WORTH CARRYING. On a browser-only rollout (force-installed
 * extension, no desktop agent) identity rests entirely on the browser profile
 * being signed in, which is an admin policy the extension cannot verify. When
 * that policy is missing the extension still works perfectly — it enrolls, it
 * enforces, it captures — and every row simply says "Browser User (…)". An
 * admin looking at that cannot tell an intentionally anonymous deployment from
 * a misconfigured one, and the failure is silent on exactly the machines nobody
 * is looking at.
 *
 * Reporting the source turns that into an answerable question: `none` on a fleet
 * that was supposed to be attributed means browser sign-in is not enforced.
 *
 * Sources, in the order they are tried:
 *   managed_policy   admin pushed userEmail — deterministic, any browser
 *   agent_beacon     the desktop agent told us who is logged in
 *   browser_profile  the signed-in browser profile (Entra work account in Edge,
 *                    Google account in Chrome) — needs sign-in to be enforced
 *   none             nothing to attribute to; usage lands under a stable
 *                    anonymous per-browser id
 */
async function resolveIdentity(config) {
  if (config.userEmail) return { user: config.userEmail, source: 'managed_policy' };
  // The beacon's answer is already persisted here by fetchBeacon/auto-link, and
  // it outranks the browser profile: it names the OS user, whereas a browser
  // profile can be a personal account signed into a work machine.
  if (config.detectedUser) return { user: config.detectedUser, source: 'agent_beacon' };
  try {
    if (typeof chrome !== 'undefined' && chrome.identity?.getProfileUserInfo) {
      const info = await new Promise((resolve) => {
        // accountStatus:'ANY' matters — without it this returns nothing unless
        // the user has turned on sync, which enterprises routinely disable.
        try { chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, resolve); }
        catch { resolve(null); }
      });
      if (info?.email) return { user: info.email, source: 'browser_profile' };
    }
  } catch { /* unsupported / not permitted — fall through */ }
  return { user: null, source: 'none' };
}
function safeHost(url) {
  try { return new URL(url).hostname; } catch (e) { return null; }
}
async function getOrCreateMachineId() {
  let id = await getStored(STORAGE.MACHINE_ID);
  if (id) return id;
  id = crypto.randomUUID();
  await setStored(STORAGE.MACHINE_ID, id);
  return id;
}

// --- enrollment ---

async function ensureToken() {
  const existing = await getStored(STORAGE.TOKEN);
  if (existing) return existing;

  const config = await getConfig();
  if (!config.serverUrl || !config.enrollSecret) return null;

  const machineId = await getOrCreateMachineId();

  // Try to auto-detect hostname from desktop agent beacon
  let computerName = config.computerName;
  if (!computerName) {
    try {
      const beaconData = await fetchBeacon();
      if (beaconData) {
        computerName = beaconData.hostname;
        // Persist for future enrollments
        config.computerName = computerName;
        config.detectedUser = beaconData.user;
        await setStored(STORAGE.CONFIG, config);
        console.info('[cfai] auto-detected hostname from desktop agent:', computerName);
      }
    } catch { /* agent not running — proceed without linking */ }
  }

  // Don't enroll as an unattributable "<UA>-browser-extension" (e.g.
  // "Mozilla-browser-extension") just because the desktop agent's beacon was slow
  // to come up at logon. Such a record carries no hostname the server can match to
  // a person, so it lands as an anonymous "Browser User (…)" row forever. Instead
  // defer for a grace window and let the periodic flush alarm retry — the beacon
  // normally appears within seconds. Only after the window do we accept this is a
  // browser-only machine (no agent) and enroll unlinked so its usage is not lost.
  if (!computerName) {
    const now = Date.now();
    let firstAt = await getStored(STORAGE.FIRST_ENROLL_AT);
    if (!firstAt) { firstAt = now; await setStored(STORAGE.FIRST_ENROLL_AT, firstAt); }
    // The grace exists so a slow-starting agent does not cost us attribution.
    // On a declared browser-only fleet there is no agent to wait for, and the
    // wait is pure cost: every newly provisioned machine would be invisible to
    // governance for five minutes after the extension force-installs.
    if (!config.browserOnly && now - firstAt < ENROLL_BEACON_GRACE_MS) {
      console.info('[cfai] desktop agent beacon not found yet — deferring enroll to stay attributable');
      return null;
    }
    console.info('[cfai] beacon grace elapsed — enrolling unlinked (treated as a browser-only machine)');
  }

  const hostname = computerName
    ? computerName + '-browser-extension'
    : navigator.userAgent.split(/[\s/(]/)[0] + '-browser-extension';
  const { user, source: identitySource } = await resolveIdentity(config);

  try {
    const enrollBody = { machineId, hostname, user, identitySource, enrollSecret: config.enrollSecret };
    if (config.employeeEmail) enrollBody.employeeEmail = config.employeeEmail;
    const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(enrollBody),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { token } = await res.json();
    await setStored(STORAGE.TOKEN, token);
    await setStored(STORAGE.USER, user);
    return token;
  } catch (err) {
    console.warn('[cfai] enrollment failed:', err.message);
    return null;
  }
}

// ── Engagement: THE session boundary ────────────────────────────────────────
// One session_id covers a continuous stretch of using the SAME AI service in the
// SAME tab. It survives chat switches, "New chat" and same-service reloads, and
// ends only on: tab closed, a switch to a DIFFERENT AI service, 15 min without
// VISIBLE-tab use, a 12h hard cap, or a browser restart.
//
// WHY THIS LIVES HERE AND NOT IN content.js: session identity used to be three
// locals in the content script (_sessionId / _clientSeq / _lastConvId), and
// content-script memory is destroyed by every page load. That is precisely why a
// reload or a hard navigation between chats silently started a new session. The
// worker survives navigation, and chrome.storage.local survives the worker being
// terminated, so identity is owned here and keyed by tab id.
//
// The decision logic itself is pure and unit-tested in lib/recording.js
// (nextEngagement / engagementExpiry / serviceKeyForHost — see
// tests/engagement.test.mjs). This half only supplies storage, tab ids and the
// clock. Keep it that way: none of the branching below should grow conditions.

const ENGAGEMENT_SWEEP_ALARM = 'cfai-engagement-sweep';

// The idle/cap windows ride on the replay policy document, which the replayPolicy
// RPC further down fetches and caches (already normalized + clamped). Sync on
// purpose — every engagement decision needs these windows, and none of them may
// wait on a network round-trip. Before the first successful fetch, and whenever the
// server is unreachable, this is DEFAULT_REPLAY_POLICY: 15 min idle / 12 h cap,
// which is the product decision anyway.
function engagementPolicy() {
  return cachedReplayPolicy() || DEFAULT_REPLAY_POLICY;
}

// --- engagement state (tabId → engagement) ---
// Same shape as the recordings map above: one storage key holding a plain
// tabId → record object.

async function getEngagements() {
  const map = await getStored(STORAGE.SESSIONS, {});
  return map && typeof map === 'object' ? map : {};
}
async function getEngagement(tabId) {
  return (await getEngagements())[String(tabId)] || null;
}
async function putEngagement(tabId, rec) {
  const map = await getEngagements();
  map[String(tabId)] = rec;
  await setStored(STORAGE.SESSIONS, map);
}
async function dropEngagement(tabId) {
  const map = await getEngagements();
  const rec = map[String(tabId)] || null;
  delete map[String(tabId)];
  await setStored(STORAGE.SESSIONS, map);
  return rec;
}

// --- single writer over cfai.sessions ---
// Every engagement read-modify-writes ONE storage key holding the whole map, so
// two concurrent writers clobber each other's tabs, not just their own. Two
// events from different frames of the same tab arriving in the same task would
// otherwise each see "no engagement" and mint one — two session_ids for one tab.
// Same promise-chain trick as the daily ledger further down; a rejection must not
// poison the next waiter, hence the catch on the tail.
let _sessionsChain = Promise.resolve();
function withSessionsLock(fn) {
  const run = _sessionsChain.then(fn, fn);
  _sessionsChain = run.catch(() => {});
  return run;
}

const NO_SESSION = Object.freeze({ session_id: null, service_key: null, client_seq: null });

/**
 * Resolve this tab's engagement against one signal and persist the result.
 *
 * signal.type:
 *   'activity'       an event this tab is about to enqueue — consumes a
 *                    client_seq, and extends the idle window when the tab is
 *                    visible. May mint.
 *   'touch'          the tab was used but produced no event (became visible, the
 *                    replay controller asked for the current id). NEVER mints.
 *   'nav_committed'  a top-frame navigation committed. Boundary check only.
 *
 * Returns { session_id, service_key, client_seq } — all null when there is no
 * engagement (no tab, an unusable host, or a 'touch' with nothing to resume).
 */
async function sessionTouch(tabId, host, signal = {}) {
  if (typeof tabId !== 'number' || tabId < 0) return NO_SESSION;
  return withSessionsLock(async () => {
    // The MIRROR, never getFreshPlatforms(): a session boundary must not depend
    // on a network round-trip, and must not be decided differently because one
    // fetch happened to fail.
    const platforms = await getStored(STORAGE.PLATFORMS, []);
    const current = await getEngagement(tabId);

    const result = nextEngagement(current, {
      type: signal.type || 'touch',
      host,
      platforms,
      visible: signal.visible,
      isTopFrame: signal.isTopFrame,
      new_session_id: crypto.randomUUID(),
    }, Date.now(), engagementPolicy());

    if (result.closed) logEngagementEnd(tabId, result.closed);
    if (result.action === 'mint') {
      console.info('[cfai] session', result.record.session_id,
                   '— tab', tabId, '(' + result.record.service_key + ')');
    }

    if (result.record) {
      // 'none' means nothing was decided; leave storage alone rather than
      // rewriting the same map on every read.
      if (result.action !== 'none') await putEngagement(tabId, result.record);
      return {
        session_id: result.record.session_id,
        service_key: result.record.service_key,
        client_seq: result.seq,
      };
    }
    if (result.action === 'closed') await dropEngagement(tabId);
    return NO_SESSION;
  });
}

function logEngagementEnd(tabId, closed) {
  console.info('[cfai] session ended', closed.session_id, '— tab', tabId,
               '— reason:', closed.reason,
               '— lasted', Math.round((closed.last_activity_at - closed.started_at) / 1000) + 's');
}

/** Close a tab's engagement for a reason that is not a signal about a host. */
async function closeEngagement(tabId, reason) {
  if (typeof tabId !== 'number' || tabId < 0) return null;
  return withSessionsLock(async () => {
    const rec = await dropEngagement(tabId);
    if (rec) logEngagementEnd(tabId, { ...rec, reason });
    return rec;
  });
}

/** Age every stored engagement out. Driven by the 1-minute sweep alarm. */
async function engagementSweep() {
  await withSessionsLock(async () => {
    const map = await getEngagements();
    const keys = Object.keys(map);
    if (keys.length === 0) return;
    const now = Date.now();
    const policy = engagementPolicy();
    let changed = false;
    for (const key of keys) {
      const reason = engagementExpiry(map[key], now, policy);
      if (!reason) continue;
      logEngagementEnd(Number(key), { ...map[key], reason });
      delete map[key];
      changed = true;
    }
    if (changed) await setStored(STORAGE.SESSIONS, map);
  });
}

// Tab ids are not stable across a browser restart, so a persisted engagement can
// no longer be matched to the tab it belonged to — nothing resumes, everything
// closes.
async function closeEngagementsOnStartup() {
  await withSessionsLock(async () => {
    const map = await getEngagements();
    const keys = Object.keys(map);
    if (keys.length === 0) return;
    console.info('[cfai] closing', keys.length, 'session(s) left from the previous browser run');
    for (const key of keys) logEngagementEnd(Number(key), { ...map[key], reason: 'browser_restarted' });
    await setStored(STORAGE.SESSIONS, {});
  });
}

// Keep the machine's attributed user current. Runs cheaply on every flush and
// at startup; only re-enrolls (network) when the resolved identity actually
// changes — e.g. after the admin sets an email, or the browser sign-in changes.
// This is what makes already-installed extensions start reporting a real user.
async function syncIdentity() {
  const config = await getConfig();
  if (!config.serverUrl || !config.enrollSecret) return;
  const current = await resolveUserIdentity(config);
  if (!current) return;                          // nothing to attribute yet
  const last = await getStored(STORAGE.USER);
  if (current === last) return;                  // unchanged — no network call
  const machineId = await getOrCreateMachineId();
  const hostname = navigator.userAgent.split(/[\s/(]/)[0] + '-browser-extension';
  try {
    const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId, hostname, user: current, enrollSecret: config.enrollSecret }),
    });
    if (res.ok) {
      const { token } = await res.json();
      await setStored(STORAGE.TOKEN, token);
      await setStored(STORAGE.USER, current);
    }
  } catch (err) {
    console.warn('[cfai] identity sync failed:', err.message);
  }
}

// --- queue ---

async function pushEvent(event) {
  const queue = (await getStored(STORAGE.QUEUE)) || [];
  queue.push(event);
  // Cap to prevent runaway growth if server is unreachable for a long time.
  if (queue.length > 1000) queue.splice(0, queue.length - 1000);
  await setStored(STORAGE.QUEUE, queue);
}

// Stamp an outgoing event with the tab's session identity, then queue it.
// session_id / client_seq come from the WORKER's engagement record — the content
// script no longer sends either. client_seq (not occurredAt) stays the ordering
// source of truth: this queue flushes on an alarm, so delivery order is not send
// order, and the user's clock may be skewed.
// The session_id is handed back in the response so the sender learns which
// session its event landed in without a second round-trip — content.js caches it
// for the replay controller.
async function pushTabEvent(event, tabId, host, visible) {
  const { session_id, client_seq } = await sessionTouch(tabId, host, { type: 'activity', visible });
  await pushEvent({ ...event, session_id, client_seq });
  return session_id;
}

async function flushQueue() {
  const queue = (await getStored(STORAGE.QUEUE)) || [];
  if (queue.length === 0) return;

  const config = await getConfig();
  if (!config.serverUrl) return;
  const token = await ensureToken();
  if (!token) return;

  // Stamp the signed-in person on each event so activity attributes to a user,
  // not just the machine. Uses the identity resolved at enroll / last sync.
  const user = (await resolveUserIdentity(config)) || (await getStored(STORAGE.USER)) || null;
  const batch = queue.slice(0, BATCH_SIZE).map((e) => (e.user ? e : { ...e, user }));
  try {
    // authedFetch transparently handles 401-on-token-rotation by clearing
    // the stale token, re-enrolling using stored config, and retrying once.
    const res = await authedFetch('/api/v1/dlp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Remove sent events from the queue
    const remaining = queue.slice(batch.length);
    await setStored(STORAGE.QUEUE, remaining);
  } catch (err) {
    console.warn('[cfai] flush failed:', err.message);
  }
}

// Auth-aware fetch with one-shot retry on 401. When the dev server restarts
// it rotates JWT_SECRET, which makes all existing tokens invalid. Previously
// we just gave up on 401 and waited for the user to manually re-enroll. Now
// we automatically clear the stale token, re-enroll using stored config, and
// retry the original request. Net effect: server restarts no longer require
// the user to touch the options page.
async function authedFetch(path, init = {}) {
  const config = await getConfig();
  if (!config.serverUrl) throw new Error('not configured');
  const url = `${config.serverUrl.replace(/\/$/, '')}${path}`;

  let token = await ensureToken();
  if (!token) throw new Error('not enrolled');

  const makeReq = () => fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), 'authorization': `Bearer ${token}` },
  });

  let res = await makeReq();
  if (res.status !== 401) return res;

  // Token stale — drop it, re-enroll, retry once. If re-enrollment fails
  // we just return the original 401 to the caller for normal error handling.
  await chrome.storage.local.remove([STORAGE.TOKEN]);
  token = await ensureToken();
  if (!token) return res;
  res = await makeReq();
  return res;
}

// --- classification (LLM-in-loop) ---

// In-memory negative cache so we don't ping the server for hosts we've
// already classified during this service-worker lifetime. Service workers
// die periodically — that's OK, the server has its own cache so the worst
// case is one extra server call per host per worker restart.
const _classifyCache = new Map();   // host → verdict
const CLASSIFY_TTL_MS = 60 * 60 * 1000;   // 1 hour in-memory; server has the canonical 30-day cache

// Tabs we've already injected the DLP stack into. We don't re-inject on the
// same tab to avoid duplicate listeners (which would fire double notifications
// for one paste). Cleared on tab close + on tab navigation, since SPA reloads
// blow away the injected listeners but a real navigation might too.
const _injectedTabs = new Set();   // tabId

chrome.tabs.onRemoved.addListener((tabId) => _injectedTabs.delete(tabId));
chrome.webNavigation?.onCommitted?.addListener((details) => {
  // Top-frame navigations only (frameId 0) — iframe navigations don't unload
  // the parent's content script.
  if (details.frameId === 0 && details.transitionType !== 'auto_subframe') {
    _injectedTabs.delete(details.tabId);
  }
});
// Same for SPA pushState/replaceState transitions. In MV3, these don't trigger
// onCommitted because the document doesn't actually reload — but the content
// script CAN be torn down on some routes (Lovable, certain Next.js apps),
// and we have no way to tell which from the worker. Safer to always clear
// the injected marker so the next user interaction triggers a fresh inject.
chrome.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
  if (details.frameId === 0) {
    _injectedTabs.delete(details.tabId);
  }
});

async function classifyHost({ host, signals, tabId }) {
  if (!host) throw new Error('host required');
  const cached = _classifyCache.get(host);
  let verdict;
  if (cached && Date.now() - cached.cachedAt < CLASSIFY_TTL_MS) {
    verdict = cached.verdict;
  } else {
    const token  = await ensureToken();
    const config = await getConfig();
    if (!token || !config.serverUrl) {
      // Not enrolled — fail silent so unenrolled installs don't crash. The
      // user can configure the extension via options.html later.
      return { is_ai: false, should_govern: false, confidence: 0, classifier: 'unenrolled', reasoning: 'extension not enrolled' };
    }

    const res = await authedFetch('/api/v1/classify-host', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host, signals }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`server ${res.status}: ${text.slice(0, 120)}`);
    }
    verdict = await res.json();
    _classifyCache.set(host, { verdict, cachedAt: Date.now() });
  }

  // If verdict says govern, inject the DLP stack into the originating tab.
  // This is the closing-the-gap step: fingerprint.js + classifier handle
  // DISCOVERY; content.js (just-injected) handles CAPTURE + ENFORCEMENT.
  // The content.js selectors are generic (textarea/contenteditable/role=textbox
  // with shadow-DOM walking), so it works on arbitrary AI sites the classifier
  // identifies — no per-site selectors needed for v1.
  if (verdict.should_govern && tabId && !_injectedTabs.has(tabId)) {
    _injectedTabs.add(tabId);
    injectDlpStack(tabId).catch((e) => {
      // Most common failures: tab navigated away mid-inject, or page is on
      // a chrome:// URL we can't touch. Clear the marker so a later visit
      // gets another chance.
      _injectedTabs.delete(tabId);
      console.warn('[cfai] inject failed for tab', tabId, e?.message || e);
    });
  }

  return verdict;
}

// Shortcut for SaaS-with-AI allowlist hits and AI-affordance clicks. Skips
// the LLM and goes straight to /api/v1/known-ai-tool, which upserts the
// verdict + tool_usage row. Then injects the DLP stack into the tab.
async function markKnownAiTool({ host, vendor, product, category, sandbox, source, reason, tabId }) {
  if (!host) throw new Error('host required');

  // De-dupe: if we already injected on this tab, skip the server round-trip.
  if (tabId && _injectedTabs.has(tabId)) {
    return { is_ai: true, should_govern: true, vendor, product, category, sandbox, confidence: 1, classifier: 'known:' + (source || 'allowlist'), from_cache: true };
  }

  const token  = await ensureToken();
  const config = await getConfig();
  if (!token || !config.serverUrl) {
    return { is_ai: true, should_govern: false, classifier: 'unenrolled', reasoning: 'extension not enrolled' };
  }

  const res = await authedFetch('/api/v1/known-ai-tool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host, vendor, product, category, sandbox, source, reason }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`server ${res.status}: ${text.slice(0, 120)}`);
  }
  const verdict = await res.json();

  // Inject the DLP stack — same path as classifyHost.
  if (verdict.should_govern && tabId && !_injectedTabs.has(tabId)) {
    _injectedTabs.add(tabId);
    injectDlpStack(tabId).catch((e) => {
      _injectedTabs.delete(tabId);
      console.warn('[cfai] inject failed for tab', tabId, e?.message || e);
    });
  }
  return verdict;
}

// Inject the heavy DLP stack into a tab AFTER classification said yes.
// File order matters — vendor libs first, then patterns + complexity + replay,
// then content.js which reads window.__cfaiPatterns, window.__cfaiComplexity and
// window.__cfaiReplay.
//
// This list MUST stay in step with manifest.json's content_scripts[0].js (the
// hardcoded-host path). This is the OTHER injection path: hosts an admin added to
// the platforms registry, or that the LLM classifier decided to govern, only ever
// get the stack through here — so a file missing from this array means recording
// silently never happens on exactly the hosts an admin went out of their way to
// add. tests/replay-vendor.test.mjs asserts the two lists agree.
async function injectDlpStack(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: [
      'vendor/pdf.js',
      'vendor/mammoth.min.js',
      'vendor/xlsx.min.js',
      'vendor/jszip.min.js',
      'vendor/tesseract/tesseract.min.js',
      'vendor/rrweb-record.js',
      'content/patterns.js',
      'content/complexity.js',
      'content/replay.js',
      'content/content.js',
    ],
  });
  await chrome.scripting.insertCSS({
    target: { tabId, allFrames: false },
    files: ['content/content.css'],
  });
  console.info('[cfai] DLP stack injected into tab', tabId);
}

// --- wiring ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  // Branch: AI page-classification request from the fingerprinter content
  // script. Relays { host, signals } to /api/v1/classify-host and returns
  // the verdict so the content script can decide whether to govern. The
  // tabId is what classifyHost uses to inject the DLP stack into the right
  // tab on a positive verdict.
  if (msg.__cfai_kind === 'classifyHost') {
    classifyHost({ host: msg.host, signals: msg.signals, tabId: sender?.tab?.id })
      .then((verdict) => sendResponse({ ok: true, verdict }))
      .catch((err) => {
        console.warn('[cfai] classifyHost failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true; // async response
  }

  // Branch: known-AI shortcut. Used by:
  //   - SaaS-with-AI allowlist hits (Slack, Notion, M365, etc.)
  //   - AI-affordance click detection on otherwise-unclassified pages
  // Bypasses the LLM — calls /api/v1/known-ai-tool which upserts the
  // verdict + tool_usage record + injects the DLP stack.
  if (msg.__cfai_kind === 'knownAiTool') {
    markKnownAiTool({
      host:     msg.host,
      vendor:   msg.vendor,
      product:  msg.product,
      category: msg.category,
      sandbox:  msg.sandbox,
      source:   msg.source,
      reason:   msg.reason,
      tabId:    sender?.tab?.id,
    })
      .then((verdict) => sendResponse({ ok: true, verdict }))
      .catch((err) => {
        console.warn('[cfai] knownAiTool failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  // Control-channel RPC is NOT a governance event. This listener runs for every
  // runtime message, so anything it doesn't recognise falls through to
  // pushEvent() below and gets uploaded to /api/v1/dlp as a junk event. That was
  // already happening for the cfai-get-* polls; the video-recording phase adds
  // several more control messages, so the channel is now named explicitly. The
  // dedicated listeners further down answer these.
  if (isControlMessage(msg)) return;

  // Attach the tab URL host as the canonical source.
  // NOTE: events are forwarded VERBATIM — every field the content script sets
  // (including event kinds like `session_bind`) rides through the queue and the
  // /api/v1/dlp POST untouched. There is no field allowlist here on purpose; keep
  // it that way so new event fields don't need a service-worker change. That is
  // how `external_conv_id` — the AI site's own conversation id, stamped by
  // content.js's emit() at the moment of the action — reaches the ingest route
  // without a change here.
  //
  // TWO exceptions, both deliberate:
  //   session_id / client_seq  stamped BY THE WORKER (see pushTabEvent) because
  //                            session identity now lives here, not in the
  //                            content script. Whatever the sender put there is
  //                            overwritten.
  //   __cfai_visible           a control field, not governance data: it tells us
  //                            whether the tab was visible when the event fired,
  //                            which is what decides whether the idle window
  //                            slides. Stripped before the event is queued.
  const tabHost = sender?.tab?.url ? new URL(sender.tab.url).hostname : null;
  const tabId = sender?.tab?.id;
  const visible = msg.__cfai_visible !== false;
  const { __cfai_visible: _dropVisible, session_id: _dropSid, client_seq: _dropSeq, ...forwarded } = msg;
  const event = {
    ...forwarded,
    source: 'browser_extension',
    tabHost,
    receivedAt: new Date().toISOString(),
  };

  // Native OS notifications disabled — the in-page popup and toast already
  // alert the user. Chrome notifications are redundant and annoying when
  // multiple blocking events fire in quick succession.
  // const sev = msg.highest_severity || msg.severity;
  // if (sev === 'critical' || sev === 'high') {
  //   showNativeWarning(msg);
  // }

  pushTabEvent(event, tabId, tabHost, visible)
    .then((sessionId) => sendResponse({ ok: true, session_id: sessionId }))
    .catch(() => sendResponse({ ok: false }));
  return true; // async response
});

function showNativeWarning(msg) {
  const service = msg.service || 'AI service';
  const sev = (msg.highest_severity || msg.severity || '').toUpperCase();
  const patterns = (msg.matches || []).map((m) => m.pattern + (m.count > 1 ? '×' + m.count : '')).join(', ');
  const message =
    msg.kind === 'file_upload'
      ? `File: ${msg.filename || 'unknown'} (${patterns || msg.file_class || 'sensitive'})`
      : msg.kind === 'prompt_paste'
        ? `Paste — ${patterns || 'sensitive data'}`
        : msg.kind === 'prompt_submit'
          ? `Prompt — ${patterns || 'sensitive data'}`
          : `${msg.kind}: ${patterns || 'sensitive data'}`;

  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `⚠ ${service} → ${sev}`,
      message,
      contextMessage: 'Reported to CloudFuze AI Governance',
      priority: 2,
    });
  } catch (e) {
    console.warn('[cfai] notification failed', e);
  }
}

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_INTERVAL_MIN });
chrome.alarms.create(PLATFORMS_ALARM, { periodInMinutes: PLATFORMS_REFRESH_MIN });
chrome.alarms.create(BLOCKED_ALARM, { periodInMinutes: BLOCKED_REFRESH_MIN });
// The idle/cap sweep. 1 minute is the chrome.alarms floor, so an engagement can
// outlive its window by up to a minute — which is why every signal path also
// re-checks expiry through nextEngagement() instead of trusting the sweep.
chrome.alarms.create(ENGAGEMENT_SWEEP_ALARM, { periodInMinutes: 1 });
chrome.alarms.create(ROUTING_ALARM, { periodInMinutes: ROUTING_REFRESH_MIN });
chrome.alarms.create(DLP_POLICY_ALARM, { periodInMinutes: DLP_POLICY_REFRESH_MIN });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM)      { syncIdentity().catch(() => {}); flushQueue(); }
  if (alarm.name === PLATFORMS_ALARM)  refreshPlatforms();
  if (alarm.name === BLOCKED_ALARM)    refreshBlockedAgents();
  if (alarm.name === ENGAGEMENT_SWEEP_ALARM) engagementSweep().catch(() => {});
  if (alarm.name === ROUTING_ALARM)    { refreshRoutingRules(); refreshAiSurfaces(); }
  if (alarm.name === DLP_POLICY_ALARM) refreshDlpPolicy();
});

// Fetch once at load as well: the first alarm is up to DLP_POLICY_REFRESH_MIN
// away, and a freshly installed extension should not run unpoliced until then.
refreshDlpPolicy();

// Refresh once at startup too — alarm fires on its own schedule, not at boot.
// Best-effort: if the worker is unenrolled or offline, no-op.
refreshPlatforms().catch(() => {});
refreshBlockedAgents().catch(() => {});
refreshRoutingRules().catch(() => {});
refreshAiSurfaces().catch(() => {});

// Auto-link: detect desktop agent beacon → re-enroll with real hostname if needed.
// Runs every startup so a freshly installed extension links automatically.
// Wrapped in setTimeout to avoid racing with other startup tasks.
setTimeout(async () => {
  try {
    console.info('[cfai] checking for desktop agent beacon...');
    const beacon = await fetchBeacon();
    if (!beacon) { console.info('[cfai] desktop agent not detected'); return; }
    if (!beacon.hostname) { console.info('[cfai] beacon has no hostname'); return; }

    const config = await getConfig();

    // Update config with detected hostname (always, in case beacon info changed)
    const wasLinked = config.computerName === beacon.hostname;
    config.computerName = beacon.hostname;
    config.detectedUser = beacon.user;
    config.detectedMachineId = beacon.machineId;
    await setStored(STORAGE.CONFIG, config);

    if (wasLinked) {
      console.info('[cfai] already linked to:', beacon.hostname);
      // Still verify the enrollment happened — force re-enroll if the server
      // doesn't have a machine record with our expected hostname
      try {
        const checkRes = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/machines`);
        if (checkRes.ok) {
          const machines = await checkRes.json();
          const expectedHost = beacon.hostname + '-browser-extension';
          const found = machines.some(m => m.hostname === expectedHost);
          if (found) return; // all good — already enrolled with correct hostname
          console.info('[cfai] extension not enrolled with correct hostname yet, re-enrolling...');
        }
      } catch {} // server down — try re-enroll anyway
    } else {
      console.info('[cfai] detected desktop agent:', beacon.hostname, beacon.user);
    }

    // Force re-enrollment with the real hostname
    await chrome.storage.local.remove(STORAGE.TOKEN);
    console.info('[cfai] cleared old token, re-enrolling...');
    const newToken = await ensureToken();
    console.info('[cfai] re-enrolled:', newToken ? 'OK' : 'FAILED (no serverUrl/secret?)');
  } catch (err) {
    console.info('[cfai] desktop agent not detected:', err.message || 'fetch failed');
  }
}, 2000);
syncIdentity().catch(() => {});

// --- blocked agents sync ---

async function refreshBlockedAgents() {
  const config = await getConfig();
  if (!config.serverUrl) return;
  try {
    const res = await fetch(`${config.serverUrl}/api/lifecycle/blocked-agents`);
    if (!res.ok) return;
    const list = await res.json();
    await setStored(STORAGE.BLOCKED, list);
    await setStored(STORAGE.BLOCKED_AT, Date.now());
    // Notify content scripts so they can enforce immediately. Only http(s)
    // tabs can have our content script; skip chrome://, extensions, the Web
    // Store, etc. In MV3 sendMessage returns a promise, so a missing receiver
    // rejects ASYNC — a sync try/catch can't catch it. We must .catch() the
    // promise, or Chrome logs "Could not establish connection. Receiving end
    // does not exist." for every tab without our content script.
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      Promise.resolve(chrome.tabs.sendMessage(tab.id, { type: 'cfai-blocked-update', blocked: list }))
        .catch(() => { /* no content script in this tab — expected, ignore */ });
    }
  } catch {}
}

// Respond to content script requests for the blocked list
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'cfai-get-blocked') {
    getStored(STORAGE.BLOCKED, []).then(list => sendResponse({ blocked: list }));
    return true;
  }
  // Access exception check — relay through service worker to avoid mixed-content
  if (msg.__cfai_kind === 'checkAccessException') {
    (async () => {
      try {
        const config = await getConfig();
        if (!config.serverUrl) { sendResponse({ allowed: false }); return; }
        const machineId = await getOrCreateMachineId();
        const res = await fetch(
          `${config.serverUrl.replace(/\/$/, '')}/api/v1/access-exceptions/check?machine_id=${encodeURIComponent(machineId)}&tool_host=${encodeURIComponent(msg.tool_host)}`,
        );
        if (res.ok) {
          sendResponse(await res.json());
        } else {
          sendResponse({ allowed: false });
        }
      } catch { sendResponse({ allowed: false }); }
    })();
    return true;
  }
  // Access request — relay from content script to server
  if (msg.kind === 'access_request') {
    (async () => {
      try {
        const config = await getConfig();
        if (!config.serverUrl) { sendResponse({ error: 'Extension is not configured. Open extension settings and enter the server URL.' }); return; }
        const machineId = await getOrCreateMachineId();
        const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/access-requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            machine_id: machineId,
            hostname: config.computerName || null,
            // detectedUser is written ONLY by the desktop-agent beacon, so on a
            // browser-only install this field was always null even when the
            // extension knew the user's email from policy or the browser
            // profile. Attribution survived because the server resolves it from
            // the enrolled machine record via machine_id — but the payload said
            // "unknown" about someone we could name, which is one refactor away
            // from becoming true.
            user: await resolveUserIdentity(config),
            tool_host: msg.tool_host,
            tool_name: msg.tool_name,
            tool_vendor: msg.tool_vendor,
            reason: msg.reason || '',
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.error || 'Server returned ' + res.status });
        } else {
          const data = await res.json();
          sendResponse({ ok: true, id: data.id });
        }
      } catch (err) {
        sendResponse({ error: 'Cannot reach the governance server. Please check your network connection or contact IT.' });
      }
    })();
    return true; // async response
  }
});

// Pull the admin-editable AI platforms registry from /api/v1/ai-platforms
// and mirror it into chrome.storage.local. Content scripts (fingerprint.js)
// read it from storage directly — that's the channel from server policy to
// in-page behavior. Failures here are non-fatal: content scripts fall back
// to a small hardcoded list if storage hasn't been populated yet.
//
// ── PLATFORMS MIRROR TRUST (security-critical) ───────────────────────────────
// This mirror USED to be fetched with a plain unauthenticated fetch(), on the
// grounds that GET /ai-platforms is public and the block list should sync even
// with a stale token — wrong data there fails safe either way, because it only
// decided block-vs-allow.
//
// It does not only decide that any more. isRecordableHost() in lib/recording.js
// treats any registry row with governed:true OR blocked:true as RECORDABLE, and
// replayGate() answers the content script's "may I record" from this same mirror.
// With <all_urls> host permissions, an unauthenticated response is an on-path
// injection point that turns into full-DOM session recording and upload of an
// arbitrary internal site, off one forged row. So every fetch that WRITES this
// mirror goes through authedFetch(): the JWT the machine already holds for every
// other server call, plus its 401-rotation retry. An unenrolled install now syncs
// no platforms at all, which is the correct fail-closed answer for a mirror that
// can start a recording.
async function refreshPlatforms() {
  try {
    // AUTHED, deliberately — see PLATFORMS MIRROR TRUST below. No governed filter,
    // though: a blocked platform must sync even if it isn't otherwise governed, so
    // the content script can enforce the block.
    const config = await getConfig();
    if (!config.serverUrl) return;
    const res = await authedFetch('/api/v1/ai-platforms?surface=browser');
    if (!res.ok) return;
    const rows = await res.json();
    // Keep only the fields content scripts care about — keep storage small.
    const compact = rows.map((r) => ({
      host:     r.host,
      vendor:   r.vendor,
      product:  r.product,
      category: r.category,
      sandbox:  r.sandbox,
      governed: r.governed ? 1 : 0,
      blocked:  r.blocked ? 1 : 0,
    }));
    await setStored(STORAGE.PLATFORMS,    compact);
    await setStored(STORAGE.PLATFORMS_AT, Date.now());
    _platCache = compact;
    _platCacheAt = Date.now();
  } catch (e) {
    console.warn('[cfai] platforms refresh failed:', e?.message || e);
  }
}

// --- routing rules sync ---
// Pull model routing rules so the content script can auto-switch models before send.
async function refreshRoutingRules() {
  try {
    const config = await getConfig();
    if (!config.serverUrl) return;
    const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/routing/rules`);
    if (!res.ok) return;
    const rules = await res.json();
    const active = (rules || []).filter(r => r.enabled).sort((a,b) => (a.priority||50) - (b.priority||50));
    await setStored(STORAGE.ROUTING_RULES,    active);
    await setStored(STORAGE.ROUTING_RULES_AT, Date.now());
  } catch (e) {
    console.warn('[cfai] routing rules refresh failed:', e?.message || e);
  }
}

// Pull the DLP pattern policy derived from deployed compliance policy packs and
// mirror it into chrome.storage.local, where content scripts pick it up. This is
// the channel that lets a pack's `dlp` rules actually govern client detection
// instead of only describing it.
//
// Unauthenticated GET, like the platforms registry: detection policy must sync
// even when the extension's token is stale or it has not enrolled yet.
//
// On any failure we deliberately leave the previous mirror in place and do NOT
// write a default. patterns.js treats "no policy" as "run everything", so an
// empty write would look like a successful sync that silently disabled nothing —
// or worse, a truncated response could disable real detection.
// Where on a governed page capture is allowed. Mirrored into chrome.storage for
// the content scripts, exactly like the routing rules and the DLP policy.
//
// content.js also carries a BUILT-IN copy of this list. That is deliberate: the
// list is what stops an embedded-AI host (Gmail, HubSpot, Zendesk) having its
// whole page captured, and a privacy guarantee must not depend on a network call
// succeeding. This sync exists so a selector that goes stale when a vendor
// reshuffles its DOM is a config fix rather than an extension release — it can
// add hosts and replace selectors, never remove the built-in floor.
//
// Unauthenticated GET, like the platforms registry: scope policy must sync even
// when the token is stale or the extension has not enrolled yet.
async function refreshAiSurfaces() {
  try {
    const config = await getConfig();
    if (!config.serverUrl) return;
    const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/ai-surfaces`);
    if (!res.ok) return;
    const map = await res.json();
    if (!map || typeof map !== 'object' || !map.embedded) return;
    await setStored(STORAGE.AI_SURFACES, map);
  } catch (e) {
    // Leave the previous mirror in place; the built-in floor still applies.
    console.warn('[cfai] ai-surfaces refresh failed:', e?.message || e);
  }
}

async function refreshDlpPolicy() {
  try {
    const config = await getConfig();
    if (!config.serverUrl) return;
    const res = await fetch(
      `${config.serverUrl.replace(/\/$/, '')}/api/policy-packs/extension-config`,
    );
    if (!res.ok) return;
    const policy = await res.json();
    if (!policy || typeof policy !== 'object' || !policy.patterns) return;
    await setStored(STORAGE.DLP_POLICY, policy);
    await setStored(STORAGE.DLP_POLICY_AT, Date.now());
  } catch (e) {
    console.warn('[cfai] dlp policy refresh failed:', e?.message || e);
  }
}

// Near-real-time policy for open AI tabs. The content script asks every few
// seconds; we serve a short-lived cache so block/allow changes reflect in
// ~2-3s without hammering the server (one fetch per ~2.5s no matter how many
// tabs ask). chrome.alarms can't poll faster than 60s and an SW setInterval is
// unreliable, so the persistent content script drives the cadence.
let _platCache = null;
let _platCacheAt = 0;
const PLAT_CACHE_TTL_MS = 2500;
async function getFreshPlatforms() {
  const now = Date.now();
  if (_platCache && now - _platCacheAt < PLAT_CACHE_TTL_MS) return _platCache;
  const config = await getConfig();
  if (!config.serverUrl) return _platCache || [];
  try {
    // AUTHED for the same reason refreshPlatforms() is — this path also writes
    // STORAGE.PLATFORMS, which gates recording. See PLATFORMS MIRROR TRUST above.
    const res = await authedFetch('/api/v1/ai-platforms?surface=browser');
    if (res.ok) {
      const rows = await res.json();
      _platCache = rows.map((r) => ({
        host: r.host, vendor: r.vendor, product: r.product, category: r.category,
        sandbox: r.sandbox, governed: r.governed ? 1 : 0, blocked: r.blocked ? 1 : 0,
      }));
      _platCacheAt = now;
      await setStored(STORAGE.PLATFORMS, _platCache);
    }
  } catch { /* keep last cache */ }
  return _platCache || [];
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'cfai-get-platforms') {
    getFreshPlatforms().then((platforms) => sendResponse({ platforms })).catch(() => sendResponse({ platforms: null }));
    return true; // async response
  }
  // Content scripts cannot fetch cross-origin under the page CSP, so they ask us
  // for the mirrored DLP policy. Serving from storage keeps this cheap however
  // many tabs are open; the alarm above is what actually refreshes it.
  if (msg && msg.type === 'cfai-get-dlp-policy') {
    getStored(STORAGE.DLP_POLICY)
      .then((policy) => sendResponse({ policy: policy || null }))
      .catch(() => sendResponse({ policy: null }));
    return true;
  }
  if (msg && msg.type === 'cfai-get-features') {
    getStored('cfai.features')
      .then((f) => sendResponse({ features: f || null }))
      .catch(() => sendResponse({ features: null }));
    return true;
  }
});

// ── Feature flags — fetched from server, cached in storage ──────────────────
async function refreshFeatureFlags() {
  try {
    const config = await getConfig();
    // Try enrolled server first, then local fallbacks
    const urls = [];
    if (config.serverUrl) urls.push(config.serverUrl.replace(/\/$/, ''));
    if (!urls.includes('http://127.0.0.1:8787')) urls.push('http://127.0.0.1:8787');
    if (!urls.includes('http://localhost:8787')) urls.push('http://localhost:8787');
    for (const base of urls) {
      try {
        const res = await fetch(`${base}/api/v1/features`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        const data = await res.json();
        if (data?.features) {
          await setStored('cfai.features', data);
          chrome.storage.local.set({ 'cfai.features': data });
          return;
        }
      } catch {}
    }
  } catch {}
}
// Refresh on startup, again after 3s (in case server was slow), then every 2 minutes
refreshFeatureFlags();
setTimeout(refreshFeatureFlags, 3000);
setInterval(refreshFeatureFlags, 2 * 60 * 1000);

// ── Session Replay — the worker half of the rrweb recorder ──────────────────
// WHAT USED TO BE HERE, AND WHY IT IS GONE
// This section held the tab-VIDEO recording pipeline: chrome.tabCapture →
// MediaRecorder in an offscreen document, armed by a toolbar click, with a
// recordings map, a REC badge, an offscreen watchdog and a /api/v1/recordings
// registration. chrome.tabCapture only hands out a stream for a tab the extension
// has been INVOKED on — a click per tab, every time — so automatic governance
// recording was impossible with it. It was replaced by rrweb DOM/interaction
// recording in content/replay.js, which needs no gesture because it runs inside
// the content script the DLP layer already auto-injects.
//
// WHAT THIS SECTION IS NOW: pure TRANSPORT plus the three things a content script
// cannot answer for itself.
//   the host gate      lib/recording.js is ESM; a classic content script cannot
//                      import it, so isRecordableHost() is asked over the wire
//   the server policy  a content-script fetch would hit the page's CSP and has no
//                      JWT. authedFetch here has both.
//   the daily ledger   chrome.storage belongs to the worker
// The recorder's state machine, chunking, gzip and masking all live in
// content/replay.js. Nothing about a run is tracked here: these handlers are
// stateless request forwarders (the one exception is the policy cache below, which
// exists so 30 s polls from N open tabs do not become N server calls per 30 s).
//
// LOGGING DISCIPLINE, NON-NEGOTIABLE: sizes, counts, hosts, status codes. Never
// chunk_b64, never a decoded event, never prompt text. A chunk is opaque here and
// must stay that way — the /api/v1/replays chunk store is its only destination, and
// it must never reach the DLP event queue (which is exactly why every kind below is
// listed in CONTROL_KINDS).

const REPLAY_POLICY_TTL_MS = 5 * 60 * 1000;

let _replayPolicy = null;
let _replayPolicyAt = 0;

/** The last normalized policy, or null before the first successful fetch. */
function cachedReplayPolicy() {
  return _replayPolicy;
}

/**
 * GET /api/v1/replay-policy, normalized + clamped by lib/recording.js and cached
 * for REPLAY_POLICY_TTL_MS.
 *
 * The cache is the whole reason this function exists: every recording tab re-asks
 * its gate every 30 s, so without it N open tabs would be N server calls per 30 s
 * for a document that changes about never.
 *
 * Throws on any failure — deciding what a failure MEANS is replayGate()'s job, and
 * "the fetch failed" must never resolve to a policy that permits recording. A stale
 * cached policy is deliberately NOT served past its TTL: the policy is what says
 * whether recording is allowed at all.
 */
async function getReplayPolicy() {
  const now = Date.now();
  if (_replayPolicy && now - _replayPolicyAt < REPLAY_POLICY_TTL_MS) return _replayPolicy;
  const res = await authedFetch('/api/v1/replay-policy');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  _replayPolicy = normalizeReplayPolicy(await res.json());
  _replayPolicyAt = now;
  return _replayPolicy;
}

// localhost/127.0.0.1/[::1], any port. Mirrors the web platform's own Secure
// Context exemption for loopback (https://w3c.github.io/webappsec-secure-contexts/#localhost):
// traffic to loopback never leaves the machine, so there is no network path for
// an attacker to intercept or spoof it on — the exact risk isSecureServerUrl()
// exists to close for a REMOTE host. A developer running the stack from a fresh
// clone therefore gets working Session Replay against `http://localhost:8787`
// with no certificate, no trust-store change, no download of any kind — the
// same zero-setup bar every other feature (DLP, enrollment) already has.
// Matched against URL.hostname (via safeHost), which strips the port but KEEPS
// the [] brackets an IPv6 literal wears in a URL string (confirmed: Node's
// `new URL('http://[::1]:8787').hostname` is `'[::1]'`, not `'::1'`) — an
// anchored exact match, so `localhost.evil.com` does not qualify as `localhost`.
const LOOPBACK_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Is the configured server a TLS endpoint, OR loopback (see LOOPBACK_HOST_RE)?
 *
 * SCOPED TO REPLAY ON PURPOSE. options.html takes the server URL as a bare
 * type="url" with no scheme restriction, and DLP enrollment/flush have historically
 * tolerated http:// (an on-prem lab server, a dev box), so tightening that here would
 * break installs that are working today. Session recording is a different bar: it
 * ships the DOM of the page, and both the recording TRIGGER (the platforms mirror)
 * and the evidence itself would cross the wire in cleartext, readable and forgeable
 * by anyone on the path — UNLESS that path is loopback, which by definition has no
 * wire for anyone else to be on. A non-https, non-loopback server means
 * enabled:false for replay only, with a warning that says why.
 */
function isSecureServerUrl(serverUrl) {
  if (typeof serverUrl !== 'string') return false;
  const trimmed = serverUrl.trim().toLowerCase();
  if (trimmed.startsWith('https://')) return true;
  if (!trimmed.startsWith('http://')) return false;
  const host = safeHost(trimmed);
  return !!host && LOOPBACK_HOST_RE.test(host);
}

let _insecureUrlWarned = false;

/** The host of the tab that sent this message. The SENDER is trusted, not the body. */
function senderHost(msg, sender) {
  const fromSender = sender?.tab?.url ? safeHost(sender.tab.url) : null;
  if (fromSender) return fromSender;
  return typeof msg?.host === 'string' && msg.host ? safeHost('https://' + msg.host) || msg.host : null;
}

/**
 * Answer the content script's every-30s "may I record, and under what policy".
 *
 * FAILS CLOSED on every unhappy path: an unenrolled install, an unreachable
 * policy, no serverUrl, no token → enabled:false with a reason. `recordable` is
 * still reported, because that answer does not depend on the server being up and
 * the content script logs it.
 */
async function replayGate(msg, sender) {
  const host = senderHost(msg, sender);
  // The MIRROR, same as sessionTouch(): the host gate must not depend on a network
  // round-trip, and must not answer differently because one fetch failed.
  const platforms = await getStored(STORAGE.PLATFORMS, []);
  const recordable = isRecordableHost(host, platforms).ok;

  let policy;
  try {
    policy = await getReplayPolicy();
  } catch (err) {
    const message = String(err?.message || err);
    const reason = /not configured|not enrolled/i.test(message) ? 'not_enrolled' : 'policy_unavailable';
    return { ok: true, recordable, enabled: false, reason };
  }

  // No destination for the evidence means do not record and do not show a banner.
  // A cleartext destination counts as no destination — see isSecureServerUrl().
  const config = await getConfig();
  const token = await getStored(STORAGE.TOKEN);
  const secure = isSecureServerUrl(config.serverUrl);
  if (config.serverUrl && !secure && !_insecureUrlWarned) {
    _insecureUrlWarned = true;
    console.warn('[cfai] session replay is OFF: the configured server URL is not https:// (or localhost/127.0.0.1).',
                 'Recording uploads the page DOM, and the platforms registry that decides',
                 'WHICH hosts get recorded would both be readable and forgeable over http to a REMOTE server.',
                 'Fix the Server URL on the options page — https:// for a real deployment,',
                 'or http://localhost:<port> / http://127.0.0.1:<port> for local development.');
  }
  const enabled = !!policy.enabled && secure && !!(typeof token === 'string' && token);

  const ledger = await getStored(STORAGE.RECORDING_DAILY, null);
  return {
    ok: true,
    recordable,
    enabled,
    ...(enabled ? {} : {
      reason: !config.serverUrl ? 'not_configured'
        : !secure ? 'insecure_server_url'
        : !token ? 'not_enrolled'
        : 'policy_disabled',
    }),
    policy,
    remaining_daily_ms: remainingDailyMs(ledger, policy.max_daily_ms),
  };
}

/** POST /api/v1/replays. 201 and 200 (idempotent re-register) are both success. */
async function replayRegister(msg, sender) {
  const tabId = sender?.tab?.id;
  const host = senderHost(msg, sender) || msg?.tab_host || null;
  const body = {
    replay_id: msg?.replay_id,
    session_id: msg?.session_id,
    tab_host: host,
    started_at: msg?.started_at,
    recorder: msg?.recorder,
    mask_profile: msg?.mask_profile,
    capture: 'dom_events',
  };
  // The canonical service key the engagement is already keyed by. Omitted rather
  // than guessed when there is none — the server defaults it to 'unknown'.
  const engagement = typeof tabId === 'number' ? await getEngagement(tabId) : null;
  const aiService = msg?.ai_service || engagement?.service_key || null;
  if (aiService) body.ai_service = aiService;
  // The AI site's own conversation id, when the recorder already knew it at
  // registration (an EXISTING chat being revisited). Rides along exactly like
  // ai_service above; a run that learns its conversation later sends a separate
  // replayBindConversation instead. Omitted rather than sent as null so the
  // server's "optional, defaults null" path is the one that runs.
  const convId = typeof msg?.external_conv_id === 'string' && msg.external_conv_id.trim()
    ? msg.external_conv_id.trim()
    : null;
  if (convId) body.external_conv_id = convId;

  const res = await authedFetch('/api/v1/replays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 201 || res.status === 200) {
    console.info('[cfai] replay run registered', msg?.replay_id, '—', host, `(${res.status})`);
    return { ok: true };
  }
  console.warn('[cfai] replay register refused:', res.status);
  return { ok: false, error: res.status };
}

/**
 * POST /api/v1/replays/:replay_id/chunks/:seq. STATELESS — forward and answer.
 * There is no queue here on purpose (see the note on the lib/recording.js import).
 * A rejected chunk is the recorder's problem; it rolls back in memory and, after a
 * few consecutive refusals, ends the run with stop_reason 'chunk_rejected'.
 */
async function replayChunk(msg) {
  const replayId = String(msg?.replay_id ?? '');
  const seq = Number(msg?.seq);
  if (!replayId || !Number.isInteger(seq) || seq < 0) return { ok: false, error: 'bad chunk address' };

  // EXACTLY these fields. Whatever else rode along on the control message (there
  // should be nothing) does not reach the server.
  const body = {
    encoding: msg?.encoding,
    chunk_b64: msg?.chunk_b64,
    sha256: msg?.sha256,
    event_count: msg?.event_count,
    first_ts: msg?.first_ts,
    last_ts: msg?.last_ts,
    has_full_snapshot: msg?.has_full_snapshot,
    has_font_event: msg?.has_font_event,
  };
  const b64Len = typeof body.chunk_b64 === 'string' ? body.chunk_b64.length : 0;

  const res = await authedFetch(
    `/api/v1/replays/${encodeURIComponent(replayId)}/chunks/${seq}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 204) return { ok: true };
  // Sizes, counts and the status code only.
  console.warn('[cfai] replay chunk', seq, 'refused:', res.status,
               `(${body.event_count} events, ${Math.round(b64Len / 1024)} KB b64)`);
  return { ok: false, error: res.status };
}

/**
 * POST /api/v1/replays/:replay_id/conversation — "this run turned out to be in
 * conversation X". Only sent for a run that registered before the site had
 * minted a conversation id (a brand-new chat); an existing chat's id rides along
 * in the registration payload instead.
 *
 * Set-once server-side: 204 on a set or an idempotent repeat, 409 if the run
 * already carries a DIFFERENT id or is no longer recording. Every non-204 is
 * reported as { ok:false } and the recorder decides what to do — a failed bind
 * never stops a recording, it only leaves the run ungrouped.
 */
async function replayBindConversation(msg) {
  const replayId = String(msg?.replay_id ?? '');
  const convId = typeof msg?.external_conv_id === 'string' ? msg.external_conv_id.trim() : '';
  if (!replayId) return { ok: false, error: 'replay_id required' };
  if (!convId) return { ok: false, error: 'external_conv_id required' };

  const res = await authedFetch(`/api/v1/replays/${encodeURIComponent(replayId)}/conversation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ external_conv_id: convId }),
  });
  if (res.status === 204) return { ok: true };
  console.warn('[cfai] replay conversation bind refused:', res.status);
  return { ok: false, error: res.status };
}

/** POST /api/v1/replays/:replay_id/complete. Idempotent server-side; 200 is success. */
async function replayComplete(msg) {
  const replayId = String(msg?.replay_id ?? '');
  if (!replayId) return { ok: false, error: 'replay_id required' };
  const res = await authedFetch(`/api/v1/replays/${encodeURIComponent(replayId)}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stop_reason: msg?.stop_reason,
      chunk_count: msg?.chunk_count,
      event_count: msg?.event_count,
      session_ids: msg?.session_ids,
      ended_at: msg?.ended_at,
      duration_ms: msg?.duration_ms,
    }),
  });
  if (res.status === 200) {
    console.info('[cfai] replay run complete', replayId,
                 `— ${msg?.chunk_count ?? 0} chunks, ${msg?.event_count ?? 0} events,`,
                 `reason=${msg?.stop_reason ?? 'unknown'}`);
    return { ok: true };
  }
  console.warn('[cfai] replay complete refused:', res.status);
  return { ok: false, error: res.status };
}

// --- single writer over cfai.recordingDaily ---
// Same promise-chain trick as withSessionsLock: the ledger is one key that every
// recording tab read-modify-writes, so two tabs reporting accrual in the same task
// would each read the same starting total and one increment would vanish. A
// rejection must not poison the next waiter, hence the catch on the tail.
let _dailyChain = Promise.resolve();
function withDailyLock(fn) {
  const run = _dailyChain.then(fn, fn);
  _dailyChain = run.catch(() => {});
  return run;
}

/** Add observed milliseconds to today's total and report what is left. */
async function replayAccrueDaily(ms) {
  return withDailyLock(async () => {
    const ledger = await getStored(STORAGE.RECORDING_DAILY, null);
    const next = accrueDaily(ledger, ms);
    await setStored(STORAGE.RECORDING_DAILY, next);
    const policy = cachedReplayPolicy() || DEFAULT_REPLAY_POLICY;
    return remainingDailyMs(next, policy.max_daily_ms);
  });
}

// Control-message discriminators — see the guard in the event listener above.
// These MUST keep listing every control message any other context can send, even
// ones nothing answers any more: an unrecognised message falls through to the
// event path and gets uploaded to /api/v1/dlp as a junk governance event. For the
// replay* kinds that is not merely junk — a replayChunk falling through would park
// gzipped, base64'd, UNMASKED composer DOM in the DLP queue and POST it to
// /api/v1/dlp, i.e. raw prompt bytes into the wrong store. Every replay kind below
// is load-bearing; tests/worker-load.test.mjs asserts the chunk case specifically.
const CONTROL_TYPES = new Set([
  'cfai-get-blocked',
  'cfai-get-platforms',
  'cfai-blocked-update',
  'cfai-arm-recording',
  'cfai-stop-recording',
  'cfai-recording-state',
]);
const CONTROL_KINDS = new Set([
  'classifyHost',
  'knownAiTool',
  'checkAccessException',
  'currentSessionId',
  'replayPolicy',
  'replayRegister',
  'replayBindConversation',
  'replayChunk',
  'replayComplete',
  'replayDailyAccrued',
]);
function isControlMessage(msg) {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.__cfai_kind && CONTROL_KINDS.has(msg.__cfai_kind)) return true;
  return !!(msg.type && CONTROL_TYPES.has(msg.type));
}

// --- the session_id this tab is currently in ---
// A PLAIN LOCAL READ of the tab's engagement. This used to be a cross-context
// relay (worker → tabs.sendMessage → content script → its _sessionId local),
// because the content script was the only holder of session identity. The worker
// owns it now, so there is nothing to ask anybody: an out-of-process round-trip
// to learn our own state would just be a way to get a different answer per frame.
//
// A tab with no engagement answers null — that is normal and means "nobody has
// used the AI in this tab yet". Asking must never MINT (that would open a
// conversation with no turns), and an engagement the sweep is about to reap is
// reported as null rather than handed out for one last event.
async function getTabSessionId(tabId) {
  const rec = await getEngagement(tabId);
  if (!rec || !rec.session_id) return null;
  if (engagementExpiry(rec, Date.now(), engagementPolicy())) return null;
  return rec.session_id;
}

// --- wiring ---

// The toolbar icon. It used to be the recording ARM GESTURE — chrome.tabCapture
// required a per-tab invocation, which is why manifest.json declares no
// default_popup (a popup suppresses onClicked entirely). rrweb recording needs no
// gesture, so there is nothing to arm, and the listener is kept only as the
// settings shortcut armTab already had for a not-yet-configured install. A toolbar
// icon that does nothing at all reads as a broken extension.
chrome.action.onClicked.addListener(() => {
  try { chrome.runtime.openOptionsPage(); } catch (e) {}
});

// A closed tab ends its engagement. 'tab_closed' is the one session boundary that
// is not a signal about a host, so nextEngagement() has nothing to say about it
// and the close is driven from here.
chrome.tabs.onRemoved.addListener((tabId) => {
  closeEngagement(tabId, 'tab_closed').catch(() => {});
});

// A top-frame navigation is the engagement's navigation boundary: a same-service
// commit (a reload, a hard navigation between chats, "New chat") CONTINUES the
// engagement — that is the entire point of moving session identity out of the
// content script. Only a commit to a DIFFERENT service ends it
// ('service_changed'), or to a host that is not an AI surface at all
// ('navigated_away'). A service change does not mint a replacement here: the next
// activity signal does, because a commit is not evidence anyone used the new
// service.
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (details.frameId !== 0) return;
  let host = null;
  try { host = new URL(details.url).hostname; } catch {}
  sessionTouch(details.tabId, host, { type: 'nav_committed', isTopFrame: true }).catch(() => {});
});

// Control channel. Kept separate from the event listener above, which treats
// unrecognised messages as governance events.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  // "Which session is this tab in right now?" Asked by the content script so the
  // replay controller can scope one run to one session_id. A plain read of the
  // tab's stored engagement — no relay, no minting. A null answer is normal and
  // means "nobody has used the AI in this tab yet".
  //
  // `touch: true` also counts the ask as visible-tab use, which is how the
  // content script's visibilitychange refresh keeps a session alive while someone
  // is reading a long reply without typing. It still never mints.
  if (msg.__cfai_kind === 'currentSessionId') {
    const tabId = typeof msg.tab_id === 'number' ? msg.tab_id : sender?.tab?.id;
    const host = sender?.tab?.url ? safeHost(sender.tab.url) : null;
    const answer = msg.touch
      ? sessionTouch(tabId, host, { type: 'touch', visible: msg.__cfai_visible !== false })
          .then((r) => r.session_id)
      : getTabSessionId(tabId);
    answer
      .then((sessionId) => sendResponse({ session_id: sessionId }))
      .catch(() => sendResponse({ session_id: null }));
    return true;
  }

  // ── the replay recorder's six RPCs ───────────────────────────────────────
  // content/replay.js is the state machine; these are its hands. Every one of them
  // answers asynchronously (hence `return true`) and NEVER rejects into the
  // channel: the recorder treats a missing or { ok:false } answer as "not
  // accepted" and handles it itself, so a thrown error here would only turn a
  // handled outage into an unhandled one.

  // "May I record this tab, and under what policy / what budget is left?" Polled
  // every 30 s per recording tab, which is why the policy behind it is cached.
  if (msg.__cfai_kind === 'replayPolicy') {
    replayGate(msg, sender)
      .then(sendResponse)
      .catch((err) => {
        console.warn('[cfai] replay policy failed:', err?.message || err);
        sendResponse({ ok: true, recordable: false, enabled: false, reason: 'policy_unavailable' });
      });
    return true;
  }

  // A run has a session_id and is opening a server row for itself.
  if (msg.__cfai_kind === 'replayRegister') {
    replayRegister(msg, sender)
      .then(sendResponse)
      .catch((err) => {
        console.warn('[cfai] replay register failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  // A registered run learned which conversation it is in. Metadata only — one
  // opaque id the AI site itself minted.
  if (msg.__cfai_kind === 'replayBindConversation') {
    replayBindConversation(msg)
      .then(sendResponse)
      .catch((err) => {
        console.warn('[cfai] replay conversation bind failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  // One gzipped chunk of the event stream. Forwarded verbatim, never stored here,
  // never logged beyond its size and the response status.
  if (msg.__cfai_kind === 'replayChunk') {
    replayChunk(msg)
      .then(sendResponse)
      .catch((err) => {
        console.warn('[cfai] replay chunk upload failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  if (msg.__cfai_kind === 'replayComplete') {
    replayComplete(msg)
      .then(sendResponse)
      .catch((err) => {
        console.warn('[cfai] replay complete failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  // Observed-time accrual against the daily cap. The worker is the ledger's only
  // writer; the recorder reports a delta and gets the remaining budget back so the
  // cap still bites before its next policy poll.
  if (msg.__cfai_kind === 'replayDailyAccrued') {
    replayAccrueDaily(Number(msg.ms))
      .then((remaining) => sendResponse({ ok: true, remaining_daily_ms: remaining }))
      .catch((err) => {
        console.warn('[cfai] replay daily accrual failed:', err?.message || err);
        sendResponse({ ok: false, error: err?.message || String(err) });
      });
    return true;
  }

  // Everything else on this channel belonged to the video recorder: the arm /
  // stop / is-this-tab-recording requests and the offscreen document's
  // recordingStopped / recordingDailyAccrued / refreshMachineToken RPCs. They are
  // gone with it. content.js's recording-banner region still SENDS
  // cfai-stop-recording and cfai-recording-state; nothing answers, its callbacks
  // already tolerate a missing responder (they read chrome.runtime.lastError), and
  // isControlMessage() still lists both so they can never be mistaken for
  // governance events and uploaded.
});

// A stale alarm from the deleted offscreen watchdog would keep waking this worker
// once a minute forever with nothing to handle it — chrome.alarms persist across
// extension updates.
chrome.alarms.clear('cfai-recording-watchdog').catch(() => {});

// Also flush on startup. A browser restart also ends every session: tab ids are
// not stable across it, so a persisted engagement can no longer be matched to the
// tab it belonged to and nothing resumes.
chrome.runtime.onStartup.addListener(() => {
  flushQueue();
  closeEngagementsOnStartup().catch(() => {});
  autoConfigFromBaked();
  autoConfigFromManaged();
});
// Auto-configure from baked cfai-config.json and enroll.
// Runs on install, update, AND startup so re-loading the extension or
// restarting the browser always picks up the baked config.
async function autoConfigFromBaked() {
  try {
    const r = await fetch(chrome.runtime.getURL('cfai-config.json'));
    if (!r.ok) { console.info('[cfai] no baked cfai-config.json'); return; }
    const baked = await r.json();
    if (!baked.preConfigured || !baked.serverUrl || !baked.enrollSecret) return;
    // Always apply — stale storage from a previous install must not block it.
    await setStored(STORAGE.CONFIG, { serverUrl: baked.serverUrl, enrollSecret: baked.enrollSecret });
    await chrome.storage.local.remove([STORAGE.TOKEN]); // clear stale token
    console.info('[cfai] auto-configured from baked config:', baked.serverUrl);
    const token = await ensureToken();
    console.info('[cfai] auto-enroll result:', token ? 'OK' : 'FAILED');
  } catch (e) { console.warn('[cfai] auto-config error:', e?.message || e); }
}

// Zero-touch enterprise provisioning: when an admin pushes serverUrl + enrollSecret
// through managed policy (Intune / Group Policy), enroll automatically — no options
// page, no user action. getConfig() already layers managed policy over local, so we
// only need to clear any stale token and re-run enrollment when policy is present.
async function autoConfigFromManaged() {
  try {
    const managed = await getManagedConfig();
    if (!managed.serverUrl || !managed.enrollSecret) {
      console.info('[cfai] no managed policy (serverUrl/enrollSecret) present');
      return;
    }
    console.info('[cfai] managed policy detected, auto-enrolling against', managed.serverUrl);
    const token = await ensureToken();
    console.info('[cfai] managed auto-enroll result:', token ? 'OK' : 'FAILED');
  } catch (e) { console.warn('[cfai] managed auto-config error:', e?.message || e); }
}

// Re-enroll if the admin changes policy after install (e.g. rotates the secret or
// points at a new server). Managed storage fires onChanged in the 'managed' area.
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'managed') return;
  const touched = MANAGED_KEYS.some((k) => k in changes);
  if (!touched) return;
  console.info('[cfai] managed policy changed, re-provisioning');
  chrome.storage.local.remove([STORAGE.TOKEN]).finally(() => { autoConfigFromManaged(); });
});

chrome.runtime.onInstalled.addListener(() => {
  flushQueue();
  autoConfigFromBaked();
  autoConfigFromManaged();
});
