const normalizeMicrosoftPlanKey = (name) =>
  String(name ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/_/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");

/** Demo feature copy for specific Microsoft SKUs (matched after normalizing plan name / id). */
export const MICROSOFT_LICENSE_FEATURES = {
  "DYNAMICS 365 CUSTOMER SERVICE ENTERPRISE VIRAL TRIAL": [
    "Full Customer Service Enterprise capabilities during the viral trial period",
    "Omnichannel routing for cases across chat, voice, and digital channels",
    "Unified agent desktop with timeline, knowledge, and productivity tools",
    "Customer self-service portals and knowledge base publishing",
    "Service-level agreements, entitlements, and escalation rules",
    "Embedded insights for queue health and agent performance",
  ],
  "MICROSOFT 365 COPILOT": [
    "Copilot in Microsoft 365 apps: Word, Excel, PowerPoint, Outlook, and Teams",
    "Grounded responses using your Microsoft Graph content where enabled",
    "Meeting summaries, action items, and intelligent chat in Teams",
    "Draft and refine content with organization-aware suggestions",
    "Admin controls for rollout, licensing, and usage policies",
    "Works within your existing Microsoft 365 security and compliance boundary",
  ],
  "FLOW FREE": [
    "Create and run cloud flows with a curated set of standard connectors",
    "Trigger automations from approved Microsoft 365 and cloud services",
    "Basic run history and failure notifications for troubleshooting",
    "Mobile approvals for common flow scenarios",
    "Suitable for personal productivity and light team automation (subject to service limits)",
  ],
  "SPE E5": [
    "Advanced security and compliance capabilities aligned with E5-class SKUs",
    "Threat protection and safer links/attachments for collaboration workloads",
    "Cloud discovery, session controls, and app governance patterns",
    "Advanced retention, eDiscovery, and audit readiness features",
    "Information protection labels and policy-driven encryption options",
  ],
  "O365 BUSINESS ESSENTIALS": [
    "Business email with calendaring and contacts via Exchange Online",
    "Web and mobile versions of Word, Excel, and PowerPoint",
    "Microsoft Teams for chat, meetings, and calling (per plan limits)",
    "1 TB OneDrive for Business storage per user for file sync and share",
    "SharePoint Online team sites for intranet and document collaboration",
  ],
  "PROJECT MADEIRA PREVIEW IW SKU": [
    "Preview access to cloud financials and small-business ERP scenarios",
    "Core financials: chart of accounts, general ledger, and bank reconciliation",
    "Sales and purchasing documents with basic inventory visibility",
    "IW (Invitation) program features subject to preview terms and changes",
    "Not intended for production; functionality may differ from general availability",
  ],
};

const MICROSOFT_LICENSE_FEATURE_ALIASES = {
  "OFFICE 365 BUSINESS ESSENTIALS": "O365 BUSINESS ESSENTIALS",
  "MICROSOFT 365 BUSINESS BASIC": "O365 BUSINESS ESSENTIALS",
  "MICROSOFT FLOW FREE": "FLOW FREE",
  "POWER AUTOMATE FREE": "FLOW FREE",
};

export const getMicrosoftLicenseFeatures = (planName, planId, domain) => {
  const candidates = [planName, planId, domain].filter(Boolean);
  for (const raw of candidates) {
    const key = normalizeMicrosoftPlanKey(raw);
    if (MICROSOFT_LICENSE_FEATURES[key]) {
      return MICROSOFT_LICENSE_FEATURES[key];
    }
    const viaAlias = MICROSOFT_LICENSE_FEATURE_ALIASES[key];
    if (viaAlias && MICROSOFT_LICENSE_FEATURES[viaAlias]) {
      return MICROSOFT_LICENSE_FEATURES[viaAlias];
    }
  }
  return null;
};

export const isMicrosoftLicenseProvider = (providerName) =>
  providerName === "MICROSOFT_OFFICE_365" || providerName === "MICROSOFT_TEAMS";
