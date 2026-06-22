// MV3 service worker — batches events from content scripts and POSTs to the
// governance server. Survives termination by persisting queue + token to
// chrome.storage.local, using chrome.alarms for periodic flushes.

const STORAGE = {
  CONFIG:    'cfai.config',
  TOKEN:     'cfai.token',
  MACHINE_ID:'cfai.machineId',
  QUEUE:     'cfai.queue',
  PLATFORMS: 'cfai.platforms',         // mirror of GET /api/v1/ai-platforms
  PLATFORMS_AT: 'cfai.platforms_at',   // timestamp of last refresh
};

const FLUSH_ALARM = 'cfai-flush';
const FLUSH_INTERVAL_MIN = 1;       // chrome.alarms minimum
const BATCH_SIZE = 50;

const PLATFORMS_ALARM = 'cfai-platforms-refresh';
const PLATFORMS_REFRESH_MIN = 10;   // how often to pull the registry

// --- helpers ---

async function getStored(key, fallback = null) {
  const obj = await chrome.storage.local.get([key]);
  return obj[key] ?? fallback;
}
async function setStored(key, value) {
  await chrome.storage.local.set({ [key]: value });
}
async function getConfig() {
  return getStored(STORAGE.CONFIG, { serverUrl: '', enrollSecret: '' });
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
  const hostname = navigator.userAgent.split(/[\s/(]/)[0] + '-browser-extension';

  try {
    const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId, hostname, enrollSecret: config.enrollSecret }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { token } = await res.json();
    await setStored(STORAGE.TOKEN, token);
    return token;
  } catch (err) {
    console.warn('[cfai] enrollment failed:', err.message);
    return null;
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

async function flushQueue() {
  const queue = (await getStored(STORAGE.QUEUE)) || [];
  if (queue.length === 0) return;

  const config = await getConfig();
  if (!config.serverUrl) return;
  const token = await ensureToken();
  if (!token) return;

  const batch = queue.slice(0, BATCH_SIZE);
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
// File order matters — vendor libs first, then patterns, then content.js
// which reads window.__cfaiPatterns.
async function injectDlpStack(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: [
      'vendor/pdf.js',
      'vendor/mammoth.min.js',
      'vendor/xlsx.min.js',
      'vendor/jszip.min.js',
      'vendor/tesseract/tesseract.min.js',
      'content/patterns.js',
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

  // Attach the tab URL host as the canonical source
  const tabHost = sender?.tab?.url ? new URL(sender.tab.url).hostname : null;
  const event = {
    ...msg,
    source: 'browser_extension',
    tabHost,
    receivedAt: new Date().toISOString(),
  };

  // Native OS notification for high/critical events so the user sees the
  // warning even when the AI tab isn't focused. Goes through Windows Action
  // Center / macOS Notification Center.
  const sev = msg.highest_severity || msg.severity;
  if (sev === 'critical' || sev === 'high') {
    showNativeWarning(msg);
  }

  pushEvent(event).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
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
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM)     flushQueue();
  if (alarm.name === PLATFORMS_ALARM) refreshPlatforms();
});

// Refresh once at startup too — alarm fires on its own schedule, not at boot.
// Best-effort: if the worker is unenrolled or offline, no-op.
refreshPlatforms().catch(() => {});

// Pull the admin-editable AI platforms registry from /api/v1/ai-platforms
// and mirror it into chrome.storage.local. Content scripts (fingerprint.js)
// read it from storage directly — that's the channel from server policy to
// in-page behavior. Failures here are non-fatal: content scripts fall back
// to a small hardcoded list if storage hasn't been populated yet.
async function refreshPlatforms() {
  try {
    const res = await authedFetch('/api/v1/ai-platforms?governed=1&surface=browser');
    if (!res.ok) return;
    const rows = await res.json();
    // Keep only the fields content scripts care about — keep storage small.
    const compact = rows.map((r) => ({
      host:     r.host,
      vendor:   r.vendor,
      product:  r.product,
      category: r.category,
      sandbox:  r.sandbox,
    }));
    await setStored(STORAGE.PLATFORMS,    compact);
    await setStored(STORAGE.PLATFORMS_AT, Date.now());
  } catch (e) {
    console.warn('[cfai] platforms refresh failed:', e?.message || e);
  }
}

// Also flush on startup
chrome.runtime.onStartup.addListener(() => flushQueue());
chrome.runtime.onInstalled.addListener(() => flushQueue());
