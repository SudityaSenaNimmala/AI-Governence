import { createContext, useContext, useReducer, useState, useCallback } from "react";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";

const STORAGE_KEY = "ag_oauth_key_id";
const TENANT_KEY = "ag_tenant_id";
const DV_ENV_KEY = "ag_dataverse_env_url";
const AZ_SUB_KEY = "ag_azure_subscription_id";
const GCP_KEY = "ag_google_key_id";
const OPENAI_KEY = "ag_openai_key_id";
const CLAUDE_KEY = "ag_claude_key_id";
const GEMINI_ENTERPRISE_KEY = "ag_gemini_enterprise_key_id";
const GEMINI_ENTERPRISE_TOKEN_CONN = "ag_gemini_enterprise_token_conn";
export const GEMINI_ENTERPRISE_TOKEN_SENTINEL = "__ge_token__";

export const SCOPE_LABELS = {
  all: "All Applications",
  copilot_studio: "Copilot Studio",
  personal_agent: "Personal Agents",
  teams_chat_agent: "Chat Agents",
  sharepoint_embedded: "SharePoint",
  teams_app: "Teams Bots",
  isv_store: "ISV Store Apps",
  azure_foundry: "Azure AI Foundry",
  vertex_ai: "Vertex AI",
  gemini: "Gemini",               // Standalone Gemini AI (gemini.google.com)
  google_workspace: "Google Workspace", // Combined view — all Workspace apps
  gemini_gmail: "Gmail",
  gemini_docs: "Docs",
  gemini_sheets: "Sheets",
  gemini_slides: "Slides",
  gemini_meet: "Meet",
  gemini_drive: "Drive",
  gemini_chat: "Chat",
  google_chat: "Google Chat Bots",
  apps_script: "Apps Script",
  gemini_gems: "Gemini Gems",
  gemini_workspace: "Gemini for Workspace", // legacy — kept for backward compat
  oauth_app: "Shadow AI (OAuth)",
  openai_assistant: "OpenAI Assistants",
  custom_gpt: "Custom GPTs (ChatGPT)",
  claude_ai_project: "Claude.ai Projects",
  gemini_enterprise: "Gemini Enterprise",
};

export const SCOPE_COLORS = {
  all: "#6366f1",
  copilot_studio: "#742774",
  personal_agent: "#0078D4",
  teams_chat_agent: "#5B5FC7",
  sharepoint_embedded: "#038387",
  teams_app: "#5B5FC7",
  isv_store: "#D83B01",
  azure_foundry: "#0078D4",
  vertex_ai: "#1A73E8",
  gemini: "#886FBF",
  google_workspace: "#4285F4",
  gemini_gmail: "#EA4335",
  gemini_docs: "#4285F4",
  gemini_sheets: "#34A853",
  gemini_slides: "#FBBC04",
  gemini_meet: "#00897B",
  gemini_drive: "#F9AB00",
  gemini_chat: "#1A73E8",
  google_chat: "#00AC47",
  apps_script: "#0F9D58",
  gemini_gems: "#7C4DFF",
  gemini_workspace: "#886FBF",
  oauth_app: "#8b5cf6",
  openai_assistant: "#10a37f",
  custom_gpt: "#7c3aed",
  claude_ai_project: "#D4622A",
  gemini_enterprise: "#886FBF",
};

const governanceInitialState = {
  activeTab: "overview",
  selectedScope: "all",
  discoveryStatus: "idle",
  discoveryProgress: "",
  discoveryResult: null,
  error: null,
  statusFilter: "all",
  riskFilter: "all",
  platformFilter: "all",
  searchQuery: "",
  selectedAgentId: null,
  refreshKey: 0,
};

function governanceReducer(state, action) {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, activeTab: action.tab, selectedAgentId: null };
    case "SET_SCOPE":
      return { ...state, selectedScope: action.scope, selectedAgentId: null, platformFilter: action.scope === "all" ? "all" : action.scope };
    case "DISCOVERY_START":
      return { ...state, discoveryStatus: "loading", error: null, discoveryProgress: "Starting scan..." };
    case "DISCOVERY_PROGRESS":
      return { ...state, discoveryProgress: action.message };
    case "DISCOVERY_SUCCESS":
      return { ...state, discoveryStatus: "success", discoveryResult: action.result, discoveryProgress: "", refreshKey: state.refreshKey + 1 };
    case "DISCOVERY_ERROR":
      return { ...state, discoveryStatus: "error", error: action.error, discoveryProgress: "" };
    case "SET_STATUS_FILTER":
      return { ...state, statusFilter: action.filter };
    case "SET_RISK_FILTER":
      return { ...state, riskFilter: action.filter };
    case "SET_PLATFORM_FILTER":
      return { ...state, platformFilter: action.filter };
    case "SET_SEARCH":
      return { ...state, searchQuery: action.query };
    case "SELECT_AGENT":
      return { ...state, selectedAgentId: action.agentId };
    case "UPDATE_AGENT_STATUS":
      if (!state.discoveryResult) return state;
      return {
        ...state,
        discoveryResult: {
          ...state.discoveryResult,
          agents: state.discoveryResult.agents.map((a) =>
            a.id === action.agentId ? { ...a, lifecycleStatus: action.status } : a
          ),
        },
      };
    default:
      return state;
  }
}

const WORKSPACE_APP_PLATFORMS = ["gemini_gmail", "gemini_docs", "gemini_sheets", "gemini_slides", "gemini_meet", "gemini_drive", "gemini_chat"];

export function getScopedAgents(result, scope) {
  if (!result) return [];
  if (scope === "all") return result.agents;
  // "google_workspace" is a combined view — aggregates all individual Workspace app platforms
  if (scope === "google_workspace") return result.agents.filter((a) => WORKSPACE_APP_PLATFORMS.includes(a.platform));
  return result.agents.filter((a) => a.platform === scope);
}

export function getScopeCounts(result) {
  const counts = { all: 0, copilot_studio: 0, personal_agent: 0, teams_chat_agent: 0, sharepoint_embedded: 0, teams_app: 0, isv_store: 0, azure_foundry: 0, vertex_ai: 0, gemini: 0, google_workspace: 0, gemini_gmail: 0, gemini_docs: 0, gemini_sheets: 0, gemini_slides: 0, gemini_meet: 0, gemini_drive: 0, gemini_chat: 0, google_chat: 0, apps_script: 0, gemini_gems: 0, gemini_workspace: 0, oauth_app: 0, openai_assistant: 0, custom_gpt: 0, claude_project: 0, claude_model: 0, claude_agent: 0, claude_ai_project: 0, gemini_enterprise: 0 };
  if (!result) return counts;
  counts.all = result.agents.length;
  for (const a of result.agents) {
    if (a.platform in counts) counts[a.platform]++;
  }
  // google_workspace combined count = sum of all individual Workspace app platform counts
  counts.google_workspace = WORKSPACE_APP_PLATFORMS.reduce((sum, p) => sum + counts[p], 0);
  return counts;
}

export function computeMetrics(result, scope = "all") {
  if (!result) {
    return {
      totalAgents: 0, complianceScore: 0, highRiskCount: 0,
      staleCount: 0, orphanedCount: 0, activeCount: 0,
      riskDistribution: { critical: 0, high: 0, medium: 0, low: 0 },
      platformDistribution: {},
      recentEvents: [],
    };
  }

  const agents = getScopedAgents(result, scope);
  const highRiskCount = agents.filter((a) => a.risk.level === "critical" || a.risk.level === "high").length;
  const now = Date.now();
  const staleThresholdMs = 30 * 24 * 60 * 60 * 1000;
  const staleCount = agents.filter((a) => {
    const lastActive = a.activity?.lastActiveTimestamp
      ? new Date(a.activity.lastActiveTimestamp).getTime()
      : a.lastModified ? new Date(a.lastModified).getTime() : null;
    return !lastActive || (now - lastActive) > staleThresholdMs;
  }).length;
  const orphanedCount = agents.filter((a) => a.isOrphaned).length;
  const activeCount = agents.length - staleCount;

  const withOwners = agents.filter((a) => !a.isOrphaned).length;
  const belowRiskThreshold = agents.filter((a) => a.risk.level === "low" || a.risk.level === "medium").length;
  const complianceScore = agents.length > 0
    ? Math.round(((withOwners / agents.length) * 0.3 + (belowRiskThreshold / agents.length) * 0.4 + (activeCount / agents.length) * 0.3) * 100)
    : 0;

  const riskDistribution = { critical: 0, high: 0, medium: 0, low: 0 };
  const platformDistribution = {};

  for (const a of agents) {
    riskDistribution[a.risk.level]++;
    platformDistribution[a.platform] = (platformDistribution[a.platform] || 0) + 1;
  }

  const recentEvents = [];
  for (const a of agents.slice(0, 5)) {
    if (a.risk.level === "critical" || a.risk.level === "high") {
      recentEvents.push({
        id: `risk-${a.id}`,
        type: "risk_change",
        agentId: a.id,
        agentName: a.name,
        description: `${a.name} flagged as ${a.risk.level} risk (score: ${a.risk.score})`,
        severity: a.risk.level,
        timestamp: result.scanTimestamp,
      });
    }
    const aLastActive = a.activity?.lastActiveTimestamp
      ? new Date(a.activity.lastActiveTimestamp).getTime()
      : a.lastModified ? new Date(a.lastModified).getTime() : null;
    if (!aLastActive || (now - aLastActive) > staleThresholdMs) {
      recentEvents.push({
        id: `stale-${a.id}`,
        type: "agent_stale",
        agentId: a.id,
        agentName: a.name,
        description: `${a.name} has no activity in 30+ days`,
        severity: "medium",
        timestamp: result.scanTimestamp,
      });
    }
  }

  return {
    totalAgents: agents.length,
    complianceScore,
    highRiskCount,
    staleCount,
    orphanedCount,
    activeCount,
    riskDistribution,
    platformDistribution,
    recentEvents,
  };
}

const GovernanceContext = createContext(null);
const AuthContext = createContext(null);

export function AgentGovernanceProvider({ children }) {
  const [govState, govDispatch] = useReducer(governanceReducer, governanceInitialState);

  const [oauthKeyId, setOauthKeyId] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [tenantId, setTenantId] = useState(() => localStorage.getItem(TENANT_KEY));
  const [dataverseEnvUrl, setDataverseEnvUrl] = useState(() => localStorage.getItem(DV_ENV_KEY));
  const [azureSubscriptionId, setAzureSubscriptionId] = useState(() => localStorage.getItem(AZ_SUB_KEY));
  const [googleKeyId, setGoogleKeyId] = useState(() => localStorage.getItem(GCP_KEY));
  const [openaiKeyId, setOpenaiKeyId] = useState(() => localStorage.getItem(OPENAI_KEY));
  const [claudeKeyId, setClaudeKeyId] = useState(() => localStorage.getItem(CLAUDE_KEY));
  const [geminiEnterpriseKeyId, setGeminiEnterpriseKeyId] = useState(() => localStorage.getItem(GEMINI_ENTERPRISE_KEY));
  const [isConnecting, setIsConnecting] = useState(false);
  const [authError, setAuthError] = useState(null);

  const isAuthenticated = !!oauthKeyId;

  const connect = useCallback(async (data) => {
    setIsConnecting(true);
    setAuthError(null);
    try {
      // If reconnecting with existing saved credentials (no new secret), reuse the existing key
      if (data._existingKeyId) {
        // Update Dataverse/Azure fields if changed
        const updates = {};
        if (data.dataverse_env_url) updates.dataverse_env_url = data.dataverse_env_url;
        if (data.azure_subscription_id) updates.azure_subscription_id = data.azure_subscription_id;
        if (Object.keys(updates).length > 0) {
          await agentGovernanceApi.updateOAuthKey(data._existingKeyId, updates);
        }
        await agentGovernanceApi.acquireToken(data._existingKeyId);
        localStorage.setItem(STORAGE_KEY, data._existingKeyId);
        localStorage.setItem(TENANT_KEY, data.tenant_id);
        if (data.dataverse_env_url) {
          localStorage.setItem(DV_ENV_KEY, data.dataverse_env_url);
          setDataverseEnvUrl(data.dataverse_env_url);
        }
        if (data.azure_subscription_id) {
          localStorage.setItem(AZ_SUB_KEY, data.azure_subscription_id);
          setAzureSubscriptionId(data.azure_subscription_id);
        }
        setOauthKeyId(data._existingKeyId);
        setTenantId(data.tenant_id);
      } else {
        // Fresh connect with new credentials
        const saved = await agentGovernanceApi.saveOAuthKeys({
          vendor: "microsoft",
          client_id: data.client_id,
          client_secret: data.client_secret,
          tenant_id: data.tenant_id,
          dataverse_env_url: data.dataverse_env_url || undefined,
          azure_subscription_id: data.azure_subscription_id || undefined,
        });
        await agentGovernanceApi.acquireToken(saved.id);
        localStorage.setItem(STORAGE_KEY, saved.id);
        localStorage.setItem(TENANT_KEY, data.tenant_id);
        if (data.dataverse_env_url) {
          localStorage.setItem(DV_ENV_KEY, data.dataverse_env_url);
          setDataverseEnvUrl(data.dataverse_env_url);
        }
        if (data.azure_subscription_id) {
          localStorage.setItem(AZ_SUB_KEY, data.azure_subscription_id);
          setAzureSubscriptionId(data.azure_subscription_id);
        }
        setOauthKeyId(saved.id);
        setTenantId(data.tenant_id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setAuthError(msg);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const updateConnection = useCallback(async (data) => {
    if (!oauthKeyId) return;
    setIsConnecting(true);
    setAuthError(null);
    try {
      await agentGovernanceApi.updateOAuthKey(oauthKeyId, data);
      if (data.dataverse_env_url) {
        localStorage.setItem(DV_ENV_KEY, data.dataverse_env_url);
        setDataverseEnvUrl(data.dataverse_env_url);
      }
      if (data.azure_subscription_id) {
        localStorage.setItem(AZ_SUB_KEY, data.azure_subscription_id);
        setAzureSubscriptionId(data.azure_subscription_id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setAuthError(msg);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [oauthKeyId]);

  const connectGoogle = useCallback(async (serviceAccountJson, gcpProjectId, adminEmail) => {
    setAuthError(null);
    try {
      const result = await agentGovernanceApi.connectGoogle(serviceAccountJson, gcpProjectId, adminEmail);
      localStorage.setItem(GCP_KEY, result.id);
      setGoogleKeyId(result.id);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google connection failed";
      setAuthError(msg);
      throw err;
    }
  }, []);

  const disconnectGoogle = useCallback(async () => {
    if (googleKeyId) {
      try { await agentGovernanceApi.deleteOAuthKey(googleKeyId); } catch { /* ignore */ }
    }
    localStorage.removeItem(GCP_KEY);
    setGoogleKeyId(null);
  }, [googleKeyId]);

  const connectOpenAI = useCallback(async (apiKey, orgId, sessionToken, adminKey) => {
    setAuthError(null);
    try {
      const result = await agentGovernanceApi.connectOpenAI(apiKey, orgId, sessionToken, adminKey);
      localStorage.setItem(OPENAI_KEY, result.id);
      setOpenaiKeyId(result.id);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OpenAI connection failed";
      setAuthError(msg);
      throw err;
    }
  }, []);

  const disconnectOpenAI = useCallback(async () => {
    if (openaiKeyId) {
      try { await agentGovernanceApi.deleteOAuthKey(openaiKeyId); } catch { /* ignore */ }
    }
    localStorage.removeItem(OPENAI_KEY);
    setOpenaiKeyId(null);
  }, [openaiKeyId]);

  const connectClaude = useCallback(async (apiKey, sessionKey) => {
    setAuthError(null);
    try {
      const result = await agentGovernanceApi.connectClaude(apiKey, sessionKey);
      localStorage.setItem(CLAUDE_KEY, result.id);
      setClaudeKeyId(result.id);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Claude connection failed";
      setAuthError(msg);
      throw err;
    }
  }, []);

  const disconnectClaude = useCallback(async () => {
    if (claudeKeyId) {
      try { await agentGovernanceApi.deleteOAuthKey(claudeKeyId); } catch { /* ignore */ }
    }
    localStorage.removeItem(CLAUDE_KEY);
    setClaudeKeyId(null);
  }, [claudeKeyId]);

  const connectGeminiEnterprise = useCallback(async (data) => {
    setAuthError(null);
    try {
      const result = await agentGovernanceApi.connectGeminiEnterprise(data);
      localStorage.setItem(GEMINI_ENTERPRISE_KEY, result.id);
      setGeminiEnterpriseKeyId(result.id);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gemini Enterprise connection failed";
      setAuthError(msg);
      throw err;
    }
  }, []);

  // Access-token connect path — for self-serve Business tenants where the user
  // can read the app but cannot create a service-account key. Stores the token
  // + app coordinates locally; nothing is persisted server-side.
  const connectGeminiEnterpriseToken = useCallback((conn) => {
    localStorage.setItem(GEMINI_ENTERPRISE_TOKEN_CONN, JSON.stringify(conn));
    localStorage.setItem(GEMINI_ENTERPRISE_KEY, GEMINI_ENTERPRISE_TOKEN_SENTINEL);
    setGeminiEnterpriseKeyId(GEMINI_ENTERPRISE_TOKEN_SENTINEL);
  }, []);

  const disconnectGeminiEnterprise = useCallback(async () => {
    if (geminiEnterpriseKeyId && geminiEnterpriseKeyId !== GEMINI_ENTERPRISE_TOKEN_SENTINEL) {
      try { await agentGovernanceApi.deleteOAuthKey(geminiEnterpriseKeyId); } catch { /* ignore */ }
    }
    localStorage.removeItem(GEMINI_ENTERPRISE_KEY);
    localStorage.removeItem(GEMINI_ENTERPRISE_TOKEN_CONN);
    setGeminiEnterpriseKeyId(null);
  }, [geminiEnterpriseKeyId]);

  const disconnect = useCallback(async () => {
    if (oauthKeyId) {
      try {
        await agentGovernanceApi.deleteOAuthKey(oauthKeyId);
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(DV_ENV_KEY);
    localStorage.removeItem(AZ_SUB_KEY);
    localStorage.removeItem(GCP_KEY);
    localStorage.removeItem(OPENAI_KEY);
    localStorage.removeItem(CLAUDE_KEY);
    localStorage.removeItem(GEMINI_ENTERPRISE_KEY);
    localStorage.removeItem(GEMINI_ENTERPRISE_TOKEN_CONN);
    setOauthKeyId(null);
    setTenantId(null);
    setDataverseEnvUrl(null);
    setAzureSubscriptionId(null);
    setGoogleKeyId(null);
    setOpenaiKeyId(null);
    setClaudeKeyId(null);
    setGeminiEnterpriseKeyId(null);
  }, [oauthKeyId]);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isConnecting, error: authError, oauthKeyId, tenantId, dataverseEnvUrl, azureSubscriptionId, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId, connect, connectGoogle, disconnectGoogle, connectOpenAI, disconnectOpenAI, connectClaude, disconnectClaude, connectGeminiEnterprise, connectGeminiEnterpriseToken, disconnectGeminiEnterprise, updateConnection, disconnect }}
    >
      <GovernanceContext.Provider value={{ state: govState, dispatch: govDispatch }}>
        {children}
      </GovernanceContext.Provider>
    </AuthContext.Provider>
  );
}

export function useGovernance() {
  const ctx = useContext(GovernanceContext);
  if (!ctx) throw new Error("useGovernance must be used within AgentGovernanceProvider");
  return ctx;
}

export function useAgentAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAgentAuth must be used within AgentGovernanceProvider");
  return ctx;
}
