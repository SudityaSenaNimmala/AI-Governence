/**
 * Per-platform capability matrix — drives which UI tabs the frontend shows,
 * gates (shows with a requirements banner), or hides entirely.
 *
 * status:
 *   "supported"   → real data available; render the tab normally.
 *   "limited"     → works, but gated by a license/key/permission OR partial data;
 *                   render the tab WITH the `note` (and `requires`) shown as a banner.
 *   "unsupported" → the provider has no API for this; HIDE the tab.
 *
 * Capabilities map 1:1 to the customer-facing tabs:
 *   file_activity | user_activity | knowledge | files | conversations | usage
 *
 * Grounded in the integration code audit (Microsoft activity routes, Google
 * Workspace client, OpenAI routes, Claude routes) — not aspirational.
 */

export type CapabilityStatus = "supported" | "limited" | "unsupported";

export interface Capability {
  status: CapabilityStatus;
  /** Backend route that serves this capability (omitted when unsupported). */
  route?: string;
  /** Concrete prerequisites the customer must satisfy (license / key / scope). */
  requires?: string[];
  /** Short, customer-facing explanation. Shown as a banner for "limited". */
  note?: string;
}

export interface PlatformCapabilities {
  label: string;
  /** Whether agent discovery/inventory works at all for this platform. */
  discovery: CapabilityStatus;
  tabs: {
    file_activity: Capability;
    user_activity: Capability;
    knowledge: Capability;
    files: Capability;
    conversations: Capability;
    usage: Capability;
  };
}

export const PLATFORM_CAPABILITIES: Record<string, PlatformCapabilities> = {
  microsoft: {
    label: "Microsoft 365",
    discovery: "supported",
    tabs: {
      file_activity: {
        status: "limited",
        route: "/api/activity/files",
        requires: ["E3 or E5 license", "ActivityFeed.Read (O365 Management API)"],
        note: "Real SharePoint/OneDrive file events, but E3/E5-gated, lagged 15–30 min, and attributed to the user — not the specific agent.",
      },
      user_activity: {
        status: "limited",
        route: "/api/activity/teams/signins",
        requires: ["AuditLog.Read.All", "Entra ID P1/P2"],
        note: "Agent/app sign-in activity from Entra audit logs. Agent matching is heuristic when no app ID is supplied.",
      },
      knowledge: {
        status: "supported",
        route: "/api/activity/knowledge",
        note: "Knowledge sources for Copilot Studio agents (via Dataverse). Requires a Dataverse environment URL.",
      },
      files: {
        status: "supported",
        route: "/api/activity/agent-permissions",
        note: "Agent app permissions / resource access resolved from Microsoft Graph.",
      },
      conversations: {
        status: "limited",
        route: "/api/activity/chats",
        note: "Full transcripts for Copilot Studio agents (Dataverse). Teams / Personal / SharePoint agents have no retrievable conversation content (audit logs are metadata-only).",
      },
      usage: {
        status: "limited",
        route: "/api/activity/azure/usage",
        note: "Reflects Azure OpenAI consumption, not native M365 Copilot usage. Token input/output split is estimated when the source doesn't provide it.",
      },
    },
  },

  google: {
    label: "Google Workspace / Gemini",
    discovery: "supported",
    tabs: {
      file_activity: {
        status: "limited",
        route: "/api/google/agent-details",
        note: "Per-agent file/source metadata. Real user-attributed file activity exists only for Chat messages and Gem owners.",
      },
      user_activity: {
        status: "supported",
        route: "/api/google/gemini-usage",
        requires: ["Gemini for Workspace license", "admin.reports.audit.readonly"],
        note: "Per-user Gemini-in-Workspace activity by app (Gmail, Docs, Sheets, …). Reports are available on a rolling 180-day window.",
      },
      knowledge: {
        status: "supported",
        route: "/api/google/agent-details",
        note: "Knowledge sources for Agent Builder apps and NotebookLM notebooks. Gem knowledge is metadata only (instruction text is not exposed).",
      },
      files: {
        status: "supported",
        route: "/api/google/agent-details",
        note: "Agent data-store documents / attached files. Bounded to discovered Agent Builder, Chat, and NotebookLM agents.",
      },
      conversations: {
        status: "limited",
        route: "/api/google/conversations",
        note: "Conversations exist only for Agent Builder apps. There is no API for Gemini, Google Chat bot, or Gem chat content; end users often appear as anonymous.",
      },
      usage: {
        status: "supported",
        route: "/api/google/usage",
        requires: ["monitoring.read"],
        note: "Vertex AI prediction counts and input/output token usage from Cloud Monitoring.",
      },
    },
  },

  openai: {
    label: "OpenAI / ChatGPT",
    discovery: "supported",
    tabs: {
      file_activity: {
        status: "supported",
        route: "/api/openai/files",
        note: "Uploaded files (Files API). OpenAI does not provide a per-file access timeline, so this is the file inventory.",
      },
      user_activity: {
        status: "limited",
        route: "/api/openai/activity",
        requires: ["Organization Admin or service-account key (sk-admin… / sk-svcacct…)"],
        note: "Per-user usage requires an org-scoped key. API traffic has no per-user attribution unless OpenAI returns user IDs.",
      },
      knowledge: {
        status: "supported",
        route: "/api/openai/knowledge",
        note: "Assistant knowledge files via vector stores (requires an assistant ID).",
      },
      files: {
        status: "supported",
        route: "/api/openai/files",
        note: "Files API inventory. A project key (not an admin key) is required for file read scope.",
      },
      conversations: {
        status: "unsupported",
        note: "OpenAI provides no endpoint to list threads, and no access to ChatGPT consumer / Team / Enterprise conversation history.",
      },
      usage: {
        status: "limited",
        route: "/api/openai/usage",
        requires: ["Organization Admin or service-account key (sk-admin… / sk-svcacct…)"],
        note: "Token/request usage requires an org-scoped key. Cost is computed from public list pricing, not OpenAI billing.",
      },
    },
  },

  claude: {
    label: "Claude / Anthropic",
    discovery: "supported",
    tabs: {
      file_activity: {
        status: "unsupported",
        note: "Anthropic's API has no endpoint for end-user file activity.",
      },
      user_activity: {
        status: "unsupported",
        note: "Anthropic's API has no endpoint for per-user activity.",
      },
      knowledge: {
        status: "unsupported",
        note: "Anthropic's API has no endpoint for agent knowledge sources.",
      },
      files: {
        status: "limited",
        route: "/api/claude/files",
        requires: ["Files API beta access"],
        note: "Lists only files uploaded via the API (Files API beta) — not end-user Claude.ai uploads.",
      },
      conversations: {
        status: "unsupported",
        note: "Anthropic's public API has no endpoint for conversation history. (Claude.ai scraping is blocked server-side.)",
      },
      usage: {
        status: "limited",
        route: "/api/claude/usage",
        requires: ["Admin API key (sk-ant-admin…)"],
        note: "Organization token usage via the Admin Usage Report. Cost is computed from public list pricing, not Anthropic billing.",
      },
    },
  },
};
