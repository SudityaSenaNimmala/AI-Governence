import { useState, useEffect, useCallback } from "react";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { useGovernance } from "../AgentGovernanceContext";
import {
  ShieldCheck, Clock, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, RefreshCw, Send, ChevronsUp, Trash2, Plus
} from "lucide-react";

const STATUS_CONFIG = {
  pending:   { color: "#f59e0b", bg: "#fef3c7", label: "Pending",   icon: <Clock size={12} /> },
  approved:  { color: "#10b981", bg: "#d1fae5", label: "Approved",  icon: <CheckCircle2 size={12} /> },
  rejected:  { color: "#ef4444", bg: "#fee2e2", label: "Rejected",  icon: <XCircle size={12} /> },
  escalated: { color: "#8b5cf6", bg: "#ede9fe", label: "Escalated", icon: <ChevronsUp size={12} /> },
  expired:   { color: "#6b7280", bg: "#f3f4f6", label: "Expired",   icon: <AlertTriangle size={12} /> },
};

const PLATFORM_LABELS = {
  copilot_studio: "Copilot Studio",
  sharepoint_embedded: "SharePoint",
  azure_foundry: "Azure AI",
  teams_app: "Teams App",
  vertex_ai: "Vertex AI",
  agent_builder: "Agent Builder",
  google_chat: "Google Chat",
  openai_assistant: "OpenAI Assistant",
  custom_gpt: "Custom GPT",
  claude_project: "Claude Project",
  claude_ai_project: "Claude.ai Project",
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
      background: cfg.bg, color: cfg.color,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function StatCard({ label, value, color = "#6366f1", icon }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10,
      padding: "14px 18px", minWidth: 110, flex: "1 1 110px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, color }}>
        {icon}<span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{value}</div>
    </div>
  );
}

export function RecertificationTab() {
  const { state } = useGovernance();
  const [campaigns, setCampaigns] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [respondingId, setRespondingId] = useState(null);
  const [respondForm, setRespondForm] = useState({ response: "approved", responder: "", notes: "" });
  const [launching, setLaunching] = useState(false);
  const [launchConfig, setLaunchConfig] = useState({ dueInDays: 14, selectedAgentIds: [] });
  const [showLaunchPanel, setShowLaunchPanel] = useState(false);
  const [error, setError] = useState(null);

  const agents = state.discoveryResult?.agents || [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [campaignRes, statsRes] = await Promise.all([
        agentGovernanceApi.listRecertificationCampaigns({
          status: statusFilter !== "all" ? statusFilter : undefined,
          platform: platformFilter !== "all" ? platformFilter : undefined,
          limit: 200,
        }),
        agentGovernanceApi.getRecertificationStats(),
      ]);
      // Also expire overdue silently
      agentGovernanceApi.expireOverdueCampaigns().catch(() => {});
      setCampaigns(campaignRes.campaigns || []);
      setStats(statsRes);
    } catch (e) {
      setError(e.message || "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, platformFilter]);

  useEffect(() => { load(); }, [load]);

  const handleRespond = async (campaignId) => {
    try {
      await agentGovernanceApi.respondRecertification(
        campaignId, respondForm.response, respondForm.responder, respondForm.notes
      );
      setRespondingId(null);
      setRespondForm({ response: "approved", responder: "", notes: "" });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleEscalate = async (campaignId) => {
    const to = prompt("Escalate to (email or name):", "admin");
    if (!to) return;
    try {
      await agentGovernanceApi.escalateRecertification(campaignId, to);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (campaignId) => {
    if (!confirm("Delete this campaign?")) return;
    try {
      await agentGovernanceApi.deleteRecertificationCampaign(campaignId);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleLaunch = async () => {
    if (launchConfig.selectedAgentIds.length === 0) {
      alert("Select at least one agent to recertify.");
      return;
    }
    setLaunching(true);
    try {
      const selected = agents.filter((a) => launchConfig.selectedAgentIds.includes(a.id));
      const res = await agentGovernanceApi.launchRecertificationCampaign(selected, launchConfig.dueInDays);
      alert(`Launched ${res.campaignsCreated} campaign(s). ${res.skippedDuplicates || 0} skipped (already open).`);
      setShowLaunchPanel(false);
      setLaunchConfig({ dueInDays: 14, selectedAgentIds: [] });
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setLaunching(false);
    }
  };

  const toggleAgentSelect = (id) => {
    setLaunchConfig((prev) => ({
      ...prev,
      selectedAgentIds: prev.selectedAgentIds.includes(id)
        ? prev.selectedAgentIds.filter((x) => x !== id)
        : [...prev.selectedAgentIds, id],
    }));
  };

  const selectByRisk = (level) => {
    const ids = agents.filter((a) => a.risk?.level === level).map((a) => a.id);
    setLaunchConfig((prev) => ({ ...prev, selectedAgentIds: [...new Set([...prev.selectedAgentIds, ...ids])] }));
  };

  const filteredCampaigns = campaigns.filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (platformFilter !== "all" && c.platform !== platformFilter) return false;
    return true;
  });

  return (
    <div style={{ padding: "20px 24px", fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <ShieldCheck size={18} color="#6366f1" />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>Recertification Campaigns</h2>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
            Require agent owners to review and re-approve agents on a schedule. Overdue campaigns escalate automatically.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", color: "#374151" }}
          >
            <RefreshCw size={13} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
            Refresh
          </button>
          <button
            onClick={() => setShowLaunchPanel(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 12, fontWeight: 600, background: "#6366f1", border: "none", borderRadius: 7, cursor: "pointer", color: "#fff" }}
          >
            <Plus size={13} /> Launch Campaign
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <StatCard label="Total"     value={stats.total || 0}     color="#6366f1" icon={<ShieldCheck size={14} />} />
          <StatCard label="Pending"   value={stats.pending || 0}   color="#f59e0b" icon={<Clock size={14} />} />
          <StatCard label="Approved"  value={stats.approved || 0}  color="#10b981" icon={<CheckCircle2 size={14} />} />
          <StatCard label="Rejected"  value={stats.rejected || 0}  color="#ef4444" icon={<XCircle size={14} />} />
          <StatCard label="Escalated" value={stats.escalated || 0} color="#8b5cf6" icon={<ChevronsUp size={14} />} />
          <StatCard label="Overdue"   value={stats.overdue || 0}   color="#dc2626" icon={<AlertTriangle size={14} />} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {["all", "pending", "approved", "rejected", "escalated", "expired"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: statusFilter === s ? "#6366f1" : "#f3f4f6",
            color: statusFilter === s ? "#fff" : "#374151",
            border: "none",
          }}>
            {s === "all" ? "All" : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}
        >
          <option value="all">All Platforms</option>
          {Object.entries(PLATFORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 14px", background: "#fee2e2", borderRadius: 8, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Campaign Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", fontSize: 13 }}>Loading campaigns…</div>
      ) : filteredCampaigns.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
          <ShieldCheck size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>No campaigns yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Launch a campaign to require agent owners to re-approve their agents.</div>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                {["Agent", "Platform", "Owner", "Due Date", "Status", "Responded By", "Actions"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredCampaigns.map((c) => {
                const isOverdue = c.status === "pending" && new Date(c.due_at) < new Date();
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6", background: isOverdue ? "#fffbeb" : undefined }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "#111827", maxWidth: 180 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.agent_name || c.agent_id}</div>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#6b7280" }}>{PLATFORM_LABELS[c.platform] || c.platform}</td>
                    <td style={{ padding: "10px 14px", color: "#374151" }}>
                      <div style={{ fontSize: 11 }}>{c.owner_name || "—"}</div>
                      {c.owner_email && <div style={{ fontSize: 10, color: "#9ca3af" }}>{c.owner_email}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", color: isOverdue ? "#dc2626" : "#374151", fontWeight: isOverdue ? 600 : 400 }}>
                      {c.due_at ? new Date(c.due_at).toLocaleDateString() : "—"}
                      {isOverdue && <span style={{ marginLeft: 4, fontSize: 10, color: "#dc2626" }}>Overdue</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <StatusBadge status={c.status} />
                      {c.notes && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{c.notes.substring(0, 60)}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", color: "#374151", fontSize: 11 }}>
                      {c.responder || "—"}
                      {c.responded_at && <div style={{ fontSize: 10, color: "#9ca3af" }}>{new Date(c.responded_at).toLocaleDateString()}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {c.status === "pending" && (
                          <>
                            {respondingId === c.id ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
                                <select
                                  value={respondForm.response}
                                  onChange={(e) => setRespondForm((p) => ({ ...p, response: e.target.value }))}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid #e5e7eb" }}
                                >
                                  <option value="approved">Approve</option>
                                  <option value="rejected">Reject</option>
                                </select>
                                <input
                                  placeholder="Responder name"
                                  value={respondForm.responder}
                                  onChange={(e) => setRespondForm((p) => ({ ...p, responder: e.target.value }))}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid #e5e7eb" }}
                                />
                                <input
                                  placeholder="Notes (optional)"
                                  value={respondForm.notes}
                                  onChange={(e) => setRespondForm((p) => ({ ...p, notes: e.target.value }))}
                                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid #e5e7eb" }}
                                />
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button onClick={() => handleRespond(c.id)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#6366f1", color: "#fff", border: "none", cursor: "pointer" }}>Submit</button>
                                  <button onClick={() => setRespondingId(null)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#f3f4f6", color: "#374151", border: "none", cursor: "pointer" }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button onClick={() => setRespondingId(c.id)} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 4, background: "#6366f1", color: "#fff", border: "none", cursor: "pointer" }}>
                                  <Send size={10} style={{ marginRight: 3 }} />Respond
                                </button>
                                <button onClick={() => handleEscalate(c.id)} title="Escalate" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#ede9fe", color: "#7c3aed", border: "none", cursor: "pointer" }}>
                                  <ChevronsUp size={10} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                        <button onClick={() => handleDelete(c.id)} title="Delete" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#fee2e2", color: "#ef4444", border: "none", cursor: "pointer" }}>
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Launch Campaign Panel */}
      {showLaunchPanel && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 24, width: 560, maxHeight: "80vh",
            display: "flex", flexDirection: "column", gap: 16, overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Launch Recertification Campaign</h3>
              <button onClick={() => setShowLaunchPanel(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 18 }}>×</button>
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Due In (days)</label>
              <input
                type="number" min={1} max={90}
                value={launchConfig.dueInDays}
                onChange={(e) => setLaunchConfig((p) => ({ ...p, dueInDays: parseInt(e.target.value) || 14 }))}
                style={{ width: 80, padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 13 }}
              />
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                  Select Agents ({launchConfig.selectedAgentIds.length} selected)
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  {["critical", "high"].map((lvl) => (
                    <button key={lvl} onClick={() => selectByRisk(lvl)} style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                      background: lvl === "critical" ? "#fee2e2" : "#fef3c7",
                      color: lvl === "critical" ? "#dc2626" : "#b45309", border: "none", fontWeight: 600,
                    }}>
                      + All {lvl}
                    </button>
                  ))}
                  <button onClick={() => setLaunchConfig((p) => ({ ...p, selectedAgentIds: agents.map((a) => a.id) }))} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", background: "#f3f4f6", color: "#374151", border: "none" }}>
                    + All
                  </button>
                  <button onClick={() => setLaunchConfig((p) => ({ ...p, selectedAgentIds: [] }))} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", background: "#f3f4f6", color: "#374151", border: "none" }}>
                    Clear
                  </button>
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, maxHeight: 260, overflowY: "auto" }}>
                {agents.length === 0 ? (
                  <div style={{ padding: 16, color: "#9ca3af", fontSize: 12, textAlign: "center" }}>Run a discovery scan to load agents.</div>
                ) : (
                  agents.map((agent) => {
                    const selected = launchConfig.selectedAgentIds.includes(agent.id);
                    const riskColor = { critical: "#ef4444", high: "#f59e0b", medium: "#f59e0b", low: "#10b981" }[agent.risk?.level] || "#9ca3af";
                    return (
                      <div
                        key={agent.id}
                        onClick={() => toggleAgentSelect(agent.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                          borderBottom: "1px solid #f3f4f6", cursor: "pointer",
                          background: selected ? "#eef2ff" : "transparent",
                        }}
                      >
                        <input type="checkbox" readOnly checked={selected} style={{ cursor: "pointer" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{agent.name}</div>
                          <div style={{ fontSize: 10, color: "#9ca3af" }}>{PLATFORM_LABELS[agent.platform] || agent.platform}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 600, color: riskColor, padding: "1px 6px", borderRadius: 4, background: `${riskColor}15` }}>
                          {agent.risk?.level}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 8, borderTop: "1px solid #f3f4f6" }}>
              <button onClick={() => setShowLaunchPanel(false)} style={{ padding: "8px 16px", fontSize: 13, borderRadius: 7, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer" }}>Cancel</button>
              <button onClick={handleLaunch} disabled={launching || launchConfig.selectedAgentIds.length === 0} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 7, background: "#6366f1", color: "#fff", border: "none", cursor: "pointer", opacity: launching ? 0.7 : 1 }}>
                {launching ? "Launching…" : `Launch (${launchConfig.selectedAgentIds.length} agents)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
