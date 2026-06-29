import { useState, useEffect } from "react";
import {
  DollarSign, TrendingUp, Cpu, Zap, RefreshCw, Cloud, Shield,
  ArrowUpRight, ArrowDownRight, BarChart3, Clock, Filter, Bot, Sparkles
} from "lucide-react";
import { useAgentAuth, useGovernance } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";
import { Badge } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";

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
                    display: "inline-flex", alignItems: "center",
                    background: `${color}15`, color, padding: "2px 8px",
                    borderRadius: 4, fontWeight: 600, fontSize: 11,
                  }}>
                    {dep.modelName}
                  </span>
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
  const [azureData, setAzureData] = useState(null);
  const [googleData, setGoogleData] = useState(null);
  const [openaiData, setOpenaiData] = useState(null);
  const [claudeData, setClaudeData] = useState(null);
  const [azureLoading, setAzureLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [openaiLoading, setOpenaiLoading] = useState(false);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [azureError, setAzureError] = useState(null);
  const [googleError, setGoogleError] = useState(null);
  const [openaiError, setOpenaiError] = useState(null);
  const [claudeError, setClaudeError] = useState(null);
  const [geminiData, setGeminiData] = useState(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState(null);

  const periodDays = PERIOD_OPTIONS.find((p) => p.value === period)?.days || 7;

  const fetchAzure = async () => {
    if (!oauthKeyId) return;
    setAzureLoading(true);
    setAzureError(null);
    try {
      const data = await agentGovernanceApi.fetchAzureCost(oauthKeyId, period);
      setAzureData(data);
    } catch (err) {
      setAzureError(err.message || "Failed to fetch Azure cost data");
    } finally {
      setAzureLoading(false);
    }
  };

  const fetchGoogle = async () => {
    if (!googleKeyId) return;
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      const data = await agentGovernanceApi.fetchGoogleCost(googleKeyId, periodDays);
      setGoogleData(data);
    } catch (err) {
      setGoogleError(err.message || "Failed to fetch Google cost data");
    } finally {
      setGoogleLoading(false);
    }
  };

  const fetchOpenAI = async () => {
    if (!openaiKeyId) return;
    setOpenaiLoading(true);
    setOpenaiError(null);
    try {
      const data = await agentGovernanceApi.fetchOpenAICost(openaiKeyId, period);
      setOpenaiData(data);
    } catch (err) {
      setOpenaiError(err.message || "Failed to fetch OpenAI cost data");
    } finally {
      setOpenaiLoading(false);
    }
  };

  const fetchClaude = async () => {
    if (!claudeKeyId) return;
    setClaudeLoading(true);
    setClaudeError(null);
    try {
      const data = await agentGovernanceApi.fetchClaudeUsage(claudeKeyId, period);
      setClaudeData(data);
    } catch (err) {
      setClaudeError(err.message || "Failed to fetch Claude cost data");
    } finally {
      setClaudeLoading(false);
    }
  };

  const fetchGemini = async () => {
    if (!geminiEnterpriseKeyId) return;
    setGeminiLoading(true);
    setGeminiError(null);
    try {
      const data = await agentGovernanceApi.fetchGeminiEnterpriseCost(geminiEnterpriseKeyId, periodDays);
      setGeminiData(data);
    } catch (err) {
      setGeminiError(err.message || "Failed to fetch Gemini Enterprise cost data");
    } finally {
      setGeminiLoading(false);
    }
  };

  const fetchAll = () => {
    fetchAzure();
    fetchGoogle();
    fetchOpenAI();
    fetchClaude();
    fetchGemini();
  };

  useEffect(() => { if (scanActive) fetchAll(); }, [scanActive, period, oauthKeyId, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId, refreshKey]);

  const isLoading = azureLoading || googleLoading || openaiLoading || claudeLoading || geminiLoading;
  const azureCost = azureData?.summary?.totalCost || 0;
  const googleCost = googleData?.summary?.totalCost || 0;
  const openaiCost = openaiData?.summary?.totalCost || 0;
  const claudeCost = claudeData?.summary?.totalCost || 0;
  const geminiCost = geminiData?.estimatedTotalCost || 0;
  const totalCost = azureCost + googleCost + openaiCost + claudeCost + geminiCost;
  const totalTokens = (azureData?.summary?.totalTokens || 0) + (googleData?.summary?.totalTokens || 0) + (openaiData?.summary?.totalTokens || 0) + (claudeData?.summary?.totalTokens || 0);
  const totalRequests = (azureData?.summary?.totalRequests || 0) + (googleData?.summary?.totalPredictions || 0) + (openaiData?.summary?.totalRequests || 0) + (claudeData?.summary?.totalRequests || 0) + (geminiData?.totalRequests || 0);

  if (!isAuthenticated && !googleKeyId && !openaiKeyId && !claudeKeyId && !geminiEnterpriseKeyId) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
        <DollarSign size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>
          No platforms connected
        </h3>
        <p style={{ fontSize: 13 }}>
          Connect Microsoft 365 or Google Cloud to track AI agent costs and token usage.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
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
        <button onClick={fetchAll} disabled={isLoading} className="ag_btn_primary">
          <RefreshCw size={13} style={isLoading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {isLoading ? "Fetching..." : "Refresh Costs"}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Total Cost"
          value={formatCost(totalCost)}
          color={totalCost > 100 ? "#ef4444" : totalCost > 10 ? "#f59e0b" : "#22c55e"}
          sub={PERIOD_OPTIONS.find((p) => p.value === period)?.label}
          icon={<DollarSign size={20} />}
        />
        {isAuthenticated && (
          <StatCard
            label="Azure OpenAI Cost"
            value={formatCost(azureCost)}
            color="#0078D4"
            sub={`${azureData?.deployments?.length || 0} deployment(s)`}
            icon={<Shield size={20} />}
          />
        )}
        {googleKeyId && (
          <StatCard
            label="Google Vertex AI Cost"
            value={formatCost(googleCost)}
            color="#4285F4"
            sub={`${googleData?.endpoints?.length || 0} endpoint(s)`}
            icon={<Cloud size={20} />}
          />
        )}
        {openaiKeyId && (
          <StatCard
            label="ChatGPT / OpenAI Cost"
            value={formatCost(openaiCost)}
            color="#10a37f"
            sub={`${openaiData?.deployments?.length || 0} model(s)`}
            icon={<Bot size={20} />}
          />
        )}
        {claudeKeyId && (
          <StatCard
            label="Claude / Anthropic Cost"
            value={formatCost(claudeCost)}
            color="#D4622A"
            sub={`${claudeData?.deployments?.length || 0} model(s)`}
            icon={<Bot size={20} />}
          />
        )}
        {geminiEnterpriseKeyId && (
          <StatCard
            label="Gemini Enterprise Cost (est.)"
            value={formatCost(geminiCost)}
            color="#886FBF"
            sub={`${(geminiData?.totalRequests || 0).toLocaleString()} request(s) · est. @ $${geminiData?.ratePer1kRequests ?? 2}/1k`}
            icon={<Sparkles size={20} />}
          />
        )}
        <StatCard
          label="Total Tokens"
          value={formatTokens(totalTokens)}
          color="#6366f1"
          sub="input + output"
          icon={<Cpu size={20} />}
        />
        <StatCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
          color="#8b5cf6"
          sub={PERIOD_OPTIONS.find((p) => p.value === period)?.label}
          icon={<BarChart3 size={20} />}
        />
      </div>

      {/* Azure OpenAI Cost */}
      {isAuthenticated && (
        <Section title={`Microsoft / Azure OpenAI Cost (${formatCost(azureCost)})`}>
          {azureLoading && !azureData ? (
            <LoadingSpinner message="Fetching Azure OpenAI usage metrics from Azure Monitor..." />
          ) : azureError ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#dc2626" }}>
              {azureError}
              <button onClick={fetchAzure} className="ag_btn_secondary" style={{ marginLeft: 12, padding: "4px 10px", fontSize: 11 }}>
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
              <CostBreakdownTable deployments={azureData?.deployments} vendor="Microsoft" />
            </div>
          )}

          {azureData?.deployments?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 10 }}>Cost by Model</h4>
              <ModelCostCards deployments={azureData.deployments} />
            </div>
          )}
        </Section>
      )}

      {/* Google Vertex AI Cost */}
      {googleKeyId && (
        <Section title={`Google / Vertex AI Cost (${formatCost(googleCost)})`}>
          {googleLoading && !googleData ? (
            <LoadingSpinner message="Fetching Vertex AI usage metrics from Cloud Monitoring..." />
          ) : googleError ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#dc2626" }}>
              {googleError}
              <button onClick={fetchGoogle} className="ag_btn_secondary" style={{ marginLeft: 12, padding: "4px 10px", fontSize: 11 }}>
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
              <CostBreakdownTable deployments={googleData?.endpoints} vendor="Google" />
            </div>
          )}

          {googleData?.endpoints?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 10 }}>Cost by Model</h4>
              <ModelCostCards deployments={googleData.endpoints} />
            </div>
          )}
        </Section>
      )}

      {/* ChatGPT / OpenAI Direct Cost */}
      {openaiKeyId && (
        <Section title={`ChatGPT / OpenAI Direct Cost (${formatCost(openaiCost)})`}>
          {openaiLoading && !openaiData ? (
            <LoadingSpinner message="Fetching OpenAI usage metrics from organization usage API..." />
          ) : openaiError ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#dc2626" }}>
              {openaiError}
              <button onClick={fetchOpenAI} className="ag_btn_secondary" style={{ marginLeft: 12, padding: "4px 10px", fontSize: 11 }}>
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <>
              {openaiData?.warnings?.length > 0 && (
                <div style={{ background: "#fef3c7", border: "1px solid #f59e0b33", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#78350f", marginBottom: 12 }}>
                  {openaiData.warnings.map((w, i) => <div key={i}>• {w}</div>)}
                  <div style={{ marginTop: 6, color: "#92400e" }}>
                    Usage API requires an <strong>admin/org-level API key</strong>. Project keys will not return usage data.
                  </div>
                </div>
              )}
              <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
                <CostBreakdownTable deployments={openaiData?.deployments} vendor="OpenAI" />
              </div>
            </>
          )}
          {openaiData?.deployments?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 10 }}>Cost by Model</h4>
              <ModelCostCards deployments={openaiData.deployments} />
            </div>
          )}
        </Section>
      )}

      {/* Claude / Anthropic Cost */}
      {claudeKeyId && (
        <Section title={`Claude / Anthropic Cost (${formatCost(claudeCost)})`}>
          {claudeLoading && !claudeData ? (
            <LoadingSpinner message="Fetching Claude usage from Anthropic admin API..." />
          ) : claudeError ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#dc2626" }}>
              {claudeError}
              <button onClick={fetchClaude} className="ag_btn_secondary" style={{ marginLeft: 12, padding: "4px 10px", fontSize: 11 }}>
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <>
              {claudeData?.warnings?.length > 0 && (
                <div style={{ background: "#fef3c7", border: "1px solid #f59e0b33", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#78350f", marginBottom: 12 }}>
                  {claudeData.warnings.map((w, i) => <div key={i}>• {w}</div>)}
                  <div style={{ marginTop: 6, color: "#92400e" }}>
                    Usage API requires an <strong>admin API key</strong> (<code>sk-ant-admin...</code>). Standard keys will not return usage data.
                  </div>
                </div>
              )}
              <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
                <CostBreakdownTable deployments={claudeData?.deployments} vendor="Claude" />
              </div>
            </>
          )}
          {claudeData?.deployments?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 10 }}>Cost by Model</h4>
              <ModelCostCards deployments={claudeData.deployments} />
            </div>
          )}
        </Section>
      )}

      {/* Gemini Enterprise Cost */}
      {geminiEnterpriseKeyId && (
        <Section title={`Gemini Enterprise Cost — est. (${formatCost(geminiCost)})`}>
          {geminiLoading && !geminiData ? (
            <LoadingSpinner message="Fetching Discovery Engine usage from Cloud Monitoring..." />
          ) : geminiError ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", fontSize: 12, color: "#dc2626" }}>
              {geminiError}
              <button onClick={fetchGemini} className="ag_btn_secondary" style={{ marginLeft: 12, padding: "4px 10px", fontSize: 11 }}>
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : (
            <>
              <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#5b21b6", marginBottom: 12 }}>
                Request counts are <strong>real</strong> (Cloud Monitoring · Discovery Engine API). Cost is an
                <strong> estimate</strong> at ${geminiData?.ratePer1kRequests ?? 2} per 1,000 requests over {geminiData?.period || `P${periodDays}D`}.
              </div>
              <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--ag-bg-hover, #f9fafb)", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "var(--ag-text-secondary)" }}>API Method</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "var(--ag-text-secondary)", textAlign: "right" }}>Requests</th>
                      <th style={{ padding: "10px 14px", fontWeight: 600, color: "var(--ag-text-secondary)", textAlign: "right" }}>Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(geminiData?.methods || []).length === 0 ? (
                      <tr><td colSpan={3} style={{ padding: "16px 14px", color: "var(--ag-text-secondary)", textAlign: "center" }}>No Discovery Engine API requests recorded in this period.</td></tr>
                    ) : (
                      geminiData.methods.map((m) => (
                        <tr key={m.method} style={{ borderTop: "1px solid var(--ag-border)" }}>
                          <td style={{ padding: "10px 14px", color: "var(--ag-text-primary)" }}>{m.method}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right" }}>{m.requestCount.toLocaleString()}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right" }}>{formatCost(m.estimatedCost)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

      {/* Pricing reference */}
      <Section title="Pricing Reference">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#10a37f", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Bot size={14} /> ChatGPT / OpenAI (per 1M tokens)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { model: "GPT-4o",       input: "$2.50",  output: "$10.00" },
                { model: "GPT-4o-mini",  input: "$0.15",  output: "$0.60"  },
                { model: "o1",           input: "$15.00", output: "$60.00" },
                { model: "o1-mini",      input: "$3.00",  output: "$12.00" },
                { model: "o3-mini",      input: "$1.10",  output: "$4.40"  },
                { model: "GPT-3.5-turbo",input: "$0.50",  output: "$1.50"  },
              ].map((r) => (
                <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                  <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0078D4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Shield size={14} /> Azure OpenAI (per 1M tokens)
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
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#D4622A", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Bot size={14} /> Claude / Anthropic (per 1M tokens)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { model: "Claude Opus 4.7",   input: "$15.00", output: "$75.00" },
                { model: "Claude Sonnet 4.6", input: "$3.00",  output: "$15.00" },
                { model: "Claude Haiku 4.5",  input: "$0.80",  output: "$4.00"  },
                { model: "Claude 3.5 Sonnet", input: "$3.00",  output: "$15.00" },
                { model: "Claude 3.5 Haiku",  input: "$0.80",  output: "$4.00"  },
                { model: "Claude 3 Opus",     input: "$15.00", output: "$75.00" },
              ].map((r) => (
                <div key={r.model} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                  <span style={{ fontWeight: 500, color: getModelColor(r.model) }}>{r.model}</span>
                  <span style={{ color: "#666" }}>{r.input} in / {r.output} out</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#4285F4", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Cloud size={14} /> Google Vertex AI (per 1M tokens)
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
        </div>
        <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 10 }}>
          Pricing is approximate and based on standard pay-as-you-go rates. Actual costs may vary based on your enterprise agreements, committed-use discounts, and region.
        </div>
      </Section>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
const tdRight = { padding: "10px", textAlign: "right", fontFamily: "monospace", fontSize: 11 };
