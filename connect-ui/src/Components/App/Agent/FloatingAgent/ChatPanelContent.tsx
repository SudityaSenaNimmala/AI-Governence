import React, { useEffect, useRef, useState } from "react";
import { useChat, type ChatSession } from "./hooks/useChat";
import ChatInput from "./ChatInput";
import MessageBubble from "./MessageBubble";
import { fetchTemplates } from "./lib/api";

import type { ActionPlan } from "./mouseAgent/types";

interface MouseAgentPause {
  message: string;
  onDone: () => void;
  onStop: () => void;
}

interface Props { token: string; onClose?: () => void; onExpand?: () => void; isExpanded?: boolean; userName?: string; onSetName?: (name: string) => void; prefillText?: string; onPrefillConsumed?: () => void; autoSendText?: string; onAutoSendConsumed?: () => void; onActionStart?: (plan: ActionPlan, messageId: string) => void; onInChatOnboard?: (plan: ActionPlan, messageId: string) => void; mouseAgentPause?: MouseAgentPause | null; }

const STARTERS: { label: string; sub: string }[] = [
  { label: "Total users",         sub: "How many users do I have?" },
  { label: "Connected apps",      sub: "Show all connected apps" },
  { label: "License waste",       sub: "Which licenses are unused?" },
  { label: "SaaS spend",          sub: "What is my total spend?" },
  { label: "Users per vendor",    sub: "Breakdown by application" },
  { label: "Renewals",            sub: "What contracts renew soon?" },
];

function relativeDate(dateStr: string): string {
  const d    = new Date(dateStr);
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0)  return "Today";
  if (diff === 1)  return "Yesterday";
  if (diff <= 7)   return "Previous 7 days";
  if (diff <= 30)  return "Previous 30 days";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ── Beta config — controlled via VITE_AGENT_BETA in .env ──────────────────────
// Set VITE_AGENT_BETA=true to show Beta label + disclaimer banner
// Set VITE_AGENT_BETA=false (or remove) to hide both
const BETA_ENABLED = true;

// Dismissal is keyed to the current auth token — so it persists across refreshes
// within the same login session, but resets automatically on re-login (new token).
function getBetaDismissedKey(): string {
  const token = localStorage.getItem('bToken') ?? '';
  return 'cf_beta_dismissed_' + token.slice(-24);
}
function groupSessions(sessions: ChatSession[]): { label: string; items: ChatSession[] }[] {
  const groups: Record<string, ChatSession[]> = {};
  for (const s of sessions) {
    const label = relativeDate(s.updatedAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

export default function ChatPanelContent({ token, onClose, onExpand, isExpanded, userName, onSetName, prefillText, onPrefillConsumed, autoSendText, onAutoSendConsumed, onActionStart, onInChatOnboard, mouseAgentPause }: Props) {
  const {
    messages,
    isStreaming,
    restoring,
    sessions,
    sessionsLoading,
    sendMessage,
    startNewChat,
    loadSession,
    deleteSession,
    refreshSessions,
    markActionPlanExecuted,
  } = useChat();
  const [view, setView]           = useState<"chat" | "history">("chat");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [agentSteps, setAgentSteps] = useState<{ label: string; startTime: number }[]>([]);
  const [agentStepStatus, setAgentStepStatus] = useState<"idle" | "executing" | "paused" | "done" | "error">("idle");
  const [agentCurrentLabel, setAgentCurrentLabel] = useState("");

  // In-chat onboarding state
  const [inchatOnboardState, setInchatOnboardState] = useState<"idle" | "loading" | "ready" | "running" | "done" | "error">("idle");
  const [inchatTemplate, setInchatTemplate] = useState<any>(null);
  const [inchatPlan, setInchatPlan] = useState<ActionPlan | null>(null);
  const [inchatMessageId, setInchatMessageId] = useState<string | null>(null);

  // Beta banner: dismissed state is keyed to the auth token.
  // - Same login session + page refresh → stays dismissed (sessionStorage persists)
  // - Re-login (new token) → new key → banner shows again automatically
  const [showBeta, setShowBeta] = useState<boolean>(
    BETA_ENABLED && !sessionStorage.getItem(getBetaDismissedKey())
  );

  function dismissBeta() {
    sessionStorage.setItem(getBetaDismissedKey(), "1");
    setShowBeta(false);
  }

  // In-chat onboarding handler
  async function handleInChatOnboard(plan: ActionPlan, messageId: string) {
    setInchatOnboardState("loading");
    setInchatPlan(plan);
    setInchatMessageId(messageId);

    try {
      // If backend already found a template (smart lookup), use it directly
      if (plan.params?.template) {
        setInchatTemplate(plan.params.template);
        setInchatOnboardState("ready");
        return;
      }

      // Otherwise, fetch templates (fallback for legacy behavior)
      const role = plan.params?.role || '';
      const { matched, all } = await fetchTemplates(role);
      const templates = matched.length > 0 ? matched : all;

      if (templates.length === 0) {
        setInchatOnboardState("error");
        return;
      }

      // Use the first matched/all template
      setInchatTemplate(templates[0]);
      setInchatOnboardState("ready");
    } catch (err) {
      console.error('[inchat] template fetch error:', err);
      setInchatOnboardState("error");
    }
  }

  // Run the in-chat onboarding workflow
  async function handleRunInchatWorkflow() {
    if (!inchatPlan) return;

    setInchatOnboardState("running");

    try {
      const email = inchatPlan.params?.email;
      if (!email) throw new Error("Email is required");

      // Use plan.params.app_names if available (merged from SmartOnboardCard)
      // Otherwise, extract from inchatTemplate
      let apps: any[];
      if (Array.isArray(inchatPlan.params?.app_names) && inchatPlan.params.app_names.length > 0) {
        // Apps are already specified in the plan (from merged selection)
        apps = inchatPlan.params.app_names.map((appName: string) => ({
          applicationName: appName,
          vendor: appName,
        }));
      } else if (inchatTemplate) {
        // Fallback: extract from template
        apps = (inchatTemplate.mandatoryApplications || inchatTemplate.workFlowApplications || []).map((app: any) => ({
          applicationName: app.applicationName || app.vendor || app,
          vendor: app.vendor || app.applicationName || app,
          adminCloudId: app.adminCloudId,
          adminMemberId: app.adminMemberId,
        }));
      } else {
        throw new Error("No applications specified");
      }

      const token = localStorage.getItem('bToken') || '';
      const resp = await fetch('/api/agent/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'run_inchat_onboard',
          payload: { email, apps },
        }),
      });

      if (!resp.ok) {
        const error = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP ${resp.status}`);
      }

      const result = await resp.json();
      if (result.success) {
        setInchatOnboardState("done");
        // Auto-reset after 3 seconds
        setTimeout(() => {
          setInchatOnboardState("idle");
          setInchatTemplate(null);
          setInchatPlan(null);
          setInchatMessageId(null);
        }, 3000);
      } else {
        throw new Error(result.error || "Action failed");
      }
    } catch (err) {
      console.error('[inchat] workflow execution error:', err);
      setInchatOnboardState("error");
    }
  }

  const bottomRef = useRef<HTMLDivElement>(null);

  // Listen for agent step updates
  useEffect(() => {
    function handleStepUpdate(e: Event) {
      const { steps, status, currentLabel } = (e as CustomEvent).detail;
      setAgentSteps(steps);
      setAgentStepStatus(status);
      setAgentCurrentLabel(currentLabel);
    }

    window.addEventListener('agent-step-update', handleStepUpdate);
    return () => window.removeEventListener('agent-step-update', handleStepUpdate);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Auto-send proactive question into the current (restored) session
  useEffect(() => {
    if (!autoSendText || isStreaming || restoring) return;
    onAutoSendConsumed?.();
    sendMessage(autoSendText);
  }, [autoSendText, restoring]);

  const needsName = !userName && messages.length === 0;

  function submitName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    onSetName?.(trimmed);
    setNameInput("");
  }

  const isEmpty = messages.length === 0;
  const grouped = groupSessions(sessions);

  return (
    <div style={s.panel}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          {view === "history" ? (
            <button type="button" style={s.iconBtn} onClick={() => setView("chat")} title="Back">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          ) : (
            <div style={s.avatar}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
            </div>
          )}
          <div>
            <div style={{ ...s.title, display: "flex", alignItems: "center", gap: 6 }}>
              {view === "history" ? "Chat History" : "Manage AI"}
              {view === "chat" && BETA_ENABLED && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 4, padding: "1px 6px", letterSpacing: "0.05em" }}>
                  BETA
                </span>
              )}
            </div>
            {view === "chat" && (
              <div style={s.subtitle}>
                <span style={{ ...s.dot, background: isStreaming ? "#60a5fa" : "#4ade80", boxShadow: isStreaming ? "0 0 6px #60a5fa" : "0 0 6px #4ade80" }} />
                {isStreaming ? "Thinking…" : "Online"}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {view === "chat" && (
            <button type="button" style={s.iconBtn} onClick={() => { setView("history"); refreshSessions({ silent: true }); }} title="History">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
            </button>
          )}
          <button type="button" style={s.iconBtn} onClick={() => { startNewChat(); setView("chat"); }} title="New chat">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          {onExpand && (
            <button type="button" style={s.iconBtn} onClick={onExpand} title={isExpanded ? "Collapse" : "Expand"}>
              {isExpanded ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                  <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              )}
            </button>
          )}
          {onClose && (
            <button type="button" style={s.iconBtn} onClick={onClose} title="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Beta disclaimer banner — once per session, dismissible */}
      {showBeta && view === "chat" && (
        <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", padding: "9px 14px", display: "flex", alignItems: "flex-start", gap: 10, flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span style={{ fontSize: 11.5, color: "#92400e", lineHeight: 1.5, flex: 1 }}>
            This agent is in Beta. It may occasionally return incorrect or incomplete information. Always verify important figures directly in the dashboard before taking action.
          </span>
          <button type="button" onClick={dismissBeta} style={{ background: "none", border: "none", cursor: "pointer", color: "#d97706", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0, marginTop: -1 }}>×</button>
        </div>
      )}

      {/* History view */}
      {view === "history" ? (
        <div style={s.historyPanel}>
          {sessionsLoading && sessions.length === 0 ? (
            <div style={s.emptyHistory}>
              <div style={{ fontSize: 13, color: "#64748b" }}>Loading conversations…</div>
            </div>
          ) : sessions.length === 0 ? (
            <div style={s.emptyHistory}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>💬</div>
              <div style={{ fontWeight: 700, color: "#1e293b", marginBottom: 6, fontSize: 15 }}>No conversations yet</div>
              <div style={{ fontSize: 13, color: "#94a3b8" }}>Start a new chat to begin</div>
            </div>
          ) : (
            grouped.map(({ label, items }) => (
              <div key={label} style={{ marginBottom: 4 }}>
                <div style={s.groupLabel}>{label}</div>
                {items.map(session => (
                  <div
                    key={session.sessionId}
                    style={{ ...s.sessionRow, background: hoveredId === session.sessionId ? "#eff6ff" : "transparent" }}
                    onMouseEnter={() => setHoveredId(session.sessionId)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => { loadSession(session.sessionId); setView("chat"); }}
                  >
                    <div style={s.sessionIcon}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </div>
                    <div style={s.sessionTitle}>{session.title}</div>
                    <button
                      type="button"
                      style={{ ...s.deleteBtn, opacity: hoveredId === session.sessionId ? 1 : 0 }}
                      title="Delete"
                      onClick={e => { e.stopPropagation(); void deleteSession(session.sessionId); }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div style={s.chatShell}>
            <div style={s.chatCol}>
              <div style={s.messages}>
                {needsName ? (
                  <div style={s.emptyState}>
                    <div style={s.welcomeCard}>
                      <div style={s.welcomeIconWrap}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                      </div>
                      <div style={s.welcomeTitle}>Hi there! I'm <span style={{ color: "#2563eb" }}>Manage AI</span></div>
                      <div style={s.welcomeSubtitle}>Your SaaS management assistant. What should I call you?</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                        <input
                          autoFocus
                          value={nameInput}
                          onChange={e => setNameInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && submitName()}
                          placeholder="Enter your name…"
                          style={s.nameInput}
                        />
                        <button type="button" onClick={submitName} style={{ ...s.nameBtn, background: nameInput.trim() ? "#2563eb" : "#e2e8f0", cursor: nameInput.trim() ? "pointer" : "default" }}>
                          →
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSetName?.("there")}
                        style={{ marginTop: 10, background: "none", border: "none", color: "#94a3b8", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                ) : restoring ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 10 }}>
                    <style>{`@keyframes cf-restore-spin{to{transform:rotate(360deg)}}`}</style>
                    <div style={{ width: 28, height: 28, border: "3px solid #e2e8f0", borderTopColor: "#2563eb", borderRadius: "50%", animation: "cf-restore-spin 0.7s linear infinite" }} />
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>Loading conversation…</div>
                  </div>
                ) : isEmpty ? (
                  <div style={s.emptyState}>
                    {/* AI bubble */}
                    <div style={s.welcomeRow}>
                      <div style={s.aiAvatar}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                      </div>
                      <div style={s.welcomeBubble}>
                        <div style={{ marginBottom: 10, fontSize: 14, color: "#0f172a" }}>
                          {userName && userName !== "there" ? `Welcome back, ${userName}! ` : userName === "there" ? "Hey there! " : ""}I'm <strong>Manage AI</strong>, your SaaS management assistant.
                        </div>
                        <div style={{ marginBottom: 8, fontSize: 13, color: "#374151" }}>Here's what I can help you with:</div>
                        <div style={s.featureList}>
                          {[
                            ["Spend & Costs", "total SaaS spend, anomalies, savings", "Show me the total SaaS spend"],
                            ["Users", "active/inactive users, offboarding", "Show active and inactive users"],
                            ["Licenses", "utilization, waste, billable vs licensed", "Show license utilization and waste"],
                            ["Apps & Vendors", "connected tools, shadow IT, duplicates", "Show connected apps and shadow IT"],
                            ["Compliance", "policy violations, MFA issues", "Show compliance and policy violations"],
                            ["Renewals", "upcoming contracts and risk", "Show upcoming contract renewals"],
                          ].map(([label, desc, query]) => (
                            <div
                              key={label}
                              style={{ ...s.featureItem, cursor: "pointer", borderRadius: 8, padding: "4px 6px", margin: "0 -6px", transition: "background 0.15s" }}
                              onClick={() => sendMessage(query)}
                              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = "#eff6ff"}
                              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = "transparent"}
                            >
                              <span style={s.featureDot} />
                              <span style={{ fontSize: 13, color: "#374151" }}><strong>{label}</strong> — {desc}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>What would you like to explore?</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map(msg => (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        token={token}
                        onFollowUp={sendMessage}
                        onActionStart={(plan, messageId) => {
                          markActionPlanExecuted(messageId);
                          onActionStart?.(plan, messageId);
                        }}
                        onActionDismiss={markActionPlanExecuted}
                        onInChatOnboard={handleInChatOnboard}
                      />
                    ))}
                    {/* In-Chat Onboarding Card */}
                    {inchatOnboardState !== "idle" && inchatPlan && (
                      <div style={{ fontSize: 13, color: "#64748b", margin: "8px 0" }}>
                        {inchatOnboardState === "loading" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <style>{`@keyframes cf-template-spin{to{transform:rotate(360deg)}}`}</style>
                            <div style={{ width: 16, height: 16, border: "2px solid #e2e8f0", borderTopColor: "#2563eb", borderRadius: "50%", animation: "cf-template-spin 0.7s linear infinite" }} />
                            <span>Loading templates…</span>
                          </div>
                        )}
                        {inchatOnboardState === "error" && (
                          <div style={{ color: "#dc2626", fontWeight: 500 }}>
                            ❌ Failed to load templates. Please try again.
                          </div>
                        )}
                        {inchatOnboardState === "ready" && inchatTemplate && (
                          <div style={{
                            background: "#fff",
                            border: "1px solid #dbeafe",
                            borderRadius: 12,
                            padding: "14px 16px",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                          }}>
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Template Preview</div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", marginBottom: 6 }}>
                                {inchatTemplate.templetName || "Workflow Template"}
                              </div>
                              <div style={{ fontSize: 13, color: "#475569", marginBottom: 8 }}>
                                Onboarding <strong>{inchatPlan.params?.email}</strong>
                              </div>
                              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                                Apps to provision:
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                                {(inchatTemplate.mandatoryApplications || inchatTemplate.workFlowApplications || []).map((app: any, idx: number) => (
                                  <div key={idx} style={{ fontSize: 12, color: "#334155", padding: "6px 10px", background: "#f1f5f9", borderRadius: 6 }}>
                                    • {app.applicationName || app.vendor || app}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={() => handleRunInchatWorkflow()}
                                style={{
                                  flex: 1,
                                  background: "#2563eb",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 8,
                                  padding: "8px 0",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                Run Workflow
                              </button>
                              <button
                                onClick={() => {
                                  setInchatOnboardState("idle");
                                  setInchatTemplate(null);
                                  setInchatPlan(null);
                                  setInchatMessageId(null);
                                }}
                                style={{
                                  background: "#f1f5f9",
                                  color: "#64748b",
                                  border: "none",
                                  borderRadius: 8,
                                  padding: "8px 14px",
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        {inchatOnboardState === "running" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <style>{`@keyframes cf-running-spin{to{transform:rotate(360deg)}}`}</style>
                            <div style={{ width: 16, height: 16, border: "2px solid #e2e8f0", borderTopColor: "#2563eb", borderRadius: "50%", animation: "cf-running-spin 0.7s linear infinite" }} />
                            <span>Provisioning…</span>
                          </div>
                        )}
                        {inchatOnboardState === "done" && (
                          <div style={{ color: "#16a34a", fontWeight: 600 }}>
                            ✓ Onboarding completed successfully!
                          </div>
                        )}
                      </div>
                    )}
                    {/* Agent step progress display */}
                    {agentStepStatus !== "idle" && agentSteps.length > 0 && (
                      <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6, margin: "8px 0" }}>
                        {agentStepStatus === "paused" ? (
                          <div style={{ color: "#2563eb" }}>⏸ Waiting for you to complete the action...</div>
                        ) : (
                          <>
                            {agentSteps.map((step, i) => {
                              const isLast = i === agentSteps.length - 1;
                              const isActive = isLast && agentStepStatus === "executing";
                              const isDone = !isActive && agentStepStatus !== "executing";

                              return (
                                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: i < agentSteps.length - 1 ? 4 : 0 }}>
                                  {isDone ? (
                                    <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                                  ) : isActive ? (
                                    <span style={{ display: "inline-block", animation: "cf-spin 1s linear infinite", transformOrigin: "center" }}>⟳</span>
                                  ) : (
                                    <span style={{ color: "#cbd5e1" }}>◦</span>
                                  )}
                                  <span style={{ color: isActive ? "#2563eb" : isDone ? "#64748b" : "#64748b", fontWeight: isActive ? 600 : 400 }}>
                                    {step.label}
                                  </span>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </>
                )}
              </div>
              {/* ── Mouse agent pause card — shown above input when agent needs user action ── */}
              {mouseAgentPause && (
                <div style={{
                  margin: '0 10px 8px',
                  background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                  border: '1.5px solid #93c5fd',
                  borderRadius: 14,
                  padding: '12px 14px',
                  animation: 'cf-agent-fadein 0.2s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {/* Pulsing dot */}
                    <div style={{ marginTop: 2, flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563eb', boxShadow: '0 0 0 3px rgba(37,99,235,0.2)', animation: 'cf-comet-pulse 1.6s ease-in-out infinite' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action Required</div>
                      <div style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.5 }}>{mouseAgentPause.message}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      onClick={mouseAgentPause.onDone}
                      style={{ flex: 1, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Done, continue
                    </button>
                    <button
                      onClick={mouseAgentPause.onStop}
                      style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 10, padding: '8px 14px', fontSize: 12, cursor: 'pointer' }}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              )}
              <ChatInput onSend={sendMessage} disabled={isStreaming || !!mouseAgentPause} draftText={prefillText} onDraftConsumed={onPrefillConsumed} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  panel:        { display: "flex", flexDirection: "column", height: "100%", background: "#f8fafc", fontFamily: "inherit" },

  // Header
  header:       { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "linear-gradient(135deg, #0d1f6e 0%, #1e3a8a 100%)", flexShrink: 0, boxShadow: "0 2px 8px rgba(13,31,110,0.3)" },
  headerLeft:   { display: "flex", alignItems: "center", gap: 10 },
  avatar:       { width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center" },
  title:        { fontWeight: 700, fontSize: 14, color: "#fff", letterSpacing: "0.01em" },
  subtitle:     { fontSize: 11, color: "rgba(255,255,255,0.65)", display: "flex", alignItems: "center", gap: 5, marginTop: 2 },
  dot:          { width: 6, height: 6, borderRadius: "50%", display: "inline-block", transition: "background 0.3s" },
  iconBtn:      { width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" },

  // History
  historyPanel: { flex: 1, overflowY: "auto", padding: "10px 8px", background: "#f8fafc" },
  emptyHistory: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", padding: 40 },
  groupLabel:   { fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", padding: "8px 10px 4px" },
  sessionRow:   { display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, cursor: "pointer", transition: "background 0.12s", marginBottom: 2 },
  sessionIcon:  { width: 26, height: 26, borderRadius: 7, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sessionTitle: { flex: 1, fontSize: 13, color: "#334155", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" },
  deleteBtn:    { border: "none", cursor: "pointer", padding: "5px 7px", flexShrink: 0, display: "flex", alignItems: "center", borderRadius: 7, background: "#fee2e2", transition: "opacity 0.15s" },

  // Chat layout
  chatShell:    { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" },
  chatCol:      { display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", flex: 1 },
  messages:     { flex: 1, overflowY: "auto", overflowX: "hidden", padding: "20px 14px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 },

  // Welcome / empty
  emptyState:      { display: "flex", flexDirection: "column", gap: 14, width: "100%" },
  welcomeRow:      { display: "flex", alignItems: "flex-start", gap: 10 },
  aiAvatar:        { width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, boxShadow: "0 2px 6px rgba(37,99,235,0.3)" },
  welcomeBubble:   { background: "#fff", border: "1px solid #e2e8f0", borderRadius: "4px 16px 16px 16px", padding: "14px 16px", flex: 1, boxShadow: "0 1px 4px rgba(0,0,0,0.05)" },
  featureList:     { display: "flex", flexDirection: "column", gap: 6 },
  featureItem:     { display: "flex", alignItems: "flex-start", gap: 8 },
  featureDot:      { width: 6, height: 6, borderRadius: "50%", background: "#2563eb", flexShrink: 0, marginTop: 5 },
  nameInput:       { flex: 1, border: "1.5px solid #dbeafe", borderRadius: 10, padding: "9px 12px", fontSize: 13, outline: "none", color: "#0f172a", background: "#f8fafc" },
  nameBtn:         { border: "none", borderRadius: 10, padding: "9px 16px", color: "#fff", fontSize: 14, fontWeight: 700, transition: "background 0.15s" },

  // Starter cards
  starterGrid:  { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  starterCard:  { background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", transition: "border-color 0.15s" },
  starterLabel: { fontSize: 13, fontWeight: 700, color: "#1e40af", marginBottom: 4 },
  starterSub:   { fontSize: 11, color: "#94a3b8", lineHeight: 1.4 },

};
