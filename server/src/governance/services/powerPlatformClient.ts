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
    const url = `${BAP_BASE}/providers/Microsoft.BusinessAppPlatform/environments?api-version=2023-06-01`;
    try {
      const response = await this.fetchWithRetry(url);
      const data = await response.json();
      return data.value || [];
    } catch (e) {
      if (e instanceof PowerPlatformError && (e.status === 403 || e.status === 401)) {
        console.warn("No access to Power Platform environments — may need Power Platform admin role");
        return [];
      }
      throw e;
    }
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
