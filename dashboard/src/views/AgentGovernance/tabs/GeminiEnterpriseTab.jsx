import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Sparkles, RefreshCw, Settings2, Bot, MessageSquare, FileText, Activity,
  ExternalLink, Users, Database, ChevronRight, ChevronDown, Search,
} from "lucide-react";
import { useAgentAuth, GEMINI_ENTERPRISE_TOKEN_SENTINEL } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { LoadingSpinner } from "../common/LoadingSpinner";
import { StatCard } from "../common/StatCard";
import { Badge } from "../common/Badge";

const GE_COLOR = "#886FBF";

function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtRelative(ts) {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  if (isNaN(d)) return "—";
  const diff = Date.now() - d;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(ts);
}

const SUB_TABS = [
  { id: "agents", label: "Agents", icon: <Bot size={14} /> },
  { id: "chats", label: "Chats", icon: <MessageSquare size={14} /> },
  { id: "knowledge", label: "Knowledge Files", icon: <FileText size={14} /> },
  { id: "activity", label: "File Activity", icon: <Activity size={14} /> },
];

export function GeminiEnterpriseTab({ onOpenConnect }) {
  const { geminiEnterpriseKeyId } = useAgentAuth();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState("agents");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!geminiEnterpriseKeyId) return;
    setStatus("loading");
    setError(null);
    try {
      let res;
      if (geminiEnterpriseKeyId === GEMINI_ENTERPRISE_TOKEN_SENTINEL) {
        const conn = JSON.parse(localStorage.getItem("ag_gemini_enterprise_token_conn") || "{}");
        res = await agentGovernanceApi.previewGeminiEnterprise(conn);
      } else {
        res = await agentGovernanceApi.fetchGeminiEnterpriseData(geminiEnterpriseKeyId);
      }
      setData(res);
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Gemini Enterprise data");
      setStatus("error");
    }
  }, [geminiEnterpriseKeyId]);

  useEffect(() => { load(); }, [load]);

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!geminiEnterpriseKeyId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: `${GE_COLOR}18`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <Sparkles size={32} color={GE_COLOR} />
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--ag-text-primary)" }}>Connect Gemini Enterprise</h3>
        <p style={{ maxWidth: 440, color: "var(--ag-text-secondary)", fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          Connect your Gemini Enterprise app (business.gemini.google) to discover the agents created in it —
          including NotebookLM, Deep Research and custom agents — along with their chats, knowledge files and file activity.
        </p>
        <button onClick={onOpenConnect} className="ag_btn_primary" style={{ background: GE_COLOR, padding: "10px 24px", fontSize: 14 }}>
          <Sparkles size={16} /> Connect Gemini Enterprise
        </button>
      </div>
    );
  }

  const agents = data?.agents || [];
  const chats = data?.chats || [];
  const knowledge = data?.knowledge || [];
  const files = data?.files || [];
  const fileActivity = data?.fileActivity || [];
  const totalKnowledgeSources = knowledge.reduce((s, k) => s + (k.sources?.length || 0), 0);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return { agents, chats, files, fileActivity };
    return {
      agents: agents.filter((a) => `${a.displayName} ${a.description} ${a.type}`.toLowerCase().includes(q)),
      chats: chats.filter((c) => `${c.displayName} ${c.userName} ${c.messages?.map((m) => m.content).join(" ")}`.toLowerCase().includes(q)),
      files: files.filter((f) => `${f.fileName} ${f.filePath}`.toLowerCase().includes(q)),
      fileActivity: fileActivity.filter((e) => `${e.target} ${e.operation} ${e.user}`.toLowerCase().includes(q)),
    };
  }, [q, agents, chats, files, fileActivity]);

  return (
    <div>
      {/* Sub-header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={18} color={GE_COLOR} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ag-text-primary)" }}>
              {data?.engine?.displayName || "Gemini Enterprise"}
            </div>
            <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>
              App {data?.engine?.id || "—"} · {data?.engine?.location || "global"}
              {data?.engine?.consoleUrl && (
                <a href={data.engine.consoleUrl} target="_blank" rel="noreferrer" style={{ color: GE_COLOR, marginLeft: 8, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  Open <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} disabled={status === "loading"} className="ag_btn_primary" style={{ background: GE_COLOR }}>
            <RefreshCw size={13} style={status === "loading" ? { animation: "agSpin 1s linear infinite" } : undefined} />
            {status === "loading" ? "Loading..." : "Refresh"}
          </button>
          <button onClick={onOpenConnect} className="ag_btn_secondary">
            <Settings2 size={13} /> Settings
          </button>
        </div>
      </div>

      {data?.warnings?.length > 0 && (
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "8px 12px", marginBottom: 16, fontSize: 12, color: "#b45309" }}>
          {data.warnings.slice(0, 4).map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* Stat row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Agents" value={agents.length} color={GE_COLOR} icon={<Bot size={20} />} />
        <StatCard label="Chats" value={chats.length} color="#1A73E8" icon={<MessageSquare size={20} />} />
        <StatCard label="Knowledge Files" value={files.length} color="#0F9D58" sub={`${totalKnowledgeSources} source(s)`} icon={<FileText size={20} />} />
        <StatCard label="Activity Events" value={fileActivity.length} color="#F9AB00" icon={<Activity size={20} />} />
      </div>

      {/* Sub-tabs + search */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SUB_TABS.map((t) => {
            const counts = { agents: agents.length, chats: chats.length, knowledge: files.length, activity: fileActivity.length };
            const active = subTab === t.id;
            return (
              <button key={t.id} onClick={() => setSubTab(t.id)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${active ? GE_COLOR : "var(--ag-border)"}`,
                  background: active ? `${GE_COLOR}14` : "var(--ag-bg-card)",
                  color: active ? GE_COLOR : "var(--ag-text-secondary)",
                }}>
                {t.icon} {t.label}
                <span style={{ background: active ? GE_COLOR : "var(--ag-border)", color: active ? "#fff" : "var(--ag-text-secondary)", borderRadius: 99, fontSize: 11, padding: "1px 7px" }}>{counts[t.id]}</span>
              </button>
            );
          })}
        </div>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ag-text-secondary)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
            className="ag_form_input" style={{ paddingLeft: 30, width: 220, height: 34, fontSize: 13 }} />
        </div>
      </div>

      {/* Body */}
      {status === "loading" && !data && <LoadingSpinner message="Fetching Gemini Enterprise data..." />}
      {status === "error" && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "16px 18px", color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {status !== "error" && data && (
        <>
          {subTab === "agents" && <AgentsView agents={filtered.agents} />}
          {subTab === "chats" && <ChatsView chats={filtered.chats} />}
          {subTab === "knowledge" && <KnowledgeView knowledge={knowledge} files={filtered.files} />}
          {subTab === "activity" && <ActivityView events={filtered.fileActivity} />}
        </>
      )}
    </div>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────────────

function EmptyState({ icon, message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 48, color: "var(--ag-text-secondary)" }}>
      <div style={{ opacity: 0.4, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{message}</div>
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
      {children}
    </div>
  );
}

function AgentsView({ agents }) {
  if (!agents.length) return <EmptyState icon={<Bot size={40} />} message="No agents found in this Gemini Enterprise app." />;
  return (
    <div>
      {agents.map((a) => (
        <Card key={a.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${GE_COLOR}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {a.icon ? <img src={a.icon} alt="" style={{ width: 22, height: 22 }} /> : <Bot size={20} color={GE_COLOR} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ag-text-primary)" }}>{a.displayName}</div>
                {a.description && <div style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginTop: 2 }}>{a.description}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge text={a.type} color={GE_COLOR} />
                  {a.assistant && a.assistant !== "default_assistant" && <Badge text={a.assistant} color="#1A73E8" />}
                  {a.dataStoreIds?.length > 0 && <span style={{ fontSize: 11, color: "var(--ag-text-secondary)", display: "inline-flex", alignItems: "center", gap: 3 }}><Database size={11} /> {a.dataStoreIds.length} data store(s)</span>}
                  {a.starterPrompts?.length > 0 && <span style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>{a.starterPrompts.length} starter prompt(s)</span>}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <Badge text={a.state || "ENABLED"} color={a.state === "DISABLED" ? "#ef4444" : "#22c55e"} />
              <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 6 }}>Created {fmtDate(a.createTime)}</div>
              {a.updateTime && <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>Updated {fmtRelative(a.updateTime)}</div>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ChatsView({ chats }) {
  const [expanded, setExpanded] = useState(null);
  if (!chats.length) return <EmptyState icon={<MessageSquare size={40} />} message="No chats found. Sessions appear here once users interact with the app." />;
  return (
    <div>
      {chats.map((c) => {
        const open = expanded === c.id;
        return (
          <Card key={c.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={() => setExpanded(open ? null : c.id)}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                {open ? <ChevronDown size={16} color="var(--ag-text-secondary)" /> : <ChevronRight size={16} color="var(--ag-text-secondary)" />}
                <MessageSquare size={18} color="#1A73E8" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)" }}>{c.displayName}</div>
                  <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Users size={11} /> {c.userName}</span>
                    <span>{c.turnCount} turn(s)</span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {c.state && c.state !== "STATE_UNSPECIFIED" && <Badge text={c.state} color="#1A73E8" />}
                <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 4 }}>{fmtRelative(c.updatedAt)}</div>
              </div>
            </div>
            {open && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--ag-border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {(c.messages || []).length === 0 && <div style={{ fontSize: 12, color: "var(--ag-text-secondary)" }}>No message content available for this session.</div>}
                {(c.messages || []).map((m) => (
                  <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "85%", padding: "8px 12px", borderRadius: 10, fontSize: 12, lineHeight: 1.5,
                      background: m.role === "user" ? `${GE_COLOR}14` : "var(--ag-bg-hover, #f3f4f6)",
                      color: "var(--ag-text-primary)",
                    }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: m.role === "user" ? GE_COLOR : "#1A73E8", marginBottom: 3, textTransform: "uppercase" }}>{m.role}</div>
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function KnowledgeView({ knowledge, files }) {
  if (!files.length && !knowledge.length) return <EmptyState icon={<FileText size={40} />} message="No knowledge files found. Data store documents appear here." />;
  return (
    <div>
      {files.map((f) => (
        <Card key={f.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
              <FileText size={18} color="#0F9D58" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)" }}>
                  {f.webViewLink ? <a href={f.webViewLink} target="_blank" rel="noreferrer" style={{ color: "var(--ag-text-primary)", textDecoration: "none" }}>{f.fileName} <ExternalLink size={11} style={{ verticalAlign: "middle" }} /></a> : f.fileName}
                </div>
                <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>Data store: {f.filePath}</div>
                {f.relatedAgents?.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 4 }}>
                    Used by: {f.relatedAgents.map((r) => r.name).join(", ")}
                  </div>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <Badge text={f.operation} color="#0F9D58" />
              <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 4 }}>{fmtRelative(f.timestamp)}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ActivityView({ events }) {
  if (!events.length) return <EmptyState icon={<Activity size={40} />} message="No file activity recorded." />;
  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 12, overflow: "hidden" }}>
      {events.map((e, i) => (
        <div key={e.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < events.length - 1 ? "1px solid var(--ag-border)" : "none" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: GE_COLOR, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--ag-text-primary)" }}>
              <strong>{e.operation}</strong> — {e.target}
            </div>
            <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>{e.user}{e.details ? ` · ${e.details}` : ""}</div>
          </div>
          <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", flexShrink: 0 }}>{fmtDate(e.timestamp)}</div>
        </div>
      ))}
    </div>
  );
}
