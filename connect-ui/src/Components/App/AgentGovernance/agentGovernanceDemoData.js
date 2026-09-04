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

// AI Hub (/api/v1) is served from a cache of real responses rather than
// fabricated data — see aiHubDemoCache.js for why.
// Explicit .js extension: Vite resolves it either way, but the verify scripts
// run this module under bare Node, which does not.
import { isCacheable, cacheGet, cachePut } from "../AIHub/aiHubDemoCache.js";

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
  // GOOGLE ONLY. This customer is a Google Workspace shop, so Agent Governance
  // must present no Microsoft surface whatsoever.
  //
  // A null key id is what every "is this platform connected?" check reads, so
  // leaving the Microsoft fields unset removes the Microsoft 365 connection
  // badge, every Microsoft scope chip in the Discovery selector, the Azure AI
  // Foundry panel and the App Permissions panel, and the Microsoft entries in
  // the User Activity application dropdown. Two knock-on effects are load
  // bearing and intentional: CostTab picks its vendor from the first key
  // present, so it now follows the Google path, and User Activity defaults its
  // application dropdown to a Google platform instead of Copilot Studio.
  oauthKeyId: null,
  tenantId: null,
  dataverseEnvUrl: null,
  azureSubscriptionId: null,
  openaiKeyId: null,
  claudeKeyId: null,
  awsKeyId: null,
  googleKeyId: guid("key:google"),
  geminiEnterpriseKeyId: guid("key:gemini-enterprise"),
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

// ── identifiers ─────────────────────────────────────────────────────────────
//
// NOTHING ON SCREEN MAY READ AS FABRICATED. Agent Governance renders raw
// identifiers in several places — the Discovery detail panel prints
// `discoverySource` and the agent id, and the permissions table prints appId
// under every application name — so an id like "demo-copilot_studio-0" or a
// source of "demo_dataset" is visible to whoever is watching the screen.
//
// Ids are therefore generated as real-shaped values (GUIDs for Microsoft,
// resource paths for Google) and derived from a hash of the agent name, so
// they are stable across reloads.
//
// Because no id carries a marker any more, the check that stops a fabricated
// agent's write reaching the server can no longer be a string prefix. It is a
// membership test against FABRICATED_IDS instead, populated below.
const FABRICATED_IDS = new Set();

/** Deterministic RFC-4122-shaped GUID from any seed string. */
function guid(seed) {
  const r = rngFor("guid:" + seed);
  const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(r() * 16)]).join("");
  // Version 4, variant 1 — the shape Entra and Dataverse ids actually take.
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(r() * 4)]}${hex(3)}-${hex(12)}`;
}

/** Register an id as fabricated and return it unchanged. */
function fab(id) {
  FABRICATED_IDS.add(String(id));
  return id;
}

export function isFabricatedId(id) {
  return FABRICATED_IDS.has(String(id || ""));
}

// The real `discoverySource` value each platform reports, taken from
// server/src/governance/services/discoveryService.ts and the client-side
// converters. These are what the Discovery panel prints, and several get a
// coloured badge from sourceStyle in tabs/DiscoveryTab.jsx.
const DISCOVERY_SOURCE = {
  vertex_ai:         "vertex_ai_reasoning_engines",
  gemini_enterprise: "gemini_enterprise",
  gemini_gems:       "google_admin_sdk",
  google_chat:       "google_chat_api",
  apps_script:       "google_apps_script_api",
};

const GCP_PROJECT = "halcyon-ai-prod";
const GCP_ORG = "halcyongroup.com";

/** Google resources are addressed by path, not GUID. */
function googleResourceId(platform, name) {
  const n = rngFor("gres:" + name);
  const num = String(Math.floor(n() * 9e15) + 1e15);
  const region = pick(rngFor("greg:" + name), ["europe-west4", "europe-west1", "us-central1"]);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  switch (platform) {
    case "vertex_ai":         return "projects/" + GCP_PROJECT + "/locations/" + region + "/reasoningEngines/" + num;
    case "gemini_enterprise": return "projects/" + GCP_PROJECT + "/locations/global/collections/default_collection/engines/" + slug;
    case "gemini_gems":       return "gems/" + num.slice(0, 16);
    case "google_chat":       return "spaces/" + num.slice(0, 11);
    case "apps_script":       return "projects/1" + num.slice(0, 14) + slug.slice(0, 8);
    // Every platform above is covered; this is a guard, not a live branch.
    default:                  return "projects/" + GCP_PROJECT + "/locations/global/agents/" + slug;
  }
}

// ── people ──────────────────────────────────────────────────────────────────

const P = (displayName, upn, accountEnabled = true) => ({
  id: upn,
  displayName,
  userPrincipalName: upn,
  accountEnabled,
});

const OWNERS = {
  amara: P("Amara Okafor", "amara.okafor@halcyongroup.com"),
  dev: P("Devika Raman", "devika.raman@halcyongroup.com"),
  tom: P("Tomas Lindqvist", "tomas.lindqvist@halcyongroup.com"),
  yuki: P("Yuki Tanaka", "yuki.tanaka@halcyongroup.com"),
  marco: P("Marco Ferreira", "marco.ferreira@halcyongroup.com"),
  priya: P("Priya Nair", "priya.nair@halcyongroup.com"),
  sean: P("Sean Whitaker", "sean.whitaker@halcyongroup.com"),
  lena: P("Lena Hoffmann", "lena.hoffmann@halcyongroup.com"),
  // Left the company — their agents are still running. This is the story.
  gone1: P("Robert Ashby", "robert.ashby@halcyongroup.com", false),
  gone2: P("Claire Dumont", "claire.dumont@halcyongroup.com", false),
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
  // The five surfaces that actually hold AGENTS. Gemini inside Gmail / Docs /
  // Sheets / Slides / Meet / Drive is a feature of those apps, and a standalone
  // Gemini seat is a chat surface — neither is an agent, so neither belongs in
  // an agent inventory. Their prompt-level activity is the AI Hub's job.
  vertex_ai:         "Google",
  gemini_enterprise: "Google",
  gemini_gems:       "Google",
  google_chat:       "Google",
  apps_script:       "Google",
};

const C = (name, type) => ({ name, type });

const AGENT_SPECS = [
  // ── Vertex AI — reasoning engines and deployed agents ─────────────────────
  { name: "Territory Planner", platform: "vertex_ai", level: "high", owner: OWNERS.marco, age: 121, idle: 3,
    connectors: [C("BigQuery", "Managed"), C("Cloud Storage", "Managed")], permissions: [{ name: "bigquery.dataViewer", type: "IAM" }],
    consentType: "Principal", model: "gemini-2.5-pro", desc: "Reasoning engine allocating sales territories from BigQuery closed-won data." },
  { name: "Support Deflection Agent", platform: "vertex_ai", level: "medium", owner: OWNERS.amara, age: 84, idle: 2,
    connectors: [C("Vertex AI Search", "Managed")], permissions: [], consentType: "Principal",
    model: "gemini-2.5-flash", desc: "Answers tier-1 support questions from the help-centre data store." },
  { name: "Invoice Extraction Agent", platform: "vertex_ai", level: "high", owner: OWNERS.tom, age: 138, idle: 2,
    connectors: [C("Document AI", "Managed"), C("Cloud Functions: finance-api", "Function")],
    permissions: [{ name: "cloudfunctions.invoker", type: "IAM" }], consentType: "Principal", model: "gemini-2.5-pro",
    desc: "Pulls line items from supplier invoices and calls the finance API to reconcile them." },
  { name: "Claims Triage Engine", platform: "vertex_ai", level: "critical", owner: OWNERS.gone1, age: 268, idle: 44,
    connectors: [C("Cloud SQL", "Managed"), C("Cloud Storage", "Managed"), C("HTTP", "HTTP")],
    permissions: [{ name: "cloudsql.client", type: "IAM" }, { name: "storage.objectAdmin", type: "IAM" }],
    consentType: "AllPrincipals", model: "gemini-2.5-pro", desc: "Scores insurance claims against fraud heuristics. The owner has left the company." },
  { name: "Contract Review Engine", platform: "vertex_ai", level: "critical", owner: null, age: 412, idle: 96,
    connectors: [C("Google Drive", "Managed"), C("HTTP", "HTTP"), C("BigQuery", "Managed")],
    permissions: [{ name: "drive.readonly", type: "OAuth" }, { name: "bigquery.dataEditor", type: "IAM" }],
    consentType: "AllPrincipals", model: "gemini-2.5-pro", desc: "Reads master service agreements from the Legal shared drive and drafts redlines." },
  { name: "Field Dispatch Agent", platform: "vertex_ai", level: "high", owner: OWNERS.tom, age: 322, idle: 11,
    connectors: [C("Cloud SQL", "Managed"), C("HTTP", "HTTP"), C("Google Chat", "Managed")],
    permissions: [{ name: "cloudsql.client", type: "IAM" }], consentType: "AllPrincipals", model: "gemini-2.5-flash",
    desc: "Assigns engineers to open work orders and posts the schedule to a Chat space." },
  { name: "Churn Scoring Agent", platform: "vertex_ai", level: "medium", owner: OWNERS.amara, age: 224, idle: 21,
    connectors: [C("BigQuery", "Managed")], permissions: [{ name: "bigquery.jobUser", type: "IAM" }],
    consentType: "Principal", model: "gemini-2.5-flash-lite", desc: "Scores churn probability nightly and writes results back to BigQuery." },
  { name: "Procurement Policy Agent", platform: "vertex_ai", level: "low", owner: OWNERS.lena, age: 97, idle: 6,
    connectors: [C("Vertex AI Search", "Managed")], permissions: [], consentType: "Principal",
    model: "gemini-2.5-flash", desc: "Answers purchase-approval threshold questions from the finance policy corpus." },

  // ── Gemini Enterprise (Agentspace) and NotebookLM Enterprise ─────────────
  { name: "Enterprise Knowledge Agent", platform: "gemini_enterprise", level: "high", owner: OWNERS.priya, age: 76, idle: 1,
    connectors: [C("Google Drive", "Managed"), C("Confluence", "Third-party")], permissions: [{ name: "discoveryengine.viewer", type: "IAM" }],
    consentType: "AllPrincipals", desc: "Company-wide search agent indexing shared Drive and Confluence." },
  { name: "Policy Lookup Agent", platform: "gemini_enterprise", level: "medium", owner: OWNERS.lena, age: 52, idle: 6,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "Principal",
    desc: "Answers HR and finance policy questions from the policy corpus." },
  { name: "Onboarding FAQ Notebook", platform: "gemini_enterprise", level: "medium", owner: OWNERS.priya, age: 61, idle: 3,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "AllPrincipals",
    desc: "NotebookLM Enterprise notebook answering new-joiner questions from HR sources." },
  { name: "Bid Library Agent", platform: "gemini_enterprise", level: "high", owner: OWNERS.gone2, age: 301, idle: null,
    connectors: [C("Google Drive", "Managed"), C("HTTP", "HTTP")], permissions: [{ name: "discoveryengine.editor", type: "IAM" }],
    consentType: "AllPrincipals", desc: "Indexes the historic bid library. Never used since creation, and the owner is disabled." },
  { name: "Benefits Explainer Agent", platform: "gemini_enterprise", level: "high", owner: OWNERS.priya, age: 233, idle: 38,
    connectors: [C("Google Drive", "Managed"), C("HTTP", "HTTP")], permissions: [{ name: "discoveryengine.viewer", type: "IAM" }],
    consentType: "AllPrincipals", desc: "Explains health and pension elections; reads the benefits document library." },
  { name: "Board Pack Notebook", platform: "gemini_enterprise", level: "critical", owner: null, age: 188, idle: 54,
    connectors: [C("Google Drive", "Managed")], permissions: [{ name: "discoveryengine.viewer", type: "IAM" }],
    consentType: "AllPrincipals", desc: "NotebookLM notebook over executive board packs. Shared domain-wide with no owner." },

  // ── Gemini Gems — user-built assistants with their own instructions ──────
  { name: "Brand Voice Gem", platform: "gemini_gems", level: "low", owner: OWNERS.lena, age: 43, idle: 1,
    connectors: [], permissions: [], consentType: "Principal", desc: "Shared Gem enforcing tone-of-voice rules for marketing copy." },
  { name: "RFP Answer Gem", platform: "gemini_gems", level: "medium", owner: OWNERS.sean, age: 59, idle: 8,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "Principal",
    desc: "Drafts RFP responses from the bid library on shared Drive." },
  { name: "Market Digest Gem", platform: "gemini_gems", level: "medium", owner: OWNERS.marco, age: 95, idle: 4,
    connectors: [C("Google Drive", "Managed")], permissions: [], consentType: "Principal",
    desc: "Summarises analyst reports into a weekly digest." },
  { name: "Code Review Gem", platform: "gemini_gems", level: "high", owner: OWNERS.dev, age: 88, idle: 12,
    connectors: [C("HTTP", "HTTP")], permissions: [], consentType: "AllPrincipals",
    desc: "Shared across the domain; posts review comments to an external code host." },
  { name: "Deal Desk Gem", platform: "gemini_gems", level: "medium", owner: OWNERS.marco, age: 64, idle: 1,
    connectors: [C("Google Sheets", "Managed")], permissions: [], consentType: "Principal",
    desc: "Summarises open opportunities and discount positions before pipeline review." },
  { name: "Payroll Query Gem", platform: "gemini_gems", level: "critical", owner: OWNERS.gone2, age: 501, idle: null,
    connectors: [C("Google Sheets", "Managed"), C("HTTP", "HTTP")], permissions: [], consentType: "AllPrincipals",
    desc: "Answers payslip and tax-code questions against an exported payroll sheet. Owner disabled, never used." },

  // ── Google Chat bots ─────────────────────────────────────────────────────
  { name: "Release Notes Chat Bot", platform: "google_chat", level: "medium", owner: OWNERS.dev, age: 167, idle: 14,
    connectors: [C("Google Chat", "Managed")], permissions: [{ name: "chat.bot", type: "Application" }],
    consentType: "AllPrincipals", desc: "Posts AI-written release notes to the engineering space." },
  { name: "Support Deflection Chat Bot", platform: "google_chat", level: "high", owner: null, age: 254, idle: 63,
    connectors: [C("Google Chat", "Managed"), C("HTTP", "HTTP")], permissions: [{ name: "chat.bot", type: "Application" }],
    consentType: "AllPrincipals", desc: "Answers customer questions in a shared space. No current owner." },
  { name: "IT Helpdesk Chat Bot", platform: "google_chat", level: "medium", owner: OWNERS.sean, age: 176, idle: 1,
    connectors: [C("Google Chat", "Managed"), C("ServiceNow", "Third-party")], permissions: [{ name: "chat.bot", type: "Application" }],
    consentType: "AllPrincipals", desc: "First-line IT support bot published to the whole domain." },
  { name: "Standup Poller Bot", platform: "google_chat", level: "low", owner: OWNERS.dev, age: 205, idle: 5,
    connectors: [C("Google Chat", "Managed")], permissions: [{ name: "chat.bot", type: "Application" }],
    consentType: "Principal", desc: "Collects written standups and summarises blockers." },
  { name: "Vendor Intake Bot", platform: "google_chat", level: "high", owner: null, age: 366, idle: 71,
    connectors: [C("Google Chat", "Managed"), C("HTTP", "HTTP"), C("Gmail", "Managed")],
    permissions: [{ name: "chat.bot", type: "Application" }, { name: "gmail.send", type: "OAuth" }],
    consentType: "AllPrincipals", desc: "Collects supplier onboarding forms and mails them onward. No current owner." },

  // ── Apps Script automations calling Gemini ───────────────────────────────
  { name: "Expense Reconciler Script", platform: "apps_script", level: "high", owner: OWNERS.gone1, age: 289, idle: null,
    connectors: [C("Gmail", "Managed"), C("Google Sheets", "Managed")], permissions: [{ name: "gmail.readonly", type: "OAuth" }],
    consentType: "Principal", desc: "Bound script reconciling receipts against policy. The owner has left and it is still authorised." },
  { name: "Timesheet Summariser Script", platform: "apps_script", level: "medium", owner: OWNERS.yuki, age: 118, idle: 5,
    connectors: [C("Google Sheets", "Managed")], permissions: [{ name: "spreadsheets", type: "OAuth" }],
    consentType: "Principal", desc: "Summarises weekly timesheets into a management sheet." },
  { name: "Meeting Recap Script", platform: "apps_script", level: "medium", owner: OWNERS.yuki, age: 83, idle: 1,
    connectors: [C("Google Meet", "Managed"), C("Google Drive", "Managed")], permissions: [{ name: "drive.file", type: "OAuth" }],
    consentType: "AllPrincipals", desc: "Writes an AI recap to Drive after every recorded meeting." },
  { name: "Contract Renewal Watcher", platform: "apps_script", level: "critical", owner: OWNERS.gone1, age: 341, idle: 118,
    connectors: [C("Google Sheets", "Managed"), C("Gmail", "Managed"), C("HTTP", "HTTP")],
    permissions: [{ name: "gmail.send", type: "OAuth" }, { name: "spreadsheets", type: "OAuth" }],
    consentType: "AllPrincipals", desc: "Mails renewal reminders from a contracts sheet. Orphaned, dormant, still able to send mail." },

  // NOTE: Gemini inside Gmail, Docs, Sheets, Slides, Meet and Drive is
  // deliberately absent, and so are standalone Gemini seats. Those are Gemini
  // FEATURES in an app and a licensed chat surface — not agents. Agent
  // Governance inventories agents: reasoning engines, Agentspace and NotebookLM
  // agents, Gems, Chat bots and Apps Script automations. Prompt-level activity
  // on the Workspace surfaces belongs in the AI Hub's Activity screens.
  //
  // No Microsoft, OpenAI, Claude or AWS agents either — see AG_DEMO_KEYS.
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

  const isGoogle = vendor === "Google";
  // Google resources are path-addressed; Microsoft ones are GUIDs. Both are
  // registered as fabricated so a write against them can never leave the
  // browser — see FABRICATED_IDS.
  const agentId = fab(isGoogle ? googleResourceId(spec.platform, spec.name) : guid("agent:" + spec.name));
  const appId = fab(isGoogle ? agentId : guid("app:" + spec.name));

  return {
    id: agentId,
    appId,
    botId: spec.platform === "copilot_studio" ? appId : undefined,
    name: spec.name,
    description: spec.desc,
    vendor,
    category: "generative-ai",
    platform: spec.platform,
    discoverySource: DISCOVERY_SOURCE[spec.platform] || "graph_beta",
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
    environmentName: spec.platform === "copilot_studio" ? "Halcyon (default)" : undefined,
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
      id: guid("tenant"),
      name: "Halcyon Group",
      domain: GCP_ORG,
      license: "Google Workspace Enterprise Plus + Gemini",
    },
    agents: AG_DEMO_AGENTS,
    totalServicePrincipals: 412,
    totalUsers: 1284,
    totalEnvironments: 4,
    scanTimestamp: hoursAgo(1),
    scanDuration: 42718,
    warnings: [
      "Gemini Enterprise agent discovery uses a preview Discovery Engine endpoint — coverage may vary by project.",
      "Admin SDK activity reporting lags by up to 48 hours, so today's usage may be understated.",
    ],
  };
}

// ── conversations (User Activity → AI Safety) ───────────────────────────────
//
// Deliberately includes prompts that trip the sensitive-data classifier, so the
// AI Safety sub-tab lights up with PII / financial / secret findings.

const CONVERSATION_SEEDS = [
  { agent: "Support Deflection Agent", user: OWNERS.amara, source: "audit_log", turns: [
    ["Refund request on account HG-CUST-4471GK — the customer says the annual plan was double charged on card 4539 1488 0343 6467. Draft the reply.",
     "Two charges of $4,800 landed for the same period. Policy 4.2 allows a full refund inside 30 days, so I have drafted the refund note and the customer email for your approval."],
    ["Also confirm the billing contact — their national ID on file is 402-55-1189, is that the right record?",
     "I do not need an identity number to look that up. Matching on the account id alone, the billing contact is the same person as the primary admin."],
  ]},
  { agent: "Payroll Query Gem", user: OWNERS.priya, source: "audit_log", turns: [
    ["An employee is asking why their March payslip differs. Their national insurance number is JT 60 21 44 C and the payroll id is 88213.",
     "The March run applied a backdated tax-code change. Gross was unchanged; net fell by £212.40 because the code moved from 1257L to 1103L."],
  ]},
  { agent: "Contract Review Engine", user: OWNERS.lena, source: "graph_copilot", turns: [
    ["Summarise the liability cap in the Meridian master agreement and flag anything unusual.",
     "The cap is 12 months of fees, but clause 14.3 carves out data-breach liability entirely. That is unusual and materially worse than your standard position."],
    ["Draft a redline that puts breach liability back under the cap.",
     "Drafted. I have inserted a proviso in 14.3 subjecting breach liability to the general cap, with a 2x multiplier as a fallback position."],
  ]},
  { agent: "IT Helpdesk Chat Bot", user: OWNERS.sean, source: "teams_chat", turns: [
    ["I need to rotate the staging API token. The current one is AIzaSyD8Qd2mF7xKpLvR3nTzYwB4jHcK1pQ2s for reference.",
     "Please do not paste live keys into chat — that value is now in this conversation's history. Rotate it in the Cloud console and I will walk you through updating the Secret Manager entry."],
    ["Fair. How do I update the secret?",
     "Secret Manager, add a new version to staging-gemini-key, then redeploy the service so it picks up the latest version. No code change needed."],
  ]},
  { agent: "Benefits Explainer Agent", user: OWNERS.yuki, source: "audit_log", turns: [
    ["An employee is asking whether their pre-existing cardiac condition is covered under the new plan, and whether their diabetes medication is on the formulary.",
     "Both are covered from day one under the 2026 plan — there is no pre-existing exclusion. The specific medication is tier 2, so a £12 copay applies."],
  ]},
  { agent: "Territory Planner", user: OWNERS.marco, source: "audit_log", turns: [
    ["Rebalance the EMEA territories for next quarter using the closed-won data.",
     "Rebalanced across six reps. Two territories were more than 30% above the median account load, so I moved 14 accounts and flagged the two that carry a named strategic customer for you to confirm."],
  ]},
  { agent: "Field Dispatch Agent", user: OWNERS.tom, source: "audit_log", turns: [
    ["Who is nearest to work order WO-88213 and what is the SLA?",
     "Marcus is 14 minutes away and free from 14:30. The SLA on that order expires at 17:00 today, so it fits."],
  ]},
  { agent: "Enterprise Knowledge Agent", user: OWNERS.priya, source: "graph_copilot", turns: [
    ["What is our parental leave entitlement in Germany, and where is it documented?",
     "Fourteen weeks at full pay plus the statutory Elternzeit. The source is the DE addendum to the employee handbook on shared Drive, last revised in January."],
    ["Does that differ for someone on a fixed-term contract?",
     "The entitlement is the same; only the notice window differs. The addendum covers it in section 4.2."],
  ]},
  { agent: "Invoice Extraction Agent", user: OWNERS.tom, source: "audit_log", turns: [
    ["Pull the line items off the Meridian invoice batch and check them against the purchase order.",
     "Eleven of twelve match. Invoice 0412-7 bills 14 licences against a PO for 12 — a £1,340 overage. I have flagged it rather than passing it through."],
  ]},
  { agent: "Meeting Recap Script", user: OWNERS.marco, source: "audit_log", turns: [
    ["Summarise the call with the Meridian buying committee and list the actions.",
     "Four actions. Security review pack to their CISO by Friday, revised pricing at three years, a reference call with a similar customer, and a follow-up once their budget cycle reopens in April."],
  ]},
  { agent: "Release Notes Chat Bot", user: OWNERS.dev, source: "teams_chat", turns: [
    ["Post the release notes for 4.18 to the engineering space.",
     "Posted. I summarised 23 merged changes into six user-facing items and listed the two breaking API changes separately at the top."],
  ]},
  { agent: "Board Pack Notebook", user: OWNERS.lena, source: "graph_copilot", turns: [
    ["Summarise the revenue section of last quarter's board pack.",
     "Revenue closed 4% above plan, driven by renewals. New business came in 9% under plan and the deck attributes that to a longer security-review cycle."],
  ]},
  { agent: "RFP Answer Gem", user: OWNERS.sean, source: "audit_log", turns: [
    ["Draft the security section of the Meridian RFP response from the bid library.",
     "Drafted from the three most recent responses. Two answers are stale — the SOC 2 report date and the sub-processor list — so I have marked those for you to refresh rather than reusing them."],
  ]},
  { agent: "Expense Reconciler Script", user: OWNERS.yuki, source: "audit_log", turns: [
    ["Why did the reconciler flag my March expenses?",
     "Two receipts exceeded the per-meal cap and one had no attached receipt at all. The script flagged rather than rejected them, so they are waiting on your manager."],
  ]},
  { agent: "Code Review Gem", user: OWNERS.dev, source: "teams_chat", turns: [
    ["Review the pending change to the auth middleware.",
     "One substantive finding: the new branch skips the token-expiry check when a refresh header is present, which would accept an expired token. The rest is style."],
  ]},
  { agent: "Procurement Policy Agent", user: OWNERS.lena, source: "audit_log", turns: [
    ["What is the approval threshold for a three-year software commit above £250k?",
     "Above £250k at three years needs the CFO plus a security review. The playbook allows 18% discount at that term, rising to 22% with quarterly prepayment."],
  ]},
];



function buildChats() {
  return CONVERSATION_SEEDS.map((seed, i) => {
    const rand = rngFor(seed.agent + i);
    const start = NOW - between(rand, 2, 160) * 3600000;
    const messages = [];
    seed.turns.forEach((pair, t) => {
      messages.push({
        id: `msg_${i}-${t}-u`,
        from: "user",
        fromName: seed.user.displayName,
        timestamp: iso(start + t * 240000),
        text: pair[0],
      });
      messages.push({
        id: `msg_${i}-${t}-b`,
        from: "bot",
        fromName: seed.agent,
        timestamp: iso(start + t * 240000 + 45000),
        text: pair[1],
      });
    });
    return {
      id: `cnv_${i}`,
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
  ["Meridian_MSA_2026_redline.gdoc", "/Drive/Legal/Contracts", OWNERS.lena, "FileModified", "Drive", ["Contract Review Engine"]],
  ["Q1_payroll_export.gsheet", "/Drive/Finance/Payroll", OWNERS.tom, "FileDownloaded", "Drive", ["Payroll Query Gem"]],
  ["customer_refunds_march.csv", "/Drive/Support/Billing", OWNERS.amara, "FileUploaded", "Drive", ["Support Deflection Agent"]],
  ["benefits_formulary_2026.pdf", "/Drive/HR/Benefits", OWNERS.priya, "FilePreviewed", "Drive", ["Benefits Explainer Agent", "Onboarding FAQ Notebook"]],
  ["emea_territories_q2.gsheet", "/Drive/Sales/Territories", OWNERS.marco, "FileModified", "Drive", ["Territory Planner"]],
  ["field_service_rota.gsheet", "/Drive/Operations/Dispatch", OWNERS.tom, "FileModified", "Drive", ["Field Dispatch Agent"]],
  ["db_failover_runbook.gdoc", "/Drive/Engineering/Runbooks", OWNERS.dev, "FileAccessed", "Drive", ["Code Review Gem"]],
  ["supplier_bank_details.gsheet", "/Drive/Finance/AP", OWNERS.lena, "FileDownloaded", "Drive", ["Vendor Intake Bot"]],
  ["pen_test_findings_q1.pdf", "/Drive/Security/Reports", OWNERS.sean, "FileUploaded", "Drive", []],
  ["meridian_invoice_batch.pdf", "/Drive/Finance/AP", OWNERS.tom, "FileUploaded", "Drive", ["Invoice Extraction Agent"]],
  ["help_centre_export.csv", "/Drive/Support/Knowledge", OWNERS.amara, "FileDownloaded", "Drive", ["Support Deflection Agent"]],
  ["de_handbook_addendum.pdf", "/Drive/HR/Handbook", OWNERS.priya, "FilePreviewed", "Drive", ["Enterprise Knowledge Agent", "Policy Lookup Agent"]],
  ["bid_library_index.gsheet", "/Drive/Sales/Bids", OWNERS.sean, "FileAccessed", "Drive", ["RFP Answer Gem", "Bid Library Agent"]],
  ["board_pack_q1.gslides", "/Drive/Executive/Board", OWNERS.lena, "FilePreviewed", "Drive", ["Board Pack Notebook"]],
  ["all_hands_transcript.gdoc", "/Drive/Company/Meetings", OWNERS.yuki, "FileUploaded", "Drive", ["Meeting Recap Script"]],
  ["claims_features_q1.csv", "/Drive/Data/Claims", OWNERS.amara, "FileAccessed", "Drive", ["Claims Triage Engine"]],
  ["release_notes_draft.gdoc", "/Drive/Engineering/Releases", OWNERS.dev, "FileModified", "Drive", ["Release Notes Chat Bot"]],
  ["timesheets_wk12.gsheet", "/Drive/Operations/Timesheets", OWNERS.yuki, "FileModified", "Drive", ["Timesheet Summariser Script"]],
  ["contract_renewals_2026.gsheet", "/Drive/Legal/Renewals", OWNERS.lena, "FileAccessed", "Drive", ["Contract Renewal Watcher"]],
  ["churn_features_q1.csv", "/Drive/Data/Churn", OWNERS.amara, "FileAccessed", "Drive", ["Churn Scoring Agent"]],
  ["procurement_thresholds.gdoc", "/Drive/Finance/Policies", OWNERS.lena, "FilePreviewed", "Drive", ["Procurement Policy Agent"]],
  ["standup_notes_wk12.gdoc", "/Drive/Engineering/Standups", OWNERS.dev, "FileModified", "Drive", ["Standup Poller Bot"]],
];



const AG_DEMO_FILES = FILE_SEEDS.map(([fileName, filePath, user, operation, workload, relatedAgents], i) => {
  const rand = rngFor(fileName);
  return {
    id: `evt_${i}`,
    fileName,
    filePath,
    userName: user.displayName,
    userId: user.userPrincipalName,
    operation,
    workload,
    relatedAgents,
    siteUrl: `https://halcyongroup.sharepoint.com${filePath.split("/Shared Documents")[0]}`,
    timestamp: iso(NOW - between(rand, 1, 220) * 3600000),
  };
});

// ── knowledge sources (User Activity → Knowledge & Files) ───────────────────

const KNOWLEDGE_SEEDS = {
  "Contract Review Engine": [
    { name: "Legal — Contracts (shared Drive)", type: "connector", url: "https://drive.google.com/drive/folders/legal-contracts", metadata: { auth: "Service account", scope: "read", files: 1284 } },
    { name: "Standard clause bank", type: "knowledge_article", metadata: { articles: 96 } },
    { name: "BigQuery — contract_terms", type: "azure_storage", metadata: { rows: 4120, dataset: "legal_analytics" } },
  ],
  "Enterprise Knowledge Agent": [
    { name: "Google Drive — company-wide", type: "connector", metadata: { auth: "Service account", scope: "read", files: 41208 } },
    { name: "Confluence (external)", type: "connector", metadata: { auth: "API token", scope: "read", spaces: 18 } },
    { name: "hr-finance-policies (data store)", type: "knowledge_article", metadata: { articles: 312 } },
  ],
  "Policy Lookup Agent": [
    { name: "Drive — HR & Finance policies", type: "connector", metadata: { auth: "Service account", scope: "read", files: 486 } },
  ],
  "Territory Planner": [
    { name: "BigQuery — closed_won_opportunities", type: "azure_storage", metadata: { rows: "≈184,000", dataset: "sales_analytics" } },
    { name: "Cloud Storage — territory-exports", type: "azure_storage", metadata: { bucket: "hg-territory", files: 240 } },
  ],
  "Support Deflection Agent": [
    { name: "help-centre-articles (data store)", type: "knowledge_article", metadata: { articles: 1043 } },
    { name: "support.halcyongroup.com", type: "website", url: "https://support.halcyongroup.com", metadata: { crawled: "daily" } },
  ],
  "Invoice Extraction Agent": [
    { name: "Document AI — invoice parser", type: "connector", metadata: { processor: "invoice-parser-v2" } },
    { name: "Drive — Finance/AP", type: "connector", metadata: { auth: "Service account", scope: "read", files: 2914 } },
  ],
  "Claims Triage Engine": [
    { name: "Cloud SQL — claims", type: "azure_storage", metadata: { rows: "≈96,000", classification: "confidential" } },
    { name: "Cloud Storage — claim-packs", type: "azure_storage", metadata: { bucket: "hg-claims", files: 18420 } },
  ],
  "Onboarding FAQ Notebook": [
    { name: "Drive — HR/Onboarding", type: "connector", metadata: { auth: "User OAuth", scope: "read", files: 64 } },
    { name: "IT setup guides", type: "knowledge_article", metadata: { articles: 41 } },
  ],
  "Bid Library Agent": [
    { name: "Drive — bid library", type: "connector", metadata: { auth: "Service account", scope: "read", files: 176 } },
  ],
  "RFP Answer Gem": [
    { name: "Drive — bid library", type: "connector", metadata: { auth: "User OAuth", scope: "read", files: 176 } },
  ],
  "Board Pack Notebook": [
    { name: "Drive — Executive/Board", type: "connector", metadata: { auth: "User OAuth", scope: "read", files: 312, classification: "restricted" } },
  ],
  "Benefits Explainer Agent": [
    { name: "Drive — HR/Benefits", type: "connector", metadata: { auth: "Service account", scope: "read", files: 78 } },
    { name: "formulary.hpn-benefits.com", type: "website", url: "https://formulary.hpn-benefits.com", metadata: { crawled: "weekly" } },
  ],
  "Payroll Query Gem": [
    { name: "Drive — Finance/Payroll (export)", type: "connector", metadata: { auth: "User OAuth", scope: "read", files: 12, classification: "confidential" } },
  ],
  "Field Dispatch Agent": [
    { name: "Cloud SQL — work_orders", type: "azure_storage", metadata: { rows: 22841 } },
    { name: "dispatch-api.halcyongroup.com", type: "connector", metadata: { auth: "OIDC", scope: "read/write" } },
  ],
  "Contract Renewal Watcher": [
    { name: "Drive — Legal/Renewals", type: "connector", metadata: { auth: "User OAuth", scope: "read", files: 204 } },
  ],
};



const AG_DEMO_KNOWLEDGE_BOTS = Object.entries(KNOWLEDGE_SEEDS).map(([botName, sources]) => {
  const agent = AG_DEMO_AGENTS.find((a) => a.name === botName);
  return {
    botId: agent ? agent.id : `bot_${botName}`,
    botName,
    schemaName: botName.replace(/\s+/g, "_").toLowerCase(),
    sources: sources.map((s, i) => ({ id: `${botName}-src-${i}`, addedOn: daysAgo(30 + i * 11), ...s })),
  };
});

// ── Google / Vertex AI cost (Cost tab) ──────────────────────────────────────
//
// Shape verified against the GET /cost/google handler in
// server/src/governance/routes/cost.ts. CostTab reads costData.endpoints and
// costData.summary, and its free-tier maths keys off ep.modelName containing
// "flash", so the model names here matter as much as the numbers.
//
// CostTab now takes this path rather than the Azure one, because it picks its
// vendor from the first credential present and the Microsoft key is null.
const ENDPOINT_SEEDS = [
  ["territory-planner",     "gemini-2.5-pro",        18_420_000,  4_210_000,  1.25,  10.0,  24_180],
  ["support-deflection",    "gemini-2.5-flash",      41_900_000,  9_640_000,  0.30,   2.50, 61_402],
  ["invoice-extraction",    "gemini-2.5-pro",         7_860_000,  1_940_000,  1.25,  10.0,  11_204],
  ["claims-triage",         "gemini-2.5-pro",         2_140_000,  1_080_000,  1.25,  10.0,   3_118],
  ["knowledge-embeddings",  "text-embedding-004",    88_200_000,          0,  0.025,  0.0, 142_800],
  ["contract-review",       "gemini-2.5-flash-lite",  5_120_000,  1_460_000,  0.10,   0.40,  9_640],
];

// TWO WIRE FORMATS, and getting this wrong makes the period picker look broken
// rather than throw: the Azure endpoint takes an ISO-8601 duration ("P30D"),
// but fetchGoogleCost sends a BARE DAY COUNT ("30"). Parsing only the first
// form silently defaulted every window to 7 days, so switching 7d → 90d left
// the totals identical.
const PERIOD_DAYS = { P1D: 1, P7D: 7, P30D: 30, P90D: 90 };
function periodToDays(p) {
  const raw = String(p ?? "").trim();
  if (!raw) return 7;
  const iso = PERIOD_DAYS[raw.toUpperCase()];
  if (iso) return iso;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function buildGoogleCost(periodDays) {
  const scale = periodDays / 30;
  const endpoints = ENDPOINT_SEEDS.map(([name, modelName, inTok, outTok, inRate, outRate, reqs]) => {
    const inputTokens = Math.round(inTok * scale);
    const outputTokens = Math.round(outTok * scale);
    const inputCost = (inputTokens / 1_000_000) * inRate;
    const outputCost = (outputTokens / 1_000_000) * outRate;
    return {
      endpointId: "projects/" + GCP_PROJECT + "/locations/europe-west4/endpoints/" + name,
      displayName: name,
      modelName,
      vendor: "Google",
      platform: "vertex_ai",
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      requestCount: Math.round(reqs * scale),
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      costEstimated: false,
      tokensUnavailable: false,
    };
  });
  const sum = (f) => endpoints.reduce((t, e) => t + (e[f] || 0), 0);
  return {
    vendor: "Google",
    period: "P" + periodDays + "D",
    projectId: GCP_PROJECT,
    endpoints,
    summary: {
      totalInputTokens: sum("inputTokens"),
      totalOutputTokens: sum("outputTokens"),
      totalTokens: sum("totalTokens"),
      totalPredictions: sum("requestCount"),
      totalCost: Math.round(sum("totalCost") * 10000) / 10000,
      endpointsWithUnknownCost: 0,
      requestsWithUnknownCost: 0,
    },
    fetchedAt: iso(NOW),
  };
}

// ── policies & compliance packs (Policies tab) ──────────────────────────────

// Field set verified against the GET /policy-packs handler in
// server/src/governance/routes/policyPacks.ts. PackRow reads ruleCount,
// enforceable, monitored and attestations off each row; the modal reads the
// ENVELOPE as `packs.packs`, so this list is wrapped rather than returned bare
// — a bare array leaves the modal showing "No policy packs available."
const AG_DEMO_PACKS = [
  { id: "gdpr",        framework: "GDPR",          name: "EU General Data Protection Regulation",       deployed: true,  ruleCount: 18, enforceable: 7, monitored: 6, attestations: 5 },
  { id: "hipaa",       framework: "HIPAA",         name: "US Health Insurance Portability and Accountability Act", deployed: false, ruleCount: 17, enforceable: 6, monitored: 6, attestations: 5 },
  { id: "soc2",        framework: "SOC 2",         name: "SOC 2 Trust Services Criteria",               deployed: false, ruleCount: 16, enforceable: 7, monitored: 5, attestations: 4 },
  { id: "ccpa",        framework: "CCPA/CPRA",     name: "California Consumer Privacy Act (as amended by CPRA)",    deployed: false, ruleCount: 13, enforceable: 5, monitored: 4, attestations: 4 },
  { id: "eu-ai-act",   framework: "EU AI Act",     name: "EU Artificial Intelligence Act (Reg. 2024/1689)",         deployed: false, ruleCount: 16, enforceable: 5, monitored: 5, attestations: 6 },
  { id: "iso-42001",   framework: "ISO/IEC 42001", name: "ISO/IEC 42001 AI Management System",          deployed: false, ruleCount: 15, enforceable: 5, monitored: 5, attestations: 5 },
  { id: "nist-ai-rmf", framework: "NIST AI RMF",   name: "NIST AI Risk Management Framework 1.0 (AI 100-1)",        deployed: false, ruleCount: 15, enforceable: 5, monitored: 5, attestations: 5 },
].map((p) => ({
  ...p,
  description: `${p.ruleCount} rules mapped to ${p.framework} clauses — ${p.enforceable} enforced automatically, ${p.monitored} dependent on endpoint detection, ${p.attestations} tracked as attestations.`,
  version: 1,
  deployed_version: p.deployed ? 1 : null,
  deployed_at: p.deployed ? daysAgo(41) : null,
  update_available: false,
  enabled_rules: p.deployed ? p.ruleCount : 0,
  attested: p.deployed ? 2 : 0,
}));

const COND = (field, operator, value) => ({ field, operator, value });

const AG_DEMO_POLICIES = [
  // Custom policies an admin wrote.
  { id: "pol_1", name: "Escalate orphaned agents", type: "lifecycle", status: "active", severity: "critical",
    description: "Any agent whose owner no longer has an active account is escalated to the AI governance group.",
    conditions: [COND("is_orphaned", "is_true", "true")], actions: [{ type: "escalate" }, { type: "notify" }],
    scope: { type: "all agents" }, created_at: daysAgo(96) },
  { id: "pol_2", name: "Flag organisation-wide consent", type: "access", status: "active", severity: "high",
    description: "Agents consented for every user in the tenant are flagged for review.",
    conditions: [COND("consent_type", "equals", "AllPrincipals")], actions: [{ type: "flag" }],
    scope: { type: "all agents" }, created_at: daysAgo(88) },
  { id: "pol_3", name: "Dormant but privileged (90 days)", type: "lifecycle", status: "active", severity: "high",
    description: "Agents with no activity for 90 days that still hold application permissions.",
    conditions: [COND("days_since_last_activity", "greater_than", "90"), COND("permission_count", "greater_than", "0")],
    actions: [{ type: "flag" }, { type: "notify" }], scope: { type: "all agents" }, created_at: daysAgo(71) },
  { id: "pol_4", name: "External HTTP connector review", type: "data", status: "active", severity: "high",
    description: "Any agent holding a connector that can reach outside the tenant.",
    conditions: [COND("has_http_connector", "is_true", "true")], actions: [{ type: "flag" }],
    scope: { type: "all agents" }, created_at: daysAgo(64) },
  { id: "pol_5", name: "Suspend critical unreviewed agents", type: "lifecycle", status: "draft", severity: "critical",
    description: "Draft — would suspend any agent scoring above 85 that has never been recertified.",
    conditions: [COND("risk_score", "greater_than", "85")], actions: [{ type: "suspend" }],
    scope: { type: "all agents" }, created_at: daysAgo(12) },

  // Policies created by deploying the GDPR pack.
  { id: "pol_gdpr_1", pack_id: "gdpr", name: "[GDPR] Art. 5(1)(c) — data minimisation in agent scope", type: "data",
    status: "active", severity: "high", description: "Agents must not hold broader data access than their stated purpose requires.",
    conditions: [COND("has_dangerous_permissions", "is_true", "true")], actions: [{ type: "flag" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "pol_gdpr_2", pack_id: "gdpr", name: "[GDPR] Art. 5(2) — accountability: named owner required", type: "lifecycle",
    status: "active", severity: "critical", description: "Every processing activity needs an accountable owner.",
    conditions: [COND("is_orphaned", "is_true", "true")], actions: [{ type: "escalate" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "pol_gdpr_3", pack_id: "gdpr", name: "[GDPR] Art. 28 — processor due diligence on third-party agents", type: "access",
    status: "active", severity: "high", description: "Third-party AI apps consented org-wide require a processor agreement on file.",
    conditions: [COND("consent_type", "equals", "AllPrincipals")], actions: [{ type: "flag" }, { type: "notify" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "pol_gdpr_4", pack_id: "gdpr", name: "[GDPR] Art. 30 — records of processing kept current", type: "lifecycle",
    status: "active", severity: "medium", description: "Agents unreviewed for more than 12 months fall out of the ROPA.",
    conditions: [COND("days_since_last_activity", "greater_than", "365")], actions: [{ type: "flag" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "pol_gdpr_5", pack_id: "gdpr", name: "[GDPR] Art. 32 — security of processing: connector review", type: "data",
    status: "active", severity: "high", description: "External connectors must be assessed before an agent processes personal data.",
    conditions: [COND("has_http_connector", "is_true", "true")], actions: [{ type: "flag" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "pol_gdpr_6", pack_id: "gdpr", name: "[GDPR] Art. 35 — DPIA trigger on high-risk agents", type: "compliance",
    status: "active", severity: "high", description: "Agents scoring high or critical require a documented DPIA.",
    conditions: [COND("risk_level", "equals", "critical")], actions: [{ type: "flag" }, { type: "notify" }], scope: { type: "all agents" }, created_at: daysAgo(41) },
  { id: "pol_gdpr_7", pack_id: "gdpr", name: "[GDPR] Art. 44 — transfers outside the EEA", type: "data",
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
      id: "vio_" + i,
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

/**
 * Dry-run result for a single policy or a whole pack.
 *
 * SHAPE IS LOAD-BEARING AND NOT FORGIVING. PoliciesTab does:
 *
 *   setSimResults(s => ({ ...s, [id]: { ...body.policies[0], ... } }))
 *
 * `body.policies[0]` is NOT optional-chained, and it sits inside a functional
 * state updater — React runs that updater while processing the update, outside
 * the handler's try/catch. So a missing `policies` array does not surface as an
 * error card; it throws during render and blanks the whole screen. Returning a
 * FLAT result here (would_flag/matches at the top level) is exactly that bug.
 *
 * Match rows are read as m.agent_name / m.already_open / m.condition_triggered,
 * and `actions` is an array of action-type STRINGS, not objects — the pack
 * aggregation does `(pol.actions || []).forEach(a => allActions.add(a))` and
 * renders the set directly.
 */
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

  // Evaluate each targeted policy against the agents its conditions describe,
  // so a pack simulation aggregates per-policy numbers the way the real engine
  // does rather than repeating one total.
  const matchesFor = (policy) => {
    const fields = (policy.conditions || []).map((c) => c.field);
    return AG_DEMO_AGENTS.filter((a) => {
      if (fields.includes("is_orphaned")) return a.isOrphaned;
      if (fields.includes("consent_type")) return a.consentType === "AllPrincipals";
      if (fields.includes("has_http_connector")) return (a.connectors || []).some((c) => c.type === "HTTP" || c.type === "Third-party");
      if (fields.includes("has_dangerous_permissions")) return (a.permissions || []).some((p) => /ReadWrite|\.Send|Directory\.Read/.test(p.name));
      if (fields.includes("risk_level")) return a.risk.level === "critical";
      if (fields.includes("risk_score")) return (a.risk.score || 0) > 85;
      if (fields.includes("days_since_last_activity")) {
        const last = a.activity.lastActiveTimestamp ? new Date(a.activity.lastActiveTimestamp).getTime() : null;
        return !last || (NOW - last) / 86400000 > 90;
      }
      return false;
    });
  };

  const policies = target.map((policy) => {
    const hit = matchesFor(policy);
    const alreadyOpen = hit.filter((a) => AG_DEMO_VIOLATIONS.some((v) => v.agent_id === a.id && v.status === "open")).length;
    return {
      policy_id: policy.id,
      policy_name: policy.name,
      status: "simulated",
      severity: policy.severity,
      would_flag: hit.length,
      already_open: alreadyOpen,
      newly_flagged: Math.max(0, hit.length - alreadyOpen),
      // Action-type strings, not objects.
      actions: (policy.actions || []).map((x) => x.type),
      matches: hit.slice(0, 12).map((a) => ({
        agent_id: a.id,
        agent_name: a.name,
        platform: a.platform,
        owner: a.owner ? a.owner.displayName : null,
        risk_level: a.risk.level,
        already_open: AG_DEMO_VIOLATIONS.some((v) => v.agent_id === a.id && v.status === "open"),
        condition_triggered: (policy.conditions || [])
          .map((c) => `${c.field} ${c.operator} ${c.value}`)
          .join(" AND ") || "policy conditions met",
      })),
    };
  });

  return {
    ok: true,
    status: "simulated",
    agents_evaluated: AG_DEMO_AGENTS.length,
    policies,
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
      id: "alr_" + i,
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

// ── secondary panels ───────────────────────────────────────────────────────
//
// Recertification, Prompt Monitor and Claude Budget are built in the codebase
// but are not in the six-tab strip, so their payload shapes have never been
// read off a live consumer and their endpoints return REJECT.
//
// Their sample datasets USED to live here, unused. They are deleted: they
// carried agent names from the Microsoft dataset, and although nothing
// rendered them, Rollup kept the module-level constants so those stale names
// shipped in the bundle. Dead data that still reaches the browser is worse
// than no data. Rebuild them from the real component shapes if those tabs
// ever get wired up.

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
    projectId: "halcyon-ai-prod",
    domain: "halcyongroup.com",
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
  if (has("/discovery/agents") && m === "POST") return { ok: true, persisted: 0, note: "not persisted" };
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

  // ── Microsoft surface: none ────────────────────────────────────────────────
  // There is no Microsoft credential in demo mode, so none of these panels
  // mount. They reject rather than return a shape nothing will read, which
  // also means an accidental call is visible instead of silently succeeding.
  if (has("/azure/") || has("/activity/azure/")) return REJECT;
  if (has("/activity/agent-permissions")) return REJECT;

  // ── activity ──────────────────────────────────────────────────────────────
  // The Dataverse and Graph activity endpoints. Unreachable without a Microsoft
  // credential — User Activity takes its Google branch instead, which is served
  // by /google/user-activity below.
  if (has("/activity/chats") || has("/activity/copilot-interactions")
      || has("/activity/m365-copilot-chats") || has("/activity/files")
      || has("/activity/knowledge") || has("/activity/teams/signins")) return REJECT;
  // Empty on purpose: the panel then falls back to the discovered agents, which
  // is the same list every other tab is showing.
  if (has("/activity/risk-summary")) return { agents: [] };

  // ── cost ──────────────────────────────────────────────────────────────────
  if (has("/cost/azure")) return REJECT;
  // CostTab follows this path now: it picks its vendor from the first
  // credential present, and only the Google ones are set.
  if (has("/cost/google")) return buildGoogleCost(periodToDays(q.get("period")));
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
  if (has("/openai/gpt")) return Object.assign({}, OK, { action: "deleted", note: "not applied" });
  if (has("/claude/project")) return Object.assign({}, OK, { action: "deleted", note: "not applied" });
  if (has("/claude/workspace/archive")) return Object.assign({}, OK, { action: "archived", note: "not applied" });

  // ── lifecycle ─────────────────────────────────────────────────────────────
  // READS PASS THROUGH to the real server. These are small, fast queries that
  // never needed a cloud connection, and the AI Hub's own Inventory screen
  // reads the same collections (its DLP-monitoring toggle is a flag on the
  // agent-keyed blocked_agents row). Serving them from here made that screen
  // report "nothing monitored" whatever the truth was. Real ids simply never
  // match a demo agent id, so demo rows still render as unblocked.
  if (has("/lifecycle/approval-statuses") || has("/lifecycle/lifecycle-statuses")
      || has("/lifecycle/blocked-agents")) return undefined;

  // WRITES are suppressed only for fabricated agents: such an id must never
  // reach the server — that would persist a blocked_agents row for an agent
  // that does not exist. Any other id is a REAL agent the admin is acting on
  // from the AI Hub, so it goes through and behaves normally with demo mode on.
  //
  // Membership test, NOT a string prefix. Ids used to start with "demo-", but
  // Agent Governance prints raw ids on screen (the Discovery detail panel and
  // the permissions table both do), so a marker in the id was visible to a
  // prospect. FABRICATED_IDS carries the same knowledge without leaking it.
  if (has("/lifecycle/")) {
    let id = "";
    try {
      const b = typeof body === "string" ? JSON.parse(body) : (body || {});
      id = String(b.agent_id || b.bot_id || b.app_id || b.id || "");
    } catch { /* unparseable body — treat as real and let it through */ }
    if (isFabricatedId(id)) return Object.assign({}, OK, { note: "not persisted" });
    return undefined;
  }

  // ── policies & packs ──────────────────────────────────────────────────────
  if (has("/policies/violations")) return AG_DEMO_VIOLATIONS;
  if (has("/policies/simulate")) return buildSimulation(body);
  if (has("/policies/evaluate")) return { violations: AG_DEMO_VIOLATIONS, evaluated: AG_DEMO_AGENTS.length };
  if (has("/policies/seed-templates")) return { success: true, created: 0, total: AG_DEMO_POLICIES.length };
  if (has("/policies")) {
    if (m === "GET") return AG_DEMO_POLICIES;
    return Object.assign({}, OK, { id: "pol_" + Date.now() });
  }
  if (has("/policy-packs")) {
    if (p.includes("/simulate")) return buildSimulation(body);
    // Envelope, not a bare array — the modal reads `packs.packs`.
    if (m === "GET") return { packs: AG_DEMO_PACKS, definition_problems: [] };
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
    return Object.assign({}, OK, { id: guid("key:connected") });
  }
  if (has("/health")) return { ok: true, status: "ok", version: "0.1.0" };

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
  if (p.startsWith("/api/v1/")) return null; // AI Hub API — cached, see below
  return p.slice(4);
}

/** "/api/v1/dlp?x=1" becomes "/dlp?x=1"; anything else returns null. */
function aiHubPath(input) {
  const p = pathOf(input);
  if (!p.startsWith("/api/v1/")) return null;
  return p.slice(7);
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

    // ── AI Hub (/api/v1) — cache-through, not fabricated ────────────────────
    // Replay a stored real response when we have one; otherwise let the request
    // run and keep it on the way back. Reads only: a demo must never replay a
    // write, and a non-200 must never become sticky.
    const hp = aiHubPath(input);
    if (hp) {
      const method2 =
        ((init && init.method) || (input && typeof input !== "string" && input.method) || "GET").toUpperCase();
      if (method2 === "GET" && isCacheable(hp)) {
        const hit = cacheGet(hp);
        if (hit !== null) {
          return Promise.resolve(
            new Response(hit, { status: 200, headers: { "Content-Type": "application/json" } })
          );
        }
        return realFetch(input, init).then((res) => {
          try {
            if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
              // clone() so the caller still gets an unread body.
              res.clone().text().then((txt) => cachePut(hp, txt)).catch(() => {});
            }
          } catch { /* caching is best-effort */ }
          return res;
        });
      }
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
