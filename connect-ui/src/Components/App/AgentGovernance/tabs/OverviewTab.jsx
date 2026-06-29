import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useGovernance, computeMetrics, SCOPE_LABELS } from "../AgentGovernanceContext";
import { StatCard } from "../common/StatCard";
import { Section } from "../common/Section";
import { Badge, riskColor } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { Shield, AlertTriangle, Users, TrendingDown, Clock } from "lucide-react";

export function OverviewTab() {
  const { state } = useGovernance();
  const result = state.discoveryResult;
  const metrics = computeMetrics(result, state.selectedScope, state.selectedVendor);
  const displayTenant =
    state.selectedVendor === "google"
      ? result?.tenants?.google
      : state.selectedVendor === "microsoft"
      ? result?.tenants?.microsoft
      : result?.tenant;

  if (state.discoveryStatus === "idle") {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
        <Shield size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>
          No scan data yet
        </h3>
        <p style={{ fontSize: 13 }}>
          Click <strong>"Run Scan"</strong> in the header to discover AI agents across your M365 tenant, SharePoint, and Azure.
        </p>
      </div>
    );
  }

  if (state.discoveryStatus === "loading") {
    return <LoadingSpinner message={state.discoveryProgress} />;
  }

  if (state.discoveryStatus === "error") {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "#ef4444" }}>
        <AlertTriangle size={40} style={{ marginBottom: 12 }} />
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Discovery Failed</h3>
        <p style={{ fontSize: 12, color: "var(--ag-text-secondary)", maxWidth: 400, margin: "0 auto" }}>
          {state.error}
        </p>
        <p style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 12 }}>
          Check that your app registration has the required permissions (Application.Read.All, AuditLog.Read.All, etc.)
          and that admin consent has been granted.
        </p>
      </div>
    );
  }

  const riskData = [
    { name: "Critical", value: metrics.riskDistribution.critical, color: "#ef4444" },
    { name: "High", value: metrics.riskDistribution.high, color: "#f59e0b" },
    { name: "Medium", value: metrics.riskDistribution.medium, color: "#3b82f6" },
    { name: "Low", value: metrics.riskDistribution.low, color: "#22c55e" },
  ].filter((d) => d.value > 0);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <StatCard
          label="AI Agents Discovered"
          value={metrics.totalAgents}
          color="#6366f1"
          sub={`across ${displayTenant?.domain || result?.tenant?.domain || ""}`}
          icon={<Shield size={20} />}
        />
        <StatCard
          label="Compliance Score"
          value={`${metrics.complianceScore}%`}
          color={metrics.complianceScore > 70 ? "#22c55e" : metrics.complianceScore > 40 ? "#f59e0b" : "#ef4444"}
          sub="overall tenant compliance"
          icon={<TrendingDown size={20} />}
        />
        <StatCard
          label="High/Critical Risk"
          value={metrics.highRiskCount}
          color="#ef4444"
          sub="need immediate review"
          icon={<AlertTriangle size={20} />}
        />
        <StatCard
          label="Stale Agents"
          value={metrics.staleCount}
          color="#f59e0b"
          sub="30+ days inactive"
          icon={<Clock size={20} />}
        />
        <StatCard
          label="Total Users"
          value={result?.totalUsers || 0}
          sub="in tenant"
          icon={<Users size={20} />}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Section title="Risk Distribution" style={{ flex: 1 }}>
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {riskData.length > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={riskData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} dataKey="value" stroke="none">
                      {riskData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 6, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  {riskData.map((d) => (
                    <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 3, background: d.color }} />
                      <span style={{ fontSize: 13, color: "var(--ag-text-secondary)" }}>
                        {d.name}: <strong style={{ color: "var(--ag-text-primary)", fontSize: 14 }}>{d.value}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: 20, color: "var(--ag-text-secondary)", fontSize: 13 }}>
                No agents discovered
              </div>
            )}
          </div>
        </Section>

        <Section title="Live Activity Feed" style={{ flex: 1 }}>
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden", flex: 1 }}>
            {metrics.recentEvents.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "var(--ag-text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid var(--ag-border)" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "var(--ag-text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid var(--ag-border)", width: 80 }}>Score</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 600, color: "var(--ag-text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid var(--ag-border)", width: 110 }}>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.recentEvents.slice(0, 5).map((evt, idx, arr) => {
                    const scoreMatch = evt.description?.match(/score:\s*(\d+)/i);
                    const score = scoreMatch ? scoreMatch[1] : "—";
                    const isLast = idx === arr.length - 1;
                    return (
                      <tr key={evt.id}>
                        <td style={{ padding: "10px 12px", color: "var(--ag-text-primary)", borderBottom: isLast ? "none" : "1px solid var(--ag-border)" }}>
                          {evt.agentName || evt.description}
                        </td>
                        <td style={{ padding: "10px 12px", color: "var(--ag-text-primary)", fontWeight: 600, borderBottom: isLast ? "none" : "1px solid var(--ag-border)" }}>
                          {score}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: isLast ? "none" : "1px solid var(--ag-border)" }}>
                          <Badge text={evt.severity} color={riskColor[evt.severity]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: "center", padding: 20, color: "var(--ag-text-secondary)", fontSize: 13 }}>
                No events yet — run a discovery scan
              </div>
            )}
          </div>
        </Section>
      </div>

      {Object.keys(metrics.platformDistribution).length > 0 && (
        <Section title="Agent Platforms">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {Object.entries(metrics.platformDistribution).map(([platform, count]) => (
              <div
                key={platform}
                style={{
                  background: "var(--ag-bg-card)",
                  border: "1px solid var(--ag-border)",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 700, color: "#6366f1", fontSize: 13 }}>
                  {SCOPE_LABELS[platform] || platform.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </div>
                <div style={{ color: "var(--ag-text-secondary)", marginTop: 2 }}>{count} agent{count !== 1 ? "s" : ""}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
