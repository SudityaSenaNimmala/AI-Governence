import { Section } from "../common/Section";

const P = ({ children }) => (
  <p style={{ color: "var(--ag-text-secondary)", fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>{children}</p>
);

const Card = ({ children, style }) => (
  <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14, marginBottom: 12, ...style }}>
    {children}
  </div>
);

const Callout = ({ tone = "warn", title, children }) => {
  const colors = {
    warn: { bg: "#f59e0b11", border: "#f59e0b33", heading: "#f59e0b" },
    info: { bg: "#4285F411", border: "#4285F433", heading: "#4285F4" },
    danger: { bg: "#ef444411", border: "#ef444433", heading: "#ef4444" },
  }[tone];
  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.heading, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
};

export function GoogleSetupGuideTab() {
  return (
    <div>
      <Section title="Step 1: Create GCP Project & Service Account">
        <P>
          Open{" "}
          <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" style={{ color: "#4285F4" }}>console.cloud.google.com</a>
          {" "}&rarr; select or create a project that will host the governance service account.
        </P>
        <Card>
          <ol style={{ fontSize: 12, color: "#666", lineHeight: 2, paddingLeft: 20 }}>
            <li>Go to <strong>IAM &amp; Admin</strong> &rarr; <strong>Service Accounts</strong> &rarr; <strong>+ Create Service Account</strong></li>
            <li><strong>Name:</strong> CloudFuze Agent Governance</li>
            <li><strong>Service account ID:</strong> cloudfuze-agent-governance</li>
            <li>Skip optional role grants on this screen &mdash; we'll add roles in Step 4</li>
            <li>Click <strong>Done</strong> to create the account</li>
          </ol>
        </Card>
        <P>
          Open the new service account &rarr; <strong>Keys</strong> tab &rarr; <strong>Add Key</strong> &rarr;{" "}
          <strong>Create new key</strong> &rarr; <strong>JSON</strong>. The .json file downloads once &mdash; store it securely,
          it cannot be re-downloaded.
        </P>
        <Callout tone="warn" title="Record the Client ID (numeric)">
          Also copy the service account's numeric <strong>Unique ID / OAuth client ID</strong> (visible on the Details tab).
          You'll need it in Step 3 for Domain-Wide Delegation.
        </Callout>
      </Section>

      <Section title="Step 2: Enable Required Google APIs">
        <P>Under <strong>APIs &amp; Services</strong> &rarr; <strong>Library</strong>, enable each API:</P>
        <Card>
          <table style={{ fontSize: 12, width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>API</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                { api: "Admin SDK API", purpose: "User directory, OAuth token audit, usage & audit reports" },
                { api: "Google Chat API", purpose: "Discover Chat bots and spaces" },
                { api: "Vertex AI API (aiplatform.googleapis.com)", purpose: "Reasoning Engines, model endpoints, tuned Gemini models" },
                { api: "Discovery Engine API", purpose: "Gemini Agent Builder apps and data stores" },
                { api: "Apps Script API", purpose: "Script-based bots and automations" },
                { api: "Google Drive API", purpose: "Gemini Gems discovery and shared file inventory" },
                { api: "Cloud Logging API", purpose: "Activity, invocations, and audit logs" },
                { api: "Cloud Monitoring API", purpose: "Cost and usage metrics for AI workloads" },
                { api: "Service Usage API", purpose: "List enabled AI APIs per project" },
                { api: "Enterprise License Manager API", purpose: "Gemini for Workspace license detection" },
                { api: "Google Vault API", purpose: "(Optional) eDiscovery and retention holds" },
              ].map((row) => (
                <tr key={row.api} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#4285F4", fontSize: 11 }}>{row.api}</td>
                  <td style={{ padding: "6px 10px", color: "#666" }}>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Step 3: Configure Domain-Wide Delegation (Workspace Admin)">
        <P>
          Workspace-scoped APIs (Admin SDK, Chat, Drive, Apps Script, Vault) require the service account to impersonate
          a Workspace admin. Enable Domain-Wide Delegation in the Google Workspace Admin Console.
        </P>
        <Card>
          <ol style={{ fontSize: 12, color: "#666", lineHeight: 2, paddingLeft: 20 }}>
            <li>Go to{" "}
              <a href="https://admin.google.com" target="_blank" rel="noreferrer" style={{ color: "#4285F4" }}>admin.google.com</a>
              {" "}&rarr; <strong>Security</strong> &rarr; <strong>Access and data control</strong> &rarr; <strong>API controls</strong></li>
            <li>Click <strong>Manage Domain Wide Delegation</strong> &rarr; <strong>Add new</strong></li>
            <li><strong>Client ID:</strong> paste the numeric service account Unique ID from Step 1</li>
            <li><strong>OAuth scopes:</strong> paste the comma-separated list below (exact strings, no spaces after commas)</li>
            <li>Click <strong>Authorize</strong></li>
          </ol>
        </Card>
        <P>Add these <strong>read-only</strong> OAuth scopes &mdash; all are required for full discovery:</P>
        <Card>
          <table style={{ fontSize: 11, width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Scope</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                { scope: "https://www.googleapis.com/auth/admin.directory.user.readonly", purpose: "User directory & owner resolution" },
                { scope: "https://www.googleapis.com/auth/admin.directory.user.security", purpose: "OAuth token audit (3rd-party AI apps)" },
                { scope: "https://www.googleapis.com/auth/admin.directory.customer.readonly", purpose: "Tenant / customer metadata" },
                { scope: "https://www.googleapis.com/auth/admin.reports.audit.readonly", purpose: "Audit logs (logins, Gemini usage, token grants)" },
                { scope: "https://www.googleapis.com/auth/admin.reports.usage.readonly", purpose: "Per-user activity & Gemini usage metrics" },
                { scope: "https://www.googleapis.com/auth/chat.spaces.readonly", purpose: "Chat spaces & bot discovery" },
                { scope: "https://www.googleapis.com/auth/chat.memberships.readonly", purpose: "Chat membership for activity attribution" },
                { scope: "https://www.googleapis.com/auth/chat.admin.spaces.readonly", purpose: "Chat admin view — required to resolve bot/app names" },
                { scope: "https://www.googleapis.com/auth/chat.admin.memberships.readonly", purpose: "Chat admin memberships — required to resolve bot/app names" },
                { scope: "https://www.googleapis.com/auth/chat.messages.readonly", purpose: "Read Chat messages — required to resolve bot display names from message senders" },
                { scope: "https://www.googleapis.com/auth/drive.readonly", purpose: "Gemini Gems & shared file inventory" },
                { scope: "https://www.googleapis.com/auth/script.projects.readonly", purpose: "Apps Script projects" },
                { scope: "https://www.googleapis.com/auth/script.deployments.readonly", purpose: "Apps Script deployments" },
                { scope: "https://www.googleapis.com/auth/apps.licensing", purpose: "Gemini for Workspace license assignments" },
                { scope: "https://www.googleapis.com/auth/ediscovery", purpose: "(Optional) Google Vault holds & matters" },
              ].map((row) => (
                <tr key={row.scope} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#4285F4", fontSize: 10 }}>{row.scope}</td>
                  <td style={{ padding: "6px 10px", color: "#666" }}>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Callout tone="warn" title="Why a Workspace Admin email is required">
          Workspace APIs don't support pure service-account access &mdash; the service account must impersonate a human
          Super Admin (or delegated admin with matching privileges). Enter that admin's email during the Connect step
          so the tool can exchange JWTs for scoped access tokens.
        </Callout>
      </Section>

      <Section title="Step 4: Grant IAM Roles for GCP Discovery (Vertex AI, Logging, Monitoring)">
        <P>
          GCP-scoped APIs (Vertex AI, Agent Builder, Cloud Logging) use the service account's own identity &mdash; no
          impersonation. Grant least-privilege IAM roles on each project you want scanned.
        </P>
        <Card>
          <table style={{ fontSize: 12, width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Role</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                { role: "roles/aiplatform.viewer", purpose: "Vertex AI endpoints, reasoning engines, tuned models" },
                { role: "roles/discoveryengine.viewer", purpose: "Gemini Agent Builder apps & data stores" },
                { role: "roles/logging.viewer", purpose: "Read audit & activity logs for invocations" },
                { role: "roles/monitoring.viewer", purpose: "Cost & usage metrics" },
                { role: "roles/serviceusage.serviceUsageViewer", purpose: "List enabled AI APIs per project" },
                { role: "roles/iam.securityReviewer", purpose: "Review IAM policy bindings on AI resources" },
                { role: "roles/browser", purpose: "Project / folder / organization metadata resolution" },
              ].map((row) => (
                <tr key={row.role} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#4285F4" }}>{row.role}</td>
                  <td style={{ padding: "6px 10px", color: "#666" }}>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Callout tone="info" title="Scan multiple projects">
          Grant the roles at the <strong>Organization</strong> or <strong>Folder</strong> level to discover agents
          across every project in one scan. Leave the GCP Project ID empty on the Connect screen to enumerate all
          accessible projects.
        </Callout>
      </Section>

      <Section title="Step 5: (Optional) Gemini for Workspace License Check">
        <P>
          To flag users licensed for Gemini (Duet AI) in Gmail, Docs, Meet, etc., the service account already has the{" "}
          <code style={{ fontFamily: "monospace", color: "#4285F4" }}>apps.licensing</code> scope from Step 3.
          No extra setup is required &mdash; license data is pulled via the Enterprise License Manager API.
        </P>
      </Section>

      <Section title="Step 6: Connect & Run Discovery">
        <P>Once the service account is ready, DWD is configured, and IAM roles are granted:</P>
        <Card>
          <ol style={{ fontSize: 12, color: "#666", lineHeight: 2, paddingLeft: 20 }}>
            <li>Click <strong>"+ Connect Platform"</strong> in the Agent Governance page header</li>
            <li>Switch to the <strong>Google Cloud</strong> tab</li>
            <li>Upload your <strong>Service Account JSON key</strong> (or paste its contents)</li>
            <li>Enter the <strong>Workspace Admin Email</strong> (Super Admin the service account will impersonate)</li>
            <li>Optionally enter a <strong>GCP Project ID</strong> &mdash; leave blank to scan all accessible projects</li>
            <li>Click <strong>"Connect &amp; Verify"</strong> &mdash; credentials are validated against each API</li>
            <li>Click <strong>"Run Scan"</strong>. The scan fires 5 parallel platform calls (Reasoning Engines, Agent Builder, Chat, Gems, NotebookLM) and typically takes 15&ndash;40 seconds</li>
            <li>Review agents, users, and risk signals in <strong>Discovery</strong>, <strong>User Activity</strong>, and <strong>Overview</strong> tabs</li>
            <li>Load policy templates in <strong>Policies</strong> &rarr; click <strong>"Run Policy Check"</strong> to evaluate agents</li>
          </ol>
        </Card>
      </Section>

      <Section title="Discovery Sources">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {[
            { source: "OAuth Token Audit (Admin SDK)", desc: "Third-party AI apps users granted access to. Detects sensitive scope grants (Gmail, Drive, Calendar) &mdash; primary signal for shadow AI.", api: "admin.googleapis.com/admin/directory/v1/users/{user}/tokens", status: "stable" },
            { source: "Google Chat Bots", desc: "Chat apps, bots, and DM bots across Workspace. Flags externally-allowed spaces.", api: "chat.googleapis.com/v1/spaces", status: "stable" },
            { source: "Vertex AI Reasoning Engines", desc: "Deployed agentic engines &mdash; the primary Vertex Agent surface.", api: "aiplatform.googleapis.com/.../reasoningEngines", status: "stable" },
            { source: "Gemini Agent Builder", desc: "Discovery Engine apps with connected data stores. Highest risk (grounded on corpora).", api: "discoveryengine.googleapis.com/.../engines", status: "stable" },
            { source: "Gemini Gems (Drive)", desc: "Personal & shared custom Gems. Shared Gems are scored higher for multi-user exposure.", api: "drive.googleapis.com/v3/files?q=mimeType=gem", status: "stable" },
            { source: "NotebookLM Enterprise", desc: "Personal knowledge notebooks with uploaded sources. Flags sensitive content.", api: "notebooklm.googleapis.com (+ Drive fallback)", status: "beta" },
            { source: "Apps Script", desc: "Script-based automations and bots, including deployments.", api: "script.googleapis.com/v1/projects", status: "stable" },
            { source: "Tuned Gemini Models", desc: "Custom / fine-tuned Gemini models per project.", api: "aiplatform.googleapis.com/.../tunedModels", status: "stable" },
            { source: "Admin Reports (Audit & Usage)", desc: "Per-user Gemini activity, invocations, login signals.", api: "admin.googleapis.com/admin/reports/v1/activity", status: "stable" },
            { source: "Cloud Logging", desc: "Real invocation counts and API-level usage for Vertex / Agent Builder.", api: "logging.googleapis.com/v2/entries:list", status: "stable" },
            { source: "Gemini for Workspace Licenses", desc: "Assigned Duet AI / Gemini SKUs per user for cost & coverage analysis.", api: "licensing.googleapis.com/apps/licensing/v1", status: "stable" },
            { source: "Google Vault (Optional)", desc: "eDiscovery matters and holds covering Gemini/Chat data.", api: "vault.googleapis.com/v1/matters", status: "optional" },
          ].map((s) => (
            <div key={s.source} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#4285F4" }}>{s.source}</span>
                <span style={{
                  fontSize: 9, padding: "1px 5px", borderRadius: 3,
                  background: s.status === "beta" ? "#f59e0b22" : s.status === "optional" ? "#6366f122" : "#22c55e22",
                  color: s.status === "beta" ? "#f59e0b" : s.status === "optional" ? "#6366f1" : "#22c55e",
                }}>{s.status}</span>
              </div>
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 6 }}>{s.desc}</div>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#4285F4" }}>{s.api}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Risk Signals Scored for Google Workspace">
        <P>
          Each discovered Google agent / OAuth grant is scored on a 0&ndash;100 scale where lower means higher risk.
          The engine looks for the following Google-specific signals:
        </P>
        <Card>
          <table style={{ fontSize: 12, width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Signal</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Weight</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Why it matters</th>
              </tr>
            </thead>
            <tbody>
              {[
                { signal: "Sensitive OAuth scopes granted", weight: "high", why: "gmail.*, drive, calendar, admin.directory.user &mdash; broad data-plane access" },
                { signal: "Agent Builder with data stores", weight: "high", why: "Grounded on corporate corpora &mdash; potential PII/PHI exposure" },
                { signal: "Externally-shared Chat space / bot", weight: "high", why: "External users can interact with or install the bot" },
                { signal: "Shared Gemini Gem", weight: "medium", why: "Custom Gem instructions accessible by multiple users" },
                { signal: "Stale agent (> 30 days inactive)", weight: "medium", why: "Unused agents retain scopes and are a prime abuse target" },
                { signal: "Orphaned owner (disabled user)", weight: "high", why: "Nobody accountable; remediation path unclear" },
                { signal: "Apps Script with HTTP triggers / external calls", weight: "medium", why: "Potential data egress channel" },
                { signal: "Sensitive keywords in name/description", weight: "low", why: "hr, payroll, credentials, confidential, etc." },
                { signal: "No governance policy applied", weight: "low", why: "Not yet covered by a CloudFuze policy rule" },
              ].map((row) => (
                <tr key={row.signal} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <td style={{ padding: "6px 10px", color: "#333", fontWeight: 500 }}>{row.signal}</td>
                  <td style={{ padding: "6px 10px" }}>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 3, fontWeight: 600,
                      background: row.weight === "high" ? "#ef444422" : row.weight === "medium" ? "#f59e0b22" : "#6366f122",
                      color: row.weight === "high" ? "#ef4444" : row.weight === "medium" ? "#f59e0b" : "#6366f1",
                    }}>{row.weight}</span>
                  </td>
                  <td style={{ padding: "6px 10px", color: "#666" }}>{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section title="Troubleshooting">
        <Callout tone="danger" title="401 / 403 on Admin SDK calls">
          The scope is probably missing from Domain-Wide Delegation or the admin email doesn't have rights.
          Re-check the <strong>numeric Client ID</strong> in <em>admin.google.com</em> &rarr; API controls &rarr;
          Domain Wide Delegation, and confirm the exact scope string is present.
        </Callout>
        <Callout tone="danger" title="403 PERMISSION_DENIED on Vertex AI / Logging">
          The service account is missing a GCP IAM role. Grant <code>roles/aiplatform.viewer</code> and{" "}
          <code>roles/logging.viewer</code> at the project (or org) level. Changes can take 1&ndash;2 minutes to propagate.
        </Callout>
        <Callout tone="warn" title="'No access to Apps Script' warning">
          Add <code>https://www.googleapis.com/auth/script.projects.readonly</code> to Domain-Wide Delegation &mdash;
          this scope is commonly missed because Apps Script isn't one of the default listed APIs.
        </Callout>
        <Callout tone="warn" title="Usage Reports fall back to audit logs">
          If <code>admin.reports.usage.readonly</code> isn't authorized, the scanner falls back to{" "}
          <code>admin.reports.audit.readonly</code>. Activity counts will be lower-resolution. Add the usage scope for best fidelity.
        </Callout>
      </Section>
    </div>
  );
}
