import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { decrypt } from "../crypto.js";
import { getValidToken } from "../services/tokenManager.js";
import { AzureFoundryClient } from "../services/azureFoundryClient.js";
import { GoogleWorkspaceClient, type GoogleServiceAccountKey } from "../services/googleWorkspaceClient.js";
import { AZURE_PRICING, GOOGLE_PRICING, findPricing, computeCost } from "../services/pricingUtils.js";
import crypto from "node:crypto";

const router = Router();

router.get("/azure", async (req: Request, res: Response) => {
  try {
    const oauthKeyId = req.query.oauth_key_id as string;
    if (!oauthKeyId) return res.status(400).json({ error: "oauth_key_id is required" });

    const period = (req.query.period as string) || "P7D";
    const azureToken = await getValidToken(oauthKeyId, "azure");
    const client = new AzureFoundryClient(azureToken);

    const subscriptions = await client.listSubscriptions();
    const allDeploymentCosts: any[] = [];
    let totalInputTokens = 0, totalOutputTokens = 0, totalCost = 0, totalRequests = 0;

    for (const sub of subscriptions.slice(0, 5)) {
      const accounts = await client.listCognitiveAccounts(sub.subscriptionId);
      const openAIAccounts = accounts.filter((a: any) => a.kind === "OpenAI");
      for (const account of openAIAccounts) {
        const deployments = await client.listOpenAIDeployments(account.id);
        const deploymentModelMap = new Map<string, string>();
        for (const dep of deployments) deploymentModelMap.set(dep.name, dep.properties?.model?.name || "unknown");
        const metrics = await client.getOpenAIUsageMetrics(account.id, period);
        for (const dep of metrics.deployments) {
          const modelName = deploymentModelMap.get(dep.deploymentName) || dep.deploymentName;
          const pricing = findPricing(modelName, "azure");
          const cost = computeCost(dep.promptTokens, dep.completionTokens, pricing);
          allDeploymentCosts.push({
            resourceName: account.name, resourceId: account.id,
            deploymentName: dep.deploymentName, modelName,
            inputTokens: dep.promptTokens, outputTokens: dep.completionTokens,
            totalTokens: dep.totalTokens, requestCount: dep.requestCount,
            inputCost: (dep.promptTokens * pricing.input) / 1_000_000,
            outputCost: (dep.completionTokens * pricing.output) / 1_000_000,
            totalCost: cost, pricingPerMillionInput: pricing.input, pricingPerMillionOutput: pricing.output,
            vendor: "Microsoft", platform: "azure_openai",
          });
          totalInputTokens += dep.promptTokens; totalOutputTokens += dep.completionTokens;
          totalCost += cost; totalRequests += dep.requestCount;
        }
      }
    }

    const db = getDb();
    for (const dc of allDeploymentCosts) {
      try {
        await db.collection("cost_records").insertOne({
          id: crypto.randomUUID(),
          agent_id: dc.deploymentName, agent_name: `${dc.resourceName}/${dc.deploymentName}`,
          vendor: dc.vendor, platform: dc.platform, model_name: dc.modelName,
          input_tokens: dc.inputTokens, output_tokens: dc.outputTokens,
          total_tokens: dc.totalTokens, request_count: dc.requestCount,
          input_cost: dc.inputCost, output_cost: dc.outputCost, total_cost: dc.totalCost,
          period, recorded_at: new Date(),
        });
      } catch { /* table may not exist yet */ }
    }

    res.json({
      vendor: "Microsoft", period, deployments: allDeploymentCosts,
      summary: { totalInputTokens, totalOutputTokens, totalTokens: totalInputTokens + totalOutputTokens, totalRequests, totalCost: Math.round(totalCost * 10000) / 10000 },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Azure cost fetch error:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch Azure cost data" });
  }
});

router.get("/google", async (req: Request, res: Response) => {
  try {
    let oauthKeyId = req.query.oauth_key_id as string;
    const db = getDb();

    if (!oauthKeyId) {
      const googleKey = await db.collection("oauth_keys").findOne({ vendor: "google" });
      if (!googleKey) return res.status(400).json({ error: "No Google credentials found" });
      oauthKeyId = googleKey.id;
    }

    const periodDays = parseInt(req.query.period as string) || 7;

    const keyDoc = await db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "google" });
    if (!keyDoc) return res.status(404).json({ error: "Google credentials not found" });

    const serviceAccountJson = decrypt(keyDoc.client_secret);
    const keyObj: GoogleServiceAccountKey = JSON.parse(serviceAccountJson);
    const adminEmail = keyDoc.google_admin_email || keyObj.client_email;
    const projectId = keyDoc.google_project_id || keyObj.project_id;

    const client = new GoogleWorkspaceClient(keyObj, adminEmail, projectId);
    const metrics = await client.getVertexAIUsageMetrics(periodDays);

    const endpointCosts = metrics.endpoints.map((ep) => {
      const pricing = findPricing(ep.displayName, "google");
      const cost = computeCost(ep.inputTokenCount, ep.outputTokenCount, pricing);
      return {
        endpointId: ep.endpointId, displayName: ep.displayName, modelName: ep.displayName,
        inputTokens: ep.inputTokenCount, outputTokens: ep.outputTokenCount, totalTokens: ep.totalTokenCount,
        requestCount: ep.predictionCount,
        inputCost: (ep.inputTokenCount * pricing.input) / 1_000_000,
        outputCost: (ep.outputTokenCount * pricing.output) / 1_000_000,
        totalCost: cost, pricingPerMillionInput: pricing.input, pricingPerMillionOutput: pricing.output,
        vendor: "Google", platform: "vertex_ai",
      };
    });

    for (const ec of endpointCosts) {
      try {
        await db.collection("cost_records").insertOne({
          id: crypto.randomUUID(),
          agent_id: ec.endpointId, agent_name: ec.displayName,
          vendor: ec.vendor, platform: ec.platform, model_name: ec.modelName,
          input_tokens: ec.inputTokens, output_tokens: ec.outputTokens,
          total_tokens: ec.totalTokens, request_count: ec.requestCount,
          input_cost: ec.inputCost, output_cost: ec.outputCost, total_cost: ec.totalCost,
          period: `P${periodDays}D`, recorded_at: new Date(),
        });
      } catch { /* table may not exist yet */ }
    }

    const totalCost = endpointCosts.reduce((s, e) => s + e.totalCost, 0);
    res.json({
      vendor: "Google", period: `P${periodDays}D`, projectId,
      endpoints: endpointCosts,
      summary: { totalInputTokens: metrics.totalInputTokens, totalOutputTokens: metrics.totalOutputTokens, totalTokens: metrics.totalTokens, totalPredictions: metrics.totalPredictions, totalCost: Math.round(totalCost * 10000) / 10000 },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Google cost fetch error:", err.message);
    res.status(500).json({ error: err.message || "Failed to fetch Google cost data" });
  }
});

router.get("/history", async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const vendor = req.query.vendor as string;

  try {
    const db = getDb();
    const filter: Record<string, any> = {};
    if (vendor) filter.vendor = vendor;

    const rows = await db.collection("cost_records")
      .find(filter)
      .sort({ recorded_at: -1 })
      .limit(limit)
      .toArray();

    res.json({ records: rows, total: rows.length });
  } catch {
    res.json({ records: [], total: 0 });
  }
});

router.get("/pricing", (_req: Request, res: Response) => {
  res.json({
    azure: AZURE_PRICING,
    google: GOOGLE_PRICING,
    note: "Pricing in USD per 1M tokens. Actual costs may vary based on your Azure/GCP agreements.",
  });
});

export default router;
