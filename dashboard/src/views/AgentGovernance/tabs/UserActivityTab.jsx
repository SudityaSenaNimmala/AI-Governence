import { useState, useEffect, useMemo, useRef } from "react";
import {
  MessageSquare, FileText, Search, ChevronDown, ChevronRight,
  User, Bot, Clock, RefreshCw, AlertTriangle, Database, Globe,
  FolderOpen, Link, Brain, BookOpen, ExternalLink, ShieldAlert,
  Shield, CheckCircle, XCircle, Activity, TrendingDown, Zap,
  Eye, Lock, CreditCard, Heart, Key, ArrowRight,
  DollarSign, Cpu, BarChart3, Info,
} from "lucide-react";
import { useAgentAuth, useGovernance } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Section } from "../common/Section";
import { Badge } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";

// ═══════════════════════════════════════════════════
// Sensitive Data Scanner — detects PII, financial,
// health, and secrets/credentials in text
// ═══════════════════════════════════════════════════

const SENSITIVE_PATTERNS = {
  pii: [
    { name: "Email Address", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "medium" },
    { name: "Phone Number", regex: /\b\d{10}\b/g, severity: "medium" },
    { name: "Phone Number (formatted)", regex: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]\d{4}/g, severity: "medium" },
    { name: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g, severity: "critical" },
    { name: "IP Address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, severity: "low" },
    { name: "Street Address", regex: /\b\d{1,5}\s[\w\s]{2,30}(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|way|pl|place)\b/gi, severity: "medium" },
    { name: "Date of Birth", regex: /\b(?:dob|date\s*of\s*birth|born\s*on|birthday)[\s:=]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi, severity: "high" },
    { name: "Passport Number", regex: /\b(?:passport)\s*(?:#|number|no\.?)?[\s:]*[A-Z0-9]{6,12}\b/gi, severity: "critical" },
  ],
  financial: [
    { name: "Credit Card", regex: /\b(?:4\d{3}|5[1-8]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, severity: "critical" },
    { name: "Card Number (any 16 digits)", regex: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g, severity: "critical" },
    { name: "Card Number (contextual)", regex: /\b(?:card|credit|debit|visa|master)\s*(?:card|number|no|#|details)?[\s:]*\d[\d\s\-]{12,18}\d\b/gi, severity: "critical" },
    { name: "Bank Account", regex: /\b(?:account|acct|routing|iban)\s*(?:#|number|no\.?)?[\s:]*[A-Z0-9]{6,30}\b/gi, severity: "high" },
    { name: "CVV", regex: /\b(?:cvv|cvc|security\s*code)[\s:=]*\d{3,4}\b/gi, severity: "critical" },
    { name: "Currency Amount", regex: /\$[\d,]+(?:\.\d{2})?\b/g, severity: "low" },
  ],
  health: [
    { name: "Medical Record", regex: /\b(?:MRN|patient\s*id|medical\s*record)\s*(?:#|number|no\.?)?[\s:]*[\w-]{4,}\b/gi, severity: "critical" },
    { name: "Health Condition", regex: /\b(?:diagnosed?\s+with|suffering\s+from|treatment\s+for|symptoms?\s+of)\s+[\w\s]{3,30}\b/gi, severity: "high" },
    { name: "Medication", regex: /\b(?:prescribed|taking|dosage\s+of|medication)\s+[\w\s]{3,25}\b/gi, severity: "high" },
  ],
  secrets: [
    { name: "API Key", regex: /\b(?:api[_\-\s]?key|apikey|api[_\-\s]?token)(?:\s+is|\s*[:="'])?\s*[a-zA-Z0-9_\-]{10,64}/gi, severity: "critical" },
    { name: "Secret/Token (long string)", regex: /\b(?:key|token|secret|credential)(?:\s+is|\s*[:="'])\s*[a-zA-Z0-9_\-]{16,64}\b/gi, severity: "critical" },
    { name: "High-entropy Token", regex: /\b[a-zA-Z0-9_\-]{20,}[A-Z][a-zA-Z0-9_\-]{5,}[a-z][a-zA-Z0-9_\-]{5,}\b/g, severity: "high" },
    { name: "Bearer Token", regex: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g, severity: "critical" },
    { name: "Password", regex: /\b(?:password|passwd|pwd|pin)[\s:="']+\S{4,}/gi, severity: "critical" },
    { name: "Connection String", regex: /(?:mongodb|postgres|mysql|redis|amqp|Server=|Data Source=):?\/?\/?[^\s"']{10,}/gi, severity: "critical" },
    { name: "Private Key", regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, severity: "critical" },
    { name: "AWS Key", regex: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, severity: "critical" },
    { name: "Generic Secret Pattern", regex: /\b(?:sk-|sk_live_|pk_live_|ghp_|gho_|xoxb-|xoxp-)[a-zA-Z0-9_\-]{10,}/g, severity: "critical" },
  ],
};

const CATEGORY_CONFIG = {
  pii: { label: "Personally Identifiable Information", icon: User, color: "#8b5cf6", shortLabel: "PII" },
  financial: { label: "Financial Information", icon: CreditCard, color: "#f59e0b", shortLabel: "Financial" },
  health: { label: "Personal Health Information", icon: Heart, color: "#ef4444", shortLabel: "Health" },
  secrets: { label: "Secrets and Credentials", icon: Key, color: "#dc2626", shortLabel: "Secrets" },
};

function scanTextForSensitiveData(text) {
  if (!text) return [];
  const raw = [];
  for (const [category, patterns] of Object.entries(SENSITIVE_PATTERNS)) {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        raw.push({ category, name: pattern.name, severity: pattern.severity, match: match[0], index: match.index, end: match.index + match[0].length });
      }
    }
  }
  // Deduplicate overlapping matches within the same category — keep the highest-severity / first-defined pattern
  const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  raw.sort((a, b) => a.index - b.index || (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  const findings = [];
  for (const f of raw) {
    const dominated = findings.some(
      existing => existing.category === f.category && existing.index <= f.index && existing.end >= f.end
    );
    if (!dominated) findings.push(f);
  }
  return findings;
}

function scanChatsForSensitiveData(chats) {
  if (!chats?.length) return { chats: [], summary: { total: 0, byCategory: {}, bySeverity: {}, byAgent: {}, chatsWithFindings: 0 } };

  const scannedChats = chats.map((chat) => {
    const allFindings = [];
    for (const msg of (chat.messages || [])) {
      if (msg.from !== "bot") {
        const findings = scanTextForSensitiveData(msg.text);
        if (findings.length) allFindings.push(...findings.map((f) => ({ ...f, messageFrom: msg.fromName, messageId: msg.id })));
      }
    }
    return { ...chat, sensitiveFindings: allFindings };
  });

  const allFindings = scannedChats.flatMap((c) => c.sensitiveFindings);
  const byCategory = {};
  const bySeverity = {};
  const byAgent = {};
  for (const f of allFindings) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  for (const c of scannedChats) {
    if (c.sensitiveFindings.length > 0) {
      byAgent[c.botName] = (byAgent[c.botName] || 0) + c.sensitiveFindings.length;
    }
  }

  return {
    chats: scannedChats,
    summary: {
      total: allFindings.length,
      byCategory,
      bySeverity,
      byAgent,
      chatsWithFindings: scannedChats.filter((c) => c.sensitiveFindings.length > 0).length,
    },
  };
}

// ═══════════════════════════════════════════════════
// Data Flow — extract source → destination relationships
// for Sankey-style visualization
// ═══════════════════════════════════════════════════

function buildDataFlowFromFiles(taggedFiles, knowledge) {
  const flows = new Map(); // "source::dest" → count
  const sources = new Map();
  const destinations = new Map();

  for (const f of taggedFiles) {
    const site = extractSiteName(f.filePath || f.objectId || "");
    if (!site) continue;
    if (f.relatedAgents?.length > 0) {
      for (const agent of f.relatedAgents) {
        const key = `${site}::${agent}`;
        flows.set(key, (flows.get(key) || 0) + 1);
        sources.set(site, (sources.get(site) || 0) + 1);
        destinations.set(agent, (destinations.get(agent) || 0) + 1);
      }
    } else {
      sources.set(site, (sources.get(site) || 0) + 1);
    }
  }

  // Sort by count
  const sortedSources = [...sources.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const sortedDests = [...destinations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const sortedFlows = [...flows.entries()]
    .map(([key, count]) => { const [src, dst] = key.split("::"); return { src, dst, count }; })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return { sources: sortedSources, destinations: sortedDests, flows: sortedFlows, totalEvents: taggedFiles.length };
}

function extractSiteName(path) {
  if (!path) return null;
  try {
    const url = new URL(path.startsWith("http") ? path : `https://${path}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && (parts[0] === "sites" || parts[0] === "personal")) {
      return parts[1].replace(/_/g, " ");
    }
    return url.hostname.split(".")[0];
  } catch {
    const segments = path.split("/").filter(Boolean);
    return segments[0] || "Unknown";
  }
}

function DataFlowSankey({ taggedFiles, knowledge }) {
  const flow = useMemo(() => buildDataFlowFromFiles(taggedFiles, knowledge), [taggedFiles, knowledge]);

  if (flow.flows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 30, color: "#999", fontSize: 12 }}>
        <ArrowRight size={24} style={{ marginBottom: 8, opacity: 0.3 }} />
        <div>No data flows to visualize. Agent knowledge sources need SharePoint sites configured.</div>
      </div>
    );
  }

  const maxFlow = Math.max(...flow.flows.map((f) => f.count), 1);
  const srcSet = new Set(flow.flows.map((f) => f.src));
  const dstSet = new Set(flow.flows.map((f) => f.dst));
  const srcList = [...srcSet];
  const dstList = [...dstSet];
  const srcColors = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#3b82f6", "#60a5fa", "#93c5fd", "#06b6d4", "#22d3ee"];
  const dstColors = ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0", "#f59e0b", "#fbbf24", "#fcd34d"];

  return (
    <Section title={`Data Flow: Sources → AI Agents (${flow.flows.length} connections)`}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", overflowX: "auto", padding: "8px 0" }}>
        {/* Sources column */}
        <div style={{ minWidth: 160, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Sources</div>
          {srcList.map((src, i) => {
            const total = flow.sources.find(([s]) => s === src)?.[1] || 0;
            return (
              <div key={src} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4,
                background: `${srcColors[i % srcColors.length]}10`, border: `1px solid ${srcColors[i % srcColors.length]}33`,
                borderRadius: 6, fontSize: 11,
              }}>
                <Globe size={12} color={srcColors[i % srcColors.length]} />
                <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{src}</span>
                <span style={{ fontSize: 10, color: "#999", flexShrink: 0 }}>{total}</span>
              </div>
            );
          })}
        </div>

        {/* Flow lines */}
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#999", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1, textAlign: "center" }}>
            {flow.totalEvents} file events
          </div>
          {flow.flows.map((f, i) => {
            const width = Math.max(2, (f.count / maxFlow) * 20);
            const srcIdx = srcList.indexOf(f.src);
            const dstIdx = dstList.indexOf(f.dst);
            const color = srcColors[srcIdx % srcColors.length];
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6, marginBottom: 3, padding: "3px 8px",
                background: `${color}08`, borderRadius: 4,
              }}>
                <span style={{ fontSize: 10, color: "#666", width: 70, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.src}</span>
                <div style={{ flex: 1, height: width, background: `linear-gradient(90deg, ${color}60, ${dstColors[dstIdx % dstColors.length]}60)`, borderRadius: width / 2, minWidth: 40 }} />
                <span style={{ fontSize: 10, color: "#666", width: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.dst}</span>
                <span style={{ fontSize: 9, color: "#999", width: 30, textAlign: "right" }}>{f.count}</span>
              </div>
            );
          })}
        </div>

        {/* Destinations column */}
        <div style={{ minWidth: 160, flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#10b981", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>AI Agents</div>
          {dstList.map((dst, i) => {
            const total = flow.destinations.find(([d]) => d === dst)?.[1] || 0;
            return (
              <div key={dst} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4,
                background: `${dstColors[i % dstColors.length]}10`, border: `1px solid ${dstColors[i % dstColors.length]}33`,
                borderRadius: 6, fontSize: 11,
              }}>
                <Bot size={12} color={dstColors[i % dstColors.length]} />
                <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dst}</span>
                <span style={{ fontSize: 10, color: "#999", flexShrink: 0 }}>{total}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

const RISK_COLORS = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#22c55e",
};

function RiskBadge({ level, score }) {
  const color = RISK_COLORS[level] || "#6b7280";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 700,
        background: `${color}15`,
        color,
        border: `1px solid ${color}33`,
      }}
    >
      <ShieldAlert size={10} />
      {level?.charAt(0).toUpperCase() + level?.slice(1)} {score !== undefined && `(${score})`}
    </span>
  );
}

function ChatBubble({ message }) {
  const isBot = message.from === "bot";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isBot ? "flex-start" : "flex-end", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {isBot ? (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 18, height: 18, borderRadius: "50%", background: "#6366f120",
          }}>
            <Bot size={11} color="#6366f1" />
          </span>
        ) : (
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 18, height: 18, borderRadius: "50%", background: "#22c55e20",
          }}>
            <User size={11} color="#22c55e" />
          </span>
        )}
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: isBot ? "#6366f1" : "#22c55e",
        }}>
          {isBot ? message.fromName || "Agent" : message.fromName || "User"}
        </span>
        {message.timestamp && (
          <span style={{ fontSize: 9, color: "#999" }}>
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div
        style={{
          maxWidth: "80%",
          padding: "10px 14px",
          borderRadius: isBot ? "2px 12px 12px 12px" : "12px 2px 12px 12px",
          background: isBot ? "#f1f3f9" : "#6366f10d",
          border: `1px solid ${isBot ? "#e2e5ec" : "#6366f133"}`,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: "var(--ag-text-primary)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {message.text}
      </div>
    </div>
  );
}

function ChatCard({ chat, isExpanded, onToggle }) {
  const userMsgCount = (chat.messages || []).filter(m => m.from !== "bot").length;
  const botMsgCount = (chat.messages || []).filter(m => m.from === "bot").length;

  return (
    <div
      style={{
        background: "var(--ag-bg-card)",
        border: "1px solid var(--ag-border)",
        borderRadius: 10,
        marginBottom: 10,
        overflow: "hidden",
        transition: "box-shadow 0.15s",
        boxShadow: isExpanded ? "0 2px 12px rgba(99,102,241,0.08)" : "none",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          cursor: "pointer",
          borderBottom: isExpanded ? "1px solid var(--ag-border)" : "none",
        }}
      >
        {isExpanded ? <ChevronDown size={14} color="#6366f1" /> : <ChevronRight size={14} color="#999" />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)" }}>
              # {chat.userName}
            </span>
            <span style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>&rarr;</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#6366f1" }}>
              {chat.botName}
            </span>
            {chat.source === "audit_log" && <Badge text="Audit Log" color="#8b5cf6" />}
            {chat.source === "teams_chat" && <Badge text="Teams" color="#2563eb" />}
            {chat.source === "graph_copilot" && <Badge text="Copilot API" color="#059669" />}
          </div>
          {chat.userEmail && (
            <div style={{ fontSize: 10, color: "var(--ag-text-secondary)" }}>{chat.userEmail}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 10, color: "#22c55e", display: "flex", alignItems: "center", gap: 3 }}>
              <User size={9} /> {userMsgCount}
            </span>
            <span style={{ fontSize: 10, color: "#6366f1", display: "flex", alignItems: "center", gap: 3 }}>
              <Bot size={9} /> {botMsgCount}
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>
              <MessageSquare size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />
              {chat.messageCount} messages
            </div>
            <div style={{ fontSize: 10, color: "#999" }}>
              <Clock size={9} style={{ marginRight: 3, verticalAlign: "middle" }} />
              {new Date(chat.startTime).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {isExpanded && chat.messages && chat.messages.length > 0 && (
        <div style={{ padding: "14px 16px", background: "#fafbfd", maxHeight: 500, overflowY: "auto" }}>
          {chat.messages.map((msg, i) => (
            <ChatBubble key={msg.id || i} message={msg} />
          ))}
        </div>
      )}
      {isExpanded && (!chat.messages || chat.messages.length === 0) && (
        <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: "var(--ag-text-secondary)" }}>
          No message content available for this conversation
        </div>
      )}
    </div>
  );
}

const OP_COLORS = {
  FileAccessed: "#3b82f6",
  FileModified: "#f59e0b",
  FileDeleted: "#ef4444",
  FileUploaded: "#22c55e",
  FilePreviewed: "#8b5cf6",
  FileDownloaded: "#6366f1",
  PageViewed: "#3b82f6",
};

function FileRow({ file }) {
  return (
    <tr style={{ borderBottom: "1px solid var(--ag-border)", background: file.relatedAgents?.length ? "rgba(99,102,241,0.02)" : "transparent" }}>
      <td style={{ padding: "10px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={14} color={file.relatedAgents?.length ? "#6366f1" : "#999"} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ag-text-primary)" }}>{file.fileName}</div>
            <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.filePath}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: "10px 8px" }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{file.userName}</div>
        <div style={{ fontSize: 10, color: "var(--ag-text-secondary)" }}>{file.userId}</div>
      </td>
      <td style={{ padding: "10px 8px" }}>
        <Badge text={file.operation} color={OP_COLORS[file.operation] || "#6b7280"} />
      </td>
      <td style={{ padding: "10px 8px" }}>
        <Badge text={file.workload} color={file.workload === "SharePoint" ? "#059669" : "#3b82f6"} />
      </td>
      <td style={{ padding: "10px 8px" }}>
        {file.relatedAgents?.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {file.relatedAgents.map((a) => (
              <span key={a} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#6366f115", color: "#6366f1", fontWeight: 600, border: "1px solid #6366f133" }}>
                {a}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: "#999" }}>—</span>
        )}
      </td>
      <td style={{ padding: "10px 8px", fontSize: 11, color: "var(--ag-text-secondary)" }}>
        {new Date(file.timestamp).toLocaleString()}
      </td>
    </tr>
  );
}

// Summarize knowledge sources for diagnostics
function getKnowledgeDiagnostics(knowledgeSources) {
  const diag = { totalBots: 0, totalSources: 0, byType: {}, siteUrls: [], botsWithSites: [] };
  if (!knowledgeSources?.length) return diag;
  diag.totalBots = knowledgeSources.length;
  for (const bot of knowledgeSources) {
    const sources = bot.sources || [];
    diag.totalSources += sources.length;
    let hasSite = false;
    for (const s of sources) {
      diag.byType[s.type] = (diag.byType[s.type] || 0) + 1;
      if (s.url && (s.url.includes("sharepoint.com") || s.url.includes("onedrive.com") || s.url.includes(".sharepoint.us"))) {
        diag.siteUrls.push({ botName: bot.botName, url: s.url, type: s.type });
        hasSite = true;
      }
    }
    if (hasSite) diag.botsWithSites.push(bot.botName);
  }
  return diag;
}

function extractSiteBase(rawUrl) {
  try {
    const url = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const pathParts = url.pathname.split("/").filter(Boolean);
    return url.hostname + (pathParts.length >= 2 ? `/${pathParts[0]}/${pathParts[1]}` : "");
  } catch { return null; }
}

// Cross-reference file events with agent knowledge sources
function tagFilesWithAgents(files, knowledgeSources) {
  if (!files?.length) return files || [];
  if (!knowledgeSources?.length) return files.map((f) => ({ ...f, relatedAgents: [] }));

  const agentSiteMap = new Map();
  const agentHostMap = new Map();
  const agentFileIdMap = new Map(); // OpenAI: vector_store_file componentId → agent names

  for (const bot of knowledgeSources) {
    for (const source of (bot.sources || [])) {
      // ID-based matching for OpenAI vector store files
      if (source.type === "vector_store_file" && source.componentId) {
        if (!agentFileIdMap.has(source.componentId)) agentFileIdMap.set(source.componentId, new Set());
        agentFileIdMap.get(source.componentId).add(bot.botName);
      }
      if (!source.url) continue;
      const lower = source.url.toLowerCase();
      if (lower.includes("sharepoint.com") || lower.includes("onedrive.com") || lower.includes(".sharepoint.us")) {
        const siteBase = extractSiteBase(source.url);
        if (siteBase) {
          if (!agentSiteMap.has(siteBase)) agentSiteMap.set(siteBase, new Set());
          agentSiteMap.get(siteBase).add(bot.botName);
        }
        try {
          const hostname = new URL(source.url.startsWith("http") ? source.url : `https://${source.url}`).hostname.toLowerCase();
          if (!agentHostMap.has(hostname)) agentHostMap.set(hostname, new Set());
          agentHostMap.get(hostname).add(bot.botName);
        } catch { /* skip */ }
      }
    }
  }

  return files.map((f) => {
    const relatedAgents = new Set();
    // OpenAI: match by file ID
    if (f.id && agentFileIdMap.has(f.id)) {
      for (const a of agentFileIdMap.get(f.id)) relatedAgents.add(a);
    }
    // SharePoint/OneDrive: match by URL path
    if (relatedAgents.size === 0) {
      const objId = (f.objectId || f.filePath || "").toLowerCase();
      for (const [siteBase, agents] of agentSiteMap) {
        if (objId.includes(siteBase.toLowerCase())) {
          for (const a of agents) relatedAgents.add(a);
        }
      }
      if (relatedAgents.size === 0) {
        for (const [hostname, agents] of agentHostMap) {
          if (objId.includes(hostname)) {
            for (const a of agents) relatedAgents.add(a);
          }
        }
      }
    }
    return { ...f, relatedAgents: [...relatedAgents] };
  });
}

function computeDataExposure(taggedFiles, knowledgeSources) {
  const agentRelatedCount = taggedFiles.filter((f) => f.relatedAgents?.length > 0).length;
  const uniqueAgentsExposed = new Set(taggedFiles.flatMap((f) => f.relatedAgents || []));
  const modifiedOnAgentSites = taggedFiles.filter((f) => f.relatedAgents?.length > 0 && (f.operation === "FileModified" || f.operation === "FileUploaded" || f.operation === "FileDeleted")).length;
  const externalUsersOnAgentSites = new Set(
    taggedFiles.filter((f) => f.relatedAgents?.length > 0 && f.userId?.includes("#ext#")).map((f) => f.userId)
  ).size;

  const allKnowledgeSites = new Set();
  const activeSites = new Set();
  for (const bot of (knowledgeSources || [])) {
    for (const source of (bot.sources || [])) {
      if (source.url && (source.url.includes("sharepoint.com") || source.url.includes("onedrive.com"))) {
        allKnowledgeSites.add(source.url);
      }
    }
  }
  for (const f of taggedFiles) {
    if (f.relatedAgents?.length > 0) activeSites.add(f.objectId || f.filePath);
  }
  const staleSources = allKnowledgeSites.size - Math.min(activeSites.size, allKnowledgeSites.size);

  return { agentRelatedCount, uniqueAgentsExposed: uniqueAgentsExposed.size, modifiedOnAgentSites, externalUsersOnAgentSites, staleSources, totalKnowledgeSites: allKnowledgeSites.size };
}

const knowledgeTypeConfig = {
  sharepoint: { icon: <Globe size={14} />, color: "#059669", label: "SharePoint" },
  website: { icon: <Link size={14} />, color: "#3b82f6", label: "Website" },
  dataverse_table: { icon: <Database size={14} />, color: "#6366f1", label: "Dataverse Table" },
  azure_storage: { icon: <FolderOpen size={14} />, color: "#0ea5e9", label: "Azure Storage" },
  file_analysis: { icon: <FileText size={14} />, color: "#f59e0b", label: "File Analysis" },
  model_knowledge: { icon: <Brain size={14} />, color: "#8b5cf6", label: "Model Knowledge" },
  knowledge_article: { icon: <BookOpen size={14} />, color: "#ec4899", label: "Knowledge Article" },
  connector: { icon: <Link size={14} />, color: "#f97316", label: "Connector" },
  uploaded_file: { icon: <FileText size={14} />, color: "#22c55e", label: "Uploaded File" },
  other: { icon: <FolderOpen size={14} />, color: "#6b7280", label: "Other" },
};

function KnowledgeSourceCard({ source }) {
  const config = knowledgeTypeConfig[source.type] || knowledgeTypeConfig.other;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px", background: "var(--ag-bg-card)",
        border: "1px solid var(--ag-border)", borderRadius: 8,
        borderLeft: `3px solid ${config.color}`,
      }}
    >
      <div style={{ color: config.color, flexShrink: 0 }}>{config.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Badge text={config.label} color={config.color} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)" }}>{source.name}</span>
        </div>
        {source.url && (
          <div style={{ fontSize: 11, color: "#6366f1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
            <ExternalLink size={10} />
            <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{source.url}</a>
          </div>
        )}
        {source.metadata && (() => {
          const meta = typeof source.metadata === "string"
            ? source.metadata
            : Object.entries(source.metadata).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ");
          return meta ? <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginTop: 2 }}>{meta}</div> : null;
        })()}
      </div>
      {source.addedOn && (
        <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", flexShrink: 0 }}>
          {new Date(source.addedOn).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function extractKnowledgeFromDiscoveredAgent(agent) {
  const sources = [];

  // Extract SharePoint URLs from description
  const spUrlMatch = (agent.description || "").match(/https?:\/\/[^\s]*sharepoint[^\s]*/gi);
  if (spUrlMatch) {
    for (const url of spUrlMatch) {
      const cleanUrl = url.replace(/[,.)]+$/, "");
      const pathParts = cleanUrl.split("/");
      const siteName = pathParts.find((p, i) => pathParts[i - 1] === "sites" || pathParts[i - 1] === "personal") || pathParts.pop();
      sources.push({ componentId: `sp-${sources.length}`, name: decodeURIComponent(siteName || "SharePoint Site"), type: "sharepoint", url: cleanUrl, addedOn: agent.firstSeen });
    }
  }

  // Connectors as knowledge sources
  if (agent.connectors?.length > 0) {
    for (const c of agent.connectors) {
      sources.push({ componentId: `conn-${sources.length}`, name: c.name || c.type || "Connector", type: "connector", url: "", metadata: c.type, addedOn: agent.firstSeen });
    }
  }

  // LLM Model as knowledge source
  if (agent.llmModel) {
    sources.push({ componentId: `model-${sources.length}`, name: agent.llmModel, type: "model_knowledge", url: "", metadata: "AI Model powering this agent", addedOn: agent.firstSeen });
  }

  // Deployed channels — only include URLs, skip plain channel names like "Microsoft Teams"
  if (agent.deployedTo?.length > 0) {
    for (const d of agent.deployedTo) {
      if (!d.startsWith("http")) continue;
      sources.push({
        componentId: `deploy-${sources.length}`,
        name: d.includes("sharepoint") ? decodeURIComponent(d.split("/").pop() || "SharePoint Site") : new URL(d).hostname,
        type: d.includes("sharepoint") ? "sharepoint" : "website",
        url: d,
        addedOn: agent.firstSeen,
      });
    }
  }

  return {
    botId: agent.id,
    botName: agent.name,
    sources,
    components: [],
  };
}

function BotComponentInspector({ components }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  if (!components || components.length === 0) return null;

  const typeNames = {
    0: "Topic", 1: "Skill", 2: "Variable", 3: "Response", 4: "Entity",
    5: "Dialog", 9: "Topic", 15: "Agent Def", 67: "Knowledge",
    68: "Knowledge", 69: "Knowledge", 70: "Knowledge", 71: "Knowledge", 72: "Knowledge",
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          fontSize: 11, color: "var(--ag-text-secondary)", background: "none",
          border: "none", cursor: "pointer", padding: "4px 0", fontFamily: "inherit",
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Inspect all components ({components.length})
      </button>
      {expanded && (
        <div style={{ marginTop: 6, maxHeight: 500, overflowY: "auto", background: "#fafbfd", borderRadius: 6, border: "1px solid var(--ag-border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ag-border)", position: "sticky", top: 0, background: "#f1f3f9" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Type</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Name</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Schema</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "#666" }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c) => (
                <>
                  <tr
                    key={c.id}
                    onClick={() => setExpandedRow(expandedRow === c.id ? null : c.id)}
                    style={{ borderBottom: "1px solid var(--ag-border)", cursor: c.hasData ? "pointer" : "default", background: expandedRow === c.id ? "#f0f0ff" : "transparent" }}
                  >
                    <td style={{ padding: "5px 8px" }}>
                      <Badge text={typeNames[c.type] || `Type ${c.type}`} color={c.type === 15 ? "#6366f1" : c.type >= 60 ? "#22c55e" : "#6b7280"} />
                    </td>
                    <td style={{ padding: "5px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{c.name || "—"}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10, color: "#999" }}>{c.schemaname || "—"}</td>
                    <td style={{ padding: "5px 8px" }}>
                      {c.hasData
                        ? <span style={{ color: "#22c55e", fontSize: 10 }}>{c.dataSize ? `${Math.round(c.dataSize / 1024)}KB` : "Yes"}</span>
                        : <span style={{ color: "#999" }}>—</span>}
                    </td>
                  </tr>
                  {expandedRow === c.id && c.dataPreview && (
                    <tr key={c.id + "-data"}>
                      <td colSpan={4} style={{ padding: "8px", background: "#1a1a2e" }}>
                        <pre style={{ fontSize: 10, color: "#e2e8f0", whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0, maxHeight: 200, overflow: "auto", fontFamily: "Consolas, monospace" }}>
                          {c.dataPreview}
                          {c.dataSize > 800 && <span style={{ color: "#6366f1" }}>{`\n... (${Math.round(c.dataSize / 1024)}KB total)`}</span>}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DiscoveredKnowledgeView({ agents }) {
  const knowledgeData = agents.map(extractKnowledgeFromDiscoveredAgent);
  const withSources = knowledgeData.filter(b => b.sources.length > 0);
  const totalSources = knowledgeData.reduce((s, b) => s + b.sources.length, 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Agents Discovered", value: agents.length, color: "#6366f1" },
          { label: "Knowledge Sources", value: totalSources, color: "#22c55e" },
          { label: "With Knowledge", value: withSources.length, color: "#3b82f6" },
        ].map((s) => (
          <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 140 }}>
            <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {agents.map((agent, idx) => {
        const kd = knowledgeData[idx];
        const channels = agent.deployedTo || [];
        return (
          <div key={agent.id || idx} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Bot size={18} color="#6366f1" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ag-text-primary)" }}>{agent.name}</div>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", fontFamily: "monospace" }}>{agent.id}</div>
              </div>
              <Badge text={agent.platform} color="#6366f1" />
              {kd.sources.length > 0 && <Badge text={`${kd.sources.length} source${kd.sources.length !== 1 ? "s" : ""}`} color="#22c55e" />}
            </div>

            {agent.description && (
              <div style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
                {agent.description.length > 200 ? agent.description.substring(0, 200) + "..." : agent.description}
              </div>
            )}

            {channels.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ag-text-secondary)", marginBottom: 4 }}>Deployed Channels</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {channels.map((ch, ci) => (
                    <span key={ci} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>
                      {ch.startsWith("http") ? new URL(ch).hostname : ch}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {kd.sources.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ag-text-secondary)", marginBottom: 2 }}>Knowledge Sources</div>
                {kd.sources.map((s, i) => (
                  <KnowledgeSourceCard key={s.componentId + "-" + i} source={s} />
                ))}
              </div>
            ) : (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--ag-text-secondary)", fontSize: 12, background: "#fafbfd", borderRadius: 8, border: "1px dashed var(--ag-border)" }}>
                <FolderOpen size={18} style={{ marginBottom: 4, opacity: 0.4 }} />
                <div>Knowledge sources are managed within the agent&apos;s platform</div>
                <div style={{ fontSize: 11, marginTop: 3, color: "#999" }}>
                  Configure knowledge in the agent builder (Copilot Studio, SharePoint, or m365.cloud.microsoft)
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BotKnowledgePanel({ bot }) {
  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Bot size={18} color="#6366f1" />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ag-text-primary)" }}>{bot.botName}</div>
          <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", fontFamily: "monospace" }}>{bot.botId}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Badge text={`${bot.sources.length} source${bot.sources.length !== 1 ? "s" : ""}`} color={bot.sources.length > 0 ? "#22c55e" : "#6b7280"} />
        </div>
      </div>

      {bot.sources.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {bot.sources.map((s, i) => (
            <KnowledgeSourceCard key={s.componentId + "-" + i} source={s} />
          ))}
        </div>
      ) : (
        <div style={{ padding: "16px 12px", textAlign: "center", color: "var(--ag-text-secondary)", fontSize: 12, background: "#fafbfd", borderRadius: 8, border: "1px dashed var(--ag-border)" }}>
          <FolderOpen size={20} style={{ marginBottom: 6, opacity: 0.4 }} />
          <div>No knowledge sources configured for this agent</div>
          <div style={{ fontSize: 11, marginTop: 4, color: "#999" }}>
            Add files, SharePoint sites, or web URLs in Copilot Studio &rarr; Knowledge
          </div>
        </div>
      )}

      <BotComponentInspector components={bot.components} />
    </div>
  );
}

function AgentPermissionsPanel({ oauthKeyId, enabled = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [showAll, setShowAll] = useState(false);

  const loadPermissions = async () => {
    if (!oauthKeyId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.fetchAgentPermissions(oauthKeyId);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (oauthKeyId && enabled) loadPermissions(); }, [oauthKeyId, enabled]);

  const LEVEL_COLORS = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" };
  const LEVEL_BG = { critical: "#fef2f2", high: "#fffbeb", medium: "#eff6ff", low: "#f0fdf4" };
  const CATEGORY_ICONS = { files: FolderOpen, mail: MessageSquare, directory: User, communications: MessageSquare, calendar: Clock, other: Shield };

  const [filterMode, setFilterMode] = useState("agents"); // "agents" | "risky" | "all"
  const apps = data?.apps || [];
  const agentApps = apps.filter(a => a.isAgent);
  const riskyApps = apps.filter(a => a.summary.hasFileAccess || a.summary.hasWriteAccess || a.summary.criticalCount > 0);
  const displayed = filterMode === "agents" ? agentApps : filterMode === "risky" ? riskyApps : showAll ? apps : apps.slice(0, 30);

  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldAlert size={16} color="#dc2626" />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ag-text-primary)" }}>App Permissions &amp; File Access</span>
        </div>
        <button onClick={loadPermissions} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", color: "var(--ag-text-secondary)" }}>
          <RefreshCw size={10} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {loading ? "Scanning..." : "Re-scan"}
        </button>
      </div>

      {loading && !data ? (
        <LoadingSpinner message="Scanning service principal permissions across your tenant..." />
      ) : error ? (
        <div style={{ textAlign: "center", padding: 20, color: "#f59e0b", fontSize: 12 }}>
          <AlertTriangle size={20} style={{ marginBottom: 6 }} />
          <div>{error}</div>
        </div>
      ) : data ? (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              { label: "Apps Scanned", value: data.totalApps, color: "#6366f1" },
              { label: "With File Access", value: data.summary.withFileAccess, color: "#f59e0b" },
              { label: "With Write Access", value: data.summary.withWriteAccess, color: "#dc2626" },
              { label: "Critical Risk", value: data.summary.criticalRisk, color: "#dc2626" },
              { label: "Agent Apps", value: data.summary.agentCount, color: "#22c55e" },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "8px 14px", minWidth: 110 }}>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {[
              { id: "agents", label: `Agents Only (${agentApps.length})`, color: "#22c55e" },
              { id: "risky", label: `With File/Write Access (${riskyApps.length})`, color: "#f59e0b" },
              { id: "all", label: `All Apps (${apps.length})`, color: "#6366f1" },
            ].map(f => (
              <button key={f.id} onClick={() => setFilterMode(f.id)} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                background: filterMode === f.id ? f.color : "transparent",
                color: filterMode === f.id ? "#fff" : "var(--ag-text-secondary)",
                border: `1px solid ${filterMode === f.id ? f.color : "var(--ag-border)"}`,
              }}>
                {f.label}
              </button>
            ))}
          </div>

          {displayed.length > 0 ? (
            <div style={{ border: "1px solid var(--ag-border)", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...thStyle, width: "25%" }}>Application</th>
                    <th style={{ ...thStyle, width: "10%" }}>Risk Level</th>
                    <th style={{ ...thStyle, width: "10%" }}>Access Type</th>
                    <th style={{ ...thStyle, width: "40%" }}>Granted Permissions</th>
                    <th style={{ ...thStyle, width: "15%" }}>File Access</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((app) => {
                    const readPerms = app.permissions.filter((p) => !p.isWrite);
                    const writePerms = app.permissions.filter((p) => p.isWrite);
                    return (
                      <tr key={app.servicePrincipalId} onClick={() => setExpanded(prev => ({ ...prev, [app.servicePrincipalId]: !prev[app.servicePrincipalId] }))} style={{ cursor: "pointer", borderTop: "1px solid var(--ag-border)", background: expanded[app.servicePrincipalId] ? "#f8fafc" : "transparent" }}>
                        <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {expanded[app.servicePrincipalId] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <div>
                              <div style={{ fontWeight: 600, color: "var(--ag-text-primary)" }}>
                                {app.displayName}
                                {app.isAgent && <Badge text="Agent" color="#22c55e" style={{ marginLeft: 6 }} />}
                              </div>
                              <div style={{ fontSize: 10, color: "#999" }}>{app.appId}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                          <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 700, background: LEVEL_BG[app.summary.riskLevel], color: LEVEL_COLORS[app.summary.riskLevel], border: `1px solid ${LEVEL_COLORS[app.summary.riskLevel]}33`, textTransform: "uppercase" }}>
                            {app.summary.riskLevel}
                          </span>
                        </td>
                        <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                          {app.summary.hasWriteAccess ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#dc2626", fontWeight: 600, fontSize: 11 }}>
                              <AlertTriangle size={12} /> Read + Write
                            </span>
                          ) : (
                            <span style={{ color: "#22c55e", fontWeight: 600, fontSize: 11 }}>Read-only</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {readPerms.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: "#3b82f6", marginBottom: 2 }}>Read Permissions:</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                  {readPerms.map((p, i) => (
                                    <span key={i} style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, background: LEVEL_BG[p.level], color: LEVEL_COLORS[p.level], border: `1px solid ${LEVEL_COLORS[p.level]}22` }}>
                                      {p.permission}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {writePerms.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: "#dc2626", marginBottom: 2 }}>Write Permissions:</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                  {writePerms.map((p, i) => (
                                    <span key={i} style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, background: "#fef2f2", color: "#dc2626", border: "1px solid #dc262622" }}>
                                      {p.permission}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {app.permissions.length === 0 && <span style={{ color: "#999", fontSize: 10 }}>No permissions granted</span>}
                          </div>
                          {expanded[app.servicePrincipalId] && (
                            <div style={{ marginTop: 8, padding: "8px", background: "#f8fafc", borderRadius: 6, border: "1px solid var(--ag-border)" }}>
                              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ag-text-secondary)", marginBottom: 4 }}>Permission Details</div>
                              {app.permissions.map((p, i) => {
                                const Icon = CATEGORY_ICONS[p.category] || Shield;
                                return (
                                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                                    <Icon size={12} color={LEVEL_COLORS[p.level]} />
                                    <span style={{ fontSize: 10, fontWeight: 600, color: LEVEL_COLORS[p.level] }}>{p.permission}</span>
                                    {p.isWrite && <Badge text="WRITE" color="#dc2626" />}
                                    <span style={{ fontSize: 10, color: "#999" }}>via {p.resourceDisplayName}</span>
                                    <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 3, background: LEVEL_BG[p.level], color: LEVEL_COLORS[p.level] }}>{p.level}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                          {app.summary.hasFileAccess ? (
                            <div>
                              {app.summary.filePermissions.map((fp, i) => (
                                <div key={i} style={{ fontSize: 10, fontWeight: 600, color: fp.includes("Write") || fp.includes("FullControl") ? "#dc2626" : "#f59e0b", marginBottom: 2 }}>
                                  {fp}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: "#22c55e", fontSize: 11 }}>No file access</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 30, color: "#999", fontSize: 12 }}>
              No applications with significant permissions found.
            </div>
          )}

          {!showAll && apps.length > displayed.length && (
            <button onClick={() => setShowAll(true)} style={{ display: "block", margin: "12px auto 0", padding: "6px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
              Show All {apps.length} Apps
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RiskScoringGuide() {
  const [expanded, setExpanded] = useState(false);
  const [simScenario, setSimScenario] = useState({
    orphaned: false,
    stale: false,
    httpConnector: false,
    broadPerms: false,
    allUsersScope: false,
    expiredRenewal: false,
    sensitiveKw: false,
  });

  const computeSimScore = () => {
    let score = 100;
    const factors = [];
    score -= 5; // base deduction for "low" base risk

    if (simScenario.broadPerms) { score -= 20; factors.push({ signal: "Broad connector scopes (Mail.ReadWrite.All, Sites.ReadWrite.All)", weight: "critical", deduction: -20 }); }
    if (simScenario.orphaned) { score -= 20; factors.push({ signal: "No assigned owner (orphaned)", weight: "critical", deduction: -20 }); }
    if (simScenario.stale) { score -= 12; factors.push({ signal: "Stale — no activity in 30+ days", weight: "high", deduction: -12 }); }
    if (simScenario.expiredRenewal) { score -= 10; factors.push({ signal: "Overdue for renewal", weight: "medium", deduction: -10 }); }
    if (simScenario.allUsersScope) { score -= 10; factors.push({ signal: "Deployed to all-user Teams scope", weight: "medium", deduction: -10 }); }
    if (simScenario.httpConnector) { score -= 10; factors.push({ signal: "HTTP connector (external data egress)", weight: "medium", deduction: -10 }); }
    if (simScenario.sensitiveKw) { score -= 5; factors.push({ signal: "Sensitive keywords in name/description", weight: "low", deduction: -5 }); }

    factors.push({ signal: "No governance policy applied", weight: "low", deduction: 0 });
    score = Math.max(0, Math.min(100, score));
    let level = score <= 25 ? "critical" : score <= 50 ? "high" : score <= 75 ? "medium" : "low";
    return { score, level, factors };
  };

  const sim = computeSimScore();

  return (
    <div style={{ marginTop: 16, background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", cursor: "pointer", borderBottom: expanded ? "1px solid var(--ag-border)" : "none" }}
      >
        {expanded ? <ChevronDown size={14} color="#6366f1" /> : <ChevronRight size={14} color="#999" />}
        <ShieldAlert size={16} color="#6366f1" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ag-text-primary)" }}>Risk Score Guide & Simulator</span>
        <span style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginLeft: "auto" }}>
          Score 0–100 (lower = higher risk)
        </span>
      </div>

      {expanded && (
        <div style={{ padding: 16 }}>
          {/* Score bands */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            {[
              { level: "Low", range: "76-100", color: "#22c55e", desc: "Healthy — within acceptable risk" },
              { level: "Medium", range: "51-75", color: "#3b82f6", desc: "Monitor — some risk signals present" },
              { level: "High", range: "26-50", color: "#f59e0b", desc: "Needs review — multiple risk factors" },
              { level: "Critical", range: "0-25", color: "#ef4444", desc: "Immediate action — severe risk" },
            ].map(b => (
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
                {[
                  { signal: "Broad connector scopes (Mail.ReadWrite, Sites.ReadWrite.All)", weight: "Critical", impact: "-20", source: "Power Platform API", how: "Checks connector permissions against dangerous scope list" },
                  { signal: "No assigned owner (orphaned agent)", weight: "Critical", impact: "-20", source: "Dataverse + Graph", how: "Resolves bot createdby \u2192 Dataverse user \u2192 Entra ID accountEnabled" },
                  { signal: "Stale agent (30+ days inactive)", weight: "High", impact: "-12", source: "Dataverse sessions + chats", how: "Computes days since last session; chats feed into activity tracking" },
                  { signal: "Expired renewal date", weight: "Medium", impact: "-10", source: "CloudFuze agent_registry", how: "Admin sets renewal date during governance review; triggers risk deduction when past due without re-certification" },
                  { signal: "All-user Teams deployment", weight: "Medium", impact: "-10", source: "Graph appCatalogs", how: "Checks consentType === 'AllPrincipals' from app registration" },
                  { signal: "HTTP connector present", weight: "Medium", impact: "-10", source: "Connector config", how: "Detects HTTP connector type in bot's connector list" },
                  { signal: "Sensitive keywords in name/description", weight: "Low", impact: "-5", source: "Dataverse name/desc", how: "Scans for keywords: password, secret, credential, PII, HIPAA, etc." },
                  { signal: "Multiple read permissions", weight: "Low", impact: "-5", source: "Connector config", how: "Counts read-level permissions (Mail.Read, Files.Read.All, etc.)" },
                  { signal: "No governance policy applied", weight: "Low", impact: "flag only", source: "CloudFuze", how: "Flags agents not covered by any CloudFuze governance policy" },
                ].map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                    <td style={{ padding: "5px 8px" }}>{r.signal}</td>
                    <td style={{ padding: "5px 8px" }}>
                      <Badge text={r.weight} color={r.weight === "Critical" ? "#ef4444" : r.weight === "High" ? "#f59e0b" : r.weight === "Medium" ? "#3b82f6" : r.weight === "Low" ? "#22c55e" : "#6b7280"} />
                    </td>
                    <td style={{ padding: "5px 8px", fontWeight: 600, color: r.impact.startsWith("+") ? "#22c55e" : r.impact.startsWith("-") ? "#ef4444" : "#999" }}>{r.impact}</td>
                    <td style={{ padding: "5px 8px", color: "var(--ag-text-secondary)", fontSize: 10 }}>{r.source}</td>
                    <td style={{ padding: "5px 8px", color: "var(--ag-text-secondary)", fontSize: 10, maxWidth: 250 }}>{r.how}</td>
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
                  {[
                    { key: "orphaned", label: "Agent has no owner (orphaned)", weight: "CRITICAL -20" },
                    { key: "broadPerms", label: "Has broad connector scopes", weight: "CRITICAL -20" },
                    { key: "stale", label: "No activity in 30+ days", weight: "HIGH -12" },
                    { key: "expiredRenewal", label: "Renewal date expired", weight: "MED -10" },
                    { key: "allUsersScope", label: "Deployed to all users (Teams)", weight: "MED -10" },
                    { key: "httpConnector", label: "HTTP connector present", weight: "MED -10" },
                    { key: "sensitiveKw", label: "Sensitive keywords in name/description", weight: "LOW -5" },
                  ].map(opt => (
                    <label key={opt.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={simScenario[opt.key]}
                        onChange={() => setSimScenario(prev => ({ ...prev, [opt.key]: !prev[opt.key] }))}
                        style={{ accentColor: "#6366f1" }}
                      />
                      <span>{opt.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: opt.weight.includes("+") ? "#22c55e" : "#ef4444", fontWeight: 600 }}>
                        {opt.weight}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ width: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--ag-bg-card)", borderRadius: 10, border: "1px solid var(--ag-border)" }}>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 4 }}>Simulated Score</div>
                <div style={{ fontSize: 42, fontWeight: 800, color: RISK_COLORS[sim.level] || "#6b7280", lineHeight: 1 }}>{sim.score}</div>
                <RiskBadge level={sim.level} />
                <div style={{ width: "100%", height: 8, borderRadius: 4, background: "#e5e7eb", marginTop: 12, overflow: "hidden" }}>
                  <div style={{ width: `${sim.score}%`, height: "100%", borderRadius: 4, background: RISK_COLORS[sim.level] || "#6b7280", transition: "all 0.3s" }} />
                </div>
              </div>
            </div>

            {/* Active deductions */}
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {sim.factors.map((f, i) => (
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

          {/* How chats & files connect to risk */}
          <div style={{ background: "#eef2ff", borderRadius: 8, padding: 14, border: "1px solid #c7d2fe", marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: "#4338ca", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <MessageSquare size={14} /> How User Chats & Files Affect Risk
            </div>
            <div style={{ fontSize: 11, color: "#4338ca", lineHeight: 1.7 }}>
              <strong>User Chats (Conversation Transcripts):</strong> The number of conversations is tracked per agent from Dataverse.
              This directly feeds the <strong>"Stale agent"</strong> signal — if an agent has sessions but the last one was 30+ days ago, it gets a <strong>-12 point (High) deduction</strong>.
              Agents with zero conversations are flagged as potentially unused.
              <br /><br />
              <strong>Files & Audit Logs:</strong> File access events from O365 Audit API (SharePoint/OneDrive operations) are monitored.
              While file access cannot always be definitively attributed to a specific Copilot Studio agent at runtime, the audit data informs overall tenant activity.
              <br /><br />
              <strong>Renewal Date:</strong> Admins set a renewal date during governance review to schedule the next re-certification.
              If no renewal date is set, the column shows the agent's creation date from Dataverse instead.
              Once a renewal date passes without re-certification, the <strong>"Overdue for renewal"</strong> signal triggers a <strong>-10 point deduction</strong>.
              <br /><br />
              <strong>Note:</strong> Risk scoring is based on <em>configuration posture</em>, not observed runtime behavior.
              Specific runtime actions (e.g., which files an agent read) are only visible when an audit event is generated.
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

function computeDiscoveredAgentRisk(agent) {
  let score = 100;
  const factors = [];
  const recommendations = [];

  const permCount = agent.permissions?.length || 0;
  if (permCount > 10) {
    score -= 15;
    factors.push({ signal: "High permission count", weight: "high", description: `Agent has ${permCount} permissions — review if all are necessary` });
    recommendations.push(`Review and reduce the ${permCount} permissions granted to "${agent.name}".`);
  } else if (permCount > 5) {
    score -= 8;
    factors.push({ signal: "Moderate permissions", weight: "medium", description: `Agent has ${permCount} permissions` });
  }

  if (!agent.owner?.displayName) {
    score -= 20;
    factors.push({ signal: "No identified owner", weight: "high", description: "Agent has no clear owner — may be orphaned" });
    recommendations.push(`Assign an owner to "${agent.name}" to ensure accountability.`);
  }

  const connCount = agent.connectors?.length || 0;
  if (connCount > 3) {
    score -= 10;
    factors.push({ signal: "Multiple connectors/tools", weight: "medium", description: `Agent uses ${connCount} connectors — broader attack surface` });
  }

  if (!agent.activity || agent.activity.totalInvocations === 0) {
    score -= 5;
    factors.push({ signal: "No recorded activity", weight: "low", description: "Agent has no recorded invocations — may be unused" });
    recommendations.push(`Verify "${agent.name}" is still needed — no usage activity detected.`);
  }

  if (agent.lifecycleStatus !== "active") {
    score -= 10;
    factors.push({ signal: "Non-active status", weight: "medium", description: `Agent status: ${agent.lifecycleStatus || "unknown"}` });
  }

  if (agent.deployedTo?.length > 2) {
    score -= 5;
    factors.push({ signal: "Wide deployment", weight: "low", description: `Deployed to ${agent.deployedTo.length} channels` });
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? "low" : score >= 60 ? "medium" : score >= 40 ? "high" : "critical";
  return { score, level, factors, recommendations };
}

function RiskManagementPanel({ oauthKeyId, dataverseEnvUrl, discoveredAgents = [], applicationLabel, application = "copilot_studio", enabled = true, searchQuery = "", agentFilter = "all" }) {
  const [riskData, setRiskData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedBot, setExpandedBot] = useState(null);

  const [blockedAgents, setBlockedAgents] = useState(new Set());
  const [blockFeedback, setBlockFeedback] = useState({});

  const isCopilotStudio = application === "copilot_studio";

  // Load blocked agents on mount
  useEffect(() => {
    agentGovernanceApi.getBlockedAgents()
      .then((list) => setBlockedAgents(new Set((list || []).map(b => b.agent_id))))
      .catch(() => {});
  }, []);

  const handleBlockToggle = async (agent) => {
    const agentId = agent.botId || agent.id;
    const isBlocked = blockedAgents.has(agentId);
    try {
      if (isBlocked) {
        await agentGovernanceApi.unblockAgent({ agent_id: agentId });
        setBlockedAgents(prev => { const n = new Set(prev); n.delete(agentId); return n; });
        setBlockFeedback(prev => ({ ...prev, [agentId]: { ok: true, msg: "Unblocked" } }));
      } else {
        await agentGovernanceApi.blockAgent({
          agent_id: agentId,
          agent_name: agent.botName || agent.name,
          platform: agent.platform || application,
          reason: "Blocked by admin from Risk Management",
        });
        setBlockedAgents(prev => new Set([...prev, agentId]));
        setBlockFeedback(prev => ({ ...prev, [agentId]: { ok: true, msg: "Blocked" } }));
      }
    } catch (err) {
      setBlockFeedback(prev => ({ ...prev, [agentId]: { ok: false, msg: err.message } }));
    }
    setTimeout(() => setBlockFeedback(prev => { const n = { ...prev }; delete n[agentId]; return n; }), 3000);
  };

  const loadRisk = async () => {
    if (!oauthKeyId) return;
    if (!isCopilotStudio) return;
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.fetchRiskSummary(oauthKeyId, dataverseEnvUrl || undefined);
      setRiskData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (oauthKeyId && enabled && isCopilotStudio) loadRisk();
  }, [oauthKeyId, enabled, isCopilotStudio]);

  // For non-Copilot-Studio apps, use discovery scan's pre-computed risk (from assessRisk in riskService)
  const discoveryAgentsWithRisk = useMemo(() => {
    if (isCopilotStudio || discoveredAgents.length === 0) return [];
    return discoveredAgents.map((a) => {
      const risk = a.risk || computeDiscoveredAgentRisk(a);
      const isOrphaned = !a.owner?.displayName || a.isOrphaned;
      return {
        botId: a.id || a.botId,
        botName: a.name,
        description: a.description || `${a.platform} agent`,
        ownerName: a.owner?.displayName || "Unknown",
        isOrphaned,
        status: a.lifecycleStatus || "unknown",
        risk,
        sessionCount: a.activity?.totalInvocations || 0,
        conversationCount: a.activity?.totalConversations || 0,
        lastActivity: a.activity?.lastActiveTimestamp || null,
        createdOn: a.createdOn || a.registeredOn || null,
        modifiedOn: a.modifiedOn || null,
        renewalDate: null,
        renewalPeriodDays: 90,
        isExpiredRenewal: false,
        platform: a.platform,
        connectors: a.connectors,
        permissions: a.permissions,
        deployedTo: a.deployedTo,
      };
    });
  }, [isCopilotStudio, discoveredAgents]);

  // For Copilot Studio: use /risk-summary API, filtered by discovered agents
  const allDataverseAgents = riskData?.agents || [];
  const dataverseAgents = useMemo(() => {
    if (!isCopilotStudio) return [];
    if (allDataverseAgents.length === 0 || discoveredAgents.length === 0) return allDataverseAgents;
    const ids = new Set(discoveredAgents.map(a => a.id?.toLowerCase()).filter(Boolean));
    const names = new Set(discoveredAgents.map(a => a.name?.toLowerCase()).filter(Boolean));
    const botIds = new Set(discoveredAgents.map(a => a.botId?.toLowerCase()).filter(Boolean));
    return allDataverseAgents.filter(a =>
      ids.has(a.botId?.toLowerCase()) || names.has(a.botName?.toLowerCase()) || botIds.has(a.botId?.toLowerCase())
    );
  }, [isCopilotStudio, allDataverseAgents, discoveredAgents]);

  // Copilot Studio fallback: if /risk-summary returned nothing but we have discovered agents
  const copilotFallbackAgents = useMemo(() => {
    if (!isCopilotStudio || dataverseAgents.length > 0 || discoveredAgents.length === 0) return [];
    return discoveredAgents.map((a) => {
      const risk = a.risk || computeDiscoveredAgentRisk(a);
      return {
        botId: a.id || a.botId,
        botName: a.name,
        description: a.description || `${a.platform} agent`,
        ownerName: a.owner?.displayName || "Unknown",
        isOrphaned: !a.owner?.displayName,
        status: a.lifecycleStatus || "unknown",
        risk,
        sessionCount: a.activity?.totalInvocations || 0,
        conversationCount: 0,
        lastActivity: a.activity?.lastActiveTimestamp || null,
        renewalDate: null,
        renewalPeriodDays: 90,
        isExpiredRenewal: false,
        platform: a.platform,
        connectors: a.connectors,
        permissions: a.permissions,
      };
    });
  }, [isCopilotStudio, dataverseAgents, discoveredAgents]);

  let agents = isCopilotStudio
    ? (dataverseAgents.length > 0 ? dataverseAgents : copilotFallbackAgents)
    : discoveryAgentsWithRisk;
  if (agentFilter !== "all") {
    agents = agents.filter(a => a.botName === agentFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    agents = agents.filter(a =>
      a.botName?.toLowerCase().includes(q) ||
      a.ownerName?.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.risk?.factors?.some(f => f.signal?.toLowerCase().includes(q) || f.description?.toLowerCase().includes(q))
    );
  }
  const criticalCount = agents.filter(a => a.risk?.level === "critical").length;
  const highCount = agents.filter(a => a.risk?.level === "high").length;
  const mediumCount = agents.filter(a => a.risk?.level === "medium").length;
  const lowCount = agents.filter(a => a.risk?.level === "low").length;
  const avgScore = agents.length > 0 ? Math.round(agents.reduce((s, a) => s + (a.risk?.score || 0), 0) / agents.length) : 0;
  const orphanedCount = agents.filter(a => a.isOrphaned).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Shield size={18} color="#6366f1" />
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ag-text-primary)" }}>Risk Management</span>
        </div>
        {isCopilotStudio ? (
          <button
            onClick={loadRisk}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "#6366f1", color: "#fff", padding: "7px 14px",
              borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: "none", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
            {loading ? "Scanning..." : "Refresh Risk Scores"}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: "#999" }}>
            Risk scores from last discovery scan · {agents.length} agent{agents.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading && agents.length === 0 ? (
        <LoadingSpinner message="Computing risk scores for all agents..." />
      ) : error ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 13, color: "var(--ag-text-secondary)" }}>{error}</div>
        </div>
      ) : agents.length > 0 ? (
        <>
          {/* Summary stats */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              { label: "Avg. Risk Score", value: avgScore, color: avgScore > 75 ? "#22c55e" : avgScore > 50 ? "#f59e0b" : "#ef4444", sub: "/100 (higher = safer)" },
              { label: "Critical", value: criticalCount, color: "#ef4444", sub: "immediate action" },
              { label: "High Risk", value: highCount, color: "#f59e0b", sub: "needs review" },
              { label: "Medium", value: mediumCount, color: "#3b82f6", sub: "monitor" },
              { label: "Low Risk", value: lowCount, color: "#22c55e", sub: "healthy" },
              { label: "Orphaned", value: orphanedCount, color: "#ef4444", sub: "no owner" },
            ].map((s) => (
              <div key={s.label} style={{
                background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8,
                padding: "10px 16px", minWidth: 110,
              }}>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 9, color: "#999" }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Agent risk table */}
          <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--ag-border)", background: "#f8f9fb" }}>
                  <th style={thStyle}>Agent</th>
                  <th style={thStyle}>Owner</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Risk Level</th>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Activity</th>
                  <th style={thStyle}>Renewal</th>
                  <th style={thStyle}>Risk Factors</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const renewalOk = agent.renewalDate && new Date(agent.renewalDate) > new Date();
                  const daysToRenewal = agent.renewalDate
                    ? Math.ceil((new Date(agent.renewalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;
                  const isExpanded = expandedBot === agent.botId;
                  const allFactors = agent.risk?.factors || [];
                  const activeDeductions = allFactors.filter(f => f.weight !== "info" && f.weight !== "low");
                  const infoFactors = allFactors.filter(f => f.weight === "info");

                  return (
                    <>
                      <tr
                        key={agent.botId}
                        style={{ borderBottom: isExpanded ? "none" : "1px solid var(--ag-border)", cursor: "pointer", background: isExpanded ? "#f8f9fb" : undefined }}
                        onClick={() => setExpandedBot(isExpanded ? null : agent.botId)}
                      >
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {isExpanded ? <ChevronDown size={12} color="#6366f1" /> : <ChevronRight size={12} color="#999" />}
                            <Bot size={14} color="#6366f1" />
                            <div>
                              <div style={{ fontWeight: 600, color: "var(--ag-text-primary)" }}>{agent.botName}</div>
                              <div style={{ fontSize: 9, color: "#999", fontFamily: "monospace" }}>{agent.botId?.substring(0, 12)}...</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                            {agent.isOrphaned ? (
                              <span style={{ color: "#ef4444", display: "flex", alignItems: "center", gap: 3 }}>
                                <AlertTriangle size={10} /> Orphaned
                              </span>
                            ) : (
                              <span>{agent.ownerName}</span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <Badge text={agent.status} color={agent.status === "active" ? "#22c55e" : "#f59e0b"} />
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <RiskBadge level={agent.risk?.level} />
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 50, height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden" }}>
                              <div style={{
                                width: `${agent.risk?.score || 0}%`, height: "100%", borderRadius: 3,
                                background: RISK_COLORS[agent.risk?.level] || "#6b7280",
                              }} />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ag-text-primary)" }}>{agent.risk?.score}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ fontSize: 11 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ag-text-primary)" }}>
                              <MessageSquare size={10} /> {agent.conversationCount || 0} chats
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ag-text-secondary)" }}>
                              <Activity size={10} /> {agent.sessionCount} sessions
                            </div>
                            <div style={{ fontSize: 10, color: "#999" }}>
                              {agent.lastActivity ? `Last: ${new Date(agent.lastActivity).toLocaleDateString()}` : "No activity"}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          {agent.renewalDate ? (
                            <div style={{ fontSize: 11 }}>
                              <div style={{
                                display: "flex", alignItems: "center", gap: 4,
                                color: agent.isExpiredRenewal ? "#ef4444" : daysToRenewal < 14 ? "#f59e0b" : "#22c55e",
                              }}>
                                <Clock size={10} />
                                {agent.isExpiredRenewal
                                  ? "EXPIRED"
                                  : `${daysToRenewal}d left`}
                              </div>
                              <div style={{ fontSize: 9, color: "#999" }}>
                                Due: {new Date(agent.renewalDate).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: "#999" }}>
                              <div>No review scheduled</div>
                              {agent.createdOn && (
                                <div style={{ fontSize: 9, color: "#bbb" }}>
                                  Created: {new Date(agent.createdOn).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "10px 8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {allFactors.filter(f => f.weight !== "info").slice(0, 3).map((f, i) => (
                              <div key={i} style={{ fontSize: 10, color: "var(--ag-text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{
                                  width: 6, height: 6, borderRadius: "50%",
                                  background: f.weight === "critical" ? "#ef4444" : f.weight === "high" ? "#f59e0b" : f.weight === "medium" ? "#3b82f6" : "#22c55e",
                                  flexShrink: 0,
                                }} />
                                {f.signal}
                              </div>
                            ))}
                            <div style={{ fontSize: 9, color: "#6366f1", marginTop: 2 }}>{isExpanded ? "Click to collapse" : "Click for full breakdown"}</div>
                          </div>
                        </td>
                        <td style={{ padding: "10px 8px" }} onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const agentId = agent.botId || agent.id;
                            const fb = blockFeedback[agentId];
                            if (fb) {
                              return <span style={{ fontSize: 10, fontWeight: 600, color: fb.ok ? "#16a34a" : "#dc2626" }}>{fb.msg}</span>;
                            }
                            const isBlocked = blockedAgents.has(agentId);
                            return (
                              <button
                                onClick={() => handleBlockToggle(agent)}
                                title={isBlocked ? "Unblock this agent" : "Block this agent for all users"}
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 4,
                                  padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                  cursor: "pointer", fontFamily: "inherit",
                                  border: isBlocked ? "1px solid #22c55e44" : "1px solid #ef444444",
                                  background: isBlocked ? "#f0fdf4" : "#fef2f2",
                                  color: isBlocked ? "#16a34a" : "#dc2626",
                                }}
                              >
                                <Lock size={11} /> {isBlocked ? "Unblock" : "Block"}
                              </button>
                            );
                          })()}
                        </td>
                      </tr>

                      {/* Expanded Risk Breakdown */}
                      {isExpanded && (
                        <tr key={`${agent.botId}-breakdown`} style={{ borderBottom: "2px solid var(--ag-border)" }}>
                          <td colSpan={9} style={{ padding: 0 }}>
                            <div style={{ padding: "12px 16px", background: "#f8f9fb", borderTop: "1px dashed var(--ag-border)" }}>
                              <div style={{ fontWeight: 700, fontSize: 12, color: "#4338ca", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                                <ShieldAlert size={14} /> Full Risk Breakdown — {agent.botName}
                                <span style={{ marginLeft: "auto", fontSize: 24, fontWeight: 800, color: RISK_COLORS[agent.risk?.level] || "#6b7280" }}>
                                  {agent.risk?.score}/100
                                </span>
                              </div>

                              {/* Score computation walkthrough */}
                              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                                <div style={{ flex: 1, minWidth: 300 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 6 }}>Score Computation</div>
                                  <div style={{ fontSize: 11, fontFamily: "monospace", background: "#fff", padding: 10, borderRadius: 6, border: "1px solid var(--ag-border)", lineHeight: 1.8 }}>
                                    <div>Start: <span style={{ color: "#22c55e", fontWeight: 700 }}>100</span></div>
                                    <div style={{ color: "#f59e0b" }}>Base risk ({agent.risk?.level || "low"}): <span style={{ fontWeight: 700 }}>-5</span></div>
                                    {allFactors.filter(f => f.weight !== "info").map((f, i) => {
                                      const isDeduction = f.weight === "high" || f.weight === "medium" || f.weight === "low";
                                      return (
                                        <div key={i} style={{ color: isDeduction ? "#ef4444" : "#22c55e" }}>
                                          {f.signal}: <span style={{ fontWeight: 700 }}>{isDeduction ? `deducted` : `bonus`}</span>
                                          <span style={{ color: "#999", fontSize: 10 }}> ({f.weight})</span>
                                        </div>
                                      );
                                    })}
                                    <div style={{ borderTop: "1px solid var(--ag-border)", marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
                                      Final: <span style={{ color: RISK_COLORS[agent.risk?.level] || "#6b7280" }}>{agent.risk?.score}</span>
                                    </div>
                                  </div>
                                </div>

                                <div style={{ flex: 1, minWidth: 300 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 6 }}>Activity & Context</div>
                                  <div style={{ background: "#fff", padding: 10, borderRadius: 6, border: "1px solid var(--ag-border)", fontSize: 11, lineHeight: 1.8 }}>
                                    {isCopilotStudio && <div><strong>Conversations:</strong> {agent.conversationCount || 0} transcripts in Dataverse</div>}
                                    <div><strong>{isCopilotStudio ? "Sessions (30d)" : "Invocations"}:</strong> {agent.sessionCount || 0}</div>
                                    <div><strong>Last Activity:</strong> {agent.lastActivity ? new Date(agent.lastActivity).toLocaleString() : "Never"}</div>
                                    <div><strong>Days Since Activity:</strong> {agent.lastActivity ? Math.floor((Date.now() - new Date(agent.lastActivity).getTime()) / (1000 * 60 * 60 * 24)) : "N/A"}</div>
                                    <div><strong>Created:</strong> {agent.createdOn ? new Date(agent.createdOn).toLocaleString() : "Unknown"}</div>
                                    <div><strong>Last Modified:</strong> {agent.modifiedOn ? new Date(agent.modifiedOn).toLocaleString() : "Unknown"}</div>
                                    {agent.platform && <div><strong>Platform:</strong> {agent.platform}</div>}
                                    {agent.permissions?.length > 0 && <div><strong>Permissions:</strong> {agent.permissions.join(", ")}</div>}
                                    {agent.connectors?.length > 0 && <div><strong>Connectors:</strong> {agent.connectors.map(c => c.name || c.type).join(", ")}</div>}
                                    {agent.deployedTo?.length > 0 && <div><strong>Deployed To:</strong> {agent.deployedTo.join(", ")}</div>}
                                    <div><strong>Renewal Due:</strong> {agent.renewalDate ? `${new Date(agent.renewalDate).toLocaleDateString()} (${agent.isExpiredRenewal ? "EXPIRED" : daysToRenewal !== null ? `${daysToRenewal} days left` : ""})` : "No review scheduled"}</div>
                                    <div><strong>Owner:</strong> {agent.ownerName} {agent.isOrphaned ? "(DISABLED/ORPHANED)" : ""}</div>
                                    {infoFactors.map((f, i) => (
                                      <div key={i} style={{ color: "#6366f1" }}>{f.description}</div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {/* Recommendations */}
                              {(agent.risk?.recommendations || []).length > 0 && (
                                <div style={{ marginTop: 10, background: "#fffbeb", padding: 10, borderRadius: 6, border: "1px solid #fde68a" }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>Recommendations</div>
                                  {agent.risk.recommendations.map((r, i) => (
                                    <div key={i} style={{ fontSize: 11, color: "#92400e", display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ color: "#f59e0b" }}>&#9679;</span> {r}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Recommendations */}
          {agents.some(a => a.risk?.recommendations?.length > 0) && (
            <div style={{ marginTop: 16, background: "#faf5ff", border: "1px solid #c084fc33", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <TrendingDown size={16} color="#8b5cf6" />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#8b5cf6" }}>Recommendations</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {agents
                  .filter(a => a.risk?.level === "critical" || a.risk?.level === "high")
                  .slice(0, 5)
                  .map((a) => (
                    <div key={a.botId} style={{ fontSize: 12, color: "var(--ag-text-primary)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <RiskBadge level={a.risk.level} />
                      <div>
                        <strong>{a.botName}:</strong>{" "}
                        {(a.risk.recommendations || []).join(". ")}
                      </div>
                    </div>
                  ))}
                {agents.every(a => a.risk?.level !== "critical" && a.risk?.level !== "high") && (
                  <div style={{ fontSize: 12, color: "#22c55e", display: "flex", alignItems: "center", gap: 6 }}>
                    <CheckCircle size={14} />
                    All agents are within acceptable risk parameters. Continue monitoring.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Risk Scoring Guide */}
          <RiskScoringGuide />
        </>
      ) : (
        <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
          <Shield size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>No agents found for {applicationLabel || "this application"}</h3>
          <p style={{ fontSize: 13 }}>
            {isCopilotStudio
              ? "Click \"Refresh Risk Scores\" or run a discovery scan to compute risk scores for your agents."
              : "Run a discovery scan first to discover and compute risk scores for your agents."
            }
          </p>
        </div>
      )}
    </div>
  );
}

const APP_OPTIONS = [
  { id: "copilot_studio", label: "Copilot Studio", color: "#742774" },
  { id: "personal_agent", label: "Personal Agents", color: "#2563eb" },
  { id: "sharepoint_agent", label: "SharePoint Agents", color: "#059669" },
  { id: "azure_foundry", label: "Azure AI Foundry", color: "#0078D4" },
  { id: "google_reasoning_engines", label: "Reasoning Engines", color: "#4285F4" },
  { id: "google_agent_builder", label: "Agent Builder", color: "#EA4335" },
  { id: "google_chat_bots", label: "Google Chat Bots", color: "#34A853" },
  { id: "google_gems", label: "Gemini Gems", color: "#FBBC04" },
  { id: "google_notebooklm", label: "NotebookLM", color: "#9334E6" },
  { id: "openai_assistant", label: "OpenAI Assistants", color: "#10a37f" },
  { id: "custom_gpt", label: "Custom GPTs", color: "#7c3aed" },
  { id: "claude_ai_project", label: "Claude.ai Projects", color: "#D4622A" },
  { id: "gemini_enterprise", label: "Gemini Enterprise", color: "#886FBF" },
];

const GOOGLE_APP_IDS = new Set([
  "google_reasoning_engines",
  "google_agent_builder",
  "google_chat_bots",
  "google_gems",
  "google_notebooklm",
]);

const OPENAI_APP_IDS = new Set(["openai_assistant", "custom_gpt"]);
const CLAUDE_APP_IDS = new Set(["claude_ai_project"]);
const GEMINI_ENTERPRISE_APP_IDS = new Set(["gemini_enterprise"]);

// Azure Risk Panel — shows Azure-specific governance signals
function AzureRiskPanel({ oauthKeyId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!oauthKeyId) return;
    setLoading(true);
    agentGovernanceApi.discoverAzureAI(oauthKeyId)
      .then((result) => setData(result))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [oauthKeyId]);

  if (loading) return <LoadingSpinner message="Analyzing Azure AI risk posture..." />;
  if (error) return <div style={{ padding: 20, color: "#ef4444", fontSize: 12 }}>{error}</div>;
  if (!data) return null;

  // Compute risk signals from Azure data
  const publicOpenAI = data.openAIResources.filter((r) => r.publicAccess !== "Disabled");
  const noContentFilter = data.openAIResources.flatMap((r) => r.deployments).filter((d) => !d.contentFilter);
  const keyAuthEnabled = data.openAIResources.filter((r) => !r.localAuthDisabled);
  const ownerContributor = data.accessControl.filter((a) => a.roleName.includes("Owner") || a.roleName.includes("Contributor"));
  const spAccess = data.accessControl.filter((a) => a.principalType === "ServicePrincipal");

  const signals = [
    { label: "Public network access enabled", count: publicOpenAI.length, severity: publicOpenAI.length > 0 ? "high" : "low", desc: "OpenAI resources accessible from the internet" },
    { label: "Deployments without content filter", count: noContentFilter.length, severity: noContentFilter.length > 0 ? "critical" : "low", desc: "No RAI content safety policy applied" },
    { label: "API key auth enabled", count: keyAuthEnabled.length, severity: keyAuthEnabled.length > 0 ? "medium" : "low", desc: "Key-based auth is less secure than Entra ID" },
    { label: "Owner/Contributor role assignments", count: ownerContributor.length, severity: ownerContributor.length > 3 ? "high" : ownerContributor.length > 0 ? "medium" : "low", desc: "Principals with write access to AI resources" },
    { label: "Service principal access", count: spAccess.length, severity: spAccess.length > 5 ? "medium" : "low", desc: "Apps and services with access to AI resources" },
  ];

  const overallScore = signals.reduce((s, sig) => {
    if (sig.severity === "critical") return s - 25;
    if (sig.severity === "high") return s - 15;
    if (sig.severity === "medium") return s - 5;
    return s;
  }, 100);
  const overallLevel = overallScore >= 80 ? "low" : overallScore >= 60 ? "medium" : overallScore >= 40 ? "high" : "critical";

  return (
    <div>
      {/* Overall score */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 160 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Azure AI Risk Score</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: RISK_COLORS[overallLevel] }}>{Math.max(0, overallScore)}</div>
          <RiskBadge level={overallLevel} />
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 120 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>OpenAI Resources</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#10b981" }}>{data.openAIResources.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 120 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Model Deployments</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#6366f1" }}>{data.openAIResources.reduce((s, r) => s + r.deployments.length, 0)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 120 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>RBAC Assignments</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>{data.accessControl.length}</div>
        </div>
      </div>

      {/* Risk signals */}
      <Section title="Risk Signals">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {signals.map((sig) => (
            <div key={sig.label} style={{
              display: "flex", alignItems: "center", gap: 14,
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px",
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: `${RISK_COLORS[sig.severity]}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {sig.severity === "critical" ? <XCircle size={18} color={RISK_COLORS.critical} /> :
                 sig.severity === "high" ? <AlertTriangle size={18} color={RISK_COLORS.high} /> :
                 sig.severity === "medium" ? <ShieldAlert size={18} color={RISK_COLORS.medium} /> :
                 <CheckCircle size={18} color={RISK_COLORS.low} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#111" }}>{sig.label}</div>
                <div style={{ fontSize: 11, color: "#999" }}>{sig.desc}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: RISK_COLORS[sig.severity], minWidth: 30, textAlign: "center" }}>{sig.count}</div>
              <RiskBadge level={sig.severity} />
            </div>
          ))}
        </div>
      </Section>

      {/* Detailed findings */}
      {publicOpenAI.length > 0 && (
        <Section title="Public Access Resources">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {publicOpenAI.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
                <Globe size={14} color="#ef4444" />
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: "#999" }}>{r.location}</span>
                <span style={{ color: "#999" }}>{r.endpoint}</span>
                <span style={{ marginLeft: "auto" }}><Badge text="Public" color="#ef4444" /></span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {noContentFilter.length > 0 && (
        <Section title="Deployments Missing Content Filter">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {noContentFilter.map((d) => (
              <div key={d.id} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 14px", fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "#dc2626" }}>{d.name}</span>
                <span style={{ color: "#999", marginLeft: 8 }}>{d.modelName}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {ownerContributor.length > 0 && (
        <Section title="Elevated Access (Owner/Contributor)">
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 }}>Principal</th>
                <th style={{ textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 }}>Type</th>
                <th style={{ textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 }}>Role</th>
                <th style={{ textAlign: "left", padding: "8px 14px", color: "#999", fontWeight: 600, fontSize: 11 }}>Resource</th>
              </tr></thead>
              <tbody>
                {ownerContributor.slice(0, 20).map((ac, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 14px", fontFamily: "monospace", fontSize: 10 }}>{ac.principalId.slice(0, 12)}...</td>
                    <td style={{ padding: "8px 14px" }}><Badge text={ac.principalType} color={ac.principalType === "User" ? "#6366f1" : "#f59e0b"} /></td>
                    <td style={{ padding: "8px 14px", fontWeight: 600, color: "#ef4444" }}>{ac.roleName}</td>
                    <td style={{ padding: "8px 14px", color: "#999" }}>{ac.resourceId.split("/").pop()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

// Azure Knowledge Panel — shows OpenAI data sources / grounding config
function AzureKnowledgePanel({ oauthKeyId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!oauthKeyId) return;
    setLoading(true);
    agentGovernanceApi.discoverAzureAI(oauthKeyId)
      .then((result) => setData(result))
      .finally(() => setLoading(false));
  }, [oauthKeyId]);

  if (loading) return <LoadingSpinner message="Loading Azure AI resource details..." />;
  if (!data) return null;

  return (
    <div>
      {/* OpenAI Resources with their deployments */}
      {data.openAIResources.map((resource) => (
        <Section key={resource.id} title={`${resource.name} — ${resource.location}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {resource.endpoint && (
              <div style={{ fontSize: 11, fontFamily: "monospace", color: "#6366f1", padding: "8px 12px", background: "#f9fafb", borderRadius: 6, border: "1px solid #e5e7eb" }}>
                {resource.endpoint}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, padding: "4px 10px", background: resource.publicAccess === "Disabled" ? "#f0fdf4" : "#fef2f2", borderRadius: 4, border: `1px solid ${resource.publicAccess === "Disabled" ? "#bbf7d0" : "#fecaca"}` }}>
                Network: <strong>{resource.publicAccess === "Disabled" ? "Private" : "Public"}</strong>
              </div>
              <div style={{ fontSize: 11, padding: "4px 10px", background: "#f9fafb", borderRadius: 4, border: "1px solid #e5e7eb" }}>
                SKU: <strong>{resource.skuName || "—"}</strong>
              </div>
              <div style={{ fontSize: 11, padding: "4px 10px", background: resource.localAuthDisabled ? "#f0fdf4" : "#fef3c7", borderRadius: 4, border: `1px solid ${resource.localAuthDisabled ? "#bbf7d0" : "#fde68a"}` }}>
                Key Auth: <strong>{resource.localAuthDisabled ? "Disabled" : "Enabled"}</strong>
              </div>
            </div>
            {resource.deployments.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                <thead><tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#999", fontSize: 11 }}>Deployment</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#999", fontSize: 11 }}>Model</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#999", fontSize: 11 }}>Version</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#999", fontSize: 11 }}>Content Filter</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", color: "#999", fontSize: 11 }}>Capacity</th>
                </tr></thead>
                <tbody>
                  {resource.deployments.map((d) => (
                    <tr key={d.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{d.name}</td>
                      <td style={{ padding: "8px 12px" }}><span style={{ color: "#6366f1", fontWeight: 600 }}>{d.modelName}</span></td>
                      <td style={{ padding: "8px 12px", color: "#999" }}>{d.modelVersion || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{d.contentFilter ? <Badge text={d.contentFilter} color="#22c55e" /> : <Badge text="None" color="#ef4444" />}</td>
                      <td style={{ padding: "8px 12px" }}>{d.capacityTPM ? `${d.capacityTPM >= 1000 ? d.capacityTPM / 1000 + "K" : d.capacityTPM} TPM` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>
      ))}

      {/* AI Services */}
      {data.aiServices.length > 0 && (
        <Section title={`AI Services (${data.aiServices.length})`}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data.aiServices.map((svc) => (
              <div key={svc.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px", minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{svc.name}</div>
                <div style={{ fontSize: 11, color: "#999" }}>{svc.kind} · {svc.location} · {svc.skuName || "Free"}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.openAIResources.length === 0 && data.aiServices.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
          <Brain size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p style={{ fontSize: 13 }}>No Azure AI resources found. Ensure Reader RBAC role is assigned.</p>
        </div>
      )}
    </div>
  );
}

// ── Azure Conversations Panel — real thread data ──
function AzureConversationsPanel({ oauthKeyId }) {
  const [threads, setThreads] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [expandedThread, setExpandedThread] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [threadData, usageData] = await Promise.all([
        agentGovernanceApi.fetchAzureThreads(oauthKeyId),
        agentGovernanceApi.fetchAzureUsage(oauthKeyId, "P7D"),
      ]);
      setThreads(threadData.threads || []);
      setUsage(usageData);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Failed to load Azure conversations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (oauthKeyId && !loaded) load(); }, [oauthKeyId]);

  if (loading && !loaded) return <LoadingSpinner message="Loading Azure AI conversation threads..." />;

  return (
    <div>
      {/* Usage KPIs */}
      {usage && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Total Requests", value: usage.totalRequests?.toLocaleString() || "0", color: "#6366f1" },
            { label: "Total Tokens", value: usage.totalTokens?.toLocaleString() || "0", color: "#22c55e" },
            { label: "OpenAI Resources", value: usage.resources?.length || 0, color: "#3b82f6" },
            { label: "Threads Found", value: threads.length, color: "#8b5cf6" },
          ].map((s) => (
            <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}>
              <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Deployment-level usage */}
      {usage?.resources?.length > 0 && (
        <Section title="Deployment Usage (Last 7 Days)">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Resource</th>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Deployment</th>
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Requests</th>
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Prompt Tokens</th>
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Completion Tokens</th>
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Total Tokens</th>
              </tr></thead>
              <tbody>
                {usage.resources.flatMap((r) => r.metrics.deployments.map((d) => (
                  <tr key={`${r.resourceName}-${d.deploymentName}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{r.resourceName}</td>
                    <td style={{ padding: "8px 10px" }}>{d.deploymentName}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: "#6366f1", fontWeight: 600 }}>{d.requestCount.toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{d.promptTokens.toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{d.completionTokens.toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{d.totalTokens.toLocaleString()}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Thread list */}
      {threads.length > 0 ? (
        <Section title={`Conversation Threads (${threads.length})`}>
          {threads.map((thread) => (
            <div key={thread.id} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
              <div
                onClick={() => setExpandedThread(expandedThread === thread.id ? null : thread.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer" }}
              >
                {expandedThread === thread.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <MessageSquare size={14} color="#0078D4" />
                <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Thread {thread.id.slice(0, 12)}...</span>
                <span style={{ fontSize: 11, color: "#999" }}>{thread.resourceName}</span>
                <span style={{ fontSize: 11, color: "#999" }}>{thread.messages?.length || 0} messages</span>
                {thread.created_at && <span style={{ fontSize: 11, color: "#999" }}>{new Date(thread.created_at * 1000).toLocaleString()}</span>}
              </div>
              {expandedThread === thread.id && thread.messages?.length > 0 && (
                <div style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  {thread.messages.map((msg) => (
                    <div key={msg.id} style={{
                      display: "flex", gap: 8, padding: "8px 12px", borderRadius: 8,
                      background: msg.role === "assistant" ? "#f0f4ff" : "#f9fafb",
                      border: `1px solid ${msg.role === "assistant" ? "#bfdbfe" : "#e5e7eb"}`,
                    }}>
                      <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: msg.role === "assistant" ? "#0078D4" : "#6366f1" }}>
                        {msg.role === "assistant" ? <Bot size={12} color="#fff" /> : <User size={12} color="#fff" />}
                      </div>
                      <div style={{ flex: 1, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: msg.role === "assistant" ? "#0078D4" : "#333", marginBottom: 2 }}>{msg.role === "assistant" ? "AI Assistant" : "User"}</div>
                        <div style={{ color: "#555", lineHeight: 1.5 }}>
                          {Array.isArray(msg.content) ? msg.content.map((c, i) => <span key={i}>{c.text?.value || c.text || JSON.stringify(c)}</span>) : (typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Section>
      ) : loaded && !error ? (
        <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
          <MessageSquare size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "#333", marginBottom: 8 }}>No Conversation Threads</h3>
          <p style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 400, margin: "0 auto" }}>
            {usage?.totalRequests > 0
              ? "Your Azure OpenAI resources have activity but no thread-based conversations. Threads are created by the Assistants API."
              : "No Azure OpenAI activity found. Ensure agents are deployed and have been used."}
          </p>
        </div>
      ) : null}

      {error && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <AlertTriangle size={24} color="#f59e0b" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, color: "#f59e0b" }}>{error}</div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={load} disabled={loading} style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "#0078D4", color: "#fff", padding: "7px 14px",
          borderRadius: 6, fontSize: 12, fontWeight: 600,
          border: "none", cursor: "pointer", fontFamily: "inherit",
        }}>
          <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}

// ── Personal / SharePoint Agent Activity Panel ──
function PersonalAgentActivityPanel({ oauthKeyId, agentType }) {
  const [signIns, setSignIns] = useState([]);
  const [appSummaries, setAppSummaries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.fetchTeamsSignIns(oauthKeyId);
      setSignIns(result.signIns || []);
      setAppSummaries(result.appSummaries || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Failed to load agent activity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (oauthKeyId && !loaded) load(); }, [oauthKeyId]);

  const filtered = searchQuery
    ? signIns.filter((s) => {
        const q = searchQuery.toLowerCase();
        return (s.userDisplayName || "").toLowerCase().includes(q) ||
               (s.appDisplayName || "").toLowerCase().includes(q) ||
               (s.userPrincipalName || "").toLowerCase().includes(q);
      })
    : signIns;

  if (loading && !loaded) return <LoadingSpinner message={`Loading ${agentType === "sharepoint_agent" ? "SharePoint" : "personal"} agent activity from sign-in logs...`} />;

  return (
    <div>
      {/* App summaries */}
      {appSummaries.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Agent Apps Found", value: appSummaries.length, color: "#6366f1" },
            { label: "Total Sign-Ins", value: signIns.length, color: "#22c55e" },
            { label: "Unique Users", value: new Set(signIns.map((s) => s.userPrincipalName)).size, color: "#3b82f6" },
          ].map((s) => (
            <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}>
              <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {appSummaries.length > 0 && (
        <Section title="Agent App Usage Summary">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>App Name</th>
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Sign-Ins</th>
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Unique Users</th>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Last Activity</th>
              </tr></thead>
              <tbody>
                {appSummaries.map((a) => (
                  <tr key={a.appId} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{a.appName}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: "#6366f1", fontWeight: 600 }}>{a.totalSignIns}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>{a.uniqueUsers}</td>
                    <td style={{ padding: "8px 10px", color: "#999", fontSize: 11 }}>{a.lastSignIn ? new Date(a.lastSignIn).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Search + Refresh */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "#999" }} />
          <input
            type="text" placeholder="Search by user or app name..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 8px 8px 30px", fontSize: 12, color: "#333", fontFamily: "inherit" }}
          />
        </div>
        <button onClick={load} disabled={loading} style={{
          display: "flex", alignItems: "center", gap: 5,
          background: agentType === "sharepoint_agent" ? "#059669" : "#2563eb", color: "#fff", padding: "7px 14px",
          borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit",
        }}>
          <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Sign-in log table */}
      {filtered.length > 0 ? (
        <Section title={`Sign-In Activity (${filtered.length})`}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>User</th>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>App</th>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Resource</th>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Status</th>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 }}>Timestamp</th>
              </tr></thead>
              <tbody>
                {filtered.slice(0, 200).map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ fontWeight: 600 }}>{s.userDisplayName}</div>
                      <div style={{ fontSize: 10, color: "#999" }}>{s.userPrincipalName}</div>
                    </td>
                    <td style={{ padding: "8px 10px" }}>{s.appDisplayName}</td>
                    <td style={{ padding: "8px 10px", color: "#999" }}>{s.resourceDisplayName}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <Badge text={s.status} color={s.status === "Success" ? "#22c55e" : "#ef4444"} />
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "#999" }}>{new Date(s.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : loaded && !error ? (
        <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
          <Activity size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "#333", marginBottom: 8 }}>No Agent Activity Found</h3>
          <p style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 400, margin: "0 auto" }}>
            Sign-in logs for {agentType === "sharepoint_agent" ? "SharePoint" : "personal"} agents will appear once users interact with them.
            Ensure AuditLog.Read.All permission is granted.
          </p>
        </div>
      ) : null}

      {error && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <AlertTriangle size={24} color="#f59e0b" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 12, color: "#f59e0b" }}>{error}</div>
        </div>
      )}
    </div>
  );
}

// ── Personal Agent Knowledge Panel ──────────────
function PersonalAgentKnowledgePanel({ oauthKeyId, dataverseEnvUrl, agentType }) {
  const [knowledge, setKnowledge] = useState([]);
  const [assistants, setAssistants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        agentGovernanceApi.fetchKnowledgeSources(oauthKeyId, dataverseEnvUrl),
        agentGovernanceApi.fetchAzureAssistants(oauthKeyId),
      ]);
      if (results[0].status === "fulfilled") setKnowledge(results[0].value.bots || []);
      if (results[1].status === "fulfilled") setAssistants(results[1].value.assistants || []);
      setLoaded(true);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { if (oauthKeyId && !loaded) load(); }, [oauthKeyId]);

  if (loading && !loaded) return <LoadingSpinner message="Scanning agent knowledge and configuration..." />;

  const isSharePoint = agentType === "sharepoint_agent";

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: "14px 16px", background: isSharePoint ? "#05966908" : "#2563eb08",
        border: `1px solid ${isSharePoint ? "#05966922" : "#2563eb22"}`, borderRadius: 8,
        marginBottom: 16, fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6,
      }}>
        <Brain size={18} color={isSharePoint ? "#059669" : "#2563eb"} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 4 }}>
            {isSharePoint ? "SharePoint Agent Configuration" : "Personal Agent Configuration"}
          </div>
          {isSharePoint
            ? "SharePoint agents use site content as their knowledge source. Knowledge is linked to the SharePoint site where the agent is deployed."
            : "Personal agents may have Dataverse knowledge sources if they were built in Copilot Studio, or Azure OpenAI configurations if built with the Assistants API."}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={load} disabled={loading} style={{
          display: "flex", alignItems: "center", gap: 5,
          background: isSharePoint ? "#059669" : "#2563eb", color: "#fff", padding: "7px 14px",
          borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit",
        }}>
          <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {loading ? "Scanning..." : "Refresh"}
        </button>
      </div>

      {/* Dataverse knowledge sources */}
      {knowledge.length > 0 && (
        <Section title={`Dataverse Knowledge Sources (${knowledge.length} agents)`}>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {[
              { label: "Agents Scanned", value: knowledge.length, color: "#6366f1" },
              { label: "Total Sources", value: knowledge.reduce((s, b) => s + (b.sources?.length || 0), 0), color: "#22c55e" },
              { label: "With Sources", value: knowledge.filter((b) => b.sources?.length > 0).length, color: "#3b82f6" },
            ].map((s) => (
              <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 130 }}>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          {knowledge.map((bot) => (
            <BotKnowledgePanel key={bot.botId} bot={bot} />
          ))}
        </Section>
      )}

      {/* Azure assistants knowledge */}
      {assistants.length > 0 && (
        <Section title={`Azure AI Assistants (${assistants.length})`}>
          {assistants.map((a) => (
            <div key={a.id} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 16, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Bot size={16} color="#0078D4" />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name || `Assistant ${a.id.slice(0, 8)}`}</span>
                <Badge text={a.model} color="#6366f1" />
                <span style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>{a.resourceName}</span>
              </div>
              {a.instructions && (
                <div style={{ fontSize: 12, color: "#555", marginBottom: 8, padding: "8px 12px", background: "#f9fafb", borderRadius: 6, lineHeight: 1.5 }}>
                  {a.instructions.length > 200 ? a.instructions.slice(0, 200) + "..." : a.instructions}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {a.tools?.map((t, i) => (
                  <Badge key={i} text={t.type === "function" ? `fn:${t.function?.name || "custom"}` : t.type} color={t.type === "code_interpreter" ? "#22c55e" : t.type === "file_search" ? "#3b82f6" : "#f59e0b"} />
                ))}
              </div>
              {a.files?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
                  <FolderOpen size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                  {a.files.length} attached file{a.files.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {loaded && knowledge.length === 0 && assistants.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
          <FolderOpen size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>No Knowledge Sources Found</h3>
          <p style={{ fontSize: 13, maxWidth: 460, margin: "0 auto" }}>
            {isSharePoint
              ? "SharePoint agents derive knowledge from their host site content. Run a discovery scan to find SharePoint agents."
              : "Personal agents may not have explicit knowledge sources. If built in Copilot Studio, add knowledge sources there. If using Azure OpenAI Assistants, attach files to the assistant."}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Google Conversations Panel ──────────────────
function GoogleConversationsPanel({ application }) {
  const [conversations, setConversations] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [expandedChat, setExpandedChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadConversations = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.fetchGoogleConversations(7);
      setConversations(result.conversations || []);
      setStats(result);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded && !loading) loadConversations();
  }, []);

  const filtered = searchQuery
    ? conversations.filter(c =>
        c.agentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.userName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.messages?.some(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : conversations;

  if (loading && !loaded) {
    return <LoadingSpinner message="Fetching conversation logs from Cloud Logging..." />;
  }

  if (error && !loaded) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{error}</div>
        <div style={{ marginTop: 16, padding: 16, background: "#FEF3C7", borderRadius: 8, maxWidth: 420, margin: "16px auto 0", textAlign: "left" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#92400E", marginBottom: 8 }}>To enable conversation logging:</div>
          <ol style={{ fontSize: 11, color: "#78350F", lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
            <li>Open your agent in Agent Builder</li>
            <li>Go to <strong>Settings → Logging</strong></li>
            <li>Enable <strong>Cloud Logging</strong></li>
            <li>Grant <strong>Logs Viewer</strong> role to the service account</li>
            <li>Send a few test messages to the agent</li>
            <li>Click Refresh below</li>
          </ol>
        </div>
        <button onClick={loadConversations} style={{ marginTop: 16, padding: "8px 20px", background: "#4285F4", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <RefreshCw size={12} style={{ marginRight: 6 }} />Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Stats */}
      {stats && conversations.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { label: "Conversations", value: stats.totalConversations, color: "#4285F4" },
            { label: "Messages", value: stats.totalMessages, color: "#34A853" },
            { label: "Unique Users", value: stats.uniqueUsers, color: "#FBBC05" },
            { label: "Agents", value: stats.uniqueAgents, color: "#EA4335" },
          ].map((s) => (
            <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 120 }}>
              <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search & Refresh */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "#999" }} />
          <input
            type="text" placeholder="Search conversations..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6, padding: "8px 8px 8px 30px", fontSize: 12, color: "#333", fontFamily: "inherit" }}
          />
        </div>
        <button onClick={loadConversations} disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "#4285F4", color: "#fff", padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : undefined} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Conversation list */}
      {filtered.length > 0 ? (
        <div>
          {filtered.map((conv) => (
            <div key={conv.id} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
              {/* Header */}
              <div
                onClick={() => setExpandedChat(expandedChat === conv.id ? null : conv.id)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: "pointer", background: expandedChat === conv.id ? "#f8fafc" : "transparent" }}
              >
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#4285F415", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Bot size={16} color="#4285F4" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ag-text-primary)" }}>{String(conv.agentName || "Unknown Agent")}</div>
                  <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>
                    <User size={10} style={{ marginRight: 3 }} />{String(conv.userName || "Anonymous")}
                    <span style={{ margin: "0 6px", color: "#ddd" }}>|</span>
                    <Clock size={10} style={{ marginRight: 3 }} />{new Date(conv.startTime).toLocaleString()}
                    <span style={{ margin: "0 6px", color: "#ddd" }}>|</span>
                    {conv.messageCount} message{conv.messageCount !== 1 ? "s" : ""}
                  </div>
                </div>
                <Badge
                  text={conv.source.replace("discoveryengine.googleapis.com/", "").replace("aiplatform.googleapis.com/", "")}
                  color={conv.severity === "ERROR" ? "#ef4444" : conv.severity === "WARNING" ? "#f59e0b" : "#22c55e"}
                />
                {expandedChat === conv.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>

              {/* Messages */}
              {expandedChat === conv.id && (
                <div style={{ borderTop: "1px solid var(--ag-border)", padding: "12px 16px", background: "#fafbfc" }}>
                  {conv.messages.map((msg) => (
                    <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 10, flexDirection: msg.from === "bot" ? "row" : "row-reverse" }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                        background: msg.from === "bot" ? "#4285F420" : "#6366f120",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {msg.from === "bot" ? <Bot size={12} color="#4285F4" /> : <User size={12} color="#6366f1" />}
                      </div>
                      <div style={{
                        maxWidth: "75%", padding: "8px 12px", borderRadius: 10,
                        background: msg.from === "bot" ? "#fff" : "#6366f110",
                        border: `1px solid ${msg.from === "bot" ? "#e5e7eb" : "#6366f130"}`,
                        fontSize: 12, lineHeight: 1.6, color: "#333",
                      }}>
                        <div style={{ fontSize: 10, color: "#999", marginBottom: 4 }}>
                          {String(msg.fromName || "Unknown")} — {new Date(msg.timestamp).toLocaleTimeString()}
                        </div>
                        {typeof msg.text === "string" ? msg.text : JSON.stringify(msg.text)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : loaded ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
          <MessageSquare size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>
            {searchQuery ? "No conversations match your search" : "No conversation logs found"}
          </h3>
          <p style={{ fontSize: 13, maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>
            {searchQuery ? "Try a different search term." : "Send some test messages to your agent in Agent Builder, then click Refresh. Make sure Cloud Logging is enabled in your agent's settings."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Maps APP_OPTIONS id → discovery platform values
const APP_TO_PLATFORMS = {
  copilot_studio: ["copilot_studio"],
  personal_agent: ["personal_agent"],
  sharepoint_agent: ["sharepoint_embedded"],
  azure_foundry: ["azure_foundry"],
  google_reasoning_engines: ["reasoning_engine"],
  google_agent_builder: ["agent_builder"],
  google_chat_bots: ["google_chat"],
  google_gems: ["gemini_gem"],
  google_notebooklm: ["notebooklm"],
  openai_assistant: ["openai_assistant"],
  custom_gpt: ["custom_gpt"],
  claude_ai_project: ["claude_ai_project"],
  gemini_enterprise: ["gemini_enterprise"],
};

export function UserActivityTab() {
  const { oauthKeyId, dataverseEnvUrl, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId } = useAgentAuth();
  const { state: govState } = useGovernance();
  const [subTab, setSubTab] = useState("safety");
  const [application, setApplication] = useState(() => {
    if (oauthKeyId) return "copilot_studio";
    if (googleKeyId) return "google_agent_builder";
    if (openaiKeyId) return "openai_assistant";
    if (claudeKeyId) return "claude_ai_project";
    if (geminiEnterpriseKeyId) return "gemini_enterprise";
    return "copilot_studio";
  });
  const [chats, setChats] = useState([]);
  const [files, setFiles] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [chatsLastUpdated, setChatsLastUpdated] = useState(null);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [chatsError, setChatsError] = useState(null);
  const [filesError, setFilesError] = useState(null);
  const [knowledgeError, setKnowledgeError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedChat, setExpandedChat] = useState(null);
  const [agentFilter, setAgentFilter] = useState("all");
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false);
  const [agentFilesOnly, setAgentFilesOnly] = useState(false);

  // Azure Usage Tracking state
  const [azureUsageDetails, setAzureUsageDetails] = useState(null);
  const [azureUsageLoading, setAzureUsageLoading] = useState(false);
  const [azureUsageError, setAzureUsageError] = useState(null);
  const [azureUsagePeriod, setAzureUsagePeriod] = useState("P7D");

  const loadChats = async () => {
    if (GEMINI_ENTERPRISE_APP_IDS.has(application)) return loadGeminiEnterpriseUserActivity();
    if (GOOGLE_APP_IDS.has(application)) return loadGoogleUserActivity();
    if (CLAUDE_APP_IDS.has(application)) { setChatsLoaded(true); return; }
    if (OPENAI_APP_IDS.has(application)) {
      if (!openaiKeyId) { setChatsLoaded(true); return; }
      setChatsLoading(true);
      setChatsError(null);
      try {
        const result = await agentGovernanceApi.fetchOpenAIThreads(openaiKeyId);
        setChats(result.chats || []);
        setChatsLastUpdated(new Date());
        if (result.warnings?.length) setChatsError(result.warnings[0]);
      } catch (err) {
        setChatsError(err.message || "Failed to load OpenAI conversations");
      } finally {
        setChatsLoaded(true);
        setChatsLoading(false);
      }
      return;
    }
    if (!oauthKeyId) return;
    setChatsLoading(true);
    setChatsError(null);
    try {
      const withTimeout = (promise, ms = 90000) =>
        Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

      const allAgentNames = (govState.discoveryResult?.agents || []).map((a) => a.name).filter(Boolean);

      // Fetch ALL data sources in parallel so every platform has data ready
      const [dataverseResult, personalInteractions, sharepointInteractions, azureInteractions, teamsChats] = await Promise.all([
        agentGovernanceApi.fetchUserChats(oauthKeyId, dataverseEnvUrl || undefined).catch(() => ({ chats: [] })),
        withTimeout(agentGovernanceApi.fetchCopilotInteractions(oauthKeyId, "personal_agent")).then((r) => r.chats || []).catch(() => []),
        withTimeout(agentGovernanceApi.fetchCopilotInteractions(oauthKeyId, "sharepoint_embedded")).then((r) => r.chats || []).catch(() => []),
        withTimeout(agentGovernanceApi.fetchCopilotInteractions(oauthKeyId, "azure_foundry")).then((r) => r.chats || []).catch(() => []),
        withTimeout(agentGovernanceApi.fetchM365CopilotChats(oauthKeyId, allAgentNames)).then((r) => r.chats || []).catch(() => []),
      ]);

      const allChats = [
        ...(dataverseResult.chats || []),
        ...personalInteractions,
        ...sharepointInteractions,
        ...azureInteractions,
        ...teamsChats,
      ];

      // Deduplicate by id
      const seen = new Set();
      const deduped = allChats.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

      deduped.sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

      setChats(deduped);
      setChatsLastUpdated(new Date());
    } catch (err) {
      setChatsError(err.message || "Failed to load chats");
    } finally {
      setChatsLoaded(true);
      setChatsLoading(false);
    }
  };

  const [subscriptionNote, setSubscriptionNote] = useState(null);

  const isGoogle = GOOGLE_APP_IDS.has(application);
  const isClaude = CLAUDE_APP_IDS.has(application);
  const isOpenAI = OPENAI_APP_IDS.has(application);
  const isGeminiEnterprise = GEMINI_ENTERPRISE_APP_IDS.has(application);

  // ── Unified Gemini Enterprise loader — same single-call pattern as Google.
  // The /gemini-enterprise data returns chats/files/knowledge in the same shape.
  const loadGeminiEnterpriseUserActivity = async () => {
    if (!geminiEnterpriseKeyId) return;
    setChatsLoading(true); setFilesLoading(true); setKnowledgeLoading(true);
    setChatsError(null); setFilesError(null); setKnowledgeError(null);
    try {
      const result = await agentGovernanceApi.fetchGeminiEnterpriseAuto(geminiEnterpriseKeyId);
      setChats(result.chats || []);
      setFiles(result.files || []);
      setKnowledge(result.knowledge || []);
      setChatsLastUpdated(new Date());
    } catch (err) {
      const msg = err.message || "Failed to load Gemini Enterprise activity";
      setChatsError(msg); setFilesError(msg); setKnowledgeError(msg);
    } finally {
      setChatsLoaded(true); setFilesLoaded(true); setKnowledgeLoaded(true);
      setChatsLoading(false); setFilesLoading(false); setKnowledgeLoading(false);
    }
  };

  // ── Unified Google loader — fetches chats, files, knowledge in a single call ─
  // and sets them into the same state variables Microsoft uses so the UI is identical.
  const loadGoogleUserActivity = async () => {
    if (!googleKeyId) return;
    setChatsLoading(true); setFilesLoading(true); setKnowledgeLoading(true);
    setChatsError(null); setFilesError(null); setKnowledgeError(null);
    try {
      const result = await agentGovernanceApi.fetchGoogleUserActivity(googleKeyId);
      setChats(result.chats || []);
      setFiles(result.files || []);
      setKnowledge(result.knowledge || []);
      setChatsLastUpdated(new Date());
    } catch (err) {
      const msg = err.message || "Failed to load Google activity";
      setChatsError(msg); setFilesError(msg); setKnowledgeError(msg);
    } finally {
      setChatsLoaded(true); setFilesLoaded(true); setKnowledgeLoaded(true);
      setChatsLoading(false); setFilesLoading(false); setKnowledgeLoading(false);
    }
  };

  const loadFiles = async () => {
    if (isGeminiEnterprise) return loadGeminiEnterpriseUserActivity();
    if (isGoogle) return loadGoogleUserActivity();
    if (isClaude) { setFilesLoaded(true); return; }
    if (isOpenAI) {
      if (!openaiKeyId) { setFilesLoaded(true); return; }
      setFilesLoading(true);
      setFilesError(null);
      try {
        const result = await agentGovernanceApi.fetchOpenAIFiles(openaiKeyId);
        setFiles((result.files || []).map(f => ({
          id: f.id,
          fileName: f.filename || f.id,
          filePath: f.id,
          userName: "API Upload",
          userId: f.id,
          operation: "FileUploaded",
          workload: "OpenAI",
          timestamp: f.created_at ? new Date(f.created_at * 1000).toISOString() : new Date().toISOString(),
          fileSize: f.bytes,
          status: f.status,
        })));
        if (result.warnings?.length) setFilesError(result.warnings[0]);
      } catch (err) {
        setFilesError(err.message || "Failed to load OpenAI files");
      } finally {
        setFilesLoaded(true);
        setFilesLoading(false);
      }
      return;
    }
    if (!oauthKeyId) return;
    setFilesLoading(true);
    setFilesError(null);
    setSubscriptionNote(null);
    try {
      const result = await agentGovernanceApi.fetchUserFiles(oauthKeyId);
      setFiles(result.files || []);
      if (result.warning) setFilesError(result.warning);
      if (result.subscriptionNote) setSubscriptionNote(result.subscriptionNote);
      setFilesLoaded(true);
    } catch (err) {
      const msg = err.message || "Failed to load file activity";
      const isTimeout = msg.includes("abort") || msg.includes("timeout") || err.name === "AbortError";
      setFilesError(isTimeout ? "Request timed out — the audit log scan is taking longer than expected. Click Refresh to try again." : msg);
    } finally {
      setFilesLoaded(true);
      setFilesLoading(false);
    }
  };

  const loadKnowledge = async () => {
    if (isGeminiEnterprise) return loadGeminiEnterpriseUserActivity();
    if (isGoogle) return loadGoogleUserActivity();
    if (isClaude) { setKnowledgeLoaded(true); return; }
    if (isOpenAI) {
      if (!openaiKeyId) { setKnowledgeLoaded(true); return; }
      const allAgents = govState.discoveryResult?.agents || [];
      const currentPlatforms = APP_TO_PLATFORMS[application] || [];
      // Only OpenAI Assistants have vector stores accessible via API
      // Custom GPTs knowledge is shown via DiscoveredKnowledgeView (tools/capabilities)
      const assistantAgents = allAgents.filter(a =>
        currentPlatforms.includes(a.platform) && a.platform === "openai_assistant" && a.appId
      );
      if (!assistantAgents.length) { setKnowledgeLoaded(true); return; }
      setKnowledgeLoading(true);
      setKnowledgeError(null);
      try {
        const results = await Promise.allSettled(
          assistantAgents.map(agent =>
            agentGovernanceApi.fetchOpenAIKnowledge(openaiKeyId, agent.appId)
              .then(res => ({ agent, files: res.files || [] }))
              .catch(() => ({ agent, files: [] }))
          )
        );
        const knowledgeBots = results
          .filter(r => r.status === "fulfilled")
          .map(r => r.value)
          .map(({ agent, files }) => ({
            botId: agent.id,
            botName: agent.name,
            sources: files.map(f => ({
              componentId: f.id,
              name: f.filename || f.id,
              type: "vector_store_file",
              url: "",
              metadata: f.bytes ? `${(f.bytes / 1024).toFixed(1)} KB` : "unknown size",
              addedOn: f.created_at ? new Date(f.created_at * 1000).toISOString() : null,
              status: f.status,
            })),
            components: [],
          }));
        setKnowledge(knowledgeBots);
      } catch (err) {
        setKnowledgeError(err.message || "Failed to load OpenAI knowledge");
      } finally {
        setKnowledgeLoaded(true);
        setKnowledgeLoading(false);
      }
      return;
    }
    if (!oauthKeyId) return;
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const result = await agentGovernanceApi.fetchKnowledgeSources(oauthKeyId, dataverseEnvUrl || undefined);
      setKnowledge(result.bots || []);
      setKnowledgeLoaded(true);
    } catch (err) {
      setKnowledgeError(err.message || "Failed to load knowledge sources");
    } finally {
      setKnowledgeLoading(false);
    }
  };

  // Reset loaded state when switching platforms so data is re-fetched from the right source
  const prevAppRef = useState({ prev: application })[0];
  useEffect(() => {
    if (prevAppRef.prev !== application) {
      prevAppRef.prev = application;
      setSearchQuery("");
      setAgentFilter("all");
      // Knowledge is platform-specific — reset so the correct data loads for the new platform
      setKnowledge([]);
      setKnowledgeLoaded(false);
      setKnowledgeError(null);
    }
  }, [application]);

  // Only fetch data when a scan is running or has completed — not on connect
  const scanActive = govState.discoveryStatus === "loading" || govState.discoveryStatus === "success";
  useEffect(() => {
    if (!scanActive) return;
    if (isGeminiEnterprise) {
      if (!chatsLoaded && !chatsLoading) loadGeminiEnterpriseUserActivity();
    } else if (isGoogle) {
      if (!chatsLoaded && !chatsLoading) loadGoogleUserActivity();
    } else {
      if (!chatsLoaded && !chatsLoading) loadChats();
      if (!filesLoaded && !filesLoading) loadFiles();
      if (!knowledgeLoaded && !knowledgeLoading) loadKnowledge();
    }
  }, [scanActive, oauthKeyId, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId, chatsLoaded, filesLoaded, knowledgeLoaded, isGoogle, isOpenAI, isClaude, isGeminiEnterprise]);

  // After scan completes, silently refresh (no spinners — loaded flags stay true)
  const prevRefreshKey = useRef(govState.refreshKey);
  useEffect(() => {
    if (prevRefreshKey.current !== govState.refreshKey) {
      prevRefreshKey.current = govState.refreshKey;
      if (!chatsLoading) loadChats();
      if (!filesLoading) loadFiles();
      if (!knowledgeLoading) loadKnowledge();
    }
  }, [govState.refreshKey]);

  // Auto-poll for new chats every 60 seconds after initial load
  const chatsLoadingRef = useRef(chatsLoading);
  chatsLoadingRef.current = chatsLoading;
  useEffect(() => {
    if (!scanActive || !chatsLoaded || isGoogle || isOpenAI || isClaude || isGeminiEnterprise) return;
    const interval = setInterval(() => {
      if (!chatsLoadingRef.current) loadChats();
    }, 60000);
    return () => clearInterval(interval);
  }, [scanActive, chatsLoaded, isGoogle, oauthKeyId, dataverseEnvUrl]);

  // Build a set of agent identifiers (names + botIds) belonging to the selected platform
  const platformAgentIdentifiers = useMemo(() => {
    const discoveredAgents = govState.discoveryResult?.agents || [];
    const platforms = APP_TO_PLATFORMS[application] || [];
    if (platforms.length === 0) return null;
    const ids = new Set();
    for (const a of discoveredAgents) {
      if (platforms.includes(a.platform)) {
        if (a.name) ids.add(a.name.toLowerCase());
        if (a.botId) ids.add(a.botId.toLowerCase());
        if (a.id) ids.add(a.id.toLowerCase());
        if (a.appId) ids.add(a.appId.toLowerCase());
      }
    }
    return ids.size > 0 ? ids : null;
  }, [govState.discoveryResult, application]);

  // Get the full discovered agent objects for the selected platform
  const platformDiscoveredAgents = useMemo(() => {
    const discoveredAgents = govState.discoveryResult?.agents || [];
    const platforms = APP_TO_PLATFORMS[application] || [];
    if (platforms.length === 0) return [];
    return discoveredAgents.filter((a) => platforms.includes(a.platform));
  }, [govState.discoveryResult, application]);

  // Filter chats to only show conversations for agents belonging to the selected platform
  // Azure AI Foundry has no chat transcripts — show empty (usage tracking handled separately)
  const isAzureFoundry = application === "azure_foundry";

  const azureUsagePeriodRef = useRef(azureUsagePeriod);
  azureUsagePeriodRef.current = azureUsagePeriod;

  const loadAzureUsageDetails = async (periodOverride) => {
    if (!oauthKeyId || !isAzureFoundry) return;
    const period = periodOverride || azureUsagePeriodRef.current;
    setAzureUsageLoading(true);
    setAzureUsageError(null);
    try {
      const data = await agentGovernanceApi.fetchAzureUsageDetails(oauthKeyId, period);
      setAzureUsageDetails(data);
    } catch (err) {
      setAzureUsageError(err?.message || "Failed to fetch usage details");
    } finally {
      setAzureUsageLoading(false);
    }
  };

  useEffect(() => {
    if (isAzureFoundry && oauthKeyId && subTab === "chats") {
      loadAzureUsageDetails(azureUsagePeriod);
    }
  }, [isAzureFoundry, oauthKeyId, azureUsagePeriod]);

  const platformChats = useMemo(() => {
    if (isAzureFoundry) return [];
    if (isGoogle || isOpenAI || isClaude || isGeminiEnterprise) return chats;
    if (application === "copilot_studio") {
      if (platformDiscoveredAgents.length === 0) return chats;
      const copilotNames = new Set(platformDiscoveredAgents.map((a) => (a.name || "").toLowerCase()));
      return chats.filter((c) => {
        const botNameLC = (c.botName || "").toLowerCase();
        return copilotNames.has(botNameLC);
      });
    }
    if (!platformAgentIdentifiers) return chats;
    return chats.filter((c) => {
      const botNameLC = (c.botName || "").toLowerCase();
      const botIdLC = (c.botId || "").toLowerCase();
      if (platformAgentIdentifiers.has(botNameLC) || platformAgentIdentifiers.has(botIdLC)) return true;
      if (c.source === "audit_log" || c.source === "teams_chat" || c.source === "graph_copilot") {
        if (platformDiscoveredAgents.length === 0) return true;
        return platformAgentIdentifiers.has(botNameLC) || platformAgentIdentifiers.has(botIdLC);
      }
      return false;
    });
  }, [chats, platformAgentIdentifiers, isGoogle, isOpenAI, isClaude, application, isAzureFoundry, platformDiscoveredAgents]);

  // Filter knowledge to agents of the selected platform
  const platformKnowledge = useMemo(() => {
    if (!platformAgentIdentifiers || isGoogle || isOpenAI || isClaude || isGeminiEnterprise || application === "copilot_studio") return knowledge;
    return knowledge.filter((b) => {
      const nameLC = (b.botName || "").toLowerCase();
      const idLC = (b.botId || "").toLowerCase();
      return platformAgentIdentifiers.has(nameLC) || platformAgentIdentifiers.has(idLC);
    });
  }, [knowledge, platformAgentIdentifiers, isGoogle, isOpenAI, isClaude, application]);

  const uniqueAgents = [...new Set([
    ...(application === "copilot_studio" && platformDiscoveredAgents.length > 0
      ? platformDiscoveredAgents.map((a) => a.name)
      : platformChats.map((c) => c.botName)),
    ...platformDiscoveredAgents.map((a) => a.name),
  ].filter(Boolean))].sort();

  let filteredChats = platformChats;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredChats = filteredChats.filter(
      (c) =>
        c.userName?.toLowerCase().includes(q) ||
        c.userEmail?.toLowerCase().includes(q) ||
        c.botName?.toLowerCase().includes(q) ||
        c.messages?.some((m) => m.text?.toLowerCase().includes(q))
    );
  }
  if (agentFilter !== "all") {
    filteredChats = filteredChats.filter((c) => c.botName === agentFilter);
  }

  // Cross-reference file events with agent knowledge sources
  const taggedFiles = tagFilesWithAgents(files, platformKnowledge);
  const dataExposure = computeDataExposure(taggedFiles, platformKnowledge);
  const knowledgeDiag = getKnowledgeDiagnostics(platformKnowledge);

  // Sensitive data scanning — scoped to platform-filtered chats
  const sensitiveData = useMemo(() => scanChatsForSensitiveData(platformChats), [platformChats]);

  let filteredFiles = taggedFiles;
  if (agentFilesOnly) {
    filteredFiles = filteredFiles.filter((f) => f.relatedAgents?.length > 0);
  }
  if (agentFilter !== "all") {
    filteredFiles = filteredFiles.filter((f) => f.relatedAgents?.some((a) => a === agentFilter));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredFiles = filteredFiles.filter(
      (f) =>
        f.fileName?.toLowerCase().includes(q) ||
        f.userName?.toLowerCase().includes(q) ||
        f.userId?.toLowerCase().includes(q) ||
        f.filePath?.toLowerCase().includes(q) ||
        f.relatedAgents?.some((a) => a.toLowerCase().includes(q))
    );
  }

  const chatStats = {
    totalChats: platformChats.length,
    totalMessages: platformChats.reduce((sum, c) => sum + (c.messageCount || 0), 0),
    userMessages: platformChats.reduce((sum, c) => sum + (c.messages || []).filter(m => m.from !== "bot").length, 0),
    agentResponses: platformChats.reduce((sum, c) => sum + (c.messages || []).filter(m => m.from === "bot").length, 0),
    uniqueUsers: new Set(platformChats.map((c) => c.userId)).size,
    uniqueAgents: new Set(platformChats.map((c) => c.botName)).size,
  };

  const visibleApps = APP_OPTIONS.filter((app) => {
    if (app.id === "copilot_studio" || app.id === "azure_foundry" || app.id === "personal_agent" || app.id === "sharepoint_agent") return !!oauthKeyId;
    if (GOOGLE_APP_IDS.has(app.id)) return !!googleKeyId;
    if (OPENAI_APP_IDS.has(app.id)) return !!openaiKeyId;
    if (CLAUDE_APP_IDS.has(app.id)) return !!claudeKeyId;
    if (GEMINI_ENTERPRISE_APP_IDS.has(app.id)) return !!geminiEnterpriseKeyId;
    return true;
  });

  return (
    <div>
      {/* Sub-tab navigation + Application dropdown */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--ag-border)", alignItems: "flex-end" }}>
        {[
          { id: "safety", label: "AI Safety", icon: <Eye size={14} />, count: sensitiveData.summary.total, alert: sensitiveData.summary.total > 0 },
          { id: "risk", label: "Risk Management", icon: <ShieldAlert size={14} />, count: 0 },
          { id: "knowledge", label: "Knowledge & Files", icon: <FolderOpen size={14} />, count: isGoogle ? 0 : isGeminiEnterprise ? platformKnowledge.reduce((sum, b) => sum + (b.sources?.length || 0), 0) : (platformKnowledge.reduce((sum, b) => sum + (b.sources?.length || 0), 0) || platformDiscoveredAgents.reduce((sum, a) => sum + (a.connectors?.length || 0) + (a.description?.includes("sharepoint.com") ? 1 : 0), 0)) },
          { id: "files", label: "File Activity", icon: <FileText size={14} />, count: files.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 20px", fontSize: 13,
              fontWeight: subTab === tab.id ? 600 : 500,
              color: subTab === tab.id ? "#6366f1" : "var(--ag-text-secondary)",
              background: "none", border: "none",
              borderBottom: `2px solid ${subTab === tab.id ? "#6366f1" : "transparent"}`,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {tab.icon} {tab.label}
            {tab.count > 0 && (
              <span style={{
                background: tab.alert ? "#ef444420" : subTab === tab.id ? "#6366f115" : "#f1f3f9",
                color: tab.alert ? "#ef4444" : subTab === tab.id ? "#6366f1" : "var(--ag-text-secondary)",
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Shared filter bar — visible across all sub-tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: "#999" }} />
          <input
            type="text"
            placeholder="Search by user, agent, or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%", background: "#fff",
              border: "1px solid var(--ag-border)", borderRadius: 6,
              padding: "8px 8px 8px 30px", fontSize: 12, color: "#333", fontFamily: "inherit",
            }}
          />
        </div>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={{
            background: "#fff", border: "1px solid var(--ag-border)",
            borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#333",
          }}
        >
          <option value="all">All Agents</option>
          {uniqueAgents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={application}
          onChange={(e) => setApplication(e.target.value)}
          style={{
            background: "#fff",
            border: `1.5px solid ${visibleApps.find(a => a.id === application)?.color || "#e5e7eb"}`,
            borderRadius: 6, padding: "7px 28px 7px 10px", fontSize: 12, fontWeight: 600,
            color: visibleApps.find(a => a.id === application)?.color || "#333",
            cursor: "pointer", fontFamily: "inherit",
            appearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 8px center",
          }}
        >
          {visibleApps.map((app) => (
            <option key={app.id} value={app.id}>{app.label}</option>
          ))}
        </select>
      </div>

      {/* Chats data is loaded in background for AI Safety scanning */}

      {/* ===== AI SAFETY SUB-TAB ===== */}
      <div style={{ display: subTab === "safety" ? "block" : "none" }}>
        <div>
          {isClaude ? (
            <div style={{ padding: "14px 16px", background: "#D4622A08", border: "1px solid #D4622A33", borderRadius: 8, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6 }}>
              <Info size={16} color="#D4622A" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: "#D4622A", marginBottom: 2 }}>Conversation Scanning Not Available for Claude</div>
                Anthropic does not expose conversation history via the admin API. Claude.ai conversations stay within the platform. Use <strong>console.anthropic.com</strong> to review usage and audit logs directly.
              </div>
            </div>
          ) : application === "custom_gpt" ? (
            <div style={{ padding: "14px 16px", background: "#f59e0b08", border: "1px solid #f59e0b33", borderRadius: 8, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6 }}>
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: 2 }}>Conversation Scanning Not Available for Custom GPTs</div>
                OpenAI does not expose chatgpt.com conversations via any API. Custom GPT chats stay within ChatGPT and cannot be accessed externally. Use <strong>Risk Management</strong> to review agent risk posture and <strong>Knowledge &amp; Files</strong> to audit what data your GPTs have access to.
              </div>
            </div>
          ) : application === "openai_assistant" ? (
            <div style={{ padding: "14px 16px", background: "#6366f108", border: "1px solid #6366f122", borderRadius: 8, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6 }}>
              <Eye size={16} color="#6366f1" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: "#6366f1", marginBottom: 2 }}>Scanning Assistants API Threads</div>
                Conversations are captured when users interact with your Assistants via the API or the OpenAI Playground. Chats through chatgpt.com are not accessible. To see user identity in results, pass <code>metadata: &#123; user_name, user_id &#125;</code> when creating threads in your application.
              </div>
            </div>
          ) : null}
          {!chatsLoaded && !chatsLoading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <Eye size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
              <p style={{ fontSize: 13, color: "#999" }}>Run a discovery scan to detect dangerous conversations.</p>
            </div>
          ) : chatsLoading && chats.length === 0 ? (
            <LoadingSpinner message="Scanning conversations for sensitive data..." />
          ) : (
            <>
              {/* Summary KPIs */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
                <div style={{
                  background: sensitiveData.summary.total > 0 ? "#fef2f2" : "#f0fdf4",
                  border: `1px solid ${sensitiveData.summary.total > 0 ? "#fca5a533" : "#86efac33"}`,
                  borderRadius: 10, padding: "14px 20px", minWidth: 150,
                }}>
                  <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Total Findings</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: sensitiveData.summary.total > 0 ? "#ef4444" : "#22c55e" }}>
                    {sensitiveData.summary.total}
                  </div>
                  <div style={{ fontSize: 10, color: "#999" }}>
                    in {sensitiveData.summary.chatsWithFindings} of {chats.length} conversations
                  </div>
                </div>
                {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => {
                  const count = sensitiveData.summary.byCategory[key] || 0;
                  const Icon = cfg.icon;
                  return (
                    <div key={key} style={{
                      background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)",
                      borderRadius: 10, padding: "14px 20px", minWidth: 130,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <Icon size={12} color={cfg.color} />
                        <span style={{ fontSize: 10, color: "#999" }}>{cfg.shortLabel}</span>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? cfg.color : "#ccc" }}>{count}</div>
                    </div>
                  );
                })}
              </div>

              {/* Per-conversation findings list with expandable transcripts */}
              <Section title="Conversations with Sensitive Data">
                {(() => {
                  let safetyChats = sensitiveData.chats.filter((c) => c.sensitiveFindings.length > 0);
                  if (agentFilter !== "all") {
                    safetyChats = safetyChats.filter(c => c.botName === agentFilter);
                  }
                  if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    safetyChats = safetyChats.filter(c =>
                      c.botName?.toLowerCase().includes(q) ||
                      c.userName?.toLowerCase().includes(q) ||
                      c.sensitiveFindings?.some(f => f.name?.toLowerCase().includes(q) || f.category?.toLowerCase().includes(q))
                    );
                  }
                  return safetyChats.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
                    <CheckCircle size={32} color="#22c55e" style={{ marginBottom: 12 }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#22c55e", marginBottom: 4 }}>No Sensitive Data Detected</div>
                    <div style={{ fontSize: 12 }}>Scanned {chats.length} conversations — no PII, financial, health, or credential data found in user messages.</div>
                  </div>
                ) : (
                  <div>
                    {safetyChats.map((chat) => {
                      const grouped = {};
                      for (const f of chat.sensitiveFindings) {
                        if (!grouped[f.category]) grouped[f.category] = [];
                        grouped[f.category].push(f);
                      }
                      const isOpen = expandedChat === chat.id;
                      const flaggedMessageIds = new Set(chat.sensitiveFindings.map(f => f.messageId));
                      return (
                        <div key={chat.id} style={{
                          background: "#fff", border: "1px solid #fca5a533", borderRadius: 10,
                          marginBottom: 10, overflow: "hidden",
                          boxShadow: isOpen ? "0 2px 12px rgba(239,68,68,0.08)" : "none",
                        }}>
                          <div
                            onClick={() => setExpandedChat(isOpen ? null : chat.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "12px 16px", cursor: "pointer",
                              borderBottom: isOpen ? "1px solid #fca5a533" : "none",
                            }}
                          >
                            {isOpen ? <ChevronDown size={14} color="#ef4444" /> : <ChevronRight size={14} color="#999" />}
                            <AlertTriangle size={14} color="#ef4444" />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{chat.userName}</span>
                                <span style={{ fontSize: 11, color: "#999" }}>→</span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#6366f1" }}>{chat.botName}</span>
                              </div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                {Object.entries(grouped).map(([cat, findings]) => {
                                  const cfg = CATEGORY_CONFIG[cat];
                                  return (
                                    <div key={cat} style={{
                                      display: "flex", alignItems: "center", gap: 4,
                                      padding: "2px 8px", borderRadius: 12,
                                      background: `${cfg.color}10`, border: `1px solid ${cfg.color}33`,
                                      fontSize: 10, color: cfg.color, fontWeight: 600,
                                    }}>
                                      {cfg.shortLabel}: {findings.length}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                              <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 600, background: "#ef444415", padding: "2px 8px", borderRadius: 4 }}>
                                {chat.sensitiveFindings.length} finding{chat.sensitiveFindings.length !== 1 ? "s" : ""}
                              </span>
                              <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 11, color: "var(--ag-text-secondary)" }}>
                                  <MessageSquare size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />
                                  {chat.messageCount || chat.messages?.length || 0} messages
                                </div>
                                <div style={{ fontSize: 10, color: "#999" }}>
                                  {new Date(chat.startTime).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          </div>

                          {isOpen && (
                            <div style={{ padding: "14px 16px", background: "#fefefe" }}>
                              {chat.messages && chat.messages.length > 0 ? (
                                <div style={{ maxHeight: 500, overflowY: "auto" }}>
                                  {chat.messages.map((msg, i) => {
                                    const isDangerous = flaggedMessageIds.has(msg.id);
                                    const msgFindings = isDangerous ? chat.sensitiveFindings.filter(f => f.messageId === msg.id) : [];
                                    return (
                                      <div key={msg.id || i}>
                                        <div style={{
                                          position: "relative",
                                          borderLeft: isDangerous ? "3px solid #ef4444" : "3px solid transparent",
                                          paddingLeft: isDangerous ? 8 : 11,
                                          marginBottom: isDangerous ? 4 : 10,
                                          borderRadius: isDangerous ? 4 : 0,
                                          background: isDangerous ? "#fef2f208" : "transparent",
                                        }}>
                                          <ChatBubble message={msg} />
                                        </div>
                                        {isDangerous && msgFindings.length > 0 && (
                                          <div style={{
                                            display: "flex", gap: 4, flexWrap: "wrap",
                                            marginLeft: 14, marginBottom: 10, paddingLeft: 8,
                                          }}>
                                            {msgFindings.map((f, fi) => (
                                              <span key={fi} style={{
                                                display: "inline-flex", alignItems: "center", gap: 3,
                                                fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 8,
                                                background: (CATEGORY_CONFIG[f.category]?.color || "#ef4444") + "15",
                                                color: CATEGORY_CONFIG[f.category]?.color || "#ef4444",
                                                border: `1px solid ${(CATEGORY_CONFIG[f.category]?.color || "#ef4444")}33`,
                                              }}>
                                                <AlertTriangle size={8} /> {f.name}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div style={{ textAlign: "center", padding: 20, fontSize: 12, color: "var(--ag-text-secondary)" }}>
                                  No message content available for this conversation
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
                })()}
              </Section>
            </>
          )}
        </div>
      </div>

      {/* ===== RISK MANAGEMENT SUB-TAB ===== */}
      <div style={{ display: subTab === "risk" ? "block" : "none" }}>
        <RiskManagementPanel oauthKeyId={oauthKeyId} dataverseEnvUrl={dataverseEnvUrl} discoveredAgents={platformDiscoveredAgents} applicationLabel={APP_OPTIONS.find(a => a.id === application)?.label} application={application} enabled={scanActive} searchQuery={searchQuery} agentFilter={agentFilter} />
      </div>

      {/* ===== KNOWLEDGE & FILES SUB-TAB ===== */}
      <div style={{ display: subTab === "knowledge" ? "block" : "none" }}>
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "14px 16px", background: "#6366f108",
            border: "1px solid #6366f122", borderRadius: 8,
            marginBottom: 16, fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6,
          }}>
            <Brain size={18} color="#6366f1" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 4 }}>Agent Knowledge Sources</div>
              This shows what data sources, files, configurations, and web content each agent has access to.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <button
              onClick={loadKnowledge}
              disabled={knowledgeLoading}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "#6366f1", color: "#fff", padding: "7px 14px",
                borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: "none", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <RefreshCw size={12} style={knowledgeLoading ? { animation: "agSpin 1s linear infinite" } : undefined} />
              {knowledgeLoading ? "Scanning..." : "Refresh"}
            </button>
          </div>

          {knowledgeLoading && !knowledgeLoaded ? (
            <LoadingSpinner message="Scanning agent knowledge sources..." />
          ) : knowledgeError && !knowledgeLoaded ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: "var(--ag-text-secondary)" }}>{knowledgeError}</div>
            </div>
          ) : platformKnowledge.length > 0 ? (
            (() => {
              let filteredKnowledge = platformKnowledge;
              if (agentFilter !== "all") {
                filteredKnowledge = filteredKnowledge.filter(b => b.botName === agentFilter);
              }
              if (searchQuery) {
                const q = searchQuery.toLowerCase();
                filteredKnowledge = filteredKnowledge.filter(b =>
                  b.botName?.toLowerCase().includes(q) ||
                  b.sources?.some(s => s.name?.toLowerCase().includes(q) || s.type?.toLowerCase().includes(q) || s.url?.toLowerCase().includes(q))
                );
              }
              return (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { label: "Agents Scanned", value: filteredKnowledge.length, color: "#6366f1" },
                  { label: "Total Knowledge Sources", value: filteredKnowledge.reduce((s, b) => s + (b.sources?.length || 0), 0), color: "#22c55e" },
                  { label: "With Sources", value: filteredKnowledge.filter((b) => b.sources?.length > 0).length, color: "#3b82f6" },
                  { label: "Without Sources", value: filteredKnowledge.filter((b) => !b.sources?.length).length, color: "#f59e0b" },
                ].map((s) => (
                  <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 140 }}>
                    <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {filteredKnowledge.map((bot) => (
                <BotKnowledgePanel key={bot.botId} bot={bot} />
              ))}
            </div>
              );
            })()
          ) : platformDiscoveredAgents.length > 0 ? (
            <DiscoveredKnowledgeView agents={platformDiscoveredAgents} />
          ) : knowledgeLoaded ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
              <FolderOpen size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>No agents found</h3>
              <p style={{ fontSize: 13 }}>Run a discovery scan first, then come back here to check knowledge sources.</p>
            </div>
          ) : null}
        </div>

      {/* ===== FILES SUB-TAB ===== */}
      <div style={{ display: subTab === "files" ? "block" : "none" }}>
          <>
          {!isGoogle && !isOpenAI && !isClaude && !isGeminiEnterprise && <AgentPermissionsPanel oauthKeyId={oauthKeyId} enabled={scanActive} />}
          {application === "custom_gpt" && (
            <div style={{ padding: "14px 16px", background: "#f59e0b08", border: "1px solid #f59e0b33", borderRadius: 8, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6 }}>
              <AlertTriangle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: 2 }}>Limited File Visibility for Custom GPTs</div>
                Files uploaded in GPT Builder are stored internally by OpenAI and may not appear via the Files API. Files shown below are from your OpenAI account's file storage (<code>purpose=assistants</code>) and may include files from OpenAI Assistants as well.
              </div>
            </div>
          )}

          {/* Knowledge loading indicator */}
          {knowledgeLoading && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
              background: "#6366f108", border: "1px solid #6366f122", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "#6366f1",
            }}>
              <RefreshCw size={14} style={{ animation: "agSpin 1s linear infinite" }} />
              Loading agent knowledge sources for cross-referencing...
            </div>
          )}

          {/* Knowledge source match summary (when matches exist) */}
          {filesLoaded && knowledgeLoaded && knowledgeDiag.siteUrls.length > 0 && dataExposure.agentRelatedCount > 0 && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px",
              background: "#ecfdf5", border: "1px solid #10b98122", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "#065f46",
            }}>
              <CheckCircle size={16} color="#10b981" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                Cross-referencing {knowledgeDiag.siteUrls.length} SharePoint knowledge source{knowledgeDiag.siteUrls.length !== 1 ? "s" : ""} from{" "}
                <strong>{knowledgeDiag.botsWithSites.join(", ")}</strong> against {taggedFiles.length} file events.
              </div>
            </div>
          )}

          {/* Agent Data Exposure Summary */}
          {filesLoaded && taggedFiles.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              {[
                { label: "Total File Events", value: taggedFiles.length, color: "#6366f1" },
                { label: "Agent-Related Events", value: dataExposure.agentRelatedCount, color: "#10b981", highlight: true },
                { label: "Agents Exposed", value: dataExposure.uniqueAgentsExposed, color: "#f59e0b" },
                { label: "Modifications on Agent Sites", value: dataExposure.modifiedOnAgentSites, color: dataExposure.modifiedOnAgentSites > 0 ? "#ef4444" : "#22c55e" },
                { label: "External Users on Agent Sites", value: dataExposure.externalUsersOnAgentSites, color: dataExposure.externalUsersOnAgentSites > 0 ? "#ef4444" : "#22c55e" },
                ...(dataExposure.totalKnowledgeSites > 0 ? [{ label: "Stale Knowledge Sources", value: dataExposure.staleSources, color: dataExposure.staleSources > 0 ? "#f59e0b" : "#22c55e", sub: `of ${dataExposure.totalKnowledgeSites} sites` }] : []),
              ].map((s) => (
                <div key={s.label} style={{
                  background: s.highlight ? "#10b98108" : "var(--ag-bg-card)",
                  border: `1px solid ${s.highlight ? "#10b98133" : "var(--ag-border)"}`,
                  borderRadius: 8, padding: "10px 16px", minWidth: 130,
                }}>
                  <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                  {s.sub && <div style={{ fontSize: 10, color: "#999" }}>{s.sub}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Data Flow Visualization */}
          {filesLoaded && taggedFiles.length > 0 && dataExposure.agentRelatedCount > 0 && (
            <div style={{ marginBottom: 16 }}>
              <DataFlowSankey taggedFiles={taggedFiles} knowledge={knowledge} />
            </div>
          )}

          {/* Data Activity toolbar — toggle + refresh only (search is in shared bar above) */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
            <button
              onClick={() => setAgentFilesOnly(!agentFilesOnly)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: agentFilesOnly ? "1.5px solid #6366f1" : "1px solid var(--ag-border)",
                background: agentFilesOnly ? "#6366f110" : "#fff",
                color: agentFilesOnly ? "#6366f1" : "#666",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Shield size={12} />
              {agentFilesOnly ? "Agent Sites Only" : "All Files"}
            </button>
            <button
              onClick={loadFiles}
              disabled={filesLoading}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "#6366f1", color: "#fff", padding: "7px 14px",
                borderRadius: 6, fontSize: 12, fontWeight: 600,
                border: "none", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <RefreshCw size={12} style={filesLoading ? { animation: "agSpin 1s linear infinite" } : undefined} />
              {filesLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {subscriptionNote && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "12px 16px", background: "#f59e0b08", border: "1px solid #f59e0b33",
              borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6,
            }}>
              <Clock size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: "#f59e0b", marginBottom: 2 }}>Audit Subscription Activated</div>
                {subscriptionNote}
              </div>
            </div>
          )}

          {isClaude && (
            <div style={{ padding: "14px 16px", background: "#D4622A08", border: "1px solid #D4622A33", borderRadius: 8, marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "var(--ag-text-secondary)", lineHeight: 1.6 }}>
              <Info size={16} color="#D4622A" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, color: "#D4622A", marginBottom: 2 }}>File Activity Not Available for Claude</div>
                Anthropic does not expose file upload or activity logs via the admin API. Review usage at <strong>console.anthropic.com</strong>.
              </div>
            </div>
          )}

          {filesLoading && files.length === 0 ? (
            <LoadingSpinner message={isOpenAI ? "Loading OpenAI uploaded files..." : "Loading file activity from O365 audit logs (this may take up to a minute)..."} />
          ) : filesError && files.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: "var(--ag-text-secondary)", marginBottom: 8 }}>{filesError}</div>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 12 }}>
                File activity requires E3/E5 license with ActivityFeed.Read permission and audit logging enabled.
              </div>
              <button onClick={() => { setFilesLoaded(false); setFilesError(null); }} style={{ padding: "6px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
                Retry
              </button>
            </div>
          ) : filteredFiles.length > 0 ? (
            <Section title={`${agentFilesOnly ? "Agent-Related " : ""}File Activity (${filteredFiles.length})`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                      <th style={thStyle}>File</th>
                      <th style={thStyle}>User</th>
                      <th style={thStyle}>Operation</th>
                      <th style={thStyle}>Source</th>
                      <th style={thStyle}>Used By Agent</th>
                      <th style={thStyle}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map((f) => (
                      <FileRow key={f.id} file={f} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : filesLoaded ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
              <FileText size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>
                {agentFilesOnly ? "No agent-related file activity" : searchQuery ? "No files match your search" : "No file activity found"}
              </h3>
              <p style={{ fontSize: 13, maxWidth: 500, margin: "0 auto" }}>
                {isOpenAI
                  ? "No files uploaded to OpenAI yet. Upload files to your Assistants vector stores — they will appear here with agent cross-references."
                  : agentFilesOnly && knowledgeDiag.siteUrls.length === 0
                  ? "Your agents don't have SharePoint/OneDrive knowledge sources configured. Add a SharePoint site as a knowledge source in Copilot Studio, then file events on that site will be linked to the agent."
                  : agentFilesOnly
                  ? "No file events found on sites used by agent knowledge sources. The agents' knowledge sites may not have had recent file activity. Try disabling the filter to see all files."
                  : searchQuery
                  ? "Try adjusting your search criteria."
                  : "File activity events from SharePoint and OneDrive will appear here from the O365 audit log (last 7 days)."}
              </p>
              {agentFilesOnly && taggedFiles.length > 0 && (
                <button
                  onClick={() => setAgentFilesOnly(false)}
                  style={{
                    marginTop: 16, padding: "8px 20px", background: "#6366f1", color: "#fff",
                    border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Show All {taggedFiles.length} File Events
                </button>
              )}
            </div>
          ) : null}
          </>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Gemini Activity Panel — shows per-user Gemini usage
// from Admin Reports API
// ═══════════════════════════════════════════════════════

function GeminiActivityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState(7);
  const [searchQuery, setSearchQuery] = useState("");

  const loadActivity = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.fetchGeminiActivity(days);
      setData(result);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Failed to load Gemini activity");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loaded && !loading) loadActivity();
  }, [loaded]);

  const filteredUsers = useMemo(() => {
    if (!data?.userSummary) return [];
    if (!searchQuery) return data.userSummary;
    const q = searchQuery.toLowerCase();
    return data.userSummary.filter(
      u => u.email?.toLowerCase().includes(q) || u.displayName?.toLowerCase().includes(q)
    );
  }, [data, searchQuery]);

  const activeIn7Days = data?.userSummary?.length || 0;
  const totalEvents = data?.totalEvents || 0;
  const topApps = useMemo(() => {
    if (!data?.userSummary) return {};
    const counts = {};
    for (const u of data.userSummary) {
      for (const app of (u.appsUsed || [])) {
        counts[app] = (counts[app] || 0) + u.eventCount;
      }
    }
    return counts;
  }, [data]);

  if (loading && !loaded) {
    return <LoadingSpinner message="Fetching Gemini activity from Admin Reports API..." />;
  }

  if (error && !loaded) {
    return (
      <div style={{ textAlign: "center", padding: 40 }}>
        <AlertTriangle size={32} color="#f59e0b" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>{error}</div>
        <div style={{ marginTop: 16, padding: 16, background: "#FEF3C7", borderRadius: 8, maxWidth: 480, margin: "16px auto 0", textAlign: "left" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#92400E", marginBottom: 8 }}>Requirements:</div>
          <ol style={{ fontSize: 11, color: "#78350F", lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
            <li>Scope <code>admin.reports.audit.readonly</code> must be authorized in Domain-Wide Delegation</li>
            <li>The Gemini Reports API may have a 2-day delay for recent activity</li>
            <li>Gemini activity reporting requires a supported Workspace edition</li>
          </ol>
        </div>
        <button
          onClick={loadActivity}
          style={{ marginTop: 16, padding: "8px 20px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Summary KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd33", borderRadius: 10, padding: "14px 20px", minWidth: 140 }}>
          <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Active Users</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#0284c7" }}>{activeIn7Days}</div>
          <div style={{ fontSize: 10, color: "#999" }}>last {days} days</div>
        </div>
        <div style={{ background: "#faf5ff", border: "1px solid #d8b4fe33", borderRadius: 10, padding: "14px 20px", minWidth: 140 }}>
          <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Total Events</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#7c3aed" }}>{totalEvents}</div>
          <div style={{ fontSize: 10, color: "#999" }}>Gemini interactions</div>
        </div>
        {Object.entries(topApps).slice(0, 3).map(([app, count]) => (
          <div key={app} style={{ background: "#f0fdf4", border: "1px solid #86efac33", borderRadius: 10, padding: "14px 20px", minWidth: 120 }}>
            <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>{app}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>{count}</div>
            <div style={{ fontSize: 10, color: "#999" }}>events</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#999" }} />
          <input
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: "100%", padding: "8px 10px 8px 32px", border: "1px solid var(--ag-border)", borderRadius: 6, fontSize: 12, outline: "none", background: "var(--ag-surface)" }}
          />
        </div>
        <select
          value={days}
          onChange={(e) => { setDays(Number(e.target.value)); setLoaded(false); }}
          style={{ padding: "8px 12px", border: "1px solid var(--ag-border)", borderRadius: 6, fontSize: 12, background: "var(--ag-surface)" }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        <button
          onClick={loadActivity}
          disabled={loading}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.6 : 1 }}
        >
          <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : {}} />
          Refresh
        </button>
      </div>

      {/* User Activity Table */}
      {filteredUsers.length > 0 ? (
        <div style={{ border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--ag-surface)" }}>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>User</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Email</th>
                <th style={{ textAlign: "center", padding: "10px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Events</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Apps Used</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, idx) => (
                <tr key={user.email} style={{ borderTop: "1px solid var(--ag-border)", background: idx % 2 === 0 ? "transparent" : "var(--ag-surface)" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#6366f115", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <User size={14} color="#6366f1" />
                      </div>
                      <span style={{ fontWeight: 500 }}>{user.displayName}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#666" }}>{user.email}</td>
                  <td style={{ padding: "10px 14px", textAlign: "center" }}>
                    <span style={{ background: "#6366f115", color: "#6366f1", padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
                      {user.eventCount}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(user.appsUsed || []).map(app => (
                        <span key={app} style={{ background: "#f0fdf4", color: "#16a34a", padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 500 }}>
                          {app}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#999", fontSize: 11 }}>
                    {user.lastActive ? new Date(user.lastActive).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : loaded ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <Zap size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>No Gemini activity found</h3>
          <p style={{ fontSize: 13, color: "#999", maxWidth: 400, margin: "0 auto" }}>
            Gemini usage data has a ~2 day delay. If users recently started using Gemini, activity will appear here within 48 hours.
          </p>
        </div>
      ) : null}

      {/* Info banner */}
      {loaded && (
        <div style={{ marginTop: 16, padding: 12, background: "#f0f9ff", border: "1px solid #bae6fd33", borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Info size={14} color="#0284c7" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: "#0369a1", lineHeight: 1.6 }}>
            Data sourced from Google Workspace Admin Reports API. Activity events have a ~2 day delay.
            This shows which users accessed Gemini features in Workspace apps — actual prompt content is not captured by the API.
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Gemini Vault Panel — shows Gemini conversations
// from Google Vault eDiscovery API
// ═══════════════════════════════════════════════════════

function GeminiVaultPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [days, setDays] = useState(7);

  const loadVault = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await agentGovernanceApi.fetchGeminiVault(days);
      setData(result);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Failed to load Vault data");
    } finally {
      setLoading(false);
    }
  };

  if (!loaded && !loading && !error) {
    return (
      <div style={{ border: "1px solid var(--ag-border)", borderRadius: 12, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#7c3aed15", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Lock size={18} color="#7c3aed" />
          </div>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Gemini Vault — Conversation Export</h3>
            <p style={{ fontSize: 11, color: "#999", margin: 0 }}>Pull actual Gemini prompts & responses via Google Vault eDiscovery</p>
          </div>
        </div>
        <div style={{ padding: 12, background: "#faf5ff", border: "1px solid #d8b4fe22", borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#6b21a8", lineHeight: 1.7 }}>
            <strong>Prerequisites:</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
              <li>Google Vault must be included in your Workspace plan (Business Plus / Enterprise)</li>
              <li>Scope <code>https://www.googleapis.com/auth/ediscovery</code> must be added to Domain-Wide Delegation</li>
              <li>The admin user must have Vault privileges</li>
            </ul>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ padding: "8px 12px", border: "1px solid var(--ag-border)", borderRadius: 6, fontSize: 12, background: "var(--ag-surface)" }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            onClick={loadVault}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            <Database size={14} /> Scan Vault
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ border: "1px solid var(--ag-border)", borderRadius: 12, padding: 24 }}>
        <LoadingSpinner message="Querying Google Vault — this may take up to 2 minutes while the export processes..." />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ border: "1px solid var(--ag-border)", borderRadius: 12, padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Lock size={18} color="#7c3aed" />
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Gemini Vault</h3>
        </div>
        <div style={{ textAlign: "center", padding: 20 }}>
          <AlertTriangle size={28} color="#f59e0b" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>{error}</div>
          <div style={{ padding: 14, background: "#FEF3C7", borderRadius: 8, maxWidth: 460, margin: "0 auto", textAlign: "left" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#92400E", marginBottom: 6 }}>To enable Vault access:</div>
            <ol style={{ fontSize: 11, color: "#78350F", lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
              <li>Go to <strong>Google Admin Console → Security → API Controls → Domain-Wide Delegation</strong></li>
              <li>Add scope: <code>https://www.googleapis.com/auth/ediscovery</code></li>
              <li>Enable <strong>Google Vault API</strong> in GCP Console</li>
              <li>Ensure the admin user has eDiscovery privileges</li>
            </ol>
          </div>
          <button
            onClick={() => { setError(null); setLoaded(false); }}
            style={{ marginTop: 16, padding: "8px 20px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const vaultAvailable = data?.vaultAvailable;
  const exports = data?.exports || [];
  const newExport = data?.newExport;
  const totalArtifacts = newExport
    ? newExport.artifactCount
    : exports.reduce((sum, e) => sum + e.artifactCount, 0);

  return (
    <div style={{ border: "1px solid var(--ag-border)", borderRadius: 12, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#7c3aed15", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Lock size={18} color="#7c3aed" />
          </div>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Gemini Vault — Conversation Export</h3>
            <p style={{ fontSize: 11, color: "#999", margin: 0 }}>
              Matter: <span style={{ color: "var(--ag-text-primary)", fontWeight: 500 }}>{data?.matterName || "—"}</span>
              {data?.matterId && <span style={{ marginLeft: 8, color: "#ccc" }}>({data.matterId.substring(0, 12)}…)</span>}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={days}
            onChange={(e) => { setDays(Number(e.target.value)); setLoaded(false); }}
            style={{ padding: "6px 10px", border: "1px solid var(--ag-border)", borderRadius: 6, fontSize: 11, background: "var(--ag-surface)" }}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <button
            onClick={loadVault}
            disabled={loading}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 14px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.6 : 1 }}
          >
            <RefreshCw size={12} style={loading ? { animation: "agSpin 1s linear infinite" } : {}} /> Refresh
          </button>
        </div>
      </div>

      {!vaultAvailable ? (
        <div style={{ textAlign: "center", padding: 30 }}>
          <ShieldAlert size={32} color="#f59e0b" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "#666" }}>{data?.message}</div>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ background: vaultAvailable ? "#f0fdf4" : "#fef2f2", border: "1px solid #86efac33", borderRadius: 10, padding: "14px 20px", minWidth: 140 }}>
              <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Vault Status</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a", display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle size={16} /> Connected
              </div>
            </div>
            <div style={{ background: "#faf5ff", border: "1px solid #d8b4fe33", borderRadius: 10, padding: "14px 20px", minWidth: 140 }}>
              <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Gemini Items Found</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#7c3aed" }}>{totalArtifacts}</div>
              <div style={{ fontSize: 10, color: "#999" }}>in last {days} days</div>
            </div>
            <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd33", borderRadius: 10, padding: "14px 20px", minWidth: 140 }}>
              <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>Completed Exports</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#0284c7" }}>{exports.length}</div>
              <div style={{ fontSize: 10, color: "#999" }}>in this matter</div>
            </div>
            {newExport && (
              <div style={{ background: "#fefce8", border: "1px solid #fde04733", borderRadius: 10, padding: "14px 20px", minWidth: 140 }}>
                <div style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>New Export Size</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#ca8a04" }}>
                  {newExport.sizeBytes > 1048576
                    ? `${(newExport.sizeBytes / 1048576).toFixed(1)} MB`
                    : newExport.sizeBytes > 1024
                    ? `${(newExport.sizeBytes / 1024).toFixed(0)} KB`
                    : `${newExport.sizeBytes} B`}
                </div>
                <div style={{ fontSize: 10, color: "#999" }}>{newExport.status}</div>
              </div>
            )}
          </div>

          {/* Exports Table */}
          {exports.length > 0 && (
            <div style={{ border: "1px solid var(--ag-border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "10px 14px", background: "var(--ag-surface)", borderBottom: "1px solid var(--ag-border)", fontSize: 12, fontWeight: 600 }}>
                Vault Exports
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--ag-surface)" }}>
                    <th style={{ textAlign: "left", padding: "8px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Export Name</th>
                    <th style={{ textAlign: "center", padding: "8px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Items</th>
                    <th style={{ textAlign: "center", padding: "8px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Total Artifacts</th>
                    <th style={{ textAlign: "left", padding: "8px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Created</th>
                    <th style={{ textAlign: "center", padding: "8px 14px", color: "#666", fontWeight: 600, fontSize: 11 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((exp, idx) => (
                    <tr key={exp.id} style={{ borderTop: "1px solid var(--ag-border)", background: idx % 2 === 0 ? "transparent" : "var(--ag-surface)" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ fontWeight: 500 }}>{exp.name}</div>
                        <div style={{ fontSize: 10, color: "#999" }}>{exp.id.substring(0, 20)}…</div>
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <span style={{ background: "#7c3aed15", color: "#7c3aed", padding: "2px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600 }}>
                          {exp.artifactCount}
                        </span>
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center", color: "#666" }}>{exp.totalArtifacts}</td>
                      <td style={{ padding: "10px 14px", color: "#999", fontSize: 11 }}>
                        {exp.createTime ? new Date(exp.createTime).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td style={{ padding: "10px 14px", textAlign: "center" }}>
                        <span style={{
                          background: exp.status === "COMPLETED" ? "#f0fdf4" : "#fef3c7",
                          color: exp.status === "COMPLETED" ? "#16a34a" : "#92400e",
                          padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600,
                        }}>
                          {exp.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Status message */}
          <div style={{ padding: 12, background: "#faf5ff", border: "1px solid #d8b4fe22", borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Info size={14} color="#7c3aed" style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: "#6b21a8", lineHeight: 1.6 }}>
              {data?.message || "Vault scan complete."}
              {" "}Exported data is stored in Google Cloud Storage associated with the Vault matter and can be downloaded from the Google Vault admin console for full review.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
