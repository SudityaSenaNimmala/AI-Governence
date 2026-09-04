/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DEMO-ONLY MOCK DATA FOR AGENT GOVERNANCE — NOT PRODUCTION CODE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Lets every Agent Governance tab render a full, coherent tenant WITHOUT any
 * OAuth connection, for prospect demos.
 *
 * SCOPE: Microsoft and Google only, Gemini Enterprise included. There are
 * deliberately no OpenAI, Claude or AWS agents — see the note at the end of
 * AGENT_SPECS and the null key ids in AG_DEMO_KEYS.
 *
 * ── HOW TO TURN IT ON AND OFF ──────────────────────────────────────────────
 *   AI Hub → Setup → Settings → "Agent Governance demo data" → Demo on / Off.
 *   The switch reloads onto Agent Governance so the change is immediate.
 *
 *   ON  = sample Microsoft + Google estate, every tab instant, no network.
 *   OFF = your real discovered agents, exactly as before. Nothing in this file
 *         runs at all; the fetch shim is not even installed.
 *
 *   It is per-browser (localStorage `ag_demo_mode`), never a server flag, so
 *   turning it on never changes what anyone else sees.
 *
 *   The URL form still works if you would rather not click through:
 *     ?agDemo=1  turns it on      ?agDemo=0  turns it off
 *
 * ── HOW TO REVERT THE CODE COMPLETELY ──────────────────────────────────────
 *   1. Delete this file and agentGovernanceDemoData.verify.mjs beside it.
 *   2. Delete every block fenced between
 *          ── DEMO MODE (remove to revert) ──
 *      and ── END DEMO MODE ──
 *      in these three files (8 blocks total):
 *        AgentGovernanceContext.jsx                       (4 — import, keys, 2 effects)
 *        AgentGovernanceActions/AgentGovernanceActions.js (2 — import, request hook)
 *        ../AIHub/AIHubPage.jsx                           (2 — the Settings switch + its render)
 *      Find them all with:
 *          grep -rn "DEMO MODE" connect-ui/src/Components/App
 *   Nothing else in the codebase references this file.
 *
 * ── WHY IT IS INSTANT ──────────────────────────────────────────────────────
 *   In demo mode there is ZERO network I/O on any governance screen. Two hooks
 *   guarantee it:
 *     1. `agDemoResponse` short-circuits the actions layer's `request()`
 *        before it ever calls fetch.
 *     2. `installAgDemoFetch` patches window.fetch for `/api/*` (never
 *        `/api/v1/*`), which catches the callers that bypass the actions
 *        layer — PoliciesTab's own packFetch, the simulate calls, and the
 *        panels that use fetch() directly.
 *   Every response is built synchronously from the constants below, so a tab's
 *   load resolves within the same microtask its effect fires in — the browser
 *   never paints a spinner frame. Anything still hitting the network logs a
 *   loud "NOT MOCKED" console warning naming the path.
 *
 * ── SAFETY RULES BUILT IN ──────────────────────────────────────────────────
 *   • OFF by default. With no flag set, nothing in this file runs — the fetch
 *     shim is not even installed.
 *   • WRITES ARE BLOCKED. Mock agents are never persisted to MongoDB, and
 *     every lifecycle / policy / alert mutation is answered as a local no-op,
 *     so a demo can never pollute real data.
 *   • THE AI HUB IS UNTOUCHED. Only the governance API (`/api/…`) is served
 *     locally; `/api/v1/…` always goes to the real server, so the DLP,
 *     Inventory and Access Request screens keep showing live data.
 *   • NOTHING MARKS THE SCREEN as demo data — there is no badge, by request.
 *     The only signal is a console warning on load. That puts the burden on
 *     whoever flipped the switch to remember it is on, so switch it back Off
 *     in Settings when the demo is over.
 *
 * Every agent name below comes from ONE list (AGENT_SPECS), so the same names
 * appear in Discovery, Stale Agents, Risk Management, User Activity and Cost.
 * The tabs agree with each other, which is the whole point.
 */

const LS_KEY = "ag_demo_mode";

/** Hard switch. Leave false — use ?agDemo=1 instead. */
export const AG_DEMO_FORCE = false;

/**
 * Fake latency for the "Run Scan" button ONLY, in milliseconds.
 *
 * 0 = instant, which is the default and what every other screen does.
 *
 * The one place instant can work against you: a scan of 41 agents across six
 * clouds that finishes before the spinner paints can read as canned. Set this
 * to e.g. 1800 if you would rather the prospect watch the progress line for a
 * beat. It delays nothing else — every tab, filter and drill-down stays
 * instant regardless of this value.
 */
export const AG_DEMO_SCAN_MS = 0;

const delay = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));

function readDemoFlag() {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("agDemo");
    if (q === "1" || q === "true") {
      localStorage.setItem(LS_KEY, "1");
      return true;
    }
    if (q === "0" || q === "false") {
      localStorage.removeItem(LS_KEY);
      return false;
    }
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Read once at module load, before the router rewrites the query string. */
export const AG_DEMO = AG_DEMO_FORCE || readDemoFlag();

if (AG_DEMO && typeof console !== "undefined") {
  console.warn(
    "%c[AGENT GOVERNANCE] DEMO DATA IS ACTIVE",
    "background:#b45309;color:#fff;padding:2px 6px;border-radius:3px;font-weight:700",
    "\nAll agents, chats, costs and activity are fabricated. Nothing is written to the server." +
      "\nTurn off with ?agDemo=0"
  );
}

/**
 * Fake credential ids. Present so the "is a platform connected?" checks pass
 * and every scope chip appears — they are never sent anywhere, because every
 * request that would carry them is intercepted below.
 */
export const AG_DEMO_KEYS = {
  oauthKeyId: "demo-microsoft-key",
  tenantId: "northwind.onmicrosoft.com",
  dataverseEnvUrl: "https://northwind.crm.dynamics.com",
  azureSubscriptionId: "0f2d-demo-subscription",
  googleKeyId: "demo-google-key",
  geminiEnterpriseKeyId: "demo-gemini-enterprise-key",
  // NULL ON PURPOSE — Agent Governance demos Microsoft + Google only.
  // A null key id is what every "is this platform connected?" check reads, so
  // leaving these unset removes the ChatGPT / Claude / AWS connection badges,
  // their scope chips in the Discovery selector, and their entries in the User
  // Activity application dropdown. Set one to a string to bring that vendor
  // back, and add matching AGENT_SPECS rows for it.
  openaiKeyId: null,
  claudeKeyId: null,
  awsKeyId: null,
};

// ── helpers ─────────────────────────────────────────────────────────────────

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const daysAgo = (d) => iso(NOW - d * 86400000);
const hoursAgo = (h) => iso(NOW - h * 3600000);

/** Deterministic PRNG so numbers never change between reloads mid-demo. */
function rngFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ── people ──────────────────────────────────────────────────────────────────

const P = (displayName, upn, accountEnabled = true) => ({
  id: upn,
  displayName,
  userPrincipalName: upn,
  accountEnabled,
});

const OWNERS = {
  amara: P("Amara Okafor", "amara.okafor@northwind.example"),
  dev: P("Devika Raman", "devika.raman@northwind.example"),
  tom: P("Tomas Lindqvist", "tomas.lindqvist@northwind.example"),
  yuki: P("Yuki Tanaka", "yuki.tanaka@northwind.example"),
  marco: P("Marco Ferreira", "marco.ferreira@northwind.example"),
  priya: P("Priya Nair", "priya.nair@northwind.example"),
  sean: P("Sean Whitaker", "sean.whitaker@northwind.example"),
  lena: P("Lena Hoffmann", "lena.hoffmann@northwind.example"),
  // Left the company — their agents are still running. This is the story.
  gone1: P("Robert Ashby", "robert.ashby@northwind.example", false),
  gone2: P("Claire Dumont", "claire.dumont@northwind.example", false),
};

const ACTIVE_PEOPLE = [
  OWNERS.amara, OWNERS.dev, OWNERS.tom, OWNERS.yuki,
  OWNERS.marco, OWNERS.priya, OWNERS.sean, OWNERS.lena,
];

// ── the canonical agent list ────────────────────────────────────────────────
//
// ONE source of truth. Every other mock in this file derives its agent names
// from here, so Discovery, Stale Agents, Cost and User Activity never disagree.
//
// spec: name, platform, risk level, owner (undefined = orphaned), age in days,
//       days since last use (null = never used), connectors, permissions.

const VENDOR_BY_PLATFORM = {
  copilot_studio: "Microsoft",
  personal_agent: "Microsoft",
  teams_chat_agent: "Microsoft",
  sharepoint_embedded: "Microsoft",
  teams_app: "Microsoft",
  isv_store: "Microsoft",
  azure_foundry: "Microsoft",
  oauth_app: "Microsoft",
  vertex_ai: "Google",
  gemini_gems: "Google",
  google_chat: "Google",
  gemini_enterprise: "Google",
  // Microsoft and Google only — see the note at the end of AGENT_SPECS.
};

const C = (name, type) => ({ name, type });

const AGENT_SPECS = [
  // ── Copilot Studio ────────────────────────────────────────────────────────
  { name: "Contract Review Assistant", platform: "copilot_studio", level: "critical", owner: null, age: 412, idle: 96,
    connectors: [C("SharePoint", "Standard"), C("HTTP with Microsoft Entra ID", "HTTP"), C("SQL Server", "Standard")],
    permissions: [{ name: "Sites.Read.All", type: "Application" }, { name: "Files.ReadWrite.All", type: "Application" }],
    consentType: "AllPrincipals", desc: "Reads master service agreements from the Legal SharePoint site and drafts redline summaries." },
  { name: "Customer Refund Triage", platform: "copilot_studio", level: "high", owner: OWNERS.amara, age: 208, idle: 2,
    connectors: [C("Dataverse", "Standard"), C("Dynamics 365 Sales", "Standard"), C("Office 365 Outlook", "Standard")],
    permissions: [{ name: "Dataverse.user_impersonation", type: "Delegated" }],
    consentType: "AllPrincipals", desc: "Classifies refund requests against policy and drafts the customer reply." },
  { name: "Onboarding Buddy", platform: "copilot_studio", level: "medium", owner: OWNERS.priya, age: 141, idle: 4,
    connectors: [C("SharePoint", "Standard"), C("Microsoft Teams", "Standard")],
    permissions: [{ name: "Sites.Read.All", type: "Application" }],
    consentType: "Principal", desc: "Answers new-joiner questions from the HR handbook and IT setup guides." },
  { name: "Field Service Dispatcher", platform: "copilot_studio", level: "high", owner: OWNERS.tom, age: 322, idle: 11,
    connectors: [C("Dataverse", "Standard"), C("HTTP", "HTTP"), C("Azure Blob Storage", "Standard")],
    permissions: [{ name: "Sites.ReadWrite.All", type: "Application" }, { name: "User.Read.All", type: "Application" }],
    consentType: "AllPrincipals", desc: "Assigns engineers to open work orders and posts the schedule to Teams." },
  { name: "Procurement Policy Bot", platform: "copilot_studio", level: "low", owner: OWNERS.lena, age: 97, idle: 6,
    connectors: [C("SharePoint", "Standard")],
    permissions: [{ name: "Sites.Read.All", type: "Application" }],
    consentType: "Principal", desc: "Answers purchase-approval threshold questions from the finance policy library." },
  { name: "Payroll Query Handler", platform: "copilot_studio", level: "critical", owner: OWNERS.gone2, age: 501, idle: null,
    connectors: [C("SQL Server", "Standard"), C("HTTP", "HTTP"), C("Office 365 Users", "Standard")],
    permissions: [{ name: "User.ReadWrite.All", type: "Application" }, { name: "Directory.Read.All", type: "Application" }],
    consentType: "AllPrincipals", desc: "Looks up payslip and tax-code queries directly against the HR database." },

  // ── Personal agents ───────────────────────────────────────────────────────
  { name: "My Deal Desk Helper", platform: "personal_agent", level: "medium", owner: OWNERS.marco, age: 64, idle: 1,
    connectors: [C("Dynamics 365 Sales", "Standard")], permissions: [], consentType: "Principal",
    desc: "Personal agent summarising open opportunities before pipeline review." },
  { name: "My Sprint Notes Agent", platform: "personal_agent", level: "low", owner: OWNERS.dev, age: 38, idle: 3,
    connectors: [C("Azure DevOps", "Standard")], permissions: [], consentType: "Principal",
    desc: "Personal agent that turns standup notes into work items." },
  { name: "My Expense Checker", platform: "personal_agent", level: "medium", owner: OWNERS.gone1, age: 289, idle: null,
    connectors: [C("Office 365 Outlook", "Standard"), C("SharePoint", "Standard")], permissions: [], consentType: "Principal",
    desc: "Personal agent that reconciles receipts against the expense policy." },

  // ── Teams chat agents & apps ──────────────────────────────────────────────
  { name: "IT Helpdesk Copilot", platform: "teams_chat_agent", level: "medium", owner: OWNERS.sean, age: 176, idle: 1,
    connectors: [C("ServiceNow", "Premium"), C("Microsoft Teams", "Standard")],
    permissions: [{ name: "Chat.Read.All", type: "Application" }], consentType: "AllPrincipals",
    desc: "First-line IT support agent published to the whole company in Teams." },
  { name: "Benefits Explainer", platform: "teams_chat_agent", level: "high", owner: OWNERS.priya, age: 233, idle: 38,
    connectors: [C("SharePoint", "Standard"), C("HTTP", "HTTP")],
    permissions: [{ name: "Sites.Read.All", type: "Application" }, { name: "Chat.Read.All", type: "Application" }],
    consentType: "AllPrincipals", desc: "Explains health and pension elections; reads the benefits document library." },
  { name: "Meeting Recap Bot", platform: "teams_app", level: "medium", owner: OWNERS.yuki, age: 118, idle: 2,
    connectors: [C("Microsoft Teams", "Standard")],
    permissions: [{ name: "OnlineMeetings.Read.All", type: "Application" }], consentType: "AllPrincipals",
    desc: "Posts an AI recap after every recorded Teams meeting." },
  { name: "Standup Poller", platform: "teams_app", level: "low", owner: OWNERS.dev, age: 205, idle: 5,
    connectors: [C("Microsoft Teams", "Standard")], permissions: [], consentType: "Principal",
    desc: "Collects written standups and summarises blockers." },
  { name: "Vendor Intake Bot", platform: "teams_app", level: "high", owner: null, age: 366, idle: 71,
    connectors: [C("HTTP", "HTTP"), C("Office 365 Outlook", "Standard")],
    permissions: [{ name: "Mail.Send", type: "Application" }, { name: "Directory.Read.All", type: "Application" }],
    consentType: "AllPrincipals", desc: "Collects supplier onboarding forms and mails them onward. No current owner." },

  // ── SharePoint agents ─────────────────────────────────────────────────────
  { name: "Sales Playbook Agent", platform: "sharepoint_embedded", level: "medium", owner: OWNERS.marco, age: 132, idle: 3,
    connectors: [C("SharePoint", "Standard")], permissions: [{ name: "Sites.Read.All", type: "Application" }],
    consentType: "Principal", desc: "Site agent on /sites/sales answering from the playbook library." },
  { name: "Engineering Runbook Agent", platform: "sharepoint_embedded", level: "high", owner: OWNERS.dev, age: 156, idle: 9,
    connectors: [C("SharePoint", "Standard"), C("Azure Blob Storage", "Standard")],
    permissions: [{ name: "Sites.ReadWrite.All", type: "Application" }], consentType: "AllPrincipals",
    desc: "Site agent on /sites/engineering with read/write across the runbook library." },

  // ── ISV / store apps ──────────────────────────────────────────────────────
  { name: "Otter Meeting Notes", platform: "isv_store", level: "high", owner: OWNERS.yuki, age: 244, idle: 7,
    connectors: [C("Microsoft Graph", "Third-party")],
    permissions: [{ name: "OnlineMeetings.Read.All", type: "Application" }, { name: "offline_access", type: "Delegated" }],
    consentType: "AllPrincipals", desc: "Third-party transcription app consented org-wide; egresses meeting audio." },
  { name: "Notion AI Connector", platform: "isv_store", level: "critical", owner: OWNERS.sean, age: 187, idle: 4,
    connectors: [C("Microsoft Graph", "Third-party")],
    permissions: [{ name: "Files.Read.All", type: "Application" }, { name: "Sites.Read.All", type: "Application" }],
    consentType: "AllPrincipals", desc: "Reads OneDrive and SharePoint content into an external workspace." },

  // ── Azure AI Foundry ──────────────────────────────────────────────────────
  { name: "Claims Summariser (Foundry)", platform: "azure_foundry", level: "high", owner: OWNERS.tom, age: 92, idle: 1,
    connectors: [C("Azure AI Search", "Managed"), C("Azure Blob Storage", "Managed")], permissions: [],
    consentType: "Principal", model: "gpt-4o", desc: "Foundry deployment summarising insurance claim packs." },
  { name: "Product QA Assistant (Foundry)", platform: "azure_foundry", level: "medium", owner: OWNERS.lena, age: 71, idle: 5,
    connectors: [C("Azure AI Search", "Managed")], permissions: [], consentType: "Principal",
    model: "gpt-4o-mini", desc: "Answers product questions from the technical documentation index." },
  { name: "Fraud Signal Classifier", platform: "azure_foundry", level: "critical", owner: OWNERS.gone1, age: 268, idle: 44,
    connectors: [C("Azure SQL", "Managed"), C("Azure Blob Storage", "Managed")], permissions: [],
    consentType: "Principal", model: "o1", desc: "Scores transactions against fraud heuristics. Owner has left." },

  // ── Shadow AI via OAuth grant ─────────────────────────────────────────────
  { name: "ChatGPT (work account grant)", platform: "oauth_app", level: "critical", owner: null, age: 154, idle: 1,
    connectors: [C("Microsoft Graph", "Third-party")],
    permissions: [{ name: "User.Read", type: "Delegated" }, { name: "Files.Read", type: "Delegated" }, { name: "offline_access", type: "Delegated" }],
    consentType: "Principal", desc: "23 employees granted ChatGPT access to their work account. Nobody approved it." },
  { name: "Perplexity (work account grant)", platform: "oauth_app", level: "high", owner: null, age: 88, idle: 2,
    connectors: [C("Microsoft Graph", "Third-party")],
    permissions: [{ name: "User.Read", type: "Delegated" }, { name: "offline_access", type: "Delegated" }],
    consentType: "Principal", desc: "9 employees granted Perplexity access to their work identity." },

  // ── Google ────────────────────────────────────────────────────────────────
  { name: "Territory Planner (Vertex)", platform: "vertex_ai", level: "high", owner: OWNERS.marco, age: 121, idle: 3,
    connectors: [C("BigQuery", "Managed"), C("Cloud Storage", "Managed")], permissions: [],
    consentType: "Principal", model: "gemini-2.5-pro", desc: "Vertex reasoning engine allocating sales territories from BigQuery." },
  { name: "Support Deflection Agent", platform: "vertex_ai", level: "medium", owner: OWNERS.amara, age: 84, idle: 2,
    connectors: [C("Vertex AI Search", "Managed")], permissions: [], consentType: "Principal",
    model: "gemini-2.5-flash", desc: "Answers tier-1 support questions from the help centre data store." },
  { name: "Brand Voice Gem", platform: "gemini_gems", level: "low", owner: OWNERS.lena, age: 43, idle: 1,
    connectors: [], permissions: [], consentType: "Principal",
    desc: "Shared Gem enforcing tone-of-voice rules for marketing copy." },
  { name: "RFP Answer Gem", platform: "gemini_gems", level: "medium", owner: OWNERS.sean, age: 59, idle: 8,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "Principal",
    desc: "Shared Gem drafting RFP responses from the bid library on Drive." },
  { name: "Release Notes Chat Bot", platform: "google_chat", level: "medium", owner: OWNERS.dev, age: 167, idle: 14,
    connectors: [C("Google Chat", "Managed")], permissions: [], consentType: "AllPrincipals",
    desc: "Google Chat bot posting AI-written release notes to #engineering." },
  { name: "Enterprise Knowledge Agent", platform: "gemini_enterprise", level: "high", owner: OWNERS.priya, age: 76, idle: 1,
    connectors: [C("Google Drive", "Managed"), C("Confluence", "Third-party")], permissions: [],
    consentType: "AllPrincipals", desc: "Gemini Enterprise agent indexing Drive and Confluence for company-wide search." },
  { name: "Policy Lookup Agent", platform: "gemini_enterprise", level: "medium", owner: OWNERS.lena, age: 52, idle: 6,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "Principal",
    desc: "Gemini Enterprise agent over the HR and finance policy corpus." },

  // ── More Google, to balance the estate ────────────────────────────────────
  { name: "Invoice Extraction Agent", platform: "vertex_ai", level: "high", owner: OWNERS.tom, age: 138, idle: 2,
    connectors: [C("Document AI", "Managed"), C("Cloud Functions: finance-api", "Function")],
    permissions: [], consentType: "Principal", model: "gemini-2.5-pro",
    desc: "Vertex agent pulling line items from supplier invoices; calls the finance API." },
  { name: "Market Digest Gem", platform: "gemini_gems", level: "medium", owner: OWNERS.marco, age: 95, idle: 4,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "Principal",
    desc: "Shared Gem summarising analyst reports into a weekly digest." },
  { name: "Onboarding FAQ Notebook", platform: "gemini_enterprise", level: "medium", owner: OWNERS.priya, age: 61, idle: 3,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "AllPrincipals",
    desc: "NotebookLM Enterprise notebook answering new-joiner questions from HR sources." },
  { name: "Support Deflection Chat Bot", platform: "google_chat", level: "high", owner: null, age: 254, idle: 63,
    connectors: [C("Google Chat", "Managed"), C("HTTP", "HTTP")],
    permissions: [{ name: "chat.bot", type: "Application" }], consentType: "AllPrincipals",
    desc: "Google Chat bot answering customer questions in a shared space. No current owner." },

  // NOTE: OpenAI, Claude/Anthropic and AWS agents are deliberately absent.
  // Agent Governance demos Microsoft and Google (incl. Gemini Enterprise) only.
  // Their credential ids are left null in AG_DEMO_KEYS, which also removes
  // their connection badges, scope chips and application-dropdown entries.
];

const RISK_SCORE_BY_LEVEL = { critical: 90, high: 72, medium: 45, low: 18 };

/** Human-readable risk signals, chosen from what the agent actually looks like. */
function riskFactorsFor(spec) {
  const f = [];
  if (!spec.owner) {
    f.push({ signal: "No owner", weight: "critical", description: "No resolvable owner — nobody is accountable for this agent" });
  } else if (spec.owner.accountEnabled === false) {
    f.push({ signal: "Orphaned", weight: "critical", description: `Owner ${spec.owner.displayName} no longer has an active account` });
  }
  if (spec.consentType === "AllPrincipals") {
    f.push({ signal: "Organisation-wide consent", weight: "high", description: "Consent was granted for every user in the tenant, not one user" });
  }
  if ((spec.connectors || []).some((c) => c.type === "HTTP" || c.type === "Third-party")) {
    f.push({ signal: "External data connector", weight: "high", description: "Holds a connector that can reach outside the tenant" });
  }
  if ((spec.permissions || []).some((p) => /ReadWrite|\.Send|Directory\.Read/.test(p.name))) {
    f.push({ signal: "Broad permissions", weight: "high", description: "Holds write or directory-wide application permissions" });
  }
  if (spec.idle === null) {
    f.push({ signal: "Never used", weight: "medium", description: "No recorded interaction since it was created, but still privileged" });
  } else if (spec.idle > 30) {
    f.push({ signal: "Dormant but privileged", weight: "medium", description: `No activity for ${spec.idle} days while retaining its permissions` });
  }
  if (spec.platform === "oauth_app") {
    f.push({ signal: "Unsanctioned tool", weight: "high", description: "Employee-granted access to an AI service with no approval on record" });
  }
  if (spec.age > 300) {
    f.push({ signal: "Never reviewed", weight: "low", description: `Created ${Math.round(spec.age / 30)} months ago and never recertified` });
  }
  // A clean agent still has to explain its own score, or the detail panel opens
  // empty and the number looks asserted rather than derived. Every condition
  // named here is one this branch has already ruled out.
  if (f.length === 0) {
    f.push({
      signal: "No elevated signals",
      weight: "low",
      description: "Single-user consent, no external connector, no write permissions, active within the last 30 days",
    });
  }
  return f;
}

function recommendationsFor(spec) {
  const r = [];
  if (!spec.owner || spec.owner.accountEnabled === false) r.push("Assign a current owner or retire the agent");
  if (spec.consentType === "AllPrincipals") r.push("Narrow consent to the users who actually need it");
  if (spec.idle === null || spec.idle > 30) r.push("Confirm the agent is still needed, or revoke its permissions");
  if (spec.platform === "oauth_app") r.push("Review the OAuth grant and decide whether to sanction or revoke it");
  return r;
}

function buildAgent(spec, i) {
  const rand = rngFor(spec.name);
  const vendor = VENDOR_BY_PLATFORM[spec.platform] || "Unknown";
  const orphaned = !spec.owner || spec.owner.accountEnabled === false;
  const level = spec.level;
  const firstSeen = daysAgo(spec.age);
  const lastActive = spec.idle === null ? null : daysAgo(spec.idle);

  // Usage scales with how recently it was touched — a dormant agent with 4,000
  // invocations would read as obviously fake.
  const busy = spec.idle === null ? 0 : Math.max(0, 40 - spec.idle);
  const total = spec.idle === null ? 0 : between(rand, 12, 60) * (busy > 25 ? 14 : busy > 10 ? 5 : 1);
  const uniqueUsers = spec.idle === null ? 0 : Math.max(1, Math.round(total / between(rand, 6, 22)));

  const breakdownPeople = [];
  const poolCopy = [...ACTIVE_PEOPLE];
  for (let n = 0; n < Math.min(uniqueUsers, 5); n++) {
    const p = poolCopy.splice(Math.floor(rand() * poolCopy.length), 1)[0];
    if (p) breakdownPeople.push(p);
  }
  let remaining = total;
  const userBreakdown = breakdownPeople.map((p, n) => {
    const share = n === breakdownPeople.length - 1 ? remaining : Math.max(1, Math.round(remaining * (0.55 - n * 0.08)));
    remaining = Math.max(0, remaining - share);
    return {
      userId: p.userPrincipalName,
      userName: p.displayName,
      userPrincipalName: p.userPrincipalName,
      invocations: share,
      lastActive: lastActive,
    };
  });

  return {
    id: `demo-${spec.platform}-${i}`,
    appId: `demo-app-${i}`,
    name: spec.name,
    description: spec.desc,
    vendor,
    category: "generative-ai",
    platform: spec.platform,
    discoverySource: "demo_dataset",
    firstSeen,
    createdDateTime: firstSeen,
    createdOn: firstSeen,
    lastModified: daysAgo(Math.max(1, Math.round(spec.age / 4))),
    modifiedOn: daysAgo(Math.max(1, Math.round(spec.age / 4))),
    publishedStatus: "active",
    isOrphaned: orphaned,
    owner: spec.owner || undefined,
    llmModel: spec.model,
    consentType: spec.consentType,
    connectors: spec.connectors || [],
    permissions: spec.permissions || [],
    environmentName: spec.platform === "copilot_studio" ? "Northwind (default)" : undefined,
    lifecycleStatus: spec.idle === null || spec.idle > 60 ? "stale" : "active",
    approvalStatus: orphaned ? "pending" : "approved",
    risk: {
      score: RISK_SCORE_BY_LEVEL[level],
      level,
      factors: riskFactorsFor(spec),
      recommendations: recommendationsFor(spec),
      computedAt: hoursAgo(2),
    },
    activity: {
      totalInvocations: total,
      totalConversations: Math.round(total / 3),
      invocationsLast7Days: spec.idle !== null && spec.idle <= 7 ? Math.round(total * 0.22) : 0,
      invocationsLast30Days: spec.idle !== null && spec.idle <= 30 ? Math.round(total * 0.61) : 0,
      invocationsLast90Days: spec.idle !== null && spec.idle <= 90 ? total : 0,
      uniqueUsers,
      userBreakdown,
      lastActiveTimestamp: lastActive,
    },
  };
}

export const AG_DEMO_AGENTS = AGENT_SPECS.map(buildAgent);

/** Names available to every other mock, so the tabs stay consistent. */
const AGENT_NAMES = AG_DEMO_AGENTS.map((a) => a.name);
const CHATTY_AGENTS = AG_DEMO_AGENTS.filter(
  (a) => a.activity.totalInvocations > 0 && ["copilot_studio", "teams_chat_agent", "sharepoint_embedded", "personal_agent"].includes(a.platform)
);

export function agDemoDiscoveryResult() {
  return {
    tenant: {
      id: "demo-tenant",
      name: "Northwind Traders",
      domain: "northwind.onmicrosoft.com",
      license: "Microsoft 365 E5 + Copilot",
    },
    agents: AG_DEMO_AGENTS,
    totalServicePrincipals: 412,
    totalUsers: 1284,
    totalEnvironments: 4,
    scanTimestamp: hoursAgo(1),
    scanDuration: 42718,
    warnings: [
      "Microsoft 365 Copilot agent discovery uses a preview endpoint — coverage may vary by tenant.",
      "Sign-in history for 6 agents was unavailable at the current Entra ID licence level.",
    ],
  };
}

// ── conversations (User Activity → AI Safety) ───────────────────────────────
//
// Deliberately includes prompts that trip the sensitive-data classifier, so the
// AI Safety sub-tab lights up with PII / financial / secret findings.

const CONVERSATION_SEEDS = [
  { agent: "Customer Refund Triage", user: OWNERS.amara, source: "audit_log", turns: [
    ["Refund request from account CF-CUST-4471GK — customer says the annual plan was double charged on card 4539 1488 0343 6467. Can we refund it?",
     "I can see two charges of $4,800 on that account for the same period. Policy 4.2 allows a full refund within 30 days. I've drafted the refund note and the customer email for your approval."],
    ["Also confirm the billing contact — their SSN on file is 402-55-1189, is that the right record?",
     "I don't need identity numbers to look that up. Matching on the account id alone, the billing contact is the same as the primary admin."],
  ]},
  { agent: "Payroll Query Handler", user: OWNERS.priya, source: "audit_log", turns: [
    ["Employee asked why their March payslip differs. Their national insurance number is JT 60 21 44 C and the payroll id is 88213.",
     "The March run applied a backdated tax-code change from HMRC. Gross was unchanged; net fell by £212.40 because of the code switch from 1257L to 1103L."],
  ]},
  { agent: "Contract Review Assistant", user: OWNERS.lena, source: "graph_copilot", turns: [
    ["Summarise the liability cap in the Acme master agreement and flag anything unusual.",
     "The cap is 12 months of fees, but clause 14.3 carves out data-breach liability entirely — that is unusual and materially worse than your standard position."],
    ["Draft a redline that puts the breach liability back under the cap.",
     "Drafted. I've inserted a proviso in 14.3 subjecting breach liability to the general cap, with a 2x multiplier fallback."],
  ]},
  { agent: "IT Helpdesk Copilot", user: OWNERS.sean, source: "teams_chat", turns: [
    ["I need to rotate the staging API token. Current one is sk-proj-8Qd2mF7xKpLvR3nTzYwB4jHc for reference.",
     "Please don't paste live keys into chat — that value is now in this conversation's history. Rotate it in the portal and I'll walk you through updating the pipeline secret."],
    ["Fair. How do I update the pipeline secret?",
     "Project settings → Secrets → staging_openai_key → Update. The next build picks it up automatically; no redeploy needed."],
  ]},
  { agent: "Benefits Explainer", user: OWNERS.yuki, source: "audit_log", turns: [
    ["An employee is asking whether their pre-existing cardiac condition is covered under the new plan and whether their diabetes medication is on the formulary.",
     "Both are covered from day one under the 2026 plan — there is no pre-existing exclusion. The specific medication is tier 2, so a £12 copay applies."],
  ]},
  { agent: "Field Service Dispatcher", user: OWNERS.tom, source: "audit_log", turns: [
    ["Who is nearest to work order WO-88213 and what is the SLA?",
     "Marcus is 14 minutes away and free from 14:30. The SLA on that order expires at 17:00 today, so it fits."],
  ]},
  { agent: "Sales Playbook Agent", user: OWNERS.marco, source: "graph_copilot", turns: [
    ["What's our standard discount ladder for a three-year commit above £250k?",
     "The playbook allows 18% at three years above £250k, rising to 22% with quarterly prepayment. Anything beyond that needs the VP Sales on the approval."],
  ]},
  { agent: "Onboarding Buddy", user: OWNERS.dev, source: "teams_chat", turns: [
    ["New joiner wants to know how to get a laptop and what the VPN setup is.",
     "Hardware comes from the IT request form on day one, and the VPN client is pushed automatically once the device enrols. I've linked both guides."],
  ]},
  { agent: "Engineering Runbook Agent", user: OWNERS.dev, source: "graph_copilot", turns: [
    ["Give me the failover steps for the primary database.",
     "Promote the standby with the documented sequence, update the connection string in the secret store, then run the health check. Full runbook is in the engineering library — step 4 needs a DBA present."],
  ]},
  { agent: "My Deal Desk Helper", user: OWNERS.marco, source: "audit_log", turns: [
    ["Summarise my open opportunities over £100k and where each one is stuck.",
     "Four opportunities. Two are waiting on security review, one on legal redlines, one on a customer budget cycle that reopens in April."],
  ]},

  // ── Google-side conversations ─────────────────────────────────────────────
  // These are what the User Activity tab shows when the application dropdown
  // is switched to a Google platform, and what buildGoogleActivity() selects.
  { agent: "Territory Planner (Vertex)", user: OWNERS.marco, source: "audit_log", turns: [
    ["Rebalance the EMEA territories for next quarter using the closed-won data.",
     "Rebalanced across six reps. Two territories were more than 30% above the median account load, so I moved 14 accounts and flagged the two that carry a named strategic customer for you to confirm."],
  ]},
  { agent: "Support Deflection Agent", user: OWNERS.amara, source: "audit_log", turns: [
    ["Customer on account CF-CUST-4471GK is asking why their export failed. Their contact number is +1 415 555 0182.",
     "The export failed on a permissions error, not a data error — the destination folder lost its service-account grant on Tuesday. I've drafted the reply with the re-grant steps. You don't need to share their phone number with me for this."],
  ]},
  { agent: "Enterprise Knowledge Agent", user: OWNERS.priya, source: "graph_copilot", turns: [
    ["What is our parental leave entitlement in Germany, and where is it documented?",
     "Fourteen weeks at full pay, plus the statutory Elternzeit. Source is the DE addendum to the employee handbook on Drive, last revised in January."],
    ["Does that differ for someone on a fixed-term contract?",
     "The entitlement is the same; only the notice window differs. The addendum covers it in section 4.2."],
  ]},
  { agent: "Invoice Extraction Agent", user: OWNERS.tom, source: "audit_log", turns: [
    ["Pull the line items off the Meridian invoice batch and check them against the PO.",
     "Eleven of twelve match. Invoice 0412-7 bills 14 licences against a PO for 12 — a £1,340 overage. I've flagged it rather than passing it through."],
  ]},
  { agent: "Release Notes Chat Bot", user: OWNERS.dev, source: "teams_chat", turns: [
    ["Post the release notes for 4.18 to the engineering space.",
     "Posted. I summarised 23 merged PRs into six user-facing changes and listed the two breaking API changes separately at the top."],
  ]},
];

function buildChats() {
  return CONVERSATION_SEEDS.map((seed, i) => {
    const rand = rngFor(seed.agent + i);
    const start = NOW - between(rand, 2, 160) * 3600000;
    const messages = [];
    seed.turns.forEach((pair, t) => {
      messages.push({
        id: `demo-msg-${i}-${t}-u`,
        from: "user",
        fromName: seed.user.displayName,
        timestamp: iso(start + t * 240000),
        text: pair[0],
      });
      messages.push({
        id: `demo-msg-${i}-${t}-b`,
        from: "bot",
        fromName: seed.agent,
        timestamp: iso(start + t * 240000 + 45000),
        text: pair[1],
      });
    });
    return {
      id: `demo-chat-${i}`,
      userName: seed.user.displayName,
      userEmail: seed.user.userPrincipalName,
      userId: seed.user.userPrincipalName,
      botName: seed.agent,
      botId: (AG_DEMO_AGENTS.find((a) => a.name === seed.agent) || {}).id,
      source: seed.source,
      messageCount: messages.length,
      startTime: iso(start),
      endTime: iso(start + seed.turns.length * 300000),
      messages,
    };
  });
}

const AG_DEMO_CHATS = buildChats();

// ── file activity (User Activity → File Activity) ───────────────────────────

const FILE_SEEDS = [
  ["Acme_MSA_2026_redline.docx", "/sites/legal/Shared Documents/Contracts", OWNERS.lena, "FileAccessed", "SharePoint", ["Contract Review Assistant"]],
  ["Q1_payroll_export.xlsx", "/sites/hr/Shared Documents/Payroll", OWNERS.priya, "FileDownloaded", "SharePoint", ["Payroll Query Handler"]],
  ["customer_refunds_march.csv", "/personal/amara_okafor/Documents", OWNERS.amara, "FileUploaded", "OneDrive", ["Customer Refund Triage"]],
  ["benefits_formulary_2026.pdf", "/sites/hr/Shared Documents/Benefits", OWNERS.yuki, "FilePreviewed", "SharePoint", ["Benefits Explainer"]],
  ["field_service_rota.xlsx", "/sites/operations/Shared Documents", OWNERS.tom, "FileModified", "SharePoint", ["Field Service Dispatcher"]],
  ["sales_playbook_v9.pptx", "/sites/sales/Shared Documents/Playbook", OWNERS.marco, "FileAccessed", "SharePoint", ["Sales Playbook Agent"]],
  ["db_failover_runbook.md", "/sites/engineering/Shared Documents/Runbooks", OWNERS.dev, "FileAccessed", "SharePoint", ["Engineering Runbook Agent"]],
  ["supplier_bank_details.xlsx", "/sites/finance/Shared Documents", OWNERS.lena, "FileDownloaded", "SharePoint", ["Vendor Intake Bot"]],
  ["pen_test_findings_q1.pdf", "/personal/sean_whitaker/Documents", OWNERS.sean, "FileUploaded", "OneDrive", ["Security Review Project"]],
  ["onboarding_checklist.docx", "/sites/hr/Shared Documents/Onboarding", OWNERS.priya, "FileAccessed", "SharePoint", ["Onboarding Buddy"]],
  ["invoice_batch_0412.pdf", "/sites/finance/Shared Documents/AP", OWNERS.tom, "FileUploaded", "SharePoint", ["Invoice Extraction Assistant"]],
  ["churn_features_v3.parquet", "/personal/amara_okafor/Documents/ml", OWNERS.amara, "FileAccessed", "OneDrive", ["churn-scoring-endpoint"]],
  ["board_pack_march.pptx", "/sites/exec/Shared Documents", OWNERS.lena, "FilePreviewed", "SharePoint", []],
  ["release_notes_draft.md", "/sites/engineering/Shared Documents", OWNERS.dev, "FileModified", "SharePoint", ["Release Notes Chat Bot"]],
  // ── Google-side file activity (Drive) ─────────────────────────────────────
  ["emea_territories_q2.xlsx", "/Drive/Sales/Territories", OWNERS.marco, "FileModified", "Drive", ["Territory Planner (Vertex)"]],
  ["help_centre_export.csv", "/Drive/Support/Knowledge", OWNERS.amara, "FileDownloaded", "Drive", ["Support Deflection Agent"]],
  ["de_handbook_addendum.pdf", "/Drive/HR/Handbook", OWNERS.priya, "FilePreviewed", "Drive", ["Enterprise Knowledge Agent", "Policy Lookup Agent"]],
  ["meridian_invoice_batch.pdf", "/Drive/Finance/AP", OWNERS.tom, "FileUploaded", "Drive", ["Invoice Extraction Agent"]],
  ["bid_library_index.gsheet", "/Drive/Sales/Bids", OWNERS.sean, "FileAccessed", "Drive", ["RFP Answer Gem"]],
];

const AG_DEMO_FILES = FILE_SEEDS.map(([fileName, filePath, user, operation, workload, relatedAgents], i) => {
  const rand = rngFor(fileName);
  return {
    id: `demo-file-${i}`,
    fileName,
    filePath,
    userName: user.displayName,
    userId: user.userPrincipalName,
    operation,
    workload,
    relatedAgents,
    siteUrl: `https://northwind.sharepoint.com${filePath.split("/Shared Documents")[0]}`,
    timestamp: iso(NOW - between(rand, 1, 220) * 3600000),
  };
});

// ── knowledge sources (User Activity → Knowledge & Files) ───────────────────

const KNOWLEDGE_SEEDS = {
  "Contract Review Assistant": [
    { name: "Legal — Contracts library", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/legal/Shared Documents/Contracts", metadata: { files: 1284, indexed: "yes" } },
    { name: "Standard clause bank", type: "knowledge_article", metadata: { articles: 96 } },
    { name: "contract_terms", type: "dataverse_table", metadata: { rows: 4120 } },
  ],
  "Customer Refund Triage": [
    { name: "Refund policy 4.2", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/finance/Shared Documents/Policies", metadata: { files: 34 } },
    { name: "account", type: "dataverse_table", metadata: { rows: 18422 } },
    { name: "incident", type: "dataverse_table", metadata: { rows: 96110 } },
  ],
  "Payroll Query Handler": [
    { name: "payroll_records (SQL)", type: "azure_storage", metadata: { rows: "≈12,400", classification: "confidential" } },
    { name: "HR handbook", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/hr/Shared Documents", metadata: { files: 212 } },
  ],
  "Benefits Explainer": [
    { name: "Benefits 2026 library", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/hr/Shared Documents/Benefits", metadata: { files: 78 } },
    { name: "provider-formulary.example.com", type: "website", url: "https://provider-formulary.example.com", metadata: { crawled: "weekly" } },
  ],
  "Engineering Runbook Agent": [
    { name: "Engineering — Runbooks", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/engineering/Shared Documents/Runbooks", metadata: { files: 341 } },
    { name: "runbook-archive (blob)", type: "azure_storage", metadata: { container: "runbooks", files: 1902 } },
  ],
  "Sales Playbook Agent": [
    { name: "Sales — Playbook", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/sales/Shared Documents/Playbook", metadata: { files: 156 } },
  ],
  "Onboarding Buddy": [
    { name: "HR — Onboarding", type: "sharepoint", url: "https://northwind.sharepoint.com/sites/hr/Shared Documents/Onboarding", metadata: { files: 64 } },
    { name: "IT setup guides", type: "knowledge_article", metadata: { articles: 41 } },
  ],
  "Field Service Dispatcher": [
    { name: "msdyn_workorder", type: "dataverse_table", metadata: { rows: 22841 } },
    { name: "dispatch-api.northwind.example", type: "connector", metadata: { auth: "Entra ID", scope: "read/write" } },
  ],
  // ── Google-side knowledge ─────────────────────────────────────────────────
  // Only the source types KnowledgeSourceCard knows are used, so every card
  // renders with an icon and label rather than falling back to "Other".
  "Enterprise Knowledge Agent": [
    { name: "Google Drive — company-wide", type: "connector", metadata: { auth: "Service account", scope: "read", files: 41208 } },
    { name: "Confluence (external)", type: "connector", metadata: { auth: "API token", scope: "read", spaces: 18 } },
    { name: "hr-finance-policies (data store)", type: "knowledge_article", metadata: { articles: 312 } },
  ],
  "Policy Lookup Agent": [
    { name: "Drive — HR & Finance policies", type: "connector", metadata: { auth: "Service account", scope: "read", files: 486 } },
  ],
  "Territory Planner (Vertex)": [
    { name: "BigQuery — closed_won_opportunities", type: "azure_storage", metadata: { rows: "≈184,000", dataset: "sales_analytics" } },
    { name: "Cloud Storage — territory-exports", type: "azure_storage", metadata: { bucket: "nw-territory", files: 240 } },
  ],
  "Support Deflection Agent": [
    { name: "help-centre-articles (data store)", type: "knowledge_article", metadata: { articles: 1043 } },
    { name: "support.northwind.example", type: "website", url: "https://support.northwind.example", metadata: { crawled: "daily" } },
  ],
  "Invoice Extraction Agent": [
    { name: "Document AI — invoice parser", type: "connector", metadata: { processor: "invoice-parser-v2" } },
    { name: "Drive — Finance/AP", type: "connector", metadata: { auth: "Service account", scope: "read", files: 2914 } },
  ],
  "RFP Answer Gem": [
    { name: "Drive — bid library", type: "connector", metadata: { auth: "User OAuth", scope: "read", files: 176 } },
  ],
};

const AG_DEMO_KNOWLEDGE_BOTS = Object.entries(KNOWLEDGE_SEEDS).map(([botName, sources]) => {
  const agent = AG_DEMO_AGENTS.find((a) => a.name === botName);
  return {
    botId: agent ? agent.id : `demo-bot-${botName}`,
    botName,
    schemaName: botName.replace(/\s+/g, "_").toLowerCase(),
    sources: sources.map((s, i) => ({ id: `${botName}-src-${i}`, addedOn: daysAgo(30 + i * 11), ...s })),
  };
});

// ── Azure OpenAI cost + usage (Cost tab) ────────────────────────────────────

const DEPLOYMENT_SEEDS = [
  ["claims-summariser", "gpt-4o", "northwind-ai-prod", 18_420_000, 4_210_000, 2.5, 10.0, 24_180],
  ["product-qa", "gpt-4o-mini", "northwind-ai-prod", 41_900_000, 9_640_000, 0.15, 0.6, 61_402],
  ["fraud-signal", "o1", "northwind-ai-sec", 2_140_000, 1_080_000, 15.0, 60.0, 3_118],
  ["invoice-extract", "gpt-4o", "northwind-ai-fin", 7_860_000, 1_940_000, 2.5, 10.0, 11_204],
  ["embeddings-index", "text-embedding-3-large", "northwind-ai-prod", 88_200_000, 0, 0.13, 0.0, 142_800],
  ["legacy-support", "gpt-35-turbo", "northwind-ai-dev", 5_120_000, 1_460_000, 0.5, 1.5, 9_640],
];

function buildAzureCost(periodDays) {
  const scale = periodDays / 30;
  const deployments = DEPLOYMENT_SEEDS.map(([deploymentName, modelName, resourceName, inTok, outTok, inRate, outRate, reqs]) => {
    const inputTokens = Math.round(inTok * scale);
    const outputTokens = Math.round(outTok * scale);
    const inputCost = (inputTokens / 1_000_000) * inRate;
    const outputCost = (outputTokens / 1_000_000) * outRate;
    return {
      deploymentName,
      resourceName,
      modelName,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      requestCount: Math.round(reqs * scale),
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      costEstimated: false,
    };
  });
  return {
    vendor: "Azure OpenAI",
    deployments,
    summary: {
      totalCost: deployments.reduce((s, d) => s + d.totalCost, 0),
      totalTokens: deployments.reduce((s, d) => s + d.totalTokens, 0),
      totalRequests: deployments.reduce((s, d) => s + d.requestCount, 0),
    },
    warnings: [],
  };
}

const PERIOD_DAYS = { P1D: 1, P7D: 7, P30D: 30, P90D: 90 };
const periodToDays = (p) => PERIOD_DAYS[String(p || "P7D").toUpperCase()] || 7;

// ── agent permissions (User Activity → Risk Management) ─────────────────────

// Shape verified against AgentPermissionsPanel in tabs/UserActivityTab.jsx.
// Two fields are load-bearing and easy to get wrong:
//   • a permission item's name is `permission`, NOT `name`.
//   • summary.filePermissions is an array of STRINGS, and it is mapped
//     unguarded whenever summary.hasFileAccess is true — a missing array there
//     throws inside render, and because every tab mounts at once that blanks
//     the whole screen rather than just this panel.
// PERMISSION_CATALOGUE maps each scope to the category icon and severity the
// panel colours by, so a row never renders an undefined level.
const PERMISSION_CATALOGUE = {
  "Files.Read.All":         { category: "files",          level: "high",     isWrite: false, resource: "Microsoft Graph" },
  "Files.Read":             { category: "files",          level: "medium",   isWrite: false, resource: "Microsoft Graph" },
  "Files.ReadWrite.All":    { category: "files",          level: "critical", isWrite: true,  resource: "Microsoft Graph" },
  "Sites.Read.All":         { category: "files",          level: "high",     isWrite: false, resource: "SharePoint" },
  "Sites.ReadWrite.All":    { category: "files",          level: "critical", isWrite: true,  resource: "SharePoint" },
  "User.Read":              { category: "directory",      level: "low",      isWrite: false, resource: "Microsoft Graph" },
  "User.Read.All":          { category: "directory",      level: "high",     isWrite: false, resource: "Microsoft Graph" },
  "User.ReadWrite.All":     { category: "directory",      level: "critical", isWrite: true,  resource: "Microsoft Graph" },
  "Directory.Read.All":     { category: "directory",      level: "high",     isWrite: false, resource: "Microsoft Graph" },
  "Mail.Send":              { category: "mail",           level: "critical", isWrite: true,  resource: "Exchange Online" },
  "Chat.Read.All":          { category: "communications", level: "high",     isWrite: false, resource: "Microsoft Teams" },
  "OnlineMeetings.Read.All":{ category: "calendar",       level: "medium",   isWrite: false, resource: "Microsoft Teams" },
  "offline_access":         { category: "other",          level: "medium",   isWrite: false, resource: "Microsoft Graph" },
};

const PERMISSION_APP_SEEDS = [
  ["Notion AI Connector",            "critical", ["Files.Read.All", "Sites.Read.All", "User.Read.All"]],
  ["Otter Meeting Notes",            "high",     ["OnlineMeetings.Read.All", "offline_access"]],
  ["ChatGPT (work account grant)",   "critical", ["User.Read", "Files.Read", "offline_access"]],
  ["Vendor Intake Bot",              "high",     ["Mail.Send", "Directory.Read.All"]],
  ["Contract Review Assistant",      "critical", ["Sites.Read.All", "Files.ReadWrite.All"]],
  ["Field Service Dispatcher",       "high",     ["Sites.ReadWrite.All", "User.Read.All"]],
  ["Payroll Query Handler",          "critical", ["User.ReadWrite.All", "Directory.Read.All"]],
  ["IT Helpdesk Copilot",            "medium",   ["Chat.Read.All"]],
  ["Meeting Recap Bot",              "medium",   ["OnlineMeetings.Read.All"]],
  ["Perplexity (work account grant)","high",     ["User.Read", "offline_access"]],
  ["Benefits Explainer",             "high",     ["Sites.Read.All", "Chat.Read.All"]],
  ["Engineering Runbook Agent",      "high",     ["Sites.ReadWrite.All"]],
];

function buildAgentPermissions() {
  const apps = PERMISSION_APP_SEEDS.map((seed, i) => {
    const [displayName, riskLevel, scopes] = seed;
    const agent = AG_DEMO_AGENTS.find((a) => a.name === displayName);
    const permissions = scopes.map((scope) => {
      const meta = PERMISSION_CATALOGUE[scope] || { category: "other", level: "medium", isWrite: false, resource: "Microsoft Graph" };
      return {
        permission: scope,
        isWrite: meta.isWrite,
        level: meta.level,
        category: meta.category,
        resourceDisplayName: meta.resource,
        type: "Application",
        consentType: "AllPrincipals",
      };
    });
    const filePerms = permissions.filter((p) => p.category === "files");
    return {
      servicePrincipalId: `demo-sp-${i}`,
      appId: agent ? agent.appId : `demo-app-perm-${i}`,
      displayName,
      isAgent: !!agent,
      publisherName: /ChatGPT|Perplexity|Notion|Otter/.test(displayName) ? "Third party" : "Northwind Traders",
      permissions,
      summary: {
        riskLevel,
        hasFileAccess: filePerms.length > 0,
        hasWriteAccess: permissions.some((p) => p.isWrite),
        criticalCount: permissions.filter((p) => p.level === "critical").length,
        permissionCount: permissions.length,
        // Strings, not objects — the panel renders each one directly and tests
        // it with fp.includes("Write") to pick the colour.
        filePermissions: filePerms.map((p) => p.permission),
      },
    };
  });
  return {
    totalApps: apps.length,
    apps,
    summary: {
      withFileAccess: apps.filter((a) => a.summary.hasFileAccess).length,
      withWriteAccess: apps.filter((a) => a.summary.hasWriteAccess).length,
      criticalRisk: apps.filter((a) => a.summary.riskLevel === "critical").length,
      agentCount: apps.filter((a) => a.isAgent).length,
    },
  };
}

// ── Azure Foundry discovery (Discovery tab → Azure panel) ───────────────────

// Shape verified against AzureAIFoundryView in tabs/DiscoveryTab.jsx (which
// auto-loads on mount) and AzureKnowledgePanel in tabs/UserActivityTab.jsx.
//
// SIX arrays are read with .length / .filter / .map and NONE of them is
// optional-chained: openAIResources, serverlessEndoints, foundryAgents,
// aiServices, accessControl, subscriptions. Omit any one and the view throws
// during render. `foundryAgents` doubles as the ML-workspace list — entries
// WITHOUT a modelName are counted as workspaces, entries with one as
// deployments. Deployment fields are modelName / modelVersion / capacityTPM,
// not model / version / capacity.
const AZ_DEP = (name, modelName, modelVersion, capacityTPM, skuName) => ({
  id: `demo-dep-${name}`,
  name,
  modelName,
  modelVersion,
  capacityTPM,
  skuName,
  contentFilter: "Microsoft.Default",
  provisioningState: "Succeeded",
});

function buildAzureDiscovery() {
  return {
    openAIResources: [
      { id: "/subscriptions/0f2d/rg-ai/northwind-ai-prod", name: "northwind-ai-prod", location: "westeurope",
        skuName: "S0", publicAccess: "Enabled", localAuthDisabled: false,
        endpoint: "https://northwind-ai-prod.openai.azure.com/",
        deployments: [
          AZ_DEP("claims-summariser", "gpt-4o", "2024-08-06", 120, "Standard"),
          AZ_DEP("product-qa", "gpt-4o-mini", "2024-07-18", 300, "Standard"),
          AZ_DEP("embeddings-index", "text-embedding-3-large", "1", 200, "Standard"),
        ] },
      { id: "/subscriptions/0f2d/rg-sec/northwind-ai-sec", name: "northwind-ai-sec", location: "northeurope",
        skuName: "S0", publicAccess: "Disabled", localAuthDisabled: true,
        endpoint: "https://northwind-ai-sec.openai.azure.com/",
        deployments: [AZ_DEP("fraud-signal", "o1", "2024-12-17", 40, "Standard")] },
      { id: "/subscriptions/0f2d/rg-fin/northwind-ai-fin", name: "northwind-ai-fin", location: "westeurope",
        skuName: "S0", publicAccess: "Enabled", localAuthDisabled: false,
        endpoint: "https://northwind-ai-fin.openai.azure.com/",
        deployments: [AZ_DEP("invoice-extract", "gpt-4o", "2024-08-06", 80, "Standard")] },
      { id: "/subscriptions/0f2d/rg-dev/northwind-ai-dev", name: "northwind-ai-dev", location: "uksouth",
        skuName: "S0", publicAccess: "Enabled", localAuthDisabled: false,
        endpoint: "https://northwind-ai-dev.openai.azure.com/",
        // No content filter on the dev deployment — a real finding to point at.
        deployments: [Object.assign(AZ_DEP("legacy-support", "gpt-35-turbo", "0613", 60, "Standard"), { contentFilter: null })] },
    ],
    serverlessEndpoints: [
      { id: "demo-sl-phi4", name: "phi-4-serverless", modelId: "Phi-4", workspaceName: "northwind-ml-research", location: "eastus", state: "Online" },
    ],
    // Entries without modelName are ML workspaces; with one, a managed deployment.
    foundryAgents: [
      { id: "demo-ws-research", name: "northwind-ml-research", location: "westeurope", resourceGroup: "rg-ml", provisioningState: "Succeeded" },
      { id: "demo-ws-prod", name: "northwind-ml-prod", location: "westeurope", resourceGroup: "rg-ml", provisioningState: "Succeeded" },
      { id: "demo-ws-churn", name: "churn-scoring-managed", location: "westeurope", resourceGroup: "rg-ml", provisioningState: "Succeeded", modelName: "gpt-4o-mini", modelVersion: "2024-07-18" },
    ],
    aiServices: [
      { id: "demo-svc-docintel", name: "northwind-docintel", kind: "FormRecognizer", location: "westeurope", skuName: "S0", publicAccess: "Enabled" },
      { id: "demo-svc-language", name: "northwind-language", kind: "TextAnalytics", location: "westeurope", skuName: "S", publicAccess: "Enabled" },
      { id: "demo-svc-vision", name: "northwind-vision", kind: "ComputerVision", location: "northeurope", skuName: "S1", publicAccess: "Disabled" },
      { id: "demo-svc-safety", name: "northwind-safety", kind: "ContentSafety", location: "westeurope", skuName: "S0", publicAccess: "Enabled" },
      { id: "demo-svc-speech", name: "northwind-speech", kind: "SpeechServices", location: "uksouth", skuName: "S0", publicAccess: "Enabled" },
    ],
    accessControl: [
      { principalId: "8f31c2a4-0d55-4b9e-9a71-2c6f4b8e1d03", principalType: "User", roleName: "Cognitive Services OpenAI Contributor", resourceId: "/subscriptions/0f2d/rg-ai/northwind-ai-prod" },
      { principalId: "b7d92e15-6a43-4c81-bf20-91e5d7a3c468", principalType: "ServicePrincipal", roleName: "Owner", resourceId: "/subscriptions/0f2d/rg-sec/northwind-ai-sec" },
      { principalId: "3c48a9f7-2b61-4d05-8e93-7fa1c60b2d59", principalType: "Group", roleName: "Cognitive Services OpenAI User", resourceId: "/subscriptions/0f2d/rg-ai/northwind-ai-prod" },
      { principalId: "d15e6b83-9c27-4a10-b5df-38e02f7a91c4", principalType: "ServicePrincipal", roleName: "Contributor", resourceId: "/subscriptions/0f2d/rg-fin/northwind-ai-fin" },
    ],
    subscriptions: [{ id: "0f2d-demo-subscription", name: "Northwind Production" }],
    warnings: [],
  };
}

// ── Azure usage / threads / assistants ──────────────────────────────────────

// Shape verified against the Azure conversations panel in UserActivityTab:
// totalRequests / totalTokens at the top level, and resources[].metrics
// .deployments[] for the table. A flat `deployments` array is silently wrong
// here — the table is optional-chained so it renders nothing and the KPIs read
// zero, which looks like "no usage" rather than a bug.
function buildAzureUsage(period) {
  const days = periodToDays(period);
  const cost = buildAzureCost(days);
  const byResource = new Map();
  for (const d of cost.deployments) {
    if (!byResource.has(d.resourceName)) byResource.set(d.resourceName, []);
    byResource.get(d.resourceName).push({
      deploymentName: d.deploymentName,
      modelName: d.modelName,
      requestCount: d.requestCount,
      promptTokens: d.inputTokens,
      completionTokens: d.outputTokens,
      totalTokens: d.totalTokens,
    });
  }
  return {
    period,
    totalRequests: cost.summary.totalRequests,
    totalTokens: cost.summary.totalTokens,
    resources: [...byResource.entries()].map(([resourceName, deployments]) => ({
      resourceName,
      metrics: { deployments },
    })),
    summary: cost.summary,
  };
}

function buildAzureThreads() {
  const threads = CHATTY_AGENTS.slice(0, 6).map((a, i) => {
    const rand = rngFor("thread" + a.name);
    return {
      id: `demo-thread-${i}`,
      assistantId: a.appId,
      assistantName: a.name,
      messageCount: between(rand, 4, 28),
      createdAt: iso(NOW - between(rand, 2, 120) * 3600000),
      lastMessageAt: iso(NOW - between(rand, 1, 40) * 3600000),
      userName: pick(rand, ACTIVE_PEOPLE).displayName,
    };
  });
  return { threads, totalThreads: threads.length, warnings: [] };
}

function buildAzureAssistants() {
  const assistants = AG_DEMO_AGENTS.filter((a) => a.platform === "azure_foundry" || a.platform === "openai_assistant")
    .map((a) => ({
      id: a.appId,
      name: a.name,
      model: a.llmModel || "gpt-4o",
      instructions: a.description,
      tools: (a.connectors || []).map((c) => ({ type: c.type === "Function" ? "function" : c.type === "CodeInterpreter" ? "code_interpreter" : "file_search" })),
      fileCount: (a.connectors || []).length * 3,
      createdAt: a.firstSeen,
    }));
  return { assistants, warnings: [] };
}


// ── policies & compliance packs (Policies tab) ──────────────────────────────

const AG_DEMO_PACKS = [
  { id: "gdpr",        framework: "GDPR",          deployed: true,  ruleCount: 18, enforceable: 7, monitored: 6, attestations: 5 },
  { id: "hipaa",       framework: "HIPAA",         deployed: false, ruleCount: 17, enforceable: 6, monitored: 6, attestations: 5 },
  { id: "soc2",        framework: "SOC 2",         deployed: false, ruleCount: 16, enforceable: 7, monitored: 5, attestations: 4 },
  { id: "ccpa",        framework: "CCPA/CPRA",     deployed: false, ruleCount: 13, enforceable: 5, monitored: 4, attestations: 4 },
  { id: "eu-ai-act",   framework: "EU AI Act",     deployed: false, ruleCount: 16, enforceable: 5, monitored: 5, attestations: 6 },
  { id: "iso-42001",   framework: "ISO/IEC 42001", deployed: false, ruleCount: 15, enforceable: 5, monitored: 5, attestations: 5 },
  { id: "nist-ai-rmf", framework: "NIST AI RMF",   deployed: false, ruleCount: 15, enforceable: 5, monitored: 5, attestations: 5 },
];

const COND = (field, operator, value) => ({ field, operator, value });

const AG_DEMO_POLICIES = [
  // Custom policies an admin wrote.
  { id: "demo-pol-1", name: "Escalate orphaned agents", type: "lifecycle", status: "active", severity: "critical",
    description: "Any agent whose owner no longer has an active account is escalated to the AI governance group.",
    conditions: [COND("is_orphaned", "is_true", "true")], actions: [{ type: "escalate" }, { type: "notify" }],
    scope: { type: "all agents" }, created_at: daysAgo(96) },
  { id: "demo-pol-2", name: "Flag organisation-wide consent", type: "access", status: "active", severity: "high",
    description: "Agents consented for every user in the tenant are flagged for review.",
    conditions: [COND("consent_type", "equals", "AllPrincipals")], actions: [{ type: "flag" }],
    scope: { type: "all agents" }, created_at: daysAgo(88) },
  { id: "demo-pol-3", name: "Dormant but privileged (90 days)", type: "lifecycle", status: "active", severity: "high",
    description: "Agents with no activity for 90 days that still hold application permissions.",
    conditions: [COND("days_since_last_activity", "greater_than", "90"), COND("permission_count", "greater_than", "0")],
    actions: [{ type: "flag" }, { type: "notify" }], scope: { type: "all agents" }, created_at: daysAgo(71) },
  { id: "demo-pol-4", name: "External HTTP connector review", type: "data", status: "active", severity: "high",
    description: "Any agent holding a connector that can reach outside the tenant.",
    conditions: [COND("has_http_connector", "is_true", "true")], actions: [{ type: "flag" }],
    scope: { type: "all agents" }, created_at: daysAgo(64) },
  { id: "demo-pol-5", name: "Suspend critical unreviewed agents", type: "lifecycle", status: "draft", severity: "critical",
    description: "Draft — would suspend any agent scoring above 85 that has never been recertified.",
    conditions: [COND("risk_score", "greater_than", "85")], actions: [{ type: "suspend" }],
    scope: { type: "all agents" }, created_at: daysAgo(12) },

  // Policies created by deploying the GDPR pack.
  { id: "demo-gdpr-1", pack_id: "gdpr", name: "[GDPR] Art. 5(1)(c) — data minimisation in agent scope", type: "data",
    status: "active", severity: "high", description: "Agents must not hold broader data access than their stated purpose requires.",
    conditions: [COND("has_dangerous_permissions", "is_true", "true")], actions: [{ type: "flag" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "demo-gdpr-2", pack_id: "gdpr", name: "[GDPR] Art. 5(2) — accountability: named owner required", type: "lifecycle",
    status: "active", severity: "critical", description: "Every processing activity needs an accountable owner.",
    conditions: [COND("is_orphaned", "is_true", "true")], actions: [{ type: "escalate" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "demo-gdpr-3", pack_id: "gdpr", name: "[GDPR] Art. 28 — processor due diligence on third-party agents", type: "access",
    status: "active", severity: "high", description: "Third-party AI apps consented org-wide require a processor agreement on file.",
    conditions: [COND("consent_type", "equals", "AllPrincipals")], actions: [{ type: "flag" }, { type: "notify" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "demo-gdpr-4", pack_id: "gdpr", name: "[GDPR] Art. 30 — records of processing kept current", type: "lifecycle",
    status: "active", severity: "medium", description: "Agents unreviewed for more than 12 months fall out of the ROPA.",
    conditions: [COND("days_since_last_activity", "greater_than", "365")], actions: [{ type: "flag" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "demo-gdpr-5", pack_id: "gdpr", name: "[GDPR] Art. 32 — security of processing: connector review", type: "data",
    status: "active", severity: "high", description: "External connectors must be assessed before an agent processes personal data.",
    conditions: [COND("has_http_connector", "is_true", "true")], actions: [{ type: "flag" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "demo-gdpr-6", pack_id: "gdpr", name: "[GDPR] Art. 35 — DPIA trigger on high-risk agents", type: "compliance",
    status: "active", severity: "high", description: "Agents scoring high or critical require a documented DPIA.",
    conditions: [COND("risk_level", "equals", "critical")], actions: [{ type: "flag" }, { type: "notify" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "demo-gdpr-7", pack_id: "gdpr", name: "[GDPR] Art. 44 — transfers outside the EEA", type: "data",
    status: "active", severity: "critical", description: "Agents egressing personal data outside the tenant need a transfer basis.",
    conditions: [COND("has_http_connector", "is_true", "true"), COND("consent_type", "equals", "AllPrincipals")],
    actions: [{ type: "escalate" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
];

/** Live violations — one per agent that actually trips a deployed policy. */
function buildViolations() {
  const rows = [];
  const offenders = AG_DEMO_AGENTS.filter((a) => a.isOrphaned || a.consentType === "AllPrincipals");
  offenders.slice(0, 14).forEach((a, i) => {
    const pol = a.isOrphaned ? AG_DEMO_POLICIES[0] : AG_DEMO_POLICIES[1];
    rows.push({
      id: "demo-viol-" + i,
      policy_id: pol.id,
      policy_name: pol.name,
      agent_id: a.id,
      agent_name: a.name,
      severity: a.risk.level === "critical" ? "critical" : "high",
      status: i < 4 ? "open" : "acknowledged",
      detail: a.isOrphaned ? "Owner account is disabled or absent" : "Consent granted for all principals",
      created_at: daysAgo(1 + i * 3),
    });
  });
  return rows;
}
const AG_DEMO_VIOLATIONS = buildViolations();

/** Dry-run result for a single policy or a whole pack. */
function buildSimulation(body) {
  let target = [];
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body || {};
    const id = parsed.policy_id || parsed.policyId || parsed.pack_id || parsed.packId;
    const pack = AG_DEMO_PACKS.find((p) => p.id === id);
    if (pack) target = AG_DEMO_POLICIES.filter((p) => p.pack_id === pack.id);
    else target = AG_DEMO_POLICIES.filter((p) => p.id === id);
  } catch { /* fall through */ }
  if (target.length === 0) target = [AG_DEMO_POLICIES[0]];

  const hit = AG_DEMO_AGENTS.filter(
    (a) => a.isOrphaned || a.consentType === "AllPrincipals" || a.risk.level === "critical"
  );
  const alreadyOpen = AG_DEMO_VIOLATIONS.filter((v) => v.status === "open").length;
  return {
    ok: true,
    status: "simulated",
    agents_evaluated: AG_DEMO_AGENTS.length,
    would_flag: hit.length,
    already_open: alreadyOpen,
    newly_flagged: Math.max(0, hit.length - alreadyOpen),
    severity: target[0].severity,
    actions: target.flatMap((p) => (p.actions || []).map((x) => x.type)),
    matches: hit.slice(0, 12).map((a) => ({
      agent_id: a.id,
      agent_name: a.name,
      platform: a.platform,
      owner: a.owner ? a.owner.displayName : null,
      risk_level: a.risk.level,
      reason: a.isOrphaned
        ? "No accountable owner"
        : a.consentType === "AllPrincipals"
          ? "Organisation-wide consent"
          : "Risk score above threshold",
      already_flagged: AG_DEMO_VIOLATIONS.some((v) => v.agent_id === a.id),
    })),
  };
}

// ── stale-agent alerts (Stale Agents tab) ───────────────────────────────────

function buildAlerts(thresholdMinutes) {
  const thresholdMs = (thresholdMinutes || 43200) * 60000;
  const out = [];
  AG_DEMO_AGENTS.forEach((a, i) => {
    const last = a.activity.lastActiveTimestamp ? new Date(a.activity.lastActiveTimestamp).getTime() : null;
    if (last && NOW - last <= thresholdMs) return;
    const idleMinutes = last ? Math.round((NOW - last) / 60000) : null;
    const idleDays = idleMinutes ? Math.floor(idleMinutes / 1440) : null;
    out.push({
      id: "demo-alert-" + i,
      agent_id: a.id,
      agent_name: a.name,
      vendor: a.vendor,
      platform: a.platform,
      alert_type: "idle_agent",
      idle_minutes: idleMinutes,
      last_active: a.activity.lastActiveTimestamp,
      message: idleDays
        ? a.name + " has been idle for " + idleDays + " day(s)"
        : a.name + " has no recorded activity",
      severity: idleDays && idleDays > 90 ? "high" : idleDays && idleDays > 60 ? "medium" : "low",
      resolved: false,
      created_at: hoursAgo(1),
    });
  });
  return out;
}

const AG_DEMO_ALERT_CONFIG = {
  idle_threshold_minutes: 43200,
  enabled: true,
  notify_microsoft: true,
  notify_google: true,
};

// ── secondary panels — DATA RETAINED BUT CURRENTLY UNSERVED ────────────────
//
// Recertification, Prompt Monitor and Claude Budget are built in the codebase
// but are not in the six-tab strip, so their payload shapes have never been
// read off a live consumer. Their endpoints therefore return REJECT (see the
// rule on the sentinel below) rather than an unverified guess.
//
// The datasets below are kept, unused, for whoever wires those tabs up: fill
// in the real shape from the component, then swap the REJECT for the builder.
// Vite tree-shakes them out of the bundle in the meantime.

function buildRecertificationCampaigns() {
  const targets = AG_DEMO_AGENTS.filter((a) => a.risk.level === "critical" || a.risk.level === "high").slice(0, 10);
  const states = ["pending", "pending", "approved", "pending", "escalated", "approved", "rejected", "pending", "approved", "pending"];
  return targets.map((a, i) => ({
    id: "demo-recert-" + i,
    agent_id: a.id,
    agent_name: a.name,
    platform: a.platform,
    owner_name: a.owner ? a.owner.displayName : "Unassigned",
    owner_email: a.owner ? a.owner.userPrincipalName : null,
    status: states[i] || "pending",
    due_at: daysAgo(-(14 - i)),
    launched_at: daysAgo(7),
    overdue: i === 4,
    notes: i === 6 ? "Owner confirmed the agent is no longer needed — scheduled for retirement." : null,
  }));
}
const AG_DEMO_RECERT = buildRecertificationCampaigns();

function buildPromptFlags() {
  const seeds = [
    ["Customer Refund Triage", "critical", "pii", "Card number and national identifier in one prompt"],
    ["Payroll Query Handler", "critical", "pii", "National insurance number sent to the agent"],
    ["IT Helpdesk Copilot", "critical", "secrets", "Live API key pasted into the conversation"],
    ["Benefits Explainer", "high", "health", "Named medical condition and medication"],
    ["Contract Review Assistant", "high", "confidential", "Unredacted commercial terms"],
    ["Customer Refund Triage", "high", "financial", "Account balance and charge history"],
    ["Sales Playbook Agent", "medium", "confidential", "Internal discount ladder"],
  ];
  return seeds.map((s, i) => {
    const a = AG_DEMO_AGENTS.find((x) => x.name === s[0]);
    return {
      id: "demo-flag-" + i,
      agent_id: a ? a.id : "demo-unknown-" + i,
      agent_name: s[0],
      platform: a ? a.platform : "copilot_studio",
      severity: s[1],
      category: s[2],
      detail: s[3],
      resolved: i > 4,
      created_at: hoursAgo(3 + i * 9),
    };
  });
}
const AG_DEMO_PROMPT_FLAGS = buildPromptFlags();

function buildClaudeBudgetMembers() {
  return {
    org: { name: "Northwind Traders", month: new Date(NOW).toISOString().slice(0, 7) },
    members: ACTIVE_PEOPLE.map((p, i) => {
      const rand = rngFor("budget" + p.userPrincipalName);
      const inTok = between(rand, 400000, 4200000);
      const outTok = between(rand, 90000, 900000);
      return {
        id: p.userPrincipalName,
        name: p.displayName,
        email: p.userPrincipalName,
        role: i === 0 ? "admin" : i < 3 ? "developer" : "user",
        inputTokens: inTok,
        outputTokens: outTok,
        costUsd: (inTok / 1e6) * 3 + (outTok / 1e6) * 15,
      };
    }),
  };
}

const AG_DEMO_PRICING = {
  azure: [
    { model: "gpt-4o", input: 2.5, output: 10 },
    { model: "gpt-4o-mini", input: 0.15, output: 0.6 },
    { model: "o1", input: 15, output: 60 },
    { model: "text-embedding-3-large", input: 0.13, output: 0 },
    { model: "gpt-35-turbo", input: 0.5, output: 1.5 },
  ],
};

// ── Google Vertex / GCP drill-down (Discovery → a Google scope) ─────────────
//
// Shape verified against GoogleVertexView in tabs/DiscoveryTab.jsx. EIGHT
// arrays are read unguarded — reasoningEngines, agentBuilderApps,
// dialogflowAgents, chatBots, endpoints, models, dataStores, warnings — so all
// eight must exist even when empty.
//
// `bot.spaces` and `ep.deployedModels` are mapped but their item shapes are not
// verified, so both stay empty arrays: the parent rows render, the unverified
// sub-lists simply show nothing rather than risking a throw.
function buildGoogleVertexDiscovery() {
  return {
    projectId: "northwind-ai-prod",
    domain: "northwind.example",
    reasoningEngines: [
      { id: "re-territory", displayName: "Territory Planner", description: "Allocates sales territories from BigQuery", region: "europe-west4", pythonVersion: "3.11", createTime: daysAgo(121) },
      { id: "re-support", displayName: "Support Deflection Agent", description: "Answers tier-1 questions from the help centre", region: "europe-west4", pythonVersion: "3.11", createTime: daysAgo(84) },
      { id: "re-invoice", displayName: "Invoice Extraction Agent", description: "Extracts line items from supplier invoices", region: "europe-west1", pythonVersion: "3.12", createTime: daysAgo(138) },
    ],
    agentBuilderApps: [
      { id: "ab-helpcentre", displayName: "Help Centre Search", location: "eu", solutionType: "SOLUTION_TYPE_SEARCH", dataStoreCount: 2, createTime: daysAgo(96) },
      { id: "ab-policy", displayName: "Policy Assistant", location: "eu", solutionType: "SOLUTION_TYPE_CHAT", dataStoreCount: 1, createTime: daysAgo(52) },
    ],
    dialogflowAgents: [],
    chatBots: [
      { id: "cb-release", displayName: "Release Notes Chat Bot", adminInstalled: true, firstSeen: daysAgo(167), spaces: [], spaceTypes: [] },
      { id: "cb-support", displayName: "Support Deflection Chat Bot", adminInstalled: true, firstSeen: daysAgo(254), spaces: [], spaceTypes: [] },
    ],
    endpoints: [
      { id: "ep-gemini-pro", displayName: "gemini-pro-endpoint", region: "europe-west4", deployedModels: [] },
      { id: "ep-gemini-flash", displayName: "gemini-flash-endpoint", region: "europe-west1", deployedModels: [] },
    ],
    models: [
      { id: "m-gemini-pro", displayName: "gemini-2.5-pro", description: "Managed foundation model", model: "gemini-2.5-pro", region: "europe-west4", sourceType: "MODEL_GARDEN", createTime: daysAgo(121) },
      { id: "m-gemini-flash", displayName: "gemini-2.5-flash", description: "Managed foundation model", model: "gemini-2.5-flash", region: "europe-west1", sourceType: "MODEL_GARDEN", createTime: daysAgo(84) },
    ],
    dataStores: [
      { id: "ds-helpcentre", displayName: "help-centre-articles", contentConfig: "CONTENT_REQUIRED", createTime: daysAgo(96) },
      { id: "ds-policies", displayName: "hr-finance-policies", contentConfig: "CONTENT_REQUIRED", createTime: daysAgo(52) },
      { id: "ds-bidlibrary", displayName: "bid-library", contentConfig: "CONTENT_REQUIRED", createTime: daysAgo(59) },
    ],
    warnings: [],
  };
}

// ── Google / Gemini Enterprise user activity ────────────────────────────────
//
// Both endpoints return {chats, files, knowledge} and the loaders push them
// into the SAME state the Microsoft path uses, so all three shapes are already
// verified. Google-flavoured slices of the same datasets keep the demo
// consistent when someone switches the application dropdown.
const GOOGLE_AGENT_NAMES = new Set(
  AG_DEMO_AGENTS.filter((a) => a.vendor === "Google").map((a) => a.name)
);

function buildGoogleActivity() {
  const chats = AG_DEMO_CHATS.filter((c) => GOOGLE_AGENT_NAMES.has(c.botName));
  const files = AG_DEMO_FILES.filter((f) => (f.relatedAgents || []).some((n) => GOOGLE_AGENT_NAMES.has(n)));
  const knowledge = AG_DEMO_KNOWLEDGE_BOTS.filter((b) => GOOGLE_AGENT_NAMES.has(b.botName));
  return { chats, files, knowledge, warnings: [] };
}

// ── mocked responses, by request path ───────────────────────────────────────
//
// COMPLETE COVERAGE, on purpose. In demo mode every governance call is answered
// from this file, so nothing waits on a network round-trip — that is what makes
// each tab render instantly. Paths here are relative to the /api base.
//
// /api/v1/* (the AI Hub API) is deliberately never touched.

const OK = { ok: true, success: true };

/**
 * Sentinel: "answer locally, but as a FAILURE".
 *
 * This exists because of a real bug this file shipped with. A mock that returns
 * a half-formed object looks like success to the component, which then maps
 * over a field that is not there and throws inside render. Every Agent
 * Governance tab mounts at once (AgentGovernance.jsx renders all six and
 * toggles display), so one such throw blanks the ENTIRE screen, not just the
 * panel that caused it.
 *
 * A rejection is strictly safer. Every one of these panels already handles a
 * failed fetch — that is exactly what they do today with no cloud connection —
 * so they fall back to their own empty or error state and the rest of the page
 * keeps working. It is still instant: a rejected promise settles in a
 * microtask with no network involved.
 *
 * RULE: return real data only for a payload whose shape has been read off the
 * consuming component. Anything else returns REJECT. Never return a guess.
 */
const REJECT = Symbol("ag-demo-reject");
const NOT_CONNECTED = "This platform is not connected.";

function mockFor(path, method, body) {
  const p = String(path || "");
  const m = String(method || "GET").toUpperCase();
  const q = new URLSearchParams(p.includes("?") ? p.slice(p.indexOf("?") + 1) : "");
  const has = (s) => p.startsWith(s);

  // ── discovery ─────────────────────────────────────────────────────────────
  // Never write fabricated agents to the server.
  if (has("/discovery/agents") && m === "POST") return { ok: true, persisted: 0, note: "demo mode - write suppressed" };
  if (has("/discovery/agents")) return { agents: AG_DEMO_AGENTS, warnings: [] };
  if (has("/discovery/run")) return agDemoDiscoveryResult();

  // ── per-platform scans ────────────────────────────────────────────────────
  // The merge helpers are all optional-chained, so an empty object is safe —
  // the full agent list already arrives from /discovery/run.
  // The four scan-platform endpoints are safe to answer with {}: the parent's
  // merge helpers read every field optional-chained (r.assistants?.length and
  // friends), and the full agent list already arrives via /discovery/run.
  if (has("/google/scan-platform")) return {};
  if (has("/openai/scan-platform") || has("/claude/scan-platform") || has("/aws/scan-platform")) return {};

  // ── Google (verified shapes) ──────────────────────────────────────────────
  // GoogleVertexView reads eight arrays unguarded; the activity endpoints
  // return {chats, files, knowledge} into the same state the Microsoft path
  // uses, so those three shapes are already verified.
  if (has("/google/discover")) return buildGoogleVertexDiscovery();
  if (has("/google/user-activity")) return buildGoogleActivity();
  // fetchGeminiEnterpriseAuto / -Data feed the same three collections.
  if (has("/gemini-enterprise/data") || has("/gemini-enterprise/auto")) return buildGoogleActivity();
  if (has("/gemini-enterprise/preview") || has("/gemini-enterprise/connect")) return Object.assign({}, OK, { id: AG_DEMO_KEYS.geminiEnterpriseKeyId });

  // Still unverified: per-agent detail and the Vault / raw-conversation feeds.
  if (has("/google/agent-details") || has("/google/conversations")
      || has("/google/gemini-activity") || has("/google/gemini-vault")) return REJECT;
  if (has("/gemini-enterprise")) return REJECT;

  // ── Azure ─────────────────────────────────────────────────────────────────
  if (has("/azure/discover")) return buildAzureDiscovery();
  if (has("/activity/azure/usage")) return buildAzureUsage(q.get("period"));
  if (has("/activity/azure/threads")) return buildAzureThreads();
  if (has("/activity/azure/assistants")) return buildAzureAssistants();

  // ── activity ──────────────────────────────────────────────────────────────
  // The Dataverse endpoint carries every conversation; the audit-log and Graph
  // endpoints return empty so nothing is double-counted.
  if (has("/activity/chats")) return { chats: AG_DEMO_CHATS, warnings: [] };
  if (has("/activity/copilot-interactions") || has("/activity/m365-copilot-chats")) return { chats: [] };
  if (has("/activity/files")) return { files: AG_DEMO_FILES, warnings: [] };
  if (has("/activity/knowledge")) return { bots: AG_DEMO_KNOWLEDGE_BOTS, warnings: [] };
  if (has("/activity/agent-permissions")) return buildAgentPermissions();
  if (has("/activity/teams/signins")) return { signIns: [], warnings: [] };
  // Empty on purpose: the panel then falls back to the discovered agents, which
  // is the same list every other tab is showing.
  if (has("/activity/risk-summary")) return { agents: [] };

  // ── cost ──────────────────────────────────────────────────────────────────
  if (has("/cost/azure")) return buildAzureCost(periodToDays(q.get("period")));
  if (has("/cost/google")) return { endpoints: [], summary: { totalCost: 0, totalTokens: 0, totalPredictions: 0 } };
  // Cost is only ever rendered for the Microsoft vendor in demo mode (CostTab
  // picks its vendor from the first key present, and oauthKeyId always wins),
  // so the per-vendor cost endpoints below are unreachable there. They reject
  // rather than feed an unverified shape into a table.
  if (has("/cost/history") || has("/cost/pricing")) return REJECT;
  if (has("/openai/usage") || has("/openai/cost") || has("/openai/activity")
      || has("/openai/knowledge") || has("/openai/threads") || has("/openai/files")) return REJECT;
  if (has("/claude/usage") || has("/claude/files") || has("/claude/budget/members")
      || has("/claude/debug-admin")) return REJECT;
  if (has("/aws/usage")) return REJECT;

  // ── destructive vendor actions — answered as no-ops ───────────────────────
  // These delete or archive a real agent in a real tenant. They must never
  // leave the browser in demo mode, so they are swallowed here and the UI
  // gets its success response. Kept together, and above the generic /claude
  // and /openai read handlers would not catch them anyway.
  if (has("/openai/gpt")) return Object.assign({}, OK, { action: "deleted", note: "demo mode - nothing deleted" });
  if (has("/claude/project")) return Object.assign({}, OK, { action: "deleted", note: "demo mode - nothing deleted" });
  if (has("/claude/workspace/archive")) return Object.assign({}, OK, { action: "archived", note: "demo mode - nothing archived" });

  // ── lifecycle: statuses are read, actions are no-ops ──────────────────────
  if (has("/lifecycle/approval-statuses") || has("/lifecycle/lifecycle-statuses")) return { statuses: {} };
  if (has("/lifecycle/blocked-agents")) return [];
  if (has("/lifecycle/")) return Object.assign({}, OK, { note: "demo mode - no change applied" });

  // ── policies & packs ──────────────────────────────────────────────────────
  if (has("/policies/violations")) return AG_DEMO_VIOLATIONS;
  if (has("/policies/simulate")) return buildSimulation(body);
  if (has("/policies/evaluate")) return { violations: AG_DEMO_VIOLATIONS, evaluated: AG_DEMO_AGENTS.length };
  if (has("/policies/seed-templates")) return { success: true, created: 0, total: AG_DEMO_POLICIES.length };
  if (has("/policies")) {
    if (m === "GET") return AG_DEMO_POLICIES;
    return Object.assign({}, OK, { id: "demo-pol-" + Date.now() });
  }
  if (has("/policy-packs")) {
    if (p.includes("/simulate")) return buildSimulation(body);
    if (m === "GET") return AG_DEMO_PACKS;
    return OK;
  }

  // ── alerts ────────────────────────────────────────────────────────────────
  if (has("/alerts/config")) return AG_DEMO_ALERT_CONFIG;
  if (has("/alerts/check")) {
    let threshold = 43200;
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body || {};
      if (parsed.idle_threshold_minutes) threshold = parsed.idle_threshold_minutes;
    } catch { /* default */ }
    return { alerts: buildAlerts(threshold), checked: AG_DEMO_AGENTS.length };
  }
  if (has("/alerts/resolve-all")) return OK;
  if (has("/alerts")) {
    if (m === "GET") return { alerts: buildAlerts(43200) };
    return OK;
  }

  // ── panels outside the current 6-tab strip ────────────────────────────────
  // Recertification, Prompt Monitor and the sensitivity views are built but not
  // wired into TABS, so their shapes have not been read off a live consumer.
  // Writes are still swallowed (nothing must reach the server); reads reject.
  if (has("/sensitivity/") || has("/prompts/") || has("/recertification")) {
    return m === "GET" ? REJECT : OK;
  }

  // AgentMetadataPanel is the one verified consumer here: it reads
  // res.exists and fills an empty form when false. The list and stats
  // endpoints have no verified consumer, so they reject.
  if (has("/agent-metadata/stats/summary")) return REJECT;
  if (has("/agent-metadata")) {
    if (m !== "GET") return OK;
    // "/agent-metadata/<id>" is a single record; bare "/agent-metadata" a list.
    const segs = p.split("?")[0].split("/").filter(Boolean);
    return segs.length > 1 ? { exists: false } : REJECT;
  }

  // ── credential plumbing — answered locally so a fake key id never 400s ────
  if (has("/auth/token")) return { ok: true, expires_in: 3600 };
  if (has("/oauth-keys")) {
    if (m === "GET") {
      // Microsoft + Google only. No openai / claude / aws rows, so nothing can
      // restore those vendors behind the scenes.
      return [
        { id: AG_DEMO_KEYS.oauthKeyId, vendor: "microsoft", tenant_id: AG_DEMO_KEYS.tenantId, dataverse_env_url: AG_DEMO_KEYS.dataverseEnvUrl, azure_subscription_id: AG_DEMO_KEYS.azureSubscriptionId },
        { id: AG_DEMO_KEYS.googleKeyId, vendor: "google" },
      ];
    }
    return Object.assign({}, OK, { id: AG_DEMO_KEYS.oauthKeyId });
  }
  if (has("/google/connect") || has("/openai/connect") || has("/claude/connect") || has("/aws/connect")) {
    return Object.assign({}, OK, { id: "demo-connected-key" });
  }
  if (has("/health")) return { ok: true, status: "ok", version: "demo" };

  return undefined; // nothing matched
}

/**
 * Returns a mocked response for `path`, or undefined to let the real request
 * through. Always undefined when demo mode is off.
 */
export function agDemoResponse(path, options) {
  if (!AG_DEMO) return undefined;
  try {
    const out = mockFor(path, options && options.method, options && options.body);
    // Answer locally as a failure. request() is async, so returning a rejected
    // promise surfaces in the caller's existing catch — no network, no throw
    // inside render.
    if (out === REJECT) return Promise.reject(new Error(NOT_CONNECTED));
    // The only deliberate wait in the whole file, and it is opt-in (0 by default).
    if (out !== undefined && AG_DEMO_SCAN_MS > 0 && String(path).startsWith("/discovery/run")) {
      return delay(AG_DEMO_SCAN_MS, out);
    }
    return out;
  } catch (e) {
    console.error("[agent-governance demo] mock failed for", path, e);
    return undefined;
  }
}

// ── global fetch shim ───────────────────────────────────────────────────────
//
// The actions layer is not the only caller: PoliciesTab loads policy packs and
// runs simulations through its own packFetch, and a few panels call fetch()
// directly. Patching fetch once covers all of them, so no governance screen can
// fall back to a network round-trip mid-demo.
//
// Scope is deliberately narrow: only paths under /api that are NOT /api/v1 (the
// AI Hub API). Everything else — assets, the AI Hub, any third-party request —
// passes through untouched.

function pathOf(input) {
  let raw = "";
  if (typeof input === "string") raw = input;
  else if (input && typeof input.url === "string") raw = input.url;
  else return "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (typeof window !== "undefined" && u.origin !== window.location.origin) return "";
      return u.pathname + u.search;
    }
  } catch {
    return "";
  }
  return raw;
}

/** "/api/policies?x=1" becomes "/policies?x=1"; anything else returns null. */
function governancePath(input) {
  const p = pathOf(input);
  if (!p.startsWith("/api/")) return null;
  if (p.startsWith("/api/v1/")) return null; // AI Hub API — leave alone
  return p.slice(4);
}

let shimInstalled = false;

export function installAgDemoFetch() {
  if (!AG_DEMO || shimInstalled) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  shimInstalled = true;

  const realFetch = window.fetch.bind(window);

  window.fetch = function agDemoFetch(input, init) {
    const gp = governancePath(input);
    if (gp) {
      const method =
        (init && init.method) ||
        (input && typeof input !== "string" && input.method) ||
        "GET";
      const body = (init && init.body) || undefined;
      let mock;
      try {
        mock = mockFor(gp, method, body);
      } catch (e) {
        console.error("[agent-governance demo] mock threw for", gp, e);
      }
      // Deliberate local failure — 503 so request()'s !res.ok path throws with
      // the message, exactly as a real unreachable platform would.
      if (mock === REJECT) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: NOT_CONNECTED }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (mock !== undefined) {
        const wait = AG_DEMO_SCAN_MS > 0 && gp.startsWith("/discovery/run") ? AG_DEMO_SCAN_MS : 0;
        // Promise.resolve handles both the sync value and the opt-in scan delay.
        return Promise.resolve(wait ? delay(wait, mock) : mock).then(
          (v) =>
            new Response(JSON.stringify(v), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
        );
      }
      // An un-mocked governance path is the only thing that can still make a
      // tab wait, so say so loudly rather than failing quietly.
      console.warn("[agent-governance demo] NOT MOCKED, hitting network:", method, gp);
    }
    return realFetch(input, init);
  };

  console.info(
    "%c[agent-governance demo] fetch shim active",
    "color:#b45309;font-weight:600",
    "- every /api governance call is served locally. /api/v1 is untouched."
  );
}

// Self-install at import time, so the shim is in place before any component
// mounts and fires its first effect.
installAgDemoFetch();
