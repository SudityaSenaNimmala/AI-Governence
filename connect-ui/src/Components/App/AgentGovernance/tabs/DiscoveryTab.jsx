import { useState, useEffect } from "react";
import { Search, ChevronDown, ChevronUp, Cloud, Brain, Cpu, Server, Globe, Lock, AlertTriangle, RefreshCw, Bot, Layers, Key, Zap, MessageSquare } from "lucide-react";
import { useGovernance, getScopedAgents, SCOPE_LABELS } from "../AgentGovernanceContext";
import { useAgentAuth } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { DEMO_AZURE_AI } from "../demoData";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";
import { Badge, riskColor, statusColor, statusLabel } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";

// ── Azure AI colors ──

const MODEL_COLORS = {
  "gpt-4o": "#10b981", "gpt-4o-mini": "#34d399", "gpt-4": "#6366f1", "gpt-4-turbo": "#818cf8",
  "gpt-35-turbo": "#f59e0b", "gpt-3.5-turbo": "#f59e0b", "dall-e-3": "#ec4899", "dall-e-2": "#f472b6",
  "text-embedding-ada-002": "#8b5cf6", "text-embedding-3-small": "#a78bfa", "text-embedding-3-large": "#7c3aed",
  "whisper": "#06b6d4", "o1": "#0ea5e9", "o1-mini": "#38bdf8", "o3-mini": "#22d3ee",
};

const AI_SERVICE_ICONS = {
  OpenAI: { color: "#10b981", label: "Azure OpenAI" },
  CognitiveServices: { color: "#0078D4", label: "AI Services" },
  TextAnalytics: { color: "#6366f1", label: "Language" },
  SpeechServices: { color: "#f59e0b", label: "Speech" },
  ComputerVision: { color: "#ec4899", label: "Vision" },
  FormRecognizer: { color: "#8b5cf6", label: "Document Intelligence" },
  ContentSafety: { color: "#ef4444", label: "Content Safety" },
  Face: { color: "#06b6d4", label: "Face API" },
};

function getModelColor(name) {
  const lower = (name || "").toLowerCase();
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#6b7280";
}

// ── Agent detail panel (used for non-Azure views) ──

function AgentDetailPanel({ agent, onClose }) {
  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>{agent.name}</h3>
        <button onClick={onClose} style={{ color: "var(--ag-text-secondary)", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}>Close</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 12 }}>
        <div><div style={{ color: "var(--ag-text-secondary)", marginBottom: 4 }}>Vendor</div><div>{agent.vendor || "Unknown"}</div></div>
        <div><div style={{ color: "var(--ag-text-secondary)", marginBottom: 4 }}>Platform</div><div>{agent.platform.replace(/_/g, " ")}</div></div>
        <div><div style={{ color: "var(--ag-text-secondary)", marginBottom: 4 }}>Discovery Source</div><div>{agent.discoverySource}</div></div>
        <div><div style={{ color: "var(--ag-text-secondary)", marginBottom: 4 }}>Risk Score</div><div><span style={{ fontWeight: 700, color: riskColor[agent.risk.level] }}>{agent.risk.score}/100</span> <Badge text={agent.risk.level} color={riskColor[agent.risk.level]} /></div></div>
        <div><div style={{ color: "var(--ag-text-secondary)", marginBottom: 4 }}>Lifecycle Status</div><Badge text={statusLabel[agent.lifecycleStatus] || agent.lifecycleStatus} color={statusColor[agent.lifecycleStatus] || "#6b7280"} /></div>
      </div>
      {agent.llmModel && (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "var(--ag-text-secondary)", fontSize: 12, marginBottom: 6 }}>AI Configuration</div>
          <div style={{ background: "#6366f115", border: "1px solid #6366f133", borderRadius: 6, padding: "6px 12px", display: "inline-block" }}>
            <div style={{ fontSize: 10, color: "var(--ag-text-secondary)" }}>LLM Model</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#6366f1" }}>{agent.llmModel}</div>
          </div>
        </div>
      )}
      {agent.risk.factors?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "var(--ag-text-secondary)", fontSize: 12, marginBottom: 6 }}>Risk Factors</div>
          {agent.risk.factors.map((f, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--ag-text-secondary)", padding: "2px 0" }}>
              <Badge text={f.weight} color={f.weight === "critical" ? "#ef4444" : f.weight === "high" ? "#f59e0b" : f.weight === "medium" ? "#3b82f6" : "#22c55e"} />
              <span style={{ marginLeft: 8 }}>{f.description}</span>
            </div>
          ))}
        </div>
      )}
      {agent.activity?.userBreakdown?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "var(--ag-text-secondary)", fontSize: 12, marginBottom: 6 }}>Active Users ({agent.activity.uniqueUsers})</div>
          <table style={{ width: "100%", fontSize: 11 }}>
            <thead><tr style={{ borderBottom: "1px solid var(--ag-border)" }}><th style={{ textAlign: "left", padding: "4px 8px", color: "#999" }}>User</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#999" }}>Sign-ins</th><th style={{ textAlign: "left", padding: "4px 8px", color: "#999" }}>Last Active</th></tr></thead>
            <tbody>
              {agent.activity.userBreakdown.slice(0, 10).map((u) => (
                <tr key={u.userPrincipalName} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <td style={{ padding: "4px 8px" }}><div style={{ fontWeight: 600 }}>{u.displayName}</div><div style={{ color: "#999", fontSize: 10 }}>{u.userPrincipalName}</div></td>
                  <td style={{ padding: "4px 8px" }}>{u.invocationCount}</td>
                  <td style={{ padding: "4px 8px", color: "#999" }}>{new Date(u.lastActivity).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Azure AI Foundry View ──

function AzureAIFoundryView() {
  const { oauthKeyId } = useAgentAuth();
  const [expandedResource, setExpandedResource] = useState(null);
  const loading = false;
  const error = null;
  const loadData = () => { };

  const data = {
    aiServices: DEMO_AZURE_AI.aiServices,
    openAIResources: DEMO_AZURE_AI.aiServices.filter((s) => s.kind === "OpenAI").map((s) => ({
      ...s, publicAccess: "Enabled", localAuthDisabled: false, skuName: s.sku,
      deployments: DEMO_AZURE_AI.deployments.filter((d) => d.resourceName === s.name).map((d) => ({
        id: d.name, name: d.name, modelName: d.model, modelVersion: d.version,
        contentFilter: d.model.includes("gpt-4") ? "nsi-safety-policy" : null,
        capacityTPM: d.capacity * 1000, sku: d.sku,
      })),
    })),
    otherAIServices: DEMO_AZURE_AI.aiServices.filter((s) => s.kind !== "OpenAI"),
    foundryAgents: [],
    serverlessEndpoints: [],
    subscriptionName: "National Shield Insurance - Production",
  };

  if (loading) return <LoadingSpinner message="Discovering Azure AI resources across subscriptions..." />;

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <AlertTriangle size={40} color="#ef4444" style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: 15, marginBottom: 8, color: "#ef4444" }}>Azure AI Discovery Failed</h3>
        <p style={{ fontSize: 12, color: "#999", maxWidth: 400, margin: "0 auto 16px" }}>{error}</p>
        <button onClick={loadData} className="ag_btn_primary" style={{ display: "inline-flex" }}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
        <Cloud size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 8 }}>Azure AI Foundry</h3>
        <p style={{ fontSize: 13, marginBottom: 16 }}>Scan Azure subscriptions for OpenAI, AI Services, ML Workspaces, and serverless endpoints.</p>
        <button onClick={loadData} className="ag_btn_primary" style={{ display: "inline-flex" }}><Cloud size={13} /> Discover Azure AI</button>
      </div>
    );
  }

  const totalDeployments = data.openAIResources.reduce((s, r) => s + r.deployments.length, 0);
  const totalTPM = data.openAIResources.reduce((s, r) => s + r.deployments.reduce((ds, d) => ds + (d.capacityTPM || 0), 0), 0);
  const uniqueModels = new Set(data.openAIResources.flatMap((r) => r.deployments.map((d) => d.modelName)));
  const workspaceCount = data.foundryAgents.filter((a) => !a.modelName).length;

  return (
    <div>
      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard label="Azure OpenAI Resources" value={data.openAIResources.length} color="#10b981" icon={<Brain size={20} />} />
        <StatCard label="Model Deployments" value={totalDeployments} color="#6366f1" icon={<Cpu size={20} />} />
        <StatCard label="Unique Models" value={uniqueModels.size} color="#f59e0b" icon={<Server size={20} />} />
        <StatCard label="Total Capacity" value={totalTPM > 1000 ? `${Math.round(totalTPM / 1000)}K TPM` : `${totalTPM} TPM`} color="#0078D4" icon={<Globe size={20} />} />
        <StatCard label="AI Services" value={data.aiServices.length} color="#8b5cf6" icon={<Cloud size={20} />} />
        {workspaceCount > 0 && <StatCard label="ML Workspaces" value={workspaceCount} color="#038387" icon={<Server size={20} />} />}
        {data.serverlessEndpoints.length > 0 && <StatCard label="Serverless Endpoints" value={data.serverlessEndpoints.length} color="#ec4899" icon={<Cpu size={20} />} />}
      </div>

      {/* Azure OpenAI Resources */}
      {data.openAIResources.length > 0 && (
        <Section title={`Azure OpenAI Resources (${data.openAIResources.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.openAIResources.map((resource) => {
              const expanded = expandedResource === resource.id;
              return (
                <div key={resource.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                  <div onClick={() => setExpandedResource(expanded ? null : resource.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", background: expanded ? "#f9fafb" : "#fff" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "#10b98115", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Brain size={18} color="#10b981" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>{resource.name}</div>
                      <div style={{ fontSize: 11, color: "#999", display: "flex", gap: 12, marginTop: 2 }}>
                        <span>{resource.location}</span>
                        <span>{resource.deployments.length} deployment{resource.deployments.length !== 1 ? "s" : ""}</span>
                        <span>SKU: {resource.skuName || "—"}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {resource.publicAccess === "Disabled" ? <Badge text="Private" color="#22c55e" /> : <Badge text="Public" color="#f59e0b" />}
                      {resource.localAuthDisabled && <Badge text="No Keys" color="#6366f1" />}
                      {expanded ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                    </div>
                  </div>
                  {expanded && (
                    <div style={{ borderTop: "1px solid #e5e7eb" }}>
                      {resource.endpoint && (
                        <div style={{ padding: "8px 18px", background: "#f9fafb", fontSize: 11, color: "#666", fontFamily: "monospace", borderBottom: "1px solid #e5e7eb" }}>{resource.endpoint}</div>
                      )}
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                            <th style={azThStyle}>Deployment</th><th style={azThStyle}>Model</th><th style={azThStyle}>Version</th>
                            <th style={azThStyle}>Capacity</th><th style={azThStyle}>Content Filter</th><th style={azThStyle}>SKU</th><th style={azThStyle}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resource.deployments.map((dep) => (
                            <tr key={dep.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                              <td style={azTdStyle}><span style={{ fontWeight: 600 }}>{dep.name}</span></td>
                              <td style={azTdStyle}>
                                <span style={{ display: "inline-flex", alignItems: "center", background: `${getModelColor(dep.modelName)}15`, color: getModelColor(dep.modelName), padding: "2px 8px", borderRadius: 4, fontWeight: 600, fontSize: 11 }}>
                                  {dep.modelName}
                                </span>
                              </td>
                              <td style={{ ...azTdStyle, color: "#999" }}>{dep.modelVersion || "—"}</td>
                              <td style={azTdStyle}>{dep.capacityTPM ? <span style={{ fontWeight: 600 }}>{dep.capacityTPM >= 1000 ? `${dep.capacityTPM / 1000}K` : dep.capacityTPM} TPM</span> : "—"}</td>
                              <td style={azTdStyle}>{dep.contentFilter ? <Badge text={dep.contentFilter} color={dep.contentFilter === "Microsoft.Default" ? "#22c55e" : "#f59e0b"} /> : <span style={{ color: "#ef4444", fontSize: 11 }}>None</span>}</td>
                              <td style={{ ...azTdStyle, color: "#999" }}>{dep.skuName || "—"}</td>
                              <td style={azTdStyle}><Badge text={dep.provisioningState || "Unknown"} color={dep.provisioningState === "Succeeded" ? "#22c55e" : "#f59e0b"} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Model Distribution */}
      {totalDeployments > 0 && (
        <Section title="Model Distribution">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(() => {
              const counts = {};
              for (const r of data.openAIResources) for (const d of r.deployments) counts[d.modelName] = (counts[d.modelName] || 0) + 1;
              return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([model, count]) => (
                <div key={model} style={{ background: `${getModelColor(model)}10`, border: `1px solid ${getModelColor(model)}30`, borderRadius: 8, padding: "10px 16px" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: getModelColor(model) }}>{model}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{count} deployment{count !== 1 ? "s" : ""}</div>
                </div>
              ));
            })()}
          </div>
        </Section>
      )}

      {/* Serverless Endpoints */}
      {data.serverlessEndpoints.length > 0 && (
        <Section title={`Serverless Endpoints (${data.serverlessEndpoints.length})`}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={azThStyle}>Endpoint</th><th style={azThStyle}>Model</th><th style={azThStyle}>Workspace</th><th style={azThStyle}>Region</th><th style={azThStyle}>State</th>
              </tr></thead>
              <tbody>
                {data.serverlessEndpoints.map((ep) => (
                  <tr key={ep.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={azTdStyle}><span style={{ fontWeight: 600 }}>{ep.name}</span></td>
                    <td style={azTdStyle}><span style={{ fontFamily: "monospace", color: "#6366f1", fontSize: 11 }}>{ep.modelId || "—"}</span></td>
                    <td style={{ ...azTdStyle, color: "#999" }}>{ep.workspaceName}</td>
                    <td style={{ ...azTdStyle, color: "#999" }}>{ep.location}</td>
                    <td style={azTdStyle}><Badge text={ep.state || "Unknown"} color={ep.state === "Online" ? "#22c55e" : "#f59e0b"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ML Workspaces */}
      {data.foundryAgents.length > 0 && (
        <Section title={`ML Workspaces & Deployments (${data.foundryAgents.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.foundryAgents.map((ws) => (
              <div key={ws.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: ws.modelName ? "#6366f115" : "#03838715", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {ws.modelName ? <Cpu size={16} color="#6366f1" /> : <Server size={16} color="#038387" />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{ws.name}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{ws.location} · {ws.resourceGroup}</div>
                </div>
                {ws.modelName && (
                  <span style={{ background: `${getModelColor(ws.modelName)}15`, color: getModelColor(ws.modelName), padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                    {ws.modelName} {ws.modelVersion ? `v${ws.modelVersion}` : ""}
                  </span>
                )}
                <Badge text={ws.provisioningState || "Unknown"} color={ws.provisioningState === "Succeeded" ? "#22c55e" : "#f59e0b"} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* AI Services */}
      {data.aiServices.length > 0 && (
        <Section title={`AI Services (${data.aiServices.length})`}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data.aiServices.map((svc) => {
              const info = AI_SERVICE_ICONS[svc.kind] || { color: "#6b7280", label: svc.kind };
              return (
                <div key={svc.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "14px 18px", minWidth: 200, flex: "0 1 260px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: info.color }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{svc.name}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#999" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Type</span><span style={{ color: info.color, fontWeight: 500 }}>{info.label}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Region</span><span style={{ color: "#333" }}>{svc.location}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>SKU</span><span style={{ color: "#333" }}>{svc.skuName || "—"}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Network</span><Badge text={svc.publicAccess === "Disabled" ? "Private" : "Public"} color={svc.publicAccess === "Disabled" ? "#22c55e" : "#f59e0b"} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Access Control */}
      {data.accessControl.length > 0 && (
        <Section title={`Access Control (${data.accessControl.length} assignments)`}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={azThStyle}>Principal</th><th style={azThStyle}>Type</th><th style={azThStyle}>Role</th><th style={azThStyle}>Resource</th>
              </tr></thead>
              <tbody>
                {data.accessControl.slice(0, 50).map((ac, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ ...azTdStyle, fontFamily: "monospace", fontSize: 10 }}>{ac.principalId.slice(0, 8)}...</td>
                    <td style={azTdStyle}><Badge text={ac.principalType} color={ac.principalType === "User" ? "#6366f1" : ac.principalType === "ServicePrincipal" ? "#f59e0b" : "#8b5cf6"} /></td>
                    <td style={azTdStyle}><span style={{ fontWeight: 500, color: ac.roleName.includes("Owner") || ac.roleName.includes("Contributor") ? "#ef4444" : "#333" }}>{ac.roleName}</span></td>
                    <td style={{ ...azTdStyle, color: "#999" }}>{ac.resourceId.split("/").pop()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Subscriptions */}
      {data.subscriptions.length > 0 && (
        <Section title="Subscriptions Scanned">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.subscriptions.map((sub) => (
              <div key={sub.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 14px", fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{sub.name}</span>
                <span style={{ color: "#999", fontFamily: "monospace", fontSize: 10, marginLeft: 8 }}>{sub.id}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Default agent table view ──

const sourceStyle = {
  // Microsoft discovery sources
  dataverse: { bg: "#6366f122", color: "#6366f1" },
  graph_beta: { bg: "#f59e0b22", color: "#f59e0b" },
  azure_management: { bg: "#3b82f622", color: "#3b82f6" },
  // Google discovery sources — match the values actually emitted by
  // the Google discovery pipelines so rows in the table render with
  // Google brand colors instead of falling back to grey.
  vertex_ai: { bg: "#4285F422", color: "#4285F4" },           // Google Blue
  notebook_lm: { bg: "#F9AB0022", color: "#B06000" },         // Google Amber
  chat_api: { bg: "#34A85322", color: "#137333" },            // Google Green
  gemini_workspace: { bg: "#8B5CF622", color: "#8B5CF6" },    // Gemini Purple
  // Legacy / alternate keys kept for backwards compat
  google_vertex_ai: { bg: "#4285F422", color: "#4285F4" },
  google_dialogflow: { bg: "#EA433522", color: "#EA4335" },
  oauth: { bg: "#8b5cf622", color: "#8b5cf6" },
  manual: { bg: "#6b728022", color: "#6b7280" },
};

const APPROVAL_OPTIONS = [
  { value: "no_status", label: "No Status", color: "#9ca3af", bg: "#f3f4f6" },
  { value: "approved", label: "Approved", color: "#059669", bg: "#ecfdf5" },
  { value: "under_review", label: "In Review", color: "#d97706", bg: "#fffbeb" },
  { value: "not_permitted", label: "Not Permitted", color: "#dc2626", bg: "#fef2f2" },
];

function ApprovalDropdown({ agentId, agentName, currentStatus, onStatusChange }) {
  const current = APPROVAL_OPTIONS.find((o) => o.value === currentStatus) || APPROVAL_OPTIONS[0];
  return (
    <select
      value={currentStatus || "no_status"}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { e.stopPropagation(); onStatusChange(agentId, e.target.value, agentName); }}
      style={{
        fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 10,
        border: `1px solid ${current.color}44`, background: current.bg,
        color: current.color, cursor: "pointer", outline: "none", appearance: "auto",
      }}
    >
      {APPROVAL_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function AgentTableView() {
  const { state, dispatch } = useGovernance();
  const { oauthKeyId } = useAgentAuth();
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [sortField, setSortField] = useState("risk");
  const [sortAsc, setSortAsc] = useState(true);
  const [approvalStatuses, setApprovalStatuses] = useState({});
  const result = state.discoveryResult;
  const scopeLabel = state.selectedScope !== "all" ? SCOPE_LABELS[state.selectedScope] : "";

  useEffect(() => {
    agentGovernanceApi.getApprovalStatuses()
      .then((data) => setApprovalStatuses(data.statuses || {}))
      .catch(() => { });
  }, []);

  const handleApprovalChange = async (botId, status, name) => {
    setApprovalStatuses((prev) => ({ ...prev, [botId]: status }));
    try {
      await agentGovernanceApi.setApprovalStatus(botId, status, name, oauthKeyId);
    } catch (err) {
      console.error("Failed to save approval status:", err);
    }
  };

  let agents = [...getScopedAgents(result, state.selectedScope, state.selectedVendor)];
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    agents = agents.filter((a) => a.name.toLowerCase().includes(q) || a.vendor?.toLowerCase().includes(q) || a.appId?.toLowerCase().includes(q) || a.platform?.toLowerCase().includes(q));
  }
  if (state.riskFilter !== "all") agents = agents.filter((a) => a.risk.level === state.riskFilter);
  if (state.statusFilter !== "all") agents = agents.filter((a) => a.lifecycleStatus === state.statusFilter);
  if (state.platformFilter !== "all" && state.selectedScope === "all") agents = agents.filter((a) => a.platform === state.platformFilter);

  agents.sort((a, b) => {
    let cmp = 0;
    if (sortField === "risk") cmp = a.risk.score - b.risk.score;
    else if (sortField === "name") cmp = a.name.localeCompare(b.name);
    else if (sortField === "users") cmp = (a.activity.uniqueUsers || 0) - (b.activity.uniqueUsers || 0);
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (field) => { if (sortField === field) setSortAsc(!sortAsc); else { setSortField(field); setSortAsc(true); } };
  const SortIcon = ({ field }) => sortField === field ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null;
  const selectStyle = { background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#333" };

  return (
    <div>
      {/* Discovery Warnings */}
      {result.warnings?.length > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b33", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: "#92400e", marginBottom: 4 }}>Discovery Warnings ({result.warnings.length})</div>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#78350f", padding: "2px 0" }}>• {w}</div>
          ))}
        </div>
      )}

      <Section title={`${scopeLabel ? scopeLabel + " " : "Discovered AI "}Agents (${agents.length})`}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "#999" }} />
            <input type="text" placeholder="Search agents by name or vendor..." value={state.searchQuery}
              onChange={(e) => dispatch({ type: "SET_SEARCH", query: e.target.value })}
              style={{ width: "100%", background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 8px 8px 30px", fontSize: 12, color: "#333" }} />
          </div>
          <select value={state.riskFilter} onChange={(e) => dispatch({ type: "SET_RISK_FILTER", filter: e.target.value })} style={selectStyle}>
            <option value="all">All Risk Levels</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select value={state.statusFilter} onChange={(e) => dispatch({ type: "SET_STATUS_FILTER", filter: e.target.value })} style={selectStyle}>
            <option value="all">All Statuses</option><option value="active">Active</option><option value="stale">Stale</option><option value="pending_approval">Pending</option><option value="suspended">Suspended</option>
          </select>
          {state.selectedScope === "all" && (
            <select value={state.platformFilter} onChange={(e) => dispatch({ type: "SET_PLATFORM_FILTER", filter: e.target.value })} style={selectStyle}>
              <option value="all">All Platforms</option>
              {state.selectedVendor !== "google" && (
                <>
                  <option value="copilot_studio">Copilot Studio</option>
                  <option value="personal_agent">Personal Agents</option>
                  <option value="sharepoint_embedded">SharePoint</option>
                  <option value="teams_app">Teams Bots</option>
                  <option value="azure_foundry">Azure AI Foundry</option>
                </>
              )}
              {state.selectedVendor !== "microsoft" && (
                <>
                  <option value="agent_builder">Agent Builder</option>
                  <option value="gemini_gems">Gemini Gems</option>
                  <option value="notebook_lm">NotebookLM</option>
                  <option value="google_chat_bots">Chat Bots</option>
                  <option value="reasoning_engines">Reasoning Engines</option>
                </>
              )}
            </select>
          )}
        </div>

        {expandedAgent && <AgentDetailPanel agent={result.agents.find((a) => a.id === expandedAgent)} onClose={() => setExpandedAgent(null)} />}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("name")}>Agent <SortIcon field="name" /></th>
                <th style={thStyle}>Vendor</th>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("risk")}>Risk <SortIcon field="risk" /></th>
                <th style={thStyle}>Status</th><th style={thStyle}>LLM Model</th><th style={thStyle}>Owner</th>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("users")}>Users <SortIcon field="users" /></th>
                <th style={thStyle}>Source</th><th style={thStyle}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} onClick={() => setExpandedAgent(expandedAgent === a.id ? null : a.id)}
                  style={{ borderBottom: "1px solid var(--ag-border)", cursor: "pointer", background: expandedAgent === a.id ? "#f8f9fa" : "transparent" }}>
                  <td style={{ padding: "10px" }}><div style={{ fontWeight: 600 }}>{a.name}</div><div style={{ fontSize: 10, color: "#999" }}>{a.platform.replace(/_/g, " ")}</div></td>
                  <td style={{ padding: "10px", color: "#999" }}>{a.vendor || "—"}</td>
                  <td style={{ padding: "10px" }}><Badge text={`${a.risk.level} (${a.risk.score})`} color={riskColor[a.risk.level]} /></td>
                  <td style={{ padding: "10px" }}><Badge text={statusLabel[a.lifecycleStatus] || a.lifecycleStatus} color={statusColor[a.lifecycleStatus] || "#6b7280"} /></td>
                  <td style={{ padding: "10px" }}>{a.llmModel ? <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1" }}>{a.llmModel}</span> : <span style={{ color: "#999" }}>—</span>}</td>
                  <td style={{ padding: "10px", fontSize: 11, color: "#999" }}>{a.owner ? <span style={{ color: a.owner.accountEnabled ? "#333" : "#ef4444" }}>{a.owner.displayName}</span> : "—"}</td>
                  <td style={{ padding: "10px" }}>{a.activity?.uniqueUsers || 0}</td>
                  <td style={{ padding: "10px" }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: sourceStyle[a.discoverySource]?.bg || "#f0f0f0", color: sourceStyle[a.discoverySource]?.color || "#999" }}>{a.discoverySource}</span>
                  </td>
                  <td style={{ padding: "10px", color: "#999" }}>{a.activity?.lastActiveTimestamp ? new Date(a.activity.lastActiveTimestamp).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {agents.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999", fontSize: 13 }}>No agents match your filters</div>}
      </Section>
    </div>
  );
}

// ── Google Vertex AI colors & helpers ──

const GEMINI_COLORS = {
  "gemini-1.5-pro": "#4285F4",
  "gemini-1.5-flash": "#34A853",
  "gemini-2.0-flash": "#0F9D58",
  "gemini-2.0-pro": "#1A73E8",
  "gemini-1.0-pro": "#5F6368",
  "gemini-ultra": "#9334E6",
  "palm-2": "#F9AB00",
  "text-bison": "#F9AB00",
  "code-bison": "#EA4335",
};

function getGeminiColor(name) {
  const lower = (name || "").toLowerCase();
  for (const [key, color] of Object.entries(GEMINI_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#5F6368";
}

// ── Google Vertex AI Connect Modal ──

function GoogleConnectModal({ onClose, onConnected }) {
  const [saJson, setSaJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!saJson.trim()) { setError("Service account JSON key is required"); return; }
    setLoading(true);
    try {
      const result = await agentGovernanceApi.connectGoogle(saJson.trim(), projectId.trim() || undefined);
      onConnected(result);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ag_modal_overlay" onClick={onClose}>
      <div className="ag_modal_content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="ag_modal_header">
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Connect Google Cloud</h2>
            <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0 0" }}>
              Provide a service account key to discover Vertex AI, Gemini, and Dialogflow agents
            </p>
          </div>
          <button onClick={onClose} className="ag_modal_close" style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 18 }}>&times;</button>
        </div>

        <div style={{ marginBottom: 14, border: "1px solid #4285F415", borderRadius: 8, overflow: "hidden" }}>
          {[
            { color: "#4285F4", label: "Vertex AI Endpoints & Models", perm: "aiplatform.viewer" },
            { color: "#34A853", label: "Gemini Tuned Models", perm: "aiplatform.viewer" },
            { color: "#EA4335", label: "Dialogflow CX Agents", perm: "dialogflow.client" },
            { color: "#F9AB00", label: "IAM Access Control", perm: "iam.securityReviewer" },
            { color: "#9334E6", label: "Enabled AI APIs", perm: "serviceusage.viewer" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: "#4285F4", fontFamily: "monospace", fontSize: 10 }}>{item.perm}</span>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="ag_form_group">
            <label className="ag_form_label">Service Account JSON Key <span style={{ color: "#ef4444" }}>*</span></label>
            <textarea
              placeholder='Paste the full JSON key file contents ({"type": "service_account", ...})'
              value={saJson} onChange={(e) => setSaJson(e.target.value)}
              className="ag_form_input"
              style={{ minHeight: 120, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            />
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              GCP Console &rarr; IAM &amp; Admin &rarr; Service Accounts &rarr; Keys &rarr; Add Key &rarr; JSON
            </div>
          </div>

          <div className="ag_form_group">
            <label className="ag_form_label">
              GCP Project ID
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>optional — scans all accessible projects if empty</span>
            </label>
            <input type="text" placeholder="e.g. my-project-123456" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ag_form_input" />
          </div>

          {error && (
            <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444" }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: "#4285F4" }}>
            {loading ? "Connecting..." : "Connect & Verify"}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 11, color: "#999" }}>
          <Lock size={12} />
          Service account key encrypted at rest (AES-256-GCM). Never leaves your infrastructure.
        </div>
      </div>
    </div>
  );
}

// ── Google Vertex AI View ──

function GoogleVertexView() {
  const { googleKeyId } = useAgentAuth();
  const [expandedEndpoint, setExpandedEndpoint] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectedKeyId, setConnectedKeyId] = useState("demo-google-key");
  const loading = false;
  const error = null;

  const loadData = () => { };
  const data = {
    projectId: "nsi-gcp-prod-2026",
    domain: "nationalshield.com",
    endpoints: [
      { name: "projects/nsi-gcp-prod-2026/locations/us-central1/endpoints/risk-assessment", displayName: "Risk Assessment Endpoint", description: "Commercial property risk assessment with satellite imagery", createTime: new Date(Date.now() - 45 * 86400000).toISOString(), region: "us-central1", deployedModels: [{ displayName: "gemini-2.0-pro", model: "publishers/google/models/gemini-2.0-pro" }] },
      { name: "projects/nsi-gcp-prod-2026/locations/us-east1/endpoints/compliance-analysis", displayName: "Compliance Analysis Endpoint", description: "Regulatory compliance document analysis", createTime: new Date(Date.now() - 55 * 86400000).toISOString(), region: "us-east1", deployedModels: [{ displayName: "gemini-1.5-pro", model: "publishers/google/models/gemini-1.5-pro" }] },
    ],
    models: [],
    tunedModels: [],
    dialogflowAgents: [],
    enabledApis: ["aiplatform.googleapis.com", "dialogflow.googleapis.com", "logging.googleapis.com"],
    projects: [{ projectId: "nsi-gcp-prod-2026", name: "National Shield Insurance GCP", projectNumber: "123456789012" }],
    iamPolicies: [
      { member: "serviceAccount:risk-engine@nsi-gcp-prod-2026.iam.gserviceaccount.com", role: "roles/aiplatform.user", resource: "projects/nsi-gcp-prod-2026" },
      { member: "user:p.gupta@nationalshield.com", role: "roles/aiplatform.admin", resource: "projects/nsi-gcp-prod-2026" },
      { member: "user:e.watson@nationalshield.com", role: "roles/aiplatform.user", resource: "projects/nsi-gcp-prod-2026" },
    ],
    warnings: [],
  };

  if (loading) return <LoadingSpinner message="Discovering Google Cloud AI resources across projects and regions..." />;

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <AlertTriangle size={40} color="#ef4444" style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: 15, marginBottom: 8, color: "#ef4444" }}>Google Cloud Discovery Failed</h3>
        <p style={{ fontSize: 12, color: "#999", maxWidth: 400, margin: "0 auto 16px" }}>{error}</p>
        <button onClick={() => loadData()} className="ag_btn_primary" style={{ display: "inline-flex", background: "#4285F4" }}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  if (!data && !connectedKeyId) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
        <Cloud size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 8 }}>Google Vertex AI</h3>
        <p style={{ fontSize: 13, marginBottom: 16, maxWidth: 450, margin: "0 auto 16px" }}>
          Connect a Google Cloud service account to discover Vertex AI endpoints, Gemini models,
          Dialogflow CX agents, and IAM access control.
        </p>
        <button onClick={() => setShowConnectModal(true)} className="ag_btn_primary" style={{ display: "inline-flex", background: "#4285F4" }}>
          <Cloud size={13} /> Connect Google Cloud
        </button>
        {showConnectModal && (
          <GoogleConnectModal
            onClose={() => setShowConnectModal(false)}
            onConnected={(result) => { setConnectedKeyId(result.id); }}
          />
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
        <Cloud size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 8 }}>Google Vertex AI</h3>
        <p style={{ fontSize: 13, marginBottom: 16 }}>Scan Google Cloud projects for Vertex AI, Gemini, and Dialogflow CX resources.</p>
        <button onClick={() => loadData()} className="ag_btn_primary" style={{ display: "inline-flex", background: "#4285F4" }}>
          <Cloud size={13} /> Discover Google AI
        </button>
      </div>
    );
  }

  const totalDeployedModels = data.endpoints.reduce((s, ep) => s + ep.deployedModels.length, 0);
  const uniqueRegions = new Set([
    ...data.endpoints.map((e) => e.region),
    ...data.models.map((m) => m.region),
    ...data.dialogflowAgents.map((a) => a.region),
  ]);

  return (
    <div>
      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard label="Vertex AI Endpoints" value={data.endpoints.length} color="#4285F4" icon={<Zap size={20} />} />
        <StatCard label="Deployed Models" value={totalDeployedModels} color="#34A853" icon={<Cpu size={20} />} />
        <StatCard label="Custom Models" value={data.models.length} color="#F9AB00" icon={<Brain size={20} />} />
        <StatCard label="Tuned Gemini Models" value={data.tunedModels.length} color="#9334E6" icon={<Layers size={20} />} />
        <StatCard label="Dialogflow CX Agents" value={data.dialogflowAgents.length} color="#EA4335" icon={<MessageSquare size={20} />} />
        <StatCard label="AI APIs Enabled" value={data.enabledApis.length} color="#0F9D58" icon={<Globe size={20} />} />
        <StatCard label="Regions" value={uniqueRegions.size} color="#5F6368" icon={<Server size={20} />} />
        <StatCard label="Projects" value={data.projects.length} color="#1A73E8" icon={<Cloud size={20} />} />
      </div>

      {/* Vertex AI Endpoints */}
      {data.endpoints.length > 0 && (
        <Section title={`Vertex AI Endpoints (${data.endpoints.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.endpoints.map((ep) => {
              const expanded = expandedEndpoint === ep.id;
              return (
                <div key={ep.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                  <div onClick={() => setExpandedEndpoint(expanded ? null : ep.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", background: expanded ? "#f9fafb" : "#fff" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "#4285F415", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Zap size={18} color="#4285F4" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>{ep.displayName}</div>
                      <div style={{ fontSize: 11, color: "#999", display: "flex", gap: 12, marginTop: 2 }}>
                        <span>{ep.region}</span>
                        <span>{ep.projectId}</span>
                        <span>{ep.deployedModels.length} model{ep.deployedModels.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {ep.isPrivate ? <Badge text="Private" color="#34A853" /> : <Badge text="Public" color="#F9AB00" />}
                      <Badge text={ep.deployedModels.length > 0 ? "Active" : "No Models"} color={ep.deployedModels.length > 0 ? "#34A853" : "#999"} />
                      {expanded ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                    </div>
                  </div>
                  {expanded && ep.deployedModels.length > 0 && (
                    <div style={{ borderTop: "1px solid #e5e7eb" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                            <th style={gThStyle}>Model</th><th style={gThStyle}>Machine Type</th><th style={gThStyle}>Accelerator</th>
                            <th style={gThStyle}>Replicas</th><th style={gThStyle}>Traffic</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ep.deployedModels.map((dm) => (
                            <tr key={dm.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                              <td style={gTdStyle}><span style={{ fontWeight: 600 }}>{dm.displayName}</span></td>
                              <td style={{ ...gTdStyle, fontFamily: "monospace", fontSize: 11 }}>{dm.machineType || "auto"}</td>
                              <td style={gTdStyle}>{dm.accelerator ? <Badge text={dm.accelerator} color="#9334E6" /> : <span style={{ color: "#999" }}>CPU</span>}</td>
                              <td style={gTdStyle}>{dm.minReplicas != null ? `${dm.minReplicas}–${dm.maxReplicas || "∞"}` : "auto"}</td>
                              <td style={gTdStyle}>{dm.trafficPercent != null ? <span style={{ fontWeight: 600 }}>{dm.trafficPercent}%</span> : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Tuned Gemini Models */}
      {data.tunedModels.length > 0 && (
        <Section title={`Tuned Gemini Models (${data.tunedModels.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.tunedModels.map((tm) => (
              <div key={tm.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: "#9334E615", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Layers size={16} color="#9334E6" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{tm.displayName}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{tm.region} &middot; {tm.projectId}</div>
                </div>
                <span style={{ background: `${getGeminiColor(tm.baseModel)}15`, color: getGeminiColor(tm.baseModel), padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                  {tm.baseModel}
                </span>
                <Badge text={tm.state || "Unknown"} color={tm.state === "ACTIVE" ? "#34A853" : "#F9AB00"} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Dialogflow CX Agents */}
      {data.dialogflowAgents.length > 0 && (
        <Section title={`Dialogflow CX Agents (${data.dialogflowAgents.length})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.dialogflowAgents.map((agent) => (
              <div key={agent.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: "#EA433515", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MessageSquare size={16} color="#EA4335" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{agent.displayName}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>
                    {agent.region} &middot; {agent.projectId}
                    {agent.language && <span> &middot; {agent.language}</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11 }}>
                  {agent.flowCount > 0 && <Badge text={`${agent.flowCount} flows`} color="#4285F4" />}
                  {agent.intentCount > 0 && <Badge text={`${agent.intentCount} intents`} color="#34A853" />}
                  {agent.locked && <Badge text="Locked" color="#EA4335" />}
                  {agent.loggingEnabled && <Badge text="Logging" color="#0F9D58" />}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Custom Models */}
      {data.models.length > 0 && (
        <Section title={`Custom Models (${data.models.length})`}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={gThStyle}>Model</th><th style={gThStyle}>Region</th><th style={gThStyle}>Version</th>
                <th style={gThStyle}>Deployments</th><th style={gThStyle}>Container</th>
              </tr></thead>
              <tbody>
                {data.models.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={gTdStyle}>
                      <div style={{ fontWeight: 600 }}>{m.displayName}</div>
                      {m.description && <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{m.description.slice(0, 80)}</div>}
                    </td>
                    <td style={{ ...gTdStyle, color: "#999" }}>{m.region}</td>
                    <td style={gTdStyle}>{m.versionId || "—"}</td>
                    <td style={gTdStyle}><span style={{ fontWeight: 600 }}>{m.deploymentCount}</span></td>
                    <td style={{ ...gTdStyle, fontFamily: "monospace", fontSize: 10, color: "#999", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.containerImage || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Enabled AI APIs */}
      {data.enabledApis.length > 0 && (
        <Section title={`Enabled AI APIs (${data.enabledApis.length})`}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.enabledApis.map((api, i) => {
              const apiColors = {
                "aiplatform": "#4285F4", "dialogflow": "#EA4335", "generativelanguage": "#9334E6",
                "language": "#34A853", "speech": "#F9AB00", "vision": "#EA4335",
                "translate": "#4285F4", "documentai": "#0F9D58",
              };
              const colorKey = Object.keys(apiColors).find((k) => api.apiId.includes(k));
              const color = apiColors[colorKey] || "#5F6368";
              return (
                <div key={`${api.projectId}-${api.apiId}-${i}`} style={{ background: `${color}08`, border: `1px solid ${color}25`, borderRadius: 8, padding: "10px 16px" }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color }}>{api.title || api.apiId}</div>
                  <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{api.projectId}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* IAM Access Control */}
      {data.iamBindings.length > 0 && (
        <Section title={`IAM Access Control (${data.iamBindings.length} bindings)`}>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={gThStyle}>Role</th><th style={gThStyle}>Type</th><th style={gThStyle}>Members</th><th style={gThStyle}>Project</th>
              </tr></thead>
              <tbody>
                {data.iamBindings.slice(0, 50).map((binding, i) => {
                  const isOwnerEditor = binding.role.includes("owner") || binding.role.includes("editor");
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={gTdStyle}>
                        <span style={{ fontWeight: 500, color: isOwnerEditor ? "#EA4335" : "#333" }}>
                          {binding.role.split("/").pop()}
                        </span>
                      </td>
                      <td style={gTdStyle}>
                        <Badge text={binding.isAiRole ? "AI Role" : "General"} color={binding.isAiRole ? "#4285F4" : "#5F6368"} />
                      </td>
                      <td style={gTdStyle}>
                        <div style={{ maxWidth: 300 }}>
                          {binding.members.slice(0, 3).map((m, j) => (
                            <div key={j} style={{ fontSize: 11, color: m.includes("allUsers") || m.includes("allAuthenticatedUsers") ? "#EA4335" : "#666", fontWeight: m.includes("allUsers") ? 700 : 400 }}>
                              {m.length > 50 ? m.slice(0, 50) + "..." : m}
                            </div>
                          ))}
                          {binding.members.length > 3 && <div style={{ fontSize: 10, color: "#999" }}>+{binding.members.length - 3} more</div>}
                        </div>
                      </td>
                      <td style={{ ...gTdStyle, color: "#999" }}>{binding.projectId}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Projects Scanned */}
      {data.projects.length > 0 && (
        <Section title="Projects Scanned">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {data.projects.map((proj) => (
              <div key={proj.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "8px 14px", fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{proj.name}</span>
                <span style={{ color: "#999", fontFamily: "monospace", fontSize: 10, marginLeft: 8 }}>{proj.id}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {showConnectModal && (
        <GoogleConnectModal
          onClose={() => setShowConnectModal(false)}
          onConnected={(result) => { setConnectedKeyId(result.id); }}
        />
      )}
    </div>
  );
}

// ── Main Discovery Tab ──

export function DiscoveryTab() {
  const { state } = useGovernance();

  if (state.discoveryStatus === "idle") {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
        <Search size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 8 }}>No scan data yet</h3>
        <p style={{ fontSize: 13 }}>Click <strong>"Run Scan"</strong> in the header to discover AI agents.</p>
      </div>
    );
  }
  if (state.discoveryStatus === "loading") return <LoadingSpinner message={state.discoveryProgress} />;
  if (!state.discoveryResult) return null;

  if (state.selectedScope === "azure_foundry") {
    return <AzureAIFoundryView />;
  }

  if (state.selectedScope === "google_vertex") {
    return <GoogleVertexView />;
  }

  return <AgentTableView />;
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
const azThStyle = { textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 };
const azTdStyle = { padding: "10px 14px" };
const gThStyle = { textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 };
const gTdStyle = { padding: "10px 14px" };
