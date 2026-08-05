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

  app.get('/api/v1/registry', a(async (req, res) => {
    const { platform, status, risk_level, category, search } = req.query;

    // 1. Governance discovered agents
    const govAgents = await db.collection('discovered_agents')
      .find({}).project({ _id: 0 }).toArray().catch(() => []);

    // 2. Endpoint scan findings (deduplicated by tool_key)
    const findings = await db.collection('findings')
      .find({}).project({ _id: 0 }).toArray().catch(() => []);

    // 3. Sanctions (approval status)
    const sanctions = await db.collection('sanctions')
      .find({}).project({ _id: 0 }).toArray().catch(() => []);
    const sanctionMap = new Map(sanctions.map(s => [s.tool_key, s]));

    // 4. DLP usage stats per service
    const dlpStats = await db.collection('dlp_events').aggregate([
      { $group: {
        _id: '$ai_service',
        event_count: { $sum: 1 },
        last_event: { $max: '$occurred_at' },
        block_count: { $sum: { $cond: [{ $eq: ['$event_kind', 'enforcement_block'] }, 1, 0] } },
      }},
    ]).toArray().catch(() => []);
    const dlpMap = new Map(dlpStats.map(d => [d._id, d]));

    // 5. AI Platforms
    const platforms = await db.collection('ai_platforms')
      .find({}).project({ _id: 0 }).toArray().catch(() => []);
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
    function getProductStatus(productName) {
      if (!productName) return 'unknown';
      const lower = productName.toLowerCase();
      // Exact match first
      let hosts = productHosts.get(lower);
      // Partial match: "Gemini" should find "Google Gemini"
      if (!hosts || hosts.length === 0) {
        for (const [key, val] of productHosts) {
          if (key.includes(lower) || lower.includes(key)) {
            if (!key.includes(' in ')) { hosts = val; break; }
          }
        }
      }
      if (!hosts || hosts.length === 0) return 'unknown';
      const allBlocked = hosts.every(h => h.blocked);
      if (allBlocked) return 'blocked';
      const allUnblocked = hosts.every(h => !h.blocked);
      if (allUnblocked) return 'approved';
      // Mixed: some blocked, some not → still blocked (majority rule)
      return 'blocked';
    }

    // Build unified registry
    const registry = new Map(); // key → entry

    // Source A: Governance agents (richest data)
    for (const agent of govAgents) {
      const key = agent.botId || agent.appId || agent.id || agent.name;
      if (!key) continue;
      const sanction = sanctionMap.get(key);
      registry.set('gov:' + key, {
        id: agent.id || key,
        name: agent.name || 'Unnamed Agent',
        description: agent.description || null,
        platform: agent.platform || 'unknown',
        category: mapGovPlatform(agent.platform),
        vendor: agent.vendor || null,
        owner: agent.owner?.displayName || null,
        owner_email: agent.owner?.userPrincipalName || null,
        owner_active: agent.owner?.accountEnabled ?? true,
        is_orphaned: agent.isOrphaned || false,
        risk_score: agent.risk?.score ?? null,
        risk_level: agent.risk?.level || null,
        risk_factors: agent.risk?.factors || [],
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
      const resolvedStatus = getProductStatus(name) !== 'unknown'
        ? getProductStatus(name)
        : (sanction?.status || 'unknown');

      registry.set('scan:' + tk, {
        id: tk,
        name,
        description: null,
        platform: sample.type === 'ide_extension' ? sample.ide : (sample.platform || 'endpoint'),
        category: CATEGORY_MAP[sample.type] || 'unknown',
        vendor: sample.vendor || null,
        owner: null,
        owner_email: null,
        owner_active: true,
        is_orphaned: false,
        risk_score: sample.risk_score ?? null,
        risk_level: sample.risk_score != null ? (sample.risk_score >= 70 ? 'high' : sample.risk_score >= 40 ? 'medium' : 'low') : null,
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
      registry.set(key, {
        id: plat.host,
        name: plat.product || plat.host,
        description: null,
        platform: 'web',
        category: plat.category || 'web-service',
        vendor: plat.vendor || null,
        owner: null,
        owner_email: null,
        owner_active: true,
        is_orphaned: false,
        risk_score: null,
        risk_level: null,
        risk_factors: [],
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

    // Convert to array and apply filters
    let results = [...registry.values()];

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

    // Sort: highest risk first, then by name
    results.sort((a, b) => {
      const ra = a.risk_score ?? -1, rb = b.risk_score ?? -1;
      if (rb !== ra) return rb - ra;
      return (a.name || '').localeCompare(b.name || '');
    });

    res.json(results);
  }));

  // ── Registry summary stats ──

  app.get('/api/v1/registry/summary', a(async (req, res) => {
    // Quick counts from each source
    const govCount = await db.collection('discovered_agents').countDocuments().catch(() => 0);
    const findingsToolKeys = await db.collection('findings').distinct('tool_key').catch(() => []);
    const platformCount = await db.collection('ai_platforms').countDocuments({ $or: [{ governed: true }, { blocked: true }] }).catch(() => 0);
    const sanctions = await db.collection('sanctions').find({}).project({ _id: 0, status: 1 }).toArray().catch(() => []);

    const statusCounts = { approved: 0, restricted: 0, blocked: 0, unknown: 0 };
    for (const s of sanctions) statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;

    res.json({
      total_ai_systems: govCount + findingsToolKeys.length + platformCount,
      by_source: {
        governance_agents: govCount,
        endpoint_tools: findingsToolKeys.length,
        platform_services: platformCount,
      },
      by_status: statusCounts,
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

    // Update sanctions collection (status tracking)
    await db.collection('sanctions').updateOne(
      { tool_key: id },
      { $set: { tool_key: id, status, updated_at: new Date() } },
      { upsert: true },
    );

    // ENFORCE via ai_platforms — the same collection the browser extension
    // and proxy already read. PATCH /api/v1/ai-platforms/:host is the existing
    // endpoint; we update the DB directly here (same logic) to avoid a self-call.
    const patch = { blocked: isBlocked ? 1 : 0, updated_at: new Date() };
    if (status === 'approved') patch.governed = 1;

    // Strategy 1: id is a host (e.g. "chatgpt.com")
    let matched = await db.collection('ai_platforms').updateOne({ host: id }, { $set: patch });

    // Strategy 2: look up the registry entry's actual product name, then match ai_platforms
    if (matched.matchedCount === 0) {
      // The id could be a tool_key (openai:chatgpt), a UUID, or a product name.
      // We need to find the PRODUCT NAME this registry entry represents, then
      // find all ai_platforms with that product.

      // First: get the product name from the request body or look it up
      const productName = req.body.product_name; // UI can send this
      const candidates = [];
      if (productName) candidates.push(productName);
      candidates.push(id); // raw id
      if (id.includes(':')) {
        candidates.push(id.split(':').pop()); // "chatgpt" from "openai:chatgpt"
        candidates.push(id.split(':')[0]);    // "openai" from "openai:chatgpt"
      }

      // Dynamic matching — find the ai_platforms product that corresponds
      // to this registry entry, then update ALL hosts with that product.
      // No hardcoded maps — reads product names directly from ai_platforms.
      const allPlatforms = await db.collection('ai_platforms').find({}).project({ _id: 0, product: 1 }).toArray();
      const allProducts = [...new Set(allPlatforms.map(p => p.product).filter(Boolean))];

      // Find the matching product name
      let matchedProduct = null;
      for (const name of candidates) {
        const lower = name.toLowerCase();
        // Exact match first
        matchedProduct = allProducts.find(p => p.toLowerCase() === lower);
        if (matchedProduct) break;
        // Partial: "Gemini" matches "Google Gemini" but NOT "Gemini in Gmail"
        matchedProduct = allProducts.find(p => {
          const pl = p.toLowerCase();
          return (pl.includes(lower) || lower.includes(pl)) && !pl.includes(' in ');
        });
        if (matchedProduct) break;
      }

      if (matchedProduct) {
        matched = await db.collection('ai_platforms').updateMany(
          { product: matchedProduct },
          { $set: patch },
        );
      }
    }

    // Strategy 3: for governance agents — update lifecycle
    await db.collection('discovered_agents').updateMany(
      { $or: [{ id: id }, { botId: id }, { appId: id }, { name: id }] },
      { $set: { lifecycleStatus: isBlocked ? 'suspended' : 'active' } },
    );

    // Fire webhook
    const productName = req.body.product_name || id;
    fireWebhooks(db, isBlocked ? 'tool_blocked' : 'tool_approved', {
      title: (isBlocked ? 'Tool Blocked: ' : 'Tool Approved: ') + productName,
      body: productName + ' has been ' + (isBlocked ? 'blocked' : 'approved') + ' in the AI Registry.',
      severity: isBlocked ? 'high' : 'info',
      tool: productName,
      trigger: isBlocked ? 'tool_blocked' : 'tool_approved',
    });

    res.json({ ok: true, enforced: matched.matchedCount > 0 || matched.modifiedCount > 0 });
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
