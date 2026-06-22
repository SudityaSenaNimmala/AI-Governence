/**
 * Azure AI Foundry Client — Comprehensive AI resource discovery
 * Discovers:
 *   1. ML Workspaces (AI Foundry hubs & projects)
 *   2. Online Endpoints / Deployments in workspaces
 *   3. Azure OpenAI accounts + model deployments (GPT-4, GPT-4o, etc.)
 *   4. AI Services (Cognitive Services) accounts
 *   5. Serverless endpoints (model-as-a-service)
 *   6. RBAC role assignments on AI resources
 *
 * Requires: Reader RBAC role on Azure subscription
 */

const AZURE_MGMT_BASE = "https://management.azure.com";

// ── Types ──────────────────────────────────────────

export interface AzureWorkspace {
  id: string;
  name: string;
  type: string;
  kind?: string; // "Default" | "Hub" | "Project"
  location: string;
  properties: {
    friendlyName?: string;
    description?: string;
    creationTime?: string;
    provisioningState?: string;
    workspaceId?: string;
    hubResourceId?: string; // for Project kind
  };
  tags?: Record<string, string>;
}

export interface AzureDeployment {
  id: string;
  name: string;
  type: string;
  properties: {
    provisioningState?: string;
    createdAt?: string;
    updatedAt?: string;
    model?: {
      format?: string;
      name?: string;
      version?: string;
    };
    scaleSettings?: {
      scaleType?: string;
    };
  };
}

export interface AzureOpenAIAccount {
  id: string;
  name: string;
  kind: string; // "OpenAI" | "CognitiveServices" | "TextAnalytics" etc.
  location: string;
  sku?: { name: string; tier?: string };
  properties: {
    provisioningState?: string;
    endpoint?: string;
    dateCreated?: string;
    customSubDomainName?: string;
    publicNetworkAccess?: string;
    networkAcls?: { defaultAction?: string };
    disableLocalAuth?: boolean;
  };
  tags?: Record<string, string>;
}

export interface AzureOpenAIDeployment {
  id: string;
  name: string;
  properties: {
    model?: {
      format?: string;
      name?: string;   // e.g. "gpt-4o", "gpt-35-turbo", "dall-e-3"
      version?: string;
    };
    provisioningState?: string;
    raiPolicyName?: string; // Content filter policy
    versionUpgradeOption?: string;
    capabilities?: Record<string, string>;
    rateLimits?: Array<{
      key?: string;
      count?: number;
      renewalPeriod?: number;
    }>;
    scaleSettings?: {
      scaleType?: string;
      capacity?: number; // TPM (tokens per minute)
    };
  };
  sku?: { name: string; capacity?: number };
}

export interface AzureRoleAssignment {
  id: string;
  properties: {
    roleDefinitionId: string;
    principalId: string;
    principalType: string; // "User" | "Group" | "ServicePrincipal"
    scope: string;
  };
}

export interface AzureRoleDefinition {
  id: string;
  properties: {
    roleName: string;
    description?: string;
    type: string; // "BuiltInRole" | "CustomRole"
  };
}

export interface ServerlessEndpoint {
  id: string;
  name: string;
  location: string;
  properties: {
    modelSettings?: {
      modelId?: string;
    };
    provisioningState?: string;
    inferenceEndpoint?: {
      uri?: string;
    };
    endpointState?: string;
    marketplaceSubscriptionId?: string;
  };
}

/** Azure AI Agent / OpenAI Assistant */
export interface AzureAIAgent {
  id: string;
  object: string;          // "assistant"
  name: string | null;
  description: string | null;
  model: string;           // e.g. "gpt-4o", "gpt-4"
  instructions: string | null;
  tools: Array<{
    type: string;          // "code_interpreter" | "file_search" | "function"
    function?: { name: string; description?: string };
  }>;
  metadata: Record<string, string>;
  created_at: number;      // Unix timestamp
  temperature?: number;
  top_p?: number;
  response_format?: unknown;
}

// ── Unified result types ──────────────────────────

export interface AzureFoundryAgent {
  id: string;
  name: string;
  workspaceName: string;
  workspaceId: string;
  location: string;
  description?: string;
  modelName?: string;
  modelVersion?: string;
  provisioningState?: string;
  createdAt?: string;
  updatedAt?: string;
  subscriptionId: string;
  resourceGroup: string;
}

export interface AzureOpenAIResource {
  id: string;
  name: string;
  location: string;
  endpoint?: string;
  kind: string;
  skuName?: string;
  publicAccess?: string;
  localAuthDisabled?: boolean;
  createdAt?: string;
  subscriptionId: string;
  resourceGroup: string;
  deployments: AzureOpenAIModelDeployment[];
}

export interface AzureOpenAIModelDeployment {
  id: string;
  name: string;
  modelName: string;
  modelVersion?: string;
  modelFormat?: string;
  provisioningState?: string;
  contentFilter?: string;
  capacityTPM?: number;
  scaleType?: string;
  skuName?: string;
  rateLimits?: Array<{ key?: string; count?: number; renewalPeriod?: number }>;
  versionUpgrade?: string;
}

export interface AzureAIServiceAccount {
  id: string;
  name: string;
  kind: string;
  location: string;
  endpoint?: string;
  skuName?: string;
  publicAccess?: string;
  subscriptionId: string;
  resourceGroup: string;
}

export interface AzureResourceAccess {
  resourceId: string;
  principalId: string;
  principalType: string;
  roleName: string;
  roleType: string;
  scope: string;
}

export interface AzureAIDiscoveryResult {
  foundryAgents: AzureFoundryAgent[];
  openAIResources: AzureOpenAIResource[];
  aiAgents: Array<AzureAIAgent & { resourceName: string; endpoint: string; subscriptionId: string; resourceGroup: string }>;
  aiServices: AzureAIServiceAccount[];
  accessControl: AzureResourceAccess[];
  serverlessEndpoints: Array<{
    id: string;
    name: string;
    modelId?: string;
    state?: string;
    endpoint?: string;
    location: string;
    workspaceName: string;
    subscriptionId: string;
    resourceGroup: string;
  }>;
  subscriptions: Array<{ id: string; name: string }>;
}

// ── Client ──────────────────────────────────────────

export class AzureFoundryClient {
  private token: string;
  private cognitiveServicesToken?: string;

  constructor(token: string, cognitiveServicesToken?: string) {
    this.token = token;
    this.cognitiveServicesToken = cognitiveServicesToken;
  }

  private async fetchWithRetry(url: string, retries = 2): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 429 && retries > 0) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "10");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.fetchWithRetry(url, retries - 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new AzureFoundryError(response.status, body, url);
    }

    return response;
  }

  private async fetchSafe<T>(url: string): Promise<T[]> {
    try {
      const response = await this.fetchWithRetry(url);
      const data = await response.json();
      return data.value || [];
    } catch (e) {
      if (e instanceof AzureFoundryError && (e.status === 401 || e.status === 403 || e.status === 404)) {
        return [];
      }
      throw e;
    }
  }

  private parseResourceId(id: string): { subscriptionId: string; resourceGroup: string } {
    const parts = id.split("/");
    const subIdx = parts.indexOf("subscriptions");
    const rgIdx = parts.indexOf("resourceGroups");
    return {
      subscriptionId: subIdx >= 0 ? parts[subIdx + 1] : "unknown",
      resourceGroup: rgIdx >= 0 ? parts[rgIdx + 1] : "unknown",
    };
  }

  // ── Subscriptions ──────────────────────────────────

  async listSubscriptions(): Promise<Array<{ subscriptionId: string; displayName: string }>> {
    const url = `${AZURE_MGMT_BASE}/subscriptions?api-version=2022-12-01`;
    const subs = await this.fetchSafe<{ subscriptionId: string; displayName: string }>(url);
    return subs.map((s) => ({ subscriptionId: s.subscriptionId, displayName: s.displayName }));
  }

  // ── ML Workspaces ──────────────────────────────────

  async listWorkspaces(subscriptionId: string): Promise<AzureWorkspace[]> {
    const url = `${AZURE_MGMT_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.MachineLearningServices/workspaces?api-version=2024-10-01`;
    return this.fetchSafe<AzureWorkspace>(url);
  }

  async listDeployments(workspaceResourceId: string): Promise<AzureDeployment[]> {
    const url = `${AZURE_MGMT_BASE}${workspaceResourceId}/onlineEndpoints?api-version=2024-10-01`;
    return this.fetchSafe<AzureDeployment>(url);
  }

  async listServerlessEndpoints(workspaceResourceId: string): Promise<ServerlessEndpoint[]> {
    const url = `${AZURE_MGMT_BASE}${workspaceResourceId}/serverlessEndpoints?api-version=2024-10-01`;
    return this.fetchSafe<ServerlessEndpoint>(url);
  }

  // ── Azure OpenAI ──────────────────────────────────

  async listCognitiveAccounts(subscriptionId: string): Promise<AzureOpenAIAccount[]> {
    const url = `${AZURE_MGMT_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CognitiveServices/accounts?api-version=2024-10-01`;
    return this.fetchSafe<AzureOpenAIAccount>(url);
  }

  async listOpenAIDeployments(accountResourceId: string): Promise<AzureOpenAIDeployment[]> {
    const url = `${AZURE_MGMT_BASE}${accountResourceId}/deployments?api-version=2024-10-01`;
    return this.fetchSafe<AzureOpenAIDeployment>(url);
  }

  // ── RBAC ──────────────────────────────────────────

  async listRoleAssignments(resourceId: string): Promise<AzureRoleAssignment[]> {
    const url = `${AZURE_MGMT_BASE}${resourceId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=atScope()`;
    return this.fetchSafe<AzureRoleAssignment>(url);
  }

  async getRoleDefinition(roleDefId: string): Promise<AzureRoleDefinition | null> {
    try {
      const response = await this.fetchWithRetry(`${AZURE_MGMT_BASE}${roleDefId}?api-version=2022-04-01`);
      return await response.json();
    } catch {
      return null;
    }
  }

  // ── Azure AI Agents (OpenAI Assistants API) ───────

  /**
   * List AI Agents/Assistants deployed on an Azure OpenAI resource
   * Uses the data-plane API: GET {endpoint}/openai/assistants?api-version=2025-03-01-preview
   * Requires cognitiveServicesToken (scoped to https://cognitiveservices.azure.com/.default)
   */
  async listAssistants(endpoint: string): Promise<AzureAIAgent[]> {
    if (!this.cognitiveServicesToken) return [];

    const url = `${endpoint.replace(/\/$/, "")}/openai/assistants?api-version=2025-03-01-preview&limit=100`;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.cognitiveServicesToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) return [];
        return [];
      }

      const data = await response.json();
      return data.data || [];
    } catch {
      return [];
    }
  }

  // ── Threads & Messages (Assistants API data-plane) ──

  async listThreads(endpoint: string, limit = 20): Promise<any[]> {
    if (!this.cognitiveServicesToken) return [];
    const url = `${endpoint.replace(/\/$/, "")}/openai/threads?api-version=2025-03-01-preview&limit=${limit}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cognitiveServicesToken}`, "Content-Type": "application/json" },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.data || [];
    } catch {
      return [];
    }
  }

  async getThreadMessages(endpoint: string, threadId: string, limit = 50): Promise<any[]> {
    if (!this.cognitiveServicesToken) return [];
    const url = `${endpoint.replace(/\/$/, "")}/openai/threads/${threadId}/messages?api-version=2025-03-01-preview&limit=${limit}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cognitiveServicesToken}`, "Content-Type": "application/json" },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.data || [];
    } catch {
      return [];
    }
  }

  async listAssistantFiles(endpoint: string, assistantId: string): Promise<any[]> {
    if (!this.cognitiveServicesToken) return [];
    const url = `${endpoint.replace(/\/$/, "")}/openai/assistants/${assistantId}/files?api-version=2025-03-01-preview`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cognitiveServicesToken}`, "Content-Type": "application/json" },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return data.data || [];
    } catch {
      return [];
    }
  }

  // ── Full discovery ────────────────────────────────

  async discoverAll(): Promise<AzureAIDiscoveryResult> {
    const result: AzureAIDiscoveryResult = {
      foundryAgents: [],
      openAIResources: [],
      aiAgents: [],
      aiServices: [],
      accessControl: [],
      serverlessEndpoints: [],
      subscriptions: [],
    };

    const subscriptions = await this.listSubscriptions();
    result.subscriptions = subscriptions.map((s) => ({ id: s.subscriptionId, name: s.displayName }));

    // Cache role definitions to avoid repeated lookups
    const roleDefCache = new Map<string, string>();

    for (const sub of subscriptions.slice(0, 5)) {
      // ── 1. ML Workspaces + Deployments + Serverless ──
      const workspaces = await this.listWorkspaces(sub.subscriptionId);
      for (const ws of workspaces) {
        const { resourceGroup } = this.parseResourceId(ws.id);

        result.foundryAgents.push({
          id: ws.properties.workspaceId || ws.id,
          name: ws.properties.friendlyName || ws.name,
          workspaceName: ws.name,
          workspaceId: ws.id,
          location: ws.location,
          description: ws.properties.description,
          provisioningState: ws.properties.provisioningState,
          createdAt: ws.properties.creationTime,
          subscriptionId: sub.subscriptionId,
          resourceGroup,
        });

        // Online endpoint deployments
        const deployments = await this.listDeployments(ws.id);
        for (const dep of deployments) {
          result.foundryAgents.push({
            id: `${ws.id}/deployments/${dep.name}`,
            name: `${ws.properties.friendlyName || ws.name} — ${dep.name}`,
            workspaceName: ws.name,
            workspaceId: ws.id,
            location: ws.location,
            modelName: dep.properties.model?.name,
            modelVersion: dep.properties.model?.version,
            provisioningState: dep.properties.provisioningState,
            createdAt: dep.properties.createdAt,
            updatedAt: dep.properties.updatedAt,
            subscriptionId: sub.subscriptionId,
            resourceGroup,
          });
        }

        // Serverless model-as-a-service endpoints
        const serverless = await this.listServerlessEndpoints(ws.id);
        for (const ep of serverless) {
          result.serverlessEndpoints.push({
            id: ep.id,
            name: ep.name,
            modelId: ep.properties.modelSettings?.modelId,
            state: ep.properties.endpointState || ep.properties.provisioningState,
            endpoint: ep.properties.inferenceEndpoint?.uri,
            location: ep.location,
            workspaceName: ws.properties.friendlyName || ws.name,
            subscriptionId: sub.subscriptionId,
            resourceGroup,
          });
        }
      }

      // ── 2. Azure OpenAI + AI Services ──
      const cognitiveAccounts = await this.listCognitiveAccounts(sub.subscriptionId);

      for (const account of cognitiveAccounts) {
        const { resourceGroup } = this.parseResourceId(account.id);
        const isOpenAI = account.kind === "OpenAI";

        if (isOpenAI) {
          // Azure OpenAI resource with deployments
          const deployments = await this.listOpenAIDeployments(account.id);
          result.openAIResources.push({
            id: account.id,
            name: account.name,
            location: account.location,
            endpoint: account.properties.endpoint || (account.properties.customSubDomainName ? `https://${account.properties.customSubDomainName}.openai.azure.com` : undefined),
            kind: account.kind,
            skuName: account.sku?.name,
            publicAccess: account.properties.publicNetworkAccess,
            localAuthDisabled: account.properties.disableLocalAuth,
            createdAt: account.properties.dateCreated,
            subscriptionId: sub.subscriptionId,
            resourceGroup,
            deployments: deployments.map((d) => ({
              id: d.id,
              name: d.name,
              modelName: d.properties.model?.name || "unknown",
              modelVersion: d.properties.model?.version,
              modelFormat: d.properties.model?.format,
              provisioningState: d.properties.provisioningState,
              contentFilter: d.properties.raiPolicyName,
              capacityTPM: d.sku?.capacity || d.properties.scaleSettings?.capacity,
              scaleType: d.properties.scaleSettings?.scaleType,
              skuName: d.sku?.name,
              rateLimits: d.properties.rateLimits,
              versionUpgrade: d.properties.versionUpgradeOption,
            })),
          });

          // Also collect RBAC for OpenAI resources
          try {
            const assignments = await this.listRoleAssignments(account.id);
            for (const ra of assignments) {
              let roleName = roleDefCache.get(ra.properties.roleDefinitionId);
              if (!roleName) {
                const roleDef = await this.getRoleDefinition(ra.properties.roleDefinitionId);
                roleName = roleDef?.properties?.roleName || "Unknown";
                roleDefCache.set(ra.properties.roleDefinitionId, roleName);
              }
              result.accessControl.push({
                resourceId: account.id,
                principalId: ra.properties.principalId,
                principalType: ra.properties.principalType,
                roleName,
                roleType: "BuiltInRole",
                scope: ra.properties.scope,
              });
            }
          } catch {
            // RBAC read may not be available
          }

          // ── 3. List AI Agents/Assistants on this OpenAI resource ──
          const oaiEndpoint = account.properties.endpoint ||
            (account.properties.customSubDomainName ? `https://${account.properties.customSubDomainName}.openai.azure.com` : undefined);
          if (oaiEndpoint && this.cognitiveServicesToken) {
            try {
              const assistants = await this.listAssistants(oaiEndpoint);
              for (const agent of assistants) {
                result.aiAgents.push({
                  ...agent,
                  resourceName: account.name,
                  endpoint: oaiEndpoint,
                  subscriptionId: sub.subscriptionId,
                  resourceGroup,
                });
              }
            } catch {
              // Agent listing may not be available on this resource
            }
          }
        } else {
          // Other AI Services (Speech, Vision, Language, etc.)
          result.aiServices.push({
            id: account.id,
            name: account.name,
            kind: account.kind,
            location: account.location,
            endpoint: account.properties.endpoint,
            skuName: account.sku?.name,
            publicAccess: account.properties.publicNetworkAccess,
            subscriptionId: sub.subscriptionId,
            resourceGroup,
          });
        }
      }
    }

    return result;
  }

  /**
   * Legacy method — still used by discoveryService for basic agent list
   */
  async discoverAgents(): Promise<AzureFoundryAgent[]> {
    const full = await this.discoverAll();
    return full.foundryAgents;
  }

  // ── Azure Monitor Metrics — real token usage ─────

  /**
   * Fetch Azure OpenAI usage metrics from Azure Monitor.
   * Returns prompt tokens, completion tokens per deployment for the given time range.
   * API: GET {resourceId}/providers/Microsoft.Insights/metrics
   */
  async getOpenAIUsageMetrics(
    resourceId: string,
    timespan: string = "P7D" // ISO 8601 duration: P1D, P7D, P30D
  ): Promise<{
    deployments: Array<{
      deploymentName: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      requestCount: number;
    }>;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalRequests: number;
    timespan: string;
    tokensEstimated: boolean;
  }> {
    const end = new Date().toISOString();
    const startDate = new Date();
    if (timespan === "P1D") startDate.setDate(startDate.getDate() - 1);
    else if (timespan === "P7D") startDate.setDate(startDate.getDate() - 7);
    else if (timespan === "P30D") startDate.setDate(startDate.getDate() - 30);
    else if (timespan === "P90D") startDate.setDate(startDate.getDate() - 90);
    else startDate.setDate(startDate.getDate() - 7);
    const start = startDate.toISOString();

    const deploymentMetrics = new Map<string, { prompt: number; completion: number; totalTokens: number; requests: number }>();

    const parseMetricTimeseries = (data: any, handler: (deploymentName: string, total: number, metricName: string) => void) => {
      for (const metric of (data.value || [])) {
        const metricName = metric.name?.value || metric.name?.localizedValue || "";
        for (const ts of (metric.timeseries || [])) {
          let deploymentName = "unknown";
          for (const md of (ts.metadatavalues || [])) {
            if (md.name?.value === "ModelDeploymentName") deploymentName = md.value;
          }
          let total = 0;
          for (const dp of (ts.data || [])) total += dp.total || 0;
          handler(deploymentName, total, metricName);
        }
      }
    };

    const ensureEntry = (name: string) => {
      if (!deploymentMetrics.has(name)) {
        deploymentMetrics.set(name, { prompt: 0, completion: 0, totalTokens: 0, requests: 0 });
      }
      return deploymentMetrics.get(name)!;
    };

    // 1) Discover which metrics are available on this resource
    let availableMetrics: string[] = [];
    try {
      const defUrl = `${AZURE_MGMT_BASE}${resourceId}/providers/Microsoft.Insights/metricDefinitions?api-version=2024-02-01`;
      const defResp = await this.fetchWithRetry(defUrl);
      const defData = await defResp.json();
      availableMetrics = (defData.value || []).map((d: any) => d.name?.value || "").filter(Boolean);
      const tokenRelated = availableMetrics.filter((m: string) =>
        m.toLowerCase().includes("token") || m.toLowerCase().includes("prompt") || m.toLowerCase().includes("completion")
      );
      console.log("[AzureMetrics] Available metrics on resource:", availableMetrics.length, "total. Token-related:", tokenRelated.length > 0 ? tokenRelated.join(", ") : "NONE");
    } catch (err: any) {
      console.warn("[AzureMetrics] Failed to list metric definitions:", err?.message || err);
    }

    // Build token metric queries dynamically from what's available on this resource.
    // Azure exposes different metric names across resource versions/regions:
    //   Newer: ProcessedPromptTokens + GeneratedTokens (or GeneratedCompletionTokens)
    //   Medium: InputTokens + OutputTokens
    //   Older:  TokenTransaction or TotalTokens
    let hasTokenData = false;

    // Determine which metric sets exist
    const promptMetric = availableMetrics.includes("ProcessedPromptTokens") ? "ProcessedPromptTokens"
      : availableMetrics.includes("InputTokens") ? "InputTokens" : null;
    const completionMetric = availableMetrics.includes("GeneratedTokens") ? "GeneratedTokens"
      : availableMetrics.includes("GeneratedCompletionTokens") ? "GeneratedCompletionTokens"
      : availableMetrics.includes("OutputTokens") ? "OutputTokens" : null;
    const totalTokenMetric = availableMetrics.includes("TokenTransaction") ? "TokenTransaction"
      : availableMetrics.includes("TotalTokens") ? "TotalTokens" : null;

    // Helper to query a set of metrics
    const fetchTokenMetrics = async (metricNames: string, withDeploymentFilter: boolean) => {
      const url = `${AZURE_MGMT_BASE}${resourceId}/providers/Microsoft.Insights/metrics`
        + `?api-version=2024-02-01`
        + `&metricnames=${metricNames}`
        + `&timespan=${start}/${end}`
        + `&interval=P1D`
        + `&aggregation=Total`
        + (withDeploymentFilter ? `&$filter=ModelDeploymentName eq '*'` : "");
      const response = await this.fetchWithRetry(url);
      return response.json();
    };

    // 2a) Try split input/output metrics (with deployment filter, then without)
    if (promptMetric && completionMetric) {
      const metricNames = `${promptMetric},${completionMetric}`;
      for (const withFilter of [true, false]) {
        if (hasTokenData) break;
        try {
          const data = await fetchTokenMetrics(metricNames, withFilter);
          parseMetricTimeseries(data, (depName, total, metricName) => {
            const entry = ensureEntry(depName);
            const lower = metricName.toLowerCase();
            if (lower.includes("prompt") || lower.includes("input")) entry.prompt += total;
            else entry.completion += total;
            if (total > 0) hasTokenData = true;
          });
          console.log(`[AzureMetrics] ${metricNames} (filter=${withFilter}): hasData =`, hasTokenData);
        } catch (err: any) {
          console.warn(`[AzureMetrics] ${metricNames} (filter=${withFilter}) failed:`, err?.message || err);
        }
      }
    }

    // 2b) Fallback to total token metric (TokenTransaction / TotalTokens)
    if (!hasTokenData && totalTokenMetric) {
      for (const withFilter of [true, false]) {
        if (hasTokenData) break;
        try {
          const data = await fetchTokenMetrics(totalTokenMetric, withFilter);
          parseMetricTimeseries(data, (depName, total) => {
            ensureEntry(depName).totalTokens += total;
            if (total > 0) hasTokenData = true;
          });
          console.log(`[AzureMetrics] ${totalTokenMetric} (filter=${withFilter}): hasData =`, hasTokenData);
        } catch (err: any) {
          console.warn(`[AzureMetrics] ${totalTokenMetric} (filter=${withFilter}) failed:`, err?.message || err);
        }
      }
    }

    // 2d) Last resort: estimate tokens from request count (avg ~500 tokens/request)
    const ESTIMATED_TOKENS_PER_REQUEST = 500;

    // 3) Fetch request count
    const hasRequestMetric = availableMetrics.includes("AzureOpenAIRequests");
    if (hasRequestMetric) {
      try {
        const reqUrl = `${AZURE_MGMT_BASE}${resourceId}/providers/Microsoft.Insights/metrics`
          + `?api-version=2024-02-01`
          + `&metricnames=AzureOpenAIRequests`
          + `&timespan=${start}/${end}`
          + `&interval=P1D`
          + `&aggregation=Total`
          + `&$filter=ModelDeploymentName eq '*'`;
        const response = await this.fetchWithRetry(reqUrl);
        const data = await response.json();
        parseMetricTimeseries(data, (depName, total) => {
          const entry = ensureEntry(depName);
          entry.requests += total;
          if (!hasTokenData && total > 0) {
            entry.totalTokens += Math.round(total * ESTIMATED_TOKENS_PER_REQUEST);
          }
        });
      } catch (err: any) {
        console.warn("[AzureMetrics] Request count metrics failed:", err?.message || err);
      }
    }

    if (!hasTokenData && deploymentMetrics.size > 0) {
      console.log("[AzureMetrics] No token metrics available — estimated tokens from request count (avg", ESTIMATED_TOKENS_PER_REQUEST, "tokens/request)");
    }

    const deployments = Array.from(deploymentMetrics.entries()).map(([name, m]) => {
      const combinedTokens = m.prompt + m.completion + m.totalTokens;
      return {
        deploymentName: name,
        promptTokens: Math.round(m.prompt),
        completionTokens: Math.round(m.completion),
        totalTokens: Math.round(combinedTokens > 0 ? combinedTokens : 0),
        requestCount: Math.round(m.requests),
      };
    });

    return {
      deployments,
      totalPromptTokens: deployments.reduce((s, d) => s + d.promptTokens, 0),
      totalCompletionTokens: deployments.reduce((s, d) => s + d.completionTokens, 0),
      totalTokens: deployments.reduce((s, d) => s + d.totalTokens, 0),
      totalRequests: deployments.reduce((s, d) => s + d.requestCount, 0),
      timespan,
      tokensEstimated: !hasTokenData && deploymentMetrics.size > 0,
    };
  }

  // ── Log Analytics — fallback when Azure Monitor Metrics returns 0 ─────

  async queryLogAnalytics(
    workspaceId: string,
    periodDays: number = 7
  ): Promise<{
    deployments: Array<{
      deploymentName: string;
      modelName: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      requestCount: number;
    }>;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalRequests: number;
  }> {
    const kql = `
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| where OperationName in ("ChatCompletions", "Completions", "Embeddings")
| where TimeGenerated > ago(${periodDays}d)
| extend props = parse_json(Properties_s)
| extend model = tostring(props.model)
| extend deployment = tostring(props.deploymentName)
| extend inputTokens = toint(props.promptTokens)
| extend outputTokens = toint(props.completionTokens)
| summarize totalRequests=count(),
            totalInputTokens=sum(inputTokens),
            totalOutputTokens=sum(outputTokens)
  by model, deployment
`.trim();

    const url = `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: kql }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn("[LogAnalytics] Query failed:", response.status, body.substring(0, 300));
        return { deployments: [], totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalRequests: 0 };
      }

      const data = await response.json();
      const table = data.tables?.[0];
      if (!table || !table.rows?.length) {
        return { deployments: [], totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalRequests: 0 };
      }

      const cols = table.columns.map((c: any) => c.name);
      const modelIdx = cols.indexOf("model");
      const deployIdx = cols.indexOf("deployment");
      const reqIdx = cols.indexOf("totalRequests");
      const inIdx = cols.indexOf("totalInputTokens");
      const outIdx = cols.indexOf("totalOutputTokens");

      const deployments = table.rows.map((row: any[]) => {
        const promptTokens = row[inIdx] || 0;
        const completionTokens = row[outIdx] || 0;
        return {
          deploymentName: row[deployIdx] || "unknown",
          modelName: row[modelIdx] || "unknown",
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          requestCount: row[reqIdx] || 0,
        };
      });

      return {
        deployments,
        totalPromptTokens: deployments.reduce((s: number, d: any) => s + d.promptTokens, 0),
        totalCompletionTokens: deployments.reduce((s: number, d: any) => s + d.completionTokens, 0),
        totalTokens: deployments.reduce((s: number, d: any) => s + d.totalTokens, 0),
        totalRequests: deployments.reduce((s: number, d: any) => s + d.requestCount, 0),
      };
    } catch (err: any) {
      console.warn("[LogAnalytics] Query error:", err?.message || err);
      return { deployments: [], totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalRequests: 0 };
    }
  }
}

export class AzureFoundryError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(status: number, body: string, endpoint: string) {
    const parsed = (() => {
      try { return JSON.parse(body); } catch { return null; }
    })();
    const msg = parsed?.error?.message || body.slice(0, 200);
    super(`Azure Foundry ${status}: ${msg}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}
