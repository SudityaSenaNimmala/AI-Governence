import { useState, useEffect, useCallback } from "react";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { useAgentAuth, useGovernance } from "../AgentGovernanceContext";
import {
  Shield, AlertTriangle, CheckCircle2, RefreshCw, Eye, EyeOff,
  Zap, Flag, Search, ScanLine, ChevronRight
} from "lucide-react";

const SEVERITY_CONFIG = {
  critical: { color: "#dc2626", bg: "#fee2e2", label: "Critical" },
  high:     { color: "#d97706", bg: "#fef3c7", label: "High" },
  medium:   { color: "#7c3aed", bg: "#ede9fe", label: "Medium" },
  low:      { color: "#2563eb", bg: "#dbeafe", label: "Low" },
};

const FLAG_TYPE_LABELS = {
  pii_detected:       "PII Detected",
  jailbreak_attempt:  "Jailbreak Attempt",
  prompt_injection:   "Prompt Injection",
  unusual_instruction:"Unusual Instruction",
  sensitive_keyword:  "Sensitive Keyword",
  data_exfiltration:  "Data Exfiltration",
  sensitive_content:  "Sensitive Content",
};

const PLATFORM_LABELS = {
  copilot_studio: "Copilot Studio",
  sharepoint_embedded: "SharePoint",
  azure_foundry: "Azure AI",
  vertex_ai: "Vertex AI",
  google_chat: "Google Chat",
  openai_assistant: "OpenAI Assistant",
  custom_gpt: "Custom GPT",
  claude_project: "Claude Project",
  claude_ai_project: "Claude.ai",
};

function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color,
    }}>
      {severity === "critical" && <Zap size={10} />}
      {cfg.label}
    </span>
  );
}

function StatCard({ label, value, color, icon }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 18px", flex: "1 1 100px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {icon && <span style={{ color }}>{icon}</span>}
        <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{value}</div>
    </div>
  );
}

export function PromptMonitorTab() {
  const { oauthKeyId, dataverseEnvUrl } = useAgentAuth();
  const { state } = useGovernance();
  const [flags, setFlags] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [resolvedFilter, setResolvedFilter] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [error, setError] = useState(null);

  const agents = state.discoveryResult?.agents || [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flagsRes, summaryRes] = await Promise.all([
        agentGovernanceApi.listPromptFlags({
          severity: severityFilter !== "all" ? severityFilter : undefined,
          platform: platformFilter !== "all" ? platformFilter : undefined,
          resolved: resolvedFilter,
          limit: 200,
        }),
        agentGovernanceApi.getPromptSummary(),
      ]);
      setFlags(flagsRes.flags || []);
      setSummary(summaryRes);
    } catch (e) {
      setError(e.message || "Failed to load flags");
    } finally {
      setLoading(false);
    }
  }, [severityFilter, platformFilter, resolvedFilter]);

  useEffect(() => { load(); }, [load]);

  const handleScanAll = async () => {
    if (!oauthKeyId && !state.discoveryResult) {
      alert("Run a discovery scan first to load agents and conversations.");
      return;
    }
    setScanning(true);
    setScanProgress("Starting prompt scan across all platforms…");
    setError(null);

    try {
      let totalFlags = 0;

      // Microsoft: scan Dataverse conversation transcripts
      if (oauthKeyId) {
        const microsoftAgents = agents.filter((a) =>
          ["copilot_studio", "personal_agent", "teams_app", "sharepoint_embedded"].includes(a.platform)
        );

        if (microsoftAgents.length > 0) {
          setScanProgress("Fetching Microsoft 365 conversation transcripts…");
          try {
            const chatsRes = await agentGovernanceApi.fetchUserChats(oauthKeyId, dataverseEnvUrl, 500);
            const chats = chatsRes.chats || [];

            // Group chats by botId / botName to analyze per agent
            const chatsByAgent = new Map();
            for (const chat of chats) {
              const key = chat.botId || chat.botName || "unknown";
              if (!chatsByAgent.has(key)) chatsByAgent.set(key, []);
              chatsByAgent.get(key).push(chat);
            }

            for (const agent of microsoftAgents.slice(0, 20)) {
              const agentChats = chatsByAgent.get(agent.botId || agent.name) || chats.slice(0, 50);
              if (agentChats.length === 0) continue;
              setScanProgress(`Analyzing ${agentChats.length} conversations for ${agent.name}…`);
              const res = await agentGovernanceApi.analyzePrompts(agent.id, agent.name, agent.platform, agentChats);
              totalFlags += res.totalFlagsFound || 0;
            }
          } catch (e) {
            console.warn("[PromptMonitor] Microsoft scan failed:", e.message);
          }
        }
      }

      // Google: scan Google Chat conversations
      const googleKeyId = state.discoveryResult && agents.find((a) => a.vendor === "Google")?.id
        ? null  // We don't have a separate googleKeyId ref here, use context
        : null;

      const googleAgents = agents.filter((a) => a.vendor === "Google");
      if (googleAgents.length > 0) {
        setScanProgress("Scanning Google agent conversations…");
        // Google conversations are available via google/conversations endpoint if available
        for (const agent of googleAgents.slice(0, 10)) {
          // Google agents have activity in their userBreakdown — we analyze what's available
          if (agent.activity?.userBreakdown?.length > 0) {
            const syntheticConvos = agent.activity.userBreakdown.map((u) => ({
              id: `google-${agent.id}-${u.userPrincipalName}`,
              messages: [{ text: u.displayName || u.userPrincipalName, from: "user" }],
            }));
            const res = await agentGovernanceApi.analyzePrompts(agent.id, agent.name, agent.platform, syntheticConvos);
            totalFlags += res.totalFlagsFound || 0;
          }
        }
      }

      // OpenAI: scan Assistant threads
      const openaiAgents = agents.filter((a) => a.vendor === "OpenAI" && a.platform === "openai_assistant");
      if (openaiAgents.length > 0) {
        setScanProgress("Scanning OpenAI thread messages…");
        // We'll analyze instruction fields if available
        for (const agent of openaiAgents.slice(0, 10)) {
          if (agent.instructions) {
            const convos = [{ id: `openai-${agent.id}`, messages: [{ text: agent.instructions, from: "bot" }] }];
            const res = await agentGovernanceApi.analyzePrompts(agent.id, agent.name, agent.platform, convos);
            totalFlags += res.totalFlagsFound || 0;
          }
        }
      }

      // Claude: scan project files / instructions
      const claudeAgents = agents.filter((a) => a.vendor === "Claude / Anthropic");
      if (claudeAgents.length > 0) {
        setScanProgress("Scanning Claude project data…");
        for (const agent of claudeAgents.slice(0, 10)) {
          const content = agent.description || agent.instructions || "";
          if (content) {
            const convos = [{ id: `claude-${agent.id}`, messages: [{ text: content, from: "bot" }] }];
            const res = await agentGovernanceApi.analyzePrompts(agent.id, agent.name, agent.platform, convos);
            totalFlags += res.totalFlagsFound || 0;
          }
        }
      }

      setScanProgress(`Scan complete — ${totalFlags} flag(s) found across all platforms.`);
      setTimeout(() => setScanProgress(""), 4000);
      await load();
    } catch (e) {
      setError(e.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (flagId) => {
    try {
      await agentGovernanceApi.resolvePromptFlag(flagId);
      setFlags((prev) => prev.map((f) => f.id === flagId ? { ...f, resolved: true } : f));
      if (summary) setSummary((prev) => ({ ...prev, unresolved_count: Math.max(0, parseInt(prev.unresolved_count) - 1) }));
    } catch (e) {
      alert(e.message);
    }
  };

  const handleResolveAll = async () => {
    if (!confirm("Mark all unresolved flags as resolved?")) return;
    try {
      await agentGovernanceApi.resolveAllPromptFlags();
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const visibleFlags = flags.filter((f) => {
    if (resolvedFilter === false && f.resolved) return false;
    if (resolvedFilter === true && !f.resolved) return false;
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    if (platformFilter !== "all" && f.platform !== platformFilter) return false;
    return true;
  });

  const uniquePlatforms = [...new Set(flags.map((f) => f.platform))].filter(Boolean);

  return (
    <div style={{ padding: "20px 24px", fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <ScanLine size={18} color="#6366f1" />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Prompt Monitor</h2>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
            Detects PII, jailbreak attempts, credential leaks, and sensitive content in agent conversations across all platforms.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", color: "#374151" }}>
            <RefreshCw size={13} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
            Refresh
          </button>
          <button onClick={handleScanAll} disabled={scanning} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, background: "#6366f1", border: "none", borderRadius: 7, cursor: "pointer", color: "#fff" }}>
            <ScanLine size={13} />
            {scanning ? "Scanning…" : "Scan All Agents"}
          </button>
        </div>
      </div>

      {/* Scan progress */}
      {scanProgress && (
        <div style={{ padding: "10px 14px", background: "#eef2ff", borderRadius: 8, color: "#4338ca", fontSize: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <RefreshCw size={12} style={{ animation: scanning ? "agSpin 1s linear infinite" : undefined }} />
          {scanProgress}
        </div>
      )}

      {/* Stats */}
      {summary && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <StatCard label="Total Flags"      value={summary.total_flags || 0}      color="#6366f1" icon={<Flag size={14} />} />
          <StatCard label="Critical"         value={summary.critical_count || 0}   color="#dc2626" icon={<Zap size={14} />} />
          <StatCard label="High"             value={summary.high_count || 0}       color="#d97706" icon={<AlertTriangle size={14} />} />
          <StatCard label="Unresolved"       value={summary.unresolved_count || 0} color="#7c3aed" icon={<Shield size={14} />} />
          <StatCard label="Agents Affected"  value={summary.affected_agents || 0}  color="#0f766e" icon={<Search size={14} />} />
        </div>
      )}

      {/* Flag type summary */}
      {summary?.byType?.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {summary.byType.map((t) => (
            <span key={t.flag_type} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: "#f3f4f6", color: "#374151",
            }}>
              {FLAG_TYPE_LABELS[t.flag_type] || t.flag_type}
              <span style={{ background: "#e5e7eb", borderRadius: 8, padding: "0 5px", fontSize: 10 }}>{t.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {["all", "critical", "high", "medium", "low"].map((s) => (
          <button key={s} onClick={() => setSeverityFilter(s)} style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none",
            background: severityFilter === s ? "#6366f1" : "#f3f4f6",
            color: severityFilter === s ? "#fff" : "#374151",
          }}>
            {s === "all" ? "All Severities" : SEVERITY_CONFIG[s]?.label}
          </button>
        ))}
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
        >
          <option value="all">All Platforms</option>
          {uniquePlatforms.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>)}
        </select>
        <button onClick={() => setResolvedFilter((v) => !v)} style={{
          display: "flex", alignItems: "center", gap: 4, padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: resolvedFilter ? "#d1fae5" : "#f3f4f6", color: resolvedFilter ? "#065f46" : "#374151", border: "none",
        }}>
          {resolvedFilter ? <Eye size={12} /> : <EyeOff size={12} />}
          {resolvedFilter ? "Showing Resolved" : "Hide Resolved"}
        </button>
        {visibleFlags.some((f) => !f.resolved) && (
          <button onClick={handleResolveAll} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#d1fae5", color: "#065f46", border: "none" }}>
            <CheckCircle2 size={12} style={{ marginRight: 4 }} />Resolve All
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Flags Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", fontSize: 13 }}>Loading flags…</div>
      ) : visibleFlags.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
          <Shield size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>No flags found</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Click "Scan All Agents" to analyze conversations for risks.</div>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Agent", "Platform", "Flag Type", "Severity", "Detected Patterns", "Snippet", "Flagged At", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleFlags.map((f) => (
                <>
                  <tr
                    key={f.id}
                    style={{ borderBottom: "1px solid #f3f4f6", background: f.resolved ? "#f9fafb" : undefined, opacity: f.resolved ? 0.6 : 1, cursor: "pointer" }}
                    onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                  >
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "#111827", maxWidth: 160 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.agent_name || f.agent_id}</div>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6b7280" }}>{PLATFORM_LABELS[f.platform] || f.platform}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#f3f4f6", color: "#374151", fontWeight: 500 }}>
                        {FLAG_TYPE_LABELS[f.flag_type] || f.flag_type}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}><SeverityBadge severity={f.severity} /></td>
                    <td style={{ padding: "10px 14px", color: "#374151", maxWidth: 200 }}>
                      <div style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {(f.matched_patterns || []).slice(0, 2).join(" · ")}
                        {(f.matched_patterns || []).length > 2 && ` +${f.matched_patterns.length - 2}`}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151", maxWidth: 200 }}>
                      <div style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "monospace", background: "#f9fafb", padding: "2px 6px", borderRadius: 4 }}>
                        {(f.snippet || "").substring(0, 80)}…
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#9ca3af", fontSize: 11 }}>
                      {f.flagged_at ? new Date(f.flagged_at).toLocaleString() : "—"}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {!f.resolved && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResolve(f.id); }}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#d1fae5", color: "#065f46", border: "none", cursor: "pointer" }}
                          >
                            <CheckCircle2 size={10} style={{ marginRight: 2 }} />Resolve
                          </button>
                        )}
                        <ChevronRight size={13} style={{ color: "#9ca3af", transform: expandedId === f.id ? "rotate(90deg)" : undefined, transition: "transform 0.15s" }} />
                      </div>
                    </td>
                  </tr>
                  {expandedId === f.id && (
                    <tr key={`${f.id}-expanded`} style={{ background: "#f9fafb" }}>
                      <td colSpan={8} style={{ padding: "12px 20px" }}>
                        <div style={{ fontSize: 12, color: "#374151", marginBottom: 6 }}>
                          <strong>Matched Patterns:</strong> {(f.matched_patterns || []).join(" · ")}
                        </div>
                        <div style={{ fontSize: 12, fontFamily: "monospace", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px", whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#374151" }}>
                          {f.snippet}
                        </div>
                        {f.conversation_id && (
                          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>Conversation ID: {f.conversation_id}</div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
