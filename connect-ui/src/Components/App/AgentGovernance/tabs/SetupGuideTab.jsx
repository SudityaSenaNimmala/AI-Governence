import { Section } from "../common/Section";

const CodeBlock = ({ code }) => (
  <pre style={{ background: "#1e1e2e", color: "#cdd6f4", padding: 16, borderRadius: 8, fontSize: 12, overflowX: "auto", lineHeight: 1.5, margin: "8px 0" }}>
    <code>{code}</code>
  </pre>
);

const P = ({ children }) => (
  <p style={{ color: "var(--ag-text-secondary)", fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>{children}</p>
);

export function SetupGuideTab() {
  return (
    <div>
      <Section title="Step 1: Register App in Microsoft Entra ID">
        <P>
          Go to{" "}
          <a href="https://entra.microsoft.com" target="_blank" rel="noreferrer" style={{ color: "#6366f1" }}>entra.microsoft.com</a>
          {" "}&rarr; App registrations &rarr; New registration.
        </P>
        <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div><strong>Name:</strong> CloudFuze Agent Governance</div>
            <div><strong>Account types:</strong> Accounts in any organizational directory (multi-tenant)</div>
            <div><strong>Platform:</strong> Web (NOT SPA &mdash; uses client credentials)</div>
            <div><strong>Redirect URI:</strong> http://localhost:3000 (optional)</div>
          </div>
        </div>
        <P>Under <strong>Certificates &amp; secrets</strong>, create a new client secret and copy the value immediately (it won't be shown again).</P>
      </Section>

      <Section title="Step 2: Configure API Permissions">
        <P>Add these <strong>Application</strong> permissions (NOT Delegated):</P>
        <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <table style={{ fontSize: 12, width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--ag-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>API</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Permission</th>
                <th style={{ textAlign: "left", padding: "6px 10px", color: "#666" }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {[
                { api: "Microsoft Graph", perm: "Application.Read.All", purpose: "Read app registrations and service principals" },
                { api: "Microsoft Graph", perm: "User.Read.All", purpose: "Resolve agent owners via Entra ID" },
                { api: "Microsoft Graph", perm: "Sites.Read.All", purpose: "SharePoint agent discovery (beta API)" },
                { api: "Microsoft Graph", perm: "AuditLog.Read.All", purpose: "Sign-in logs (requires E3/E5)" },
                { api: "Microsoft Graph", perm: "Directory.Read.All", purpose: "Tenant info and directory data" },
                { api: "Dynamics CRM", perm: "user_impersonation", purpose: "Read Copilot Studio bots from Dataverse" },
                { api: "O365 Mgmt APIs", perm: "ActivityFeed.Read", purpose: "Audit event ingestion (E3/E5)" },
              ].map((p) => (
                <tr key={p.perm} style={{ borderBottom: "1px solid var(--ag-border)" }}>
                  <td style={{ padding: "6px 10px", color: "#666", fontSize: 11 }}>{p.api}</td>
                  <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#6366f1" }}>{p.perm}</td>
                  <td style={{ padding: "6px 10px", color: "#666" }}>{p.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>After adding permissions, click <strong>"Grant admin consent for [tenant]"</strong> (requires Global Admin or Privileged Role Administrator).</P>
      </Section>

      <Section title="Step 3: Register as Application User in Power Platform">
        <P>This step is required for Copilot Studio agent discovery via Dataverse:</P>
        <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <ol style={{ fontSize: 12, color: "#666", lineHeight: 2, paddingLeft: 20 }}>
            <li>Go to <strong>Power Platform Admin Center</strong> &rarr; Environments &rarr; select your environment</li>
            <li>Go to <strong>Settings</strong> &rarr; Users + permissions &rarr; <strong>Application users</strong></li>
            <li>Click <strong>"+ New app user"</strong></li>
            <li>Select your Entra app registration (CloudFuze Agent Governance)</li>
            <li>Assign the <strong>System Administrator</strong> security role</li>
          </ol>
        </div>
        <div style={{ background: "#f59e0b11", border: "1px solid #f59e0b33", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>Why System Administrator?</div>
          <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6 }}>
            This is the minimum Power Platform role that provides read access to the bot entity table in Dataverse.
            Microsoft does not offer a more granular read-only alternative for this data.
          </div>
        </div>
      </Section>

      <Section title="Step 4: (Optional) Azure AI Foundry Access">
        <P>To discover Azure AI Foundry agents, assign the Reader RBAC role:</P>
        <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <ol style={{ fontSize: 12, color: "#666", lineHeight: 2, paddingLeft: 20 }}>
            <li>Go to <strong>Azure Portal</strong> &rarr; Subscriptions &rarr; select your subscription</li>
            <li>Go to <strong>Access control (IAM)</strong> &rarr; <strong>Add role assignment</strong></li>
            <li>Role: <strong>Reader</strong></li>
            <li>Assign to: your app registration (search by name or client ID)</li>
          </ol>
        </div>
      </Section>

      <Section title="Step 5: Connect & Run Discovery">
        <P>Once the app is registered and permissions are granted:</P>
        <div style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14 }}>
          <ol style={{ fontSize: 12, color: "#666", lineHeight: 2, paddingLeft: 20 }}>
            <li>Click <strong>"+ Connect Tenant"</strong> in the Agent Governance page header</li>
            <li>Enter your <strong>Tenant ID</strong>, <strong>Client ID</strong>, and <strong>Client Secret</strong></li>
            <li>Enter your <strong>Dataverse Environment URL</strong> (from Power Platform Admin Center)</li>
            <li>Click <strong>"Connect &amp; Scan"</strong></li>
            <li>The scan takes 10-30 seconds depending on tenant size</li>
            <li>Review discovered agents across all sources in the Discovery tab</li>
            <li>Go to <strong>Policies</strong> tab &rarr; click <strong>"Load Templates"</strong> to set up governance policies</li>
            <li>Click <strong>"Run Policy Check"</strong> to evaluate all agents against active policies</li>
          </ol>
        </div>
      </Section>

      <Section title="Discovery Sources">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          {[
            { source: "Copilot Studio (Dataverse)", desc: "Primary source: bot entity table. Discovers agents with metadata, owner, status, LLM config.", api: "/api/data/v9.2/bots", status: "stable" },
            { source: "SharePoint Agents (Graph Beta)", desc: "Embedded Copilot agents in SharePoint sites. Beta API.", api: "/beta/sites/{id}/copilot/agents", status: "beta" },
            { source: "Azure AI Foundry", desc: "ML workspaces and deployed AI models. Requires Azure Reader RBAC.", api: "management.azure.com/...workspaces", status: "stable" },
            { source: "Power Platform Connectors", desc: "Connector types per environment. Used for risk scoring.", api: "api.powerapps.com/.../connections", status: "stable" },
            { source: "O365 Audit Events", desc: "CopilotStudio and PowerApps workload events. Requires E3/E5.", api: "manage.office.com/.../activity/feed", status: "stable" },
            { source: "Tenant Users (Graph)", desc: "User directory for owner resolution and orphan detection.", api: "/v1.0/users", status: "stable" },
          ].map((s) => (
            <div key={s.source} style={{ background: "var(--ag-bg-card)", border: "1px solid var(--ag-border)", borderRadius: 8, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#6366f1" }}>{s.source}</span>
                <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: s.status === "beta" ? "#f59e0b22" : "#22c55e22", color: s.status === "beta" ? "#f59e0b" : "#22c55e" }}>{s.status}</span>
              </div>
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 6 }}>{s.desc}</div>
              <div style={{ fontSize: 10, fontFamily: "monospace", color: "#6366f1" }}>{s.api}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
