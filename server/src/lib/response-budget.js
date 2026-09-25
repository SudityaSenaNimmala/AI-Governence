// A uniform response budget for the AI Hub's read routes.
//
// THE PROBLEM THIS REPLACES. Three routes had grown their own copy of the same
// "race the query against a budget, fall back to the last real answer" shape, at
// three different budgets (registry 5s after having been 15s, /dlp 9s,
// /claude-usage a 20s maxTimeMS with no fallback at all), and most of the other
// tab-load routes had no cap whatsoever. So "how long can a tab take" was not a
// number anyone could state, let alone change — it was five numbers in four
// files, and the slowest route set the tab's actual load time.
//
// WHAT A RESPONSE IS, NOW. Every wrapped route answers with exactly one of:
//   * live        — the query finished inside the budget;
//   * stale       — the budget expired and the last REAL answer for this exact
//                   key is served instead, with the time it was captured;
//   * slow-but-real — the budget expired and nothing has ever been captured for
//                   this key, so the caller waits out the real query (once per
//                   key, per process).
// Nothing is ever synthesized, estimated or truncated to fit the budget. A
// governance dashboard that invents a number is worse than a slow one.
//
// THE COLD-START RULE IS THE SAFETY PROPERTY. When the budget expires with an
// EMPTY store, the route does NOT 503 and does not fabricate: it awaits the live
// query. routes/dlp.js already reasoned this out — "without one, tripping would
// turn a slow page into a 503 and lose the data that a patient caller would
// still have received" — and it generalizes. The budget bounds the wait for a
// key that has been answered before, which after boot warming
// (warmResponseStore) is every key the dashboard asks for.
//
// 5000ms IS A SERVER-SIDE QUERY BUDGET, not a browser wall-clock promise: a tab
// costs this budget plus its own network and render time.

import crypto from 'node:crypto';

// ONE constant, imported by every wrapped route, so changing the org-wide budget
// is a one-line edit rather than a search for numeric literals. Per-route env
// overrides still layer on top of it (REGISTRY_BUILD_BUDGET_MS,
// CLAUDE_USAGE_BUDGET_MS) — same style as the override registry.js already had,
// kept so existing deployment config keeps working.
export const RESPONSE_BUDGET_MS = Number(process.env.RESPONSE_BUDGET_MS || 5000);

// ── The store ────────────────────────────────────────────────────────────────
//
// ONE shared, bounded, module-level structure — deliberately not one Map per
// route. Per-route caches are how the three ad-hoc versions ended up with three
// different eviction rules and no memory ceiling between them; a single store
// has one ceiling that holds however many routes get wrapped later.
//
// MEMORY ONLY, AND STRUCTURALLY SO. This is not a convention to be remembered:
// `dlp_events` metadata (severity, pattern names, machine/user identity, and for
// file events a filename) flows through this store, and server/data is a mounted
// Docker volume with no retention policy attached to it. So there is no
// disk-backed store class in this module to reach for, and raceWithFallback
// brand-checks the store it is handed with a private-field test that nothing
// outside this file can satisfy. A file-backed tier is registry.js's own,
// applied to its own curated snapshot, and never reaches this store.
//
// (Raw prompt/response text is never in scope here: it lives in `dlp_content`
// and is not part of any list response these routes return.)
const MAX_ENTRIES     = Number(process.env.RESPONSE_STORE_MAX_ENTRIES || 50);
const MAX_ENTRY_BYTES = Number(process.env.RESPONSE_STORE_MAX_ENTRY_BYTES || 2 * 1024 * 1024);
const MAX_TOTAL_BYTES = Number(process.env.RESPONSE_STORE_MAX_TOTAL_BYTES || 16 * 1024 * 1024);

// A short, stable id for one store key. LOGGED INSTEAD OF THE KEY: a key carries
// the route's query parameters, which can include an admin's ?search= text or a
// machine id, and this file logs at a read boundary. Same discipline as the
// egress logging elsewhere in this codebase — counts and ids only, never
// content, never a filename or recipient.
function entryId(route, key) {
  return `${route}#${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}

class MemoryResponseStore {
  // The private field IS the brand. `#entries in obj` is a syntactic test no
  // other class or object literal can pass, so "the DLP routes cannot be handed
  // a disk-backed store" is enforced by the language rather than by review.
  #entries = new Map();   // key → { route, value, bytes, at }
  #totalBytes = 0;

  static isMemoryOnly(candidate) {
    return #entries in candidate;
  }

  get kind() { return 'memory'; }
  get size() { return this.#entries.size; }
  get totalBytes() { return this.#totalBytes; }

  /** The stored entry, or null. Reading makes it most-recently-used. */
  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  /**
   * Store a response body. Refuses anything over the per-entry byte cap — the
   * size is measured on the actual JSON, because that is what a caller would
   * have received and what this would cost to hold.
   * @returns {boolean} whether it was stored
   */
  set(key, route, value) {
    let bytes;
    try {
      bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
    } catch {
      // Not serializable means it is not a response body. Refuse rather than
      // hold an unmeasurable object.
      console.warn(`[response-budget] refused ${entryId(route, key)} — response body is not serializable`);
      return false;
    }
    if (bytes > MAX_ENTRY_BYTES) {
      console.warn(`[response-budget] refused ${entryId(route, key)} — ${bytes} bytes over the ${MAX_ENTRY_BYTES}-byte per-entry cap`);
      return false;
    }

    const existing = this.#entries.get(key);
    if (existing) {
      this.#totalBytes -= existing.bytes;
      this.#entries.delete(key);
    }
    this.#entries.set(key, { route, value, bytes, at: Date.now() });
    this.#totalBytes += bytes;
    this.#evict();
    return true;
  }

  /**
   * Keep the value as a fallback but make it never again count as FRESH.
   * Used after a write that invalidates a read (PUT /registry/:id/status): the
   * admin's decision must not be reverted by a still-warm cache, which is a bug
   * that was observed live. Deliberately not a delete — the last real answer is
   * still the best thing to serve if the live query then times out, and it goes
   * out clearly labelled stale with its capture time.
   */
  expire(route) {
    for (const entry of this.#entries.values()) {
      if (entry.route === route) entry.at = 0;
    }
  }

  clear() {
    this.#entries.clear();
    this.#totalBytes = 0;
  }

  // LRU on both dimensions: entry count and total bytes. The oldest-used key is
  // the front of the Map, since get() and set() both move a key to the back.
  #evict() {
    while (this.#entries.size > MAX_ENTRIES || this.#totalBytes > MAX_TOTAL_BYTES) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      this.#totalBytes -= oldest.bytes;
    }
  }
}

// THE shared store. Exported so tests and ops code can inspect or clear it;
// there is intentionally no setter and no alternative implementation.
export const responseStore = new MemoryResponseStore();

// The same object, under the name the DLP routes use. Named separately only so
// the call sites read as the deliberate choice they are — see the memory-only
// note above for why a disk-backed alternative does not exist.
export const dlpResponseStore = responseStore;

/**
 * Gate for anything that accepts a store. Throws on anything this module did
 * not create, which is what stops a future refactor from passing a
 * file-or-Mongo-backed cache to a DLP route.
 */
export function requireMemoryOnlyStore(store) {
  if (!store || typeof store !== 'object' || !MemoryResponseStore.isMemoryOnly(store)) {
    throw new TypeError('response-budget: the fallback store must be the in-memory store from lib/response-budget.js — a disk-backed store may never hold DLP response bodies');
  }
  return store;
}

// ── Keys ─────────────────────────────────────────────────────────────────────

// Deterministic, sorted-key serialization. The HELPER owns key construction, for
// two reasons: two routes can never collide (the route name is always part of
// the key, so a route cannot forget its own namespace), and two calls with the
// same filters always agree however the caller happened to order the object's
// keys. Getting this wrong on /api/v1/dlp would show one severity's events under
// another's filter — an admin reading the wrong data and having no way to tell.
function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(value[k])}`).join(',')}}`;
}

/**
 * The stored answer for this key IF it is younger than `freshMs`, else null.
 *
 * For the one caller that has to decide whether to run the live read at all
 * before raceWithFallback would get the chance: registry.js's circuit breaker
 * and REGISTRY_SNAPSHOT_FIRST both skip the live build, and when they do, a
 * recent real capture in this store is better data than the file snapshot they
 * would otherwise reach for.
 */
export function peekFresh({ route, params = null, freshMs, store = responseStore }) {
  requireMemoryOnlyStore(store);
  const entry = store.get(storeKey(route, params));
  if (!entry) return null;
  if (freshMs > 0 && Date.now() - entry.at >= freshMs) return null;
  return { value: entry.value, capturedAt: new Date(entry.at).toISOString() };
}

/** The last real answer for this key whatever its age, or null. */
export function peekLastKnownGood({ route, params = null, store = responseStore }) {
  requireMemoryOnlyStore(store);
  const entry = store.get(storeKey(route, params));
  if (!entry) return null;
  return { value: entry.value, capturedAt: new Date(entry.at).toISOString() };
}

export function storeKey(route, params) {
  if (!route || typeof route !== 'string') throw new TypeError('response-budget: a route name is required');
  // \u0000 cannot appear in a JSON-serialized value, so no params object can
  // forge a different route's prefix.
  return `${route}\u0000${stableSerialize(params ?? null)}`;
}

// ── The race ─────────────────────────────────────────────────────────────────

const BUDGET_EXPIRED = Symbol('response-budget:expired');

/**
 * Race a live read against the budget, falling back to the last real answer.
 *
 * RESOLVES, NEVER REJECTS — the convention registry.js and dlp.js already
 * established ("so callers branch on the value instead of wrapping every call
 * site in try/catch").
 *
 * @param {object}   opts
 * @param {string}   opts.route     namespace for the store key, e.g. 'registry'
 * @param {any}      opts.params    the request's filters; serialized into the key
 * @param {Function} opts.live      () => Promise<body>  the real read
 * @param {number}   [opts.budgetMs]
 * @param {number}   [opts.freshMs] serve a stored value younger than this
 *                                  WITHOUT running the live read at all. This is
 *                                  the pre-existing short-TTL cache of
 *                                  registry (30s) and /api/v1/dlp (20s), which
 *                                  is a separate knob from the budget: the TTL
 *                                  decides when to bother asking, the budget
 *                                  decides how long to wait for the answer.
 * @param {boolean}  [opts.awaitOnColdMiss=true]
 *        The cold-start rule: with an empty store there is nothing to be stale
 *        with, so the caller waits out the live read rather than 503ing or
 *        inventing an answer. Set false ONLY by a route that has a fallback tier
 *        of its OWN that this store cannot see — registry.js, whose
 *        data/registry-snapshot.json is a real capture that survives restarts.
 *        For that route "the store is empty" is not "there is nothing to serve",
 *        and making its callers wait would reintroduce the hang the snapshot
 *        exists to prevent. The live read is left running either way, so the
 *        store still self-heals.
 * @param {object}   [opts.store]
 * @returns {Promise<{value:any, stale:boolean, capturedAt:string|null,
 *                    coldMiss:boolean, unresolved:boolean, failed:boolean,
 *                    error:Error|null}>}
 */
export async function raceWithFallback({
  route,
  params = null,
  live,
  budgetMs = RESPONSE_BUDGET_MS,
  freshMs = 0,
  awaitOnColdMiss = true,
  store = responseStore,
}) {
  requireMemoryOnlyStore(store);
  if (typeof live !== 'function') throw new TypeError('response-budget: live must be a function returning a promise');
  const key = storeKey(route, params);

  const cached = store.get(key);
  if (cached && freshMs > 0 && Date.now() - cached.at < freshMs) {
    // Still inside its TTL, so this IS the current answer — not a fallback.
    return result({ value: cached.value, stale: false, capturedAt: cached.at });
  }

  // THE LIVE PROMISE ALWAYS POPULATES THE STORE, EVEN AFTER LOSING THE RACE.
  //
  // This is the whole point of the helper, and the bug it fixes. registry.js
  // used a `settled` flag that made the late-arriving build's result get
  // DISCARDED: once the budget had expired, a build that then succeeded threw
  // its answer away, so the cache could only ever be filled by a build that
  // happened to land under budget on its own — on a degraded cluster, never.
  // The page was pinned to the snapshot until the database recovered AND a
  // request happened to be fast. Here the store write is attached to the
  // promise itself, so it cannot be skipped by whatever the caller did in the
  // meantime, and the NEXT request sees a fresh value.
  const settled = Promise.resolve()
    .then(() => live())
    .then(
      (value) => {
        store.set(key, route, value);
        return { ok: true, value };
      },
      (error) => {
        console.warn(`[response-budget] ${entryId(route, key)} live read failed: ${error?.message || error}`);
        return { ok: false, error };
      },
    );

  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_EXPIRED), budgetMs);
  });

  let winner;
  try {
    winner = await Promise.race([settled, budget]);
  } finally {
    clearTimeout(timer);
  }

  if (winner !== BUDGET_EXPIRED) {
    if (winner.ok) return result({ value: winner.value, stale: false, capturedAt: Date.now() });
    // The live read FAILED rather than being slow. Last-known-good is still a
    // real prior answer, so serve it labelled stale instead of erroring.
    const fallback = store.get(key);
    if (fallback) return result({ value: fallback.value, stale: true, capturedAt: fallback.at });
    return result({ value: undefined, failed: true, error: winner.error });
  }

  const fallback = store.get(key);
  if (fallback) {
    console.warn(`[response-budget] ${entryId(route, key)} exceeded ${budgetMs}ms — serving last-known-good, refreshing in the background`);
    return result({ value: fallback.value, stale: true, capturedAt: fallback.at });
  }

  if (!awaitOnColdMiss) {
    // The caller has its own fallback tier (see awaitOnColdMiss) and will serve
    // from that. The live read keeps running, so the store self-heals.
    console.warn(`[response-budget] ${entryId(route, key)} exceeded ${budgetMs}ms with an empty store — deferring to the route's own fallback`);
    return result({ value: undefined, coldMiss: true, unresolved: true });
  }

  // COLD START. Nothing has ever been captured for this key, so there is
  // nothing to be stale with — wait for the real answer. Bounded by "once per
  // key per process": the store is populated by the time this resolves.
  console.warn(`[response-budget] ${entryId(route, key)} exceeded ${budgetMs}ms with an empty store — waiting for the live read`);
  const late = await settled;
  if (late.ok) return result({ value: late.value, stale: false, capturedAt: Date.now(), coldMiss: true });
  return result({ value: undefined, coldMiss: true, failed: true, error: late.error });
}

function result({ value, stale = false, capturedAt = null, coldMiss = false, unresolved = false, failed = false, error = null }) {
  return {
    value,
    stale,
    capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
    coldMiss,
    // The budget expired, nothing was in the store, and the caller asked not to
    // wait — so this result carries no value and the caller's own fallback tier
    // answers. Only reachable with awaitOnColdMiss: false.
    unresolved,
    failed,
    error,
  };
}

/**
 * Say which of the three answers this was, in HEADERS rather than body fields.
 *
 * Header, not body: /registry, /findings, /dlp and friends return a bare array
 * that the UI iterates directly, so wrapping it to carry a flag would break
 * every caller. registry.js made this call first (X-Registry-Stale) and it
 * generalizes; those two legacy registry headers are still emitted alongside
 * these by that route, for anything already reading them.
 *
 *   X-Response-Stale: 1                 this body is a previous real answer
 *   X-Response-Captured-At: <ISO 8601>   when that answer was captured
 *   X-Response-Budget: exceeded          the budget expired with nothing to fall
 *                                        back on, so this is live data that
 *                                        simply took longer than the budget —
 *                                        NOT stale. Deliberately no stale header
 *                                        here: it was slow this once, not old.
 */
export function applyBudgetHeaders(res, result) {
  if (!result) return;
  if (result.stale) {
    res.setHeader('X-Response-Stale', '1');
    if (result.capturedAt) res.setHeader('X-Response-Captured-At', result.capturedAt);
    return;
  }
  if (result.coldMiss) res.setHeader('X-Response-Budget', 'exceeded');
}

/**
 * Drop the freshness of everything a route has stored, so the next read goes
 * live. Called from write paths that change what a read returns.
 */
export function invalidateRoute(route, store = responseStore) {
  requireMemoryOnlyStore(store);
  store.expire(route);
}

// ── Boot-time warming ────────────────────────────────────────────────────────
//
// Every wrapped route registers the same read its handler performs for the
// default, no-filter request. warmResponseStore() runs them once after the
// server is listening, so the store has a real answer to fall back on from the
// first request rather than every route being cold after every deploy — and
// deploy.yml restarts the whole container, so that is every deploy.
//
// Keyed by name, so re-mounting a route (which tests do, per app) replaces its
// warmer instead of accumulating duplicates.
const warmers = new Map();

export function registerResponseWarmer(name, fn) {
  warmers.set(name, fn);
}

/**
 * Off the request path, failures logged and swallowed, never fatal, never
 * blocking startup — the same contract as ensureAnalyticsIndexes in db/index.js,
 * and for the same reason: none of this is required for correctness, it only
 * makes the first request after a restart cheap.
 */
export async function warmResponseStore(db) {
  const names = [...warmers.keys()];
  if (names.length === 0) return { warmed: 0, failed: 0 };
  const settledAll = await Promise.allSettled(names.map((name) => warmers.get(name)(db)));
  let failed = 0;
  settledAll.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      failed += 1;
      console.warn(`[response-budget] warm ${names[i]} failed: ${outcome.reason?.message || outcome.reason} (reads still work, just cold)`);
    }
  });
  console.log(`[response-budget] warmed ${names.length - failed}/${names.length} read routes (budget ${RESPONSE_BUDGET_MS}ms)`);
  return { warmed: names.length - failed, failed };
}

// ── Query-timeout detection ──────────────────────────────────────────────────
//
// For the one route that deliberately does NOT race-and-fall-back
// (/api/v1/claude-usage — a stale dollar figure drives a wrong
// cost/seat-reclamation decision, so it aborts instead), so it can turn a
// maxTimeMS abort into a structured 503 rather than leaking a raw driver message
// as a 500.
export function isQueryTimeoutError(err) {
  if (!err) return false;
  if (err.code === 50 || err.codeName === 'MaxTimeMSExpired') return true;
  return /maxtimemsexpired|exceeded time limit|operation exceeded/i.test(String(err.message || ''));
}
