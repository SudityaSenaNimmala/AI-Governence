import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, Plus, Play, Trash2, AlertTriangle, CheckCircle, Clock, Edit2, X, ChevronRight, Boxes } from "lucide-react";
import { useGovernance } from "../AgentGovernanceContext";
import { Section } from "../common/Section";
import { Badge } from "../common/Badge";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";

const PACK_API = "/api";
async function packFetch(path, opts) {
  const r = await fetch(`${PACK_API}${path}`, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `${r.status}`);
  return body;
}

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
      <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "#fef2f2", border: "1px solid #fecaca", fontSize:13.2, color: "#b91c1c" }}>
        <AlertTriangle size={12} /> {res.error}
        <button onClick={onClose} style={{ float: "right", border: "none", background: "none", cursor: "pointer", color: "#b91c1c" }}>×</button>
      </div>
    );
  }
  const n = res.would_flag || 0;
  const tone = n === 0 ? "#16a34a" : res.severity === "critical" ? "#b91c1c" : "#b45309";
  return (
    <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", fontSize:12.7, color: "#166534" }}>
        <ShieldCheck size={12} />
        <span><strong>Simulation only — nothing was changed.</strong> No violations recorded, no actions run.</span>
        <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: "#166534", fontSize:15.2, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize:13.7, marginBottom: n ? 8 : 0 }}>
          Would flag <strong style={{ color: tone, fontSize:16.2 }}>{n}</strong> of {res.agents_evaluated} agents
          {n > 0 && <> — action: <strong>{(res.actions || []).join(", ") || "flag"}</strong></>}
          {res.already_open > 0 && <span style={{ color: "#6b7280" }}> · {res.newly_flagged} new, {res.already_open} already flagged</span>}
        </div>

        {n === 0 && <div style={{ fontSize:12.7, color: "#6b7280" }}>No agent currently meets this policy&apos;s conditions.</div>}

        {n > 0 && (
          <div style={{ maxHeight: 170, overflowY: "auto", border: "1px solid #f3f4f6", borderRadius: 6 }}>
            {res.matches.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "5px 10px", fontSize:12.7, borderBottom: i < res.matches.length - 1 ? "1px solid #f9fafb" : "none" }}>
                <span style={{ fontWeight: 600, minWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.agent_name}</span>
                <span style={{ color: "#6b7280", flex: 1 }}>{m.condition_triggered}</span>
                {m.already_open && <span style={{ color: "#9ca3af", fontSize:11.7 }}>already open</span>}
              </div>
            ))}
            {n > res.matches.length && (
              <div style={{ padding: "5px 10px", fontSize:12.7, color: "#9ca3af" }}>
                …and {n - res.matches.length} more not listed
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const PACK_DESCRIPTIONS = {
  gdpr: "General Data Protection Regulation — EU data privacy law. Enforces data minimisation, consent verification, cross-border transfer controls, and right-to-erasure compliance for AI systems processing personal data.",
  hipaa: "Health Insurance Portability and Accountability Act — US healthcare privacy. Ensures AI agents handling PHI have minimum-necessary access, audit trails, encryption at rest, and breach notification readiness.",
  "soc-2": "SOC 2 Trust Services Criteria — security, availability, confidentiality. Validates that AI systems meet access control, change management, incident response, and vendor oversight requirements.",
  "ccpa-cpra": "California Consumer Privacy Act / California Privacy Rights Act — consumer data rights. Covers opt-out enforcement, data inventory, automated decision-making disclosure, and data retention limits for AI.",
  "eu-ai-act": "EU Artificial Intelligence Act — risk-based AI regulation. Classifies AI systems by risk tier, enforces transparency obligations, human oversight requirements, and conformity assessments for high-risk AI.",
  "iso-iec-42001": "ISO/IEC 42001 — AI Management System standard. Covers AI governance structure, risk assessment methodology, performance monitoring, and continuous improvement of AI deployments.",
  "nist-ai-rmf": "NIST AI Risk Management Framework — US federal AI guidelines. Maps AI risks across govern, map, measure, and manage functions with controls for bias, security, transparency, and accountability.",
};
function getPackDesc(id) { return PACK_DESCRIPTIONS[id] || "A compliance framework policy pack with pre-built rules. Deploy to enforce its rules across your AI systems automatically."; }

/** One row in the Policy Packs modal — with per-pack busy state and Learn more. */
function PackRow({ pk, busyId, onDeploy, onUndeploy }) {
  const [expanded, setExpanded] = useState(false);
  const isBusy = busyId === pk.id;
  const otherBusy = busyId && busyId !== pk.id;
  const desc = getPackDesc(pk.id);

  return (
    <div style={{
      border: "1px solid " + (pk.deployed ? "#22c55e30" : "#e2e5ea"), borderRadius: 12,
      background: pk.deployed ? "#f0fdf4" : "#fff", overflow: "hidden",
      transition: "all 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize:14.2, color: "#111" }}>{pk.framework}</span>
            {pk.deployed && <span style={{ fontSize:11.2, padding: "2px 7px", background: "#22c55e18", color: "#16a34a", borderRadius: 4, fontWeight: 600 }}>deployed</span>}
          </div>
          <div style={{ fontSize:12.7, color: "#6b7280", marginTop: 3 }}>
            {pk.ruleCount} rules · {pk.enforceable} enforced · {pk.monitored || 0} monitored · {pk.attestations || 0} attestations
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setExpanded(!expanded)}
            style={{ ...cardBtn, color: "#0052e0", background: "#0052e00a", border: "1px solid #0052e020", padding: "7px 12px" }}>
            {expanded ? "Less" : "Learn more"}
          </button>
          {pk.deployed ? (
            <button onClick={() => onUndeploy(pk.id)} disabled={isBusy || otherBusy}
              style={{ ...cardBtn, color: "#ef4444", background: "#ef44440a", border: "1px solid #ef444420", padding: "7px 14px", opacity: otherBusy ? 0.4 : 1 }}>
              {isBusy ? "..." : "Undeploy"}
            </button>
          ) : (
            <button onClick={() => onDeploy(pk.id)} disabled={isBusy || otherBusy}
              style={{ ...cardBtn, color: "#fff", background: "#8b5cf6", border: "1px solid #8b5cf6", padding: "7px 14px", opacity: otherBusy ? 0.4 : 1 }}>
              {isBusy ? "..." : "Deploy"}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid #f3f4f6", marginTop: 0 }}>
          <p style={{ margin: "12px 0 0", fontSize:13.2, color: "#4b5563", lineHeight: 1.65 }}>{desc}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize:12.7, color: "#6b7280" }}>
            <span><strong style={{ color: "#16a34a" }}>{pk.enforceable}</strong> auto-enforced on agents</span>
            <span>·</span>
            <span><strong style={{ color: "#0052e0" }}>{pk.monitored || 0}</strong> monitored via endpoint DLP</span>
            <span>·</span>
            <span><strong style={{ color: "#b45309" }}>{pk.attestations || 0}</strong> require human sign-off</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* Keyframes injected once — spawn (pop in) and smash (crush out). */
const CARD_ANIMS = `
@keyframes polSpawn {
  0%   { opacity: 0; transform: scale(0.3) rotate(-8deg); }
  50%  { opacity: 1; transform: scale(1.06) rotate(1deg); }
  70%  { transform: scale(0.97) rotate(0deg); }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes polSmash {
  0%   { opacity: 1; transform: scale(1) rotate(0deg); }
  20%  { transform: scale(1.05) rotate(1deg); }
  100% { opacity: 0; transform: scale(0) rotate(-15deg); }
}
@keyframes polTense {
  0%   { transform: rotate(0deg); }
  2%   { transform: rotate(1.2deg); }
  4%   { transform: rotate(-1.2deg); }
  6%   { transform: rotate(1deg); }
  8%   { transform: rotate(-1deg); }
  10%  { transform: rotate(0.6deg); }
  12%  { transform: rotate(-0.6deg); }
  14%  { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}
@keyframes polProgress {
  0%   { width: 0%; }
  15%  { width: 30%; }
  40%  { width: 55%; }
  70%  { width: 80%; }
  100% { width: 95%; }
}
.pol_sim_track {
  height: 35px; border-radius: 8px; overflow: hidden;
  background: #f3f4f6; border: 1px solid #e2e5ea;
  position: relative; flex: 1;
}
.pol_sim_track .pol_sim_fill {
  height: 100%; border-radius: 8px;
  background: linear-gradient(90deg, #0052e0, #6366f1);
  animation: polProgress 2s ease-out forwards;
}
.pol_sim_track .pol_sim_label {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font-size: 10.5px; font-weight: 700;
  pointer-events: none; color: transparent;
}
.pol_sim_result {
  display: flex; align-items: center; gap: 6px; flex: 1;
  height: 35px; box-sizing: border-box;
  padding: 0 10px; border-radius: 8px; font-size: 11px; font-weight: 600;
  cursor: pointer; border: 1px solid; transition: opacity 0.15s;
}
.pol_sim_result:hover { opacity: 0.85; }
.pol_card_hint {
  position: absolute; bottom: 56px; left: 0; right: 0;
  text-align: center; font-size: 10.5px; font-weight: 600;
  color: #8b919e; letter-spacing: 0.02em;
  opacity: 0; transition: opacity 0.2s;
  pointer-events: none;
}
.pol_card_front:hover .pol_card_hint { opacity: 1; }`;
let animsInjected = false;
function ensureAnims() {
  if (animsInjected) return;
  animsInjected = true;
  const s = document.createElement("style");
  s.textContent = CARD_ANIMS;
  document.head.appendChild(s);
}

/** Measures its own width and passes it to children as a render prop. */
function SimTrack({ children }) {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth);
  }, []);
  return <div className="pol_sim_track" ref={ref}>{children(w)}</div>;
}

/** Three-state simulate button: idle → animated progress bar → compact result chip.
 *  Clicking the result chip opens a detail modal; × dismisses it. */
function SimButton({ simulating, result, onRun, onClear }) {
  const [showDetail, setShowDetail] = useState(false);

  if (simulating) {
    const lbl = {position:"absolute",top:0,bottom:0,left:0,display:"flex",alignItems:"center",justifyContent:"center",
      fontSize:10.2,fontWeight:700,pointerEvents:"none",whiteSpace:"nowrap"};
    return (
      <SimTrack>
        {(trackW) => <>
          <div className="pol_sim_fill" />
          <div style={{...lbl, right:0, color:"#374151", zIndex:1}}>Simulating...</div>
          {/* Clip div animates width same as the fill. White text inside is pinned to full track width so it stays centered. */}
          <div style={{position:"absolute",top:0,left:0,bottom:0,zIndex:2,overflow:"hidden",
            animation:"polProgress 2s ease-out forwards"}}>
            <div style={{...lbl, width:trackW+"px", color:"#fff"}}>Simulating...</div>
          </div>
        </>}
      </SimTrack>
    );
  }
  if (result) {
    if (result.error) {
      return (
        <div className="pol_sim_result" onClick={onClear}
          style={{ background: "#fef2f210", color: "#b91c1c", borderColor: "#fecaca" }}>
          <AlertTriangle size={12} /> Failed
          <span style={{ marginLeft: "auto", fontSize:11.7, opacity: 0.6 }}>dismiss</span>
        </div>
      );
    }
    const n = result.would_flag || 0;
    const ok = n === 0;
    return (<>
      <div className="pol_sim_result" onClick={() => setShowDetail(true)}
        style={{ background: ok ? "#f0fdf410" : "#fffbeb10", color: ok ? "#16a34a" : "#b45309", borderColor: ok ? "#bbf7d0" : "#fde68a" }}>
        {ok ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
        {ok ? "All clear" : `${n} flagged`}
        <span onClick={e => { e.stopPropagation(); onClear(); }} style={{ marginLeft: "auto", fontSize:13.7, opacity: 0.5, lineHeight: 1, padding: "0 2px", cursor: "pointer" }}>×</span>
      </div>
      {showDetail && createPortal(<SimDetailModal result={result} onClose={() => setShowDetail(false)} onClear={onClear} />, document.body)}
    </>);
  }
  return (
    <button onClick={onRun} title="Preview what this policy would do"
      style={{ ...cardBtn, color: "#0052e0", background: "#0052e00a", border: "1px solid #0052e020", flex: 1 }}>
      <Play size={12} /> Simulate
    </button>
  );
}

/** Full simulation result — same wide clean layout as PolicyDetail / PackGroupCard detail. */
function SimDetailModal({ result, onClose, onClear }) {
  const n = result.would_flag || 0;
  const ok = n === 0;
  const tone = ok ? "#16a34a" : "#b45309";
  const matches = result.matches || [];
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)",
      animation: "polFadeIn 0.15s ease-out",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "85vh", overflow: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "polSlideUp 0.2s ease-out",
      }}>
        {/* Accent bar */}
        <div style={{ height: 4, background: ok ? "#22c55e" : "linear-gradient(90deg, #f59e0b, #ef4444)", borderRadius: "16px 16px 0 0" }} />

        {/* Header */}
        <div style={{ padding: "20px 28px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize:17.7, fontWeight: 800, color: "#111", letterSpacing: "-0.02em" }}>Simulation Result</h3>
              <p style={{ margin: "4px 0 0", fontSize:13.7, color: "#6b7280" }}>Dry run only — no violations recorded, no actions executed.</p>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, border: "1px solid #e2e5ea", borderRadius: 8, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", flexShrink: 0 }}><X size={16} /></button>
          </div>
        </div>

        <div style={{ padding: "20px 28px 28px" }}>
          {/* Stat cards row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
            <div style={{ background: ok ? "#f0fdf4" : "#fffbeb", border: "1px solid " + (ok ? "#bbf7d0" : "#fde68a"), borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize:32.2, fontWeight: 800, color: tone, lineHeight: 1 }}>{n}</div>
              <div style={{ fontSize:13.2, color: "#6b7280", marginTop: 4 }}>would be flagged</div>
            </div>
            <div style={{ background: "#f5f6f8", border: "1px solid #e2e5ea", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize:32.2, fontWeight: 800, color: "#111", lineHeight: 1 }}>{result.agents_evaluated || 0}</div>
              <div style={{ fontSize:13.2, color: "#6b7280", marginTop: 4 }}>agents evaluated</div>
            </div>
            <div style={{ background: "#f5f6f8", border: "1px solid #e2e5ea", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontSize:32.2, fontWeight: 800, color: "#111", lineHeight: 1 }}>{(result.actions || []).length}</div>
              <div style={{ fontSize:13.2, color: "#6b7280", marginTop: 4 }}>actions configured</div>
            </div>
          </div>

          {(result.actions || []).length > 0 && (
            <div style={{ background: "#f5f6f8", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize:13.7, color: "#4b5563" }}>
              <span style={{ fontWeight: 700, color: "#111" }}>Actions: </span>{result.actions.join(", ")}
              {result.already_open > 0 && <span style={{ color: "#6b7280" }}> · {result.newly_flagged || 0} new, {result.already_open} already open</span>}
            </div>
          )}

          {ok && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px", borderRadius: 12, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <CheckCircle size={22} color="#16a34a" />
              <div>
                <div style={{ fontWeight: 700, fontSize:14.2, color: "#16a34a" }}>All clear</div>
                <div style={{ fontSize:13.2, color: "#6b7280", marginTop: 1 }}>No agent currently meets this policy's conditions.</div>
              </div>
            </div>
          )}

          {n > 0 && matches.length > 0 && (<>
            <div style={{ fontSize:12.7, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Agents that would be flagged ({matches.length}{n > matches.length ? ` of ${n}` : ""})</div>
            <div style={{ border: "1px solid #e2e5ea", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                {matches.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", borderBottom: i < matches.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: tone, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize:13.7, fontWeight: 600, color: "#111" }}>{m.agent_name}</div>
                      <div style={{ fontSize:12.7, color: "#6b7280", marginTop: 1 }}>{m.condition_triggered}</div>
                    </div>
                    {m.already_open && <span style={{ fontSize:11.7, padding: "2px 8px", background: "#f5f6f8", borderRadius: 4, color: "#6b7280" }}>already flagged</span>}
                  </div>
                ))}
              </div>
              {n > matches.length && (
                <div style={{ padding: "10px 18px", fontSize:13.2, color: "#6b7280", background: "#fafbfc", borderTop: "1px solid #f3f4f6" }}>...and {n - matches.length} more not listed</div>
              )}
            </div>
          </>)}

          {/* Footer actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button onClick={() => { onClose(); onClear(); }} style={{ ...btnSecondary, padding: "9px 18px" }}>Dismiss result</button>
            <button onClick={onClose} style={{ ...btnPrimary, background: "#0052e0", padding: "9px 18px" }}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact card for the grid. Click opens detail; delete flips the card. */
function PolicyCard({ policy: p, simulatingId, simResult, onSimulate, onDelete, onToggle, onClearSim, spawning, smashing, collapsing, onSmashEnd, onCollapseEnd }) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const sColor = severityColor[p.severity] || "#9ca3af";
  const isActive = p.status === "active";
  const CARD_H = 168;

  useEffect(() => { ensureAnims(); }, []);

  // Smash animation ended → tell parent to start collapsing the slot
  const handleAnimEnd = (e) => {
    if (e.animationName === "polSmash" && smashing) onSmashEnd(p.id);
  };
  // Collapse transition ended → tell parent to remove from DOM
  const handleTransEnd = (e) => {
    if (collapsing && e.propertyName === "height") onCollapseEnd(p.id);
  };

  const outerAnim = spawning ? "polSpawn 0.45s cubic-bezier(0.34,1.56,0.64,1) both"
    : smashing ? "polSmash 0.4s cubic-bezier(0.55,0,1,0.45) both"
    : "none";

  // Collapsing: shrink height + gap contribution to zero smoothly
  const collapseStyle = collapsing ? {
    height: 0, minHeight: 0, overflow: "hidden", opacity: 0,
    marginTop: -7, marginBottom: -7, /* eat the grid gap */
    transition: "height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.2s, margin 0.35s cubic-bezier(0.4,0,0.2,1)",
  } : {};

  return (<>
    <div style={{
      perspective: 1000, height: CARD_H, animation: outerAnim, ...collapseStyle,
      /* Vibrate the whole card when flipped — keeps the inner transform/transition clean */
      ...(flipped && !smashing ? { animation: "polTense 2.5s 0.5s linear infinite" } : {}),
    }}
         onAnimationEnd={handleAnimEnd} onTransitionEnd={handleTransEnd}>
      <div style={{
        position: "relative", width: "100%", height: "100%",
        transformStyle: "preserve-3d",
        transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: flipped ? "rotateY(180deg)" : "none",
      }}>
        {/* ─── FRONT FACE ─── */}
        <div className="pol_card_front" onClick={() => !flipped && setOpen(true)} style={{
          position: "absolute", inset: 0,
          backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
          background: "var(--ag-bg-card, #fff)", borderRadius: 14,
          border: "1px solid var(--ag-border, #e2e5ea)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          padding: "18px 20px", cursor: "pointer", overflow: "hidden",
          opacity: p.status === "disabled" ? 0.65 : 1,
          display: "flex", flexDirection: "column",
        }}
        onMouseEnter={e => { if (!flipped) { e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.08)"; e.currentTarget.style.borderColor = sColor + "60"; } }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor = "var(--ag-border, #e2e5ea)"; }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: sColor }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? "#22c55e" : "#d1d5db", flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize:13.7, color: "var(--ag-text, #111)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.name}</span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <Badge text={p.severity} color={sColor} />
            <Badge text={p.type} color="#6366f1" />
            {p.pack_id
              ? <span style={{ fontSize:11.2, padding: "2px 7px", background: "#8b5cf614", color: "#8b5cf6", borderRadius: 4, fontWeight: 600 }}>pack</span>
              : <span style={{ fontSize:11.2, padding: "2px 7px", background: "#0052e012", color: "#0052e0", borderRadius: 4, fontWeight: 600 }}>custom</span>}
          </div>

          <div className="pol_card_hint">click for more info</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: "auto" }} onClick={e => e.stopPropagation()}>
            <SimButton simulating={simulatingId === p.id} result={simResult} onRun={() => onSimulate(p.id)} onClear={onClearSim} />
            {!p.pack_id && (
              <button onClick={() => setFlipped(true)}
                title="Delete policy"
                style={{ ...cardBtn, color: "#ef4444", background: "#ef44440a", border: "1px solid #ef444420", width: 34, justifyContent: "center", padding: "6px 0" }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {/* ─── BACK FACE (delete confirmation) ─── */}
        <div style={{
          position: "absolute", inset: 0, transform: "rotateY(180deg)",
          backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
          borderRadius: 14, border: "1px solid #fecaca",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 100%)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "24px 20px", textAlign: "center", gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#ef44441a", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={20} color="#ef4444" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize:14.2, color: "#111", marginBottom: 4 }}>Delete this policy?</div>
            <div style={{ fontSize:13.2, color: "#6b7280", lineHeight: 1.5, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setFlipped(false)}
              style={{ ...cardBtn, color: "#4b5563", background: "#fff", border: "1px solid #e2e5ea", padding: "8px 18px" }}>
              Cancel
            </button>
            <button onClick={() => { onDelete(p.id); }}
              style={{ ...cardBtn, color: "#fff", background: "#ef4444", border: "1px solid #ef4444", padding: "8px 18px" }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    {open && <PolicyDetail policy={p} sColor={sColor} simulatingId={simulatingId} simResult={simResult}
      onSimulate={onSimulate} onDelete={onDelete} onToggle={onToggle} onClearSim={onClearSim} onClose={() => setOpen(false)} />}
  </>);
}

/** One card representing an entire deployed pack (grouped). */
function PackGroupCard({ group: g, spawning, smashing, collapsing, onUndeploy, onSmashEnd, onCollapseEnd, simulating, simResult, onSimulate, onClearSim }) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const CARD_H = 168;
  const ruleCount = g.policies.length;
  const activeCount = g.policies.filter(p => p.status === "active").length;
  // Highest severity in the pack
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const topSev = g.policies.reduce((best, p) => (sevOrder[p.severity] ?? 9) < (sevOrder[best] ?? 9) ? p.severity : best, "low");
  const sColor = severityColor[topSev] || "#8b5cf6";

  useEffect(() => { ensureAnims(); }, []);

  const handleAnimEnd = (e) => { if (e.animationName === "polSmash" && smashing) onSmashEnd(); };
  const handleTransEnd = (e) => { if (collapsing && e.propertyName === "height") onCollapseEnd(); };

  const outerAnim = spawning ? "polSpawn 0.45s cubic-bezier(0.34,1.56,0.64,1) both"
    : smashing ? "polSmash 0.4s cubic-bezier(0.55,0,1,0.45) both" : "none";
  const collapseStyle = collapsing ? {
    height: 0, minHeight: 0, overflow: "hidden", opacity: 0,
    marginTop: -7, marginBottom: -7,
    transition: "height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.2s, margin 0.35s cubic-bezier(0.4,0,0.2,1)",
  } : {};

  return (<>
    <div style={{
      perspective: 1000, height: CARD_H, animation: outerAnim, ...collapseStyle,
      ...(flipped && !smashing ? { animation: "polTense 2.5s 0.5s linear infinite" } : {}),
    }} onAnimationEnd={handleAnimEnd} onTransitionEnd={handleTransEnd}>
      <div style={{
        position: "relative", width: "100%", height: "100%",
        transformStyle: "preserve-3d",
        transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: flipped ? "rotateY(180deg)" : "none",
      }}>
        {/* FRONT */}
        <div className="pol_card_front" onClick={() => !flipped && setOpen(true)} style={{
          position: "absolute", inset: 0,
          backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
          background: "linear-gradient(135deg, #f5f3ff 0%, #fff 100%)", borderRadius: 14,
          border: "1px solid #8b5cf630",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          padding: "18px 20px", cursor: "pointer", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(139,92,246,0.12)"; e.currentTarget.style.borderColor = "#8b5cf660"; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; e.currentTarget.style.borderColor = "#8b5cf630"; }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #8b5cf6, #6366f1)" }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Boxes size={14} color="#8b5cf6" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize:13.7, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {g.packId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <Badge text={`${ruleCount} rules`} color="#8b5cf6" />
            <Badge text={`${activeCount} active`} color="#22c55e" />
            <span style={{ fontSize:11.2, padding: "2px 7px", background: "#8b5cf614", color: "#8b5cf6", borderRadius: 4, fontWeight: 600 }}>pack</span>
          </div>

          <div className="pol_card_hint">click for more info</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: "auto" }} onClick={e => e.stopPropagation()}>
            <SimButton simulating={simulating} result={simResult} onRun={onSimulate} onClear={onClearSim} />
            <button onClick={() => setFlipped(true)}
              title="Undeploy this pack"
              style={{ ...cardBtn, color: "#ef4444", background: "#ef44440a", border: "1px solid #ef444420", width: 34, justifyContent: "center", padding: "6px 0" }}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* BACK — undeploy confirmation */}
        <div style={{
          position: "absolute", inset: 0, transform: "rotateY(180deg)",
          backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
          borderRadius: 14, border: "1px solid #fecaca",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          background: "linear-gradient(135deg, #fef2f2 0%, #fff5f5 100%)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "24px 20px", textAlign: "center", gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#ef44441a", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={20} color="#ef4444" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize:14.2, color: "#111", marginBottom: 4 }}>Undeploy this pack?</div>
            <div style={{ fontSize:13.2, color: "#6b7280" }}>Removes all {ruleCount} rules</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setFlipped(false)}
              style={{ ...cardBtn, color: "#4b5563", background: "#fff", border: "1px solid #e2e5ea", padding: "8px 18px" }}>
              Cancel
            </button>
            <button onClick={() => { onUndeploy(); }}
              style={{ ...cardBtn, color: "#fff", background: "#ef4444", border: "1px solid #ef4444", padding: "8px 18px" }}>
              <Trash2 size={12} /> Undeploy
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Detail modal showing all rules in the pack */}
    {open && (
      <div onClick={() => setOpen(false)} style={{
        position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)",
        animation: "polFadeIn 0.15s ease-out",
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "85vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "polSlideUp 0.2s ease-out",
        }}>
          <div style={{ height: 4, background: "linear-gradient(90deg, #8b5cf6, #6366f1)", borderRadius: "16px 16px 0 0" }} />
          <div style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize:17.7, fontWeight: 800, color: "#111" }}>
                  {g.packId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                </h3>
                <div style={{ fontSize:13.2, color: "#6b7280", marginTop: 3 }}>{ruleCount} rules · {activeCount} active</div>
              </div>
              <button onClick={() => setOpen(false)} style={{ width: 32, height: 32, border: "1px solid #e2e5ea", borderRadius: 8, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}><X size={16} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.policies.map(p => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #e2e5ea", borderRadius: 10, background: "#fafbfc" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.status === "active" ? "#22c55e" : "#d1d5db", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize:13.7, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    {p.description && <div style={{ fontSize:12.7, color: "#6b7280", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.description}</div>}
                  </div>
                  <Badge text={p.severity} color={severityColor[p.severity] || "#9ca3af"} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}
  </>);
}

/** Full-detail overlay for a single policy. */
function PolicyDetail({ policy: p, sColor, simulatingId, simResult, onSimulate, onDelete, onToggle, onClearSim, onClose }) {
  const isActive = p.status === "active";
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)",
      animation: "polFadeIn 0.15s ease-out",
    }}>
      <style>{`@keyframes polFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes polSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, maxHeight: "85vh", overflow: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "polSlideUp 0.2s ease-out",
        position: "relative",
      }}>
        {/* Accent bar */}
        <div style={{ height: 4, background: sColor, borderRadius: "16px 16px 0 0" }} />

        {/* Header */}
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: isActive ? "#22c55e" : "#d1d5db", boxShadow: isActive ? "0 0 6px rgba(34,197,94,0.4)" : "none" }} />
                <span style={{ fontSize:12.7, fontWeight: 600, color: isActive ? "#16a34a" : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {p.status}
                </span>
              </div>
              <h3 style={{ margin: 0, fontSize:17.7, fontWeight: 800, color: "#111", letterSpacing: "-0.02em" }}>{p.name}</h3>
            </div>
            <button onClick={onClose} style={{
              width: 32, height: 32, border: "1px solid #e2e5ea", borderRadius: 8, background: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280", flexShrink: 0,
            }}><X size={16} /></button>
          </div>

          {/* Tags */}
          <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            <Badge text={p.severity} color={sColor} />
            <Badge text={p.type} color="#6366f1" />
            {p.pack_id
              ? <span style={{ fontSize:11.7, padding: "2px 8px", background: "#8b5cf612", color: "#8b5cf6", borderRadius: 6, fontWeight: 600 }}>pack · {p.pack_id}</span>
              : <span style={{ fontSize:11.7, padding: "2px 8px", background: "#0052e012", color: "#0052e0", borderRadius: 6, fontWeight: 600 }}>custom</span>}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 24px 24px" }}>
          {/* Description */}
          {p.description && (
            <div style={{ fontSize:13.7, color: "#4b5563", lineHeight: 1.65, marginBottom: 16 }}>{p.description}</div>
          )}

          {/* Condition logic */}
          {p.conditions && p.conditions.length > 0 && (
            <div style={{ background: "#f5f6f8", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontSize:11.7, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Rule Logic</div>
              <div style={{ fontSize:13.2, fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: "#6366f1", lineHeight: 1.6 }}>
                IF {p.conditions.map((c) => `${c.field} ${c.operator} ${c.value}`).join(" AND ")} &rarr; {p.actions?.map((a) => a.type).join(", ") || "flag"}
              </div>
            </div>
          )}

          {/* Detail fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "#f5f6f8", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize:11.7, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Actions</div>
              <div style={{ fontSize:13.7, fontWeight: 600, color: "#111", marginTop: 3 }}>{p.actions?.map(a => a.type).join(", ") || "flag"}</div>
            </div>
            <div style={{ background: "#f5f6f8", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize:11.7, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Scope</div>
              <div style={{ fontSize:13.7, fontWeight: 600, color: "#111", marginTop: 3 }}>{p.scope?.type || "all agents"}</div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => onSimulate(p.id)} disabled={simulatingId === p.id}
              style={{ ...btnPrimary, background: "#0052e0", flex: 1 }}>
              <Play size={14} /> {simulatingId === p.id ? "Simulating..." : "Simulate"}
            </button>
            <button onClick={() => onToggle(p)}
              style={{ ...btnSecondary, color: isActive ? "#22c55e" : "#6b7280", borderColor: isActive ? "#22c55e40" : "var(--ag-border, #e2e5ea)", flex: 1 }}>
              {isActive ? <CheckCircle size={14} /> : <Clock size={14} />} {isActive ? "Active" : "Disabled"}
            </button>
            {!p.pack_id && (
              <button onClick={() => { if (confirm(`Delete "${p.name}"?`)) { onDelete(p.id); onClose(); } }}
                style={{ ...btnSecondary, color: "#ef4444", borderColor: "#ef444430" }}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>

          {/* Simulation result */}
          {simResult && <PolicySimResult res={simResult} onClose={onClearSim} />}
        </div>
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
  const [showPacks, setShowPacks] = useState(false);
  const [packs, setPacks] = useState(null);
  const [packsBusyId, setPacksBusyId] = useState(null); // ID of the pack currently deploying/undeploying
  const [filter, setFilter] = useState("all"); // "all" | "custom" | "pack"
  // Animation state: spawn (pop-in), smash (crush-out), collapse (slot shrinks)
  const [spawnIds, setSpawnIds] = useState(new Set());
  const [smashingId, setSmashingId] = useState(null);
  const [collapsingId, setCollapsingId] = useState(null);

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
      // Snapshot current IDs so we can detect the new one after reload
      const before = new Set(policies.map(p => p.id));
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
      const fresh = await agentGovernanceApi.listPolicies();
      const newIds = new Set(fresh.filter(p => !before.has(p.id)).map(p => p.id));
      // Push newly created policies to the end so the spawn animation appears last
      const existing = fresh.filter(p => !newIds.has(p.id));
      const created = fresh.filter(p => newIds.has(p.id));
      setSpawnIds(newIds);
      setPolicies([...existing, ...created]);
      if (newIds.size) setTimeout(() => setSpawnIds(new Set()), 600);
    } catch (e) {
      console.error("Failed to create policy:", e);
    }
  };

  // Three-phase delete: smash → collapse slot → remove from state
  const startSmash = (id) => { setSmashingId(id); };
  // Called when smash animation ends — start collapsing the grid slot
  const startCollapse = (id) => {
    setSmashingId(null);
    setCollapsingId(id);
    // Fire the API delete in parallel with the collapse animation
    agentGovernanceApi.deletePolicy(id).catch(e => console.error("Failed to delete policy:", e));
  };
  // Called when the collapse transition ends — remove from DOM
  const finishRemove = (id) => {
    setPolicies((prev) => prev.filter((p) => p.id !== id));
    setCollapsingId(null);
  };
  const handleDeletePolicy = (id) => { startSmash(id); };

  // ── Policy Packs helpers ──
  const loadPacks = async () => {
    try { setPacks(await packFetch("/policy-packs")); } catch (e) { console.error("Failed to load packs:", e); }
  };
  const openPacksModal = () => { setShowPacks(true); loadPacks(); };
  const deployPack = async (packId) => {
    setPacksBusyId(packId);
    try {
      const beforePackIds = new Set(policies.filter(p => p.pack_id).map(p => p.pack_id));
      await packFetch(`/policy-packs/${packId}/deploy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      await loadPacks();
      const fresh = await agentGovernanceApi.listPolicies();
      setPolicies(fresh);
      if (!beforePackIds.has(packId)) {
        const newPackPolicyIds = new Set(fresh.filter(p => p.pack_id === packId).map(p => p.id));
        setSpawnIds(newPackPolicyIds);
        if (newPackPolicyIds.size) setTimeout(() => setSpawnIds(new Set()), 600);
      }
    } catch (e) { console.error("Deploy failed:", e); }
    finally { setPacksBusyId(null); }
  };
  const undeployPack = async (id) => {
    setPacksBusyId(id);
    try {
      await packFetch(`/policy-packs/${id}/undeploy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      await loadPacks();
      await loadPolicies();
    } catch (e) { console.error("Undeploy failed:", e); }
    finally { setPacksBusyId(null); }
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

  // Simulate all policies in a pack group, aggregate results
  const handleSimulatePack = async (group) => {
    const key = "pack:" + group.packId;
    setSimulatingId(key);
    try {
      let totalFlagged = 0, totalEvaluated = 0, allMatches = [], allActions = new Set();
      for (const p of group.policies) {
        const res = await fetch("/api/policies/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy_id: p.id }),
        });
        const body = await res.json();
        if (!res.ok) continue;
        const pol = body.policies?.[0];
        if (pol) {
          totalFlagged += pol.would_flag || 0;
          totalEvaluated = Math.max(totalEvaluated, body.agents_evaluated || 0);
          (pol.matches || []).forEach(m => allMatches.push(m));
          (pol.actions || []).forEach(a => allActions.add(a));
        }
      }
      setSimResults(s => ({ ...s, [key]: { would_flag: totalFlagged, agents_evaluated: totalEvaluated, matches: allMatches, actions: [...allActions] } }));
    } catch (e) {
      setSimResults(s => ({ ...s, [key]: { error: e.message } }));
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

  // Build card list: individual custom policies + one grouped card per pack
  const customPolicies = policies.filter(p => !p.pack_id);
  const packGroups = {};
  policies.filter(p => p.pack_id).forEach(p => {
    if (!packGroups[p.pack_id]) packGroups[p.pack_id] = { packId: p.pack_id, policies: [] };
    packGroups[p.pack_id].policies.push(p);
  });
  const packGroupList = Object.values(packGroups);
  // Count for the section title
  const cardCount = customPolicies.length + packGroupList.length;

  const filteredCustom = filter === "pack" ? [] : customPolicies;
  const filteredPacks = filter === "custom" ? [] : packGroupList;
  const filteredCount = filteredCustom.length + filteredPacks.length;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setShowCreateForm(!showCreateForm)} style={btnPrimary}><Plus size={14} /> Custom Policy</button>
        <button onClick={openPacksModal} style={{ ...btnPrimary, background: "#8b5cf6" }}><Boxes size={14} /> Policy Packs</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={() => setFilter(filter === "custom" ? "all" : "custom")}
            style={{ ...countPill, background: filter === "custom" ? "#0052e0" : "#fff", color: filter === "custom" ? "#fff" : "#0052e0", borderColor: filter === "custom" ? "#0052e0" : "#0052e030" }}>
            {customPolicies.length} Custom
          </button>
          <button onClick={() => setFilter(filter === "pack" ? "all" : "pack")}
            style={{ ...countPill, background: filter === "pack" ? "#8b5cf6" : "#fff", color: filter === "pack" ? "#fff" : "#8b5cf6", borderColor: filter === "pack" ? "#8b5cf6" : "#8b5cf630" }}>
            {packGroupList.length} Packs
          </button>
        </div>
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

      <div>
        {loading && policies.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading policies...</div>
        ) : cardCount === 0 ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <ShieldCheck size={40} style={{ color: "#999", marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize:14.2, fontWeight: 600, color: "#333", marginBottom: 8 }}>No policies configured</div>
            <div style={{ fontSize:13.2, color: "#999", marginBottom: 16 }}>Click <strong>"Custom Policy"</strong> or deploy a <strong>Policy Pack</strong>.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {filteredCustom.map((p) => (
              <PolicyCard key={p.id} policy={p} simulatingId={simulatingId} simResult={simResults[p.id]}
                spawning={spawnIds.has(p.id)} smashing={smashingId === p.id} collapsing={collapsingId === p.id}
                onSimulate={handleSimulate} onDelete={startSmash} onSmashEnd={startCollapse} onCollapseEnd={finishRemove}
                onToggle={handleToggleStatus}
                onClearSim={() => setSimResults((s) => ({ ...s, [p.id]: null }))} />
            ))}
            {filteredPacks.map((g) => {
              const packSimKey = "pack:" + g.packId;
              return (
              <PackGroupCard key={g.packId} group={g}
                spawning={g.policies.some(p => spawnIds.has(p.id))}
                smashing={smashingId === packSimKey}
                collapsing={collapsingId === packSimKey}
                simulating={simulatingId === packSimKey}
                simResult={simResults[packSimKey]}
                onSimulate={() => handleSimulatePack(g)}
                onClearSim={() => setSimResults(s => ({ ...s, [packSimKey]: null }))}
                onUndeploy={() => startSmash(packSimKey)}
                onSmashEnd={() => startCollapse(packSimKey)}
                onCollapseEnd={() => {
                  undeployPack(g.packId).then(() => {
                    setCollapsingId(null);
                  });
                }} />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Policy Packs modal ── */}
      {showPacks && (
        <div onClick={() => setShowPacks(false)} style={{
          position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, width: "100%", maxWidth: 660, maxHeight: "80vh", overflow: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "polSlideUp 0.2s ease-out",
          }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e2e5ea", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize:16.7, fontWeight: 800, color: "#111" }}>Policy Packs</h3>
                <div style={{ fontSize:13.2, color: "#6b7280", marginTop: 3 }}>Deploy a compliance framework to add its rules as policies</div>
              </div>
              <button onClick={() => setShowPacks(false)} style={{ width: 32, height: 32, border: "1px solid #e2e5ea", borderRadius: 8, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}><X size={16} /></button>
            </div>
            <div style={{ padding: "16px 24px 24px" }}>
              {!packs ? <div style={{ textAlign: "center", padding: 30, color: "#999", fontSize:13.7 }}>Loading packs...</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {(packs.packs || []).map(pk => (
                    <PackRow key={pk.id} pk={pk} busyId={packsBusyId} onDeploy={deployPack} onUndeploy={undeployPack} />
                  ))}
                  {(packs.packs || []).length === 0 && <div style={{ textAlign: "center", padding: 20, color: "#999", fontSize:13.7 }}>No policy packs available.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#6366f1", color: "#fff", padding: "9px 16px", borderRadius: 8, fontSize:13.2, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" };
const btnSecondary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "transparent", border: "1px solid var(--ag-border)", color: "#666", padding: "9px 16px", borderRadius: 8, fontSize:13.2, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" };
const btnSmall = { display: "flex", alignItems: "center", gap: 3, background: "transparent", border: "none", padding: "4px 8px", borderRadius: 4, fontSize:12.7, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" };
const cardBtn = { display: "flex", alignItems: "center", gap: 5, height: 35, boxSizing: "border-box", padding: "0 12px", borderRadius: 8, fontSize:12.7, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" };
const countPill = { display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 20, fontSize:13.2, fontWeight: 700, border: "1px solid", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", letterSpacing: "-0.01em" };
const fieldLabel = { display: "block", fontSize:12.7, fontWeight: 500, color: "#666", marginBottom: 4 };
const fieldInput = { width: "100%", background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 10px", fontSize:13.2, color: "#333", outline: "none", fontFamily: "inherit" };
const thStyle = { textAlign: "left", padding: "8px 12px", color: "#666", fontWeight: 600, fontSize:12.7 };
const tdStyle = { padding: "8px 12px" };
