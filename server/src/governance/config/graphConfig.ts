export const GRAPH_BASE = "https://graph.microsoft.com";

export const ENDPOINTS = {
  organization: "/v1.0/organization",
  servicePrincipals: "/v1.0/servicePrincipals",
  oauth2PermissionGrants: "/v1.0/oauth2PermissionGrants",
  signIns: "/v1.0/auditLogs/signIns",
  users: "/v1.0/users",
  // Teams app catalog — lists all Teams apps (bots, messaging extensions, ISV apps)
  teamsApps: "/v1.0/appCatalogs/teamsApps",
  // User-installed Teams apps (shows personal copilot agents)
  meInstalledApps: "/v1.0/me/teamwork/installedApps",
  // Beta endpoints (may not be available in all tenants)
  genAiInsights: "/beta/networkAccess/logs/generativeAIInsights",
  agentIdentities: "/beta/agentIdentities",
  // M365 Copilot agents (personal + declarative)
  copilotAgents: "/beta/copilot/agents",
} as const;
