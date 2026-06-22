export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
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
      {children}
    </div>
  );
}
