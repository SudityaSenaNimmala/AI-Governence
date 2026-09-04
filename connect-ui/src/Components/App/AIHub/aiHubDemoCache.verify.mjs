// Verification for the AI Hub demo response cache.
// Run: node src/Components/App/AIHub/aiHubDemoCache.verify.mjs
let store = {};
let quota = Infinity;
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    const size = Object.values(store).reduce((s, x) => s + x.length, 0) + v.length;
    if (size > quota) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
    store[k] = String(v);
  },
  removeItem: (k) => { delete store[k]; },
};

const m = await import("./aiHubDemoCache.js");
const { isCacheable, cacheGet, cachePut, cacheStats, cacheClear, warmCache, WARM_PATHS } = m;

let fails = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS " : "FAIL "} ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) fails++;
};
// MUST await: the warm-up tests are async, and a non-awaiting runner reported
// them as "PASS -> [object Promise]" while their real assertions failed later
// as unhandled rejections — and let them run concurrently, so one test's cache
// writes corrupted the next test's measurement.
const t = async (label, fn) => {
  try { const r = await fn(); console.log(`  PASS  ${label}${r ? ` -> ${r}` : ""}`); }
  catch (e) { console.log(`  FAIL  ${label}  ::  ${e.message}`); fails++; }
};

console.log("\n=== what may be cached ===");
eq("/overview", isCacheable("/overview"), true);
eq("/dlp?limit=5000", isCacheable("/dlp?limit=5000"), true);
eq("/dlp/summary", isCacheable("/dlp/summary"), true);
eq("/dlp/files?limit=5000", isCacheable("/dlp/files?limit=5000"), true);
eq("/claude-usage?sources=all&days=30", isCacheable("/claude-usage?sources=all&days=30"), true);
eq("/routing/rules", isCacheable("/routing/rules"), true);
console.log("\n=== what must NEVER be cached ===");
eq("/features (Settings reads it live)", isCacheable("/features"), false);
eq("/dlp/abc123/content (captured prompt text)", isCacheable("/dlp/abc123/content"), false);
eq("/dlp/6f2a-9c/content?x=1", isCacheable("/dlp/6f2a-9c/content?x=1"), false);
eq("/installations/agent-installer?platform=windows", isCacheable("/installations/agent-installer?platform=windows"), false);
eq("/installations/extension-package", isCacheable("/installations/extension-package"), false);

console.log("\n=== round trip ===");
cacheClear();
await t("put then get returns the same bytes", () => {
  const body = JSON.stringify({ totals: { machines: 3 } });
  if (cachePut("/overview", body) !== true) throw new Error("put refused");
  if (cacheGet("/overview") !== body) throw new Error("mismatch");
  return "byte-identical";
});
await t("miss returns null (not undefined/throw)", () => {
  if (cacheGet("/never-fetched") !== null) throw new Error("expected null");
  return "null";
});
await t("stats counts and sizes", () => {
  const s = cacheStats();
  if (s.count !== 1) throw new Error("count " + s.count);
  if (!(s.bytes > 0)) throw new Error("bytes " + s.bytes);
  if (!s.newest) throw new Error("no timestamp");
  return `${s.count} entry, ${s.bytes} bytes`;
});

console.log("\n=== oversized payloads are trimmed, not dropped ===");
await t("top-level array of 5000 trims to 600", () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ id: "e" + i, occurred_at: new Date().toISOString(), pad: "x".repeat(200) }));
  const ok = cachePut("/dlp?limit=5000", JSON.stringify(big));
  if (!ok) throw new Error("refused to cache");
  const back = JSON.parse(cacheGet("/dlp?limit=5000"));
  if (!Array.isArray(back)) throw new Error("not an array any more");
  if (back.length !== 600) throw new Error("length " + back.length);
  if (back[0].id !== "e0") throw new Error("lost ordering");
  return `5000 -> ${back.length} newest-first entries kept`;
});
await t("object with a big events[] trims that field and flags it", () => {
  const big = { byService: [{ ai_service: "chatgpt.com" }], events: Array.from({ length: 3000 }, (_, i) => ({ id: i, pad: "y".repeat(300) })) };
  if (!cachePut("/dlp/summary", JSON.stringify(big))) throw new Error("refused");
  const back = JSON.parse(cacheGet("/dlp/summary"));
  if (back.events.length !== 600) throw new Error("events " + back.events.length);
  if (back._demo_trimmed !== true) throw new Error("not flagged as trimmed");
  if (back.byService.length !== 1) throw new Error("sibling field lost");
  return "events trimmed, byService preserved, _demo_trimmed set";
});

console.log("\n=== quota exhaustion must not corrupt existing entries ===");
cacheClear();
await t("an entry that will not fit is refused, others survive", () => {
  cachePut("/overview", JSON.stringify({ ok: true }));
  quota = 4000; // tiny
  const refused = cachePut("/huge", JSON.stringify(Array.from({ length: 500 }, () => "z".repeat(100))));
  quota = Infinity;
  if (refused !== false) throw new Error("expected refusal");
  if (cacheGet("/overview") === null) throw new Error("existing entry was evicted");
  return "refused the new entry, kept the old one";
});

console.log("\n=== clear ===");
await t("clear removes entries and the index", () => {
  cachePut("/a", "1"); cachePut("/b", "2");
  cacheClear();
  if (cacheGet("/a") !== null || cacheGet("/b") !== null) throw new Error("entries remain");
  if (cacheStats().count !== 0) throw new Error("index remains");
  return "empty";
});

console.log("\n=== warm-up ===");
await t("warmCache fetches every path once and reports progress", async () => {
  cacheClear();
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    return { ok: true, headers: { get: () => "application/json" }, text: async () => JSON.stringify({ url }) };
  };
  const progress = [];
  const stats = await warmCache(fakeFetch, (done, total, path) => progress.push(`${done}/${total}`));
  if (seen.length !== WARM_PATHS.length) throw new Error(`fetched ${seen.length} of ${WARM_PATHS.length}`);
  if (progress.length !== WARM_PATHS.length) throw new Error("progress not reported for every path");
  if (stats.count !== WARM_PATHS.length) throw new Error(`cached ${stats.count}`);
  if (!seen.every((u) => u.startsWith("/api/v1/"))) throw new Error("warm path missing the /api/v1 prefix");
  return `${seen.length} paths warmed`;
});
await t("warmCache skips a failing path instead of aborting", async () => {
  cacheClear();
  let n = 0;
  const flaky = async () => {
    n++;
    if (n % 3 === 0) throw new Error("boom");
    return { ok: true, headers: { get: () => "application/json" }, text: async () => "{}" };
  };
  const stats = await warmCache(flaky, () => {});
  if (n !== WARM_PATHS.length) throw new Error("stopped early at " + n);
  if (stats.count === 0) throw new Error("nothing cached");
  return `${n} attempted, ${stats.count} cached, ${n - stats.count} skipped`;
});
await t("warmCache does not cache a non-200 or non-JSON response", async () => {
  cacheClear();
  const bad = async () => ({ ok: false, headers: { get: () => "application/json" }, text: async () => "nope" });
  const stats = await warmCache(bad, () => {});
  if (stats.count !== 0) throw new Error("cached " + stats.count);
  const html = async () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => "<html>" });
  const stats2 = await warmCache(html, () => {});
  if (stats2.count !== 0) throw new Error("cached html: " + stats2.count);
  return "401s and HTML both refused";
});



console.log(fails === 0 ? "\nCACHE OK" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
