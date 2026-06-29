export function LoadingSpinner({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60 }}>
      <div
        style={{
          width: 40,
          height: 40,
          border: "3px solid var(--ag-border)",
          borderTop: "3px solid var(--ag-accent)",
          borderRadius: "50%",
          animation: "agSpin 1s linear infinite",
        }}
      />
      {message && (
        <div style={{ marginTop: 16, color: "var(--ag-text-secondary)", fontSize: 13 }}>{message}</div>
      )}
    </div>
  );
}
