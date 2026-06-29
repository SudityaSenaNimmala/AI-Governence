/**
 * Shadow IT application table: publisher → category pill (label + colors).
 * Reference palette: Outlook add-in (yellow/amber), SaaS SSO (lavender/blue),
 * Custom automation (pink/red), Security tool (mint/green), AI agents (violet).
 */

export const PUBLISHER_CATEGORY = {
  OUTLOOK_ADDIN: {
    label: "Outlook add-in",
    style: { backgroundColor: "#fef9c3", color: "#b45309" },
  },
  SAAS_SSO: {
    label: "SaaS SSO",
    style: { backgroundColor: "#e0e7ff", color: "#4338ca" },
  },
  CUSTOM_AUTOMATION: {
    label: "Custom automation",
    style: { backgroundColor: "#ffe4e6", color: "#be123c" },
  },
  SECURITY_TOOL: {
    label: "Security tool",
    style: { backgroundColor: "#d1fae5", color: "#047857" },
  },
  AI_AGENTS: {
    label: "AI agents",
    style: { backgroundColor: "#ede9fe", color: "#5b21b6" },
  },
  OTHER: {
    label: "Other",
    style: { backgroundColor: "#f3f4f6", color: "#4b5563" },
  },
};

/** Dropdown options: All + each publisher category (for Shadow IT filters). */
export const SHADOW_IT_CATEGORY_FILTER_OPTIONS = [
  { key: "ALL", value: "All", id: "ALL" },
  ...Object.keys(PUBLISHER_CATEGORY).map((id) => ({
    key: id,
    value: PUBLISHER_CATEGORY[id].label,
    id,
  })),
];

const CAT = {
  OUTLOOK_ADDIN: "OUTLOOK_ADDIN",
  SAAS_SSO: "SAAS_SSO",
  CUSTOM_AUTOMATION: "CUSTOM_AUTOMATION",
  SECURITY_TOOL: "SECURITY_TOOL",
  AI_AGENTS: "AI_AGENTS",
  OTHER: "OTHER",
};

/** Normalize publisher for dictionary lookup (commas, dots, parentheses, spaces). */
export function normalizePublisherKey(pub) {
  return String(pub || "")
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\./g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exact / known publishers from tenant exports (normalized key → category id).
 * Covers: CloudFuze, filefuze, Voohalu, HubSpot, Syskit, Miro, Box, JumpCloud, etc.
 */
const PUBLISHER_NORMALIZED_TO_CATEGORY = {
  "cloudfuze inc": CAT.SAAS_SSO,
  filefuze: CAT.SAAS_SSO,
  voohalu: CAT.SAAS_SSO,
  "hubspot inc": CAT.SAAS_SSO,
  pepperwood: CAT.OTHER,
  "jgraph ltd": CAT.SAAS_SSO,
  syskit: CAT.SECURITY_TOOL,
  polly: CAT.SAAS_SSO,
  "realtimeboard inc": CAT.SAAS_SSO,
  "docusign techops": CAT.SAAS_SSO,
  box: CAT.SAAS_SSO,
  "microsoft accounts": CAT.SAAS_SSO,
  tailscale: CAT.SECURITY_TOOL,
  jumpcloud: CAT.SAAS_SSO,
  "zoho corporation private limited": CAT.SAAS_SSO,
  "default directory": CAT.SAAS_SSO,
  superhuman: CAT.AI_AGENTS,
  "ytria inc": CAT.CUSTOM_AUTOMATION,
  "aikido dev": CAT.SECURITY_TOOL,
  prdtrs01: CAT.OTHER,
  meta: CAT.SAAS_SSO,
  "mural tactivos": CAT.SAAS_SSO,
  "standss south pacific pte ltd": CAT.OUTLOOK_ADDIN,
  "read ai inc": CAT.AI_AGENTS,
};

/** Unicode / exact string matches (no lowercasing). */
const EXACT_TRIM_TO_CATEGORY = {
  "ジョーシス株式会社": CAT.OTHER,
};

/** Category id string (e.g. SAAS_SSO) for filtering; matches SHADOW_IT_CATEGORY_FILTER_OPTIONS ids. */
export function getCategoryIdFromPublisher(publisher) {
  if (publisher == null || String(publisher).trim() === "" || publisher === "-") {
    return CAT.OTHER;
  }

  const trimmed = String(publisher).trim();
  if (EXACT_TRIM_TO_CATEGORY[trimmed]) {
    return EXACT_TRIM_TO_CATEGORY[trimmed];
  }

  const normalized = normalizePublisherKey(publisher);
  if (PUBLISHER_NORMALIZED_TO_CATEGORY[normalized]) {
    return PUBLISHER_NORMALIZED_TO_CATEGORY[normalized];
  }

  const p = String(publisher).toLowerCase();

  if (
    /openai|anthropic|claude|chatgpt|gpt-4|gpt-3|copilot|github\s*copilot|microsoft\s*copilot|perplexity|cursor|replicate|hugging|cohere|midjourney|stability\s*ai|langchain|llama|gemini\s*api|vertex\s*ai|bedrock|azure\s*openai|ai\s*agent|agents?\s*platform|writer\.com|jasper|copy\.ai|character\.ai|elevenlabs|runway|synthesia|read\s*ai/i.test(
      p
    )
  ) {
    return CAT.AI_AGENTS;
  }
  if (/outlook|exchange\s+online|microsoft\s+outlook|add-?in|office\s*365.*add|for\s+outlook/i.test(p)) {
    return CAT.OUTLOOK_ADDIN;
  }
  if (/zapier|ifttt|make\.com|power\s*automate|n8n|workato|tray\.io|integromat|automate\.io|jenkins/i.test(p)) {
    return CAT.CUSTOM_AUTOMATION;
  }
  if (
    /crowdstrike|sentinel|splunk|zscaler|okta|auth0|ping\s+identity|mimecast|proofpoint|defender|carbon\s+black|wazuh|tenable|rapid7|varonis|cyber|security|palo\s+alto|fortinet|checkpoint|syskit|tailscale|aikido/i.test(
      p
    )
  ) {
    return CAT.SECURITY_TOOL;
  }
  if (
    /microsoft|google|amazon|aws|salesforce|slack|asana|zoom|atlassian|dropbox|adobe|servicenow|workday|hubspot|oracle|ibm|miro|notion|figma|cloudfuze|filefuze|fuze|lucid|docusign|box\b|zoho|jumpcloud|realtimeboard|mural|jgraph|polly|meta\b/i.test(
      p
    )
  ) {
    return CAT.SAAS_SSO;
  }
  return CAT.OTHER;
}

export function getCategoryFromPublisher(publisher) {
  const id = getCategoryIdFromPublisher(publisher);
  return PUBLISHER_CATEGORY[id] ?? PUBLISHER_CATEGORY.OTHER;
}
