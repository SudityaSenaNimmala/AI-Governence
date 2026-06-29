export function Section({ title, children, style }) {
  return (
    <div style={{ marginBottom: 28, display: "flex", flexDirection: "column", ...style }}>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "var(--ag-text-primary)",
          marginBottom: 14,
          borderBottom: "2px solid var(--ag-accent)",
          paddingBottom: 6,
          display: "inline-block",
        }}
      >
        {title}
      </h3>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
