// Pre-built compliance policy packs (SELECTED_FEATURES_AUG2026 #11).
//
// A pack is a versioned bundle of rules for one framework. Deploying a pack
// materialises its rules into the existing `policies` collection, so the normal
// policy list / edit / evaluate paths keep working — packs are a authoring and
// lifecycle layer, not a second engine.
//
// ── Why each rule declares an `enforcement` surface ───────────────────────────
// This product has two real enforcement mechanisms and one procedural one, and a
// compliance framework spans all three. Tagging each rule keeps the distinction
// visible instead of implying everything is automatically enforced:
//
//   "agent"       Evaluated by policyEngine against discovered agents. The engine
//                 resolves a FIXED set of fields (see AGENT_FIELDS below) — a rule
//                 referencing anything else would silently never fire, so pack
//                 rules are restricted to those fields and validated on load.
//
//   "dlp"         Detected client-side by the browser extension / OS monitor from
//                 patterns.js and reported to /api/v1/dlp. The detection already
//                 exists; the pack records which pattern classes the framework
//                 requires so coverage can be VERIFIED against observed events.
//                 It cannot switch client patterns on and off — the extension does
//                 not read policy config from the server today.
//
//   "attestation" A control that software cannot decide: a signed BAA, a DPA on
//                 file, a retention period agreed with legal. Tracked as an
//                 attestation with an owner and evidence, never auto-satisfied.
//
// Claiming an attestation or dlp rule was "enforced" would be the failure mode
// that matters here: an auditor asks for evidence and there is none.

import type { PolicyCondition, PolicyAction, PolicyScope } from "./policyEngine.js";

// Fields policyEngine.resolveField() actually understands. Kept in sync with that
// function — validatePacks() fails loudly if a rule drifts outside this set.
export const AGENT_FIELDS = [
  "risk_score",
  "risk_level",
  "days_since_last_activity",
  "is_orphaned",
  "has_owner",
  "lifecycle_status",
  "consent_type",
  "permission_count",
  "connector_count",
  "has_http_connector",
  "has_dangerous_permissions",
  "platform",
  "published_status",
  "total_invocations",
  "unique_users",
] as const;

// Pattern classes defined in browser-extension/content/patterns.js. A dlp rule may
// only reference these, so "required coverage" is checkable against reality.
export const DLP_PATTERNS = [
  "us-ssn", "credit-card", "iban", "us-phone",
  "openai-api-key", "anthropic-api-key", "google-api-key", "huggingface-token",
  "github-pat", "gitlab-pat", "aws-access-key", "gcp-service-key", "slack-token", "jwt",
  "cloudfuze-customer-id", "internal-jira-key",
  "injection-ignore-instructions", "injection-system-markers", "injection-override-safety",
  "injection-extract-system", "injection-new-identity", "injection-no-restrictions",
  "injection-pretend-no-rules", "injection-roleplay-dangerous", "injection-forget-identity",
  "jailbreak-dan", "jailbreak-developer-mode", "jailbreak-no-ethics", "jailbreak-bypass-policy",
  "jailbreak-fiction-excuse", "jailbreak-keyword", "jailbreak-opposite-day", "jailbreak-lets-go-crazy",
  "toxicity-hate-request", "toxicity-harm-instructions", "toxicity-explicit-content",
  "toxicity-self-harm", "toxicity-group-attack",
  "bias-demographic-comparison", "bias-stereotype-request",
] as const;

export type EnforcementSurface = "agent" | "dlp" | "attestation";

export interface PackRule {
  /** Stable within a pack. Used for per-rule toggles, so never renumber. */
  key: string;
  title: string;
  /** What the rule does, in the language of the framework. */
  description: string;
  /** The clause this maps to, so an auditor can trace it. */
  citation: string;
  severity: "low" | "medium" | "high" | "critical";
  enforcement: EnforcementSurface;

  /** enforcement === "agent" */
  type?: string;
  conditions?: PolicyCondition[];
  actions?: PolicyAction[];
  scope?: PolicyScope;
  /** Which condition value a customer may tune, e.g. a day count or score. */
  tunable?: { field: string; label: string; min: number; max: number };

  /** enforcement === "dlp" — pattern classes this control depends on. */
  patterns?: string[];

  /** enforcement === "attestation" — what evidence satisfies it. */
  evidence?: string;
}

export interface PolicyPack {
  id: string;
  framework: string;
  name: string;
  description: string;
  /** Bump when rules change; drives the review-and-accept diff. */
  version: number;
  /** Short note on what changed in this version, shown in the diff. */
  versionNotes: string;
  rules: PackRule[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GDPR
// ─────────────────────────────────────────────────────────────────────────────
const GDPR: PolicyPack = {
  id: "gdpr",
  framework: "GDPR",
  name: "EU General Data Protection Regulation",
  description:
    "Personal-data protection for EU data subjects: lawful basis, data minimisation, "
    + "residency, erasure and breach-notification readiness for AI systems.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    {
      key: "gdpr-pii-in-prompts",
      title: "Detect personal data in AI prompts",
      description:
        "Personal identifiers sent to an AI service are a processing activity requiring a lawful "
        + "basis. Detection of national IDs, payment data and contact details in prompts.",
      citation: "GDPR Art. 6 (lawfulness), Art. 5(1)(c) (data minimisation)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["us-ssn", "credit-card", "iban", "us-phone"],
    },
    {
      key: "gdpr-no-owner",
      title: "Every AI agent must have an accountable owner",
      description:
        "A controller must be able to identify who is responsible for each processing activity. "
        + "Agents with no owner have no accountable person.",
      citation: "GDPR Art. 5(2) (accountability), Art. 24",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "gdpr-orphaned-processing",
      title: "Escalate orphaned agents still processing data",
      description:
        "An agent whose owner has left continues processing personal data with no accountable "
        + "controller contact. Escalate for reassignment or shutdown.",
      citation: "GDPR Art. 5(2), Art. 32 (security of processing)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "is_orphaned", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "gdpr-external-egress",
      title: "Flag agents with external data egress",
      description:
        "HTTP connectors can transfer personal data outside the controller's systems, which may "
        + "constitute a third-country transfer requiring safeguards.",
      citation: "GDPR Ch. V (Art. 44–49, transfers)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_http_connector", operator: "is_true", value: true }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "gdpr-broad-consent",
      title: "Review tenant-wide (admin-consented) permissions",
      description:
        "AllPrincipals consent grants an agent access to all users' data, which conflicts with "
        + "data minimisation and purpose limitation.",
      citation: "GDPR Art. 5(1)(b)–(c) (purpose limitation, minimisation)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "consent_type", operator: "equals", value: "AllPrincipals" }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "gdpr-excessive-permissions",
      title: "Limit permission breadth per agent",
      description:
        "An agent holding more permissions than its purpose requires breaches data minimisation. "
        + "Flag agents above the configured permission count.",
      citation: "GDPR Art. 5(1)(c) (data minimisation)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "permission_count", operator: "greater_than", value: 10 }],
      actions: [{ type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "permission_count", label: "Maximum permissions per agent", min: 1, max: 100 },
    },
    {
      key: "gdpr-dangerous-permissions",
      title: "Escalate agents with high-impact permissions",
      description:
        "Permissions allowing mass read or write of personal data require a documented "
        + "justification and, often, a DPIA.",
      citation: "GDPR Art. 35 (DPIA), Art. 32",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_dangerous_permissions", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "gdpr-stale-retention",
      title: "Retire agents inactive beyond the retention period",
      description:
        "Personal data must not be kept longer than necessary. An agent unused for the configured "
        + "period should be decommissioned along with its data.",
      citation: "GDPR Art. 5(1)(e) (storage limitation)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "days_since_last_activity", operator: "greater_than", value: 90 }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
      tunable: { field: "days_since_last_activity", label: "Inactivity before retirement (days)", min: 7, max: 730 },
    },
    {
      key: "gdpr-secrets-in-prompts",
      title: "Detect credentials pasted into AI services",
      description:
        "Leaked credentials enable unauthorised access to personal data and are a reportable "
        + "security incident.",
      citation: "GDPR Art. 32 (security), Art. 33 (breach notification)",
      severity: "critical",
      enforcement: "dlp",
      patterns: ["openai-api-key", "anthropic-api-key", "aws-access-key", "gcp-service-key", "github-pat", "jwt"],
    },
    {
      key: "gdpr-lawful-basis-record",
      title: "Record a lawful basis for each AI processing activity",
      description:
        "Each AI system processing personal data needs a documented lawful basis (consent, "
        + "contract, legitimate interests) in the record of processing activities.",
      citation: "GDPR Art. 6, Art. 30 (records of processing)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Record of processing activities entry naming the lawful basis per AI system.",
    },
    {
      key: "gdpr-dpa-processors",
      title: "Data Processing Agreement with each AI vendor",
      description:
        "An AI vendor processing personal data on your behalf is a processor and requires an "
        + "Art. 28 contract before use.",
      citation: "GDPR Art. 28 (processor obligations)",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Signed DPA per AI vendor, with sub-processor list and transfer mechanism.",
    },
    {
      key: "gdpr-erasure-process",
      title: "Right-to-erasure process covers AI systems",
      description:
        "Erasure requests must reach data held in AI systems, including prompt logs, fine-tuning "
        + "sets and vector stores.",
      citation: "GDPR Art. 17 (right to erasure)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Documented erasure runbook listing each AI data store and its deletion path.",
    },
    {
      key: "gdpr-dsar-process",
      title: "Subject access requests include AI-held data",
      description:
        "A data subject may request a copy of personal data processed by AI systems, including "
        + "prompt history attributable to them.",
      citation: "GDPR Art. 15 (right of access)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "DSAR procedure referencing AI prompt logs and their retention window.",
    },
    {
      key: "gdpr-residency",
      title: "Confirm processing region for each AI vendor",
      description:
        "Where an AI vendor processes data determines whether a Ch. V transfer mechanism is "
        + "needed. Record the region per vendor.",
      citation: "GDPR Art. 44–49 (transfers to third countries)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Per-vendor processing region plus SCCs or adequacy decision where applicable.",
    },
    {
      key: "gdpr-breach-72h",
      title: "72-hour breach notification runbook",
      description:
        "A personal-data breach involving an AI system must be notifiable to the supervisory "
        + "authority within 72 hours of awareness.",
      citation: "GDPR Art. 33 (notification to supervisory authority)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Incident-response runbook with the 72-hour clock and named notifier.",
    },
    {
      key: "gdpr-dpia-high-risk",
      title: "DPIA for high-risk AI processing",
      description:
        "Systematic evaluation or large-scale processing of special-category data by AI requires "
        + "a Data Protection Impact Assessment before deployment.",
      citation: "GDPR Art. 35 (DPIA)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Completed DPIA per high-risk AI system, reviewed by the DPO.",
    },
    {
      key: "gdpr-automated-decisions",
      title: "Safeguards for solely automated decisions",
      description:
        "Decisions made solely by automated means with legal or significant effect require "
        + "human review, explanation and a contest route.",
      citation: "GDPR Art. 22 (automated individual decision-making)",
      severity: "high",
      enforcement: "attestation",
      evidence: "List of AI systems making automated decisions plus the human-review route.",
    },
    {
      key: "gdpr-transparency-notice",
      title: "Privacy notice discloses AI processing",
      description:
        "Data subjects must be told that their data is processed by AI, for what purpose and with "
        + "what logic where relevant.",
      citation: "GDPR Art. 13–14 (information to be provided)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Privacy notice section covering AI processing and purposes.",
    },
    {
      key: "gdpr-processor-audit",
      title: "Periodic AI processor review",
      description:
        "Controllers must verify that processors continue to meet Art. 28 obligations, including "
        + "sub-processor changes.",
      citation: "GDPR Art. 28(3)(h) (audits and inspections)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Dated review record per AI processor (certification, audit report or questionnaire).",
    },
    {
      key: "gdpr-unsanctioned-tools",
      title: "Detect personal data in unsanctioned AI tools",
      description:
        "Shadow AI use means processing outside the record of processing activities and without a "
        + "DPA. Detection depends on prompt capture across unsanctioned services.",
      citation: "GDPR Art. 5(2), Art. 30",
      severity: "high",
      enforcement: "dlp",
      patterns: ["us-ssn", "credit-card", "iban"],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// HIPAA
// ─────────────────────────────────────────────────────────────────────────────
const HIPAA: PolicyPack = {
  id: "hipaa",
  framework: "HIPAA",
  name: "US Health Insurance Portability and Accountability Act",
  description:
    "Protected Health Information safeguards for AI usage: PHI detection across the 18 "
    + "identifiers, Business Associate Agreements, minimum necessary access and audit controls.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    {
      key: "hipaa-phi-identifiers",
      title: "Detect PHI identifiers in AI prompts",
      description:
        "Of the 18 HIPAA identifiers, those with reliable machine signatures are detected in "
        + "prompt content: SSN, telephone number, account and payment numbers. Names, dates and "
        + "free-text clinical detail are NOT reliably detectable by pattern matching — see the "
        + "minimum-necessary attestation for those.",
      citation: "45 CFR §164.514(b)(2) (de-identification: 18 identifiers)",
      severity: "critical",
      enforcement: "dlp",
      patterns: ["us-ssn", "us-phone", "credit-card", "iban"],
    },
    {
      key: "hipaa-baa-required",
      title: "Business Associate Agreement before AI vendor use",
      description:
        "An AI vendor that creates, receives, maintains or transmits PHI is a business associate "
        + "and requires a BAA before any PHI is sent.",
      citation: "45 CFR §164.308(b)(1), §164.502(e)",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Executed BAA per AI vendor handling PHI, with effective date.",
    },
    {
      key: "hipaa-minimum-necessary",
      title: "Minimum necessary standard for AI access",
      description:
        "AI systems must access only the PHI required for the purpose. Broad tenant-wide consent "
        + "grants access beyond the minimum necessary.",
      citation: "45 CFR §164.502(b) (minimum necessary)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "consent_type", operator: "equals", value: "AllPrincipals" }],
      actions: [{ type: "flag" }, { type: "escalate" }],
      scope: { type: "all" },
    },
    {
      key: "hipaa-workforce-accountability",
      title: "Assign a responsible owner to each AI agent",
      description:
        "Workforce security requires an identified individual accountable for each system "
        + "touching PHI.",
      citation: "45 CFR §164.308(a)(3) (workforce security)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "hipaa-termination-orphans",
      title: "Revoke access when a workforce member departs",
      description:
        "Termination procedures must remove PHI access. An orphaned agent retains access after "
        + "its owner has left.",
      citation: "45 CFR §164.308(a)(3)(ii)(C) (termination procedures)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "is_orphaned", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "suspend" }],
      scope: { type: "all" },
    },
    {
      key: "hipaa-transmission-security",
      title: "Review external transmission of PHI",
      description:
        "Agents with HTTP connectors can transmit PHI to external endpoints and require "
        + "transmission-security review.",
      citation: "45 CFR §164.312(e)(1) (transmission security)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_http_connector", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "hipaa-access-breadth",
      title: "Constrain permission breadth on PHI-adjacent agents",
      description:
        "Access control requires permissions scoped to role. Flag agents holding more than the "
        + "configured number of permissions.",
      citation: "45 CFR §164.312(a)(1) (access control)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "permission_count", operator: "greater_than", value: 8 }],
      actions: [{ type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "permission_count", label: "Maximum permissions per agent", min: 1, max: 100 },
    },
    {
      key: "hipaa-dangerous-permissions",
      title: "Escalate mass-access permissions",
      description:
        "Permissions permitting bulk read of records conflict with minimum necessary and require "
        + "documented justification.",
      citation: "45 CFR §164.502(b), §164.312(a)(1)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_dangerous_permissions", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "hipaa-credentials",
      title: "Detect credentials that expose PHI systems",
      description:
        "A leaked credential to a system holding PHI is a security incident requiring breach "
        + "assessment.",
      citation: "45 CFR §164.308(a)(6) (security incident procedures)",
      severity: "critical",
      enforcement: "dlp",
      patterns: ["aws-access-key", "gcp-service-key", "github-pat", "jwt", "slack-token"],
    },
    {
      key: "hipaa-audit-controls",
      title: "Audit controls over AI PHI access",
      description:
        "Record and examine activity in systems containing PHI. AI prompt capture and agent "
        + "activity logging provide this evidence.",
      citation: "45 CFR §164.312(b) (audit controls)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Evidence that AI prompt and agent activity logs are retained and reviewed.",
    },
    {
      key: "hipaa-inactive-review",
      title: "Periodic review of dormant agents",
      description:
        "Information system activity review must identify systems no longer in use so their PHI "
        + "access can be withdrawn.",
      citation: "45 CFR §164.308(a)(1)(ii)(D) (information system activity review)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "days_since_last_activity", operator: "greater_than", value: 60 }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
      tunable: { field: "days_since_last_activity", label: "Dormancy before review (days)", min: 7, max: 365 },
    },
    {
      key: "hipaa-risk-analysis",
      title: "Security risk analysis covers AI systems",
      description:
        "The required risk analysis must include AI systems that create, receive, maintain or "
        + "transmit ePHI.",
      citation: "45 CFR §164.308(a)(1)(ii)(A) (risk analysis)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Risk analysis document with an AI systems section and dated review.",
    },
    {
      key: "hipaa-workforce-training",
      title: "Workforce training on AI and PHI",
      description:
        "Workforce members must be trained on what PHI may and may not be entered into AI tools.",
      citation: "45 CFR §164.308(a)(5) (security awareness and training)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Training completion records covering AI-specific PHI handling.",
    },
    {
      key: "hipaa-breach-assessment",
      title: "Breach risk assessment for AI disclosures",
      description:
        "An impermissible disclosure of PHI to an AI service requires a four-factor breach risk "
        + "assessment and possible notification.",
      citation: "45 CFR §164.402 (breach definition), §164.404",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Documented four-factor assessment procedure covering AI disclosures.",
    },
    {
      key: "hipaa-deidentification",
      title: "De-identification before AI processing where feasible",
      description:
        "Where the purpose allows, PHI should be de-identified under Safe Harbor or expert "
        + "determination before being sent to an AI service.",
      citation: "45 CFR §164.514(a)-(b) (de-identification)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Documented de-identification method and the use cases it applies to.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// SOC 2
// ─────────────────────────────────────────────────────────────────────────────
const SOC2: PolicyPack = {
  id: "soc2",
  framework: "SOC 2",
  name: "SOC 2 Trust Services Criteria",
  description:
    "Common Criteria controls for AI systems: logical access, change management, monitoring, "
    + "incident response and vendor risk — the evidence an auditor samples.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    {
      key: "soc2-cc61-access",
      title: "Logical access restricted to authorised agents",
      description:
        "Tenant-wide consent grants access beyond what the role requires and is a common audit "
        + "exception under logical access.",
      citation: "TSC CC6.1 (logical access security)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "consent_type", operator: "equals", value: "AllPrincipals" }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "soc2-cc62-owner",
      title: "Each AI agent has a registered owner",
      description:
        "Access must be authorised by an accountable owner. Unowned agents cannot evidence "
        + "authorisation.",
      citation: "TSC CC6.2 (registration and authorisation)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "soc2-cc63-deprovision",
      title: "Access removed on role change or departure",
      description:
        "Orphaned agents evidence a gap in the deprovisioning control, which auditors test "
        + "directly against leaver lists.",
      citation: "TSC CC6.3 (access removal)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "is_orphaned", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "soc2-cc64-least-privilege",
      title: "Least privilege on AI agent permissions",
      description:
        "Permission counts above the configured threshold indicate privilege beyond need.",
      citation: "TSC CC6.1, CC6.3 (least privilege)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "permission_count", operator: "greater_than", value: 10 }],
      actions: [{ type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "permission_count", label: "Maximum permissions per agent", min: 1, max: 100 },
    },
    {
      key: "soc2-cc67-egress",
      title: "Control external data transmission",
      description:
        "Agents transmitting data outside the boundary need documented review of the transmission "
        + "and its encryption.",
      citation: "TSC CC6.7 (transmission and disposal of information)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_http_connector", operator: "is_true", value: true }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "soc2-cc68-dangerous",
      title: "Detect high-impact permission grants",
      description:
        "Permissions enabling mass data access are a significant risk requiring compensating "
        + "controls.",
      citation: "TSC CC6.8, CC7.1",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_dangerous_permissions", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "soc2-cc71-monitoring",
      title: "Monitor for unauthorised data disclosure",
      description:
        "Detection of secrets and sensitive data leaving via AI services provides monitoring "
        + "evidence for the security-event criterion.",
      citation: "TSC CC7.1–CC7.2 (system monitoring)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["aws-access-key", "gcp-service-key", "github-pat", "gitlab-pat", "openai-api-key", "anthropic-api-key", "jwt", "slack-token"],
    },
    {
      key: "soc2-cc73-stale",
      title: "Identify and retire unused agents",
      description:
        "Dormant agents with live access are an audit finding under system operations.",
      citation: "TSC CC7.3, CC8.1",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "days_since_last_activity", operator: "greater_than", value: 90 }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
      tunable: { field: "days_since_last_activity", label: "Inactivity before retirement (days)", min: 7, max: 730 },
    },
    {
      key: "soc2-cc74-incident",
      title: "Incident response covers AI data exposure",
      description:
        "Security incidents involving AI services must follow the documented response process "
        + "with recorded outcomes.",
      citation: "TSC CC7.4 (incident response)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Incident-response plan naming AI exposure as an incident category, plus ticket history.",
    },
    {
      key: "soc2-cc81-change",
      title: "Change management for AI systems",
      description:
        "Adding or materially changing an AI agent must follow the change-management process with "
        + "approval and rollback.",
      citation: "TSC CC8.1 (change management)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Change tickets for AI agent additions and configuration changes.",
    },
    {
      key: "soc2-cc91-vendor",
      title: "Vendor risk assessment for AI providers",
      description:
        "AI providers are subservice organisations; their SOC 2 report or equivalent must be "
        + "obtained and reviewed.",
      citation: "TSC CC9.1–CC9.2 (vendor and business partner management)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Current SOC 2 report or security review per AI vendor, with review date.",
    },
    {
      key: "soc2-cc21-inventory",
      title: "Maintain a complete AI system inventory",
      description:
        "Auditors test completeness of the system inventory. Discovered-but-unregistered AI "
        + "agents are exceptions.",
      citation: "TSC CC2.1 (information quality), CC3.2",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Reconciliation of discovered AI agents against the approved inventory.",
    },
    {
      key: "soc2-cc51-review",
      title: "Periodic access review of AI agents",
      description:
        "Access rights must be reviewed on a defined cadence, with evidence of who reviewed and "
        + "what changed.",
      citation: "TSC CC5.1–CC5.2 (control activities)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Signed quarterly access-review record covering AI agents.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// CCPA / CPRA
// ─────────────────────────────────────────────────────────────────────────────
const CCPA: PolicyPack = {
  id: "ccpa",
  framework: "CCPA/CPRA",
  name: "California Consumer Privacy Act (as amended by CPRA)",
  description:
    "California consumer personal-information controls for AI: PI detection, do-not-sell/share "
    + "handling, consumer rights and service-provider contracts.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    {
      key: "ccpa-pi-detection",
      title: "Detect California consumer personal information",
      description:
        "Identifiers such as SSN, telephone number and financial account numbers are personal "
        + "information under the CCPA when entered into AI services.",
      citation: "Cal. Civ. Code §1798.140(v) (personal information)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["us-ssn", "us-phone", "credit-card", "iban"],
    },
    {
      key: "ccpa-sensitive-pi",
      title: "Detect sensitive personal information",
      description:
        "SSN and financial account data are sensitive PI, which carries a separate right to limit "
        + "use and disclosure.",
      citation: "Cal. Civ. Code §1798.140(ae) (sensitive PI), §1798.121",
      severity: "critical",
      enforcement: "dlp",
      patterns: ["us-ssn", "credit-card"],
    },
    {
      key: "ccpa-accountable-owner",
      title: "Accountable owner per AI system handling PI",
      description:
        "Responding to consumer requests within statutory deadlines requires a known owner for "
        + "each system holding PI.",
      citation: "Cal. Civ. Code §1798.130 (notice and response obligations)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "ccpa-orphan-access",
      title: "Remove PI access for departed owners",
      description:
        "Orphaned agents retain access to consumer PI with no accountable owner, undermining "
        + "reasonable security.",
      citation: "Cal. Civ. Code §1798.150 (reasonable security)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "is_orphaned", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "ccpa-third-party-egress",
      title: "Flag disclosure of PI to third parties",
      description:
        "Transmitting consumer PI to an external endpoint may constitute a sale or sharing unless "
        + "the recipient is a contracted service provider.",
      citation: "Cal. Civ. Code §1798.115, §1798.140(ad) (sharing)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_http_connector", operator: "is_true", value: true }],
      actions: [{ type: "flag" }, { type: "escalate" }],
      scope: { type: "all" },
    },
    {
      key: "ccpa-purpose-limitation",
      title: "Limit PI collection to disclosed purposes",
      description:
        "Broad tenant-wide access collects PI beyond what is reasonably necessary for the "
        + "disclosed purpose.",
      citation: "Cal. Civ. Code §1798.100(c) (purpose limitation)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "consent_type", operator: "equals", value: "AllPrincipals" }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "ccpa-retention",
      title: "Retain PI no longer than disclosed",
      description:
        "PI must not be kept longer than the disclosed retention period; dormant AI systems "
        + "holding PI should be decommissioned.",
      citation: "Cal. Civ. Code §1798.100(a)(3) (retention disclosure)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "days_since_last_activity", operator: "greater_than", value: 90 }],
      actions: [{ type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "days_since_last_activity", label: "Inactivity before retirement (days)", min: 7, max: 730 },
    },
    {
      key: "ccpa-do-not-sell",
      title: "Do-not-sell/share signal honoured in AI systems",
      description:
        "Opt-out signals, including Global Privacy Control, must propagate to AI systems that "
        + "would otherwise share PI.",
      citation: "Cal. Civ. Code §1798.120, §1798.135 (opt-out)",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Documented flow showing opt-out status reaching each AI system that shares PI.",
    },
    {
      key: "ccpa-service-provider-contract",
      title: "Service-provider contract with each AI vendor",
      description:
        "Without a compliant service-provider contract, disclosing PI to an AI vendor may be a "
        + "sale requiring opt-out.",
      citation: "Cal. Civ. Code §1798.140(ag), §1798.100(d)",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Executed service-provider agreement per AI vendor with CCPA-required terms.",
    },
    {
      key: "ccpa-consumer-rights",
      title: "Consumer rights requests reach AI-held PI",
      description:
        "Know, delete and correct requests must cover PI held in AI systems, including prompt "
        + "logs, within 45 days.",
      citation: "Cal. Civ. Code §1798.105, §1798.106, §1798.110",
      severity: "high",
      enforcement: "attestation",
      evidence: "Rights-request runbook enumerating AI data stores and deletion or correction paths.",
    },
    {
      key: "ccpa-notice-at-collection",
      title: "Notice at collection covers AI processing",
      description:
        "Consumers must be told at collection what PI is collected and that it may be processed "
        + "by AI, with retention periods.",
      citation: "Cal. Civ. Code §1798.100(a) (notice at collection)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Notice-at-collection text referencing AI processing and retention.",
    },
    {
      key: "ccpa-risk-assessment",
      title: "Risk assessment for high-risk AI processing",
      description:
        "Processing that presents significant risk to consumer privacy, including certain "
        + "automated decision-making, requires a documented assessment.",
      citation: "Cal. Civ. Code §1798.185(a)(15) (CPPA risk assessments)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Risk assessment per high-risk AI processing activity, with review date.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// EU AI Act
// ─────────────────────────────────────────────────────────────────────────────
const EU_AI_ACT: PolicyPack = {
  id: "eu-ai-act",
  framework: "EU AI Act",
  name: "EU Artificial Intelligence Act (Reg. 2024/1689)",
  description:
    "Risk-tier obligations for AI systems: prohibited practices, high-risk requirements, "
    + "transparency, human oversight and record-keeping.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    {
      key: "aiact-risk-tier-classification",
      title: "Classify each AI system by risk tier",
      description:
        "Every AI system must be classified as unacceptable, high, limited or minimal risk. The "
        + "tier determines every other obligation.",
      citation: "AI Act Art. 5–6, Annex III",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Risk-tier classification per AI system with written justification.",
    },
    {
      key: "aiact-prohibited-manipulation",
      title: "Detect attempts to bypass AI safeguards",
      description:
        "Prompt-injection and jailbreak attempts indicate manipulation of an AI system's intended "
        + "behaviour and undermine the provider's risk controls.",
      citation: "AI Act Art. 5 (prohibited practices), Art. 15 (robustness)",
      severity: "critical",
      enforcement: "dlp",
      patterns: [
        "injection-ignore-instructions", "injection-system-markers", "injection-override-safety",
        "injection-extract-system", "injection-new-identity", "injection-no-restrictions",
        "jailbreak-dan", "jailbreak-developer-mode", "jailbreak-no-ethics", "jailbreak-bypass-policy",
      ],
    },
    {
      key: "aiact-prohibited-social-scoring",
      title: "No social scoring or biometric categorisation",
      description:
        "Social scoring, emotion inference in work or education, and untargeted facial scraping "
        + "are prohibited outright.",
      citation: "AI Act Art. 5(1) (prohibited practices)",
      severity: "critical",
      enforcement: "attestation",
      evidence: "Attestation that no deployed AI system performs an Art. 5 prohibited practice.",
    },
    {
      key: "aiact-bias-monitoring",
      title: "Monitor for discriminatory AI usage",
      description:
        "High-risk systems must be examined for bias. Detection of demographic comparison and "
        + "stereotype requests provides monitoring signal.",
      citation: "AI Act Art. 10 (data governance), Art. 15",
      severity: "high",
      enforcement: "dlp",
      patterns: ["bias-demographic-comparison", "bias-stereotype-request"],
    },
    {
      key: "aiact-harmful-output-monitoring",
      title: "Monitor for harmful content generation",
      description:
        "Requests for hateful, harmful or self-harm content indicate misuse a deployer must detect "
        + "and act on.",
      citation: "AI Act Art. 26 (deployer obligations)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["toxicity-hate-request", "toxicity-harm-instructions", "toxicity-self-harm", "toxicity-group-attack", "toxicity-explicit-content"],
    },
    {
      key: "aiact-human-oversight",
      title: "Human oversight for high-risk systems",
      description:
        "High-risk AI must be designed so a human can oversee, intervene and stop it. Automatic "
        + "suspension without review is itself a control gap.",
      citation: "AI Act Art. 14 (human oversight)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Named oversight role per high-risk AI system and the intervention procedure.",
    },
    {
      key: "aiact-accountable-deployer",
      title: "Identify the accountable deployer per system",
      description:
        "Deployer obligations attach to a person. Unowned AI agents have no accountable deployer.",
      citation: "AI Act Art. 26 (obligations of deployers)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "aiact-orphan-oversight",
      title: "No high-risk system without an overseer",
      description:
        "An orphaned agent operates without human oversight, which is not permissible for "
        + "high-risk systems.",
      citation: "AI Act Art. 14, Art. 26",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "is_orphaned", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "suspend" }],
      scope: { type: "all" },
    },
    {
      key: "aiact-record-keeping",
      title: "Automatic logging retained for traceability",
      description:
        "Deployers must keep logs generated by high-risk AI systems for at least six months to "
        + "support traceability.",
      citation: "AI Act Art. 12 (record-keeping), Art. 26(6)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Log-retention configuration for AI systems showing at least six months.",
    },
    {
      key: "aiact-transparency-disclosure",
      title: "Disclose AI interaction to people",
      description:
        "People must be informed when interacting with an AI system, and synthetic content must "
        + "be marked as such.",
      citation: "AI Act Art. 50 (transparency obligations)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Disclosure text or UI evidence per user-facing AI system.",
    },
    {
      key: "aiact-fria",
      title: "Fundamental Rights Impact Assessment for high-risk use",
      description:
        "Certain deployers of high-risk AI must complete a FRIA before first use and update it "
        + "when the use changes.",
      citation: "AI Act Art. 27 (FRIA)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Completed FRIA per applicable high-risk system, with date and author.",
    },
    {
      key: "aiact-ai-literacy",
      title: "AI literacy for staff operating AI systems",
      description:
        "Providers and deployers must ensure staff have sufficient AI literacy for their role.",
      citation: "AI Act Art. 4 (AI literacy)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Training records covering AI literacy for relevant staff.",
    },
    {
      key: "aiact-data-governance",
      title: "Data governance for high-risk training and input data",
      description:
        "Training, validation and input data must be relevant, representative and examined for "
        + "bias.",
      citation: "AI Act Art. 10 (data and data governance)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Data-governance record per high-risk system covering provenance and bias review.",
    },
    {
      key: "aiact-serious-incident",
      title: "Serious incident reporting process",
      description:
        "Deployers must report serious incidents involving high-risk AI to the provider and the "
        + "relevant authority.",
      citation: "AI Act Art. 73 (reporting of serious incidents)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Incident procedure naming the reporting route and deadlines.",
    },
    {
      key: "aiact-gpai-inventory",
      title: "Record general-purpose AI models in use",
      description:
        "Deployers should record which GPAI models they rely on, since obligations flow from the "
        + "provider's documentation.",
      citation: "AI Act Ch. V (general-purpose AI models)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Inventory of GPAI models in use with provider documentation references.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// ISO/IEC 42001
// ─────────────────────────────────────────────────────────────────────────────
const ISO42001: PolicyPack = {
  id: "iso-42001",
  framework: "ISO/IEC 42001",
  name: "ISO/IEC 42001 AI Management System",
  description:
    "AI management system controls: AI policy, roles, risk and impact assessment, lifecycle "
    + "management, data governance and performance monitoring.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    {
      key: "iso-ai-policy",
      title: "Documented AI policy approved by management",
      description:
        "The organisation must establish an AI policy appropriate to its purpose and have it "
        + "approved by top management.",
      citation: "ISO/IEC 42001 Cl. 5.2, A.2",
      severity: "high",
      enforcement: "attestation",
      evidence: "Approved AI policy document with version and approval date.",
    },
    {
      key: "iso-roles",
      title: "Defined AI roles and responsibilities",
      description:
        "Responsibilities for AI systems must be assigned and communicated, including ownership "
        + "of each system.",
      citation: "ISO/IEC 42001 Cl. 5.3, A.3",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "iso-inventory",
      title: "Maintain an inventory of AI systems",
      description:
        "An AI management system requires a current record of AI systems within scope, including "
        + "shadow AI discovered in use.",
      citation: "ISO/IEC 42001 A.4 (AI system inventory)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "AI system inventory reconciled against discovery output, with review date.",
    },
    {
      key: "iso-risk-assessment",
      title: "AI risk assessment performed and maintained",
      description:
        "Risks to and from AI systems must be assessed at planned intervals and after "
        + "significant change.",
      citation: "ISO/IEC 42001 Cl. 6.1, A.5",
      severity: "high",
      enforcement: "attestation",
      evidence: "AI risk register with assessment dates and treatment decisions.",
    },
    {
      key: "iso-impact-assessment",
      title: "AI system impact assessment on individuals and society",
      description:
        "The organisation must assess potential consequences of AI systems for individuals and "
        + "groups, not only for itself.",
      citation: "ISO/IEC 42001 A.5.2 (AI system impact assessment)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Impact assessment per AI system covering affected individuals and groups.",
    },
    {
      key: "iso-lifecycle-retirement",
      title: "Manage AI systems through to retirement",
      description:
        "Lifecycle management includes decommissioning. Dormant systems retaining access "
        + "indicate the retirement stage is not being applied.",
      citation: "ISO/IEC 42001 A.6 (AI system lifecycle)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "days_since_last_activity", operator: "greater_than", value: 120 }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
      tunable: { field: "days_since_last_activity", label: "Dormancy before retirement review (days)", min: 30, max: 730 },
    },
    {
      key: "iso-access-control",
      title: "Control access granted to AI systems",
      description:
        "Access rights of AI systems must be limited to what the intended use requires.",
      citation: "ISO/IEC 42001 A.7 (data and access controls)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "consent_type", operator: "equals", value: "AllPrincipals" }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "iso-privilege-breadth",
      title: "Review AI systems with broad privilege",
      description:
        "Systems holding many permissions require documented justification against intended use.",
      citation: "ISO/IEC 42001 A.7",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "permission_count", operator: "greater_than", value: 12 }],
      actions: [{ type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "permission_count", label: "Maximum permissions per agent", min: 1, max: 100 },
    },
    {
      key: "iso-data-governance",
      title: "Data governance for AI systems",
      description:
        "Data used by AI systems must be managed for quality, provenance and appropriate use, "
        + "including what leaves the organisation.",
      citation: "ISO/IEC 42001 A.7.4–A.7.6 (data for AI systems)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["us-ssn", "credit-card", "iban", "cloudfuze-customer-id", "internal-jira-key"],
    },
    {
      key: "iso-third-party",
      title: "Manage third-party AI providers",
      description:
        "Responsibilities must be allocated and monitored where AI systems or components come "
        + "from third parties.",
      citation: "ISO/IEC 42001 A.10 (third-party relationships)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Per-provider record of allocated responsibilities and monitoring evidence.",
    },
    {
      key: "iso-performance-monitoring",
      title: "Monitor AI system performance against objectives",
      description:
        "The organisation must evaluate whether AI systems meet their stated objectives and act "
        + "on deviations.",
      citation: "ISO/IEC 42001 Cl. 9.1 (monitoring and measurement)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Monitoring records with objectives, measures and corrective actions.",
    },
    {
      key: "iso-incident-response",
      title: "Respond to AI incidents and nonconformity",
      description:
        "Incidents involving AI systems must be handled, with root cause addressed and "
        + "corrective action recorded.",
      citation: "ISO/IEC 42001 Cl. 10.2, A.9",
      severity: "high",
      enforcement: "attestation",
      evidence: "Nonconformity and corrective-action log covering AI incidents.",
    },
    {
      key: "iso-internal-audit",
      title: "Internal audit of the AI management system",
      description:
        "Internal audits at planned intervals must confirm the AI management system conforms and "
        + "is effective.",
      citation: "ISO/IEC 42001 Cl. 9.2 (internal audit)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Internal audit programme and latest AI management system audit report.",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// NIST AI RMF
//
// Structured around the framework's four core functions — GOVERN, MAP, MEASURE,
// MANAGE — and cited to subcategory so an assessor can trace each rule. Unlike
// GDPR or HIPAA this is voluntary guidance rather than law, so nothing here is a
// legal obligation; it is the framework most US enterprises and federal buyers
// ask to be measured against.
// ─────────────────────────────────────────────────────────────────────────────
const NIST_AI_RMF: PolicyPack = {
  id: "nist-ai-rmf",
  framework: "NIST AI RMF",
  name: "NIST AI Risk Management Framework 1.0 (AI 100-1)",
  description:
    "Voluntary US framework for trustworthy AI, organised as GOVERN, MAP, MEASURE and MANAGE: "
    + "AI inventory and accountability, risk mapping, security, privacy and bias measurement, "
    + "and post-deployment monitoring with the ability to deactivate a system.",
  version: 1,
  versionNotes: "Initial pack.",
  rules: [
    // ── GOVERN ──────────────────────────────────────────────────────────────
    {
      key: "nist-govern-2-1-accountability",
      title: "Every AI system has documented accountability",
      description:
        "Roles and responsibilities for AI systems must be documented and clear. An agent with no "
        + "owner has no accountable actor, which undermines every other control in the framework.",
      citation: "NIST AI RMF GOVERN 2.1 (roles and responsibilities)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_owner", operator: "is_false", value: false }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "nist-govern-1-6-inventory",
      title: "Maintain an inventory of AI systems in use",
      description:
        "An organisation-wide AI inventory must be established and kept current, including systems "
        + "discovered in use but never formally registered.",
      citation: "NIST AI RMF GOVERN 1.6 (AI system inventory)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "AI inventory reconciled against discovery output, with a review date and owner.",
    },
    {
      key: "nist-govern-1-1-legal",
      title: "Legal and regulatory requirements identified per AI system",
      description:
        "The legal and regulatory requirements that apply to each AI system must be understood, "
        + "documented and managed — not assumed.",
      citation: "NIST AI RMF GOVERN 1.1 (legal and regulatory requirements)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Per-system record of applicable regulations and who confirmed them.",
    },
    {
      key: "nist-govern-1-3-risk-tolerance",
      title: "Escalate systems outside organisational risk tolerance",
      description:
        "Risk management processes must reflect a stated risk tolerance. Agents scoring below the "
        + "configured threshold exceed it and require documented treatment or acceptance.",
      citation: "NIST AI RMF GOVERN 1.3, MAP 1.5 (risk tolerance)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "risk_score", operator: "less_than", value: 40 }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "risk_score", label: "Escalate below risk score", min: 1, max: 99 },
    },
    {
      key: "nist-govern-3-2-human-oversight",
      title: "Human oversight defined for AI configurations",
      description:
        "Policies must address human-AI configurations and oversight, so a person can intervene in "
        + "an AI system's operation.",
      citation: "NIST AI RMF GOVERN 3.2, MAP 3.5 (human oversight)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Named oversight role per AI system and the documented intervention route.",
    },
    {
      key: "nist-govern-2-2-training",
      title: "AI risk management training for relevant staff",
      description:
        "Personnel and partners involved with AI systems must receive training appropriate to their "
        + "role and the risks involved.",
      citation: "NIST AI RMF GOVERN 2.2 (training)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Training completion records covering AI risk for relevant roles.",
    },
    {
      key: "nist-govern-6-1-third-party",
      title: "Review broad third-party AI access",
      description:
        "Risks arising from third-party AI software and data must be addressed by policy. "
        + "Organisation-wide consent grants a third-party system access well beyond a single "
        + "reviewed use case.",
      citation: "NIST AI RMF GOVERN 6.1 (third-party risk)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "consent_type", operator: "equals", value: "AllPrincipals" }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "nist-govern-6-2-contingency",
      title: "Contingency plan for third-party AI failure",
      description:
        "Contingency processes must exist for incidents or failures in third-party AI data or "
        + "software the organisation depends on.",
      citation: "NIST AI RMF GOVERN 6.2 (contingency for third-party failure)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Documented fallback for each critical third-party AI dependency.",
    },

    // ── MAP ─────────────────────────────────────────────────────────────────
    {
      key: "nist-map-1-1-purpose",
      title: "Intended purpose and context documented per system",
      description:
        "The intended purpose, setting and expected users of each AI system must be established and "
        + "understood before deployment.",
      citation: "NIST AI RMF MAP 1.1 (intended purpose and context)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Purpose-and-context statement per AI system, reviewed by its owner.",
    },
    {
      key: "nist-map-2-2-limitations",
      title: "Known limitations of each AI system documented",
      description:
        "The boundaries of what a system can reliably do — and where it is known to fail — must be "
        + "documented so users are not relying on it beyond its competence.",
      citation: "NIST AI RMF MAP 2.2 (knowledge limits)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Documented limitations and failure modes per AI system.",
    },
    {
      key: "nist-map-4-1-excess-privilege",
      title: "Map and constrain excessive AI system privilege",
      description:
        "Risks from third-party components must be mapped, including the access those components "
        + "hold. Flag agents holding more permissions than their mapped purpose requires.",
      citation: "NIST AI RMF MAP 4.1, MAP 4.2 (third-party risk mapping)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "permission_count", operator: "greater_than", value: 10 }],
      actions: [{ type: "flag" }],
      scope: { type: "all" },
      tunable: { field: "permission_count", label: "Maximum permissions per agent", min: 1, max: 100 },
    },

    // ── MEASURE ─────────────────────────────────────────────────────────────
    {
      key: "nist-measure-2-7-security",
      title: "Evaluate AI system security and resilience",
      description:
        "Security and resilience must be measured, including attempts to manipulate a system's "
        + "intended behaviour. Prompt-injection and jailbreak attempts are that signal.",
      citation: "NIST AI RMF MEASURE 2.7 (security and resilience)",
      severity: "critical",
      enforcement: "dlp",
      patterns: [
        "injection-ignore-instructions", "injection-system-markers", "injection-override-safety",
        "injection-extract-system", "injection-new-identity", "injection-no-restrictions",
        "jailbreak-dan", "jailbreak-developer-mode", "jailbreak-no-ethics", "jailbreak-bypass-policy",
      ],
    },
    {
      key: "nist-measure-2-10-privacy",
      title: "Examine privacy risk of AI system use",
      description:
        "Privacy risk must be examined and documented. Detection of personal identifiers and "
        + "credentials entering AI services provides the measurement.",
      citation: "NIST AI RMF MEASURE 2.10 (privacy risk)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["us-ssn", "credit-card", "iban", "us-phone", "aws-access-key", "github-pat", "jwt"],
    },
    {
      key: "nist-measure-2-11-bias",
      title: "Evaluate AI system fairness and bias",
      description:
        "Fairness and bias must be evaluated and results documented. Requests comparing "
        + "demographics or seeking stereotypes are a measurable signal of biased usage.",
      citation: "NIST AI RMF MEASURE 2.11 (fairness and bias)",
      severity: "high",
      enforcement: "dlp",
      patterns: ["bias-demographic-comparison", "bias-stereotype-request"],
    },
    {
      key: "nist-measure-2-6-safety",
      title: "Evaluate AI system safety risks",
      description:
        "Safety risks must be evaluated. Requests for harmful, hateful or self-harm content "
        + "indicate unsafe usage a deployer is expected to detect and act on.",
      citation: "NIST AI RMF MEASURE 2.6 (safety)",
      severity: "critical",
      enforcement: "dlp",
      patterns: [
        "toxicity-hate-request", "toxicity-harm-instructions", "toxicity-self-harm",
        "toxicity-group-attack", "toxicity-explicit-content",
      ],
    },
    {
      key: "nist-measure-2-8-egress-transparency",
      title: "Examine accountability for external data flows",
      description:
        "Risks to transparency and accountability must be examined. An agent transmitting data "
        + "outside the organisation needs a documented, reviewed justification.",
      citation: "NIST AI RMF MEASURE 2.8 (transparency and accountability)",
      severity: "high",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "has_http_connector", operator: "is_true", value: true }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
    },
    {
      key: "nist-measure-3-1-tracking",
      title: "Track identified AI risks over time",
      description:
        "Approaches for tracking identified risks must be in place, so risk treatment can be shown "
        + "to have progressed rather than merely been recorded once.",
      citation: "NIST AI RMF MEASURE 3.1 (risk tracking)",
      severity: "medium",
      enforcement: "attestation",
      evidence: "Risk register showing status changes over time for AI-related risks.",
    },

    // ── MANAGE ──────────────────────────────────────────────────────────────
    {
      key: "nist-manage-2-4-deactivate",
      title: "Ability to deactivate an AI system that should not run",
      description:
        "Mechanisms must exist to supersede, disengage or deactivate an AI system. An orphaned "
        + "agent — its owner gone, still holding access — is the case this control exists for.",
      citation: "NIST AI RMF MANAGE 2.4 (deactivation mechanisms)",
      severity: "critical",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "is_orphaned", operator: "is_true", value: true }],
      actions: [{ type: "escalate" }, { type: "flag" }],
      scope: { type: "all" },
    },
    {
      key: "nist-manage-4-1-monitoring",
      title: "Post-deployment monitoring of AI systems in use",
      description:
        "Monitoring plans must be applied after deployment. An agent dormant beyond the configured "
        + "period while retaining access is unmonitored risk and should be reviewed or retired.",
      citation: "NIST AI RMF MANAGE 4.1 (post-deployment monitoring)",
      severity: "medium",
      enforcement: "agent",
      type: "compliance",
      conditions: [{ field: "days_since_last_activity", operator: "greater_than", value: 90 }],
      actions: [{ type: "flag" }, { type: "notify" }],
      scope: { type: "all" },
      tunable: { field: "days_since_last_activity", label: "Dormancy before review (days)", min: 7, max: 730 },
    },
    {
      key: "nist-manage-1-2-prioritise",
      title: "Prioritise and treat documented AI risks",
      description:
        "Documented risks must be prioritised and their treatment planned, with residual risk "
        + "explicitly accepted rather than left implicit.",
      citation: "NIST AI RMF MANAGE 1.2, MANAGE 1.4 (risk treatment and residual risk)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Prioritised risk treatment plan, including accepted residual risks and approver.",
    },
    {
      key: "nist-manage-4-3-incidents",
      title: "Communicate AI incidents to affected parties",
      description:
        "Incidents and negative impacts must be communicated to the AI actors who need to know, "
        + "including affected users and third-party providers.",
      citation: "NIST AI RMF MANAGE 4.3 (incident communication)",
      severity: "high",
      enforcement: "attestation",
      evidence: "Incident communication procedure naming recipients and timelines.",
    },
  ],
};

export const POLICY_PACKS: PolicyPack[] = [
  GDPR, HIPAA, SOC2, CCPA, EU_AI_ACT, ISO42001, NIST_AI_RMF,
];

export function getPack(id: string): PolicyPack | undefined {
  return POLICY_PACKS.find((p) => p.id === id);
}

/**
 * Guard against silently-dead rules.
 *
 * An `agent` rule whose condition field is not one policyEngine.resolveField()
 * understands never fires: resolveField returns undefined, the comparison fails,
 * and the rule looks deployed while enforcing nothing. Likewise a `dlp` rule
 * naming a pattern the extension does not define can never be satisfied. Both are
 * caught here rather than in production.
 */
export function validatePacks(): string[] {
  const problems: string[] = [];
  const fields = new Set<string>(AGENT_FIELDS);
  const patterns = new Set<string>(DLP_PATTERNS);
  const seenPackIds = new Set<string>();

  for (const pack of POLICY_PACKS) {
    if (seenPackIds.has(pack.id)) problems.push(`duplicate pack id: ${pack.id}`);
    seenPackIds.add(pack.id);

    const seenKeys = new Set<string>();
    for (const rule of pack.rules) {
      if (seenKeys.has(rule.key)) problems.push(`${pack.id}: duplicate rule key ${rule.key}`);
      seenKeys.add(rule.key);

      if (rule.enforcement === "agent") {
        if (!rule.conditions?.length) {
          problems.push(`${pack.id}/${rule.key}: agent rule has no conditions`);
        }
        for (const c of rule.conditions || []) {
          if (!fields.has(c.field)) {
            problems.push(`${pack.id}/${rule.key}: unknown agent field "${c.field}" — would never fire`);
          }
        }
        if (!rule.actions?.length) {
          problems.push(`${pack.id}/${rule.key}: agent rule has no actions`);
        }
        if (rule.tunable && !(rule.conditions || []).some((c) => c.field === rule.tunable!.field)) {
          problems.push(`${pack.id}/${rule.key}: tunable field "${rule.tunable.field}" is not in conditions`);
        }
      }

      if (rule.enforcement === "dlp") {
        if (!rule.patterns?.length) {
          problems.push(`${pack.id}/${rule.key}: dlp rule names no patterns`);
        }
        for (const p of rule.patterns || []) {
          if (!patterns.has(p)) {
            problems.push(`${pack.id}/${rule.key}: unknown DLP pattern "${p}"`);
          }
        }
      }

      if (rule.enforcement === "attestation" && !rule.evidence) {
        problems.push(`${pack.id}/${rule.key}: attestation rule states no evidence`);
      }
    }
  }
  return problems;
}

/** Counts used by the pack list, so the UI does not have to derive them. */
export function packSummary(pack: PolicyPack) {
  const byEnforcement = { agent: 0, dlp: 0, attestation: 0 } as Record<EnforcementSurface, number>;
  for (const r of pack.rules) byEnforcement[r.enforcement]++;
  return {
    ruleCount: pack.rules.length,
    enforceable: byEnforcement.agent,      // automatically evaluated today
    monitored: byEnforcement.dlp,          // detected client-side, verifiable
    attestations: byEnforcement.attestation,
    byEnforcement,
  };
}
