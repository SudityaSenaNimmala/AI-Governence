import { useState, useEffect } from "react";
import { useAgentAuth } from "./AgentGovernanceContext";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";
import { Lock, Eye, EyeOff, X, ChevronDown, ChevronUp, CheckCircle, Cloud } from "lucide-react";

const MS_SCOPE_ITEMS = [
  { color: "#742774", label: "Copilot Studio", perm: "user_impersonation", license: "Power Platform" },
  { color: "#038387", label: "SharePoint Agents", perm: "Sites.Read.All", license: "Any M365" },
  { color: "#0078D4", label: "Azure AI Foundry", perm: "Reader RBAC", license: "Azure subscription" },
  { color: "#5B5FC7", label: "Teams Apps", perm: "AppCatalog.Read.All", license: "Any M365" },
  { color: "#D83B01", label: "Audit & Activity", perm: "ActivityFeed.Read", license: "E3/E5" },
  { color: "#6366f1", label: "Users & Directory", perm: "User.Read.All", license: "Any M365" },
];

const GCP_SCOPE_ITEMS = [
  { color: "#4285F4", label: "Vertex AI Endpoints & Models", perm: "aiplatform.viewer" },
  { color: "#34A853", label: "Gemini Tuned Models", perm: "aiplatform.viewer" },
  { color: "#EA4335", label: "Dialogflow CX Agents", perm: "dialogflow.client" },
  { color: "#F9AB00", label: "IAM Access Control", perm: "iam.securityReviewer" },
  { color: "#9334E6", label: "Enabled AI APIs", perm: "serviceusage.viewer" },
];

const TAB_STYLE_BASE = {
  flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 600, border: "none",
  cursor: "pointer", borderRadius: "8px 8px 0 0", fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  transition: "all 0.15s ease",
};

// ── Microsoft Tab ──

function MicrosoftForm({ onClose, mode }) {
  const { connect, updateConnection, isConnecting, error, dataverseEnvUrl: currentDvUrl, azureSubscriptionId: currentAzSub } = useAgentAuth();
  const isUpdateMode = mode === "update";
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [dataverseEnvUrl, setDataverseEnvUrl] = useState(isUpdateMode ? (currentDvUrl || "") : "");
  const [azureSubscriptionId, setAzureSubscriptionId] = useState(isUpdateMode ? (currentAzSub || "") : "");
  const [showSecret, setShowSecret] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showScopes, setShowScopes] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState(null);
  const [changeSecret, setChangeSecret] = useState(false);

  useEffect(() => {
    if (isUpdateMode) return;
    agentGovernanceApi.listOAuthKeys().then((keys) => {
      if (keys && keys.length > 0) {
        const ms = keys.find((k) => k.vendor === "microsoft") || keys[0];
        setSavedCredentials(ms);
        setTenantId(ms.tenant_id || "");
        setClientId(ms.client_id || "");
        setDataverseEnvUrl(ms.dataverse_env_url || "");
        setAzureSubscriptionId(ms.azure_subscription_id || "");
      }
    }).catch(() => {});
  }, [isUpdateMode]);

  const hasSavedSecret = !!savedCredentials && !changeSecret;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (isUpdateMode) {
      const updates = {};
      if (dataverseEnvUrl.trim()) updates.dataverse_env_url = dataverseEnvUrl.trim();
      if (azureSubscriptionId.trim()) updates.azure_subscription_id = azureSubscriptionId.trim();
      if (Object.keys(updates).length === 0) { setLocalError("Enter at least one field to update"); return; }
      try { await updateConnection(updates); onClose(); } catch { /* context error */ }
      return;
    }

    if (!clientId.trim() || !tenantId.trim()) { setLocalError("Tenant ID and Client ID are required"); return; }
    if (!hasSavedSecret && !clientSecret.trim()) { setLocalError("Client Secret is required"); return; }

    try {
      if (hasSavedSecret) {
        await connect({ _existingKeyId: savedCredentials.id, client_id: clientId.trim(), tenant_id: tenantId.trim(), dataverse_env_url: dataverseEnvUrl.trim() || undefined, azure_subscription_id: azureSubscriptionId.trim() || undefined });
      } else {
        await connect({ client_id: clientId.trim(), client_secret: clientSecret.trim(), tenant_id: tenantId.trim(), dataverse_env_url: dataverseEnvUrl.trim() || undefined, azure_subscription_id: azureSubscriptionId.trim() || undefined });
      }
      onClose();
    } catch (err) {
      if (!error) {
        setLocalError(err?.message || "Connection failed. Please check your credentials and try again.");
      }
    }
  };

  const displayError = error || localError;

  return (
    <div>
      {savedCredentials && !isUpdateMode && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          <CheckCircle size={16} color="#22c55e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Previous credentials found</div>
            <div style={{ fontSize: 11, color: "#15803d" }}>{savedCredentials.client_id_masked} &middot; {savedCredentials.tenant_id || "no tenant"}</div>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setShowScopes(!showScopes)}
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, fontWeight: 500, color: "#6366f1", cursor: "pointer", fontFamily: "inherit" }}>
        {showScopes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        What this single connection discovers
      </button>

      {showScopes && (
        <div style={{ marginBottom: 14, border: "1px solid rgba(99,102,241,0.15)", borderRadius: 8, overflow: "hidden" }}>
          {MS_SCOPE_ITEMS.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 10 }}>{item.perm}</span>
              <span style={{ color: "#999", fontSize: 10, width: 90, textAlign: "right" }}>{item.license}</span>
            </div>
          ))}
        </div>
      )}

      {isUpdateMode && (
        <div style={{ marginBottom: 14, padding: 10, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 12, color: "#166534", lineHeight: 1.5 }}>
          Already connected. Update Dataverse or Azure settings below.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {!isUpdateMode && (
          <>
            <div className="ag_form_group">
              <label className="ag_form_label">Tenant ID <span style={{ color: "#ef4444" }}>*</span></label>
              <input type="text" placeholder="e.g. contoso.onmicrosoft.com or GUID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="ag_form_input" autoComplete="off" />
            </div>
            <div className="ag_form_group">
              <label className="ag_form_label">Client ID (Entra App Registration) <span style={{ color: "#ef4444" }}>*</span></label>
              <input type="text" placeholder="Application (client) ID from Entra" value={clientId} onChange={(e) => setClientId(e.target.value)} className="ag_form_input" autoComplete="off" />
            </div>
            <div className="ag_form_group">
              <label className="ag_form_label">Client Secret <span style={{ color: "#ef4444" }}>*</span></label>
              {hasSavedSecret ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ag_form_input" style={{ flex: 1, color: "#999", background: "#f9fafb" }}>••••••••••••••••••••</div>
                  <button type="button" onClick={() => { setChangeSecret(true); setClientSecret(""); }}
                    style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "7px 14px", fontSize: 12, color: "#6366f1", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <input type={showSecret ? "text" : "password"} placeholder="Client secret value" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="ag_form_input" style={{ paddingRight: 40 }} autoComplete="off" />
                  <button type="button" onClick={() => setShowSecret(!showSecret)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <div className="ag_form_group">
          <label className="ag_form_label">
            Dataverse Environment URL
            {currentDvUrl && isUpdateMode ? <span style={{ color: "#22c55e", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>connected</span> : <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>for Copilot Studio discovery</span>}
          </label>
          <input type="text" placeholder="e.g. org12345.crm.dynamics.com" value={dataverseEnvUrl} onChange={(e) => setDataverseEnvUrl(e.target.value)} className="ag_form_input" autoComplete="off" />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Power Platform Admin Center &rarr; Environments &rarr; Environment URL</div>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">
            Azure Subscription ID
            {currentAzSub && isUpdateMode ? <span style={{ color: "#22c55e", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>connected</span> : <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>for Azure AI Foundry</span>}
          </label>
          <input type="text" placeholder="e.g. 12345678-abcd-efgh-1234-567890abcdef" value={azureSubscriptionId} onChange={(e) => setAzureSubscriptionId(e.target.value)} className="ag_form_input" autoComplete="off" />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Optional &mdash; scans all accessible subscriptions if empty</div>
        </div>

        {displayError && (
          <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
            {displayError}
          </div>
        )}

        <button type="submit" disabled={isConnecting} className="ag_connect_btn">
          {isConnecting ? (isUpdateMode ? "Updating..." : "Connecting...") : (isUpdateMode ? "Update Connection" : (savedCredentials ? "Reconnect & Discover" : "Connect & Discover"))}
        </button>
      </form>
    </div>
  );
}

// ── Google Cloud Tab ──

function GoogleForm({ onClose }) {
  const { connectGoogle, googleKeyId } = useAgentAuth();
  const [saJson, setSaJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showScopes, setShowScopes] = useState(false);
  const [success, setSuccess] = useState(false);

  const isAlreadyConnected = !!googleKeyId;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!saJson.trim()) { setLocalError("Service account JSON key is required"); return; }
    try { JSON.parse(saJson.trim()); } catch { setLocalError("Invalid JSON — paste the full key file contents"); return; }

    setLoading(true);
    try {
      await connectGoogle(saJson.trim(), projectId.trim() || undefined);
      setSuccess(true);
    } catch (err) {
      setLocalError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {isAlreadyConnected && !success && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          <CheckCircle size={16} color="#22c55e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Google Cloud connected</div>
            <div style={{ fontSize: 11, color: "#15803d" }}>Service account credentials stored. Run a scan to discover agents.</div>
          </div>
        </div>
      )}

      {success && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          <CheckCircle size={16} color="#22c55e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Google Cloud connected successfully</div>
            <div style={{ fontSize: 11, color: "#15803d" }}>Click "Run Scan" in the header to discover Vertex AI agents.</div>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setShowScopes(!showScopes)}
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", background: "rgba(66,133,244,0.05)", border: "1px solid rgba(66,133,244,0.15)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, fontWeight: 500, color: "#4285F4", cursor: "pointer", fontFamily: "inherit" }}>
        {showScopes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        What this connection discovers
      </button>

      {showScopes && (
        <div style={{ marginBottom: 14, border: "1px solid rgba(66,133,244,0.15)", borderRadius: 8, overflow: "hidden" }}>
          {GCP_SCOPE_ITEMS.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: "#4285F4", fontFamily: "monospace", fontSize: 10 }}>{item.perm}</span>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ag_form_group">
          <label className="ag_form_label">Service Account JSON Key <span style={{ color: "#ef4444" }}>*</span></label>
          <textarea
            placeholder='Paste the full JSON key file contents ({"type": "service_account", ...})'
            value={saJson} onChange={(e) => setSaJson(e.target.value)}
            className="ag_form_input"
            style={{ minHeight: 110, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
          />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            GCP Console &rarr; IAM &amp; Admin &rarr; Service Accounts &rarr; Keys &rarr; Add Key &rarr; JSON
          </div>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">
            GCP Project ID
            <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>optional — scans all accessible projects if empty</span>
          </label>
          <input type="text" placeholder="e.g. my-project-123456" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ag_form_input" autoComplete="off" />
        </div>

        {localError && (
          <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
            {localError}
          </div>
        )}

        <button type="submit" disabled={loading || success} className="ag_connect_btn" style={{ background: success ? "#22c55e" : "#4285F4" }}>
          {loading ? "Verifying & Connecting..." : success ? "Connected ✓" : (isAlreadyConnected ? "Update Google Credentials" : "Connect & Verify")}
        </button>
      </form>
    </div>
  );
}

// ── Main Modal ──

export function ConnectTenantModal({ onClose, mode = "connect" }) {
  const isUpdateMode = mode === "update";
  const [activeTab, setActiveTab] = useState("microsoft");

  const msTabActive = activeTab === "microsoft";
  const gcpTabActive = activeTab === "google";

  return (
    <div className="ag_modal_overlay" onClick={onClose}>
      <div className="ag_modal_content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="ag_modal_header">
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              {isUpdateMode ? "Update Connection" : "Connect Cloud Platform"}
            </h2>
            <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0 0" }}>
              Connect Microsoft 365 and/or Google Cloud for agent discovery
            </p>
          </div>
          <button onClick={onClose} className="ag_modal_close"><X size={18} /></button>
        </div>

        {/* Platform Tabs */}
        <div style={{ display: "flex", gap: 2, marginBottom: 16, background: "#f3f4f6", borderRadius: 8, padding: 2 }}>
          <button type="button" onClick={() => setActiveTab("microsoft")}
            style={{
              ...TAB_STYLE_BASE,
              background: msTabActive ? "#fff" : "transparent",
              color: msTabActive ? "#0078D4" : "#666",
              boxShadow: msTabActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              borderRadius: 6,
            }}>
            <svg width="14" height="14" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill={msTabActive ? "#F25022" : "#999"} /><rect x="11" y="1" width="9" height="9" fill={msTabActive ? "#7FBA00" : "#999"} /><rect x="1" y="11" width="9" height="9" fill={msTabActive ? "#00A4EF" : "#999"} /><rect x="11" y="11" width="9" height="9" fill={msTabActive ? "#FFB900" : "#999"} /></svg>
            Microsoft 365
          </button>
          <button type="button" onClick={() => setActiveTab("google")}
            style={{
              ...TAB_STYLE_BASE,
              background: gcpTabActive ? "#fff" : "transparent",
              color: gcpTabActive ? "#4285F4" : "#666",
              boxShadow: gcpTabActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              borderRadius: 6,
            }}>
            <Cloud size={14} color={gcpTabActive ? "#4285F4" : "#999"} />
            Google Cloud
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "microsoft" && <MicrosoftForm onClose={onClose} mode={mode} />}
        {activeTab === "google" && <GoogleForm onClose={onClose} />}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 11, color: "#999" }}>
          <Lock size={12} />
          Credentials encrypted at rest (AES-256-GCM). Data stays in your infrastructure.
        </div>
      </div>
    </div>
  );
}
