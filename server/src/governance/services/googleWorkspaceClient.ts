/**
 * Google Workspace Client — Agent & AI Tool Discovery
 * Discovers:
 *   1. Admin SDK Token Audit   → OAuth tokens granted by users to third-party AI apps
 *   2. Google Chat Spaces      → Chat bots/apps deployed in Workspace
 *   3. Vertex AI               → Gemini agents, model endpoints, custom jobs
 *   4. Apps Script              → Script-based bots and automations
 *   5. Gemini for Workspace     → Gemini feature add-on status per user
 *
 * Auth: Google Service Account with domain-wide delegation
 * Required scopes:
 *   - https://www.googleapis.com/auth/admin.directory.user.security (token audit)
 *   - https://www.googleapis.com/auth/admin.directory.user.readonly (user list)
 *   - https://www.googleapis.com/auth/chat.spaces.readonly (Chat spaces)
 *   - https://www.googleapis.com/auth/cloud-platform.read-only (Vertex AI)
 *   - https://www.googleapis.com/auth/script.projects.readonly (Apps Script)
 */

import crypto from "crypto";

// ── Types ──────────────────────────────────────────

export interface GoogleServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain?: string;
}

/** OAuth token a user granted to a third-party app */
export interface GoogleUserToken {
  clientId: string;
  displayText: string;
  nativeApp: boolean;
  scopes: string[];
  userKey: string;
  anonymous?: boolean;
}

/** Google Chat space */
export interface GoogleChatSpace {
  name: string;            // "spaces/AAAA..."
  type: string;            // "ROOM" | "DM" | "GROUP_CHAT"
  displayName?: string;
  spaceType?: string;      // "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE"
  singleUserBotDm?: boolean;
  threaded?: boolean;
  externalUserAllowed?: boolean;
  spaceThreadingState?: string;
  createTime?: string;
  adminInstalled?: boolean;
}

/** Google Chat space member (bot) */
export interface GoogleChatMember {
  name: string;
  member?: {
    name: string;          // "users/..." or "bots/..."
    displayName: string;
    type: string;          // "HUMAN" | "BOT"
    domainId?: string;
  };
  role?: string;
  createTime?: string;
}

/** Vertex AI endpoint */
export interface VertexAIEndpoint {
  name: string;            // "projects/.../locations/.../endpoints/..."
  displayName: string;
  description?: string;
  deployedModels?: Array<{
    id: string;
    model: string;
    displayName?: string;
    createTime?: string;
    modelVersionId?: string;
  }>;
  createTime?: string;
  updateTime?: string;
  labels?: Record<string, string>;
}

/** Vertex AI model */
export interface VertexAIModel {
  name: string;
  displayName: string;
  description?: string;
  versionId?: string;
  createTime?: string;
  updateTime?: string;
  deployedModels?: Array<{ endpoint: string; deployedModelId: string }>;
  labels?: Record<string, string>;
  modelSourceInfo?: {
    sourceType?: string;   // "AUTOML" | "CUSTOM" | "GENIE" | "MODEL_GARDEN"
  };
}

/** Vertex AI Reasoning Engine (Agent Builder agent) */
export interface VertexAIReasoningEngine {
  name: string;            // "projects/.../locations/.../reasoningEngines/..."
  displayName: string;
  description?: string;
  spec?: {
    classMethod?: string;
    packageSpec?: {
      pickleObjectGcsUri?: string;
      dependencyFilesGcsUri?: string;
      requirementsGcsUri?: string;
      pythonVersion?: string;
    };
  };
  createTime?: string;
  updateTime?: string;
  labels?: Record<string, string>;
}

/** Vertex AI Extension (tools/plugins used by agents) */
export interface VertexAIExtension {
  name: string;            // "projects/.../locations/.../extensions/..."
  displayName: string;
  description?: string;
  createTime?: string;
  updateTime?: string;
  runtimeConfig?: {
    codeInterpreterRuntimeConfig?: Record<string, unknown>;
    vertexAiSearchRuntimeConfig?: Record<string, unknown>;
  };
  toolUseExamples?: unknown[];
  labels?: Record<string, string>;
}

/** Dialogflow CX conversational agent */
export interface DialogflowCXAgent {
  name: string;            // "projects/.../locations/.../agents/..."
  displayName: string;
  defaultLanguageCode?: string;
  description?: string;
  timeZone?: string;
  locked?: boolean;
  enableStackdriverLogging?: boolean;
  enableSpellCorrection?: boolean;
  region?: string;         // populated client-side during multi-region scan
}

/** Cloud Logging entry */
export interface CloudLogEntry {
  insertId?: string;
  timestamp: string;
  severity?: string;
  logName?: string;
  resource?: {
    type?: string;
    labels?: Record<string, string>;
  };
  labels?: Record<string, string>;
  jsonPayload?: Record<string, any>;
  protoPayload?: Record<string, any>;
  textPayload?: string;
}

/** Structured conversation from Cloud Logging */
export interface AgentConversation {
  id: string;
  agentName: string;
  userName: string;
  userEmail: string;
  startTime: string;
  lastMessageTime: string;
  messageCount: number;
  messages: Array<{
    id: string;
    timestamp: string;
    from: "user" | "bot";
    fromName: string;
    text: string;
  }>;
  source: string;
  severity: string;
}

/** Vertex AI Agent Builder / Discovery Engine App (Gen App Builder) */
export interface DiscoveryEngineApp {
  name: string;            // "projects/.../locations/.../collections/.../engines/..."
  displayName: string;
  createTime?: string;
  updateTime?: string;
  solutionType?: string;   // "SOLUTION_TYPE_SEARCH" | "SOLUTION_TYPE_CHAT" | "SOLUTION_TYPE_RECOMMENDATION"
  industryVertical?: string;
  commonConfig?: {
    companyName?: string;
  };
  chatEngineConfig?: {
    dialogflowAgentToLink?: string;
    agentCreationConfig?: {
      business?: string;
      defaultLanguageCode?: string;
    };
  };
  searchEngineConfig?: {
    searchTier?: string;
    searchAddOns?: string[];
  };
  dataStoreIds?: string[];
}

/** Discovery Engine Data Store */
export interface DiscoveryEngineDataStore {
  name: string;
  displayName: string;
  createTime?: string;
  defaultSchemaId?: string;
  contentConfig?: string;  // "NO_CONTENT" | "CONTENT_REQUIRED" | "PUBLIC_WEBSITE"
  solutionTypes?: string[];
}

/** Vertex AI Pipeline Job (automated AI workflow) */
export interface VertexAIPipelineJob {
  name: string;
  displayName: string;
  state?: string;
  createTime?: string;
  updateTime?: string;
  startTime?: string;
  endTime?: string;
  pipelineSpec?: { pipelineInfo?: { name?: string } };
  labels?: Record<string, string>;
  templateUri?: string;
  scheduleName?: string;
}

/** NotebookLM Enterprise notebook */
export interface NotebookLMNotebook {
  name: string;
  displayName?: string;
  createTime?: string;
  updateTime?: string;
  creator?: string;
  sourceCount?: number;
}

/** Google Cloud Function (may call AI APIs) */
export interface CloudFunctionEntry {
  name: string;
  displayName?: string;
  description?: string;
  state?: string;
  environment?: string;
  buildConfig?: { runtime?: string; entryPoint?: string; source?: { storageSource?: { bucket?: string; object?: string } } };
  serviceConfig?: { uri?: string; serviceAccountEmail?: string };
  createTime?: string;
  updateTime?: string;
  labels?: Record<string, string>;
  url?: string;
}

/** Cloud Run service */
export interface CloudRunService {
  name: string;
  description?: string;
  uri?: string;
  creator?: string;
  createTime?: string;
  updateTime?: string;
  labels?: Record<string, string>;
  template?: { containers?: Array<{ image?: string; env?: Array<{ name?: string; value?: string }> }> };
}

/** Vertex AI custom job (fine-tuning, training) */
export interface VertexAICustomJob {
  name: string;
  displayName: string;
  state: string;           // "JOB_STATE_SUCCEEDED" etc.
  createTime?: string;
  updateTime?: string;
  startTime?: string;
  endTime?: string;
  labels?: Record<string, string>;
}

/** Apps Script project */
export interface AppsScriptProject {
  scriptId: string;
  title: string;
  parentId?: string;
  createTime?: string;
  updateTime?: string;
  creator?: { name?: string; email?: string };
  lastModifyUser?: { name?: string; email?: string };
}

/** Apps Script deployment */
export interface AppsScriptDeployment {
  deploymentId: string;
  deploymentConfig: {
    scriptId: string;
    versionNumber?: number;
    manifestFileName?: string;
    description?: string;
  };
  updateTime?: string;
  entryPoints?: Array<{
    entryPointType: string;  // "WEB_APP" | "EXECUTION_API" | "ADD_ON"
    webApp?: { url: string; entryPointConfig: { access: string; executeAs: string } };
    addOn?: { title: string; description?: string };
  }>;
}

// ── Unified result types ────────────────────────────

export interface GoogleUserOAuthApp {
  clientId: string;
  displayName: string;
  scopes: string[];
  users: Array<{ userKey: string; email: string; displayName?: string; lastLoginTime?: string; creationTime?: string }>;
  isNativeApp: boolean;
  isAiTool: boolean;
  aiToolName?: string;
}

export interface GoogleChatBot {
  spaceId: string;
  spaceName: string;
  botName: string;
  botDisplayName: string;
  spaceType: string;
  createTime?: string;
  adminInstalled: boolean;
  spaceUri?: string;
  singleUserBotDm?: boolean;
  humanParticipant?: string;
}

/** Per-platform Gemini for Workspace usage breakdown */
export interface GeminiPlatformUsage {
  app: string;          // "gmail" | "docs" | "sheets" | "slides" | "meet" | "drive" | "chat"
  label: string;        // human-readable label
  userCount: number;    // unique users who used Gemini in this app
  requestCount: number; // total Gemini interactions/requests
  topUsers: Array<{ email: string; count: number }>;
}

/** Per-user Gemini usage broken down by Workspace app */
export interface GeminiUserAppUsage {
  email: string;
  displayName: string;
  apps: Record<string, number>;   // app → action count, e.g. { gmail: 5, docs: 3 }
  totalActions: number;
  lastActive: string;
}

/** Gemini Gem discovered in a user's Drive */
export interface GeminiGem {
  id: string;
  name: string;
  owner: { email: string; displayName: string };
  shared: boolean;
  sharedWith: Array<{ email: string; displayName?: string; role: string }>;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
}

export interface GoogleWorkspaceDiscoveryResult {
  oauthApps: GoogleUserOAuthApp[];
  chatBots: GoogleChatBot[];
  vertexEndpoints: VertexAIEndpoint[];
  vertexModels: VertexAIModel[];
  vertexJobs: VertexAICustomJob[];
  vertexReasoningEngines: VertexAIReasoningEngine[];
  vertexExtensions: VertexAIExtension[];
  vertexPipelineJobs: VertexAIPipelineJob[];
  agentBuilderApps: DiscoveryEngineApp[];
  agentBuilderDataStores: DiscoveryEngineDataStore[];
  dialogflowAgents: DialogflowCXAgent[];
  appsScriptProjects: AppsScriptProject[];
  appsScriptDeployments: AppsScriptDeployment[];
  notebookLMNotebooks: NotebookLMNotebook[];
  cloudFunctions: CloudFunctionEntry[];
  cloudRunServices: CloudRunService[];
  geminiEnabled: boolean;
  geminiLicensedCount: number;
  geminiAppUsage: GeminiPlatformUsage[];
  geminiUserAppUsage: GeminiUserAppUsage[];
  gems: GeminiGem[];
  workspaceUsers: Array<{ id: string; email: string; displayName: string; lastLoginTime?: string; creationTime?: string }>;
  domain: string;
  projectId: string;
  warnings: string[];
}

// ── Known AI app patterns for OAuth token audit ─────

const AI_APP_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  vendor: string;
  riskLevel: "critical" | "high" | "medium" | "low";
}> = [
  { pattern: /gemini|google\s*ai\s*studio|bard|makersuite/i, name: "Gemini / Google AI Studio", vendor: "Google", riskLevel: "high" },
  { pattern: /openai|chatgpt|dall-e/i, name: "ChatGPT / OpenAI", vendor: "OpenAI", riskLevel: "high" },
  { pattern: /anthropic|claude/i, name: "Claude (Anthropic)", vendor: "Anthropic", riskLevel: "high" },
  { pattern: /copilot|github/i, name: "GitHub Copilot", vendor: "GitHub (Microsoft)", riskLevel: "medium" },
  { pattern: /cursor/i, name: "Cursor IDE", vendor: "Anysphere", riskLevel: "high" },
  { pattern: /perplexity/i, name: "Perplexity AI", vendor: "Perplexity", riskLevel: "high" },
  { pattern: /notion\s*ai/i, name: "Notion AI", vendor: "Notion", riskLevel: "medium" },
  { pattern: /grammarly/i, name: "Grammarly", vendor: "Grammarly", riskLevel: "medium" },
  { pattern: /codeium|windsurf/i, name: "Windsurf / Codeium", vendor: "Codeium", riskLevel: "high" },
  { pattern: /midjourney/i, name: "Midjourney", vendor: "Midjourney", riskLevel: "medium" },
  { pattern: /jasper/i, name: "Jasper AI", vendor: "Jasper", riskLevel: "medium" },
  { pattern: /hugging\s*face/i, name: "Hugging Face", vendor: "Hugging Face", riskLevel: "medium" },
  { pattern: /stability|stable\s*diffusion/i, name: "Stability AI", vendor: "Stability AI", riskLevel: "medium" },
  { pattern: /vertex\s*ai/i, name: "Vertex AI", vendor: "Google", riskLevel: "medium" },
  { pattern: /cloud\s*ai\s*platform/i, name: "Google Cloud AI", vendor: "Google", riskLevel: "medium" },
];

/** Sensitive Google OAuth scopes that indicate elevated access */
const SENSITIVE_GOOGLE_SCOPES = new Set([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://mail.google.com/",
]);

// ── JWT Token Generation ────────────────────────────

function createJwt(
  serviceAccountKey: GoogleServiceAccountKey,
  scopes: string[],
  subject?: string
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: serviceAccountKey.client_email,
    scope: scopes.join(" "),
    aud: serviceAccountKey.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  // For domain-wide delegation, impersonate the admin user
  if (subject) {
    payload.sub = subject;
  }

  const encodeBase64Url = (data: string) =>
    Buffer.from(data).toString("base64url");

  const headerB64 = encodeBase64Url(JSON.stringify(header));
  const payloadB64 = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Normalize PEM: handle both escaped \n (from JSON storage) and actual newlines
  const pemKey = serviceAccountKey.private_key.replace(/\\n/g, "\n").trim();

  // Convert PEM to DER buffer with explicit pkcs8 type to avoid
  // OpenSSL 3.x "DECODER routines::unsupported" error on Node.js 17+.
  // crypto.createPrivateKey({ format:'pem' }) without an explicit type can
  // fail to decode PKCS#8 keys under OpenSSL 3's stricter provider model.
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const derKey = Buffer.from(pemBody, "base64");
  const privateKey = crypto.createPrivateKey({ key: derKey, format: "der", type: "pkcs8" });

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput, "utf8");
  const signature = sign.sign(privateKey, "base64url");

  return `${signingInput}.${signature}`;
}

async function exchangeJwtForToken(
  serviceAccountKey: GoogleServiceAccountKey,
  scopes: string[],
  subject?: string
): Promise<string> {
  const jwt = createJwt(serviceAccountKey, scopes, subject);
  const tokenUrl = serviceAccountKey.token_uri || "https://oauth2.googleapis.com/token";

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new GoogleWorkspaceError(
      res.status,
      `Token exchange failed: ${(err as Record<string, string>).error_description || (err as Record<string, string>).error || "Unknown"}`,
      tokenUrl
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}

// ── Client ──────────────────────────────────────────

export class GoogleWorkspaceClient {
  private serviceAccountKey: GoogleServiceAccountKey;
  private adminEmail: string;      // Admin user email for domain-wide delegation
  private projectId: string;
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    serviceAccountKey: GoogleServiceAccountKey,
    adminEmail: string,
    projectId?: string
  ) {
    this.serviceAccountKey = serviceAccountKey;
    this.adminEmail = adminEmail;
    this.projectId = projectId || serviceAccountKey.project_id;
  }

  // When set, the client authenticates with this user/OAuth access token instead
  // of exchanging the service-account JWT. Used by the Gemini Enterprise "access
  // token" connect path, where the user has read access but cannot mint an SA key.
  private overrideAccessToken?: string;
  private quotaProjectId?: string;

  /** Authenticate using a pre-acquired OAuth access token (e.g. `gcloud auth print-access-token`). */
  useAccessToken(token: string, quotaProjectId?: string): void {
    this.overrideAccessToken = token;
    this.quotaProjectId = quotaProjectId;
  }

  private async getToken(scopes: string[], subject?: string): Promise<string> {
    if (this.overrideAccessToken) return this.overrideAccessToken;

    const cacheKey = `${scopes.join(",")}:${subject || ""}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const token = await exchangeJwtForToken(this.serviceAccountKey, scopes, subject);
    this.tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 3500_000 });
    return token;
  }

  private async fetchApi<T>(
    url: string,
    token: string,
    retries = 2,
    timeoutMs = 15000
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      // User access tokens require a quota project for billing the request.
      if (this.quotaProjectId) headers["X-Goog-User-Project"] = this.quotaProjectId;
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error)?.name === "AbortError") {
        throw new GoogleWorkspaceError(0, `Request timed out after ${timeoutMs}ms`, url);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 && retries > 0) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "10");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.fetchApi(url, token, retries - 1, timeoutMs);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new GoogleWorkspaceError(response.status, body, url);
    }

    return response.json() as Promise<T>;
  }

  private async fetchSafe<T>(url: string, token: string): Promise<T | null> {
    try {
      return await this.fetchApi<T>(url, token);
    } catch (e) {
      if (e instanceof GoogleWorkspaceError && [0, 401, 403, 404].includes(e.status)) {
        return null;
      }
      throw e;
    }
  }

  // ── Admin SDK: User OAuth Token Audit ─────────────

  /**
   * List all users in the Google Workspace domain
   */
  private async listUsers(): Promise<Array<{ id: string; primaryEmail: string; name: { fullName: string }; lastLoginTime?: string; creationTime?: string }>> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/admin.directory.user.readonly",
    ], this.adminEmail);

    const users: Array<{ id: string; primaryEmail: string; name: { fullName: string }; lastLoginTime?: string; creationTime?: string }> = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        customer: "my_customer",
        maxResults: "500",
        projection: "full",
        orderBy: "email",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const data = await this.fetchSafe<{
        users?: Array<{ id: string; primaryEmail: string; name: { fullName: string }; lastLoginTime?: string; creationTime?: string }>;
        nextPageToken?: string;
      }>(`https://admin.googleapis.com/admin/directory/v1/users?${params}`, token);

      if (data?.users) users.push(...data.users);
      pageToken = data?.nextPageToken;
      pages++;
    } while (pageToken && pages < 200);  // 200 pages × 500 = 100,000 users max

    return users;
  }

  /**
   * List OAuth tokens granted by a specific user
   * Admin SDK: GET /admin/directory/v1/users/{userKey}/tokens
   */
  private async listUserTokens(userKey: string): Promise<GoogleUserToken[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/admin.directory.user.security",
    ], this.adminEmail);

    const data = await this.fetchSafe<{ items?: GoogleUserToken[] }>(
      `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(userKey)}/tokens`,
      token
    );

    return data?.items || [];
  }

  /**
   * Scan all users' OAuth tokens and aggregate by app
   * This is the main shadow AI detection mechanism
   */
  async discoverOAuthApps(): Promise<GoogleUserOAuthApp[]> {
    const users = await this.listUsers();
    const appMap = new Map<string, GoogleUserOAuthApp>();

    // Sample up to 200 users to avoid rate limiting
    const sampleUsers = users.slice(0, 200);

    for (const user of sampleUsers) {
      try {
        const tokens = await this.listUserTokens(user.primaryEmail);
        for (const t of tokens) {
          const existing = appMap.get(t.clientId);
          const aiMatch = AI_APP_PATTERNS.find((p) => p.pattern.test(t.displayText));

          if (existing) {
            existing.users.push({
              userKey: user.id,
              email: user.primaryEmail,
              displayName: user.name.fullName,
              lastLoginTime: user.lastLoginTime,
              creationTime: user.creationTime,
            });
            for (const s of t.scopes) {
              if (!existing.scopes.includes(s)) existing.scopes.push(s);
            }
          } else {
            appMap.set(t.clientId, {
              clientId: t.clientId,
              displayName: t.displayText,
              scopes: [...t.scopes],
              users: [{
                userKey: user.id,
                email: user.primaryEmail,
                displayName: user.name.fullName,
                lastLoginTime: user.lastLoginTime,
                creationTime: user.creationTime,
              }],
              isNativeApp: t.nativeApp,
              isAiTool: !!aiMatch,
              aiToolName: aiMatch?.name,
            });
          }
        }
      } catch (e) {
        // Skip individual user failures (rate limit, permission)
        if (e instanceof GoogleWorkspaceError && e.status === 429) {
          // Back off on rate limit
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    return Array.from(appMap.values());
  }

  // ── Google Chat: Bot Discovery ────────────────────

  /**
   * List Google Chat spaces that have bots/apps installed
   * Requires Chat API + service account with domain-wide delegation
   */
  async discoverChatBots(): Promise<GoogleChatBot[]> {
    // Try to get a token with admin scopes first (needed for real bot names).
    // If admin scopes aren't authorized in DWD, fall back to the basic scopes so
    // the scan still works (just with generic "Chat Bot" labels).
    let token: string;
    let hasAdminScopes = false;
    try {
      token = await this.getToken([
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.memberships.readonly",
        "https://www.googleapis.com/auth/chat.admin.spaces.readonly",
        "https://www.googleapis.com/auth/chat.admin.memberships.readonly",
      ], this.adminEmail);
      hasAdminScopes = true;
      console.log("[Google] Chat: ✓ using admin scopes (bot names will be resolved)");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[Google] Chat: admin scope token exchange FAILED: ${errMsg}`);
      console.log(`[Google] Chat: admin scopes NOT authorized. Falling back to regular scopes.`);
      console.log(`[Google] Chat: To fix, add these scopes to DWD for service account ${this.serviceAccountKey.client_email}:`);
      console.log(`[Google] Chat:   https://www.googleapis.com/auth/chat.admin.spaces.readonly`);
      console.log(`[Google] Chat:   https://www.googleapis.com/auth/chat.admin.memberships.readonly`);
      token = await this.getToken([
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.memberships.readonly",
      ], this.adminEmail);
    }

    const bots: GoogleChatBot[] = [];
    const allSpaces: Array<GoogleChatSpace & { singleUserBotDm?: boolean }> = [];
    let pageToken: string | undefined;
    let pages = 0;

    // Step 1: List all spaces (max 2 pages = 200 spaces)
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);

      const data = await this.fetchSafe<{
        spaces?: Array<GoogleChatSpace & { singleUserBotDm?: boolean }>;
        nextPageToken?: string;
      }>(`https://chat.googleapis.com/v1/spaces?${params}`, token);

      if (data?.spaces) allSpaces.push(...data.spaces);
      pageToken = data?.nextPageToken;
      pages++;
    } while (pageToken && pages < 2);

    console.log(`[Google] Chat: scanning ${allSpaces.length} spaces for bots...`);

    // Step 2: Check members in parallel batches of 10 (massive speedup).
    // Note: we DO NOT pass useAdminAccess on the bulk members.list here — some
    // spaces (e.g. external/cross-org) reject admin access with 403 and that
    // would zero-out bot detection. We use admin access selectively during
    // enrichment (getMembership) where it's safer and more useful.
    const BATCH_SIZE = 10;
    for (let i = 0; i < allSpaces.length; i += BATCH_SIZE) {
      const batch = allSpaces.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(space =>
          this.fetchSafe<{ memberships?: GoogleChatMember[] }>(
            `https://chat.googleapis.com/v1/${space.name}/members?pageSize=100`,
            token
          ).then(membersData => ({ space, membersData }))
        )
      );

      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value.membersData?.memberships) continue;
        const { space, membersData } = r.value;
        for (const m of membersData.memberships ?? []) {
          if (m.member?.type === "BOT") {
            // Priority for display name:
            // 1) m.member.displayName (rarely populated for bots)
            // 2) space.displayName when the space is a single-user bot DM (DM's name = the bot's name)
            // 3) Fallback to member name (e.g. "users/123...")
            const isBotDm = space.spaceType === "DIRECT_MESSAGE" && (space as { singleUserBotDm?: boolean }).singleUserBotDm === true;
            const displayName =
              m.member.displayName ||
              (isBotDm && space.displayName) ||
              m.member.name;

            bots.push({
              spaceId: space.name,
              spaceName: space.displayName || space.name,
              botName: m.member.name,
              botDisplayName: displayName,
              spaceType: space.spaceType || space.type,
              createTime: m.createTime || space.createTime,
              adminInstalled: space.adminInstalled || false,
            });
          }
        }
      }
    }

    console.log(`[Google] Chat: found ${bots.length} bot memberships across spaces`);
    bots.slice(0, 10).forEach(b =>
      console.log(`[Google] Chat bot pre-enrich: name=${b.botName} displayName="${b.botDisplayName}" space="${b.spaceName}"`),
    );

    // Step 3: Enrich bots that still have "users/{id}" as display name
    // by calling `spaces.get` on their parent space (which often returns bot metadata)
    await this.enrichBotDisplayNames(bots, token, hasAdminScopes);

    return bots;
  }

  /**
   * For bots whose display name is still a raw "users/{id}" identifier,
   * enrich with any available metadata:
   *  1) spaces.get with admin view (may expose bot's app name)
   *  2) direct getMembership with detailed view
   *  3) Admin SDK chat bot catalog (if granted)
   *  4) Fall back to the parent space's display name / a cleaner generic label
   */
  private async enrichBotDisplayNames(bots: GoogleChatBot[], token: string, hasAdminScopes: boolean): Promise<void> {
    // Manual override catalog: Google Chat API doesn't expose custom bot display
    // names for DMs, so allow operators to supply a mapping via the GOOGLE_CHAT_BOT_NAMES
    // env var — JSON like {"users/112638592543610537137": "agent governance chat"}.
    let botNameOverrides: Record<string, string> = {};
    if (process.env.GOOGLE_CHAT_BOT_NAMES) {
      try {
        botNameOverrides = JSON.parse(process.env.GOOGLE_CHAT_BOT_NAMES);
      } catch (err) {
        console.log(`[Google] Chat: invalid GOOGLE_CHAT_BOT_NAMES JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Try to acquire a messages-scoped token once — this is the most reliable
    // way to resolve a bot's real displayName (from sender.displayName on a
    // message the bot has sent). chat.messages.readonly must be in DWD.
    let messagesToken: string | null = null;
    try {
      messagesToken = await this.getToken([
        "https://www.googleapis.com/auth/chat.messages.readonly",
      ], this.adminEmail);
      console.log("[Google] Chat: ✓ messages scope available — will resolve bot names from message senders");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[Google] Chat: chat.messages.readonly NOT authorized in DWD — bot names may not resolve. Add it to the service account's DWD scopes. (${msg})`);
    }

    for (const bot of bots) {
      const botShortId = bot.botName.replace(/^users\//, "");

      // Manual override takes precedence — cheapest and most reliable for custom bots.
      const override = botNameOverrides[bot.botName] || botNameOverrides[botShortId];
      if (override) {
        bot.botDisplayName = override;
        console.log(`[Google] Chat bot ${botShortId}: resolved via GOOGLE_CHAT_BOT_NAMES override → "${bot.botDisplayName}"`);
        continue;
      }

      // Try direct getMembership with admin access — this is the endpoint that
      // actually returns the bot/app's displayName when chat.admin.memberships is granted.
      // If admin access is rejected for this space (400/403), silently try without it.
      if (hasAdminScopes && (!bot.botDisplayName || bot.botDisplayName.startsWith("users/"))) {
        const memberUrls = [
          `https://chat.googleapis.com/v1/${bot.spaceId}/members/${botShortId}?useAdminAccess=true`,
          `https://chat.googleapis.com/v1/${bot.spaceId}/members/${botShortId}`,
        ];
        for (const url of memberUrls) {
          const variant = url.includes("useAdminAccess") ? "admin" : "basic";
          try {
            const memData = await this.fetchApi<{ member?: { name?: string; displayName?: string; type?: string } }>(url, token);
            if (memData?.member?.displayName) {
              bot.botDisplayName = memData.member.displayName;
              console.log(`[Google] Chat bot ${botShortId}: resolved via getMembership (${variant}) → "${bot.botDisplayName}"`);
              break;
            }
            console.log(`[Google] Chat bot ${botShortId}: getMembership (${variant}) returned empty displayName`);
          } catch (err) {
            const msg = err instanceof GoogleWorkspaceError ? `${err.status}` : String(err);
            console.log(`[Google] Chat bot ${botShortId}: getMembership failed (${variant}): ${msg}`);
          }
        }
      }

      // Extra fallback: try Admin SDK Directory for this bot id. First-party
      // Google apps and some Workspace-installed bots are resolvable here using
      // only the admin.directory.user.readonly scope (which is already granted).
      if (!bot.botDisplayName || bot.botDisplayName.startsWith("users/")) {
        try {
          const adminToken = await this.getToken([
            "https://www.googleapis.com/auth/admin.directory.user.readonly",
          ], this.adminEmail);
          const userInfo = await this.fetchApi<{ primaryEmail?: string; name?: { fullName?: string }; kind?: string }>(
            `https://admin.googleapis.com/admin/directory/v1/users/${botShortId}?projection=basic`,
            adminToken,
          );
          const resolved = userInfo.name?.fullName || userInfo.primaryEmail;
          if (resolved) {
            bot.botDisplayName = resolved;
            console.log(`[Google] Chat bot ${botShortId}: resolved via Admin Directory → "${bot.botDisplayName}"`);
          } else {
            console.log(`[Google] Chat bot ${botShortId}: Admin Directory returned no name`);
          }
        } catch (err) {
          const msg = err instanceof GoogleWorkspaceError ? `${err.status}` : String(err);
          console.log(`[Google] Chat bot ${botShortId}: Admin Directory lookup failed: ${msg}`);
        }
      }

      // Fallback: list a few recent messages in the space and find one from this bot —
      // `sender.displayName` on a Message is the bot/app's real name.
      if (messagesToken && (!bot.botDisplayName || bot.botDisplayName.startsWith("users/"))) {
        try {
          const msgs = await this.fetchApi<{
            messages?: Array<{
              name?: string;
              sender?: { name?: string; displayName?: string; type?: string };
              annotations?: Array<{
                type?: string;
                slashCommand?: { bot?: { name?: string; displayName?: string } };
                userMention?: { user?: { name?: string; displayName?: string; type?: string } };
              }>;
            }>;
          }>(`https://chat.googleapis.com/v1/${bot.spaceId}/messages?pageSize=100`, messagesToken);

          const allMessages = msgs.messages || [];
          console.log(`[Google] Chat bot ${botShortId}: scanning ${allMessages.length} messages for bot name`);

          // 1) Messages SENT BY the bot
          const botMsg = allMessages.find(m => m.sender?.name === bot.botName && m.sender?.displayName);
          if (botMsg?.sender?.displayName) {
            bot.botDisplayName = botMsg.sender.displayName;
            console.log(`[Google] Chat bot ${botShortId}: resolved via message sender → "${bot.botDisplayName}"`);
          }

          // 2) @mentions of the bot (userMention annotation) — when a human @botname, the annotation carries displayName
          if (!bot.botDisplayName || bot.botDisplayName.startsWith("users/")) {
            for (const m of allMessages) {
              const mention = m.annotations?.find(a =>
                a.type === "USER_MENTION" &&
                a.userMention?.user?.name === bot.botName &&
                a.userMention?.user?.displayName,
              );
              if (mention?.userMention?.user?.displayName) {
                bot.botDisplayName = mention.userMention.user.displayName;
                console.log(`[Google] Chat bot ${botShortId}: resolved via @mention annotation → "${bot.botDisplayName}"`);
                break;
              }
            }
          }

          // 3) Slash-command annotation — contains the bot's displayName
          if (!bot.botDisplayName || bot.botDisplayName.startsWith("users/")) {
            for (const m of allMessages) {
              const slash = m.annotations?.find(a =>
                a.type === "SLASH_COMMAND" &&
                a.slashCommand?.bot?.name === bot.botName &&
                a.slashCommand?.bot?.displayName,
              );
              if (slash?.slashCommand?.bot?.displayName) {
                bot.botDisplayName = slash.slashCommand.bot.displayName;
                console.log(`[Google] Chat bot ${botShortId}: resolved via slash-command annotation → "${bot.botDisplayName}"`);
                break;
              }
            }
          }

          if (!bot.botDisplayName || bot.botDisplayName.startsWith("users/")) {
            // Diagnostic: show what senders appeared so we can see why match failed
            const senderSummary = allMessages.slice(0, 5).map(m =>
              `{sender=${m.sender?.name}, dn="${m.sender?.displayName ?? ""}", type=${m.sender?.type}}`,
            ).join(", ");
            console.log(`[Google] Chat bot ${botShortId}: no match in ${allMessages.length} msgs. First 5 senders: ${senderSummary}`);
          }
        } catch (err) {
          const msg = err instanceof GoogleWorkspaceError ? `${err.status}` : String(err);
          console.log(`[Google] Chat bot ${botShortId}: messages.list failed: ${msg}`);
        }
      }

      // Always fetch the space to capture spaceUri for the UI link (no admin access —
      // that can 403 for spaces outside the admin's scope).
      let spaceDisplayName: string | undefined;
      let spaceUri: string | undefined;
      let humanParticipant: string | undefined;
      try {
        const spaceData = await this.fetchApi<{
          name?: string;
          displayName?: string;
          spaceType?: string;
          singleUserBotDm?: boolean;
          spaceUri?: string;
          [k: string]: unknown;
        }>(`https://chat.googleapis.com/v1/${bot.spaceId}`, token);
        spaceDisplayName = spaceData?.displayName;
        spaceUri = spaceData?.spaceUri;
        if (spaceData?.singleUserBotDm) bot.singleUserBotDm = true;
      } catch (err) {
        const msg = err instanceof GoogleWorkspaceError ? `${err.status}` : String(err);
        console.log(`[Google] Chat bot ${botShortId}: space GET failed: ${msg}`);
      }

      // Fetch human participant(s) of this DM so we know WHO installed the bot
      if (bot.singleUserBotDm) {
        try {
          const memsData = await this.fetchApi<{ memberships?: Array<{ member?: { name?: string; displayName?: string; type?: string } }> }>(
            `https://chat.googleapis.com/v1/${bot.spaceId}/members?pageSize=10`,
            token,
          );
          const human = memsData.memberships?.find(m => m.member?.type === "HUMAN")?.member;
          let resolved = human?.displayName;
          if (!resolved && human?.name?.startsWith("users/")) {
            // Try to resolve the user ID to an email via Admin SDK Directory API
            const userId = human.name.replace("users/", "");
            try {
              const adminToken = await this.getToken([
                "https://www.googleapis.com/auth/admin.directory.user.readonly",
              ], this.adminEmail);
              const userInfo = await this.fetchApi<{ primaryEmail?: string; name?: { fullName?: string } }>(
                `https://admin.googleapis.com/admin/directory/v1/users/${userId}?projection=basic`,
                adminToken,
              );
              resolved = userInfo.name?.fullName || userInfo.primaryEmail || userId;
            } catch {
              resolved = userId;
            }
          }
          humanParticipant = resolved;
        } catch { /* ignore */ }
      }

      bot.spaceUri = spaceUri;
      if (humanParticipant) bot.humanParticipant = humanParticipant;

      // If we already have a non-raw display name, we're done
      if (bot.botDisplayName && !bot.botDisplayName.startsWith("users/")) continue;

      // Use the space display name if it's meaningful (group spaces often have one)
      if (spaceDisplayName && !spaceDisplayName.startsWith("users/") && !spaceDisplayName.startsWith("spaces/")) {
        bot.botDisplayName = spaceDisplayName;
        console.log(`[Google] Chat bot ${botShortId}: using space displayName "${bot.botDisplayName}"`);
        continue;
      }

      // Friendly fallback with attribution
      if (bot.singleUserBotDm || bot.spaceType === "DIRECT_MESSAGE") {
        bot.botDisplayName = humanParticipant
          ? `Chat Bot (DM with ${humanParticipant})`
          : `Chat Bot (Private DM)`;
      } else if (bot.botDisplayName?.startsWith("users/")) {
        bot.botDisplayName = `Chat Bot in ${bot.spaceName || "space"}`;
      }
    }
  }

  // ── Vertex AI: Agent & Model Discovery ────────────

  /**
   * List Vertex AI endpoints in a project
   */
  async listVertexEndpoints(location = "us-central1"): Promise<VertexAIEndpoint[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);

    const data = await this.fetchSafe<{ endpoints?: VertexAIEndpoint[] }>(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/endpoints`,
      token
    );

    return data?.endpoints || [];
  }

  /**
   * List Vertex AI models in a project
   */
  async listVertexModels(location = "us-central1"): Promise<VertexAIModel[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);

    const data = await this.fetchSafe<{ models?: VertexAIModel[] }>(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/models`,
      token
    );

    return data?.models || [];
  }

  /**
   * List Vertex AI custom training jobs
   */
  async listVertexCustomJobs(location = "us-central1"): Promise<VertexAICustomJob[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);

    const data = await this.fetchSafe<{ customJobs?: VertexAICustomJob[] }>(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/customJobs`,
      token
    );

    return data?.customJobs || [];
  }

  /**
   * List Vertex AI Reasoning Engines (Agent Builder agents)
   * These are the core "agents" in Google's AI ecosystem
   * API: GET /v1/projects/{project}/locations/{location}/reasoningEngines
   */
  async listReasoningEngines(location = "us-central1"): Promise<VertexAIReasoningEngine[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform",
    ]);

    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/reasoningEngines`;
    try {
      const data = await this.fetchApi<{ reasoningEngines?: VertexAIReasoningEngine[] }>(url, token);
      const count = data?.reasoningEngines?.length || 0;
      console.log(`[Google] ReasoningEngines@${location}: ${count} found`);
      return data?.reasoningEngines || [];
    } catch (err) {
      const msg = err instanceof GoogleWorkspaceError ? `${err.status} ${err.body?.slice(0, 200)}` : String(err);
      console.log(`[Google] ReasoningEngines@${location} ERROR: ${msg}`);
      return [];
    }
  }

  /**
   * List Vertex AI Extensions (tools/plugins used by agents)
   * API: GET /v1/projects/{project}/locations/{location}/extensions
   */
  async listExtensions(location = "us-central1"): Promise<VertexAIExtension[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);

    const data = await this.fetchSafe<{ extensions?: VertexAIExtension[] }>(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/extensions`,
      token
    );

    return data?.extensions || [];
  }

  // ── Vertex AI Pipeline Jobs ─────────────────────────

  async listPipelineJobs(location = "us-central1"): Promise<VertexAIPipelineJob[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);
    const data = await this.fetchSafe<{ pipelineJobs?: VertexAIPipelineJob[] }>(
      `https://${location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${location}/pipelineJobs?pageSize=100`,
      token
    );
    return data?.pipelineJobs || [];
  }

  async discoverPipelineJobs(): Promise<VertexAIPipelineJob[]> {
    const regions = ["us-central1", "us-east1", "us-west1", "europe-west1", "asia-east1"];
    const results = await Promise.allSettled(regions.map(r => this.listPipelineJobs(r)));
    const all: VertexAIPipelineJob[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    console.log(`[Google] Vertex AI Pipelines: ${all.length} jobs`);
    return all;
  }

  // ── NotebookLM Enterprise ─────────────────────────

  async discoverNotebookLM(): Promise<NotebookLMNotebook[]> {
    // Impersonate the admin via DWD so we can see notebooks they created/have access to.
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform",
    ], this.adminEmail);
    const locations = ["global", "us", "eu"];
    const all: NotebookLMNotebook[] = [];
    const seenNames = new Set<string>();

    for (const loc of locations) {
      // NotebookLM exposes :listRecentlyViewed (not a plain list).
      const url = `https://discoveryengine.googleapis.com/v1alpha/projects/${this.projectId}/locations/${loc}/notebooks:listRecentlyViewed?pageSize=100`;
      try {
        const data = await this.fetchApi<{ notebooks?: NotebookLMNotebook[] }>(url, token);
        const count = data?.notebooks?.length || 0;
        console.log(`[Google] NotebookLM@${loc}: ${count} notebooks`);
        for (const nb of (data?.notebooks || [])) {
          if (!seenNames.has(nb.name)) {
            seenNames.add(nb.name);
            all.push(nb);
          }
        }
      } catch (err) {
        const msg = err instanceof GoogleWorkspaceError ? `${err.status} ${err.body?.slice(0, 200)}` : String(err);
        console.log(`[Google] NotebookLM@${loc} ERROR: ${msg}`);
      }
    }

    // Enrich each notebook with its full metadata (title, sources, etc.) since
    // listRecentlyViewed returns a truncated record (no title).
    const enriched: NotebookLMNotebook[] = [];
    const results = await Promise.allSettled(all.map(nb =>
      this.fetchApi<NotebookLMNotebook & { title?: string; metadata?: { title?: string; sourceCount?: number }; sources?: unknown[] }>(
        `https://discoveryengine.googleapis.com/v1alpha/${nb.name}`, token,
      )
    ));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const base = all[i];
      if (r.status === "fulfilled") {
        const full = r.value;
        enriched.push({
          ...base,
          ...full,
          displayName: full.displayName || full.title || full.metadata?.title || base.name.split("/").pop() || "Notebook",
          sourceCount: (full as { sources?: unknown[] }).sources?.length || full.metadata?.sourceCount || 0,
        });
      } else {
        enriched.push({
          ...base,
          displayName: base.name.split("/").pop() || "Notebook",
        });
      }
    }

    console.log(`[Google] NotebookLM Enterprise total: ${enriched.length} notebooks (enriched)`);
    return enriched;
  }

  // ── Cloud Functions (v2) ──────────────────────────

  async listCloudFunctions(location = "us-central1"): Promise<CloudFunctionEntry[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);
    const data = await this.fetchSafe<{ functions?: CloudFunctionEntry[] }>(
      `https://cloudfunctions.googleapis.com/v2/projects/${this.projectId}/locations/${location}/functions?pageSize=100`,
      token
    );
    return data?.functions || [];
  }

  async discoverCloudFunctions(): Promise<CloudFunctionEntry[]> {
    const regions = [
      "us-central1", "us-east1", "us-west1", "europe-west1", "asia-east1",
      "us-east4", "europe-west2", "asia-northeast1",
    ];
    const results = await Promise.allSettled(regions.map(r => this.listCloudFunctions(r)));
    const all: CloudFunctionEntry[] = [];
    const seenNames = new Set<string>();
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const fn of r.value) {
          if (!seenNames.has(fn.name)) { seenNames.add(fn.name); all.push(fn); }
        }
      }
    }
    console.log(`[Google] Cloud Functions: ${all.length} functions`);
    return all;
  }

  // ── Cloud Run Services ────────────────────────────

  async listCloudRunServices(location = "us-central1"): Promise<CloudRunService[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);
    const data = await this.fetchSafe<{ services?: CloudRunService[] }>(
      `https://run.googleapis.com/v2/projects/${this.projectId}/locations/${location}/services?pageSize=100`,
      token
    );
    return data?.services || [];
  }

  async discoverCloudRunServices(): Promise<CloudRunService[]> {
    const regions = [
      "us-central1", "us-east1", "us-west1", "europe-west1", "asia-east1",
      "us-east4", "europe-west2", "asia-northeast1",
    ];
    const results = await Promise.allSettled(regions.map(r => this.listCloudRunServices(r)));
    const all: CloudRunService[] = [];
    const seenNames = new Set<string>();
    for (const r of results) {
      if (r.status === "fulfilled") {
        for (const svc of r.value) {
          if (!seenNames.has(svc.name)) { seenNames.add(svc.name); all.push(svc); }
        }
      }
    }
    console.log(`[Google] Cloud Run: ${all.length} services`);
    return all;
  }

  /**
   * Discover ONLY Vertex AI Reasoning Engines (pure agents) across multiple regions.
   * Used by the discoverAll() flow to skip irrelevant non-agent resources.
   */
  async discoverReasoningEnginesOnly(): Promise<VertexAIReasoningEngine[]> {
    const regions = ["us-central1", "us-east1", "us-west1", "europe-west1", "asia-east1"];
    const results = await Promise.allSettled(regions.map(r => this.listReasoningEngines(r)));
    const all: VertexAIReasoningEngine[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    return all;
  }

  /**
   * Discover Vertex AI resources across multiple regions
   * Includes reasoning engines (agents), endpoints, models, extensions, and jobs
   */
  async discoverVertexAI(): Promise<{
    endpoints: VertexAIEndpoint[];
    models: VertexAIModel[];
    jobs: VertexAICustomJob[];
    reasoningEngines: VertexAIReasoningEngine[];
    extensions: VertexAIExtension[];
  }> {
    const regions = ["us-central1", "us-east1", "us-west1", "europe-west1", "asia-east1"];
    const endpoints: VertexAIEndpoint[] = [];
    const models: VertexAIModel[] = [];
    const jobs: VertexAICustomJob[] = [];
    const reasoningEngines: VertexAIReasoningEngine[] = [];
    const extensions: VertexAIExtension[] = [];

    for (const region of regions) {
      try {
        const [ep, md, jb, re, ext] = await Promise.all([
          this.listVertexEndpoints(region),
          this.listVertexModels(region),
          this.listVertexCustomJobs(region),
          this.listReasoningEngines(region),
          this.listExtensions(region),
        ]);
        endpoints.push(...ep);
        models.push(...md);
        jobs.push(...jb);
        reasoningEngines.push(...re);
        extensions.push(...ext);
      } catch {
        // Region may not be enabled — skip
      }
    }

    return { endpoints, models, jobs, reasoningEngines, extensions };
  }

  // ── Dialogflow CX: Conversational Agent Discovery ─

  /**
   * List Dialogflow CX agents in a single location
   * API: GET https://{location}-dialogflow.googleapis.com/v3/projects/{project}/locations/{location}/agents
   */
  private async listDialogflowCXAgents(location: string): Promise<DialogflowCXAgent[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);

    const host = location === "global"
      ? "dialogflow.googleapis.com"
      : `${location}-dialogflow.googleapis.com`;

    const data = await this.fetchSafe<{ agents?: DialogflowCXAgent[] }>(
      `https://${host}/v3/projects/${this.projectId}/locations/${location}/agents`,
      token
    );

    return (data?.agents || []).map(a => ({ ...a, region: location }));
  }

  /**
   * Discover Dialogflow CX agents across all supported regions
   */
  async discoverDialogflowCX(): Promise<DialogflowCXAgent[]> {
    const regions = [
      "global", "us-central1", "us-east1", "us-west1",
      "europe-west1", "europe-west2", "asia-east1",
      "asia-northeast1", "asia-southeast1",
    ];
    const agents: DialogflowCXAgent[] = [];
    const seenNames = new Set<string>();

    for (const region of regions) {
      try {
        const regionAgents = await this.listDialogflowCXAgents(region);
        for (const a of regionAgents) {
          if (!seenNames.has(a.name)) {
            seenNames.add(a.name);
            agents.push(a);
          }
        }
      } catch {
        // Dialogflow CX may not be enabled in this region — skip
      }
    }

    return agents;
  }

  // ── Gemini for Workspace: License & Feature Discovery ─

  /**
   * Get count of users with Gemini for Workspace license assigned
   * Paginates through all results
   */
  async getGeminiLicensedUsersCount(): Promise<number> {
    // Strategy 1: Try Licensing API for explicit Gemini SKUs
    try {
      const token = await this.getToken([
        "https://www.googleapis.com/auth/apps.licensing",
      ], this.adminEmail);

      const geminiSkus = [
        { product: "101047", sku: "1010470003" },
        { product: "101047", sku: "1010470001" },
        { product: "101038", sku: "1010380003" },
      ];

      let totalCount = 0;
      const countedUsers = new Set<string>();

      for (const { product, sku } of geminiSkus) {
        let pageToken: string | undefined;
        let pages = 0;
        do {
          const params = new URLSearchParams({ maxResults: "1000", customerId: "my_customer" });
          if (pageToken) params.set("pageToken", pageToken);
          const data = await this.fetchSafe<{ items?: Array<{ userId?: string }>; nextPageToken?: string }>(
            `https://licensing.googleapis.com/apps/licensing/v1/product/${product}/sku/${sku}/users?${params}`,
            token
          );
          if (data?.items) {
            for (const item of data.items) {
              const uid = item.userId || JSON.stringify(item);
              if (!countedUsers.has(uid)) { countedUsers.add(uid); totalCount++; }
            }
          }
          pageToken = data?.nextPageToken;
          pages++;
        } while (pageToken && pages < 20);
      }

      if (totalCount > 0) return totalCount;
    } catch {
      // Licensing API not accessible
    }

    // Strategy 2: Count all Workspace users (Business Standard+ includes Gemini)
    try {
      const users = await this.listUsers();
      console.log(`[Google] Gemini user count from Workspace directory: ${users.length}`);
      return users.length;
    } catch {
      return 0;
    }
  }

  // ── Gemini Activity: Admin Reports API ──────────

  /**
   * Fetch Gemini usage activity from Admin Reports API.
   * Tries multiple application names since Google may use different identifiers.
   * Scope: admin.reports.audit.readonly (already in domain-wide delegation)
   */
  async fetchGeminiActivity(daysBack = 7): Promise<{
    events: Array<{
      userEmail: string;
      userName: string;
      timestamp: string;
      eventName: string;
      appName: string;
      parameters: Record<string, string>;
    }>;
    userSummary: Array<{
      email: string;
      displayName: string;
      eventCount: number;
      lastActive: string;
      appsUsed: string[];
    }>;
  }> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
    ], this.adminEmail);

    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const events: Array<{
      userEmail: string; userName: string; timestamp: string;
      eventName: string; appName: string; parameters: Record<string, string>;
    }> = [];

    // Try multiple application names for Gemini activity
    const appNames = ["gemini", "gemini_app", "workspace_gemini"];

    for (const appName of appNames) {
      try {
        let pageToken: string | undefined;
        let pages = 0;

        do {
          const params = new URLSearchParams({
            startTime: since,
            maxResults: "500",
          });
          if (pageToken) params.set("pageToken", pageToken);

          const data = await this.fetchSafe<{
            items?: Array<{
              id?: { time?: string; customerId?: string };
              actor?: { email?: string; profileId?: string };
              events?: Array<{
                name?: string;
                type?: string;
                parameters?: Array<{ name?: string; value?: string; multiValue?: string[] }>;
              }>;
            }>;
            nextPageToken?: string;
          }>(
            `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/${appName}?${params}`,
            token
          );

          if (data?.items) {
            for (const item of data.items) {
              const userEmail = item.actor?.email || "unknown";
              for (const event of (item.events || [])) {
                const paramMap: Record<string, string> = {};
                for (const p of (event.parameters || [])) {
                  if (p.name && p.value) paramMap[p.name] = p.value;
                }
                events.push({
                  userEmail,
                  userName: userEmail.split("@")[0],
                  timestamp: item.id?.time || "",
                  eventName: event.name || "unknown",
                  appName: paramMap["application_name"] || paramMap["doc_type"] || appName,
                  parameters: paramMap,
                });
              }
            }
          }

          pageToken = data?.nextPageToken;
          pages++;
        } while (pageToken && pages < 5);

        if (events.length > 0) {
          console.log(`[Google] Gemini activity from '${appName}': ${events.length} events`);
          break;
        }
      } catch {
        // Try next application name
      }
    }

    // Also try User Usage Reports for enrollment/usage flags
    if (events.length === 0) {
      try {
        const date2DaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
          .toISOString().split("T")[0];

        const data = await this.fetchSafe<{
          usageReports?: Array<{
            entity?: { userEmail?: string; type?: string };
            parameters?: Array<{ name?: string; stringValue?: string; boolValue?: boolean; intValue?: string }>;
          }>;
        }>(
          `https://admin.googleapis.com/admin/reports/v1/usage/users/all/dates/${date2DaysAgo}?parameters=accounts:is_disabled,accounts:admin_set_name`,
          token
        );

        if (data?.usageReports) {
          for (const report of data.usageReports) {
            const email = report.entity?.userEmail;
            if (!email) continue;
            events.push({
              userEmail: email,
              userName: email.split("@")[0],
              timestamp: date2DaysAgo,
              eventName: "workspace_active",
              appName: "workspace",
              parameters: {},
            });
          }
          console.log(`[Google] User usage reports: ${events.length} active users found`);
        }
      } catch {
        // Usage reports not accessible
      }
    }

    // Aggregate by user
    const userMap = new Map<string, { email: string; displayName: string; eventCount: number; lastActive: string; appsUsed: Set<string> }>();
    for (const e of events) {
      const existing = userMap.get(e.userEmail);
      if (existing) {
        existing.eventCount++;
        if (e.timestamp > existing.lastActive) existing.lastActive = e.timestamp;
        if (e.appName) existing.appsUsed.add(e.appName);
      } else {
        userMap.set(e.userEmail, {
          email: e.userEmail,
          displayName: e.userName,
          eventCount: 1,
          lastActive: e.timestamp,
          appsUsed: new Set(e.appName ? [e.appName] : []),
        });
      }
    }

    return {
      events,
      userSummary: Array.from(userMap.values()).map(u => ({
        ...u,
        appsUsed: Array.from(u.appsUsed),
      })).sort((a, b) => b.eventCount - a.eventCount),
    };
  }

  // ── Google Vault: Gemini Conversation Export ─────

  private readonly VAULT_SCOPE = "https://www.googleapis.com/auth/ediscovery";
  private readonly VAULT_BASE = "https://vault.googleapis.com/v1";

  /**
   * Find or create a Vault matter for governance scanning.
   * Reuses an existing open matter named "Agent Governance - Gemini Audit" if found.
   */
  private async getOrCreateMatter(token: string): Promise<{ matterId: string; name: string }> {
    const listData = await this.fetchApi<{
      matters?: Array<{ matterId: string; name: string; state: string }>;
    }>(`${this.VAULT_BASE}/matters?state=OPEN&pageSize=100`, token);

    const existing = listData.matters?.find(m => m.name === "Agent Governance - Gemini Audit");
    if (existing) return { matterId: existing.matterId, name: existing.name };

    const resp = await fetch(`${this.VAULT_BASE}/matters`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Agent Governance - Gemini Audit",
        description: "Auto-created by Agent Governance platform to audit Gemini usage in Workspace.",
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new GoogleWorkspaceError(resp.status, body, `${this.VAULT_BASE}/matters`);
    }
    const matter = await resp.json() as { matterId: string; name: string };
    console.log(`[Google Vault] Created matter: ${matter.matterId}`);
    return matter;
  }

  /**
   * Create a Vault export for Gemini/Mail data and wait for it to complete.
   * Returns the export with cloud storage download info.
   */
  private async createAndWaitExport(
    token: string,
    matterId: string,
    userEmails: string[],
    daysBack: number,
    corpus: "MAIL" | "DRIVE" | "GROUPS" = "MAIL"
  ): Promise<{
    id: string;
    status: string;
    cloudStorageSink?: { files?: Array<{ bucketName: string; objectName: string; size: string; md5Hash: string }> };
    stats?: { exportedArtifactCount?: string; totalArtifactCount?: string; sizeInBytes?: string };
  } | null> {
    const startTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    const searchQuery = corpus === "MAIL"
      ? "gemini OR label:gemini"
      : "";

    const exportBody: Record<string, unknown> = {
      name: `Gemini-Audit-${Date.now()}`,
      exportOptions: {
        mailOptions: corpus === "MAIL" ? { exportFormat: "MBOX", showConfidentialModeContent: false } : undefined,
        driveOptions: corpus === "DRIVE" ? { includeAccessInfo: true } : undefined,
      },
      query: {
        corpus,
        dataScope: "ALL_DATA",
        searchMethod: userEmails.length > 0 ? "ACCOUNT" : "ENTIRE_ORG",
        accountInfo: userEmails.length > 0 ? { emails: userEmails } : undefined,
        startTime,
        endTime,
        terms: searchQuery || undefined,
      },
    };

    const createResp = await fetch(`${this.VAULT_BASE}/matters/${matterId}/exports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(exportBody),
    });

    if (!createResp.ok) {
      const body = await createResp.text();
      console.error(`[Google Vault] Export creation failed: ${body}`);
      if (createResp.status === 403 || createResp.status === 401) return null;
      throw new GoogleWorkspaceError(createResp.status, body, `${this.VAULT_BASE}/matters/${matterId}/exports`);
    }

    const exportData = await createResp.json() as { id: string; status: string };
    console.log(`[Google Vault] Export created: ${exportData.id}, polling for completion...`);

    // Poll for completion (max 2 minutes with exponential backoff)
    let attempt = 0;
    const maxAttempts = 12;
    while (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, Math.min(10000, 2000 * Math.pow(1.5, attempt))));
      attempt++;

      const status = await this.fetchApi<{ id: string; status: string; cloudStorageSink?: unknown; stats?: unknown }>(
        `${this.VAULT_BASE}/matters/${matterId}/exports/${exportData.id}`,
        token
      );

      console.log(`[Google Vault] Export ${exportData.id} poll #${attempt}: ${status.status}`);

      if (status.status === "COMPLETED") return status as any;
      if (status.status === "FAILED") {
        console.error(`[Google Vault] Export failed`);
        return null;
      }
    }

    console.warn(`[Google Vault] Export timed out after ${maxAttempts} polls`);
    return null;
  }

  /**
   * List existing completed exports from the governance matter.
   * This avoids creating new exports every time — reuses recent ones.
   */
  private async listRecentExports(token: string, matterId: string): Promise<Array<{
    id: string;
    name: string;
    status: string;
    createTime: string;
    stats?: { exportedArtifactCount?: string; totalArtifactCount?: string };
  }>> {
    const data = await this.fetchSafe<{
      exports?: Array<{
        id: string; name: string; status: string; createTime: string;
        stats?: { exportedArtifactCount?: string; totalArtifactCount?: string };
      }>;
    }>(`${this.VAULT_BASE}/matters/${matterId}/exports`, token);

    return (data?.exports || []).filter(e => e.status === "COMPLETED");
  }

  /**
   * High-level method: Fetch Gemini conversations via Google Vault.
   *
   * Strategy:
   *  1. Try listing Vault matters to verify access
   *  2. Get/create the governance matter
   *  3. Check for recent completed exports or create a new one
   *  4. Return metadata + conversation summaries
   *
   * Note: Actual MBOX content download requires GCS access which may not be
   * available. We return export metadata and stats as a practical alternative.
   */
  async fetchGeminiVaultData(daysBack = 7, userEmails: string[] = []): Promise<{
    matterId: string;
    matterName: string;
    exports: Array<{
      id: string;
      name: string;
      status: string;
      createTime: string;
      artifactCount: number;
      totalArtifacts: number;
    }>;
    newExport: {
      id: string;
      status: string;
      artifactCount: number;
      totalArtifacts: number;
      sizeBytes: number;
    } | null;
    vaultAvailable: boolean;
    message: string;
  }> {
    const token = await this.getToken([this.VAULT_SCOPE], this.adminEmail);

    // Step 1: Verify Vault access
    let matter: { matterId: string; name: string };
    try {
      matter = await this.getOrCreateMatter(token);
    } catch (e) {
      const status = e instanceof GoogleWorkspaceError ? e.status : "unknown";
      const body = e instanceof GoogleWorkspaceError ? e.message : (e instanceof Error ? e.message : String(e));
      console.error(`[Google Vault] Access failed (${status}): ${body}`);
      if (e instanceof GoogleWorkspaceError && (e.status === 403 || e.status === 401)) {
        return {
          matterId: "",
          matterName: "",
          exports: [],
          newExport: null,
          vaultAvailable: false,
          message: `Google Vault not accessible (${status}). Ensure the eDiscovery scope is authorized in Domain-Wide Delegation and the admin has Vault privileges.`,
        };
      }
      throw e;
    }

    console.log(`[Google Vault] Using matter: ${matter.matterId} (${matter.name})`);

    // Step 2: List existing completed exports
    const existingExports = await this.listRecentExports(token, matter.matterId);
    const exportSummaries = existingExports.map(e => ({
      id: e.id,
      name: e.name,
      status: e.status,
      createTime: e.createTime,
      artifactCount: parseInt(e.stats?.exportedArtifactCount || "0"),
      totalArtifacts: parseInt(e.stats?.totalArtifactCount || "0"),
    }));

    // Step 3: Check if we need a new export (skip if one was created in the last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentExport = existingExports.find(e => e.createTime > oneHourAgo);

    let newExport: { id: string; status: string; artifactCount: number; totalArtifacts: number; sizeBytes: number } | null = null;

    if (!recentExport) {
      console.log(`[Google Vault] No recent export found, creating new one...`);
      const result = await this.createAndWaitExport(token, matter.matterId, userEmails, daysBack);
      if (result) {
        newExport = {
          id: result.id,
          status: result.status,
          artifactCount: parseInt((result.stats as any)?.exportedArtifactCount || "0"),
          totalArtifacts: parseInt((result.stats as any)?.totalArtifactCount || "0"),
          sizeBytes: parseInt((result.stats as any)?.sizeInBytes || "0"),
        };
      }
    } else {
      console.log(`[Google Vault] Reusing recent export: ${recentExport.id}`);
    }

    const totalArtifacts = newExport
      ? newExport.artifactCount
      : exportSummaries.reduce((sum, e) => sum + e.artifactCount, 0);

    return {
      matterId: matter.matterId,
      matterName: matter.name,
      exports: exportSummaries,
      newExport,
      vaultAvailable: true,
      message: totalArtifacts > 0
        ? `Found ${totalArtifacts} Gemini-related item(s) in Vault.`
        : "Vault is accessible but no Gemini conversations found for the selected period.",
    };
  }

  // ── Cloud Logging: Agent Conversation Logs ──────

  /**
   * Fetch conversation logs from Cloud Logging for Vertex AI / Agent Builder
   * Uses: POST https://logging.googleapis.com/v2/entries:list
   * Scopes: https://www.googleapis.com/auth/logging.read
   */
  async fetchConversationLogs(daysBack = 7, pageSize = 200): Promise<CloudLogEntry[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/logging.read",
      "https://www.googleapis.com/auth/cloud-platform",
    ]);

    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    // Target actual conversation/query logs, NOT audit logs
    const filter = `timestamp >= "${since}" AND NOT protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog" AND (logName : "discoveryengine" OR logName : "dialogflow" OR logName : "aiplatform" OR logName : "conversation" OR logName : "agent_assist" OR logName : "requests")`;

    console.log(`[Google] Cloud Logging filter: ${filter}`);

    const entries: CloudLogEntry[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const body: Record<string, unknown> = {
        resourceNames: [`projects/${this.projectId}`],
        filter,
        orderBy: "timestamp desc",
        pageSize: Math.min(pageSize, 1000),
      };
      if (pageToken) body.pageToken = pageToken;

      const response = await fetch("https://logging.googleapis.com/v2/entries:list", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        if ([401, 403].includes(response.status)) {
          console.warn("[Google] No access to Cloud Logging — need logging.read scope. Error:", errText.slice(0, 200));
          break;
        }
        console.warn(`[Google] Cloud Logging error (${response.status}):`, errText.slice(0, 300));

        // If the filter fails, try an even broader search
        if (response.status === 400 && pages === 0) {
          console.log("[Google] Retrying with broader filter (excluding audit logs)...");
          const broaderBody = {
            resourceNames: [`projects/${this.projectId}`],
            filter: `timestamp >= "${since}" AND NOT protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog"`,
            orderBy: "timestamp desc",
            pageSize: 100,
          };
          const retryRes = await fetch("https://logging.googleapis.com/v2/entries:list", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(broaderBody),
          });
          if (retryRes.ok) {
            const retryData = await retryRes.json() as { entries?: CloudLogEntry[] };
            if (retryData.entries) {
              // Log the resource types we see so we can fix the filter
              const types = new Set(retryData.entries.map(e => e.resource?.type).filter(Boolean));
              const logNames = new Set(retryData.entries.map(e => e.logName?.split("/").pop()).filter(Boolean));
              console.log("[Google] Available resource types:", [...types].join(", "));
              console.log("[Google] Available log names:", [...logNames].join(", "));
              // Filter for anything AI-related
              const aiEntries = retryData.entries.filter(e => {
                const t = (e.resource?.type || "").toLowerCase();
                const l = (e.logName || "").toLowerCase();
                const p = JSON.stringify(e.jsonPayload || e.textPayload || "").toLowerCase();
                return t.includes("discovery") || t.includes("aiplatform") || t.includes("dialogflow") ||
                  l.includes("discovery") || l.includes("aiplatform") || l.includes("dialogflow") || l.includes("agent") ||
                  p.includes("conversation") || p.includes("query") || p.includes("answer") || p.includes("agent");
              });
              entries.push(...aiEntries);
              console.log(`[Google] Broad search found ${retryData.entries.length} total logs, ${aiEntries.length} AI-related`);
            }
          }
        }
        break;
      }

      const result = await response.json() as { entries?: CloudLogEntry[]; nextPageToken?: string };
      if (result.entries) {
        entries.push(...result.entries);
        if (pages === 0) {
          // Log first entry's structure for debugging
          const first = result.entries[0];
          if (first) {
            console.log(`[Google] First log entry — resource.type: ${first.resource?.type}, logName: ${first.logName?.split("/").pop()}`);
          }
        }
      }
      pageToken = result.nextPageToken;
      pages++;
    } while (pageToken && pages < 3 && entries.length < pageSize);

    return entries;
  }

  /**
   * Fetch conversations directly from Discovery Engine (Agent Builder) API
   * This is where actual user questions and agent answers are stored
   * API: GET /v1/projects/{project}/locations/{location}/collections/default_collection/engines/{engine}/conversations
   */
  async fetchEngineConversations(engineName: string, location = "global"): Promise<AgentConversation[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform",
    ]);

    const conversations: AgentConversation[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const params = new URLSearchParams({ pageSize: "50" });
      if (pageToken) params.set("pageToken", pageToken);

      // Try both v1alpha and v1
      let data: any = null;
      for (const version of ["v1alpha", "v1"]) {
        const url = `https://discoveryengine.googleapis.com/${version}/${engineName}/conversations?${params}`;
        console.log(`[Google] Fetching conversations: ${url}`);
        const result = await this.fetchSafe<{ conversations?: any[]; nextPageToken?: string }>(url, token);
        if (result?.conversations && result.conversations.length > 0) {
          data = result;
          break;
        }
        if (result && !result.conversations) {
          data = result; // API responded but empty
        }
      }

      if (data?.conversations) {
        for (const conv of data.conversations) {
          const messages: AgentConversation["messages"] = [];

          // Each conversation has "messages" with "userInput" and "reply"
          if (conv.messages) {
            for (const msg of conv.messages) {
              // User message
              if (msg.userInput?.input) {
                messages.push({
                  id: `${conv.name}-user-${messages.length}`,
                  timestamp: msg.createTime || conv.startTime || new Date().toISOString(),
                  from: "user",
                  fromName: "User",
                  text: String(msg.userInput.input.query || msg.userInput.input.text || JSON.stringify(msg.userInput.input)).slice(0, 500),
                });
              }

              // Agent reply
              if (msg.reply) {
                const replyText = msg.reply.summary?.summaryText ||
                  msg.reply.reply ||
                  msg.reply.searchResults?.map((r: any) => r.document?.derivedStructData?.title || r.document?.name).join(", ") ||
                  JSON.stringify(msg.reply);
                messages.push({
                  id: `${conv.name}-bot-${messages.length}`,
                  timestamp: msg.createTime || conv.startTime || new Date().toISOString(),
                  from: "bot",
                  fromName: "Agent",
                  text: String(replyText).slice(0, 500),
                });
              }
            }
          }

          conversations.push({
            id: conv.name || `conv-${conversations.length}`,
            agentName: engineName.split("/engines/").pop() || "Agent",
            userName: conv.userPseudoId || "Anonymous",
            userEmail: conv.userPseudoId || "anonymous",
            startTime: conv.startTime || new Date().toISOString(),
            lastMessageTime: conv.endTime || conv.startTime || new Date().toISOString(),
            messageCount: messages.length,
            messages,
            source: "discovery_engine",
            severity: "INFO",
          });
        }
      }

      pageToken = data?.nextPageToken;
      pages++;
    } while (pageToken && pages < 3);

    return conversations;
  }

  /**
   * Fetch conversations from ALL discovered Agent Builder apps
   */
  async fetchAgentConversations(daysBack = 7): Promise<AgentConversation[]> {
    const allConversations: AgentConversation[] = [];

    // First discover all Agent Builder apps to get engine names
    const { apps } = await this.discoverAgentBuilder();
    console.log(`[Google] Found ${apps.length} Agent Builder apps, fetching conversations...`);

    for (const app of apps) {
      try {
        const convs = await this.fetchEngineConversations(app.name);
        console.log(`[Google] ${app.displayName}: ${convs.length} conversations`);
        // Set proper agent name from the app
        for (const c of convs) {
          c.agentName = app.displayName;
        }
        allConversations.push(...convs);
      } catch (e) {
        console.warn(`[Google] Failed to fetch conversations for ${app.displayName}:`, e instanceof Error ? e.message : e);
      }
    }

    // Also try Cloud Logging as fallback for other agent types
    try {
      const logs = await this.fetchConversationLogs(daysBack);
      if (logs.length > 0) {
        console.log(`[Google] Also found ${logs.length} Cloud Logging entries`);
        // Convert log entries to conversations (simplified)
        for (const entry of logs) {
          const payload = entry.jsonPayload || {};
          const textPayload = entry.textPayload || "";
          const text = String(
            payload.text || payload.query || payload.response || payload.message || textPayload ||
            (typeof payload === "object" ? JSON.stringify(payload) : String(payload))
          ).slice(0, 500);

          allConversations.push({
            id: entry.insertId || `log-${entry.timestamp}`,
            agentName: String(payload.agentName || entry.resource?.labels?.engine_id || "Cloud Log"),
            userName: String(payload.userEmail || entry.labels?.principal_email || "System"),
            userEmail: String(payload.userEmail || "system"),
            startTime: entry.timestamp,
            lastMessageTime: entry.timestamp,
            messageCount: 1,
            messages: [{
              id: entry.insertId || entry.timestamp,
              timestamp: entry.timestamp,
              from: "user" as const,
              fromName: "System",
              text,
            }],
            source: "cloud_logging",
            severity: entry.severity || "INFO",
          });
        }
      }
    } catch {
      // Cloud Logging is optional
    }

    return allConversations.sort((a, b) => b.lastMessageTime.localeCompare(a.lastMessageTime));
  }

  // ── Agent Builder / Discovery Engine ────────────

  /**
   * List Agent Builder apps (Gen App Builder / Discovery Engine)
   * These are Gemini agents created via console.cloud.google.com/gen-app-builder
   * API: GET /v1/projects/{project}/locations/{location}/collections/default_collection/engines
   */
  async listAgentBuilderApps(location = "global"): Promise<DiscoveryEngineApp[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform",
    ]);

    // Try v1alpha first (more complete), fallback to v1
    for (const version of ["v1alpha", "v1"]) {
      const url = `https://discoveryengine.googleapis.com/${version}/projects/${this.projectId}/locations/${location}/collections/default_collection/engines`;
      console.log(`[Google] Trying Agent Builder: ${url}`);
      const data = await this.fetchSafe<{ engines?: DiscoveryEngineApp[] }>(url, token);
      if (data?.engines && data.engines.length > 0) {
        return data.engines;
      }
    }

    return [];
  }

  /**
   * List Agent Builder data stores
   * API: GET /v1/projects/{project}/locations/{location}/collections/default_collection/dataStores
   */
  async listAgentBuilderDataStores(location = "global"): Promise<DiscoveryEngineDataStore[]> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform",
    ]);

    const data = await this.fetchSafe<{ dataStores?: DiscoveryEngineDataStore[] }>(
      `https://discoveryengine.googleapis.com/v1/projects/${this.projectId}/locations/${location}/collections/default_collection/dataStores`,
      token
    );

    return data?.dataStores || [];
  }

  /**
   * Discover all Agent Builder resources across locations
   */
  async discoverAgentBuilder(): Promise<{
    apps: DiscoveryEngineApp[];
    dataStores: DiscoveryEngineDataStore[];
  }> {
    const locations = ["global", "us", "eu"];
    const apps: DiscoveryEngineApp[] = [];
    const dataStores: DiscoveryEngineDataStore[] = [];

    for (const loc of locations) {
      try {
        const [a, d] = await Promise.all([
          this.listAgentBuilderApps(loc),
          this.listAgentBuilderDataStores(loc),
        ]);
        apps.push(...a);
        dataStores.push(...d);
      } catch {
        // Location may not be available
      }
    }

    return { apps, dataStores };
  }

  // ── Apps Script: Bot & Automation Discovery ───────

  /**
   * List Apps Script projects accessible by the service account
   */
  async discoverAppsScripts(): Promise<{
    projects: AppsScriptProject[];
    deployments: AppsScriptDeployment[];
  }> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/script.projects.readonly",
      "https://www.googleapis.com/auth/script.deployments.readonly",
    ], this.adminEmail);

    // Apps Script API doesn't have a "list all projects" endpoint for the domain.
    // We use the Drive API to find .gs files, then get their script project metadata.
    const driveToken = await this.getToken([
      "https://www.googleapis.com/auth/drive.readonly",
    ], this.adminEmail);

    const projects: AppsScriptProject[] = [];
    const deployments: AppsScriptDeployment[] = [];

    // Search Drive for Apps Script files
    const driveData = await this.fetchSafe<{
      files?: Array<{ id: string; name: string; createdTime?: string; modifiedTime?: string; owners?: Array<{ emailAddress: string; displayName: string }> }>;
    }>(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType='application/vnd.google-apps.script'")}&fields=files(id,name,createdTime,modifiedTime,owners)&pageSize=100`,
      driveToken
    );

    if (driveData?.files) {
      for (const file of driveData.files) {
        projects.push({
          scriptId: file.id,
          title: file.name,
          createTime: file.createdTime,
          updateTime: file.modifiedTime,
          creator: file.owners?.[0]
            ? { name: file.owners[0].displayName, email: file.owners[0].emailAddress }
            : undefined,
        });

        // Get deployments for this project
        try {
          const depData = await this.fetchSafe<{
            deployments?: AppsScriptDeployment[];
          }>(
            `https://script.googleapis.com/v1/projects/${file.id}/deployments`,
            token
          );
          if (depData?.deployments) {
            deployments.push(...depData.deployments);
          }
        } catch {
          // Skip if no access to this specific project
        }
      }
    }

    return { projects, deployments };
  }

  // ── Gemini Per-Platform Activity Breakdown ────────

  /**
   * Fetch Gemini usage broken down by Workspace platform (Gmail, Docs, Sheets, etc.)
   *
   * Uses two data sources in order of preference:
   *  1. Admin Reports Activity API — events under the "gemini" application,
   *     where each event carries a `doc_type` parameter naming the host app.
   *  2. Admin Reports User Usage API — per-user parameter counts like
   *     `gmail:num_gemini_help_me_write_clicks`, `docs:num_gemini_requests` etc.
   *
   * Scope: admin.reports.audit.readonly + admin.reports.usage.readonly
   */
  async fetchGeminiPerAppUsage(daysBack = 7): Promise<{
    platforms: GeminiPlatformUsage[];
    perUser: GeminiUserAppUsage[];
  }> {
    const APP_LABELS: Record<string, string> = {
      gmail: "Gmail", docs: "Docs", sheets: "Sheets",
      slides: "Slides", meet: "Meet", drive: "Drive",
      chat: "Chat", gemini: "Gemini App",
    };

    type PlatformAccum = { userEmails: Set<string>; requestCount: number; perUser: Map<string, number> };
    const platformMap = new Map<string, PlatformAccum>();
    // email → app → count
    const userAppMap = new Map<string, Map<string, number>>();
    // email → last active timestamp
    const userLastActive = new Map<string, string>();

    const ensurePlatform = (app: string): PlatformAccum => {
      if (!platformMap.has(app)) platformMap.set(app, { userEmails: new Set(), requestCount: 0, perUser: new Map() });
      return platformMap.get(app)!;
    };

    const addEvent = (app: string, email: string, timestamp?: string) => {
      // platform aggregation
      const p = ensurePlatform(app);
      p.userEmails.add(email);
      p.requestCount++;
      p.perUser.set(email, (p.perUser.get(email) || 0) + 1);
      // per-user app breakdown
      if (!userAppMap.has(email)) userAppMap.set(email, new Map());
      const ua = userAppMap.get(email)!;
      ua.set(app, (ua.get(app) || 0) + 1);
      // last active
      if (timestamp) {
        const prev = userLastActive.get(email) || "";
        if (!prev || timestamp > prev) userLastActive.set(email, timestamp);
      }
    };

    const normaliseDocType = (raw: string): string => {
      const v = raw.toLowerCase();
      if (v.includes("gmail") || v.includes("mail"))    return "gmail";
      if (v === "docs" || v.includes("document"))        return "docs";
      if (v.includes("sheet"))                           return "sheets";
      if (v.includes("slide") || v.includes("present")) return "slides";
      if (v.includes("meet") || v.includes("calendar")) return "meet";
      if (v.includes("drive"))                           return "drive";
      if (v.includes("chat"))                            return "chat";
      if (v === "keep")                                  return "docs";
      if (v === "classroom")                             return "docs";
      if (v === "vids")                                  return "slides";
      if (v === "gemini_app" || v === "gemini")          return "gemini";
      return "gemini";
    };

    // ── Source 1: gemini_in_workspace_apps Activity API (actual Gemini usage) ──
    // This is the correct API that returns ONLY Gemini feature interactions per user per app
    // Each event has app_name (gmail, docs, sheets, etc.), action, event_category, feature_source
    try {
      const auditToken = await this.getToken([
        "https://www.googleapis.com/auth/admin.reports.audit.readonly",
      ], this.adminEmail);

      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      let pageToken: string | undefined;
      let totalEvents = 0;
      let pages = 0;

      console.log(`[Google] Gemini usage: querying gemini_in_workspace_apps (feature_utilization)...`);

      do {
        const params = new URLSearchParams({
          startTime: since,
          maxResults: "1000",
          eventName: "feature_utilization",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const url = `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/gemini_in_workspace_apps?${params}`;
        const data = await this.fetchSafe<{
          items?: Array<{
            id?: { time?: string };
            actor?: { email?: string };
            events?: Array<{
              name?: string;
              type?: string;
              parameters?: Array<{ name?: string; value?: string }>;
            }>;
          }>;
          nextPageToken?: string;
        }>(url, auditToken);

        if (!data?.items?.length) break;

        for (const item of data.items) {
          const email = item.actor?.email;
          const ts = item.id?.time;
          if (!email) continue;

          for (const event of (item.events || [])) {
            // Skip inactive/unknown categories — only count active Gemini usage
            let eventCategory = "";
            let appName = "gemini";
            let action = "";

            for (const p of (event.parameters || [])) {
              if (p.name === "app_name" && p.value) appName = p.value.toLowerCase();
              if (p.name === "event_category" && p.value) eventCategory = p.value.toLowerCase();
              if (p.name === "action" && p.value) action = p.value.toLowerCase();
            }

            if (eventCategory === "inactive") continue;

            const mappedApp = normaliseDocType(appName);
            addEvent(mappedApp, email, ts);
            totalEvents++;
          }
        }

        pageToken = data.nextPageToken;
        pages++;
      } while (pageToken && pages < 20);

      console.log(`[Google] Gemini usage (gemini_in_workspace_apps): ${totalEvents} events across ${pages} page(s), ${platformMap.size} apps, ${userAppMap.size} users`);

      if (totalEvents === 0) {
        console.log(`[Google] Note: gemini_in_workspace_apps returned 0 events. Possible causes:`);
        console.log(`[Google]   - No users have used Gemini features in the last ${daysBack} days`);
        console.log(`[Google]   - Gemini logs available from 2025-06-20 onward (180-day rolling window)`);
        console.log(`[Google]   - Your Workspace edition may not support this report`);
      }
    } catch (e) {
      console.log(`[Google] Gemini usage (gemini_in_workspace_apps) FAILED:`, e instanceof Error ? e.message : String(e));
    }

    // ── Source 2: User Usage Reports (per-app Gemini counters) ──────
    // This API gives counts like "gmail:num_gemini_requests", "docs:num_gemini_requests"
    // Requires admin.reports.usage.readonly scope in Domain-Wide Delegation
    {
      console.log(`[Google] Gemini per-app: trying User Usage Reports for per-app counters...`);
      try {
        // Try the specific usage scope first; if not authorized, fall back to the broader audit scope
        let usageToken: string;
        try {
          usageToken = await this.getToken([
            "https://www.googleapis.com/auth/admin.reports.usage.readonly",
          ], this.adminEmail);
          console.log(`[Google] ✓ Usage Reports scope authorized successfully`);
        } catch (scopeErr) {
          console.log(`[Google] ✗ Usage scope FAILED:`, scopeErr instanceof Error ? scopeErr.message : String(scopeErr));
          console.log(`[Google]   Make sure this EXACT scope is in Domain-Wide Delegation:`);
          console.log(`[Google]   https://www.googleapis.com/auth/admin.reports.usage.readonly`);
          usageToken = await this.getToken([
            "https://www.googleapis.com/auth/admin.reports.audit.readonly",
          ], this.adminEmail);
        }

        // Try multiple dates — most recent first (yesterday, 2 days, 3 days ago)
        const datesToTry = [
          new Date(Date.now() - 1 * 86400000).toISOString().split("T")[0],
          new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0],
          new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0],
        ];

        let reportsProcessed = 0;
        const geminiParamsSeen = new Set<string>();
        let usedDate = "";

        for (const reportDate of datesToTry) {
          console.log(`[Google] Usage Reports: trying date=${reportDate}...`);

          const processReport = (report: { entity?: { userEmail?: string }; parameters?: Array<{ name?: string; intValue?: string; datetimeValue?: string; stringValue?: string; boolValue?: boolean }> }) => {
            const email = report.entity?.userEmail;
            if (!email) return;
            for (const p of (report.parameters || [])) {
              if (!p.name) continue;
              const parts = p.name.split(":");
              const appPrefix = parts[0]?.toLowerCase() || "";
              const metricName = (parts[1] || "").toLowerCase();

              // Only count explicitly Gemini-related metrics
              if (metricName.includes("gemini") || metricName.includes("help_me_write") || metricName.includes("smart_compose")) {
                geminiParamsSeen.add(p.name);
                const count = parseInt(p.intValue || "1");
                if (count > 0 || p.boolValue) addEvent(normaliseDocType(appPrefix), email);
              }
            }
          };

          let pageToken: string | undefined;
          let pages = 0;
          let dateReports = 0;
          try {
            do {
              const params = new URLSearchParams({ maxResults: "500" });
              if (pageToken) params.set("pageToken", pageToken);

              const data = await this.fetchSafe<{
                usageReports?: Array<{
                  entity?: { userEmail?: string };
                  parameters?: Array<{ name?: string; intValue?: string; datetimeValue?: string; stringValue?: string; boolValue?: boolean }>;
                }>;
                nextPageToken?: string;
              }>(
                `https://admin.googleapis.com/admin/reports/v1/usage/users/all/dates/${reportDate}?${params}`,
                usageToken
              );

              if (!data?.usageReports?.length) break;
              dateReports += data.usageReports.length;
              for (const report of data.usageReports) processReport(report);
              pageToken = data.nextPageToken;
              pages++;
            } while (pageToken && pages < 5);
          } catch {
            console.log(`[Google] Usage Reports: date=${reportDate} not available yet`);
            continue;
          }

          if (dateReports > 0) {
            reportsProcessed += dateReports;
            usedDate = reportDate;
            console.log(`[Google] Usage Reports: date=${reportDate} ✓ ${dateReports} reports`);
            break;
          }
          console.log(`[Google] Usage Reports: date=${reportDate} — empty`);
        }

        if (geminiParamsSeen.size > 0) {
          console.log(`[Google] Usage Reports: Gemini params found:`, Array.from(geminiParamsSeen).join(", "));
        }
        console.log(`[Google] Usage Reports: used date=${usedDate}, ${reportsProcessed} reports → ${platformMap.size} platforms, ${userAppMap.size} users`);
      } catch (e) {
        console.log(`[Google] Gemini usage reports FAILED:`, e instanceof Error ? e.message : String(e));
      }
    }

    // Source 3 removed — previously scanned generic Drive/Calendar/Chat/Login activity,
    // which showed ALL app users rather than only those who used Gemini features.

    // Log which specific apps were detected with user counts
    const appBreakdown = Array.from(platformMap.entries())
      .map(([app, acc]) => `${app}: ${acc.userEmails.size} users, ${acc.requestCount} events`)
      .join(" | ");
    console.log(`[Google] Gemini per-app usage final: ${platformMap.size} platforms, ${userAppMap.size} users`);
    console.log(`[Google] Gemini app breakdown: ${appBreakdown || "none"}`);

    // ── Serialise platforms ───────────────────────────
    const platforms: GeminiPlatformUsage[] = Array.from(platformMap.entries())
      .map(([app, acc]) => ({
        app,
        label: APP_LABELS[app] || app,
        userCount: acc.userEmails.size,
        requestCount: acc.requestCount,
        topUsers: Array.from(acc.perUser.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([email, count]) => ({ email, count })),
      }))
      .sort((a, b) => b.requestCount - a.requestCount);

    // ── Serialise per-user breakdown ─────────────────
    const perUser: GeminiUserAppUsage[] = Array.from(userAppMap.entries())
      .map(([email, appMap]) => {
        const apps: Record<string, number> = {};
        let total = 0;
        for (const [app, count] of appMap) { apps[app] = count; total += count; }
        return {
          email,
          displayName: email.split("@")[0],
          apps,
          totalActions: total,
          lastActive: userLastActive.get(email) || "",
        };
      })
      .sort((a, b) => b.totalActions - a.totalActions);

    return { platforms, perUser };
  }

  // ── Gemini for Workspace Status ───────────────────

  /**
   * Check if Gemini for Google Workspace is enabled.
   * Strategy: first try the Licensing API for standalone Gemini SKUs,
   * then fall back to checking the Workspace subscription via
   * Admin SDK (Business Standard+ plans bundle Gemini since 2024).
   */
  async checkGeminiEnabled(): Promise<boolean> {
    // Strategy 1: Check Licensing API for explicit Gemini SKUs
    try {
      const licToken = await this.getToken([
        "https://www.googleapis.com/auth/apps.licensing",
      ], this.adminEmail);

      const geminiSkus = [
        { product: "101047", sku: "1010470003" },
        { product: "101047", sku: "1010470001" },
        { product: "101038", sku: "1010380003" },
      ];

      for (const { product, sku } of geminiSkus) {
        const data = await this.fetchSafe<{ items?: unknown[] }>(
          `https://licensing.googleapis.com/apps/licensing/v1/product/${product}/sku/${sku}/users?maxResults=1&customerId=my_customer`,
          licToken
        );
        if ((data?.items?.length ?? 0) > 0) {
          console.log(`[Google] Gemini detected via Licensing API (${product}/${sku})`);
          return true;
        }
      }
    } catch {
      // Licensing API not accessible — fall through to subscription check
    }

    // Strategy 2: Check subscription type — Business Standard and above include Gemini
    try {
      const subToken = await this.getToken([
        "https://www.googleapis.com/auth/admin.directory.customer.readonly",
      ], this.adminEmail);

      const data = await this.fetchSafe<{ subscriptions?: Array<{ skuId?: string; skuName?: string; plan?: { planName?: string } }> }>(
        `https://reseller.googleapis.com/apps/reseller/v1/subscriptions?customerId=my_customer`,
        subToken
      );

      if (data?.subscriptions) {
        const geminiPlans = data.subscriptions.filter(s =>
          (s.skuName || "").toLowerCase().includes("business standard") ||
          (s.skuName || "").toLowerCase().includes("business plus") ||
          (s.skuName || "").toLowerCase().includes("enterprise")
        );
        if (geminiPlans.length > 0) {
          console.log(`[Google] Gemini detected via Workspace subscription: ${geminiPlans.map(p => p.skuName).join(", ")}`);
          return true;
        }
      }
    } catch {
      // Reseller API not accessible — fall through
    }

    // Strategy 3: If we found Workspace users, Business Standard+ includes Gemini
    try {
      const users = await this.listUsers();
      if (users.length > 0) {
        console.log(`[Google] Gemini assumed enabled: ${users.length} Workspace users found (Business Standard includes Gemini)`);
        return true;
      }
    } catch {
      // Can't list users
    }

    return false;
  }

  // ── Gemini Gems Discovery ────────────────────────

  async debugGeminiAudit(): Promise<{ events: unknown[]; gems: GeminiGem[]; errors: string[] }> {
    const errors: string[] = [];
    const allEvents: unknown[] = [];

    const token = await this.getToken([
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
    ], this.adminEmail);

    // Query all Gemini activity events (not just feature_utilization) to find Gem-related events
    const appNames = ["gemini_in_workspace_apps"];

    for (const appName of appNames) {
      try {
        const url = `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/${appName}?maxResults=200`;
        const data = await this.fetchApi<{ items?: Array<{ id?: unknown; actor?: unknown; events?: unknown[] }> }>(url, token);
        const items = data?.items || [];
        console.log(`[Gems Debug] Audit "${appName}": ${items.length} items`);
        for (const item of items.slice(0, 20)) {
          console.log(`  → actor:`, JSON.stringify(item.actor), `events:`, JSON.stringify(item.events));
          allEvents.push(item);
        }
      } catch (err) {
        const msg = `Audit "${appName}" FAILED: ${err instanceof Error ? err.message : String(err)}`;
        console.log(`[Gems Debug] ${msg}`);
        errors.push(msg);
      }
    }

    // Also try the Gemini-specific event types for Gem creation/usage
    // Also query without eventName filter to see ALL event types
    try {
      const url = `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/gemini_in_workspace_apps?maxResults=200`;
      const data = await this.fetchApi<{ items?: Array<{ id?: unknown; actor?: unknown; events?: unknown[] }> }>(url, token);
      const items = data?.items || [];
      console.log(`[Gems Debug] ALL gemini_in_workspace_apps events (no filter): ${items.length} items`);
      const eventTypes = new Set<string>();
      for (const item of items) {
        for (const evt of (item.events as Array<{ name?: string }> || [])) {
          eventTypes.add(evt.name || "unknown");
        }
      }
      console.log(`[Gems Debug] Unique event types: ${[...eventTypes].join(", ")}`);
      if (items.length > allEvents.length) {
        allEvents.length = 0;
        allEvents.push(...items);
      }
    } catch (err) {
      const msg = `ALL events query FAILED: ${err instanceof Error ? err.message : String(err)}`;
      console.log(`[Gems Debug] ${msg}`);
      errors.push(msg);
    }

    // Parse all Gemini audit events to find Gem-related ones
    const gemNames = new Map<string, { name: string; users: Set<string>; lastUsed: string }>();

    for (const item of allEvents) {
      const rec = item as { actor?: { email?: string }; events?: Array<{ name?: string; parameters?: Array<{ name?: string; value?: string }> }> };
      const email = rec.actor?.email || "";
      for (const evt of (rec.events || [])) {
        const params = evt.parameters || [];
        const paramMap: Record<string, string> = {};
        for (const p of params) {
          if (p.name && p.value) paramMap[p.name] = p.value;
        }
        // Look for any parameter that mentions "gem"
        const allVals = Object.entries(paramMap).map(([k, v]) => `${k}=${v}`).join(" | ");
        if (/gem/i.test(allVals) || /gem/i.test(evt.name || "")) {
          console.log(`[Gems Debug] ★ GEM-related event: ${evt.name} by ${email} → ${allVals}`);
          const gemName = paramMap.gem_name || paramMap.custom_gem_name || paramMap.gem_id || evt.name || "unknown";
          if (!gemNames.has(gemName)) {
            gemNames.set(gemName, { name: gemName, users: new Set(), lastUsed: "" });
          }
          const entry = gemNames.get(gemName)!;
          entry.users.add(email);
        }
      }
    }

    console.log(`[Gems Debug] Found ${gemNames.size} unique Gem-related entries from audit`);

    // Build Gem objects from audit data
    const gems: GeminiGem[] = [];
    for (const [key, val] of gemNames) {
      gems.push({
        id: `audit-${key}`,
        name: val.name,
        owner: { email: [...val.users][0] || "unknown", displayName: "" },
        shared: val.users.size > 1,
        sharedWith: [],
        createdTime: "",
        modifiedTime: val.lastUsed,
      });
    }

    return { events: allEvents.slice(0, 30), gems, errors };
  }

  /**
   * Fast Gems discovery — only the domain-wide Drive search for shared Gems.
   * Skips per-user Drive scans and Reports-API activity summary.
   * Returns only real Gem files (MIME type application/vnd.google-gemini.gem).
   */
  async discoverSharedGems(): Promise<GeminiGem[]> {
    const gems: GeminiGem[] = [];
    try {
      const token = await this.getToken([
        "https://www.googleapis.com/auth/drive.readonly",
      ], this.adminEmail);

      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: "mimeType='application/vnd.google-gemini.gem' and trashed=false",
          fields: "nextPageToken,files(id,name,mimeType,owners,shared,permissions,createdTime,modifiedTime,webViewLink)",
          pageSize: "100",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          corpora: "allDrives",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const data = await this.fetchSafe<{
          files?: Array<{
            id: string; name: string; mimeType?: string;
            owners?: Array<{ emailAddress?: string; displayName?: string }>;
            shared?: boolean;
            permissions?: Array<{ emailAddress?: string; displayName?: string; role?: string; type?: string }>;
            createdTime?: string; modifiedTime?: string; webViewLink?: string;
          }>;
          nextPageToken?: string;
        }>(`https://www.googleapis.com/drive/v3/files?${params}`, token);

        for (const file of (data?.files || [])) {
          const ownerInfo = file.owners?.[0];
          const sharedWith: GeminiGem["sharedWith"] = [];
          for (const perm of (file.permissions || [])) {
            if (perm.type === "user" && perm.emailAddress !== ownerInfo?.emailAddress) {
              sharedWith.push({
                email: perm.emailAddress || "",
                displayName: perm.displayName,
                role: perm.role || "reader",
              });
            }
          }
          gems.push({
            id: file.id,
            name: file.name || "Untitled Gem",
            owner: {
              email: ownerInfo?.emailAddress || "",
              displayName: ownerInfo?.displayName || ownerInfo?.emailAddress || "",
            },
            shared: file.shared || sharedWith.length > 0,
            sharedWith,
            createdTime: file.createdTime || "",
            modifiedTime: file.modifiedTime || "",
            webViewLink: file.webViewLink,
          });
        }
        pageToken = data?.nextPageToken;
      } while (pageToken);
    } catch (err) {
      if (err instanceof GoogleWorkspaceError && (err.status === 401 || err.status === 403)) {
        throw err;
      }
      console.log(`[Google] discoverSharedGems error:`, err instanceof Error ? err.message : String(err));
    }
    return gems.sort((a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || ""));
  }

  async discoverGems(): Promise<GeminiGem[]> {
    const gemMap = new Map<string, GeminiGem>();

    // ── Approach 1: Reports API — find users who used standalone Gemini app ──
    // Events with app_name=gemini_app represent standalone Gemini usage (which includes Gems)
    const geminiAppUsers = new Map<string, { count: number; lastActive: string }>();
    try {
      const auditToken = await this.getToken([
        "https://www.googleapis.com/auth/admin.reports.audit.readonly",
      ], this.adminEmail);

      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90-day window for better Gem coverage
      let pageToken: string | undefined;

      do {
        const params = new URLSearchParams({
          startTime: since,
          maxResults: "1000",
          eventName: "feature_utilization",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const url = `https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/gemini_in_workspace_apps?${params}`;
        const data = await this.fetchSafe<{
          items?: Array<{
            id?: { time?: string };
            actor?: { email?: string };
            events?: Array<{ parameters?: Array<{ name?: string; value?: string }> }>;
          }>;
          nextPageToken?: string;
        }>(url, auditToken);

        for (const item of (data?.items || [])) {
          const email = item.actor?.email;
          if (!email) continue;
          for (const evt of (item.events || [])) {
            const paramMap: Record<string, string> = {};
            for (const p of (evt.parameters || [])) {
              if (p.name && p.value) paramMap[p.name] = p.value;
            }
            if (paramMap.app_name === "gemini_app") {
              const existing = geminiAppUsers.get(email) || { count: 0, lastActive: "" };
              existing.count++;
              const ts = item.id?.time || "";
              if (ts > existing.lastActive) existing.lastActive = ts;
              geminiAppUsers.set(email, existing);
            }
          }
        }
        pageToken = data?.nextPageToken;
      } while (pageToken);

      console.log(`[Google] Gems: Reports API found ${geminiAppUsers.size} users of standalone Gemini app (${[...geminiAppUsers.values()].reduce((s, u) => s + u.count, 0)} events)`);
    } catch (err) {
      console.log(`[Google] Gems: Reports API error:`, err instanceof Error ? err.message : String(err));
    }

    // ── Approach 2a: Domain-wide Drive search (single query, catches all SHARED Gems org-wide) ──
    // Using the admin account with domain-wide delegation, query corpora=domain to find every
    // .gem file that has been shared within the domain — no per-user impersonation needed.
    // Private (unshared) Gems are NOT visible this way; those require per-user impersonation below.
    try {
      const adminToken = await this.getToken(
        ["https://www.googleapis.com/auth/drive.readonly"],
        this.adminEmail
      );
      let pageToken: string | undefined;
      let domainHits = 0;
      do {
        const params = new URLSearchParams({
          q: "mimeType='application/vnd.google-gemini.gem' and visibility != 'limited'",
          corpora: "domain",
          fields: "files(id,name,owners,shared,permissions,createdTime,modifiedTime,webViewLink),nextPageToken",
          pageSize: "1000",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const data = await this.fetchSafe<{
          files?: Array<{
            id: string; name: string;
            owners?: Array<{ emailAddress?: string; displayName?: string }>;
            shared?: boolean;
            permissions?: Array<{ emailAddress?: string; displayName?: string; role?: string; type?: string }>;
            createdTime?: string; modifiedTime?: string; webViewLink?: string;
          }>;
          nextPageToken?: string;
        }>(`https://www.googleapis.com/drive/v3/files?${params}`, adminToken);

        for (const file of (data?.files || [])) {
          if (gemMap.has(file.id)) continue;
          const ownerInfo = file.owners?.[0];
          const sharedWith: GeminiGem["sharedWith"] = [];
          for (const perm of (file.permissions || [])) {
            if (perm.type === "user" && perm.emailAddress !== ownerInfo?.emailAddress) {
              sharedWith.push({ email: perm.emailAddress || "", displayName: perm.displayName, role: perm.role || "reader" });
            }
          }
          gemMap.set(file.id, {
            id: file.id,
            name: file.name || "Untitled Gem",
            owner: { email: ownerInfo?.emailAddress || "", displayName: ownerInfo?.displayName || "" },
            shared: true,
            sharedWith,
            createdTime: file.createdTime || "",
            modifiedTime: file.modifiedTime || "",
            webViewLink: file.webViewLink,
          });
          domainHits++;
        }
        pageToken = data?.nextPageToken;
      } while (pageToken);
      console.log(`[Google] Gems: domain-wide Drive search found ${domainHits} shared Gems`);
    } catch (err) {
      console.log(`[Google] Gems: domain-wide Drive search error (will fall back to per-user scan):`, err instanceof Error ? err.message : String(err));
    }

    // ── Approach 2b: Targeted per-user Drive scan for private Gems ──────────────────────────────
    // Private Gems are only visible by impersonating each owner — no admin shortcut exists.
    //
    // Two-tier strategy:
    //   Tier 1 — ALL users identified by Reports API as Gemini users (no cap — these are the
    //            highest-value targets and may number in the thousands for large enterprises)
    //   Tier 2 — A sample of remaining org users (capped) to catch private Gems from users
    //            who haven't surfaced in the 90-day Reports API window
    //
    // Shared Gems are already found by the domain-wide search above; duplicates are skipped
    // automatically via gemMap.has(file.id).
    const MAX_USERS_TO_SCAN = 20;  // hard cap: scan at most 20 users (top Gemini-active by activity)
    const BATCH_SIZE = 10;          // concurrent Drive API calls per batch

    const allUsers = await this.listUsers();
    const geminiActiveEmails = new Set(geminiAppUsers.keys());

    // Pick the top MAX_USERS_TO_SCAN Gemini-active users sorted by highest activity count
    const usersToScan = allUsers
      .filter(u => geminiActiveEmails.has(u.primaryEmail))
      .sort((a, b) => {
        const aCount = geminiAppUsers.get(a.primaryEmail)?.count ?? 0;
        const bCount = geminiAppUsers.get(b.primaryEmail)?.count ?? 0;
        return bCount - aCount;
      })
      .slice(0, MAX_USERS_TO_SCAN);

    console.log(`[Google] Gems: per-user Drive scan — ${usersToScan.length} users (top ${MAX_USERS_TO_SCAN} Gemini-active out of ${geminiActiveEmails.size} active / ${allUsers.length} total)`);

    let scannedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < usersToScan.length; i += BATCH_SIZE) {
      const batch = usersToScan.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (user) => {
        const token = await this.getToken(
          ["https://www.googleapis.com/auth/drive.readonly"],
          user.primaryEmail
        );
        const params = new URLSearchParams({
          q: "mimeType='application/vnd.google-gemini.gem'",
          fields: "files(id,name,owners,shared,permissions,createdTime,modifiedTime,webViewLink)",
          pageSize: "100",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        const data = await this.fetchSafe<{
          files?: Array<{
            id: string; name: string;
            owners?: Array<{ emailAddress?: string; displayName?: string }>;
            shared?: boolean;
            permissions?: Array<{ emailAddress?: string; displayName?: string; role?: string; type?: string }>;
            createdTime?: string; modifiedTime?: string; webViewLink?: string;
          }>;
        }>(`https://www.googleapis.com/drive/v3/files?${params}`, token);
        return { user, files: data?.files || [] };
      }));

      for (const r of results) {
        if (r.status === "fulfilled") {
          scannedCount++;
          for (const file of r.value.files) {
            if (gemMap.has(file.id)) continue;  // already found via domain-wide search
            const ownerInfo = file.owners?.[0];
            const sharedWith: GeminiGem["sharedWith"] = [];
            for (const perm of (file.permissions || [])) {
              if (perm.type === "user" && perm.emailAddress !== ownerInfo?.emailAddress) {
                sharedWith.push({ email: perm.emailAddress || "", displayName: perm.displayName, role: perm.role || "reader" });
              }
            }
            gemMap.set(file.id, {
              id: file.id,
              name: file.name || "Untitled Gem",
              owner: { email: ownerInfo?.emailAddress || r.value.user.primaryEmail, displayName: ownerInfo?.displayName || (r.value.user as any).name?.fullName || "" },
              shared: file.shared || sharedWith.length > 0,
              sharedWith,
              createdTime: file.createdTime || "",
              modifiedTime: file.modifiedTime || "",
              webViewLink: file.webViewLink,
            });
          }
        } else {
          errorCount++;
          if (errorCount <= 5) console.log(`[Google] Gems: Drive scan error:`, r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      }
    }

    console.log(`[Google] Gems: per-user scan — ${scannedCount}/${usersToScan.length} users scanned, ${errorCount} errors, ${gemMap.size} total Gems (shared + private)`);

    // ── Merge: if no shared Gems found but we have Gemini app users, create a summary Gem entry ──
    // This ensures we always surface standalone Gemini usage even when no Gems are explicitly shared
    if (geminiAppUsers.size > 0) {
      const userList = [...geminiAppUsers.entries()]
        .sort((a, b) => b[1].count - a[1].count);

      const totalEvents = userList.reduce((s, [, v]) => s + v.count, 0);
      const latestActivity = userList.reduce((latest, [, v]) => v.lastActive > latest ? v.lastActive : latest, "");

      // Add all standalone Gemini users as "shared with" for visibility
      const geminiUsers: GeminiGem["sharedWith"] = userList.map(([email, data]) => ({
        email,
        displayName: email.split("@")[0],
        role: `${data.count} interactions`,
      }));

      gemMap.set("gemini-standalone-usage", {
        id: "gemini-standalone-usage",
        name: "Gemini App (Standalone)",
        owner: { email: userList[0]?.[0] || "unknown", displayName: "Google" },
        shared: true,
        sharedWith: geminiUsers,
        createdTime: "",
        modifiedTime: latestActivity,
        webViewLink: "https://gemini.google.com",
      });

      console.log(`[Google] Gems: added standalone Gemini summary — ${geminiAppUsers.size} users, ${totalEvents} events`);

      // Also add individual Gem entries per user for detailed tracking
      for (const [email, data] of userList) {
        const userId = `gemini-user-${email.replace(/[^a-z0-9]/gi, "-")}`;
        if (!gemMap.has(userId)) {
          gemMap.set(userId, {
            id: userId,
            name: `Gemini Chats by ${email.split("@")[0]}`,
            owner: { email, displayName: email.split("@")[0] },
            shared: false,
            sharedWith: [],
            createdTime: "",
            modifiedTime: data.lastActive,
            webViewLink: "https://gemini.google.com",
          });
        }
      }
    }

    const gems = Array.from(gemMap.values()).sort(
      (a, b) => (b.modifiedTime || "").localeCompare(a.modifiedTime || "")
    );
    console.log(`[Google] Gems: total ${gems.length} entries (${gemMap.size - (geminiAppUsers.size > 0 ? geminiAppUsers.size + 1 : 0)} shared + ${geminiAppUsers.size > 0 ? geminiAppUsers.size + 1 : 0} from activity)`);
    return gems;
  }

  // ── Full Discovery ────────────────────────────────

  async discoverAll(): Promise<GoogleWorkspaceDiscoveryResult> {
    const warnings: string[] = [];
    const domain = this.adminEmail.split("@")[1] || "unknown";

    // Run only the 5 pure-agent discovery calls in parallel
    const [
      chatBotsResult,
      reasoningEnginesResult,
      agentBuilderResult,
      gemsResult,
      notebookLMResult,
    ] = await Promise.allSettled([
      this.discoverChatBots(),
      this.discoverReasoningEnginesOnly(),
      this.discoverAgentBuilder(),
      this.discoverGems(),
      this.discoverNotebookLM(),
    ]);

    // 1. Google Chat bots
    let chatBots: GoogleChatBot[] = [];
    if (chatBotsResult.status === "fulfilled") {
      chatBots = chatBotsResult.value;
      console.log(`[Google] Chat bots: ${chatBots.length}`);
    } else {
      const e = chatBotsResult.reason;
      warnings.push(e instanceof GoogleWorkspaceError && (e.status === 401 || e.status === 403)
        ? "No access to Google Chat API — requires chat.spaces.readonly scope."
        : `Chat error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Vertex AI Reasoning Engines (pure agents only)
    let vertexReasoningEngines: VertexAIReasoningEngine[] = [];
    if (reasoningEnginesResult.status === "fulfilled") {
      vertexReasoningEngines = reasoningEnginesResult.value;
      console.log(`[Google] Reasoning Engines: ${vertexReasoningEngines.length}`);
    } else {
      const e = reasoningEnginesResult.reason;
      warnings.push(e instanceof GoogleWorkspaceError && (e.status === 401 || e.status === 403)
        ? "No access to Vertex AI — requires cloud-platform.read-only scope on the GCP project."
        : `Reasoning Engines error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Agent Builder (Gemini agents from Gen App Builder / Discovery Engine)
    let agentBuilderApps: DiscoveryEngineApp[] = [];
    let agentBuilderDataStores: DiscoveryEngineDataStore[] = [];
    if (agentBuilderResult.status === "fulfilled") {
      agentBuilderApps = agentBuilderResult.value.apps;
      agentBuilderDataStores = agentBuilderResult.value.dataStores;
      console.log(`[Google] Agent Builder: ${agentBuilderApps.length} apps, ${agentBuilderDataStores.length} data stores`);
    } else {
      const e = agentBuilderResult.reason;
      warnings.push(e instanceof GoogleWorkspaceError && (e.status === 401 || e.status === 403)
        ? "No access to Discovery Engine API — enable 'Vertex AI Agent Builder' API and grant cloud-platform scope."
        : `Agent Builder error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 4. Gemini Gems (shared only — fast, domain-wide Drive search)
    let gems: GeminiGem[] = [];
    if (gemsResult.status === "fulfilled") {
      gems = gemsResult.value;
      console.log(`[Google] Gems: ${gems.length} shared gems`);
    } else {
      const e = gemsResult.reason;
      warnings.push(e instanceof GoogleWorkspaceError && (e.status === 401 || e.status === 403)
        ? "No access to Drive API for Gems discovery — requires drive.readonly scope in Domain-Wide Delegation."
        : `Gems discovery error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 6. NotebookLM Enterprise
    let notebookLMNotebooks: NotebookLMNotebook[] = [];
    if (notebookLMResult.status === "fulfilled") {
      notebookLMNotebooks = notebookLMResult.value;
      console.log(`[Google] NotebookLM: ${notebookLMNotebooks.length} notebooks`);
    } else {
      const e = notebookLMResult.reason;
      warnings.push(e instanceof GoogleWorkspaceError && (e.status === 401 || e.status === 403)
        ? "No access to NotebookLM Enterprise — enable Discovery Engine API and grant cloud-platform scope."
        : `NotebookLM error: ${e instanceof Error ? e.message : String(e)}`);
    }

    return {
      oauthApps: [],
      chatBots,
      vertexEndpoints: [],
      vertexModels: [],
      vertexJobs: [],
      vertexReasoningEngines,
      vertexExtensions: [],
      vertexPipelineJobs: [],
      agentBuilderApps,
      agentBuilderDataStores,
      dialogflowAgents: [],
      appsScriptProjects: [],
      appsScriptDeployments: [],
      notebookLMNotebooks,
      cloudFunctions: [],
      cloudRunServices: [],
      geminiEnabled: false,
      geminiLicensedCount: 0,
      geminiAppUsage: [],
      geminiUserAppUsage: [],
      gems,
      workspaceUsers: [],
      domain,
      projectId: this.projectId,
      warnings,
    };
  }

  // ── Agent Details: Knowledge, Files, Permissions, Activity ───

  /**
   * Fetch full detail (knowledge sources, files, permissions, recent activity)
   * for a single Google agent. Returns a unified shape across all agent types.
   *
   * platform: "agent_builder" | "gemini_gem" | "reasoning_engine" | "google_chat" | "notebooklm"
   * agentId : the unique resource name/id of the agent (e.g. "projects/.../engines/X")
   */
  // ──────────────────────────────────────────────────────────────────────────
  // Gemini Enterprise (Agentspace) — business.gemini.google
  //
  // Gemini Enterprise is Google's Agentspace product, built on the Discovery
  // Engine API. A "Gemini Enterprise app" is an engine identified by its app ID
  // (the `cid` in the business.gemini.google URL). Under that engine live:
  //   • Assistants → Agents      (NotebookLM, Deep Research, custom "New agent"s)
  //   • Sessions                 (the user's chats)
  //   • Data stores → Documents  (knowledge files)
  // This method fetches all of those in one pass and returns real data.
  // ──────────────────────────────────────────────────────────────────────────
  async discoverGeminiEnterprise(
    engineId: string,
    location = "global",
    collection = "default_collection",
  ): Promise<{
    engine: { id: string; displayName: string; createTime?: string; updateTime?: string; location: string; collection: string; consoleUrl: string };
    agents: Array<{
      id: string; name: string; displayName: string; description: string;
      type: string; state: string; createTime?: string; updateTime?: string;
      assistant: string; dataStoreIds: string[]; icon?: string;
      authorizations: string[]; starterPrompts: string[];
    }>;
    chats: Array<{
      id: string; sessionId: string; displayName: string; userName: string; userEmail: string;
      botName: string; botId: string; state: string;
      messages: Array<{ id: string; role: string; content: string; timestamp: string }>;
      createdAt: string; updatedAt: string; containsSensitive: boolean; turnCount: number;
    }>;
    knowledge: Array<{
      botId: string; botName: string;
      sources: Array<{ type: string; name: string; url?: string; metadata?: Record<string, unknown>; addedOn?: string; componentId?: string }>;
    }>;
    files: Array<{
      id: string; fileName: string; filePath: string; userName: string; userId: string;
      operation: string; workload: string; timestamp: string; webViewLink?: string;
      relatedAgents?: Array<{ name: string; botId: string }>;
    }>;
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>;
    warnings: string[];
  }> {
    const token = await this.getToken(["https://www.googleapis.com/auth/cloud-platform"]);
    const BASE = "https://discoveryengine.googleapis.com/v1alpha";
    const enginePath = `projects/${this.projectId}/locations/${location}/collections/${collection}/engines/${engineId}`;
    const engineName = `${BASE}/${enginePath}`;
    const warnings: string[] = [];

    // ── 1. Engine metadata ────────────────────────────────────────────────────
    // LIST engines and find the target by id. This matches the discovery scan that
    // is known to work, and avoids GET-by-id quirks. Using fetchApi (not fetchSafe)
    // so auth errors (401/403) surface correctly instead of looking like "not found".
    type EngineMeta = { name?: string; displayName?: string; createTime?: string; updateTime?: string; dataStoreIds?: string[] };
    let engineData: EngineMeta | undefined;
    try {
      const listUrl = `${BASE}/projects/${this.projectId}/locations/${location}/collections/${collection}/engines`;
      const listed = await this.fetchApi<{ engines?: EngineMeta[] }>(listUrl, token);
      engineData = (listed.engines || []).find(e => ((e.name || "").split("/engines/").pop() === engineId));
      // Fall back to a direct GET if LIST didn't include it (paging/visibility differences)
      if (!engineData) {
        engineData = await this.fetchSafe<EngineMeta>(engineName, token) || undefined;
      }
    } catch (e) {
      // Re-throw auth/permission errors so the route can report "token expired / no access"
      if (e instanceof GoogleWorkspaceError && (e.status === 401 || e.status === 403)) throw e;
      throw e;
    }
    if (!engineData) {
      throw new GoogleWorkspaceError(404, `Gemini Enterprise app "${engineId}" not found in project ${this.projectId} (location ${location}, collection ${collection}). Verify the app ID and that this token can read it.`, engineName);
    }
    const engine = {
      id: engineId,
      displayName: engineData.displayName || engineId,
      createTime: engineData.createTime,
      updateTime: engineData.updateTime,
      location,
      collection,
      consoleUrl: `https://business.gemini.google/home/cid/${engineId}`,
    };
    const engineDataStoreIds = engineData.dataStoreIds || [];

    const agents: Awaited<ReturnType<GoogleWorkspaceClient["discoverGeminiEnterprise"]>>["agents"] = [];
    const chats: Awaited<ReturnType<GoogleWorkspaceClient["discoverGeminiEnterprise"]>>["chats"] = [];
    const knowledge: Awaited<ReturnType<GoogleWorkspaceClient["discoverGeminiEnterprise"]>>["knowledge"] = [];
    const files: Awaited<ReturnType<GoogleWorkspaceClient["discoverGeminiEnterprise"]>>["files"] = [];
    const fileActivity: Awaited<ReturnType<GoogleWorkspaceClient["discoverGeminiEnterprise"]>>["fileActivity"] = [];

    const agentDefType = (a: Record<string, unknown>): string => {
      if (a.adkAgentDefinition) return "ADK Agent";
      if (a.a2aAgentDefinition) return "A2A Agent";
      if (a.dialogflowAgentDefinition) return "Dialogflow Agent";
      if (a.managedAgentDefinition) return "Managed Agent";
      return "Agent";
    };

    // ── 2. Assistants → Agents ─────────────────────────────────────────────────
    let assistantNames: string[] = [];
    const assistantsData = await this.fetchSafe<{ assistants?: Array<{ name: string }> }>(
      `${engineName}/assistants?pageSize=100`, token,
    );
    if (assistantsData?.assistants?.length) {
      assistantNames = assistantsData.assistants.map(a => a.name);
    } else {
      // Default assistant always exists for a Gemini Enterprise app
      assistantNames = [`${enginePath}/assistants/default_assistant`];
    }

    for (const assistantName of assistantNames) {
      const shortAssistant = assistantName.split("/assistants/").pop() || "default_assistant";
      let agentPageToken: string | undefined;
      let agentPages = 0;
      do {
        const params = new URLSearchParams({ pageSize: "100" });
        if (agentPageToken) params.set("pageToken", agentPageToken);
        const agentsData = await this.fetchSafe<{
          agents?: Array<Record<string, any>>; nextPageToken?: string;
        }>(`${BASE}/${assistantName}/agents?${params}`, token);
        if (!agentsData) break;
        for (const a of (agentsData.agents || [])) {
          const dataStoreIds: string[] = [];
          for (const spec of (a.dataStoreSpecs || a.toolSettings?.dataStoreSpecs || [])) {
            const ds = spec.dataStore || spec.dataStoreId;
            if (ds) dataStoreIds.push(String(ds).split("/dataStores/").pop() || String(ds));
          }
          const authorizations: string[] = (a.authorizationConfig?.toolAuthorizations || a.authorizations || [])
            .map((x: any) => (typeof x === "string" ? x : x?.serverSideAuthorization || x?.name || JSON.stringify(x)));
          const starterPrompts: string[] = (a.starterPrompts || a.suggestedPrompts || [])
            .map((p: any) => (typeof p === "string" ? p : p?.text || "")).filter(Boolean);
          const id = a.name || `${assistantName}/agents/${(a.displayName || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          agents.push({
            id,
            name: id,
            displayName: a.displayName || a.name?.split("/agents/").pop() || "Agent",
            description: a.description || a.customPlaceholderText || "",
            type: agentDefType(a),
            state: (a.state || "STATE_UNSPECIFIED").replace("STATE_", ""),
            createTime: a.createTime,
            updateTime: a.updateTime,
            assistant: shortAssistant,
            dataStoreIds,
            icon: a.icon?.uri,
            authorizations,
            starterPrompts,
          });
          if (a.createTime) {
            fileActivity.push({ id: `${id}-created`, timestamp: a.createTime, user: "system", operation: "Agent Created", target: a.displayName || "Agent" });
          }
          if (a.updateTime && a.updateTime !== a.createTime) {
            fileActivity.push({ id: `${id}-updated`, timestamp: a.updateTime, user: "system", operation: "Agent Updated", target: a.displayName || "Agent" });
          }
        }
        agentPageToken = agentsData.nextPageToken;
      } while (agentPageToken && ++agentPages < 10);
    }

    // ── 3. Sessions (chats) ────────────────────────────────────────────────────
    // List sessions on the engine, then fetch turn-level detail for a bounded set.
    const sessionStubs: Array<{ name: string; userPseudoId?: string; state?: string; displayName?: string; startTime?: string; endTime?: string }> = [];
    let sessPageToken: string | undefined;
    let sessPages = 0;
    do {
      const params = new URLSearchParams({ pageSize: "100" });
      if (sessPageToken) params.set("pageToken", sessPageToken);
      const sessData = await this.fetchSafe<{
        sessions?: Array<{ name: string; userPseudoId?: string; state?: string; displayName?: string; startTime?: string; endTime?: string }>;
        nextPageToken?: string;
      }>(`${engineName}/sessions?${params}`, token);
      if (!sessData) break;
      for (const s of (sessData.sessions || [])) sessionStubs.push(s);
      sessPageToken = sessData.nextPageToken;
    } while (sessPageToken && ++sessPages < 5 && sessionStubs.length < 500);

    const SESSION_DETAIL_LIMIT = 50; // bound the per-session turn fetches
    for (let i = 0; i < sessionStubs.length; i += 5) {
      const batch = sessionStubs.slice(i, i + 5);
      const batchResults = await Promise.allSettled(batch.map(async (stub) => {
        let full: any = stub;
        if (i < SESSION_DETAIL_LIMIT) {
          const detail = await this.fetchSafe<any>(`${BASE}/${stub.name}`, token);
          if (detail) full = { ...stub, ...detail };
        }
        return full;
      }));
      for (const r of batchResults) {
        if (r.status !== "fulfilled") continue;
        const s = r.value;
        const messages: Array<{ id: string; role: string; content: string; timestamp: string }> = [];
        for (const [idx, turn] of (s.turns || []).entries()) {
          const ts = turn.createTime || s.startTime || s.updateTime || new Date().toISOString();
          const queryText = turn.query?.text || turn.query?.input || "";
          if (queryText) messages.push({ id: `${s.name}-q-${idx}`, role: "user", content: String(queryText).slice(0, 2000), timestamp: ts });
          const answerText = turn.detailedAnswer?.answerText || turn.answerText || (typeof turn.answer === "string" ? "" : turn.answer?.answerText) || "";
          if (answerText) messages.push({ id: `${s.name}-a-${idx}`, role: "assistant", content: String(answerText).slice(0, 2000), timestamp: ts });
        }
        const sessionId = s.name?.split("/sessions/").pop() || s.name;
        chats.push({
          id: s.name,
          sessionId,
          displayName: s.displayName || `Session ${sessionId}`,
          userName: s.userPseudoId || "Anonymous",
          userEmail: s.userPseudoId || "",
          botName: engine.displayName,
          botId: engineId,
          state: (s.state || "STATE_UNSPECIFIED").replace("STATE_", ""),
          messages,
          createdAt: s.startTime || s.updateTime || new Date().toISOString(),
          updatedAt: s.endTime || s.updateTime || s.startTime || new Date().toISOString(),
          containsSensitive: false,
          turnCount: (s.turns || []).length,
        });
        if (s.startTime) {
          fileActivity.push({ id: `${s.name}-chat`, timestamp: s.startTime, user: s.userPseudoId || "user", operation: "Chat Started", target: s.displayName || `Session ${sessionId}` });
        }
      }
    }

    // ── 4. Knowledge — data stores & documents ─────────────────────────────────
    // Collect data store IDs from the engine and from each agent.
    const dataStoreIds = new Set<string>(engineDataStoreIds);
    for (const a of agents) for (const ds of a.dataStoreIds) dataStoreIds.add(ds);

    const engineKnowledgeSources: Array<{ type: string; name: string; url?: string; metadata?: Record<string, unknown>; addedOn?: string; componentId?: string }> = [];
    for (const dsId of dataStoreIds) {
      const dsPath = `projects/${this.projectId}/locations/${location}/collections/${collection}/dataStores/${dsId}`;
      const dsMeta = await this.fetchSafe<{ displayName?: string; createTime?: string; industryVertical?: string }>(`${BASE}/${dsPath}`, token);
      engineKnowledgeSources.push({
        type: "Data Store",
        name: dsMeta?.displayName || dsId,
        url: `https://console.cloud.google.com/gen-app-builder/data-stores/${dsId}?project=${this.projectId}`,
        metadata: { location, collection, industryVertical: dsMeta?.industryVertical },
        addedOn: dsMeta?.createTime,
        componentId: dsId,
      });

      const docsData = await this.fetchSafe<{
        documents?: Array<{ id: string; name: string; content?: { uri?: string; mimeType?: string }; derivedStructData?: { title?: string; link?: string }; structData?: Record<string, unknown> }>;
      }>(`${BASE}/${dsPath}/branches/default_branch/documents?pageSize=100`, token);
      for (const doc of (docsData?.documents || [])) {
        const title = doc.derivedStructData?.title || doc.id;
        const link = doc.derivedStructData?.link || doc.content?.uri;
        const mime = doc.content?.mimeType;
        engineKnowledgeSources.push({
          type: "Document",
          name: title,
          url: link,
          metadata: { dataStore: dsId, mimeType: mime },
          componentId: doc.id,
        });
        files.push({
          id: `${dsId}-${doc.id}`,
          fileName: title,
          filePath: dsId,
          userName: "—",
          userId: "",
          operation: "Indexed",
          workload: "gemini_enterprise_knowledge",
          timestamp: engine.updateTime || engine.createTime || new Date().toISOString(),
          webViewLink: link,
          relatedAgents: agents.filter(a => a.dataStoreIds.includes(dsId)).map(a => ({ name: a.displayName, botId: a.id })),
        });
      }
    }
    if (engineKnowledgeSources.length) {
      knowledge.push({ botId: engineId, botName: engine.displayName, sources: engineKnowledgeSources });
    }

    // Engine lifecycle events
    if (engine.createTime) fileActivity.push({ id: `${engineId}-engine-created`, timestamp: engine.createTime, user: "system", operation: "App Created", target: engine.displayName });
    if (engine.updateTime && engine.updateTime !== engine.createTime) fileActivity.push({ id: `${engineId}-engine-updated`, timestamp: engine.updateTime, user: "system", operation: "App Updated", target: engine.displayName });

    fileActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return { engine, agents, chats, knowledge, files, fileActivity, warnings };
  }

  async getAgentDetails(platform: string, agentId: string): Promise<{
    platform: string;
    agentId: string;
    knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }>;
    files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }>;
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>;
    permissions: Array<{ principal: string; type: string; role: string }>;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    const knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }> = [];
    const files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }> = [];
    const fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }> = [];
    const permissions: Array<{ principal: string; type: string; role: string }> = [];

    try {
      switch (platform) {
        case "agent_builder":
          await this.fetchAgentBuilderDetails(agentId, knowledge, files, fileActivity, permissions, warnings);
          break;
        case "gemini_gem":
          await this.fetchGemDetails(agentId, knowledge, files, fileActivity, permissions, warnings);
          break;
        case "reasoning_engine":
          await this.fetchReasoningEngineDetails(agentId, knowledge, files, fileActivity, permissions, warnings);
          break;
        case "google_chat":
          await this.fetchChatBotDetails(agentId, knowledge, files, fileActivity, permissions, warnings);
          break;
        case "notebooklm":
          await this.fetchNotebookLMDetails(agentId, knowledge, files, fileActivity, permissions, warnings);
          break;
        default:
          warnings.push(`Unknown platform: ${platform}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Agent details error: ${msg}`);
    }

    return { platform, agentId, knowledge, files, fileActivity, permissions, warnings };
  }

  // ── Agent Builder (Discovery Engine) details ──

  private async fetchAgentBuilderDetails(
    agentId: string,
    knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }>,
    files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }>,
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>,
    permissions: Array<{ principal: string; type: string; role: string }>,
    warnings: string[],
  ): Promise<void> {
    const token = await this.getToken(["https://www.googleapis.com/auth/cloud-platform"]);
    const engineMatch = agentId.match(/projects\/[^/]+\/locations\/([^/]+)\/collections\/([^/]+)\/engines\/([^/]+)/);
    if (!engineMatch) {
      warnings.push(`Invalid Agent Builder ID format: ${agentId}`);
      return;
    }
    const [, location, collection] = engineMatch;

    // 1. Fetch the engine to get its data store IDs
    try {
      const engine = await this.fetchApi<{ dataStoreIds?: string[]; createTime?: string; updateTime?: string; displayName?: string }>(
        `https://discoveryengine.googleapis.com/v1alpha/${agentId}`,
        token,
      );
      if (engine.createTime) {
        fileActivity.push({
          id: `${agentId}-created`, timestamp: engine.createTime,
          user: "system", operation: "Created", target: engine.displayName || "Agent",
        });
      }
      if (engine.updateTime && engine.updateTime !== engine.createTime) {
        fileActivity.push({
          id: `${agentId}-updated`, timestamp: engine.updateTime,
          user: "system", operation: "Updated", target: engine.displayName || "Agent",
        });
      }

      // 2. For each data store, list documents (knowledge + files)
      for (const dsId of (engine.dataStoreIds || [])) {
        const dsName = `projects/${this.projectId}/locations/${location}/collections/${collection}/dataStores/${dsId}`;
        knowledge.push({
          type: "Data Store", name: dsId,
          url: `https://console.cloud.google.com/gen-app-builder/data-stores/${dsId}?project=${this.projectId}`,
          metadata: { location, collection },
        });

        try {
          const docsData = await this.fetchApi<{
            documents?: Array<{ id: string; name: string; content?: { uri?: string; mimeType?: string }; derivedStructData?: { title?: string; link?: string } }>;
          }>(
            `https://discoveryengine.googleapis.com/v1alpha/${dsName}/branches/default_branch/documents?pageSize=50`,
            token,
          );
          for (const doc of (docsData.documents || [])) {
            const title = doc.derivedStructData?.title || doc.id;
            const link = doc.derivedStructData?.link || doc.content?.uri;
            files.push({
              id: doc.id, name: title,
              type: doc.content?.mimeType?.includes("pdf") ? "PDF" : doc.content?.mimeType?.includes("html") ? "Web Page" : "Document",
              mimeType: doc.content?.mimeType, webViewLink: link,
            });
          }
        } catch (err) {
          warnings.push(`Could not fetch documents for data store ${dsId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      warnings.push(`Could not fetch Agent Builder details: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Fetch IAM policy (permissions)
    try {
      const iam = await this.fetchApi<{ bindings?: Array<{ role: string; members: string[] }> }>(
        `https://discoveryengine.googleapis.com/v1alpha/${agentId}:getIamPolicy`,
        token,
      );
      for (const binding of (iam.bindings || [])) {
        for (const member of (binding.members || [])) {
          const [type, principal] = member.split(":");
          permissions.push({ principal: principal || member, type: type || "unknown", role: binding.role });
        }
      }
    } catch {
      // IAM on engines requires extra permissions; fall back silently
    }
  }

  // ── Gemini Gem details (Drive file metadata) ──

  private async fetchGemDetails(
    agentId: string,
    knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }>,
    files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }>,
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>,
    permissions: Array<{ principal: string; type: string; role: string }>,
    warnings: string[],
  ): Promise<void> {
    // agentId here is the Drive file ID of the Gem
    const token = await this.getToken([
      "https://www.googleapis.com/auth/drive.readonly",
    ], this.adminEmail);

    try {
      const fileData = await this.fetchApi<{
        id: string; name: string; mimeType?: string; size?: string;
        owners?: Array<{ emailAddress?: string; displayName?: string }>;
        permissions?: Array<{ id: string; emailAddress?: string; displayName?: string; role?: string; type?: string }>;
        createdTime?: string; modifiedTime?: string; lastModifyingUser?: { emailAddress?: string; displayName?: string };
        webViewLink?: string; description?: string;
      }>(
        `https://www.googleapis.com/drive/v3/files/${agentId}?fields=id,name,mimeType,size,owners,permissions,createdTime,modifiedTime,lastModifyingUser,webViewLink,description&supportsAllDrives=true`,
        token,
      );

      // Gem itself = knowledge (its instructions/prompt live here)
      knowledge.push({
        type: "Gem Instructions", name: fileData.name,
        url: fileData.webViewLink,
        addedOn: fileData.createdTime,
        metadata: { description: fileData.description, mimeType: fileData.mimeType },
      });

      // The Gem file itself
      files.push({
        id: fileData.id, name: fileData.name,
        type: "Gemini Gem", mimeType: fileData.mimeType,
        size: fileData.size ? parseInt(fileData.size) : undefined,
        owner: fileData.owners?.[0]?.emailAddress,
        modifiedTime: fileData.modifiedTime,
        webViewLink: fileData.webViewLink,
      });

      // Activity: created + modified
      if (fileData.createdTime) {
        fileActivity.push({
          id: `${fileData.id}-created`, timestamp: fileData.createdTime,
          user: fileData.owners?.[0]?.emailAddress || "unknown",
          operation: "Created", target: fileData.name,
        });
      }
      if (fileData.modifiedTime && fileData.modifiedTime !== fileData.createdTime) {
        fileActivity.push({
          id: `${fileData.id}-modified`, timestamp: fileData.modifiedTime,
          user: fileData.lastModifyingUser?.emailAddress || fileData.owners?.[0]?.emailAddress || "unknown",
          operation: "Modified", target: fileData.name,
        });
      }

      // Permissions from sharing
      for (const perm of (fileData.permissions || [])) {
        permissions.push({
          principal: perm.emailAddress || perm.displayName || perm.id,
          type: perm.type || "unknown",
          role: perm.role || "reader",
        });
      }
    } catch (err) {
      warnings.push(`Could not fetch Gem details: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Reasoning Engine details ──

  private async fetchReasoningEngineDetails(
    agentId: string,
    knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }>,
    files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }>,
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>,
    permissions: Array<{ principal: string; type: string; role: string }>,
    warnings: string[],
  ): Promise<void> {
    const token = await this.getToken(["https://www.googleapis.com/auth/cloud-platform"]);
    const locMatch = agentId.match(/projects\/[^/]+\/locations\/([^/]+)\/reasoningEngines/);
    if (!locMatch) {
      warnings.push(`Invalid Reasoning Engine ID: ${agentId}`);
      return;
    }
    const location = locMatch[1];

    try {
      const engine = await this.fetchApi<{
        displayName?: string; description?: string; createTime?: string; updateTime?: string;
        spec?: { packageSpec?: { pickleObjectGcsUri?: string; requirementsGcsUri?: string; dependencyFilesGcsUri?: string; pythonVersion?: string }; classMethods?: Array<{ name?: string; description?: string | null }> };
      }>(`https://${location}-aiplatform.googleapis.com/v1/${agentId}`, token);

      // Knowledge = code artifacts (GCS URIs)
      if (engine.spec?.packageSpec?.pickleObjectGcsUri) {
        knowledge.push({
          type: "Python Pickle (Agent Code)", name: "reasoning_engine.pkl",
          url: engine.spec.packageSpec.pickleObjectGcsUri,
          metadata: { pythonVersion: engine.spec.packageSpec.pythonVersion },
        });
      }
      if (engine.spec?.packageSpec?.requirementsGcsUri) {
        knowledge.push({
          type: "Requirements", name: "requirements.txt",
          url: engine.spec.packageSpec.requirementsGcsUri,
        });
      }
      if (engine.spec?.packageSpec?.dependencyFilesGcsUri) {
        knowledge.push({
          type: "Dependencies Archive", name: "dependencies.tar.gz",
          url: engine.spec.packageSpec.dependencyFilesGcsUri,
        });
      }

      // Class methods = capabilities (files acting as tools)
      for (const m of (engine.spec?.classMethods || [])) {
        if (m.name) {
          files.push({
            id: `${agentId}-method-${m.name}`, name: m.name,
            type: "Agent Method", mimeType: "application/python",
          });
        }
      }

      // Activity
      if (engine.createTime) {
        fileActivity.push({
          id: `${agentId}-created`, timestamp: engine.createTime,
          user: "system", operation: "Deployed", target: engine.displayName || "Reasoning Engine",
        });
      }
      if (engine.updateTime && engine.updateTime !== engine.createTime) {
        fileActivity.push({
          id: `${agentId}-updated`, timestamp: engine.updateTime,
          user: "system", operation: "Updated", target: engine.displayName || "Reasoning Engine",
        });
      }
    } catch (err) {
      warnings.push(`Could not fetch Reasoning Engine details: ${err instanceof Error ? err.message : String(err)}`);
    }

    // IAM
    try {
      const iam = await this.fetchApi<{ bindings?: Array<{ role: string; members: string[] }> }>(
        `https://${location}-aiplatform.googleapis.com/v1/${agentId}:getIamPolicy`,
        token,
      );
      for (const binding of (iam.bindings || [])) {
        for (const member of (binding.members || [])) {
          const [type, principal] = member.split(":");
          permissions.push({ principal: principal || member, type: type || "unknown", role: binding.role });
        }
      }
    } catch {
      // fall back silently
    }
  }

  // ── Chat Bot details ──

  private async fetchChatBotDetails(
    agentId: string,
    knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }>,
    files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }>,
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>,
    _permissions: Array<{ principal: string; type: string; role: string }>,
    warnings: string[],
  ): Promise<void> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/chat.spaces.readonly",
      "https://www.googleapis.com/auth/chat.memberships.readonly",
      "https://www.googleapis.com/auth/chat.messages.readonly",
    ], this.adminEmail);

    // agentId here is the bot's member name (e.g. "users/bot-id")
    // We need to find which spaces contain this bot
    const matchingSpaces: Array<{ name: string; displayName?: string; createTime?: string; spaceType?: string }> = [];

    try {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({ pageSize: "100" });
        if (pageToken) params.set("pageToken", pageToken);
        const data = await this.fetchApi<{
          spaces?: Array<{ name: string; displayName?: string; createTime?: string; spaceType?: string }>;
          nextPageToken?: string;
        }>(`https://chat.googleapis.com/v1/spaces?${params}`, token);

        for (const space of (data.spaces || [])) {
          try {
            const mems = await this.fetchApi<{ memberships?: Array<{ member?: { name?: string; type?: string } }> }>(
              `https://chat.googleapis.com/v1/${space.name}/members?pageSize=100`, token,
            );
            if (mems.memberships?.some(m => m.member?.name === agentId || m.member?.type === "BOT")) {
              matchingSpaces.push(space);
            }
          } catch { /* skip */ }
        }
        pageToken = data.nextPageToken;
        pages++;
      } while (pageToken && pages < 2);
    } catch (err) {
      warnings.push(`Could not list Chat spaces: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Knowledge = the spaces where the bot is installed
    for (const sp of matchingSpaces) {
      knowledge.push({
        type: "Chat Space", name: sp.displayName || sp.name,
        metadata: { spaceType: sp.spaceType, spaceId: sp.name },
      });
    }

    // Files/Activity = recent messages to/from the bot (across all matched spaces)
    for (const sp of matchingSpaces.slice(0, 5)) {
      try {
        const msgs = await this.fetchApi<{
          messages?: Array<{ name: string; sender?: { name?: string; displayName?: string; type?: string }; createTime?: string; text?: string; attachment?: unknown[] }>;
        }>(`https://chat.googleapis.com/v1/${sp.name}/messages?pageSize=30`, token);
        for (const msg of (msgs.messages || [])) {
          const preview = (msg.text || "").slice(0, 100);
          fileActivity.push({
            id: msg.name, timestamp: msg.createTime || new Date().toISOString(),
            user: msg.sender?.displayName || msg.sender?.name || "unknown",
            operation: msg.sender?.type === "BOT" ? "Bot replied" : "User messaged bot",
            target: sp.displayName || sp.name,
            details: preview,
          });
          if (msg.attachment && Array.isArray(msg.attachment) && msg.attachment.length > 0) {
            files.push({
              id: `${msg.name}-attachment`, name: "Attachment",
              type: "Chat Attachment", owner: msg.sender?.displayName || msg.sender?.name,
              modifiedTime: msg.createTime,
            });
          }
        }
      } catch {
        // Skip spaces we can't read messages from
      }
    }
  }

  // ── NotebookLM details ──

  private async fetchNotebookLMDetails(
    agentId: string,
    knowledge: Array<{ type: string; name: string; url?: string; size?: number; addedOn?: string; metadata?: Record<string, unknown> }>,
    files: Array<{ id: string; name: string; type: string; mimeType?: string; size?: number; owner?: string; modifiedTime?: string; webViewLink?: string }>,
    fileActivity: Array<{ id: string; timestamp: string; user: string; operation: string; target: string; details?: string }>,
    permissions: Array<{ principal: string; type: string; role: string }>,
    warnings: string[],
  ): Promise<void> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/cloud-platform",
    ], this.adminEmail);

    // Fetch the notebook (sources come inline — no separate list endpoint)
    try {
      const nb = await this.fetchApi<{
        name: string; displayName?: string; title?: string;
        createTime?: string; updateTime?: string; lastViewedTime?: string;
        sources?: Array<{
          name: string; displayName?: string; title?: string; sourceType?: string; createTime?: string; updateTime?: string;
          webSource?: { url?: string };
          fileSource?: { uri?: string; mimeType?: string };
          driveSource?: { documentId?: string; mimeType?: string };
        }>;
        metadata?: { sourceCount?: number; title?: string };
      }>(
        `https://discoveryengine.googleapis.com/v1alpha/${agentId}`, token,
      );

      const title = nb.displayName || nb.title || nb.metadata?.title || "Notebook";

      if (nb.createTime) {
        fileActivity.push({
          id: `${agentId}-created`, timestamp: nb.createTime,
          user: this.adminEmail, operation: "Created", target: title,
        });
      }
      if (nb.updateTime && nb.updateTime !== nb.createTime) {
        fileActivity.push({
          id: `${agentId}-updated`, timestamp: nb.updateTime,
          user: this.adminEmail, operation: "Updated", target: title,
        });
      }
      if (nb.lastViewedTime) {
        fileActivity.push({
          id: `${agentId}-viewed`, timestamp: nb.lastViewedTime,
          user: this.adminEmail, operation: "Viewed", target: title,
        });
      }

      // Sources come inline in the notebook response
      for (const src of (nb.sources || [])) {
        const sName = src.displayName || src.title || src.name.split("/").pop() || "Source";
        const sType =
          src.sourceType === "WEB" || src.webSource ? "Web Source"
          : src.sourceType === "DRIVE" || src.driveSource ? "Google Drive File"
          : src.sourceType === "FILE" || src.fileSource ? "Uploaded File"
          : src.sourceType === "DOCUMENT" ? "Google Doc"
          : "Source";
        const url = src.webSource?.url || src.fileSource?.uri || (src.driveSource?.documentId ? `https://drive.google.com/open?id=${src.driveSource.documentId}` : undefined);
        const mime = src.fileSource?.mimeType || src.driveSource?.mimeType;

        knowledge.push({
          type: sType, name: sName, url,
          addedOn: src.createTime,
          metadata: { sourceType: src.sourceType, mimeType: mime },
        });
        files.push({
          id: src.name, name: sName, type: sType,
          mimeType: mime, modifiedTime: src.updateTime || src.createTime, webViewLink: url,
        });
      }
    } catch (err) {
      warnings.push(`Could not fetch NotebookLM details: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Sharing info (permissions) — optional, silently skip if unavailable
    try {
      const share = await this.fetchApi<{
        sharingEntries?: Array<{ principal?: { user?: { email?: string }; group?: { email?: string } }; role?: string }>;
      }>(`https://discoveryengine.googleapis.com/v1alpha/${agentId}:getSharingInfo`, token);

      for (const entry of (share.sharingEntries || [])) {
        const email = entry.principal?.user?.email || entry.principal?.group?.email || "unknown";
        const type = entry.principal?.user ? "user" : entry.principal?.group ? "group" : "unknown";
        permissions.push({ principal: email, type, role: entry.role || "reader" });
      }
    } catch {
      // Sharing info endpoint may not exist for all notebooks; skip silently
    }
  }

  // ── Cloud Monitoring — Vertex AI usage metrics ───

  async getVertexAIUsageMetrics(
    periodDays: number = 7
  ): Promise<{
    endpoints: Array<{
      endpointId: string;
      displayName: string;
      predictionCount: number;
      inputTokenCount: number;
      outputTokenCount: number;
      totalTokenCount: number;
    }>;
    totalPredictions: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    periodDays: number;
  }> {
    const token = await this.getToken([
      "https://www.googleapis.com/auth/monitoring.read",
    ]);

    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - periodDays);

    const endpointMetrics = new Map<string, {
      displayName: string;
      predictions: number;
      inputTokens: number;
      outputTokens: number;
    }>();

    const metricTypes = [
      "aiplatform.googleapis.com/prediction/online/prediction_count",
      "aiplatform.googleapis.com/prediction/online/input_token_count",
      "aiplatform.googleapis.com/prediction/online/output_token_count",
    ];

    for (const metricType of metricTypes) {
      try {
        const filter = encodeURIComponent(`metric.type="${metricType}"`);
        const interval = `interval.startTime=${startTime.toISOString()}&interval.endTime=${endTime.toISOString()}`;
        const url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/timeSeries`
          + `?filter=${filter}&${interval}`
          + `&aggregation.alignmentPeriod=${periodDays * 86400}s`
          + `&aggregation.perSeriesAligner=ALIGN_SUM`;

        const data = await this.fetchSafe<{
          timeSeries?: Array<{
            metric?: { labels?: Record<string, string> };
            resource?: { labels?: Record<string, string> };
            points?: Array<{ value?: { int64Value?: string; doubleValue?: number } }>;
          }>;
        }>(url, token);

        if (data?.timeSeries) {
          for (const ts of data.timeSeries) {
            const endpointId = ts.resource?.labels?.endpoint_id || ts.metric?.labels?.endpoint_id || "unknown";
            const displayName = ts.resource?.labels?.endpoint_display_name || endpointId;

            if (!endpointMetrics.has(endpointId)) {
              endpointMetrics.set(endpointId, { displayName, predictions: 0, inputTokens: 0, outputTokens: 0 });
            }
            const entry = endpointMetrics.get(endpointId)!;

            let total = 0;
            for (const pt of (ts.points || [])) {
              total += parseInt(pt.value?.int64Value || "0") || pt.value?.doubleValue || 0;
            }

            if (metricType.includes("prediction_count")) entry.predictions += total;
            else if (metricType.includes("input_token")) entry.inputTokens += total;
            else if (metricType.includes("output_token")) entry.outputTokens += total;
          }
        }
      } catch {
        // Monitoring API may not be available
      }
    }

    try {
      const genFilter = encodeURIComponent(`metric.type=starts_with("aiplatform.googleapis.com/publisher/online_serving/")`);
      const interval = `interval.startTime=${startTime.toISOString()}&interval.endTime=${endTime.toISOString()}`;
      const url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/timeSeries`
        + `?filter=${genFilter}&${interval}`
        + `&aggregation.alignmentPeriod=${periodDays * 86400}s`
        + `&aggregation.perSeriesAligner=ALIGN_SUM`;

      const data = await this.fetchSafe<{
        timeSeries?: Array<{
          metric?: { type?: string; labels?: Record<string, string> };
          resource?: { labels?: Record<string, string> };
          points?: Array<{ value?: { int64Value?: string; doubleValue?: number } }>;
        }>;
      }>(url, token);

      if (data?.timeSeries) {
        for (const ts of data.timeSeries) {
          const model = ts.metric?.labels?.model_id || ts.metric?.labels?.model || "gemini";
          const metricType = ts.metric?.type || "";

          if (!endpointMetrics.has(model)) {
            endpointMetrics.set(model, { displayName: model, predictions: 0, inputTokens: 0, outputTokens: 0 });
          }
          const entry = endpointMetrics.get(model)!;

          let total = 0;
          for (const pt of (ts.points || [])) {
            total += parseInt(pt.value?.int64Value || "0") || pt.value?.doubleValue || 0;
          }

          if (metricType.includes("token_count") && metricType.includes("input")) entry.inputTokens += total;
          else if (metricType.includes("token_count") && metricType.includes("output")) entry.outputTokens += total;
          else if (metricType.includes("request_count") || metricType.includes("prediction")) entry.predictions += total;
        }
      }
    } catch {
      // Gen AI metrics may not be available
    }

    const endpoints = Array.from(endpointMetrics.entries()).map(([id, m]) => ({
      endpointId: id,
      displayName: m.displayName,
      predictionCount: Math.round(m.predictions),
      inputTokenCount: Math.round(m.inputTokens),
      outputTokenCount: Math.round(m.outputTokens),
      totalTokenCount: Math.round(m.inputTokens + m.outputTokens),
    }));

    return {
      endpoints,
      totalPredictions: endpoints.reduce((s, e) => s + e.predictionCount, 0),
      totalInputTokens: endpoints.reduce((s, e) => s + e.inputTokenCount, 0),
      totalOutputTokens: endpoints.reduce((s, e) => s + e.outputTokenCount, 0),
      totalTokens: endpoints.reduce((s, e) => s + e.totalTokenCount, 0),
      periodDays,
    };
  }

  /**
   * Real Gemini Enterprise (Discovery Engine) usage from Cloud Monitoring.
   * Uses the serviceruntime consumed_api request_count metric filtered to the
   * Discovery Engine service — the genuine per-method API call volume for the
   * project. Returns real request counts; the route turns these into an
   * estimated cost using list pricing.
   */
  async getGeminiEnterpriseUsageMetrics(periodDays: number = 7): Promise<{
    totalRequests: number;
    methods: Array<{ method: string; requestCount: number }>;
    periodDays: number;
  }> {
    const token = await this.getToken(["https://www.googleapis.com/auth/monitoring.read"]);

    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - periodDays);

    const byMethod = new Map<string, number>();
    try {
      const filter = encodeURIComponent(
        `metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.labels.service="discoveryengine.googleapis.com"`
      );
      const interval = `interval.startTime=${startTime.toISOString()}&interval.endTime=${endTime.toISOString()}`;
      const url = `https://monitoring.googleapis.com/v3/projects/${this.projectId}/timeSeries`
        + `?filter=${filter}&${interval}`
        + `&aggregation.alignmentPeriod=${periodDays * 86400}s`
        + `&aggregation.perSeriesAligner=ALIGN_SUM`;

      const data = await this.fetchSafe<{
        timeSeries?: Array<{
          resource?: { labels?: Record<string, string> };
          points?: Array<{ value?: { int64Value?: string; doubleValue?: number } }>;
        }>;
      }>(url, token);

      for (const ts of (data?.timeSeries || [])) {
        const fullMethod = ts.resource?.labels?.method || "discoveryengine.request";
        const method = fullMethod.split(".").pop() || fullMethod;
        let total = 0;
        for (const pt of (ts.points || [])) {
          total += parseInt(pt.value?.int64Value || "0") || pt.value?.doubleValue || 0;
        }
        byMethod.set(method, (byMethod.get(method) || 0) + total);
      }
    } catch {
      // Monitoring API may not be enabled / no permission — return zeros
    }

    const methods = Array.from(byMethod.entries())
      .map(([method, requestCount]) => ({ method, requestCount: Math.round(requestCount) }))
      .sort((a, b) => b.requestCount - a.requestCount);

    return {
      totalRequests: methods.reduce((s, m) => s + m.requestCount, 0),
      methods,
      periodDays,
    };
  }
}

// ── Helpers ──────────────────────────────────────────

export function isSensitiveGoogleScope(scope: string): boolean {
  return SENSITIVE_GOOGLE_SCOPES.has(scope);
}

export function classifyGoogleOAuthApp(app: GoogleUserOAuthApp): {
  isAiTool: boolean;
  aiToolName: string | undefined;
  vendor: string | undefined;
  riskLevel: "critical" | "high" | "medium" | "low" | undefined;
} {
  const match = AI_APP_PATTERNS.find((p) => p.pattern.test(app.displayName));
  return {
    isAiTool: !!match,
    aiToolName: match?.name,
    vendor: match?.vendor,
    riskLevel: match?.riskLevel,
  };
}

// ── Error ────────────────────────────────────────────

export class GoogleWorkspaceError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(status: number, body: string, endpoint: string) {
    const parsed = (() => {
      try { return JSON.parse(body); } catch { return null; }
    })();
    const msg = parsed?.error?.message || parsed?.error_description || body.slice(0, 200);
    super(`Google API ${status}: ${msg}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}
