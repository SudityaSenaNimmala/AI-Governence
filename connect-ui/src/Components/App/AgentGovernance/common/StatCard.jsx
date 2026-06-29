export function StatCard({ label, value, sub, icon }) {
  return (
    <div
      style={{
        background: "var(--ag-bg-card)",
        border: "1px solid var(--ag-border)",
        borderRadius: 12,
        padding: "16px 20px",
        flex: 1,
        minWidth: 160,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ag-text-primary)" }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", marginTop: 2 }}>{sub}</div>}
        </div>
        {icon && <div style={{ opacity: 0.5 }}>{icon}</div>}
      </div>
    </div>
  );
}
