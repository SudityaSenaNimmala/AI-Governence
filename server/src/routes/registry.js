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
import { fireWebhooks } from './webhooks.js';
import { scoreToLevel, normalizeStoredRisk } from '../lib/risk-scale.js';
import { assessToolRisk } from '../lib/tool-risk.js';
import { readFileSync } from 'node:fs';
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
  const SNAPSHOT_PATH = join(__dirname, '..', '..', 'data', 'registry-snapshot.json');
  const BUILD_BUDGET_MS = Number(process.env.REGISTRY_BUILD_BUDGET_MS || 15000);
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
  // query on every tab switch or page refresh within 30 seconds.
  let _liveCache = null;
  let _liveCacheAt = 0;
  const LIVE_CACHE_TTL_MS = 30_000;

  function loadSnapshot() {
    if (_snapshot) return _snapshot;
    try {
      _snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    } catch {
      _snapshot = null;   // absent is fine — callers fall through to their own error
    }
    return _snapshot;
  }

  // Resolves to null rather than rejecting, so callers branch on the value instead
  // of wrapping every call site in try/catch.
  function buildRegistryWithBudget() {
    // Serve from short-lived cache if fresh
    if (_liveCache && Date.now() - _liveCacheAt < LIVE_CACHE_TTL_MS) return Promise.resolve(_liveCache);
    const haveSnapshot = Boolean(loadSnapshot());
    if (haveSnapshot && (SNAPSHOT_FIRST || Date.now() < _unhealthyUntil)) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const fail = (why) => {
        settled = true;
        // Only trip the breaker when there is a snapshot to fall back to. Without
        // one, tripping would turn a slow page into a 503 and lose the data that a
        // patient caller would still have received.
        if (haveSnapshot) _unhealthyUntil = Date.now() + UNHEALTHY_FOR_MS;
        console.warn(`[registry] ${why} — serving snapshot, skipping live build for ${UNHEALTHY_FOR_MS / 1000}s`);
        resolve(null);
      };
      const timer = setTimeout(() => { if (!settled) fail(`live build exceeded ${BUILD_BUDGET_MS}ms`); }, BUILD_BUDGET_MS);
      buildRegistry().then((r) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        _unhealthyUntil = 0;   // healthy again
        _liveCache = r; _liveCacheAt = Date.now();
        resolve(r);
      }).catch((e) => {
        if (settled) return;
        clearTimeout(timer);
        fail(`live build failed: ${e?.message || e}`);
      });
    });
  }

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

    const live = await buildRegistryWithBudget();
    let stale = false;
    let results = live;
    if (!results) {
      const snap = loadSnapshot();
      if (!snap) {
        return res.status(503).json({
          error: 'Registry is temporarily unavailable',
          detail: 'The live build timed out and no snapshot is present on this server.',
        });
      }
      results = snap.systems;
      stale = true;
      // Filters below still apply to snapshot rows — the shape is identical, so the
      // page behaves the same whichever source it got.
    }

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

    // Header, not a body field: this route returns a bare array and the UI iterates
    // it directly, so wrapping it in an object to carry a flag would break every
    // caller. A header says which source answered without changing the contract.
    if (stale) {
      res.setHeader('X-Registry-Stale', '1');
      res.setHeader('X-Registry-Captured-At', loadSnapshot()?.captured_at || '');
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
    const live = await buildRegistryWithBudget();
    if (!live) {
      // The snapshot carries its own precomputed summary, derived from the very rows
      // in the same file — so the fallback keeps the "cannot disagree" property that
      // the comment above is about.
      const snap = loadSnapshot();
      if (!snap) {
        return res.status(503).json({
          error: 'Registry summary is temporarily unavailable',
          detail: 'The live build timed out and no snapshot is present on this server.',
        });
      }
      res.setHeader('X-Registry-Stale', '1');
      res.setHeader('X-Registry-Captured-At', snap.captured_at || '');
      return res.json(snap.summary);
    }
    const rows = live;

    const statusCounts = { approved: 0, restricted: 0, blocked: 0, unknown: 0 };
    const bySource = { governance_agents: 0, endpoint_tools: 0, platform_services: 0 };
    const riskCounts = { low: 0, medium: 0, high: 0, critical: 0, not_assessed: 0 };
    const SOURCE_KEY = {
      governance: 'governance_agents',
      endpoint_scan: 'endpoint_tools',
      platform_registry: 'platform_services',
    };

    let activeCount = 0;
    for (const r of rows) {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      const key = SOURCE_KEY[r.source];
      if (key) bySource[key] += 1;
      riskCounts[r.risk_level || 'not_assessed'] = (riskCounts[r.risk_level || 'not_assessed'] || 0) + 1;
      if ((r.activity?.total || 0) > 0) activeCount += 1;
    }

    res.json({
      total_ai_systems: rows.length,
      active_ai_systems: activeCount,
      by_source: bySource,
      by_status: statusCounts,
      by_risk: riskCounts,
    });
  }));

  // ── Update status (allowed / blocked) — uses existing ai-platforms endpoint for enforcement ──

  app.put('/api/v1/registry/:id/status', a(async (req, res) => {
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
    _liveCache = null;
    _liveCacheAt = 0;

    // Update sanctions collection (status tracking)
    await db.collection('sanctions').updateOne(
      { tool_key: id },
      { $set: { tool_key: id, status, updated_at: new Date() } },
      { upsert: true },
    );

    // ENFORCE via ai_platforms — the same collection the browser extension
    // and proxy already read. The UI sends matched_hosts (resolved during
    // buildRegistry) so we update the exact hosts — no fuzzy matching needed.
    const patch = { blocked: isBlocked ? 1 : 0, updated_at: new Date() };
    if (status === 'approved') patch.governed = 1;

    let matched = { matchedCount: 0, modifiedCount: 0 };
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

    // Strategy 3: for governance agents — update lifecycle
    const agentLifecycle = await db.collection('discovered_agents').updateMany(
      { $or: [{ id: id }, { botId: id }, { appId: id }, { name: id }] },
      { $set: { lifecycleStatus: isBlocked ? 'suspended' : 'active' } },
    );

    // Strategy 4: MIRROR AN AGENT BLOCK INTO `blocked_agents`.
    //
    // THE GAP THIS CLOSES. Two different things were both called "blocked" and
    // neither knew about the other:
    //
    //   * this route writes sanctions + ai_platforms, which is HOST-keyed, and is
    //     what enforces "this platform is blocked" in the extension;
    //   * content.js's enforceBlockedAgent() polls
    //     GET /api/lifecycle/blocked-agents, which reads `blocked_agents` and
    //     matches on the agent NAME shown in the page header. Only
    //     POST /api/lifecycle/block ever wrote to it.
    //
    // So blocking a Copilot Studio agent from Inventory → AI Systems marked the
    // row Blocked, suspended its lifecycle, and did nothing at runtime: the agent
    // stayed fully usable in m365.cloud.microsoft. Worse, a host-keyed block could
    // never have stopped it — an agent inside Copilot Studio has no host of its
    // own, only a name inside someone else's app.
    //
    // Written to match POST /api/lifecycle/block exactly, field for field, so the
    // two paths produce indistinguishable rows and /unblock still works on either.
    // Unblocking sets blocked:false rather than deleting, mirroring /unblock and
    // keeping the audit trail.
    const looksLikeAgent = agentLifecycle.matchedCount > 0
      || req.body.category === 'autonomous-agent'
      || req.body.source === 'governance';

    let agentEnforced = false;
    if (looksLikeAgent) {
      agentEnforced = true;
      const agentName = req.body.product_name || id;
      if (isBlocked) {
        await db.collection('blocked_agents').updateOne(
          { agent_id: id },
          { $set: {
            agent_id: id,
            agent_name: agentName,
            platform: req.body.platform || null,
            reason: 'Blocked by admin from AI Systems',
            oauth_key_id: null,
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
    const platformEnforced = matched.matchedCount > 0 || matched.modifiedCount > 0;
    res.json({
      ok: true,
      enforced: platformEnforced || agentEnforced,
      enforced_via: [
        ...(platformEnforced ? ['platform_hosts'] : []),
        ...(agentEnforced ? ['agent_blocklist'] : []),
      ],
    });
  }));
}

// Helpers

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
