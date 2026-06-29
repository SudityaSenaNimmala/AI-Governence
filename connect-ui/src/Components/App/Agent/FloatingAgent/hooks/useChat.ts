import { useState, useCallback, useRef, useEffect } from "react";
import type { WidgetDescriptor } from "@cloudfuze/shared";
import { streamChat, clearSession, fetchHistory, fetchSessions, type HistoryEntry, type ChatSession } from "../lib/api";
import type { ActionPlan } from "../mouseAgent/types";

export type { ChatSession };

export interface ToolCall {
  toolName: string;
  toolUseId: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  rowCount?: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  widgets: WidgetDescriptor[];
  loading: boolean;
  widgetPending?: boolean;
  status?: string;
  error?: boolean;
  followUps?: string[];
  toolCalls?: ToolCall[];
  actionPlan?: ActionPlan;
  actionPlanExecuted?: boolean;
  /** From last agent query SSE `done` — required for action_buttons → POST /api/agent/action */
  runId?: string | null;
}

const TOOL_STATUS: Record<string, string> = {
  get_org_stats:           "Loading portfolio overview…",
  get_discovered_apps:     "Fetching app inventory…",
  get_app_usage:           "Analyzing app usage…",
  get_licenses:            "Checking licenses…",
  get_unused_licenses:     "Scanning unused seats…",
  get_user_apps:           "Fetching user apps…",
  get_spend_summary:       "Calculating spend…",
  get_spend_anomalies:     "Detecting anomalies…",
  get_renewal_forecast:    "Checking renewals…",
  get_shadow_it:           "Scanning shadow IT…",
  get_compliance_summary:  "Checking compliance…",
  get_duplicate_tools:     "Finding duplicate tools…",
  get_contract_details:    "Loading contracts…",
  search_apps:             "Searching apps…",
  get_groups:              "Fetching groups…",
  run_sql_query:           "Querying user directory…",
};

const TOOL_QUESTIONS: Record<string, string> = {
  get_user_metrics:               "How many total users do I have?",
  get_vendor_user_metrics:        "Show user counts per vendor",
  get_user_list:                  "Show me the full user list",
  get_vendor_list:                "What apps are connected?",
  get_license_utilization:        "Show license utilization report",
  get_license_waste_report:       "Which licenses are being wasted?",
  get_spend_summary:              "What is my total SaaS spend?",
  get_spend_anomalies:            "Are there any spend anomalies?",
  get_renewal_forecast:           "What contracts are renewing soon?",
  get_shadow_it:                  "Are there any unauthorized apps?",
  get_duplicate_tools:            "Do I have duplicate tools?",
  search_apps:                    "Search for a specific app",
  get_user_offboarding_checklist: "Help me offboard a user",
  get_compliance_summary:         "What is my compliance status?",
  get_compliance_score:           "What is my compliance score?",
  get_policy_violations:          "Are there any policy violations?",
  trigger_action:                 "Take action on a recommendation",
};

function isToolName(s: string): boolean {
  return /^[a-z][a-z0-9_]{3,}$/.test(s) && s.includes("_");
}

function stripJsonBlock(raw: string): string {
  // Strip complete block first
  const complete = raw.match(/```json[\s\S]*?```/);
  if (complete) return raw.slice(0, complete.index).trim();
  // Strip partial/incomplete block (streaming: opener seen but no closer yet)
  const partial = raw.indexOf("```json");
  if (partial !== -1) return raw.slice(0, partial).trim();
  return raw;
}

function parseFollowUps(raw: string): { text: string; followUps: string[] } {
  const withoutJson = stripJsonBlock(raw);
  const text = withoutJson
    .replace(/<followups>[\s\S]*?<\/followups>/gi, "")
    .replace(/<followups>[\s\S]*/gi, "")
    .trim();

  const match = raw.match(/<followups>([\s\S]*?)<\/followups>/i);
  if (!match) return { text, followUps: [] };

  const followUps = match[1]
    .split("\n")
    .map(l => l.replace(/^[\s\-*\d.)[\]]+/, "").replace(/[\[\]]+$/, "").trim())
    .filter(l => l.length > 4)
    .map(l => isToolName(l) ? (TOOL_QUESTIONS[l] ?? null) : l)
    .filter((l): l is string => l !== null && l.length > 4)
    .slice(0, 3);

  return { text, followUps };
}

function newChatId(): string {
  return crypto.randomUUID();
}

/** Normalize for comparing follow-up text to prior user questions in this chat. */
function followUpKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[?!.,\-'"`]/g, "")
    .replace(/\s+/g, " ");
}

/** Skip suggestions that repeat a question the user already asked in this session (new chat clears history). */
function isRedundantWithPriorUserMessage(suggestion: string, priorUserKeys: Set<string>): boolean {
  const sn = followUpKey(suggestion);
  if (priorUserKeys.has(sn)) return true;
  for (const asked of priorUserKeys) {
    if (sn === asked) return true;
    const shorter = sn.length < asked.length ? sn : asked;
    const longer = sn.length < asked.length ? asked : sn;
    if (shorter.length >= 28 && longer.includes(shorter)) return true;
  }
  return false;
}

const FOLLOW_UP_PAD_POOL: readonly string[] = [
  "Which apps have the most inactive users?",
  "How many users are suspended?",
  "Show me users who have never signed in",
  "Show me an overview of my SaaS portfolio",
  "Which apps have unused licenses?",
  "What are my upcoming renewals?",
  "Show me SaaS spend as a bar chart by vendor",
  "Are there any high-risk shadow IT apps?",
  "Which connected apps have the lowest utilisation?",
  "Show me duplicate tool categories in my portfolio",
  "What contracts are renewing in the next 90 days?",
];

/** Always show 3 chips; pad from pool. Drop only if user already asked the same thing in this chat. */
function buildThreeFollowUps(serverList: string[], priorUserKeys: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const tryAdd = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const k = followUpKey(t);
    if (seen.has(k)) return;
    if (isRedundantWithPriorUserMessage(t, priorUserKeys)) return;
    seen.add(k);
    out.push(t);
  };
  for (const s of serverList) tryAdd(s);
  for (const p of FOLLOW_UP_PAD_POOL) {
    if (out.length >= 3) break;
    tryAdd(p);
  }
  return out.slice(0, 3);
}

export function useChat() {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatId, setChatId]       = useState<string>(newChatId);
  const [sessions, setSessions]   = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [restoring, setRestoring] = useState(true); // true until initial session restore completes
  const abortRef        = useRef<AbortController | null>(null);
  const rawTextRef      = useRef<string>("");
  const followUpsSetRef = useRef(false);
  const restoredRef     = useRef(false); // only auto-restore once on mount
  const isStreamingRef  = useRef(false); // live ref so background restore can check it

  // Keep streaming ref in sync so the mount effect closure always sees the latest value
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const refreshSessions = useCallback((options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!silent) setSessionsLoading(true);
    return fetchSessions()
      .then(list => { setSessions(list); return list; })
      .catch(() => [] as ChatSession[])
      .finally(() => {
        if (!silent) setSessionsLoading(false);
      });
  }, []);

  // On mount: restore last session — show cached version instantly, then refresh from network
  useEffect(() => {
    const CACHE_KEY = 'cf_last_session';

    // Step 1: Show cached messages immediately (zero loading time)
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { id, msgs } = JSON.parse(cached);
        setMessages(msgs);
        setChatId(id);
        setRestoring(false); // show immediately — no spinner
      }
    } catch {}

    // Step 2: Fetch fresh data in background and update silently
    refreshSessions()
      .then(list => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        if (!list.length) { setRestoring(false); return; }
        const latest = list[0];
        const parts = latest.sessionId.split(":");
        const id = parts.length >= 3 ? parts.slice(2).join(":") : latest.sessionId;
        fetchHistory(id)
          .then(entries => {
            // Don't overwrite if user already started a conversation during the fetch
            if (isStreamingRef.current) return;
            const msgs: ChatMessage[] = entries.map((e, i) => ({
              id: `h-${i}`, role: e.role, text: e.text,
              widgets: e.widgets, loading: false, followUps: [],
            }));
            setMessages(msgs);
            setChatId(id);
            // Update cache for next open
            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ id, msgs })); } catch {}
          })
          .catch(() => {})
          .finally(() => setRestoring(false));
      })
      .catch(() => setRestoring(false)); // always unblock if sessions fetch fails
  }, []);

  function updateMessage(id: string, updater: (m: ChatMessage) => ChatMessage) {
    setMessages(prev => prev.map(m => m.id === id ? updater(m) : m));
  }

  const sendMessage = useCallback((text: string) => {
    if (isStreaming || !text.trim()) return;

    // Set synchronously so background session restore can't overwrite messages mid-flight
    isStreamingRef.current = true;

    setMessages(prev => prev.map(m => ({ ...m, followUps: [] })));
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: "user", text, widgets: [], loading: false }]);

    const assistantId = `a-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: assistantId,
      role: "assistant",
      text: "",
      widgets: [],
      loading: true,
      widgetPending: true,
      toolCalls: [],
    }]);
    setIsStreaming(true);
    rawTextRef.current = "";
    followUpsSetRef.current = false;

    abortRef.current = streamChat({
      message: text,
      chatId,
      onTextDelta: delta => {
        rawTextRef.current += delta;
        const visible = stripJsonBlock(rawTextRef.current.replace(/<followups>[\s\S]*/i, "").trimEnd());
        updateMessage(assistantId, m => ({ ...m, text: visible, loading: false, status: undefined }));
        if (!followUpsSetRef.current && rawTextRef.current.includes("</followups>")) {
          followUpsSetRef.current = true;
          const { followUps } = parseFollowUps(rawTextRef.current);
          if (followUps.length > 0) {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, followUps } : m));
          }
        }
      },
      onActionPlan: (plan) => {
        updateMessage(assistantId, m => ({ ...m, actionPlan: plan }));
      },
      onWidget: descriptor => {
        updateMessage(assistantId, m => ({ ...m, widgets: [...m.widgets, descriptor], loading: false }));
      },
      onToolStart: ({ toolName, toolUseId }) => {
        updateMessage(assistantId, m => ({
          ...m,
          loading: true,
          status: TOOL_STATUS[toolName] ?? "Working…",
          toolCalls: [
            ...(m.toolCalls ?? []),
            { toolName, toolUseId, status: "running" },
          ],
        }));
      },
      onToolDone: ({ toolName, toolUseId, rowCount, durationMs }) => {
        updateMessage(assistantId, m => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map(tc =>
            tc.toolUseId === toolUseId
              ? { ...tc, status: "done", rowCount, durationMs }
              : tc
          ),
        }));
      },
      onToolError: ({ toolName, toolUseId, error }) => {
        updateMessage(assistantId, m => ({
          ...m,
          toolCalls: (m.toolCalls ?? []).map(tc =>
            tc.toolUseId === toolUseId
              ? { ...tc, status: "error", error }
              : tc
          ),
        }));
      },
      onDone: (serverFollowUps?: string[], serverText?: string, serverWidgets?: WidgetDescriptor[], agentRunId?: string | null) => {
        const { text: cleanText } = parseFollowUps(rawTextRef.current);
        const finalText = (cleanText?.trim() || serverText?.trim() || "");
        const finalWidgets = serverWidgets && serverWidgets.length > 0 ? serverWidgets : undefined;
        const raw = (serverFollowUps && serverFollowUps.length > 0)
          ? serverFollowUps
          : parseFollowUps(rawTextRef.current).followUps;
        setMessages(prev => {
          const priorUserKeys = new Set(
            prev.filter(m => m.role === "user").map(m => followUpKey(m.text)),
          );
          // Always show 3 suggested questions after every completed turn (same chip UI / flow)
          const followUps = buildThreeFollowUps(raw, priorUserKeys);
          return prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  text: finalText,
                  widgets: finalWidgets ?? m.widgets,
                  loading: false,
                  widgetPending: false,
                  followUps,
                  runId: agentRunId ?? undefined,
                }
              : m
          );
        });
        isStreamingRef.current = false;
        setIsStreaming(false);
        setTimeout(() => refreshSessions({ silent: true }), 500);
        // Update cache so next open shows the latest conversation instantly
        setMessages(prev => {
          try { sessionStorage.setItem('cf_last_session', JSON.stringify({ id: chatId, msgs: prev })); } catch {}
          return prev;
        });
      },
      onError: errorMsg => {
        setMessages(prev => {
          const priorUserKeys = new Set(
            prev.filter(m => m.role === "user").map(m => followUpKey(m.text)),
          );
          const followUps = buildThreeFollowUps([], priorUserKeys);
          return prev.map(m =>
            m.id === assistantId
              ? { ...m, text: m.text || errorMsg, loading: false, widgetPending: false, error: true, followUps }
              : m
          );
        });
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    });
  }, [isStreaming, chatId, refreshSessions]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    setChatId(newChatId());
  }, []);

  // Start a new chat and immediately send the first message — avoids chatId race condition
  const startNewChatAndSend = useCallback((text: string) => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    const id = newChatId();
    setChatId(id);

    const userMsgId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    setMessages([
      { id: userMsgId, role: "user", text, widgets: [], loading: false },
      { id: assistantId, role: "assistant", text: "", widgets: [], loading: true, widgetPending: true },
    ]);
    setIsStreaming(true);
    rawTextRef.current = "";
    followUpsSetRef.current = false;

    abortRef.current = streamChat({
      message: text,
      chatId: id,
      onTextDelta: delta => {
        rawTextRef.current += delta;
        const visible = stripJsonBlock(rawTextRef.current.replace(/<followups>[\s\S]*/i, "").trimEnd());
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, text: visible, loading: false, status: undefined } : m));
        if (!followUpsSetRef.current && rawTextRef.current.includes("</followups>")) {
          followUpsSetRef.current = true;
          const { followUps } = parseFollowUps(rawTextRef.current);
          if (followUps.length > 0) setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, followUps } : m));
        }
      },
      onActionPlan: (plan) => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, actionPlan: plan } : m));
      },
      onWidget: descriptor => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, widgets: [...m.widgets, descriptor], loading: false } : m));
      },
      onToolStart: ({ toolName }) => {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, loading: true, status: TOOL_STATUS[toolName] ?? "Thinking…" } : m));
      },
      onDone: (serverFollowUps?: string[], serverText?: string, serverWidgets?: WidgetDescriptor[], agentRunId?: string | null) => {
        const { text: cleanText } = parseFollowUps(rawTextRef.current);
        const finalText = (cleanText?.trim() || serverText?.trim() || "");
        const finalWidgets = serverWidgets && serverWidgets.length > 0 ? serverWidgets : undefined;
        const raw = (serverFollowUps && serverFollowUps.length > 0) ? serverFollowUps : parseFollowUps(rawTextRef.current).followUps;
        setMessages(prev => {
          const priorUserKeys = new Set(prev.filter(m => m.role === "user").map(m => followUpKey(m.text)));
          const followUps = buildThreeFollowUps(raw, priorUserKeys);
          return prev.map(m => m.id === assistantId ? {
            ...m,
            text: finalText,
            widgets: finalWidgets ?? m.widgets,
            loading: false,
            widgetPending: false,
            followUps,
            runId: agentRunId ?? undefined,
          } : m);
        });
        setIsStreaming(false);
        setTimeout(() => refreshSessions({ silent: true }), 500);
      },
      onError: errorMsg => {
        setMessages(prev => {
          const priorUserKeys = new Set(prev.filter(m => m.role === "user").map(m => followUpKey(m.text)));
          const followUps = buildThreeFollowUps([], priorUserKeys);
          return prev.map(m => m.id === assistantId ? { ...m, text: m.text || errorMsg, loading: false, widgetPending: false, error: true, followUps } : m);
        });
        setIsStreaming(false);
      },
    });
  }, [refreshSessions]);

  const loadSession = useCallback(async (sessionId: string) => {
    abortRef.current?.abort();
    setIsStreaming(false);
    const parts = sessionId.split(":");
    const id = parts.length >= 3 ? parts.slice(2).join(":") : sessionId;
    const entries = await fetchHistory(id).catch(() => [] as HistoryEntry[]);
    const msgs: ChatMessage[] = entries.map((e, i) => ({
      id: `h-${i}`,
      role: e.role,
      text: e.text,
      widgets: e.widgets,
      loading: false,
      followUps: [],
      ...(e.toolCalls && e.toolCalls.length > 0 ? { toolCalls: e.toolCalls } : {}),
    }));
    setMessages(msgs);
    setChatId(id);
    try { sessionStorage.setItem('cf_last_session', JSON.stringify({ id, msgs })); } catch {}
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    const parts = sessionId.split(":");
    const id = parts.length >= 3 ? parts.slice(2).join(":") : sessionId;
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
    try {
      await clearSession(id);
    } catch {
      refreshSessions({ silent: true });
      return;
    }
    refreshSessions({ silent: true });
    if (id === chatId || sessionId.endsWith(chatId)) startNewChat();
  }, [chatId, refreshSessions, startNewChat]);

  const clearHistory = useCallback(async () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    await clearSession(chatId);
    refreshSessions({ silent: true });
  }, [chatId, refreshSessions]);

  const markActionPlanExecuted = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, actionPlanExecuted: true } : m));
  }, []);

  return {
    messages,
    isStreaming,
    restoring,
    chatId,
    sessions,
    sessionsLoading,
    sendMessage,
    startNewChat,
    loadSession,
    deleteSession,
    clearHistory,
    refreshSessions,
    markActionPlanExecuted,
  };
}
