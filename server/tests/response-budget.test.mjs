// lib/response-budget.js — the shared 5s response budget.
//
// The load-bearing test in this file is "the late live result populates the
// store". registry.js's bespoke version used a `settled` flag that DISCARDED an
// over-budget build's result, so on a degraded cluster — where every build runs
// past the budget — the cache could never be filled and the page stayed pinned
// to the snapshot until the database recovered and a request happened to be
// fast. Everything else here is the cold-start rule (never 503, never fabricate)
// and the key-collision rule (one severity's events must never be served under
// another's filter).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESPONSE_BUDGET_MS,
  raceWithFallback,
  applyBudgetHeaders,
  responseStore,
  dlpResponseStore,
  requireMemoryOnlyStore,
  storeKey,
  invalidateRoute,
  registerResponseWarmer,
  warmResponseStore,
  isQueryTimeoutError,
} from '../src/lib/response-budget.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stand-in for `res` that records only what applyBudgetHeaders does.
function fakeRes() {
  const headers = {};
  return { headers, setHeader(k, v) { headers[k] = String(v); } };
}

test.beforeEach(() => responseStore.clear());

test('the budget is one named constant, defaulting to 5000ms', () => {
  assert.equal(typeof RESPONSE_BUDGET_MS, 'number');
  assert.equal(RESPONSE_BUDGET_MS, Number(process.env.RESPONSE_BUDGET_MS || 5000));
});

test('live wins under budget — no stale, no budget header', async () => {
  const res = await raceWithFallback({
    route: 'test.fast', params: { a: 1 }, budgetMs: 200,
    live: async () => ({ rows: [1, 2, 3] }),
  });

  assert.deepEqual(res.value, { rows: [1, 2, 3] });
  assert.equal(res.stale, false);
  assert.equal(res.coldMiss, false);
  assert.equal(res.failed, false);

  const r = fakeRes();
  applyBudgetHeaders(r, res);
  assert.deepEqual(r.headers, {}, 'a live answer carries no budget headers at all');
});

test('budget expires with a store hit — stale body plus its capture time', async () => {
  // First call fills the store.
  await raceWithFallback({ route: 'test.stale', params: null, budgetMs: 200, live: async () => 'first' });

  const before = Date.now();
  const res = await raceWithFallback({
    route: 'test.stale', params: null, budgetMs: 30,
    live: async () => { await sleep(300); return 'second'; },
  });

  assert.equal(res.value, 'first', 'the last real answer, not a fabricated one');
  assert.equal(res.stale, true);
  assert.equal(res.coldMiss, false);
  assert.ok(res.capturedAt, 'a stale answer must say when it was captured');
  assert.ok(Date.parse(res.capturedAt) <= before + 5, 'capture time is when the body was captured, not now');

  const r = fakeRes();
  applyBudgetHeaders(r, res);
  assert.equal(r.headers['X-Response-Stale'], '1');
  assert.equal(r.headers['X-Response-Captured-At'], res.capturedAt);
  assert.equal(r.headers['X-Response-Budget'], undefined, 'stale is not the same signal as budget-exceeded');
  assert.match(r.headers['X-Response-Captured-At'], /^\d{4}-\d{2}-\d{2}T.*Z$/, 'ISO 8601');
});

test('budget expires with an EMPTY store — waits for real data, never 503, never fabricates', async () => {
  const res = await raceWithFallback({
    route: 'test.cold', params: null, budgetMs: 20,
    live: async () => { await sleep(120); return { real: true, rows: 7 }; },
  });

  assert.deepEqual(res.value, { real: true, rows: 7 }, 'the real answer a patient caller would have got');
  assert.equal(res.failed, false, 'a cold miss is not a failure — nothing 503s here');
  assert.equal(res.stale, false, 'it was slow this once, not old');
  assert.equal(res.coldMiss, true);

  const r = fakeRes();
  applyBudgetHeaders(r, res);
  assert.equal(r.headers['X-Response-Budget'], 'exceeded');
  assert.equal(r.headers['X-Response-Stale'], undefined, 'a cold miss must NOT claim to be stale');
  assert.equal(r.headers['X-Response-Captured-At'], undefined);
});

// ── THE REGRESSION TEST FOR THE REGISTRY DISCARD BUG ────────────────────────
test('a slow-but-successful read still lands in the store, and the NEXT call sees it fresh', async () => {
  let builds = 0;
  const slowLive = async () => { builds += 1; await sleep(150); return { build: builds }; };

  // Call 1 loses the race. The old registry logic threw this result away.
  const first = await raceWithFallback({
    route: 'test.selfheal', params: { q: 1 }, budgetMs: 20, freshMs: 10_000, live: slowLive,
  });
  assert.equal(first.coldMiss, true, 'nothing was in the store yet, so it waited');
  assert.deepEqual(first.value, { build: 1 });

  // The store now holds build 1 — proven by the next call answering from it
  // WITHOUT running the live read at all, and answering as fresh, not stale.
  const second = await raceWithFallback({
    route: 'test.selfheal', params: { q: 1 }, budgetMs: 20, freshMs: 10_000,
    live: async () => { throw new Error('the live read must not be needed here'); },
  });
  assert.deepEqual(second.value, { build: 1 });
  assert.equal(second.stale, false, 'a self-healed store serves live-grade data, not stale');
  assert.equal(second.coldMiss, false);
  assert.equal(builds, 1);
});

test('the late result of a LOST race is stored even after a stale answer went out', async () => {
  await raceWithFallback({ route: 'test.late', params: null, budgetMs: 200, live: async () => 'old' });

  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = raceWithFallback({
    route: 'test.late', params: null, budgetMs: 20,
    live: async () => { await gate; return 'new'; },
  });

  const served = await slow;
  assert.equal(served.value, 'old', 'the over-budget caller got last-known-good');
  assert.equal(served.stale, true);

  // The losing build finishes AFTER its caller has been answered.
  release();
  await sleep(20);

  const next = await raceWithFallback({
    route: 'test.late', params: null, budgetMs: 5_000, freshMs: 10_000,
    live: async () => { throw new Error('should be served from the self-healed store'); },
  });
  assert.equal(next.value, 'new', 'the late build repopulated the store instead of being discarded');
  assert.equal(next.stale, false);
});

test('a live read that FAILS falls back to last-known-good rather than erroring', async () => {
  await raceWithFallback({ route: 'test.fail', params: null, budgetMs: 200, live: async () => 'good' });

  const res = await raceWithFallback({
    route: 'test.fail', params: null, budgetMs: 200,
    live: async () => { throw new Error('cluster down'); },
  });
  assert.equal(res.value, 'good');
  assert.equal(res.stale, true);
  assert.equal(res.failed, false);
});

test('a live read that fails with an EMPTY store reports the failure — the caller decides (503)', async () => {
  const res = await raceWithFallback({
    route: 'test.failcold', params: null, budgetMs: 200,
    live: async () => { throw new Error('cluster down'); },
  });
  assert.equal(res.value, undefined, 'nothing is ever synthesized in place of the answer');
  assert.equal(res.failed, true);
  assert.match(res.error.message, /cluster down/);
});

test('raceWithFallback resolves rather than rejecting, whatever the live read does', async () => {
  await assert.doesNotReject(() => raceWithFallback({
    route: 'test.reject', params: null, budgetMs: 50, live: () => Promise.reject(new Error('boom')),
  }));
  // Including a synchronous throw inside the live function.
  await assert.doesNotReject(() => raceWithFallback({
    route: 'test.throw', params: null, budgetMs: 50, live: () => { throw new Error('sync boom'); },
  }));
});

// ── Keys ────────────────────────────────────────────────────────────────────

test('keys never collide across routes, or across params that merely look alike', async () => {
  // Two routes, identical-looking params.
  assert.notEqual(storeKey('dlp', { severity: 'high' }), storeKey('dlp.files', { severity: 'high' }));
  // A route name cannot be forged from inside a params value.
  assert.notEqual(storeKey('a', { x: 'b' }), storeKey('a\u0000{"x":"b"}', null));
  // Key order does not matter; the value is what matters.
  assert.equal(storeKey('dlp', { a: 1, b: 2 }), storeKey('dlp', { b: 2, a: 1 }));
  assert.notEqual(storeKey('dlp', { a: 1, b: 2 }), storeKey('dlp', { a: 2, b: 1 }));
  // 'high' as a string and ['high'] as a one-element list are different filters.
  assert.notEqual(storeKey('dlp', { severity: 'high' }), storeKey('dlp', { severity: ['high'] }));

  // And end to end: one route's cached body is never served to another's caller.
  await raceWithFallback({ route: 'r1', params: { p: 1 }, budgetMs: 200, live: async () => 'one' });
  const other = await raceWithFallback({
    route: 'r2', params: { p: 1 }, budgetMs: 20,
    live: async () => { await sleep(100); return 'two'; },
  });
  assert.equal(other.value, 'two', "r2 must not be handed r1's body");
  assert.equal(other.coldMiss, true, 'r2 had nothing of its own to fall back on');
});

// ── Store bounds ────────────────────────────────────────────────────────────

test('LRU eviction by entry count', async () => {
  const cap = Number(process.env.RESPONSE_STORE_MAX_ENTRIES || 50);
  for (let i = 0; i < cap + 5; i++) {
    responseStore.set(storeKey('evict', { i }), 'evict', { i });
  }
  assert.equal(responseStore.size, cap, 'the store is bounded by entry count');
  assert.equal(responseStore.get(storeKey('evict', { i: 0 })), null, 'the oldest key was evicted');
  assert.ok(responseStore.get(storeKey('evict', { i: cap + 4 })), 'the newest key survived');
});

test('reading a key makes it survive eviction (LRU, not FIFO)', () => {
  const cap = Number(process.env.RESPONSE_STORE_MAX_ENTRIES || 50);
  for (let i = 0; i < cap; i++) responseStore.set(storeKey('lru', { i }), 'lru', { i });
  // Touch the oldest, then push one more in.
  assert.ok(responseStore.get(storeKey('lru', { i: 0 })));
  responseStore.set(storeKey('lru', { i: 999 }), 'lru', { i: 999 });
  assert.ok(responseStore.get(storeKey('lru', { i: 0 })), 'a recently READ key is not the eviction victim');
  assert.equal(responseStore.get(storeKey('lru', { i: 1 })), null);
});

test('a body over the per-entry byte cap is refused, not stored — and logged with id and size only', () => {
  const cap = Number(process.env.RESPONSE_STORE_MAX_ENTRY_BYTES || 2 * 1024 * 1024);
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const huge = { blob: 'x'.repeat(cap + 1024), secret: 'PROMPT-CONTENT-DO-NOT-LOG' };
    const stored = responseStore.set(storeKey('big', { severity: 'critical' }), 'big', huge);
    assert.equal(stored, false, 'an oversized body must be refused');
    assert.equal(responseStore.get(storeKey('big', { severity: 'critical' })), null);
  } finally {
    console.warn = realWarn;
  }

  assert.equal(warnings.length, 1);
  const line = warnings[0];
  assert.match(line, /refused big#[0-9a-f]{8}/, 'logs a route + hashed key id');
  assert.match(line, /\d+ bytes/, 'logs the size');
  assert.ok(!line.includes('PROMPT-CONTENT-DO-NOT-LOG'), 'never logs the body');
  assert.ok(!line.includes('critical'), 'never logs the params, which can carry admin search text');
});

test('a body just under the cap IS stored', () => {
  // JSON overhead makes the exact boundary awkward, so stay clearly under it.
  const cap = Number(process.env.RESPONSE_STORE_MAX_ENTRY_BYTES || 2 * 1024 * 1024);
  const ok = responseStore.set(storeKey('big', { n: 2 }), 'big', { blob: 'x'.repeat(cap - 1024) });
  assert.equal(ok, true);
  assert.ok(responseStore.get(storeKey('big', { n: 2 })));
});

test('invalidateRoute keeps the value as a fallback but never again serves it as fresh', async () => {
  await raceWithFallback({ route: 'inv', params: null, budgetMs: 200, freshMs: 10_000, live: async () => 'v1' });
  invalidateRoute('inv');

  // A fresh TTL read no longer short-circuits: the live read runs.
  let ran = 0;
  const live = await raceWithFallback({
    route: 'inv', params: null, budgetMs: 200, freshMs: 10_000,
    live: async () => { ran += 1; return 'v2'; },
  });
  assert.equal(ran, 1, 'an invalidated entry must not be served as current');
  assert.equal(live.value, 'v2');
  assert.equal(live.stale, false);
});

// ── The DLP store is structurally memory-only ───────────────────────────────

test('the DLP store cannot be swapped for a disk-backed one', async () => {
  // It is the shared in-memory store, and it passes the brand check.
  assert.equal(dlpResponseStore.kind, 'memory');
  assert.equal(requireMemoryOnlyStore(dlpResponseStore), dlpResponseStore);

  // Anything that merely LOOKS like the interface is rejected — including a
  // plausible disk-backed impostor with the right method names and even the
  // right `kind`. The brand is a private field, which no outside object can
  // have, so this cannot be talked around.
  const diskBacked = {
    kind: 'memory',
    get: () => null,
    set: () => true,
    expire: () => {},
    clear: () => {},
    path: 'server/data/response-cache.json',
  };
  assert.throws(() => requireMemoryOnlyStore(diskBacked), /must be the in-memory store/);
  await assert.rejects(
    () => raceWithFallback({ route: 'dlp', params: null, live: async () => 1, store: diskBacked }),
    /must be the in-memory store/,
    'a route cannot be wired to a non-memory store even by mistake',
  );
  for (const candidate of [null, undefined, 'server/data', 42, new Map(), Object.create(null)]) {
    assert.throws(() => requireMemoryOnlyStore(candidate), /must be the in-memory store/);
  }

  // And the module exposes no way to persist: no write-through hook exists to
  // point at a file, on the instance or its prototype.
  const surface = [
    ...Object.getOwnPropertyNames(dlpResponseStore),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(dlpResponseStore)),
  ];
  for (const forbidden of ['persist', 'flush', 'writeFile', 'path', 'file', 'save']) {
    assert.ok(!surface.includes(forbidden), `the store must expose no ${forbidden} hook`);
  }
});

// ── Warming ─────────────────────────────────────────────────────────────────

test('warmResponseStore runs every registered warmer and swallows failures', async () => {
  const calls = [];
  registerResponseWarmer('warm-ok', async (db) => { calls.push(db); });
  registerResponseWarmer('warm-bad', async () => { throw new Error('nope'); });

  const realWarn = console.warn, realLog = console.log;
  console.warn = () => {}; console.log = () => {};
  let out;
  try {
    out = await warmResponseStore('db-handle');
  } finally {
    console.warn = realWarn; console.log = realLog;
  }

  assert.deepEqual(calls, ['db-handle'], 'a warmer is handed the db and run once');
  assert.ok(out.warmed >= 1);
  assert.ok(out.failed >= 1, 'a failing warmer is counted, not thrown');
});

// ── Timeout detection (for /claude-usage's structured 503) ──────────────────

test('isQueryTimeoutError recognises a maxTimeMS abort and nothing else', () => {
  assert.equal(isQueryTimeoutError(Object.assign(new Error('operation exceeded time limit'), { code: 50 })), true);
  assert.equal(isQueryTimeoutError(Object.assign(new Error('x'), { codeName: 'MaxTimeMSExpired' })), true);
  assert.equal(isQueryTimeoutError(new Error('operation exceeded time limit')), true);
  assert.equal(isQueryTimeoutError(new Error('E11000 duplicate key')), false);
  assert.equal(isQueryTimeoutError(null), false);
});
