export function Badge({ text, color }) {
  return (
    <span
      style={{
        background: color + "22",
        color,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 99,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export const riskColor = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#22c55e",
  informational: "#6b7280",
};

export const statusColor = {
  sanctioned: "#22c55e",
  under_review: "#f59e0b",
  shadow: "#ef4444",
  blocked: "#6b7280",
  active: "#22c55e",
  pending_approval: "#6366f1",
  due_for_renewal: "#f59e0b",
  stale: "#f59e0b",
  suspended: "#ef4444",
  retired: "#6b7280",
};

export const statusLabel = {
  sanctioned: "Sanctioned",
  under_review: "Under Review",
  shadow: "Shadow AI",
  blocked: "Blocked",
  active: "Active",
  pending_approval: "Discovered",
  due_for_renewal: "Renewal Due",
  stale: "Stale",
  suspended: "Suspended",
  retired: "Retired",
};
