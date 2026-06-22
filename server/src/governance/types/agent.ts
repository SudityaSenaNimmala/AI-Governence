// Risk levels following PRD Section 4.2
export type RiskLevel = "critical" | "high" | "medium" | "low";

// Classification result for AI tool detection
export interface AgentClassification {
  signatureId: string;
  signatureName: string;
  confidence: number;
  matchedFields: string[];
}

// Agent lifecycle states per PRD Section 4.3
export type LifecycleStatus =
  | "pending_approval"
  | "active"
  | "due_for_renewal"
  | "stale"
  | "suspended"
  | "retired";

// Agent platforms per PRD
export type AgentPlatform =
  | "copilot_studio"
  | "sharepoint_embedded"
  | "azure_foundry"
  | "teams_app"              // Teams bots / messaging extensions
  | "teams_chat_agent"       // M365 Chat agents (declarative copilots)
  | "personal_agent"         // Personal Copilot agents created by users
  | "isv_store"              // Third-party ISV apps from Teams/M365 store
  | "power_automate"
  | "oauth_app"              // external AI tools (ChatGPT, Claude, etc.)
  | "google_workspace"       // OAuth apps detected in Google Workspace user tokens
  | "google_chat"            // Google Chat bots/apps
  | "vertex_ai"              // Vertex AI endpoints, models, jobs
  | "apps_script"            // Google Apps Script bots/automations
  | "gemini_workspace"       // Gemini for Google Workspace add-on
  | "claude_project"         // Claude.ai Projects (Anthropic — admin key)
  | "claude_model"           // Claude model deployments (standard key)
  | "manual";                // manually registered

export type AgentCategory =
  | "generative-ai"
  | "code-assistant"
  | "productivity-ai"
  | "ai-platform"
  | "custom-agent"
  | "unknown";

// AI signature for OAuth-based external tool detection
export interface AiSignature {
  id: string;
  name: string;
  vendor: string;
  category: AgentCategory;
  matchPatterns: Array<{
    field: "displayName" | "appDisplayName" | "publisherName" | "homepage" | "appId";
    pattern: string;
  }>;
  knownAppIds?: string[];
  baseRiskLevel: RiskLevel;
  description: string;
  icon: string;
}

// Connector info per PRD Section 4.1
export interface AgentConnector {
  name: string;
  type: string; // SharePoint, Exchange, HTTP, etc.
  scope?: string;
  destinationUrl?: string; // may not be available per PRD
}

// Risk assessment per PRD Section 4.2
export interface RiskAssessment {
  score: number; // 0-100 (lower = higher risk per PRD convention)
  level: RiskLevel;
  factors: Array<{
    signal: string;
    weight: "high" | "medium" | "low" | "info";
    description: string;
  }>;
  recommendations: string[];
  computedAt: string;
}

// Activity data per PRD Section 4.5
export interface AgentActivity {
  totalInvocations: number;
  invocationsLast7Days: number;
  invocationsLast30Days: number;
  invocationsLast90Days: number;
  lastActiveTimestamp?: string; // from CopilotStudio audit events
  uniqueUsers: number;
  userBreakdown: Array<{
    userPrincipalName: string;
    displayName: string;
    invocationCount: number;
    lastActivity: string;
  }>;
}

// Core agent entity per PRD Section 4.1
export interface DiscoveredAgent {
  // Identity
  id: string; // CloudFuze internal ID
  botId?: string; // Dataverse bot ID (stable GUID)
  appId?: string; // Entra app ID for OAuth apps
  servicePrincipalId?: string;

  // Metadata
  name: string;
  description?: string;
  vendor: string;
  category: AgentCategory;
  platform: AgentPlatform;

  // Discovery
  discoverySource: string; // "dataverse" | "graph" | "power_platform" | "oauth" | "manual"
  firstSeen: string;
  lastModified?: string;
  publishedStatus?: "active" | "inactive" | "draft";

  // Ownership per PRD Section 4.3
  owner?: {
    id: string;
    displayName: string;
    userPrincipalName: string;
    accountEnabled: boolean;
  };
  isOrphaned: boolean;

  // Connectors per PRD Section 4.1
  connectors: AgentConnector[];

  // Permissions (for OAuth apps)
  permissions: string[];
  consentType?: string;

  // Deployment
  deployedTo?: string[]; // Teams, SharePoint sites, etc.
  environment?: string; // Power Platform environment

  // Lifecycle per PRD Section 4.3
  lifecycleStatus: LifecycleStatus;
  renewalDate?: string;
  renewalPeriodDays?: number;

  // Risk per PRD Section 4.2
  risk: RiskAssessment;

  // Activity per PRD Section 4.5
  activity: AgentActivity;

  // AI/LLM Configuration (for Copilot Studio agents)
  llmModel?: string;           // e.g. "Claude Sonnet 4.5", "GPT-4o"
  llmModelHint?: string;       // raw hint e.g. "Sonnet46"
  aiSettings?: {
    generativeActionsEnabled?: boolean;
    useModelKnowledge?: boolean;
    isFileAnalysisEnabled?: boolean;
    webBrowsingEnabled?: boolean;
  };
  topicCount?: number;

  // Classification (for OAuth-detected AI tools)
  classification?: {
    signatureId: string;
    signatureName: string;
    confidence: number;
    matchedFields: string[];
  };
}

// Governance policy per PRD Section 4.4
export interface GovernancePolicy {
  id: string;
  name: string;
  description: string;
  type: "lifecycle" | "risk" | "connector" | "dlp" | "custom";
  severity: RiskLevel;
  status: "active" | "draft" | "under_review";
  template?: string; // template name if from template
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  appliesTo: {
    scope: "all" | "platform" | "connector_type" | "owner" | "specific";
    values?: string[];
  };
  violations: number;
  lastEvaluated?: string;
}

export interface PolicyCondition {
  field: string;
  operator: "equals" | "greater_than" | "less_than" | "contains" | "is_empty";
  value: string | number | boolean;
}

export interface PolicyAction {
  type: "notify" | "suspend" | "escalate" | "flag" | "archive";
  target?: string; // email, admin group, etc.
}

// Discovery result
export interface DiscoveryResult {
  tenant: {
    id: string;
    name: string;
    domain: string;
    license?: string; // E3, E5, etc.
  };
  agents: DiscoveredAgent[];
  totalServicePrincipals: number;
  totalUsers: number;
  totalEnvironments: number;
  scanTimestamp: string;
  scanDuration?: number; // ms
  warnings?: string[];
}

// Dashboard metrics per PRD Section 4.6
export interface DashboardMetrics {
  totalAgents: number;
  complianceScore: number; // 0-100 per PRD
  highRiskCount: number;
  staleCount: number;
  orphanedCount: number;
  activeCount: number;
  estimatedMonthlyCost?: number;
  riskDistribution: Record<RiskLevel, number>;
  platformDistribution: Record<string, number>;
  recentEvents: GovernanceEvent[];
}

export interface GovernanceEvent {
  id: string;
  type: "new_agent" | "risk_change" | "renewal_due" | "policy_violation" | "ownership_lapse" | "suspension" | "agent_stale";
  agentId: string;
  agentName: string;
  description: string;
  severity: RiskLevel;
  timestamp: string;
  actor?: string;
}
