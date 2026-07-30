import { useState, useEffect, useCallback } from "react";
import {
  Wallet, Users, DollarSign, TrendingUp, RefreshCw, Link, X, Eye, EyeOff,
  AlertTriangle, Shield, ChevronDown, ChevronUp, Search,
} from "lucide-react";
import { useAgentAuth, useGovernance } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";
import { LoadingSpinner } from "../common/LoadingSpinner";
import "../css/AgentGovernance.css";

// ── Helpers ──────────────────────────────────────────────────────────────────

function centsToUsd(cents) {
  if (cents == null) return null;
  const n = typeof cents === "string" ? parseFloat(cents) : cents;
  if (isNaN(n)) return null;
  return n / 100;
}

function formatUsd(dollars) {
  if (dollars == null) return "Unlimited";
  return "$" + dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function utilPercent(spend, limit) {
  if (limit == null || limit <= 0) return null;
  return Math.min((spend / limit) * 100, 100);
}

function utilColor(pct) {
  if (pct == null) return "#6b7280";
  if (pct >= 90) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  if (pct >= 60) return "#eab308";
  return "#22c55e";
}

function sourceLabel(source) {
  if (!source) return "Unknown";
  switch (source.type) {
    case "user": return "Per-user override";
    case "seat_tier": return source.seat_tier ? `Seat: ${source.seat_tier.replace(/_/g, " ")}` : "Seat tier";
    case "rbac_group": return "Group";
    case "organization": return "Org default";
    default: return source.type || "Unknown";
  }
}

// ── Connect Modal ────────────────────────────────────────────────────────────

function BudgetConnectModal({ onClose, onConnect }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const isValidKey = apiKey.trim().startsWith("sk-ant-admin");

  const handleConnect = async () => {
    if (!isValidKey) return;
    setConnecting(true);
    setError(null);
    try {
      await onConnect(apiKey.trim());
      onClose();
    } catch (err) {
      setError(err.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="ag_modal_overlay" onClick={onClose}>
      <div className="ag_modal_content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="ag_modal_header">
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
            <Wallet size={18} /> Connect AI Budget
          </h3>
          <button className="ag_modal_close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {/* Claude option */}
          <div style={{
            border: "2px solid var(--ag-accent, #D4622A)",
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            background: "var(--ag-bg-card, #fff)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "linear-gradient(135deg, #D4622A, #E07B39)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 700, fontSize: 14,
              }}>C</div>
              <div>
                <div style={{ fontWeight: 600, color: "var(--ag-text-primary, #111)" }}>Claude (Anthropic)</div>
                <div style={{ fontSize: 12, color: "var(--ag-text-secondary, #666)" }}>Manage spend limits for your Claude Enterprise org</div>
              </div>
            </div>

            <div style={{ fontSize: 13, color: "var(--ag-text-secondary, #555)", marginBottom: 14, lineHeight: 1.5 }}>
              Enter your <strong>Admin API key</strong> to view and manage org member budgets.
              Create one at{" "}
              <a href="https://console.anthropic.com/settings/admin-keys" target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--ag-accent, #D4622A)" }}>
                console.anthropic.com
              </a>{" "}
              with the <code style={{ background: "#f1f5f9", padding: "1px 5px", borderRadius: 3, fontSize: 12 }}>read:spend_limits</code> scope.
            </div>

            <div className="ag_form_group" style={{ marginBottom: 12 }}>
              <label className="ag_form_label" style={{ fontSize: 13, marginBottom: 4 }}>Admin API Key</label>
              <div style={{ position: "relative" }}>
                <input
                  className="ag_form_input"
                  type={showKey ? "text" : "password"}
                  placeholder="sk-ant-admin01-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  style={{ paddingRight: 36, width: "100%", fontFamily: "monospace", fontSize: 13 }}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: "#888", padding: 2,
                  }}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {apiKey.trim() && !isValidKey && (
                <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
                  Key must start with <code>sk-ant-admin</code>. Standard API keys don't have access to spend limits.
                </div>
              )}
            </div>

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
                padding: "8px 12px", marginBottom: 12, color: "#dc2626", fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              disabled={!isValidKey || connecting}
              onClick={handleConnect}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "10px 20px", borderRadius: 8, border: "none",
                background: "#1B1F3B", color: "#fff", fontSize: 14, fontWeight: 600,
                cursor: (!isValidKey || connecting) ? "not-allowed" : "pointer",
                opacity: (!isValidKey || connecting) ? 0.5 : 1,
              }}
            >
              {connecting ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Link size={14} />}
              {connecting ? "Connecting..." : "Connect Claude"}
            </button>
          </div>

          <div style={{ fontSize: 12, color: "var(--ag-text-secondary, #999)", textAlign: "center" }}>
            More AI platforms coming soon (Cursor, OpenAI, etc.)
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Utilization Bar ──────────────────────────────────────────────────────────

function UtilBar({ percent }) {
  if (percent == null) return <span style={{ color: "#9ca3af", fontSize: 13 }}>N/A</span>;
  const color = utilColor(percent);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
      <div style={{
        flex: 1, height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden",
      }}>
        <div style={{
          width: `${percent}%`, height: "100%", background: color,
          borderRadius: 4, transition: "width 0.3s ease",
        }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 36, textAlign: "right" }}>
        {percent.toFixed(0)}%
      </span>
    </div>
  );
}

// ── Main Tab ─────────────────────────────────────────────────────────────────

export function BudgetTab() {
  const { claudeKeyId, connectClaude } = useAgentAuth();
  const { state } = useGovernance();

  const [members, setMembers] = useState([]);
  const [orgStats, setOrgStats] = useState({ totalCostUsd: 0, inputTokens: 0, outputTokens: 0, month: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsAdminKey, setNeedsAdminKey] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortAsc, setSortAsc] = useState(true);

  const fetchMembers = useCallback(async () => {
    if (!claudeKeyId) return;
    setLoading(true);
    setError(null);
    setNeedsAdminKey(false);
    try {
      const data = await agentGovernanceApi.fetchClaudeBudgetMembers(claudeKeyId);
      setMembers(data.members || []);
      setOrgStats({
        totalCostUsd: data.cost?.total_usd || 0,
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
        month: data.cost?.month || "",
      });
    } catch (err) {
      if (err.message?.includes("needsAdminKey") || err.message?.includes("Admin API key")) {
        setNeedsAdminKey(true);
        setError("The connected Claude key is a standard API key. Spend limits require an Admin API key.");
      } else {
        setError(err.message || "Failed to fetch budget data");
      }
    } finally {
      setLoading(false);
    }
  }, [claudeKeyId]);

  useEffect(() => {
    if (claudeKeyId) fetchMembers();
  }, [claudeKeyId, state.refreshKey, fetchMembers]);

  const handleConnect = async (apiKey) => {
    await connectClaude(apiKey);
    // Clear old error and re-fetch with the new key
    setError(null);
    setNeedsAdminKey(false);
    setMembers([]);
    // Small delay to let context update the claudeKeyId
    setTimeout(() => fetchMembers(), 300);
  };

  // ── Process members for display ──
  const processedMembers = members.map((m) => {
    return {
      userId: m.id || "unknown",
      name: m.name || "Unknown",
      email: m.email || "",
      role: m.role || "user",
      addedAt: m.added_at || null,
    };
  });

  // ── Filter ──
  const filtered = processedMembers.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  // ── Sort ──
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name": cmp = a.name.localeCompare(b.name); break;
      case "email": cmp = a.email.localeCompare(b.email); break;
      case "role": cmp = a.role.localeCompare(b.role); break;
      case "added": cmp = (a.addedAt || "").localeCompare(b.addedAt || ""); break;
      default: cmp = a.name.localeCompare(b.name);
    }
    return sortAsc ? cmp : -cmp;
  });

  const totalMembers = processedMembers.length;
  const adminCount = processedMembers.filter((m) => m.role === "admin").length;
  const devCount = processedMembers.filter((m) => m.role === "developer").length;

  function formatTokens(n) {
    if (!n) return "0";
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return n.toString();
  }

  function roleBadgeColor(role) {
    switch (role) {
      case "admin": return "#8b5cf6";
      case "developer": return "#3b82f6";
      case "claude_code_user": return "#D4622A";
      case "billing": return "#22c55e";
      default: return "#6b7280";
    }
  }

  function roleLabel(role) {
    if (role === "claude_code_user") return "Claude Code";
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  function timeAgo(dateStr) {
    if (!dateStr) return "—";
    const ms = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(ms / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown size={12} style={{ opacity: 0.3 }} />;
    return sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  // ── Empty state: no Claude key ──
  if (!claudeKeyId) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
          background: "linear-gradient(135deg, #D4622A22, #E07B3922)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Wallet size={28} style={{ color: "#D4622A" }} />
        </div>
        <h3 style={{ margin: "0 0 8px", color: "var(--ag-text-primary, #111)" }}>AI Budget Management</h3>
        <p style={{ color: "var(--ag-text-secondary, #666)", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px", lineHeight: 1.6 }}>
          Connect your Claude Enterprise organization to view and manage per-user spend limits,
          track usage, and control AI costs across your team.
        </p>
        <button
          onClick={() => setShowConnectModal(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#1B1F3B", color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Link size={14} /> Connect Claude
        </button>
        {showConnectModal && (
          <BudgetConnectModal onClose={() => setShowConnectModal(false)} onConnect={handleConnect} />
        )}
      </div>
    );
  }

  // ── Needs admin key upgrade ──
  if (needsAdminKey) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
          background: "#fef3c722",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertTriangle size={28} style={{ color: "#f59e0b" }} />
        </div>
        <h3 style={{ margin: "0 0 8px", color: "var(--ag-text-primary, #111)" }}>Admin API Key Required</h3>
        <p style={{ color: "var(--ag-text-secondary, #666)", marginBottom: 24, maxWidth: 440, margin: "0 auto 24px", lineHeight: 1.6 }}>
          The currently connected Claude key is a standard API key.
          Spend limits require an <strong>Admin API key</strong> (starting with <code>sk-ant-admin</code>).
          This will replace your current key and work for both Budget and Discovery features.
        </p>
        <button
          onClick={() => setShowConnectModal(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 24px", borderRadius: 8, border: "none",
            background: "#1B1F3B", color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Link size={14} /> Connect Admin Key
        </button>
        {showConnectModal && (
          <BudgetConnectModal onClose={() => setShowConnectModal(false)} onConnect={handleConnect} />
        )}
      </div>
    );
  }

  // ── Loading ──
  if (loading && members.length === 0) {
    return <LoadingSpinner message="Fetching organization members..." />;
  }

  // ── Error — show error + reconnect option ──
  if (error && members.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16, margin: "0 auto 20px",
          background: "#fef2f222",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertTriangle size={28} style={{ color: "#ef4444" }} />
        </div>
        <h3 style={{ margin: "0 0 8px", color: "var(--ag-text-primary, #111)" }}>Connection Failed</h3>
        <div style={{
          background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
          padding: "12px 20px", maxWidth: 500, margin: "0 auto 20px", color: "#dc2626", fontSize: 13,
        }}>
          {error}
        </div>
        <p style={{ color: "var(--ag-text-secondary, #666)", marginBottom: 24, maxWidth: 400, margin: "0 auto 24px", lineHeight: 1.6, fontSize: 14 }}>
          Please connect with a valid Claude Admin API key to continue.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={fetchMembers}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
              background: "#fff", color: "#374151", fontSize: 14, fontWeight: 500, cursor: "pointer",
            }}
          >
            <RefreshCw size={14} /> Retry
          </button>
          <button
            onClick={() => setShowConnectModal(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 24px", borderRadius: 8, border: "none",
              background: "#1B1F3B", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Link size={14} /> Reconnect
          </button>
        </div>
        {showConnectModal && (
          <BudgetConnectModal onClose={() => setShowConnectModal(false)} onConnect={handleConnect} />
        )}
      </div>
    );
  }

  // ── Connected + data ──
  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, color: "var(--ag-text-primary, #111)", display: "flex", alignItems: "center", gap: 8 }}>
            <Wallet size={18} /> AI Budget
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ag-text-secondary, #666)" }}>
            Claude Enterprise spend limits for {totalMembers} organization member{totalMembers !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={fetchMembers} disabled={loading} title="Refresh"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db",
              background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer",
            }}
          >
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
          </button>
          <button
            onClick={() => setShowConnectModal(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: "#1B1F3B", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}
          >
            <Link size={14} /> Connect
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Total Members" value={totalMembers} icon={<Users size={18} />} color="#6366f1" />
        <StatCard label="Admins" value={adminCount} icon={<Shield size={18} />} color="#8b5cf6" />
        <StatCard label="Developers" value={devCount} icon={<TrendingUp size={18} />} color="#3b82f6" />
        <StatCard label="Month Spend" value={formatUsd(orgStats.totalCostUsd)} icon={<DollarSign size={18} />} color="#22c55e" sub={orgStats.month || undefined} />
        <StatCard label="Tokens Used" value={formatTokens(orgStats.inputTokens + orgStats.outputTokens)} icon={<Wallet size={18} />} color="#D4622A" />
      </div>

      {/* Members table */}
      <Section title={`Organization Members (${sorted.length})`}>
        {/* Search */}
        <div style={{ marginBottom: 14, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
          <input
            className="ag_form_input"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 32, width: "100%", maxWidth: 320, fontSize: 13 }}
          />
        </div>

        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--ag-text-secondary, #888)" }}>
            {searchQuery ? "No members match your search." : "No members found in your organization."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--ag-border, #e5e7eb)" }}>
                  {[
                    { key: "name", label: "Name" },
                    { key: "email", label: "Email" },
                    { key: "role", label: "Role" },
                    { key: "added", label: "Added" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        textAlign: "left", padding: "10px 12px", fontWeight: 600,
                        color: "var(--ag-text-secondary, #555)", cursor: "pointer",
                        userSelect: "none", whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {col.label} <SortIcon field={col.key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr
                    key={m.userId}
                    style={{ borderBottom: "1px solid var(--ag-border, #f0f0f0)" }}
                  >
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "var(--ag-text-primary, #111)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%",
                          background: `hsl(${m.name.charCodeAt(0) * 7 % 360}, 60%, 90%)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 700,
                          color: `hsl(${m.name.charCodeAt(0) * 7 % 360}, 60%, 40%)`,
                        }}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        {m.name}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--ag-text-secondary, #666)", fontSize: 12 }}>
                      {m.email}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span style={{
                        fontSize: 11, padding: "3px 10px", borderRadius: 10, fontWeight: 600,
                        background: roleBadgeColor(m.role) + "14",
                        color: roleBadgeColor(m.role),
                      }}>
                        {roleLabel(m.role)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", color: "var(--ag-text-secondary, #888)", fontSize: 12 }}>
                      {timeAgo(m.addedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {showConnectModal && (
        <BudgetConnectModal onClose={() => setShowConnectModal(false)} onConnect={handleConnect} />
      )}
    </div>
  );
}
