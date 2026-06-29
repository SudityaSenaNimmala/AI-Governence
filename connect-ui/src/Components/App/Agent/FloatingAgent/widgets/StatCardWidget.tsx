import React from "react";
import type { StatCardDescriptor } from "@cloudfuze/shared";

interface Props { descriptor: StatCardDescriptor }

export default function StatCardWidget({ descriptor }: Props) {
  const { title, data } = descriptor;

  const d = data as Record<string, unknown>;

  if (typeof d.totalUsers === "number") {
    return (
      <div style={styles.grid}>
        <Card label="Total Users" value={d.totalUsers} color="#1e3a8a" />
        <Card label="Active" value={d.activeUsers as number} color="#2563eb" />
        <Card label="New" value={d.newUsers as number} color="#3b82f6" />
        <Card label="Deactivated" value={d.deactivatedUsers as number} color="#60a5fa" />
      </div>
    );
  }

  if (typeof d.score === "number") {
    const riskColors: Record<string, string> = { low: "#93c5fd", medium: "#3b82f6", high: "#1e40af", critical: "#1e3a8a" };
    const color = riskColors[String(d.riskLevel)] ?? "#2563eb";
    return (
      <div style={styles.grid}>
        <Card label="Score" value={`${d.score}%`} color={color} />
        <Card label="Passed" value={d.passedControls as number} color="#2563eb" />
        <Card label="Failed" value={d.failedControls as number} color="#60a5fa" />
        <Card label="Risk" value={String(d.riskLevel).toUpperCase()} color={color} />
      </div>
    );
  }

  if (typeof d.annualSpend === "string" || typeof d.totalSpend === "string") {
    const annual   = (d.annualSpend  ?? d.totalSpend) as string;
    const monthly  = d.monthlySpend as string | undefined;
    const savings  = d.potentialSavings as string | undefined;
    const byApp    = d.byApp as Array<{ app: string; spend: string }> | undefined;
    return (
      <div style={styles.box}>
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={styles.big}>{annual}</div>
            <div style={styles.sub}>Annual Spend</div>
          </div>
          {monthly && (
            <div style={{ flex: 1 }}>
              <div style={{ ...styles.big, fontSize: 22, color: "#2563eb" }}>{monthly}</div>
              <div style={styles.sub}>Monthly (÷12)</div>
            </div>
          )}
          {savings && savings !== "—" && (
            <div style={{ flex: 1 }}>
              <div style={{ ...styles.big, fontSize: 22, color: "#16a34a" }}>{savings}</div>
              <div style={styles.sub}>Potential Savings</div>
            </div>
          )}
        </div>
        {byApp && byApp.length > 0 && (
          <div style={styles.breakdown}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", marginBottom: 4 }}>BY APP</div>
            {byApp.map((row) => (
              <div key={row.app} style={styles.row}>
                <span>{row.app}</span>
                <span style={{ fontWeight: 600 }}>{row.spend}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.box}>
      <div style={styles.title}>{title}</div>
      {Object.entries(d).map(([k, v]) => (
        <div key={k} style={styles.row}>
          <span style={{ textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
          <span style={{ fontWeight: 600 }}>{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{label}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 },
  card: { background: "#fff", borderRadius: 8, padding: "14px 16px", boxShadow: "0 1px 3px rgba(30,64,175,.08)" },
  box: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 3px rgba(30,64,175,.08)" },
  title: { fontWeight: 600, marginBottom: 10, color: "#0f172a" },
  big: { fontSize: 30, fontWeight: 700, color: "#1e40af" },
  sub: { fontSize: 12, color: "#64748b", marginBottom: 10 },
  breakdown: { borderTop: "1px solid #dbeafe", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 },
  row: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#334155" }
};
