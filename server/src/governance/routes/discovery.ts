import { Router } from "express";
import { getValidToken, getDataverseToken } from "../services/tokenManager.js";
import { runDiscovery } from "../services/discoveryService.js";
import { getDb } from "../db.js";
import { decrypt } from "../crypto.js";

const router = Router();

interface OAuthKeyRow {
  id: string;
  vendor: string;
  client_id: string;
  client_secret: string;
  tenant_id: string | null;
  google_admin_email: string | null;
  google_project_id: string | null;
}

/**
 * Run full discovery scan combining all data sources
 * Per PRD: Poll Dataverse bot table + Power Platform connector API + Graph + O365 Audit + Google Workspace
 */
router.get("/run", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const dataverseEnvUrl = req.query.dataverse_env_url as string | undefined;
    const googleOauthKeyId = req.query.google_oauth_key_id as string | undefined;

    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id query param is required" });
      return;
    }

    const db = getDb();

    // Get oauth key info for tenant_id
    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId });
    if (!keyDoc) {
      res.status(404).json({ error: "OAuth credentials not found" });
      return;
    }
    const tenantId = keyDoc.tenant_id;

    // Acquire tokens for all APIs (Graph is required, others are best-effort)
    const graphToken = await getValidToken(oauthKeyId, "graph");

    // Dataverse token — requires specific environment URL
    let dataverseToken: string | undefined;
    const dvEnvUrl = dataverseEnvUrl || undefined;
    console.log("[Discovery] dataverse_env_url param:", JSON.stringify(dataverseEnvUrl), "| dvEnvUrl:", JSON.stringify(dvEnvUrl), "| oauthKeyId:", oauthKeyId);
    if (dvEnvUrl) {
      try {
        console.log("[Discovery] Acquiring Dataverse token for:", dvEnvUrl);
        dataverseToken = await getDataverseToken(oauthKeyId, dvEnvUrl);
        console.log("[Discovery] Dataverse token acquired successfully, length:", dataverseToken?.length);
      } catch (e) {
        console.error("[Discovery] Dataverse token FAILED:", e instanceof Error ? e.message : e);
        console.error("[Discovery] Stack:", e instanceof Error ? e.stack : "");
      }
    } else {
      console.log("[Discovery] No dataverse_env_url provided — skipping Dataverse discovery");
    }

    // Power Platform token
    let powerPlatformToken: string | undefined;
    try {
      powerPlatformToken = await getValidToken(oauthKeyId, "power_platform");
    } catch (e) {
      console.warn("Power Platform token failed (will skip connector discovery):", e instanceof Error ? e.message : e);
    }

    // O365 Audit token
    let auditToken: string | undefined;
    try {
      auditToken = await getValidToken(oauthKeyId, "audit");
    } catch (e) {
      console.warn("Audit API token failed (will skip activity monitoring):", e instanceof Error ? e.message : e);
    }

    // Azure Management token (for Azure AI Foundry discovery)
    let azureToken: string | undefined;
    try {
      azureToken = await getValidToken(oauthKeyId, "azure");
    } catch (e) {
      console.warn("Azure Management token failed (will skip AI Foundry discovery):", e instanceof Error ? e.message : e);
    }

    // Azure Cognitive Services token (for OpenAI Assistants/Agents data-plane API)
    let cognitiveServicesToken: string | undefined;
    try {
      cognitiveServicesToken = await getValidToken(oauthKeyId, "cognitiveservices");
    } catch (e) {
      console.warn("Cognitive Services token failed (will skip AI Agent/Assistant listing):", e instanceof Error ? e.message : e);
    }

    // Google Workspace credentials (optional — separate OAuth key with vendor=google)
    let googleServiceAccountKey: string | undefined;
    let googleAdminEmail: string | undefined;
    let googleProjectId: string | undefined;
    if (googleOauthKeyId) {
      try {
        const googleKeyDoc = await db.collection("oauth_keys").findOne({
          id: googleOauthKeyId,
          vendor: "google",
        });
        if (googleKeyDoc) {
          googleServiceAccountKey = decrypt(googleKeyDoc.client_secret);
          googleAdminEmail = googleKeyDoc.google_admin_email || undefined;
          googleProjectId = googleKeyDoc.google_project_id || undefined;
          console.log("[Discovery] Google Workspace credentials loaded for:", googleAdminEmail);
        } else {
          console.warn("[Discovery] Google OAuth key not found or vendor is not 'google'");
        }
      } catch (e) {
        console.warn("Google Workspace credential load failed:", e instanceof Error ? e.message : e);
      }
    }

    // Run the full discovery pipeline
    const result = await runDiscovery({
      graph: graphToken,
      dataverse: dataverseToken,
      powerPlatform: powerPlatformToken,
      audit: auditToken,
      azure: azureToken,
      cognitiveServices: cognitiveServicesToken,
      dataverseEnvUrl: dvEnvUrl,
      tenantId: tenantId || undefined,
      googleServiceAccountKey,
      googleAdminEmail,
      googleProjectId,
    });

    // Persist discovered agents so the dashboard survives a page refresh.
    // Upsert each agent by its id + tenant to avoid duplicates across runs.
    if (result.agents && result.agents.length > 0) {
      const col = db.collection("discovered_agents");
      for (const agent of result.agents) {
        const key = agent.id || agent.botId || agent.name;
        await col.updateOne(
          { agent_key: key, tenant_id: tenantId || "default" },
          { $set: { ...agent, agent_key: key, tenant_id: tenantId || "default", oauth_key_id: oauthKeyId, updated_at: new Date() } },
          { upsert: true },
        );
      }
      console.log(`[Discovery] Persisted ${result.agents.length} agents to discovered_agents`);
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";
    console.error("Discovery error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/discovery/agents — Return persisted discovered agents.
 * The dashboard calls this on load so data survives page refresh.
 */
router.get("/agents", async (req, res) => {
  try {
    const db = getDb();
    const oauthKeyId = req.query.oauth_key_id as string | undefined;
    const filter: any = {};
    if (oauthKeyId) filter.oauth_key_id = oauthKeyId;
    const agents = await db.collection("discovered_agents")
      .find(filter)
      .sort({ updated_at: -1 })
      .toArray();
    // Strip MongoDB _id
    const clean = agents.map(({ _id, ...rest }: any) => rest);
    res.json({ agents: clean, warnings: [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load agents";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/discovery/debug-dataverse — Raw Dataverse query for debugging
 * Shows all bots, botcomponents, and recent transcripts
 */
router.get("/debug-dataverse", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    const dataverseEnvUrl = req.query.dataverse_env_url as string | undefined;

    if (!oauthKeyId || !dataverseEnvUrl) {
      res.status(400).json({ error: "oauth_key_id and dataverse_env_url are required" });
      return;
    }

    const dvToken = await getDataverseToken(oauthKeyId, dataverseEnvUrl);

    const headers = {
      Authorization: `Bearer ${dvToken}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
    };
    const base = dataverseEnvUrl.startsWith("https://") ? dataverseEnvUrl : `https://${dataverseEnvUrl}`;

    // Query 1: ALL bots (minimal — just name and state)
    let bots: any[] = [];
    try {
      const r = await fetch(`${base}/api/data/v9.2/bots?$select=botid,name,schemaname,statecode,statuscode,createdon,modifiedon&$orderby=modifiedon desc`, { headers });
      const d = await r.json();
      bots = d.value || [];
    } catch (e) { bots = [{ error: e instanceof Error ? e.message : String(e) }]; }

    // Query 2: botcomponents — unique parent bot IDs
    let componentParents: any[] = [];
    try {
      const r = await fetch(`${base}/api/data/v9.2/botcomponents?$select=botcomponentid,name,componenttype,_parentbotid_value&$top=500`, { headers });
      const d = await r.json();
      const parentIds = new Map<string, { count: number; names: string[] }>();
      for (const c of (d.value || [])) {
        const pid = c._parentbotid_value || "none";
        const ex = parentIds.get(pid) || { count: 0, names: [] };
        ex.count++;
        if (c.name && !ex.names.includes(c.name)) ex.names.push(c.name);
        parentIds.set(pid, ex);
      }
      componentParents = Array.from(parentIds.entries()).map(([id, v]) => ({ parentBotId: id, componentCount: v.count, sampleNames: v.names.slice(0, 3) }));
    } catch (e) { componentParents = [{ error: e instanceof Error ? e.message : String(e) }]; }

    // Query 3: Recent transcripts
    let transcripts: any[] = [];
    try {
      const r = await fetch(`${base}/api/data/v9.2/conversationtranscripts?$select=conversationtranscriptid,name,createdon,metadata,_bot_conversationtranscriptid_value&$orderby=createdon desc&$top=20`, { headers });
      const d = await r.json();
      transcripts = (d.value || []).map((t: any) => {
        let meta: any = {};
        try { meta = JSON.parse(t.metadata || "{}"); } catch {}
        return {
          id: t.conversationtranscriptid,
          botId: t._bot_conversationtranscriptid_value,
          botName: meta.BotName || "?",
          createdOn: t.createdon,
          name: t.name,
        };
      });
    } catch (e) { transcripts = [{ error: e instanceof Error ? e.message : String(e) }]; }

    res.json({
      bots: { count: bots.length, items: bots },
      componentParents: { count: componentParents.length, items: componentParents },
      transcripts: { count: transcripts.length, items: transcripts },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Debug query failed" });
  }
});

export default router;
