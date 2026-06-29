import React, { useState } from "react";
import type { ActionConfirmDescriptor, ActionResultDescriptor } from "@cloudfuze/shared";

interface ConfirmProps { descriptor: ActionConfirmDescriptor; token: string }
interface ResultProps { descriptor: ActionResultDescriptor }

export function ActionConfirmWidget({ descriptor, token }: ConfirmProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [resultMsg, setResultMsg] = useState("");

  async function confirm() {
    setStatus("loading");
    try {
      const resp = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: (() => { const t = localStorage.getItem('bToken') || ''; return t.startsWith('Bearer ') ? t : `Bearer ${t}`; })() },
        body: JSON.stringify({ actionId: descriptor.actionId, action: descriptor.action, payload: descriptor.payload })
      });
      const data = await resp.json() as { message?: string };
      setResultMsg(data.message ?? "Action completed.");
      setStatus("done");
    } catch {
      setResultMsg("Action failed. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return <div style={{ ...styles.box, borderLeft: "4px solid #2563eb" }}>{resultMsg}</div>;
  }
  if (status === "error") {
    return <div style={{ ...styles.box, borderLeft: "4px solid #1e3a8a" }}>{resultMsg}</div>;
  }

  return (
    <div style={styles.box}>
      <div style={styles.icon}>⚠️</div>
      <div style={styles.msg}>{descriptor.message}</div>
      <div style={styles.actions}>
        <button type="button" style={styles.cancelBtn} disabled={status === "loading"} onClick={() => setStatus("done")}>
          Cancel
        </button>
        <button type="button" style={styles.confirmBtn} disabled={status === "loading"} onClick={confirm}>
          {status === "loading" ? "Processing…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}

export function ActionResultWidget({ descriptor }: ResultProps) {
  return (
    <div style={{ ...styles.box, borderLeft: `4px solid ${descriptor.success ? "#2563eb" : "#1e3a8a"}` }}>
      <strong>{descriptor.success ? "Done" : "Failed"}:</strong> {descriptor.message}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  box: { background: "#fff", borderRadius: 8, padding: "14px 16px", boxShadow: "0 1px 3px rgba(30,64,175,.08)" },
  icon: { fontSize: 20, marginBottom: 6 },
  msg: { fontSize: 14, color: "#334155", marginBottom: 14 },
  actions: { display: "flex", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "6px 16px", cursor: "pointer", fontSize: 13, color: "#334155" },
  confirmBtn: { background: "#1e40af", color: "#fff", border: "none", borderRadius: 6, padding: "6px 16px", cursor: "pointer", fontSize: 13, fontWeight: 500 }
};
