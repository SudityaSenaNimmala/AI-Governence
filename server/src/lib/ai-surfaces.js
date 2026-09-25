// WHERE on a governed page the extension is allowed to capture.
//
// THE BUG THIS EXISTS TO FIX. Governance scope was decided per HOST and then
// enforced across the whole PAGE. The registry marks mail.google.com governed
// because of "Gemini in Gmail", hubspot.com because of HubSpot AI, github.com
// because of Copilot — and once a host is governed, service-worker.js injects the
// DLP stack into the entire tab and content.js captures from every textarea,
// contenteditable and file input on it. On a dedicated AI site that is right: the
// whole site IS the AI. On a SaaS app where AI is one panel, it meant ordinary
// email bodies, ticket replies and CRM notes were captured and labelled as AI
// prompts. Production had 186 events from app.hubspot.com, 32 from github.com and
// 6 from a SharePoint tenant — all from non-AI surfaces, all with stored content.
//
// So scope becomes a property of the host:
//
//   whole_site   — the site is an AI product. Capture anywhere. Current behaviour.
//   embedded_ai  — AI is a panel inside a larger app. Capture ONLY inside a
//                  recognised AI panel, and NOTHING if no panel is found.
//
// FAIL CLOSED IS DELIBERATE. If a selector goes stale because a vendor reshuffles
// its DOM, an embedded_ai host captures nothing rather than everything. For a
// governance tool, silently under-collecting is a visible gap someone reports;
// silently collecting employee email is a compliance incident. The selectors are
// served over HTTP (see routes/ai-surfaces.js) precisely so a stale one is a
// config fix rather than an extension release.

export const SURFACE_SCOPE = {
  WHOLE_SITE: 'whole_site',
  EMBEDDED_AI: 'embedded_ai',
};

/**
 * Hosts where AI is embedded in a larger product, with the selectors that
 * identify the AI panel. Matched on exact host or dot-suffix, longest key wins.
 *
 * SELECTORS ARE KEYED ON THE AI PRODUCT'S OWN NAME (Gemini, Copilot, Breeze,
 * Einstein) rather than a generic "ai" token, and that is not stylistic: an
 * attribute substring match on "ai" also matches the word "mail", which on Gmail
 * would re-select the entire mail UI and reproduce the bug this file fixes.
 *
 * These are best-effort and NOT yet verified against each live app. Because
 * capture fails closed, an inaccurate selector under-collects — which is why it
 * is safe to ship them unverified and correct them from observed behaviour.
 */
// Generic AI-panel selectors for apps whose embedded assistant we have not named
// specifically. Mirrors GENERIC_AI_PANEL in browser-extension/content/content.js.
const GENERIC_AI_PANEL = [
  '[aria-label*="Copilot" i]', '[aria-label*="Assistant" i]', '[aria-label*="Ask AI" i]',
  '[class*="copilot" i]', '[class*="assistant" i]', '[data-testid*="assistant" i]',
];

// WHICH NAMED AGENT is open inside a Microsoft 365 surface — a DIFFERENT question
// from `selectors` above, which answers "where is the AI panel on this page".
//
// The `blocked_agents` rows this feeds are per-AGENT ({ agent_name: "AI Learning
// Advisor", platform: "personal_agent" }), and a host-level match cannot enforce
// one: blocking a single agent by host would disable Teams, Outlook and M365
// Copilot chat for the whole org. The browser side therefore needs the same read
// the desktop enforcer already does through the composer's accessible name (see
// agent/src/os_monitor/ai-processes.js's agent-surfaces catalog) — in the DOM,
// the element whose text is the open agent's display name.
//
// THIS SET IS A HYPOTHESIS, NOT A VERIFIED READ. It is a best guess at the M365
// web DOM, pending a live verification pass by someone with a licensed tenant.
// ITS ONE CONSUMER is the panel agent-label reader in
// browser-extension/content/content.js, which reads `agentLabelSelectors` off
// this payload — behind a feature flag that SHIPS OFF, so in a default build
// nothing acts on these selectors yet. Served from here rather than compiled into
// the extension so that correcting a wrong guess is a server-side config fix
// rather than an extension release, which is the same reason `selectors` is
// served from here at all (see the header).
//
// Shipping an unverified guess is safe in the same direction the rest of this
// file fails: a selector that matches nothing means no agent name is read, which
// means an agent-scoped block does not enforce in the browser — the behaviour
// that exists today. A wrong name can never be fabricated from a stale selector
// matching nothing, and the desktop surface is unaffected either way.
const M365_AGENT_LABEL = [
  '.fai-CopilotMessage__accessibleHeading',
  '.fai-AiGeneratedDisclaimer',
  '[aria-selected="true"][role="option"]',
  '[role="combobox"][aria-expanded]',
];

export const EMBEDDED_AI_SURFACES = {
  'mail.google.com': {
    product: 'Gemini in Gmail',
    selectors: ['[aria-label*="Gemini" i]', '[data-gemini]', 'dialog[aria-label*="Gemini" i]'],
  },
  'docs.google.com': {
    product: 'Gemini in Docs',
    selectors: ['[aria-label*="Gemini" i]', '[aria-label*="Help me write" i]'],
  },
  'meet.google.com': {
    product: 'Gemini in Meet',
    selectors: ['[aria-label*="Gemini" i]', '[aria-label*="take notes" i]'],
  },
  'teams.microsoft.com': {
    product: 'Teams Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[data-tid*="copilot" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  // Dot-suffix matching means this entry is also the one m365.cloud.microsoft —
  // where Copilot Studio and personal agents are actually consumed — resolves to,
  // so its agent-label selectors are set here rather than on a second key. Adding
  // 'm365.cloud.microsoft' as its own key would also break the server-map ↔
  // extension-floor parity test until the extension gained the same key.
  'cloud.microsoft': {
    product: 'Microsoft 365 Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]', '[data-tid*="copilot" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  // `sharepoint_embedded` is one of the six per-agent M365 platforms, and the
  // agents it names are consumed on <tenant>.sharepoint.com — the exact host this
  // dot-suffix key covers. It was the one M365 host left without an agent-label
  // read, which would have made a `sharepoint_embedded` block the only one of the
  // four new platforms with no browser-side way to resolve which agent is open.
  'sharepoint.com': {
    product: 'SharePoint Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'outlook.office.com': {
    product: 'Outlook Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'outlook.office365.com': {
    product: 'Outlook Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'outlook.live.com': {
    product: 'Outlook Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'office.com': {
    product: 'Microsoft 365 Copilot',
    selectors: GENERIC_AI_PANEL,
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'office365.com': {
    product: 'Microsoft 365 Copilot',
    selectors: GENERIC_AI_PANEL,
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  // office.com's successor portal, and already one of
  // MICROSOFT_WORKSPACE_COPILOT_HOSTS below. Mirrors the extension's own
  // EMBEDDED_AI_FLOOR entry for it selector-for-selector: a host the extension
  // injects into but the server does not scope answers whole_site, which leaves
  // the extension on its compiled-in floor forever and makes a stale selector an
  // extension release rather than a config fix (the parity test in
  // tests/ai-surfaces.test.mjs is what keeps the two lists equal).
  'microsoft365.com': {
    product: 'Microsoft 365 Copilot',
    selectors: ['[data-tid*="copilot" i]', ...GENERIC_AI_PANEL],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'crm.dynamics.com': {
    product: 'Dynamics Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'copilotstudio.microsoft.com': {
    product: 'Copilot Studio',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]', '[aria-label*="Test your agent" i]'],
    agentLabelSelectors: M365_AGENT_LABEL,
  },
  'powerapps.com': {
    product: 'Power Apps Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'github.com': {
    product: 'GitHub Copilot',
    selectors: ['[data-testid*="copilot" i]', '#copilot-chat', '[aria-label*="Copilot" i]', 'copilot-chat'],
  },
  'gitlab.com': {
    product: 'GitLab Duo',
    selectors: ['[aria-label*="Duo" i]', '[class*="duo-chat" i]', '[data-testid*="duo" i]'],
  },
  'hubspot.com': {
    product: 'HubSpot Breeze',
    selectors: ['[data-test-id*="copilot" i]', '[class*="copilot" i]', '[aria-label*="Breeze" i]'],
  },
  'hs-scripts.com': {
    product: 'HubSpot Breeze',
    selectors: ['[data-test-id*="copilot" i]', '[class*="copilot" i]', '[aria-label*="Breeze" i]'],
  },
  'salesforce.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
  },
  'force.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
  },
  'salesforceliveagent.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
  },
  'salesforce-experience.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
  },
  'salesforce-sites.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]'],
  },
  'zendesk.com': {
    product: 'Zendesk AI',
    selectors: ['[data-test-id*="copilot" i]', '[data-test-id*="generative" i]', '[class*="ai-agent" i]'],
  },
  'zopim.com': {
    product: 'Zendesk AI',
    selectors: ['[data-test-id*="copilot" i]', '[data-test-id*="generative" i]', '[class*="ai-agent" i]'],
  },
  'intercom.com': {
    product: 'Intercom Fin',
    selectors: ['[class*="fin-" i]', '[class*="intercom-ai" i]'],
  },
  'intercom.io': {
    product: 'Intercom Fin',
    selectors: ['[class*="fin-" i]', '[class*="intercom-ai" i]'],
  },
  'drift.com': {
    product: 'Drift AI',
    selectors: GENERIC_AI_PANEL,
  },
  'driftt.com': {
    product: 'Drift AI',
    selectors: GENERIC_AI_PANEL,
  },
  'livechatinc.com': {
    product: 'LiveChat AI',
    selectors: GENERIC_AI_PANEL,
  },
  'crisp.chat': {
    product: 'Crisp MagicReply',
    selectors: ['[class*="magic" i]', ...GENERIC_AI_PANEL],
  },
  'tawk.to': {
    product: 'Tawk AI',
    selectors: GENERIC_AI_PANEL,
  },
  'slack.com': {
    product: 'Slack AI',
    selectors: ['[aria-label*="Slack AI" i]', '[data-qa*="ai_" i]', ...GENERIC_AI_PANEL],
  },
  'notion.so': {
    product: 'Notion AI',
    selectors: ['[class*="notion-ai" i]', '[aria-label*="Notion AI" i]', ...GENERIC_AI_PANEL],
  },
  'notion.site': {
    product: 'Notion AI',
    selectors: ['[class*="notion-ai" i]', '[aria-label*="Notion AI" i]', ...GENERIC_AI_PANEL],
  },
  'linear.app': {
    product: 'Linear AI',
    selectors: GENERIC_AI_PANEL,
  },
  'atlassian.net': {
    product: 'Atlassian Intelligence',
    selectors: ['[data-testid*="ai-" i]', '[aria-label*="Atlassian Intelligence" i]', ...GENERIC_AI_PANEL],
  },
  'atlassian.com': {
    product: 'Atlassian Intelligence',
    selectors: ['[data-testid*="ai-" i]', '[aria-label*="Atlassian Intelligence" i]', ...GENERIC_AI_PANEL],
  },
  'asana.com': {
    product: 'Asana AI',
    selectors: GENERIC_AI_PANEL,
  },
  'monday.com': {
    product: 'monday AI',
    selectors: GENERIC_AI_PANEL,
  },
  'clickup.com': {
    product: 'ClickUp Brain',
    selectors: ['[aria-label*="Brain" i]', ...GENERIC_AI_PANEL],
  },
  'canva.com': {
    product: 'Canva Magic Studio',
    selectors: ['[aria-label*="Magic" i]', ...GENERIC_AI_PANEL],
  },
  'figma.com': {
    product: 'Figma AI',
    selectors: GENERIC_AI_PANEL,
  },
  'miro.com': {
    product: 'Miro AI',
    selectors: GENERIC_AI_PANEL,
  },
};

/**
 * The web surfaces the Microsoft 365 Copilot PRODUCT is consumed on.
 *
 * WHY A CURATED STATIC LIST. Blocking the M365 Copilot product has to reach the
 * browser extension, which enforces per HOST — and the obvious shortcut, deriving
 * the host set from a discovered agent's `matched_hosts`, is the exact bug that
 * was removed from PUT /api/v1/registry/:id/status (see the long note there):
 * discovery attaches the whole Microsoft suite to every Copilot Studio agent, so
 * one narrow decision blocked Teams, SharePoint and Outlook for the org. This list
 * is therefore hand-maintained and deliberately small, and changing what a product
 * toggle covers is a code review rather than a side effect of a tenant scan.
 *
 * WHAT IS DELIBERATELY ABSENT, and why each one is a different product:
 *   copilot.microsoft.com        free consumer Copilot — not the licensed M365 one
 *   copilotstudio.microsoft.com  maker/authoring tool, not the agent being consumed
 *   powerapps.com                same: authoring surface
 *   powerva.ms                   legacy Power Virtual Agents authoring host
 *   crm.dynamics.com             Dynamics Copilot, a separate product with its own row
 *
 * Bare hostnames: consumers match on exact host or dot-suffix, so `sharepoint.com`
 * covers `<tenant>.sharepoint.com` and `office.com` covers `www.office.com`.
 */
export const MICROSOFT_WORKSPACE_COPILOT_HOSTS = [
  'cloud.microsoft',
  'm365.cloud.microsoft',
  'office.com',
  'office365.com',
  'microsoft365.com',
  'teams.microsoft.com',
  'outlook.office.com',
  'outlook.office365.com',
  'outlook.live.com',
  'sharepoint.com',
];

// The product's identity string, read off the catalog above rather than restated,
// so this product has exactly ONE spelling in the codebase. It is the same value
// `ai_platforms.product` already carries for these rows (see seed-platforms.js),
// which is what makes a product toggle identifiable without a new field.
const MICROSOFT_WORKSPACE_COPILOT_PRODUCT = EMBEDDED_AI_SURFACES['cloud.microsoft'].product;

// The ONE alias this product is recognized under besides its own name. The
// live, actually-reachable Inventory toggle for this product today is a
// discovered `endpoint_scan`/`browser_ai_visit` row (id "microsoft:
// microsoft-copilot") whose `name` — and therefore the `product_name` its
// toggle sends — is the shorter "Microsoft Copilot", not "Microsoft 365
// Copilot". Explicitly asked for 2026-09-21: blocking THAT toggle must reach
// the same desktop pane + browser surfaces the longer name does. This does
// NOT widen which HOSTS get blocked — copilot.microsoft.com (the free
// consumer product) is still deliberately absent from
// MICROSOFT_WORKSPACE_COPILOT_HOSTS above — it only widens which PRODUCT
// LABEL is allowed to trigger that same, unchanged cascade.
const MICROSOFT_WORKSPACE_COPILOT_ALIASES = new Set(
  [MICROSOFT_WORKSPACE_COPILOT_PRODUCT, 'Microsoft Copilot'].map((s) => s.toLowerCase()),
);

/**
 * True for the Microsoft 365 Copilot product itself, or for its one
 * recognized alias (see MICROSOFT_WORKSPACE_COPILOT_ALIASES above).
 *
 * Exact match on the product name, case-insensitively — NOT a substring test.
 * "Copilot" appears in the name of at least six unrelated Microsoft products
 * (Dynamics Copilot, Copilot Studio, GitHub Copilot, the free consumer Copilot,
 * Power Apps Copilot, Teams Copilot), so a loose match here would silently widen
 * a product block onto surfaces the admin never chose.
 */
export function isMicrosoftWorkspaceCopilotProduct(product) {
  if (typeof product !== 'string') return false;
  return MICROSOFT_WORKSPACE_COPILOT_ALIASES.has(product.trim().toLowerCase());
}

/**
 * Fans a block/unblock decision for the Microsoft 365 Copilot product out
 * across every host in MICROSOFT_WORKSPACE_COPILOT_HOSTS.
 *
 * ONE function, called from BOTH admin surfaces that can toggle a product's
 * block state — registry.js's `PUT /api/v1/registry/:id/status` (the
 * Inventory list) and ai-platforms.js's `PATCH /api/v1/ai-platforms/:host`
 * (the host-keyed catalog) — because a real admin can reach this product
 * from either one, and a cascade that only fired from one of them would mean
 * "blocked" in one view and silently not in the other. See both call sites'
 * own comments for how each one determines `productIdentity`.
 *
 * Callers gate this themselves on `isMicrosoftWorkspaceCopilotProduct(productIdentity)`
 * before calling — this function does not re-check, so it must never be
 * called for any other product's toggle.
 */
export async function applyMicrosoftWorkspaceCopilotCascade(db, isBlocked) {
  const now = new Date();
  // Upsert, host by host: an unblock has to reach a host the same way a block
  // did, and `blocked: 0` is stored rather than the row deleted so the
  // decision stays visible in ai_platforms (same convention as PATCH
  // /api/v1/ai-platforms/:host and the agent blocklist's unblock).
  for (const host of MICROSOFT_WORKSPACE_COPILOT_HOSTS) {
    await db.collection('ai_platforms').updateOne(
      { host },
      {
        // Only `blocked` is written on an EXISTING row. sharepoint.com and
        // outlook.office.com legitimately carry their own product names
        // ("SharePoint Copilot", "Outlook Copilot"); rewriting those to
        // "Microsoft 365 Copilot" would destroy identity this toggle merely
        // needs to read.
        $set: { blocked: isBlocked ? 1 : 0, updated_at: now },
        $setOnInsert: {
          vendor: 'Microsoft',
          product: 'Microsoft 365 Copilot',
          category: 'ide-assistant',
          sandbox: 'remote',
          governed: 1,
          surface: 'browser',
          capture_mode: 'observe',
          governance_note: null,
          pinned: 0,
          source: 'curated',
          added_by: 'system',
          added_at: now,
        },
      },
      { upsert: true },
    );
  }
  // A row scoped to another surface is invisible to the extension's
  // ?surface=browser fetch, which would leave the block silently unenforced
  // there — the failure this route keeps running into. Widened to 'all'
  // rather than reassigned to 'browser', so desktop coverage is added to,
  // not lost.
  await db.collection('ai_platforms').updateMany(
    { host: { $in: MICROSOFT_WORKSPACE_COPILOT_HOSTS }, surface: { $nin: ['browser', 'all'] } },
    { $set: { surface: 'all', updated_at: now } },
  );
}

/** Exact host or dot-suffix match; the longest matching key wins. */
export function surfaceFor(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return { scope: SURFACE_SCOPE.WHOLE_SITE, selectors: [], product: null };

  let bestKey = null;
  for (const key of Object.keys(EMBEDDED_AI_SURFACES)) {
    if ((h === key || h.endsWith('.' + key)) && (!bestKey || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  if (!bestKey) {
    // DEFAULT IS whole_site, ON PURPOSE. The LLM classifier discovers arbitrary
    // AI sites and governs them with generic selectors — defaulting those to
    // embedded_ai would silently stop capturing on every newly discovered AI tool.
    // The trade is stated plainly: a SaaS app with embedded AI that is NOT listed
    // above will over-collect until it is added. See ROADMAP.
    return { scope: SURFACE_SCOPE.WHOLE_SITE, selectors: [], product: null };
  }
  const entry = EMBEDDED_AI_SURFACES[bestKey];
  return {
    scope: SURFACE_SCOPE.EMBEDDED_AI,
    selectors: entry.selectors.slice(),
    product: entry.product,
    matched: bestKey,
    // OPTIONAL and omitted entirely for the hosts that have none, rather than sent
    // as []: a consumer must be able to tell "this host has no agent-label read"
    // from "the read found nothing", and an empty array reads as the latter.
    ...(entry.agentLabelSelectors ? { agentLabelSelectors: entry.agentLabelSelectors.slice() } : {}),
  };
}

/** True when this host must only be captured inside an AI panel. */
export function isEmbeddedAi(host) {
  return surfaceFor(host).scope === SURFACE_SCOPE.EMBEDDED_AI;
}

/** Every embedded-AI host key — used by the content purge to select rows. */
export function embeddedAiHostKeys() {
  return Object.keys(EMBEDDED_AI_SURFACES);
}
