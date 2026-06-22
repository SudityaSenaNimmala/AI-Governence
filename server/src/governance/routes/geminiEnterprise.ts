import { Router } from "express";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { GoogleWorkspaceClient, GoogleWorkspaceError, type GoogleServiceAccountKey } from "../services/googleWorkspaceClient.js";

const router = Router();

const DEFAULT_LOCATION = "global";
const DEFAULT_COLLECTION = "default_collection";

async function loadKey(oauthKeyId?: string) {
  const db = getDb();
  if (oauthKeyId) {
    return db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "gemini_enterprise" });
  }
  return db.collection("oauth_keys").findOne({ vendor: "gemini_enterprise" }, { sort: { updated_at: -1 } });
}

function clientFromKey(row: any) {
  const serviceAccountJson = decrypt(row.client_secret);
  const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
  const adminEmail = row.google_admin_email || keyObj.client_email;
  const projectId = row.google_project_id || keyObj.project_id;
  const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
  return {
    client,
    engineId: row.gemini_engine_id || "",
    location: row.gemini_location || DEFAULT_LOCATION,
    collection: row.gemini_collection || DEFAULT_COLLECTION,
  };
}

router.post("/connect", async (req, res) => {
  try {
    const { service_account_json, gcp_project_id, engine_id, location, collection, admin_email } = req.body;

    if (!engine_id || !String(engine_id).trim()) {
      res.status(400).json({ error: "engine_id (the Gemini Enterprise app ID / cid) is required" });
      return;
    }
    const loc = (location && String(location).trim()) || DEFAULT_LOCATION;
    const coll = (collection && String(collection).trim()) || DEFAULT_COLLECTION;

    let keyId: string;
    let keyObj: GoogleServiceAccountKey;
    let projectId: string;
    let adminEmail: string;
    const db = getDb();

    if (service_account_json === "__USE_EXISTING__") {
      const existing = await loadKey();
      if (!existing) {
        res.status(400).json({ error: "No saved Gemini Enterprise credentials found. Upload the service account JSON." });
        return;
      }
      keyId = existing.id as string;
      keyObj = JSON.parse(decrypt(existing.client_secret));
      projectId = gcp_project_id || existing.google_project_id || keyObj.project_id;
      adminEmail = admin_email || existing.google_admin_email || keyObj.client_email;
      await db.collection("oauth_keys").updateOne(
        { id: keyId },
        { $set: { google_project_id: projectId, google_admin_email: adminEmail, gemini_engine_id: String(engine_id).trim(), gemini_location: loc, gemini_collection: coll, updated_at: new Date() } }
      );
    } else {
      if (!service_account_json) {
        res.status(400).json({ error: "service_account_json is required" });
        return;
      }
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
      projectId = gcp_project_id || keyObj.project_id || "";
      adminEmail = admin_email || keyObj.client_email;
      const encryptedSecret = encrypt(service_account_json);

      const existing = await loadKey();
      if (existing) {
        keyId = existing.id as string;
        await db.collection("oauth_keys").updateOne(
          { id: keyId },
          { $set: { client_id: keyObj.client_email, client_secret: encryptedSecret, google_project_id: projectId, google_admin_email: adminEmail, gemini_engine_id: String(engine_id).trim(), gemini_location: loc, gemini_collection: coll, updated_at: new Date() } }
        );
      } else {
        const { randomUUID } = await import("node:crypto");
        keyId = randomUUID();
        await db.collection("oauth_keys").insertOne({
          id: keyId,
          vendor: "gemini_enterprise",
          client_id: keyObj.client_email,
          client_secret: encryptedSecret,
          google_admin_email: adminEmail,
          google_project_id: projectId,
          gemini_engine_id: String(engine_id).trim(),
          gemini_location: loc,
          gemini_collection: coll,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }

    let verified = false;
    let verifyMessage = "";
    try {
      const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
      const result = await client.discoverGeminiEnterprise(String(engine_id).trim(), loc, coll);
      verified = true;
      verifyMessage = `Connected to "${result.engine.displayName}" — ${result.agents.length} agent(s), ${result.chats.length} chat(s)`;
    } catch (e) {
      if (e instanceof GoogleWorkspaceError && e.status === 403) {
        verified = true;
        verifyMessage = "Service account authenticated but may need Discovery Engine Viewer role for full discovery";
      } else {
        verifyMessage = `Connection test: ${e instanceof Error ? e.message : "unknown error"}`;
      }
    }

    res.json({ id: keyId, vendor: "gemini_enterprise", project_id: projectId, engine_id: String(engine_id).trim(), location: loc, collection: coll, verified, message: verifyMessage });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save Gemini Enterprise credentials";
    console.error("Gemini Enterprise connect error:", message);
    res.status(500).json({ error: message });
  }
});

router.get("/data", async (req, res) => {
  const oauthKeyId = req.query.oauth_key_id as string | undefined;
  try {
    const row = await loadKey(oauthKeyId);
    if (!row) { res.status(400).json({ error: "No Gemini Enterprise credentials found. Connect Gemini Enterprise first." }); return; }
    if (!row.gemini_engine_id) { res.status(400).json({ error: "No Gemini Enterprise app ID configured. Reconnect with the app ID (cid)." }); return; }

    const { client, engineId, location, collection } = clientFromKey(row);
    const result = await client.discoverGeminiEnterprise(engineId, location, collection);

    res.json({ ...result, lastUpdated: new Date().toISOString() });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "Google auth failed. Ensure the service account has the Discovery Engine Viewer role on the project." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Gemini Enterprise data";
    console.error("Gemini Enterprise data error:", message);
    res.status(500).json({ error: message });
  }
});

router.post("/preview", async (req, res) => {
  try {
    const { access_token, project_id, engine_id, location, collection } = req.body;
    if (!access_token) { res.status(400).json({ error: "access_token is required" }); return; }
    if (!project_id) { res.status(400).json({ error: "project_id is required" }); return; }
    if (!engine_id) { res.status(400).json({ error: "engine_id is required" }); return; }
    const loc = (location && String(location).trim()) || DEFAULT_LOCATION;
    const coll = (collection && String(collection).trim()) || DEFAULT_COLLECTION;

    const stubKey = { client_email: "token@local", private_key: "", project_id } as GoogleServiceAccountKey;
    const client = new GoogleWorkspaceClient(stubKey, "", project_id);
    client.useAccessToken(String(access_token).trim(), project_id);

    const result = await client.discoverGeminiEnterprise(String(engine_id).trim(), loc, coll);
    res.json({ ...result, lastUpdated: new Date().toISOString() });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "Access token rejected or expired. Run `gcloud auth print-access-token` again and paste a fresh token." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Gemini Enterprise data";
    console.error("Gemini Enterprise preview error:", message);
    res.status(500).json({ error: message });
  }
});

const GE_USD_PER_1K_REQUESTS = 2.0;

router.post("/cost", async (req, res) => {
  try {
    const { access_token, project_id, oauth_key_id, period } = req.body;
    const periodDays = parseInt(String(period)) || 7;

    let client: GoogleWorkspaceClient;
    if (access_token) {
      if (!project_id) { res.status(400).json({ error: "project_id is required with access_token" }); return; }
      const stubKey = { client_email: "token@local", private_key: "", project_id } as GoogleServiceAccountKey;
      client = new GoogleWorkspaceClient(stubKey, "", project_id);
      client.useAccessToken(String(access_token).trim(), project_id);
    } else {
      const row = await loadKey(oauth_key_id);
      if (!row) { res.status(400).json({ error: "No Gemini Enterprise credentials found." }); return; }
      ({ client } = clientFromKey(row));
    }

    const usage = await client.getGeminiEnterpriseUsageMetrics(periodDays);
    const methods = usage.methods.map((m) => ({
      ...m,
      estimatedCost: Math.round((m.requestCount / 1000) * GE_USD_PER_1K_REQUESTS * 10000) / 10000,
    }));
    const totalCost = Math.round((usage.totalRequests / 1000) * GE_USD_PER_1K_REQUESTS * 10000) / 10000;

    res.json({
      vendor: "Gemini Enterprise", period: `P${periodDays}D`,
      totalRequests: usage.totalRequests, methods,
      ratePer1kRequests: GE_USD_PER_1K_REQUESTS,
      estimatedTotalCost: totalCost, fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "Access token rejected/expired, or missing Monitoring Viewer access for cost metrics." });
      return;
    }
    const message = err instanceof Error ? err.message : "Failed to fetch Gemini Enterprise cost";
    console.error("Gemini Enterprise cost error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
