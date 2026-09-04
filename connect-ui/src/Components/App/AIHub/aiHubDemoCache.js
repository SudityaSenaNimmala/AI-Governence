/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO-ONLY RESPONSE CACHE FOR THE AI HUB (/api/v1/*) — NOT PRODUCTION CODE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Makes every AI Hub tab — Overview, Inventory, Activity (Prompts & DLP,
 * Claude Usage, Model Routing), Policies & Risk, Access Requests, SDK, Setup —
 * load instantly while demo mode is on.
 *
 * ── WHY A CACHE AND NOT FABRICATED DATA ────────────────────────────────────
 * Agent Governance uses a fabricated tenant because it cannot show anything at
 * all without an OAuth connection. The AI Hub is different: it already has
 * real data, it is just slow — `/dlp?limit=5000` pulls thousands of events to
 * the browser and filters them client-side.
 *
 * So this stores the REAL response the first time and replays it after that.
 * The shapes are therefore correct by construction. Hand-writing mocks for
 * this surface would mean guessing a dozen more payload shapes, and a wrong
 * guess renders as a blank screen rather than a visible error — that already
 * happened once on the Agent Governance side and cost a live demo.
 *
 * ── HOW IT BEHAVES ─────────────────────────────────────────────────────────
 *   demo ON,  path cached      → instant replay, no network
 *   demo ON,  path not cached  → real request, response stored on the way back
 *   demo OFF                   → nothing here runs at all
 *
 * First visit to a tab is therefore as slow as it is today; every visit after
 * is instant, and "Warm demo cache" in Settings does that first pass for every
 * tab up front so it never happens mid-demo.
 *
 * ── WHAT IS DELIBERATELY NOT CACHED ────────────────────────────────────────
 *   • Anything that is not a GET. A demo must not replay writes.
 *   • Any response that is not 200 + JSON. Caching a 401 would make an
 *     admin-auth gap look permanent.
 *   • `/features`. That is what the Settings page reads, including the demo
 *     switch's own surroundings — freezing it would make Settings lie.
 *   • `/dlp/:id/content`. Captured prompt text, fetched only when a drawer is
 *     opened. It is the most sensitive payload in the product and there is no
 *     reason to persist it into localStorage.
 *
 * ── REVERT ─────────────────────────────────────────────────────────────────
 * Delete this file and the DEMO MODE block in
 * ../AgentGovernance/agentGovernanceDemoData.js that calls into it.
 */

const PREFIX = "aihub_demo_cache:";
const INDEX_KEY = "aihub_demo_cache_index";

/** localStorage is ~5MB per origin. A single oversized entry must not evict
 *  the rest, so anything above this is trimmed and then re-measured. */
const MAX_ENTRY_BYTES = 700_000;
/** How many items to keep when trimming an oversized list. Comfortably more
 *  than any table paginates to (25/page), so the demo still looks full. */
const TRIM_TO = 600;

const NEVER_CACHE = [
  "/features",        // Settings reads this live
  "/dlp/",            // /dlp/:id/content — captured prompt text
  "/installations/agent-installer",
  "/installations/extension-package",
  "/sdk-download",
];

/** Paths worth pre-fetching so no tab is ever cold during a demo. */
export const WARM_PATHS = [
  "/overview",
  "/machines",
  "/registry",
  "/registry/summary",
  "/ai-platforms",
  "/dlp/summary",
  "/dlp?limit=5000",
  "/dlp/files?limit=5000",
  "/dlp?severity=critical,high&limit=1",
  "/findings?type=mcp_server&latestOnly=true&limit=500",
  "/findings?type=agent_project&latestOnly=true&limit=500",
  "/claude-usage?sources=all&days=30",
  "/claude-usage?sources=all&days=7",
  "/claude-usage?sources=all&days=90",
  "/routing/rules",
  "/routing/endpoints",
  "/routing/analytics",
  "/routing/log?limit=50",
  "/installations/info",
  "/connections",
  "/webhooks",
  "/webhooks/templates",
  "/webhooks/log",
];

// `/dlp` is a legitimate cache target but `/dlp/<id>/content` is not, and the
// NEVER_CACHE prefix "/dlp/" would swallow both. Distinguish on the shape.
function isCapturedContent(path) {
  return /^\/dlp\/[^/?]+\/content/.test(path);
}

export function isCacheable(path) {
  if (isCapturedContent(path)) return false;
  if (path.startsWith("/dlp?") || path === "/dlp" || path.startsWith("/dlp/summary") || path.startsWith("/dlp/files")) return true;
  return !NEVER_CACHE.some((p) => path.startsWith(p));
}

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || "{}"); } catch { return {}; }
}
function writeIndex(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* full */ }
}

/** Shrink an oversized payload rather than refuse to cache it. Only touches
 *  the obvious list shapes — a top-level array, or one array field carrying
 *  the bulk (events / files / rows / items). */
function trim(value) {
  if (Array.isArray(value)) return value.slice(0, TRIM_TO);
  if (value && typeof value === "object") {
    for (const k of ["events", "files", "rows", "items", "data", "log", "systems"]) {
      if (Array.isArray(value[k]) && value[k].length > TRIM_TO) {
        return { ...value, [k]: value[k].slice(0, TRIM_TO), _demo_trimmed: true };
      }
    }
  }
  return value;
}

export function cacheGet(path) {
  try {
    return localStorage.getItem(PREFIX + path);
  } catch {
    return null;
  }
}

export function cachePut(path, text) {
  try {
    let body = text;
    if (body.length > MAX_ENTRY_BYTES) {
      let parsed;
      try { parsed = JSON.parse(body); } catch { return false; }
      body = JSON.stringify(trim(parsed));
      // Still too large after trimming — leave it uncached and keep serving it
      // from the server rather than evicting everything else.
      if (body.length > MAX_ENTRY_BYTES) return false;
    }
    localStorage.setItem(PREFIX + path, body);
    const idx = readIndex();
    idx[path] = { at: Date.now(), bytes: body.length };
    writeIndex(idx);
    return true;
  } catch {
    // QuotaExceeded — the demo still works, it is just not instant for this
    // path. Better than wiping entries other tabs depend on.
    return false;
  }
}

export function cacheStats() {
  const idx = readIndex();
  const paths = Object.keys(idx);
  const bytes = paths.reduce((s, p) => s + (idx[p].bytes || 0), 0);
  const newest = paths.reduce((m, p) => Math.max(m, idx[p].at || 0), 0);
  return { count: paths.length, bytes, newest: newest || null };
}

export function cacheClear() {
  try {
    for (const p of Object.keys(readIndex())) localStorage.removeItem(PREFIX + p);
    localStorage.removeItem(INDEX_KEY);
  } catch { /* nothing to do */ }
}

/**
 * Fetch every warm path once and cache it. `onProgress(done, total, path)`
 * is called as each settles. Uses the REAL fetch passed in, so it works even
 * though the demo shim has already replaced window.fetch.
 */
export async function warmCache(realFetch, onProgress) {
  const total = WARM_PATHS.length;
  let done = 0;
  // Sequential on purpose: 23 parallel requests against an already-slow
  // endpoint is how you turn a warm-up into a timeout.
  for (const path of WARM_PATHS) {
    try {
      const res = await realFetch(`/api/v1${path}`, { headers: { "Content-Type": "application/json" } });
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
        cachePut(path, await res.text());
      }
    } catch { /* skip — this path stays live */ }
    done += 1;
    if (onProgress) onProgress(done, total, path);
  }
  return cacheStats();
}
