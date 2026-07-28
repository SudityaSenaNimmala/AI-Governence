import { useState, useEffect, useRef } from "react";
import { useAgentAuth } from "./AgentGovernanceContext";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";
import { Lock, Eye, EyeOff, X, ChevronDown, ChevronUp, CheckCircle, Cloud, Upload, Bot, Sparkles } from "lucide-react";

const MS_SCOPE_ITEMS = [
  { color: "#742774", label: "Copilot Studio", perm: "user_impersonation", license: "Power Platform" },
  { color: "#038387", label: "SharePoint Agents", perm: "Sites.Read.All", license: "Any M365" },
  { color: "#0078D4", label: "Azure AI Foundry", perm: "Reader RBAC", license: "Azure subscription" },
  { color: "#5B5FC7", label: "Teams Apps", perm: "AppCatalog.Read.All", license: "Any M365" },
  { color: "#D83B01", label: "Audit & Activity", perm: "ActivityFeed.Read", license: "E3/E5" },
  { color: "#6366f1", label: "Users & Directory", perm: "User.Read.All", license: "Any M365" },
];

const OPENAI_SCOPE_ITEMS = [
  { color: "#10a37f", label: "Assistants API Agents", perm: "assistants:read" },
  { color: "#0ea5e9", label: "Vector Stores (Knowledge Bases)", perm: "vector_stores:read" },
  { color: "#f97316", label: "Uploaded Files", perm: "files:read" },
  { color: "#7c3aed", label: "Custom GPTs (Business/Team/Enterprise)", perm: "session token" },
];

const CLAUDE_SCOPE_ITEMS = [
  { color: "#D4622A", label: "Available Claude Models", perm: "any API key" },
  { color: "#E8845A", label: "Claude.ai Projects (Workspaces, Admin API)", perm: "admin key only" },
  { color: "#B85C38", label: "Claude.ai Projects (via claude.ai)", perm: "session key" },
  { color: "#F4A77E", label: "Model Usage & Spend", perm: "admin key only" },
];

const GCP_SCOPE_ITEMS = [
  { color: "#4285F4", label: "Vertex AI Endpoints & Models", perm: "aiplatform.viewer" },
  { color: "#34A853", label: "Gemini Tuned Models", perm: "aiplatform.viewer" },
  { color: "#EA4335", label: "Dialogflow CX Agents", perm: "dialogflow.client" },
  { color: "#F9AB00", label: "IAM Access Control", perm: "iam.securityReviewer" },
  { color: "#9334E6", label: "Enabled AI APIs", perm: "serviceusage.viewer" },
];

const AWS_SCOPE_ITEMS = [
  { color: "#FF9900", label: "Bedrock Agents", perm: "bedrock:ListAgents" },
  { color: "#FF6600", label: "Bedrock Knowledge Bases", perm: "bedrock:ListKnowledgeBases" },
  { color: "#232F3E", label: "Bedrock Foundation Models", perm: "bedrock:ListFoundationModels" },
  { color: "#527FFF", label: "SageMaker Endpoints", perm: "sagemaker:ListEndpoints" },
];

const AWS_REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-east-2", label: "US East (Ohio)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "us-west-2", label: "US West (Oregon)" },
  { value: "eu-west-1", label: "EU (Ireland)" },
  { value: "eu-west-2", label: "EU (London)" },
  { value: "eu-west-3", label: "EU (Paris)" },
  { value: "eu-central-1", label: "EU (Frankfurt)" },
  { value: "eu-north-1", label: "EU (Stockholm)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { value: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { value: "sa-east-1", label: "South America (Sao Paulo)" },
  { value: "ca-central-1", label: "Canada (Central)" },
  { value: "me-south-1", label: "Middle East (Bahrain)" },
  { value: "af-south-1", label: "Africa (Cape Town)" },
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

function GoogleForm({ onClose, mode }) {
  const { connectGoogle, googleKeyId } = useAgentAuth();
  const isUpdateMode = mode === "update";
  const [saJson, setSaJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showScopes, setShowScopes] = useState(false);
  const [savedGoogle, setSavedGoogle] = useState(null);
  const [useSaved, setUseSaved] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const fileInputRef = useRef(null);

  const isAlreadyConnected = !!googleKeyId;

  useEffect(() => {
    agentGovernanceApi.listOAuthKeys().then((keys) => {
      if (keys && keys.length > 0) {
        const gKey = keys.find((k) => k.vendor === "google");
        if (gKey) {
          setSavedGoogle(gKey);
          setAdminEmail(gKey.google_admin_email || "");
          setProjectId(gKey.google_project_id || "");
          setUseSaved(true);
        }
      }
    }).catch(() => {});
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") {
        setSaJson(text.trim());
        setUseSaved(false);
        setLocalError(null);
        try {
          const parsed = JSON.parse(text.trim());
          if (parsed.project_id) setProjectId(parsed.project_id);
          if (parsed.client_email && !adminEmail) {
            const domain = parsed.client_email.split("@")[1];
            if (domain && !domain.includes("iam.gserviceaccount.com")) setAdminEmail(parsed.client_email);
          }
        } catch { /* not valid json yet */ }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleJsonChange = (e) => {
    const val = e.target.value;
    setSaJson(val);
    setUseSaved(false);
    setLocalError(null);
    try {
      const parsed = JSON.parse(val.trim());
      if (parsed.project_id && !projectId) setProjectId(parsed.project_id);
    } catch { /* still typing */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (useSaved && savedGoogle) {
      // Re-connect with existing stored key — just update admin email / project
      setLoading(true);
      try {
        await connectGoogle("__USE_EXISTING__", projectId.trim() || undefined, adminEmail.trim() || undefined);
        onClose();
      } catch (err) {
        setLocalError(err.message || "Failed to connect");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!saJson.trim()) { setLocalError("Service account JSON key is required"); return; }
    try { JSON.parse(saJson.trim()); } catch { setLocalError("Invalid JSON — upload the .json key file or paste the complete file contents"); return; }

    setLoading(true);
    try {
      await connectGoogle(saJson.trim(), projectId.trim() || undefined, adminEmail.trim() || undefined);
      onClose();
    } catch (err) {
      setLocalError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {savedGoogle && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          <CheckCircle size={16} color="#22c55e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>Google Cloud credentials saved</div>
            <div style={{ fontSize: 11, color: "#15803d" }}>
              {savedGoogle.google_admin_email || savedGoogle.client_id_masked || "Service account stored"} &middot; {savedGoogle.google_project_id || ""}
            </div>
          </div>
          {!useSaved && (
            <button type="button" onClick={() => setUseSaved(true)}
              style={{ background: "none", border: "1px solid #bbf7d0", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#166534", cursor: "pointer", fontFamily: "inherit" }}>
              Use Saved
            </button>
          )}
        </div>
      )}

      {isUpdateMode && !savedGoogle && (
        <div style={{ marginBottom: 14, padding: 10, background: "#f0f4ff", border: "1px solid #c7d2fe", borderRadius: 8, fontSize: 12, color: "#3730a3", lineHeight: 1.5 }}>
          Already connected to Google Cloud. Paste a new service account JSON to update credentials or switch project.
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

          {useSaved && savedGoogle ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div className="ag_form_input" style={{ flex: 1, color: "#999", background: "#f9fafb", fontSize: 11 }}>
                ••••••••  (saved credentials — key stored securely)
              </div>
              <button type="button" onClick={() => { setUseSaved(false); setSaJson(""); }}
                style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "7px 14px", fontSize: 12, color: "#4285F4", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                Change
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#4285F4", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  <Upload size={12} /> Upload .json file
                </button>
                <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleFileUpload} />
                {uploadedFileName && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#16a34a" }}>
                    <CheckCircle size={12} /> {uploadedFileName}
                  </span>
                )}
              </div>
              <textarea
                placeholder='Upload the .json file above — or paste the full file contents here'
                value={saJson} onChange={handleJsonChange}
                className="ag_form_input"
                style={{ minHeight: 100, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
              />
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                GCP Console &rarr; IAM &amp; Admin &rarr; Service Accounts &rarr; Keys &rarr; Add Key &rarr; JSON
              </div>
            </>
          )}
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">
            Workspace Admin Email <span style={{ color: "#ef4444" }}>*</span>
            <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>required for Workspace discovery (Gemini, users, Chat)</span>
          </label>
          <input type="email" placeholder="e.g. admin@yourdomain.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="ag_form_input" autoComplete="off" />
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

        <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: "#4285F4" }}>
          {loading ? "Verifying & Connecting..." : (useSaved && savedGoogle ? "Reconnect with Saved Credentials" : isAlreadyConnected ? "Update Google Credentials" : "Connect & Verify")}
        </button>
      </form>
    </div>
  );
}

// ── OpenAI Tab ──

function OpenAIForm({ onClose }) {
  const { connectOpenAI, openaiKeyId } = useAgentAuth();
  const [apiKey, setApiKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [orgId, setOrgId] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [sessionToken1, setSessionToken1] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showScopes, setShowScopes] = useState(false);
  const [showSessionHelp, setShowSessionHelp] = useState(false);
  const [savedKey, setSavedKey] = useState(null);
  const [changeKey, setChangeKey] = useState(false);

  const isAlreadyConnected = !!openaiKeyId;

  useEffect(() => {
    agentGovernanceApi.listOAuthKeys().then((keys) => {
      if (keys && keys.length > 0) {
        const oKey = keys.find((k) => k.vendor === "openai");
        if (oKey) setSavedKey(oKey);
      }
    }).catch(() => {});
  }, []);

  const hasSavedKey = !!savedKey && !changeKey;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    const combinedToken = sessionToken.trim()
      ? (sessionToken1.trim() ? `${sessionToken.trim()}||${sessionToken1.trim()}` : sessionToken.trim())
      : undefined;

    if (hasSavedKey) {
      setLoading(true);
      try {
        await connectOpenAI("__USE_EXISTING__", orgId.trim() || undefined, combinedToken, adminKey.trim() || undefined);
        onClose();
      } catch (err) {
        setLocalError(err.message || "Failed to reconnect");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!apiKey.trim()) { setLocalError("Project API key is required"); return; }
    if (!apiKey.trim().startsWith("sk-")) { setLocalError("OpenAI API keys start with sk-"); return; }

    setLoading(true);
    try {
      await connectOpenAI(apiKey.trim(), orgId.trim() || undefined, combinedToken, adminKey.trim() || undefined);
      onClose();
    } catch (err) {
      setLocalError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {savedKey && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
          <CheckCircle size={16} color="#22c55e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#166534" }}>OpenAI API key saved</div>
            <div style={{ fontSize: 11, color: "#15803d" }}>
              {savedKey.tenant_id ? `Org: ${savedKey.tenant_id}` : "Personal / Plus account"}
            </div>
          </div>
          {!changeKey && (
            <button type="button" onClick={() => setChangeKey(true)}
              style={{ background: "none", border: "1px solid #bbf7d0", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#166534", cursor: "pointer", fontFamily: "inherit" }}>
              Change
            </button>
          )}
        </div>
      )}

      <button type="button" onClick={() => setShowScopes(!showScopes)}
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", background: "rgba(16,163,127,0.05)", border: "1px solid rgba(16,163,127,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, fontWeight: 500, color: "#10a37f", cursor: "pointer", fontFamily: "inherit" }}>
        {showScopes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        What this connection discovers
      </button>

      {showScopes && (
        <div style={{ marginBottom: 14, border: "1px solid rgba(16,163,127,0.2)", borderRadius: 8, overflow: "hidden" }}>
          {OPENAI_SCOPE_ITEMS.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: "#10a37f", fontFamily: "monospace", fontSize: 10 }}>{item.perm}</span>
            </div>
          ))}
          <div style={{ padding: "8px 12px", fontSize: 10, color: "#999", background: "#fafafa" }}>
            Plus account: Assistants API + Vector Stores. Upgrade to Team/Enterprise for Custom GPTs.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ag_form_group">
          <label className="ag_form_label">OpenAI API Key <span style={{ color: "#ef4444" }}>*</span></label>
          {hasSavedKey ? (
            <div className="ag_form_input" style={{ color: "#999", background: "#f9fafb" }}>••••••••••••••••••••</div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="ag_form_input"
                style={{ paddingRight: 40 }}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowKey(!showKey)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            platform.openai.com &rarr; Default project &rarr; API keys &rarr; Create new secret key
          </div>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            Admin Key
            <span style={{ background: "#10a37f", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4 }}>for API key discovery</span>
            <span style={{ color: "#999", fontWeight: 400, fontSize: 11 }}>optional</span>
          </label>
          <div style={{ position: "relative" }}>
            <input
              type={showAdminKey ? "text" : "password"}
              placeholder="sk-..."
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              className="ag_form_input"
              style={{ paddingRight: 40 }}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowAdminKey(!showAdminKey)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
              {showAdminKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            platform.openai.com &rarr; Settings &rarr; Organization &rarr; Admin keys &rarr; Create new Admin key
          </div>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">
            Organization ID
            <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>optional — for Team/Enterprise</span>
          </label>
          <input
            type="text"
            placeholder="e.g. org-xxxxxxxxxxxxxxxxxxxx"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="ag_form_input"
            autoComplete="off"
          />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            platform.openai.com &rarr; Settings &rarr; Organization &rarr; Organization ID
          </div>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            ChatGPT Session Token
            <span style={{ background: "#10a37f", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4 }}>for Custom GPTs</span>
          </label>

          <button type="button" onClick={() => setShowSessionHelp(!showSessionHelp)}
            style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8, background: "none", border: "none", fontSize: 11, color: "#10a37f", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
            {showSessionHelp ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            How to get your session token
          </button>

          {showSessionHelp && (
            <div style={{ marginBottom: 10, padding: "10px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 11, color: "#166534", lineHeight: 1.7 }}>
              1. Open <strong>chatgpt.com</strong> and sign in<br />
              2. Press <strong>F12</strong> → <strong>Application</strong> tab → <strong>Cookies</strong> → <strong>https://chatgpt.com</strong><br />
              3. Look for <strong>__Secure-next-auth.session-token.0</strong> and <strong>.1</strong><br />
              4. Copy each value and paste in the fields below<br />
              <span style={{ color: "#15803d", fontSize: 10, marginTop: 4, display: "block" }}>
                ChatGPT splits long tokens into two parts — paste both.
              </span>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap", minWidth: 56 }}>Token .0 *</span>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type={showSession ? "text" : "password"}
                placeholder="__Secure-next-auth.session-token.0 value"
                value={sessionToken}
                onChange={(e) => setSessionToken(e.target.value)}
                className="ag_form_input"
                style={{ paddingRight: 40, fontFamily: "monospace", fontSize: 10, marginBottom: 0 }}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowSession(!showSession)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
                {showSession ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap", minWidth: 56 }}>Token .1</span>
            <input
              type={showSession ? "text" : "password"}
              placeholder="__Secure-next-auth.session-token.1 value (if exists)"
              value={sessionToken1}
              onChange={(e) => setSessionToken1(e.target.value)}
              className="ag_form_input"
              style={{ flex: 1, fontFamily: "monospace", fontSize: 10, marginBottom: 0 }}
              autoComplete="off"
            />
          </div>
          <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>
            Token .1 is optional — only if you see a second token in DevTools cookies
          </div>
        </div>

        {localError && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
            {localError}
          </div>
        )}

        <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: "#10a37f" }}>
          {loading ? "Verifying & Connecting..." : hasSavedKey ? "Reconnect with Saved Key" : isAlreadyConnected ? "Update API Key" : "Connect & Verify"}
        </button>
      </form>
    </div>
  );
}

// ── Claude / Anthropic Tab ──

function ClaudeForm({ onClose }) {
  const { connectClaude, claudeKeyId } = useAgentAuth();
  const [apiKey, setApiKey] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showScopes, setShowScopes] = useState(false);
  const [savedKey, setSavedKey] = useState(null);
  const [changeKey, setChangeKey] = useState(false);

  const isAlreadyConnected = !!claudeKeyId;

  useEffect(() => {
    agentGovernanceApi.listOAuthKeys().then((keys) => {
      if (keys && keys.length > 0) {
        const cKey = keys.find((k) => k.vendor === "claude");
        if (cKey) setSavedKey(cKey);
      }
    }).catch(() => {});
  }, []);

  const hasSavedKey = !!savedKey && !changeKey;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (hasSavedKey) {
      setLoading(true);
      try {
        await connectClaude("__USE_EXISTING__", sessionKey.trim() || undefined);
        onClose();
      } catch (err) {
        setLocalError(err.message || "Failed to reconnect");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!apiKey.trim()) { setLocalError("API key is required"); return; }
    if (!apiKey.trim().startsWith("sk-ant-")) { setLocalError("Anthropic API keys must start with sk-ant-"); return; }

    setLoading(true);
    try {
      await connectClaude(apiKey.trim(), sessionKey.trim() || undefined);
      onClose();
    } catch (err) {
      setLocalError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {savedKey && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#fff7f3", border: "1px solid #fbd5c5", borderRadius: 8 }}>
          <CheckCircle size={16} color="#D4622A" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#7c2d12" }}>Anthropic API key saved</div>
            <div style={{ fontSize: 11, color: "#9a3412" }}>Key stored securely — ready to scan Claude.ai Projects</div>
          </div>
          {!changeKey && (
            <button type="button" onClick={() => setChangeKey(true)}
              style={{ background: "none", border: "1px solid #fbd5c5", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#7c2d12", cursor: "pointer", fontFamily: "inherit" }}>
              Change
            </button>
          )}
        </div>
      )}

      <button type="button" onClick={() => setShowScopes(!showScopes)}
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", background: "rgba(212,98,42,0.05)", border: "1px solid rgba(212,98,42,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, fontWeight: 500, color: "#D4622A", cursor: "pointer", fontFamily: "inherit" }}>
        {showScopes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        What this connection discovers
      </button>

      {showScopes && (
        <div style={{ marginBottom: 14, border: "1px solid rgba(212,98,42,0.2)", borderRadius: 8, overflow: "hidden" }}>
          {CLAUDE_SCOPE_ITEMS.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: "#D4622A", fontFamily: "monospace", fontSize: 10 }}>{item.perm}</span>
            </div>
          ))}
          <div style={{ padding: "8px 12px", fontSize: 10, color: "#999", background: "#fafafa" }}>
            Requires an Admin API key from console.anthropic.com → Settings → API Keys.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ag_form_group">
          <label className="ag_form_label">Anthropic API Key <span style={{ color: "#ef4444" }}>*</span></label>
          {hasSavedKey ? (
            <div className="ag_form_input" style={{ color: "#999", background: "#f9fafb" }}>••••••••••••••••••••</div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                type={showKey ? "text" : "password"}
                placeholder="sk-ant-api03-... or sk-ant-admin01-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="ag_form_input"
                style={{ paddingRight: 40 }}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowKey(!showKey)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            Standard key discovers Claude Models &middot; Admin key also discovers Projects &amp; Usage
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
            console.anthropic.com &rarr; Settings &rarr; API Keys
          </div>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">Claude.ai Session Key <span style={{ color: "#999", fontWeight: 400 }}>(optional)</span></label>
          <div style={{ position: "relative" }}>
            <input
              type={showSession ? "text" : "password"}
              placeholder="sk-ant-... session key from claude.ai cookies"
              value={sessionKey}
              onChange={(e) => setSessionKey(e.target.value)}
              className="ag_form_input"
              style={{ paddingRight: 40 }}
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowSession(!showSession)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
              {showSession ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 4, lineHeight: 1.6 }}>
            Enables discovery of Claude.ai Projects without Admin API access.<br />
            Get it: open <strong>claude.ai</strong> → F12 → Application → Cookies → claude.ai → <strong>sessionKey</strong>
          </div>
        </div>

        {localError && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
            {localError}
          </div>
        )}

        <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: "#D4622A" }}>
          {loading ? "Verifying & Connecting..." : hasSavedKey ? "Reconnect with Saved Key" : isAlreadyConnected ? "Update API Key" : "Connect & Verify"}
        </button>
      </form>
    </div>
  );
}

// ── Gemini Enterprise Tab ──

const GE_COLOR = "#886FBF";

function GeminiEnterpriseForm({ onClose }) {
  const { connectGeminiEnterprise, connectGeminiEnterpriseToken } = useAgentAuth();
  const [authMode, setAuthMode] = useState("token"); // "sa" | "token" — token is the common case
  const [accessToken, setAccessToken] = useState("");
  const [saJson, setSaJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [location, setLocation] = useState("global");
  const [collection, setCollection] = useState("default_collection");
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const fileInputRef = useRef(null);

  const parseJsonHints = (text) => {
    try {
      const parsed = JSON.parse(text.trim());
      if (parsed.project_id) setProjectId((p) => p || parsed.project_id);
      if (parsed.client_email) {
        const domain = parsed.client_email.split("@")[1];
        if (domain && !domain.includes("iam.gserviceaccount.com")) setAdminEmail((a) => a || parsed.client_email);
      }
    } catch { /* still typing */ }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") { setSaJson(text.trim()); setLocalError(null); parseJsonHints(text); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!engineId.trim()) { setLocalError("Gemini Enterprise app ID (engine ID) is required"); return; }
    if (!projectId.trim()) { setLocalError("GCP Project ID is required"); return; }

    if (authMode === "token") {
      if (!accessToken.trim()) { setLocalError("Access token is required (run: gcloud auth print-access-token)"); return; }
      setLoading(true);
      try {
        const conn = {
          access_token: accessToken.trim(), project_id: projectId.trim(), engine_id: engineId.trim(),
          location: location.trim() || "global", collection: collection.trim() || "default_collection",
        };
        await agentGovernanceApi.previewGeminiEnterprise(conn);
        connectGeminiEnterpriseToken(conn);
        onClose();
      } catch (err) { setLocalError(err.message || "Token rejected — paste a fresh one"); }
      finally { setLoading(false); }
      return;
    }

    if (!saJson.trim()) { setLocalError("Service account JSON key is required"); return; }
    try { JSON.parse(saJson.trim()); } catch { setLocalError("Invalid JSON — upload the .json key file or paste the full contents"); return; }
    setLoading(true);
    try {
      await connectGeminiEnterprise({
        service_account_json: saJson.trim(), gcp_project_id: projectId.trim(), engine_id: engineId.trim(),
        location: location.trim() || undefined, collection: collection.trim() || undefined, admin_email: adminEmail.trim() || undefined,
      });
      onClose();
    } catch (err) { setLocalError(err.message || "Failed to connect"); }
    finally { setLoading(false); }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "flex", gap: 2, marginBottom: 14, background: "#f3f4f6", borderRadius: 8, padding: 2 }}>
        {[{ id: "token", label: "Access Token (quick)" }, { id: "sa", label: "Service Account" }].map((m) => {
          const active = authMode === m.id;
          return (
            <button key={m.id} type="button" onClick={() => { setAuthMode(m.id); setLocalError(null); }}
              style={{ flex: 1, padding: "8px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit", background: active ? "#fff" : "transparent", color: active ? GE_COLOR : "#666", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
              {m.label}
            </button>
          );
        })}
      </div>

      {authMode === "token" ? (
        <div className="ag_form_group">
          <label className="ag_form_label">Access Token <span style={{ color: "#ef4444" }}>*</span></label>
          <textarea placeholder="Paste output of: gcloud auth print-access-token" value={accessToken}
            onChange={(e) => { setAccessToken(e.target.value); setLocalError(null); }}
            className="ag_form_input" style={{ minHeight: 70, fontFamily: "monospace", fontSize: 11, resize: "vertical" }} />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>In Cloud Shell run <code>gcloud auth print-access-token</code>. Works ~1h; paste a fresh one when it expires.</div>
        </div>
      ) : (
        <div className="ag_form_group">
          <label className="ag_form_label">Service Account JSON Key <span style={{ color: "#ef4444" }}>*</span></label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button type="button" onClick={() => fileInputRef.current?.click()}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: GE_COLOR, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              <Upload size={12} /> Upload .json file
            </button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={handleFileUpload} />
            {uploadedFileName && <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#16a34a" }}><CheckCircle size={12} /> {uploadedFileName}</span>}
          </div>
          <textarea placeholder="Upload the .json file above — or paste the full contents here" value={saJson}
            onChange={(e) => { setSaJson(e.target.value); setLocalError(null); parseJsonHints(e.target.value); }}
            className="ag_form_input" style={{ minHeight: 90, fontFamily: "monospace", fontSize: 11, resize: "vertical" }} />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Needs the <strong>Discovery Engine Viewer</strong> role on the project.</div>
        </div>
      )}

      <div className="ag_form_group">
        <label className="ag_form_label">Gemini Enterprise App ID (engine ID) <span style={{ color: "#ef4444" }}>*</span>
          <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>e.g. agentspace-engine</span>
        </label>
        <input type="text" placeholder="e.g. agentspace-engine" value={engineId} onChange={(e) => setEngineId(e.target.value)} className="ag_form_input" autoComplete="off" />
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div className="ag_form_group" style={{ flex: 1 }}>
          <label className="ag_form_label">Location</label>
          <input type="text" placeholder="global" value={location} onChange={(e) => setLocation(e.target.value)} className="ag_form_input" autoComplete="off" />
        </div>
        <div className="ag_form_group" style={{ flex: 1 }}>
          <label className="ag_form_label">Collection</label>
          <input type="text" placeholder="default_collection" value={collection} onChange={(e) => setCollection(e.target.value)} className="ag_form_input" autoComplete="off" />
        </div>
      </div>

      <div className="ag_form_group">
        <label className="ag_form_label">GCP Project ID <span style={{ color: "#ef4444" }}>*</span>
          <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>e.g. the-dispatch-0vzc3</span>
        </label>
        <input type="text" placeholder="e.g. the-dispatch-0vzc3" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ag_form_input" autoComplete="off" />
      </div>

      {localError && (
        <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>{localError}</div>
      )}

      <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: GE_COLOR }}>
        {loading ? "Verifying & Connecting..." : (authMode === "token" ? "Connect with Token" : "Connect & Verify")}
      </button>
    </form>
  );
}

// ── AWS Tab ──

const AWS_COLOR = "#FF9900";

function AWSForm({ onClose }) {
  const { connectAWS, awsKeyId } = useAgentAuth();
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [accountId, setAccountId] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [showScopes, setShowScopes] = useState(false);
  const [savedKey, setSavedKey] = useState(null);
  const [changeKey, setChangeKey] = useState(false);

  const isAlreadyConnected = !!awsKeyId;

  useEffect(() => {
    agentGovernanceApi.listOAuthKeys().then((keys) => {
      if (keys && keys.length > 0) {
        const aKey = keys.find((k) => k.vendor === "aws");
        if (aKey) setSavedKey(aKey);
      }
    }).catch(() => {});
  }, []);

  const hasSavedKey = !!savedKey && !changeKey;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (hasSavedKey) {
      setLoading(true);
      try {
        await connectAWS("__USE_EXISTING__", "", region);
        onClose();
      } catch (err) {
        setLocalError(err.message || "Failed to reconnect");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!accessKeyId.trim()) { setLocalError("Access Key ID is required"); return; }
    if (!secretAccessKey.trim()) { setLocalError("Secret Access Key is required"); return; }
    if (!region) { setLocalError("Region is required"); return; }

    setLoading(true);
    try {
      await connectAWS(accessKeyId.trim(), secretAccessKey.trim(), region, accountId.trim() || undefined);
      onClose();
    } catch (err) {
      setLocalError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {savedKey && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#fff8f0", border: "1px solid #ffe0b2", borderRadius: 8 }}>
          <CheckCircle size={16} color={AWS_COLOR} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#7c4a03" }}>AWS credentials saved</div>
            <div style={{ fontSize: 11, color: "#9a6700" }}>Key stored securely — ready to scan Bedrock &amp; SageMaker</div>
          </div>
          {!changeKey && (
            <button type="button" onClick={() => setChangeKey(true)}
              style={{ background: "none", border: "1px solid #ffe0b2", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#7c4a03", cursor: "pointer", fontFamily: "inherit" }}>
              Change
            </button>
          )}
        </div>
      )}

      <button type="button" onClick={() => setShowScopes(!showScopes)}
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", background: "rgba(255,153,0,0.06)", border: "1px solid rgba(255,153,0,0.25)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, fontWeight: 500, color: AWS_COLOR, cursor: "pointer", fontFamily: "inherit" }}>
        {showScopes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        What this connection discovers
      </button>

      {showScopes && (
        <div style={{ marginBottom: 14, border: "1px solid rgba(255,153,0,0.25)", borderRadius: 8, overflow: "hidden" }}>
          {AWS_SCOPE_ITEMS.map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(0,0,0,0.04)", fontSize: 11 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{item.label}</span>
              <span style={{ color: AWS_COLOR, fontFamily: "monospace", fontSize: 10 }}>{item.perm}</span>
            </div>
          ))}
          <div style={{ padding: "8px 12px", fontSize: 10, color: "#999", background: "#fafafa" }}>
            Requires an IAM user or role with Bedrock and SageMaker read permissions.
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ag_form_group">
          <label className="ag_form_label">Access Key ID <span style={{ color: "#ef4444" }}>*</span></label>
          {hasSavedKey ? (
            <div className="ag_form_input" style={{ color: "#999", background: "#f9fafb" }}>••••••••••••••••••••</div>
          ) : (
            <input
              type="text"
              placeholder="AKIAIOSFODNN7EXAMPLE"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              className="ag_form_input"
              autoComplete="off"
            />
          )}
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">Secret Access Key <span style={{ color: "#ef4444" }}>*</span></label>
          {hasSavedKey ? (
            <div className="ag_form_input" style={{ color: "#999", background: "#f9fafb" }}>••••••••••••••••••••</div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                type={showSecret ? "text" : "password"}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                className="ag_form_input"
                style={{ paddingRight: 40 }}
                autoComplete="off"
              />
              <button type="button" onClick={() => setShowSecret(!showSecret)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#999", cursor: "pointer", padding: 4 }}>
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          )}
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">Region <span style={{ color: "#ef4444" }}>*</span></label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="ag_form_input"
            style={{ cursor: "pointer" }}
          >
            {AWS_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label} ({r.value})</option>
            ))}
          </select>
        </div>

        <div className="ag_form_group">
          <label className="ag_form_label">Account ID <span style={{ color: "#999", fontWeight: 400 }}>(optional)</span></label>
          <input
            type="text"
            placeholder="123456789012"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="ag_form_input"
            autoComplete="off"
          />
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            AWS Console &rarr; IAM &rarr; Security Credentials &rarr; Access Keys
          </div>
        </div>

        {localError && (
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
            {localError}
          </div>
        )}

        <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: AWS_COLOR }}>
          {loading ? "Verifying & Connecting..." : hasSavedKey ? "Reconnect with Saved Key" : isAlreadyConnected ? "Update Credentials" : "Connect & Verify"}
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
  const openaiTabActive = activeTab === "openai";
  const claudeTabActive = activeTab === "claude";
  const geminiTabActive = activeTab === "gemini_enterprise";
  const awsTabActive = activeTab === "aws";

  return (
    <div className="ag_modal_overlay" onClick={onClose}>
      <div className="ag_modal_content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="ag_modal_header">
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              {isUpdateMode ? "Update Connection" : "Connect AI Platform"}
            </h2>
            <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0 0" }}>
              Connect Microsoft 365, Google Cloud, ChatGPT, Claude, or AWS for agent discovery
            </p>
          </div>
          <button onClick={onClose} className="ag_modal_close"><X size={18} /></button>
        </div>

        {/* Platform Tabs — 2 rows x 3 columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, marginBottom: 16, background: "#f3f4f6", borderRadius: 8, padding: 2 }}>
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
          <button type="button" onClick={() => setActiveTab("openai")}
            style={{
              ...TAB_STYLE_BASE,
              background: openaiTabActive ? "#fff" : "transparent",
              color: openaiTabActive ? "#10a37f" : "#666",
              boxShadow: openaiTabActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              borderRadius: 6,
            }}>
            <Bot size={14} color={openaiTabActive ? "#10a37f" : "#999"} />
            ChatGPT
          </button>
          <button type="button" onClick={() => setActiveTab("claude")}
            style={{
              ...TAB_STYLE_BASE,
              background: claudeTabActive ? "#fff" : "transparent",
              color: claudeTabActive ? "#D4622A" : "#666",
              boxShadow: claudeTabActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              borderRadius: 6,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill={claudeTabActive ? "#D4622A" : "#999"} />
              <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#fff">C</text>
            </svg>
            Claude
          </button>
          <button type="button" onClick={() => setActiveTab("gemini_enterprise")}
            style={{
              ...TAB_STYLE_BASE,
              background: geminiTabActive ? "#fff" : "transparent",
              color: geminiTabActive ? "#886FBF" : "#666",
              boxShadow: geminiTabActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              borderRadius: 6,
            }}>
            <Sparkles size={14} color={geminiTabActive ? "#886FBF" : "#999"} />
            Gemini Enterprise
          </button>
          <button type="button" onClick={() => setActiveTab("aws")}
            style={{
              ...TAB_STYLE_BASE,
              background: awsTabActive ? "#fff" : "transparent",
              color: awsTabActive ? "#FF9900" : "#666",
              boxShadow: awsTabActive ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              borderRadius: 6,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M8.1 14.4c0 .2.1.4.2.5.1.2.2.3.3.4.1 0 .1.1.1.2s-.1.1-.2.2l-.8.5c-.1.1-.2.1-.3.1-.1 0-.2-.1-.3-.2-.1-.2-.3-.3-.4-.5-.1-.2-.2-.3-.3-.5-1 1.1-2.1 1.7-3.5 1.7-1 0-1.8-.3-2.4-.9-.6-.6-.9-1.3-.9-2.3 0-1 .4-1.8 1.1-2.4.7-.6 1.7-.9 2.9-.9.4 0 .8 0 1.3.1.5.1.9.2 1.4.3v-.8c0-.9-.2-1.5-.5-1.9-.4-.4-1-.6-1.9-.6-.4 0-.8.1-1.3.2-.4.1-.9.3-1.3.5-.2.1-.3.1-.4.2h-.2c-.2 0-.2-.1-.2-.4v-.6c0-.2 0-.3.1-.4.1-.1.2-.2.4-.3.4-.2 1-.4 1.5-.5.6-.2 1.2-.2 1.8-.2 1.4 0 2.4.3 3 .9.6.6.9 1.5.9 2.8v3.6h.1zm-4.8 1.8c.4 0 .8-.1 1.2-.2.4-.2.8-.4 1-.8.1-.2.2-.4.3-.7 0-.2.1-.5.1-.9v-.4c-.3-.1-.7-.2-1.1-.3-.4-.1-.7-.1-1.1-.1-.8 0-1.4.2-1.8.5-.4.3-.6.8-.6 1.4 0 .6.1 1 .4 1.3.3.3.8.5 1.4.5l.2-.3z" fill={awsTabActive ? "#FF9900" : "#999"} />
              <path d="M14.8 16.2c-.2 0-.3 0-.4-.1-.1-.1-.2-.3-.3-.5l-3-9.8v-.3c0-.2.1-.3.3-.3h1.2c.2 0 .3 0 .4.1.1.1.2.3.2.5l2.1 8.3 2-8.3c.1-.3.1-.4.2-.5.1-.1.3-.1.4-.1h1c.2 0 .3 0 .4.1.1.1.2.3.2.5l2 8.4 2.2-8.4c.1-.3.1-.4.2-.5.1-.1.3-.1.4-.1h1.1c.2 0 .3.1.3.3 0 .1 0 .1 0 .2s0 .1-.1.2l-3.1 9.8c-.1.3-.1.4-.3.5-.1.1-.3.1-.4.1h-1.1c-.2 0-.3 0-.4-.1-.1-.1-.2-.3-.2-.5l-2-8.1-1.9 8.1c-.1.3-.1.4-.2.5-.1.1-.3.1-.4.1h-1.1l.2.1z" fill={awsTabActive ? "#FF9900" : "#999"} />
              <path d="M23.3 18.1c-3 2.2-7.4 3.4-11.2 3.4-5.3 0-10.1-2-13.7-5.2-.3-.3 0-.6.3-.4 3.9 2.3 8.7 3.6 13.7 3.6 3.4 0 7-.7 10.4-2.1.5-.3.9.3.5.7z" fill={awsTabActive ? "#FF9900" : "#999"} />
              <path d="M24.5 16.7c-.4-.5-2.5-.2-3.5-.1-.3 0-.3-.2-.1-.4 1.7-1.2 4.5-.8 4.8-.4.3.4-.1 3.1-1.7 4.4-.2.2-.5.1-.4-.2.4-.9 1.2-2.9.9-3.3z" fill={awsTabActive ? "#FF9900" : "#999"} />
            </svg>
            AWS
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "microsoft" && <MicrosoftForm onClose={onClose} mode={mode} />}
        {activeTab === "google" && <GoogleForm onClose={onClose} mode={mode} />}
        {activeTab === "openai" && <OpenAIForm onClose={onClose} />}
        {activeTab === "claude" && <ClaudeForm onClose={onClose} />}
        {activeTab === "gemini_enterprise" && <GeminiEnterpriseForm onClose={onClose} />}
        {activeTab === "aws" && <AWSForm onClose={onClose} />}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 11, color: "#999" }}>
          <Lock size={12} />
          Credentials encrypted at rest (AES-256-GCM). Data stays in your infrastructure.
        </div>
      </div>
    </div>
  );
}
