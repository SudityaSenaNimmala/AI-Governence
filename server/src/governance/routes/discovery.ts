import { Router } from "express";
import { getValidToken, getDataverseToken } from "../services/tokenManager.js";
import { runDiscovery } from "../services/discoveryService.js";
import { PowerPlatformClient } from "../services/powerPlatformClient.js";
import { accessTokenFromRefresh } from "./googleOAuth.js";
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

    // Surfaced to the caller alongside the agents, so a partial scan is visible
    // rather than being reported as a clean one.
    const discoveryWarnings: string[] = [];

    // Power Platform token — acquired FIRST, because it is what lets us enumerate
    // the tenant's environments and therefore find the Dataverse URLs below.
    let powerPlatformToken: string | undefined;
    try {
      powerPlatformToken = await getValidToken(oauthKeyId, "power_platform");
    } catch (e) {
      console.warn("Power Platform token failed (will skip connector discovery):", e instanceof Error ? e.message : e);
    }

    // ── Dataverse environments: discover them ALL, do not ask for one ──────────
    //
    // This used to take a single dataverse_env_url typed by the admin, which made
    // coverage depend on which environment they happened to remember. Every
    // Copilot Studio agent in every other environment was invisible — and silently
    // so, because the scan reported success. For a governance product "we found
    // the agents in the one environment you named" is not an inventory.
    //
    // The environment list comes from the SAME OAuth credentials via the Power
    // Platform BAP API, and each entry carries its own Dataverse org URL in
    // properties.linkedEnvironmentMetadata.instanceUrl. A Dataverse token is
    // scoped per-org URL, so one is minted per environment.
    //
    // An explicit dataverse_env_url still wins when supplied — it is the escape
    // hatch for a tenant where the service principal has not been registered as a
    // Power Platform management app (New-PowerAppManagementApp), in which case BAP
    // returns 403 and the list comes back empty.
    const dvEnvUrls: string[] = [];
    if (dataverseEnvUrl) {
      dvEnvUrls.push(dataverseEnvUrl);
      console.log("[Discovery] Using explicitly supplied Dataverse env:", dataverseEnvUrl);
    } else if (powerPlatformToken) {
      try {
        const ppClient = new PowerPlatformClient(powerPlatformToken);
        const envs = await ppClient.listEnvironments();
        for (const env of envs) {
          const url = env.properties?.linkedEnvironmentMetadata?.instanceUrl;
          if (url) dvEnvUrls.push(url.replace(/\/$/, ""));
        }
        console.log(`[Discovery] ${envs.length} Power Platform environment(s); ${dvEnvUrls.length} with Dataverse`);
        if (envs.length > 0 && dvEnvUrls.length === 0) {
          discoveryWarnings.push("Power Platform environments were found but none has a Dataverse database, so no Copilot Studio agents could be scanned.");
        }
      } catch (e) {
        console.warn("[Discovery] Could not enumerate environments:", e instanceof Error ? e.message : e);
      }
    }

    if (dvEnvUrls.length === 0) {
      // Say so out loud. A scan that quietly skips Copilot Studio and still reports
      // success is how a tenant ends up believing it has no agents.
      discoveryWarnings.push(
        "No Dataverse environment could be discovered, so Copilot Studio agents were not scanned. " +
        "Register the app as a Power Platform management application (New-PowerAppManagementApp) so environments can be listed automatically.",
      );
    }

    // One Dataverse token per environment — the token's scope IS the org URL.
    const dataverseTokens: Array<{ url: string; token: string }> = [];
    for (const url of dvEnvUrls) {
      try {
        dataverseTokens.push({ url, token: await getDataverseToken(oauthKeyId, url) });
      } catch (e) {
        // One environment the app has no Application User in must not abort the
        // rest — record it and carry on.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[Discovery] Dataverse token failed for ${url}: ${msg}`);
        discoveryWarnings.push(`Could not access Dataverse environment ${url} — the app may not be an Application User there.`);
      }
    }
    console.log(`[Discovery] Dataverse tokens acquired: ${dataverseTokens.length}/${dvEnvUrls.length}`);

    const dataverseToken = dataverseTokens[0]?.token;
    const dvEnvUrl = dataverseTokens[0]?.url;

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
    // Set when the connection came from "Sign in with Google" instead of a
    // service-account key — the client is driven by this access token rather than
    // by a JWT exchange.
    let googleAccessToken: string | undefined;
    if (googleOauthKeyId) {
      try {
        const googleKeyDoc = await db.collection("oauth_keys").findOne({
          id: googleOauthKeyId,
          vendor: "google",
        });
        if (!googleKeyDoc) {
          console.warn("[Discovery] Google OAuth key not found or vendor is not 'google'");
        } else if (googleKeyDoc.auth_method === "oauth" && googleKeyDoc.google_refresh_token) {
          // Interactive sign-in: trade the stored refresh token for a short-lived
          // access token. A failure here is reported rather than swallowed —
          // the usual cause is the consenting admin revoking access or being
          // suspended, and a silently Google-less scan would look like "you have
          // no Google agents", which is a very different statement.
          googleAccessToken = await accessTokenFromRefresh(googleKeyDoc.google_refresh_token);
          googleAdminEmail = googleKeyDoc.google_admin_email || undefined;
          googleProjectId = googleKeyDoc.google_project_id || undefined;
          console.log("[Discovery] Google access token minted for:", googleAdminEmail);
        } else {
          googleServiceAccountKey = decrypt(googleKeyDoc.client_secret);
          googleAdminEmail = googleKeyDoc.google_admin_email || undefined;
          googleProjectId = googleKeyDoc.google_project_id || undefined;
          console.log("[Discovery] Google Workspace credentials loaded for:", googleAdminEmail);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("Google Workspace credential load failed:", msg);
        discoveryWarnings.push(`Google: ${msg}`);
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
      // Every Dataverse environment the app can reach, so Copilot Studio is
      // scanned across the whole tenant. `dataverse`/`dataverseEnvUrl` above stay
      // populated with the first entry for backward compatibility with callers
      // that still pass a single environment.
      dataverseEnvs: dataverseTokens,
      tenantId: tenantId || undefined,
      googleServiceAccountKey,
      googleAdminEmail,
      googleProjectId,
      googleAccessToken,
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

    // Merge the environment-resolution warnings in, so a scan that could not reach
    // Copilot Studio at all says so instead of returning a confident empty list.
    res.json({
      ...result,
      warnings: [...discoveryWarnings, ...(result.warnings || [])],
      dataverse_environments_scanned: dataverseTokens.map((t) => t.url),
    });
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
 * POST /api/discovery/agents — Persist agents from any platform scan.
 * Called by the dashboard after a successful multi-platform scan so data
 * survives page refresh. Upserts each agent by its id to avoid duplicates.
 */
router.post("/agents", async (req, res) => {
  try {
    const { agents } = req.body;
    if (!Array.isArray(agents) || agents.length === 0) {
      res.status(400).json({ error: "agents array is required" });
      return;
    }
    const db = getDb();
    const col = db.collection("discovered_agents");
    let upserted = 0;
    for (const agent of agents) {
      const key = agent.id || agent.appId || agent.name;
      if (!key) continue;
      await col.updateOne(
        { agent_key: key },
        { $set: { ...agent, agent_key: key, updated_at: new Date() } },
        { upsert: true },
      );
      upserted++;
    }
    res.json({ ok: true, persisted: upserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to persist agents";
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
