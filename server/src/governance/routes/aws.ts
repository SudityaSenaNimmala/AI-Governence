import { Router } from "express";
import { getDb } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import crypto from "node:crypto";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import {
  BedrockAgentClient,
  ListAgentsCommand,
  ListKnowledgeBasesCommand,
} from "@aws-sdk/client-bedrock-agent";
import { SageMakerClient, ListEndpointsCommand, ListModelsCommand } from "@aws-sdk/client-sagemaker";
import {
  CloudWatchClient,
  GetMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

const router = Router();

// ── Pricing (per 1M tokens) ──

const AWS_BEDROCK_PRICING: Record<string, { input: number; output: number }> = {
  "anthropic.claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic.claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "anthropic.claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "anthropic.claude-3-haiku": { input: 0.25, output: 1.25 },
  "anthropic.claude-3-opus": { input: 15.0, output: 75.0 },
  "amazon.titan-text-express": { input: 0.20, output: 0.60 },
  "amazon.titan-text-lite": { input: 0.15, output: 0.20 },
  "amazon.titan-text-premier": { input: 0.50, output: 1.50 },
  "amazon.nova-pro": { input: 0.80, output: 3.20 },
  "amazon.nova-lite": { input: 0.06, output: 0.24 },
  "amazon.nova-micro": { input: 0.035, output: 0.14 },
  "meta.llama3-70b": { input: 2.65, output: 3.50 },
  "meta.llama3-8b": { input: 0.30, output: 0.60 },
  "mistral.mixtral-8x7b": { input: 0.45, output: 0.70 },
  "mistral.mistral-large": { input: 4.0, output: 12.0 },
  "cohere.command-r-plus": { input: 3.0, output: 15.0 },
  "cohere.command-r": { input: 0.50, output: 1.50 },
  "ai21.jamba-1-5-large": { input: 2.0, output: 8.0 },
};

function getBedrockModelPrice(model: string) {
  const lower = model.toLowerCase();
  for (const [key, price] of Object.entries(AWS_BEDROCK_PRICING)) {
    if (lower.includes(key)) return price;
  }
  return { input: 1.0, output: 3.0 };
}

// ── Helpers ──

function awsCredentials(accessKeyId: string, secretAccessKey: string, sessionToken?: string | null) {
  const creds: any = { accessKeyId, secretAccessKey };
  if (sessionToken) creds.sessionToken = sessionToken;
  return creds;
}

async function loadAWSKey(oauthKeyId: string) {
  const db = getDb();
  const row = await db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "aws" });
  if (!row) {
    const e: any = new Error("AWS credentials not found");
    e.status = 404;
    throw e;
  }
  return {
    accessKeyId: row.client_id,
    secretAccessKey: decrypt(row.client_secret),
    region: row.tenant_id || "us-east-1",
    accountId: row.google_project_id || null,
    sessionToken: row.redirect_uri ? decrypt(row.redirect_uri) : null,
  };
}

// ── POST /connect ──

router.post("/connect", async (req, res) => {
  try {
    const { access_key_id, secret_access_key, region, account_id, session_token } =
      req.body as {
        access_key_id?: string;
        secret_access_key?: string;
        region?: string;
        account_id?: string;
        session_token?: string;
      };

    if (!access_key_id?.trim()) return res.status(400).json({ error: "Access Key ID is required" });
    if (!region?.trim()) return res.status(400).json({ error: "AWS Region is required" });

    const db = getDb();

    // Reconnect with saved credentials
    if (access_key_id.trim() === "__USE_EXISTING__") {
      const existing = await db.collection("oauth_keys").findOne({ vendor: "aws" });
      if (!existing) return res.status(404).json({ error: "No saved AWS credentials found" });
      return res.json({ id: existing.id, vendor: "aws", connected: true });
    }

    if (!secret_access_key?.trim()) return res.status(400).json({ error: "Secret Access Key is required" });

    // Validate credentials via STS GetCallerIdentity
    const stsClient = new STSClient({
      region: region.trim(),
      credentials: awsCredentials(access_key_id.trim(), secret_access_key.trim(), session_token?.trim()),
    });
    try {
      const identity = await stsClient.send(new GetCallerIdentityCommand({}));
      // identity.Account contains the AWS account ID
    } catch (stsErr: any) {
      return res.status(400).json({
        error: `Invalid AWS credentials: ${stsErr?.message || "Authentication failed"}`,
      });
    }

    // Encrypt and store
    const encryptedSecret = encrypt(secret_access_key.trim());
    const encryptedSession = session_token?.trim() ? encrypt(session_token.trim()) : null;
    const existing = await db.collection("oauth_keys").findOne({ vendor: "aws" });

    let id: string;
    if (existing) {
      id = existing.id;
      const updates: Record<string, any> = {
        client_id: access_key_id.trim(),
        client_secret: encryptedSecret,
        tenant_id: region.trim(),
        updated_at: new Date(),
      };
      if (account_id?.trim()) updates.google_project_id = account_id.trim();
      if (encryptedSession) updates.redirect_uri = encryptedSession;
      await db.collection("oauth_keys").updateOne({ id }, { $set: updates });
    } else {
      id = crypto.randomUUID();
      await db.collection("oauth_keys").insertOne({
        id,
        vendor: "aws",
        client_id: access_key_id.trim(),
        client_secret: encryptedSecret,
        tenant_id: region.trim(),
        google_project_id: account_id?.trim() || null,
        redirect_uri: encryptedSession,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    res.json({ id, vendor: "aws", connected: true });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message || "Failed to connect AWS" });
  }
});

// ── GET /scan-platform ──

router.get("/scan-platform", async (req, res) => {
  try {
    const { oauth_key_id, platform } = req.query as { oauth_key_id?: string; platform?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });
    if (!platform) return res.status(400).json({ error: "platform required" });

    const { accessKeyId, secretAccessKey, region, sessionToken } = await loadAWSKey(oauth_key_id);
    const creds = awsCredentials(accessKeyId, secretAccessKey, sessionToken);
    const warnings: string[] = [];

    if (platform === "bedrock_agents") {
      try {
        const agentClient = new BedrockAgentClient({ region, credentials: creds });
        const [agentsRes, kbRes] = await Promise.all([
          agentClient.send(new ListAgentsCommand({ maxResults: 100 })).catch((e: any) => {
            warnings.push(`ListAgents: ${e.message}`);
            return { agentSummaries: [] };
          }),
          agentClient.send(new ListKnowledgeBasesCommand({ maxResults: 100 })).catch((e: any) => {
            warnings.push(`ListKnowledgeBases: ${e.message}`);
            return { knowledgeBaseSummaries: [] };
          }),
        ]);

        const agents = (agentsRes.agentSummaries || []).map((a: any) => ({
          id: a.agentId,
          name: a.agentName || `Agent ${a.agentId}`,
          description: a.description || null,
          status: a.agentStatus || "unknown",
          created_at: a.updatedAt?.toISOString() || null,
          foundationModel: a.foundationModel || null,
          type: "bedrock_agent",
        }));

        const knowledgeBases = (kbRes.knowledgeBaseSummaries || []).map((kb: any) => ({
          id: kb.knowledgeBaseId,
          name: kb.name || `KB ${kb.knowledgeBaseId}`,
          description: kb.description || null,
          status: kb.status || "unknown",
          created_at: kb.updatedAt?.toISOString() || null,
          type: "bedrock_knowledge_base",
        }));

        return res.json({ platform: "bedrock_agents", agents, knowledgeBases, warnings });
      } catch (e: any) {
        warnings.push(`Bedrock Agent API error: ${e.message}`);
        return res.json({ platform: "bedrock_agents", agents: [], knowledgeBases: [], warnings });
      }
    }

    if (platform === "bedrock_models") {
      try {
        const bedrockClient = new BedrockClient({ region, credentials: creds });
        const modelsRes = await bedrockClient.send(new ListFoundationModelsCommand({}));
        const models = (modelsRes.modelSummaries || []).map((m: any) => ({
          id: m.modelId,
          name: m.modelName || m.modelId,
          provider: m.providerName || "Unknown",
          inputModalities: m.inputModalities || [],
          outputModalities: m.outputModalities || [],
          customizable: m.customizationsSupported?.length > 0,
          inferenceTypes: m.inferenceTypesSupported || [],
          type: "bedrock_model",
        }));
        return res.json({ platform: "bedrock_models", models, warnings });
      } catch (e: any) {
        warnings.push(`Bedrock Models API error: ${e.message}`);
        return res.json({ platform: "bedrock_models", models: [], warnings });
      }
    }

    if (platform === "sagemaker_endpoints") {
      try {
        const smClient = new SageMakerClient({ region, credentials: creds });
        const [endpointsRes, modelsRes] = await Promise.all([
          smClient.send(new ListEndpointsCommand({ MaxResults: 100 })).catch((e: any) => {
            warnings.push(`ListEndpoints: ${e.message}`);
            return { Endpoints: [] };
          }),
          smClient.send(new ListModelsCommand({ MaxResults: 100 })).catch((e: any) => {
            warnings.push(`ListModels: ${e.message}`);
            return { Models: [] };
          }),
        ]);

        const endpoints = (endpointsRes.Endpoints || []).map((ep: any) => ({
          id: ep.EndpointName,
          name: ep.EndpointName,
          status: ep.EndpointStatus || "unknown",
          created_at: ep.CreationTime?.toISOString() || null,
          last_modified: ep.LastModifiedTime?.toISOString() || null,
          type: "sagemaker_endpoint",
        }));

        const models = (modelsRes.Models || []).map((m: any) => ({
          id: m.ModelName,
          name: m.ModelName,
          created_at: m.CreationTime?.toISOString() || null,
          type: "sagemaker_model",
        }));

        return res.json({ platform: "sagemaker_endpoints", endpoints, models, warnings });
      } catch (e: any) {
        warnings.push(`SageMaker API error: ${e.message}`);
        return res.json({ platform: "sagemaker_endpoints", endpoints: [], models: [], warnings });
      }
    }

    return res.status(400).json({ error: `Unknown platform: ${platform}` });
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message || "Scan failed" });
  }
});

// ── GET /usage ──

router.get("/usage", async (req, res) => {
  try {
    const { oauth_key_id, period = "7" } = req.query as { oauth_key_id?: string; period?: string };
    if (!oauth_key_id) return res.status(400).json({ error: "oauth_key_id required" });

    const { accessKeyId, secretAccessKey, region, sessionToken } = await loadAWSKey(oauth_key_id);
    const creds = awsCredentials(accessKeyId, secretAccessKey, sessionToken);
    const days = parseInt(period) || 7;
    const warnings: string[] = [];

    const cwClient = new CloudWatchClient({ region, credentials: creds });
    const now = new Date();
    const startTime = new Date(now.getTime() - days * 86400 * 1000);

    try {
      const metricsRes = await cwClient.send(
        new GetMetricDataCommand({
          StartTime: startTime,
          EndTime: now,
          MetricDataQueries: [
            {
              Id: "invocations",
              MetricStat: {
                Metric: {
                  Namespace: "AWS/Bedrock",
                  MetricName: "Invocations",
                },
                Period: days * 86400,
                Stat: "Sum",
              },
            },
            {
              Id: "inputTokens",
              MetricStat: {
                Metric: {
                  Namespace: "AWS/Bedrock",
                  MetricName: "InputTokenCount",
                },
                Period: days * 86400,
                Stat: "Sum",
              },
            },
            {
              Id: "outputTokens",
              MetricStat: {
                Metric: {
                  Namespace: "AWS/Bedrock",
                  MetricName: "OutputTokenCount",
                },
                Period: days * 86400,
                Stat: "Sum",
              },
            },
          ],
        })
      );

      const results = metricsRes.MetricDataResults || [];
      const invocations = results.find((r: any) => r.Id === "invocations");
      const inputTok = results.find((r: any) => r.Id === "inputTokens");
      const outputTok = results.find((r: any) => r.Id === "outputTokens");

      const totalInputTokens = (inputTok?.Values || []).reduce((s: number, v: number) => s + v, 0);
      const totalOutputTokens = (outputTok?.Values || []).reduce((s: number, v: number) => s + v, 0);
      const totalInvocations = (invocations?.Values || []).reduce((s: number, v: number) => s + v, 0);

      // Use default Bedrock pricing for aggregate cost estimate
      const defaultPricing = { input: 1.0, output: 3.0 };
      const totalCost =
        (totalInputTokens * defaultPricing.input + totalOutputTokens * defaultPricing.output) / 1_000_000;

      return res.json({
        vendor: "AWS Bedrock",
        period: `P${days}D`,
        deployments: [
          {
            deploymentName: "Bedrock (aggregate)",
            modelName: "All Models",
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
            requestCount: totalInvocations,
            inputCost: (totalInputTokens * defaultPricing.input) / 1_000_000,
            outputCost: (totalOutputTokens * defaultPricing.output) / 1_000_000,
            totalCost,
          },
        ],
        summary: {
          totalTokens: totalInputTokens + totalOutputTokens,
          totalRequests: totalInvocations,
          totalCost,
        },
        warnings,
      });
    } catch (e: any) {
      warnings.push(`CloudWatch metrics unavailable: ${e.message}`);
      return res.json({
        vendor: "AWS Bedrock",
        period: `P${days}D`,
        deployments: [],
        summary: { totalTokens: 0, totalRequests: 0, totalCost: 0 },
        warnings,
      });
    }
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err.message || "Failed to fetch usage" });
  }
});

export default router;
