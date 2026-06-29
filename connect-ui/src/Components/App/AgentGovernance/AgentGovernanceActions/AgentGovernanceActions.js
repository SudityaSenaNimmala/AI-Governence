const BASE = "/api";

async function request(path, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Request failed (${res.status})`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const agentGovernanceApi = {
  async saveOAuthKeys(data) {
    return request("/oauth-keys", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async listOAuthKeys() {
    return request("/oauth-keys");
  },

  async updateOAuthKey(id, data) {
    return request(`/oauth-keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  async deleteOAuthKey(id) {
    await request(`/oauth-keys/${id}`, { method: "DELETE" });
  },

  async acquireToken(oauthKeyId) {
    return request("/auth/token", {
      method: "POST",
      body: JSON.stringify({ oauth_key_id: oauthKeyId }),
    });
  },

  async runDiscovery(oauthKeyId, dataverseEnvUrl) {
    let url = `/discovery/run?oauth_key_id=${oauthKeyId}`;
    if (dataverseEnvUrl) {
      url += `&dataverse_env_url=${encodeURIComponent(dataverseEnvUrl)}`;
    }
    return request(url);
  },

  async suspendAgent(data) {
    return request("/lifecycle/suspend", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async reactivateAgent(data) {
    return request("/lifecycle/reactivate", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async listPolicies() {
    return request("/policies");
  },

  async createPolicy(data) {
    return request("/policies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async updatePolicy(id, data) {
    return request(`/policies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },

  async deletePolicy(id) {
    await request(`/policies/${id}`, { method: "DELETE" });
  },

  async seedPolicyTemplates() {
    return request("/policies/seed-templates", { method: "POST" });
  },

  async evaluatePolicies(agents) {
    return request("/policies/evaluate", {
      method: "POST",
      body: JSON.stringify({ agents }),
    });
  },

  async listViolations(limit) {
    return request(`/policies/violations${limit ? `?limit=${limit}` : ""}`);
  },

  async health() {
    return request("/health");
  },

  async fetchUserChats(oauthKeyId, dataverseEnvUrl, limit = 1000) {
    let url = `/activity/chats?oauth_key_id=${oauthKeyId}&limit=${limit}`;
    if (dataverseEnvUrl) {
      url += `&dataverse_env_url=${encodeURIComponent(dataverseEnvUrl)}`;
    }
    return request(url);
  },

  async fetchUserFiles(oauthKeyId) {
    return request(`/activity/files?oauth_key_id=${oauthKeyId}`, {}, 120000);
  },

  async fetchKnowledgeSources(oauthKeyId, dataverseEnvUrl, botId) {
    let url = `/activity/knowledge?oauth_key_id=${oauthKeyId}`;
    if (dataverseEnvUrl) url += `&dataverse_env_url=${encodeURIComponent(dataverseEnvUrl)}`;
    if (botId) url += `&bot_id=${encodeURIComponent(botId)}`;
    return request(url);
  },

  async fetchRiskSummary(oauthKeyId, dataverseEnvUrl) {
    let url = `/activity/risk-summary?oauth_key_id=${oauthKeyId}`;
    if (dataverseEnvUrl) url += `&dataverse_env_url=${encodeURIComponent(dataverseEnvUrl)}`;
    return request(url, {}, 120000);
  },

  async discoverAzureAI(oauthKeyId) {
    return request(`/azure/discover?oauth_key_id=${oauthKeyId}`);
  },

  async discoverGoogleVertex(oauthKeyId) {
    return request(`/google/discover?oauth_key_id=${oauthKeyId}`);
  },

  async fetchGoogleConversations(days = 7) {
    return request(`/google/conversations?days=${days}`);
  },

  async connectGoogle(serviceAccountJson, gcpProjectId) {
    return request("/google/connect", {
      method: "POST",
      body: JSON.stringify({ service_account_json: serviceAccountJson, gcp_project_id: gcpProjectId }),
    });
  },

  async getApprovalStatuses() {
    return request("/lifecycle/approval-statuses");
  },

  async setApprovalStatus(botId, approvalStatus, name, oauthKeyId) {
    return request("/lifecycle/approval-status", {
      method: "PUT",
      body: JSON.stringify({ bot_id: botId, approval_status: approvalStatus, name, oauth_key_id: oauthKeyId }),
    });
  },

  // Alerts
  async checkAlerts(agents, idleThresholdMinutes = 43200) {
    return request("/alerts/check", {
      method: "POST",
      body: JSON.stringify({ agents, idle_threshold_minutes: idleThresholdMinutes }),
    });
  },

  async listAlerts(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit);
    if (options.vendor) params.set("vendor", options.vendor);
    if (options.resolved !== undefined) params.set("resolved", options.resolved);
    const qs = params.toString();
    return request(`/alerts${qs ? `?${qs}` : ""}`);
  },

  async resolveAlert(id) {
    return request(`/alerts/${id}/resolve`, { method: "PATCH" });
  },

  async resolveAllAlerts() {
    return request("/alerts/resolve-all", { method: "POST" });
  },

  async getAlertConfig() {
    return request("/alerts/config");
  },

  async updateAlertConfig(config) {
    return request("/alerts/config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },

  // Azure activity
  async fetchAzureUsage(oauthKeyId, period = "P7D") {
    return request(`/activity/azure/usage?oauth_key_id=${oauthKeyId}&period=${period}`);
  },

  async fetchAzureUsageDetails(oauthKeyId, period = "P7D") {
    return request(`/activity/azure/usage-details?oauth_key_id=${oauthKeyId}&period=${period}`, {}, 90000);
  },

  async fetchAzureThreads(oauthKeyId) {
    return request(`/activity/azure/threads?oauth_key_id=${oauthKeyId}`);
  },

  async fetchAzureAssistants(oauthKeyId) {
    return request(`/activity/azure/assistants?oauth_key_id=${oauthKeyId}`);
  },

  // Teams / Personal agent activity
  async fetchTeamsSignIns(oauthKeyId, appId) {
    let url = `/activity/teams/signins?oauth_key_id=${oauthKeyId}`;
    if (appId) url += `&app_id=${encodeURIComponent(appId)}`;
    return request(url);
  },

  async fetchCopilotInteractions(oauthKeyId, platform) {
    let url = `/activity/copilot-interactions?oauth_key_id=${oauthKeyId}`;
    if (platform) url += `&platform=${encodeURIComponent(platform)}`;
    return request(url, {}, 90000);
  },

  async fetchM365CopilotChats(oauthKeyId, agentNames = []) {
    let url = `/activity/m365-copilot-chats?oauth_key_id=${oauthKeyId}`;
    if (agentNames.length > 0) {
      url += `&agent_names=${encodeURIComponent(agentNames.join(","))}`;
    }
    return request(url);
  },

  async fetchAgentPermissions(oauthKeyId) {
    return request(`/activity/agent-permissions?oauth_key_id=${oauthKeyId}`, {}, 90000);
  },

  // Cost tracking
  async fetchAzureCost(oauthKeyId, period = "P7D") {
    return request(`/cost/azure?oauth_key_id=${oauthKeyId}&period=${period}`);
  },

  async fetchGoogleCost(oauthKeyId, period = 7) {
    const qs = oauthKeyId ? `?oauth_key_id=${oauthKeyId}&period=${period}` : `?period=${period}`;
    return request(`/cost/google${qs}`);
  },

  async fetchCostHistory(options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit);
    if (options.vendor) params.set("vendor", options.vendor);
    const qs = params.toString();
    return request(`/cost/history${qs ? `?${qs}` : ""}`);
  },

  async fetchPricing() {
    return request("/cost/pricing");
  },
};
