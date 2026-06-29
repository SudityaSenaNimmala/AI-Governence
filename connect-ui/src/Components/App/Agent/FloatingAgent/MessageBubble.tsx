import React from "react";
import type { ChatMessage, ToolCall } from "./hooks/useChat";
import type { WidgetDescriptor } from "@cloudfuze/shared";
import type { ActionPlan } from "./mouseAgent/types";
import WidgetRenderer from "./widgets/WidgetRenderer";

function MdText({ text }: { text: string }) {
  const cleaned = text
    .split("\n")
    .map(line => line.replace(/^[\s]*[-•*]\s+/, "").replace(/^[\s]*\d+[.)]\s+/, ""))
    .join("\n");

  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0, match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index > last) parts.push(cleaned.slice(last, match.index));
    if (match[0].startsWith("**")) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else {
      parts.push(<em key={match.index}>{match[3]}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < cleaned.length) parts.push(cleaned.slice(last));
  return <>{parts}</>;
}

interface Props {
  message: ChatMessage;
  token: string;
  onFollowUp: (text: string) => void;
  onActionStart?: (plan: ActionPlan, messageId: string) => void;
  onActionDismiss?: (messageId: string) => void;
  onInChatOnboard?: (plan: ActionPlan, messageId: string) => void;
}

export default function MessageBubble({ message, token, onFollowUp, onActionStart, onActionDismiss, onInChatOnboard }: Props) {
  const isUser = message.role === "user";

  return (
    <div className="msg-appear" style={{ ...s.row, justifyContent: isUser ? "flex-end" : "flex-start" }}>
      {!isUser && (
        <div style={s.aiAvatar}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </div>
      )}

      <div style={{ maxWidth: isUser ? "75%" : "85%", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {(message.text || message.loading || (!isUser && (message.toolCalls?.length ?? 0) > 0)) && (
          <div style={isUser ? s.userBubble : s.aiBubble}>
            {message.error && <span style={{ color: "#ef4444", marginRight: 4 }}>⚠</span>}

            {/* AgentHarness: show while loading OR after done (stays as collapsible "Thought for Xs") */}
            {message.loading && !message.text && (message.toolCalls?.length ?? 0) === 0 && (
              <AgentHarness toolCalls={[]} status={message.status} done={false} />
            )}
            {(message.toolCalls?.length ?? 0) > 0 && (
              <AgentHarness toolCalls={message.toolCalls} status={message.status} done={!message.loading} />
            )}

            {/* Divider between harness and streaming text */}
            {(message.toolCalls?.length ?? 0) > 0 && message.text && (
              <div style={{ borderTop: "1px solid #f1f5f9", margin: "10px 0 6px" }} />
            )}

            {/* Streaming / final text */}
            {message.text && (
              <span style={{ whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
                <MdText text={message.text} />
              </span>
            )}
            {message.loading && message.text && <span className="cursor-blink" style={{ color: "#2563eb", marginLeft: 2 }}>▋</span>}
          </div>
        )}

        {/* Widget skeleton — shown when tools are done but widget hasn't arrived yet */}
        {(message.widgetPending ?? false) &&
          (message.toolCalls?.length ?? 0) > 0 &&
          message.toolCalls!.every(tc => tc.status === "done") &&
          message.widgets.length === 0 && (
          <DelayedWidgetSkeleton toolName={message.toolCalls![message.toolCalls!.length - 1]?.toolName} />
        )}

        {/* Action plan confirmation card */}
        {!isUser && message.actionPlan && !message.actionPlanExecuted && !message.loading && (
          message.actionPlan.operation === 'onboard_user' ? (
            <SmartOnboardCard
              plan={message.actionPlan}
              onAgentic={(updatedPlan) => onActionStart?.(updatedPlan, message.id)}
              onInChat={(updatedPlan) => onInChatOnboard?.(updatedPlan, message.id)}
              onDismiss={() => onActionDismiss?.(message.id)}
              onFollowUp={onFollowUp}
            />
          ) : (
            <ActionConfirmCard
              plan={message.actionPlan}
              onStart={() => onActionStart?.(message.actionPlan!, message.id)}
              onDismiss={() => onActionDismiss?.(message.id)}
            />
          )
        )}

        {message.widgets.length > 0 && (() => {
          const structured = message.widgets.filter(w => w.widgetType !== "text_block");
          const textBlocks = message.widgets.filter(w => w.widgetType === "text_block");
          // Show structured widgets always.
          // Show text_blocks only when there are no structured widgets AND no prose text
          // (avoids duplicating the same content that's already in message.text).
          const toRender = structured.length > 0 ? structured : (!message.text ? textBlocks : []);
          return toRender.length > 0 ? (
            <WidgetGroup
              widgets={toRender}
              token={token}
              runId={message.runId}
              onMousePlan={plan => onActionStart?.(plan, message.id)}
            />
          ) : null;
        })()}

        {/* Follow-up suggestion chips — rendered inline under the answer */}
        {!isUser && !message.loading && (message.followUps?.length ?? 0) > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {message.followUps!.map(chip => (
              <button
                key={chip}
                type="button"
                onClick={() => onFollowUp(chip)}
                style={{
                  fontSize: 12, color: "#1e40af", background: "#eff6ff",
                  border: "1.5px solid #bfdbfe", borderRadius: 20,
                  padding: "5px 12px", cursor: "pointer",
                  fontFamily: "inherit", lineHeight: 1.4,
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#dbeafe"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#93c5fd"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#bfdbfe"; }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div style={s.userAvatar}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
      )}
    </div>
  );
}

// ── Delayed skeleton — only renders after 450ms to avoid flash on text-only responses ──

function DelayedWidgetSkeleton({ toolName }: { toolName?: string }) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return <WidgetSkeleton toolName={toolName} />;
}

// ── Widget skeleton placeholder ────────────────────────────────────────────────

const TABLE_TOOLS = new Set([
  "get_user_apps","get_discovered_apps","run_sql_query","get_shadow_it",
  "get_unused_licenses","get_groups","get_licenses","get_contract_details",
  "get_duplicate_tools","search_apps",
]);
const CARD_TOOLS  = new Set(["get_org_stats","get_app_usage","get_compliance_summary"]);
const CHART_TOOLS = new Set(["get_spend_summary","get_spend_anomalies","get_renewal_forecast"]);

function WidgetSkeleton({ toolName }: { toolName?: string }) {
  const isTable = toolName && TABLE_TOOLS.has(toolName);
  const isCards = toolName && CARD_TOOLS.has(toolName);

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      {/* Header bar */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="skeleton" style={{ width: 140, height: 11, borderRadius: 6 }} />
        <div className="skeleton" style={{ width: 52, height: 22, borderRadius: 6 }} />
      </div>

      {isCards ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: 12 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ background: "#f8fafc", border: "1px solid #dbeafe", borderRadius: 10, padding: "12px 14px" }}>
              <div className="skeleton" style={{ width: "60%", height: 9, borderRadius: 4, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: "40%", height: 18, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      ) : isTable ? (
        <div>
          {/* Column headers */}
          <div style={{ display: "flex", gap: 0, padding: "8px 10px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
            {[90, 130, 80, 60].map((w, i) => (
              <div key={i} className="skeleton" style={{ width: w, height: 9, borderRadius: 4, marginRight: 24 }} />
            ))}
          </div>
          {/* Data rows */}
          {[0,1,2,3].map(i => (
            <div key={i} style={{ display: "flex", gap: 0, padding: "10px 10px", borderBottom: "1px solid #f3f4f6", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              {[90, 130, 80, 60].map((w, j) => (
                <div key={j} className="skeleton" style={{ width: w * (0.7 + Math.random() * 0.5), height: 9, borderRadius: 4, marginRight: 24 }} />
              ))}
            </div>
          ))}
          {/* Footer */}
          <div style={{ padding: "6px 10px", borderTop: "1px solid #f1f5f9" }}>
            <div className="skeleton" style={{ width: 70, height: 9, borderRadius: 4 }} />
          </div>
        </div>
      ) : (
        /* Chart skeleton — bars */
        <div style={{ padding: "16px 16px 12px", display: "flex", alignItems: "flex-end", gap: 6, height: 110 }}>
          {[55, 80, 45, 90, 60, 75, 40, 85].map((h, i) => (
            <div key={i} className="skeleton" style={{ flex: 1, height: h, borderRadius: "4px 4px 0 0" }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Action plan confirmation card ─────────────────────────────────────────────

function ActionConfirmCard({ plan, onStart, onDismiss }: { plan: ActionPlan; onStart: () => void; onDismiss: () => void }) {
  return (
    <div style={{ border: "1.5px solid #2563eb", borderRadius: 12, background: "#eff6ff", padding: "14px 16px", marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🖱</span>
        <span style={{ fontWeight: 700, color: "#1e40af", fontSize: 14 }}>Ready to act</span>
      </div>
      <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 10, fontWeight: 500 }}>{plan.label}</div>
      <div style={{ marginBottom: 14 }}>
        {plan.steps_preview.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 5 }}>
            <span style={{ color: "#2563eb", fontWeight: 700, fontSize: 11, minWidth: 18, marginTop: 1 }}>{i + 1}.</span>
            <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{step}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onStart}
          style={{ flex: 1, background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Start
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{ flex: 1, background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "9px 0", fontSize: 13, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Smart Onboarding card (Template-aware, with app management) ─────────────────

function SmartOnboardCard({
  plan,
  onAgentic,
  onInChat,
  onDismiss,
  onFollowUp,
}: {
  plan: ActionPlan;
  onAgentic: (updatedPlan: ActionPlan) => void;
  onInChat: (updatedPlan: ActionPlan) => void;
  onDismiss: () => void;
  onFollowUp: (text: string) => void;
}) {
  const template = plan.params?.template as any;
  const noTemplateFound = plan.params?.noTemplateFound as boolean;
  const role = plan.params?.role as string;
  const isRoleBasedWorkflow = plan.operation === 'create_role_based_onboard_workflow';

  const [extraAppsInput, setExtraAppsInput] = React.useState("");
  const [extraApps, setExtraApps] = React.useState<string[]>([]);
  const [removedApps, setRemovedApps] = React.useState<Set<string>>(new Set());
  const [showManualInput, setShowManualInput] = React.useState(false);
  const [manualAppsInput, setManualAppsInput] = React.useState("");

  const handleAddExtraApp = (input: string) => {
    if (!input.trim()) return;
    // Split by comma or "and"
    const parts = input
      .split(/,|\s+and\s+/i)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (parts.length > 0) {
      setExtraApps([...extraApps, ...parts]);
      setExtraAppsInput("");
    }
  };

  const handleRemoveTemplateApp = (appName: string) => {
    const next = new Set(removedApps);
    if (next.has(appName)) {
      next.delete(appName);
    } else {
      next.add(appName);
    }
    setRemovedApps(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, isManual: boolean) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isManual) {
        handleAddExtraApp(manualAppsInput);
        setManualAppsInput("");
      } else {
        handleAddExtraApp(extraAppsInput);
      }
    }
  };

  const mergeAndCallAgentic = () => {
    const templateApps = template?.apps?.map((a: any) => a.applicationName ?? a.vendor ?? a) ?? [];
    const activeTemplateApps = templateApps.filter((a: any) => !removedApps.has(a));
    const allApps = [...new Set([...activeTemplateApps, ...extraApps])];
    const updatedPlan = { ...plan, params: { ...plan.params, app_names: allApps } };
    onAgentic?.(updatedPlan);
  };

  const mergeAndCallInChat = () => {
    if (template) {
      const templateApps = template?.apps?.map((a: any) => a.applicationName ?? a.vendor ?? a) ?? [];
      const activeTemplateApps = templateApps.filter((a: any) => !removedApps.has(a));
      const allApps = [...new Set([...activeTemplateApps, ...extraApps])];
      const updatedPlan = { ...plan, params: { ...plan.params, app_names: allApps } };
      onInChat?.(updatedPlan);
    } else {
      // No template: use manually entered apps
      const parts = manualAppsInput
        .split(/,|\s+and\s+/i)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const allApps = [...new Set([...extraApps, ...parts])];
      const updatedPlan = { ...plan, params: { ...plan.params, app_names: allApps } };
      onInChat?.(updatedPlan);
    }
  };

  // ─── Template found case ─────────────────────────────────────────────────────
  if (template && !noTemplateFound) {
    const templateApps = template.apps?.map((a: any) => a.applicationName ?? a.vendor ?? a) ?? [];
    const activeTemplateApps = templateApps.filter((a: any) => !removedApps.has(a));

    return (
      <div style={{ border: "1.5px solid #2563eb", borderRadius: 12, background: "#eff6ff", padding: "14px 16px", marginTop: 4 }}>
        <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 10, fontWeight: 600 }}>
          Found onboarding template: <span style={{ color: "#2563eb" }}>{template.name}</span>
        </div>

        <div style={{ fontSize: 11, color: "#475569", marginBottom: 10, fontWeight: 500 }}>
          {plan.label}
        </div>

        {/* Template apps pills */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, fontWeight: 500 }}>Applications:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {activeTemplateApps.map((app: string) => (
              <div
                key={app}
                style={{
                  background: "#dbeafe",
                  color: "#0c4a6e",
                  padding: "5px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {app}
                <span
                  onClick={() => handleRemoveTemplateApp(app)}
                  style={{ cursor: "pointer", fontWeight: 700, fontSize: 12 }}
                >
                  ×
                </span>
              </div>
            ))}
          </div>

          {/* Add extra apps input */}
          <input
            type="text"
            placeholder="Add more apps (e.g., Zoom, Slack)"
            value={extraAppsInput}
            onChange={(e) => setExtraAppsInput(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, false)}
            onBlur={() => {
              if (extraAppsInput.trim()) handleAddExtraApp(extraAppsInput);
            }}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #bfdbfe",
              fontSize: 12,
              boxSizing: "border-box",
            }}
          />

          {/* Extra apps pills */}
          {extraApps.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {extraApps.map((app: string) => (
                <div
                  key={app}
                  style={{
                    background: "#fef08a",
                    color: "#713f12",
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {app}
                  <span
                    onClick={() => setExtraApps(extraApps.filter((a) => a !== app))}
                    style={{ cursor: "pointer", fontWeight: 700, fontSize: 12 }}
                  >
                    ×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
          {isRoleBasedWorkflow ? (
            <>
              <button
                type="button"
                onClick={() => onAgentic(plan)}
                style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                ⚙️ Create Automated Workflow
              </button>
              <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.4 }}>
                This will create an automated workflow with division-based conditions and the {role} template. You'll be able to review and configure it before saving.
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={mergeAndCallAgentic}
                style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                🖱 Agentic Onboarding
              </button>
              <button
                type="button"
                onClick={mergeAndCallInChat}
                style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                💬 In-Chat Onboarding
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDismiss}
            style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ─── No template found case ──────────────────────────────────────────────────
  if (noTemplateFound) {
    return (
      <div style={{ border: "1.5px solid #f97316", borderRadius: 12, background: "#fff7ed", padding: "14px 16px", marginTop: 4 }}>
        <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 10, fontWeight: 600 }}>
          No onboarding template found
        </div>

        <div style={{ fontSize: 11, color: "#475569", marginBottom: 12, lineHeight: 1.5 }}>
          No existing template for <strong>"{role}"</strong> role. You can create a template or specify apps manually.
        </div>

        {!showManualInput ? (
          <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
            <button
              type="button"
              onClick={() => onFollowUp(`create an onboarding template for ${role} role`)}
              style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              ✨ Create Template
            </button>
            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              style={{ background: "#e0e7ff", color: "#3730a3", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              📝 Specify Apps Manually
            </button>
            <button
              type="button"
              onClick={onDismiss}
              style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, fontWeight: 500 }}>Enter applications (comma-separated):</div>
            <input
              type="text"
              placeholder="e.g., Jira, Slack, Zoom"
              value={manualAppsInput}
              onChange={(e) => setManualAppsInput(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, true)}
              autoFocus
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid #fed7aa",
                fontSize: 12,
                boxSizing: "border-box",
                marginBottom: 10,
              }}
            />

            {/* Manual extra apps pills */}
            {extraApps.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {extraApps.map((app: string) => (
                  <div
                    key={app}
                    style={{
                      background: "#fef08a",
                      color: "#713f12",
                      padding: "5px 10px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {app}
                    <span
                      onClick={() => setExtraApps(extraApps.filter((a) => a !== app))}
                      style={{ cursor: "pointer", fontWeight: 700, fontSize: 12 }}
                    >
                      ×
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              <button
                type="button"
                onClick={mergeAndCallAgentic}
                style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                🖱 Agentic Onboarding
              </button>
              <button
                type="button"
                onClick={mergeAndCallInChat}
                style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                💬 In-Chat Onboarding
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowManualInput(false);
                  setManualAppsInput("");
                  setExtraApps([]);
                }}
                style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback (shouldn't happen, but just in case)
  return (
    <div style={{ border: "1.5px solid #2563eb", borderRadius: 12, background: "#eff6ff", padding: "14px 16px", marginTop: 4 }}>
      <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 12, fontWeight: 500 }}>{plan.label}</div>
      <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
        <button
          type="button"
          onClick={onAgentic}
          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          🖱 Agentic Onboarding
        </button>
        <button
          type="button"
          onClick={onInChat}
          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          💬 In-Chat Onboarding
        </button>
        <button
          type="button"
          onClick={onDismiss}
          style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Renders all widgets inline */
function WidgetGroup({
  widgets,
  token,
  runId,
  onMousePlan,
}: {
  widgets: WidgetDescriptor[];
  token: string;
  runId?: string | null;
  onMousePlan?: (plan: ActionPlan) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {widgets.map((w, i) => (
        <div key={i} className="msg-appear">
          <WidgetRenderer descriptor={w} token={token} runId={runId} onMousePlan={onMousePlan} />
        </div>
      ))}
    </div>
  );
}

// ── Tool label map ─────────────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  get_org_stats:           "Searching portfolio overview",
  get_discovered_apps:     "Searching app inventory",
  get_app_usage:           "Searching app usage",
  get_licenses:            "Searching license data",
  get_unused_licenses:     "Scanning unused seats",
  get_user_apps:           "Searching user apps",
  get_spend_summary:       "Calculating spend",
  get_spend_anomalies:     "Detecting anomalies",
  get_renewal_forecast:    "Checking renewals",
  get_shadow_it:           "Scanning shadow IT",
  get_compliance_summary:  "Checking compliance",
  get_duplicate_tools:     "Scanning duplicate tools",
  get_contract_details:    "Searching contracts",
  search_apps:             "Searching apps",
  get_groups:              "Searching groups",
};

// ── Conversational status messages ────────────────────────────────────────────
const TOOL_ACTION: Record<string, string> = {
  get_org_stats:          "your portfolio overview",
  get_discovered_apps:    "your connected apps",
  get_app_usage:          "app usage data",
  get_licenses:           "license details",
  get_unused_licenses:    "unused seats",
  get_user_apps:          "user app data",
  get_spend_summary:      "spend data",
  get_spend_anomalies:    "spend anomalies",
  get_renewal_forecast:   "upcoming renewals",
  get_shadow_it:          "shadow IT apps",
  get_compliance_summary: "compliance status",
  get_duplicate_tools:    "duplicate tools",
  get_contract_details:   "contract details",
  search_apps:            "matching apps",
  get_groups:             "group data",
};

const TOOL_BUILDING: Record<string, string> = {
  get_user_apps:           "Preparing your user table…",
  get_discovered_apps:     "Preparing your app list…",
  get_org_stats:           "Calculating your metrics…",
  get_spend_summary:       "Building your spend chart…",
  get_spend_anomalies:     "Analysing spend data…",
  get_renewal_forecast:    "Preparing your renewal timeline…",
  get_shadow_it:           "Preparing shadow IT results…",
  get_unused_licenses:     "Preparing license report…",
  get_groups:              "Preparing group data…",
  get_licenses:            "Preparing license details…",
  run_sql_query:           "Preparing your results…",
  get_compliance_summary:  "Preparing compliance report…",
  get_duplicate_tools:     "Preparing duplicate tools report…",
  get_app_usage:           "Preparing app usage data…",
  search_apps:             "Preparing search results…",
  get_contract_details:    "Preparing contract details…",
};

function getBuildingMessage(toolCalls: ToolCall[]): string {
  const lastName = toolCalls[toolCalls.length - 1]?.toolName;
  return TOOL_BUILDING[lastName] ?? "Building your answer…";
}

function getWorkingMessage(toolCalls: ToolCall[]): string {
  const running = toolCalls.filter(tc => tc.status === "running");
  if (running.length === 0) return "Got everything, putting your answer together…";
  if (running.length === 1) {
    const label = TOOL_ACTION[running[0].toolName] ?? "your data";
    return `Looking up ${label}…`;
  }
  return `Checking ${running.length} sources in parallel…`;
}

// ── AgentHarness — conversational working indicator ───────────────────────────

function AgentHarness({ toolCalls, status, done: responseDone }: { toolCalls?: ToolCall[]; status?: string; done?: boolean }) {
  const hasTools     = !!toolCalls && toolCalls.length > 0;
  const runningCount = hasTools ? toolCalls!.filter(tc => tc.status === "running").length : 0;
  const allToolsDone = hasTools && runningCount === 0;

  // Wall-clock timer: measures actual elapsed time from first render to response done
  const mountedAt = React.useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = React.useState(0);

  // Expanded while working; collapses to summary line when response is done
  const [expanded, setExpanded] = React.useState(true);
  React.useEffect(() => {
    if (responseDone) {
      setElapsedMs(Date.now() - mountedAt.current);
      setExpanded(false);
    }
  }, [responseDone]);

  const thoughtSecs = elapsedMs > 0 ? (elapsedMs / 1000).toFixed(1) : null;

  // ── Collapsed "Thought for Xs" summary ──
  if (responseDone && !expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} style={st.thoughtLine}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <span style={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>
          {thoughtSecs ? `Thought for ${thoughtSecs}s` : "Done thinking"}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    );
  }

  // ── Expanded step-by-step view ──
  return (
    <div style={st.harness}>
      {/* "I understood your question" — always shown as first step */}
      <div style={st.stepRow}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
        <span style={{ ...st.stepText, color: "#64748b" }}>I understood your question, working on it…</span>
        {!hasTools && (
          <span style={{ display: "inline-flex", gap: 3, alignItems: "center", marginLeft: 2 }}>
            {[0,150,300].map(d => <span key={d} className="dot-bounce" style={{ width: 3, height: 3, borderRadius: "50%", background: "#94a3b8", display: "inline-block", animationDelay: `${d}ms` }} />)}
          </span>
        )}
      </div>

      {/* One line per tool call — appears as each starts */}
      {hasTools && toolCalls!.map((tc) => {
        const done = tc.status === "done";
        const err  = tc.status === "error";
        const run  = tc.status === "running";
        return (
          <div key={tc.toolUseId} style={st.stepRow}>
            {/* status icon */}
            {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>}
            {err  && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}
            {run  && <span className="dot-spin" style={st.spinner} />}

            {/* label */}
            <span style={{ ...st.stepText, color: done ? "#64748b" : err ? "#ef4444" : "#1e293b", fontWeight: run ? 500 : 400 }}>
              {TOOL_LABELS[tc.toolName] ?? tc.toolName.replace(/_/g, " ")}
            </span>

            {/* result / timing */}
            {done && (
              <span style={st.stepMeta}>
                {tc.rowCount != null && tc.rowCount > 0 ? `${tc.rowCount} results` : tc.durationMs != null ? `${tc.durationMs}ms` : ""}
              </span>
            )}
            {err && <span style={{ ...st.stepMeta, color: "#ef4444" }}>failed</span>}

            {/* animated dots while running */}
            {run && (
              <span style={{ display: "inline-flex", gap: 3, alignItems: "center", marginLeft: 2 }}>
                {[0,150,300].map(d => <span key={d} className="dot-bounce" style={{ width: 3, height: 3, borderRadius: "50%", background: "#94a3b8", display: "inline-block", animationDelay: `${d}ms` }} />)}
              </span>
            )}
          </div>
        );
      })}

      {/* "Building answer" line once all tools done but LLM still writing */}
      {hasTools && allToolsDone && !responseDone && (
        <div style={st.stepRow}>
          <span className="dot-spin" style={st.spinner} />
          <span style={{ ...st.stepText, color: "#475569", fontWeight: 500 }}>
            {getBuildingMessage(toolCalls!)}
          </span>
        </div>
      )}

      {/* Collapse button when done */}
      {responseDone && (
        <button type="button" onClick={() => setExpanded(false)} style={st.collapseBtn}>
          {thoughtSecs ? `Thought for ${thoughtSecs}s` : "Done"} · hide
        </button>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  row:        { display: "flex", alignItems: "flex-start", gap: 8 },
  aiAvatar:   { width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #2563eb, #1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, boxShadow: "0 2px 6px rgba(37,99,235,0.3)" },
  userAvatar: { width: 30, height: 30, borderRadius: 9, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  userBubble: { background: "linear-gradient(135deg, #2563eb, #1d4ed8)", color: "#fff", borderRadius: "16px 4px 16px 16px", padding: "11px 15px", fontSize: 14, lineHeight: 1.65, boxShadow: "0 2px 8px rgba(37,99,235,0.25)" },
  aiBubble:   { background: "#fff", color: "#0f172a", borderRadius: "4px 16px 16px 16px", padding: "11px 15px", fontSize: 14, lineHeight: 1.65, border: "1px solid #e2e8f0", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  followUpWrap:  { marginTop: 6 },
  followUpLabel: { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 },
  followUpList:  { display: "flex", flexDirection: "column", gap: 8 },
  chip: {
    background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10,
    padding: "10px 14px", fontSize: 13, color: "#1e40af", cursor: "pointer",
    textAlign: "left", width: "100%", display: "flex", alignItems: "center",
    gap: 10, fontWeight: 400, lineHeight: 1.5,
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)", transition: "border-color 0.15s, background 0.15s",
  },
  chipArrow: { color: "#2563eb", fontWeight: 700, fontSize: 16, flexShrink: 0 },
};

const st: Record<string, React.CSSProperties> = {
  // Outer wrapper — no border, just spacing
  harness:    { display: "flex", flexDirection: "column", gap: 5, marginBottom: 4 },

  // Each step line — flat, inline, like Cursor
  stepRow:    { display: "flex", alignItems: "center", gap: 8, minHeight: 22 },
  stepText:   { fontSize: 13, flex: 1, lineHeight: 1.4 },
  stepMeta:   { fontSize: 11, color: "#94a3b8", fontStyle: "italic", flexShrink: 0 },
  spinner:    { width: 11, height: 11, border: "1.5px solid #e2e8f0", borderTopColor: "#6366f1", borderRadius: "50%", display: "inline-block", flexShrink: 0 } as React.CSSProperties,

  // "Thought for Xs" collapsed summary line
  thoughtLine: {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: "none", border: "none", cursor: "pointer",
    padding: "2px 0", marginBottom: 4,
  },

  // "hide" link after done
  collapseBtn: {
    background: "none", border: "none", padding: "2px 0",
    fontSize: 11, color: "#94a3b8", cursor: "pointer",
    textAlign: "left", fontStyle: "italic",
  },
};
