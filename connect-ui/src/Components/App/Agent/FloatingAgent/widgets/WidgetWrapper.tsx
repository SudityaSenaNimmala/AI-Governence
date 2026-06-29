import React from "react";

interface Props {
  title?: string;
  onDownload?: () => void;
  children: (expanded: boolean) => React.ReactNode;
}

export default function WidgetWrapper({ title, onDownload, children }: Props) {
  return (
    <div style={s.wrap}>
      {title && title !== "Result" && (
        <div style={s.header}>
          <span style={s.title}>{title}</span>
          {onDownload && (
            <button type="button" style={s.dlBtn} title="Download" onClick={onDownload}>
              ⬇ Download
            </button>
          )}
        </div>
      )}
      <div>{children(true)}</div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap:   { background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(30,64,175,.08)", overflow: "hidden" },
  header: { padding: "8px 12px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title:  { fontSize: 12, fontWeight: 600, color: "#334155", flex: "1 1 auto", minWidth: 0 },
  dlBtn:  { background: "none", border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer", color: "#374151", fontWeight: 500 },
};
