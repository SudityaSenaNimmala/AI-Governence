// Shared helpers for Session Replay — the WORKER half.
//
// Imported by background/service-worker.js (an ESM MV3 worker). NOT importable
// from the content script: content scripts are classic scripts and this repo has
// no bundler, which is why the content-side pure logic (the replay state machine)
// lives in content/replay.js instead, exposed on `window.__cfaiReplay` the same
// way content/patterns.js exposes the pattern catalog.
//
// Everything in this file is PURE: no chrome.*, no DOM, no fetch, no Date.now()
// without an injected `now`. That is deliberate — it makes the policy clamps, the
// daily-cap ledger math, the host allowlist and the bounded upload queue
// unit-testable with plain `node --test`. See tests/recording.test.mjs.
//
// HISTORY (read this before re-adding video code): an earlier round recorded the
// tab to WebM via chrome.tabCapture + MediaRecorder in an offscreen document.
// Chrome only hands out a tabCapture stream for a tab the extension has been
// INVOKED on (a toolbar click), so recording could never be automatic. The
// feature was pivoted to rrweb DOM/interaction recording, which needs no gesture,
// no offscreen document and no tabCapture/offscreen permissions at all. The
// segment sequencer, the byte-capped video retry buffer and the fps/bitrate/
// resolution/segment_ms policy fields were deleted with it — a variable-rate JSON
// event stream has no equivalent of any of them.

// ── Replay policy ───────────────────────────────────────────────────────────
// The server owns policy (GET /api/v1/replay-policy). The extension still clamps
// every field: a policy row edited to flush every 10ms would hammer the queue,
// and a missing/unreachable policy must not mean "no recording limits".

// How long one ENGAGEMENT (see the engagement section below) may live. These are
// session-boundary knobs, not recorder knobs, but they ride on the same policy
// document and get the same clamping treatment — a server that sets
// idle_timeout_ms to 5ms must not be able to rotate a session per keystroke.
export const ENGAGEMENT_DEFAULTS = Object.freeze({
  idle_timeout_ms: 900_000,                // 15 min without VISIBLE-tab use ends it
  max_session_ms: 43_200_000,              // 12 h hard cap, activity or not
});

export const DEFAULT_REPLAY_POLICY = Object.freeze({
  enabled: true,
  chunk_flush_ms: 10_000,                  // upload cadence for accumulated events
  chunk_max_bytes: 256 * 1024,             // uncompressed JSON buffered before an early flush
  max_run_ms: 60 * 60 * 1000,              // 1h per run (one session_id's lifetime)
  max_daily_ms: 4 * 60 * 60 * 1000,        // 4h of observed time per machine per local day
  checkout_every_ms: 5 * 60 * 1000,        // rrweb full-snapshot checkpoint interval
  mask_profile: 'composer_visible',
  retention_days: 30,
  ...ENGAGEMENT_DEFAULTS,
});

const LIMITS = {
  chunk_flush_ms:    { min: 1_000,      max: 120_000 },
  chunk_max_bytes:   { min: 16 * 1024,  max: 4 * 1024 * 1024 },
  max_run_ms:        { min: 60_000,     max: 8 * 60 * 60 * 1000 },
  max_daily_ms:      { min: 60_000,     max: 24 * 60 * 60 * 1000 },
  checkout_every_ms: { min: 30_000,     max: 30 * 60 * 1000 },
  retention_days:    { min: 1,          max: 3650 },
  // 1 min floor so a session cannot be rotated out from under a live
  // conversation; 4h ceiling because an idle window that long stops being a
  // boundary at all (the 12h cap is the backstop for that case).
  idle_timeout_ms:   { min: 60_000,     max: 4 * 60 * 60 * 1000 },
  max_session_ms:    { min: 60_000,     max: 24 * 60 * 60 * 1000 },
};

// Aliases accepted so a small naming drift on the server track does not silently
// degrade every client to defaults.
const ALIASES = {
  chunk_flush_ms:    ['chunk_flush_ms', 'flush_ms', 'chunkFlushMs', 'chunk_interval_ms'],
  chunk_max_bytes:   ['chunk_max_bytes', 'max_chunk_bytes', 'chunkMaxBytes'],
  max_run_ms:        ['max_run_ms', 'max_recording_ms', 'max_duration_ms', 'maxRunMs'],
  max_daily_ms:      ['max_daily_ms', 'daily_budget_ms', 'maxDailyMs'],
  checkout_every_ms: ['checkout_every_ms', 'checkoutEveryNms', 'snapshot_every_ms', 'checkoutEveryMs'],
  retention_days:    ['retention_days', 'retentionDays', 'retention'],
  idle_timeout_ms:   ['idle_timeout_ms', 'session_idle_ms', 'engagement_idle_ms', 'idleTimeoutMs'],
  max_session_ms:    ['max_session_ms', 'session_max_ms', 'engagement_max_ms', 'maxSessionMs'],
};

// The ONLY masking profiles this client knows how to honour.
//   composer_visible — maskAllInputs, then unmask just the prompt composer
//   mask_all         — mask every input, composer included
// An UNRECOGNISED profile clamps to 'mask_all', not to the default. A governance
// product must never read a policy value it does not understand as "show more".
export const MASK_PROFILES = Object.freeze(['composer_visible', 'mask_all']);
const FAIL_SAFE_MASK_PROFILE = 'mask_all';

function pickNumber(raw, keys) {
  for (const k of keys) {
    const v = raw?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    // Servers that hand numbers back as strings (a JSON column, a form post)
    // should not silently fall back to the default.
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function clamp(n, { min, max }) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Turn whatever /api/v1/replay-policy returned into a policy this client is
 * willing to act on. Unknown / missing / out-of-range fields fall back to
 * DEFAULT_REPLAY_POLICY, clamped to LIMITS.
 *
 * `enabled` is fail-OPEN-to-default (a policy body with no `enabled` key means
 * enabled) but explicit `false` / 0 disables recording. A policy that cannot be
 * fetched at all is the caller's decision, not ours — see fetchReplayPolicy().
 */
export function normalizeReplayPolicy(raw) {
  const out = { ...DEFAULT_REPLAY_POLICY };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.enabled === false || raw.enabled === 0 || raw.enabled === 'false') out.enabled = false;
    for (const key of Object.keys(LIMITS)) {
      const v = pickNumber(raw, ALIASES[key]);
      if (v !== null) out[key] = clamp(v, LIMITS[key]);
    }
    const profile = raw.mask_profile ?? raw.maskProfile;
    if (profile !== undefined && profile !== null && profile !== '') {
      out.mask_profile = MASK_PROFILES.includes(String(profile))
        ? String(profile)
        : FAIL_SAFE_MASK_PROFILE;
    }
  }
  // Flushing less often than we take full snapshots would leave a chunk holding
  // two snapshots and delay evidence for minutes at a time.
  if (out.chunk_flush_ms > out.checkout_every_ms) out.chunk_flush_ms = out.checkout_every_ms;
  // An idle window longer than the hard cap can never be reached, which would
  // silently turn "15 min idle" into "12 h always".
  if (out.idle_timeout_ms > out.max_session_ms) out.idle_timeout_ms = out.max_session_ms;
  return out;
}

// The per-run hard caps (max chunks / max gzipped bytes per run) are NOT here.
// They belong to the recorder that enforces them and live in content/replay.js as
// MAX_CHUNKS_PER_RUN / MAX_RUN_BYTES. This module used to export a second copy that
// nothing read — two numbers that had to agree with no test tying them together.

// Arming a run with less than this left in the daily budget is not worth the
// banner and the snapshot cost.
export const MIN_USEFUL_BUDGET_MS = 10_000;

// ── Daily cap ledger ────────────────────────────────────────────────────────
// CHOICE: LOCAL CALENDAR DAY, not a rolling 24h window.
// A rolling window needs the full history of every chunk to answer "how much have
// I recorded in the last 24h"; a calendar day needs two fields. The cap exists so
// a forgotten AI tab cannot record all week — a day boundary the user can reason
// about ("it resets at midnight") serves that better than a sliding window they
// cannot observe. Persisted at cfai.recordingDaily (same key as the video phase:
// what is measured changed from video wall-clock to DOM-observation wall-clock,
// the ledger shape did not).

/** Local-time day key, e.g. '2026-07-29'. Local, so "midnight" means the user's midnight. */
export function dayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ledger with a stale (previous-day) entry treated as zero. Never mutates input. */
export function normalizeDailyLedger(ledger, now = new Date()) {
  const day = dayKey(now);
  const ms = ledger && ledger.day === day && Number.isFinite(ledger.ms) && ledger.ms > 0 ? ledger.ms : 0;
  return { day, ms };
}

/** Add recorded milliseconds to today's total, rolling the day over if needed. */
export function accrueDaily(ledger, addMs, now = new Date()) {
  const base = normalizeDailyLedger(ledger, now);
  const add = Number.isFinite(addMs) && addMs > 0 ? Math.round(addMs) : 0;
  return { day: base.day, ms: base.ms + add };
}

/** Milliseconds of recording still allowed today. Never negative. */
export function remainingDailyMs(ledger, maxDailyMs, now = new Date()) {
  const cap = Number.isFinite(maxDailyMs) && maxDailyMs > 0 ? maxDailyMs : DEFAULT_REPLAY_POLICY.max_daily_ms;
  return Math.max(0, cap - normalizeDailyLedger(ledger, now).ms);
}

// ── "Is this an AI site we may record" ──────────────────────────────────────
// Recording is the most invasive thing this product does, so the host gate is an
// explicit allowlist, not inferService()'s loose substring match (which would
// treat any host containing "poe" or "you" as an AI tool). Two sources:
//   1. the governance platforms mirror the service worker syncs into
//      chrome.storage.local ('cfai.platforms') — admin-controlled, wins
//   2. this built-in suffix list, so a fresh install with an empty mirror still
//      works on the majors
//
// This gate now answers the CONTENT SCRIPT's automatic-start question (it used to
// answer armTab()'s). The content script cannot import this module, so it asks
// the worker — see the 'replayPolicy' RPC in background/service-worker.js. The
// allowlist therefore still lives in exactly one place.
//
// Deliberately NOT here: github.com. github.com/copilot is an AI surface but the
// rest of github.com is not, and this gate only sees a hostname. It is
// recordable only when an admin adds it to the platforms registry.
export const RECORDABLE_HOST_SUFFIXES = Object.freeze([
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'claude.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'bard.google.com',
  'perplexity.ai',
  'copilot.microsoft.com',
  'm365.cloud.microsoft',
  'poe.com',
  'you.com',
  'huggingface.co',
  'mistral.ai',
  'chat.mistral.ai',
  'groq.com',
  'meta.ai',
  'grok.com',
  'deepseek.com',
]);

/** host === suffix, or host is a subdomain of suffix. Never a bare substring. */
export function hostMatchesSuffix(host, suffix) {
  if (!host || !suffix) return false;
  const h = String(host).toLowerCase().replace(/\.$/, '');
  const s = String(suffix).toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return h === s || h.endsWith('.' + s);
}

/**
 * Decide whether a tab on `host` may be recorded.
 * Returns { ok, source, platform } — `source` is 'registry' | 'builtin' | null,
 * so the caller can log WHY without re-deriving it.
 */
export function isRecordableHost(host, platforms = []) {
  if (!host) return { ok: false, source: null, platform: null };
  for (const p of Array.isArray(platforms) ? platforms : []) {
    if (!p || !p.host) continue;
    // governed OR blocked: a blocked platform is still worth recording — the
    // evidence of an attempted use is exactly what an admin asked for.
    if (!p.governed && !p.blocked) continue;
    if (hostMatchesSuffix(host, p.host)) return { ok: true, source: 'registry', platform: p };
  }
  for (const suffix of RECORDABLE_HOST_SUFFIXES) {
    if (hostMatchesSuffix(host, suffix)) return { ok: true, source: 'builtin', platform: null };
  }
  return { ok: false, source: null, platform: null };
}

// ── Canonical service keys ──────────────────────────────────────────────────
// USED ONLY FOR SESSION-BOUNDARY DECISIONS. The per-event `service` field
// (content.js inferService(), 'ChatGPT' / 'Claude' / …) is a human label and is
// NOT touched by any of this — two different names for the same thing would be a
// mess, but the boundary needs something a hostname maps onto deterministically
// and a display label does not qualify (it is derived by loose regex and can
// change wording).
//
// The rule the table encodes: one session spans continuous use of the SAME
// service in the same tab. So hosts that are the same product wear one key
//   chatgpt.com / chat.openai.com / openai.com          → openai
//   copilot.microsoft.com / m365.cloud.microsoft        → microsoft-copilot
//   mistral.ai / chat.mistral.ai                        → mistral
// and hosts that only LOOK related stay apart:
//   gemini.google.com   → google-gemini
//   aistudio.google.com → google-aistudio   (a different surface, deliberately
//                         a different session — moving between them is a
//                         service change, not a chat switch)
//
// Every entry in RECORDABLE_HOST_SUFFIXES appears exactly once below; the test
// suite asserts that, so adding a recordable host without giving it a key fails
// loudly instead of producing sessions that never end.
export const SERVICE_KEY_HOSTS = Object.freeze({
  'openai':            Object.freeze(['chatgpt.com', 'chat.openai.com', 'openai.com']),
  'anthropic':         Object.freeze(['claude.ai']),
  'google-gemini':     Object.freeze(['gemini.google.com', 'bard.google.com']),
  'google-aistudio':   Object.freeze(['aistudio.google.com']),
  'perplexity':        Object.freeze(['perplexity.ai']),
  'microsoft-copilot': Object.freeze(['copilot.microsoft.com', 'm365.cloud.microsoft']),
  'poe':               Object.freeze(['poe.com']),
  'you':               Object.freeze(['you.com']),
  'huggingface':       Object.freeze(['huggingface.co']),
  'mistral':           Object.freeze(['mistral.ai', 'chat.mistral.ai']),
  'groq':              Object.freeze(['groq.com']),
  'meta':              Object.freeze(['meta.ai']),
  'xai-grok':          Object.freeze(['grok.com', 'x.ai']),
  'deepseek':          Object.freeze(['deepseek.com']),
});

// Flattened to (suffix, key) pairs sorted LONGEST SUFFIX FIRST. Not for
// correctness of the current table (no suffix in it resolves to two keys) but so
// a future 'foo.example.com' added under its own key cannot be shadowed by an
// already-present 'example.com'.
const SERVICE_KEY_PAIRS = Object.freeze(
  Object.entries(SERVICE_KEY_HOSTS)
    .flatMap(([key, hosts]) => hosts.map((suffix) => ({ suffix, key })))
    .sort((a, b) => b.suffix.length - a.suffix.length),
);

/** The built-in canonical key for a host, or null if the table has no entry. */
export function builtinServiceKey(host) {
  if (!host) return null;
  for (const { suffix, key } of SERVICE_KEY_PAIRS) {
    if (hostMatchesSuffix(host, suffix)) return key;
  }
  return null;
}

/**
 * The service key a RECORDABLE host belongs to, or null when the host is not
 * recordable at all (same gate as isRecordableHost — this never widens it).
 *
 * A host known only through the admin platforms registry has no canonical key,
 * so it gets one derived from the registry row's own host — that row IS its
 * identity in that registry (the CRUD routes are keyed /ai-platforms/:host).
 * The built-in table is consulted FIRST even for a registry hit, deliberately:
 * an admin who also registers chat.openai.com must not end up with
 * chatgpt.com → 'openai' and chat.openai.com → 'registry:chat.openai.com',
 * which would read as a service change every time the site redirects.
 */
export function serviceKeyForHost(host, platforms = []) {
  const gate = isRecordableHost(host, platforms);
  if (!gate.ok) return null;
  const builtin = builtinServiceKey(host);
  if (builtin) return builtin;
  const registryHost = gate.platform?.host;
  if (registryHost) return 'registry:' + String(registryHost).toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return null;
}

/**
 * The key used for SESSION GROUPING, which is a slightly wider question than
 * "may we record this".
 *
 * content.js is also injected on hosts the LLM classifier decided to govern but
 * that are in neither the recordable allowlist nor the platforms registry. Those
 * events still need a session_id — before this change every event got one
 * unconditionally — so an unrecognised host groups under its own hostname
 * instead of losing session identity entirely.
 *
 * Navigation boundaries still use serviceKeyForHost(): an engagement survives a
 * page load only on a host we actually recognise as a service.
 */
export function engagementServiceKey(host, platforms = []) {
  const known = serviceKeyForHost(host, platforms);
  if (known) return known;
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  return h ? 'host:' + h : null;
}

// ── Engagement (the session boundary) ───────────────────────────────────────
// An ENGAGEMENT is one continuous stretch of using ONE AI service in ONE tab.
// Its `session_id` is what every event in that stretch is stamped with.
//
// WHY IT LIVES IN THE WORKER, NOT THE CONTENT SCRIPT: the previous rule minted a
// session_id in content-script memory and rotated it whenever the conversation
// id in the URL changed. Content-script memory dies on every page load, so a
// reload — or the site's own hard navigation between chats — silently started a
// new session, and switching chats did too. The engagement record is therefore
// owned by background/service-worker.js and persisted in chrome.storage.local
// keyed by tab id, which survives navigation. Everything in THIS file is the
// pure decision logic; the worker supplies storage, tab ids and the clock.
//
// It ends on exactly five things:
//   tab closed          the worker's tabs.onRemoved — not a signal about a host,
//                       so it is the caller's call, not this function's
//   service changed     a top-frame commit to a different service key
//   idle_timeout        no VISIBLE-tab activity for idle_timeout_ms. A hidden or
//                       backgrounded tab is NOT activity: a forgotten AI tab
//                       that keeps polling in the background must still time out
//   max_session_ms      12h hard cap, activity or not
//   browser restart     tab ids are not stable across a restart, so the worker
//                       closes every persisted engagement at onStartup
// It explicitly does NOT end on: a new chat, switching chats, or a reload /
// same-service navigation.
//
// Record shape (all epoch ms):
//   { session_id, service_key, host, started_at, last_activity_at, client_seq }
// `client_seq` is the NEXT sequence number to hand out, so it doubles as "how
// many events this engagement has stamped".

function engagementLimits(policy) {
  const pick = (key) => {
    const v = policy?.[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : ENGAGEMENT_DEFAULTS[key];
  };
  return { idleMs: pick('idle_timeout_ms'), maxMs: pick('max_session_ms') };
}

function finiteTs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Has this engagement aged out? Returns null | 'idle_timeout' | 'max_session_ms'.
 *
 * Both windows are INCLUSIVE at the boundary: exactly idle_timeout_ms since the
 * last visible-tab activity is expired, not "still just alive". The sweep runs
 * once a minute, so an off-by-one at the edge decides nothing in practice, but a
 * fixed rule is what makes it testable.
 *
 * Idle is reported ahead of the cap when both are true (which needs a sleeping
 * worker to happen at all): the idle boundary is the one that was crossed FIRST,
 * so it is the truthful reason.
 *
 * A record with unusable timestamps is reported as expired rather than kept — a
 * session we cannot put an end on is exactly the thing this rule exists to
 * prevent.
 */
export function engagementExpiry(record, now = Date.now(), policy = DEFAULT_REPLAY_POLICY) {
  if (!record || typeof record !== 'object') return null;
  const { idleMs, maxMs } = engagementLimits(policy);
  const startedAt = finiteTs(record.started_at);
  const lastAt = finiteTs(record.last_activity_at) ?? startedAt;
  if (startedAt === null || lastAt === null) return 'idle_timeout';
  if (now - lastAt >= idleMs) return 'idle_timeout';
  if (now - startedAt >= maxMs) return 'max_session_ms';
  return null;
}

// The signal types nextEngagement() understands.
export const ENGAGEMENT_SIGNALS = Object.freeze(['activity', 'touch', 'nav_committed']);

function closedFrom(record, reason) {
  return {
    session_id: record.session_id,
    service_key: record.service_key,
    started_at: record.started_at,
    last_activity_at: record.last_activity_at,
    reason,
  };
}

/**
 * The whole state transition, in one pure function.
 *
 * record  the tab's stored engagement, or null when it has none
 * signal  what just happened:
 *   { type: 'activity', host, platforms?, visible?, new_session_id? }
 *       an event this tab is about to enqueue. Consumes a client_seq. Bumps
 *       last_activity_at only when the tab is visible (visible !== false) —
 *       that is the whole "a background tab does not keep a session alive" rule.
 *       MAY mint: an event has to be stamped with something.
 *   { type: 'touch', host, platforms?, visible? }
 *       the tab was used but produced no event (became visible, controller asked
 *       for the current session id). Never mints — asking must not create a
 *       conversation with no turns — and consumes no seq.
 *   { type: 'nav_committed', host, platforms?, isTopFrame }
 *       a top-frame navigation committed. Boundary check only: never mints,
 *       never counts as activity (a commit can happen in a hidden tab).
 * now     epoch ms
 * policy  a normalizeReplayPolicy() result (or anything with the two fields)
 *
 * Returns:
 *   { action, record, seq, closed }
 *     action  'mint'      a fresh engagement was minted (record is the new one)
 *             'continue'  the SAME engagement carries on
 *             'closed'    an engagement ended and nothing replaced it
 *             'none'      nothing to decide
 *     record  the engagement the tab should now hold, or null
 *     seq     the client_seq to stamp on THIS event, or null
 *     closed  { session_id, service_key, started_at, last_activity_at, reason }
 *             for the engagement that ended, or null. Set alongside a 'mint'
 *             when one ended and another started in the same step.
 *
 * `tab_closed` is not a signal here on purpose: it says nothing about a host, so
 * the worker closes that one directly.
 */
export function nextEngagement(record, signal, now = Date.now(), policy = DEFAULT_REPLAY_POLICY) {
  const type = signal?.type;
  const platforms = Array.isArray(signal?.platforms) ? signal.platforms : [];
  const nothing = { action: 'none', record: record ?? null, seq: null, closed: null };
  if (!ENGAGEMENT_SIGNALS.includes(type)) return nothing;

  // Age the stored record out FIRST: every signal is also a chance to notice the
  // engagement should already be gone (the 1-minute sweep can be up to a minute
  // behind, and a suspended worker can be much further behind than that).
  let current = record && typeof record === 'object' && record.session_id ? record : null;
  let closed = null;
  if (current) {
    const expired = engagementExpiry(current, now, policy);
    if (expired) {
      closed = closedFrom(current, expired);
      current = null;
    }
  }

  const mint = (serviceKey, consumesSeq) => {
    const sessionId = typeof signal?.new_session_id === 'string' && signal.new_session_id.trim()
      ? signal.new_session_id.trim()
      // The caller always supplies a uuid; this keeps the function pure (and its
      // tests deterministic) if one ever forgets.
      : 'eng-' + String(now);
    return {
      action: 'mint',
      record: {
        session_id: sessionId,
        service_key: serviceKey,
        host: signal?.host ? String(signal.host).toLowerCase() : null,
        started_at: now,
        last_activity_at: now,
        client_seq: consumesSeq ? 1 : 0,
      },
      seq: consumesSeq ? 0 : null,
      closed,
    };
  };

  if (type === 'nav_committed') {
    // Subframe commits do not unload the top document, so they are not a
    // boundary of anything.
    if (signal?.isTopFrame === false) return { action: 'none', record: current, seq: null, closed };
    if (!current) return closed ? { action: 'closed', record: null, seq: null, closed } : nothing;
    // STRICT key here, not engagementServiceKey(): an engagement survives a
    // navigation only on a host we recognise as a service.
    const navKey = serviceKeyForHost(signal?.host, platforms);
    if (!navKey) {
      return { action: 'closed', record: null, seq: null, closed: closedFrom(current, 'navigated_away') };
    }
    if (navKey !== current.service_key) {
      // The next activity signal mints the replacement — a commit alone is not
      // evidence anyone used the new service.
      return { action: 'closed', record: null, seq: null, closed: closedFrom(current, 'service_changed') };
    }
    // Same service: a reload, a hard navigation between chats, a "New chat".
    // This is the case the whole change exists for — carry on untouched. Not
    // even last_activity_at moves: a commit can fire in a hidden tab.
    return { action: 'continue', record: current, seq: null, closed };
  }

  const key = engagementServiceKey(signal?.host, platforms);
  if (!key) return closed ? { action: 'closed', record: null, seq: null, closed } : nothing;

  if (current && current.service_key !== key) {
    // A same-tab service switch with no navigation commit in between (an
    // in-page transition, or a commit the worker slept through).
    closed = closedFrom(current, 'service_changed');
    current = null;
  }

  if (!current) {
    // 'touch' must never mint: the replay controller asks for the current
    // session id on every tick, and answering with a brand-new id would open a
    // conversation nobody has said anything in.
    if (type === 'touch') {
      return closed ? { action: 'closed', record: null, seq: null, closed } : nothing;
    }
    return mint(key, true);
  }

  const visible = signal?.visible !== false;
  const next = {
    ...current,
    host: signal?.host ? String(signal.host).toLowerCase() : current.host ?? null,
    // Only visible-tab use extends the idle window.
    last_activity_at: visible ? now : current.last_activity_at,
    client_seq: type === 'activity' ? (finiteTs(current.client_seq) ?? 0) + 1 : current.client_seq,
  };
  return {
    action: 'continue',
    record: next,
    seq: type === 'activity' ? (finiteTs(current.client_seq) ?? 0) : null,
    closed,
  };
}
