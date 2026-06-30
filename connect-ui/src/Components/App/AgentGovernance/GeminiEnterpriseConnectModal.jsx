import { useState, useRef, useEffect } from "react";
import { X, Upload, CheckCircle, Lock, Sparkles } from "lucide-react";
import { useAgentAuth } from "./AgentGovernanceContext";
import { agentGovernanceApi } from "./AgentGovernanceActions/AgentGovernanceActions";

const GE_COLOR = "#886FBF";

// Connect modal for Gemini Enterprise (business.gemini.google / Agentspace).
// Uses a dedicated service account + the app ID (the `cid` in the Gemini
// Enterprise URL) to fetch real agents, chats, knowledge and file activity.
export function GeminiEnterpriseConnectModal({ onClose }) {
  const { connectGeminiEnterprise, connectGeminiEnterpriseToken } = useAgentAuth();
  const [authMode, setAuthMode] = useState("sa"); // "sa" | "token"
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
  const [savedKey, setSavedKey] = useState(null);
  const [useSaved, setUseSaved] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    agentGovernanceApi.listOAuthKeys().then((keys) => {
      const k = (keys || []).find((x) => x.vendor === "gemini_enterprise");
      if (k) {
        setSavedKey(k);
        setProjectId(k.google_project_id || "");
        setAdminEmail(k.google_admin_email || "");
        setEngineId(k.gemini_engine_id || "");
        setLocation(k.gemini_location || "global");
        setCollection(k.gemini_collection || "default_collection");
        setUseSaved(true);
      }
    }).catch(() => {});
  }, []);

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
      if (typeof text === "string") {
        setSaJson(text.trim());
        setUseSaved(false);
        setLocalError(null);
        parseJsonHints(text);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    if (!engineId.trim()) { setLocalError("Gemini Enterprise app ID is required"); return; }
    if (!projectId.trim()) { setLocalError("GCP Project ID is required"); return; }

    // ── Access-token mode ──
    if (authMode === "token") {
      if (!accessToken.trim()) { setLocalError("Access token is required (run: gcloud auth print-access-token)"); return; }
      setLoading(true);
      try {
        const conn = {
          access_token: accessToken.trim(),
          project_id: projectId.trim(),
          engine_id: engineId.trim(),
          location: location.trim() || "global",
          collection: collection.trim() || "default_collection",
        };
        // Validate the token works before saving the connection
        await agentGovernanceApi.previewGeminiEnterprise(conn);
        connectGeminiEnterpriseToken(conn);
        onClose();
      } catch (err) {
        setLocalError(err.message || "Token rejected — paste a fresh one");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (useSaved && savedKey) {
      setLoading(true);
      try {
        const r = await connectGeminiEnterprise({
          service_account_json: "__USE_EXISTING__",
          gcp_project_id: projectId.trim() || undefined,
          engine_id: engineId.trim(),
          location: location.trim() || undefined,
          collection: collection.trim() || undefined,
          admin_email: adminEmail.trim() || undefined,
        });
        if (!r.verified) setLocalError(r.message || "Connected, but verification reported a warning.");
        else onClose();
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
      const r = await connectGeminiEnterprise({
        service_account_json: saJson.trim(),
        gcp_project_id: projectId.trim() || undefined,
        engine_id: engineId.trim(),
        location: location.trim() || undefined,
        collection: collection.trim() || undefined,
        admin_email: adminEmail.trim() || undefined,
      });
      if (!r.verified) setLocalError(r.message || "Connected, but verification reported a warning.");
      else onClose();
    } catch (err) {
      setLocalError(err.message || "Failed to connect");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ag_modal_overlay" onClick={onClose}>
      <div className="ag_modal_content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="ag_modal_header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles size={20} color={GE_COLOR} />
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Connect Gemini Enterprise</h2>
              <p style={{ fontSize: 12, color: "#999", margin: "4px 0 0 0" }}>
                business.gemini.google — discover agents, chats, knowledge files & activity
              </p>
            </div>
          </div>
          <button onClick={onClose} className="ag_modal_close"><X size={18} /></button>
        </div>

        {/* Auth mode toggle */}
        <div style={{ display: "flex", gap: 2, marginBottom: 16, background: "#f3f4f6", borderRadius: 8, padding: 2 }}>
          {[
            { id: "sa", label: "Service Account" },
            { id: "token", label: "Access Token (quick)" },
          ].map((m) => {
            const active = authMode === m.id;
            return (
              <button key={m.id} type="button" onClick={() => { setAuthMode(m.id); setLocalError(null); }}
                style={{
                  flex: 1, padding: "8px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: "none", cursor: "pointer", fontFamily: "inherit",
                  background: active ? "#fff" : "transparent",
                  color: active ? GE_COLOR : "#666",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}>
                {m.label}
              </button>
            );
          })}
        </div>

        {authMode === "token" && (
          <div style={{ marginBottom: 14, padding: 10, background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, fontSize: 11, color: "#5b21b6", lineHeight: 1.6 }}>
            Use this if you can&apos;t create a service account. In <strong>Cloud Shell</strong> run{" "}
            <code style={{ background: "#fff", padding: "1px 5px", borderRadius: 4 }}>gcloud auth print-access-token</code>{" "}
            and paste the result below. The token works for ~1 hour; paste a fresh one when it expires.
          </div>
        )}

        {savedKey && authMode === "sa" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8 }}>
            <CheckCircle size={16} color={GE_COLOR} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#5b21b6" }}>Gemini Enterprise credentials saved</div>
              <div style={{ fontSize: 11, color: "#6d28d9" }}>
                {savedKey.google_admin_email || "Service account stored"} &middot; app {savedKey.gemini_engine_id || "—"}
              </div>
            </div>
            {!useSaved && (
              <button type="button" onClick={() => setUseSaved(true)}
                style={{ background: "none", border: "1px solid #ddd6fe", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#5b21b6", cursor: "pointer", fontFamily: "inherit" }}>
                Use Saved
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {authMode === "token" && (
            <div className="ag_form_group">
              <label className="ag_form_label">Access Token <span style={{ color: "#ef4444" }}>*</span></label>
              <textarea
                placeholder="Paste the output of: gcloud auth print-access-token"
                value={accessToken}
                onChange={(e) => { setAccessToken(e.target.value); setLocalError(null); }}
                className="ag_form_input"
                style={{ minHeight: 70, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
              />
            </div>
          )}

          {authMode === "sa" && (
          <div className="ag_form_group">
            <label className="ag_form_label">Service Account JSON Key <span style={{ color: "#ef4444" }}>*</span></label>
            {useSaved && savedKey ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div className="ag_form_input" style={{ flex: 1, color: "#999", background: "#f9fafb", fontSize: 11 }}>
                  ••••••••  (saved credentials — key stored securely)
                </div>
                <button type="button" onClick={() => { setUseSaved(false); setSaJson(""); }}
                  style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "7px 14px", fontSize: 12, color: GE_COLOR, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  Change
                </button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: GE_COLOR, color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
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
                  placeholder="Upload the .json file above — or paste the full file contents here"
                  value={saJson}
                  onChange={(e) => { setSaJson(e.target.value); setUseSaved(false); setLocalError(null); parseJsonHints(e.target.value); }}
                  className="ag_form_input"
                  style={{ minHeight: 100, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
                />
                <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                  GCP Console → IAM &amp; Admin → Service Accounts → Keys → Add Key → JSON. Grant the
                  <strong> Discovery Engine Viewer</strong> role on the project.
                </div>
              </>
            )}
          </div>
          )}

          <div className="ag_form_group">
            <label className="ag_form_label">
              Gemini Enterprise App ID (engine ID) <span style={{ color: "#ef4444" }}>*</span>
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>e.g. agentspace-engine (NOT the cid)</span>
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
            <label className="ag_form_label">
              GCP Project ID <span style={{ color: "#ef4444" }}>*</span>
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>e.g. the-dispatch-0vzc3</span>
            </label>
            <input type="text" placeholder="e.g. my-project-123456" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ag_form_input" autoComplete="off" />
          </div>

          <div className="ag_form_group">
            <label className="ag_form_label">
              Admin Email
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>optional</span>
            </label>
            <input type="email" placeholder="e.g. admin@yourdomain.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="ag_form_input" autoComplete="off" />
          </div>

          {localError && (
            <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#ef4444", lineHeight: 1.5 }}>
              {localError}
            </div>
          )}

          <button type="submit" disabled={loading} className="ag_connect_btn" style={{ background: GE_COLOR }}>
            {loading ? "Verifying & Connecting..." : (authMode === "token" ? "Connect with Token" : (useSaved && savedKey ? "Reconnect with Saved Credentials" : "Connect & Verify"))}
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 11, color: "#999" }}>
          <Lock size={12} />
          Credentials encrypted at rest (AES-256-GCM). Data stays in your infrastructure.
        </div>
      </div>
    </div>
  );
}
