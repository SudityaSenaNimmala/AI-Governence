import { Router } from "express";
import { getValidToken } from "../services/tokenManager.js";
import { AzureFoundryClient, AzureFoundryError } from "../services/azureFoundryClient.js";

const router = Router();

/**
 * GET /api/azure/discover?oauth_key_id=...
 * Full Azure AI discovery — OpenAI resources, AI Services, RBAC, serverless endpoints
 */
router.get("/discover", async (req, res) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    if (!oauthKeyId) {
      res.status(400).json({ error: "oauth_key_id is required" });
      return;
    }

    const azureToken = await getValidToken(oauthKeyId, "azure");
    const client = new AzureFoundryClient(azureToken);
    const result = await client.discoverAll();

    res.json(result);
  } catch (err) {
    if (err instanceof AzureFoundryError && (err.status === 401 || err.status === 403)) {
      res.status(403).json({ error: "No access to Azure Management API. Ensure Reader RBAC role is assigned on the subscription." });
      return;
    }
    const message = err instanceof Error ? err.message : "Azure discovery failed";
    console.error("Azure discovery error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
