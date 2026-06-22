import { Router } from "express";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { GoogleWorkspaceClient, GoogleWorkspaceError, type GoogleServiceAccountKey, type GoogleChatBot, type GoogleWorkspaceDiscoveryResult } from "../services/googleWorkspaceClient.js";
import crypto from "node:crypto";

const router = Router();

// ── Helpers ───────────────────────────────────────────

/**
 * Aggregate raw chat bots (one entry per space) into unique bots
 * with a list of all spaces they are installed in.
 */
function aggregateChatBots(bots: GoogleChatBot[]) {
  const map = new Map<string, {
    id: string;
    displayName: string;
    spaces: string[];
    spaceTypes: string[];
    spaceUris: string[];
    humanParticipants: string[];
    adminInstalled: boolean;
    singleUserBotDm: boolean;
    firstSeen: string;
  }>();

  for (const bot of bots) {
    const key = bot.botName;
    const existing = map.get(key);
    const betterName = bot.botDisplayName && !bot.botDisplayName.startsWith("users/")
      ? bot.botDisplayName : null;

    if (existing) {
      if (!existing.spaces.includes(bot.spaceName)) existing.spaces.push(bot.spaceName);
      if (!existing.spaceTypes.includes(bot.spaceType)) existing.spaceTypes.push(bot.spaceType);
      if (bot.spaceUri && !existing.spaceUris.includes(bot.spaceUri)) existing.spaceUris.push(bot.spaceUri);
      if (bot.humanParticipant && !existing.humanParticipants.includes(bot.humanParticipant)) existing.humanParticipants.push(bot.humanParticipant);
      if (bot.adminInstalled) existing.adminInstalled = true;
      if (bot.singleUserBotDm) existing.singleUserBotDm = true;
      if (betterName && (!existing.displayName || existing.displayName.startsWith("users/") || existing.displayName.startsWith("Chat Bot"))) {
        existing.displayName = betterName;
      }
    } else {
      map.set(key, {
        id: bot.botName,
        displayName: betterName || bot.botDisplayName || bot.botName,
        spaces: [bot.spaceName],
        spaceTypes: [bot.spaceType],
        spaceUris: bot.spaceUri ? [bot.spaceUri] : [],
        humanParticipants: bot.humanParticipant ? [bot.humanParticipant] : [],
        adminInstalled: bot.adminInstalled,
        singleUserBotDm: bot.singleUserBotDm || false,
        firstSeen: bot.createTime || new Date().toISOString(),
      });
    }
  }

  return Array.from(map.values());
}

function transformForFrontend(r: GoogleWorkspaceDiscoveryResult) {
  const reasoningEngines = r.vertexReasoningEngines.map(re => ({
    id: re.name, name: re.name, displayName: re.displayName, description: re.description || "",
    region: re.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
    createTime: re.createTime, updateTime: re.updateTime,
    pythonVersion: re.spec?.packageSpec?.pythonVersion, labels: re.labels || {},
  }));
  const agentBuilderApps = r.agentBuilderApps.map(app => ({
    id: app.name, name: app.name, displayName: app.displayName,
    solutionType: (app.solutionType || "").replace("SOLUTION_TYPE_", "").toLowerCase(),
    dataStoreCount: app.dataStoreIds?.length || 0, dataStoreIds: app.dataStoreIds || [],
    createTime: app.createTime, updateTime: app.updateTime,
    location: app.name.split("/locations/")[1]?.split("/")[0] || "global",
  }));
  const dialogflowAgents = r.dialogflowAgents.map(a => ({
    id: a.name, name: a.name, displayName: a.displayName, description: a.description || "",
    region: a.region || "global", language: a.defaultLanguageCode || "en", timeZone: a.timeZone,
    locked: a.locked || false, loggingEnabled: a.enableStackdriverLogging || false,
  }));
  const chatBots = aggregateChatBots(r.chatBots);
  const endpoints = r.vertexEndpoints.map(ep => ({
    id: ep.name, name: ep.name, displayName: ep.displayName, description: ep.description || "",
    region: ep.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
    createTime: ep.createTime, deployedModels: ep.deployedModels || [],
  }));
  const models = r.vertexModels.map(m => ({
    id: m.name, name: m.name, displayName: m.displayName, description: m.description || "",
    region: m.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
    createTime: m.createTime, modelSourceInfo: m.modelSourceInfo,
    sourceType: m.modelSourceInfo?.sourceType || "CUSTOM",
  }));
  const extensions = r.vertexExtensions.map(ext => ({
    id: ext.name, name: ext.name, displayName: ext.displayName, description: ext.description || "",
    region: ext.name.split("/locations/")[1]?.split("/")[0] || "us-central1", createTime: ext.createTime,
  }));
  const dataStores = r.agentBuilderDataStores.map(ds => ({
    id: ds.name, displayName: ds.displayName, contentConfig: ds.contentConfig || "CONTENT_REQUIRED", createTime: ds.createTime,
  }));
  const pipelineJobs = (r.vertexPipelineJobs || []).map(pj => ({
    id: pj.name, name: pj.name, displayName: pj.displayName,
    state: pj.state || "UNKNOWN",
    region: pj.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
    createTime: pj.createTime, updateTime: pj.updateTime,
    startTime: pj.startTime, endTime: pj.endTime,
    pipelineName: pj.pipelineSpec?.pipelineInfo?.name || "",
    templateUri: pj.templateUri, labels: pj.labels || {},
  }));
  const notebookLMNotebooks = (r.notebookLMNotebooks || []).map(nb => ({
    id: nb.name, name: nb.name, displayName: nb.displayName || nb.name.split("/").pop() || "Notebook",
    createTime: nb.createTime, updateTime: nb.updateTime,
    creator: nb.creator, sourceCount: nb.sourceCount || 0,
  }));
  const cloudFunctions = (r.cloudFunctions || []).map(fn => {
    const shortName = fn.name.split("/").pop() || fn.name;
    return {
      id: fn.name, name: fn.name, displayName: shortName,
      state: fn.state || "ACTIVE",
      region: fn.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
      runtime: fn.buildConfig?.runtime || "unknown",
      createTime: fn.createTime, updateTime: fn.updateTime,
      labels: fn.labels || {},
      serviceAccountEmail: fn.serviceConfig?.serviceAccountEmail,
      url: fn.serviceConfig?.uri,
    };
  });
  const cloudRunServices = (r.cloudRunServices || []).map(svc => {
    const shortName = svc.name.split("/").pop() || svc.name;
    return {
      id: svc.name, name: svc.name, displayName: shortName,
      description: svc.description || "",
      region: svc.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
      createTime: svc.createTime, updateTime: svc.updateTime,
      uri: svc.uri, labels: svc.labels || {},
    };
  });

  return {
    reasoningEngines, agentBuilderApps, dialogflowAgents, chatBots,
    endpoints, models, extensions, dataStores,
    pipelineJobs, notebookLMNotebooks, cloudFunctions, cloudRunServices,
    vertexReasoningEngines: reasoningEngines,
    vertexEndpoints: endpoints,
    vertexModels: models,
    vertexExtensions: extensions,
    oauthApps: r.oauthApps,
    geminiWorkspace: {
      enabled: r.geminiEnabled, licensedUsers: r.geminiLicensedCount,
      features: ["Gmail", "Docs", "Sheets", "Slides", "Meet", "Drive", "Chat"],
      domain: r.domain, riskLevel: r.geminiEnabled ? "high" : "none",
      appUsage: r.geminiAppUsage || [],
    },
    geminiEnabled: r.geminiEnabled,
    geminiLicensedCount: r.geminiLicensedCount,
    geminiAppUsage: r.geminiAppUsage || [],
    geminiUserAppUsage: r.geminiUserAppUsage || [],
    gems: r.gems || [],
    workspaceUsers: r.workspaceUsers,
    projectId: r.projectId, domain: r.domain, warnings: r.warnings,
  };
}

// Helper to load a Google key doc from MongoDB
async function loadGoogleKey(oauthKeyId?: string) {
  const db = getDb();
  if (oauthKeyId) {
    return db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "google" });
  }
  return db.collection("oauth_keys").findOne({ vendor: "google" }, { sort: { created_at: -1 } });
}

router.post("/connect", async (req, res) => {
  try {
    const { service_account_json, gcp_project_id, admin_email } = req.body;
    const db = getDb();

    if (service_account_json === "__USE_EXISTING__") {
      const existing = await db.collection("oauth_keys").findOne({ vendor: "google" });
      if (!existing) {
        res.status(400).json({ error: "No saved Google credentials found. Please upload the service account JSON." });
        return;
      }
      const keyId = existing.id;
      const updateFields: Record<string, any> = { updated_at: new Date() };
      if (admin_email) updateFields.google_admin_email = admin_email;
      if (gcp_project_id) updateFields.google_project_id = gcp_project_id;
      if (Object.keys(updateFields).length > 1) {
        await db.collection("oauth_keys").updateOne({ id: keyId }, { $set: updateFields });
      }
      res.json({ success: true, id: keyId, keyId, projectId: gcp_project_id || existing.google_project_id });
      return;
    }

    if (!service_account_json) {
      res.status(400).json({ error: "service_account_json is required" });
      return;
    }

    let keyObj: GoogleServiceAccountKey;
    try {
      keyObj = JSON.parse(service_account_json);
    } catch {
      res.status(400).json({ error: "Invalid JSON — upload the .json key file or paste the complete file contents" });
      return;
    }

    if (!keyObj.private_key || !keyObj.client_email) {
      res.status(400).json({ error: "Invalid service account key — must contain private_key and client_email" });
      return;
    }

    const projectId = gcp_project_id || keyObj.project_id || "";
    const clientEmail = keyObj.client_email;
    const adminEmail = admin_email || clientEmail;

    const existing = await db.collection("oauth_keys").findOne({ vendor: "google" });

    let keyId: string;
    const encryptedSecret = encrypt(service_account_json);

    if (existing) {
      keyId = existing.id;
      await db.collection("oauth_keys").updateOne(
        { id: keyId },
        { $set: { client_id: clientEmail, client_secret: encryptedSecret, google_project_id: projectId, google_admin_email: adminEmail, updated_at: new Date() } }
      );
    } else {
      keyId = crypto.randomUUID();
      await db.collection("oauth_keys").insertOne({
        id: keyId,
        vendor: "google",
        client_id: clientEmail,
        client_secret: encryptedSecret,
        google_admin_email: adminEmail,
        google_project_id: projectId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    let verified = false;
    let verifyMessage = "";
    try {
      const client = new GoogleWorkspaceClient(keyObj, clientEmail, projectId);
      await client.listVertexEndpoints("us-central1");
      verified = true;
      verifyMessage = "Vertex AI connection verified";
    } catch (e) {
      if (e instanceof GoogleWorkspaceError && e.status === 403) {
        verifyMessage = "Service account authenticated but may need Vertex AI Viewer role for full discovery";
        verified = true;
      } else {
        verifyMessage = `Connection test: ${e instanceof Error ? e.message : "unknown error"}`;
      }
    }

    res.json({ id: keyId, vendor: "google", client_email: clientEmail, project_id: projectId, verified, message: verifyMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save Google credentials";
    console.error("Google connect error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/discover", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const gKey = await loadGoogleKey(oauthKeyId || undefined);
    if (!gKey) {
      res.status(oauthKeyId ? 404 : 400).json({ error: oauthKeyId ? "Google credentials not found" : "No Google credentials found. Connect Google Cloud first." });
      return;
    }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const result = await client.discoverAll();
    res.json(transformForFrontend(result));
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "Google authentication failed. Check service account key and permissions." });
      return;
    }
    const message = err instanceof Error ? err.message : "Google discovery failed";
    console.error("Google discover error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/conversations", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const gKey = await loadGoogleKey();
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const conversations = await client.fetchAgentConversations(days);

    res.json({
      conversations,
      totalConversations: conversations.length,
      totalMessages: conversations.reduce((sum, c) => sum + c.messageCount, 0),
      uniqueUsers: new Set(conversations.map(c => c.userEmail)).size,
      uniqueAgents: new Set(conversations.map(c => c.agentName)).size,
      periodDays: days,
    });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "No access to Cloud Logging. Ensure the service account has Logs Viewer role." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch conversations";
    console.error("Google conversations error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/gemini-activity", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const gKey = await loadGoogleKey();
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const activity = await client.fetchGeminiActivity(days);

    res.json({ ...activity, totalEvents: activity.events.length, totalUsers: activity.userSummary.length, periodDays: days });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "No access to Admin Reports API. Ensure admin.reports.audit.readonly scope is authorized." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Gemini activity";
    console.error("Google Gemini activity error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/gemini-vault", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const userEmails = req.query.users ? String(req.query.users).split(",").filter(Boolean) : [];
    const gKey = await loadGoogleKey();
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const vaultData = await client.fetchGeminiVaultData(days, userEmails);

    res.json({ ...vaultData, periodDays: days });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "No access to Google Vault. Ensure eDiscovery scope is authorized in Domain-Wide Delegation." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Vault data";
    console.error("Google Vault error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/usage", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const gKey = await loadGoogleKey();
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const keyObj: GoogleServiceAccountKey = JSON.parse(decrypt(gKey.client_secret));
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const usage = await client.getVertexAIUsageMetrics(days);

    res.json({ vendor: "Google / Vertex AI", period: `P${days}D`, ...usage });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "No access to Cloud Monitoring. Ensure the monitoring.read scope is authorized in Domain-Wide Delegation." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Vertex AI usage";
    console.error("Google Vertex usage error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/gemini-usage", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const gKey = await loadGoogleKey();
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const keyObj: GoogleServiceAccountKey = JSON.parse(decrypt(gKey.client_secret));
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const { platforms, perUser } = await client.fetchGeminiPerAppUsage(days);

    res.json({ vendor: "Google / Gemini", period: `P${days}D`, platforms, perUser, totalUsers: perUser.length, totalPlatforms: platforms.length });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "No access to Admin Reports API. Ensure admin.reports.audit.readonly scope is authorized." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Gemini usage";
    console.error("Google Gemini usage error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/scan-platform", async (req, res) => {
  const platform = req.query.platform as string;
  const oauthKeyId = req.query.oauth_key_id as string | undefined;

  const VALID = ["reasoning_engines", "agent_builder", "chat_bots", "gems", "notebooklm"];
  if (!VALID.includes(platform)) {
    res.status(400).json({ error: `Unknown platform "${platform}". Valid: ${VALID.join(", ")}` });
    return;
  }

  try {
    const gKey = await loadGoogleKey(oauthKeyId);
    if (!gKey) {
      res.status(oauthKeyId ? 404 : 400).json({ error: oauthKeyId ? "Google credentials not found" : "No Google credentials found. Connect Google Cloud first." });
      return;
    }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;
    const domain = adminEmail.split("@")[1] || "unknown";

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);

    switch (platform) {
      case "reasoning_engines": {
        const raw = await client.discoverReasoningEnginesOnly();
        const vertexReasoningEngines = raw.map(re => ({
          id: re.name, name: re.name, displayName: re.displayName, description: re.description || "",
          region: re.name.split("/locations/")[1]?.split("/")[0] || "us-central1",
          createTime: re.createTime, updateTime: re.updateTime,
          pythonVersion: (re as any).spec?.packageSpec?.pythonVersion, labels: (re as any).labels || {},
        }));
        res.json({ platform, vertexReasoningEngines, projectId, domain, warnings: [] });
        break;
      }
      case "agent_builder": {
        const raw = await client.discoverAgentBuilder();
        const agentBuilderApps = raw.apps.map(app => ({
          id: app.name, name: app.name, displayName: app.displayName,
          solutionType: ((app as any).solutionType || "").replace("SOLUTION_TYPE_", "").toLowerCase(),
          dataStoreCount: (app as any).dataStoreIds?.length || 0, dataStoreIds: (app as any).dataStoreIds || [],
          createTime: (app as any).createTime, updateTime: (app as any).updateTime,
          location: app.name.split("/locations/")[1]?.split("/")[0] || "global",
        }));
        res.json({ platform, agentBuilderApps, projectId, domain, warnings: [] });
        break;
      }
      case "chat_bots": {
        const raw = await client.discoverChatBots();
        const chatBots = aggregateChatBots(raw);
        res.json({ platform, chatBots, projectId, domain, warnings: [] });
        break;
      }
      case "gems": {
        const gems = await client.discoverGems();
        res.json({ platform, gems, projectId, domain, warnings: [] });
        break;
      }
      case "notebooklm": {
        const raw = await client.discoverNotebookLM();
        const notebookLMNotebooks = raw.map(nb => ({
          id: nb.name, name: nb.name, displayName: (nb as any).displayName || nb.name.split("/").pop() || "Notebook",
          createTime: (nb as any).createTime, updateTime: (nb as any).updateTime,
          creator: (nb as any).creator, sourceCount: (nb as any).sourceCount || 0,
        }));
        res.json({ platform, notebookLMNotebooks, projectId, domain, warnings: [] });
        break;
      }
    }
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: `Google auth failed for platform "${platform}". Check service account permissions.`, platform });
      return;
    }
    const message = err instanceof Error ? err.message : `Google platform scan failed for "${platform}"`;
    console.error(`Google scan-platform [${platform}] error:`, message);
    res.status(500).json({ error: message, platform });
  }
});

router.get("/user-activity", async (req, res) => {
  const oauthKeyId = req.query.oauth_key_id as string | undefined;
  try {
    const gKey = await loadGoogleKey(oauthKeyId);
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);

    const [conversationsResult, discoveryResult] = await Promise.allSettled([
      client.fetchAgentConversations(7),
      client.discoverAll(),
    ]);

    const chats: Array<any> = [];
    if (conversationsResult.status === "fulfilled") {
      for (const conv of conversationsResult.value) {
        chats.push({
          id: conv.id, sessionId: conv.id,
          userName: conv.userName || conv.userEmail || "Unknown",
          userEmail: conv.userEmail || "",
          botName: conv.agentName || "Google AI", botId: conv.agentName || "",
          messages: (conv.messages || []).map(m => ({ id: m.id, role: m.from === "bot" ? "assistant" : "user", content: m.text || "", timestamp: m.timestamp })),
          createdAt: conv.startTime, updatedAt: conv.lastMessageTime, containsSensitive: false,
        });
      }
    }

    const knowledge: Array<any> = [];
    const files: Array<any> = [];

    if (discoveryResult.status === "fulfilled") {
      const result = discoveryResult.value;
      const agentInputs: Array<{ platform: string; id: string; name: string }> = [];
      for (const ab of result.agentBuilderApps || []) agentInputs.push({ platform: "agent_builder", id: ab.name, name: ab.displayName });
      for (const re of result.vertexReasoningEngines || []) agentInputs.push({ platform: "reasoning_engine", id: re.name, name: re.displayName });
      for (const gem of result.gems || []) agentInputs.push({ platform: "gemini_gem", id: gem.id, name: gem.name });
      for (const nb of result.notebookLMNotebooks || []) agentInputs.push({ platform: "notebooklm", id: nb.name, name: (nb as { displayName?: string }).displayName || nb.name.split("/").pop() || "Notebook" });
      for (const bot of result.chatBots || []) agentInputs.push({ platform: "google_chat", id: bot.botName, name: bot.botDisplayName });

      const BATCH = 5;
      for (let i = 0; i < agentInputs.length; i += BATCH) {
        const batch = agentInputs.slice(i, i + BATCH);
        const batchResults = await Promise.allSettled(
          batch.map(a => client.getAgentDetails(a.platform, a.id).then(details => ({ agent: a, details })))
        );
        for (const r of batchResults) {
          if (r.status !== "fulfilled") continue;
          const { agent, details } = r.value;
          if (details.knowledge?.length) {
            knowledge.push({
              botId: agent.id, botName: agent.name,
              sources: details.knowledge.map((k, idx) => ({
                type: k.type, name: k.name, url: k.url, metadata: k.metadata, addedOn: k.addedOn, componentId: `${agent.id}-k-${idx}`,
              })),
            });
          }
          for (const act of (details.fileActivity || [])) {
            files.push({
              id: act.id, fileName: act.target, filePath: agent.name,
              userName: act.user || "unknown", userId: act.user || "",
              operation: act.operation, workload: agent.platform, timestamp: act.timestamp,
              relatedAgents: [{ name: agent.name, botId: agent.id }],
            });
          }
          for (const f of (details.files || [])) {
            if (!f.modifiedTime) continue;
            files.push({
              id: `${f.id}-file`, fileName: f.name, filePath: agent.name,
              userName: f.owner || "unknown", userId: f.owner || "",
              operation: "Modified", workload: agent.platform, timestamp: f.modifiedTime,
              relatedAgents: [{ name: agent.name, botId: agent.id }],
            });
          }
        }
      }
    }

    res.json({
      chats, chatsLastUpdated: new Date().toISOString(),
      files, filesLastUpdated: new Date().toISOString(),
      knowledge, knowledgeLastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "Google auth failed. Check service account permissions." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Google user activity";
    console.error("Google user-activity error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/agent-details", async (req, res) => {
  const platform = req.query.platform as string;
  const agentId = req.query.id as string;
  const oauthKeyId = req.query.oauth_key_id as string | undefined;

  const VALID = ["agent_builder", "gemini_gem", "reasoning_engine", "google_chat", "notebooklm"];
  if (!VALID.includes(platform)) { res.status(400).json({ error: `Invalid platform. Must be one of: ${VALID.join(", ")}` }); return; }
  if (!agentId) { res.status(400).json({ error: "Missing required query param: id" }); return; }

  try {
    const gKey = await loadGoogleKey(oauthKeyId);
    if (!gKey) { res.status(400).json({ error: "No Google credentials found. Connect Google Cloud first." }); return; }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const details = await client.getAgentDetails(platform, agentId);
    res.json(details);
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: `Google auth failed for platform "${platform}". Check service account permissions.`, platform });
      return;
    }
    const message = err instanceof Error ? err.message : "Agent details fetch failed";
    console.error(`Google agent-details [${platform}/${agentId}] error:`, message);
    res.status(500).json({ error: message, platform, agentId });
  }
});

router.get("/debug-gems", async (_req, res) => {
  try {
    const gKey = await loadGoogleKey();
    if (!gKey) { res.status(400).json({ error: "No Google credentials found." }); return; }

    const serviceAccountJson = decrypt(gKey.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = gKey.google_admin_email || keyObj.client_email;
    const projectId = gKey.google_project_id || keyObj.project_id;
    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const results = await client.debugGeminiAudit();
    res.json(results);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
