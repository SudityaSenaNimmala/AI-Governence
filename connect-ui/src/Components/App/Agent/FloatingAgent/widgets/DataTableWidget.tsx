import React, { useState } from "react";
import type { DataTableDescriptor } from "@cloudfuze/shared";

interface Props { descriptor: DataTableDescriptor }

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  const str = String(value);
  if (/sign.?in|sign.?on|login|last.?active|created|updated|date|time/i.test(key)) {
    if (!str) return 'Never';
    const d = new Date(str);
    if (isNaN(d.getTime()) || d.getTime() <= 0) return 'Never';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return str || '—';
}

const PAGE_SIZE = 10;
const LARGE_THRESHOLD = 100;

export default function DataTableWidget({ descriptor }: Props) {
  const { config } = descriptor;
  const { columns, rows, totalCount } = config;
  const [page, setPage] = useState(0);

  const isLarge = rows.length > LARGE_THRESHOLD;

  // Large datasets: always show only first 10, no pagination
  // Normal datasets: paginate at 10/page
  const visibleRows = isLarge ? rows.slice(0, PAGE_SIZE) : rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages  = isLarge ? 1 : Math.ceil(rows.length / PAGE_SIZE);

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={s.th}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr key={i} style={i % 2 === 0 ? s.even : s.odd}>
                {columns.map((col) => (
                  <td key={col.key} style={s.td}>
                    {col.key === "action"
                      ? <button style={s.actionBtn}>{String(row[col.key] ?? "")}</button>
                      : formatCell(col.key, row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={s.footer}>
        <span style={s.count}>{totalCount ?? rows.length} total</span>
        {!isLarge && totalPages > 1 && (
          <div style={s.pages}>
            <button style={s.pageBtn} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
            <span style={{ fontSize: 11, color: "#6b7280" }}>{page + 1} / {totalPages}</span>
            <button style={s.pageBtn} disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
          </div>
        )}
      </div>

      {isLarge && (
        <div style={s.note}>
          Showing first 10 of {rows.length} records. Download the CSV above for the complete list.
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  table:     { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th:        { textAlign: "left", padding: "6px 10px", background: "#f9fafb", color: "#6b7280", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" },
  td:        { padding: "6px 10px", color: "#374151", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" },
  even:      { background: "#fff" },
  odd:       { background: "#fafafa" },
  actionBtn: { background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" },
  footer:    { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", borderTop: "1px solid #f3f4f6" },
  count:     { fontSize: 11, color: "#9ca3af" },
  pages:     { display: "flex", alignItems: "center", gap: 6 },
  pageBtn:   { background: "none", border: "1px solid #e5e7eb", borderRadius: 4, padding: "1px 8px", fontSize: 12, cursor: "pointer", color: "#374151" },
  note:      { fontSize: 11, color: "#6b7280", background: "#f8fafc", borderTop: "1px solid #e2e8f0", padding: "6px 10px", textAlign: "center" as const },
};
