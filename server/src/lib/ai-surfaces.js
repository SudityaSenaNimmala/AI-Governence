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
export const EMBEDDED_AI_SURFACES = {
  'mail.google.com': {
    product: 'Gemini in Gmail',
    selectors: [
      '[aria-label*="Gemini" i]',
      '[data-gemini]',
      'dialog[aria-label*="Gemini" i]',
      '[jsname][aria-label*="Ask Gemini" i]',
    ],
  },
  'docs.google.com': {
    product: 'Gemini in Docs',
    selectors: ['[aria-label*="Gemini" i]', '[aria-label*="Help me write" i]'],
  },
  'hubspot.com': {
    product: 'HubSpot Breeze',
    selectors: [
      '[data-test-id*="copilot" i]',
      '[class*="copilot" i]',
      '[aria-label*="Breeze" i]',
      '[data-test-id*="breeze" i]',
    ],
  },
  'github.com': {
    product: 'GitHub Copilot',
    selectors: [
      '[data-testid*="copilot" i]',
      '#copilot-chat',
      '[aria-label*="Copilot" i]',
      'copilot-chat',
    ],
  },
  'sharepoint.com': {
    product: 'SharePoint Copilot',
    selectors: ['[aria-label*="Copilot" i]', '[class*="copilot" i]'],
  },
  'zendesk.com': {
    product: 'Zendesk AI',
    selectors: [
      '[data-test-id*="copilot" i]',
      '[data-test-id*="generative" i]',
      '[aria-label*="Zendesk AI" i]',
      '[class*="ai-agent" i]',
    ],
  },
  'salesforce.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]', '[class*="einstein" i]'],
  },
  'force.com': {
    product: 'Salesforce Agentforce',
    selectors: ['[aria-label*="Einstein" i]', '[aria-label*="Agentforce" i]', '[class*="einstein" i]'],
  },
  'intercom.com': {
    product: 'Intercom Fin',
    selectors: ['[class*="fin-" i]', '[aria-label*="Fin" i]', '[class*="intercom-ai" i]'],
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
