import { useState, useEffect, useMemo } from "react";
import {
  DollarSign, TrendingUp, Cpu, Zap, RefreshCw, Cloud, Shield,
  ArrowUpRight, ArrowDownRight, BarChart3, Clock, Filter, Bot, Sparkles,
  Info
} from "lucide-react";
import { useAgentAuth, useGovernance } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";
import { Badge } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";

// ── Subscription-included limits (monthly) ──
// These are well-known free tiers / subscription inclusions.
// Usage within these limits is NOT extra cost.
const SUBSCRIPTION_LIMITS = {
  azure_openai: {
    // Azure OpenAI is pure pay-as-you-go — no free tier
    freeTokens: 0,
    note: "Pay-as-you-go — all token usage is billed",
  },
  openai: {
    // OpenAI API has no ongoing free tier (only one-time signup credits)
    freeTokens: 0,
    note: "Pay-as-you-go — all API usage is billed",
  },
  claude: {
    // Anthropic API is pay-as-you-go
    freeTokens: 0,
    note: "Pay-as-you-go — all API usage is billed",
  },
  google_vertex: {
    // Gemini Flash: free tier up to 15 RPM / 1M tokens/day
    freeTokensPerDay: 1_000_000,
    freeRequestsPerDay: 1500,
    note: "Gemini Flash free tier: ~1M tokens/day, 15 RPM. Pro/Ultra are pay-as-you-go.",
  },
  gemini_enterprise: {
    // Gemini for Google Workspace is included in Business Standard+, Enterprise, Education Plus
    includedInSubscription: true,
    note: "Included in Workspace Business Standard, Enterprise, and Education Plus licenses — no extra per-query cost for standard Gemini features",
  },
  m365_copilot: {
    // M365 Copilot is a per-user add-on ($30/user/month) — usage within it has no per-token cost
    includedInSubscription: true,
    note: "M365 Copilot: $30/user/month add-on — no per-token overage. Copilot Studio: first 25,000 messages/month included with standalone license ($200/mo), then $0.01/message overage.",
    copilotStudioFreeMessages: 25000,
  },
};


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
  "claude-opus": "#D4622A", "claude-sonnet": "#E07B39", "claude-haiku": "#B85C38",
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

function CostBreakdownTable({ deployments, vendor }) {
  if (!deployments || deployments.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 30, color: "var(--ag-text-secondary)", fontSize: 13 }}>
        No usage data found for this period
      </div>
    );
  }

  const sorted = [...deployments].sort((a, b) => b.totalCost - a.totalCost);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
            <th style={thStyle}>{vendor === "Microsoft" ? "Deployment" : "Endpoint"}</th>
            <th style={thStyle}>Model</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Input Tokens</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Output Tokens</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Total Tokens</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Requests</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Input Cost</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Output Cost</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((dep, i) => {
            const color = getModelColor(dep.modelName);
            const costPct = sorted[0].totalCost > 0 ? (dep.totalCost / sorted[0].totalCost) * 100 : 0;
            return (
              <tr key={`${dep.deploymentName || dep.endpointId}-${i}`} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <td style={{ padding: "10px" }}>
                  <div style={{ fontWeight: 600 }}>{dep.deploymentName || dep.displayName}</div>
                  {dep.resourceName && <div style={{ fontSize: 10, color: "#999" }}>{dep.resourceName}</div>}
                </td>
                <td style={{ padding: "10px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    background: `${color}15`, color, padding: "2px 8px",
                    borderRadius: 4, fontWeight: 600, fontSize: 11,
                  }}>
                    {dep.modelName}
                  </span>
                  {dep.costEstimated && (
                    <div style={{ fontSize: 9, color: "#f59e0b", fontWeight: 500, marginTop: 2 }}>
                      ~ estimated pricing
                    </div>
                  )}
                </td>
                <td style={{ ...tdRight }}>{formatTokens(dep.inputTokens)}</td>
                <td style={{ ...tdRight }}>{formatTokens(dep.outputTokens)}</td>
                <td style={{ ...tdRight, fontWeight: 600 }}>{formatTokens(dep.totalTokens)}</td>
                <td style={{ ...tdRight }}>{dep.requestCount?.toLocaleString() || "—"}</td>
                <td style={{ ...tdRight, color: "#6366f1" }}>{formatCost(dep.inputCost)}</td>
                <td style={{ ...tdRight, color: "#8b5cf6" }}>{formatCost(dep.outputCost)}</td>
                <td style={{ padding: "10px", textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: dep.totalCost > 0 ? "#ef4444" : "#22c55e" }}>
                    {formatCost(dep.totalCost)}
                  </div>
                  {costPct > 0 && (
                    <div style={{
                      marginTop: 3, height: 3, borderRadius: 2,
                      background: "#e5e7eb", width: 60, marginLeft: "auto",
                    }}>
                      <div style={{
                        height: 3, borderRadius: 2, background: color,
                        width: `${Math.min(costPct, 100)}%`,
                      }} />
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--ag-border)", fontWeight: 700 }}>
            <td colSpan={2} style={{ padding: "10px" }}>Total</td>
            <td style={tdRight}>{formatTokens(sorted.reduce((s, d) => s + d.inputTokens, 0))}</td>
            <td style={tdRight}>{formatTokens(sorted.reduce((s, d) => s + d.outputTokens, 0))}</td>
            <td style={{ ...tdRight, fontWeight: 700 }}>{formatTokens(sorted.reduce((s, d) => s + d.totalTokens, 0))}</td>
            <td style={tdRight}>{sorted.reduce((s, d) => s + (d.requestCount || 0), 0).toLocaleString()}</td>
            <td style={{ ...tdRight, color: "#6366f1" }}>{formatCost(sorted.reduce((s, d) => s + d.inputCost, 0))}</td>
            <td style={{ ...tdRight, color: "#8b5cf6" }}>{formatCost(sorted.reduce((s, d) => s + d.outputCost, 0))}</td>
            <td style={{ padding: "10px", textAlign: "right", fontWeight: 700, color: "#ef4444", fontSize: 14 }}>
              {formatCost(sorted.reduce((s, d) => s + d.totalCost, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ModelCostCards({ deployments }) {
  if (!deployments || deployments.length === 0) return null;

  const modelCosts = {};
  for (const dep of deployments) {
    const model = dep.modelName || "unknown";
    if (!modelCosts[model]) {
      modelCosts[model] = { tokens: 0, cost: 0, requests: 0 };
    }
    modelCosts[model].tokens += dep.totalTokens || 0;
    modelCosts[model].cost += dep.totalCost || 0;
    modelCosts[model].requests += dep.requestCount || 0;
  }

  const sorted = Object.entries(modelCosts).sort((a, b) => b[1].cost - a[1].cost);

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {sorted.map(([model, data]) => {
        const color = getModelColor(model);
        return (
          <div key={model} style={{
            background: `${color}08`, border: `1px solid ${color}25`,
            borderRadius: 10, padding: "14px 18px", minWidth: 180, flex: "0 1 220px",
          }}>
            <div style={{ fontWeight: 700, fontSize: 13, color, marginBottom: 8 }}>{model}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "#666" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Tokens</span>
                <span style={{ fontWeight: 600, color: "var(--ag-text-primary)" }}>{formatTokens(data.tokens)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Requests</span>
                <span style={{ fontWeight: 600, color: "var(--ag-text-primary)" }}>{data.requests.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 4, marginTop: 2 }}>
                <span style={{ fontWeight: 600 }}>Cost</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: data.cost > 0 ? "#ef4444" : "#22c55e" }}>
                  {formatCost(data.cost)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CostTab() {
  const { oauthKeyId, isAuthenticated, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId } = useAgentAuth();
  const { state: { refreshKey, discoveryStatus } } = useGovernance();
  const scanActive = discoveryStatus === "loading" || discoveryStatus === "success";

  const [period, setPeriod] = useState("P7D");
  const [costData, setCostData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState([]);

  const periodDays = PERIOD_OPTIONS.find((p) => p.value === period)?.days || 7;

  // Detect which single vendor is active
  const vendor = oauthKeyId ? "microsoft" : googleKeyId ? "google" : openaiKeyId ? "openai" : claudeKeyId ? "claude" : geminiEnterpriseKeyId ? "gemini" : null;

  const VENDOR_META = {
    microsoft: { label: "Microsoft / Azure OpenAI", color: "#0078D4", icon: Shield, costType: "pay-as-you-go",
      subscriptionNote: "M365 Copilot usage is included in the Copilot license ($30/user/month) — no per-token cost. Copilot Studio includes 25,000 messages/month; overage is $0.01/message. Costs below are only for Azure OpenAI Service deployments (pay-as-you-go)." },
    google: { label: "Google / Vertex AI", color: "#4285F4", icon: Cloud, costType: "pay-as-you-go + free tier",
      subscriptionNote: "Gemini Flash includes a free tier (~1M tokens/day, 15 RPM). Pro and Ultra are pay-as-you-go from the first token. Costs below show only usage beyond the free tier." },
    openai: { label: "ChatGPT / OpenAI", color: "#10a37f", icon: Bot, costType: "pay-as-you-go",
      subscriptionNote: null },
    claude: { label: "Claude / Anthropic", color: "#D4622A", icon: Bot, costType: "pay-as-you-go",
      subscriptionNote: null },
    gemini: { label: "Gemini Enterprise", color: "#886FBF", icon: Sparkles, costType: "included",
      subscriptionNote: "Gemini Enterprise usage is included in Google Workspace Business Standard, Enterprise, and Education Plus licenses — no extra per-query charge. Request counts below are for visibility only." },
  };

  const meta = vendor ? VENDOR_META[vendor] : null;

  const fetchCost = async () => {
    if (!vendor) return;
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      let data;
      if (vendor === "microsoft") {
        data = await agentGovernanceApi.fetchAzureCost(oauthKeyId, period);
        data._vendor = "microsoft";
      } else if (vendor === "google") {
        data = await agentGovernanceApi.fetchGoogleCost(googleKeyId, periodDays);
        data._vendor = "google";
      } else if (vendor === "openai") {
        data = await agentGovernanceApi.fetchOpenAICost(openaiKeyId, period);
        data._vendor = "openai";
        if (data.warnings?.length) setWarnings(data.warnings);
      } else if (vendor === "claude") {
        data = await agentGovernanceApi.fetchClaudeUsage(claudeKeyId, period);
        data._vendor = "claude";
        if (data.warnings?.length) setWarnings(data.warnings);
      } else if (vendor === "gemini") {
        data = await agentGovernanceApi.fetchGeminiEnterpriseCost(geminiEnterpriseKeyId, periodDays);
        data._vendor = "gemini";
      }
      setCostData(data);
    } catch (err) {
      setError(err.message || "Failed to fetch cost data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (scanActive && vendor) fetchCost(); }, [scanActive, period, vendor, refreshKey]);

  // Extract unified values from whichever vendor is active
  const deployments = costData?.deployments || costData?.endpoints || [];
  const summary = costData?.summary || {};
  const totalCost = summary.totalCost || costData?.estimatedTotalCost || 0;
  const totalTokens = summary.totalTokens || 0;
  const totalRequests = summary.totalRequests || summary.totalPredictions || costData?.totalRequests || 0;

  // Compute extra cost (subtract subscription-included / free tier usage)
  const extraCost = useMemo(() => {
    if (vendor === "gemini") return 0; // included in Workspace subscription
    if (vendor === "google" && costData?.endpoints?.length > 0) {
      let extra = 0;
      for (const ep of costData.endpoints) {
        const isFlash = (ep.modelName || "").toLowerCase().includes("flash");
        if (isFlash) {
          const freeTotal = SUBSCRIPTION_LIMITS.google_vertex.freeTokensPerDay * periodDays;
          const billable = Math.max(0, (ep.totalTokens || 0) - freeTotal);
          if (billable > 0 && ep.totalTokens > 0) extra += ep.totalCost * (billable / ep.totalTokens);
        } else {
          extra += ep.totalCost || 0;
        }
      }
      return extra;
    }
    return totalCost; // azure, openai, claude — all pay-as-you-go
  }, [vendor, totalCost, costData, periodDays]);

  if (!vendor) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
        <DollarSign size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>
          No platform connected
        </h3>
        <p style={{ fontSize: 13 }}>
          Connect a platform in <strong>Settings &gt; Integrations</strong> to start tracking AI agent costs.
        </p>
      </div>
    );
  }

  const VendorIcon = meta.icon;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  border: period === opt.value ? "1px solid #6366f1" : "1px solid var(--ag-border)",
                  background: period === opt.value ? "#6366f112" : "#fff",
                  color: period === opt.value ? "#6366f1" : "var(--ag-text-secondary)",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: meta.color, fontWeight: 600 }}>
            <VendorIcon size={14} /> {meta.label}
          </div>
        </div>
        <button onClick={fetchCost} disabled={loading} className="ag_btn_primary">
          <RefreshCw size={13} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {loading ? "Fetching..." : "Refresh Costs"}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard
          label={vendor === "gemini" ? "Extra Cost" : "Extra Cost (pay-as-you-go)"}
          value={vendor === "gemini" && totalCost > 0 ? "Included" : formatCost(extraCost)}
          color={extraCost > 100 ? "#ef4444" : extraCost > 10 ? "#f59e0b" : "#22c55e"}
          sub={vendor === "gemini" ? "Included in Workspace subscription" : `${PERIOD_OPTIONS.find((p) => p.value === period)?.label} · excludes included usage`}
          icon={<DollarSign size={20} />}
        />
        {totalTokens > 0 && (
          <StatCard
            label="Total Tokens"
            value={formatTokens(totalTokens)}
            color="#6366f1"
            sub="input + output"
            icon={<Cpu size={20} />}
          />
        )}
        <StatCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
          color="#8b5cf6"
          sub={PERIOD_OPTIONS.find((p) => p.value === period)?.label}
          icon={<BarChart3 size={20} />}
        />
        {deployments.length > 0 && (
          <StatCard
            label={vendor === "microsoft" ? "Deployments" : vendor === "google" ? "Endpoints" : "Models"}
            value={deployments.length.toString()}
            color={meta.color}
            sub="active"
            icon={<VendorIcon size={20} />}
          />
        )}
      </div>

      {/* Subscription note */}
      {meta.subscriptionNote && (
        <div style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#1e40af", marginBottom: 16, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{meta.subscriptionNote}</span>
        </div>
      )}

      {/* Warnings (OpenAI admin key, Claude admin key, etc.) */}
      {warnings.length > 0 && (
        <div style={{ background: "#fef3c7", border: "1px solid #f59e0b33", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#78350f", marginBottom: 16 }}>
          {warnings.map((w, i) => <div key={i}>• {w}</div>)}
          {vendor === "openai" && (
            <div style={{ marginTop: 6, color: "#92400e" }}>
              Usage API requires an <strong>admin/org-level API key</strong>. Project keys will not return usage data.
            </div>
          )}
          {vendor === "claude" && (
            <div style={{ marginTop: 6, color: "#92400e" }}>
              Usage API requires an <strong>admin API key</strong> (<code>sk-ant-admin...</code>). Standard keys will not return usage data.
            </div>
          )}
        </div>
      )}

      {/* Cost breakdown */}
      <Section title={`${meta.label} Cost (${vendor === "gemini" ? "included" : formatCost(extraCost)})`}>
        {loading && !costData ? (
          <LoadingSpinner message={`Fetching ${meta.label} usage metrics...`} />
        ) : error ? (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#dc2626" }}>
            {error}
            <button onClick={fetchCost} className="ag_btn_secondary" style={{ marginLeft: 12, padding: "4px 10px", fontSize: 11 }}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        ) : vendor === "gemini" ? (
          /* Gemini: request-based table */
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--ag-bg-hover, #f9fafb)", textAlign: "left" }}>
                  <th style={{ padding: "10px 14px", fontWeight: 600, color: "var(--ag-text-secondary)" }}>API Method</th>
                  <th style={{ padding: "10px 14px", fontWeight: 600, color: "var(--ag-text-secondary)", textAlign: "right" }}>Requests</th>
                </tr>
              </thead>
              <tbody>
                {(costData?.methods || []).length === 0 ? (
                  <tr><td colSpan={2} style={{ padding: "16px 14px", color: "var(--ag-text-secondary)", textAlign: "center" }}>No API requests recorded in this period.</td></tr>
                ) : (
                  costData.methods.map((m) => (
                    <tr key={m.method} style={{ borderTop: "1px solid var(--ag-border)" }}>
                      <td style={{ padding: "10px 14px", color: "var(--ag-text-primary)" }}>{m.method}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right" }}>{m.requestCount.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Token-based vendors: standard breakdown table */
          <>
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
              <CostBreakdownTable deployments={deployments} vendor={costData?.vendor || meta.label} />
            </div>
            {vendor === "google" && extraCost < totalCost && totalCost > 0 && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#166534", marginTop: 12 }}>
                <strong>Free tier applied:</strong> Gemini Flash includes ~{formatTokens(SUBSCRIPTION_LIMITS.google_vertex.freeTokensPerDay * periodDays)} tokens free for this {periodDays}-day period.
                Only usage beyond the free tier ({formatCost(extraCost)}) is counted as extra cost.
              </div>
            )}
          </>
        )}

        {deployments.length > 0 && vendor !== "gemini" && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 10 }}>Cost by Model</h4>
            <ModelCostCards deployments={deployments} />
          </div>
        )}
      </Section>

      {/* Pricing reference — only for the connected vendor */}
      <Section title="Pricing Reference">
        {vendor === "microsoft" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#0078D4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Shield size={14} /> Azure OpenAI — Pay-as-you-go (per 1M tokens)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
            </div>
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#0369a1", marginBottom: 10 }}>
                Included in Your Microsoft Subscription
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11, color: "#0c4a6e" }}>
                <div style={{ padding: "6px 0", borderBottom: "1px solid #bae6fd40" }}>
                  <strong>M365 Copilot</strong> — $30/user/month add-on<br />
                  <span style={{ color: "#22c55e", fontWeight: 600 }}>No extra cost.</span> Built-in Copilot in Word, Excel, Teams, Outlook. Unlimited usage, no per-token charges.
                </div>
                <div style={{ padding: "6px 0", borderBottom: "1px solid #bae6fd40" }}>
                  <strong>Copilot Studio</strong> — $200/month standalone<br />
                  <span style={{ color: "#22c55e", fontWeight: 600 }}>25,000 messages/month included.</span> Overage: $0.01/message. Classic bots: $0.001/message.
                </div>
                <div style={{ padding: "6px 0" }}>
                  <strong>Power Virtual Agents (legacy)</strong><br />
                  <span style={{ color: "#22c55e", fontWeight: 600 }}>2,000 sessions/month</span> included with certain Power Platform licenses.
                </div>
              </div>
            </div>
          </div>
        )}
        {vendor === "openai" && (
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, maxWidth: 400 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#10a37f", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Bot size={14} /> OpenAI API — Pay-as-you-go (per 1M tokens)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { model: "GPT-4o", input: "$2.50", output: "$10.00" },
                { model: "GPT-4o-mini", input: "$0.15", output: "$0.60" },
                { model: "o1", input: "$15.00", output: "$60.00" },
                { model: "o1-mini", input: "$3.00", output: "$12.00" },
                { model: "o3-mini", input: "$1.10", output: "$4.40" },
                { model: "GPT-3.5-turbo", input: "$0.50", output: "$1.50" },
              ].map((r) => (
                <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                  <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {vendor === "claude" && (
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, maxWidth: 400 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#D4622A", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Bot size={14} /> Anthropic API — Pay-as-you-go (per 1M tokens)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { model: "Claude Opus 4", input: "$15.00", output: "$75.00" },
                { model: "Claude Sonnet 4.6", input: "$3.00", output: "$15.00" },
                { model: "Claude Haiku 4.5", input: "$0.80", output: "$4.00" },
                { model: "Claude 3.5 Sonnet", input: "$3.00", output: "$15.00" },
                { model: "Claude 3 Opus", input: "$15.00", output: "$75.00" },
              ].map((r) => (
                <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                  <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {vendor === "google" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#4285F4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <Cloud size={14} /> Vertex AI — Pay-as-you-go (per 1M tokens)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { model: "Gemini 2.0 Flash", input: "$0.10", output: "$0.40" },
                  { model: "Gemini 2.0 Pro", input: "$1.25", output: "$5.00" },
                  { model: "Gemini 1.5 Pro", input: "$1.25", output: "$5.00" },
                  { model: "Gemini 1.5 Flash", input: "$0.075", output: "$0.30" },
                  { model: "PaLM 2", input: "$0.50", output: "$1.50" },
                ].map((r) => (
                  <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                    <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                    <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#16a34a", marginBottom: 10 }}>
                Free Tier (No Extra Cost)
              </div>
              <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.7 }}>
                <strong>Gemini Flash</strong> — ~1M tokens/day, 15 requests/min<br />
                Usage within this limit is <strong>free</strong>. Only tokens beyond the daily limit are billed at pay-as-you-go rates.<br /><br />
                <strong>Gemini Pro / Ultra</strong> — pay-as-you-go from the first token.
              </div>
            </div>
          </div>
        )}
        {vendor === "gemini" && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0369a1", marginBottom: 8 }}>
              Gemini Enterprise — Included in Subscription
            </div>
            <div style={{ fontSize: 11, color: "#0c4a6e", lineHeight: 1.7 }}>
              Gemini for Google Workspace is included in <strong>Business Standard</strong>, <strong>Enterprise</strong>, and <strong>Education Plus</strong> licenses.
              There are no per-query or per-token charges for standard Gemini features (Gmail, Docs, Sheets, Meet, etc.).<br /><br />
              Request counts on this page are shown for <strong>visibility and governance</strong> only — they represent usage volume, not billable costs.
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 10 }}>
          Pricing is approximate and based on standard pay-as-you-go rates. Actual costs may vary based on enterprise agreements, committed-use discounts, and region.
        </div>
      </Section>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
const tdRight = { padding: "10px", textAlign: "right", fontFamily: "monospace", fontSize: 11 };
