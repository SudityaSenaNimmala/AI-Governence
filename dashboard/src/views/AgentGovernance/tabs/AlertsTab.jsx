import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell, BellOff, CheckCircle2, AlertTriangle, Clock, Settings2,
  RefreshCw, CheckCheck, Filter, Cloud, Shield, XCircle, Bot
} from "lucide-react";
import { useGovernance, getScopedAgents } from "../AgentGovernanceContext";
import { useAgentAuth } from "../AgentGovernanceContext";
import { agentGovernanceApi } from "../AgentGovernanceActions/AgentGovernanceActions";
import { Section } from "../common/Section";
import { StatCard } from "../common/StatCard";
import { Badge } from "../common/Badge";
import { LoadingSpinner } from "../common/LoadingSpinner";

const SEVERITY_CONFIG = {
  critical: { color: "#ef4444", bg: "#fef2f2", border: "#fecaca", label: "Critical" },
  high: { color: "#f59e0b", bg: "#fffbeb", border: "#fde68a", label: "High" },
  medium: { color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe", label: "Medium" },
  low: { color: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0", label: "Low" },
};

const VENDOR_CONFIG = {
  Microsoft: { color: "#0078D4", icon: <Shield size={14} />, label: "Microsoft 365" },
  Google: { color: "#4285F4", icon: <Cloud size={14} />, label: "Google Cloud" },
  OpenAI: { color: "#10a37f", icon: <Bot size={14} />, label: "ChatGPT / OpenAI" },
  "Claude / Anthropic": { color: "#D4622A", icon: <Bot size={14} />, label: "Claude / Anthropic" },
  "Gemini Enterprise": { color: "#886FBF", icon: <Bot size={14} />, label: "Gemini Enterprise" },
  Unknown: { color: "#6b7280", icon: <AlertTriangle size={14} />, label: "Unknown" },
};

function formatIdleTime(minutes) {
  if (!minutes) return "No activity recorded";
  const days = Math.floor(minutes / 1440);
  if (days > 0) return `${days} day${days !== 1 ? "s" : ""} idle`;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m idle`;
  return `${minutes}m idle`;
}

function AlertCard({ alert, onResolve }) {
  const sev = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.low;
  const vendor = VENDOR_CONFIG[alert.vendor] || VENDOR_CONFIG.Unknown;

  return (
    <div className="ag_alert_card" style={{ borderLeft: `3px solid ${sev.color}`, background: sev.bg, border: `1px solid ${sev.border}`, borderLeftWidth: 3, borderLeftColor: sev.color }}>
      <div className="ag_alert_card_header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${vendor.color}15`, display: "flex",
            alignItems: "center", justifyContent: "center", color: vendor.color,
          }}>
            {vendor.icon}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ag-text-primary)" }}>
              {alert.agent_name}
            </div>
            <div style={{ fontSize: 11, color: "var(--ag-text-secondary)", display: "flex", gap: 8, marginTop: 1 }}>
              <span style={{ color: vendor.color, fontWeight: 500 }}>{vendor.label}</span>
              <span>{alert.platform?.replace(/_/g, " ")}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge text={sev.label} color={sev.color} />
          <Badge text={formatIdleTime(alert.idle_minutes)} color={sev.color} />
          {!alert.resolved && (
            <button
              onClick={() => onResolve(alert)}
              className="ag_alert_resolve_btn"
              title="Dismiss alert"
            >
              <CheckCircle2 size={14} />
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--ag-text-secondary)", marginTop: 6 }}>
        {alert.message}
      </div>
      <div style={{ fontSize: 10, color: "var(--ag-text-secondary)", marginTop: 6, display: "flex", gap: 12 }}>
        <span>
          <Clock size={10} style={{ marginRight: 3, verticalAlign: "middle" }} />
          {alert.last_active ? `Last active: ${new Date(alert.last_active).toLocaleString()}` : "No activity recorded"}
        </span>
        {alert.created_at && (
          <span>Alert triggered: {new Date(alert.created_at).toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}

function AlertSettings({ config, onSave, onClose }) {
  const [thresholdDays, setThresholdDays] = useState(Math.round((config.idle_threshold_minutes || 43200) / 1440));
  const [enabled, setEnabled] = useState(config.enabled !== false);
  const [notifyMicrosoft, setNotifyMicrosoft] = useState(config.notify_microsoft !== false);
  const [notifyGoogle, setNotifyGoogle] = useState(config.notify_google !== false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        idle_threshold_minutes: thresholdDays * 1440,
        enabled,
        notify_microsoft: notifyMicrosoft,
        notify_google: notifyGoogle,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ag_modal_overlay" onClick={onClose}>
      <div className="ag_modal_content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="ag_modal_header">
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <Settings2 size={18} color="#6366f1" /> Stale Agent Settings
            </h2>
            <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0 0" }}>
              Configure stale agent detection thresholds and notification preferences
            </p>
          </div>
          <button onClick={onClose} className="ag_modal_close">&times;</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="ag_alert_setting_row">
            <label className="ag_alert_setting_label">
              <Bell size={14} /> Stale Agent Monitoring
            </label>
            <button
              onClick={() => setEnabled(!enabled)}
              className="ag_alert_toggle"
              style={{ background: enabled ? "#22c55e" : "#e5e7eb" }}
            >
              <span className="ag_alert_toggle_knob" style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }} />
            </button>
          </div>

          <div className="ag_alert_setting_row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <label className="ag_alert_setting_label">
              <Clock size={14} /> Idle Threshold (days)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
              <input
                type="range" min={1} max={180} value={thresholdDays}
                onChange={(e) => setThresholdDays(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#6366f1" }}
              />
              <div style={{
                minWidth: 50, textAlign: "center", fontWeight: 700, fontSize: 16,
                color: "#6366f1", background: "#6366f112", padding: "4px 10px", borderRadius: 6,
              }}>
                {thresholdDays}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              Mark agent as stale when idle for {thresholdDays} day{thresholdDays !== 1 ? "s" : ""}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--ag-border)", paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 10 }}>
              Platform Notifications
            </div>
            <div className="ag_alert_setting_row">
              <label className="ag_alert_setting_label" style={{ gap: 6 }}>
                <Shield size={14} color="#0078D4" /> Microsoft 365 Agents
              </label>
              <button
                onClick={() => setNotifyMicrosoft(!notifyMicrosoft)}
                className="ag_alert_toggle"
                style={{ background: notifyMicrosoft ? "#0078D4" : "#e5e7eb" }}
              >
                <span className="ag_alert_toggle_knob" style={{ transform: notifyMicrosoft ? "translateX(18px)" : "translateX(2px)" }} />
              </button>
            </div>
            <div className="ag_alert_setting_row" style={{ marginTop: 8 }}>
              <label className="ag_alert_setting_label" style={{ gap: 6 }}>
                <Cloud size={14} color="#4285F4" /> Google Cloud Agents
              </label>
              <button
                onClick={() => setNotifyGoogle(!notifyGoogle)}
                className="ag_alert_toggle"
                style={{ background: notifyGoogle ? "#4285F4" : "#e5e7eb" }}
              >
                <span className="ag_alert_toggle_knob" style={{ transform: notifyGoogle ? "translateX(18px)" : "translateX(2px)" }} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button onClick={handleSave} disabled={saving} className="ag_btn_primary" style={{ flex: 1, justifyContent: "center" }}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
          <button onClick={onClose} className="ag_btn_secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function AlertsTab({ isActive = true }) {
  const { state } = useGovernance();
  const { isAuthenticated, googleKeyId, openaiKeyId, claudeKeyId, geminiEnterpriseKeyId } = useAgentAuth();
  const result = state.discoveryResult;

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [vendorFilter, setVendorFilter] = useState("all");
  const [showSettings, setShowSettings] = useState(false);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);
  const [lastChecked, setLastChecked] = useState(null);
  const [alertConfig, setAlertConfig] = useState({
    idle_threshold_minutes: 43200,
    enabled: true,
    notify_microsoft: true,
    notify_google: true,
  });
  const intervalRef = useRef(null);
  const notifiedRef = useRef(new Set());

  const requestNotificationPermission = useCallback(async () => {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }, []);

  const sendBrowserNotification = useCallback((title, body, vendor) => {
    if ("Notification" in window && Notification.permission === "granted") {
      const icon = vendor === "Google"
        ? "https://www.google.com/favicon.ico"
        : "https://www.microsoft.com/favicon.ico";
      new Notification(title, { body, icon, tag: `ag-idle-${Date.now()}` });
    }
  }, []);

  const checkAgents = useCallback(async () => {
    if (!result?.agents || result.agents.length === 0) return;

    setChecking(true);
    try {
      let agentsToCheck = [...result.agents];

      if (!alertConfig.notify_microsoft) {
        agentsToCheck = agentsToCheck.filter((a) => a.vendor !== "Microsoft");
      }
      if (!alertConfig.notify_google) {
        agentsToCheck = agentsToCheck.filter((a) => a.vendor !== "Google");
      }

      const response = await agentGovernanceApi.checkAlerts(
        agentsToCheck,
        alertConfig.idle_threshold_minutes
      );

      if (response.alerts) {
        setAlerts(response.alerts);

        for (const alert of response.alerts) {
          const alertKey = `${alert.agent_id}-${alert.idle_minutes}`;
          if (!notifiedRef.current.has(alertKey)) {
            notifiedRef.current.add(alertKey);
            const vendorLabel = alert.vendor === "Google" ? "Google Cloud" : "Microsoft 365";
            sendBrowserNotification(
              `Stale Agent — ${vendorLabel}`,
              alert.message,
              alert.vendor
            );
          }
        }
      }

      setLastChecked(new Date());
    } catch (err) {
      console.error("Alert check failed:", err);
      computeAlertsLocally();
    } finally {
      setChecking(false);
    }
  }, [result, alertConfig, sendBrowserNotification]);

  const computeAlertsLocally = useCallback(() => {
    if (!result?.agents) return;

    const now = Date.now();
    const thresholdMs = alertConfig.idle_threshold_minutes * 60 * 1000;
    const localAlerts = [];

    for (const agent of result.agents) {
      if (!alertConfig.notify_microsoft && agent.vendor === "Microsoft") continue;
      if (!alertConfig.notify_google && agent.vendor === "Google") continue;

      const lastActive = agent.activity?.lastActiveTimestamp
        ? new Date(agent.activity.lastActiveTimestamp).getTime()
        : agent.lastModified
          ? new Date(agent.lastModified).getTime()
          : null;

      const isIdle = !lastActive || (now - lastActive) > thresholdMs;

      if (isIdle) {
        const idleMinutes = lastActive ? Math.round((now - lastActive) / 60000) : null;
        const idleDays = idleMinutes ? Math.floor(idleMinutes / 1440) : null;
        localAlerts.push({
          id: `local-${agent.id}`,
          agent_id: agent.id,
          agent_name: agent.name,
          vendor: agent.vendor || "Unknown",
          platform: agent.platform || "unknown",
          alert_type: "idle_agent",
          idle_minutes: idleMinutes,
          last_active: lastActive ? new Date(lastActive).toISOString() : null,
          message: idleDays
            ? `${agent.name} has been idle for ${idleDays} day(s)`
            : `${agent.name} has no recorded activity`,
          severity: idleDays && idleDays > 90 ? "high" : idleDays && idleDays > 60 ? "medium" : "low",
          resolved: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    setAlerts(localAlerts);
    setLastChecked(new Date());
  }, [result, alertConfig]);

  // Load config on mount
  useEffect(() => {
    agentGovernanceApi.getAlertConfig()
      .then(setAlertConfig)
      .catch(() => {});
    requestNotificationPermission();
  }, [requestNotificationPermission]);

  // Instantly compute stale agents from discovery data (no API call needed)
  useEffect(() => {
    if (!result?.agents) return;
    computeAlertsLocally();
  }, [result, computeAlertsLocally]);

  // Poll on interval only when tab is visible
  useEffect(() => {
    if (!isActive || !autoCheckEnabled || !alertConfig.enabled || !result?.agents) return;

    intervalRef.current = setInterval(checkAgents, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, autoCheckEnabled, alertConfig.enabled, result, checkAgents]);

  const handleResolve = async (alert) => {
    if (alert.id && !alert.id.startsWith("local-")) {
      try {
        await agentGovernanceApi.resolveAlert(alert.id);
      } catch {}
    }
    setAlerts((prev) => prev.filter((a) => a.agent_id !== alert.agent_id));
  };

  const handleResolveAll = async () => {
    try {
      await agentGovernanceApi.resolveAllAlerts();
    } catch {}
    setAlerts([]);
    notifiedRef.current.clear();
  };

  const handleSaveConfig = async (newConfig) => {
    try {
      await agentGovernanceApi.updateAlertConfig(newConfig);
    } catch {}
    setAlertConfig(newConfig);
    notifiedRef.current.clear();
  };

  // Filter alerts
  const filteredAlerts = vendorFilter === "all"
    ? alerts
    : alerts.filter((a) => a.vendor === vendorFilter);

  const microsoftAlerts = alerts.filter((a) => a.vendor === "Microsoft");
  const googleAlerts = alerts.filter((a) => a.vendor === "Google");
  const openaiAlerts = alerts.filter((a) => a.vendor === "OpenAI");
  const claudeAlerts = alerts.filter((a) => a.vendor === "Claude / Anthropic");
  const geminiAlerts = alerts.filter((a) => a.vendor === "Gemini Enterprise");

  if (!result) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--ag-text-secondary)" }}>
        <Bell size={48} style={{ marginBottom: 16, opacity: 0.3 }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ag-text-primary)", marginBottom: 8 }}>
          No scan data yet
        </h3>
        <p style={{ fontSize: 13 }}>
          Run a discovery scan first to detect stale agents across your tenant.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* KPI Cards */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div style={{ flex: "0 1 calc(25% - 9px)", minWidth: 160 }}>
          <StatCard
            label="Total Stale"
            value={alerts.length}
            color={alerts.length > 0 ? "#ef4444" : "#22c55e"}
            sub={`${Math.round(alertConfig.idle_threshold_minutes / 1440)} day threshold`}
            icon={<Bell size={20} />}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="ag_alerts_controls">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={checkAgents}
            disabled={checking}
            className="ag_btn_primary"
          >
            <RefreshCw size={13} style={checking ? { animation: "agSpin 1s linear infinite" } : undefined} />
            {checking ? "Checking..." : "Check Now"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ color: "var(--ag-text-secondary)" }}>Auto-monitor:</span>
            <button
              onClick={() => setAutoCheckEnabled(!autoCheckEnabled)}
              className="ag_alert_toggle"
              style={{ background: autoCheckEnabled ? "#22c55e" : "#e5e7eb" }}
            >
              <span className="ag_alert_toggle_knob" style={{ transform: autoCheckEnabled ? "translateX(18px)" : "translateX(2px)" }} />
            </button>
          </div>

          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            style={{
              background: "#fff", border: "1px solid var(--ag-border)", borderRadius: 6,
              padding: "6px 10px", fontSize: 12, color: "#333",
            }}
          >
            <option value="all">All Platforms</option>
            <option value="Microsoft">Microsoft 365</option>
            <option value="Google">Google Cloud</option>
            <option value="OpenAI">ChatGPT / OpenAI</option>
            {claudeKeyId && <option value="Claude / Anthropic">Claude / Anthropic</option>}
            {geminiEnterpriseKeyId && <option value="Gemini Enterprise">Gemini Enterprise</option>}
          </select>
        </div>
      </div>

      {/* Microsoft Alerts */}
      {(vendorFilter === "all" || vendorFilter === "Microsoft") && (
        <Section title={`Microsoft 365 Stale Agents (${microsoftAlerts.length})`}>
          {microsoftAlerts.length > 0 ? (
            <div className="ag_alerts_list">
              {microsoftAlerts.map((alert) => (
                <AlertCard key={alert.agent_id} alert={alert} onResolve={handleResolve} />
              ))}
            </div>
          ) : (
            <div className="ag_alerts_empty">
              <Shield size={24} color="#0078D4" style={{ opacity: 0.3 }} />
              <span>
                {alertConfig.notify_microsoft
                  ? "No stale Microsoft agents detected"
                  : "Microsoft monitoring is paused"}
              </span>
            </div>
          )}
        </Section>
      )}

      {/* Google Alerts */}
      {(vendorFilter === "all" || vendorFilter === "Google") && (
        <Section title={`Google Cloud Stale Agents (${googleAlerts.length})`}>
          {googleAlerts.length > 0 ? (
            <div className="ag_alerts_list">
              {googleAlerts.map((alert) => (
                <AlertCard key={alert.agent_id} alert={alert} onResolve={handleResolve} />
              ))}
            </div>
          ) : (
            <div className="ag_alerts_empty">
              <Cloud size={24} color="#4285F4" style={{ opacity: 0.3 }} />
              <span>No stale Google agents detected</span>
            </div>
          )}
        </Section>
      )}

      {/* OpenAI / ChatGPT Alerts */}
      {openaiKeyId && (vendorFilter === "all" || vendorFilter === "OpenAI") && (
        <Section title={`ChatGPT / OpenAI Stale Agents (${openaiAlerts.length})`}>
          {openaiAlerts.length > 0 ? (
            <div className="ag_alerts_list">
              {openaiAlerts.map((alert) => (
                <AlertCard key={alert.agent_id} alert={alert} onResolve={handleResolve} />
              ))}
            </div>
          ) : (
            <div className="ag_alerts_empty">
              <Bot size={24} color="#10a37f" style={{ opacity: 0.3 }} />
              <span>No stale ChatGPT / OpenAI agents detected</span>
            </div>
          )}
        </Section>
      )}

      {/* Claude / Anthropic Alerts */}
      {claudeKeyId && (vendorFilter === "all" || vendorFilter === "Claude / Anthropic") && (
        <Section title={`Claude / Anthropic Stale Agents (${claudeAlerts.length})`}>
          {claudeAlerts.length > 0 ? (
            <div className="ag_alerts_list">
              {claudeAlerts.map((alert) => (
                <AlertCard key={alert.agent_id} alert={alert} onResolve={handleResolve} />
              ))}
            </div>
          ) : (
            <div className="ag_alerts_empty">
              <Bot size={24} color="#D4622A" style={{ opacity: 0.3 }} />
              <span>No stale Claude / Anthropic agents detected</span>
            </div>
          )}
        </Section>
      )}

      {/* Gemini Enterprise Alerts */}
      {geminiEnterpriseKeyId && (vendorFilter === "all" || vendorFilter === "Gemini Enterprise") && (
        <Section title={`Gemini Enterprise Stale Agents (${geminiAlerts.length})`}>
          {geminiAlerts.length > 0 ? (
            <div className="ag_alerts_list">
              {geminiAlerts.map((alert) => (
                <AlertCard key={alert.agent_id} alert={alert} onResolve={handleResolve} />
              ))}
            </div>
          ) : (
            <div className="ag_alerts_empty">
              <Bot size={24} color="#886FBF" style={{ opacity: 0.3 }} />
              <span>No stale Gemini Enterprise agents detected</span>
            </div>
          )}
        </Section>
      )}

    </div>
  );
}
