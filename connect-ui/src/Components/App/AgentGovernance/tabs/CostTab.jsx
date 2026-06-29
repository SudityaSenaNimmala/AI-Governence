import { useState, useEffect, useMemo } from "react";
import {
  DollarSign, Cpu, Shield, Cloud, BarChart3, Clock, Users,
} from "lucide-react";
import { useGovernance, SCOPE_LABELS, SCOPE_COLORS } from "../AgentGovernanceContext";
import { getDemoAzureCost, getDemoGoogleCost } from "../demoData";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";

const PERIOD_OPTIONS = [
  { value: "P1D", label: "Last 24 hours", days: 1 },
  { value: "P7D", label: "Last 7 days", days: 7 },
  { value: "P30D", label: "Last 30 days", days: 30 },
  { value: "P90D", label: "Last 90 days", days: 90 },
];

const MODEL_COLORS = {
  "gpt-4o": "#10b981", "gpt-4o-mini": "#34d399", "gpt-4": "#6366f1", "gpt-4-turbo": "#818cf8",
  "gpt-35-turbo": "#f59e0b", "gpt-3.5-turbo": "#f59e0b", "dall-e-3": "#ec4899",
  "text-embedding-ada-002": "#8b5cf6", "text-embedding-3-small": "#a78bfa",
  "o1": "#0ea5e9", "o1-mini": "#38bdf8", "o3-mini": "#22d3ee",
  "gemini-2.0-flash": "#0F9D58", "gemini-2.0-pro": "#1A73E8", "gemini-1.5-pro": "#4285F4",
  "gemini-1.5-flash": "#34A853", "gemini-1.0-pro": "#5F6368",
};

function getModelColor(name) {
  const lower = (name || "").toLowerCase();
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (lower.includes(key)) return color;
  }
  return "#6b7280";
}

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(n) {
  if (!n || n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

// ─── Agent-level cost table ──────────────────────────────────────────
// Shows exactly which agent costs the organization how much, grouped by
// vendor, model, and platform. Built by joining cost rows (deployments /
// endpoints) with the discovered agents via `agentId`.
function AgentCostTable({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 30, color: "var(--ag-text-secondary)", fontSize: 13 }}>
        No billable AI usage found for the selected vendor / period.
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) => b.totalCost - a.totalCost);
  const max = sorted[0].totalCost || 1;
  const totalCost = sorted.reduce((s, r) => s + r.totalCost, 0);
  const totalTokens = sorted.reduce((s, r) => s + r.totalTokens, 0);
  const totalRequests = sorted.reduce((s, r) => s + (r.requestCount || 0), 0);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
            <th style={thStyle}>Agent</th>
            <th style={thStyle}>Vendor / Platform</th>
            <th style={thStyle}>Model</th>
            <th style={thStyle}>Owner</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Tokens</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Requests</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Cost</th>
            <th style={{ ...thStyle, textAlign: "right" }}>% of Spend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const color = getModelColor(r.modelName);
            const share = totalCost > 0 ? (r.totalCost / totalCost) * 100 : 0;
            const bar = max > 0 ? (r.totalCost / max) * 100 : 0;
            return (
              <tr key={`${r.agentId}-${i}`} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <td style={{ padding: "10px" }}>
                  <div style={{ fontWeight: 600 }}>{r.agentName}</div>
                </td>
                <td style={{ padding: "10px", fontSize: 11 }}>
                  <div style={{ color: r.vendorColor, fontWeight: 600 }}>{r.vendorLabel}</div>
                  <div style={{ color: "#999", fontSize: 10, marginTop: 2 }}>
                    {r.platformLabel}
                  </div>
                </td>
                <td style={{ padding: "10px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center",
                    background: `${color}15`, color, padding: "2px 8px",
                    borderRadius: 4, fontWeight: 600, fontSize: 11,
                  }}>
                    {r.modelName}
                  </span>
                </td>
                <td style={{ padding: "10px", fontSize: 11, color: "#666" }}>
                  {r.ownerName || "—"}
                </td>
                <td style={tdRight}>{formatTokens(r.totalTokens)}</td>
                <td style={tdRight}>{(r.requestCount || 0).toLocaleString()}</td>
                <td style={{ padding: "10px", textAlign: "right" }}>
                  <div style={{ fontWeight: 700 }}>{formatCost(r.totalCost)}</div>
                  <div style={{ marginTop: 3, height: 3, borderRadius: 2, background: "#e5e7eb", width: 70, marginLeft: "auto" }}>
                    <div style={{ height: 3, borderRadius: 2, background: color, width: `${Math.min(bar, 100)}%` }} />
                  </div>
                </td>
                <td style={{ ...tdRight, fontWeight: 600 }}>{share.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--ag-border)", fontWeight: 700 }}>
            <td colSpan={4} style={{ padding: "10px" }}>Total</td>
            <td style={tdRight}>{formatTokens(totalTokens)}</td>
            <td style={tdRight}>{totalRequests.toLocaleString()}</td>
            <td style={{ padding: "10px", textAlign: "right", fontSize: 14 }}>{formatCost(totalCost)}</td>
            <td style={{ ...tdRight }}>100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function CostTab() {
  const { state } = useGovernance();
  const vendor = state.selectedVendor;
  const scope = state.selectedScope;
  const agents = state.discoveryResult?.agents || [];

  const [period, setPeriod] = useState("P7D");
  const periodDays = PERIOD_OPTIONS.find((p) => p.value === period)?.days || 7;
  const [azureData, setAzureData] = useState(() => getDemoAzureCost(periodDays));
  const [googleData, setGoogleData] = useState(() => getDemoGoogleCost(periodDays));

  useEffect(() => {
    setAzureData(getDemoAzureCost(periodDays));
    setGoogleData(getDemoGoogleCost(periodDays));
  }, [periodDays]);

  // Build agent-indexed cost rows from both vendors.
  const agentById = useMemo(() => {
    const m = {};
    for (const a of agents) m[a.id] = a;
    return m;
  }, [agents]);

  const microsoftRows = useMemo(() => {
    const out = [];
    for (const d of azureData?.deployments || []) {
      const agent = agentById[d.agentId];
      out.push({
        agentId: d.agentId,
        agentName: d.deploymentName || agent?.name || "Unknown agent",
        vendorKey: "microsoft",
        vendorLabel: "Microsoft",
        vendorColor: "#0078D4",
        platformKey: agent?.platform || "azure_foundry",
        platformLabel: SCOPE_LABELS[agent?.platform] || "Azure AI Foundry",
        modelName: d.modelName,
        resourceName: d.resourceName,
        ownerName: agent?.owner?.displayName,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        totalTokens: d.totalTokens,
        requestCount: d.requestCount,
        inputCost: d.inputCost,
        outputCost: d.outputCost,
        totalCost: d.totalCost,
      });
    }
    return out;
  }, [azureData, agentById]);

  const googleRows = useMemo(() => {
    const out = [];
    for (const e of googleData?.endpoints || []) {
      const agent = agentById[e.agentId];
      // Only Vertex AI agents actually produce a pay-as-you-go line item.
      // Gemini Gems, NotebookLM, and Chat bot hosting are bundled in the
      // Workspace / Gemini add-on subscription, so we skip them here.
      const platform = agent?.platform;
      const isVertexPlatform = platform === "reasoning_engines" || platform === "agent_builder";
      const isVertexResource = (e.resourceName || "").startsWith("vantage-vertex");
      if (!isVertexPlatform && !isVertexResource) continue;
      out.push({
        agentId: e.agentId,
        agentName: e.displayName || agent?.name || "Unknown agent",
        vendorKey: "google",
        vendorLabel: "Google",
        vendorColor: "#4285F4",
        platformKey: agent?.platform || "agent_builder",
        platformLabel: SCOPE_LABELS[agent?.platform] || "Vertex AI",
        modelName: e.modelName,
        resourceName: e.resourceName,
        ownerName: agent?.owner?.displayName,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        totalTokens: e.totalTokens,
        requestCount: e.requestCount,
        inputCost: e.inputCost,
        outputCost: e.outputCost,
        totalCost: e.totalCost,
      });
    }
    return out;
  }, [googleData, agentById]);

  // Apply the header's vendor + scope filters.
  const allRows = useMemo(() => {
    let rows = [...microsoftRows, ...googleRows];
    if (vendor === "microsoft") rows = rows.filter((r) => r.vendorKey === "microsoft");
    if (vendor === "google") rows = rows.filter((r) => r.vendorKey === "google");
    if (scope && scope !== "all") rows = rows.filter((r) => r.platformKey === scope);
    return rows;
  }, [microsoftRows, googleRows, vendor, scope]);

  const msFiltered = allRows.filter((r) => r.vendorKey === "microsoft");
  const gFiltered = allRows.filter((r) => r.vendorKey === "google");

  const totalCost = allRows.reduce((s, r) => s + r.totalCost, 0);
  const azureCost = msFiltered.reduce((s, r) => s + r.totalCost, 0);
  const googleCost = gFiltered.reduce((s, r) => s + r.totalCost, 0);
  const totalTokens = allRows.reduce((s, r) => s + r.totalTokens, 0);
  const totalRequests = allRows.reduce((s, r) => s + (r.requestCount || 0), 0);
  const billedAgents = allRows.length;

  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Clock size={14} color="#6366f1" />
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            style={{
              padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: "1px solid #6366f1", background: "#6366f108", color: "#6366f1",
              cursor: "pointer", fontFamily: "inherit", outline: "none",
            }}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Total Cost"
          value={formatCost(totalCost)}
          color={totalCost > 100 ? "#ef4444" : totalCost > 10 ? "#f59e0b" : "#22c55e"}
          sub={periodLabel}
          icon={<DollarSign size={20} />}
        />
        {(vendor === "all" || vendor === "microsoft") && (
          <StatCard
            label="Azure OpenAI Cost"
            value={formatCost(azureCost)}
            color="#0078D4"
            sub={`${msFiltered.length} agent${msFiltered.length === 1 ? "" : "s"}`}
            icon={<Shield size={20} />}
          />
        )}
        {(vendor === "all" || vendor === "google") && (
          <StatCard
            label="Google Vertex Cost"
            value={formatCost(googleCost)}
            color="#4285F4"
            sub={`${gFiltered.length} agent${gFiltered.length === 1 ? "" : "s"}`}
            icon={<Cloud size={20} />}
          />
        )}
        <StatCard
          label="Billable Agents"
          value={billedAgents}
          color="#6366f1"
          sub={`contributing to spend`}
          icon={<Users size={20} />}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(totalTokens)}
          color="#8b5cf6"
          sub="input + output"
          icon={<Cpu size={20} />}
        />
        <StatCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
          color="#a855f7"
          sub={periodLabel}
          icon={<BarChart3 size={20} />}
        />
      </div>

      {/* Agent-level breakdown — the headline "which agents cost us what" view. */}
      <Section title={`Cost Per Agent (${formatCost(totalCost)})`}>
        <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
          <AgentCostTable rows={allRows} />
        </div>
      </Section>

      {/* Pricing reference */}
      <Section title="Pricing Reference">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {(vendor === "all" || vendor === "microsoft") && (
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, flex: "0 1 380px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#0078D4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Shield size={14} /> Azure OpenAI (per 1M tokens)
              </div>
              {[
                { model: "GPT-4o", input: "$2.50", output: "$10.00" },
                { model: "GPT-4o-mini", input: "$0.15", output: "$0.60" },
                { model: "GPT-4", input: "$30.00", output: "$60.00" },
                { model: "GPT-3.5-turbo", input: "$0.50", output: "$1.50" },
                { model: "o1", input: "$15.00", output: "$60.00" },
                { model: "o3-mini", input: "$1.10", output: "$4.40" },
              ].map((r) => (
                <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                  <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                </div>
              ))}
            </div>
          )}
          {(vendor === "all" || vendor === "google") && (
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, flex: "0 1 380px" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#4285F4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Cloud size={14} /> Google Vertex AI (per 1M tokens)
              </div>
              {[
                { model: "Gemini 2.0 Pro", input: "$12.50", output: "$50.00" },
                { model: "Gemini 1.5 Pro", input: "$12.50", output: "$50.00" },
                { model: "Gemini 2.0 Flash", input: "$0.10", output: "$0.40" },
                { model: "Gemini 1.5 Flash", input: "$0.075", output: "$0.30" },
              ].map((r) => (
                <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                  <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 10 }}>
          Pricing is approximate and based on standard pay-as-you-go rates. Actual costs may vary based on enterprise agreements,
          committed-use discounts, and region.
        </div>
      </Section>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
const tdRight = { padding: "10px", textAlign: "right", fontFamily: "monospace", fontSize: 11 };
