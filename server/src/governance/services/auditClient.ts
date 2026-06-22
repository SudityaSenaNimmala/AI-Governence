/**
 * O365 Management Activity API Client — Audit event ingestion
 * Per PRD Section 4.5: Primary source of post-deployment agent behavior
 * Endpoint: https://manage.office.com/api/v1.0/{tenant}/activity/feed
 *
 * Key constraints from PRD:
 * - E3/E5 only (E1/F-series have no audit log access)
 * - Events lag 15 min to 2 hours
 * - Available for 90 days (E3) or 180 days (E5)
 * - CopilotStudio workload gives: agent ID, user ID, session ID, timestamp
 * - Does NOT give conversation content or file-level access
 */

export interface AuditEvent {
  Id: string;
  CreationTime: string;
  Operation: string;
  Workload: string; // "CopilotStudio", "PowerApps", "SharePoint", etc.
  UserId: string;
  UserType: number;
  ResultStatus?: string;
  ObjectId?: string; // May contain agent/bot ID
  ClientIP?: string;
  // CopilotStudio-specific
  BotId?: string;
  SessionId?: string;
  EnvironmentId?: string;
  // Generic
  ExtendedProperties?: Array<{ Name: string; Value: string }>;
}

interface SubscriptionContent {
  contentUri: string;
  contentId: string;
  contentType: string;
  contentCreated: string;
  contentExpiration: string;
}

const MANAGE_BASE = "https://manage.office.com/api/v1.0";

export class AuditClient {
  private token: string;
  private tenantId: string;

  constructor(token: string, tenantId: string) {
    this.token = token;
    this.tenantId = tenantId;
  }

  private async fetchWithRetry(url: string, options: RequestInit = {}, retries = 2): Promise<Response> {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      },
    });

    if (response.status === 429 && retries > 0) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "10");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.fetchWithRetry(url, options, retries - 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new AuditError(response.status, body, url);
    }

    return response;
  }

  /**
   * Start (or re-enable) a subscription to receive audit content for a workload.
   * If the subscription was disabled, this re-enables it.
   * New content appears ~15 min after subscription is (re)started.
   */
  async startSubscription(contentType: string = "Audit.General"): Promise<{ status: string; message?: string }> {
    const url = `${MANAGE_BASE}/${this.tenantId}/activity/feed/subscriptions/start?contentType=${contentType}`;
    try {
      const resp = await this.fetchWithRetry(url, { method: "POST", body: "{}" });
      const data = await resp.json().catch(() => ({}));
      console.log(`[Audit] Subscription ${contentType}: started/enabled`, JSON.stringify(data));
      return { status: "enabled" };
    } catch (e) {
      if (e instanceof AuditError) {
        const body = e.body || "";
        if (e.status === 400 && (body.includes("already enabled") || body.includes("AF20024"))) {
          console.log(`[Audit] Subscription ${contentType}: already active`);
          return { status: "already_active" };
        }
        if (body.includes("does not exist") || body.includes("Tenant")) {
          console.warn(`[Audit] Subscription ${contentType}: tenant not provisioned in Audit service`);
          return { status: "tenant_not_provisioned", message: "Tenant not provisioned in O365 Audit service. An admin must enable audit logging in the Microsoft 365 compliance center first." };
        }
        console.warn(`[Audit] Subscription ${contentType} failed (${e.status}):`, e.message);
      }
      throw e;
    }
  }

  /**
   * List available content blobs for a given time window.
   * If subscription is disabled, attempts to re-enable it.
   */
  async listContent(
    contentType: string = "Audit.General",
    startTime?: string,
    endTime?: string
  ): Promise<SubscriptionContent[]> {
    let url = `${MANAGE_BASE}/${this.tenantId}/activity/feed/subscriptions/content?contentType=${contentType}`;

    if (startTime && endTime) {
      url += `&startTime=${startTime}&endTime=${endTime}`;
    }

    try {
      const response = await this.fetchWithRetry(url);
      return response.json();
    } catch (e) {
      if (e instanceof AuditError) {
        if (e.status === 403 || e.status === 401) {
          console.warn(`[Audit] No access to ${contentType} — requires E3/E5 + ActivityFeed.Read`);
          return [];
        }
        if (e.status === 400 && e.body?.includes("disabled")) {
          console.warn(`[Audit] ${contentType} subscription was disabled — attempting to re-enable...`);
          try {
            await this.startSubscription(contentType);
            console.log(`[Audit] ${contentType} subscription re-enabled. Content will be available in ~15 minutes.`);
          } catch { /* ignore re-enable failure */ }
          return [];
        }
      }
      throw e;
    }
  }

  /**
   * Fetch audit events from a content blob URI
   */
  async fetchContent(contentUri: string): Promise<AuditEvent[]> {
    const response = await this.fetchWithRetry(contentUri);
    return response.json();
  }

  /**
   * Fetch agent-related audit events for the last N days.
   * Covers CopilotStudio, PowerApps, MicrosoftCopilot, Teams, and SharePoint workloads
   * to capture activity for personal agents, SharePoint agents, and Copilot Studio bots.
   */
  async fetchAgentEvents(days: number = 7): Promise<AuditEvent[]> {
    const allEvents: AuditEvent[] = [];
    const MAX_BLOBS_PER_WINDOW = 15;
    const startedAt = Date.now();
    const TIMEOUT_MS = 40000;

    await this.startSubscription("Audit.General");

    const now = new Date();
    const windows: Array<{ start: string; end: string }> = [];

    for (let i = 0; i < Math.min(days, 7); i++) {
      const end = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      windows.push({
        start: start.toISOString().replace(/\.\d{3}Z/, ""),
        end: end.toISOString().replace(/\.\d{3}Z/, ""),
      });
    }

    for (const window of windows) {
      if (Date.now() - startedAt > TIMEOUT_MS) break;
      try {
        const contentList = await this.listContent("Audit.General", window.start, window.end);

        for (const content of contentList.slice(0, MAX_BLOBS_PER_WINDOW)) {
          if (Date.now() - startedAt > TIMEOUT_MS) break;
          try {
            const events = await this.fetchContent(content.contentUri);
            const agentEvents = events.filter((e) => {
              const wl = e.Workload || "";
              const op = e.Operation || "";
              if (wl === "CopilotStudio" || wl === "PowerApps" || wl === "MicrosoftCopilot") return true;
              if (wl === "MicrosoftTeams" && (op.includes("Bot") || op.includes("App") || op.includes("Copilot") || op.includes("Agent"))) return true;
              if (wl === "SharePoint" && (op.includes("Copilot") || op.includes("Agent"))) return true;
              if (wl === "Copilot") return true;
              return false;
            });
            allEvents.push(...agentEvents);
          } catch (e) {
            console.warn(`Failed to fetch content blob: ${content.contentUri}`, e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        console.warn(`Failed to list content for window ${window.start} - ${window.end}`, e instanceof Error ? e.message : e);
      }
    }

    console.log(`[Audit] fetchAgentEvents completed in ${Date.now() - startedAt}ms with ${allEvents.length} events`);
    return allEvents;
  }

  /**
   * Fetch SharePoint and OneDrive file activity events (file accessed, modified, downloaded, etc.)
   * Uses Audit.SharePoint content type for dedicated file events.
   */
  async fetchFileActivity(days: number = 7): Promise<AuditEvent[]> {
    const allEvents: AuditEvent[] = [];
    const MAX_BLOBS_PER_WINDOW = 10;
    const MAX_TOTAL_EVENTS = 500;
    const startedAt = Date.now();
    const TIMEOUT_MS = 45000;

    for (const contentType of ["Audit.SharePoint", "Audit.General"]) {
      try {
        await this.startSubscription(contentType);
      } catch (e) {
        console.warn(`[Audit] Failed to start ${contentType} subscription:`, e instanceof Error ? e.message : e);
      }
    }

    const now = new Date();
    const windows: Array<{ start: string; end: string }> = [];
    for (let i = 0; i < Math.min(days, 7); i++) {
      const end = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      windows.push({
        start: start.toISOString().replace(/\.\d{3}Z/, ""),
        end: end.toISOString().replace(/\.\d{3}Z/, ""),
      });
    }

    // Prioritize Audit.SharePoint (more relevant), then Audit.General
    outer:
    for (const contentType of ["Audit.SharePoint", "Audit.General"]) {
      for (const window of windows) {
        if (Date.now() - startedAt > TIMEOUT_MS || allEvents.length >= MAX_TOTAL_EVENTS) break outer;
        try {
          const contentList = await this.listContent(contentType, window.start, window.end);

          for (const content of contentList.slice(0, MAX_BLOBS_PER_WINDOW)) {
            if (Date.now() - startedAt > TIMEOUT_MS || allEvents.length >= MAX_TOTAL_EVENTS) break;
            try {
              const events = await this.fetchContent(content.contentUri);
              const fileEvents = events.filter((e) => {
                const op = e.Operation || "";
                const wl = e.Workload || "";
                return (
                  wl === "SharePoint" || wl === "OneDrive" ||
                  op.includes("File") || op.includes("Page") ||
                  op.includes("Folder") || op.includes("Download") ||
                  op.includes("Upload") || op.includes("Access") ||
                  op.includes("Sync") || op.includes("Share")
                );
              });
              allEvents.push(...fileEvents);
            } catch (e) {
              console.warn(`[Audit] Failed to fetch content blob:`, e instanceof Error ? e.message : e);
            }
          }
        } catch (e) {
          console.warn(`[Audit] Failed to list ${contentType} content for ${window.start}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    console.log(`[Audit] fetchFileActivity completed in ${Date.now() - startedAt}ms with ${allEvents.length} events`);

    const seen = new Set<string>();
    return allEvents.filter((e) => {
      if (seen.has(e.Id)) return false;
      seen.add(e.Id);
      return true;
    });
  }

  /**
   * Aggregate events by bot/agent ID for activity metrics.
   * Indexes by BotId, ObjectId, and extracted app/agent names from ObjectId
   * so personal and SharePoint agents (which lack BotId) can still be matched.
   */
  static aggregateByAgent(events: AuditEvent[]): Map<string, AgentActivitySummary> {
    const map = new Map<string, AgentActivitySummary>();

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    function getOrCreate(key: string): AgentActivitySummary {
      const existing = map.get(key);
      if (existing) return existing;
      const entry: AgentActivitySummary = {
        agentId: key,
        totalInvocations: 0,
        last7Days: 0,
        last30Days: 0,
        uniqueUsers: new Set<string>(),
        userBreakdown: new Map<string, { count: number; last: string }>(),
        lastActivity: "",
      };
      map.set(key, entry);
      return entry;
    }

    function addEvent(entry: AgentActivitySummary, event: AuditEvent) {
      entry.totalInvocations++;
      const eventTime = new Date(event.CreationTime).getTime();
      if (eventTime > sevenDaysAgo) entry.last7Days++;
      if (eventTime > thirtyDaysAgo) entry.last30Days++;
      entry.uniqueUsers.add(event.UserId);
      const userEntry = entry.userBreakdown.get(event.UserId);
      if (userEntry) {
        userEntry.count++;
        if (event.CreationTime > userEntry.last) userEntry.last = event.CreationTime;
      } else {
        entry.userBreakdown.set(event.UserId, { count: 1, last: event.CreationTime });
      }
      if (!entry.lastActivity || event.CreationTime > entry.lastActivity) {
        entry.lastActivity = event.CreationTime;
      }
    }

    for (const event of events) {
      const keys: string[] = [];
      if (event.BotId) keys.push(event.BotId);
      if (event.ObjectId) keys.push(event.ObjectId);

      // Extract app name from ObjectId (e.g. URLs or app identifiers)
      if (event.ObjectId) {
        const objLC = event.ObjectId.toLowerCase();
        const nameFromExt = event.ExtendedProperties?.find(
          (p) => p.Name === "AppDisplayName" || p.Name === "AgentName" || p.Name === "BotName"
        )?.Value;
        if (nameFromExt) keys.push(nameFromExt.toLowerCase());
        if (objLC.includes("/") && !objLC.startsWith("http")) keys.push(objLC);
      }

      if (keys.length === 0) continue;

      // Use first key as primary; add aliases that point to same summary
      const primary = getOrCreate(keys[0]);
      addEvent(primary, event);
      for (let i = 1; i < keys.length; i++) {
        if (!map.has(keys[i])) map.set(keys[i], primary);
      }
    }

    return map;
  }
}

export interface AgentActivitySummary {
  agentId: string;
  totalInvocations: number;
  last7Days: number;
  last30Days: number;
  uniqueUsers: Set<string>;
  userBreakdown: Map<string, { count: number; last: string }>;
  lastActivity: string;
}

export class AuditError extends Error {
  status: number;
  body: string;
  endpoint: string;

  constructor(status: number, body: string, endpoint: string) {
    const parsed = (() => {
      try { return JSON.parse(body); } catch { return null; }
    })();
    const msg = parsed?.error?.message || body.slice(0, 200);
    super(`O365 Audit API ${status}: ${msg}`);
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}
