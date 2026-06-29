import { useState, useEffect } from "react";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Tag, Save, Loader, Building2, Lock, FileText, CheckCircle2 } from "lucide-react";

const DATA_CLASSIFICATIONS = [
  { value: "unclassified", label: "Unclassified",  color: "#6b7280", bg: "#f3f4f6" },
  { value: "internal",     label: "Internal",      color: "#2563eb", bg: "#dbeafe" },
  { value: "confidential", label: "Confidential",  color: "#d97706", bg: "#fef3c7" },
  { value: "restricted",   label: "Restricted",    color: "#dc2626", bg: "#fee2e2" },
];

const USE_CASE_CATEGORIES = [
  "Customer Support",
  "HR & People Operations",
  "IT Helpdesk",
  "Finance & Accounting",
  "Sales & CRM",
  "Marketing",
  "Legal & Compliance",
  "Engineering",
  "Data Analytics",
  "Knowledge Management",
  "Process Automation",
  "Other",
];

export function AgentMetadataPanel({ agent, onSaved }) {
  const [form, setForm] = useState({
    purpose: "",
    business_unit: "",
    data_classification: "unclassified",
    use_case_category: "",
    approved_by: "",
    notes: "",
    tags: [],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (!agent?.id) return;
    setLoading(true);
    agentGovernanceApi
      .getAgentMetadata(agent.id)
      .then((res) => {
        if (res.exists) {
          setForm({
            purpose:             res.purpose            || "",
            business_unit:       res.business_unit      || "",
            data_classification: res.data_classification || "unclassified",
            use_case_category:   res.use_case_category  || "",
            approved_by:         res.approved_by        || "",
            notes:               res.notes              || "",
            tags:                res.tags               || [],
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agent?.id]);

  const handleSave = async () => {
    if (!agent?.id) return;
    setSaving(true);
    setSaved(false);
    try {
      await agentGovernanceApi.saveAgentMetadata(agent.id, {
        agent_name: agent.name,
        platform: agent.platform,
        ...form,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      if (onSaved) onSaved(form);
    } catch (e) {
      alert(e.message || "Failed to save metadata");
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) {
      setForm((p) => ({ ...p, tags: [...p.tags, t] }));
    }
    setTagInput("");
  };

  const removeTag = (tag) => setForm((p) => ({ ...p, tags: p.tags.filter((t) => t !== tag) }));

  const classConfig = DATA_CLASSIFICATIONS.find((c) => c.value === form.data_classification) || DATA_CLASSIFICATIONS[0];

  if (loading) {
    return (
      <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af" }}>
        <Loader size={16} style={{ animation: "agSpin 1s linear infinite" }} />
        <div style={{ fontSize: 12, marginTop: 6 }}>Loading metadata…</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 0 4px 0", fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #f3f4f6" }}>
        <FileText size={14} color="#6366f1" />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>Business Context</span>
      </div>

      {/* Data Classification */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          <Lock size={10} style={{ marginRight: 4, verticalAlign: "middle" }} />Data Classification
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DATA_CLASSIFICATIONS.map((c) => (
            <button
              key={c.value}
              onClick={() => setForm((p) => ({ ...p, data_classification: c.value }))}
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: form.data_classification === c.value ? c.bg : "#f3f4f6",
                color: form.data_classification === c.value ? c.color : "#6b7280",
                border: form.data_classification === c.value ? `1px solid ${c.color}40` : "1px solid transparent",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Purpose */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Purpose</label>
        <textarea
          value={form.purpose}
          onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))}
          placeholder="Describe what this agent does and why it exists…"
          rows={3}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, fontFamily: "inherit", resize: "vertical", color: "#111827", boxSizing: "border-box" }}
        />
      </div>

      {/* Business Unit + Use Case row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
            <Building2 size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />Business Unit
          </label>
          <input
            value={form.business_unit}
            onChange={(e) => setForm((p) => ({ ...p, business_unit: e.target.value }))}
            placeholder="e.g. HR, Engineering, Finance"
            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, color: "#111827", boxSizing: "border-box" }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Use Case Category</label>
          <select
            value={form.use_case_category}
            onChange={(e) => setForm((p) => ({ ...p, use_case_category: e.target.value }))}
            style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, color: "#111827", background: "#fff", cursor: "pointer", boxSizing: "border-box" }}
          >
            <option value="">Select category…</option>
            {USE_CASE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Approved By */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Approved By</label>
        <input
          value={form.approved_by}
          onChange={(e) => setForm((p) => ({ ...p, approved_by: e.target.value }))}
          placeholder="Name or email of approver"
          style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, color: "#111827", boxSizing: "border-box" }}
        />
      </div>

      {/* Tags */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
          <Tag size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />Tags
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {form.tags.map((tag) => (
            <span key={tag} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe" }}>
              {tag}
              <button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", lineHeight: 1, padding: 0, fontSize: 13 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="Add tag… (press Enter)"
            style={{ flex: 1, padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, color: "#111827" }}
          />
          <button onClick={addTag} style={{ padding: "5px 12px", borderRadius: 6, background: "#f3f4f6", border: "1px solid #e5e7eb", fontSize: 12, cursor: "pointer", color: "#374151" }}>
            Add
          </button>
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          placeholder="Additional governance notes, known issues, review history…"
          rows={2}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, fontFamily: "inherit", resize: "vertical", color: "#111827", boxSizing: "border-box" }}
        />
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
          borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: saved ? "#10b981" : "#6366f1", color: "#fff", border: "none",
          opacity: saving ? 0.7 : 1, transition: "background 0.2s",
        }}
      >
        {saved ? <CheckCircle2 size={13} /> : saving ? <Loader size={13} style={{ animation: "agSpin 1s linear infinite" }} /> : <Save size={13} />}
        {saved ? "Saved!" : saving ? "Saving…" : "Save Metadata"}
      </button>
    </div>
  );
}
