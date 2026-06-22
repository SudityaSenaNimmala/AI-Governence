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
    return request(`/google/discover?oauth_key_id=${oauthKeyId}`, undefined, 300000);
  },

  async discoverGooglePlatform(oauthKeyId, platform) {
    const qs = oauthKeyId ? `?oauth_key_id=${oauthKeyId}&platform=${platform}` : `?platform=${platform}`;
    return request(`/google/scan-platform${qs}`, undefined, 120000);
  },

  async getGoogleAgentDetails(oauthKeyId, platform, agentId) {
    const params = new URLSearchParams({ platform, id: agentId });
    if (oauthKeyId) params.set("oauth_key_id", oauthKeyId);
    return request(`/google/agent-details?${params}`, undefined, 60000);
  },

  async fetchGoogleUserActivity(oauthKeyId) {
    const qs = oauthKeyId ? `?oauth_key_id=${oauthKeyId}` : "";
    return request(`/google/user-activity${qs}`, undefined, 180000);
  },

  async fetchGoogleConversations(days = 7) {
    return request(`/google/conversations?days=${days}`);
  },

  async fetchGeminiActivity(days = 7) {
    return request(`/google/gemini-activity?days=${days}`);
  },

  async fetchGeminiVault(days = 7, userEmails = []) {
    const params = new URLSearchParams({ days: String(days) });
    if (userEmails.length > 0) params.set("users", userEmails.join(","));
    return request(`/google/gemini-vault?${params}`);
  },

  async connectGoogle(serviceAccountJson, gcpProjectId, adminEmail) {
    return request("/google/connect", {
      method: "POST",
      body: JSON.stringify({ service_account_json: serviceAccountJson, gcp_project_id: gcpProjectId, admin_email: adminEmail }),
    });
  },

  // ── Gemini Enterprise (Agentspace) ──────────────────────────────────────────
  async connectGeminiEnterprise(data) {
    return request("/gemini-enterprise/connect", {
      method: "POST",
      body: JSON.stringify(data),
    }, 300000);
  },

  async fetchGeminiEnterpriseData(oauthKeyId) {
    const qs = oauthKeyId ? `?oauth_key_id=${oauthKeyId}` : "";
    return request(`/gemini-enterprise/data${qs}`, undefined, 300000);
  },

  async previewGeminiEnterprise(data) {
    return request("/gemini-enterprise/preview", {
      method: "POST",
      body: JSON.stringify(data),
    }, 300000);
  },

  // Resolves token-mode vs stored-key-mode automatically.
  async fetchGeminiEnterpriseAuto(geminiEnterpriseKeyId) {
    if (geminiEnterpriseKeyId === "__ge_token__") {
      const conn = JSON.parse(localStorage.getItem("ag_gemini_enterprise_token_conn") || "{}");
      return this.previewGeminiEnterprise(conn);
    }
    return this.fetchGeminiEnterpriseData(geminiEnterpriseKeyId);
  },

  // Real Discovery Engine usage + estimated cost (token-aware).
  async fetchGeminiEnterpriseCost(geminiEnterpriseKeyId, period = 7) {
    let body = { period };
    if (geminiEnterpriseKeyId === "__ge_token__") {
      const conn = JSON.parse(localStorage.getItem("ag_gemini_enterprise_token_conn") || "{}");
      body = { ...body, access_token: conn.access_token, project_id: conn.project_id };
    } else {
      body = { ...body, oauth_key_id: geminiEnterpriseKeyId };
    }
    return request("/gemini-enterprise/cost", { method: "POST", body: JSON.stringify(body) }, 120000);
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

  async deleteGoogleAgent(googleOauthKeyId, agentId, platform) {
    return request("/lifecycle/google/delete", {
      method: "POST",
      body: JSON.stringify({ google_oauth_key_id: googleOauthKeyId, agent_id: agentId, platform }),
    });
  },

  async deleteOpenAIAssistant(openaiOauthKeyId, assistantId) {
    return request("/lifecycle/openai/delete", {
      method: "POST",
      body: JSON.stringify({ openai_oauth_key_id: openaiOauthKeyId, assistant_id: assistantId }),
    });
  },

  async deleteCustomGPT(openaiKeyId, gptId) {
    const qs = new URLSearchParams({ oauth_key_id: openaiKeyId, gpt_id: gptId });
    return request(`/openai/gpt?${qs}`, { method: "DELETE" });
  },

  async softSuspendAgent(botId, name, oauthKeyId) {
    return request("/lifecycle/soft-suspend", {
      method: "POST",
      body: JSON.stringify({ bot_id: botId, name, oauth_key_id: oauthKeyId }),
    });
  },

  async softReactivateAgent(botId, name, oauthKeyId) {
    return request("/lifecycle/soft-reactivate", {
      method: "POST",
      body: JSON.stringify({ bot_id: botId, name, oauth_key_id: oauthKeyId }),
    });
  },

  async deleteTeamsApp(oauthKeyId, appId, name) {
    return request("/lifecycle/teams/delete", {
      method: "POST",
      body: JSON.stringify({ oauth_key_id: oauthKeyId, app_id: appId, name }),
    });
  },

  async getLifecycleStatuses() {
    return request("/lifecycle/lifecycle-statuses");
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

  async fetchOpenAICost(openaiKeyId, period = "P7D") {
    const days = { P1D: 1, P7D: 7, P30D: 30, P90D: 90 }[period] || 7;
    return request(`/openai/usage?oauth_key_id=${openaiKeyId}&period=${days}`, undefined, 60000);
  },

  async fetchOpenAIActivity(openaiKeyId, period = 30) {
    return request(`/openai/activity?oauth_key_id=${openaiKeyId}&period=${period}`, undefined, 60000);
  },

  async fetchOpenAIKnowledge(openaiKeyId, assistantId) {
    return request(`/openai/knowledge?oauth_key_id=${openaiKeyId}&assistant_id=${assistantId}`, undefined, 60000);
  },

  async fetchOpenAIThreads(openaiKeyId, limit = 50) {
    return request(`/openai/threads?oauth_key_id=${openaiKeyId}&limit=${limit}`, undefined, 60000);
  },

  async fetchOpenAIFiles(openaiKeyId) {
    return request(`/openai/files?oauth_key_id=${openaiKeyId}`, undefined, 60000);
  },

  async connectOpenAI(apiKey, orgId, sessionToken, adminKey) {
    return request("/openai/connect", {
      method: "POST",
      body: JSON.stringify({ api_key: apiKey, org_id: orgId, session_token: sessionToken, admin_key: adminKey || undefined }),
    });
  },

  async discoverOpenAIPlatform(oauthKeyId, platform) {
    const qs = oauthKeyId ? `?oauth_key_id=${oauthKeyId}&platform=${platform}` : `?platform=${platform}`;
    return request(`/openai/scan-platform${qs}`, undefined, 120000);
  },

  // Claude / Anthropic
  async connectClaude(apiKey, sessionKey) {
    return request("/claude/connect", {
      method: "POST",
      body: JSON.stringify({ api_key: apiKey, session_key: sessionKey || undefined }),
    });
  },

  async discoverClaudePlatform(oauthKeyId, platform) {
    const qs = oauthKeyId ? `?oauth_key_id=${oauthKeyId}&platform=${platform}` : `?platform=${platform}`;
    return request(`/claude/scan-platform${qs}`, undefined, 120000);
  },

  async deleteClaudeProject(claudeKeyId, projectId, orgId) {
    const qs = new URLSearchParams({ oauth_key_id: claudeKeyId, project_id: projectId, org_id: orgId });
    return request(`/claude/project?${qs}`, { method: "DELETE" });
  },

  async archiveClaudeWorkspace(claudeKeyId, workspaceId) {
    return request("/claude/workspace/archive", {
      method: "POST",
      body: JSON.stringify({ oauth_key_id: claudeKeyId, workspace_id: workspaceId }),
    });
  },

  async debugClaudeAdmin(claudeKeyId) {
    return request(`/claude/debug-admin?oauth_key_id=${claudeKeyId}`, undefined, 30000);
  },

  async fetchClaudeUsage(claudeKeyId, period = "P7D") {
    const days = { P1D: 1, P7D: 7, P30D: 30, P90D: 90 }[period] || 7;
    return request(`/claude/usage?oauth_key_id=${claudeKeyId}&period=${days}`, undefined, 60000);
  },

  async fetchClaudeFiles(claudeKeyId) {
    return request(`/claude/files?oauth_key_id=${claudeKeyId}`, undefined, 60000);
  },

  // ── Sensitivity Labels ──────────────────────────────────────────────────────
  async checkSensitivity(oauthKeyId) {
    return request(`/sensitivity/check?oauth_key_id=${oauthKeyId}`, undefined, 60000);
  },
  async scanAgentSensitivity(payload) {
    return request("/sensitivity/scan-agent", { method: "POST", body: JSON.stringify(payload) }, 30000);
  },
  async getAgentSensitivity(agentId) {
    return request(`/sensitivity/agent/${encodeURIComponent(agentId)}`);
  },
  async getSensitivitySummary() {
    return request("/sensitivity/summary");
  },

  // ── Prompt Monitoring ───────────────────────────────────────────────────────
  async analyzePrompts(agentId, agentName, platform, conversations) {
    return request("/prompts/analyze", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, agent_name: agentName, platform, conversations }),
    }, 60000);
  },
  async listPromptFlags(options = {}) {
    const params = new URLSearchParams();
    if (options.severity)  params.set("severity",  options.severity);
    if (options.platform)  params.set("platform",  options.platform);
    if (options.agentId)   params.set("agent_id",  options.agentId);
    if (options.flagType)  params.set("flag_type", options.flagType);
    if (options.resolved !== undefined) params.set("resolved", String(options.resolved));
    if (options.limit)     params.set("limit",     String(options.limit));
    const qs = params.toString();
    return request(`/prompts/flags${qs ? `?${qs}` : ""}`);
  },
  async resolvePromptFlag(id) {
    return request(`/prompts/flags/${id}/resolve`, { method: "PATCH" });
  },
  async resolveAllPromptFlags(agentId) {
    return request("/prompts/flags/resolve-all", {
      method: "POST",
      body: JSON.stringify(agentId ? { agent_id: agentId } : {}),
    });
  },
  async getPromptSummary() {
    return request("/prompts/summary");
  },

  // ── Recertification Workflows ───────────────────────────────────────────────
  async listRecertificationCampaigns(options = {}) {
    const params = new URLSearchParams();
    if (options.status)   params.set("status",    options.status);
    if (options.agentId)  params.set("agent_id",  options.agentId);
    if (options.platform) params.set("platform",  options.platform);
    if (options.limit)    params.set("limit",     String(options.limit));
    const qs = params.toString();
    return request(`/recertification${qs ? `?${qs}` : ""}`);
  },
  async launchRecertificationCampaign(agents, dueInDays = 14) {
    return request("/recertification", {
      method: "POST",
      body: JSON.stringify({ agents, due_in_days: dueInDays }),
    });
  },
  async respondRecertification(id, response, responder, notes) {
    return request(`/recertification/${id}/respond`, {
      method: "PATCH",
      body: JSON.stringify({ response, responder, notes }),
    });
  },
  async escalateRecertification(id, escalatedTo) {
    return request(`/recertification/${id}/escalate`, {
      method: "PATCH",
      body: JSON.stringify({ escalated_to: escalatedTo }),
    });
  },
  async expireOverdueCampaigns() {
    return request("/recertification/expire-overdue", { method: "POST" });
  },
  async getRecertificationStats() {
    return request("/recertification/stats");
  },
  async deleteRecertificationCampaign(id) {
    return request(`/recertification/${id}`, { method: "DELETE" });
  },

  // ── Agent Business Context Metadata ────────────────────────────────────────
  async getAgentMetadata(agentId) {
    return request(`/agent-metadata/${encodeURIComponent(agentId)}`);
  },
  async saveAgentMetadata(agentId, data) {
    return request(`/agent-metadata/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async listAgentMetadata(options = {}) {
    const params = new URLSearchParams();
    if (options.data_classification) params.set("data_classification", options.data_classification);
    if (options.business_unit)       params.set("business_unit",       options.business_unit);
    if (options.platform)            params.set("platform",            options.platform);
    const qs = params.toString();
    return request(`/agent-metadata${qs ? `?${qs}` : ""}`);
  },
  async deleteAgentMetadata(agentId) {
    return request(`/agent-metadata/${encodeURIComponent(agentId)}`, { method: "DELETE" });
  },
  async getAgentMetadataStats() {
    return request("/agent-metadata/stats/summary");
  },
};
