import { useState, useEffect, useCallback } from "react";
import SideNav from "../../Resuables/Nav/SideNav";
import TopNav from "../../Resuables/Nav/TopNav";
import { AgentGovernanceProvider, useAgentAuth, useGovernance, getVendorCounts, VENDOR_LABELS, VENDOR_COLORS } from "./AgentGovernanceContext";
import { DEMO_DISCOVERY_RESULT } from "./demoData";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";
import { OverviewTab } from "./tabs/OverviewTab";
import { DiscoveryTab } from "./tabs/DiscoveryTab";
import { PoliciesTab } from "./tabs/PoliciesTab";

import { UserActivityTab } from "./tabs/UserActivityTab";
import { AlertsTab } from "./tabs/AlertsTab";
import { CostTab } from "./tabs/CostTab";
import { ShieldCheck, RefreshCw, LogOut, Radar, Shield, Activity, ChevronDown, Cloud, Bell, DollarSign } from "lucide-react";
import "./css/AgentGovernance.css";

const TABS = [
  { id: "overview", label: "Overview", icon: <Radar size={14} /> },
  { id: "discovery", label: "Discovery", icon: <Shield size={14} /> },
  { id: "activity", label: "User Activity", icon: <Activity size={14} /> },
  { id: "alerts", label: "Stale Agents", icon: <Bell size={14} /> },
  { id: "cost", label: "Cost", icon: <DollarSign size={14} /> },
  { id: "policies", label: "Policies", icon: <ShieldCheck size={14} /> },
];

function AgentGovernanceInner() {
  const { isAuthenticated, oauthKeyId, tenantId, dataverseEnvUrl, googleKeyId, disconnect, disconnectGoogle } = useAgentAuth();
  const { state, dispatch } = useGovernance();
  const [alertCount, setAlertCount] = useState(0);
  const vendorCounts = getVendorCounts(state.discoveryResult);

  const [isAnyConnected, setIsAnyConnected] = useState(true);

  // All tabs mount immediately when connected so their data starts loading
  // right away — no loading spinners when navigating after scan.

  // Compute stale agent count locally from demo data, honouring the
  // header vendor selector so the badge shows 9 for Google alone, not
  // the combined Microsoft + Google total.
  const checkAlertCount = useCallback(() => {
    if (!state.discoveryResult?.agents?.length) return;
      const now = Date.now();
      const threshold = 30 * 24 * 60 * 60 * 1000;
      const vendor = state.selectedVendor;
      let count = 0;
      for (const agent of state.discoveryResult.agents) {
        if (vendor === "microsoft" && agent.vendor !== "Microsoft") continue;
        if (vendor === "google" && agent.vendor !== "Google") continue;
        const lastActive = agent.activity?.lastActiveTimestamp
          ? new Date(agent.activity.lastActiveTimestamp).getTime()
          : agent.lastModified ? new Date(agent.lastModified).getTime() : null;
        if (!lastActive || (now - lastActive) > threshold) count++;
      }
      setAlertCount(count);
  }, [state.discoveryResult, state.selectedVendor]);

  useEffect(() => {
    checkAlertCount();
  }, [checkAlertCount]);

  const handleScan = async () => {
    dispatch({ type: "DISCOVERY_START" });
    dispatch({ type: "DISCOVERY_PROGRESS", message: "Connecting to Microsoft and Google tenants..." });
    await new Promise((r) => setTimeout(r, 6000));
    dispatch({ type: "DISCOVERY_PROGRESS", message: "Scanning Copilot Studio environments..." });
    await new Promise((r) => setTimeout(r, 6000));
    dispatch({ type: "DISCOVERY_PROGRESS", message: "Discovering AI agents across Power Platform..." });
    await new Promise((r) => setTimeout(r, 6000));
    dispatch({ type: "DISCOVERY_PROGRESS", message: "Analyzing agent permissions and connectors..." });
    await new Promise((r) => setTimeout(r, 6000));
    dispatch({ type: "DISCOVERY_PROGRESS", message: "Computing risk scores and finalizing results..." });
    await new Promise((r) => setTimeout(r, 6000));
    setIsAnyConnected(true);
    dispatch({ type: "DISCOVERY_SUCCESS", result: DEMO_DISCOVERY_RESULT });
  };

  const handleExport = () => {
    if (!state.discoveryResult) return;
    const data = JSON.stringify(state.discoveryResult, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `governance-${state.discoveryResult.tenant.domain}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDisconnect = () => {
    setIsAnyConnected(false);
    dispatch({ type: "DISCOVERY_SUCCESS", result: null });
    setAlertCount(0);
  };

  const vendorOptions = ["all", "microsoft", "google"];

  return (
    <div className="ag_page_container">
      {/* Header */}
      <div className="ag_header">
        <div className="ag_header_left">
          <div className="ag_header_title">
            <ShieldCheck size={20} color="#6366f1" />
            Agent Governance
          </div>

          {/* Vendor selector (All / Microsoft / Google) */}
          {state.discoveryResult && (
            <div style={{ position: "relative", display: "inline-flex" }}>
              <select
                value={state.selectedVendor}
                onChange={(e) => dispatch({ type: "SET_VENDOR", vendor: e.target.value })}
                style={{
                  appearance: "none",
                  background: `${VENDOR_COLORS[state.selectedVendor] || "#6366f1"}12`,
                  border: `1px solid ${VENDOR_COLORS[state.selectedVendor] || "#6366f1"}33`,
                  borderRadius: 6,
                  padding: "4px 26px 4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: VENDOR_COLORS[state.selectedVendor] || "#6366f1",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              >
                {vendorOptions.map((v) => (
                  <option key={v} value={v}>
                    {VENDOR_LABELS[v]} ({vendorCounts[v] || 0})
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                style={{
                  position: "absolute", right: 8, top: "50%",
                  transform: "translateY(-50%)", pointerEvents: "none",
                  color: VENDOR_COLORS[state.selectedVendor] || "#6366f1",
                }}
              />
            </div>
          )}



          {state.discoveryStatus === "loading" && (
            <span style={{ fontSize: 11, color: "#f59e0b" }}>{state.discoveryProgress}</span>
          )}
          {state.discoveryResult && (
            <span className="ag_scan_info">
              Last scan {new Date(state.discoveryResult.scanTimestamp).toLocaleTimeString()}
              {state.discoveryResult.scanDuration ? ` (${Math.round(state.discoveryResult.scanDuration / 1000)}s)` : ""}
            </span>
          )}
        </div>
        <div className="ag_header_right">
          {isAnyConnected && (
            <button onClick={handleDisconnect} className="ag_btn_secondary">
              <LogOut size={13} /> Disconnect
            </button>
          )}
        </div>
      </div>

      {isAnyConnected ? (
        <>
          {/* Tabs */}
          <div className="ag_tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`ag_tab ${state.activeTab === tab.id ? "ag_tab_active" : ""}`}
                onClick={() => dispatch({ type: "SET_TAB", tab: tab.id })}
              >
                {tab.icon} {tab.label}
                {tab.id === "alerts" && alertCount > 0 && (
                  <span className="ag_alert_badge_count">{alertCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* All tabs mounted at once — data loads immediately on connect */}
          <div className="ag_tab_content ag_content_area">
            <div style={{ display: state.activeTab === "overview" ? "block" : "none" }}>
              <OverviewTab />
            </div>
            <div style={{ display: state.activeTab === "discovery" ? "block" : "none" }}>
              <DiscoveryTab />
            </div>
            <div style={{ display: state.activeTab === "activity" ? "block" : "none" }}>
              <UserActivityTab />
            </div>
            <div style={{ display: state.activeTab === "alerts" ? "block" : "none" }}>
              <AlertsTab isActive={state.activeTab === "alerts"} />
            </div>
            <div style={{ display: state.activeTab === "cost" ? "block" : "none" }}>
              <CostTab />
            </div>
            <div style={{ display: state.activeTab === "policies" ? "block" : "none" }}>
              <PoliciesTab />
            </div>
          </div>
        </>
      ) : (
        <div className="ag_content_area">
          <div className="ag_empty_state">
            <div className="ag_empty_state_icon">
              <ShieldCheck size={32} />
            </div>
            {state.discoveryStatus === "loading" ? (
              <>
                <h3>Scanning in Progress...</h3>
                <p style={{ color: "#f59e0b", fontWeight: 600 }}>{state.discoveryProgress}</p>
                <div style={{ marginTop: 12 }}>
                  <RefreshCw size={24} color="#6366f1" style={{ animation: "agSpin 1s linear infinite" }} />
                </div>
              </>
            ) : (
              <>
                <h3>Disconnected</h3>
                <p>
                  Click "Run Scan" to discover and govern AI agents across your Microsoft and Google tenants.
                </p>
                <button onClick={handleScan} className="ag_btn_primary" style={{ padding: "10px 24px", fontSize: 14 }}>
                  <RefreshCw size={16} /> Run Scan
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

const AgentGovernance = () => {
  return (
    <div className="cf_main_container">
      <SideNav activeTab="Agent<br/>Governance" />
      <div className="cf_main_content_place">
        <TopNav />
        <div className="cf_main_content_place_main" style={{ padding: 0 }}>
          <AgentGovernanceProvider>
            <AgentGovernanceInner />
          </AgentGovernanceProvider>
        </div>
      </div>
    </div>
  );
};

export default AgentGovernance;
