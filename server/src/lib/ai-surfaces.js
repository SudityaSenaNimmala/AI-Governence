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
  },
  'cloud.microsoft': {
    product: 'Microsoft 365 Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]', '[data-tid*="copilot" i]'],
  },
  'sharepoint.com': {
    product: 'SharePoint Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'outlook.office.com': {
    product: 'Outlook Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'outlook.office365.com': {
    product: 'Outlook Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'outlook.live.com': {
    product: 'Outlook Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'office.com': {
    product: 'Microsoft 365 Copilot',
    selectors: GENERIC_AI_PANEL,
  },
  'office365.com': {
    product: 'Microsoft 365 Copilot',
    selectors: GENERIC_AI_PANEL,
  },
  'crm.dynamics.com': {
    product: 'Dynamics Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'copilotstudio.microsoft.com': {
    product: 'Copilot Studio',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]', '[aria-label*="Test your agent" i]'],
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
