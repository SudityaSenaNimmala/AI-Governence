/**
 * Discovery Service — Agent Inventory & Discovery (PARALLEL + TIMEOUTS)
 * All discovery sources run in parallel with per-task timeouts.
 */

import { GraphClient, GraphError } from "./graphClient.js";
import { DataverseClient, DataverseError, type BotSession } from "./dataverseClient.js";
import { PowerPlatformClient, PowerPlatformError, CONNECTOR_RISK_MAP } from "./powerPlatformClient.js";
import { AuditClient, AuditError } from "./auditClient.js";
import { AzureFoundryClient, AzureFoundryError } from "./azureFoundryClient.js";
import { GoogleWorkspaceClient, GoogleWorkspaceError, isSensitiveGoogleScope, type GoogleServiceAccountKey } from "./googleWorkspaceClient.js";
import { assessRisk } from "./riskService.js";
import { classifyServicePrincipals } from "./classificationService.js";
import { aiSignatures } from "../config/aiSignatures.js";
import { ENDPOINTS } from "../config/graphConfig.js";
import type {
  GraphUser, GraphOrganization, GraphServicePrincipal,
  GraphOAuth2PermissionGrant, GraphPagedResponse, DataverseBot,
} from "../types/graph.js";
import type {
  DiscoveredAgent, DiscoveryResult, AgentActivity,
  LifecycleStatus, AgentPlatform, AgentConnector, AgentCategory,
} from "../types/agent.js";

export type DiscoveryProgress = { step: string; current: number; total: number };

export interface DiscoveryTokens {
  graph: string;
  dataverse?: string;
  powerPlatform?: string;
  audit?: string;
  azure?: string;
  cognitiveServices?: string;
  dataverseEnvUrl?: string;
  tenantId?: string;
  googleServiceAccountKey?: string;
  googleAdminEmail?: string;
  googleProjectId?: string;
}

// Timeout wrapper — kills any task that takes too long
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

type TaskResult = { agents: DiscoveredAgent[]; warnings: string[] };

const TASK_TIMEOUT = 30_000; // 30 seconds per task

/**
 * Classify a Dataverse bot as a regular Copilot Studio bot, personal agent,
 * or SharePoint agent based on its template, configuration, and name fields.
 */
function classifyDataverseBot(bot: DataverseBot): { platform: AgentPlatform; category: "custom-agent" | "generative-ai"; label: string } {
  const tmpl = (bot.template || "").toLowerCase();
  const config = (bot.configuration || "").toLowerCase();
  const name = (bot.name || "").toLowerCase();
  const desc = (bot.description || "").toLowerCase();

  const isSharePoint =
    config.includes("sharepoint") || name.includes("sharepoint") ||
    desc.includes("sharepoint");

  const isDeclarativeCopilot =
    tmpl.includes("dcbot") || tmpl.includes("declarative") ||
    config.includes("declarativecopilot") || config.includes("declarativeagent") ||
    config.includes("personal") || config.includes('"type":"declarative') ||
    bot.accesscontrolpolicy === "1";

  if (isSharePoint) {
    return { platform: "sharepoint_embedded", category: "custom-agent", label: "SharePoint" };
  }
  if (isDeclarativeCopilot) {
    return { platform: "personal_agent", category: "generative-ai", label: "Personal" };
  }
  return { platform: "copilot_studio", category: "custom-agent", label: "Copilot Studio" };
}

export async function runDiscovery(
  tokens: DiscoveryTokens,
  onProgress?: (progress: DiscoveryProgress) => void
): Promise<DiscoveryResult> {
  const graphClient = new GraphClient(tokens.graph);
  const startTime = Date.now();
  const report = (step: string) => onProgress?.({ step, current: 0, total: 0 });

  const agents: DiscoveredAgent[] = [];
  const warnings: string[] = [];
  let totalServicePrincipals = 0;
  let environments: string[] = [];

  // ════════════════════════════════════════════════
  // PHASE 1: Tenant + Users (needed by other steps)
  // ════════════════════════════════════════════════
  report("Fetching tenant info & users...");
  const [orgData, users] = await Promise.all([
    graphClient.get<GraphPagedResponse<GraphOrganization>>(ENDPOINTS.organization),
    graphClient.getAllPages<GraphUser>(ENDPOINTS.users, {
      $select: "id,displayName,userPrincipalName,mail,accountEnabled",
      $top: "999",
    }).catch(() => [] as GraphUser[]),
  ]);

  const org = orgData.value[0];
  const defaultDomain = org?.verifiedDomains?.find(d => d.isDefault)?.name || "Unknown";
  const hasE5 = org?.assignedPlans?.some(p => p.service === "exchange" && p.capabilityStatus === "Enabled");
  const userMap = new Map(users.map(u => [u.id, u]));
  console.log(`[Phase 1] Tenant: ${defaultDomain}, Users: ${users.length} — ${Date.now() - startTime}ms`);

  // ════════════════════════════════════════════════
  // PHASE 2: ALL discovery tasks in PARALLEL (with timeouts)
  // ════════════════════════════════════════════════
  report("Discovering agents across all platforms...");

  // ── Task A: Copilot Studio (Dataverse) ──────────
  const taskA = (tokens.dataverse && tokens.dataverseEnvUrl) ? withTimeout((async (): Promise<TaskResult> => {
    const result: TaskResult = { agents: [], warnings: [] };
    try {
      const dvClient = new DataverseClient(tokens.dataverse!, tokens.dataverseEnvUrl!);
      const bots = await dvClient.discoverBots();
      console.log(`[DV] Bots found: ${bots.length}`);

      for (const bot of bots) {
        const classification = classifyDataverseBot(bot);
        let owner: DiscoveredAgent["owner"] = undefined;
        let isOrphaned = false;
        const creatorId = bot._createdby_value;
        if (creatorId) {
          const u = userMap.get(creatorId);
          if (u) { owner = { id: u.id, displayName: u.displayName, userPrincipalName: u.userPrincipalName, accountEnabled: u.accountEnabled ?? true }; isOrphaned = !u.accountEnabled; }
          else { try { const dvu = await dvClient.resolveUser(creatorId); if (dvu?.azureactivedirectoryobjectid) { const eu = userMap.get(dvu.azureactivedirectoryobjectid); if (eu) { owner = { id: eu.id, displayName: eu.displayName, userPrincipalName: eu.userPrincipalName, accountEnabled: eu.accountEnabled ?? true }; isOrphaned = !eu.accountEnabled; } else { owner = { id: dvu.azureactivedirectoryobjectid, displayName: dvu.fullname, userPrincipalName: dvu.internalemailaddress, accountEnabled: true }; } } } catch {} }
        }
        if (!owner) isOrphaned = true;

        const [llmInfo, botConfig, topicCount, sessions, connectorInfo] = await Promise.all([
          dvClient.getBotLLMInfo(bot.botid), dvClient.getBotConfiguration(bot.botid),
          dvClient.getBotTopicCount(bot.botid), dvClient.getBotSessions(bot.botid, 50),
          dvClient.getBotConnectorScopes(bot.botid),
        ]);

        const now = Date.now();
        const sessionUsers = new Map<string, { count: number; last: string }>();
        let last7 = 0, last30 = 0, lastTime = "";
        for (const s of sessions) {
          const t = new Date(s.startTime).getTime();
          if (t > now - 7 * 86400000) last7++;
          if (t > now - 30 * 86400000) last30++;
          if (!lastTime || s.startTime > lastTime) lastTime = s.startTime;
          const ex = sessionUsers.get(s.userId);
          if (ex) { ex.count++; if (s.startTime > ex.last) ex.last = s.startTime; }
          else sessionUsers.set(s.userId, { count: 1, last: s.startTime });
        }

        const botDescription = bot.description
          || `${classification.label} agent in ${tokens.dataverseEnvUrl}`;

        result.agents.push({
          id: bot.botid, botId: bot.botid, name: bot.name,
          description: botDescription,
          vendor: "Microsoft", category: classification.category, platform: classification.platform,
          discoverySource: "dataverse", firstSeen: bot.createdon, lastModified: bot.modifiedon,
          publishedStatus: bot.statecode === 0 ? "active" : "inactive",
          owner, isOrphaned,
          connectors: connectorInfo.connectors.map(c => ({ name: c.name, type: c.name })),
          permissions: connectorInfo.allScopes,
          lifecycleStatus: bot.statecode === 1 ? "suspended" : "active",
          llmModel: llmInfo?.modelDisplayName, llmModelHint: llmInfo?.modelNameHint,
          aiSettings: { generativeActionsEnabled: botConfig?.settings?.GenerativeActionsEnabled, useModelKnowledge: botConfig?.aISettings?.useModelKnowledge, isFileAnalysisEnabled: botConfig?.aISettings?.isFileAnalysisEnabled, webBrowsingEnabled: llmInfo?.webBrowsingEnabled },
          topicCount,
          risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
          activity: { totalInvocations: sessions.length, invocationsLast7Days: last7, invocationsLast30Days: last30, invocationsLast90Days: sessions.length, lastActiveTimestamp: lastTime || undefined, uniqueUsers: sessionUsers.size, userBreakdown: Array.from(sessionUsers.entries()).map(([uid, d]) => { const u = userMap.get(uid); return { userPrincipalName: u?.userPrincipalName || uid, displayName: u?.displayName || uid, invocationCount: d.count, lastActivity: d.last }; }) },
        });
      }
    } catch (e) {
      console.warn("[DV] Bots discovery error:", e instanceof Error ? e.message : String(e));
      result.warnings.push(`Dataverse: ${e instanceof Error ? e.message : String(e)}`);
    }

    // If bots were fetched with minimal fields, use discoverDeclarativeCopilots()
    // to reclassify personal agents and SharePoint agents
    if (result.agents.length > 0 && result.agents.every(a => a.platform === "copilot_studio")) {
      try {
        const dvClient3 = new DataverseClient(tokens.dataverse!, tokens.dataverseEnvUrl!);
        const declBots = await dvClient3.discoverDeclarativeCopilots();
        const declBotMap = new Map(declBots.map(b => [b.botid, b]));
        let reclassified = 0;

        for (const agent of result.agents) {
          const declBot = declBotMap.get(agent.botId || agent.id);
          if (!declBot) continue;
          const reclassification = classifyDataverseBot(declBot as any);
          if (reclassification.platform !== "copilot_studio") {
            agent.platform = reclassification.platform;
            agent.category = reclassification.category;
            reclassified++;
          }
        }
        if (reclassified > 0) console.log(`[DV] Reclassified ${reclassified} bots after declarative copilot scan`);
      } catch (e) {
        console.warn("[DV] Declarative copilot reclassification failed:", e instanceof Error ? e.message : "");
      }
    }

    {
      const csCount = result.agents.filter(a => a.platform === "copilot_studio").length;
      const spCount = result.agents.filter(a => a.platform === "sharepoint_embedded").length;
      const paCount = result.agents.filter(a => a.platform === "personal_agent").length;
      console.log(`[DV] Classification: ${csCount} Copilot Studio, ${paCount} personal, ${spCount} SharePoint`);
    }

    // Look for agents in botcomponents that have parent bots not in the bots table (draft/unpublished agents)
    try {
      const dvClient4 = new DataverseClient(tokens.dataverse!, tokens.dataverseEnvUrl!);
      const existingBotIds4 = new Set(result.agents.map(a => a.botId || a.id));
      const components = await dvClient4.discoverBotComponents();
      const missingParentIds = new Set<string>();
      for (const c of components) {
        if (c._parentbotid_value && !existingBotIds4.has(c._parentbotid_value)) {
          missingParentIds.add(c._parentbotid_value);
        }
      }
      if (missingParentIds.size > 0) {
        console.log(`[DV] Found ${missingParentIds.size} bot(s) in botcomponents not in bots table, fetching individually...`);
        for (const botId of missingParentIds) {
          try {
            const bot = await dvClient4.getBot(botId);
            if (bot && bot.botid) {
              const classification = classifyDataverseBot(bot);
              result.agents.push({
                id: bot.botid, botId: bot.botid, name: bot.name || "Unnamed Agent",
                description: bot.description || `${classification.label} agent (draft/unpublished)`,
                vendor: "Microsoft", category: classification.category, platform: classification.platform,
                discoverySource: "dataverse_component", firstSeen: bot.createdon, lastModified: bot.modifiedon,
                publishedStatus: bot.statecode === 0 ? "active" : "inactive",
                isOrphaned: false, connectors: [], permissions: [],
                lifecycleStatus: bot.statecode === 1 ? "suspended" : "active",
                risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
                activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
              });
              existingBotIds4.add(bot.botid);
              console.log(`[DV] Recovered agent: "${bot.name}" (state=${bot.statecode}) via botcomponents`);
            }
          } catch {
            console.warn(`[DV] Could not fetch bot ${botId} individually`);
          }
        }
      }
    } catch (e) {
      console.warn("[DV] Bot components scan for missing bots failed:", e instanceof Error ? e.message : e);
    }

    // Look for additional agents in msdyn tables that might not be in the bots table
    try {
      const dvClient2 = new DataverseClient(tokens.dataverse!, tokens.dataverseEnvUrl!);
      const existingBotIds = new Set(result.agents.map(a => a.botId || a.id));

      const copilotAgents = await dvClient2.discoverCopilotAgents();
      for (const ca of copilotAgents) {
        const id = ca.msdyn_copilotid || `msdyn-${Math.random().toString(36).slice(2, 10)}`;
        if (existingBotIds.has(id)) continue;
        existingBotIds.add(id);

        result.agents.push({
          id, name: ca.msdyn_name || "M365 Copilot Agent",
          description: ca.msdyn_description || "Copilot agent from Dataverse",
          vendor: "Microsoft", category: "generative-ai", platform: "personal_agent",
          discoverySource: "dataverse_msdyn", firstSeen: ca.createdon || new Date().toISOString(),
          lastModified: ca.modifiedon, publishedStatus: "active", isOrphaned: false,
          connectors: [], permissions: [], lifecycleStatus: "active",
          risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
          activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
        });
      }

      if (copilotAgents.length > 0) {
        console.log(`[DV Extended] ${copilotAgents.length} additional agents from msdyn tables`);
      }
    } catch (e) {
      console.warn("[DV Extended] Error scanning msdyn tables:", e instanceof Error ? e.message : e);
    }

    return result;
  })(), 60_000, "Copilot Studio") : Promise.resolve({ agents: [], warnings: ["Dataverse not configured."] } as TaskResult);

  // ── Task B: SharePoint Agents (Graph beta) ──────
  const taskB = withTimeout((async (): Promise<TaskResult> => {
    const result: TaskResult = { agents: [], warnings: [] };
    try {
      console.log("[SharePoint] Starting site scan...");
      const sites = await graphClient.getAllPages<{ id: string; displayName: string; webUrl: string }>(
        "/v1.0/sites", { $select: "id,displayName,webUrl", $top: "10", search: "*" }, 1 // Only 1 page, max 10 sites
      );
      console.log(`[SharePoint] Found ${sites.length} sites, checking for agents...`);

      // Check only first 5 sites, with per-site timeout
      for (const site of sites.slice(0, 5)) {
        try {
          const spAgents = await withTimeout(
            graphClient.get<{ value: Array<{ id: string; displayName: string; description?: string; createdDateTime?: string }> }>(
              `/beta/sites/${site.id}/copilot/agents`
            ),
            5000, // 5s per site
            `SP-${site.displayName}`
          );
          if (spAgents.value) {
            for (const spAgent of spAgents.value) {
              result.agents.push({
                id: spAgent.id, name: spAgent.displayName || `SharePoint Agent (${site.displayName})`,
                description: spAgent.description || `Embedded in ${site.displayName}`,
                vendor: "Microsoft", category: "custom-agent", platform: "sharepoint_embedded",
                discoverySource: "graph_beta", firstSeen: spAgent.createdDateTime || new Date().toISOString(),
                publishedStatus: "active", isOrphaned: false,
                connectors: [{ name: "SharePoint", type: "SharePoint", scope: site.webUrl }],
                permissions: ["Sites.Read.All"], deployedTo: [site.webUrl], lifecycleStatus: "active",
                risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
                activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
              });
            }
          }
        } catch { /* Beta endpoint may not exist or timed out — skip site */ }
      }
      console.log(`[SharePoint] ${result.agents.length} agents found`);
    } catch (e) { result.warnings.push(`SharePoint: ${e instanceof Error ? e.message : String(e)}`); }
    return result;
  })(), TASK_TIMEOUT, "SharePoint");

  // ── Task C: Teams Apps + M365 Copilot Agents (Graph) ──────
  // Only discovers org-published/sideloaded apps (actual deployed agents).
  // ISV store apps (3000+) are marketplace catalog listings, NOT deployed agents.
  const taskC = withTimeout((async (): Promise<TaskResult> => {
    const result: TaskResult = { agents: [], warnings: [] };
    try {
      console.log("[Teams] Fetching apps from catalog...");

      // Try beta endpoint with expanded appDefinitions first (gives bot info)
      let teamsApps: Array<{
        id: string; displayName: string; distributionMethod: string; externalId?: string;
        appDefinitions?: Array<{
          id?: string; displayName?: string; description?: string; shortDescription?: string;
          publishingState?: string; bot?: { id: string }; createdBy?: any;
        }>;
      }> = [];

      try {
        teamsApps = await graphClient.getAllPages<any>(
          "/beta/appCatalogs/teamsApps",
          { $expand: "appDefinitions" }, 5
        );
      } catch {
        teamsApps = await graphClient.getAllPages<any>(ENDPOINTS.teamsApps, {}, 5);
      }

      const storeCount = teamsApps.filter(a => a.distributionMethod === "store").length;
      const customApps = teamsApps.filter(a => a.distributionMethod !== "store");
      console.log(`[Teams] Catalog: ${teamsApps.length} total (${storeCount} store — skipped, ${customApps.length} org/sideloaded — processing)`);

      // Log all org-published/sideloaded apps for diagnostics
      if (customApps.length > 0) {
        console.log(`[Teams] Org/sideloaded apps:`);
        for (const a of customApps) {
          const def = a.appDefinitions?.[0];
          console.log(`  - "${a.displayName}" [${a.distributionMethod}] bot=${!!def?.bot} desc="${(def?.shortDescription || def?.description || "").slice(0, 100)}"`);
        }
      }

      for (const app of customApps) {
        const isOrgPublished = app.distributionMethod === "organization";
        const isSideloaded = app.distributionMethod === "sideloaded";
        const appDef = app.appDefinitions?.[0];
        const hasBot = !!appDef?.bot;
        const descLC = (appDef?.description || appDef?.shortDescription || "").toLowerCase();
        const nameLC = (app.displayName || "").toLowerCase();

        const isSharePointAgent =
          nameLC.includes("sharepoint") || descLC.includes("sharepoint");

        const hasCopilotKeyword =
          nameLC.includes("copilot") || nameLC.includes("agent") ||
          nameLC.includes("assistant") || nameLC.includes("bot") ||
          descLC.includes("copilot") || descLC.includes("declarative") ||
          descLC.includes("agent") || descLC.includes("assistant");

        let platform: AgentPlatform;
        let category: AgentCategory = "custom-agent";

        if (isSharePointAgent) {
          platform = "sharepoint_embedded";
        } else if (hasBot || hasCopilotKeyword) {
          platform = "personal_agent";
          category = "generative-ai";
        } else {
          platform = "teams_app";
        }

        const description = appDef?.description || appDef?.shortDescription
          || `Teams ${isOrgPublished ? "org-published" : "sideloaded"} app`;

        result.agents.push({
          id: app.id, appId: app.externalId || app.id,
          name: app.displayName, description,
          vendor: "Microsoft", category, platform,
          discoverySource: "graph_teams_catalog", firstSeen: new Date().toISOString(),
          publishedStatus: "active", isOrphaned: false,
          connectors: [], permissions: [], deployedTo: ["Microsoft Teams"],
          lifecycleStatus: "active",
          risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
          activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
        });
      }
      const teamsCount = result.agents.filter(a => a.platform === "teams_app").length;
      const personalCount = result.agents.filter(a => a.platform === "personal_agent").length;
      const spCount = result.agents.filter(a => a.platform === "sharepoint_embedded").length;
      console.log(`[Teams] Result: ${personalCount} personal agents, ${spCount} SharePoint agents, ${teamsCount} other Teams apps`);
    } catch (e) {
      console.warn("[Teams] Error:", e instanceof Error ? e.message : e);
      if (e instanceof GraphError && (e.status === 401 || e.status === 403)) {
        result.warnings.push("No access to Teams app catalog — requires AppCatalog.Read.All.");
      } else {
        result.warnings.push(`Teams: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return result;
  })(), 60_000, "Teams Apps");

  // ── Task D: Personal + Chat + SharePoint Agents (multiple approaches) ──
  const taskD = withTimeout((async (): Promise<TaskResult> => {
    const result: TaskResult = { agents: [], warnings: [] };

    // Approach 1: Try /beta/copilot/agents
    try {
      console.log("[Copilot] Trying /beta/copilot/agents...");
      const data = await graphClient.get<{ value?: Array<any> }>(ENDPOINTS.copilotAgents);
      if (data.value) {
        for (const ca of data.value) {
          const isPersonal = ca.agentType === "personal" || !ca.agentType;
          const platform: AgentPlatform = isPersonal ? "personal_agent" : "teams_chat_agent";
          const creatorUser = ca.createdBy?.user;
          const owner = creatorUser?.id ? userMap.get(creatorUser.id) : undefined;
          result.agents.push({
            id: ca.id, name: ca.displayName || `${isPersonal ? "Personal" : "Chat"} Agent`,
            description: ca.description || `M365 Copilot ${isPersonal ? "personal" : "chat"} agent`,
            vendor: "Microsoft", category: "generative-ai", platform,
            discoverySource: "graph_copilot_agents", firstSeen: ca.createdDateTime || new Date().toISOString(),
            lastModified: ca.lastModifiedDateTime, publishedStatus: "active",
            owner: owner ? { id: owner.id, displayName: owner.displayName, userPrincipalName: owner.userPrincipalName, accountEnabled: owner.accountEnabled ?? true } : undefined,
            isOrphaned: !owner && !creatorUser, connectors: [], permissions: [], lifecycleStatus: "active",
            risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
            activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
          });
        }
        console.log(`[Copilot] Found ${data.value.length} via /beta/copilot/agents`);
      }
    } catch (e) {
      console.warn("[Copilot] /beta/copilot/agents not available:", e instanceof Error ? e.message : "");
    }

    // Approach 2: Try /beta/agentIdentities (newer API for agent discovery)
    try {
      console.log("[Copilot] Trying /beta/agentIdentities...");
      const data = await graphClient.get<{ value?: Array<any> }>(ENDPOINTS.agentIdentities);
      if (data.value && data.value.length > 0) {
        for (const ai of data.value) {
          const existingIds = new Set(result.agents.map(a => a.id));
          if (existingIds.has(ai.id)) continue;
          result.agents.push({
            id: ai.id, name: ai.displayName || "M365 Agent",
            description: ai.description || `Agent identity: ${ai.agentType || "unknown type"}`,
            vendor: "Microsoft", category: "generative-ai",
            platform: ai.agentType === "sharepoint" ? "sharepoint_embedded" : "personal_agent",
            discoverySource: "graph_agent_identities", firstSeen: ai.createdDateTime || new Date().toISOString(),
            publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [], lifecycleStatus: "active",
            risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
            activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
          });
        }
        console.log(`[Copilot] Found ${data.value.length} via /beta/agentIdentities`);
      }
    } catch (e) {
      console.warn("[Copilot] /beta/agentIdentities not available:", e instanceof Error ? e.message : "");
    }

    // Approach 3: Search SharePoint for .agent files (declarative copilot manifests)
    try {
      console.log("[Copilot] Searching SharePoint for agent files...");

      const searchBody = {
        requests: [{
          entityTypes: ["driveItem"],
          query: { queryString: "filetype:agent OR filename:.agent OR filename:declarativeAgent" },
          from: 0, size: 50,
          region: "NAM",
        }]
      };

      const searchData = await graphClient.post<{ value?: Array<{ hitsContainers?: Array<{ hits?: Array<any> }> }> }>(
        "/beta/search/query", searchBody
      );

      const hits = searchData.value?.[0]?.hitsContainers?.[0]?.hits || [];
      console.log(`[Copilot] Search found ${hits.length} agent files in SharePoint/OneDrive`);

      const existingIds = new Set(result.agents.map(a => a.id));
      for (const hit of hits) {
        const resource = hit.resource;
        if (!resource) continue;
        const id = resource.id || `search-${hit.hitId}`;
        if (existingIds.has(id)) continue;
        existingIds.add(id);

        const name = (resource.name || "").replace(/\.agent$/i, "").replace(/\.json$/i, "");
        const webUrl = resource.webUrl || "";
        const isSharePoint = webUrl.includes("sharepoint.com");
        const createdBy = resource.createdBy?.user;
        const owner = createdBy?.id ? userMap.get(createdBy.id) : undefined;

        result.agents.push({
          id, name: name || "Copilot Agent",
          description: `Declarative copilot${isSharePoint ? " (SharePoint)" : ""} — ${webUrl}`,
          vendor: "Microsoft", category: "generative-ai",
          platform: isSharePoint ? "sharepoint_embedded" : "personal_agent",
          discoverySource: "graph_search_agents", firstSeen: resource.createdDateTime || new Date().toISOString(),
          lastModified: resource.lastModifiedDateTime,
          publishedStatus: "active",
          owner: owner ? { id: owner.id, displayName: owner.displayName, userPrincipalName: owner.userPrincipalName, accountEnabled: owner.accountEnabled ?? true }
            : createdBy ? { id: createdBy.id || "unknown", displayName: createdBy.displayName || "Unknown", userPrincipalName: createdBy.displayName || "unknown", accountEnabled: true } : undefined,
          isOrphaned: !owner && !createdBy, connectors: [], permissions: [],
          deployedTo: webUrl ? [webUrl] : undefined, lifecycleStatus: "active",
          risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
          activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
        });
      }
    } catch (e) {
      console.warn("[Copilot] SharePoint agent search failed:", e instanceof Error ? e.message : "");
    }

    // Approach 4: User-installed Teams apps (scan a few users for personal copilot agents)
    try {
      console.log("[Copilot] Scanning user-installed apps...");
      const existingNames = new Set(result.agents.map(a => a.name.toLowerCase()));
      const sampleUsers = users.filter(u => u.accountEnabled).slice(0, 5);
      let added = 0;

      for (const user of sampleUsers) {
        try {
          const installed = await graphClient.getAllPages<{
            id: string;
            teamsApp?: { id: string; displayName: string; distributionMethod: string; externalId?: string };
            teamsAppDefinition?: { id?: string; displayName?: string; description?: string; shortDescription?: string; bot?: { id: string }; createdBy?: any };
          }>(`/v1.0/users/${user.id}/teamwork/installedApps`, { $expand: "teamsApp,teamsAppDefinition" }, 2);

          for (const inst of installed) {
            const app = inst.teamsApp;
            const def = inst.teamsAppDefinition;
            if (!app) continue;
            if (app.distributionMethod === "store") continue;
            if (existingNames.has(app.displayName.toLowerCase())) continue;

            const nameLC = (app.displayName || "").toLowerCase();
            const descLC = (def?.description || def?.shortDescription || "").toLowerCase();
            const hasBot = !!def?.bot;
            const isSharePoint = nameLC.includes("sharepoint") || descLC.includes("sharepoint");
            const isCopilotAgent = hasBot || nameLC.includes("copilot") || nameLC.includes("agent") ||
              nameLC.includes("assistant") || descLC.includes("copilot") || descLC.includes("agent") ||
              descLC.includes("assistant") || descLC.includes("declarative");

            if (!isCopilotAgent && !isSharePoint) continue;

            const platform: AgentPlatform = isSharePoint ? "sharepoint_embedded" : "personal_agent";
            existingNames.add(app.displayName.toLowerCase());
            added++;

            result.agents.push({
              id: app.id, appId: app.externalId || app.id,
              name: app.displayName,
              description: def?.description || def?.shortDescription || `M365 Copilot ${isSharePoint ? "SharePoint" : "personal"} agent`,
              vendor: "Microsoft", category: "generative-ai", platform,
              discoverySource: "graph_user_installed_apps", firstSeen: new Date().toISOString(),
              publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [],
              deployedTo: ["M365 Copilot"], lifecycleStatus: "active",
              risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() },
              activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
            });
          }
        } catch {
          // User might not have Teams access or permission denied
        }
      }
      if (added > 0) console.log(`[Copilot] Found ${added} agents via user-installed apps`);
      else console.log("[Copilot] No additional agents found via user-installed apps");
    } catch (e) {
      console.warn("[Copilot] User-installed apps scan failed:", e instanceof Error ? e.message : "");
    }

    const personalCount = result.agents.filter(a => a.platform === "personal_agent").length;
    const spCount = result.agents.filter(a => a.platform === "sharepoint_embedded").length;
    const chatCount = result.agents.filter(a => a.platform === "teams_chat_agent").length;
    console.log(`[Copilot] Total: ${personalCount} personal, ${spCount} SharePoint, ${chatCount} chat agents`);

    return result;
  })(), 45_000, "Copilot Agents");

  // ── Task E: Azure AI Foundry ────────────────────
  // Discovers Azure AI agents, OpenAI resources + deployments, and serverless endpoints.
  // Skips generic Cognitive Services (Vision, Speech, Face, etc.) — not AI agents.
  const taskE = tokens.azure ? withTimeout((async (): Promise<TaskResult> => {
    const result: TaskResult = { agents: [], warnings: [] };
    try {
      const azureClient = new AzureFoundryClient(tokens.azure!, tokens.cognitiveServices);
      const ar = await azureClient.discoverAll();

      for (const fa of ar.foundryAgents) {
        result.agents.push({ id: fa.id, name: fa.name, description: fa.description || `Azure AI Foundry agent in ${fa.location}`, vendor: "Microsoft", category: "generative-ai", platform: "azure_foundry", discoverySource: "azure_management", firstSeen: fa.createdAt || new Date().toISOString(), lastModified: fa.updatedAt, publishedStatus: fa.provisioningState === "Succeeded" ? "active" : "draft", isOrphaned: false, connectors: [], permissions: [], environment: `${fa.subscriptionId}/${fa.resourceGroup}`, llmModel: fa.modelName, lifecycleStatus: fa.provisioningState === "Succeeded" ? "active" : "pending_approval", risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() }, activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] } });
      }
      for (const oai of ar.openAIResources) {
        result.agents.push({ id: oai.id, name: oai.name, description: `Azure OpenAI in ${oai.location}`, vendor: "Microsoft", category: "ai-platform", platform: "azure_foundry", discoverySource: "azure_management", firstSeen: oai.createdAt || new Date().toISOString(), publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [], environment: `${oai.subscriptionId}/${oai.resourceGroup}`, llmModel: oai.deployments.map(d => d.modelName).join(", ") || undefined, lifecycleStatus: "active", risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() }, activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] } });
        for (const dep of oai.deployments) {
          result.agents.push({ id: dep.id, name: `${oai.name} — ${dep.name}`, description: `${dep.modelName} deployment`, vendor: "Microsoft", category: "generative-ai", platform: "azure_foundry", discoverySource: "azure_management", firstSeen: new Date().toISOString(), publishedStatus: dep.provisioningState === "Succeeded" ? "active" : "draft", isOrphaned: false, connectors: [], permissions: [], environment: `${oai.subscriptionId}/${oai.resourceGroup}`, llmModel: dep.modelName, lifecycleStatus: dep.provisioningState === "Succeeded" ? "active" : "pending_approval", risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() }, activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] } });
        }
      }
      for (const ep of ar.serverlessEndpoints) {
        result.agents.push({ id: ep.id, name: ep.name, description: `Serverless endpoint (${ep.modelId || "unknown"})`, vendor: "Microsoft", category: "ai-platform", platform: "azure_foundry", discoverySource: "azure_management", firstSeen: new Date().toISOString(), publishedStatus: ep.state === "Online" ? "active" : "draft", isOrphaned: false, connectors: [], permissions: [], environment: `${ep.subscriptionId}/${ep.resourceGroup}`, llmModel: ep.modelId, lifecycleStatus: ep.state === "Online" ? "active" : "pending_approval", risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() }, activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] } });
      }
      for (const aiAgent of ar.aiAgents) {
        result.agents.push({ id: aiAgent.id, name: aiAgent.name || `Assistant ${aiAgent.id.slice(0, 8)}`, description: aiAgent.description || `Azure AI Agent (${aiAgent.model})`, vendor: "Microsoft", category: "generative-ai", platform: "azure_foundry", discoverySource: "azure_openai_assistants", firstSeen: new Date(aiAgent.created_at * 1000).toISOString(), publishedStatus: "active", isOrphaned: false, connectors: aiAgent.tools.map(t => ({ name: t.type, type: t.type === "code_interpreter" ? "Code" : "Function" })), permissions: [], environment: `${aiAgent.subscriptionId}/${aiAgent.resourceGroup}`, llmModel: aiAgent.model, lifecycleStatus: "active", risk: { score: 0, level: "medium", factors: [], recommendations: [], computedAt: new Date().toISOString() }, activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] } });
      }
      const skippedServices = ar.aiServices.length;
      if (skippedServices > 0) console.log(`[Azure] Skipped ${skippedServices} generic AI services (Vision, Speech, etc.)`);
      console.log(`[Azure] ${result.agents.length} resources`);
    } catch (e) { result.warnings.push(`Azure: ${e instanceof Error ? e.message : String(e)}`); }
    return result;
  })(), 45_000, "Azure") : Promise.resolve({ agents: [], warnings: [] } as TaskResult);

  // ── Task F: Connectors (Power Platform) ─────────
  const taskF = withTimeout((async () => {
    if (!tokens.powerPlatform) return { connectors: [] as AgentConnector[], envs: [] as string[], warnings: [] as string[] };
    try {
      const ppClient = new PowerPlatformClient(tokens.powerPlatform);
      const envs = await ppClient.listEnvironments();
      const allConnectors: AgentConnector[] = [];
      for (const env of envs.slice(0, 3)) {
        try {
          const conns = await ppClient.listConnections(env.name);
          for (const c of conns) {
            const apiId = c.properties?.apiId || "";
            const ct = apiId.split("/").pop() || c.type || "unknown";
            allConnectors.push({ name: c.properties?.displayName || c.name, type: CONNECTOR_RISK_MAP[ct]?.category || ct });
          }
        } catch {}
      }
      return { connectors: allConnectors, envs: envs.map(e => e.name), warnings: [] as string[] };
    } catch (e) { return { connectors: [] as AgentConnector[], envs: [] as string[], warnings: [`Power Platform: ${e instanceof Error ? e.message : String(e)}`] }; }
  })(), TASK_TIMEOUT, "Connectors");

  // ── Task G: Audit events ────────────────────────
  const taskG = withTimeout((async () => {
    if (!tokens.audit || !tokens.tenantId) return { activityMap: new Map() as Map<string, any>, warnings: [] as string[] };
    try {
      const auditClient = new AuditClient(tokens.audit, tokens.tenantId);
      const events = await auditClient.fetchAgentEvents(7);
      return { activityMap: AuditClient.aggregateByAgent(events), warnings: [] as string[] };
    } catch (e) { return { activityMap: new Map() as Map<string, any>, warnings: [`Audit: ${e instanceof Error ? e.message : String(e)}`] }; }
  })(), 60_000, "Audit");

  // ── Task H: Google Workspace (only if connected) ─
  const taskH = (tokens.googleServiceAccountKey && tokens.googleAdminEmail) ? withTimeout((async (): Promise<TaskResult> => {
    const result: TaskResult = { agents: [], warnings: [] };
    try {
      const key: GoogleServiceAccountKey = JSON.parse(tokens.googleServiceAccountKey!);
      const gc = new GoogleWorkspaceClient(key, tokens.googleAdminEmail!, tokens.googleProjectId);
      const gr = await gc.discoverAll();
      result.warnings.push(...gr.warnings);

      const now = new Date().toISOString();
      const makeRisk = (level: "critical"|"high"|"medium"|"low") => ({ score: 0, level, factors: [], recommendations: [], computedAt: now });
      const makeActivity = (uniqueUsers = 0) => ({ totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers, userBreakdown: [] });

      // Shadow AI (OAuth-connected AI tools) — platform: oauth_app (NOT google_workspace)
      // These are external tools like ChatGPT, Cursor, Claude connected via Google OAuth
      for (const app of gr.oauthApps) {
        if (!app.isAiTool) continue;
        result.agents.push({ id: `google-oauth-${app.clientId}`, appId: app.clientId, name: app.aiToolName || app.displayName, description: `${app.displayName} — used by ${app.users.length} user${app.users.length !== 1 ? "s" : ""}`, vendor: "Google", category: "generative-ai", platform: "oauth_app", discoverySource: "google_admin_sdk", firstSeen: now, publishedStatus: "active", isOrphaned: false, connectors: [], permissions: app.scopes, lifecycleStatus: "active", risk: makeRisk("high"), activity: makeActivity(app.users.length) });
      }

      // Google Chat bots — deduplicate by bot name across spaces
      const chatBotMap = new Map<string, typeof result.agents[0]>();
      for (const bot of gr.chatBots) {
        const key = bot.botDisplayName || bot.botName;
        const existing = chatBotMap.get(key);
        if (existing) {
          existing.description = existing.description?.replace(/in \d+ space/, `in ${(parseInt(existing.description?.match(/in (\d+) space/)?.[1] || "1") + 1)} spaces`) || existing.description;
          existing.activity.uniqueUsers = Math.max(existing.activity.uniqueUsers, 1);
        } else {
          chatBotMap.set(key, { id: `google-chat-${bot.botName}`, name: bot.botDisplayName || key, description: `Google Chat bot in 1 space`, vendor: "Google", category: "custom-agent", platform: "google_chat", discoverySource: "google_chat_api", firstSeen: bot.createTime || now, publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [], lifecycleStatus: "active", risk: makeRisk(bot.adminInstalled ? "medium" : "low"), activity: makeActivity() });
        }
      }
      result.agents.push(...chatBotMap.values());

      // Vertex AI Reasoning Engines (Agent Engine — code-based agents)
      for (const engine of gr.vertexReasoningEngines) {
        const region = engine.name.split("/locations/")[1]?.split("/")[0] || "us-central1";
        result.agents.push({ id: `vertex-agent-${engine.name}`, name: engine.displayName, description: engine.description || `Vertex AI Agent Engine (${region})`, vendor: "Google", category: "generative-ai", platform: "vertex_ai", discoverySource: "vertex_ai_reasoning_engines", firstSeen: engine.createTime || now, publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [], environment: gr.projectId, lifecycleStatus: "active", risk: makeRisk("medium"), activity: makeActivity() });
      }

      // Agent Builder apps (Gemini no-code agents)
      for (const app of gr.agentBuilderApps) {
        const solutionType = (app.solutionType || "").replace("SOLUTION_TYPE_", "").toLowerCase();
        result.agents.push({ id: `agent-builder-${app.name}`, name: app.displayName, description: `Gemini Agent Builder — ${solutionType} agent`, vendor: "Google", category: "generative-ai", platform: "vertex_ai", discoverySource: "google_agent_builder", firstSeen: app.createTime || now, publishedStatus: "active", isOrphaned: false, connectors: (app.dataStoreIds || []).map(ds => ({ name: ds.split("/").pop() || ds, type: "DataStore" })), permissions: [], environment: gr.projectId, llmModel: "Gemini", lifecycleStatus: "active", risk: makeRisk("medium"), activity: makeActivity() });
      }

      // Dialogflow CX agents (conversational agents)
      for (const agent of gr.dialogflowAgents) {
        result.agents.push({ id: `dialogflow-${agent.name}`, name: agent.displayName, description: agent.description || `Dialogflow CX agent (${agent.region || "global"})`, vendor: "Google", category: "generative-ai", platform: "vertex_ai", discoverySource: "google_dialogflow", firstSeen: now, publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [], environment: gr.projectId, lifecycleStatus: "active", risk: makeRisk("medium"), activity: makeActivity() });
      }

      // Vertex AI endpoints (deployed custom models)
      for (const ep of gr.vertexEndpoints) {
        result.agents.push({ id: `vertex-ep-${ep.name}`, name: ep.displayName, description: ep.description || "Vertex AI model endpoint", vendor: "Google", category: "ai-platform", platform: "vertex_ai", discoverySource: "vertex_ai_api", firstSeen: ep.createTime || now, publishedStatus: "active", isOrphaned: false, connectors: [], permissions: [], environment: gr.projectId, lifecycleStatus: "active", risk: makeRisk("medium"), activity: makeActivity() });
      }

      // ── Gemini AI (standalone) ──────────────────────────────────────────────────
      // platform: "gemini" — one entry showing all licensed users with their total activity
      if (gr.geminiEnabled) {
        const licensed = gr.geminiLicensedCount;

        const geminiUserBreakdown = (gr.geminiUserAppUsage || []).map(u => ({
          userPrincipalName: u.email,
          displayName: u.displayName,
          invocationCount: u.totalActions,
          lastActivity: u.lastActive,
        }));
        const totalActions = geminiUserBreakdown.reduce((s, u) => s + u.invocationCount, 0);

        result.agents.push({
          id: `gemini-ai-${gr.domain}`,
          name: "Gemini AI",
          description: `Google Gemini AI — ${geminiUserBreakdown.length} active user${geminiUserBreakdown.length !== 1 ? "s" : ""} on ${gr.domain}`,
          vendor: "Google",
          category: "generative-ai",
          platform: "gemini",
          discoverySource: "google_admin_sdk",
          firstSeen: now,
          publishedStatus: "active",
          isOrphaned: false,
          connectors: [],
          permissions: [],
          lifecycleStatus: "active",
          risk: makeRisk("high"),
          activity: {
            totalInvocations: totalActions,
            invocationsLast7Days: totalActions,
            invocationsLast30Days: totalActions,
            invocationsLast90Days: totalActions,
            uniqueUsers: geminiUserBreakdown.length,
            userBreakdown: geminiUserBreakdown,
          },
        } as any);

        // ── Google Workspace (Gemini in each app) ──────────────────────────────────
        // platform: "google_workspace" — one entry per app with per-user activity breakdown
        const WORKSPACE_APPS = [
          { app: "gmail",  label: "Gmail",  category: "Email" },
          { app: "docs",   label: "Docs",   category: "Documents" },
          { app: "sheets", label: "Sheets", category: "Spreadsheets" },
          { app: "slides", label: "Slides", category: "Presentations" },
          { app: "meet",   label: "Meet",   category: "Video Conferencing" },
          { app: "drive",  label: "Drive",  category: "File Storage" },
          { app: "chat",   label: "Chat",   category: "Messaging" },
        ];

        for (const { app, label, category } of WORKSPACE_APPS) {
          const appUsage = gr.geminiAppUsage.find(u => u.app === app);
          const actions  = appUsage ? appUsage.requestCount : 0;

          // Per-user breakdown for this specific app (only users with recorded activity)
          const appUserBreakdown = (gr.geminiUserAppUsage || [])
            .filter(u => (u.apps[app] || 0) > 0)
            .map(u => ({
              userPrincipalName: u.email,
              displayName: u.displayName,
              invocationCount: u.apps[app] || 0,
              lastActivity: u.lastActive,
            }))
            .sort((a, b) => b.invocationCount - a.invocationCount);

          const desc = actions > 0
            ? `Gemini AI in ${label} — ${appUserBreakdown.length} active user${appUserBreakdown.length !== 1 ? "s" : ""} (${actions} action${actions !== 1 ? "s" : ""} last 7 days) on ${gr.domain}`
            : `Gemini AI in ${label} — no activity recorded on ${gr.domain}`;

          result.agents.push({
            id: `gemini-workspace-${app}-${gr.domain}`,
            name: `Gemini in ${label}`,
            description: desc,
            vendor: "Google",
            category: "generative-ai",
            platform: `gemini_${app}` as any,  // gemini_gmail | gemini_docs | gemini_sheets | …
            discoverySource: "google_admin_sdk",
            firstSeen: now,
            publishedStatus: "active",
            isOrphaned: false,
            connectors: [{ name: label, type: category }],
            permissions: [],
            lifecycleStatus: "active",
            risk: makeRisk("high"),
            activity: {
              totalInvocations: actions,
              invocationsLast7Days: actions,
              invocationsLast30Days: actions,
              invocationsLast90Days: actions,
              uniqueUsers: appUserBreakdown.length,
              userBreakdown: appUserBreakdown,
            },
          } as any);
        }

        // ── Gemini Gems (private Gems created across the org) ─────────────────────
        for (const gem of (gr.gems || [])) {
          // Skip synthetic/placeholder entries produced by fallback logic
          if (gem.id.startsWith("gemini-")) continue;

          const sharedUserCount = (gem.sharedWith || []).length;
          result.agents.push({
            id: `gem-${gem.id}`,
            name: gem.name,
            description: `Private Gemini Gem by ${gem.owner.displayName || gem.owner.email}${gem.shared ? ` · shared with ${sharedUserCount} user${sharedUserCount !== 1 ? "s" : ""}` : " · private"}`,
            vendor: "Google",
            category: "generative-ai",
            platform: "gemini_gems" as any,
            discoverySource: "google_drive_api",
            firstSeen: gem.createdTime || now,
            lastModified: gem.modifiedTime || now,
            publishedStatus: gem.shared ? "active" : "draft",
            isOrphaned: false,
            connectors: [],
            permissions: gem.shared ? [{ name: "Shared", type: "read" }] : [],
            lifecycleStatus: "active",
            owner: { displayName: gem.owner.displayName, userPrincipalName: gem.owner.email, email: gem.owner.email },
            risk: makeRisk(gem.shared ? "high" : "medium"),
            activity: {
              totalInvocations: sharedUserCount,
              invocationsLast7Days: sharedUserCount,
              invocationsLast30Days: sharedUserCount,
              invocationsLast90Days: sharedUserCount,
              uniqueUsers: gem.shared ? sharedUserCount + 1 : 1,
              userBreakdown: [
                { userPrincipalName: gem.owner.email, displayName: gem.owner.displayName, invocationCount: 1, lastActivity: gem.modifiedTime || now },
                ...(gem.sharedWith || []).map((e: { email: string; displayName?: string }) => ({ userPrincipalName: e.email, displayName: e.displayName || e.email, invocationCount: 1, lastActivity: gem.modifiedTime || now })),
              ],
              webViewLink: gem.webViewLink,
            },
          } as any);
        }
      }

      console.log(`[Google] ${result.agents.length} agents (${gr.vertexReasoningEngines.length} reasoning engines, ${gr.agentBuilderApps.length} agent builder, ${gr.dialogflowAgents.length} dialogflow, ${chatBotMap.size} chat bots, gemini=${gr.geminiEnabled})`);
    } catch (e) { result.warnings.push(`Google: ${e instanceof Error ? e.message : String(e)}`); }
    return result;
  })(), 45_000, "Google") : Promise.resolve({ agents: [], warnings: [] } as TaskResult);

  // ════════════════════════════════════════════════
  // PHASE 3: Wait for ALL parallel tasks (with timeouts)
  // ════════════════════════════════════════════════
  const results = await Promise.allSettled([taskA, taskB, taskC, taskD, taskE, taskF, taskG, taskH]);
  const labels = ["Copilot Studio", "SharePoint", "Teams", "Copilot Agents", "Azure", "Connectors", "Audit", "Google"];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      if (i === 5) {
        // Connectors task (F) — special handling
        const connResult = r.value as any;
        warnings.push(...(connResult.warnings || []));
        environments = connResult.envs || [];
        if (connResult.connectors?.length > 0) {
          for (const agent of agents.filter(a => a.platform === "copilot_studio")) {
            agent.connectors = connResult.connectors;
          }
        }
      } else if (i === 6) {
        // Audit task (G) — merge activity
        const auditResult = r.value as any;
        warnings.push(...(auditResult.warnings || []));
        // Audit gets merged after all agent tasks
      } else {
        agents.push(...(r.value as TaskResult).agents);
        warnings.push(...(r.value as TaskResult).warnings);
      }
    } else {
      console.warn(`[${labels[i]}] FAILED: ${r.reason}`);
      warnings.push(`${labels[i]}: ${r.reason}`);
    }
  }

  // Merge audit activity into agents — tries botId, id, appId, and name (lowercased)
  const auditRes = results[6];
  if (auditRes.status === "fulfilled") {
    const activityMap = (auditRes.value as any).activityMap as Map<string, any> | undefined;
    if (activityMap) {
      for (const agent of agents) {
        const candidateKeys = [
          agent.botId, agent.id, agent.appId,
          agent.name?.toLowerCase(),
        ].filter(Boolean) as string[];

        let activity: any = null;
        for (const key of candidateKeys) {
          activity = activityMap.get(key);
          if (activity) break;
        }

        // Skip Google Workspace agents — their activity comes from the Reports API, not the M365 audit
        if (activity && agent.platform !== "google_workspace" && agent.platform !== "oauth_app") {
          agent.activity = {
            totalInvocations: activity.totalInvocations, invocationsLast7Days: activity.last7Days,
            invocationsLast30Days: activity.last30Days, invocationsLast90Days: activity.totalInvocations,
            lastActiveTimestamp: activity.lastActivity, uniqueUsers: activity.uniqueUsers.size,
            userBreakdown: Array.from(activity.userBreakdown.entries()).map((entry: any) => ({
              userPrincipalName: entry[0], displayName: userMap.get(entry[0])?.displayName || entry[0],
              invocationCount: entry[1].count, lastActivity: entry[1].last,
            })),
          };
        }
      }
    }
  }

  // Assign connectors (from task F) to Copilot Studio agents
  const connRes = results[5];
  if (connRes.status === "fulfilled") {
    const connectors = (connRes.value as any).connectors;
    if (connectors?.length > 0) {
      for (const agent of agents.filter(a => a.platform === "copilot_studio")) {
        agent.connectors = connectors;
      }
    }
  }

  console.log(`[Phase 2] All tasks done — ${agents.length} agents, ${Date.now() - startTime}ms`);

  // ════════════════════════════════════════════════
  // PHASE 4: Risk scoring + dedup
  // ════════════════════════════════════════════════
  const now = Date.now();
  for (const agent of agents) {
    const hasHttp = agent.connectors.some(c => c.type.toLowerCase().includes("http") || c.type.toLowerCase().includes("external"));
    let baseRiskLevel = "medium" as "critical" | "high" | "medium" | "low";
    if (agent.platform === "copilot_studio") baseRiskLevel = agent.connectors.length > 3 ? "medium" : "low";
    else if ((agent.platform as string) === "gemini") baseRiskLevel = "high";            // Gemini AI standalone
    else if (agent.platform === "google_workspace") baseRiskLevel = "high";             // legacy combined scope
    else if ((agent.platform as string).startsWith("gemini_")) baseRiskLevel = "high"; // gemini_gmail/docs/sheets/…
    else if (agent.platform === "gemini_workspace") baseRiskLevel = "high";            // legacy fallback
    else if (agent.platform === "oauth_app" && agent.category === "generative-ai") baseRiskLevel = "high"; // shadow AI
    else if (agent.platform === "vertex_ai") baseRiskLevel = "medium";
    else if (agent.platform === "apps_script") baseRiskLevel = "medium";
    else if (agent.platform === "google_chat") baseRiskLevel = "low";
    else if (agent.platform === "personal_agent") baseRiskLevel = "medium";
    else if (agent.platform === "teams_chat_agent") baseRiskLevel = "medium";
    else if (agent.platform === "isv_store") baseRiskLevel = "high";
    else if (agent.platform === "teams_app") baseRiskLevel = "low";

    const daysSinceLastActivity = agent.activity.lastActiveTimestamp
      ? Math.floor((now - new Date(agent.activity.lastActiveTimestamp).getTime()) / 86400000)
      : 999;
    const firstSeenDays = agent.firstSeen
      ? Math.floor((now - new Date(agent.firstSeen).getTime()) / 86400000)
      : undefined;

    agent.risk = assessRisk({
      baseRiskLevel,
      permissions: agent.permissions,
      consentType: agent.consentType,
      uniqueUsers: agent.activity.uniqueUsers,
      hasVerifiedPublisher: false,
      isMicrosoftFirstParty: false,
      hasHttpConnector: hasHttp,
      daysSinceLastActivity,
      isOrphaned: agent.isOrphaned,
      hasNoOwner: !agent.owner,
      agentName: agent.name,
      agentDescription: agent.description,
      conversationCount: agent.activity.totalInvocations || 0,
      agentAgeDays: firstSeenDays,
      neverReviewed: true,
    });

    if (agent.lifecycleStatus !== "suspended") {
      if (!agent.activity.lastActiveTimestamp) {
        agent.lifecycleStatus = "stale";
      } else {
        agent.lifecycleStatus = Math.floor((now - new Date(agent.activity.lastActiveTimestamp).getTime()) / 86400000) > 30 ? "stale" : "active";
      }
    }
  }

  // Dedup by name
  const deduped = new Map<string, DiscoveredAgent>();
  for (const agent of agents) {
    const existing = deduped.get(agent.name);
    if (!existing) { deduped.set(agent.name, agent); continue; }
    if ((agent.discoverySource === "dataverse" && existing.discoverySource !== "dataverse") || agent.activity.totalInvocations > existing.activity.totalInvocations) {
      deduped.set(agent.name, agent);
    }
  }

  const uniqueAgents = Array.from(deduped.values()).sort((a, b) => a.risk.score - b.risk.score);
  console.log(`[Done] ${uniqueAgents.length} unique agents in ${Date.now() - startTime}ms`);

  return {
    tenant: { id: org?.id || "", name: org?.displayName || "Unknown", domain: defaultDomain, license: hasE5 ? "E5" : "E3" },
    agents: uniqueAgents, totalServicePrincipals, totalUsers: users.length,
    totalEnvironments: environments.length || 1,
    scanTimestamp: new Date().toISOString(), scanDuration: Date.now() - startTime, warnings,
  };
}
