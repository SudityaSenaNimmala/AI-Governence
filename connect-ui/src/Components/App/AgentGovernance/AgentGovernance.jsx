import { useState, useEffect, useRef, useCallback } from "react";
import { AgentGovernanceProvider, useAgentAuth, useGovernance, getScopeCounts, SCOPE_LABELS, SCOPE_COLORS } from "./AgentGovernanceContext";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";
import { ConnectTenantModal } from "./ConnectTenantModal";
import { OverviewTab } from "./tabs/OverviewTab";
import { DiscoveryTab } from "./tabs/DiscoveryTab";
import { PoliciesTab } from "./tabs/PoliciesTab";

import { UserActivityTab } from "./tabs/UserActivityTab";
import { AlertsTab } from "./tabs/AlertsTab";
import { CostTab } from "./tabs/CostTab";
import { ShieldCheck, RefreshCw, LogOut, Plus, Radar, Shield, Settings2, Activity, ChevronDown, Cloud, Bell, DollarSign } from "lucide-react";
import "./css/AgentGovernance.css";

const TABS = [
  { id: "overview",        label: "Overview",        icon: <Radar size={14} /> },
  { id: "discovery",       label: "Discovery",       icon: <Shield size={14} /> },
  { id: "activity",        label: "User Activity",   icon: <Activity size={14} /> },
  { id: "alerts",          label: "Stale Agents",    icon: <Bell size={14} /> },
  { id: "cost",            label: "Cost",            icon: <DollarSign size={14} /> },
  { id: "policies",        label: "Policies",        icon: <ShieldCheck size={14} /> },
];

// ── Helper: convert Gemini Enterprise (Agentspace) data → standard agent array ──
function convertGeminiEnterpriseToAgents(data) {
  const agents = [];
  const now = new Date().toISOString();
  const engineName = data?.engine?.displayName || "Gemini Enterprise";
  for (const a of data?.agents || []) {
    agents.push({
      id: a.id,
      appId: a.id,
      name: a.displayName || "Agent",
      description: a.description || `Gemini Enterprise ${a.type || "agent"} in ${engineName}`,
      vendor: "Gemini Enterprise",
      category: "generative-ai",
      platform: "gemini_enterprise",
      discoverySource: "gemini_enterprise",
      firstSeen: a.createTime || now,
      lastModified: a.updateTime,
      publishedStatus: a.state === "DISABLED" ? "inactive" : "active",
      isOrphaned: false,
      connectors: (a.dataStoreIds || []).map((ds) => ({ name: ds, type: "DataStore" })),
      permissions: [],
      environment: data?.engine?.id,
      llmModel: "Gemini",
      lifecycleStatus: a.state === "DISABLED" ? "stale" : "active",
      risk: {
        score: 50, level: "medium",
        factors: [{ signal: "Gemini Enterprise Agent", weight: "medium", description: `${a.type || "Agent"} with ${(a.dataStoreIds || []).length} data store(s)` }],
        recommendations: (a.dataStoreIds || []).length ? ["Review connected data stores and their access scope"] : [],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 0, userBreakdown: [],
        lastActiveTimestamp: a.updateTime || a.createTime || now,
      },
    });
  }
  return agents;
}

// ── Helper: convert /api/google/discover result → standard agent array ──────
// Shared by the Google-only scan path and the parallel MS+Google scan path.
function convertGoogleResultToAgents(googleResult) {
  const agents = [];
  const now = new Date().toISOString();

  // 1. Vertex AI Reasoning Engines
  for (const engine of googleResult.vertexReasoningEngines || []) {
    agents.push({
      id: `vertex-agent-${engine.name}`,
      name: engine.displayName,
      description: engine.description || "Vertex AI Agent (Reasoning Engine)",
      vendor: "Google",
      category: "generative-ai",
      platform: "reasoning_engine",
      discoverySource: "vertex_ai_reasoning_engines",
      firstSeen: engine.createTime || now,
      lastModified: engine.updateTime,
      publishedStatus: "active",
      isOrphaned: false,
      connectors: [],
      permissions: [],
      environment: googleResult.projectId,
      lifecycleStatus: "active",
      risk: { score: 50, level: "medium", factors: [], recommendations: [], computedAt: now },
      activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
    });
  }

  // 2. Google Chat Bots
  for (const bot of googleResult.chatBots || []) {
    const participants = bot.humanParticipants || [];
    const participantLabel = participants.length > 0 ? ` · Installed by ${participants.join(", ")}` : "";
    const description = bot.singleUserBotDm
      ? `Private bot DM${participantLabel}`
      : `Google Chat bot in ${(bot.spaces || []).length} space(s)${participantLabel}`;

    agents.push({
      id: `google-chat-${bot.id || bot.botName}`,
      name: bot.displayName || bot.botDisplayName,
      description,
      vendor: "Google",
      category: "custom-agent",
      platform: "google_chat",
      discoverySource: "google_chat_api",
      firstSeen: bot.firstSeen || bot.createTime || now,
      publishedStatus: "active",
      isOrphaned: false,
      connectors: [{ name: "Google Chat", type: "Chat" }],
      permissions: [],
      lifecycleStatus: "active",
      chatSpaceUri: (bot.spaceUris && bot.spaceUris[0]) || null,
      risk: { score: 80, level: "low", factors: [], recommendations: [], computedAt: now },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: participants.length,
        userBreakdown: participants.map(p => ({ displayName: p, userPrincipalName: p, invocationCount: 0, lastActive: null, createdAt: null })),
      },
    });
  }

  // 4. Agent Builder / Gemini Apps (Discovery Engine)
  for (const app of googleResult.agentBuilderApps || []) {
    const solutionType = app.solutionType?.replace("SOLUTION_TYPE_", "").toLowerCase() || "agent";
    const dataStoreCount = app.dataStoreIds?.length || 0;
    agents.push({
      id: `agent-builder-${app.name}`,
      name: app.displayName,
      description: `Gemini Agent Builder app (${solutionType})${dataStoreCount > 0 ? ` — ${dataStoreCount} data store(s)` : ""}`,
      vendor: "Google",
      category: "generative-ai",
      platform: "agent_builder",
      discoverySource: "google_agent_builder",
      firstSeen: app.createTime || now,
      lastModified: app.updateTime,
      publishedStatus: "active",
      isOrphaned: false,
      connectors: (app.dataStoreIds || []).map(ds => ({ name: ds, type: "DataStore" })),
      permissions: [],
      environment: googleResult.projectId,
      llmModel: "Gemini",
      lifecycleStatus: "active",
      risk: { score: 45, level: "high", factors: [{ signal: "Gemini Agent", weight: "medium", description: "AI agent with data store access" }], recommendations: ["Review data store connections and access scope"], computedAt: now },
      activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [] },
    });
  }

  // 5. Gemini Gems
  for (const gem of googleResult.gems || []) {
    agents.push({
      id: `gem-${gem.id}`,
      name: gem.name,
      description: `Custom Gemini Gem created by ${gem.owner?.displayName || gem.owner?.email}${gem.shared ? ` · Shared with ${gem.sharedWith?.length || 0} user${(gem.sharedWith?.length || 0) !== 1 ? "s" : ""}` : " · Private"}`,
      vendor: "Google",
      category: "generative-ai",
      platform: "gemini_gem",
      discoverySource: "google_drive_api",
      firstSeen: gem.createdTime || now,
      lastModified: gem.modifiedTime,
      publishedStatus: gem.shared ? "active" : "private",
      isOrphaned: false,
      owner: gem.owner ? { id: gem.owner.email, displayName: gem.owner.displayName, userPrincipalName: gem.owner.email, accountEnabled: true } : undefined,
      connectors: [],
      permissions: (gem.sharedWith || []).map(s => ({ name: s.displayName || s.email, role: s.role })),
      lifecycleStatus: "active",
      risk: {
        score: gem.shared ? 55 : 30,
        level: gem.shared ? "medium" : "low",
        factors: [{ signal: "Custom AI Gem", weight: gem.shared ? "medium" : "low", description: gem.shared ? `Shared Gem accessible by ${gem.sharedWith?.length || 0} users` : "Private Gem, single user" }],
        recommendations: gem.shared ? ["Review shared Gem instructions and data access"] : [],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 1 + (gem.sharedWith?.length || 0),
        userBreakdown: [
          { displayName: gem.owner?.displayName || gem.owner?.email, userPrincipalName: gem.owner?.email, invocationCount: 0, lastActive: gem.modifiedTime, createdAt: gem.createdTime },
          ...(gem.sharedWith || []).map(s => ({ displayName: s.displayName || s.email, userPrincipalName: s.email, invocationCount: 0, lastActive: null, createdAt: null })),
        ],
      },
    });
  }

  // 6. NotebookLM Enterprise
  for (const nb of googleResult.notebookLMNotebooks || []) {
    agents.push({
      id: `notebooklm-${nb.id}`,
      name: nb.displayName || "NotebookLM Notebook",
      description: `NotebookLM Enterprise notebook${nb.sourceCount ? ` — ${nb.sourceCount} source(s)` : ""}${nb.creator ? ` by ${nb.creator}` : ""}`,
      vendor: "Google",
      category: "generative-ai",
      platform: "notebooklm",
      discoverySource: "notebooklm_enterprise",
      firstSeen: nb.createTime || now,
      lastModified: nb.updateTime,
      publishedStatus: "active",
      isOrphaned: false,
      connectors: [],
      permissions: [],
      environment: googleResult.projectId,
      lifecycleStatus: "active",
      risk: { score: 40, level: "medium", factors: [{ signal: "Personal Knowledge Agent", weight: "medium", description: "AI-powered knowledge base with uploaded documents" }], recommendations: ["Review data sources for sensitive content"], computedAt: now },
      activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 1, userBreakdown: [] },
    });
  }

  return agents;
}

// ── Helper: merge per-platform settled results → single object for convertGoogleResultToAgents ──
function mergeGooglePlatformResults(settledResults) {
  const merged = {
    vertexReasoningEngines: [],
    chatBots: [],
    agentBuilderApps: [],
    gems: [],
    notebookLMNotebooks: [],
    projectId: null,
    domain: null,
    warnings: [],
  };
  for (const settled of settledResults) {
    if (settled.status === "rejected") {
      merged.warnings.push(`Platform scan failed: ${settled.reason?.message || "unknown error"}`);
      continue;
    }
    const r = settled.value;
    if (r.vertexReasoningEngines?.length) merged.vertexReasoningEngines.push(...r.vertexReasoningEngines);
    if (r.chatBots?.length) merged.chatBots.push(...r.chatBots);
    if (r.agentBuilderApps?.length) merged.agentBuilderApps.push(...r.agentBuilderApps);
    if (r.gems?.length) merged.gems.push(...r.gems);
    if (r.notebookLMNotebooks?.length) merged.notebookLMNotebooks.push(...r.notebookLMNotebooks);
    if (r.projectId && !merged.projectId) merged.projectId = r.projectId;
    if (r.domain && !merged.domain) merged.domain = r.domain;
    if (r.warnings?.length) merged.warnings.push(...r.warnings);
  }
  return merged;
}

const GOOGLE_PLATFORMS = ["reasoning_engines", "agent_builder", "chat_bots", "gems", "notebooklm"];
const OPENAI_PLATFORMS = ["assistants", "my_gpts", "vector_stores", "api_keys"];
const CLAUDE_PLATFORMS = ["claude_ai_projects", "agents"];

// Handles both Unix timestamps (number) and ISO strings (ChatGPT gizmo API)
function parseTs(ts, fallback) {
  if (!ts) return fallback;
  try {
    const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
    return isNaN(d.getTime()) ? fallback : d.toISOString();
  } catch { return fallback; }
}

// ── Helper: convert OpenAI scan results → standard agent array ──────────────
function convertOpenAIResultToAgents(merged) {
  const agents = [];
  const now = new Date().toISOString();

  for (const assistant of merged.assistants || []) {
    const toolTypes = (assistant.tools || []).map(t => t.type);
    const hasFileSearch = toolTypes.includes("file_search");
    const hasCodeInterpreter = toolTypes.includes("code_interpreter");
    const hasFunctions = toolTypes.includes("function");
    const riskScore = hasFunctions ? 75 : hasFileSearch || hasCodeInterpreter ? 55 : 40;
    const riskLevel = riskScore >= 70 ? "high" : riskScore >= 50 ? "medium" : "low";
    const riskFactors = [];
    if (hasFunctions) riskFactors.push({ signal: "Function Tools", weight: "high", description: "Can call external APIs via function calling" });
    if (hasFileSearch) riskFactors.push({ signal: "File Search", weight: "medium", description: "Has access to uploaded files / vector stores" });
    if (hasCodeInterpreter) riskFactors.push({ signal: "Code Interpreter", weight: "medium", description: "Can execute code in a sandboxed environment" });

    const knowledgeConnectors = (assistant._vectorStoreIds || assistant.tool_resources?.file_search?.vector_store_ids || []).map((id, idx) => ({
      name: `Vector Store ${idx + 1}`,
      id,
      type: "VectorStore",
      fileCount: assistant._fileCount || 0,
    }));
    const functionTools = (assistant.tools || []).filter(t => t.type === "function").map(t => ({ name: t.function?.name || "function", type: "Function" }));
    const codeTools = (assistant.tools || []).filter(t => t.type === "code_interpreter").map(() => ({ name: "Code Interpreter", type: "CodeInterpreter" }));

    const firstSeen = assistant.created_at ? new Date(assistant.created_at * 1000).toISOString() : now;
    agents.push({
      id: `openai-assistant-${assistant.id}`,
      appId: assistant.id,
      name: assistant.name || `Assistant ${assistant.id}`,
      description: assistant.description || `OpenAI Assistant (${assistant.model})`,
      vendor: "OpenAI",
      category: "generative-ai",
      platform: "openai_assistant",
      discoverySource: "openai_assistants_api",
      firstSeen,
      publishedStatus: "active",
      isOrphaned: false,
      llmModel: assistant.model,
      instructions: assistant.instructions,
      connectors: [...knowledgeConnectors, ...functionTools, ...codeTools],
      permissions: [],
      lifecycleStatus: "active",
      risk: { score: riskScore, level: riskLevel, factors: riskFactors, recommendations: hasFunctions ? ["Review function tool permissions and allowed API endpoints"] : [], computedAt: now },
      activity: { totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0, uniqueUsers: 0, userBreakdown: [], lastActiveTimestamp: firstSeen },
    });
  }

  // Custom GPTs (via session token)
  for (const gpt of merged.gpts || []) {
    const gptId = gpt.id || gpt.gizmo_id || gpt.slug;
    const displayName = gpt.display?.name || gpt.name || gpt.title || "Custom GPT";
    const description = gpt.display?.description || gpt.description || "";
    const sharingRecipient = gpt.sharing?.recipient || gpt.sharing || "";
    const isPublic = sharingRecipient === "marketplace" || sharingRecipient === "public" || sharingRecipient === "link";
    const authorName = gpt.author?.display_name || gpt.author?.user_email || "";
    const usersCount = gpt.usage_stats?.user_count || gpt.user_count || 0;

    agents.push({
      id: `chatgpt-gpt-${gptId}`,
      name: displayName,
      description: description || `Custom GPT${isPublic ? " (Public)" : " (Private)"}`,
      vendor: "OpenAI",
      category: "generative-ai",
      platform: "custom_gpt",
      discoverySource: "chatgpt_session",
      firstSeen: gpt.created_at ? parseTs(gpt.created_at, now) : now,
      lastModified: gpt.updated_at ? parseTs(gpt.updated_at, now) : undefined,
      publishedStatus: isPublic ? "active" : "private",
      isOrphaned: false,
      llmModel: gpt.display?.prompt_starters ? "GPT-4o" : "GPT-4o",
      owner: authorName ? { id: gpt.author?.user_id || gptId, displayName: authorName, userPrincipalName: gpt.author?.user_email || "", accountEnabled: true } : undefined,
      connectors: [
        ...(gpt.tools || []).map(t => ({ name: t.type === "dalle" ? "DALL-E Image Generation" : t.type === "browser" ? "Web Browsing" : t.type === "python" ? "Code Interpreter" : t.type, type: "Tool" })),
      ],
      permissions: isPublic ? [{ name: "Public", type: "public_access" }] : [],
      lifecycleStatus: "active",
      appId: gptId,
      shortUrl: gpt.short_url,
      categories: gpt.categories || [],
      risk: {
        score: isPublic ? 65 : 35,
        level: isPublic ? "medium" : "low",
        factors: isPublic ? [{ signal: "Public GPT", weight: "medium", description: `Publicly accessible Custom GPT with ${usersCount} users` }] : [],
        recommendations: isPublic ? ["Review GPT instructions and data sources for sensitive information"] : [],
        computedAt: now,
      },
      activity: {
        totalInvocations: usersCount, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: usersCount, userBreakdown: [],
        lastActiveTimestamp: gpt.updated_at ? parseTs(gpt.updated_at, now) : (gpt.created_at ? parseTs(gpt.created_at, now) : now),
      },
    });
  }

  // OpenAI Organization API Keys
  for (const key of merged.apiKeys || []) {
    const hasBeenUsed = !!key.last_used_at;
    agents.push({
      id: `openai-apikey-${key.id}`,
      appId: key.id,
      name: key.name || `API Key ${key.id}`,
      description: `OpenAI API Key in project "${key.project_name || "Default"}"${key.created_by ? ` · created by ${key.created_by}` : ""}${hasBeenUsed ? ` · last used ${new Date(key.last_used_at * 1000).toLocaleDateString()}` : " · never used"}`,
      vendor: "OpenAI",
      category: "ai-platform",
      platform: "openai_api_key",
      discoverySource: "openai_assistants_api",
      firstSeen: key.created_at ? new Date(key.created_at * 1000).toISOString() : now,
      lastModified: key.last_used_at ? new Date(key.last_used_at * 1000).toISOString() : (key.created_at ? new Date(key.created_at * 1000).toISOString() : now),
      publishedStatus: "active",
      isOrphaned: !hasBeenUsed,
      connectors: [],
      permissions: [],
      lifecycleStatus: hasBeenUsed ? "active" : "stale",
      risk: {
        score: hasBeenUsed ? 60 : 35,
        level: hasBeenUsed ? "medium" : "low",
        factors: [{ signal: "OpenAI API Key", weight: "medium", description: `API key grants access to OpenAI models and services` }],
        recommendations: ["Verify which applications use this key", "Rotate keys that have never been used"],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 0, userBreakdown: [],
        lastActiveTimestamp: key.last_used_at ? new Date(key.last_used_at * 1000).toISOString() : (key.created_at ? new Date(key.created_at * 1000).toISOString() : now),
      },
    });
  }

  return agents;
}

function mergeOpenAIPlatformResults(settledResults) {
  const merged = { assistants: [], gpts: [], vectorStores: [], apiKeys: [], warnings: [] };
  for (const settled of settledResults) {
    if (settled.status === "rejected") {
      merged.warnings.push(`OpenAI platform scan failed: ${settled.reason?.message || "unknown error"}`);
      continue;
    }
    const r = settled.value;
    if (r.assistants?.length) merged.assistants.push(...r.assistants);
    if (r.gpts?.length) merged.gpts.push(...r.gpts);
    if (r.vectorStores?.length) merged.vectorStores.push(...r.vectorStores);
    if (r.apiKeys?.length) merged.apiKeys.push(...r.apiKeys);
    if (r.warnings?.length) merged.warnings.push(...r.warnings);
  }
  return merged;
}

// Pricing lookup for Claude models (input $/M tokens)
const CLAUDE_MODEL_PRICING = {
  "claude-opus-4":     { input: 15.0,  output: 75.0  },
  "claude-sonnet-4-6": { input: 3.0,   output: 15.0  },
  "claude-sonnet-4-5": { input: 3.0,   output: 15.0  },
  "claude-haiku-4-5":  { input: 0.8,   output: 4.0   },
  "claude-3-5-sonnet": { input: 3.0,   output: 15.0  },
  "claude-3-5-haiku":  { input: 0.8,   output: 4.0   },
  "claude-3-opus":     { input: 15.0,  output: 75.0  },
  "claude-3-sonnet":   { input: 3.0,   output: 15.0  },
  "claude-3-haiku":    { input: 0.25,  output: 1.25  },
};

function getClaudeRisk(modelId) {
  const lower = modelId.toLowerCase();
  if (lower.includes("opus"))   return { score: 45, level: "high",   label: "Most capable — highest data sensitivity" };
  if (lower.includes("sonnet")) return { score: 55, level: "medium", label: "Balanced capability and cost" };
  if (lower.includes("haiku"))  return { score: 70, level: "low",    label: "Lightweight — lower risk profile" };
  return { score: 55, level: "medium", label: "Claude model" };
}

// ── Helper: convert Claude scan results → standard agent array ───────────────
function convertClaudeResultToAgents(merged) {
  const agents = [];
  const now = new Date().toISOString();

  // Claude.ai Projects (admin key only)
  for (const project of merged.projects || []) {
    agents.push({
      id: `claude-project-${project.id}`,
      appId: project.id,
      name: project.name || project.display_name || `Claude Workspace ${project.id}`,
      description: project.description || "Claude API Workspace — groups API keys and usage in console.anthropic.com",
      vendor: "Claude / Anthropic",
      category: "generative-ai",
      platform: "claude_project",
      discoverySource: "anthropic_admin_api",
      firstSeen: project.created_at || now,
      lastModified: project.updated_at || now,
      publishedStatus: project.status === "active" ? "active" : "inactive",
      isOrphaned: false,
      connectors: [],
      permissions: [],
      lifecycleStatus: "active",
      risk: {
        score: 55,
        level: "medium",
        factors: [{ signal: "Claude.ai Project", weight: "medium", description: "Team workspace with access to Claude models and uploaded files" }],
        recommendations: ["Review project members and uploaded file contents for sensitive data"],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 0, userBreakdown: [],
        lastActiveTimestamp: project.updated_at || project.created_at || now,
      },
    });
  }

  // Claude Models (standard API key — always available)
  for (const model of merged.models || []) {
    const risk = getClaudeRisk(model.id);
    const pricing = Object.entries(CLAUDE_MODEL_PRICING).find(([k]) => model.id.includes(k))?.[1];
    const pricingLabel = pricing ? `$${pricing.input}/M input · $${pricing.output}/M output tokens` : "See console.anthropic.com for pricing";

    agents.push({
      id: `claude-model-${model.id}`,
      appId: model.id,
      name: model.display_name || model.id,
      description: `${pricingLabel}`,
      vendor: "Claude / Anthropic",
      category: "ai-platform",
      platform: "claude_model",
      discoverySource: "anthropic_models_api",
      firstSeen: model.created_at || now,
      lastModified: model.created_at || now,
      publishedStatus: "active",
      isOrphaned: false,
      llmModel: model.id,
      connectors: [],
      permissions: [],
      lifecycleStatus: "active",
      risk: {
        score: risk.score,
        level: risk.level,
        factors: [{ signal: "Claude Model Access", weight: "medium", description: risk.label }],
        recommendations: ["Ensure only authorized applications are using this model via your API key"],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 0, userBreakdown: [],
        lastActiveTimestamp: model.created_at || now,
      },
    });
  }

  // Claude.ai Projects (via session token)
  for (const project of merged.claudeAiProjects || []) {
    const isPrivate = project.is_private ?? true;
    agents.push({
      id: `claude-ai-project-${project.id}`,
      appId: project.id,
      orgId: project.org_id,
      name: project.name || `Claude.ai Project ${project.id}`,
      description: `Claude.ai Project in "${project.org_name || "Unknown Org"}"${isPrivate ? " (Private)" : " (Shared)"}${project.description ? ` — ${project.description}` : ""}`,
      vendor: "Claude / Anthropic",
      category: "generative-ai",
      platform: "claude_ai_project",
      discoverySource: "claude_ai_session",
      firstSeen: project.created_at || now,
      lastModified: project.updated_at || now,
      publishedStatus: isPrivate ? "private" : "active",
      isOrphaned: false,
      connectors: [],
      permissions: [],
      lifecycleStatus: "active",
      risk: {
        score: isPrivate ? 40 : 60,
        level: isPrivate ? "low" : "medium",
        factors: [{ signal: "Claude.ai Project", weight: isPrivate ? "low" : "medium", description: isPrivate ? "Private project — single user" : `Shared project in org "${project.org_name}"` }],
        recommendations: isPrivate ? [] : ["Review project members and shared knowledge files"],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 0, userBreakdown: [],
        lastActiveTimestamp: project.updated_at || project.created_at || now,
      },
    });
  }

  // Claude API Keys / Agent Identities (admin key + workspaces)
  for (const agentKey of merged.agents || []) {
    const isActive = agentKey.status === "active";
    const hasBeenUsed = !!agentKey.last_used_at;
    agents.push({
      id: `claude-agent-${agentKey.id}`,
      appId: agentKey.id,
      name: agentKey.name || `API Key ${agentKey.id}`,
      description: `Claude API Key in workspace "${agentKey.workspace_name}"${agentKey.created_by ? ` · created by ${agentKey.created_by}` : ""}${hasBeenUsed ? ` · last used ${new Date(agentKey.last_used_at).toLocaleDateString()}` : " · never used"}`,
      vendor: "Claude / Anthropic",
      category: "ai-platform",
      platform: "claude_agent",
      discoverySource: "anthropic_admin_api",
      firstSeen: agentKey.created_at || now,
      lastModified: agentKey.last_used_at || agentKey.created_at || now,
      publishedStatus: isActive ? "active" : "inactive",
      isOrphaned: !isActive,
      connectors: [],
      permissions: [],
      lifecycleStatus: isActive ? (hasBeenUsed ? "active" : "stale") : "stale",
      risk: {
        score: hasBeenUsed ? 60 : 35,
        level: hasBeenUsed ? "medium" : "low",
        factors: [{ signal: "Claude API Key", weight: "medium", description: `API key in workspace "${agentKey.workspace_name}" — grants access to Claude models` }],
        recommendations: ["Verify which applications use this key", "Rotate keys that have never been used"],
        computedAt: now,
      },
      activity: {
        totalInvocations: 0, invocationsLast7Days: 0, invocationsLast30Days: 0, invocationsLast90Days: 0,
        uniqueUsers: 0, userBreakdown: [],
        lastActiveTimestamp: agentKey.last_used_at || agentKey.created_at || now,
      },
    });
  }

  return agents;
}

function mergeClaudePlatformResults(settledResults) {
  const merged = { projects: [], models: [], agents: [], claudeAiProjects: [], warnings: [] };
  const seenWarnings = new Set();
  for (const settled of settledResults) {
    if (settled.status === "rejected") {
      const msg = `Claude platform scan failed: ${settled.reason?.message || "unknown error"}`;
      if (!seenWarnings.has(msg)) { seenWarnings.add(msg); merged.warnings.push(msg); }
      continue;
    }
    const r = settled.value;
    if (r.projects?.length) {
      for (const p of r.projects) {
        if (p.type === "claude_ai_project") merged.claudeAiProjects.push(p);
        else merged.projects.push(p);
      }
    }
    if (r.models?.length)   merged.models.push(...r.models);
    if (r.agents?.length)   merged.agents.push(...r.agents);
    for (const w of (r.warnings || [])) {
      if (!seenWarnings.has(w)) { seenWarnings.add(w); merged.warnings.push(w); }
    }
  }
  return merged;
}

function AgentGovernanceInner() {
  const { isAuthenticated, oauthKeyId, tenantId, dataverseEnvUrl, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId, disconnect, disconnectGoogle, disconnectOpenAI, disconnectClaude, disconnectGeminiEnterprise } = useAgentAuth();
  const { state, dispatch } = useGovernance();
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("connect");
  const [alertCount, setAlertCount] = useState(0);
  const alertIntervalRef = useRef(null);
  const scopeCounts = getScopeCounts(state.discoveryResult);

  const isAnyConnected = isAuthenticated || !!googleKeyId || !!openaiKeyId || !!claudeKeyId || !!geminiEnterpriseKeyId;

  // Background alert monitoring — counts idle agents for the header badge
  const checkAlertCount = useCallback(async () => {
    if (!state.discoveryResult?.agents?.length) return;
    try {
      const res = await agentGovernanceApi.checkAlerts(state.discoveryResult.agents, 43200);
      setAlertCount(res.idle_count || 0);
    } catch {
      // Fallback: compute locally
      const now = Date.now();
      const threshold = 30 * 24 * 60 * 60 * 1000;
      let count = 0;
      for (const agent of state.discoveryResult.agents) {
        const lastActive = agent.activity?.lastActiveTimestamp
          ? new Date(agent.activity.lastActiveTimestamp).getTime()
          : agent.lastModified ? new Date(agent.lastModified).getTime() : null;
        if (!lastActive || (now - lastActive) > threshold) count++;
      }
      setAlertCount(count);
    }
  }, [state.discoveryResult]);

  useEffect(() => {
    checkAlertCount();
    alertIntervalRef.current = setInterval(checkAlertCount, 60000);
    return () => { if (alertIntervalRef.current) clearInterval(alertIntervalRef.current); };
  }, [checkAlertCount]);

  // ── Run scan — all enabled platforms fired in parallel ──────────────────────
  const handleScan = async () => {
    if (!isAnyConnected) return;
    dispatch({ type: "DISCOVERY_START" });
    try {
      const platformLabels = [
        oauthKeyId && "Copilot Studio · Personal Agents · SharePoint · Azure Foundry",
        googleKeyId && "Reasoning Engines · Agent Builder · Chat · Gems · NotebookLM",
        openaiKeyId && "OpenAI Assistants",
        claudeKeyId && "Claude.ai Projects",
        geminiEnterpriseKeyId && "Gemini Enterprise",
      ].filter(Boolean).join(" · ");
      dispatch({ type: "DISCOVERY_PROGRESS", message: `Scanning all platforms in parallel (${platformLabels})...` });

      const msUrl = oauthKeyId
        ? `/api/discovery/run?oauth_key_id=${oauthKeyId}${dataverseEnvUrl ? `&dataverse_env_url=${encodeURIComponent(dataverseEnvUrl)}` : ""}`
        : null;

      const [msSettled, googleSettleds, openaiSettleds, claudeSettleds, geminiSettled] = await Promise.all([
        msUrl
          ? Promise.allSettled([fetch(msUrl).then(r => { if (!r.ok) throw new Error("Microsoft scan failed"); return r.json(); })])
          : Promise.resolve([]),
        googleKeyId
          ? Promise.allSettled(GOOGLE_PLATFORMS.map(p => agentGovernanceApi.discoverGooglePlatform(googleKeyId, p)))
          : Promise.resolve([]),
        openaiKeyId
          ? Promise.allSettled(OPENAI_PLATFORMS.map(p => agentGovernanceApi.discoverOpenAIPlatform(openaiKeyId, p)))
          : Promise.resolve([]),
        claudeKeyId
          ? Promise.allSettled(CLAUDE_PLATFORMS.map(p => agentGovernanceApi.discoverClaudePlatform(claudeKeyId, p)))
          : Promise.resolve([]),
        geminiEnterpriseKeyId
          ? Promise.allSettled([agentGovernanceApi.fetchGeminiEnterpriseAuto(geminiEnterpriseKeyId)])
          : Promise.resolve([]),
      ]);

      const msResult = msSettled[0];
      const geResult = geminiSettled[0];
      const allFailed =
        (!msResult || msResult.status === "rejected") &&
        googleSettleds.every(s => s.status === "rejected") &&
        openaiSettleds.every(s => s.status === "rejected") &&
        claudeSettleds.every(s => s.status === "rejected") &&
        (!geResult || geResult.status === "rejected");

      if (allFailed) throw new Error("All platform scans failed. Check connections and try again.");

      // Base result from Microsoft (or fallback shell)
      let result = msResult?.status === "fulfilled"
        ? msResult.value
        : {
            tenant: { id: "multi-platform", name: "Agent Governance", domain: "multi-platform", license: "N/A" },
            agents: [], totalServicePrincipals: 0, totalUsers: 0, totalEnvironments: 0,
            scanTimestamp: new Date().toISOString(), scanDuration: 0,
            warnings: msResult ? [`Microsoft scan failed: ${msResult.reason?.message || "unknown"}`] : [],
          };

      // Merge Google agents
      if (googleSettleds.length) {
        const mergedGoogle = mergeGooglePlatformResults(googleSettleds);
        const googleAgents = convertGoogleResultToAgents(mergedGoogle);
        result = {
          ...result,
          agents: [...(result.agents || []), ...googleAgents],
          warnings: [...(result.warnings || []), ...mergedGoogle.warnings],
        };
      }

      // Merge OpenAI agents
      if (openaiSettleds.length) {
        const mergedOpenAI = mergeOpenAIPlatformResults(openaiSettleds);
        const openaiAgents = convertOpenAIResultToAgents(mergedOpenAI);
        result = {
          ...result,
          agents: [...(result.agents || []), ...openaiAgents],
          warnings: [...(result.warnings || []), ...mergedOpenAI.warnings],
        };
      }

      // Merge Claude agents
      if (claudeSettleds.length) {
        const mergedClaude = mergeClaudePlatformResults(claudeSettleds);
        const claudeAgents = convertClaudeResultToAgents(mergedClaude);
        result = {
          ...result,
          agents: [...(result.agents || []), ...claudeAgents],
          warnings: [...(result.warnings || []), ...mergedClaude.warnings],
        };
      }

      // Merge Gemini Enterprise agents
      if (geResult) {
        if (geResult.status === "fulfilled") {
          const geAgents = convertGeminiEnterpriseToAgents(geResult.value);
          result = {
            ...result,
            agents: [...(result.agents || []), ...geAgents],
            warnings: [...(result.warnings || []), ...(geResult.value?.warnings || [])],
          };
        } else {
          result = {
            ...result,
            warnings: [...(result.warnings || []), `Gemini Enterprise scan failed: ${geResult.reason?.message || "unknown error"}`],
          };
        }
      }

      dispatch({ type: "DISCOVERY_SUCCESS", result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Discovery failed";
      dispatch({ type: "DISCOVERY_ERROR", error: message });
    }
  };

  const handleExport = () => {
    if (!state.discoveryResult) return;
    const data = JSON.stringify(state.discoveryResult, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `governance-${state.discoveryResult.tenant.domain}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDisconnect = async () => {
    await disconnect();
    if (googleKeyId) await disconnectGoogle();
    if (openaiKeyId) await disconnectOpenAI();
    if (claudeKeyId) await disconnectClaude();
    if (geminiEnterpriseKeyId) await disconnectGeminiEnterprise();
    dispatch({ type: "DISCOVERY_SUCCESS", result: null });
  };

  // Only show scopes that belong to a connected platform and have agents
  const MICROSOFT_SCOPES = new Set(["copilot_studio", "personal_agent", "teams_chat_agent", "sharepoint_embedded", "teams_app", "isv_store", "azure_foundry", "oauth_app"]);
  const GOOGLE_SCOPES = new Set(["vertex_ai", "gemini", "google_workspace", "gemini_gmail", "gemini_docs", "gemini_sheets", "gemini_slides", "gemini_meet", "gemini_drive", "gemini_chat", "google_chat", "apps_script", "gemini_gems", "gemini_workspace"]);
  const OPENAI_SCOPES = new Set(["openai_assistant", "custom_gpt", "openai_api_key"]);
  const CLAUDE_SCOPES = new Set(["claude_ai_project"]);
  const GEMINI_ENTERPRISE_SCOPES = new Set(["gemini_enterprise"]);
  const availableScopes = Object.keys(SCOPE_LABELS).filter((s) => {
    if (s === "all") return true;
    if (MICROSOFT_SCOPES.has(s) && !isAuthenticated) return false;
    if (GOOGLE_SCOPES.has(s) && !googleKeyId) return false;
    if (OPENAI_SCOPES.has(s) && !openaiKeyId) return false;
    if (CLAUDE_SCOPES.has(s) && !claudeKeyId) return false;
    if (GEMINI_ENTERPRISE_SCOPES.has(s) && !geminiEnterpriseKeyId) return false;
    return scopeCounts[s] > 0;
  });

  // Connection status badges
  const connectionBadges = [];
  if (isAuthenticated) connectionBadges.push({ label: "Microsoft 365", color: "#0078D4" });
  if (googleKeyId) connectionBadges.push({ label: "Google Cloud", color: "#4285F4" });
  if (openaiKeyId) connectionBadges.push({ label: "ChatGPT", color: "#10a37f" });
  if (claudeKeyId) connectionBadges.push({ label: "Claude / Anthropic", color: "#D4622A" });
  if (geminiEnterpriseKeyId) connectionBadges.push({ label: "Gemini Enterprise", color: "#886FBF" });

  return (
    <div className="ag_page_container">
      {/* Header */}
      <div className="ag_header">
        <div className="ag_header_left">
          <div className="ag_header_title">
            <ShieldCheck size={20} color="#6366f1" />
            Agent Governance
          </div>

          {/* Connection badges */}
          {connectionBadges.map((b) => (
            <span key={b.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600, background: `${b.color}15`, color: b.color, border: `1px solid ${b.color}30` }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: b.color }} />
              {b.label}
            </span>
          ))}

          {/* Application Scope Selector */}
          {state.discoveryResult && (
            <div style={{ position: "relative", display: "inline-flex" }}>
              <select
                value={state.selectedScope}
                onChange={(e) => dispatch({ type: "SET_SCOPE", scope: e.target.value })}
                style={{
                  appearance: "none",
                  background: `${SCOPE_COLORS[state.selectedScope] || "#6366f1"}12`,
                  border: `1px solid ${SCOPE_COLORS[state.selectedScope] || "#6366f1"}33`,
                  borderRadius: 6,
                  padding: "4px 26px 4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: SCOPE_COLORS[state.selectedScope] || "#6366f1",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              >
                {availableScopes.map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABELS[scope]} ({scopeCounts[scope]})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                style={{
                  position: "absolute", right: 8, top: "50%",
                  transform: "translateY(-50%)", pointerEvents: "none",
                  color: SCOPE_COLORS[state.selectedScope] || "#6366f1",
                }}
              />
            </div>
          )}


          {state.discoveryStatus === "loading" && (
            <span style={{ fontSize: 11, color: "#f59e0b" }}>{state.discoveryProgress}</span>
          )}
          {state.discoveryResult && (
            <span className="ag_scan_info">
              Last scan {new Date(state.discoveryResult.scanTimestamp).toLocaleTimeString()}
              {state.discoveryResult.scanDuration ? ` (${Math.round(state.discoveryResult.scanDuration / 1000)}s)` : ""}
            </span>
          )}
        </div>
        <div className="ag_header_right">
          {isAnyConnected ? (
            <>
              <button onClick={handleScan} disabled={state.discoveryStatus === "loading"} className="ag_btn_primary">
                <RefreshCw size={13} style={state.discoveryStatus === "loading" ? { animation: "agSpin 1s linear infinite" } : undefined} />
                {state.discoveryStatus === "loading" ? "Scanning..." : "Run Scan"}
              </button>
              <button onClick={() => { setModalMode("update"); setShowModal(true); }} className="ag_btn_secondary">
                <Settings2 size={13} /> Settings
              </button>
              <button onClick={handleDisconnect} className="ag_btn_secondary">
                <LogOut size={13} /> Disconnect
              </button>
            </>
          ) : (
            <button onClick={() => { setModalMode("connect"); setShowModal(true); }} className="ag_btn_primary">
              <Plus size={13} /> Connect Platform
            </button>
          )}
        </div>
      </div>

      {isAnyConnected ? (
        <>
          {/* Tabs */}
          <div className="ag_tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`ag_tab ${state.activeTab === tab.id ? "ag_tab_active" : ""}`}
                onClick={() => dispatch({ type: "SET_TAB", tab: tab.id })}
              >
                {tab.icon} {tab.label}
                {tab.id === "alerts" && alertCount > 0 && (
                  <span className="ag_alert_badge_count">{alertCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* All tabs mounted at once — data loads immediately on connect */}
          <div className="ag_tab_content ag_content_area">
            <div style={{ display: state.activeTab === "overview" ? "block" : "none" }}>
              <OverviewTab />
            </div>
            <div style={{ display: state.activeTab === "discovery" ? "block" : "none" }}>
              <DiscoveryTab />
            </div>
            <div style={{ display: state.activeTab === "activity" ? "block" : "none" }}>
              <UserActivityTab />
            </div>
            <div style={{ display: state.activeTab === "alerts" ? "block" : "none" }}>
              <AlertsTab isActive={state.activeTab === "alerts"} />
            </div>
            <div style={{ display: state.activeTab === "cost" ? "block" : "none" }}>
              <CostTab />
            </div>
            <div style={{ display: state.activeTab === "policies" ? "block" : "none" }}>
              <PoliciesTab />
            </div>
          </div>
        </>
      ) : (
        <div className="ag_content_area">
          <div className="ag_empty_state">
            <div className="ag_empty_state_icon">
              <ShieldCheck size={32} />
            </div>
            <h3>Connect a Cloud Platform</h3>
            <p>
              Connect Microsoft 365 or Google Cloud to discover and govern AI agents.
              Each platform works independently — connect one or both.
            </p>
            <button onClick={() => { setModalMode("connect"); setShowModal(true); }} className="ag_btn_primary" style={{ padding: "10px 24px", fontSize: 14 }}>
              <Plus size={16} /> Connect Platform
            </button>
          </div>
        </div>
      )}

      {showModal && <ConnectTenantModal mode={modalMode} onClose={() => setShowModal(false)} />}
    </div>
  );
}

export default function AgentGovernance() {
  return (
    <AgentGovernanceProvider>
      <AgentGovernanceInner />
    </AgentGovernanceProvider>
  );
}
