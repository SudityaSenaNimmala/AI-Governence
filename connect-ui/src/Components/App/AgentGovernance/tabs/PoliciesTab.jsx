import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Plus, Play, Trash2, AlertTriangle, CheckCircle, Clock, Edit2 } from "lucide-react";
import { useGovernance } from "../AgentGovernanceContext";
import { Section } from "../common/Section";
import { Badge } from "../common/Badge";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { DEMO_POLICIES } from "../demoData";

const severityColor = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#22c55e",
};

const statusIcon = {
  active: <CheckCircle size={14} color="#22c55e" />,
  draft: <Edit2 size={14} color="#6b7280" />,
  disabled: <Clock size={14} color="#6b7280" />,
};

const CONDITION_FIELDS = [
  { value: "risk_score", label: "Risk Score (0-100)" },
  { value: "risk_level", label: "Risk Level" },
  { value: "is_orphaned", label: "Is Orphaned" },
  { value: "days_since_last_activity", label: "Days Since Last Activity" },
  { value: "has_http_connector", label: "Has HTTP Connector" },
  { value: "has_dangerous_permissions", label: "Has Dangerous Permissions" },
  { value: "consent_type", label: "Consent Type" },
  { value: "lifecycle_status", label: "Lifecycle Status" },
  { value: "platform", label: "Platform" },
  { value: "connector_count", label: "Connector Count" },
  { value: "permission_count", label: "Permission Count" },
  { value: "total_invocations", label: "Total Invocations" },
  { value: "unique_users", label: "Unique Users" },
];

const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "is_true", label: "is true" },
  { value: "is_false", label: "is false" },
  { value: "contains", label: "contains" },
];

const ACTION_TYPES = [
  { value: "flag", label: "Flag for Review" },
  { value: "notify", label: "Notify Owner/Admin" },
  { value: "escalate", label: "Escalate to Admin" },
  { value: "suspend", label: "Suspend Agent" },
  { value: "archive", label: "Archive Agent" },
];

export function PoliciesTab() {
  const { state } = useGovernance();
  const scanActive = state.discoveryStatus === "loading" || state.discoveryStatus === "success";
  const [policies, setPolicies] = useState(DEMO_POLICIES);
  const [loading, setLoading] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formType, setFormType] = useState("lifecycle");
  const [formSeverity, setFormSeverity] = useState("medium");
  const [formConditionField, setFormConditionField] = useState("days_since_last_activity");
  const [formConditionOp, setFormConditionOp] = useState("greater_than");
  const [formConditionValue, setFormConditionValue] = useState("30");
  const [formAction, setFormAction] = useState("flag");

  const loadPolicies = useCallback(async () => {
    try {
      const data = await agentGovernanceApi.listPolicies();
      setPolicies(data);
    } catch (e) {
      console.error("Failed to load policies:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (scanActive) loadPolicies(); }, [scanActive, loadPolicies, state.refreshKey]);

  const handleSeedTemplates = async () => {
    setSeeding(true);
    try {
      const result = await agentGovernanceApi.seedPolicyTemplates();
      if (result.created > 0) await loadPolicies();
    } catch (e) {
      console.error("Failed to seed templates:", e);
    } finally {
      setSeeding(false);
    }
  };

  const handleCreatePolicy = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    let parsedValue = formConditionValue;
    if (formConditionOp === "is_true" || formConditionOp === "is_false") {
      parsedValue = true;
    } else if (!isNaN(Number(formConditionValue))) {
      parsedValue = Number(formConditionValue);
    }
    try {
      await agentGovernanceApi.createPolicy({
        name: formName.trim(),
        description: formDescription.trim(),
        type: formType,
        severity: formSeverity,
        status: "active",
        conditions: [{ field: formConditionField, operator: formConditionOp, value: parsedValue }],
        actions: [{ type: formAction }],
        scope: { type: "all" },
      });
      setShowCreateForm(false);
      setFormName("");
      setFormDescription("");
      await loadPolicies();
    } catch (e) {
      console.error("Failed to create policy:", e);
    }
  };

  const handleDeletePolicy = async (id) => {
    try {
      await agentGovernanceApi.deletePolicy(id);
      setPolicies((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error("Failed to delete policy:", e);
    }
  };

  const handleToggleStatus = async (policy) => {
    const newStatus = policy.status === "active" ? "disabled" : "active";
    try {
      await agentGovernanceApi.updatePolicy(policy.id, { status: newStatus });
      setPolicies((prev) => prev.map((p) => (p.id === policy.id ? { ...p, status: newStatus } : p)));
    } catch (e) {
      console.error("Failed to toggle policy:", e);
    }
  };

  const handleEvaluate = async () => {
    if (!state.discoveryResult?.agents.length) return;
    setEvaluating(true);
    try {
      const result = await agentGovernanceApi.evaluatePolicies(state.discoveryResult.agents);
      setEvaluationResult(result);
    } catch (e) {
      console.error("Failed to evaluate policies:", e);
    } finally {
      setEvaluating(false);
    }
  };

  const activePolicies = policies.filter((p) => p.status === "active").length;
  const hasAgents = !!state.discoveryResult?.agents.length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={() => setShowCreateForm(!showCreateForm)} style={btnPrimary}><Plus size={14} /> Create Policy</button>
        <button onClick={handleEvaluate} disabled={evaluating || !hasAgents} style={{ ...btnPrimary, background: hasAgents ? "#22c55e" : "#999" }}>
          <Play size={14} /> {evaluating ? "Evaluating..." : "Run Policy Check"}
        </button>
        {!hasAgents && <span style={{ fontSize: 11, color: "#999", alignSelf: "center" }}>Run discovery scan first to evaluate policies</span>}
      </div>

      {showCreateForm && (
        <Section title="Create Custom Policy">
          <form onSubmit={handleCreatePolicy} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={fieldLabel}>Policy Name</label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g., Stale Agent Cleanup" style={fieldInput} required />
              </div>
              <div>
                <label style={fieldLabel}>Type</label>
                <select value={formType} onChange={(e) => setFormType(e.target.value)} style={fieldInput}>
                  <option value="lifecycle">Lifecycle</option>
                  <option value="risk">Risk</option>
                  <option value="connector">Connector</option>
                  <option value="orphan">Orphan</option>
                  <option value="stale">Stale</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Description</label>
              <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="What does this policy enforce?" style={fieldInput} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={fieldLabel}>Condition: IF</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select value={formConditionField} onChange={(e) => setFormConditionField(e.target.value)} style={{ ...fieldInput, flex: 2 }}>
                  {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select value={formConditionOp} onChange={(e) => setFormConditionOp(e.target.value)} style={{ ...fieldInput, flex: 1 }}>
                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {formConditionOp !== "is_true" && formConditionOp !== "is_false" && (
                  <input type="text" value={formConditionValue} onChange={(e) => setFormConditionValue(e.target.value)} placeholder="Value" style={{ ...fieldInput, flex: 1 }} />
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={fieldLabel}>THEN (Action)</label>
                <select value={formAction} onChange={(e) => setFormAction(e.target.value)} style={fieldInput}>
                  {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Severity</label>
                <select value={formSeverity} onChange={(e) => setFormSeverity(e.target.value)} style={fieldInput}>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" style={btnPrimary}>Create Policy</button>
              <button type="button" onClick={() => setShowCreateForm(false)} style={btnSecondary}>Cancel</button>
            </div>
          </form>
        </Section>
      )}

      {evaluationResult && (
        <Section title={`Policy Evaluation Results (${evaluationResult.totalViolations} violations)`}>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {["critical", "high", "medium", "low"].map((sev) => (
              <div key={sev} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
                <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{sev.charAt(0).toUpperCase() + sev.slice(1)}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: severityColor[sev] }}>{evaluationResult.bySeverity[sev]}</div>
              </div>
            ))}
          </div>
          {evaluationResult.violations.length > 0 && (
            <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                    <th style={thStyle}>Severity</th>
                    <th style={thStyle}>Policy</th>
                    <th style={thStyle}>Agent</th>
                    <th style={thStyle}>Condition</th>
                    <th style={thStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluationResult.violations.slice(0, 50).map((v, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                      <td style={tdStyle}><Badge text={v.severity} color={severityColor[v.severity] || "#6b7280"} /></td>
                      <td style={tdStyle}><span style={{ fontWeight: 600 }}>{v.policyName}</span></td>
                      <td style={tdStyle}>{v.agentName}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 10 }}>{v.conditionTriggered}</td>
                      <td style={tdStyle}><Badge text={v.actionRecommended} color="#6366f1" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {evaluationResult.violations.length === 0 && (
            <div style={{ textAlign: "center", padding: 30, color: "#22c55e", fontSize: 13 }}>
              <CheckCircle size={32} style={{ marginBottom: 8 }} />
              <div style={{ fontWeight: 600 }}>All agents are compliant!</div>
              <div style={{ color: "#999", marginTop: 4, fontSize: 12 }}>No policy violations detected across {evaluationResult.totalAgents} agents.</div>
            </div>
          )}
        </Section>
      )}

      <Section title={`Governance Policies (${policies.length} total, ${activePolicies} active)`}>
        {loading && policies.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading policies...</div>
        ) : policies.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <ShieldCheck size={40} style={{ color: "#999", marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: "#333", marginBottom: 8 }}>No policies configured</div>
            <div style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>Click <strong>"Create Policy"</strong> to add a custom governance policy.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {policies.map((p) => (
              <div key={p.id} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 16, opacity: p.status === "disabled" ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {statusIcon[p.status] || statusIcon.draft}
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Badge text={p.severity} color={severityColor[p.severity] || "#6b7280"} />
                    <Badge text={p.type} color="#6366f1" />
                    <button onClick={() => handleToggleStatus(p)} style={{ ...btnSmall, color: p.status === "active" ? "#22c55e" : "#999" }}>{p.status === "active" ? "Active" : "Disabled"}</button>
                    <button onClick={() => handleDeletePolicy(p.id)} style={{ ...btnSmall, color: "#ef4444" }}><Trash2 size={12} /></button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginTop: 8, lineHeight: 1.6 }}>{p.description}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

    </div>
  );
}

const btnPrimary = { display: "flex", alignItems: "center", gap: 5, background: "#6366f1", color: "#fff", padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit" };
const btnSecondary = { display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "1px solid var(--ag-border)", color: "#666", padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" };
const btnSmall = { display: "flex", alignItems: "center", gap: 3, background: "transparent", border: "none", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" };
const fieldLabel = { display: "block", fontSize: 11, fontWeight: 500, color: "#666", marginBottom: 4 };
const fieldInput = { width: "100%", background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#333", outline: "none", fontFamily: "inherit" };
const thStyle = { textAlign: "left", padding: "8px 12px", color: "#666", fontWeight: 600, fontSize: 11 };
const tdStyle = { padding: "8px 12px" };
