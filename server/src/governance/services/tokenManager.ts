import { getDb } from "../db.js";
import { decrypt } from "../crypto.js";

interface TokenDoc {
  id?: string;
  oauth_key_id: string;
  vendor: string;
  access_token: string;
  expires_at: string;
  token_type?: string;
  scope: string;
}

interface OAuthKeyDoc {
  id: string;
  vendor: string;
  client_id: string;
  client_secret: string;
  tenant_id: string | null;
}

/**
 * Token scopes for different Microsoft APIs
 * Per PRD Section 5.1: Multiple APIs require different scopes/resources
 */
export type TokenScope =
  | "graph"               // Microsoft Graph API
  | "dataverse"           // Dataverse / Dynamics CRM
  | "power_platform"      // Power Platform / PowerApps
  | "audit"               // O365 Management Activity API
  | "azure"               // Azure Management API
  | "cognitiveservices";  // Azure OpenAI / Cognitive Services (data-plane)

const SCOPE_MAP: Record<TokenScope, string> = {
  graph: "https://graph.microsoft.com/.default",
  dataverse: "https://globaldisco.crm.dynamics.com/.default", // Discovery service
  power_platform: "https://service.powerapps.com/.default",
  audit: "https://manage.office.com/.default",
  azure: "https://management.azure.com/.default",
  cognitiveservices: "https://cognitiveservices.azure.com/.default",
};

/**
 * Get a valid token for a specific scope, auto-refreshing if expired
 */
export async function getValidToken(oauthKeyId: string, scope: TokenScope = "graph"): Promise<string> {
  const db = getDb();
  // Check for existing non-expired token (10 min buffer)
  const bufferTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const existing = await db.collection("tokens").findOne(
    {
      oauth_key_id: oauthKeyId,
      scope,
      expires_at: { $gt: bufferTime },
    },
    { sort: { expires_at: -1 } }
  );

  if (existing) {
    return existing.access_token;
  }

  // Need to acquire a new token
  return acquireNewToken(oauthKeyId, scope);
}

/**
 * Acquire a fresh token for a specific scope using client credentials
 */
export async function acquireNewToken(oauthKeyId: string, scope: TokenScope = "graph"): Promise<string> {
  const db = getDb();
  // Fetch credentials
  const key = await db.collection("oauth_keys").findOne({ id: oauthKeyId }) as OAuthKeyDoc | null;

  if (!key) {
    throw new Error("OAuth credentials not found");
  }

  const clientSecret = decrypt(key.client_secret);

  if (key.vendor === "microsoft") {
    return acquireMicrosoftToken(key.id, key.vendor, key.client_id, clientSecret, key.tenant_id, scope);
  }

  throw new Error(`Unsupported vendor: ${key.vendor}`);
}

/**
 * Get a Dataverse token for a specific environment URL
 * Dataverse requires scoping to the specific CRM org URL
 */
export async function getDataverseToken(oauthKeyId: string, envUrl: string): Promise<string> {
  const db = getDb();
  const key = await db.collection("oauth_keys").findOne({ id: oauthKeyId }) as OAuthKeyDoc | null;

  if (!key) {
    throw new Error("OAuth credentials not found");
  }

  const clientSecret = decrypt(key.client_secret);
  const tenant = key.tenant_id || "common";

  // Dataverse token scope is the org URL itself
  const baseUrl = envUrl.startsWith("https://") ? envUrl : `https://${envUrl}`;
  const dvScope = `${baseUrl.replace(/\/$/, "")}/.default`;

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: key.client_id,
    client_secret: clientSecret,
    scope: dvScope,
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Dataverse token failed (${res.status}): ${(err as Record<string, string>).error_description || (err as Record<string, string>).error || "Unknown error"}`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}

async function acquireMicrosoftToken(
  oauthKeyId: string,
  vendor: string,
  clientId: string,
  clientSecret: string,
  tenantId: string | null,
  scope: TokenScope
): Promise<string> {
  const tenant = tenantId || "common";
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const scopeValue = SCOPE_MAP[scope];

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: scopeValue,
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Token acquisition failed for ${scope} (${res.status}): ${(err as Record<string, string>).error_description || (err as Record<string, string>).error || "Unknown error"}`
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  const db = getDb();

  // Delete old tokens for this key+scope, then insert new one
  await db.collection("tokens").deleteMany({ oauth_key_id: oauthKeyId, scope });
  await db.collection("tokens").insertOne({
    oauth_key_id: oauthKeyId,
    vendor,
    access_token: data.access_token,
    expires_at: expiresAt.toISOString(),
    token_type: data.token_type,
    scope,
    created_at: new Date(),
  });

  return data.access_token;
}
