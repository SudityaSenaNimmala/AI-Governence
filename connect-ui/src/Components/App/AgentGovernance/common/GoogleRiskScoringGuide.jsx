import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldAlert, MessageSquare } from "lucide-react";
import { Badge, riskColor as RISK_COLORS } from "./Badge";

// ─── Google Workspace Risk Score Guide & Simulator ──────────────────────────
// Mirrors the Microsoft RiskScoringGuide visual layout but uses signals,
// weights, data sources, and logic relevant to Google Workspace discovery
// (OAuth token audit, Vertex AI, Agent Builder, Gemini Gems, Chat, Apps Script).
//
// Score is 0–100 where LOWER = HIGHER RISK (same convention as the MS guide).

function RiskLevelBadge({ level }) {
  const color = RISK_COLORS[level] || "#6b7280";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700,
      background: `${color}15`, color, border: `1px solid ${color}33`,
    }}>
      <ShieldAlert size={10} />
      {level?.charAt(0).toUpperCase() + level?.slice(1)}
    </span>
  );
}

// ─── Signal catalog (mirrors MS "Risk Signals" table) ───────────────────────
const GOOGLE_RISK_SIGNALS = [
  {
    signal: "Sensitive OAuth scopes granted (gmail.*, drive, calendar, admin.directory.user)",
    weight: "Critical", impact: "-20",
    source: "Admin SDK Token Audit",
    how: "Checks OAuth token scopes against the dangerous-scope list (Gmail read/modify, Drive full, Calendar, Directory).",
  },
  {
    signal: "No assigned owner (orphaned agent)",
    weight: "Critical", impact: "-20",
    source: "Workspace Directory + Drive/Dataverse",
    how: "Resolves creator → Workspace user → admin.directory.user; flagged if suspended or deleted.",
  },
  {
    signal: "Externally-shared Chat space / bot",
    weight: "High", impact: "-15",
    source: "Google Chat API",
    how: "Detects externalUserAllowed=true on the space containing the bot — allows unmanaged external users.",
  },
  {
    signal: "Agent Builder app with data stores",
    weight: "High", impact: "-15",
    source: "Discovery Engine API",
    how: "Counts attached dataStoreIds — grounded AI on corporate corpora is flagged for potential PII/PHI exposure.",
  },
  {
    signal: "Stale agent (30+ days inactive)",
    weight: "High", impact: "-12",
    source: "Admin Reports + Cloud Logging",
    how: "Computes days since last invocation from reports/activity and Vertex/Agent Builder log entries.",
  },
  {
    signal: "Apps Script with HTTP triggers / external calls",
    weight: "Medium", impact: "-10",
    source: "Apps Script API + Drive",
    how: "Detects webapp / external-fetch deployments — potential data egress channel.",
  },
  {
    signal: "Expired renewal date",
    weight: "Medium", impact: "-10",
    source: "CloudFuze agent_registry",
    how: "Admin sets renewal date during governance review; triggers deduction when past due without re-certification.",
  },
  {
    signal: "Shared Gemini Gem (multi-user)",
    weight: "Medium", impact: "-10",
    source: "Google Drive API",
    how: "Flags custom Gems shared beyond the creator — instructions & data accessible to multiple users.",
  },
  {
    signal: "Sensitive keywords in name/description",
    weight: "Low", impact: "-5",
    source: "Agent metadata (Drive / Chat / Vertex)",
    how: "Scans for: password, secret, credential, PII, HIPAA, salary, HR, confidential, etc.",
  },
  {
    signal: "Multiple read scopes (Drive/Gmail/Calendar read-only)",
    weight: "Low", impact: "-5",
    source: "Admin SDK Token Audit",
    how: "Counts moderate read-level scopes across a single OAuth grant — broader read footprint.",
  },
  {
    signal: "No governance policy applied",
    weight: "Low", impact: "flag only",
    source: "CloudFuze",
    how: "Flags agents not covered by any CloudFuze governance policy (no score deduction).",
  },
];

// ─── Simulator toggles (mirrors MS "What-If Simulator") ─────────────────────
const SIM_TOGGLES = [
  { key: "sensitiveScopes",  label: "Sensitive OAuth scopes granted (gmail/drive/calendar)", weight: "CRITICAL -20", deduction: 20, signal: "Sensitive OAuth scopes" },
  { key: "orphaned",         label: "Agent owner is suspended or deleted",                    weight: "CRITICAL -20", deduction: 20, signal: "No assigned owner (orphaned)" },
  { key: "externalChat",     label: "Chat space/bot allows external users",                   weight: "HIGH -15",     deduction: 15, signal: "External Chat space / bot" },
  { key: "dataStore",        label: "Agent Builder app has connected data stores",            weight: "HIGH -15",     deduction: 15, signal: "Agent Builder w/ data stores" },
  { key: "stale",            label: "No activity in 30+ days",                                weight: "HIGH -12",     deduction: 12, signal: "Stale agent (30+ days)" },
  { key: "httpScript",       label: "Apps Script with HTTP/external calls",                   weight: "MED -10",      deduction: 10, signal: "Apps Script HTTP trigger" },
  { key: "expiredRenewal",   label: "Renewal date expired",                                   weight: "MED -10",      deduction: 10, signal: "Overdue for renewal" },
  { key: "sharedGem",        label: "Gemini Gem shared with multiple users",                  weight: "MED -10",      deduction: 10, signal: "Shared Gemini Gem" },
  { key: "sensitiveKw",      label: "Sensitive keywords in name/description",                 weight: "LOW -5",       deduction: 5,  signal: "Sensitive keywords detected" },
  { key: "multipleReads",    label: "Multiple read scopes (Drive/Gmail/Calendar read)",       weight: "LOW -5",       deduction: 5,  signal: "Multiple read scopes" },
];

export function GoogleRiskScoringGuide({ defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sim, setSim] = useState(
    Object.fromEntries(SIM_TOGGLES.map((t) => [t.key, false]))
  );

  // ─ Compute simulated score ─
  let score = 100;
  const factors = [];
  score -= 5; // base deduction for "low" base risk (matches MS guide)
  for (const t of SIM_TOGGLES) {
    if (sim[t.key]) {
      score -= t.deduction;
      factors.push({
        signal: t.signal,
        weight: t.weight.split(" ")[0].toLowerCase(),
        deduction: -t.deduction,
      });
    }
  }
  factors.push({ signal: "No governance policy applied", weight: "low", deduction: 0 });
  score = Math.max(0, Math.min(100, score));
  const simLevel =
    score <= 25 ? "critical" : score <= 50 ? "high" : score <= 75 ? "medium" : "low";

  return (
    <div style={{ marginTop: 16, background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", cursor: "pointer", borderBottom: expanded ? "1px solid var(--ag-border)" : "none" }}
      >
        {expanded ? <ChevronDown size={14} color="#4285F4" /> : <ChevronRight size={14} color="#999" />}
        <ShieldAlert size={16} color="#4285F4" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ag-text-primary)" }}>
          Google Workspace Risk Score Guide &amp; Simulator
        </span>
        <span style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginLeft: "auto" }}>
          Score 0&ndash;100 (lower = higher risk)
        </span>
      </div>

      {expanded && (
        <div style={{ padding: 16 }}>
          {/* Score bands */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            {[
              { level: "Low",      range: "76-100", color: "#22c55e", desc: "Healthy — within acceptable risk" },
              { level: "Medium",   range: "51-75",  color: "#3b82f6", desc: "Monitor — some risk signals present" },
              { level: "High",     range: "26-50",  color: "#f59e0b", desc: "Needs review — multiple risk factors" },
              { level: "Critical", range: "0-25",   color: "#ef4444", desc: "Immediate action — severe risk" },
            ].map((b) => (
              <div key={b.level} style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `1px solid ${b.color}33`, background: `${b.color}08` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: b.color }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{b.level}</span>
                  <span style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>({b.range})</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)" }}>{b.desc}</div>
              </div>
            ))}
          </div>

          {/* Risk signals table */}
          <div style={{ fontSize: 12, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--ag-text-primary)" }}>Risk Signals</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--ag-border)", background: "#f8f9fb" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Signal</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Weight</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Impact</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Data Source</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>How It Works</th>
                </tr>
              </thead>
              <tbody>
                {GOOGLE_RISK_SIGNALS.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                    <td style={{ padding: "5px 8px" }}>{r.signal}</td>
                    <td style={{ padding: "5px 8px" }}>
                      <Badge
                        text={r.weight}
                        color={
                          r.weight === "Critical" ? "#ef4444"
                          : r.weight === "High" ? "#f59e0b"
                          : r.weight === "Medium" ? "#3b82f6"
                          : r.weight === "Low" ? "#22c55e"
                          : "#6b7280"
                        }
                      />
                    </td>
                    <td style={{
                      padding: "5px 8px", fontWeight: 600,
                      color: r.impact.startsWith("+") ? "#22c55e"
                        : r.impact.startsWith("-") ? "#ef4444" : "#999",
                    }}>
                      {r.impact}
                    </td>
                    <td style={{ padding: "5px 8px", color: "var(--ag-text-secondary)", fontSize: 10 }}>{r.source}</td>
                    <td style={{ padding: "5px 8px", color: "var(--ag-text-secondary)", fontSize: 10, maxWidth: 280 }}>{r.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* What-If Simulator */}
          <div style={{ background: "#f8f9fb", borderRadius: 8, padding: 16, border: "1px solid var(--ag-border)" }}>
            <div style={{ fontWeight: 700, marginBottom: 12, color: "var(--ag-text-primary)", fontSize: 13 }}>
              What-If Simulator — Toggle risk conditions to see score impact
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {SIM_TOGGLES.map((opt) => (
                    <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={sim[opt.key]}
                        onChange={() => setSim((prev) => ({ ...prev, [opt.key]: !prev[opt.key] }))}
                        style={{ accentColor: "#4285F4" }}
                      />
                      <span>{opt.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "#ef4444", fontWeight: 600 }}>
                        {opt.weight}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Simulated score card */}
              <div style={{
                width: 200, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                padding: 16, background: "var(--ag-bg-card)",
                borderRadius: 10, border: "1px solid var(--ag-border)",
              }}>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 4 }}>Simulated Score</div>
                <div style={{ fontSize: 42, fontWeight: 800, color: RISK_COLORS[simLevel] || "#6b7280", lineHeight: 1 }}>
                  {score}
                </div>
                <RiskLevelBadge level={simLevel} />
                <div style={{ width: "100%", height: 8, borderRadius: 4, background: "#e5e7eb", marginTop: 12, overflow: "hidden" }}>
                  <div style={{
                    width: `${score}%`, height: "100%", borderRadius: 4,
                    background: RISK_COLORS[simLevel] || "#6b7280",
                    transition: "all 0.3s",
                  }} />
                </div>
              </div>
            </div>

            {/* Active deductions */}
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {factors.map((f, i) => (
                <span key={i} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: f.deduction > 0 ? "#22c55e15" : f.deduction < 0 ? "#ef444415" : "#f1f3f9",
                  color: f.deduction > 0 ? "#22c55e" : f.deduction < 0 ? "#ef4444" : "#999",
                  border: `1px solid ${f.deduction > 0 ? "#22c55e33" : f.deduction < 0 ? "#ef444433" : "var(--ag-border)"}`,
                }}>
                  {f.signal} ({f.deduction > 0 ? "+" : ""}{f.deduction})
                </span>
              ))}
            </div>
          </div>

          {/* How activity, scopes & renewal connect to risk */}
          <div style={{ background: "#e8f0fe", borderRadius: 8, padding: 14, border: "1px solid #c6dafe", marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#1a73e8", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <MessageSquare size={14} /> How OAuth Scopes, Activity &amp; Sharing Affect Risk
            </div>
            <div style={{ fontSize: 11, color: "#1a73e8", lineHeight: 1.7 }}>
              <strong>OAuth Token Audit:</strong> The Admin SDK returns every third-party app each user has granted access to.
              Tokens carrying scopes like <code>gmail.modify</code>, <code>drive</code>, or <code>admin.directory.user</code> trigger
              the <strong>"Sensitive OAuth scopes"</strong> signal and a <strong>-20 (Critical) deduction</strong>. This is the primary signal for shadow AI on Google Workspace.
              <br /><br />
              <strong>Activity &amp; Staleness:</strong> Invocation counts come from <em>Admin Reports</em> (audit / usage) and <em>Cloud Logging</em>.
              Agents with zero invocations in 30 days get a <strong>-12 (High)</strong> deduction; Agent Builder or Vertex agents with
              data-store attachments compound this because stale access still retains grounding corpora.
              <br /><br />
              <strong>Sharing &amp; External Exposure:</strong> Chat spaces with <code>externalUserAllowed=true</code> and Gemini Gems shared with
              multiple users add <strong>-15 (High)</strong> and <strong>-10 (Medium)</strong> respectively — unmanaged external exposure is
              the single largest uplift factor after sensitive scopes.
              <br /><br />
              <strong>Renewal Date:</strong> Admins set a renewal date during governance review. Once it passes without re-certification the
              <strong> "Overdue for renewal"</strong> signal triggers a <strong>-10 point deduction</strong>.
              <br /><br />
              <strong>Note:</strong> Risk scoring is based on <em>configuration posture</em> (scopes, sharing, ownership), not raw runtime behavior.
              Specific runtime actions (what files Gemini read in a prompt) are only visible when Cloud Logging or Drive audit events fire.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GoogleRiskScoringGuide;
