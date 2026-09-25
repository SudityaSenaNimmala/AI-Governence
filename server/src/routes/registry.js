// Cross-Platform AI/Agent Registry — unified catalog of every AI system in the org.
//
// Aggregates data from 5 sources into one searchable registry:
//   1. discovered_agents (governance discovery — Copilot Studio, Azure, Google, AWS)
//   2. findings (endpoint agent — desktop apps, IDE extensions, MCP servers, running agents, local LLMs)
//   3. ai_platforms (platform registry — known AI services)
//   4. sanctions (approval status — approved/restricted/blocked)
//   5. dlp_events (usage stats — how much each tool is used)
//
// Each entry has: name, platform, owner, risk, status, data access, lifecycle, last active.

import { a } from '../util.js';
import { requireAdminAuth } from '../auth.js';
import { fireWebhooks } from './webhooks.js';
import { scoreToLevel, normalizeStoredRisk } from '../lib/risk-scale.js';
import { assessToolRisk } from '../lib/tool-risk.js';
import { isMicrosoftWorkspaceCopilotProduct, applyMicrosoftWorkspaceCopilotCascade } from '../lib/ai-surfaces.js';
import { derivePlatform, normalizePlatform } from '../lib/agent-platform.js';
// Imported under its REAL name, matching lifecycle.ts's import of the same
// function, so `grep -rn "unenforceableReason("` finds every call site. The local
// that holds the result is named `enforcementReason` for the same reason it is in
// lifecycle.ts's POST /block: it is not the admin's free-text `reason`.
import { unenforceableReason } from '../lib/agent-platforms.js';
import {
  RESPONSE_BUDGET_MS, raceWithFallback, applyBudgetHeaders, invalidateRoute,
  peekFresh, peekLastKnownGood, registerResponseWarmer,
} from '../lib/response-budget.js';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Normalize finding types to registry categories
const CATEGORY_MAP = {
  desktop_app:     'desktop-app',
  running_process: 'desktop-app',
  ide_extension:   'ide-assistant',
  mcp_server:      'mcp-server',
  running_agent:   'autonomous-agent',
  agent_project:   'autonomous-agent',
  agent_config:    'agent-config',
  local_llm:       'local-model',
  browser_ai_visit:'web-service',
};

export function mountRegistry(app, db) {

  // ── Unified Registry — returns all AI systems from all sources ──

  // Builds the unified registry: merges all sources, dedups, filters out the
  // skip-listed vendors/types and invalid names. Both the list route and the
  // summary route go through this, so a count can never disagree with the rows
  // it claims to be counting — see the note on /registry/summary below.
  // ── Snapshot fallback ───────────────────────────────────────────────────────
  //
  // buildRegistry() reads five collections and aggregates dlp_events on every
  // request, with no caching. When the database is slow it does not degrade, it
  // hangs: /api/v1/registry and /summary returned nothing after 120s on both the
  // deployed host and locally, while every other endpoint answered in under a
  // second. The Inventory page then shows "Loading..." forever, because the two
  // calls it depends on never resolve.
  //
  // data/registry-snapshot.json is a real capture of this tenant's inventory —
  // 260 systems with their actual scores, not fabricated rows. Served when the live
  // build exceeds its budget so the screen always has data.
  //
  // Live data still wins whenever the database is healthy: the snapshot is only
  // reached on timeout or error, and `stale: true` in the response says which one
  // you are looking at rather than passing a snapshot off as current.
  //
  // KEPT FRESH AUTOMATICALLY. It used to be a static file baked into the image,
  // so it aged from the day it was captured and a redeploy was the only thing
  // that could ever move it. Every successful live build now rewrites it (see
  // refreshSnapshotFile), which is what makes it a current capture rather than a
  // historical one. Note for operators: docker-compose.yml mounts a named volume
  // over server/data, so a newer snapshot shipped inside a new image does NOT
  // replace the one already in that volume — the running server's own rewrites
  // are what keep it current there.
  const SNAPSHOT_PATH = process.env.REGISTRY_SNAPSHOT_PATH
    || join(__dirname, '..', '..', 'data', 'registry-snapshot.json');
  // Was 15000, then 5000. Measured live: on a slow/degraded connection to the
  // database, the 5-collection build doesn't fail outright, it just runs past
  // this budget every time — so 15s was never "the rare slow case," it was the
  // guaranteed wait before the (perfectly good, real) snapshot fallback ever
  // kicked in. Lower budget = same fallback, reached 3x faster.
  //
  // The number itself now comes from lib/response-budget.js, so this route can
  // no longer drift away from the org-wide budget every other tab is held to.
  // REGISTRY_BUILD_BUDGET_MS is kept as the per-route override for backward
  // compatibility with any deployment config already setting it.
  const BUILD_BUDGET_MS = Number(process.env.REGISTRY_BUILD_BUDGET_MS || RESPONSE_BUDGET_MS);
  // REGISTRY_SNAPSHOT_FIRST=1 answers from the snapshot without attempting the live
  // build at all, so the page paints with no wait.
  //
  // For a live demo, waiting out the budget and then falling back is still a visible
  // stall — the fallback removes the infinite spinner but not the pause. This makes
  // it instant. Off by default: it stops serving current data, which is only the
  // right trade when someone is watching and the database is known to be unwell.
  const SNAPSHOT_FIRST = process.env.REGISTRY_SNAPSHOT_FIRST === '1';
  // Circuit breaker, so instant responses do not depend on an env var being set on
  // the host. deploy.mjs deliberately never ships server/.env, so a flag set locally
  // would not reach production — the one place this matters most. After a failed or
  // over-budget build the live path is skipped for this long, then retried, so the
  // page self-heals when the database recovers instead of needing a redeploy.
  const UNHEALTHY_FOR_MS = Number(process.env.REGISTRY_UNHEALTHY_FOR_MS || 120_000);
  let _unhealthyUntil = 0;
  let _snapshot = null;
  // Short-lived cache for the live build — avoids re-running the 5-collection
  // query on every tab switch or page refresh within 30 seconds. It lives in the
  // shared response store now (lib/response-budget.js) rather than in two
  // module-level variables here, which is also what makes it self-heal: see the
  // discard-bug note in readRegistry below.
  const LIVE_CACHE_TTL_MS = Number(process.env.REGISTRY_LIVE_CACHE_TTL_MS || 30_000);
  const ROUTE = 'registry';

  function loadSnapshot() {
    if (_snapshot) return _snapshot;
    try {
      _snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch {
      _snapshot = null;   // absent is fine — callers fall through to their own error
    }
    return _snapshot;
  }

  // Keep data/registry-snapshot.json current.
  //
  // The snapshot is a REAL CURATED CAPTURE of this tenant's inventory, not a
  // mere cache — that is why it is a file, why it carries its own precomputed
  // summary, and why it survives a restart when the in-memory store does not.
  // What it was not, before this, was current: it was written once by hand and
  // then aged indefinitely, so the fallback got worse every day the database
  // stayed healthy. Every successful build now replaces it, so the worst case
  // after a restart is "as old as the last successful build" rather than "as old
  // as the image".
  //
  // Written atomically (temp file + rename) because this same file is read at
  // startup and on every fallback: a half-written snapshot would be unparseable
  // and would silently degrade the fallback to a 503.
  //
  // NEVER writes an empty build over a non-empty capture. An empty result is
  // legitimate on a fresh install, but overwriting 260 real systems with [] would
  // throw away the entire fallback on the strength of one anomalous build.
  function refreshSnapshotFile(rows) {
    try {
      if (!Array.isArray(rows)) return;
      if (rows.length === 0) {
        if (loadSnapshot()) console.warn('[registry] live build returned 0 systems — keeping the existing snapshot');
        return;
      }
      const snapshot = {
        captured_at: new Date().toISOString(),
        systems: rows,
        // Derived from the very rows in the same file, which is what keeps the
        // "a count can never disagree with the rows it claims to be counting"
        // property true of the fallback as well as the live path.
        summary: summarize(rows),
      };
      mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
      const tmp = `${SNAPSHOT_PATH}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
      renameSync(tmp, SNAPSHOT_PATH);
      _snapshot = snapshot;   // in-process copy stays in step with the file
      console.log(`[registry] snapshot refreshed — ${rows.length} systems`);
    } catch (err) {
      // A failed refresh must never fail a request: the response is already
      // correct without it, and the old snapshot is still a valid fallback.
      console.warn(`[registry] snapshot refresh failed: ${err?.message || err}`);
    }
  }

  // ONE read path for both routes, resolving to a description of what was
  // served rather than throwing — the convention this file already used ("so
  // callers branch on the value instead of wrapping every call site in
  // try/catch"), now shared with every other budgeted route via
  // lib/response-budget.js.
  //
  //   { rows, stale, capturedAt, coldMiss, snapshot }
  //   { unavailable: true }   nothing real exists to serve — the caller 503s
  //
  // THE DISCARD BUG THIS CONVERSION FIXES. The old version raced the build
  // against the budget behind a `settled` flag, and once the budget had expired
  // that flag made the build's eventual result get thrown away. On a degraded
  // cluster — where the build runs past the budget EVERY time, which is the
  // measured behaviour this budget exists for — the cache could therefore never
  // be filled, so the page stayed pinned to the file snapshot until the database
  // recovered and some request happened to land under budget by luck.
  // raceWithFallback attaches the store write to the build promise itself, so a
  // late build repopulates the store and the NEXT request is live and unstale.
  async function readRegistry() {
    const fresh = peekFresh({ route: ROUTE, freshMs: LIVE_CACHE_TTL_MS });
    if (fresh) return { rows: fresh.value, stale: false, capturedAt: fresh.capturedAt, coldMiss: false };

    // The live path is skipped entirely while the breaker is open or
    // REGISTRY_SNAPSHOT_FIRST is set — but only if there is something real to
    // answer with. Prefer this process's own last capture over the file: both
    // are real and instant, and the in-memory one is newer.
    if (SNAPSHOT_FIRST || Date.now() < _unhealthyUntil) {
      const lastGood = peekLastKnownGood({ route: ROUTE });
      if (lastGood) return { rows: lastGood.value, stale: true, capturedAt: lastGood.capturedAt, coldMiss: false };
      const snap = loadSnapshot();
      if (snap) return { rows: snap.systems, stale: true, capturedAt: snap.captured_at || null, coldMiss: false, snapshot: snap };
    }

    const haveSnapshot = Boolean(loadSnapshot());
    const result = await raceWithFallback({
      route: ROUTE,
      params: null,
      budgetMs: BUILD_BUDGET_MS,
      freshMs: LIVE_CACHE_TTL_MS,
      // THIS ROUTE HAS ITS OWN FALLBACK TIER. When a snapshot file exists, an
      // over-budget build with an empty store must answer from that file rather
      // than make the caller wait the build out — waiting is exactly the hang
      // the snapshot was introduced to prevent. With NO snapshot there is
      // nothing else to serve, so the generic cold-start rule applies and a
      // patient caller gets real data instead of a 503.
      awaitOnColdMiss: !haveSnapshot,
      live: async () => {
        const rows = await buildRegistry();
        _unhealthyUntil = 0;              // healthy again — including on a LATE build
        refreshSnapshotFile(rows);        // synchronous, and cheap next to the build
        return rows;
      },
    });

    if (!result.failed && !result.stale && !result.unresolved) {
      return { rows: result.value, stale: false, capturedAt: result.capturedAt, coldMiss: result.coldMiss };
    }

    // Over budget or failed. Trip the breaker so the next 120s of requests are
    // instant, and ONLY when there is something to fall back on: without one,
    // tripping would turn a slow page into a 503 and lose the data that a
    // patient caller would still have received.
    const snap = loadSnapshot();
    if (result.stale || snap) {
      _unhealthyUntil = Date.now() + UNHEALTHY_FOR_MS;
      console.warn(`[registry] live build ${result.failed ? 'failed' : `exceeded ${BUILD_BUDGET_MS}ms`} — serving last-known-good, skipping the live build for ${UNHEALTHY_FOR_MS / 1000}s`);
    }
    // A stale answer from the store is this tenant's own last real build, which
    // is newer than the file, so it wins over the snapshot.
    if (result.stale) {
      return { rows: result.value, stale: true, capturedAt: result.capturedAt, coldMiss: false };
    }
    if (snap) {
      return { rows: snap.systems, stale: true, capturedAt: snap.captured_at || null, coldMiss: false, snapshot: snap };
    }
    return { unavailable: true };
  }

  // Warm the store once after boot, so the first request after a deploy (which
  // restarts the container, so this is every deploy) has a real fallback instead
  // of being the one request that has to wait out a cold build.
  registerResponseWarmer(ROUTE, () => readRegistry());

  async function buildRegistry() {
    // Run all 5 collection reads in parallel — was sequential, costing 15s+
    const [govAgents, findings, sanctions, dlpStats, platforms] = await Promise.all([
      // 1. Governance discovered agents
      db.collection('discovered_agents')
        .find({}).project({ _id: 0 }).toArray().catch(() => []),
      // 2. Endpoint scan findings (deduplicated by tool_key)
      db.collection('findings')
        .find({}).project({ _id: 0 }).toArray().catch(() => []),
      // 3. Sanctions (approval status)
      db.collection('sanctions')
        .find({}).project({ _id: 0 }).toArray().catch(() => []),
      // 4. DLP usage stats per service
      db.collection('dlp_events').aggregate([
        { $group: {
          _id: '$ai_service',
          event_count: { $sum: 1 },
          last_event: { $max: '$occurred_at' },
          block_count: { $sum: { $cond: [{ $eq: ['$event_kind', 'enforcement_block'] }, 1, 0] } },
          override_count: { $sum: { $cond: [{ $eq: ['$event_kind', 'enforcement_override'] }, 1, 0] } },
          sensitive_count: { $sum: { $cond: [{ $in: ['$secret_class', ['critical', 'high']] }, 1, 0] } },
          machines: { $addToSet: '$machine_id' },
        }},
      ]).toArray().catch(() => []),
      // 5. AI Platforms
      db.collection('ai_platforms')
        .find({}).project({ _id: 0 }).toArray().catch(() => []),
    ]);
    const sanctionMap = new Map(sanctions.map(s => [s.tool_key, s]));
    const dlpMap = new Map(dlpStats.map(d => [d._id, d]));
    const platformMap = new Map(platforms.map(p => [p.host, p]));
    // Build product→blocked lookup from ai_platforms (source of truth).
    // A product is "blocked" only if ALL its hosts are blocked.
    // A product is "approved" if at least one host is governed and none are blocked.
    const productHosts = new Map();  // product_lower → [{ host, blocked, governed }]
    for (const p of platforms) {
      if (!p.product) continue;
      const key = p.product.toLowerCase();
      if (!productHosts.has(key)) productHosts.set(key, []);
      productHosts.get(key).push({ host: p.host, blocked: !!p.blocked, governed: !!p.governed });
    }
    // vendor → [{ host, blocked, governed }] for matching by vendor name
    const vendorHosts = new Map();
    for (const p of platforms) {
      if (!p.vendor) continue;
      const key = p.vendor.toLowerCase();
      if (!vendorHosts.has(key)) vendorHosts.set(key, []);
      vendorHosts.get(key).push({ host: p.host, blocked: !!p.blocked, governed: !!p.governed });
    }

    function resolveProductHosts(productName, vendorName) {
      if (!productName) return { status: 'unknown', hosts: [] };
      const lower = productName.toLowerCase();
      // Exact product match first
      let hosts = productHosts.get(lower);
      // Partial product match: "Gemini" should find "Google Gemini"
      if (!hosts || hosts.length === 0) {
        for (const [key, val] of productHosts) {
          if (key.includes(lower) || lower.includes(key)) {
            if (!key.includes(' in ')) { hosts = val; break; }
          }
        }
      }
      // Match by vendor name: "Claude" → vendor "Anthropic", "ChatGPT" → vendor "OpenAI"
      if (!hosts || hosts.length === 0) {
        // Try the vendor param first, then check if the product name matches a vendor
        const vn = (vendorName || '').toLowerCase();
        if (vn && vendorHosts.has(vn)) hosts = vendorHosts.get(vn);
        if (!hosts || hosts.length === 0) {
          // Try the product name as a vendor match (e.g. "Claude" → host contains "claude")
          for (const p of platforms) {
            if (p.host && p.host.toLowerCase().includes(lower)) {
              if (!hosts) hosts = [];
              hosts.push({ host: p.host, blocked: !!p.blocked, governed: !!p.governed });
            }
          }
        }
      }
      if (!hosts || hosts.length === 0) return { status: 'unknown', hosts: [] };
      // Deduplicate by host
      const seen = new Set();
      hosts = hosts.filter(h => { if (seen.has(h.host)) return false; seen.add(h.host); return true; });
      const allBlocked = hosts.every(h => h.blocked);
      if (allBlocked) return { status: 'blocked', hosts: hosts.map(h => h.host) };
      const allUnblocked = hosts.every(h => !h.blocked);
      if (allUnblocked) return { status: 'approved', hosts: hosts.map(h => h.host) };
      return { status: 'blocked', hosts: hosts.map(h => h.host) };
    }
    function getProductStatus(productName, vendorName) { return resolveProductHosts(productName, vendorName).status; }

    // Build unified registry
    const registry = new Map(); // key → entry

    // Source A: Governance agents (richest data)
    for (const agent of govAgents) {
      const key = agent.botId || agent.appId || agent.id || agent.name;
      if (!key) continue;
      // THE SANCTION IS LOOKED UP UNDER EVERY IDENTIFIER THIS ROW COULD HAVE BEEN
      // SAVED UNDER, and that is a bug fix rather than defensiveness.
      //
      // The read used `key` — botId first — while PUT /registry/:id/status writes
      // `sanctions.tool_key` using the id the UI sent, which is this row's exposed
      // `id` (agent.id || key). For a Copilot Studio agent whose botId differs
      // from its id, the write landed under one key and the read looked under
      // another, so the decision was invisible: the toggle showed Blocked from
      // optimistic local state and silently reverted to "approved" on reload.
      // Observed live — a PUT returning {"ok":true} followed by a read still
      // saying approved.
      //
      // Reading tolerantly fixes rows already written under either key, so no
      // migration is needed. First match wins, in the same precedence the write
      // path would have used.
      const sanction = [agent.id, key, agent.botId, agent.appId, agent.name]
        .filter(Boolean)
        .map((k) => sanctionMap.get(k))
        .find(Boolean);
      const risk = normalizeStoredRisk(agent.risk);
      const govResolved = resolveProductHosts(agent.name, agent.vendor);
      registry.set('gov:' + key, {
        id: agent.id || key,
        name: agent.name || 'Unnamed Agent',
        matched_hosts: govResolved.hosts,
        description: agent.description || null,
        platform: agent.platform || 'unknown',
        category: mapGovPlatform(agent.platform),
        vendor: agent.vendor || null,
        owner: agent.owner?.displayName || null,
        owner_email: agent.owner?.userPrincipalName || null,
        owner_active: agent.owner?.accountEnabled ?? true,
        is_orphaned: agent.isOrphaned || false,
        // normalizeStoredRisk(), NOT the raw stored score. These documents were
        // persisted under the old compliance convention (87 meant "safe"), and
        // most predate the marker assessRisk() now stamps. Reading them as forward
        // would invert every historical row — the safest agent would render
        // "critical". The helper converts unmarked documents and passes marked
        // ones through, so old and new rows coexist on one scale.
        risk_score: risk.score,
        risk_level: risk.level,
        risk_factors: risk.factors || [],
        status: sanction?.status || mapLifecycleToStatus(agent.lifecycleStatus),
        lifecycle: agent.lifecycleStatus || 'active',
        data_access: (agent.connectors || []).map(c => c.name || c.type).filter(Boolean),
        connectors: agent.connectors || [],
        permissions: agent.permissions || [],
        model: agent.llmModel || agent.llmModelHint || null,
        ai_settings: agent.aiSettings || null,
        activity: {
          total: agent.activity?.totalInvocations || 0,
          last_7d: agent.activity?.invocationsLast7Days || 0,
          last_active: agent.activity?.lastActiveTimestamp || null,
          unique_users: agent.activity?.uniqueUsers || 0,
        },
        first_seen: agent.firstSeen || null,
        last_active: agent.activity?.lastActiveTimestamp || agent.lastModified || null,
        source: 'governance',
        source_detail: agent.discoverySource || agent.platform,
      });
    }

    // Source B: Endpoint findings (dedup by tool_key)
    // Skip raw finding types that aren't real AI tools (api_key, agent_project etc.)
    const SKIP_TYPES = new Set(['api_key', 'agent_marker']);
    const SKIP_VENDORS = new Set(['unknown']);
    const toolFindings = new Map();
    for (const f of findings) {
      const tk = f.tool_key;
      if (!tk) continue;
      if (SKIP_TYPES.has(f.type)) continue;
      if (tk.startsWith('unknown:') && !f.product) continue; // skip "unknown:filesystem" etc.
      if (!toolFindings.has(tk)) toolFindings.set(tk, []);
      toolFindings.get(tk).push(f);
    }

    for (const [tk, fList] of toolFindings) {
      if (registry.has('gov:' + tk)) continue;
      const sample = fList[0];
      // Skip entries that are just raw types, not real tools
      const name = sample.product || sample.appId || sample.extensionId || sample.serverName || sample.runtime;
      if (!name || name === 'undefined' || name.length < 2) continue;

      const sanction = sanctionMap.get(tk);
      const dlp = dlpMap.get(name) || dlpMap.get(sample.vendor);
      const machineCount = new Set(fList.map(f => f.machine_id)).size;

      // Status comes from ai_platforms (source of truth for enforcement)
      const resolved = resolveProductHosts(name, sample.vendor);
      const resolvedStatus = resolved.status !== 'unknown'
        ? resolved.status
        : (sanction?.status || 'unknown');

      registry.set('scan:' + tk, {
        id: tk,
        name,
        matched_hosts: resolved.hosts,
        description: null,
        platform: sample.type === 'ide_extension' ? sample.ide : (sample.platform || 'endpoint'),
        category: CATEGORY_MAP[sample.type] || 'unknown',
        vendor: sample.vendor || null,
        owner: null,
        owner_email: null,
        owner_active: true,
        is_orphaned: false,
        // scoreToLevel(), not a local set of cut-points. This site used
        // >=70/>=40 while riskService used a fourth set in the opposite
        // direction, and both landed in this same column.
        risk_score: sample.risk_score ?? null,
        risk_level: scoreToLevel(sample.risk_score),
        risk_factors: [],
        status: resolvedStatus,
        lifecycle: 'active',
        data_access: extractDataAccess(sample),
        connectors: [],
        permissions: [],
        model: null,
        ai_settings: null,
        activity: {
          total: dlp?.event_count || 0,
          last_7d: 0,
          last_active: dlp?.last_event || sample.detected_at || null,
          unique_users: machineCount,
        },
        first_seen: sample.detected_at || null,
        last_active: dlp?.last_event || sample.detected_at || null,
        source: 'endpoint_scan',
        source_detail: sample.type,
        machine_count: machineCount,
      });
    }

    // Merge endpoint-scan entries that share the same vendor AND overlapping hosts.
    // E.g. "Claude" and "Claude Code" both resolve to [api.anthropic.com, claude.ai]
    // — they're the same product, one blocking decision.
    const scanKeys = [...registry.keys()].filter(k => k.startsWith('scan:'));
    for (let i = 0; i < scanKeys.length; i++) {
      const a = registry.get(scanKeys[i]);
      if (!a) continue;
      for (let j = i + 1; j < scanKeys.length; j++) {
        const b = registry.get(scanKeys[j]);
        if (!b) continue;
        if (a.vendor && b.vendor && a.vendor === b.vendor) {
          const aHosts = new Set(a.matched_hosts || []);
          const overlap = (b.matched_hosts || []).some(h => aHosts.has(h));
          if (overlap) {
            // Merge b into a: combine activity, union hosts, keep the shorter name
            a.activity.total += b.activity?.total || 0;
            a.matched_hosts = [...new Set([...(a.matched_hosts || []), ...(b.matched_hosts || [])])];
            if (b.last_active > a.last_active) a.last_active = b.last_active;
            if (a.activity.last_active == null || (b.activity?.last_active && b.activity.last_active > a.activity.last_active)) {
              a.activity.last_active = b.activity.last_active;
            }
            // Keep the shorter/simpler name (e.g. "Claude" over "Claude Code")
            if (b.name && a.name && b.name.length < a.name.length) a.name = b.name;
            registry.delete(scanKeys[j]);
          }
        }
      }
    }

    // Source C: AI Platforms — ONLY those with actual DLP activity
    // (skip the 100+ seeded platforms that nobody used)
    for (const plat of platforms) {
      const existing = [...registry.values()].find(e =>
        e.name?.toLowerCase() === plat.product?.toLowerCase()
      );
      if (existing) continue;

      const dlp = dlpMap.get(plat.product) || dlpMap.get(plat.host);
      // Only include platforms with real activity OR explicitly blocked
      if (!dlp && !plat.blocked) continue;

      const key = 'plat:' + plat.host;
      const platResolved = resolveProductHosts(plat.product);
      registry.set(key, {
        id: plat.host,
        matched_hosts: platResolved.hosts.length ? platResolved.hosts : [plat.host],
        name: plat.product || plat.host,
        description: null,
        platform: 'web',
        category: plat.category || 'web-service',
        vendor: plat.vendor || null,
        owner: null,
        owner_email: null,
        owner_active: true,
        is_orphaned: false,
        // Scored from endpoint telemetry rather than left null.
        //
        // These tools are governed BY the browser extension and desktop agent, so
        // that capture is their governance signal — there is no admin API to read
        // permissions or connectors from. Publishing null meant four services with
        // real captured traffic showed as blanks in the Overview risk breakdown; two
        // of them had a 100% block rate on critical/high content.
        ...(() => {
          const r = assessToolRisk({
            events: dlp?.event_count || 0,
            blocks: dlp?.block_count || 0,
            overrides: dlp?.override_count || 0,
            sensitive: dlp?.sensitive_count || 0,
            machines: (dlp?.machines || []).filter(Boolean).length,
            status: plat.blocked ? 'blocked' : (plat.governed ? 'approved' : 'unknown'),
            lastActive: dlp?.last_event || null,
          });
          return { risk_score: r.score, risk_level: r.level, risk_factors: r.factors, risk_basis: r.basis, risk_recommendations: r.recommendations };
        })(),
        status: plat.blocked ? 'blocked' : 'approved',
        lifecycle: plat.blocked ? 'blocked' : 'active',
        data_access: [],
        connectors: [],
        permissions: [],
        model: null,
        ai_settings: null,
        activity: {
          total: dlp?.event_count || 0,
          last_7d: 0,
          last_active: dlp?.last_event || null,
          unique_users: 0,
        },
        first_seen: plat.added_at || null,
        last_active: dlp?.last_event || null,
        source: 'platform_registry',
        source_detail: plat.surface || 'browser',
      });
    }

    return [...registry.values()];
  }

  app.get('/api/v1/registry', a(async (req, res) => {
    const { platform, status, risk_level, category, search } = req.query;

    const read = await readRegistry();
    if (read.unavailable) {
      return res.status(503).json({
        error: 'Registry is temporarily unavailable',
        detail: 'The live build timed out and no snapshot is present on this server.',
      });
    }
    // Filters below apply to snapshot and stale rows exactly as to live ones —
    // the shape is identical, so the page behaves the same whichever source
    // answered.
    let results = read.rows;

    if (platform)   results = results.filter(r => r.platform === platform || r.source_detail === platform);
    if (status)      results = results.filter(r => r.status === status);
    if (risk_level)  results = results.filter(r => r.risk_level === risk_level);
    if (category)    results = results.filter(r => r.category === category);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.vendor || '').toLowerCase().includes(q) ||
        (r.owner || '').toLowerCase().includes(q) ||
        (r.platform || '').toLowerCase().includes(q)
      );
    }

    // Sort: highest risk first, then by name.
    //
    // This comment was true of the intent and false of the behaviour. Governance
    // rows carried an inverted score (87 = safe), so ordering by raw score
    // descending put the SAFEST agents at the top: the first row served was
    // "87 / low", while the one genuinely high-risk agent sat mid-list. Now that
    // every row is forward-scaled the descending sort finally means what it says.
    //
    // Unscored agents sort LAST (-1) rather than first. They are unknown, not safe,
    // but a triage list should lead with what is measured and known-bad; the "not
    // assessed" rows are surfaced by their own badge rather than by position.
    results.sort((a, b) => {
      const ra = a.risk_score ?? -1, rb = b.risk_score ?? -1;
      if (rb !== ra) return rb - ra;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Headers, not body fields: this route returns a bare array and the UI
    // iterates it directly, so wrapping it in an object to carry a flag would
    // break every caller. A header says which source answered without changing
    // the contract. This route made that call first; it is now the shared
    // convention (X-Response-Stale / X-Response-Captured-At / X-Response-Budget,
    // see lib/response-budget.js). The two X-Registry-* headers are kept as
    // aliases so anything already reading them keeps working.
    applyBudgetHeaders(res, read);
    if (read.stale) {
      res.setHeader('X-Registry-Stale', '1');
      res.setHeader('X-Registry-Captured-At', read.capturedAt || '');
    }
    res.json(results);
  }));

  // ── Registry summary stats ──

  app.get('/api/v1/registry/summary', a(async (req, res) => {
    // Counted from the SAME rows /api/v1/registry serves, not from independent
    // per-collection countDocuments().
    //
    // The old version summed discovered_agents + distinct(tool_key) + governed
    // platforms and applied none of the dedup, SKIP_TYPES/SKIP_VENDORS filtering
    // or name-validity checks the list applies — so it reported 130 systems for a
    // list of 125. by_status was worse: it counted the `sanctions` collection,
    // a different universe from the `status` field on the returned rows, and
    // reported `unknown: 0` while the list held plenty of unknown rows.
    //
    // Deriving both from buildRegistry() makes disagreement impossible.
    const read = await readRegistry();
    if (read.unavailable) {
      return res.status(503).json({
        error: 'Registry summary is temporarily unavailable',
        detail: 'The live build timed out and no snapshot is present on this server.',
      });
    }

    applyBudgetHeaders(res, read);
    if (read.stale) {
      res.setHeader('X-Registry-Stale', '1');
      res.setHeader('X-Registry-Captured-At', read.capturedAt || '');
    }

    // When the answer came from the FILE, serve the summary the file carries:
    // it was derived from the very rows in the same file, so the fallback keeps
    // the "cannot disagree" property this comment is about. (Snapshots written
    // before this route shared summarize() carry a slightly smaller summary —
    // no active_ai_systems — which is served as-is rather than being recomputed
    // from rows that may have been filtered since.)
    if (read.snapshot?.summary) return res.json(read.snapshot.summary);

    res.json(summarize(read.rows));
  }));

  // ── Update status (allowed / blocked) — uses existing ai-platforms endpoint for enforcement ──

  // ADMIN-GATED, unlike every GET in this file. This route is the single widest
  // write in the product: it flips sanctions, suspends discovered agents, writes
  // `blocked_agents`, and — for the Microsoft 365 Copilot product — fans a block
  // across ten Microsoft hosts (applyMicrosoftWorkspaceCopilotCascade). Left open,
  // anyone who could reach the API could unblock every AI tool in the org, or
  // block Teams, Outlook and SharePoint for everyone, with one unauthenticated
  // PUT. The reads stay public on purpose (the extension and the desktop agent
  // poll them with no token); only the writes are gated. Same middleware the SDK,
  // replay, conversation and feature-settings routes already use, so there is one
  // admin credential in the product, not two.
  app.put('/api/v1/registry/:id/status', requireAdminAuth, a(async (req, res) => {
    const { status } = req.body ?? {};
    if (!['approved', 'blocked', 'unknown'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, blocked, or unknown' });
    }
    const id = req.params.id;
    const isBlocked = status === 'blocked';

    // INVALIDATE THE REGISTRY CACHE FIRST. buildRegistry() results are cached for
    // LIVE_CACHE_TTL_MS (30s), and the status write did not clear it — so a reload
    // within 30 seconds of blocking something served the pre-block registry and the
    // row appeared to revert to its old status. Combined with the UI updating
    // optimistically and deliberately not re-reading, an admin's decision looked
    // like it had silently failed. Observed live: a PUT returning {"ok":true}
    // followed immediately by a read still reporting "approved".
    //
    // invalidateRoute() drops the entry's FRESHNESS, not the entry: the next
    // read goes live (so it sees this decision), while the pre-block body
    // survives only as an explicitly-labelled stale fallback for the case where
    // that live read then times out. Deleting it outright would trade "briefly
    // shows a stale row, and says so" for "shows nothing at all".
    invalidateRoute(ROUTE);

    // Update sanctions collection (status tracking)
    await db.collection('sanctions').updateOne(
      { tool_key: id },
      { $set: { tool_key: id, status, updated_at: new Date() } },
      { upsert: true },
    );

    // ONE definition of "which discovered agent is this request about", so the
    // platform derivation further down cannot resolve a different document than
    // the one whose lifecycle was just changed.
    const agentMatch = { $or: [{ id: id }, { botId: id }, { appId: id }, { name: id }] };

    // Strategy 3: for governance agents — update lifecycle. Moved AHEAD of the
    // ai_platforms host-block below (was Strategy 2 first, in request order) so
    // `looksLikeAgent` is known BEFORE deciding whether to touch ai_platforms at
    // all — see the comment on that gate for why order matters here.
    const agentLifecycle = await db.collection('discovered_agents').updateMany(
      agentMatch,
      { $set: { lifecycleStatus: isBlocked ? 'suspended' : 'active' } },
    );

    // THE GAP THIS WHOLE ROUTE EXISTS TO CLOSE. Two different things were both
    // called "blocked" and neither knew about the other:
    //
    //   * this route writes sanctions + ai_platforms, which is HOST-keyed, and is
    //     what enforces "this platform is blocked" in the extension;
    //   * content.js's enforceBlockedAgent() (browser) and the desktop enforcer's
    //     agent-scoped narrowing both poll GET /api/lifecycle/blocked-agents,
    //     which reads `blocked_agents` and matches on the agent's NAME — an
    //     individual Copilot Studio / M365 agent has no host of its own, only a
    //     name inside someone else's app, so a host-keyed block could never have
    //     stopped it at all.
    //
    // `looksLikeAgent` decides which of those two mechanisms this request is
    // actually asking for, and it now GATES ai_platforms too, not just adds
    // blocked_agents alongside it. Blocking one agent from Inventory used to
    // ALSO set every host in matched_hosts to blocked:true — for a Copilot
    // Studio agent, that list is broad Microsoft-suite hosts (teams.microsoft.com,
    // sharepoint.com, outlook.office.com, m365.cloud.microsoft, ...), so clicking
    // Block on one named agent blocked Teams, SharePoint, and Outlook for
    // everyone. Observed live. An agent-scoped decision must never fall back to
    // "block the whole app it lives in" — that's a materially bigger, unrequested
    // action, and the enforcer's own agent-scope narrowing already has its own
    // fail-closed fallback (whole-app block, but only for the process the agent
    // actually runs IN, e.g. M365Copilot.exe — never for its host list) for when
    // it can't tell which agent is open. That fallback belongs to the enforcer,
    // not to a second, broader one fired here at block-time.
    const looksLikeAgent = agentLifecycle.matchedCount > 0
      || req.body.category === 'autonomous-agent'
      || req.body.source === 'governance';

    // ENFORCE via ai_platforms — the same collection the browser extension and
    // proxy already read — but ONLY for a genuine host-keyed row (a platform or
    // an endpoint-scanned tool, never an individual agent; see the gate above).
    let matched = { matchedCount: 0, modifiedCount: 0 };
    if (!looksLikeAgent) {
      const patch = { blocked: isBlocked ? 1 : 0, updated_at: new Date() };
      if (status === 'approved') patch.governed = 1;

      const hosts = req.body.matched_hosts;

      if (Array.isArray(hosts) && hosts.length > 0) {
        // Direct: UI told us exactly which hosts to update
        matched = await db.collection('ai_platforms').updateMany(
          { host: { $in: hosts } },
          { $set: patch },
        );
      } else {
        // Fallback: try id as host, then product/vendor/host-substring matching
        matched = await db.collection('ai_platforms').updateOne({ host: id }, { $set: patch });
        if (matched.matchedCount === 0) {
          const productName = req.body.product_name || id;
          const allPlatforms = await db.collection('ai_platforms').find({}).project({ _id: 0, host: 1, product: 1, vendor: 1 }).toArray();
          const lower = productName.toLowerCase();
          // 1. Exact product match
          let matchHosts = allPlatforms.filter(p => p.product?.toLowerCase() === lower).map(p => p.host);
          // 2. Partial product match (e.g. "Gemini" → "Google Gemini")
          if (!matchHosts.length) matchHosts = allPlatforms.filter(p => {
            const pl = (p.product || '').toLowerCase();
            return (pl.includes(lower) || lower.includes(pl)) && !pl.includes(' in ');
          }).map(p => p.host);
          // 3. Vendor match (e.g. "Claude" → vendor "Anthropic" → claude.ai)
          if (!matchHosts.length) matchHosts = allPlatforms.filter(p =>
            p.vendor?.toLowerCase() === lower
          ).map(p => p.host);
          // 4. Host substring (e.g. "Claude" → host contains "claude")
          if (!matchHosts.length) matchHosts = allPlatforms.filter(p =>
            p.host?.toLowerCase().includes(lower)
          ).map(p => p.host);
          if (matchHosts.length) {
            matched = await db.collection('ai_platforms').updateMany(
              { host: { $in: matchHosts } }, { $set: patch },
            );
          }
        }
      }
    }

    // ── The Microsoft 365 Copilot product toggle covers its web surfaces ───────
    //
    // The M365 Copilot product is consumed across a whole set of Microsoft hosts
    // (Teams, Outlook, SharePoint, office.com, cloud.microsoft) and has no single
    // host of its own, so a toggle that only patched hosts already sitting in
    // ai_platforms enforced on whichever subset happened to be seeded. The curated
    // list in lib/ai-surfaces.js is the product's definition of coverage — static
    // and reviewed, NOT derived from any discovered agent's matched_hosts, which is
    // the over-blocking bug described above.
    //
    // Scoped to this ONE product identity and nothing else: `!looksLikeAgent` keeps
    // a named agent inside M365 Copilot on the narrow agent mechanism, and the
    // product test is an exact name match, never a substring.
    //
    // `product_name` is what Inventory sends for every row; the ai_platforms
    // lookup is only for a caller that knows the host but not the product.
    let productIdentity = String(req.body.product_name || '').trim();
    if (!productIdentity && !looksLikeAgent) {
      const hostRow = await db.collection('ai_platforms').findOne({ host: id });
      productIdentity = hostRow?.product || id;
    }

    let workspaceHostsEnforced = false;
    if (!looksLikeAgent && isMicrosoftWorkspaceCopilotProduct(productIdentity)) {
      // The cascade itself is SHARED — see applyMicrosoftWorkspaceCopilotCascade's
      // own comment for why: PATCH /api/v1/ai-platforms/:host (the host-keyed
      // catalog page) can toggle this exact product too, and a cascade that only
      // fired from this route would leave that OTHER admin surface toggling just
      // one host at a time with no way to reach the other nine.
      await applyMicrosoftWorkspaceCopilotCascade(db, isBlocked);
      workspaceHostsEnforced = true;
    }

    // Strategy 4: MIRROR AN AGENT BLOCK INTO `blocked_agents`. Written to match
    // POST /api/lifecycle/block exactly, field for field, so the two paths
    // produce indistinguishable rows and /unblock still works on either.
    // Unblocking sets blocked:false rather than deleting, mirroring /unblock and
    // keeping the audit trail.
    let agentEnforced = false;
    let enforcementReason = null;
    if (looksLikeAgent) {
      agentEnforced = true;
      const agentName = req.body.product_name || id;
      if (isBlocked) {
        // DERIVE THE PLATFORM THE CALLER DID NOT SEND. The dashboard's PUT carries
        // no `platform`, and a row stored with platform:null is inert on both
        // surfaces — the enforcer drops it at parse time and the extension cannot
        // map it to a host, so the agent showed "Blocked" and kept working. The
        // value comes off the same discovered_agents document this request already
        // matched (agentMatch), never guessed. See lib/agent-platform.js.
        const platform = normalizePlatform(req.body.platform)
          ?? await derivePlatform(db, agentMatch);
        // Still written either way — refusing the write would lose a block an
        // admin deliberately applied, which is the worse failure here. What must
        // not happen is reporting it as enforced; GET /api/lifecycle/blocked-agents
        // marks the row `unenforceable`/`unenforceable_reason` for the same reason,
        // via the same function, so this path and that one never disagree.
        //
        // THREE values, all handled identically and none of them a hard failure —
        // see ../lib/agent-platforms.js for the shared definition:
        //   no_platform            nothing to key on.
        //   unknown_platform       a platform is set, no surface knows it.
        //   product_level_platform the platform names a PRODUCT (m365_copilot,
        //                          teams_desktop), which IS blocked by the host
        //                          cascade above — but not by this name-matched
        //                          row, so this row alone enforces nothing.
        // All three are reported, never refused, and never change what is stored.
        const platformEnforcementReason = unenforceableReason(platform);
        if (platformEnforcementReason) {
          agentEnforced = false;
          enforcementReason = platformEnforcementReason;
        }
        await db.collection('blocked_agents').updateOne(
          { agent_id: id },
          { $set: {
            agent_id: id,
            agent_name: agentName,
            platform,
            reason: 'Blocked by admin from AI Systems',
            oauth_key_id: null,
            // Unconditionally 'agent' on THIS path, and only on this path. By
            // construction of the looksLikeAgent guard above, everything reaching
            // here IS an individual agent — a named agent inside someone else's
            // app, with no host of its own — so "block the whole app it lives in"
            // was never what the admin asked for. Whether the narrowing can
            // actually be applied is the enforcer's call (it falls back to the
            // whole-app block when it cannot tell which agent is open); the row's
            // job is to state the intent. Plain platform blocks are handled
            // entirely by the ai_platforms path above and never get here.
            agent_scope: 'agent',
            blocked: true,
            blocked_at: new Date(),
            unblocked_at: null,
          } },
          { upsert: true },
        );
      } else {
        // Only ever relaxes an existing block; never creates a row.
        await db.collection('blocked_agents').updateOne(
          { agent_id: id },
          { $set: { blocked: false, unblocked_at: new Date() } },
        );
      }
    }

    // Fire webhook
    const productName = req.body.product_name || id;
    fireWebhooks(db, isBlocked ? 'tool_blocked' : 'tool_approved', {
      title: (isBlocked ? 'Tool Blocked: ' : 'Tool Approved: ') + productName,
      body: productName + ' has been ' + (isBlocked ? 'blocked' : 'approved') + ' in the AI Registry.',
      severity: isBlocked ? 'high' : 'info',
      tool: productName,
      trigger: isBlocked ? 'tool_blocked' : 'tool_approved',
    });

    // `enforced` must account for BOTH enforcement paths. It previously reported
    // only whether ai_platforms hosts matched, so blocking a Copilot Studio agent
    // — which has no host of its own and is enforced by name through
    // blocked_agents — returned {"ok":true,"enforced":false}. That reads as "the
    // block did nothing", which is what sent this investigation down the wrong
    // path in the first place.
    //
    // …and it must not overstate them either: an agent row written without a
    // platform enforces on neither surface, so it reports enforced:false with a
    // `reason`, rather than the {ok:true, enforced:true} that made an inert block
    // look like a working one.
    const platformEnforced = matched.matchedCount > 0 || matched.modifiedCount > 0;
    const enforced = platformEnforced || agentEnforced || workspaceHostsEnforced;
    res.json({
      ok: true,
      enforced,
      enforced_via: [
        ...(platformEnforced ? ['platform_hosts'] : []),
        ...(workspaceHostsEnforced ? ['m365_workspace_hosts'] : []),
        ...(agentEnforced ? ['agent_blocklist'] : []),
      ],
      ...(enforcementReason ? { reason: enforcementReason } : {}),
    });
  }));
}

// Helpers

// The registry summary, counted from the SAME rows the list route serves.
//
// Shared by GET /registry/summary and by the snapshot writer, so a snapshot's
// precomputed summary is produced by exactly the code that would have counted
// the live rows — the two can never drift into disagreeing about the same
// inventory.
function summarize(rows) {
  const statusCounts = { approved: 0, restricted: 0, blocked: 0, unknown: 0 };
  const bySource = { governance_agents: 0, endpoint_tools: 0, platform_services: 0 };
  const riskCounts = { low: 0, medium: 0, high: 0, critical: 0, not_assessed: 0 };
  const SOURCE_KEY = {
    governance: 'governance_agents',
    endpoint_scan: 'endpoint_tools',
    platform_registry: 'platform_services',
  };

  let activeCount = 0;
  for (const r of rows || []) {
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    const key = SOURCE_KEY[r.source];
    if (key) bySource[key] += 1;
    riskCounts[r.risk_level || 'not_assessed'] = (riskCounts[r.risk_level || 'not_assessed'] || 0) + 1;
    if ((r.activity?.total || 0) > 0) activeCount += 1;
  }

  return {
    total_ai_systems: (rows || []).length,
    active_ai_systems: activeCount,
    by_source: bySource,
    by_status: statusCounts,
    by_risk: riskCounts,
  };
}

function mapGovPlatform(platform) {
  const map = {
    copilot_studio: 'autonomous-agent', personal_agent: 'autonomous-agent',
    power_automate: 'automation', oauth_app: 'web-service',
    teams_app: 'chat-agent', teams_chat_agent: 'chat-agent',
    sharepoint_embedded: 'embedded-agent', isv_store: 'marketplace-app',
    google_workspace: 'web-service', google_chat: 'chat-agent',
    vertex_ai: 'ml-platform', apps_script: 'automation',
    gemini_workspace: 'web-service', claude_project: 'web-service',
    aws_bedrock: 'ml-platform', aws_sagemaker: 'ml-platform',
    azure_foundry: 'ml-platform',
  };
  return map[platform] || 'unknown';
}

function mapLifecycleToStatus(lifecycle) {
  const map = {
    active: 'approved', pending_approval: 'unknown',
    due_for_renewal: 'restricted', stale: 'restricted',
    suspended: 'blocked', retired: 'blocked',
  };
  return map[lifecycle] || 'unknown';
}

function extractDataAccess(finding) {
  const access = [];
  if (finding.type === 'mcp_server' && finding.targets) {
    for (const t of finding.targets) {
      access.push(t.kind + ': ' + (t.path || t.url || t.database || 'unknown'));
    }
  }
  if (finding.type === 'mcp_server' && finding.serverKind) {
    access.push(finding.serverKind);
  }
  return access;
}
