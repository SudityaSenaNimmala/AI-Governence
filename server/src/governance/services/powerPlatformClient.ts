/**
 * Power Platform Client — Connector & Environment discovery
 * Per PRD Section 4.1: Connector type and scope drive risk scoring
 * Per PRD Appendix A: https://api.powerapps.com/providers/Microsoft.PowerApps/environments/{env}/connections
 */

import type { PowerPlatformConnector, PowerPlatformEnvironment } from "../types/graph.js";

const PP_BASE = "https://api.powerapps.com";
const BAP_BASE = "https://api.bap.microsoft.com"; // Business Application Platform

export class PowerPlatformClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async fetchWithRetry(url: string, retries = 2): Promise<Response> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });

    if (response.status === 429 && retries > 0) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "5");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.fetchWithRetry(url, retries - 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new PowerPlatformError(response.status, body, url);
    }

    return response;
  }

  /**
   * List all Power Platform environments in the tenant
   * Per PRD: Support environment selection during onboarding. Default to production environments.
   */
  async listEnvironments(): Promise<PowerPlatformEnvironment[]> {
    // The admin scope is tried FIRST, and it is the one that works for us.
    //
    // `/providers/Microsoft.BusinessAppPlatform/environments` is caller-scoped: it
    // returns the environments the *identity making the call* has been given
    // access to. Our token is app-only, and a service principal is not a user with
    // environment membership, so that endpoint answers HTTP 200 `{"value":[]}` —
    // success with nothing in it. Discovery then reported "no Dataverse
    // environment could be discovered" and told the operator to run
    // New-PowerAppManagementApp, which was never the actual blocker.
    //
    // `/scopes/admin/environments` is the tenant-wide view. Verified against a
    // live tenant with only the Graph application permissions this app already
    // has: it returned all three environments, each with
    // properties.linkedEnvironmentMetadata.instanceUrl populated, with no
    // PowerShell registration step.
    //
    // The caller-scoped call is kept as a fallback so a delegated user token — the
    // case where the admin scope legitimately 403s — still works.
    const adminUrl = `${BAP_BASE}/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2023-06-01`;
    const userUrl = `${BAP_BASE}/providers/Microsoft.BusinessAppPlatform/environments?api-version=2023-06-01`;

    for (const [scope, url] of [["admin", adminUrl], ["caller", userUrl]] as const) {
      try {
        const response = await this.fetchWithRetry(url);
        const data = await response.json();
        const envs: PowerPlatformEnvironment[] = data.value || [];
        // An empty admin result is not a reason to stop — fall through and let the
        // caller-scoped attempt answer, in case this token is delegated.
        if (envs.length > 0) {
          console.log(`[PowerPlatform] ${envs.length} environment(s) via ${scope} scope`);
          return envs;
        }
        console.log(`[PowerPlatform] ${scope} scope returned no environments`);
      } catch (e) {
        if (e instanceof PowerPlatformError && (e.status === 403 || e.status === 401)) {
          console.warn(`[PowerPlatform] ${scope} scope denied (${e.status}) — trying next`);
          continue;
        }
        throw e;
      }
    }
    return [];
  }

  /**
   * List connections (connectors) in a specific environment
   * Per PRD: Connector type (SharePoint, Exchange, HTTP) drives risk scoring
   */
  async listConnections(environmentName: string): Promise<PowerPlatformConnector[]> {
    const url = `${PP_BASE}/providers/Microsoft.PowerApps/environments/${environmentName}/connections?api-version=2023-06-01`;
    try {
      const response = await this.fetchWithRetry(url);
      const data = await response.json();
      return data.value || [];
    } catch (e) {
      if (e instanceof PowerPlatformError && (e.status === 403 || e.status === 401)) {
        console.warn(`No access to connections in env ${environmentName}`);
        return [];
      }
      throw e;
    }
  }

  /**
   * List flows (Power Automate) in an environment — some may be AI agent flows
   */
  async listFlows(environmentName: string): Promise<PowerPlatformFlow[]> {
    const url = `${PP_BASE}/providers/Microsoft.ProcessSimple/environments/${environmentName}/flows?api-version=2016-11-01`;
    try {
      const response = await this.fetchWithRetry(url);
      const data = await response.json();
      return data.value || [];
    } catch (e) {
      if (e instanceof PowerPlatformError && (e.status === 403 || e.status === 401)) {
        console.warn(`No access to flows in env ${environmentName}`);
        return [];
      }
      throw e;
    }
  }

  /**
   * Get connector details for a specific connection
   * Returns connector type info (SharePoint, Exchange, HTTP, etc.)
   */
  async getConnectionDetails(environmentName: string, connectionName: string): Promise<PowerPlatformConnector | null> {
    const url = `${PP_BASE}/providers/Microsoft.PowerApps/environments/${environmentName}/connections/${connectionName}?api-version=2023-06-01`;
    try {
      const response = await this.fetchWithRetry(url);
      return response.json();
    } catch {
      return null;
    }
  }
}

export interface PowerPlatformFlow {
  name: string;
  id: string;
  type: string;
  properties: {
    displayName: string;
    state: string;
    createdTime: string;
    lastModifiedTime: string;
    environment: { name: string };
    definitionSummary?: {
      triggers?: Array<{ type: string; kind?: string }>;
      actions?: Array<{ type: string; swaggerOperationId?: string }>;
    };
    creator?: {
      userId: string;
      userType: string;
      objectId: string;
    };
  };
}

// Known connector types and their risk implications per PRD Section 4.2
export const CONNECTOR_RISK_MAP: Record<string, { risk: "high" | "medium" | "low"; category: string }> = {
  "shared_sharepointonline": { risk: "medium", category: "SharePoint" },
  "shared_office365": { risk: "medium", category: "Exchange/Outlook" },
  "shared_office365users": { risk: "low", category: "Office 365 Users" },
  "shared_teams": { risk: "medium", category: "Teams" },
  "shared_onedriveforbusiness": { risk: "medium", category: "OneDrive" },
  "shared_dynamicscrmonline": { risk: "medium", category: "Dynamics 365" },
  "shared_sql": { risk: "high", category: "SQL Server" },
  "shared_azureblob": { risk: "medium", category: "Azure Blob Storage" },
  "shared_http": { risk: "high", category: "HTTP (External)" }, // Per PRD: external data egress
  "shared_sendgrid": { risk: "medium", category: "SendGrid Email" },
  "shared_azuread": { risk: "medium", category: "Azure AD" },
  "shared_cognitiveservices": { risk: "low", category: "Cognitive Services" },
  "shared_openaiconnector": { risk: "high", category: "OpenAI" },
};

export class PowerPlatformError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(status: number, body: string, endpoint: string) {
    const parsed = (() => {
      try { return JSON.parse(body); } catch { return null; }
    })();
    const msg = parsed?.error?.message || body.slice(0, 200);
    super(`Power Platform ${status}: ${msg}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}
