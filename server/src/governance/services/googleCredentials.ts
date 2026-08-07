/**
 * Build a GoogleWorkspaceClient from a stored connection, whichever way it was made.
 *
 * Two shapes exist and they have almost nothing in common:
 *
 *   auth_method: "oauth"   — interactive Sign in with Google. The row holds a
 *       refresh token and an admin email. There is NO client_secret and NO
 *       service-account JSON, so `JSON.parse(decrypt(row.client_secret))` throws.
 *
 *   legacy service account — the row holds the SA JSON encrypted in
 *       client_secret, and the client exchanges a signed JWT.
 *
 * Every route that talks to Google used to assume the second shape. After the
 * service-account form was removed, that assumption produced
 * "Cannot read properties of undefined (reading 'split')" across scan-platform,
 * user-activity and cost — an error that names a string operation and says
 * nothing about credentials, which is exactly why this belongs in one place
 * instead of five.
 *
 * projectId is resolved rather than required: an OAuth row has no project, so it
 * falls back to the first project the account can see. Discovery then enumerates
 * the rest itself.
 */
import { getDb } from "../db.js";
import { decrypt } from "../crypto.js";
import { GoogleWorkspaceClient } from "./googleWorkspaceClient.js";
import type { GoogleServiceAccountKey } from "./googleWorkspaceClient.js";
import { accessTokenFromRefresh } from "../routes/googleOAuth.js";

export interface GoogleConnection {
  client: GoogleWorkspaceClient;
  adminEmail: string;
  projectId: string | undefined;
  /** True when driven by an interactive-sign-in access token. */
  isOAuth: boolean;
}

/** Load the stored Google connection, by id or the most recent one. */
export async function loadGoogleKeyDoc(oauthKeyId?: string): Promise<any | null> {
  const db = getDb();
  if (oauthKeyId) return db.collection("oauth_keys").findOne({ id: oauthKeyId, vendor: "google" });
  return db.collection("oauth_keys").findOne({ vendor: "google" }, { sort: { updated_at: -1 } });
}

/**
 * Build an authenticated client for a stored Google connection.
 * Throws a message an operator can act on, never a bare TypeError.
 */
export async function googleClientFromKey(keyDoc: any, projectOverride?: string): Promise<GoogleConnection> {
  if (!keyDoc) {
    const e: any = new Error("Google is not connected. Sign in with Google from Agent Governance first.");
    e.status = 404;
    throw e;
  }

  const adminEmail: string = keyDoc.google_admin_email || "";

  if (keyDoc.auth_method === "oauth") {
    if (!keyDoc.google_refresh_token) {
      const e: any = new Error("This Google connection is missing its refresh token — sign in again to restore it.");
      e.status = 400;
      throw e;
    }
    const accessToken = await accessTokenFromRefresh(keyDoc.google_refresh_token);

    // The client's constructor reads `project_id` off the key for its fallback,
    // so an OAuth connection passes a stub carrying only that. private_key is
    // empty and never used: useAccessToken() short-circuits the JWT exchange.
    const stub = { client_email: adminEmail, private_key: "", project_id: projectOverride || keyDoc.google_project_id || "" } as GoogleServiceAccountKey;
    const client = new GoogleWorkspaceClient(stub, adminEmail, projectOverride || keyDoc.google_project_id);

    let projectId = projectOverride || keyDoc.google_project_id;

    // Deliberately NO quota project on this first call.
    //
    // fetchApi sends `X-Goog-User-Project` whenever one is set, and Google
    // rejects a request billed to a project the caller lacks serviceusage
    // permission on — which includes every `sys-…` Apps Script auto-project.
    // Passing one before we know it is a real, usable project turned the
    // project listing itself into a 403, so discovery fell back to a single
    // project and every scan came back empty.
    client.useAccessToken(accessToken);

    if (!projectId) {
      const projects = await client.listAccessibleProjects();
      projectId = projects[0]?.projectId;
    }

    // Only now, with a genuine project, set it as the quota project.
    if (projectId) {
      client.setProject(projectId);
      client.useAccessToken(accessToken, projectId);
    }
    return { client, adminEmail, projectId, isOAuth: true };
  }

  // Legacy service-account row.
  if (!keyDoc.client_secret) {
    const e: any = new Error("This Google connection has no usable credentials — sign in with Google to reconnect.");
    e.status = 400;
    throw e;
  }
  const keyObj: GoogleServiceAccountKey = JSON.parse(decrypt(keyDoc.client_secret));
  const projectId = projectOverride || keyDoc.google_project_id || keyObj.project_id;
  return {
    client: new GoogleWorkspaceClient(keyObj, adminEmail || keyObj.client_email, projectId),
    adminEmail: adminEmail || keyObj.client_email,
    projectId,
    isOAuth: false,
  };
}
