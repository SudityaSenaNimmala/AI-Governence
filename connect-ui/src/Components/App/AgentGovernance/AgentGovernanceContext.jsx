import { createContext, useContext, useReducer, useState, useCallback } from "react";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";
import { DEMO_DISCOVERY_RESULT } from "./demoData";

const STORAGE_KEY = "ag_oauth_key_id";
const TENANT_KEY = "ag_tenant_id";
const DV_ENV_KEY = "ag_dataverse_env_url";
const AZ_SUB_KEY = "ag_azure_subscription_id";
const GCP_KEY = "ag_google_key_id";

export const SCOPE_LABELS = {
  all: "All Applications",
  // Microsoft platforms
  copilot_studio: "Copilot Studio",
  personal_agent: "Personal Agents",
  sharepoint_embedded: "SharePoint",
  teams_app: "Teams Bots",
  azure_foundry: "Azure AI Foundry",
  // Google platforms
  agent_builder: "Agent Builder",
  gemini_gems: "Gemini Gems",
  notebook_lm: "NotebookLM",
  google_chat_bots: "Chat Bots",
  reasoning_engines: "Reasoning Engines",
};

export const SCOPE_COLORS = {
  all: "#6366f1",
  // Microsoft
  copilot_studio: "#742774",
  personal_agent: "#0078D4",
  teams_chat_agent: "#5B5FC7",
  sharepoint_embedded: "#038387",
  teams_app: "#5B5FC7",
  isv_store: "#D83B01",
  azure_foundry: "#0078D4",
  // Google
  agent_builder: "#4285F4",
  gemini_gems: "#886FBF",
  notebook_lm: "#EA4335",
  google_chat_bots: "#00AC47",
  reasoning_engines: "#0F9D58",
  // Legacy
  vertex_ai: "#1A73E8",
  google_workspace: "#4285F4",
  google_chat: "#00AC47",
  apps_script: "#0F9D58",
  gemini_workspace: "#886FBF",
  oauth_app: "#8b5cf6",
};

// Vendor-level grouping. The header surfaces a top-level vendor selector and
// a nested platform (scope) selector that is filtered by the current vendor.
export const VENDOR_LABELS = {
  all: "All Applications",
  microsoft: "Microsoft",
  google: "Google",
};

export const VENDOR_COLORS = {
  all: "#6366f1",
  microsoft: "#0078D4",
  google: "#4285F4",
};

// Platforms that belong to each vendor. "all" covers every platform.
export const VENDOR_PLATFORMS = {
  microsoft: ["copilot_studio", "personal_agent", "sharepoint_embedded", "teams_app", "azure_foundry"],
  google: ["agent_builder", "gemini_gems", "notebook_lm", "google_chat_bots", "reasoning_engines"],
};

// Normalize an agent's vendor field to one of: "microsoft" | "google" | other.
export function agentVendorKey(agent) {
  const v = (agent?.vendor || "").toLowerCase();
  if (v.includes("microsoft")) return "microsoft";
  if (v.includes("google")) return "google";
  return v || "unknown";
}

const governanceInitialState = {
  activeTab: "overview",
  selectedVendor: "all",
  selectedScope: "all",
  discoveryStatus: "success",
  discoveryProgress: "",
  discoveryResult: DEMO_DISCOVERY_RESULT,
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
    case "SET_VENDOR":
      return {
        ...state,
        selectedVendor: action.vendor,
        selectedScope: "all",
        platformFilter: "all",
        selectedAgentId: null,
      };
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

// Filter agents first by vendor (microsoft | google | all) and then by the
// platform (scope) selected inside that vendor.
export function getScopedAgents(result, scope, vendor = "all") {
  if (!result) return [];
  let agents = result.agents;
  if (vendor && vendor !== "all") {
    agents = agents.filter((a) => agentVendorKey(a) === vendor);
  }
  if (scope && scope !== "all") {
    agents = agents.filter((a) => a.platform === scope);
  }
  return agents;
}

// Per-platform counts. When a vendor is selected we only include platforms
// that belong to that vendor; "all" covers every platform.
export function getScopeCounts(result, vendor = "all") {
  const counts = { all: 0 };
  const platforms =
    vendor === "microsoft"
      ? VENDOR_PLATFORMS.microsoft
      : vendor === "google"
      ? VENDOR_PLATFORMS.google
      : [...VENDOR_PLATFORMS.microsoft, ...VENDOR_PLATFORMS.google];
  for (const p of platforms) counts[p] = 0;
  if (!result) return counts;
  for (const a of result.agents) {
    if (vendor !== "all" && agentVendorKey(a) !== vendor) continue;
    counts.all++;
    if (a.platform in counts) counts[a.platform]++;
  }
  return counts;
}

// Per-vendor counts — used by the top-level vendor selector so each option
// can show "(n)" next to its label.
export function getVendorCounts(result) {
  const counts = { all: 0, microsoft: 0, google: 0 };
  if (!result) return counts;
  for (const a of result.agents) {
    counts.all++;
    const key = agentVendorKey(a);
    if (key in counts) counts[key]++;
  }
  return counts;
}

export function computeMetrics(result, scope = "all", vendor = "all") {
  if (!result) {
    return {
      totalAgents: 0, complianceScore: 0, highRiskCount: 0,
      staleCount: 0, orphanedCount: 0, activeCount: 0,
      riskDistribution: { critical: 0, high: 0, medium: 0, low: 0 },
      platformDistribution: {},
      recentEvents: [],
    };
  }

  const agents = getScopedAgents(result, scope, vendor);
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
  const criticalAgents = agents.filter(a => a.risk.level === "critical");
  const highAgents = agents.filter(a => a.risk.level === "high");
  const riskAgents = [...criticalAgents, ...highAgents];
  for (const a of riskAgents) {
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
  if (recentEvents.length < 5) {
    for (const a of agents) {
      if (recentEvents.length >= 5) break;
      const aLastActive = a.activity?.lastActiveTimestamp
        ? new Date(a.activity.lastActiveTimestamp).getTime()
        : a.lastModified ? new Date(a.lastModified).getTime() : null;
      if ((!aLastActive || (now - aLastActive) > staleThresholdMs) && !recentEvents.find(e => e.agentId === a.id)) {
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

  const connectGoogle = useCallback(async (serviceAccountJson, gcpProjectId) => {
    setAuthError(null);
    try {
      const result = await agentGovernanceApi.connectGoogle(serviceAccountJson, gcpProjectId);
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
    setOauthKeyId(null);
    setTenantId(null);
    setDataverseEnvUrl(null);
    setAzureSubscriptionId(null);
    setGoogleKeyId(null);
  }, [oauthKeyId]);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isConnecting, error: authError, oauthKeyId, tenantId, dataverseEnvUrl, azureSubscriptionId, googleKeyId, connect, connectGoogle, disconnectGoogle, updateConnection, disconnect }}
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
