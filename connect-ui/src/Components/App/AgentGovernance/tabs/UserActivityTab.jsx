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
import {
  DEMO_CHATS, DEMO_FILES, DEMO_KNOWLEDGE, DEMO_PERMISSIONS,
  DEMO_RISK_SUMMARY, DEMO_AZURE_AI,
  DEMO_GOOGLE_CHATS, DEMO_GOOGLE_KNOWLEDGE, DEMO_GOOGLE_FILES,
  DEMO_GOOGLE_PERMISSIONS,
  GOOGLE_RISK_SIGNALS, GOOGLE_BASE_DEDUCTION,
} from "../demoData";
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
  const sourceColor = file.workload === "SharePoint" ? "#059669" : file.workload === "OneDrive" ? "#3b82f6" : "#6b7280";
  return (
    <tr style={{ borderBottom: "1px solid var(--ag-border)", background: "rgba(99,102,241,0.02)" }}>
      <td style={{ padding: "10px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={14} color="#6366f1" />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ag-text-primary)" }}>{file.fileName}</div>
            <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.filePath}
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: "10px 8px" }}>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#6366f115", color: "#6366f1", fontWeight: 600, border: "1px solid #6366f133" }}>
          {file.agentName || file.userName}
        </span>
      </td>
      <td style={{ padding: "10px 8px" }}>
        <Badge text={file.operation} color={OP_COLORS[file.operation] || "#6b7280"} />
      </td>
      <td style={{ padding: "10px 8px" }}>
        <Badge text={file.workload || "SharePoint"} color={sourceColor} />
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

  for (const bot of knowledgeSources) {
    for (const source of (bot.sources || [])) {
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

  if (agentSiteMap.size === 0 && agentHostMap.size === 0) {
    return files.map((f) => ({ ...f, relatedAgents: [] }));
  }

  return files.map((f) => {
    const relatedAgents = new Set();
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
        {source.metadata && (
          <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginTop: 2 }}>Keywords: {source.metadata}</div>
        )}
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
          { label: "Agents Scanned", value: agents.length, color: "#6366f1" },
          { label: "Knowledge Sources", value: totalSources, color: "#22c55e" },
          { label: "With Knowledge", value: withSources.length, color: "#3b82f6" },
        ].map((s) => (
          <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 140 }}>
            <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
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

function AgentPermissionsPanel({ oauthKeyId, enabled = true, vendor = "microsoft" }) {
  const initialData = vendor === "google" ? DEMO_GOOGLE_PERMISSIONS : DEMO_PERMISSIONS;
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    setData(vendor === "google" ? DEMO_GOOGLE_PERMISSIONS : DEMO_PERMISSIONS);
  }, [vendor]);

  const loadPermissions = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 12000));
    setLoading(false);
  };

  const LEVEL_COLORS = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" };
  const LEVEL_BG = { critical: "#fef2f2", high: "#fffbeb", medium: "#eff6ff", low: "#f0fdf4" };
  const CATEGORY_ICONS = { files: FolderOpen, mail: MessageSquare, directory: User, communications: MessageSquare, calendar: Clock, other: Shield };

  const apps = data?.apps || [];
  const displayed = apps;

  return (
    <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ShieldAlert size={16} color="#dc2626" />
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ag-text-primary)" }}>Agent Permissions &amp; File Access</span>
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
              { label: "Agents Scanned", value: displayed.length, color: "#6366f1" },
              { label: "With File Access", value: data.summary.withFileAccess, color: "#f59e0b" },
              { label: "With Write Access", value: data.summary.withWriteAccess, color: "#dc2626" },
              { label: "Critical Risk", value: data.summary.criticalRisk, color: "#dc2626" },
            ].map(s => (
              <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "8px 14px", minWidth: 110 }}>
                <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>


          {displayed.length > 0 ? (
            <div style={{ border: "1px solid var(--ag-border)", borderRadius: 8, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...thStyle, width: "25%" }}>Agent</th>
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
                              </div>
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
              No agents with significant permissions found.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Risk-Score Guide & Simulator. Vendor-aware — switches between the
// Microsoft signal catalog (Dataverse / Power Platform) and the Google
// Workspace signal catalog (Drive / Gemini Gem / Agent Builder / Chat).
function RiskScoringGuide({ vendor = "microsoft" }) {
  const isGoogleGuide = vendor === "google";
  const [expanded, setExpanded] = useState(false);

  // ── Simulator state ────────────────────────────────────────────────
  const [msSim, setMsSim] = useState({
    orphaned: false, stale: false, httpConnector: false, broadPerms: false,
    allUsersScope: false, expiredRenewal: false, sensitiveKw: false,
  });
  const [gSim, setGSim] = useState({
    sensitive_oauth_scopes: false,
    orphaned_owner: false,
    external_chat_space: false,
    agent_builder_with_datastores: false,
    stale_30_days: false,
    apps_script_http_trigger: false,
    expired_renewal: false,
    shared_gemini_gem: false,
    sensitive_keywords: false,
    multiple_read_scopes: false,
  });

  const computeMsSimScore = () => {
    let score = 100;
    const factors = [];
    score -= 5;
    if (msSim.broadPerms) { score -= 20; factors.push({ signal: "Broad connector scopes (Mail.ReadWrite.All, Sites.ReadWrite.All)", weight: "critical", deduction: -20 }); }
    if (msSim.orphaned) { score -= 20; factors.push({ signal: "No assigned owner (orphaned)", weight: "critical", deduction: -20 }); }
    if (msSim.stale) { score -= 12; factors.push({ signal: "Stale — no activity in 30+ days", weight: "high", deduction: -12 }); }
    if (msSim.expiredRenewal) { score -= 10; factors.push({ signal: "Overdue for renewal", weight: "medium", deduction: -10 }); }
    if (msSim.allUsersScope) { score -= 10; factors.push({ signal: "Deployed to all-user Teams scope", weight: "medium", deduction: -10 }); }
    if (msSim.httpConnector) { score -= 10; factors.push({ signal: "HTTP connector (external data egress)", weight: "medium", deduction: -10 }); }
    if (msSim.sensitiveKw) { score -= 5; factors.push({ signal: "Sensitive keywords in name/description", weight: "low", deduction: -5 }); }
    factors.push({ signal: "No governance policy applied", weight: "low", deduction: 0 });
    score = Math.max(0, Math.min(100, score));
    const level = score >= 80 ? "low" : score >= 60 ? "medium" : score >= 40 ? "high" : "critical";
    return { score, level, factors };
  };

  const computeGoogleSimScore = () => {
    let score = 100 + GOOGLE_BASE_DEDUCTION;
    const factors = [{
      signal: "Base low-risk deduction",
      weight: "low",
      deduction: GOOGLE_BASE_DEDUCTION,
    }];
    for (const [key, cat] of Object.entries(GOOGLE_RISK_SIGNALS)) {
      if (key === "no_policy_applied") continue;
      if (gSim[key]) {
        score += cat.deduction;
        factors.push({ signal: cat.label, weight: cat.weight, deduction: cat.deduction });
      }
    }
    factors.push({ signal: "No CloudFuze policy applied", weight: "low", deduction: 0 });
    score = Math.max(0, Math.min(100, score));
    const level = score <= 25 ? "critical" : score <= 50 ? "high" : score <= 75 ? "medium" : "low";
    return { score, level, factors };
  };

  const sim = isGoogleGuide ? computeGoogleSimScore() : computeMsSimScore();
  const simScenario = isGoogleGuide ? gSim : msSim;
  const setSimScenario = isGoogleGuide ? setGSim : setMsSim;

  // ── Signal catalog rows ────────────────────────────────────────────
  const msSignals = [
    { signal: "Broad connector scopes (Mail.ReadWrite, Sites.ReadWrite.All)", weight: "Critical", impact: "-20", source: "Power Platform API", how: "Checks connector permissions against dangerous scope list" },
    { signal: "No assigned owner (orphaned agent)", weight: "Critical", impact: "-20", source: "Dataverse + Graph", how: "Resolves bot createdby \u2192 Dataverse user \u2192 Entra ID accountEnabled" },
    { signal: "Stale agent (30+ days inactive)", weight: "High", impact: "-12", source: "Dataverse sessions + chats", how: "Computes days since last session; chats feed into activity tracking" },
    { signal: "Expired renewal date", weight: "Medium", impact: "-10", source: "CloudFuze agent_registry", how: "Admin sets renewal date during governance review; triggers risk deduction when past due without re-certification" },
    { signal: "All-user Teams deployment", weight: "Medium", impact: "-10", source: "Graph appCatalogs", how: "Checks consentType === 'AllPrincipals' from app registration" },
    { signal: "HTTP connector present", weight: "Medium", impact: "-10", source: "Connector config", how: "Detects HTTP connector type in bot's connector list" },
    { signal: "Sensitive keywords in name/description", weight: "Low", impact: "-5", source: "Dataverse name/desc", how: "Scans for keywords: password, secret, credential, PII, HIPAA, etc." },
    { signal: "Multiple read permissions", weight: "Low", impact: "-5", source: "Connector config", how: "Counts read-level permissions (Mail.Read, Files.Read.All, etc.)" },
    { signal: "No governance policy applied", weight: "Low", impact: "flag only", source: "CloudFuze", how: "Flags agents not covered by any CloudFuze governance policy" },
  ];

  const googleSignalHowTo = {
    sensitive_oauth_scopes:        "Reads the Workspace app-manifest + admin OAuth audit; flags scopes starting with drive.*, gmail.*, chat.bot, chat.spaces.*, admin.directory.* when consent is Tenant or AllPrincipals",
    orphaned_owner:                "Resolves agent owner → Workspace admin.directory.users → accountEnabled; also flags displayName of 'Unknown' or 'Former Employee'",
    external_chat_space:           "Detects google_chat_bots agents with tenant-wide deployment OR any agent holding chat.bot / chat.spaces scopes at Tenant consent",
    agent_builder_with_datastores: "Inspects discoveryengine.dataStores bound to the Agent Builder agent and its connector graph (BigQuery / Drive / Vector Search)",
    stale_30_days:                 "Queries Cloud Logging aiplatform.googleapis.com + Gem activation logs; fires when no invocation has been observed for 30+ days",
    apps_script_http_trigger:      "Lists Apps Script web-app deployments + Cloud Function HTTP triggers linked to the agent; fires when a webhook is reachable from the open internet",
    expired_renewal:               "Reads the CloudFuze agent_registry renewal date; fires when past due with no re-certification recorded",
    shared_gemini_gem:             "Reads gem.visibility from the Gemini Workspace admin API; fires for tenant-wide or group-shared Gems",
    sensitive_keywords:            "Scans agent name/description for keywords such as patient, PHI, HIPAA, SSN, claim, revenue, billing, genetic, prescription, credential, secret, …",
    multiple_read_scopes:          "Counts simultaneous read scopes across Workspace + GCP (.readonly, .dataViewer, .viewer, .subscriber, messages.readonly)",
    no_policy_applied:             "Checks whether any CloudFuze governance policy is currently bound to the agent",
  };

  const googleSignals = Object.entries(GOOGLE_RISK_SIGNALS).map(([key, cat]) => ({
    signal: cat.label,
    weight: cat.weight.charAt(0).toUpperCase() + cat.weight.slice(1),
    impact: cat.deduction === 0 ? "flag only" : `${cat.deduction}`,
    source: cat.source,
    how: googleSignalHowTo[key] || "",
  }));

  const signalRows = isGoogleGuide ? googleSignals : msSignals;

  const msSimOpts = [
    { key: "orphaned", label: "Agent has no owner (orphaned)", weight: "CRITICAL -20" },
    { key: "broadPerms", label: "Has broad connector scopes", weight: "CRITICAL -20" },
    { key: "stale", label: "No activity in 30+ days", weight: "HIGH -12" },
    { key: "expiredRenewal", label: "Renewal date expired", weight: "MED -10" },
    { key: "allUsersScope", label: "Deployed to all users (Teams)", weight: "MED -10" },
    { key: "httpConnector", label: "HTTP connector present", weight: "MED -10" },
    { key: "sensitiveKw", label: "Sensitive keywords in name/description", weight: "LOW -5" },
  ];

  const googleSimOpts = [
    { key: "sensitive_oauth_scopes", label: "Sensitive OAuth scopes (Drive / Gmail / Chat) tenant-wide", weight: "CRITICAL -20" },
    { key: "orphaned_owner", label: "Google account disabled / owner = 'Unknown'", weight: "CRITICAL -20" },
    { key: "external_chat_space", label: "Chat bot reachable from external / tenant-wide space", weight: "HIGH -15" },
    { key: "agent_builder_with_datastores", label: "Agent Builder backed by BigQuery / Drive data stores", weight: "HIGH -15" },
    { key: "stale_30_days", label: "No Vertex / Gem activity in 30+ days", weight: "HIGH -12" },
    { key: "apps_script_http_trigger", label: "Apps Script / HTTP webhook reachable from the open internet", weight: "MED -10" },
    { key: "expired_renewal", label: "Annual governance review overdue", weight: "MED -10" },
    { key: "shared_gemini_gem", label: "Gemini Gem shared tenant-wide", weight: "MED -10" },
    { key: "sensitive_keywords", label: "Sensitive keywords (PHI / claims / secret / …)", weight: "LOW -5" },
    { key: "multiple_read_scopes", label: "Multiple simultaneous read scopes (Workspace + GCP)", weight: "LOW -5" },
  ];

  const simOpts = isGoogleGuide ? googleSimOpts : msSimOpts;

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
            {(isGoogleGuide
              ? [
                  { level: "Low", range: "76-100", color: "#22c55e", desc: "Healthy — within acceptable risk" },
                  { level: "Medium", range: "51-75", color: "#3b82f6", desc: "Monitor — some risk signals present" },
                  { level: "High", range: "26-50", color: "#f59e0b", desc: "Needs review — multiple risk factors" },
                  { level: "Critical", range: "0-25", color: "#ef4444", desc: "Immediate action — severe risk" },
                ]
              : [
                  { level: "Low", range: "80-100", color: "#22c55e", desc: "Healthy — within acceptable risk" },
                  { level: "Medium", range: "60-79", color: "#3b82f6", desc: "Monitor — some risk signals present" },
                  { level: "High", range: "40-59", color: "#f59e0b", desc: "Needs review — multiple risk factors" },
                  { level: "Critical", range: "0-39", color: "#ef4444", desc: "Immediate action — severe risk" },
                ]
            ).map(b => (
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
                {signalRows.map((r, i) => (
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
                  {simOpts.map(opt => (
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
            {isGoogleGuide ? (
              <div style={{ fontSize: 11, color: "#4338ca", lineHeight: 1.7 }}>
                <strong>User Chats (Gemini &amp; Chat transcripts):</strong> Conversation volume per agent is read from the
                Gemini Workspace admin API and Chat API. It feeds the <strong>"No Vertex / Gem activity in 30+ days"</strong>
                signal — if an agent hasn't been invoked within 30 days it takes a <strong>-12 point (High) deduction</strong>.
                Agents with zero conversations surface as potentially unused in Stale Agents.
                <br /><br />
                <strong>Files &amp; Knowledge (Drive / BigQuery / Vertex DataStore / GCS):</strong> Knowledge bindings
                (discoveryengine.dataStores, BigQuery dataset grants, Drive folder shares, Vector Search indexes)
                directly drive the <strong>"Agent Builder with data stores"</strong> and <strong>"Multiple read scopes"</strong> signals.
                File activity events (TableQueried, ObjectWritten, FileAccessed, MessageSent) come from Cloud Logging
                and Drive Activity API.
                <br /><br />
                <strong>Renewal Date:</strong> The annual governance review date comes from the CloudFuze
                agent_registry. When the review is overdue without a re-certification, the
                <strong> "Expired renewal"</strong> signal triggers a <strong>-10 point deduction</strong>.
                <br /><br />
                <strong>Note:</strong> Google risk scoring uses the standard bands
                <em> critical ≤ 25</em>, <em>high ≤ 50</em>, <em>medium ≤ 75</em>, otherwise <em>low</em>,
                with a base −5 deduction applied to every agent to match Microsoft's baseline.
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "#4338ca", lineHeight: 1.7 }}>
                <strong>User Chats (Conversation Transcripts):</strong> The number of conversations is tracked per agent from Dataverse.
                This directly feeds the <strong>"Stale agent"</strong> signal — if an agent has sessions but the last one was 30+ days ago, it gets a <strong>-12 point (High) deduction</strong>.
                Agents with zero conversations are flagged as potentially unused.
                <br /><br />
                <strong>Files &amp; Audit Logs:</strong> File access events from O365 Audit API (SharePoint/OneDrive operations) are monitored.
                While file access cannot always be definitively attributed to a specific Copilot Studio agent at runtime, the audit data informs overall tenant activity.
                <br /><br />
                <strong>Renewal Date:</strong> Admins set a renewal date during governance review to schedule the next re-certification.
                If no renewal date is set, the column shows the agent's creation date from Dataverse instead.
                Once a renewal date passes without re-certification, the <strong>"Overdue for renewal"</strong> signal triggers a <strong>-10 point deduction</strong>.
                <br /><br />
                <strong>Note:</strong> Risk scoring is based on <em>configuration posture</em>, not observed runtime behavior.
                Specific runtime actions (e.g., which files an agent read) are only visible when an audit event is generated.
              </div>
            )}
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

  if (!agent.owner?.displayName || agent.owner?.displayName === "Unknown" || agent.isOrphaned || agent.owner?.accountEnabled === false) {
    score -= 20;
    factors.push({ signal: "No identified owner", weight: "high", description: "Agent has no clear owner — orphaned agent" });
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
  const [riskData, setRiskData] = useState(DEMO_RISK_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedBot, setExpandedBot] = useState(null);
  const isGoogleApplication = APP_OPTIONS.find((a) => a.id === application)?.vendor === "google";
  const loadRisk = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 12000));
    setRiskData(DEMO_RISK_SUMMARY);
    setLoading(false);
  };

  const isCopilotStudio = application === "copilot_studio";

  // For non-Copilot-Studio apps, use discovery scan's pre-computed risk (from assessRisk in riskService)
  const discoveryAgentsWithRisk = useMemo(() => {
    if (isCopilotStudio || discoveredAgents.length === 0) return [];
    return discoveredAgents.map((a, idx) => {
      const risk = a.risk || computeDiscoveredAgentRisk(a);
      const ownerName = a.owner?.displayName;
      const isOrphaned = a.isOrphaned || !ownerName || ownerName === "Unknown" || a.owner?.accountEnabled === false;
      const totalUsage = a.activity?.totalInvocations || 0;
      const chatCount = totalUsage;
      const sessionCount = Math.round(totalUsage * (0.15 + (idx % 5) * 0.05));
      const hasRenewal = idx % 3 !== 2;
      let renewalDate = null;
      let isExpiredRenewal = false;
      if (hasRenewal) {
        const offsetDays = idx % 5 === 0 ? -10 : idx % 5 === 1 ? 7 : idx % 5 === 3 ? 45 : 75;
        renewalDate = new Date(Date.now() + offsetDays * 86400000).toISOString();
        isExpiredRenewal = offsetDays < 0;
      }
      return {
        botId: a.id || a.botId,
        botName: a.name,
        description: a.description || `${a.platform} agent`,
        ownerName: isOrphaned ? "Unknown" : ownerName,
        isOrphaned,
        status: a.lifecycleStatus || "unknown",
        risk,
        sessionCount,
        conversationCount: chatCount,
        lastActivity: a.activity?.lastActiveTimestamp || null,
        createdOn: a.createdOn || a.registeredOn || null,
        modifiedOn: a.modifiedOn || null,
        renewalDate,
        renewalPeriodDays: 90,
        isExpiredRenewal,
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
    return discoveredAgents.map((a, idx) => {
      const risk = a.risk || computeDiscoveredAgentRisk(a);
      const totalUsage = a.activity?.totalInvocations || 0;
      const chatCount = totalUsage;
      const sessionCount = Math.round(totalUsage * (0.15 + (idx % 5) * 0.05));
      const cfOwnerName = a.owner?.displayName;
      const cfIsOrphaned = a.isOrphaned || !cfOwnerName || cfOwnerName === "Unknown" || a.owner?.accountEnabled === false;
      const hasRenewal = idx % 3 !== 2;
      let renewalDate = null;
      let isExpiredRenewal = false;
      if (hasRenewal) {
        const offsetDays = idx % 5 === 0 ? -10 : idx % 5 === 1 ? 7 : idx % 5 === 3 ? 45 : 75;
        renewalDate = new Date(Date.now() + offsetDays * 86400000).toISOString();
        isExpiredRenewal = offsetDays < 0;
      }
      return {
        botId: a.id || a.botId,
        botName: a.name,
        description: a.description || `${a.platform} agent`,
        ownerName: cfIsOrphaned ? "Unknown" : cfOwnerName,
        isOrphaned: cfIsOrphaned,
        status: a.lifecycleStatus || "unknown",
        risk,
        sessionCount,
        conversationCount: chatCount,
        lastActivity: a.activity?.lastActiveTimestamp || null,
        renewalDate,
        renewalPeriodDays: 90,
        isExpiredRenewal,
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
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
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
                      </tr>

                      {/* Expanded Risk Breakdown */}
                      {isExpanded && (
                        <tr key={`${agent.botId}-breakdown`} style={{ borderBottom: "2px solid var(--ag-border)" }}>
                          <td colSpan={8} style={{ padding: 0 }}>
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
                                    <div style={{ color: "#22c55e" }}>Base risk ({agent.risk?.level || "low"}): <span style={{ fontWeight: 700 }}>-5</span></div>
                                    {allFactors.filter(f => f.weight !== "info").map((f, i) => {
                                      // Color each signal by its severity so
                                      // the breakdown visually matches the
                                      // dots in the collapsed row and the
                                      // risk-signal table in the scoring
                                      // guide: critical=red, high=amber,
                                      // medium=blue, low=green.
                                      const hasDeduction = typeof f.deduction === "number";
                                      const isDeduction = hasDeduction
                                        ? f.deduction < 0
                                        : (f.weight === "critical" || f.weight === "high" || f.weight === "medium" || f.weight === "low");
                                      const isFlagOnly = hasDeduction && f.deduction === 0;
                                      const WEIGHT_COLORS = { critical: "#ef4444", high: "#f59e0b", medium: "#3b82f6", low: "#22c55e" };
                                      const color = isFlagOnly
                                        ? "#9ca3af"
                                        : WEIGHT_COLORS[f.weight] || (isDeduction ? "#ef4444" : "#22c55e");
                                      const label = isFlagOnly
                                        ? "flag only"
                                        : isDeduction
                                          ? (hasDeduction ? `${f.deduction}` : "deducted")
                                          : "bonus";
                                      return (
                                        <div key={i} style={{ color, display: "flex", alignItems: "center", gap: 6 }}>
                                          <span style={{
                                            width: 6, height: 6, borderRadius: "50%",
                                            background: color, flexShrink: 0,
                                          }} />
                                          {f.signal}: <span style={{ fontWeight: 700 }}>{label}</span>
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
          <RiskScoringGuide vendor={isGoogleApplication ? "google" : "microsoft"} />
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
  // Microsoft
  { id: "copilot_studio", label: "Copilot Studio", color: "#742774", vendor: "microsoft" },
  { id: "personal_agent", label: "Personal Agents", color: "#2563eb", vendor: "microsoft" },
  { id: "sharepoint_agent", label: "SharePoint Agents", color: "#059669", vendor: "microsoft" },
  { id: "azure_foundry", label: "Azure AI Foundry", color: "#0078D4", vendor: "microsoft" },
  // Google
  { id: "agent_builder", label: "Agent Builder", color: "#4285F4", vendor: "google" },
  { id: "gemini_gems", label: "Gemini Gems", color: "#886FBF", vendor: "google" },
  { id: "notebook_lm", label: "NotebookLM", color: "#EA4335", vendor: "google" },
  { id: "google_chat_bots", label: "Chat Bots", color: "#00AC47", vendor: "google" },
  { id: "reasoning_engines", label: "Reasoning Engines", color: "#0F9D58", vendor: "google" },
];

// Azure Risk Panel — shows Azure-specific governance signals
function AzureRiskPanel({ oauthKeyId }) {
  const demoAzureRisk = {
    openAIResources: DEMO_AZURE_AI.aiServices.filter((s) => s.kind === "OpenAI").map((s) => ({
      ...s, publicAccess: "Enabled", localAuthDisabled: false,
      deployments: DEMO_AZURE_AI.deployments.filter((d) => d.resourceName === s.name).map((d) => ({ ...d, contentFilter: d.model.includes("gpt-4") ? "nsi-safety-policy" : null })),
    })),
    accessControl: [
      { principalType: "User", roleName: "Cognitive Services OpenAI Contributor", principalName: "David Nakamura" },
      { principalType: "User", roleName: "Cognitive Services OpenAI Contributor", principalName: "Marcus Williams" },
      { principalType: "User", roleName: "Owner", principalName: "Carlos Brooks" },
      { principalType: "ServicePrincipal", roleName: "Cognitive Services OpenAI User", principalName: "Fraud Detection Engine" },
      { principalType: "ServicePrincipal", roleName: "Cognitive Services OpenAI User", principalName: "Document Processing AI" },
      { principalType: "ServicePrincipal", roleName: "Cognitive Services OpenAI User", principalName: "Underwriting Risk Analyzer" },
      { principalType: "ServicePrincipal", roleName: "Cognitive Services OpenAI User", principalName: "Claims Photo Analyzer" },
    ],
  };
  const data = demoAzureRisk;

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
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ag-text-primary)" }}>{Math.max(0, overallScore)}</div>
          <RiskBadge level={overallLevel} />
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 120 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>OpenAI Resources</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ag-text-primary)" }}>{data.openAIResources.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 120 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>Model Deployments</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ag-text-primary)" }}>{data.openAIResources.reduce((s, r) => s + r.deployments.length, 0)}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "16px 24px", minWidth: 120 }}>
          <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>RBAC Assignments</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ag-text-primary)" }}>{data.accessControl.length}</div>
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
  const data = {
    openAIResources: DEMO_AZURE_AI.aiServices.filter((s) => s.kind === "OpenAI").map((s) => ({
      ...s, publicAccess: "Enabled", localAuthDisabled: false, skuName: s.sku,
      deployments: DEMO_AZURE_AI.deployments.filter((d) => d.resourceName === s.name).map((d) => ({
        id: d.name, name: d.name, modelName: d.model, modelVersion: d.version,
        contentFilter: d.model.includes("gpt-4") ? "nsi-safety-policy" : null,
        capacityTPM: d.capacity * 1000,
      })),
    })),
  };

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
  const [expandedThread, setExpandedThread] = useState(null);
  const usage = {
    totalRequests: 342800,
    totalTokens: 187400000,
    resources: DEMO_AZURE_AI.aiServices.filter((s) => s.kind === "OpenAI").map((s) => ({
      resourceName: s.name,
      metrics: {
        deployments: DEMO_AZURE_AI.deployments.filter((d) => d.resourceName === s.name).map((d) => ({
          deploymentName: d.name, requestCount: Math.floor(Math.random() * 50000) + 10000,
          promptTokens: Math.floor(Math.random() * 20000000) + 5000000,
          completionTokens: Math.floor(Math.random() * 10000000) + 2000000,
          totalTokens: Math.floor(Math.random() * 30000000) + 7000000,
        })),
      },
    })),
  };
  const loaded = true;

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
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
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
  const demoSignIns = [
    { userDisplayName: "Helen Nguyen", userPrincipalName: "h.nguyen@nationalshield.com", appDisplayName: "Customer Service Copilot", createdDateTime: new Date(Date.now() - 3600000).toISOString(), status: { errorCode: 0 } },
    { userDisplayName: "Brian Anderson", userPrincipalName: "b.anderson@nationalshield.com", appDisplayName: "Customer Service Copilot", createdDateTime: new Date(Date.now() - 7200000).toISOString(), status: { errorCode: 0 } },
    { userDisplayName: "Dr. Alan Fischer", userPrincipalName: "a.fischer@nationalshield.com", appDisplayName: "Actuarial Data Assistant", createdDateTime: new Date(Date.now() - 86400000 * 3).toISOString(), status: { errorCode: 0 } },
    { userDisplayName: "Patricia Clark", userPrincipalName: "p.clark@nationalshield.com", appDisplayName: "Customer Service Copilot", createdDateTime: new Date(Date.now() - 86400000).toISOString(), status: { errorCode: 0 } },
    { userDisplayName: "Mika Sato", userPrincipalName: "m.sato@nationalshield.com", appDisplayName: "Actuarial Data Assistant", createdDateTime: new Date(Date.now() - 86400000 * 5).toISOString(), status: { errorCode: 0 } },
  ];
  const demoAppSummaries = [
    { appId: "pa-customer-svc-005", appName: "Customer Service Copilot", totalSignIns: 4200, uniqueUsers: 1240, lastActivity: new Date(Date.now() - 3600000).toISOString() },
    { appId: "pa-actuarial-015", appName: "Actuarial Data Assistant", totalSignIns: 720, uniqueUsers: 6, lastActivity: new Date(Date.now() - 86400000 * 3).toISOString() },
  ];
  const [signIns, setSignIns] = useState(demoSignIns);
  const [appSummaries, setAppSummaries] = useState(demoAppSummaries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

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
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
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
  const [knowledge, setKnowledge] = useState(DEMO_KNOWLEDGE);
  const [assistants, setAssistants] = useState(DEMO_AZURE_AI.assistants);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(true);
  const load = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 12000));
    setKnowledge(DEMO_KNOWLEDGE);
    setAssistants(DEMO_AZURE_AI.assistants);
    setLoaded(true);
    setLoading(false);
  };

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
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
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
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name || "Assistant"}</span>
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
  const [stats, setStats] = useState({ totalConversations: 0, totalMessages: 0, uniqueUsers: 0, uniqueAgents: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(true);
  const [expandedChat, setExpandedChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const loadConversations = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 12000));
    setLoaded(true);
    setLoading(false);
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
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
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
  // Microsoft
  copilot_studio: ["copilot_studio"],
  personal_agent: ["personal_agent"],
  sharepoint_agent: ["sharepoint_embedded"],
  azure_foundry: ["azure_foundry"],
  // Google
  agent_builder: ["agent_builder"],
  gemini_gems: ["gemini_gems"],
  notebook_lm: ["notebook_lm"],
  google_chat_bots: ["google_chat_bots"],
  reasoning_engines: ["reasoning_engines"],
};

export function UserActivityTab() {
  const { oauthKeyId, dataverseEnvUrl, googleKeyId } = useAgentAuth();
  const { state: govState } = useGovernance();
  const [subTab, setSubTab] = useState("safety");
  const [application, setApplication] = useState("copilot_studio");
  const [chats, setChats] = useState(DEMO_CHATS);
  const [files, setFiles] = useState(DEMO_FILES);
  const [knowledge, setKnowledge] = useState(DEMO_KNOWLEDGE);
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
  const [chatsLoaded, setChatsLoaded] = useState(true);
  const [filesLoaded, setFilesLoaded] = useState(true);
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(true);
  const [agentFilesOnly, setAgentFilesOnly] = useState(false);

  const [azureUsageDetails, setAzureUsageDetails] = useState({
    resources: DEMO_AZURE_AI.aiServices.filter((s) => s.kind === "OpenAI").map((r) => ({
      resourceName: r.name, location: r.location,
      deployments: DEMO_AZURE_AI.deployments.filter((d) => d.resourceName === r.name).map((d) => ({
        name: d.name, model: d.model, requests: Math.floor(Math.random() * 40000) + 5000,
        promptTokens: Math.floor(Math.random() * 15000000) + 2000000,
        completionTokens: Math.floor(Math.random() * 8000000) + 1000000,
        totalTokens: Math.floor(Math.random() * 23000000) + 3000000,
      })),
    })),
    totals: { requests: 342800, promptTokens: 112000000, completionTokens: 75400000, totalTokens: 187400000 },
  });
  const [azureUsageLoading, setAzureUsageLoading] = useState(false);
  const [azureUsageError, setAzureUsageError] = useState(null);
  const [azureUsagePeriod, setAzureUsagePeriod] = useState("P7D");

  const isGoogleApp = (appId) => APP_OPTIONS.find((a) => a.id === appId)?.vendor === "google";

  const loadChats = async () => {
    setChatsLoading(true);
    setChatsError(null);
    await new Promise((r) => setTimeout(r, 12000));
    setChats(isGoogleApp(application) ? DEMO_GOOGLE_CHATS : DEMO_CHATS);
    setChatsLastUpdated(new Date());
    setChatsLoaded(true);
    setChatsLoading(false);
  };

  const [subscriptionNote, setSubscriptionNote] = useState(null);

  const loadFiles = async () => {
    setFilesLoading(true);
    setFilesError(null);
    setSubscriptionNote(null);
    await new Promise((r) => setTimeout(r, 12000));
    setFiles(isGoogleApp(application) ? DEMO_GOOGLE_FILES : DEMO_FILES);
    setFilesLoaded(true);
    setFilesLoading(false);
  };

  const loadKnowledge = async () => {
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    await new Promise((r) => setTimeout(r, 12000));
    setKnowledge(isGoogleApp(application) ? DEMO_GOOGLE_KNOWLEDGE : DEMO_KNOWLEDGE);
    setKnowledgeLoaded(true);
    setKnowledgeLoading(false);
  };

  const isGoogle = APP_OPTIONS.find((a) => a.id === application)?.vendor === "google";

  // Reset loaded state when switching platforms so data is re-fetched from the right source
  const prevAppRef = useState({ prev: application })[0];
  useEffect(() => {
    if (prevAppRef.prev !== application) {
      const wasGoogle = isGoogleApp(prevAppRef.prev);
      const nowGoogle = isGoogleApp(application);
      prevAppRef.prev = application;
      setSearchQuery("");
      setAgentFilter("all");
      if (wasGoogle !== nowGoogle) {
        setChats(nowGoogle ? DEMO_GOOGLE_CHATS : DEMO_CHATS);
        setFiles(nowGoogle ? DEMO_GOOGLE_FILES : DEMO_FILES);
        setKnowledge(nowGoogle ? DEMO_GOOGLE_KNOWLEDGE : DEMO_KNOWLEDGE);
      }
    }
  }, [application]);

  // Only fetch data when a scan is running or has completed — not on connect
  const scanActive = govState.discoveryStatus === "loading" || govState.discoveryStatus === "success";
  useEffect(() => {
    if (!scanActive) return;
    if (!chatsLoaded && !chatsLoading) loadChats();
    if (!filesLoaded && !filesLoading) loadFiles();
    if (!knowledgeLoaded && !knowledgeLoading) loadKnowledge();
  }, [scanActive, oauthKeyId, chatsLoaded, filesLoaded, knowledgeLoaded]);

  // Demo mode — no auto-polling or refresh-key reloads needed

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

  const loadAzureUsageDetails = () => {};

  useEffect(() => {
    if (isAzureFoundry && oauthKeyId && subTab === "chats") {
      loadAzureUsageDetails(azureUsagePeriod);
    }
  }, [isAzureFoundry, oauthKeyId, azureUsagePeriod]);

  const platformChats = useMemo(() => {
    if (isAzureFoundry) return [];
    // Google — pick the correct dataset, then filter to the selected Google
    // platform (agent_builder / gemini_gems / notebook_lm / google_chat_bots /
    // reasoning_engines) using the same identifier resolution strategy as MS.
    if (isGoogle) {
      const googleSource = Array.isArray(chats) && chats.length > 0 && chats[0]?.id?.startsWith("gchat-")
        ? chats
        : DEMO_GOOGLE_CHATS;
      if (!platformAgentIdentifiers) return googleSource;
      return googleSource.filter((c) => {
        const botNameLC = (c.botName || "").toLowerCase();
        const botIdLC = (c.botId || "").toLowerCase();
        return platformAgentIdentifiers.has(botNameLC) || platformAgentIdentifiers.has(botIdLC);
      });
    }
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
  }, [chats, platformAgentIdentifiers, isGoogle, application, isAzureFoundry, platformDiscoveredAgents]);

  // Filter knowledge to agents of the selected platform. For Google we
  // pull from DEMO_GOOGLE_KNOWLEDGE (Drive / BigQuery / Vertex DataStore /
  // GCS / Pub/Sub bindings) and filter by the discovered agents that
  // belong to the selected Google platform.
  const platformKnowledge = useMemo(() => {
    if (isGoogle) {
      const firstId = Array.isArray(knowledge) && knowledge.length > 0 ? (knowledge[0]?.botId || "") : "";
      const isGoogleDataset = /^(re|gab|gem|gcb|nlm)-/.test(firstId);
      const googleSource = isGoogleDataset ? knowledge : DEMO_GOOGLE_KNOWLEDGE;
      if (!platformAgentIdentifiers) return googleSource;
      return googleSource.filter((b) => {
        const nameLC = (b.botName || "").toLowerCase();
        const idLC = (b.botId || "").toLowerCase();
        return platformAgentIdentifiers.has(nameLC) || platformAgentIdentifiers.has(idLC);
      });
    }
    if (!platformAgentIdentifiers || application === "copilot_studio") return knowledge;
    return knowledge.filter((b) => {
      const nameLC = (b.botName || "").toLowerCase();
      const idLC = (b.botId || "").toLowerCase();
      return platformAgentIdentifiers.has(nameLC) || platformAgentIdentifiers.has(idLC);
    });
  }, [knowledge, platformAgentIdentifiers, isGoogle, application]);

  // Merge each discovered agent on this platform with its knowledge record
  // (falling back to connector/description extraction when there is no
  // explicit knowledge entry). This is the single source of truth the
  // Knowledge & Files panel renders, and also what we show in the sub-tab
  // badge so the two numbers can never disagree.
  const mergedPlatformKnowledge = useMemo(() => {
    const knowledgeMap = new Map();
    for (const k of platformKnowledge) {
      if (k.botId) knowledgeMap.set(k.botId, k);
      if (k.botName) knowledgeMap.set(k.botName.toLowerCase(), k);
    }
    return platformDiscoveredAgents.map((agent) => {
      const existing =
        knowledgeMap.get(agent.id) ||
        knowledgeMap.get((agent.name || "").toLowerCase());
      return existing || extractKnowledgeFromDiscoveredAgent(agent);
    });
  }, [platformKnowledge, platformDiscoveredAgents]);

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
  if (agentFilter !== "all") {
    filteredFiles = filteredFiles.filter((f) => (f.agentName || f.userName) === agentFilter || f.relatedAgents?.some((a) => a === agentFilter));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filteredFiles = filteredFiles.filter(
      (f) =>
        f.fileName?.toLowerCase().includes(q) ||
        f.agentName?.toLowerCase().includes(q) ||
        f.userName?.toLowerCase().includes(q) ||
        f.filePath?.toLowerCase().includes(q) ||
        f.workload?.toLowerCase().includes(q)
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

  // Filter the app picker based on the header's vendor selection so
  // "Microsoft" only shows MS platforms and "Google" only shows Google platforms.
  const headerVendor = govState.selectedVendor;
  const visibleApps = headerVendor === "microsoft"
    ? APP_OPTIONS.filter((a) => a.vendor === "microsoft")
    : headerVendor === "google"
    ? APP_OPTIONS.filter((a) => a.vendor === "google")
    : APP_OPTIONS;

  // If the currently selected application isn't in the current vendor scope,
  // snap it to the first available app.
  useEffect(() => {
    if (!visibleApps.find((a) => a.id === application)) {
      setApplication(visibleApps[0]?.id || "copilot_studio");
    }
  }, [headerVendor]);

  return (
    <div>
      {/* Sub-tab navigation + Application dropdown */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--ag-border)", alignItems: "flex-end" }}>
        {[
          { id: "safety", label: "AI Safety", icon: <Eye size={14} />, count: sensitiveData.summary.total, alert: sensitiveData.summary.total > 0 },
          { id: "risk", label: "Risk Management", icon: <ShieldAlert size={14} />, count: 0 },
          { id: "knowledge", label: "Knowledge & Files", icon: <FolderOpen size={14} />, count: mergedPlatformKnowledge.reduce((sum, b) => sum + (b.sources?.length || 0), 0) },
          { id: "files", label: "Data Activity", icon: <FileText size={14} />, count: files.length },
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
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ag-text-primary)" }}>
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
                      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--ag-text-primary)" }}>{count}</div>
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
      {(
        <div style={{ display: subTab === "knowledge" ? "block" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Database size={18} color="#6366f1" />
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--ag-text-primary)" }}>Knowledge & Files</span>
            </div>
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
          ) : platformDiscoveredAgents.length > 0 ? (
            (() => {
              let mergedKnowledge = mergedPlatformKnowledge;
              if (agentFilter !== "all") {
                mergedKnowledge = mergedKnowledge.filter(b => b.botName === agentFilter);
              }
              if (searchQuery) {
                const q = searchQuery.toLowerCase();
                mergedKnowledge = mergedKnowledge.filter(b =>
                  b.botName?.toLowerCase().includes(q) ||
                  b.sources?.some(s => s.name?.toLowerCase().includes(q) || s.type?.toLowerCase().includes(q) || s.url?.toLowerCase().includes(q))
                );
              }
              const totalSources = mergedKnowledge.reduce((s, b) => s + (b.sources?.length || 0), 0);
              const withSources = mergedKnowledge.filter(b => b.sources?.length > 0).length;
              return (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                {[
                  { label: "Agents Scanned", value: mergedKnowledge.length, color: "#6366f1" },
                  { label: "Total Knowledge Sources", value: totalSources, color: "#22c55e" },
                  { label: "With Sources", value: withSources, color: "#3b82f6" },
                  { label: "Without Sources", value: mergedKnowledge.length - withSources, color: "#f59e0b" },
                ].map((s) => (
                  <div key={s.label} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: "10px 16px", minWidth: 140 }}>
                    <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {mergedKnowledge.map((bot) => (
                <BotKnowledgePanel key={bot.botId} bot={bot} />
              ))}
            </div>
              );
            })()
          ) : knowledgeLoaded ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
              <FolderOpen size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>No agents found</h3>
              <p style={{ fontSize: 13 }}>Run a discovery scan first, then come back here to check knowledge sources.</p>
            </div>
          ) : null}
        </div>
      )}

      {/* ===== FILES SUB-TAB ===== */}
      <div style={{ display: subTab === "files" ? "block" : "none" }}>
          <AgentPermissionsPanel oauthKeyId={oauthKeyId} enabled={scanActive} vendor={isGoogle ? "google" : "microsoft"} />

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


          {/* Agent File Activity Summary */}
          {filesLoaded && filteredFiles.length > 0 && (() => {
            const uniqueAgents = new Set(filteredFiles.map(f => f.agentName || f.userName));
            const msSpCount = filteredFiles.filter(f => f.workload === "SharePoint").length;
            const msOdCount = filteredFiles.filter(f => f.workload === "OneDrive").length;
            const gDriveCount = filteredFiles.filter(f => f.workload === "Google Drive").length;
            const gDocsCount = filteredFiles.filter(f => f.workload === "Google Docs").length;
            const gSheetsCount = filteredFiles.filter(f => f.workload === "Google Sheets").length;
            const modCount = filteredFiles.filter(f => ["FileModified", "FileUploaded", "FileCreated", "ObjectWritten"].includes(f.operation)).length;
            const summaryCards = isGoogle
              ? [
                  { label: "Total File Events", value: filteredFiles.length, color: "#6366f1" },
                  { label: "Agents Active", value: uniqueAgents.size, color: "#10b981" },
                  { label: "Drive Events", value: gDriveCount, color: "#4285F4" },
                  { label: "Docs Events", value: gDocsCount, color: "#1A73E8" },
                  { label: "Sheets Events", value: gSheetsCount, color: "#0F9D58" },
                  { label: "File Modifications", value: modCount, color: modCount > 0 ? "#f59e0b" : "#22c55e" },
                ]
              : [
                  { label: "Total File Events", value: filteredFiles.length, color: "#6366f1" },
                  { label: "Agents Active", value: uniqueAgents.size, color: "#10b981" },
                  { label: "SharePoint Events", value: msSpCount, color: "#059669" },
                  { label: "OneDrive Events", value: msOdCount, color: "#3b82f6" },
                  { label: "File Modifications", value: modCount, color: modCount > 0 ? "#f59e0b" : "#22c55e" },
                ];
            return (
              <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                {summaryCards.map((s) => (
                  <div key={s.label} style={{
                    background: "var(--ag-bg-card)",
                    border: "1px solid var(--ag-border)",
                    borderRadius: 8, padding: "10px 16px", minWidth: 130,
                  }}>
                    <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ag-text-primary)" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            );
          })()}


          {/* Spacer after summary cards */}

          {filteredFiles.length > 0 ? (
            <Section title={`Agent File Activity (${filteredFiles.length})`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--ag-border)" }}>
                      <th style={thStyle}>File</th>
                      <th style={thStyle}>Agent</th>
                      <th style={thStyle}>Operation</th>
                      <th style={thStyle}>Source</th>
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
                {searchQuery ? "No files match your search" : "No agent file activity found"}
              </h3>
              <p style={{ fontSize: 13, maxWidth: 500, margin: "0 auto" }}>
                {searchQuery
                  ? "Try adjusting your search criteria."
                  : isGoogle
                    ? "File activity events from Google Drive, Google Docs, and Google Sheets triggered by agents will appear here."
                    : "File activity events from SharePoint and OneDrive triggered by agents will appear here."}
              </p>
            </div>
          ) : null}
      </div>
    </div>
  );
}

const thStyle = { textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600, fontSize: 11 };
