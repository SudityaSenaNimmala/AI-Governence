import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Plus, Play, Trash2, AlertTriangle, CheckCircle, Clock, Edit2 } from "lucide-react";
import { useGovernance } from "../AgentGovernanceContext";
import { Section } from "../common/Section";
import { Badge } from "../common/Badge";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";

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

/**
 * Result of a single-policy dry run, shown inside that policy's card.
 *
 * Leads with the green "nothing changed" line. A panel that appears after
 * clicking a button next to Active/Disabled and lists agents by name reads like
 * something happened; it must say plainly that nothing did — especially for a
 * policy whose action is `suspend`.
 *
 * "already flagged" is broken out because a raw total misleads: 12 hits sounds
 * alarming when 9 are violations you have already seen and triaged.
 */
function PolicySimResult({ res, onClose }) {
  if (res.error) {
    return (
      <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12, color: "#b91c1c" }}>
        <AlertTriangle size={12} /> {res.error}
        <button onClick={onClose} style={{ float: "right", border: "none", background: "none", cursor: "pointer", color: "#b91c1c" }}>×</button>
      </div>
    );
  }
  const n = res.would_flag || 0;
  const tone = n === 0 ? "#16a34a" : res.severity === "critical" ? "#b91c1c" : "#b45309";
  return (
    <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", fontSize: 11.5, color: "#166534" }}>
        <ShieldCheck size={12} />
        <span><strong>Simulation only — nothing was changed.</strong> No violations recorded, no actions run.</span>
        <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: "#166534", fontSize: 15, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, marginBottom: n ? 8 : 0 }}>
          Would flag <strong style={{ color: tone, fontSize: 16 }}>{n}</strong> of {res.agents_evaluated} agents
          {n > 0 && <> — action: <strong>{(res.actions || []).join(", ") || "flag"}</strong></>}
          {res.already_open > 0 && <span style={{ color: "#6b7280" }}> · {res.newly_flagged} new, {res.already_open} already flagged</span>}
        </div>

        {n === 0 && <div style={{ fontSize: 11.5, color: "#6b7280" }}>No agent currently meets this policy&apos;s conditions.</div>}

        {n > 0 && (
          <div style={{ maxHeight: 170, overflowY: "auto", border: "1px solid #f3f4f6", borderRadius: 6 }}>
            {res.matches.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "5px 10px", fontSize: 11.5, borderBottom: i < res.matches.length - 1 ? "1px solid #f9fafb" : "none" }}>
                <span style={{ fontWeight: 600, minWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.agent_name}</span>
                <span style={{ color: "#6b7280", flex: 1 }}>{m.condition_triggered}</span>
                {m.already_open && <span style={{ color: "#9ca3af", fontSize: 10 }}>already open</span>}
              </div>
            ))}
            {n > res.matches.length && (
              <div style={{ padding: "5px 10px", fontSize: 11, color: "#9ca3af" }}>
                …and {n - res.matches.length} more not listed
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PoliciesTab() {
  const { state } = useGovernance();
  const scanActive = state.discoveryStatus === "loading" || state.discoveryStatus === "success";
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [simulatingId, setSimulatingId] = useState(null);
  const [simResults, setSimResults] = useState({});   // policyId → result | {error}
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

  /**
   * Dry-run one policy.
   *
   * Hits POST /api/policies/simulate, NOT /evaluate. They look interchangeable and
   * are not: /evaluate records violations, runs the policy's actions for real
   * (including SUSPEND), emits webhooks and forwards to SIEM. /simulate shares the
   * same evaluation engine and writes nothing.
   *
   * Agents come from the server, so this works even in a browser that has never
   * run a scan — unlike "Run Policy Check", which posts the client's own scan
   * result and is disabled without one.
   */
  const handleSimulate = async (policyId) => {
    setSimulatingId(policyId);
    try {
      const res = await fetch("/api/policies/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_id: policyId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Simulation failed (${res.status})`);
      setSimResults((s) => ({ ...s, [policyId]: { ...body.policies[0], agents_evaluated: body.agents_evaluated } }));
    } catch (e) {
      setSimResults((s) => ({ ...s, [policyId]: { error: e.message } }));
    } finally {
      setSimulatingId(null);
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
  // Split the count so a jump from 6 to 13 after deploying a pack is self-
  // explanatory rather than looking like seven policies appeared from nowhere.
  const fromPacks = policies.filter((p) => p.pack_id).length;
  const packNames = [...new Set(policies.filter((p) => p.pack_id).map((p) => p.pack_id))];
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

      {fromPacks > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px", borderRadius: 8,
                      background: "#f3f7ff", border: "1px solid #c7d6f5", fontSize: 12, color: "#1e3a8a" }}>
          <ShieldCheck size={13} />
          <span>
            <strong>{fromPacks} of these {policies.length} policies came from a deployed policy pack</strong>
            {packNames.length > 0 && <> ({packNames.join(", ")})</>} and are enforced across the whole organisation,
            exactly like the ones you wrote. Manage them from <strong>Policy Packs</strong> — disable a single rule
            there, or undeploy the pack to remove them all.
          </span>
        </div>
      )}

      <Section title={`Governance Policies (${policies.length} total, ${activePolicies} active${fromPacks ? ` — ${policies.length - fromPacks} your own, ${fromPacks} from packs` : ""})`}>
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
              <div key={p.id} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderLeft: `3px solid ${severityColor[p.severity] || "var(--ag-border)"}`, borderRadius: 8, padding: 16, opacity: p.status === "disabled" ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {statusIcon[p.status] || statusIcon.draft}
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span>
                    {/* A pack rule is enforced exactly like a hand-written one, so
                        it belongs in this list — but where it came from has to be
                        visible, because it is governed from the pack (disable or
                        undeploy there) and cannot be deleted here. */}
                    {p.pack_id
                      ? <span title={`Deployed from the ${p.pack_id} policy pack — manage it there`}
                              style={{ fontSize: 10, padding: "2px 6px", background: "#0044cc18", color: "#0044cc", borderRadius: 4, fontWeight: 600 }}>
                          pack · {p.pack_id}
                        </span>
                      : p.template && <span style={{ fontSize: 10, padding: "2px 6px", background: "#6366f122", color: "#6366f1", borderRadius: 4 }}>template</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <Badge text={p.severity} color={severityColor[p.severity] || "#6b7280"} />
                    <Badge text={p.type} color="#6366f1" />
                    {/* Simulate is deliberately available on EVERY policy,
                        including disabled and draft ones — previewing a rule you
                        have not switched on yet is the main reason to have it. */}
                    <button onClick={() => handleSimulate(p.id)} disabled={simulatingId === p.id}
                            style={{ ...btnSmall, color: "#0044cc" }} title="Preview what this policy would do. Changes nothing.">
                      <Play size={12} /> {simulatingId === p.id ? "Simulating…" : "Simulate"}
                    </button>
                    <button onClick={() => handleToggleStatus(p)} style={{ ...btnSmall, color: p.status === "active" ? "#22c55e" : "#999" }}>{p.status === "active" ? "Active" : "Disabled"}</button>
                    {/* Hidden, not merely disabled, for pack rules: the server
                        rejects the delete with 409, so offering the button would
                        only produce an error. The badge above says where to go. */}
                    {!p.pack_id && (
                      <button onClick={() => handleDeletePolicy(p.id)} style={{ ...btnSmall, color: "#ef4444" }}><Trash2 size={12} /></button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginTop: 8, lineHeight: 1.6 }}>{p.description}</div>
                {p.conditions && p.conditions.length > 0 && (
                  <div style={{ fontSize: 11, color: "#6366f1", marginTop: 8, fontFamily: "monospace" }}>
                    IF {p.conditions.map((c) => `${c.field} ${c.operator} ${c.value}`).join(" AND ")} &rarr; {p.actions?.map((a) => a.type).join(", ") || "flag"}
                  </div>
                )}

                {simResults[p.id] && <PolicySimResult res={simResults[p.id]} onClose={() => setSimResults((s) => ({ ...s, [p.id]: null }))} />}
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
