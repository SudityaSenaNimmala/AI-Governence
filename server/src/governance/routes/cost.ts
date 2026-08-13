import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { googleClientFromKey } from "../services/googleCredentials.js";
import { decrypt } from "../crypto.js";
import { getValidToken } from "../services/tokenManager.js";
import { AzureFoundryClient } from "../services/azureFoundryClient.js";
import { GoogleWorkspaceClient, type GoogleServiceAccountKey } from "../services/googleWorkspaceClient.js";
import { AZURE_PRICING, GOOGLE_PRICING, findPricing, computeCost, inferModelFromDeploymentName } from "../services/pricingUtils.js";
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
          // Resolve model name: deployment map → infer from deployment name → single-deployment fallback
          let modelName = deploymentModelMap.get(dep.deploymentName) || "";
          let modelEstimated = false;
          if (!modelName || modelName === "unknown") {
            // Try to infer from the deployment name itself (e.g. "gpt-4o-deployment" → "gpt-4o")
            const inferred = inferModelFromDeploymentName(dep.deploymentName, "azure");
            if (inferred) {
              modelName = inferred;
            } else if (dep.deploymentName === "unknown" && deploymentModelMap.size === 1) {
              // Metrics lack deployment metadata — use the only available deployment
              const [onlyDepName, onlyModel] = [...deploymentModelMap.entries()][0];
              modelName = onlyModel !== "unknown" ? onlyModel : (inferModelFromDeploymentName(onlyDepName, "azure") || onlyDepName);
            } else if (dep.deploymentName !== "unknown") {
              // Use deployment name as-is (may contain model hint)
              modelName = dep.deploymentName;
            } else {
              modelName = "unknown";
              modelEstimated = true;
            }
          }
          const pricing = findPricing(modelName, "azure");
          // Also estimated when the model matched no pricing entry: the Azure
          // fallback is gpt-4o list price, so an unrecognised deployment name was
          // priced as gpt-4o and shown as a firm figure. modelEstimated alone only
          // caught the literal "unknown" case.
          if (!pricing.matched) modelEstimated = true;
          const cost = computeCost(dep.promptTokens, dep.completionTokens, pricing);
          allDeploymentCosts.push({
            resourceName: account.name, resourceId: account.id,
            deploymentName: dep.deploymentName === "unknown" && deploymentModelMap.size === 1
              ? [...deploymentModelMap.keys()][0] : dep.deploymentName,
            modelName,
            inputTokens: dep.promptTokens, outputTokens: dep.completionTokens,
            totalTokens: dep.totalTokens, requestCount: dep.requestCount,
            inputCost: (dep.promptTokens * pricing.input) / 1_000_000,
            outputCost: (dep.completionTokens * pricing.output) / 1_000_000,
            totalCost: cost, pricingPerMillionInput: pricing.input, pricingPerMillionOutput: pricing.output,
            vendor: "Microsoft", platform: "azure_openai",
            costEstimated: modelEstimated,
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

    // Handles both credential shapes — an interactive-sign-in row has no
    // service-account JSON to parse.
    const { client, projectId } = await googleClientFromKey(keyDoc);
    const metrics = await client.getVertexAIUsageMetrics(periodDays);

    const endpointCosts = metrics.endpoints.map((ep) => {
      const pricing = findPricing(ep.displayName, "google");
      const cost = computeCost(ep.inputTokenCount, ep.outputTokenCount, pricing);
      // Requests happened, but Vertex reported no token counts for this endpoint —
      // its token metrics are only published for some model families.
      //
      // Cost is UNKNOWN here, not zero. Multiplying 0 tokens by a rate produced
      // $0.00 for an endpoint with 10 real predictions, and the Cost tab presented
      // that as "this agent costs nothing" rather than "we could not measure it".
      // Under-reporting spend as zero is the one direction a cost view must not fail
      // in, so these are surfaced as null and counted separately.
      const tokensUnavailable = ep.predictionCount > 0 && ep.inputTokenCount === 0 && ep.outputTokenCount === 0;
      return {
        endpointId: ep.endpointId, displayName: ep.displayName, modelName: ep.displayName,
        inputTokens: ep.inputTokenCount, outputTokens: ep.outputTokenCount, totalTokens: ep.totalTokenCount,
        requestCount: ep.predictionCount,
        tokensUnavailable,
        inputCost: tokensUnavailable ? null : (ep.inputTokenCount * pricing.input) / 1_000_000,
        outputCost: tokensUnavailable ? null : (ep.outputTokenCount * pricing.output) / 1_000_000,
        totalCost: tokensUnavailable ? null : cost,
        pricingPerMillionInput: pricing.input, pricingPerMillionOutput: pricing.output,
        // Vertex endpoints are matched by display name, which is user-chosen, so an
        // unmatched one gets the generic Google fallback rate rather than a real price.
        costEstimated: !pricing.matched,
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
          // null, not 0, when tokens were unavailable — history must not record a
          // measured-zero for something that was never measured.
          input_cost: ec.inputCost, output_cost: ec.outputCost, total_cost: ec.totalCost,
          cost_unavailable: ec.tokensUnavailable,
          period: `P${periodDays}D`, recorded_at: new Date(),
        });
      } catch { /* table may not exist yet */ }
    }

    // ?? 0 so an unmeasurable endpoint does not turn the whole total into NaN.
    const totalCost = endpointCosts.reduce((s, e) => s + (e.totalCost ?? 0), 0);
    const unmeasured = endpointCosts.filter(e => e.tokensUnavailable);
    res.json({
      vendor: "Google", period: `P${periodDays}D`, projectId,
      endpoints: endpointCosts,
      summary: {
        totalInputTokens: metrics.totalInputTokens, totalOutputTokens: metrics.totalOutputTokens,
        totalTokens: metrics.totalTokens, totalPredictions: metrics.totalPredictions,
        totalCost: Math.round(totalCost * 10000) / 10000,
        // The total above is a LOWER BOUND when this is non-zero. Stated explicitly
        // so the UI can say so instead of presenting a partial sum as complete.
        endpointsWithUnknownCost: unmeasured.length,
        requestsWithUnknownCost: unmeasured.reduce((s, e) => s + (e.requestCount || 0), 0),
      },
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
