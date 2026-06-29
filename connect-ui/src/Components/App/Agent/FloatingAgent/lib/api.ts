import type { WidgetDescriptor } from "@cloudfuze/shared";
import type { ActionPlan } from "../mouseAgent/types";

// Points to agent-backend (port 4001, proxied via vite)
let BASE = "/api/agent";

if (
  window.location.host?.includes("blogs") ||
  window.location.host?.includes("sacontain")
) {
  BASE = `https://cloudfuzehost.com/api/agent`;
} else {
  BASE = `${window.location.origin}/api/agent`;
}

function resolveBearer(): string {
  const t = localStorage.getItem("bToken") || "";
  if (!t) return "";
  return t.startsWith("Bearer ") ? t : `Bearer ${t}`;
}

function stripJsonBlock(raw: string): string {
  const complete = raw.match(/```json[\s\S]*?```/);
  if (complete) return raw.slice(0, complete.index).trim();
  const partial = raw.indexOf("```json");
  if (partial !== -1) return raw.slice(0, partial).trim();
  return raw.trim();
}

// ── Widget transformer: agent-backend format → shared WidgetDescriptor ───────

function transformWidget(w: any): WidgetDescriptor {
  switch (w.type) {
    case "table": {
      const rawCols: any[] = w.columns ?? [];
      const cols = rawCols.map((c: any) =>
        typeof c === "string"
          ? {
              key: c,
              label: c
                .replace(/_/g, " ")
                .replace(/\b\w/g, (l: string) => l.toUpperCase()),
            }
          : c,
      );
      const rows: Record<string, unknown>[] = w.rows ?? [];
      const descriptor: any = {
        widgetType: "data_table",
        title: w.title ?? "Data",
        config: {
          columns: cols,
          rows,
          totalCount: w.total_count ?? rows.length,
        },
      };
      if (w.download_key) descriptor.downloadKey = w.download_key;
      return descriptor as WidgetDescriptor;
    }

    case "metric_cards":
      return {
        widgetType: "metric_cards",
        cards: w.cards ?? [],
      } as WidgetDescriptor;

    case "bar_chart":
      return {
        widgetType: "bar_chart",
        title: w.title ?? "Chart",
        config: {
          categories: (w.data ?? []).map((d: any) => d.name ?? d.label ?? ""),
          series: [
            {
              name: w.seriesName ?? w.title ?? "",
              data: (w.data ?? []).map((d: any) => d.value ?? 0),
            },
          ],
        },
      } as WidgetDescriptor;

    case "donut_chart":
    case "pie_chart":
      return {
        widgetType: "pie_chart",
        title: w.title ?? "Chart",
        config: {
          data: (w.data ?? w.slices ?? []).map((d: any) => ({
            name: d.name ?? d.label ?? "",
            value: Number(d.value ?? 0),
          })),
        },
      } as WidgetDescriptor;

    case "timeline":
      return {
        widgetType: "timeline",
        title: w.title ?? "Timeline",
        items: (w.items ?? []).map((item: any) => ({
          date: item.date ?? "",
          label: item.title ?? item.label ?? "",
          value: item.value ?? item.desc ?? item.description ?? undefined,
          risk: item.risk ?? item.risk_level ?? undefined,
        })),
      } as WidgetDescriptor;

    case "action_buttons":
      return {
        widgetType: "action_buttons",
        title: w.title,
        items: (w.items ?? []).map((item: any) => ({
          label: item.label ?? "",
          action: item.action ?? item.id ?? "",
          payload: item.payload ?? undefined,
          style: item.style ?? "default",
        })),
      } as WidgetDescriptor;

    case "text_block":
      return {
        widgetType: "text_block",
        body: w.content ?? "",
      } as WidgetDescriptor;

    default:
      return {
        widgetType: "text_block",
        body: typeof w === "string" ? w : JSON.stringify(w),
      } as WidgetDescriptor;
  }
}

// ── streamChat — calls POST /api/agent/query, handles SSE or JSON response ────

interface StreamChatOptions {
  message: string;
  chatId?: string;
  onTextDelta: (delta: string) => void;
  onWidget: (descriptor: WidgetDescriptor) => void;
  onToolStart?: (data: { toolName: string; toolUseId: string }) => void;
  onToolDone?: (data: {
    toolName: string;
    toolUseId: string;
    rowCount: number;
    durationMs: number;
  }) => void;
  onToolError?: (data: {
    toolName: string;
    toolUseId: string;
    error: string;
  }) => void;
  /** Final widgets from the server; last arg is agent run id (audit / history). */
  onDone: (
    followUps?: string[],
    serverText?: string,
    serverWidgets?: WidgetDescriptor[],
    runId?: string | null,
  ) => void;
  onError: (message: string) => void;
  onActionPlan?: (plan: ActionPlan) => void;
}

export function streamChat(opts: StreamChatOptions): AbortController {
  const controller = new AbortController();
  void (async () => {
    try {
      const cfToken = localStorage.getItem("bToken") || "";
      const resp = await fetch(`${BASE}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: resolveBearer(),
        },
        body: JSON.stringify({
          question: opts.message,
          session_id: opts.chatId,
          cf_token: cfToken,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const status = resp.status;
        const ct = resp.headers.get("content-type") ?? "";
        let message = `HTTP ${status}`;
        try {
          if (ct.includes("application/json")) {
            const err = (await resp.json()) as { error?: string };
            message = err.error ?? message;
          } else {
            const text = (await resp.text()).trim();
            if (text)
              message = text.length > 280 ? `${text.slice(0, 280)}…` : text;
          }
        } catch {
          /* keep message */
        }
        if (
          status === 502 ||
          status === 503 ||
          status === 504 ||
          message.includes("public base URL")
        ) {
          message =
            "Cannot reach agent-backend. Please start it: cd agent-backend && npm run dev";
        }
        opts.onError(message);
        return;
      }

      const contentType = resp.headers.get("content-type") ?? "";

      // ── SSE path (in-scope queries) ────────────────────────────────────────
      if (contentType.includes("text/event-stream")) {
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        let doneReceived = false;

        function handleSseBlock(block: string) {
          let evt = "";
          const dataParts: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) evt = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataParts.push(line.slice(6));
          }
          const dataStr = dataParts.join("\n");
          if (!dataStr) return;

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch (e) {
            console.error("[api] SSE JSON parse error for event:", evt, e);
            // If the done event failed to parse, still unblock the UI with whatever text we have
            if (evt === "done") {
              doneReceived = true;
              opts.onDone([], undefined, [], null);
            }
            return;
          }

          if (evt === "tool_start") {
            opts.onToolStart?.({
              toolName: parsed.toolName,
              toolUseId: parsed.toolUseId,
            });
          } else if (evt === "tool_done") {
            opts.onToolDone?.({
              toolName: parsed.toolName,
              toolUseId: parsed.toolUseId,
              rowCount: parsed.rowCount ?? 0,
              durationMs: parsed.durationMs ?? 0,
            });
          } else if (evt === "tool_error") {
            opts.onToolError?.({
              toolName: parsed.toolName,
              toolUseId: parsed.toolUseId,
              error: parsed.error ?? "Tool failed",
            });
          } else if (evt === "action_plan") {
            opts.onActionPlan?.(parsed);
          } else if (evt === "text_delta") {
            opts.onTextDelta(parsed.text ?? "");
          } else if (evt === "done") {
            doneReceived = true;
            console.log(
              "[api] done event — text:",
              (parsed.text ?? "").slice(0, 80),
              "| widgets:",
              (parsed.widgets ?? []).map((w: any) => w?.type ?? w?.widgetType),
            );
            const serverWidgets = (parsed.widgets ?? []).flatMap((w: any) => {
              try {
                return [transformWidget(w)];
              } catch {
                return [];
              }
            });
            opts.onDone(
              parsed.follow_up ?? [],
              parsed.text ?? "",
              serverWidgets,
              parsed.run_id ?? null,
            );
          } else if (evt === "error") {
            doneReceived = true;
            opts.onError(parsed.message ?? "Agent error");
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (value) buf += decoder.decode(value, { stream: true });

          let boundary: number;
          while ((boundary = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, boundary);
            buf = buf.slice(boundary + 2);
            handleSseBlock(block);
          }

          if (done) break;
        }

        // Trailing event may not end with \n\n (e.g. connection close right after payload)
        const tail = buf.trim();
        if (tail) handleSseBlock(tail);

        // If stream ended without a done/error event (backend crash mid-flight), unblock the UI
        if (!doneReceived) {
          console.warn("[api] Stream ended without done event — unblocking UI");
          opts.onDone([], undefined, [], null);
        }

        return;
      }

      // ── JSON path (out-of-scope guardrail responses) ───────────────────────
      const data = (await resp.json()) as {
        text?: string;
        widgets?: any[];
        follow_up?: string[];
        session_id?: string;
        run_id?: string | null;
      };
      if (data.text) opts.onTextDelta(data.text);
      const serverWidgets = (data.widgets ?? []).map((w: any) =>
        transformWidget(w),
      );
      opts.onDone(
        data.follow_up ?? [],
        data.text ?? "",
        serverWidgets,
        data.run_id ?? null,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        const hint =
          err.message === "Failed to fetch"
            ? "Cannot reach API — start agent-backend (npm run dev in agent-backend/)."
            : err.message;
        opts.onError(hint);
      }
    }
  })();
  return controller;
}

export async function clearSession(chatId?: string): Promise<void> {
  if (!chatId) return;
  const resp = await fetch(`${BASE}/history/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    headers: { Authorization: resolveBearer() },
  });
  if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
}

export interface HistoryToolCall {
  toolName: string;
  toolUseId: string;
  status: "done";
}

export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
  widgets: WidgetDescriptor[];
  toolCalls?: HistoryToolCall[];
}

/** Extract tool calls from stored OpenAI messages array (assistant messages with tool_calls) */
function parseToolCallsFromMessages(storedMsgs: any[]): HistoryToolCall[] {
  const calls: HistoryToolCall[] = [];
  for (const msg of storedMsgs) {
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.type === "function" && tc.function?.name) {
          calls.push({
            toolName: tc.function.name,
            toolUseId: tc.id ?? tc.function.name,
            status: "done",
          });
        }
      }
    }
  }
  return calls;
}

export async function fetchHistory(chatId?: string): Promise<HistoryEntry[]> {
  try {
    const url = chatId
      ? `${BASE}/history?session_id=${encodeURIComponent(chatId)}`
      : `${BASE}/history`;
    const resp = await fetch(url, {
      headers: { Authorization: resolveBearer() },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { runs?: any[] };
    const entries: HistoryEntry[] = [];
    for (const run of data.runs ?? []) {
      if (run.question) {
        entries.push({ role: "user", text: run.question, widgets: [] });
      }
      const storedMsgs: any[] = Array.isArray(run.messages) ? run.messages : [];
      const lastAssistant = [...storedMsgs]
        .reverse()
        .find(
          (m: any) =>
            m.role === "assistant" &&
            m.content &&
            typeof m.content === "string" &&
            m.content.trim(),
        );
      const rawText = lastAssistant?.content ?? "";
      const cleanText = stripJsonBlock(rawText);
      const widgets = (run.widgets ?? []).map((w: any) => transformWidget(w));
      const toolCalls = parseToolCallsFromMessages(storedMsgs);
      entries.push({
        role: "assistant",
        text: cleanText,
        widgets,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
    }
    return entries;
  } catch {
    return [];
  }
}

export interface ChatSession {
  sessionId: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export async function fetchSessions(): Promise<ChatSession[]> {
  try {
    const resp = await fetch(`${BASE}/history?limit=20`, {
      headers: { Authorization: resolveBearer() },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { runs?: any[] };
    const seen = new Set<string>();
    return (data.runs ?? [])
      .reduce<ChatSession[]>((acc, run: any) => {
        const sid = run.session_id ?? run.id;
        if (seen.has(sid)) return acc;
        seen.add(sid);
        acc.push({
          sessionId: sid,
          title: (run.question ?? "Chat").slice(0, 60),
          updatedAt: run.created_at ?? new Date().toISOString(),
          messageCount: 1,
        });
        return acc;
      }, [])
      .slice(0, 20);
  } catch {
    return [];
  }
}

export interface WorkflowTemplate {
  id: string;
  templetName?: string;
  conditionValue?: string;
  mandatoryApplications?: any[];
  workFlowApplications?: any[];
  [key: string]: any;
}

export async function fetchTemplates(
  role?: string,
): Promise<{ matched: WorkflowTemplate[]; all: WorkflowTemplate[] }> {
  try {
    const params = new URLSearchParams();
    if (role) params.append("role", role);
    const resp = await fetch(`${BASE}/templates?${params.toString()}`, {
      headers: { Authorization: resolveBearer() },
    });
    if (!resp.ok) return { matched: [], all: [] };
    const data = (await resp.json()) as { matched?: any[]; all?: any[] };
    return {
      matched: data.matched ?? [],
      all: data.all ?? [],
    };
  } catch (err) {
    console.error("[api] fetchTemplates error:", err);
    return { matched: [], all: [] };
  }
}
