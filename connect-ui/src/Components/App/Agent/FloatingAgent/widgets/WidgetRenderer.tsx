import React, { useRef, useState } from "react";
import type { WidgetDescriptor, MetricCardsDescriptor, TimelineDescriptor, ActionButtonsDescriptor, TextBlockDescriptor, DataTableDescriptor, BarChartDescriptor, LineChartDescriptor, PieChartDescriptor } from "@cloudfuze/shared";
import WidgetWrapper from "./WidgetWrapper";
import StatCardWidget from "./StatCardWidget";
import BarChartWidget from "./BarChartWidget";
import LineChartWidget from "./LineChartWidget";
import PieChartWidget from "./PieChartWidget";
import DataTableWidget from "./DataTableWidget";
import { downloadChartAsPng } from "./chartDownload";
import { ActionConfirmWidget, ActionResultWidget } from "./ActionWidget";
import type { ActionPlan } from "../mouseAgent/types";
import { actionButtonItemToActionPlan, mouseUnsupportedActionMessage } from "../mouseAgent/actionButtonToPlan";

interface Props {
  descriptor: WidgetDescriptor;
  token: string;
  runId?: string | null;
  /** Start mouse-agent automation (no server-side CloudFuze REST calls). */
  onMousePlan?: (plan: ActionPlan) => void;
}

function getTitle(d: WidgetDescriptor): string {
  return "title" in d ? (d.title as string) : "Result";
}

// ── Inline widgets for new types ────────────────────────────────────────────

function MetricCardsWidget({ descriptor }: { descriptor: MetricCardsDescriptor }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(descriptor.cards.length, 3)}, 1fr)`, gap: 8 }}>
      {descriptor.cards.map((c, i) => (
        <div key={i} style={{ background: "#f8fafc", border: "1px solid #dbeafe", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: c.color ?? "#0f172a" }}>{c.value}</div>
          {c.delta && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{c.delta}</div>}
        </div>
      ))}
    </div>
  );
}

const riskColor: Record<string, string> = { low: "#93c5fd", medium: "#3b82f6", high: "#1e3a8a" };

function TimelineWidget({ descriptor }: { descriptor: TimelineDescriptor }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {descriptor.items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: i < descriptor.items.length - 1 ? "1px solid #e2e8f0" : "none" }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: riskColor[item.risk ?? "low"], flexShrink: 0, marginTop: 4 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{item.label}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{item.date}{item.value ? ` · ${item.value}` : ""}</div>
          </div>
          {item.risk && (
            <div style={{ fontSize: 10, fontWeight: 600, color: riskColor[item.risk], background: `${riskColor[item.risk]}18`, padding: "2px 8px", borderRadius: 10 }}>
              {item.risk.toUpperCase()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActionButtonsWidget({
  descriptor,
  onMousePlan,
}: {
  descriptor: ActionButtonsDescriptor;
  onMousePlan?: (plan: ActionPlan) => void;
}) {
  const styleMap: Record<string, React.CSSProperties> = {
    primary: { background: "#2563eb", color: "#fff" },
    danger:  { background: "#1e40af", color: "#fff" },
    default: { background: "#eff6ff", color: "#334155" }
  };
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function onButtonClick(item: ActionButtonsDescriptor["items"][number]) {
    const action = item.action?.trim();
    if (!action) {
      setFeedback({ kind: "err", text: "This button has no action configured." });
      return;
    }
    if (!onMousePlan) {
      setFeedback({ kind: "err", text: "Automation isn’t available here." });
      return;
    }
    setFeedback(null);
    const plan = actionButtonItemToActionPlan({
      label: item.label ?? "",
      action,
      payload: item.payload && typeof item.payload === "object" ? item.payload : undefined,
    });
    if (plan) {
      onMousePlan(plan);
      setFeedback({ kind: "ok", text: "Starting — follow the cursor in the app." });
      return;
    }
    setFeedback({ kind: "err", text: mouseUnsupportedActionMessage(action) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {descriptor.title && (
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{descriptor.title}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {descriptor.items.map((item, i) => (
          <button
            key={i}
            type="button"
            style={{
              ...styleMap[item.style ?? "default"],
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
            onClick={() => onButtonClick(item)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {feedback && (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            color: feedback.kind === "ok" ? "#15803d" : "#b91c1c",
            background: feedback.kind === "ok" ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${feedback.kind === "ok" ? "#bbf7d0" : "#fecaca"}`,
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}

function TextBlockWidget({ descriptor }: { descriptor: TextBlockDescriptor }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #dbeafe", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#334155", lineHeight: 1.6 }}>
      {descriptor.title && <div style={{ fontWeight: 600, marginBottom: 6, color: "#0f172a" }}>{descriptor.title}</div>}
      {descriptor.body}
    </div>
  );
}

// ── Main renderer ────────────────────────────────────────────────────────────

export default function WidgetRenderer({ descriptor, token, runId, onMousePlan }: Props) {
  if (descriptor.widgetType === "action_confirm") return <ActionConfirmWidget descriptor={descriptor} token={token} />;
  if (descriptor.widgetType === "action_result") return <ActionResultWidget descriptor={descriptor} />;
  if (descriptor.widgetType === "error") {
    return <div style={{ background: "#dbeafe", color: "#1e3a8a", borderRadius: 8, padding: "8px 12px", fontSize: 13, border: "1px solid #93c5fd" }}>{descriptor.message}</div>;
  }
  if (descriptor.widgetType === "stat_card")     return <StatCardWidget descriptor={descriptor} />;
  if (descriptor.widgetType === "metric_cards")  return <MetricCardsWidget descriptor={descriptor} />;
  if (descriptor.widgetType === "text_block")    return <TextBlockWidget descriptor={descriptor} />;
  if (descriptor.widgetType === "timeline") {
    return (
      <WidgetWrapper title={getTitle(descriptor)}>
        {() => <TimelineWidget descriptor={descriptor} />}
      </WidgetWrapper>
    );
  }
  if (descriptor.widgetType === "action_buttons") return <ActionButtonsWidget descriptor={descriptor} onMousePlan={onMousePlan} />;

  return <DownloadableWidget descriptor={descriptor} token={token} />;
}

function DownloadableWidget({ descriptor, token }: { descriptor: WidgetDescriptor; token: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const title = getTitle(descriptor);

  function onDownload() {
    if (descriptor.widgetType === "data_table") {
      const downloadKey = (descriptor as any).downloadKey as string | undefined;
      if (downloadKey) {
        // Stream full dataset from export endpoint (no row limit)
        const raw = token ?? localStorage.getItem("bToken") ?? "";
        const bearer = raw.startsWith("Bearer ") ? raw : raw ? `Bearer ${raw}` : "";
        fetch(`/api/agent/export?type=${encodeURIComponent(downloadKey)}`, {
          headers: { Authorization: bearer },
        })
          .then((r) => r.blob())
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${title.replace(/\s+/g, "_")}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          })
          .catch((err) => console.error("[download] export fetch failed", err));
        return;
      }
      // Fallback: build CSV from in-widget rows (filtered/lookup queries)
      const d = descriptor as DataTableDescriptor;
      const { columns, rows } = d.config;
      const header = columns.map((c) => `"${c.label}"`).join(",");
      const body = rows.map((row) =>
        columns.map((c) => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
      ).join("\n");
      const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${title.replace(/\s+/g, "_")}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else {
      downloadChartAsPng(chartRef, title, descriptor.widgetType === "pie_chart");
    }
  }

  return (
    <WidgetWrapper title={title} onDownload={onDownload}>
      {(expanded) => (
        <div ref={chartRef}>
          {(() => {
            switch (descriptor.widgetType) {
              case "bar_chart":  return <BarChartWidget  descriptor={descriptor as BarChartDescriptor}  expanded={expanded} />;
              case "line_chart": return <LineChartWidget descriptor={descriptor as LineChartDescriptor} expanded={expanded} />;
              case "pie_chart":  return <PieChartWidget  descriptor={descriptor as PieChartDescriptor}  expanded={expanded} />;
              case "data_table":
                return <DataTableWidget descriptor={descriptor as DataTableDescriptor} />;
              default: return null;
            }
          })()}
        </div>
      )}
    </WidgetWrapper>
  );
}
