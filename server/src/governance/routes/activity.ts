import { Router } from "express";
import { getValidToken, getDataverseToken } from "../services/tokenManager.js";
import { DataverseClient } from "../services/dataverseClient.js";
import { AuditClient } from "../services/auditClient.js";
import { GraphClient } from "../services/graphClient.js";
import { AzureFoundryClient } from "../services/azureFoundryClient.js";
import { findPricing, computeCost } from "../services/pricingUtils.js";
import { getDb } from "../db.js";

const router = Router();

interface OAuthKeyRow {
  id: string;
  tenant_id: string | null;
  dataverse_env_url: string | null;
}

/**
 * GET /api/activity/chats — Fetch conversation transcripts with full message content
 * Source: Dataverse conversationtranscripts entity
 */
router.get("/chats", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const dataverseEnvUrl = req.query.dataverse_env_url as string | undefined;

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }

    const dvUrl = dataverseEnvUrl || keyDoc.dataverse_env_url;
    if (!dvUrl) {
      res.status(400).json({ error: "Dataverse environment URL is required for chat transcripts" });
      return;
    }

    const dvToken = await getDataverseToken(oauthKeyId, dvUrl);
    const dvClient = new DataverseClient(dvToken, dvUrl);

    const limit = parseInt(req.query.limit as string || "1000", 10);
    const transcripts = await dvClient.getAllConversationTranscripts(Math.min(limit, 5000));

    // Resolve bot schema names to display names
    const botNameMap = new Map<string, string>();
    try {
      const bots = await dvClient.discoverBots();
      for (const bot of bots) {
        botNameMap.set(bot.botid, bot.name);
        // Map schema name to display name
        const schemaMatch = bot.schemaname || bot.name;
        if (schemaMatch) botNameMap.set(schemaMatch.toLowerCase(), bot.name);
      }
    } catch { /* ignore */ }

    // Resolve user IDs to names via Graph
    let userMap = new Map<string, { displayName: string; userPrincipalName: string }>();
    try {
      const graphToken = await getValidToken(oauthKeyId, "graph");
      const graphClient = new GraphClient(graphToken);
      const users = await graphClient.getAllPages<{ id: string; displayName: string; userPrincipalName: string }>(
        "/v1.0/users",
        { $select: "id,displayName,userPrincipalName", $top: "999" },
        5
      );
      for (const u of users) {
        userMap.set(u.id, { displayName: u.displayName, userPrincipalName: u.userPrincipalName });
      }
    } catch {
      console.warn("[Activity] Could not load users for name resolution");
    }

    // Resolve user IDs — prefer realUserAadId (from activity from.aadObjectId)
    const resolvedTranscripts = await Promise.all(
      transcripts.map(async (t) => {
        let userName: string | undefined;
        let userEmail: string | undefined;

        // First: try the real user AAD ID extracted from conversation activities
        if (t.realUserAadId) {
          const entraUser = userMap.get(t.realUserAadId);
          if (entraUser) {
            userName = entraUser.displayName;
            userEmail = entraUser.userPrincipalName;
          }
        }

        // Fallback: resolve Dataverse owning user
        if (!userName && t.userId) {
          try {
            const dvUser = await dvClient.resolveUser(t.userId);
            if (dvUser) {
              if (dvUser.azureactivedirectoryobjectid) {
                const entraUser = userMap.get(dvUser.azureactivedirectoryobjectid);
                if (entraUser) {
                  userName = entraUser.displayName;
                  userEmail = entraUser.userPrincipalName;
                }
              }
              if (!userName) {
                // Check if this is a system user (bot service account)
                const isBotSystemUser = (dvUser.fullname || "").includes("Copilot") ||
                  (dvUser.fullname || "").includes("Bot") ||
                  (dvUser.internalemailaddress || "").includes("CopilotStudio");
                if (!isBotSystemUser) {
                  userName = dvUser.fullname;
                  userEmail = dvUser.internalemailaddress;
                }
              }
            }
          } catch { /* ignore */ }
        }

        // Resolve bot display name
        let displayBotName = t.botName;
        if (t.botId && botNameMap.has(t.botId)) {
          displayBotName = botNameMap.get(t.botId)!;
        } else if (botNameMap.has(t.botName.toLowerCase())) {
          displayBotName = botNameMap.get(t.botName.toLowerCase())!;
        }

        // Update message fromName for bot messages to use display name
        const updatedMessages = (t.messages || []).map((m) => {
          if (m.from === "bot" && displayBotName) {
            return { ...m, fromName: displayBotName };
          }
          return m;
        });

        return {
          ...t,
          botName: displayBotName,
          userName: userName || "Unknown User",
          userEmail: userEmail || "",
          messages: updatedMessages,
        };
      })
    );

    res.json({
      chats: resolvedTranscripts,
      totalCount: resolvedTranscripts.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch chat transcripts";
    console.error("[Activity] Chats error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/files — Fetch file-related activity from O365 audit logs
 * Source: O365 Management Activity API (SharePoint/OneDrive file events)
 */
router.get("/files", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }

    const tenantId = keyDoc.tenant_id;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant ID not found" });
      return;
    }

    let auditToken: string;
    try {
      auditToken = await getValidToken(oauthKeyId, "audit");
    } catch {
      res.json({
        files: [],
        totalCount: 0,
        warning: "Audit API token not available — requires E3/E5 license and ActivityFeed.Read permission",
      });
      return;
    }

    const auditClient = new AuditClient(auditToken, tenantId);

    // First ensure subscriptions are active (this re-enables if disabled)
    let subscriptionNote = "";
    try {
      const spResult = await auditClient.startSubscription("Audit.SharePoint");
      const genResult = await auditClient.startSubscription("Audit.General");
      if (spResult.status === "enabled" || genResult.status === "enabled") {
        subscriptionNote = "Audit subscription was just (re-)enabled. File events will start appearing within 15-30 minutes. Please check back shortly.";
      }
    } catch (e) {
      console.warn("[Activity] Subscription start failed:", e instanceof Error ? e.message : e);
    }

    const events = await auditClient.fetchFileActivity(7);

    const fileEvents: FileActivity[] = events.map((event) => ({
      id: event.Id,
      timestamp: event.CreationTime,
      userId: event.UserId,
      operation: event.Operation,
      workload: event.Workload,
      objectId: event.ObjectId || "",
      botId: event.BotId,
      clientIP: event.ClientIP,
      resultStatus: event.ResultStatus,
    }));

    // Resolve user names via Graph
    let userNames = new Map<string, string>();
    try {
      const graphToken = await getValidToken(oauthKeyId, "graph");
      const graphClient = new GraphClient(graphToken);
      const users = await graphClient.getAllPages<{ id: string; displayName: string; userPrincipalName: string }>(
        "/v1.0/users",
        { $select: "id,displayName,userPrincipalName", $top: "999" },
        5
      );
      for (const u of users) {
        userNames.set(u.userPrincipalName?.toLowerCase(), u.displayName);
      }
    } catch { /* ignore */ }

    const resolvedFiles = fileEvents.map((f) => ({
      ...f,
      userName: userNames.get(f.userId?.toLowerCase()) || f.userId,
      fileName: f.objectId.split("/").pop() || f.objectId,
      filePath: f.objectId,
    }));

    res.json({
      files: resolvedFiles,
      totalCount: resolvedFiles.length,
      subscriptionNote: subscriptionNote || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch file activity";
    console.error("[Activity] Files error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/knowledge — Fetch knowledge sources and file access for all discovered bots
 * Source: Dataverse botcomponents + knowledge entities
 */
router.get("/knowledge", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const dataverseEnvUrl = req.query.dataverse_env_url as string | undefined;
    const botId = req.query.bot_id as string | undefined;

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }

    const dvUrl = dataverseEnvUrl || keyDoc.dataverse_env_url;
    if (!dvUrl) {
      res.status(400).json({ error: "Dataverse environment URL is required" });
      return;
    }

    const dvToken = await getDataverseToken(oauthKeyId, dvUrl);
    const dvClient = new DataverseClient(dvToken, dvUrl);

    if (botId) {
      // Single bot knowledge sources
      const sources = await dvClient.getBotKnowledgeSources(botId);
      const components = await dvClient.getAllBotComponents(botId);
      res.json({ botId, sources, components, totalSources: sources.length });
    } else {
      // All bots — discover bots first, then fetch knowledge for each
      const bots = await dvClient.discoverBots();
      const allResults: Array<{ botId: string; botName: string; sources: unknown[]; components: unknown[] }> = [];

      for (const bot of bots.slice(0, 20)) {
        const sources = await dvClient.getBotKnowledgeSources(bot.botid);
        const components = await dvClient.getAllBotComponents(bot.botid);
        allResults.push({
          botId: bot.botid,
          botName: bot.name,
          sources,
          components,
        });
      }

      res.json({ bots: allResults, totalBots: allResults.length });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch knowledge sources";
    console.error("[Activity] Knowledge error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/audit-health — Check audit subscription status
 * Tells the UI whether audit ingestion is working properly
 */
router.get("/audit-health", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }

    const tenantId = keyDoc.tenant_id;
    if (!tenantId) {
      res.json({ status: "no_tenant", message: "Tenant ID not configured", subscriptions: [] });
      return;
    }

    let auditToken: string;
    try {
      auditToken = await getValidToken(oauthKeyId, "audit");
    } catch {
      res.json({
        status: "no_token",
        message: "Audit API token unavailable — requires E3/E5 license and ActivityFeed.Read permission",
        subscriptions: [],
      });
      return;
    }

    const auditClient = new AuditClient(auditToken, tenantId);

    const subscriptions: Array<{
      contentType: string;
      status: string;
      message: string;
      hasRecentContent: boolean;
    }> = [];

    const HEALTH_TIMEOUT = 30000;
    for (const contentType of ["Audit.General", "Audit.SharePoint"]) {
      try {
        const subResult = await Promise.race([
          auditClient.startSubscription(contentType),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), HEALTH_TIMEOUT)),
        ]);

        // Try to fetch last 24h content to verify data is flowing
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        let hasContent = false;
        try {
          const content = await Promise.race([
            auditClient.listContent(
              contentType,
              yesterday.toISOString().replace(/\.\d{3}Z/, ""),
              now.toISOString().replace(/\.\d{3}Z/, "")
            ),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
          ]);
          hasContent = content.length > 0;
        } catch { /* ignore */ }

        const statusMsg = subResult.status === "already_active"
          ? "Active and running"
          : subResult.status === "tenant_not_provisioned"
            ? subResult.message || "Tenant not provisioned"
            : "Just enabled — events will appear in 15-30 min";

        subscriptions.push({
          contentType,
          status: subResult.status,
          message: statusMsg,
          hasRecentContent: hasContent,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to check subscription";
        subscriptions.push({
          contentType,
          status: msg === "timeout" ? "timeout" : "error",
          message: msg === "timeout" ? "O365 API timed out — try again shortly" : msg,
          hasRecentContent: false,
        });
      }
    }

    const allHealthy = subscriptions.every(s => s.status === "already_active" && s.hasRecentContent);
    const anyActive = subscriptions.some(s => s.status === "already_active" || s.status === "enabled");

    res.json({
      status: allHealthy ? "healthy" : anyActive ? "partial" : "unhealthy",
      message: allHealthy
        ? "All audit subscriptions are active and receiving events"
        : anyActive
          ? "Audit subscriptions are active but some may need time to collect events"
          : "Audit subscriptions are not active — check permissions",
      subscriptions,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check audit health";
    console.error("[Activity] Audit health error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/risk-summary — Get risk scores for all discovered agents
 * Pulls from last discovery result or re-computes from Dataverse data
 */
router.get("/risk-summary", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const dataverseEnvUrl = req.query.dataverse_env_url as string | undefined;

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }

    const dvUrl = dataverseEnvUrl || keyDoc.dataverse_env_url;
    if (!dvUrl) {
      res.json({ agents: [], message: "Dataverse not configured" });
      return;
    }

    const dvToken = await getDataverseToken(oauthKeyId, dvUrl);
    const dvClient = new DataverseClient(dvToken, dvUrl);
    const bots = await dvClient.discoverBots();

    // Resolve users for owner detection + guest user identification
    let userMap = new Map<string, { displayName: string; accountEnabled: boolean; userType?: string }>();
    const guestUserIds = new Set<string>();
    try {
      const graphToken = await getValidToken(oauthKeyId, "graph");
      const graphClient = new GraphClient(graphToken);
      const users = await graphClient.getAllPages<{ id: string; displayName: string; accountEnabled: boolean; userType?: string }>(
        "/v1.0/users",
        { $select: "id,displayName,accountEnabled,userType", $top: "999" },
        5
      );
      for (const u of users) {
        userMap.set(u.id, { displayName: u.displayName, accountEnabled: u.accountEnabled, userType: u.userType });
        if (u.userType === "Guest") guestUserIds.add(u.id);
      }
    } catch { /* ignore */ }

    const { assessRisk } = await import("../services/riskService.js");

    // Load conversation transcripts for activity context + guest user tracking
    let transcriptsByBot = new Map<string, number>();
    const guestUsersByBot = new Map<string, Set<string>>();
    try {
      const transcripts = await dvClient.getAllConversationTranscripts(200);
      for (const t of transcripts) {
        if (t.botId) {
          transcriptsByBot.set(t.botId, (transcriptsByBot.get(t.botId) || 0) + 1);
          // Track guest users who interacted with this bot
          const aadId = t.realUserAadId;
          if (aadId && guestUserIds.has(aadId)) {
            if (!guestUsersByBot.has(t.botId)) guestUsersByBot.set(t.botId, new Set());
            guestUsersByBot.get(t.botId)!.add(aadId);
          }
        }
      }
    } catch { /* ignore */ }

    // Load/create agent registry entries for renewal tracking
    const registryMap = new Map<string, { renewal_date: string | null; renewal_period_days: number }>();
    try {
      const regRows = await db.collection("agent_registry")
        .find({ oauth_key_id: oauthKeyId }, { projection: { bot_id: 1, renewal_date: 1, renewal_period_days: 1 } })
        .toArray();
      for (const r of regRows) {
        registryMap.set(r.bot_id as string, {
          renewal_date: r.renewal_date as string | null,
          renewal_period_days: (r.renewal_period_days as number) || 90,
        });
      }
    } catch { /* ignore */ }

    const agentRisks = await Promise.all(bots.slice(0, 20).map(async (bot) => {
      const sessions = await dvClient.getBotSessions(bot.botid, 30);
      const now = Date.now();
      const lastSession = sessions.length > 0 ? sessions[0].startTime : undefined;
      const daysSinceLastActivity = lastSession
        ? Math.floor((now - new Date(lastSession).getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      let hasOwner = false;
      let isOrphaned = false;
      let ownerName = "Unknown";
      if (bot._createdby_value) {
        try {
          const dvUser = await dvClient.resolveUser(bot._createdby_value);
          if (dvUser?.azureactivedirectoryobjectid) {
            const entraUser = userMap.get(dvUser.azureactivedirectoryobjectid);
            if (entraUser) {
              hasOwner = true;
              isOrphaned = !entraUser.accountEnabled;
              ownerName = entraUser.displayName;
            } else {
              hasOwner = true;
              ownerName = dvUser.fullname || "Unknown";
            }
          }
        } catch { /* ignore */ }
      }

      // Detect knowledge sources and connectors for this bot
      let hasHttpConnector = false;
      let detectedPermissions: string[] = [];
      let knowledgeSourceCount = 0;
      try {
        const sources = await dvClient.getBotKnowledgeSources(bot.botid);
        knowledgeSourceCount = sources.length;
        for (const src of sources) {
          if (src.type === "connector" || (src.url && !src.url.includes("sharepoint") && src.url.startsWith("http"))) {
            hasHttpConnector = true;
          }
          if (src.type === "sharepoint") {
            detectedPermissions.push("Sites.Read.All");
          }
          if (src.type === "dataverse_table") {
            detectedPermissions.push("User.Read.All");
          }
          if (src.type === "website" || src.type === "connector") {
            detectedPermissions.push("Mail.Read");
          }
        }
      } catch { /* ignore */ }

      // Detect Power Platform connector scopes (Mail.ReadWrite, Sites.ReadWrite.All, etc.)
      let detectedConnectorCount = 0;
      try {
        const { connectors: botConnectors, allScopes } = await dvClient.getBotConnectorScopes(bot.botid);
        detectedPermissions.push(...allScopes);
        detectedConnectorCount = botConnectors.length;
        if (botConnectors.some(c => c.name.toLowerCase().includes("http"))) {
          hasHttpConnector = true;
        }
      } catch { /* ignore */ }

      detectedPermissions = [...new Set(detectedPermissions)];

      // Determine base risk level from bot capabilities
      let baseRiskLevel: "low" | "medium" | "high" | "critical" = "low";
      if (detectedConnectorCount > 3 || knowledgeSourceCount > 5 || hasHttpConnector) {
        baseRiskLevel = "medium";
      } else if (knowledgeSourceCount > 2) {
        baseRiskLevel = "low";
      }

      // Published agents are available org-wide
      const isPublished = bot.statecode === 0;
      const consentType = isPublished ? "AllPrincipals" : undefined;

      // Renewal tracking — only use admin-set dates, never auto-generate
      let renewalDate: string | null = null;
      let renewalPeriodDays = 90;
      let isExpiredRenewal = false;
      const registry = registryMap.get(bot.botid);
      if (registry) {
        renewalDate = registry.renewal_date;
        renewalPeriodDays = registry.renewal_period_days;
        if (renewalDate && new Date(renewalDate).getTime() < now) {
          isExpiredRenewal = true;
        }
        // Risk is fully dynamic — no manual overrides from tags
      } else {
        // First time seeing this bot — register it WITHOUT a renewal date
        // Renewal dates should only be set by an admin through the governance workflow
        try {
          await db.collection("agent_registry").updateOne(
            { bot_id: bot.botid },
            {
              $set: {
                last_scanned_at: new Date(),
                name: bot.name,
              },
              $setOnInsert: {
                bot_id: bot.botid,
                oauth_key_id: oauthKeyId,
                owner_name: ownerName,
                renewal_period_days: 90,
                created_at: new Date(),
              },
            },
            { upsert: true }
          );
        } catch { /* ignore */ }
      }

      const conversationCount = transcriptsByBot.get(bot.botid) || 0;
      const description = bot.description || `Copilot Studio agent in ${dvUrl}`;

      // Never-reviewed: no renewal date set and agent older than 30 days
      const agentAgeDays = bot.createdon
        ? Math.floor((now - new Date(bot.createdon).getTime()) / (1000 * 60 * 60 * 24))
        : undefined;
      const neverReviewed = !renewalDate && !isExpiredRenewal;

      // Guest user tracking for this bot
      const botGuestUsers = guestUsersByBot.get(bot.botid);
      const guestUserCount = botGuestUsers?.size || 0;

      const risk = assessRisk({
        baseRiskLevel,
        permissions: detectedPermissions,
        consentType,
        uniqueUsers: sessions.length,
        hasVerifiedPublisher: false,
        isMicrosoftFirstParty: false,
        hasHttpConnector,
        daysSinceLastActivity,
        isOrphaned,
        hasNoOwner: !hasOwner,
        isExpiredRenewal,
        agentName: bot.name,
        agentDescription: description,
        hasNoPolicy: true,
        conversationCount,
        neverReviewed,
        agentAgeDays,
        hasGuestUsers: guestUserCount > 0,
        guestUserCount,
      });

      // Update registry with latest risk score
      try {
        await db.collection("agent_registry").updateOne(
          { bot_id: bot.botid },
          {
            $set: {
              last_risk_score: risk.score,
              last_risk_level: risk.level,
              last_scanned_at: new Date(),
              updated_at: new Date(),
            },
          }
        );
      } catch { /* ignore */ }

      return {
        botId: bot.botid,
        botName: bot.name,
        description,
        ownerName,
        isOrphaned,
        status: bot.statecode === 0 ? "active" : "inactive",
        risk,
        sessionCount: sessions.length,
        conversationCount,
        lastActivity: lastSession || null,
        createdOn: bot.createdon || null,
        modifiedOn: bot.modifiedon || null,
        renewalDate,
        renewalPeriodDays,
        isExpiredRenewal,
      };
    }));

    res.json({ agents: agentRisks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute risk summary";
    console.error("[Activity] Risk summary error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/azure/usage — Fetch Azure OpenAI usage metrics (tokens, requests)
 */
router.get("/azure/usage", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const period = (req.query.period as string) || "P7D";

    if (!oauthKeyId) { res.status(400).json({ error: "oauth_key_id is required" }); return; }

    const azureToken = await getValidToken(oauthKeyId, "azure");
    const cogToken = await getValidToken(oauthKeyId, "cognitiveservices").catch(() => undefined);
    const client = new AzureFoundryClient(azureToken, cogToken);

    const discovery = await client.discoverAll();
    const resourceUsage: Array<{
      resourceId: string; resourceName: string; endpoint?: string;
      metrics: Awaited<ReturnType<AzureFoundryClient["getOpenAIUsageMetrics"]>>;
    }> = [];

    for (const oai of discovery.openAIResources) {
      try {
        const metrics = await client.getOpenAIUsageMetrics(oai.id, period);
        resourceUsage.push({ resourceId: oai.id, resourceName: oai.name, endpoint: oai.endpoint, metrics });
      } catch { /* skip unavailable resource */ }
    }

    const totalTokens = resourceUsage.reduce((s, r) => s + r.metrics.totalTokens, 0);
    const totalRequests = resourceUsage.reduce((s, r) => s + r.metrics.totalRequests, 0);

    res.json({ resources: resourceUsage, totalTokens, totalRequests, period });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Azure usage";
    console.error("[Activity] Azure usage error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/azure/usage-details — Combined usage + discovery + cost
 * Merges Azure Monitor metrics (or Log Analytics fallback) with discovered agents,
 * applies pricing to compute cost, and returns everything the Usage Tracking tab needs.
 */
router.get("/azure/usage-details", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const period = (req.query.period as string) || "P7D";

    if (!oauthKeyId) { res.status(400).json({ error: "oauth_key_id is required" }); return; }

    const azureToken = await getValidToken(oauthKeyId, "azure");
    const cogToken = await getValidToken(oauthKeyId, "cognitiveservices").catch(() => undefined);
    const client = new AzureFoundryClient(azureToken, cogToken);

    // Check for Log Analytics workspace ID
    let logAnalyticsWorkspaceId: string | null = null;
    try {
      const db = getDb();
      const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
      logAnalyticsWorkspaceId = keyDoc?.log_analytics_workspace_id || null;
    } catch { /* column may not exist yet */ }

    const periodDaysMap: Record<string, number> = { P1D: 1, P7D: 7, P30D: 30, P90D: 90 };
    const periodDays = periodDaysMap[period] || 7;

    // Discover all Azure OpenAI resources
    const discovery = await client.discoverAll();

    // Build deployment-to-model map from all resources
    const deploymentModelMap = new Map<string, string>();
    for (const oai of discovery.openAIResources) {
      for (const dep of oai.deployments || []) {
        deploymentModelMap.set(dep.name, dep.modelName || "unknown");
      }
    }

    // Collect metrics from Azure Monitor for each resource
    type DeploymentUsage = {
      deploymentName: string; modelName: string;
      inputTokens: number; outputTokens: number; totalTokens: number;
      requestCount: number; inputCost: number; outputCost: number; totalCost: number;
      resourceName: string; resourceId: string;
    };

    const allDeployments: DeploymentUsage[] = [];
    let dataSource: "monitor" | "log_analytics" | "discovery_only" = "discovery_only";
    let monitorHasData = false;
    let tokensEstimated = false;

    for (const oai of discovery.openAIResources) {
      try {
        const metrics = await client.getOpenAIUsageMetrics(oai.id, period);
        if ((metrics as any).tokensEstimated) tokensEstimated = true;

        for (const dep of metrics.deployments) {
          const modelName = deploymentModelMap.get(dep.deploymentName) || dep.deploymentName;
          const pricing = findPricing(modelName, "azure");

          // If only totalTokens is available (no split), estimate 40% input / 60% output for cost
          let inputTokens = dep.promptTokens;
          let outputTokens = dep.completionTokens;
          if (inputTokens === 0 && outputTokens === 0 && dep.totalTokens > 0) {
            inputTokens = Math.round(dep.totalTokens * 0.4);
            outputTokens = Math.round(dep.totalTokens * 0.6);
          }

          const cost = computeCost(inputTokens, outputTokens, pricing);

          if (dep.totalTokens > 0 || dep.requestCount > 0) {
            monitorHasData = true;
          }

          allDeployments.push({
            deploymentName: dep.deploymentName,
            modelName,
            inputTokens,
            outputTokens,
            totalTokens: dep.totalTokens,
            requestCount: dep.requestCount,
            inputCost: (inputTokens * pricing.input) / 1_000_000,
            outputCost: (outputTokens * pricing.output) / 1_000_000,
            totalCost: cost,
            resourceName: oai.name,
            resourceId: oai.id,
          });
        }
      } catch (err: any) {
        console.warn("[UsageDetails] Metrics failed for", oai.name, err?.message);
      }
    }

    if (monitorHasData) {
      dataSource = "monitor";
    }

    // Fallback: if Azure Monitor returned 0 tokens, try Log Analytics
    const totalMonitorTokens = allDeployments.reduce((s, d) => s + d.totalTokens, 0);
    if (totalMonitorTokens === 0 && logAnalyticsWorkspaceId) {
      try {
        const laResult = await client.queryLogAnalytics(logAnalyticsWorkspaceId, periodDays);
        if (laResult.totalTokens > 0) {
          allDeployments.length = 0;
          for (const dep of laResult.deployments) {
            const modelName = dep.modelName || deploymentModelMap.get(dep.deploymentName) || dep.deploymentName;
            const pricing = findPricing(modelName, "azure");
            const cost = computeCost(dep.promptTokens, dep.completionTokens, pricing);

            allDeployments.push({
              deploymentName: dep.deploymentName,
              modelName,
              inputTokens: dep.promptTokens,
              outputTokens: dep.completionTokens,
              totalTokens: dep.totalTokens,
              requestCount: dep.requestCount,
              inputCost: (dep.promptTokens * pricing.input) / 1_000_000,
              outputCost: (dep.completionTokens * pricing.output) / 1_000_000,
              totalCost: cost,
              resourceName: "Log Analytics",
              resourceId: logAnalyticsWorkspaceId,
            });
          }
          dataSource = "log_analytics";
        }
      } catch (err: any) {
        console.warn("[UsageDetails] Log Analytics fallback failed:", err?.message);
      }
    }

    // Build agent-level view by merging discovered agents with deployment metrics
    const agents = [];

    // Map discovered AI agents (assistants) by model/deployment
    const agentsByDeployment = new Map<string, any[]>();
    for (const agent of discovery.aiAgents || []) {
      const model = agent.model || "unknown";
      if (!agentsByDeployment.has(model)) agentsByDeployment.set(model, []);
      agentsByDeployment.get(model)!.push(agent);
    }

    // Combine deployments with their metrics
    for (const dep of allDeployments) {
      const matchedAgents = agentsByDeployment.get(dep.modelName) || [];
      agents.push({
        deploymentName: dep.deploymentName,
        modelName: dep.modelName,
        resourceName: dep.resourceName,
        inputTokens: dep.inputTokens,
        outputTokens: dep.outputTokens,
        totalTokens: dep.totalTokens,
        requestCount: dep.requestCount,
        inputCost: dep.inputCost,
        outputCost: dep.outputCost,
        totalCost: dep.totalCost,
        assistantCount: matchedAgents.length,
        assistants: matchedAgents.map(a => ({ id: a.id, name: a.name, model: a.model })),
      });
    }

    // Include deployments that have no metrics but exist in discovery
    const coveredDeployments = new Set(allDeployments.map(d => d.deploymentName));
    for (const oai of discovery.openAIResources) {
      for (const dep of oai.deployments || []) {
        if (!coveredDeployments.has(dep.name)) {
          agents.push({
            deploymentName: dep.name,
            modelName: dep.modelName || "unknown",
            resourceName: oai.name,
            inputTokens: 0, outputTokens: 0, totalTokens: 0,
            requestCount: 0, inputCost: 0, outputCost: 0, totalCost: 0,
            assistantCount: 0, assistants: [],
          });
        }
      }
    }

    const summary = {
      totalInputTokens: allDeployments.reduce((s, d) => s + d.inputTokens, 0),
      totalOutputTokens: allDeployments.reduce((s, d) => s + d.outputTokens, 0),
      totalTokens: allDeployments.reduce((s, d) => s + d.totalTokens, 0),
      totalRequests: allDeployments.reduce((s, d) => s + d.requestCount, 0),
      totalCost: Math.round(allDeployments.reduce((s, d) => s + d.totalCost, 0) * 10000) / 10000,
      totalDeployments: agents.length,
      totalOpenAIResources: discovery.openAIResources.length,
    };

    res.json({
      agents,
      summary,
      dataSource,
      period,
      tokensEstimated,
      logAnalyticsConfigured: !!logAnalyticsWorkspaceId,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Azure usage details";
    console.error("[Activity] Azure usage-details error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/azure/assistants — List Azure OpenAI assistants with their configs
 */
router.get("/azure/assistants", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    if (!oauthKeyId) { res.status(400).json({ error: "oauth_key_id is required" }); return; }

    const azureToken = await getValidToken(oauthKeyId, "azure");
    const cogToken = await getValidToken(oauthKeyId, "cognitiveservices").catch(() => undefined);
    const client = new AzureFoundryClient(azureToken, cogToken);

    const discovery = await client.discoverAll();
    const allAssistants: Array<any> = [];

    for (const oai of discovery.openAIResources) {
      const endpoint = oai.endpoint;
      if (!endpoint) continue;
      const assistants = await client.listAssistants(endpoint);
      for (const a of assistants) {
        const files = await client.listAssistantFiles(endpoint, a.id);
        allAssistants.push({ ...a, resourceName: oai.name, endpoint, files });
      }
    }

    res.json({ assistants: allAssistants, totalCount: allAssistants.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Azure assistants";
    console.error("[Activity] Azure assistants error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/azure/threads — Fetch Azure OpenAI thread conversations
 */
router.get("/azure/threads", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    if (!oauthKeyId) { res.status(400).json({ error: "oauth_key_id is required" }); return; }

    const azureToken = await getValidToken(oauthKeyId, "azure");
    const cogToken = await getValidToken(oauthKeyId, "cognitiveservices").catch(() => undefined);
    const client = new AzureFoundryClient(azureToken, cogToken);

    const discovery = await client.discoverAll();
    const allThreads: Array<any> = [];

    for (const oai of discovery.openAIResources) {
      const endpoint = oai.endpoint;
      if (!endpoint) continue;
      try {
        const threads = await client.listThreads(endpoint, 20);
        for (const thread of threads) {
          const messages = await client.getThreadMessages(endpoint, thread.id, 50);
          allThreads.push({
            id: thread.id,
            created_at: thread.created_at,
            metadata: thread.metadata,
            resourceName: oai.name,
            endpoint,
            messages: messages.map((m: any) => ({
              id: m.id,
              role: m.role,
              created_at: m.created_at,
              content: m.content,
            })),
          });
        }
      } catch { /* skip if threads API not supported */ }
    }

    res.json({ threads: allThreads, totalCount: allThreads.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Azure threads";
    console.error("[Activity] Azure threads error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/teams/signins — Fetch sign-in logs for Teams/M365 apps
 * Shows who used which agent app and when via Entra ID sign-in logs
 */
router.get("/teams/signins", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const appId = req.query.app_id as string | undefined;
    if (!oauthKeyId) { res.status(400).json({ error: "oauth_key_id is required" }); return; }

    const graphToken = await getValidToken(oauthKeyId, "graph");
    const graphClient = new GraphClient(graphToken);

    // Build filter — v1.0 signIns doesn't support signInEventTypes; use createdDateTime range instead
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let filter = `createdDateTime ge ${sevenDaysAgo}`;
    if (appId) {
      filter = `appId eq '${appId}' and createdDateTime ge ${sevenDaysAgo}`;
    }

    const signIns = await graphClient.getAllPages<{
      id: string;
      createdDateTime: string;
      userPrincipalName: string;
      userDisplayName: string;
      appId: string;
      appDisplayName: string;
      resourceDisplayName: string;
      status: { errorCode: number; additionalDetails?: string };
      ipAddress?: string;
      clientAppUsed?: string;
    }>("/v1.0/auditLogs/signIns", {
      $filter: filter,
      $orderby: "createdDateTime desc",
      $top: "200",
      $select: "id,createdDateTime,userPrincipalName,userDisplayName,appId,appDisplayName,resourceDisplayName,status,ipAddress,clientAppUsed",
    }, 3);

    const agentKeywords = ["copilot", "agent", "assistant", "bot", "ai", "teams"];
    const agentSignIns = appId
      ? signIns
      : signIns.filter((s) => {
          const nameLC = (s.appDisplayName || "").toLowerCase();
          return agentKeywords.some((kw) => nameLC.includes(kw));
        });

    const byApp = new Map<string, { appName: string; appId: string; users: Set<string>; count: number; lastSignIn: string }>();
    for (const s of agentSignIns) {
      const key = s.appId || s.appDisplayName;
      const existing = byApp.get(key) || { appName: s.appDisplayName, appId: s.appId, users: new Set(), count: 0, lastSignIn: "" };
      existing.count++;
      existing.users.add(s.userPrincipalName);
      if (s.createdDateTime > existing.lastSignIn) existing.lastSignIn = s.createdDateTime;
      byApp.set(key, existing);
    }

    const appSummaries = Array.from(byApp.values()).map((a) => ({
      appName: a.appName,
      appId: a.appId,
      uniqueUsers: a.users.size,
      totalSignIns: a.count,
      lastSignIn: a.lastSignIn,
    }));

    res.json({
      signIns: agentSignIns.slice(0, 500).map((s) => ({
        id: s.id,
        timestamp: s.createdDateTime,
        userPrincipalName: s.userPrincipalName,
        userDisplayName: s.userDisplayName,
        appId: s.appId,
        appDisplayName: s.appDisplayName,
        resourceDisplayName: s.resourceDisplayName,
        status: s.status?.errorCode === 0 ? "Success" : `Error ${s.status?.errorCode}`,
        ipAddress: s.ipAddress,
        clientAppUsed: s.clientAppUsed,
      })),
      appSummaries,
      totalCount: agentSignIns.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch sign-in logs";
    console.error("[Activity] Teams sign-ins error:", message);
    res.status(500).json({ error: message });
  }
});

interface FileActivity {
  id: string;
  timestamp: string;
  userId: string;
  operation: string;
  workload: string;
  objectId: string;
  botId?: string;
  clientIP?: string;
  resultStatus?: string;
}

/**
 * GET /api/activity/copilot-interactions — Fetch Copilot interaction events from O365 audit logs
 * Covers Personal Agents (m365.cloud.microsoft) and SharePoint embedded agents.
 * These agents don't store transcripts in Dataverse, so audit logs are the primary source.
 */
router.get("/copilot-interactions", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const platform = req.query.platform as string; // "personal_agent" | "sharepoint_embedded"

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const db = getDb();
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }
    const tenantId = keyDoc.tenant_id;
    if (!tenantId) {
      res.status(400).json({ error: "Tenant ID not configured" });
      return;
    }

    // Fetch audit events
    const auditToken = await getValidToken(oauthKeyId, "audit");
    const auditClient = new AuditClient(auditToken, tenantId);
    const events = await auditClient.fetchAgentEvents(7);

    // Filter for Copilot interaction events relevant to the requested platform
    const copilotEvents = events.filter((e) => {
      const wl = (e.Workload || "").toLowerCase();
      const op = (e.Operation || "").toLowerCase();
      const objectId = (e.ObjectId || "").toLowerCase();

      if (platform === "sharepoint_embedded") {
        return (
          (wl === "sharepoint" && (op.includes("copilot") || op.includes("agent"))) ||
          (wl === "copilot" && objectId.includes("sharepoint")) ||
          (wl === "microsoftcopilot" && objectId.includes("sharepoint"))
        );
      }
      // personal_agent: M365 Copilot personal agents
      return (
        wl === "copilot" || wl === "microsoftcopilot" ||
        (wl === "microsoftteams" && (op.includes("copilot") || op.includes("agent") || op.includes("bot"))) ||
        (wl === "copilotstudio" && !objectId.includes("sharepoint"))
      );
    });

    // Resolve user display names via Graph
    let userMap = new Map<string, { displayName: string; userPrincipalName: string }>();
    try {
      const graphToken = await getValidToken(oauthKeyId, "graph");
      const graphClient = new GraphClient(graphToken);
      const users = await graphClient.getAllPages<{ id: string; displayName: string; userPrincipalName: string }>(
        "/v1.0/users",
        { $select: "id,displayName,userPrincipalName", $top: "999" },
        3
      );
      for (const u of users) {
        userMap.set(u.id, { displayName: u.displayName, userPrincipalName: u.userPrincipalName });
        userMap.set(u.userPrincipalName?.toLowerCase(), { displayName: u.displayName, userPrincipalName: u.userPrincipalName });
      }
    } catch { /* ignore user resolution failures */ }

    // Group events by session/user to create conversation-like entries
    const sessionMap = new Map<string, {
      id: string;
      agentName: string;
      userId: string;
      userName: string;
      userEmail: string;
      startTime: string;
      events: Array<{ timestamp: string; operation: string; details: string }>;
    }>();

    for (const event of copilotEvents) {
      const sessionId = event.SessionId || event.Id;
      const agentName = extractAgentName(event);
      const userId = event.UserId || "";
      const user = userMap.get(userId) || userMap.get(userId.toLowerCase());

      const key = `${sessionId}-${agentName}`;
      let session = sessionMap.get(key);
      if (!session) {
        session = {
          id: event.Id,
          agentName: agentName || "Unknown Agent",
          userId,
          userName: user?.displayName || userId.split("@")[0] || "Unknown User",
          userEmail: user?.userPrincipalName || userId || "",
          startTime: event.CreationTime,
          events: [],
        };
        sessionMap.set(key, session);
      }

      if (event.CreationTime < session.startTime) {
        session.startTime = event.CreationTime;
      }

      session.events.push({
        timestamp: event.CreationTime,
        operation: event.Operation || "CopilotInteraction",
        details: extractEventDetails(event),
      });
    }

    // Convert sessions to conversation format
    const conversations = Array.from(sessionMap.values())
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
      .slice(0, 200)
      .map((session) => ({
        id: session.id,
        botId: "",
        botName: session.agentName,
        userName: session.userName,
        userEmail: session.userEmail,
        startTime: session.startTime,
        createdOn: session.startTime,
        isTestMode: false,
        messageCount: session.events.length,
        messages: session.events
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map((e, i) => ({
            id: `${session.id}-${i}`,
            from: "user",
            fromName: session.userName,
            text: `[${e.operation}] ${e.details}`,
            timestamp: e.timestamp,
          })),
        source: "audit_log",
      }));

    res.json({
      chats: conversations,
      totalCount: conversations.length,
      source: "o365_audit_log",
      rawEventCount: copilotEvents.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Copilot interactions";
    console.error("[Activity] Copilot interactions error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/activity/m365-copilot-chats — Fetch M365 Copilot agent conversations via Graph API
 * Scans the user's 1:1 chats for agent/bot conversations using discovered agent names.
 * Also tries Graph beta /copilot/interactions for richer data when available.
 */
router.get("/m365-copilot-chats", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const agentNamesParam = req.query.agent_names as string; // comma-separated discovered agent names

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const graphToken = await getValidToken(oauthKeyId, "graph");
    const graphClient = new GraphClient(graphToken);

    // Build a set of known agent names (lowercased) from discovery data
    const knownAgentNames = new Set<string>();
    if (agentNamesParam) {
      for (const name of agentNamesParam.split(",")) {
        const trimmed = name.trim().toLowerCase();
        if (trimmed) knownAgentNames.add(trimmed);
      }
    }
    // Always include common bot keywords
    const BOT_KEYWORDS = ["agent", "copilot", "bot", "assistant"];

    function isBotMember(displayName: string, roles?: string[]): boolean {
      if ((roles || []).includes("bot")) return true;
      const nameLC = (displayName || "").toLowerCase();
      // Match against known discovered agent names
      if (knownAgentNames.has(nameLC)) return true;
      // Partial match — check if any known agent name is contained in the display name or vice versa
      for (const known of knownAgentNames) {
        if (nameLC.includes(known) || known.includes(nameLC)) return true;
      }
      // Keyword-based fallback
      return BOT_KEYWORDS.some(kw => nameLC.includes(kw));
    }

    function isBotMessage(msg: any): boolean {
      if (msg.from?.application) return true;
      const fromName = (msg.from?.user?.displayName || msg.from?.application?.displayName || "").toLowerCase();
      if (knownAgentNames.has(fromName)) return true;
      for (const known of knownAgentNames) {
        if (fromName.includes(known) || known.includes(fromName)) return true;
      }
      return BOT_KEYWORDS.some(kw => fromName.includes(kw));
    }

    // Try the beta Copilot interactions API
    let interactions: any[] = [];
    try {
      const result = await graphClient.get<{ value: any[] }>(
        "https://graph.microsoft.com/beta/copilot/interactions",
        { $top: "100", $orderby: "createdDateTime desc" }
      );
      interactions = result.value || [];
    } catch (e) {
      console.warn("[Activity] Graph beta /copilot/interactions not available:", e instanceof Error ? e.message : e);
    }

    // Scan Teams chats for agent conversations
    // Uses /users/{id}/chats with app permissions (Chat.Read.All) since we use client_credentials
    let teamsBotChats: any[] = [];
    try {
      // Get a small set of active users to scan their chats
      let userIds: string[] = [];
      try {
        const usersResult = await graphClient.get<{ value: any[] }>(
          "/v1.0/users",
          { $select: "id,displayName", $top: "5", $filter: "accountEnabled eq true" }
        );
        userIds = (usersResult.value || []).map((u: any) => u.id);
      } catch (e) {
        console.warn("[Activity] Could not list users for chat scanning:", e instanceof Error ? e.message : e);
      }

      let allRecentChats: Array<{ chat: any; userId: string }> = [];
      let chatPermissionAvailable = true;

      for (const userId of userIds.slice(0, 3)) {
        if (!chatPermissionAvailable) break;
        try {
          const chatsResult = await graphClient.get<{ value: any[] }>(
            `/v1.0/users/${userId}/chats`,
            { $top: "20", $select: "id,topic,chatType,createdDateTime,lastUpdatedDateTime" }
          );
          for (const chat of (chatsResult.value || [])) {
            if (chat.chatType === "oneOnOne") {
              allRecentChats.push({ chat, userId });
            }
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.warn(`[Activity] Cannot access chats for user ${userId}: ${errMsg}`);
          if (errMsg.includes("403") || errMsg.includes("Authorization") || errMsg.includes("Forbidden") || errMsg.includes("Chat.Read")) {
            chatPermissionAvailable = false;
          }
          break;
        }
      }

      // Deduplicate by chat ID
      const seenChatIds = new Set<string>();
      allRecentChats = allRecentChats.filter(({ chat }) => {
        if (seenChatIds.has(chat.id)) return false;
        seenChatIds.add(chat.id);
        return true;
      });

      console.log(`[Activity] Scanning ${allRecentChats.length} 1:1 chats for agent conversations (${knownAgentNames.size} known agent names)`);

      // Only check members/messages for a reasonable number of chats to avoid timeouts
      for (const { chat, userId: chatUserId } of allRecentChats.slice(0, 30)) {
        try {
          const chatPath = `/v1.0/chats/${chat.id}`;

          // Fetch members
          let members: any[] = [];
          try {
            const membersResult = await graphClient.get<{ value: any[] }>(
              `${chatPath}/members`
            );
            members = membersResult.value || [];
          } catch { continue; }

          // Find bot/agent member
          const botMember = members.find((m: any) => isBotMember(m.displayName, m.roles));
          if (!botMember) continue;

          // Fetch messages for this agent chat
          const messagesResult = await graphClient.get<{ value: any[] }>(
            `${chatPath}/messages`,
            { $top: "50", $orderby: "createdDateTime desc" }
          );

          const userMember = members.find((m: any) => !isBotMember(m.displayName, m.roles));

          teamsBotChats.push({
            chatId: chat.id,
            agentName: botMember.displayName || chat.topic || "Agent",
            userName: userMember?.displayName || "User",
            userEmail: userMember?.email || "",
            createdDateTime: chat.createdDateTime,
            lastUpdatedDateTime: chat.lastUpdatedDateTime,
            messages: (messagesResult.value || []).reverse().map((msg: any) => ({
              id: msg.id,
              from: isBotMessage(msg) ? "bot" : "user",
              fromName: msg.from?.user?.displayName || msg.from?.application?.displayName || "Unknown",
              text: (msg.body?.content || "").replace(/<[^>]*>/g, "").trim(),
              timestamp: msg.createdDateTime,
            })),
          });
        } catch { /* skip inaccessible chats */ }
      }
      console.log(`[Activity] Found ${teamsBotChats.length} agent chats out of ${allRecentChats.length} scanned`);
    } catch (e) {
      console.warn("[Activity] Teams bot chats not available:", e instanceof Error ? e.message : e);
    }

    // Merge Copilot interactions into conversation format
    const copilotChats = interactions.map((i: any) => ({
      id: i.id,
      botId: "",
      botName: i.appDisplayName || i.agentDisplayName || "M365 Copilot",
      userName: i.userPrincipalName || "Unknown",
      userEmail: i.userPrincipalName || "",
      startTime: i.createdDateTime,
      createdOn: i.createdDateTime,
      isTestMode: false,
      messageCount: (i.messages || []).length || 1,
      messages: (i.messages || [{ content: i.context || "Copilot interaction" }]).map((m: any, idx: number) => ({
        id: `${i.id}-${idx}`,
        from: m.senderType === "agent" || m.senderType === "copilot" ? "bot" : "user",
        fromName: m.senderType === "agent" ? (i.agentDisplayName || "Agent") : (i.userPrincipalName || "User"),
        text: m.content || m.text || "",
        timestamp: m.createdDateTime || i.createdDateTime,
      })),
      source: "graph_copilot",
    }));

    // Convert Teams bot chats — with real message content
    const teamsChats = teamsBotChats.map((c) => ({
      id: c.chatId,
      botId: "",
      botName: c.agentName,
      userName: c.userName || c.messages.find((m: any) => m.from === "user")?.fromName || "User",
      userEmail: c.userEmail || "",
      startTime: c.createdDateTime,
      createdOn: c.createdDateTime,
      isTestMode: false,
      messageCount: c.messages.filter((m: any) => m.text).length,
      messages: c.messages.filter((m: any) => m.text),
      source: "teams_chat",
    }));

    const allChats = [...copilotChats, ...teamsChats]
      .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""))
      .slice(0, 200);

    res.json({
      chats: allChats,
      totalCount: allChats.length,
      sources: {
        copilotInteractions: copilotChats.length,
        teamsBotChats: teamsChats.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch M365 Copilot chats";
    console.error("[Activity] M365 Copilot chats error:", message);
    res.status(500).json({ error: message });
  }
});

function extractAgentName(event: any): string {
  const ext = event.ExtendedProperties || [];
  for (const prop of ext) {
    if (["AgentName", "BotName", "AppDisplayName", "CopilotAgentName"].includes(prop.Name)) {
      return prop.Value;
    }
  }
  if (event.ObjectId) {
    const parts = event.ObjectId.split("/");
    const last = parts[parts.length - 1];
    if (last && !last.includes("http") && last.length < 100) return last;
  }
  return event.Workload === "SharePoint" ? "SharePoint Agent" : "M365 Copilot Agent";
}

function extractEventDetails(event: any): string {
  const parts: string[] = [];
  if (event.Operation) parts.push(event.Operation);
  const ext = event.ExtendedProperties || [];
  for (const prop of ext) {
    if (["Query", "UserPrompt", "CopilotQuery", "RequestContent"].includes(prop.Name) && prop.Value) {
      parts.push(prop.Value.substring(0, 500));
    }
  }
  if (parts.length <= 1 && event.ObjectId) {
    parts.push(`Target: ${event.ObjectId}`);
  }
  return parts.join(" — ") || "Agent interaction";
}

/**
 * GET /api/activity/agent-permissions — Fetch app-level permissions for all service principals
 * Uses a fast approach: fetch app registrations with requiredResourceAccess,
 * then resolve role IDs from the Graph/SharePoint resource SPs (cached).
 */
router.get("/agent-permissions", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const graphToken = await getValidToken(oauthKeyId, "graph");
    const graphClient = new GraphClient(graphToken);

    const DANGEROUS_PERMISSIONS: Record<string, { level: "critical" | "high" | "medium" | "low"; category: string; isWrite: boolean }> = {
      "Sites.Read.All": { level: "high", category: "files", isWrite: false },
      "Sites.ReadWrite.All": { level: "critical", category: "files", isWrite: true },
      "Sites.FullControl.All": { level: "critical", category: "files", isWrite: true },
      "Files.Read.All": { level: "high", category: "files", isWrite: false },
      "Files.ReadWrite.All": { level: "critical", category: "files", isWrite: true },
      "Mail.Read": { level: "high", category: "mail", isWrite: false },
      "Mail.ReadWrite": { level: "critical", category: "mail", isWrite: true },
      "Mail.Send": { level: "critical", category: "mail", isWrite: true },
      "User.Read.All": { level: "medium", category: "directory", isWrite: false },
      "User.ReadWrite.All": { level: "high", category: "directory", isWrite: true },
      "Directory.Read.All": { level: "medium", category: "directory", isWrite: false },
      "Directory.ReadWrite.All": { level: "critical", category: "directory", isWrite: true },
      "Group.Read.All": { level: "medium", category: "directory", isWrite: false },
      "Group.ReadWrite.All": { level: "high", category: "directory", isWrite: true },
      "Chat.Read.All": { level: "medium", category: "communications", isWrite: false },
      "Chat.ReadWrite.All": { level: "high", category: "communications", isWrite: true },
      "ChannelMessage.Read.All": { level: "medium", category: "communications", isWrite: false },
      "Calendars.Read": { level: "medium", category: "calendar", isWrite: false },
      "Calendars.ReadWrite": { level: "high", category: "calendar", isWrite: true },
    };

    const botKeywords = ["agent", "copilot", "bot", "assistant", "help desk", "conversation"];

    // Step 1: Build a role ID → role name map from well-known resource SPs (2 API calls)
    const roleMap = new Map<string, string>();
    const resourceAppIds = [
      "00000003-0000-0000-c000-000000000000", // Microsoft Graph
      "00000003-0000-0ff1-ce00-000000000000", // SharePoint Online
    ];
    for (const resAppId of resourceAppIds) {
      try {
        const spResult = await graphClient.get<{ value: any[] }>(
          "/v1.0/servicePrincipals",
          { $filter: `appId eq '${resAppId}'`, $select: "id,appRoles" }
        );
        const sp = spResult.value?.[0];
        if (sp?.appRoles) {
          for (const role of sp.appRoles) {
            if (role.id && role.value) roleMap.set(role.id, role.value);
          }
        }
      } catch { /* ignore */ }
    }
    console.log(`[Activity] Cached ${roleMap.size} app role definitions from Graph/SharePoint`);

    // Step 2: Fetch app registrations with their requiredResourceAccess (1 paginated call)
    let apps: any[] = [];
    try {
      apps = await graphClient.getAllPages<any>(
        "/v1.0/applications",
        { $select: "id,appId,displayName,requiredResourceAccess", $top: "200" },
        3
      );
    } catch (e) {
      console.warn("[Activity] Could not fetch applications:", e instanceof Error ? e.message : e);
    }

    // Step 3: Also get granted (consented) permissions via service principal appRoleAssignments
    let spMap = new Map<string, { id: string; displayName: string; appId: string }>();
    let allAssignments: any[] = [];
    try {
      const sps = await graphClient.getAllPages<any>(
        "/v1.0/servicePrincipals",
        { $select: "id,appId,displayName,servicePrincipalType", $top: "200" },
        3
      );
      for (const sp of sps) {
        spMap.set(sp.appId, sp);
      }
      console.log(`[Activity] Found ${sps.length} service principals`);

      const spsToCheck = sps.filter((sp: any) => sp.servicePrincipalType === "Application" || botKeywords.some(kw => (sp.displayName || "").toLowerCase().includes(kw))).slice(0, 50);
      console.log(`[Activity] Checking permissions for ${spsToCheck.length} application SPs`);
      const assignmentFetches = spsToCheck.map(async (sp: any) => {
        try {
          const result = await graphClient.get<{ value: any[] }>(
            `/v1.0/servicePrincipals/${sp.id}/appRoleAssignments`,
            { $top: "50" }
          );
          return { spId: sp.id, appId: sp.appId, assignments: result.value || [] };
        } catch { return { spId: sp.id, appId: sp.appId, assignments: [] }; }
      });
      const results = await Promise.all(assignmentFetches);
      for (const r of results) {
        for (const a of r.assignments) {
          allAssignments.push({ ...a, _spAppId: r.appId });
        }
      }
    } catch (e) {
      console.warn("[Activity] Could not fetch service principals:", e instanceof Error ? e.message : e);
    }

    // Step 4: Build permission list per app
    const consentedByApp = new Map<string, any[]>();
    for (const a of allAssignments) {
      const appId = a._spAppId;
      if (!consentedByApp.has(appId)) consentedByApp.set(appId, []);
      const roleName = roleMap.get(a.appRoleId) || a.appRoleId;
      consentedByApp.get(appId)!.push({
        permission: roleName,
        resourceDisplayName: a.resourceDisplayName || "Unknown",
        isConsented: true,
      });
    }

    const agentPermissions: any[] = [];

    const processedAppIds = new Set<string>();
    for (const [appId, assignments] of consentedByApp) {
      processedAppIds.add(appId);
      const app = apps.find(a => a.appId === appId);
      const sp = spMap.get(appId);
      const displayName = app?.displayName || sp?.displayName || appId;

      const permissions = assignments.map((a: any) => {
        const dangerInfo = DANGEROUS_PERMISSIONS[a.permission];
        return {
          permission: a.permission,
          resourceDisplayName: a.resourceDisplayName,
          level: dangerInfo?.level || "low",
          category: dangerInfo?.category || "other",
          isWrite: dangerInfo?.isWrite || a.permission.toLowerCase().includes("write") || a.permission.toLowerCase().includes("send") || a.permission.toLowerCase().includes("fullcontrol"),
          isConsented: true,
        };
      });

      const nameLC = displayName.toLowerCase();
      const isAgent = botKeywords.some(kw => nameLC.includes(kw));
      const hasFileAccess = permissions.some((p: any) => p.category === "files");
      const hasWriteAccess = permissions.some((p: any) => p.isWrite);
      const criticalCount = permissions.filter((p: any) => p.level === "critical").length;
      const highCount = permissions.filter((p: any) => p.level === "high").length;

      agentPermissions.push({
        appId,
        displayName,
        servicePrincipalId: sp?.id || "",
        isAgent,
        permissions,
        summary: {
          totalPermissions: permissions.length,
          criticalCount,
          highCount,
          hasFileAccess,
          hasWriteAccess,
          filePermissions: permissions.filter((p: any) => p.category === "files").map((p: any) => p.permission),
          riskLevel: criticalCount > 0 ? "critical" : highCount > 0 ? "high" : permissions.length > 0 ? "medium" : "low",
        },
      });
    }

    // Sort: agents first, then by risk
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    agentPermissions.sort((a, b) => {
      if (a.isAgent !== b.isAgent) return a.isAgent ? -1 : 1;
      return (riskOrder[a.summary.riskLevel] || 3) - (riskOrder[b.summary.riskLevel] || 3);
    });

    res.json({
      apps: agentPermissions,
      totalApps: agentPermissions.length,
      summary: {
        withFileAccess: agentPermissions.filter(a => a.summary.hasFileAccess).length,
        withWriteAccess: agentPermissions.filter(a => a.summary.hasWriteAccess).length,
        criticalRisk: agentPermissions.filter(a => a.summary.riskLevel === "critical").length,
        agentCount: agentPermissions.filter(a => a.isAgent).length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch agent permissions";
    console.error("[Activity] Agent permissions error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
