import { useState, useEffect, useRef } from "react";
import { Search, ChevronDown, ChevronUp, Cloud, Brain, Cpu, Server, Globe, Lock, AlertTriangle, RefreshCw, Bot, Layers, Key, Zap, MessageSquare, Sparkles, FolderOpen, Clock, Upload, ExternalLink, Ban, RotateCcw, Trash2, X } from "lucide-react";
import { useGovernance, getScopedAgents, SCOPE_LABELS } from "../AgentGovernanceContext";
import { useAgentAuth } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";
import { Badge, riskColor, statusColor, statusLabel } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { AgentMetadataPanel } from "../common/AgentMetadataPanel";

// ── Azure AI colors ──

const MODEL_COLORS = {
  "gpt-4o": "#10b981", "gpt-4o-mini": "#34d399", "gpt-4": "#6366f1", "gpt-4-turbo": "#818cf8",
  "gpt-35-turbo": "#f59e0b", "gpt-3.5-turbo": "#f59e0b", "dall-e-3": "#ec4899", "dall-e-2": "#f472b6",
  "text-embedding-ada-002": "#8b5cf6", "text-embedding-3-small": "#a78bfa", "text-embedding-3-large": "#7c3aed",
  "whisper": "#06b6d4", "o1": "#0ea5e9", "o1-mini": "#38bdf8", "o3-mini": "#22d3ee",
};

const PLATFORM_LABELS = {
  agent_builder: "Agent Builder",
  gemini_gem: "Gemini Gems",
  reasoning_engine: "Reasoning Engine",
  google_chat: "Google Chat Bot",
  notebooklm: "NotebookLM Enterprise",
  openai_assistant: "OpenAI Assistant",
  custom_gpt: "Custom GPT",
  openai_api_key: "OpenAI API Key",
  claude_ai_project: "Claude.ai Project",
  claude_agent: "Claude API Key",
};

const PLATFORM_COLORS = {
  agent_builder: "#4285F4",
  gemini_gem: "#E040FB",
  reasoning_engine: "#886FBF",
  google_chat: "#1A73E8",
  notebooklm: "#00BFA5",
  openai_assistant: "#10a37f",
  custom_gpt: "#7c3aed",
  openai_api_key: "#10a37f",
  claude_ai_project: "#D4622A",
  claude_agent: "#D4622A",
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

// ── Agent detail panel (unified overview for both Microsoft and Google) ──

function AgentDetailPanel({ agent, onClose }) {
  const platLabel = PLATFORM_LABELS[agent.platform] || agent.platform.replace(/_/g, " ");
  const platColor = PLATFORM_COLORS[agent.platform] || "#6b7280";

  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 20, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{agent.name}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: platColor + "15", color: platColor }}>{platLabel}</span>
            <span style={{ fontSize: 11, color: "#999" }}>{agent.vendor || ""}</span>
            <Badge text={agent.risk.level} color={riskColor[agent.risk.level]} />
          </div>
        </div>
        <button onClick={onClose} style={{ color: "var(--ag-text-secondary)", fontSize: 12, background: "none", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>Close</button>
      </div>

      <AgentOverviewTab agent={agent} platColor={platColor} />

      {/* Business Context Metadata — available for all 4 platforms */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--ag-border)" }}>
        <AgentMetadataPanel agent={agent} />
      </div>
    </div>
  );
}

// ── OpenAI Knowledge Files Panel (lazy-loaded on demand) ──

function OpenAIKnowledgePanel({ agent, platColor }) {
  const { openaiKeyId } = useAgentAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!openaiKeyId || !agent.appId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await agentGovernanceApi.fetchOpenAIKnowledge(openaiKeyId, agent.appId);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load knowledge files");
    } finally {
      setLoading(false);
    }
  };

  const vsConnectors = (agent.connectors || []).filter(c => c.type === "VectorStore");
  if (!vsConnectors.length) return null;

  function formatBytes(bytes) {
    if (!bytes) return "—";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  return (
    <div style={{ marginTop: 16, padding: 14, background: platColor + "06", border: `1px solid ${platColor}20`, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: platColor, display: "flex", alignItems: "center", gap: 6 }}>
          <FolderOpen size={14} /> Knowledge Files ({vsConnectors.length} vector store{vsConnectors.length > 1 ? "s" : ""})
        </div>
        {!data && (
          <button onClick={load} disabled={loading} style={{ padding: "4px 12px", background: platColor, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Loading..." : "Load Files"}
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 11, color: "#dc2626" }}>{error}</div>}

      {!data && !loading && (
        <div style={{ fontSize: 11, color: "#999" }}>
          {vsConnectors.map((c, i) => (
            <div key={i} style={{ padding: "3px 0" }}>
              Vector Store {i + 1}: <span style={{ fontFamily: "monospace", color: platColor }}>{c.id}</span>
              {c.fileCount > 0 && <span style={{ marginLeft: 8, color: "#666" }}>({c.fileCount} file{c.fileCount !== 1 ? "s" : ""})</span>}
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          {data.warnings?.map((w, i) => <div key={i} style={{ fontSize: 11, color: "#92400e", marginBottom: 4 }}>⚠ {w}</div>)}
          {data.files?.length === 0 ? (
            <div style={{ fontSize: 11, color: "#999" }}>No files found in vector stores</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${platColor}20` }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>File</th>
                  <th style={{ textAlign: "right", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Size</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Added</th>
                </tr>
              </thead>
              <tbody>
                {data.files.map((f, i) => (
                  <tr key={f.id || i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={{ padding: "5px 8px", color: "#333", fontWeight: 500 }}>{f.filename || f.id}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", color: "#666" }}>{formatBytes(f.bytes)}</td>
                    <td style={{ padding: "5px 8px" }}>
                      <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: f.status === "completed" ? "#dcfce7" : "#fef3c7", color: f.status === "completed" ? "#166534" : "#92400e" }}>
                        {f.status || "—"}
                      </span>
                    </td>
                    <td style={{ padding: "5px 8px", color: "#999" }}>{f.created_at ? new Date(typeof f.created_at === "number" ? f.created_at * 1000 : f.created_at).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

// ── Claude Knowledge Files Panel (shows all files for the organization API key) ──

function ClaudeKnowledgePanel({ platColor }) {
  const { claudeKeyId } = useAgentAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!claudeKeyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await agentGovernanceApi.fetchClaudeFiles(claudeKeyId);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load files");
    } finally {
      setLoading(false);
    }
  };

  function formatBytes(bytes) {
    if (!bytes) return "—";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  return (
    <div style={{ marginTop: 16, padding: 14, background: platColor + "06", border: `1px solid ${platColor}20`, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: platColor, display: "flex", alignItems: "center", gap: 6 }}>
          <FolderOpen size={14} /> Knowledge Files
        </div>
        {!data && (
          <button onClick={load} disabled={loading} style={{ padding: "4px 12px", background: platColor, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Loading..." : "Load Files"}
          </button>
        )}
        {data && (
          <button onClick={load} disabled={loading} style={{ padding: "4px 12px", background: "none", color: platColor, border: `1px solid ${platColor}44`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 11, color: "#dc2626" }}>{error}</div>}

      {!data && !loading && !error && (
        <div style={{ fontSize: 11, color: "#999" }}>Click "Load Files" to fetch files uploaded to this Anthropic account.</div>
      )}

      {data && (
        <>
          {data.apiNotEnabled ? (
            <div style={{ background: "#fef3c7", border: "1px solid #f59e0b33", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#92400e", marginBottom: 6 }}>Files API Not Enabled</div>
              <div style={{ fontSize: 11, color: "#78350f", lineHeight: 1.7 }}>
                The Anthropic Files API is a <strong>gated beta feature</strong> not yet active for this account.<br />
                To enable it:
                <ol style={{ margin: "6px 0 0 16px", padding: 0 }}>
                  <li>Email <strong>support@anthropic.com</strong> and request <em>Files API beta access</em></li>
                  <li>Or check <strong>console.anthropic.com → Settings</strong> for a beta opt-in toggle</li>
                </ol>
              </div>
            </div>
          ) : (
          <>
          {data.warnings?.map((w, i) => <div key={i} style={{ fontSize: 11, color: "#92400e", marginBottom: 4 }}>⚠ {w}</div>)}
          {data.files?.length === 0 && !data.warnings?.length ? (
            <div style={{ fontSize: 11, color: "#999" }}>No files found. Files uploaded via the Anthropic Files API will appear here.</div>
          ) : data.files?.length > 0 ? (
            <>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>{data.files.length} file{data.files.length !== 1 ? "s" : ""} accessible by this API key</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${platColor}20` }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>File Name</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Size</th>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Purpose</th>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((f, i) => (
                    <tr key={f.id || i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ padding: "5px 8px", color: "#333", fontWeight: 500 }}>
                        <div>{f.filename || f.id}</div>
                        <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>{f.id}</div>
                      </td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "#666" }}>{formatBytes(f.size)}</td>
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: platColor + "15", color: platColor }}>
                          {f.purpose || "assistants"}
                        </span>
                      </td>
                      <td style={{ padding: "5px 8px", color: "#999" }}>
                        {f.created_at ? new Date(typeof f.created_at === "number" ? f.created_at * 1000 : f.created_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          </>
          )}
        </>
      )}
    </div>
  );
}

// ── OpenAI Org-Level Files Panel (all files for the OpenAI account) ──

function OpenAIOrgFilesPanel({ platColor }) {
  const { openaiKeyId } = useAgentAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!openaiKeyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await agentGovernanceApi.fetchOpenAIFiles(openaiKeyId);
      setData(res);
    } catch (err) {
      setError(err.message || "Failed to load files");
    } finally {
      setLoading(false);
    }
  };

  function formatBytes(bytes) {
    if (!bytes) return "—";
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  return (
    <div style={{ marginTop: 16, padding: 14, background: platColor + "06", border: `1px solid ${platColor}20`, borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: platColor, display: "flex", alignItems: "center", gap: 6 }}>
          <FolderOpen size={14} /> Knowledge Files
        </div>
        {!data && (
          <button onClick={load} disabled={loading} style={{ padding: "4px 12px", background: platColor, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Loading..." : "Load Files"}
          </button>
        )}
        {data && (
          <button onClick={load} disabled={loading} style={{ padding: "4px 12px", background: "none", color: platColor, border: `1px solid ${platColor}44`, borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 11, color: "#dc2626" }}>{error}</div>}

      {!data && !loading && !error && (
        <div style={{ fontSize: 11, color: "#999" }}>Click "Load Files" to fetch all files uploaded to this OpenAI account.</div>
      )}

      {data && (
        <>
          {data.insufficientScope ? (
            <div style={{ background: "#fef3c7", border: "1px solid #f59e0b33", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#92400e", marginBottom: 6 }}>Admin Key Cannot Access Files</div>
              <div style={{ fontSize: 11, color: "#78350f", lineHeight: 1.7 }}>
                The connected <strong>Admin key</strong> is for org management only — it cannot read files.<br />
                To view files, also connect a <strong>Project API key</strong> (<code>sk-proj-...</code>) from:<br />
                <strong>platform.openai.com → Default project → API keys → Create new secret key</strong>
              </div>
            </div>
          ) : (
          <>
          {data.warnings?.map((w, i) => <div key={i} style={{ fontSize: 11, color: "#92400e", marginBottom: 4 }}>⚠ {w}</div>)}
          {data.files?.length === 0 && !data.warnings?.length ? (
            <div style={{ fontSize: 11, color: "#999" }}>No files found. Files uploaded via the OpenAI Files API will appear here.</div>
          ) : data.files?.length > 0 ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: "#666" }}>{data.files.length} file{data.files.length !== 1 ? "s" : ""} — verify at platform.openai.com</div>
                <a
                  href="https://platform.openai.com/storage"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: platColor, textDecoration: "none", padding: "3px 10px", border: `1px solid ${platColor}44`, borderRadius: 6 }}
                >
                  <ExternalLink size={11} /> Verify on OpenAI
                </a>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${platColor}20` }}>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>File Name</th>
                    <th style={{ textAlign: "right", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Size</th>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Purpose</th>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Status</th>
                    <th style={{ textAlign: "left", padding: "4px 8px", color: "#666", fontWeight: 600 }}>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.files.map((f, i) => (
                    <tr key={f.id || i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ padding: "5px 8px", color: "#333", fontWeight: 500 }}>
                        <div>{f.filename || f.id}</div>
                        <div style={{ fontSize: 10, color: "#aaa", fontFamily: "monospace" }}>{f.id}</div>
                      </td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: "#666" }}>{formatBytes(f.bytes || f.size)}</td>
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: platColor + "15", color: platColor }}>
                          {f.purpose || "assistants"}
                        </span>
                      </td>
                      <td style={{ padding: "5px 8px" }}>
                        <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: f.status === "processed" ? "#dcfce7" : "#fef3c7", color: f.status === "processed" ? "#166534" : "#92400e" }}>
                          {f.status || "processed"}
                        </span>
                      </td>
                      <td style={{ padding: "5px 8px", color: "#999" }}>
                        {f.created_at ? new Date(typeof f.created_at === "number" ? f.created_at * 1000 : f.created_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          </>
          )}
        </>
      )}
    </div>
  );
}

// ── Detail panel: Overview content (shared between MS, Google, OpenAI) ──

function AgentOverviewTab({ agent, platColor }) {
  const users = agent.activity?.userBreakdown || [];
  const isOpenAI = agent.vendor === "OpenAI";
  const isCustomGPT = agent.platform === "custom_gpt";
  const isAssistant = agent.platform === "openai_assistant";
  const isClaudeAgent = agent.platform === "claude_agent";
  const isOpenAIApiKey = agent.platform === "openai_api_key";

  return (
    <>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ background: platColor + "10", border: `1px solid ${platColor}22`, borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
          <div style={{ fontSize: 10, color: "#999" }}>{isCustomGPT ? "Total Users" : "Users"}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: platColor }}>{agent.activity?.uniqueUsers || 0}</div>
        </div>
        <div style={{ background: "#f8f9fa", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
          <div style={{ fontSize: 10, color: "#999" }}>Risk Score</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: riskColor[agent.risk.level] }}>{agent.risk.score}/100</div>
        </div>
        {isAssistant && agent.connectors?.filter(c => c.type === "VectorStore").length > 0 && (
          <div style={{ background: "#f8f9fa", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
            <div style={{ fontSize: 10, color: "#999" }}>Knowledge Files</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: platColor }}>
              {agent.connectors.filter(c => c.type === "VectorStore").reduce((sum, c) => sum + (c.fileCount || 0), 0) || "—"}
            </div>
          </div>
        )}
        {isAssistant && agent.connectors?.filter(c => c.type === "Function").length > 0 && (
          <div style={{ background: "#f8f9fa", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
            <div style={{ fontSize: 10, color: "#999" }}>Functions</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#f59e0b" }}>{agent.connectors.filter(c => c.type === "Function").length}</div>
          </div>
        )}
        {agent.permissions?.length > 0 && (
          <div style={{ background: "#f8f9fa", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
            <div style={{ fontSize: 10, color: "#999" }}>Shared With</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#6366f1" }}>{agent.permissions.length}</div>
          </div>
        )}
      </div>

      {agent.description && <p style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>{agent.description}</p>}

      {/* OpenAI Assistant: instructions preview */}
      {isAssistant && agent.instructions && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "#f8f9fa", border: "1px solid var(--ag-border)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#333", marginBottom: 4 }}>System Instructions</div>
          <div style={{ fontSize: 11, color: "#666", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 80, overflow: "hidden" }}>
            {agent.instructions.slice(0, 300)}{agent.instructions.length > 300 ? "..." : ""}
          </div>
        </div>
      )}

      {/* Custom GPT: sharing + categories */}
      {isCustomGPT && (
        <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: agent.publishedStatus === "active" ? "#dcfce7" : "#f3f4f6", color: agent.publishedStatus === "active" ? "#166534" : "#374151" }}>
            {agent.publishedStatus === "active" ? "Public" : "Private"}
          </span>
          {agent.shortUrl && (
            <a href={`https://chatgpt.com/g/${agent.shortUrl}`} target="_blank" rel="noopener noreferrer"
               style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: platColor + "15", color: platColor, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              Open in ChatGPT <ExternalLink size={10} />
            </a>
          )}
          {(agent.categories || []).map((cat, i) => (
            <span key={i} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, background: "#f3f4f6", color: "#666" }}>{cat}</span>
          ))}
        </div>
      )}

      {/* OpenAI: tools & connectors */}
      {isOpenAI && agent.connectors?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Tools & Capabilities</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {agent.connectors.map((c, i) => (
              <span key={i} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, background: c.type === "Function" ? "#fef3c7" : c.type === "VectorStore" ? platColor + "15" : "#f3f4f6", color: c.type === "Function" ? "#92400e" : c.type === "VectorStore" ? platColor : "#374151", fontWeight: 500 }}>
                {c.type === "VectorStore" ? `📁 ${c.name}` : c.type === "Function" ? `⚡ ${c.name}` : c.type === "CodeInterpreter" ? "💻 Code Interpreter" : c.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* OpenAI Assistant: vector store knowledge files panel */}
      {isAssistant && <OpenAIKnowledgePanel agent={agent} platColor={platColor} />}

      {/* OpenAI Assistant + Custom GPT + API Key: all org-level uploaded files */}
      {(isOpenAI || isOpenAIApiKey) && <OpenAIOrgFilesPanel platColor={platColor} />}

      {/* Claude API Key: knowledge files panel */}
      {isClaudeAgent && <ClaudeKnowledgePanel platColor={platColor} />}

      {agent.chatSpaceUri && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: platColor + "08", border: `1px solid ${platColor}22`, borderRadius: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <MessageSquare size={16} color={platColor} />
          <div style={{ flex: 1, fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: "var(--ag-text-primary)" }}>Identify the real bot name</div>
            <div style={{ color: "var(--ag-text-secondary)", fontSize: 11, marginTop: 2 }}>
              Google Chat API doesn&apos;t expose bot app names via API. Open the Chat space to see the bot&apos;s actual name.
            </div>
          </div>
          <a href={agent.chatSpaceUri} target="_blank" rel="noopener noreferrer"
             style={{ padding: "6px 12px", background: platColor, color: "#fff", borderRadius: 6, fontSize: 11, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            Open in Chat <ExternalLink size={11} />
          </a>
        </div>
      )}

      {agent.risk.factors?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Risk Factors</div>
          {agent.risk.factors.map((f, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--ag-text-secondary)", padding: "2px 0" }}>
              <Badge text={f.weight} color={f.weight === "critical" ? "#ef4444" : f.weight === "high" ? "#f59e0b" : f.weight === "medium" ? "#3b82f6" : "#22c55e"} />
              <span style={{ marginLeft: 8 }}>{f.description}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12, marginTop: 16, padding: 12, background: "#f8f9fa", borderRadius: 8 }}>
        <div><span style={{ color: "#999" }}>Source:</span> {agent.discoverySource}</div>
        <div><span style={{ color: "#999" }}>Status:</span> <Badge text={statusLabel[agent.lifecycleStatus] || agent.lifecycleStatus} color={statusColor[agent.lifecycleStatus] || "#6b7280"} /></div>
        {agent.llmModel && <div><span style={{ color: "#999" }}>Model:</span> <span style={{ fontWeight: 600, color: "#6366f1" }}>{agent.llmModel}</span></div>}
        {agent.firstSeen && <div><span style={{ color: "#999" }}>Created:</span> {new Date(agent.firstSeen).toLocaleDateString()}</div>}
        {agent.lastModified && <div><span style={{ color: "#999" }}>Updated:</span> {new Date(agent.lastModified).toLocaleDateString()}</div>}
        {agent.owner && <div><span style={{ color: "#999" }}>Owner:</span> {agent.owner.displayName}</div>}
        {isOpenAI && agent.appId && <div style={{ gridColumn: "1/-1" }}><span style={{ color: "#999" }}>ID:</span> <span style={{ fontFamily: "monospace", fontSize: 11 }}>{agent.appId}</span></div>}
      </div>

      {users.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Users ({users.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {users.slice(0, 10).map((u, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: platColor + "10", border: `1px solid ${platColor}22`, borderRadius: 14, fontSize: 11 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: platColor + "25", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: platColor }}>
                  {(u.displayName || u.userPrincipalName || "?")[0].toUpperCase()}
                </div>
                {u.displayName || u.userPrincipalName}
              </span>
            ))}
            {users.length > 10 && <span style={{ fontSize: 11, color: "#999", padding: "4px 10px" }}>+{users.length - 10} more</span>}
          </div>
        </div>
      )}
    </>
  );
}

// ── Azure AI Foundry View ──

function AzureAIFoundryView() {
  const { oauthKeyId } = useAgentAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedResource, setExpandedResource] = useState(null);

  const loadData = async () => {
    if (!oauthKeyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.discoverAzureAI(oauthKeyId);
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to discover Azure AI resources");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [oauthKeyId]);

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
  dataverse: { bg: "#6366f122", color: "#6366f1" },
  graph_beta: { bg: "#f59e0b22", color: "#f59e0b" },
  azure_management: { bg: "#3b82f622", color: "#3b82f6" },
  google_vertex_ai: { bg: "#4285F422", color: "#4285F4" },
  google_dialogflow: { bg: "#EA433522", color: "#EA4335" },
  // Google discovery sources
  vertex_ai_reasoning_engines: { bg: "#4285F422", color: "#4285F4" },
  vertex_ai_api: { bg: "#4285F422", color: "#4285F4" },
  vertex_ai_extensions: { bg: "#1A73E822", color: "#1A73E8" },
  google_admin_sdk: { bg: "#34A85322", color: "#34A853" },
  google_chat_api: { bg: "#00AC4722", color: "#00AC47" },
  google_agent_builder: { bg: "#9334E622", color: "#9334E6" },
  google_apps_script_api: { bg: "#0F9D5822", color: "#0F9D58" },
  oauth: { bg: "#8b5cf622", color: "#8b5cf6" },
  manual: { bg: "#6b728022", color: "#6b7280" },
  // Claude / Anthropic discovery sources
  anthropic_admin_api: { bg: "#D4622A22", color: "#D4622A" },
  anthropic_models_api: { bg: "#B85C3822", color: "#B85C38" },
  openai_assistants_api: { bg: "#10a37f22", color: "#10a37f" },
  chatgpt_session: { bg: "#7c3aed22", color: "#7c3aed" },
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

// ── Google Workspace View (Gemini per-platform with users) ──
function GoogleWorkspaceAgentView() {
  const { state } = useGovernance();
  const result = state.discoveryResult;
  const [expandedApp, setExpandedApp] = useState(null);
  const [userSearch, setUserSearch] = useState("");

  const GOOGLE_BLUE = "#4285F4";

  // Fixed ordered list — cards are ALWAYS rendered for all 7 apps
  const WORKSPACE_APPS = [
    { key: "gmail",  icon: "✉",  color: "#EA4335", label: "Gmail" },
    { key: "docs",   icon: "📄", color: "#4285F4", label: "Docs" },
    { key: "sheets", icon: "📊", color: "#34A853", label: "Sheets" },
    { key: "slides", icon: "🎨", color: "#FBBC04", label: "Slides" },
    { key: "meet",   icon: "📹", color: "#00897B", label: "Meet" },
    { key: "drive",  icon: "📁", color: "#F9AB00", label: "Drive" },
    { key: "chat",   icon: "💬", color: "#1A73E8", label: "Chat" },
  ];

  // Look up agent for an app — supports new "gemini_gmail" platform AND old "google_workspace" platform
  const getAgentForApp = (appKey) =>
    result?.agents.find(a =>
      a.platform === `gemini_${appKey}` ||
      (a.platform === "google_workspace" && a.id.includes(`-${appKey}-`))
    );

  // Count total active users across all workspace apps (union — users who used at least one app)
  const totalActiveUsers = new Set(
    (result?.agents || [])
      .filter(a => a.platform?.startsWith("gemini_") && a.platform !== "gemini_gems")
      .flatMap(a => (a.activity?.userBreakdown || []).map(u => u.userPrincipalName))
  ).size;

  const thStyle = { textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 600, fontSize: 11, borderBottom: "1px solid #f0f0f0" };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, padding: "14px 18px", background: "#4285F408", border: "1px solid #4285F422", borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: "linear-gradient(135deg,#4285F4,#EA4335)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>Gemini in Google Workspace</div>
            <div style={{ fontSize: 12, color: "#666" }}>
              {totalActiveUsers > 0
                ? `${totalActiveUsers} user${totalActiveUsers !== 1 ? "s" : ""} used Gemini across these apps`
                : "Shows users who actually used Gemini features in each app"}
            </div>
          </div>
        </div>
      </div>

      {/* Platform cards grid — always shows all 7 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(155px, 1fr))", gap: 10, marginBottom: 20 }}>
        {WORKSPACE_APPS.map(({ key, icon, color, label }) => {
          const agent = getAgentForApp(key);
          const users = agent?.activity?.userBreakdown || [];
          const isActive = expandedApp === key;

          return (
            <div
              key={key}
              onClick={() => { setExpandedApp(isActive ? null : key); setUserSearch(""); }}
              style={{
                cursor: "pointer", borderRadius: 10, padding: "14px 16px",
                background: isActive ? color + "12" : "#fff",
                border: `1.5px solid ${isActive ? color : "#e5e7eb"}`,
                borderLeft: `4px solid ${color}`,
                transition: "all 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{icon}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{label}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: users.length > 0 ? color : "#bbb" }}>{users.length}</div>
                  <div style={{ fontSize: 10, color: "#999" }}>used Gemini</div>
                </div>
              </div>
              {isActive && (
                <div style={{ fontSize: 10, color, marginTop: 6, textAlign: "center", fontWeight: 600 }}>▲ hide users</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded user table for selected app */}
      {expandedApp && (() => {
        const { key: appKey, icon, color, label } = WORKSPACE_APPS.find(a => a.key === expandedApp) || {};
        if (!appKey) return null;
        const agent = getAgentForApp(appKey);
        const allUsers = agent?.activity?.userBreakdown || [];

        const filtered = userSearch.trim()
          ? allUsers.filter(u =>
              u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) ||
              u.userPrincipalName?.toLowerCase().includes(userSearch.toLowerCase())
            )
          : allUsers;

        return (
          <div style={{ border: `1px solid ${color}30`, borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
            {/* Table header */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
              background: color + "10", borderBottom: `1px solid ${color}20`,
            }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color }}>Gemini in {label}</span>
                <span style={{ fontSize: 11, color: "#999", marginLeft: 8 }}>
                  {allUsers.length} user{allUsers.length !== 1 ? "s" : ""} used Gemini here
                </span>
              </div>
              <input
                type="text"
                placeholder="Search users…"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{
                  padding: "5px 10px", fontSize: 11, borderRadius: 6,
                  border: "1px solid #e5e7eb", outline: "none", width: 180, fontFamily: "inherit",
                }}
              />
            </div>

            {allUsers.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "#aaa", fontSize: 12 }}>
                No one used Gemini features in {label} in the last 7 days.
                <div style={{ fontSize: 11, marginTop: 4 }}>This tracks actual Gemini interactions (Help me write, summarize, etc.) — not general app usage.</div>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>User</th>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Gemini Interactions</th>
                    <th style={thStyle}>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u, idx) => (
                    <tr key={u.userPrincipalName || idx} style={{ borderBottom: "1px solid #f5f5f5", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "9px 12px", color: "#bbb", fontSize: 11, width: 36 }}>{idx + 1}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                            background: color + "18",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 700, color,
                          }}>
                            {(u.displayName || "?")[0].toUpperCase()}
                          </div>
                          <span style={{ fontWeight: 600, color: "#111" }}>{u.displayName || u.userPrincipalName}</span>
                        </div>
                      </td>
                      <td style={{ padding: "9px 12px", color: "#666" }}>{u.userPrincipalName}</td>
                      <td style={{ padding: "9px 12px" }}>
                        <span style={{
                          background: color + "15", color,
                          padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                        }}>{u.invocationCount}</span>
                      </td>
                      <td style={{ padding: "9px 12px", color: "#999", fontSize: 11 }}>
                        {u.lastActivity ? new Date(u.lastActivity).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Which platforms support which lifecycle actions ───────────────────────────

// Real suspend via Dataverse statecode=1
const SUSPENDABLE_PLATFORMS = new Set(["copilot_studio", "personal_agent", "sharepoint_embedded"]);
// Permanent delete via platform API
// notebooklm excluded — Discovery Engine API has no DELETE endpoint for notebooks
const GOOGLE_DELETABLE_PLATFORMS = new Set(["reasoning_engine", "agent_builder"]);
const OPENAI_DELETABLE_PLATFORMS = new Set(["openai_assistant", "custom_gpt"]);
// Permanent delete from Teams org catalog (removes for all users)
const TEAMS_DELETABLE_PLATFORMS = new Set(["teams_app"]);
// Claude: session-based permanent delete (claude.ai projects) or admin-API archive (workspaces)
const CLAUDE_DELETABLE_PLATFORMS = new Set(["claude_ai_project"]);
const CLAUDE_ARCHIVABLE_PLATFORMS = new Set([]);

function getLifecycleAction(agent) {
  if (SUSPENDABLE_PLATFORMS.has(agent.platform)) {
    if (!agent.botId) {
      // Teams-discovered personal/SharePoint agents — delete from Teams catalog
      return "teams_delete";
    }
    return agent.lifecycleStatus === "suspended" ? "reactivate" : "suspend";
  }
  if (GOOGLE_DELETABLE_PLATFORMS.has(agent.platform)) return "google_delete";
  if (OPENAI_DELETABLE_PLATFORMS.has(agent.platform)) return "openai_delete";
  if (TEAMS_DELETABLE_PLATFORMS.has(agent.platform)) return "teams_delete";
  if (CLAUDE_DELETABLE_PLATFORMS.has(agent.platform)) return "claude_delete";
  if (CLAUDE_ARCHIVABLE_PLATFORMS.has(agent.platform)) return "claude_archive";
  return null;
}

// ── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({ modal, onConfirm, onCancel, loading }) {
  const [typed, setTyped] = useState("");
  const isDelete = modal.action === "google_delete" || modal.action === "openai_delete" || modal.action === "teams_delete" || modal.action === "claude_delete";
  const isReactivate = modal.action === "reactivate";
  const isArchive = modal.action === "claude_archive";

  const iconBg = isDelete ? "#fef2f2" : isReactivate ? "#f0fdf4" : "#fffbeb";
  const icon = isDelete ? <Trash2 size={18} color="#dc2626" /> : isReactivate ? <RotateCcw size={18} color="#16a34a" /> : <Ban size={18} color="#d97706" />;
  const btnColor = isDelete ? "#dc2626" : isReactivate ? "#22c55e" : "#f59e0b";
  const btnLabel = loading ? "Processing..." : isDelete ? "Delete Permanently" : isReactivate ? "Reactivate" : isArchive ? "Archive Workspace" : "Suspend";

  const titles = {
    suspend: "Suspend Agent", reactivate: "Reactivate Agent",
    google_delete: "Delete Google Agent", openai_delete: "Delete OpenAI Assistant",
    teams_delete: "Delete from Teams Org Catalog",
    claude_delete: "Delete Claude.ai Project", claude_archive: "Archive Claude Workspace",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#fff", borderRadius: 12, padding: 28, width: 420, maxWidth: "90vw",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>{titles[modal.action] || "Confirm"}</div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{modal.agent.name}</div>
            </div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#999" }}><X size={18} /></button>
        </div>

        {(modal.action === "suspend") && (
          <p style={{ fontSize: 13, color: "#555", lineHeight: 1.6, marginBottom: 20 }}>
            This will <strong>immediately stop the agent from responding</strong> across all channels. You can reactivate it at any time.
          </p>
        )}
        {(modal.action === "reactivate") && (
          <p style={{ fontSize: 13, color: "#555", lineHeight: 1.6, marginBottom: 20 }}>
            This will <strong>reactivate the agent</strong> so users can interact with it again.
          </p>
        )}
        {(modal.action === "teams_delete") && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>This action cannot be undone</div>
            <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.5 }}>
              This will <strong>permanently remove the app from the Teams org catalog</strong>. All users will immediately lose access.
            </div>
          </div>
        )}
        {isDelete && (
          <>
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", marginBottom: 4 }}>This action cannot be undone</div>
              <div style={{ fontSize: 12, color: "#7f1d1d", lineHeight: 1.5 }}>
                {modal.action === "claude_delete"
                  ? <>The project will be <strong>permanently deleted from Claude.ai</strong> — including all uploaded files, custom instructions, and conversation history.</>
                  : modal.action === "openai_delete" && modal.agent?.platform === "custom_gpt"
                  ? <>The Custom GPT will be <strong>permanently deleted from ChatGPT</strong>. All configuration, instructions, and uploaded knowledge files will be lost.</>
                  : <>The agent will be <strong>permanently deleted</strong> from {modal.action === "google_delete" ? "Google Cloud" : "OpenAI"}. All configuration and history will be lost.</>
                }
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: "#555", display: "block", marginBottom: 6 }}>Type <strong>DELETE</strong> to confirm</label>
              <input type="text" value={typed} onChange={e => setTyped(e.target.value)} placeholder="DELETE"
                style={{ width: "100%", padding: "8px 12px", fontSize: 13, border: `1px solid ${typed === "DELETE" ? "#22c55e" : "#e5e7eb"}`, borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
            </div>
          </>
        )}
        {isArchive && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#d97706", marginBottom: 4 }}>Workspace will be archived</div>
            <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
              The workspace will be deactivated on Anthropic's side. Existing API keys in this workspace will stop working. Requires Admin API access.
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} disabled={loading} style={{
            padding: "8px 18px", borderRadius: 6, border: "1px solid #e5e7eb",
            background: "#fff", color: "#333", fontSize: 13, cursor: "pointer", fontWeight: 500,
          }}>Cancel</button>
          <button onClick={onConfirm} disabled={loading || (isDelete && typed !== "DELETE")} style={{
            padding: "8px 18px", borderRadius: 6, border: "none", fontSize: 13, fontWeight: 600,
            cursor: loading || (isDelete && typed !== "DELETE") ? "not-allowed" : "pointer",
            background: btnColor, color: "#fff", opacity: loading || (isDelete && typed !== "DELETE") ? 0.6 : 1,
          }}>{btnLabel}</button>
        </div>
      </div>
    </div>
  );
}

function AgentTableView() {
  const { state, dispatch } = useGovernance();
  const { oauthKeyId, dataverseEnvUrl, googleKeyId, openaiKeyId, claudeKeyId } = useAgentAuth();
  const hasMicrosoft = !!oauthKeyId;
  const hasGoogle = !!googleKeyId;
  const hasOpenAI = !!openaiKeyId;
  const hasClaude = !!claudeKeyId;
  const [expandedAgent, setExpandedAgent] = useState(null);
  const [sortField, setSortField] = useState("risk");
  const [sortAsc, setSortAsc] = useState(true);
  const [approvalStatuses, setApprovalStatuses] = useState({});
  const [lifecycleStatuses, setLifecycleStatuses] = useState({}); // agentId → 'suspended'

  // Lifecycle action state
  const [confirmModal, setConfirmModal] = useState(null); // { agent, action }
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleFeedback, setLifecycleFeedback] = useState({}); // agentId → { ok, msg }
  const [deletedAgents, setDeletedAgents] = useState(new Set()); // agent IDs removed from platform
  const [blockedAgents, setBlockedAgents] = useState(new Set()); // agent IDs blocked via CloudFuze

  const result = state.discoveryResult;
  const scopeLabel = state.selectedScope !== "all" ? SCOPE_LABELS[state.selectedScope] : "";

  const showFeedback = (agentId, ok, msg) => {
    setLifecycleFeedback(prev => ({ ...prev, [agentId]: { ok, msg } }));
    setTimeout(() => setLifecycleFeedback(prev => { const n = { ...prev }; delete n[agentId]; return n; }), 4000);
  };

  const handleLifecycleAction = async (agent, action) => {
    setLifecycleLoading(true);
    try {
      const dvBotId = agent.botId || agent.appId || agent.id;
      if (action === "suspend" || action === "reactivate") {
        if (!oauthKeyId) { showFeedback(agent.id, false, "Not connected to Microsoft 365"); return; }
        if (!dataverseEnvUrl) { showFeedback(agent.id, false, "Dataverse URL missing — reconnect and enter your Dataverse URL (e.g. org12345.crm.dynamics.com)"); return; }
        if (!dvBotId) { showFeedback(agent.id, false, `No Bot ID found for this ${agent.platform} agent — cannot suspend`); return; }
      }
      if (action === "suspend") {
        await agentGovernanceApi.suspendAgent({
          oauth_key_id: oauthKeyId,
          bot_id: dvBotId,
          dataverse_env_url: dataverseEnvUrl,
        });
        showFeedback(agent.id, true, "Agent suspended");
      } else if (action === "reactivate") {
        await agentGovernanceApi.reactivateAgent({
          oauth_key_id: oauthKeyId,
          bot_id: dvBotId,
          dataverse_env_url: dataverseEnvUrl,
        });
        showFeedback(agent.id, true, "Agent reactivated");
      } else if (action === "google_delete") {
        await agentGovernanceApi.deleteGoogleAgent(googleKeyId, agent.appId || agent.id, agent.platform);
        setDeletedAgents(prev => new Set([...prev, agent.id]));
        showFeedback(agent.id, true, "Agent deleted from Google Cloud");
      } else if (action === "openai_delete") {
        if (agent.platform === "custom_gpt") {
          await agentGovernanceApi.deleteCustomGPT(openaiKeyId, agent.appId || agent.id);
          setDeletedAgents(prev => new Set([...prev, agent.id]));
          showFeedback(agent.id, true, "Custom GPT deleted from ChatGPT");
        } else {
          await agentGovernanceApi.deleteOpenAIAssistant(openaiKeyId, agent.appId || agent.id);
          setDeletedAgents(prev => new Set([...prev, agent.id]));
          showFeedback(agent.id, true, "Assistant deleted from OpenAI");
        }
      } else if (action === "teams_delete") {
        if (!oauthKeyId) { showFeedback(agent.id, false, "Not connected to Microsoft 365"); return; }
        await agentGovernanceApi.deleteTeamsApp(oauthKeyId, agent.id, agent.name);
        setDeletedAgents(prev => new Set([...prev, agent.id]));
        showFeedback(agent.id, true, "App deleted from Teams catalog");
      } else if (action === "claude_delete") {
        if (!claudeKeyId) { showFeedback(agent.id, false, "Not connected to Claude"); return; }
        if (!agent.orgId) { showFeedback(agent.id, false, "Missing org ID — re-run discovery to refresh project data"); return; }
        await agentGovernanceApi.deleteClaudeProject(claudeKeyId, agent.appId || agent.id, agent.orgId);
        setDeletedAgents(prev => new Set([...prev, agent.id]));
        showFeedback(agent.id, true, "Project deleted from Claude.ai");
      } else if (action === "claude_archive") {
        if (!claudeKeyId) { showFeedback(agent.id, false, "Not connected to Claude"); return; }
        await agentGovernanceApi.archiveClaudeWorkspace(claudeKeyId, agent.appId || agent.id);
        setDeletedAgents(prev => new Set([...prev, agent.id]));
        showFeedback(agent.id, true, "Workspace archived in Claude / Anthropic");
      }
    } catch (err) {
      showFeedback(agent.id, false, err.message || "Action failed");
    } finally {
      setLifecycleLoading(false);
      setConfirmModal(null);
    }
  };

  useEffect(() => {
    agentGovernanceApi.getApprovalStatuses()
      .then((data) => setApprovalStatuses(data.statuses || {}))
      .catch(() => {});
    agentGovernanceApi.getLifecycleStatuses()
      .then((data) => setLifecycleStatuses(data.statuses || {}))
      .catch(() => {});
    agentGovernanceApi.getBlockedAgents()
      .then((list) => setBlockedAgents(new Set((list || []).map(b => b.agent_id))))
      .catch(() => {});
  }, []);

  const handleBlockToggle = async (agent) => {
    const isBlocked = blockedAgents.has(agent.id);
    try {
      if (isBlocked) {
        await agentGovernanceApi.unblockAgent({ agent_id: agent.id });
        setBlockedAgents(prev => { const n = new Set(prev); n.delete(agent.id); return n; });
        showFeedback(agent.id, true, "Agent unblocked");
      } else {
        await agentGovernanceApi.blockAgent({
          agent_id: agent.id,
          agent_name: agent.name,
          platform: agent.platform,
          reason: "Blocked by admin from governance dashboard",
        });
        setBlockedAgents(prev => new Set([...prev, agent.id]));
        showFeedback(agent.id, true, "Agent blocked — enforced via extension & monitor");
      }
    } catch (err) {
      showFeedback(agent.id, false, err.message || "Block/unblock failed");
    }
  };

  const handleApprovalChange = async (botId, status, name) => {
    setApprovalStatuses((prev) => ({ ...prev, [botId]: status }));
    try {
      await agentGovernanceApi.setApprovalStatus(botId, status, name, oauthKeyId);
    } catch (err) {
      console.error("Failed to save approval status:", err);
    }
  };

  let agents = [...getScopedAgents(result, state.selectedScope)].filter(a => !deletedAgents.has(a.id));
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    agents = agents.filter((a) => a.name.toLowerCase().includes(q) || a.vendor?.toLowerCase().includes(q) || a.appId?.toLowerCase().includes(q) || a.platform?.toLowerCase().includes(q));
  }
  if (state.riskFilter !== "all") agents = agents.filter((a) => a.risk.level === state.riskFilter);
  if (state.statusFilter !== "all") agents = agents.filter((a) => a.lifecycleStatus === state.statusFilter);
  if (state.platformFilter !== "all") agents = agents.filter((a) => a.platform === state.platformFilter);

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
      {confirmModal && (
        <ConfirmModal
          modal={confirmModal}
          loading={lifecycleLoading}
          onConfirm={() => handleLifecycleAction(confirmModal.agent, confirmModal.action)}
          onCancel={() => setConfirmModal(null)}
        />
      )}
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
            <input type="text" placeholder="Search agents by name, vendor, or app ID..." value={state.searchQuery}
              onChange={(e) => dispatch({ type: "SET_SEARCH", query: e.target.value })}
              style={{ width: "100%", background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 8px 8px 30px", fontSize: 12, color: "#333" }} />
          </div>
          <select value={state.riskFilter} onChange={(e) => dispatch({ type: "SET_RISK_FILTER", filter: e.target.value })} style={selectStyle}>
            <option value="all">All Risk Levels</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select value={state.statusFilter} onChange={(e) => dispatch({ type: "SET_STATUS_FILTER", filter: e.target.value })} style={selectStyle}>
            <option value="all">All Statuses</option><option value="active">Active</option><option value="stale">Stale</option><option value="pending_approval">Pending</option><option value="suspended">Suspended</option>
          </select>
          <select value={state.platformFilter} onChange={(e) => dispatch({ type: "SET_PLATFORM_FILTER", filter: e.target.value })} style={selectStyle}>
              <option value="all">All Agents</option>
              {hasMicrosoft && (
                <optgroup label="Microsoft 365">
                  <option value="copilot_studio">Copilot Studio</option>
                  <option value="personal_agent">Personal Agents</option>
                  <option value="sharepoint_embedded">SharePoint Agents</option>
                  <option value="teams_app">Teams Apps</option>
                  <option value="teams_chat_agent">Teams Chat Agents</option>
                  <option value="power_automate">Power Automate</option>
                  <option value="oauth_app">Shadow AI (OAuth)</option>
                </optgroup>
              )}
              {hasGoogle && (
                <optgroup label="Google Workspace">
                  <option value="agent_builder">Agent Builder</option>
                  <option value="gemini_gem">Gemini Gems</option>
                  <option value="reasoning_engine">Reasoning Engines</option>
                  <option value="google_chat">Google Chat Bots</option>
                  <option value="notebooklm">NotebookLM Enterprise</option>
                </optgroup>
              )}
              {hasOpenAI && (
                <optgroup label="ChatGPT / OpenAI">
                  <option value="openai_assistant">OpenAI Assistants</option>
                  <option value="custom_gpt">Custom GPTs</option>
                  <option value="openai_api_key">OpenAI API Keys</option>
                </optgroup>
              )}
              {hasClaude && (
                <optgroup label="Claude / Anthropic">
                  <option value="claude_ai_project">Claude.ai Projects</option>
                  <option value="claude_agent">Claude API Keys</option>
                </optgroup>
              )}
            </select>
        </div>

        {expandedAgent && <AgentDetailPanel agent={result.agents.find((a) => a.id === expandedAgent)} onClose={() => setExpandedAgent(null)} />}

        {/* Platform filter header */}
        {state.platformFilter !== "all" && (() => {
          const platLabel = PLATFORM_LABELS[state.platformFilter] || state.platformFilter;
          const platColor = PLATFORM_COLORS[state.platformFilter] || "#6366f1";
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "14px 18px", background: platColor + "08", border: `1px solid ${platColor}22`, borderRadius: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: platColor + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Zap size={20} color={platColor} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: platColor }}>{platLabel}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{agents.length} agent{agents.length !== 1 ? "s" : ""} discovered</div>
              </div>
              <div style={{ textAlign: "center", padding: "8px 16px", background: "#fff", borderRadius: 8, border: "1px solid var(--ag-border)" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: platColor }}>{agents.length}</div>
                <div style={{ fontSize: 10, color: "#999" }}>Agents</div>
              </div>
            </div>
          );
        })()}

        {/* OpenAI API Keys zero-result hint */}
        {agents.length === 0 && state.platformFilter === "openai_api_key" && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "14px 18px", marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#14532d", marginBottom: 6 }}>No OpenAI API Keys found</div>
            <div style={{ color: "#166534", lineHeight: 1.7 }}>
              An <strong>admin-level API key</strong> is required to list organization API keys.<br />
              Go to <strong>platform.openai.com → API Keys → Create new secret key</strong> and select <strong>"All"</strong> permissions, then re-connect and re-run the scan.
            </div>
          </div>
        )}

        {/* Claude zero-result hints */}
        {agents.length === 0 && state.platformFilter === "claude_ai_project" && (
          <div style={{ background: "#fff7f3", border: "1px solid #fbd5c5", borderRadius: 8, padding: "14px 18px", marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#7c2d12", marginBottom: 6 }}>
              No Claude.ai Projects found
            </div>
            <div style={{ color: "#9a3412", lineHeight: 1.7 }}>
              No Claude.ai Projects found via session key.<br />
              Add your <strong>sessionKey</strong> cookie in the Claude connection settings (click Settings → Claude), then re-run the scan.<br />
              Get it: open <strong>claude.ai</strong> → F12 → Application → Cookies → claude.ai → <strong>sessionKey</strong>
            </div>
          </div>
        )}
        {agents.length === 0 && state.platformFilter === "claude_agent" && (
          <div style={{ background: "#fff7f3", border: "1px solid #fbd5c5", borderRadius: 8, padding: "14px 18px", marginBottom: 16, fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#7c2d12", marginBottom: 6 }}>
              No Claude API Keys found
            </div>
            <div style={{ color: "#9a3412", lineHeight: 1.7 }}>
              An <strong>Admin API key</strong> is required to list API keys per workspace.<br />
              Generate one at <strong>console.anthropic.com → Settings → API Keys → Create Admin Key</strong>, then re-connect and re-run the scan.
            </div>
          </div>
        )}

        {/* Agent table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("name")}>Agent <SortIcon field="name" /></th>
                <th style={thStyle}>Type</th>
                <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => handleSort("risk")}>Risk <SortIcon field="risk" /></th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} onClick={() => setExpandedAgent(expandedAgent === a.id ? null : a.id)}
                  style={{ borderBottom: "1px solid var(--ag-border)", cursor: "pointer", background: expandedAgent === a.id ? "#f8f9fa" : "transparent" }}>
                  <td style={{ padding: "10px" }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{a.description?.slice(0, 80)}{a.description?.length > 80 ? "..." : ""}</div>
                  </td>
                  <td style={{ padding: "10px" }}>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: (PLATFORM_COLORS[a.platform] || "#6b7280") + "15",
                      color: PLATFORM_COLORS[a.platform] || "#6b7280",
                    }}>
                      {PLATFORM_LABELS[a.platform] || a.platform.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ padding: "10px" }}><Badge text={`${a.risk.level} (${a.risk.score})`} color={riskColor[a.risk.level]} /></td>
                  <td style={{ padding: "10px" }}><Badge text={statusLabel[a.lifecycleStatus] || a.lifecycleStatus} color={statusColor[a.lifecycleStatus] || "#6b7280"} /></td>
                  <td style={{ padding: "10px", fontSize: 11, color: "#999" }}>{a.owner ? <span style={{ color: a.owner.accountEnabled ? "#333" : "#ef4444" }}>{a.owner.displayName}</span> : "—"}</td>
                  <td style={{ padding: "10px" }}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: sourceStyle[a.discoverySource]?.bg || "#f0f0f0", color: sourceStyle[a.discoverySource]?.color || "#999" }}>{a.discoverySource}</span>
                  </td>
                  <td style={{ padding: "10px", color: "#999", fontSize: 11 }}>{a.firstSeen ? new Date(a.firstSeen).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
                  <td style={{ padding: "10px" }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      {(() => {
                        const action = getLifecycleAction(a);
                        const fb = lifecycleFeedback[a.id];

                        if (fb) {
                          return (
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                              background: fb.ok ? "#dcfce7" : "#fef2f2",
                              color: fb.ok ? "#166534" : "#dc2626",
                            }}>{fb.msg}</span>
                          );
                        }

                        return (
                          <>
                            {action === "suspend" && (
                              <button
                                onClick={() => setConfirmModal({ agent: a, action: "suspend" })}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, border: "1px solid #f59e0b44",
                                  background: "#fffbeb", color: "#d97706", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                }}
                              >
                                <Ban size={11} /> Suspend
                              </button>
                            )}
                            {action === "reactivate" && (
                              <button
                                onClick={() => setConfirmModal({ agent: a, action: "reactivate" })}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, border: "1px solid #22c55e44",
                                  background: "#f0fdf4", color: "#16a34a", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                }}
                              >
                                <RotateCcw size={11} /> Reactivate
                              </button>
                            )}
                            {(action === "google_delete" || action === "openai_delete") && (
                              <button
                                onClick={() => setConfirmModal({ agent: a, action })}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, border: "1px solid #ef444444",
                                  background: "#fef2f2", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                }}
                              >
                                <Trash2 size={11} /> Delete
                              </button>
                            )}
                            {action === "teams_delete" && (
                              <a
                                href={`https://admin.teams.microsoft.com/policies/manage-apps/${a.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Microsoft policy requires deletion via Teams Admin Center"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, border: "1px solid #f59e0b44",
                                  background: "#fffbeb", color: "#d97706", fontSize: 11, fontWeight: 600,
                                  textDecoration: "none", cursor: "pointer",
                                }}
                              >
                                <ExternalLink size={11} /> Delete in Teams Admin
                              </a>
                            )}
                            {action === "claude_delete" && (
                              <button
                                onClick={() => setConfirmModal({ agent: a, action: "claude_delete" })}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, border: "1px solid #ef444444",
                                  background: "#fef2f2", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                }}
                              >
                                <Trash2 size={11} /> Delete
                              </button>
                            )}
                            {action === "claude_archive" && (
                              <button
                                onClick={() => setConfirmModal({ agent: a, action: "claude_archive" })}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, border: "1px solid #f59e0b44",
                                  background: "#fffbeb", color: "#d97706", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                }}
                              >
                                <Ban size={11} /> Archive
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleBlockToggle(a); }}
                              title={blockedAgents.has(a.id) ? "Unblock this agent" : "Block this agent via extension & monitor"}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "4px 10px", borderRadius: 6,
                                border: blockedAgents.has(a.id) ? "1px solid #22c55e44" : "1px solid #ef444444",
                                background: blockedAgents.has(a.id) ? "#f0fdf4" : "#fef2f2",
                                color: blockedAgents.has(a.id) ? "#16a34a" : "#dc2626",
                                fontSize: 11, fontWeight: 600, cursor: "pointer",
                              }}
                            >
                              {blockedAgents.has(a.id) ? <><RotateCcw size={11} /> Unblock</> : <><Lock size={11} /> Block</>}
                            </button>
                            <ApprovalDropdown
                              agentId={a.id}
                              agentName={a.name}
                              currentStatus={approvalStatuses[a.id] || "no_status"}
                              onStatusChange={handleApprovalChange}
                            />
                          </>
                        );
                      })()}
                    </div>
                  </td>
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
  const [fileName, setFileName] = useState(null);
  const [jsonValid, setJsonValid] = useState(null); // null=empty, true=valid, false=invalid
  const [projectId, setProjectId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const validateAndSet = (text) => {
    setSaJson(text);
    if (!text.trim()) { setJsonValid(null); return; }
    try {
      const parsed = JSON.parse(text.trim());
      setJsonValid(parsed.type === "service_account" && !!parsed.private_key && !!parsed.client_email);
      // Auto-populate project ID if not set
      if (parsed.project_id) setProjectId((prev) => prev || parsed.project_id);
    } catch {
      setJsonValid(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      validateAndSet(text);
    };
    reader.readAsText(file, "utf-8");
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!saJson.trim()) { setError("Service account JSON key is required"); return; }
    if (jsonValid === false) { setError("Invalid JSON — make sure you upload or paste the complete service account key file"); return; }
    setLoading(true);
    try {
      const result = await agentGovernanceApi.connectGoogle(saJson.trim(), projectId.trim() || undefined, adminEmail.trim() || undefined);
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label className="ag_form_label" style={{ margin: 0 }}>
                Service Account JSON Key <span style={{ color: "#ef4444" }}>*</span>
              </label>
              {/* File upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "#4285F4", color: "#fff", border: "none",
                  borderRadius: 5, padding: "4px 10px", fontSize: 11,
                  fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                <Upload size={12} /> Upload .json file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
            </div>

            {/* Loaded file indicator */}
            {fileName && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: jsonValid ? "rgba(52,168,83,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${jsonValid ? "rgba(52,168,83,0.3)" : "rgba(239,68,68,0.3)"}`,
                borderRadius: 5, padding: "5px 10px", marginBottom: 6, fontSize: 11,
              }}>
                <span style={{ fontSize: 14 }}>{jsonValid ? "✓" : "✗"}</span>
                <span style={{ fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>
                {jsonValid && <span style={{ color: "#34A853", fontWeight: 600 }}>Valid service account key</span>}
                {jsonValid === false && <span style={{ color: "#ef4444", fontWeight: 600 }}>Invalid JSON</span>}
              </div>
            )}

            <div style={{ position: "relative" }}>
              <textarea
                placeholder='Upload the .json file above — or paste the full file contents here'
                value={saJson}
                onChange={(e) => { setFileName(null); validateAndSet(e.target.value); }}
                className="ag_form_input"
                style={{
                  minHeight: 110, fontFamily: "monospace", fontSize: 11, resize: "vertical",
                  borderColor: jsonValid === false ? "#ef4444" : jsonValid === true ? "#34A853" : undefined,
                }}
              />
              {jsonValid === true && !fileName && (
                <span style={{ position: "absolute", bottom: 8, right: 10, fontSize: 10, color: "#34A853", fontWeight: 600 }}>✓ valid JSON</span>
              )}
              {jsonValid === false && (
                <span style={{ position: "absolute", bottom: 8, right: 10, fontSize: 10, color: "#ef4444", fontWeight: 600 }}>✗ invalid JSON</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              GCP Console &rarr; IAM &amp; Admin &rarr; Service Accounts &rarr; Keys &rarr; Add Key &rarr; JSON
            </div>
          </div>

          <div className="ag_form_group">
            <label className="ag_form_label">
              Workspace Admin Email <span style={{ color: "#ef4444" }}>*</span>
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>required for Workspace discovery</span>
            </label>
            <input type="email" placeholder="e.g. admin@yourdomain.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="ag_form_input" />
          </div>

          <div className="ag_form_group">
            <label className="ag_form_label">
              GCP Project ID
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>optional — auto-detected from key file</span>
            </label>
            <input type="text" placeholder="e.g. my-project-123456" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ag_form_input" />
          </div>

          {error && (
            <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444" }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || jsonValid === false} className="ag_connect_btn" style={{ background: "#4285F4" }}>
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

// ── Google AI Agents View ──

function GoogleVertexView() {
  const { googleKeyId } = useAgentAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedBot, setExpandedBot] = useState(null);
  const [expandedEndpoint, setExpandedEndpoint] = useState(null);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectedKeyId, setConnectedKeyId] = useState(googleKeyId);
  const [activeSection, setActiveSection] = useState("agents"); // "agents" | "chat" | "infra"

  const loadData = async (keyId) => {
    const id = keyId || connectedKeyId;
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.discoverGoogleVertex(id);
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to discover Google AI agents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (connectedKeyId) loadData(); }, [connectedKeyId]);

  if (loading) return <LoadingSpinner message="Discovering Google AI agents across Vertex AI, Chat, and Workspace..." />;

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <AlertTriangle size={40} color="#ef4444" style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: 15, marginBottom: 8, color: "#ef4444" }}>Google AI Discovery Failed</h3>
        <p style={{ fontSize: 12, color: "#999", maxWidth: 400, margin: "0 auto 16px" }}>{error}</p>
        <button onClick={() => loadData()} className="ag_btn_primary" style={{ display: "inline-flex", background: "#4285F4" }}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  if (!data && !connectedKeyId) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
        <Cloud size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 8 }}>Google AI Agents</h3>
        <p style={{ fontSize: 13, marginBottom: 16, maxWidth: 450, margin: "0 auto 16px" }}>
          Connect a Google Cloud service account to discover Vertex AI agents, Dialogflow CX, Gemini for Workspace, and Google Chat bots.
        </p>
        <button onClick={() => setShowConnectModal(true)} className="ag_btn_primary" style={{ display: "inline-flex", background: "#4285F4" }}>
          <Cloud size={13} /> Connect Google Cloud
        </button>
        {showConnectModal && (
          <GoogleConnectModal onClose={() => setShowConnectModal(false)} onConnected={(r) => { setConnectedKeyId(r.id); }} />
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
        <Cloud size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#333", marginBottom: 8 }}>Google AI Agents</h3>
        <p style={{ fontSize: 13, marginBottom: 16 }}>Run a scan to discover all Google AI agents.</p>
        <button onClick={() => loadData()} className="ag_btn_primary" style={{ display: "inline-flex", background: "#4285F4" }}>
          <Cloud size={13} /> Discover Google AI
        </button>
      </div>
    );
  }

  const totalVertexAgents = (data.reasoningEngines?.length || 0) + (data.agentBuilderApps?.length || 0) + (data.dialogflowAgents?.length || 0);
  const gw = data.geminiWorkspace || {};
  const workspaceUsers = data.workspaceUsers || [];
  // per-user Gemini app breakdown, keyed by email for O(1) lookup
  const geminiUserMap = new Map((data.geminiUserAppUsage || []).map(u => [u.email, u]));
  const [showUsers, setShowUsers] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const GOOGLE_BLUE = "#4285F4";
  const GOOGLE_GREEN = "#34A853";
  const GOOGLE_RED = "#EA4335";
  const GOOGLE_YELLOW = "#FBBC05";
  const GOOGLE_PURPLE = "#9334E6";

  const sectionTabs = [
    { id: "agents", label: "Vertex AI Agents", count: totalVertexAgents },
    { id: "chat",   label: "Google Chat Bots", count: data.chatBots?.length || 0 },
    { id: "infra",  label: "Infrastructure",   count: data.endpoints?.length || 0 },
  ];

  return (
    <div>
      {/* ── KPI Cards ───────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <StatCard label="Gemini for Workspace" value={gw.enabled ? `${gw.licensedUsers || 0} users` : "Not Enabled"}
          color={gw.enabled ? GOOGLE_RED : "#999"} icon={<Sparkles size={20} />}
          sub={gw.enabled ? `High risk — org-wide AI on ${gw.domain}` : "No Gemini license detected"} />
        <StatCard label="Vertex AI Agents" value={totalVertexAgents} color={GOOGLE_BLUE} icon={<Bot size={20} />}
          sub={`${data.reasoningEngines?.length || 0} engine · ${data.agentBuilderApps?.length || 0} builder · ${data.dialogflowAgents?.length || 0} dialogflow`} />
        <StatCard label="Google Chat Bots" value={data.chatBots?.length || 0} color={GOOGLE_GREEN} icon={<MessageSquare size={20} />}
          sub="Bots installed in Chat spaces" />
        <StatCard label="Deployed Endpoints" value={data.endpoints?.length || 0} color={GOOGLE_YELLOW} icon={<Zap size={20} />}
          sub="Custom model endpoints" />
        <StatCard label="Data Stores" value={data.dataStores?.length || 0} color={GOOGLE_PURPLE} icon={<FolderOpen size={20} />}
          sub="Agent Builder knowledge bases" />
      </div>

      {/* ── Gemini for Workspace Banner ─────────────── */}
      {gw.enabled && (
        <div style={{
          padding: "16px 20px",
          background: "linear-gradient(135deg, #EA433508 0%, #4285F408 100%)",
          border: "1px solid #EA433530", borderRadius: 12, marginBottom: 20,
        }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, flexShrink: 0,
              background: "linear-gradient(135deg, #4285F4, #EA4335)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Sparkles size={22} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>Gemini for Workspace</span>
                <span style={{ background: "#EA433515", color: "#EA4335", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>HIGH RISK</span>
                <span style={{ background: "#34A85315", color: "#34A853", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600 }}>Active</span>
              </div>
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.5 }}>
                Org-wide Gemini AI license detected on <strong>{gw.domain}</strong>.{" "}
                {gw.licensedUsers > 0
                  ? <><strong>{gw.licensedUsers}</strong> licensed users have AI access across all Workspace apps.</>
                  : "Users have AI access to all Workspace apps."}
              </div>
            </div>
            {/* Clickable user count */}
            <button
              onClick={() => setShowUsers(v => !v)}
              style={{
                textAlign: "center", flexShrink: 0, background: "none", border: "none",
                cursor: workspaceUsers.length > 0 ? "pointer" : "default", padding: 0,
              }}
            >
              <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Licensed Users</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: GOOGLE_RED }}>{gw.licensedUsers || "—"}</div>
              {workspaceUsers.length > 0 && (
                <div style={{ fontSize: 10, color: GOOGLE_BLUE, marginTop: 2, display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
                  {showUsers ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  {showUsers ? "hide" : "view all"}
                </div>
              )}
            </button>
          </div>

          {/* Per-platform usage grid — shown when activity data is available */}
          {(gw.appUsage?.length > 0) ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Gemini Activity by Platform (last 7 days)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
                {gw.appUsage.map((p) => {
                  const APP_ICONS = {
                    gmail:  { icon: "✉", color: "#EA4335" },
                    docs:   { icon: "📄", color: "#4285F4" },
                    sheets: { icon: "📊", color: "#34A853" },
                    slides: { icon: "🎨", color: "#FBBC04" },
                    meet:   { icon: "📹", color: "#00897B" },
                    drive:  { icon: "📁", color: "#F9AB00" },
                    chat:   { icon: "💬", color: "#1A73E8" },
                    gemini: { icon: "✨", color: "#9334E6" },
                  };
                  const meta = APP_ICONS[p.app] || { icon: "🤖", color: "#4285F4" };
                  return (
                    <div key={p.app} style={{
                      background: "#fff", border: `1px solid ${meta.color}25`,
                      borderRadius: 8, padding: "10px 12px",
                      borderLeft: `3px solid ${meta.color}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 16 }}>{meta.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>{p.label}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                        <div style={{ textAlign: "center", flex: 1 }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: meta.color }}>{p.userCount}</div>
                          <div style={{ fontSize: 10, color: "#999" }}>users</div>
                        </div>
                        <div style={{ width: 1, background: "#f0f0f0" }} />
                        <div style={{ textAlign: "center", flex: 1 }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: "#333" }}>{p.requestCount}</div>
                          <div style={{ fontSize: 10, color: "#999" }}>actions</div>
                        </div>
                      </div>
                      {p.topUsers?.length > 0 && (
                        <div style={{ marginTop: 6, borderTop: "1px solid #f5f5f5", paddingTop: 6 }}>
                          <div style={{ fontSize: 10, color: "#aaa", marginBottom: 3 }}>Top users</div>
                          {p.topUsers.slice(0, 2).map(u => (
                            <div key={u.email} style={{ fontSize: 10, color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {u.email.split("@")[0]} <span style={{ color: "#aaa" }}>({u.count})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Fallback: static feature pills when no activity data */
            <div>
              <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8 }}>AI-enabled apps (activity data requires admin.reports.audit.readonly scope)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(gw.features || []).map((f) => (
                  <span key={f} style={{ background: "#4285F410", color: "#4285F4", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "1px solid #4285F425" }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Workspace User List (expandable) ──────── */}
          {showUsers && workspaceUsers.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid #EA433320", paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#333" }}>
                  Workspace Users ({workspaceUsers.length})
                </span>
                <input
                  type="text"
                  placeholder="Search by name or email…"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  style={{
                    flex: 1, maxWidth: 260, padding: "4px 10px", fontSize: 11,
                    border: "1px solid #e5e7eb", borderRadius: 6, outline: "none", fontFamily: "inherit",
                  }}
                />
              </div>
              {/* App icon legend */}
              {geminiUserMap.size > 0 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  {[
                    { app: "gmail",  icon: "✉",  label: "Gmail",  color: "#EA4335" },
                    { app: "docs",   icon: "📄", label: "Docs",   color: "#4285F4" },
                    { app: "sheets", icon: "📊", label: "Sheets", color: "#34A853" },
                    { app: "slides", icon: "🎨", label: "Slides", color: "#FBBC04" },
                    { app: "meet",   icon: "📹", label: "Meet",   color: "#00897B" },
                    { app: "drive",  icon: "📁", label: "Drive",  color: "#F9AB00" },
                    { app: "chat",   icon: "💬", label: "Chat",   color: "#1A73E8" },
                  ].map(({ app, icon, label, color }) => (
                    <span key={app} style={{ fontSize: 10, color: "#666", display: "flex", alignItems: "center", gap: 3 }}>
                      <span>{icon}</span> {label}
                    </span>
                  ))}
                  <span style={{ fontSize: 10, color: "#aaa", marginLeft: "auto" }}>
                    Showing Gemini actions per user (last 7 days)
                  </span>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                {workspaceUsers
                  .filter(u => {
                    if (!userSearch.trim()) return true;
                    const q = userSearch.toLowerCase();
                    return u.email.toLowerCase().includes(q) || (u.displayName || "").toLowerCase().includes(q);
                  })
                  .sort((a, b) => {
                    // sort active Gemini users first
                    const aTotal = geminiUserMap.get(a.email)?.totalActions || 0;
                    const bTotal = geminiUserMap.get(b.email)?.totalActions || 0;
                    return bTotal - aTotal || a.email.localeCompare(b.email);
                  })
                  .map(u => {
                    const usage = geminiUserMap.get(u.email);
                    const APP_META = {
                      gmail:  { icon: "✉",  color: "#EA4335" },
                      docs:   { icon: "📄", color: "#4285F4" },
                      sheets: { icon: "📊", color: "#34A853" },
                      slides: { icon: "🎨", color: "#FBBC04" },
                      meet:   { icon: "📹", color: "#00897B" },
                      drive:  { icon: "📁", color: "#F9AB00" },
                      chat:   { icon: "💬", color: "#1A73E8" },
                      gemini: { icon: "✨", color: "#9334E6" },
                    };
                    return (
                      <div key={u.email} style={{
                        background: "#fff", border: "1px solid #f0f0f0",
                        borderRadius: 8, padding: "10px 14px",
                        borderLeft: usage ? "3px solid #4285F4" : "3px solid #e5e7eb",
                      }}>
                        {/* Top row: avatar + name + last login */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                            background: `hsl(${(u.email.charCodeAt(0) * 37) % 360}, 55%, 60%)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "#fff", fontWeight: 700, fontSize: 13,
                          }}>
                            {(u.displayName || u.email).charAt(0).toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {u.displayName || u.email.split("@")[0]}
                            </div>
                            <div style={{ fontSize: 10, color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {u.email}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            {usage ? (
                              <>
                                <div style={{ fontSize: 14, fontWeight: 800, color: "#4285F4" }}>{usage.totalActions}</div>
                                <div style={{ fontSize: 9, color: "#aaa" }}>actions</div>
                              </>
                            ) : (
                              <span style={{ fontSize: 9, color: "#ccc", background: "#f5f5f5", padding: "2px 6px", borderRadius: 4 }}>No activity</span>
                            )}
                          </div>
                        </div>

                        {/* Per-app breakdown row */}
                        {usage && Object.keys(usage.apps).length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.entries(usage.apps)
                              .sort((a, b) => b[1] - a[1])
                              .map(([app, count]) => {
                                const meta = APP_META[app] || { icon: "🤖", color: "#999" };
                                return (
                                  <span key={app} style={{
                                    display: "inline-flex", alignItems: "center", gap: 3,
                                    background: `${meta.color}10`, border: `1px solid ${meta.color}30`,
                                    borderRadius: 12, padding: "2px 8px", fontSize: 10, fontWeight: 600,
                                    color: meta.color,
                                  }}>
                                    {meta.icon} {app.charAt(0).toUpperCase() + app.slice(1)} · {count}
                                  </span>
                                );
                              })}
                          </div>
                        )}

                        {/* Last active */}
                        {(usage?.lastActive || u.lastLoginTime) && (
                          <div style={{ fontSize: 9, color: "#bbb", marginTop: 5 }}>
                            {usage?.lastActive
                              ? `Last Gemini activity: ${new Date(usage.lastActive).toLocaleDateString()}`
                              : `Last login: ${new Date(u.lastLoginTime).toLocaleDateString()}`
                            }
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section Tabs ────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "2px solid #f0f0f0", paddingBottom: 0 }}>
        {sectionTabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveSection(tab.id)}
            style={{
              padding: "8px 16px", border: "none", background: "none", cursor: "pointer",
              fontSize: 13, fontWeight: activeSection === tab.id ? 700 : 500,
              color: activeSection === tab.id ? GOOGLE_BLUE : "#666",
              borderBottom: activeSection === tab.id ? `2px solid ${GOOGLE_BLUE}` : "2px solid transparent",
              marginBottom: -2, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
            }}>
            {tab.label}
            <span style={{
              background: activeSection === tab.id ? `${GOOGLE_BLUE}15` : "#f0f0f0",
              color: activeSection === tab.id ? GOOGLE_BLUE : "#999",
              padding: "1px 7px", borderRadius: 10, fontSize: 11, fontWeight: 700,
            }}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════
          SECTION: VERTEX AI AGENTS
          ════════════════════════════════════════════════ */}
      {activeSection === "agents" && (
        <div>
          {/* Reasoning Engines (Agent Engine) */}
          {(data.reasoningEngines?.length > 0) ? (
            <Section title={`Vertex AI Agent Engine — Reasoning Engines (${data.reasoningEngines.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.reasoningEngines.map((re) => (
                  <div key={re.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: `${GOOGLE_BLUE}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Bot size={18} color={GOOGLE_BLUE} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#111", marginBottom: 3 }}>{re.displayName}</div>
                      {re.description && <div style={{ fontSize: 11, color: "#666", marginBottom: 6, lineHeight: 1.5 }}>{re.description}</div>}
                      <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#999", flexWrap: "wrap" }}>
                        {re.region && <span><Server size={10} style={{ marginRight: 3 }} />{re.region}</span>}
                        {re.createTime && <span><Clock size={10} style={{ marginRight: 3 }} />{new Date(re.createTime).toLocaleDateString()}</span>}
                        {re.pythonVersion && <span>Python {re.pythonVersion}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexDirection: "column", alignItems: "flex-end" }}>
                      <Badge text="Agent Engine" color={GOOGLE_BLUE} />
                      <Badge text="Active" color={GOOGLE_GREEN} />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px dashed #e5e7eb", borderRadius: 10, padding: "20px 24px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <Bot size={18} color="#ccc" />
              <span style={{ fontSize: 12, color: "#999" }}>No Vertex AI Reasoning Engines found. Deploy agents via the Vertex AI Agent Engine console or SDK.</span>
            </div>
          )}

          {/* Agent Builder Apps */}
          {(data.agentBuilderApps?.length > 0) ? (
            <Section title={`Agent Builder — Gemini Agents (${data.agentBuilderApps.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.agentBuilderApps.map((app) => {
                  const typeColors = { chat: GOOGLE_RED, search: GOOGLE_BLUE, recommendation: GOOGLE_GREEN };
                  const typeColor = typeColors[app.solutionType] || GOOGLE_YELLOW;
                  return (
                    <div key={app.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${typeColor}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Sparkles size={18} color={typeColor} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#111", marginBottom: 3 }}>{app.displayName}</div>
                        <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#999", flexWrap: "wrap" }}>
                          {app.location && <span><Server size={10} style={{ marginRight: 3 }} />{app.location}</span>}
                          {app.createTime && <span><Clock size={10} style={{ marginRight: 3 }} />{new Date(app.createTime).toLocaleDateString()}</span>}
                          {app.dataStoreCount > 0 && <span><FolderOpen size={10} style={{ marginRight: 3 }} />{app.dataStoreCount} data store{app.dataStoreCount !== 1 ? "s" : ""}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0, flexDirection: "column", alignItems: "flex-end" }}>
                        <Badge text={app.solutionType || "Agent"} color={typeColor} />
                        <Badge text="Gemini" color={GOOGLE_PURPLE} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px dashed #e5e7eb", borderRadius: 10, padding: "20px 24px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <Sparkles size={18} color="#ccc" />
              <span style={{ fontSize: 12, color: "#999" }}>No Agent Builder apps found. Create agents at console.cloud.google.com/gen-app-builder.</span>
            </div>
          )}

          {/* Dialogflow CX Agents */}
          {(data.dialogflowAgents?.length > 0) ? (
            <Section title={`Dialogflow CX — Conversational Agents (${data.dialogflowAgents.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.dialogflowAgents.map((agent) => (
                  <div key={agent.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: `${GOOGLE_RED}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <MessageSquare size={18} color={GOOGLE_RED} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#111", marginBottom: 3 }}>{agent.displayName}</div>
                      {agent.description && <div style={{ fontSize: 11, color: "#666", marginBottom: 6, lineHeight: 1.5 }}>{agent.description}</div>}
                      <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#999", flexWrap: "wrap" }}>
                        {agent.region && <span><Server size={10} style={{ marginRight: 3 }} />{agent.region}</span>}
                        {agent.language && <span>Lang: {agent.language}</span>}
                        {agent.timeZone && <span>{agent.timeZone}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexDirection: "column", alignItems: "flex-end" }}>
                      <Badge text="Dialogflow CX" color={GOOGLE_RED} />
                      {agent.loggingEnabled && <Badge text="Logging On" color={GOOGLE_GREEN} />}
                      {agent.locked && <Badge text="Locked" color="#f59e0b" />}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : (
            <div style={{ background: "#f9fafb", border: "1px dashed #e5e7eb", borderRadius: 10, padding: "20px 24px", marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <MessageSquare size={18} color="#ccc" />
              <span style={{ fontSize: 12, color: "#999" }}>No Dialogflow CX agents found. Create agents at dialogflow.cloud.google.com.</span>
            </div>
          )}

          {totalVertexAgents === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
              <Bot size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#333", marginBottom: 6 }}>No Vertex AI Agents Found</h3>
              <p style={{ fontSize: 12, maxWidth: 400, margin: "0 auto" }}>
                No Reasoning Engines, Agent Builder apps, or Dialogflow CX agents were found in this GCP project.
                Make sure the service account has <code>Vertex AI Viewer</code> and <code>Discovery Engine Viewer</code> roles.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════
          SECTION: GOOGLE CHAT BOTS
          ════════════════════════════════════════════════ */}
      {activeSection === "chat" && (
        <div>
          {(data.chatBots?.length > 0) ? (
            <Section title={`Google Chat Bots (${data.chatBots.length} unique)`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.chatBots.map((bot) => {
                  const expanded = expandedBot === bot.id;
                  return (
                    <div key={bot.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                      <div onClick={() => setExpandedBot(expanded ? null : bot.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", background: expanded ? "#f0f9ff" : "#fff" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: `${GOOGLE_GREEN}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Bot size={18} color={GOOGLE_GREEN} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "#111" }}>{bot.displayName}</div>
                          <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                            Installed in {bot.spaces?.length || 0} space{(bot.spaces?.length || 0) !== 1 ? "s" : ""}
                            {bot.firstSeen && <span> · Since {new Date(bot.firstSeen).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                          {bot.adminInstalled && <Badge text="Admin Installed" color={GOOGLE_RED} />}
                          <Badge text={`${bot.spaces?.length || 0} spaces`} color={GOOGLE_GREEN} />
                          {expanded ? <ChevronUp size={14} color="#999" /> : <ChevronDown size={14} color="#999" />}
                        </div>
                      </div>
                      {expanded && bot.spaces?.length > 0 && (
                        <div style={{ borderTop: "1px solid #e5e7eb", padding: "12px 16px", background: "#fafbfc" }}>
                          <div style={{ fontSize: 11, color: "#666", marginBottom: 8, fontWeight: 600 }}>Installed in spaces:</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {bot.spaces.map((space) => (
                              <span key={space} style={{ background: "#f0f0f0", color: "#555", padding: "3px 10px", borderRadius: 20, fontSize: 11 }}>{space}</span>
                            ))}
                          </div>
                          {bot.spaceTypes?.length > 0 && (
                            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {[...new Set(bot.spaceTypes)].map((t) => (
                                <Badge key={t} text={t} color="#5F6368" />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : (
            <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
              <MessageSquare size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#333", marginBottom: 6 }}>No Google Chat Bots Found</h3>
              <p style={{ fontSize: 12, maxWidth: 400, margin: "0 auto" }}>
                No bots were found installed in any Google Chat spaces. Ensure the service account has
                <code> chat.spaces.readonly</code> and <code>chat.memberships.readonly</code> scopes via domain-wide delegation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════
          SECTION: INFRASTRUCTURE
          ════════════════════════════════════════════════ */}
      {activeSection === "infra" && (
        <div>
          {/* Vertex AI Endpoints */}
          {(data.endpoints?.length > 0) && (
            <Section title={`Vertex AI Endpoints (${data.endpoints.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.endpoints.map((ep) => {
                  const expanded = expandedEndpoint === ep.id;
                  return (
                    <div key={ep.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                      <div onClick={() => setExpandedEndpoint(expanded ? null : ep.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", cursor: "pointer", background: expanded ? "#f9fafb" : "#fff" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: `${GOOGLE_BLUE}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Zap size={18} color={GOOGLE_BLUE} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>{ep.displayName}</div>
                          <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                            {ep.region} · {ep.deployedModels?.length || 0} model{(ep.deployedModels?.length || 0) !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <Badge text={(ep.deployedModels?.length || 0) > 0 ? "Active" : "No Models"} color={(ep.deployedModels?.length || 0) > 0 ? GOOGLE_GREEN : "#999"} />
                          {expanded ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                        </div>
                      </div>
                      {expanded && ep.deployedModels?.length > 0 && (
                        <div style={{ borderTop: "1px solid #e5e7eb", padding: 12 }}>
                          {ep.deployedModels.map((dm) => (
                            <div key={dm.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 4px", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                              <Cpu size={12} color={GOOGLE_BLUE} />
                              <span style={{ fontWeight: 500, flex: 1 }}>{dm.displayName || dm.model?.split("/").pop()}</span>
                              <span style={{ color: "#999" }}>{dm.createTime ? new Date(dm.createTime).toLocaleDateString() : ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Custom Models */}
          {(data.models?.length > 0) && (
            <Section title={`Custom Models (${data.models.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.models.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 6, background: `${GOOGLE_YELLOW}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Brain size={16} color={GOOGLE_YELLOW} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{m.displayName}</div>
                      {m.description && <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{m.description.slice(0, 80)}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {m.region && <Badge text={m.region} color="#5F6368" />}
                      {m.sourceType && <Badge text={m.sourceType} color={GOOGLE_BLUE} />}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Data Stores */}
          {(data.dataStores?.length > 0) && (
            <Section title={`Agent Builder Data Stores (${data.dataStores.length})`}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {data.dataStores.map((ds) => (
                  <div key={ds.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px", minWidth: 160 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <FolderOpen size={13} color={GOOGLE_PURPLE} />
                      <span style={{ fontWeight: 600, fontSize: 12, color: "#111" }}>{ds.displayName}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#999" }}>{ds.contentConfig?.replace(/_/g, " ") || "Content Store"}</div>
                    {ds.createTime && <div style={{ fontSize: 10, color: "#bbb", marginTop: 2 }}>{new Date(ds.createTime).toLocaleDateString()}</div>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(!data.endpoints?.length && !data.models?.length && !data.dataStores?.length) && (
            <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
              <Server size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
              <p style={{ fontSize: 13 }}>No Vertex AI infrastructure found in this project.</p>
            </div>
          )}
        </div>
      )}

      {/* Warnings */}
      {data.warnings?.length > 0 && (
        <div style={{ marginTop: 16, padding: "12px 16px", background: "#fffbeb", border: "1px solid #fbbf2433", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>Discovery Warnings</div>
          {data.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "#78350f", marginBottom: 2 }}>• {w}</div>
          ))}
        </div>
      )}

      {showConnectModal && (
        <GoogleConnectModal onClose={() => setShowConnectModal(false)} onConnected={(r) => { setConnectedKeyId(r.id); }} />
      )}
    </div>
  );
}

// ── Platform scope sets for routing ──

const GOOGLE_VERTEX_SCOPES = new Set([
  // platforms from Google-only scan (AgentGovernance.jsx handleScan)
  "reasoning_engine", "dialogflow_cx", "agent_builder", "gemini_gem", "notebooklm",
  // platforms from combined scan (discoveryService.ts Task H)
  "vertex_ai", "gemini", "gemini_gems", "gemini_workspace", "apps_script",
  // shared between both
  "google_chat",
]);

const GOOGLE_WORKSPACE_APP_SCOPES = new Set([
  "google_workspace",
  "gemini_gmail", "gemini_docs", "gemini_sheets",
  "gemini_slides", "gemini_meet", "gemini_drive", "gemini_chat",
]);

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

  // Azure AI Foundry — rich per-subscription view
  if (state.selectedScope === "azure_foundry") {
    return <AzureAIFoundryView />;
  }

  // Google Vertex AI / GCP platforms — rich Google-native view
  if (GOOGLE_VERTEX_SCOPES.has(state.selectedScope)) {
    return <GoogleVertexView />;
  }

  // Google Workspace apps (Gemini in Gmail, Docs, Sheets, etc.)
  if (GOOGLE_WORKSPACE_APP_SCOPES.has(state.selectedScope)) {
    return <GoogleWorkspaceAgentView />;
  }

  // All Microsoft platforms + "all" — standard agent table
  return <AgentTableView />;
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
const azThStyle = { textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 };
const azTdStyle = { padding: "10px 14px" };
const gThStyle = { textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 };
const gTdStyle = { padding: "10px 14px" };
