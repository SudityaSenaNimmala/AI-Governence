// ═════════════════════════════════════════════════════════════════════
// Vantage Health Group — Google Cloud / Workspace demo data
//
// Platforms covered:
//   agent_builder       — Vertex AI Agent Builder (conversational agents)
//   gemini_gems         — Gemini Gems (custom-instructed Gemini personas)
//   notebook_lm         — NotebookLM research & summarization notebooks
//   google_chat_bots    — Google Chat / Workspace chat bots
//   reasoning_engines   — Vertex AI Reasoning Engines (LangGraph / tool-use)
//
// ─── RISK SCORING — GOOGLE WORKSPACE ────────────────────────────────
// Uses the same calculator methodology as the Microsoft side of the
// demo. Each risk factor is a signal drawn from the Google-Workspace /
// GCP signal library below. Signals are tiered by impact:
//
//   weight    │ penalty points
//   ──────────┼────────────────
//   critical  │ 25   (e.g. Drive tenant-wide read, chat.bot tenant-wide,
//             │      PHI decisioning output, orphaned owner)
//   high      │ 15   (e.g. Gemini 2.0 Pro on PHI, BigQuery financial
//             │      dataset read, no human-review gate)
//   medium    │  8   (e.g. CMEK not enforced, SA key > 90d, high
//             │      invocation volume, shared-drive read)
//   low       │  3   (e.g. public-only corpus, internal-ops scope,
//             │      human-review gate in place)
//
//   agent_score = max(0, 100 - Σ penalty(signal))
//
//   Level buckets (same as Microsoft):
//      score ≤ 25  → critical
//      score ≤ 50  → high
//      score ≤ 75  → medium
//      score ≤ 100 → low
//
// Every signal description below names the real Google Workspace /
// Vertex AI / GCP artefact that drove the signal (Drive scope, IAM
// role, Vertex endpoint, VPC-SC, CMEK, DLP, Pub/Sub topic, etc.) so a
// reviewer can trace the score back to something actionable.
// ═════════════════════════════════════════════════════════════════════

const now = new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

// ─── Scoring calculator ─────────────────────────────────────────────

export const GW_RISK_WEIGHTS = { critical: 25, high: 15, medium: 8, low: 3 };

export function scoreGoogleAgent(factors = []) {
  const penalty = factors.reduce(
    (sum, f) => sum + (GW_RISK_WEIGHTS[f.weight] || 0),
    0
  );
  const score = Math.max(0, 100 - penalty);
  const level =
    score <= 25 ? "critical" :
      score <= 50 ? "high" :
        score <= 75 ? "medium" : "low";
  return { score, level, penalty };
}

// Human-readable methodology summary, consumed by the Discovery tab's
// "How is this scored?" explainer.
export const GW_RISK_METHODOLOGY = {
  platform: "Google Cloud + Workspace",
  formula: "score = max(0, 100 − Σ penalty(signal))",
  weights: GW_RISK_WEIGHTS,
  buckets: {
    critical: "0–25",
    high: "26–50",
    medium: "51–75",
    low: "76–100",
  },
  categories: [
    {
      name: "Workspace data scope",
      description:
        "Google Drive / Gmail / Chat / Calendar OAuth scopes granted to the agent's service account.",
      examples: [
        "drive.readonly at the tenant level (critical)",
        "gmail.send on a shared mailbox (high)",
        "chat.bot installable tenant-wide (critical)",
        "calendar.events write on user calendars (medium)",
      ],
    },
    {
      name: "GCP data & IAM scope",
      description:
        "Vertex AI endpoints, BigQuery datasets, Cloud Storage buckets, Pub/Sub topics, and the IAM roles granted to the agent.",
      examples: [
        "bigquery.dataViewer on a PHI dataset (critical)",
        "storage.objectAdmin on a production bucket (high)",
        "pubsub.subscriber on a vitals topic (high)",
        "Vertex endpoint not inside a VPC-SC perimeter (high)",
        "CMEK not enforced on the source dataset (medium)",
      ],
    },
    {
      name: "Model & usage",
      description:
        "Which Gemini model the agent calls, and how intensively.",
      examples: [
        "Gemini 2.0 Pro invoked against identified patient data (high)",
        "Gemini 2.0 Flash on public/advisory content (low)",
        "Over 10,000 invocations in the last 30 days (medium)",
      ],
    },
    {
      name: "Output & governance",
      description:
        "Downstream impact of the model output and whether a human review gate exists.",
      examples: [
        "Clinical / prescribing decisions (critical)",
        "Financial / regulatory output (critical)",
        "Employment-decision inputs (high)",
        "No human-review gate on the output (high)",
        "Clinician sign-off required on every output (low)",
        "Orphaned owner — Google account disabled (critical)",
      ],
    },
  ],
};

// ─── Demo Google agents ─────────────────────────────────────────────

export const DEMO_GOOGLE_AGENTS = [
  // ─── Critical risk (7) ─────────────────────────────────────────────
  {
    id: "re-chronic-care-nav-001", appId: "gcp-001-chronic-care",
    name: "Chronic Care Navigator",
    description: "Coordinates long-term care plans for diabetic and cardiac patients by correlating EHR vitals, labs, and medication adherence.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(190), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Epic EHR API", type: "HTTP" }, { name: "Adherence BigQuery", type: "BigQuery" }, { name: "Home Monitoring IoT Stream", type: "PubSub" }, { name: "Care Plan Templates Drive", type: "Drive" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer", "pubsub.subscriber", "drive.readonly"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-001", displayName: "Ananya Rao", userPrincipalName: "a.rao@vantagehealth.com", accountEnabled: false },
    risk: {
      score: 12, level: "critical",
      factors: [
        { signal: "Clinical decisioning output", weight: "critical", description: "Reasoning engine drafts adjusted care-plan changes that flow back into Epic as orders" },
        { signal: "BigQuery — PHI dataset read", weight: "critical", description: "bigquery.dataViewer on adherence dataset containing 120k identified chronic-care patients" },
        { signal: "Pub/Sub — PHI topic subscriber", weight: "high", description: "pubsub.subscriber on the home-monitoring vitals topic (glucose / BP / HR streams)" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "High-capability Vertex model invoked directly against identified patient data" },
        { signal: "High invocation volume", weight: "medium", description: "9,200 invocations in the last 30 days against a PHI dataset" },
      ],
      recommendations: [
        "Place the Vertex endpoint inside a VPC Service Controls perimeter covering the adherence BigQuery dataset",
        "Enforce CMEK on the BigQuery export and on the Pub/Sub topic",
        "Require physician co-sign on every care-plan change before it's written back to Epic",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 32400, invocationsLast7Days: 2400, invocationsLast30Days: 9200, invocationsLast90Days: 27800, uniqueUsers: 184, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "a.rao@vantagehealth.com", displayName: "Ananya Rao", invocationCount: 420, lastActivity: daysAgo(0) }, { userPrincipalName: "t.kumar@vantagehealth.com", displayName: "Tarun Kumar", invocationCount: 280, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-allergy-screen-002", appId: "gcp-002-allergy-screen",
    name: "Allergy Risk Screener",
    description: "Evaluates drug-allergen exposure risk before a prescription is issued; escalates high-risk cases to the on-call pharmacist.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(150), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Epic EHR API", type: "HTTP" }, { name: "Allergen Ontology API", type: "HTTP" }],
    permissions: ["aiplatform.user", "secretmanager.secretAccessor"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-002", displayName: "Marcus Bell", userPrincipalName: "m.bell@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 15, level: "critical",
      factors: [
        { signal: "Clinical decisioning output", weight: "critical", description: "Model output blocks or gates prescription writes in the eRx flow" },
        { signal: "EHR — PHI read via service account", weight: "critical", description: "Agent's service account reads identified allergy & medication lists from Epic" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "Gemini 2.0 Pro invoked against identified patient data on every prescription" },
        { signal: "No VPC-SC perimeter", weight: "high", description: "Vertex endpoint is not enclosed in a VPC Service Controls perimeter" },
        { signal: "High invocation volume", weight: "medium", description: "17,800 invocations in the last 30 days — highest PHI-touching agent in the tenant" },
      ],
      recommendations: [
        "Enforce a human pharmacist veto on every high-risk output",
        "Wrap the Vertex endpoint in a VPC-SC perimeter and pin secretmanager access to the same perimeter",
        "Regression-test weekly against a pharmacist-reviewed gold dataset",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 58400, invocationsLast7Days: 4600, invocationsLast30Days: 17800, invocationsLast90Days: 51200, uniqueUsers: 240, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "m.bell@vantagehealth.com", displayName: "Marcus Bell", invocationCount: 520, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-oncology-biomarker-003", appId: "gcp-003-onco-biomarker",
    name: "Oncology Biomarker Explorer",
    description: "NotebookLM notebook curating tumor biomarker studies across 12k patients for the precision-oncology service line.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(210), lastModified: daysAgo(4), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Tumor Registry Drive", type: "Drive" }, { name: "PubMed Oncology Feed", type: "HTTP" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-003", displayName: "Priya Desai", userPrincipalName: "p.desai@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 20, level: "critical",
      factors: [
        { signal: "Drive — identifiable tumor registry index", weight: "critical", description: "NotebookLM corpus contains identified tumor-registry documents covered by HIPAA + state cancer-registry rules" },
        { signal: "Drive — shared-drive wide read scope", weight: "high", description: "drive.readonly spans the Oncology shared drives rather than a registry-specific sub-folder" },
        { signal: "External research feed in corpus", weight: "high", description: "PubMed oncology feed is blended with identified registry data — prompts can mix internal & external content" },
        { signal: "Notebook link-sharing drift", weight: "medium", description: "Notebook has been link-shared outside the precision-oncology group in the past 30 days" },
      ],
      recommendations: [
        "Narrow drive.readonly to a dedicated 'Tumor Registry — Indexed' shared drive and move everything else out",
        "Revoke any Anyone-with-link shares; restrict access to the precision-oncology Google Group",
        "Turn on Workspace data-loss-prevention scanning on the source drive",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 9800, invocationsLast7Days: 720, invocationsLast30Days: 2800, invocationsLast90Days: 8400, uniqueUsers: 62, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "p.desai@vantagehealth.com", displayName: "Priya Desai", invocationCount: 210, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-genomic-variant-004", appId: "gcp-004-genomic-variant",
    name: "Genomic Variant Classifier",
    description: "Classifies germline variants into ACMG tiers to support hereditary-risk counseling.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(205), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Variant BigQuery", type: "BigQuery" }, { name: "ClinVar Mirror", type: "HTTP" }, { name: "Epic EHR API", type: "HTTP" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer", "drive.readonly"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-004", displayName: "Elena Martinez", userPrincipalName: "e.martinez@vantagehealth.com", accountEnabled: false },
    risk: {
      score: 18, level: "critical",
      factors: [
        { signal: "BigQuery — genetic PHI read", weight: "critical", description: "bigquery.dataViewer on the variant dataset — identifiable germline data covered by GINA + HIPAA" },
        { signal: "Clinical decisioning output", weight: "critical", description: "Output directly seeds hereditary-risk counseling and follow-up testing" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "Gemini 2.0 Pro classifies every variant against identified patient context" },
        { signal: "CMEK not enforced", weight: "medium", description: "Variant BigQuery dataset uses default Google-managed keys rather than CMEK" },
      ],
      recommendations: [
        "Enable CMEK with column-level encryption on the variant BigQuery dataset",
        "Require a genetic counselor to sign off on every tier classification before it's surfaced in Epic",
        "Log every BigQuery row read via Cloud Audit Logs for chain-of-custody",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 6200, invocationsLast7Days: 420, invocationsLast30Days: 1800, invocationsLast90Days: 5400, uniqueUsers: 38, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "e.martinez@vantagehealth.com", displayName: "Elena Martinez", invocationCount: 180, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-pop-risk-stratify-005", appId: "gcp-005-pop-risk",
    name: "Population Risk Stratifier",
    description: "Stratifies 1.4M covered lives into readmission and adverse-event risk tiers for care management.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(260), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Population Health BigQuery", type: "BigQuery" }, { name: "Claims Warehouse", type: "BigQuery" }, { name: "Social Determinants Index", type: "HTTP" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-005", displayName: "Felix Hoang", userPrincipalName: "f.hoang@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 10, level: "critical",
      factors: [
        { signal: "BigQuery — PHI read at population scale", weight: "critical", description: "bigquery.dataViewer on Population Health + Claims Warehouse — 1.4M identified members" },
        { signal: "Fairness / discrimination risk", weight: "critical", description: "Risk-tier features can proxy for protected classes and drive differential care management" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "Gemini 2.0 Pro invoked against identified member records" },
        { signal: "Consumed org-wide", weight: "high", description: "Case management, actuarial, and network teams all consume outputs — blast radius is enterprise-wide" },
        { signal: "No VPC-SC perimeter", weight: "medium", description: "Vertex endpoint is outside a VPC-SC perimeter that covers both source datasets" },
      ],
      recommendations: [
        "Run quarterly fairness audits across protected classes and publish results to the Privacy Office",
        "Enclose Vertex endpoint + both BigQuery datasets in a single VPC-SC perimeter",
        "Disallow use of stratification scores outside of care-management workflows via IAM Conditions",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 18400, invocationsLast7Days: 1200, invocationsLast30Days: 4800, invocationsLast90Days: 14600, uniqueUsers: 42, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "f.hoang@vantagehealth.com", displayName: "Felix Hoang", invocationCount: 260, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-charge-capture-006", appId: "gcp-006-charge-capture",
    name: "Charge Capture Auditor",
    description: "Audits daily charge capture files to find missing or downcoded procedures before claim submission.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(220), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Revenue Cycle BigQuery", type: "BigQuery" }, { name: "Coding Rules Drive", type: "Drive" }, { name: "EHR Billing API", type: "HTTP" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer", "drive.readonly"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-006", displayName: "Nadia Okafor", userPrincipalName: "n.okafor@vantagehealth.com", accountEnabled: false },
    risk: {
      score: 22, level: "critical",
      factors: [
        { signal: "Financial / regulatory output", weight: "critical", description: "Suggested CPT / ICD edits flow directly into the claim submission file" },
        { signal: "BigQuery — full charge detail read", weight: "critical", description: "bigquery.dataViewer on the Revenue Cycle dataset — contains every patient encounter's charges" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "Gemini 2.0 Pro scores identified encounters on every daily batch" },
        { signal: "Broad tenant consent", weight: "medium", description: "Consent granted as AllPrincipals — any authenticated caller can invoke the endpoint" },
      ],
      recommendations: [
        "Require a certified coder sign-off on every suggested edit before submission",
        "Retain a 7-year audit trail of every row read and every recommendation via Cloud Audit Logs",
        "Downgrade consent from AllPrincipals to the Revenue Cycle Google Group",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 42000, invocationsLast7Days: 3200, invocationsLast30Days: 12600, invocationsLast90Days: 36400, uniqueUsers: 68, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "n.okafor@vantagehealth.com", displayName: "Nadia Okafor", invocationCount: 480, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-hipaa-exposure-007", appId: "gcp-007-hipaa-exposure",
    name: "HIPAA Exposure Scanner",
    description: "Continuously scans shared drives and Chat channels for PHI that has been shared outside of approved compliance boundaries.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(210), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: true,
    connectors: [{ name: "Google Drive — Tenant-wide", type: "Drive" }, { name: "Google Chat API", type: "HTTP" }, { name: "DLP API", type: "HTTP" }],
    permissions: ["drive.readonly", "chat.bot", "chat.spaces.readonly", "dlp.user"], environment: "vantage-workspace", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-007", displayName: "Olivia Chen", userPrincipalName: "o.chen@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 14, level: "critical",
      factors: [
        { signal: "Drive — tenant-wide read", weight: "critical", description: "drive.readonly granted at the Workspace tenant level — reads every document in every My Drive and every shared drive" },
        { signal: "Chat — tenant-wide install", weight: "critical", description: "chat.bot installable by any user across the Workspace; scans every Chat space" },
        { signal: "DLP — tenant-wide inspection", weight: "critical", description: "dlp.user lets the service account read content from every surface it inspects" },
        { signal: "Privileged-use exception", weight: "medium", description: "Runs as a privileged compliance service — must be documented in the IRB / HIPAA binder" },
      ],
      recommendations: [
        "Document the privileged-use exception in the HIPAA binder and review annually",
        "Rotate the service-account credentials every 30 days via Secret Manager",
        "Emit a Cloud Audit Log entry for every document the scanner opens — not just matches",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 84000, invocationsLast7Days: 6400, invocationsLast30Days: 25200, invocationsLast90Days: 74800, uniqueUsers: 12, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "o.chen@vantagehealth.com", displayName: "Olivia Chen", invocationCount: 320, lastActivity: daysAgo(0) }]
    },
  },

  // ─── High risk (14) ────────────────────────────────────────────────
  {
    id: "gab-symptom-check-008", appId: "gcp-008-symptom-check",
    name: "Symptom Checker Concierge",
    description: "Guides patients through an initial symptom conversation and drafts a structured intake for the triage nurse.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(200), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Clinical Knowledge Vector Search", type: "HTTP" }, { name: "Triage Queue API", type: "HTTP" }, { name: "Patient Intake Drive", type: "Drive" }],
    permissions: ["aiplatform.user", "discoveryengine.viewer", "drive.readonly", "chat.bot"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-008", displayName: "Raj Patel", userPrincipalName: "r.patel@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 44, level: "high",
      factors: [
        { signal: "Patient-reported PHI ingestion", weight: "high", description: "Agent Builder session captures symptoms, medications, and demographics from patients" },
        { signal: "Care-steering influence", weight: "high", description: "Suggested triage tier seeds the nurse queue and affects time-to-care" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "Gemini 2.0 Pro drives every patient turn against identifiable intake data" },
        { signal: "Broad tenant consent", weight: "medium", description: "Consent granted as AllPrincipals — externally embedded on vantagehealth.com" },
      ],
      recommendations: [
        "Surface a disclaimer on every patient turn stating the agent is advisory, not a clinician",
        "Retain every structured intake in a Cloud Storage bucket with Object Versioning + 7-year retention",
        "Rate-limit the endpoint at the edge to prevent scraping",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 64000, invocationsLast7Days: 5200, invocationsLast30Days: 19800, invocationsLast90Days: 56200, uniqueUsers: 980, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "r.patel@vantagehealth.com", displayName: "Raj Patel", invocationCount: 520, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-telemed-intake-009", appId: "gcp-009-telemed-intake",
    name: "Telemedicine Intake Flow",
    description: "Pre-appointment intake that captures chief complaint, vitals from patient devices, and insurance verification.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(90), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Epic EHR API", type: "HTTP" }, { name: "Payer Eligibility API", type: "HTTP" }, { name: "Device Vitals Stream", type: "PubSub" }],
    permissions: ["aiplatform.user", "pubsub.subscriber"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-009", displayName: "Linda Gomez", userPrincipalName: "l.gomez@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 48, level: "high",
      factors: [
        { signal: "PHI intake at scale", weight: "high", description: "18k telemed visits per month capturing identifiable complaint + insurance data" },
        { signal: "Pub/Sub — device vitals subscriber", weight: "high", description: "pubsub.subscriber on the real-time device vitals topic" },
        { signal: "No VPC-SC perimeter", weight: "high", description: "Vertex endpoint + Pub/Sub topic are outside any VPC Service Controls perimeter" },
        { signal: "External payer integration", weight: "medium", description: "Outbound Payer Eligibility HTTP connector without Cloud DLP inspection" },
      ],
      recommendations: [
        "Wrap the Vertex endpoint, Pub/Sub topic, and Secret Manager in one VPC-SC perimeter",
        "Validate the Pub/Sub device-source signature before trusting incoming vitals",
        "Route the Payer Eligibility call through an Apigee gateway with Cloud DLP on egress",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 21600, invocationsLast7Days: 1600, invocationsLast30Days: 6000, invocationsLast90Days: 18000, uniqueUsers: 612, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "l.gomez@vantagehealth.com", displayName: "Linda Gomez", invocationCount: 280, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-preop-readiness-010", appId: "gcp-010-preop-readiness",
    name: "Pre-Op Readiness Agent",
    description: "Confirms pre-operative requirements (labs, fasting, anticoagulant hold) and reminds patients 72h/24h/4h before surgery.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(110), lastModified: daysAgo(6), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Surgical Schedule API", type: "HTTP" }, { name: "Lab Results BigQuery", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-010", displayName: "Chris Yoon", userPrincipalName: "c.yoon@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 52, level: "high",
      factors: [
        { signal: "Surgical workflow impact", weight: "high", description: "Missed or late reminder can cause OR case cancellation" },
        { signal: "BigQuery — labs dataset read", weight: "high", description: "bigquery.dataViewer on the identified Lab Results dataset" },
        { signal: "Outbound patient messaging", weight: "medium", description: "Sends SMS / email reminders via the Surgical Schedule API on behalf of the patient record" },
        { signal: "CMEK not enforced", weight: "medium", description: "Lab Results dataset uses default Google-managed keys" },
      ],
      recommendations: [
        "Pair every outbound reminder with a nurse sign-off at the 24h checkpoint",
        "Enable CMEK on the Lab Results BigQuery dataset",
        "Scope bigquery.dataViewer to the pre-op labs view, not the full dataset",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 8400, invocationsLast7Days: 640, invocationsLast30Days: 2400, invocationsLast90Days: 7200, uniqueUsers: 128, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "c.yoon@vantagehealth.com", displayName: "Chris Yoon", invocationCount: 180, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-post-discharge-011", appId: "gcp-011-post-discharge",
    name: "Post-Discharge Follow-Up Bot",
    description: "30-day post-discharge Chat bot that collects readmission risk signals and routes high-risk patients to case management.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(75), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Case Management API", type: "HTTP" }, { name: "Epic EHR API", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-011", displayName: "Janet Franks", userPrincipalName: "j.franks@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 49, level: "high",
      factors: [
        { signal: "Readmission intervention trigger", weight: "high", description: "Chat bot routes discharged patients into case management based on model classification" },
        { signal: "Gemini 2.0 Pro on PHI", weight: "high", description: "Gemini 2.0 Pro drives every reply against identified discharge context" },
        { signal: "Chat — direct patient messaging", weight: "medium", description: "chat.bot sends direct messages to discharged patients, not an internal channel" },
        { signal: "EHR read on every turn", weight: "medium", description: "Each conversation turn fetches the patient's discharge summary from Epic" },
      ],
      recommendations: [
        "Require a nurse handoff before closing a 30-day episode",
        "Log every patient message + bot reply to an encrypted Cloud Storage bucket for chart integration",
        "Add crisis-keyword interception that immediately pages the on-call clinician",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 14800, invocationsLast7Days: 1120, invocationsLast30Days: 4200, invocationsLast90Days: 12600, uniqueUsers: 412, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "j.franks@vantagehealth.com", displayName: "Janet Franks", invocationCount: 240, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-maternity-companion-012", appId: "gcp-012-maternity-companion",
    name: "Maternity Journey Companion",
    description: "Prenatal and postpartum conversational companion that tracks symptoms, appointment adherence, and red-flag signs.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(160), lastModified: daysAgo(4), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Maternity Knowledge Drive", type: "Drive" }, { name: "Appointment API", type: "HTTP" }],
    permissions: ["aiplatform.user", "drive.readonly"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-012", displayName: "Hannah Pierce", userPrincipalName: "h.pierce@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 46, level: "high",
      factors: [
        { signal: "High-acuity patient population", weight: "high", description: "Red-flag signs can indicate pre-eclampsia, hemorrhage, or other life-threatening events" },
        { signal: "Daily PHI intake via Agent Builder", weight: "high", description: "Daily check-in captures sensitive clinical signals tied to identifiable patient records" },
        { signal: "Drive — shared-drive read", weight: "medium", description: "drive.readonly scoped to the Maternity Knowledge shared drive (internal clinical content)" },
        { signal: "No VPC-SC perimeter", weight: "medium", description: "Vertex endpoint is not in a VPC-SC perimeter covering the Appointment API" },
      ],
      recommendations: [
        "Escalate red-flag classifications to the on-call OB within 15 minutes",
        "Move the Vertex endpoint + Appointment API egress behind a VPC-SC perimeter",
        "Keep the Maternity Knowledge drive restricted to the OB clinician Google Group",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 19200, invocationsLast7Days: 1400, invocationsLast30Days: 5400, invocationsLast90Days: 16200, uniqueUsers: 280, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "h.pierce@vantagehealth.com", displayName: "Hannah Pierce", invocationCount: 320, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-cardiology-outcomes-013", appId: "gcp-013-cardiology-outcomes",
    name: "Cardiology Outcomes Synthesizer",
    description: "Synthesizes post-procedural outcomes for the cath-lab quality committee from EHR and registry sources.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(180), lastModified: daysAgo(5), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Cardiology Registry Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-013", displayName: "Tarun Kumar", userPrincipalName: "t.kumar@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 42, level: "high",
      factors: [
        { signal: "Regulatory-reporting output", weight: "high", description: "NotebookLM summaries feed Joint Commission and CMS quality reporting" },
        { signal: "Drive — identified registry index", weight: "high", description: "Source drive contains identified cath-lab registry rows" },
        { signal: "Drive — shared-drive wide scope", weight: "medium", description: "drive.readonly covers the whole Cardiology Registry drive, not a committee-specific sub-folder" },
        { signal: "No human-review gate on raw notes", weight: "medium", description: "Committee members can copy synthesized notes without owner approval" },
      ],
      recommendations: [
        "Restrict notebook sharing to the Cardiology Quality Committee Google Group only",
        "Log every NotebookLM query via Workspace audit logs and retain for 7 years",
        "Require chair sign-off on any output that leaves the notebook",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 3200, invocationsLast7Days: 240, invocationsLast30Days: 820, invocationsLast90Days: 2400, uniqueUsers: 22, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "t.kumar@vantagehealth.com", displayName: "Tarun Kumar", invocationCount: 96, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-imaging-curator-014", appId: "gcp-014-imaging-curator",
    name: "Imaging Dataset Curator",
    description: "Builds de-identified imaging training sets for the in-house research team by pulling from the DICOM archive.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(200), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "DICOM Archive API", type: "HTTP" }, { name: "De-Identification API", type: "HTTP" }, { name: "Dataset BigQuery", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataEditor"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-014", displayName: "Julia Nguyen", userPrincipalName: "j.nguyen@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 40, level: "high",
      factors: [
        { signal: "PHI → research pipeline", weight: "high", description: "Agent reads identified DICOM studies and writes de-identified copies to a research BigQuery dataset" },
        { signal: "BigQuery — dataset write", weight: "high", description: "bigquery.dataEditor lets the agent create new BQ datasets that researchers consume" },
        { signal: "Gemini 2.0 Pro in curation pipeline", weight: "medium", description: "Gemini 2.0 Pro reviews imaging metadata during curation" },
        { signal: "De-identification dependency", weight: "medium", description: "Privacy guarantees depend on the De-Identification API succeeding — no fail-closed today" },
      ],
      recommendations: [
        "Add a re-identification QA check on every dataset before it's shared with researchers",
        "Fail the pipeline closed if the De-Identification API returns low confidence",
        "Scope bigquery.dataEditor to a dedicated 'research-datasets-out' project only",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 4800, invocationsLast7Days: 320, invocationsLast30Days: 1200, invocationsLast90Days: 3800, uniqueUsers: 14, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "j.nguyen@vantagehealth.com", displayName: "Julia Nguyen", invocationCount: 120, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-or-utilization-015", appId: "gcp-015-or-utilization",
    name: "OR Utilization Planner",
    description: "Plans operating room block schedules based on surgeon throughput and case-mix to improve utilization.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(160), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Surgical Schedule API", type: "HTTP" }, { name: "Throughput BigQuery", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-015", displayName: "Miyuki Kato", userPrincipalName: "m.kato@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 50, level: "high",
      factors: [
        { signal: "Revenue-impact decisioning", weight: "high", description: "Block-schedule allocations drive surgical revenue and surgeon compensation" },
        { signal: "BigQuery — surgeon-level metrics read", weight: "high", description: "bigquery.dataViewer on per-surgeon throughput — labor-relations sensitive" },
        { signal: "Gemini 2.0 Pro on employee-adjacent data", weight: "medium", description: "Gemini 2.0 Pro used against per-surgeon productivity features" },
        { signal: "No human-review gate", weight: "medium", description: "Proposed allocations can be published to the OR committee without explicit chair sign-off" },
      ],
      recommendations: [
        "Share surgeon-level metrics only with the OR committee Google Group; avoid individual publication",
        "Require OR committee chair sign-off on any block-schedule change driven by the model",
        "Run quarterly fairness check on whether throughput features proxy for protected classes",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 2600, invocationsLast7Days: 180, invocationsLast30Days: 720, invocationsLast90Days: 2200, uniqueUsers: 18, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "m.kato@vantagehealth.com", displayName: "Miyuki Kato", invocationCount: 80, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-denial-coach-016", appId: "gcp-016-denial-coach",
    name: "Denial Management Coach",
    description: "Gemini Gem that coaches billers through payer denial playbooks and drafts first-level appeal letters.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(85), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Payer Playbooks Drive", type: "Drive" }, { name: "Denial Log BigQuery", type: "BigQuery" }],
    permissions: ["drive.readonly", "chat.messages.readonly", "bigquery.dataViewer"], environment: "vantage-workspace", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-016", displayName: "Ricardo Ochoa", userPrincipalName: "r.ochoa@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 47, level: "high",
      factors: [
        { signal: "External legal / financial drafts", weight: "high", description: "Appeal letters generated by the Gem are sent to payers and used in negotiation" },
        { signal: "BigQuery — denial log read", weight: "high", description: "bigquery.dataViewer on denial context that includes patient identifiers" },
        { signal: "Chat — read-scope on Billing space", weight: "medium", description: "chat.messages.readonly on the Billing Ops chat space — can index in-flight conversations" },
        { signal: "Drive — shared-drive read", weight: "medium", description: "drive.readonly on Payer Playbooks drive (internal confidential content)" },
      ],
      recommendations: [
        "Require a billing manager review on every externally-sent appeal letter",
        "Scope the Gem to the Billing Org Unit only via Workspace app-deployment controls",
        "Enable Drive DLP rules to flag appeal drafts containing SSN or full card numbers",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 6400, invocationsLast7Days: 480, invocationsLast30Days: 1800, invocationsLast90Days: 5600, uniqueUsers: 48, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "r.ochoa@vantagehealth.com", displayName: "Ricardo Ochoa", invocationCount: 180, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-charity-care-017", appId: "gcp-017-charity-care",
    name: "Charity Care Screener",
    description: "Screens uninsured patients for charity-care eligibility and generates the financial assistance application.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(65), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Financial Assistance API", type: "HTTP" }, { name: "Credit Attribution API", type: "HTTP" }],
    permissions: ["aiplatform.user", "secretmanager.secretAccessor"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-017", displayName: "Kevin O'Brien", userPrincipalName: "k.obrien@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 45, level: "high",
      factors: [
        { signal: "Financial eligibility decisioning", weight: "high", description: "Output affects whether a patient is billed or receives charity care" },
        { signal: "Sensitive financial data", weight: "high", description: "Agent handles household income + SSN-last-4 during the conversation" },
        { signal: "External credit API egress", weight: "medium", description: "Outbound Credit Attribution API call without Cloud DLP egress inspection" },
        { signal: "No VPC-SC perimeter", weight: "medium", description: "Vertex endpoint + Secret Manager are outside a VPC Service Controls perimeter" },
      ],
      recommendations: [
        "Require a financial counselor sign-off on every charity-care approval",
        "Mask SSN digits after validation and never echo them back in the Agent Builder session",
        "Route Credit Attribution API calls through Apigee with Cloud DLP on egress",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 5200, invocationsLast7Days: 420, invocationsLast30Days: 1500, invocationsLast90Days: 4600, uniqueUsers: 22, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "k.obrien@vantagehealth.com", displayName: "Kevin O'Brien", invocationCount: 120, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-consent-keeper-018", appId: "gcp-018-consent-keeper",
    name: "Consent Record Keeper",
    description: "Centralizes research and treatment consents and proves chain-of-custody across Vantage's 12 clinics.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(220), lastModified: daysAgo(7), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Consent Vault API", type: "HTTP" }, { name: "Cloud Storage — Consent Forms", type: "GCS" }],
    permissions: ["aiplatform.user", "storage.objectAdmin"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "AllPrincipals",
    owner: { id: "g-owner-018", displayName: "Vikram Joshi", userPrincipalName: "v.joshi@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 41, level: "high",
      factors: [
        { signal: "Legal evidence authority", weight: "high", description: "Consent records have evidentiary weight in litigation and IRB review" },
        { signal: "Cloud Storage — object admin", weight: "high", description: "storage.objectAdmin on the Consent Forms bucket (create / overwrite / delete)" },
        { signal: "Broad tenant consent", weight: "medium", description: "Consent granted as AllPrincipals — any authenticated caller can invoke the endpoint" },
        { signal: "Object versioning status unknown", weight: "medium", description: "GCS Object Versioning was not confirmed enabled on the consent bucket" },
      ],
      recommendations: [
        "Enable Object Versioning + Object Hold on the Consent Forms bucket",
        "Downgrade storage.objectAdmin to objectCreator + a separate admin service account behind a break-glass flow",
        "Require a two-person review (IRB + Privacy) before any consent record is deleted",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 9600, invocationsLast7Days: 720, invocationsLast30Days: 2800, invocationsLast90Days: 8600, uniqueUsers: 42, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "v.joshi@vantagehealth.com", displayName: "Vikram Joshi", invocationCount: 180, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-breach-draft-019", appId: "gcp-019-breach-draft",
    name: "Breach Notification Drafter",
    description: "Generates HIPAA breach-notification letters from incident timelines.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(245), lastModified: daysAgo(62), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Incident Tracker API", type: "HTTP" }, { name: "Legal Templates Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-pro", lifecycleStatus: "stale", consentType: "Group",
    owner: { id: "g-owner-019", displayName: "Sophia Lambert", userPrincipalName: "s.lambert@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 43, level: "high",
      factors: [
        { signal: "Regulatory filing content", weight: "high", description: "Outputs land in OCR breach notifications and state AG filings" },
        { signal: "Incident PHI in prompt context", weight: "high", description: "Draft inputs include breach scope and identified affected-member lists" },
        { signal: "Drive — shared-drive read", weight: "medium", description: "drive.readonly on the Legal Templates shared drive" },
        { signal: "Low but concentrated usage", weight: "low", description: "60 invocations in the last 30 days — low volume but each one is regulatory-consequential" },
      ],
      recommendations: [
        "Require the Privacy Officer to sign every draft before external send",
        "Keep the Gem scoped to the Legal Org Unit only",
        "Audit every Gem prompt + completion to a retention-locked Cloud Storage bucket",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 220, invocationsLast7Days: 12, invocationsLast30Days: 60, invocationsLast90Days: 180, uniqueUsers: 4, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "s.lambert@vantagehealth.com", displayName: "Sophia Lambert", invocationCount: 18, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-internal-mobility-020", appId: "gcp-020-internal-mobility",
    name: "Internal Mobility Matcher",
    description: "Matches employees to open internal roles based on skills, tenure, and performance history.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(95), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "HRIS API", type: "HTTP" }, { name: "Skills Graph BigQuery", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-020", displayName: "Ethan Park", userPrincipalName: "e.park@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 53, level: "high",
      factors: [
        { signal: "Employment-decision output", weight: "high", description: "Matches influence hiring / promotion / compensation decisions" },
        { signal: "BigQuery — HR dataset read", weight: "high", description: "bigquery.dataViewer on the Skills Graph dataset containing tenure + perf features" },
        { signal: "Fairness / discrimination risk", weight: "medium", description: "Skills and tenure features can encode protected-class attributes" },
        { signal: "No human-review gate", weight: "medium", description: "HR surfaces top-k matches directly to hiring managers without a people-team filter" },
      ],
      recommendations: [
        "Run quarterly fairness audits across protected classes and publish to the People team",
        "Insert a People Business Partner review step before matches reach hiring managers",
        "Enforce CMEK on the Skills Graph BigQuery dataset",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1800, invocationsLast7Days: 120, invocationsLast30Days: 480, invocationsLast90Days: 1600, uniqueUsers: 24, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "e.park@vantagehealth.com", displayName: "Ethan Park", invocationCount: 62, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-it-incident-021", appId: "gcp-021-it-incident",
    name: "IT Incident Triage Advisor",
    description: "Triages production IT incidents, correlates alerts, and suggests a runbook to on-call.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(115), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Cloud Logging", type: "HTTP" }, { name: "PagerDuty", type: "HTTP" }, { name: "Runbook Drive", type: "Drive" }],
    permissions: ["aiplatform.user", "logging.viewer", "drive.readonly"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-021", displayName: "Amara Obi", userPrincipalName: "a.obi@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 55, level: "high",
      factors: [
        { signal: "Production change suggestions", weight: "high", description: "Runbook recommendations may be executed under pressure during an incident" },
        { signal: "Cloud Logging — broad log visibility", weight: "high", description: "logging.viewer on the prod project — production logs sometimes contain PHI fragments" },
        { signal: "Drive — runbook read", weight: "medium", description: "drive.readonly on the internal Runbook drive (security-sensitive content)" },
        { signal: "Gemini 2.0 Pro + high usage", weight: "medium", description: "Gemini 2.0 Pro driving 2,000 incidents / month — model drift has outsized impact" },
      ],
      recommendations: [
        "Require a human SRE to approve every executed runbook step",
        "Scrub logs via Cloud Logging log-based metrics + redaction before the agent indexes them",
        "Scope logging.viewer to non-PHI log buckets only",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 7200, invocationsLast7Days: 540, invocationsLast30Days: 2000, invocationsLast90Days: 6400, uniqueUsers: 32, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "a.obi@vantagehealth.com", displayName: "Amara Obi", invocationCount: 180, lastActivity: daysAgo(0) }]
    },
  },

  // ─── Medium risk (20) ──────────────────────────────────────────────
  {
    id: "gem-vaccination-elig-022", appId: "gcp-022-vaccination-elig",
    name: "Vaccination Eligibility Lookup",
    description: "Gemini Gem that answers staff questions about vaccination eligibility by age, risk factor, and state rules. Owner account disabled.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(330), lastModified: daysAgo(78), publishedStatus: "active", isOrphaned: true,
    connectors: [{ name: "CDC Guidelines Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "stale", consentType: "Group",
    owner: { id: "g-owner-022", displayName: "Unknown", userPrincipalName: "unknown@vantagehealth.com", accountEnabled: false },
    risk: {
      score: 42, level: "high",
      factors: [
        { signal: "Orphaned owner", weight: "critical", description: "Owner's Google account is disabled — no steward for a clinical-guideline Gem" },
        { signal: "Clinical-guideline output", weight: "medium", description: "Staff may act on Gem responses about eligibility — risk of stale guidance" },
        { signal: "Drive — shared-drive read", weight: "medium", description: "drive.readonly on the CDC Guidelines shared drive (public-reference content)" },
        { signal: "Stale — 78 days idle", weight: "medium", description: "Last invoked 78 days ago — CDC guidance has since changed" },
      ],
      recommendations: [
        "Reassign ownership to Infection Prevention or decommission",
        "Auto-refresh the CDC Guidelines drive weekly via a Cloud Scheduler job",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 4800, invocationsLast7Days: 0, invocationsLast30Days: 18, invocationsLast90Days: 680, uniqueUsers: 68, lastActiveTimestamp: daysAgo(70),
      userBreakdown: []
    },
  },
  {
    id: "gcb-mental-mood-023", appId: "gcp-023-mental-mood",
    name: "Mental Health Mood Check-In",
    description: "Weekly Chat-based mood and sleep check-in for patients enrolled in the behavioral-health program.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(170), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Behavioral Health API", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-023", displayName: "Quentin Brooks", userPrincipalName: "q.brooks@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 62, level: "medium",
      factors: [
        { signal: "Behavioral-health context", weight: "medium", description: "Responses are sensitive — mood + sleep + crisis keywords" },
        { signal: "Chat — group-scoped bot", weight: "medium", description: "chat.bot scoped to the Behavioral Health Google Group only" },
        { signal: "High invocation volume", weight: "medium", description: "4,600 invocations / 30d against a sensitive patient population" },
      ],
      recommendations: [
        "Immediately page the on-call behavioral-health clinician on any crisis keyword hit",
        "Log every check-in response into a retention-locked Cloud Storage bucket for the care record",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 16200, invocationsLast7Days: 1240, invocationsLast30Days: 4600, invocationsLast90Days: 13800, uniqueUsers: 540, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "q.brooks@vantagehealth.com", displayName: "Quentin Brooks", invocationCount: 120, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-pediatric-growth-024", appId: "gcp-024-pediatric-growth",
    name: "Pediatric Growth Chart Helper",
    description: "Explains WHO/CDC pediatric growth percentiles to staff in plain language.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(120), lastModified: daysAgo(4), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Growth Chart Reference Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-024", displayName: "Rosa Delgado", userPrincipalName: "r.delgado@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 70, level: "medium",
      factors: [
        { signal: "Advisory-only output", weight: "medium", description: "Staff may act on percentile explanations to make care recommendations" },
        { signal: "Drive — group-scoped read", weight: "medium", description: "drive.readonly on the Pediatrics reference shared drive only" },
        { signal: "Gemini 1.5 Pro on reference content", weight: "low", description: "Pro model used for interpretability on published percentile charts" },
      ],
      recommendations: [
        "Surface a disclaimer that the Gem is advisory only and defers to the chart itself",
        "Auto-refresh source drive when WHO / CDC publish revisions",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 2400, invocationsLast7Days: 180, invocationsLast30Days: 680, invocationsLast90Days: 2100, uniqueUsers: 38, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "r.delgado@vantagehealth.com", displayName: "Rosa Delgado", invocationCount: 80, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-rare-disease-025", appId: "gcp-025-rare-disease",
    name: "Rare Disease Knowledge Base",
    description: "NotebookLM index of internal rare-disease case studies and external literature for the genetics clinic.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(240), lastModified: daysAgo(9), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Genetics Clinic Drive", type: "Drive" }, { name: "OMIM Mirror", type: "HTTP" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-025", displayName: "Theo Anderson", userPrincipalName: "t.anderson@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 68, level: "medium",
      factors: [
        { signal: "Residual identifiers in corpus", weight: "medium", description: "De-identified case-study corpus may still contain residual identifiers (rare-disease small cohorts)" },
        { signal: "Drive — group-scoped read", weight: "medium", description: "drive.readonly scoped to the Genetics Clinic shared drive only" },
        { signal: "External reference blended in", weight: "medium", description: "OMIM Mirror content is co-indexed with internal case studies — cross-contamination risk on prompt outputs" },
      ],
      recommendations: [
        "Run a quarterly identifier-scrub review on the source corpus",
        "Enable Workspace DLP rules on the Genetics Clinic drive",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1400, invocationsLast7Days: 110, invocationsLast30Days: 420, invocationsLast90Days: 1280, uniqueUsers: 14, lastActiveTimestamp: daysAgo(1),
      userBreakdown: [{ userPrincipalName: "t.anderson@vantagehealth.com", displayName: "Theo Anderson", invocationCount: 48, lastActivity: daysAgo(1) }]
    },
  },
  {
    id: "nlm-outcomes-bench-026", appId: "gcp-026-outcomes-bench",
    name: "Clinical Outcomes Benchmarker",
    description: "Compares Vantage's outcomes against de-identified peer benchmarks from shared industry reports.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(150), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Industry Reports Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-026", displayName: "Maya Sullivan", userPrincipalName: "m.sullivan@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 72, level: "medium",
      factors: [
        { signal: "Board-material disclosure", weight: "medium", description: "Outputs may be shared in CEO / board materials" },
        { signal: "Drive — group-scoped read", weight: "medium", description: "drive.readonly on the Industry Reports shared drive (licensed third-party content)" },
        { signal: "Gemini 1.5 Pro on de-identified data", weight: "low", description: "Pro model used against de-identified peer data" },
      ],
      recommendations: [
        "Watermark every benchmark output as 'de-identified peer comparator' before distribution",
        "Respect third-party license terms — block external sharing of the source drive",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1800, invocationsLast7Days: 140, invocationsLast30Days: 540, invocationsLast90Days: 1600, uniqueUsers: 18, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "m.sullivan@vantagehealth.com", displayName: "Maya Sullivan", invocationCount: 62, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-drug-repurpose-027", appId: "gcp-027-drug-repurpose",
    name: "Drug Repurposing Scout",
    description: "Scans public trial registries and literature to surface repurposing opportunities for internal rare-disease candidates.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(320), lastModified: daysAgo(58), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Trial Registry Feed", type: "HTTP" }, { name: "Internal R&D Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "stale", consentType: "Group",
    owner: { id: "g-owner-027", displayName: "Noah Foster", userPrincipalName: "n.foster@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 75, level: "medium",
      factors: [
        { signal: "Internal IP in corpus", weight: "medium", description: "Indexes in-progress R&D notes alongside public registry content" },
        { signal: "Drive — group-scoped read", weight: "medium", description: "drive.readonly on the R&D shared drive only" },
        { signal: "Stale — idle 14 days", weight: "low", description: "Last invoked 14 days ago — R&D cadence has slowed" },
      ],
      recommendations: [
        "Keep outputs confined to the R&D shared drive; block external sharing",
        "Label any repurposing hypothesis as 'internal — not for external discussion' in the Gem preamble",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 900, invocationsLast7Days: 60, invocationsLast30Days: 220, invocationsLast90Days: 780, uniqueUsers: 8, lastActiveTimestamp: daysAgo(2),
      userBreakdown: [{ userPrincipalName: "n.foster@vantagehealth.com", displayName: "Noah Foster", invocationCount: 32, lastActivity: daysAgo(2) }]
    },
  },
  {
    id: "nlm-vaccine-efficacy-028", appId: "gcp-028-vaccine-efficacy",
    name: "Vaccine Efficacy Review Notebook",
    description: "Weekly NotebookLM review of vaccine efficacy signals across published post-market surveillance studies.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(260), lastModified: daysAgo(68), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Surveillance Feed", type: "HTTP" }, { name: "Public Health Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "stale", consentType: "Group",
    owner: { id: "g-owner-028", displayName: "Grace Mitchell", userPrincipalName: "g.mitchell@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 74, level: "medium",
      factors: [
        { signal: "Public-health guidance influence", weight: "medium", description: "Weekly summaries shape staff vaccination guidance" },
        { signal: "Drive — group-scoped read", weight: "medium", description: "drive.readonly on Public Health shared drive (public content)" },
        { signal: "External feed blended in", weight: "medium", description: "Surveillance Feed blends with internal summaries — provenance tagging required" },
      ],
      recommendations: [
        "Public-health officer reviews every weekly digest before distribution",
        "Tag each output paragraph with its source document for provenance",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 620, invocationsLast7Days: 52, invocationsLast30Days: 180, invocationsLast90Days: 540, uniqueUsers: 6, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "g.mitchell@vantagehealth.com", displayName: "Grace Mitchell", invocationCount: 38, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-pandemic-trend-029", appId: "gcp-029-pandemic-trend",
    name: "Pandemic Trend Monitor",
    description: "Reasoning engine that ingests syndromic-surveillance feeds and alerts when local case velocity crosses thresholds.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(70), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "State Dept of Health Feed", type: "HTTP" }, { name: "BigQuery — Public Health", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-029", displayName: "Leo Hughes", userPrincipalName: "l.hughes@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 66, level: "medium",
      factors: [
        { signal: "Operational alert authority", weight: "medium", description: "Model alerts can trigger surge-plan activation; false positives are disruptive" },
        { signal: "BigQuery — public health dataset", weight: "medium", description: "bigquery.dataViewer on aggregated (non-PHI) public-health dataset" },
        { signal: "Gemini 2.0 Flash at scale", weight: "medium", description: "Flash model runs every 30 min — drift can cascade into alert fatigue" },
      ],
      recommendations: [
        "Require the Public Health Officer to acknowledge every alert before tenant-wide broadcast",
        "Add a confidence-threshold gate below which alerts are queued rather than broadcast",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 3200, invocationsLast7Days: 240, invocationsLast30Days: 900, invocationsLast90Days: 2700, uniqueUsers: 12, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "l.hughes@vantagehealth.com", displayName: "Leo Hughes", invocationCount: 96, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-supply-restock-030", appId: "gcp-030-supply-restock",
    name: "Supply Chain Restock Advisor",
    description: "Advises on par-level adjustments for medical-surgical supplies across 12 clinics.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(180), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Inventory BigQuery", type: "BigQuery" }, { name: "Supplier API", type: "HTTP" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-030", displayName: "Zara Ahmed", userPrincipalName: "z.ahmed@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 71, level: "medium",
      factors: [
        { signal: "Operational spend impact", weight: "medium", description: "Par-level change suggestions drive reorder volume and working-capital impact" },
        { signal: "BigQuery — inventory dataset", weight: "medium", description: "bigquery.dataViewer on Inventory dataset (non-PHI)" },
        { signal: "External supplier API egress", weight: "medium", description: "Outbound Supplier HTTP connector — pricing + inventory terms leak potential" },
      ],
      recommendations: [
        "Require a Supply Chain supervisor approval above $5k reorder delta",
        "Route Supplier API calls through Apigee with Cloud DLP egress inspection",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 3600, invocationsLast7Days: 280, invocationsLast30Days: 1100, invocationsLast90Days: 3200, uniqueUsers: 22, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "z.ahmed@vantagehealth.com", displayName: "Zara Ahmed", invocationCount: 120, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "re-shift-rota-031", appId: "gcp-031-shift-rota",
    name: "Shift Rota Optimizer",
    description: "Proposes weekly nurse shift rotas that balance acuity, overtime, and preferences.",
    vendor: "Google", category: "reasoning-engine", platform: "reasoning_engines", discoverySource: "vertex_ai",
    firstSeen: daysAgo(130), lastModified: daysAgo(4), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Scheduling API", type: "HTTP" }, { name: "HRIS API", type: "HTTP" }],
    permissions: ["aiplatform.user"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-031", displayName: "Wesley Banks", userPrincipalName: "w.banks@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 69, level: "medium",
      factors: [
        { signal: "Labor-relations sensitivity", weight: "medium", description: "Shift allocations can trigger grievance filings under the CBA" },
        { signal: "Employment-adjacent data", weight: "medium", description: "Uses nurse tenure + certification features via the HRIS API" },
        { signal: "Gemini 2.0 Flash — advisory only", weight: "medium", description: "Flash model used in an advisory posture; human manager finalizes the rota" },
      ],
      recommendations: [
        "Review every proposed rota with the union liaison weekly",
        "Exclude demographic features from the HRIS extract fed to the model",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1800, invocationsLast7Days: 140, invocationsLast30Days: 520, invocationsLast90Days: 1560, uniqueUsers: 14, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "w.banks@vantagehealth.com", displayName: "Wesley Banks", invocationCount: 72, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-bed-avail-032", appId: "gcp-032-bed-avail",
    name: "Bed Availability Broadcaster",
    description: "Answers staff questions about real-time bed availability and pending-discharge status in a Chat space.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(220), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "ADT Feed", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-032", displayName: "Charlotte Reed", userPrincipalName: "c.reed@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 73, level: "medium",
      factors: [
        { signal: "Chat — tenant-wide install", weight: "high", description: "chat.bot installable tenant-wide; census is exposed to every Workspace user unless blocked" },
        { signal: "Operational signal exposure", weight: "medium", description: "Exposes real-time census across inpatient units" },
        { signal: "Low per-call sensitivity", weight: "low", description: "Individual responses are aggregated bed counts, not PHI" },
      ],
      recommendations: [
        "Restrict chat.bot deployment to the Operations OU via Workspace app-deployment controls",
        "Pin the ADT Feed egress behind an internal ILB",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 28400, invocationsLast7Days: 2100, invocationsLast30Days: 8100, invocationsLast90Days: 24000, uniqueUsers: 420, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "c.reed@vantagehealth.com", displayName: "Charlotte Reed", invocationCount: 240, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-vendor-onboard-033", appId: "gcp-033-vendor-onboard",
    name: "Vendor Onboarding Assistant",
    description: "Walks new vendors through the Vantage onboarding checklist and collects required insurance certificates.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(100), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Vendor Portal API", type: "HTTP" }, { name: "Cloud Storage — Vendor Docs", type: "GCS" }],
    permissions: ["aiplatform.user", "storage.objectCreator"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-033", displayName: "Ananya Rao", userPrincipalName: "a.rao@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 69, level: "medium",
      factors: [
        { signal: "External-facing onboarding", weight: "medium", description: "Collects vendor-submitted data from external users" },
        { signal: "Cloud Storage — object create", weight: "medium", description: "storage.objectCreator on the Vendor Docs bucket (additive-only)" },
        { signal: "No human-review gate", weight: "medium", description: "Vendor records can enter the system without a Procurement review step" },
      ],
      recommendations: [
        "Require Procurement to approve every new vendor record before it's activated",
        "Virus-scan every uploaded document via GCS triggered Cloud Functions",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1200, invocationsLast7Days: 90, invocationsLast30Days: 340, invocationsLast90Days: 1040, uniqueUsers: 18, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "a.rao@vantagehealth.com", displayName: "Ananya Rao", invocationCount: 36, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-contract-renew-034", appId: "gcp-034-contract-renew",
    name: "Contract Renewal Summarizer",
    description: "Gemini Gem that summarizes contract terms, renewal dates, and escalation clauses for the legal team.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(140), lastModified: daysAgo(8), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Contract Repository Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-034", displayName: "Marcus Bell", userPrincipalName: "m.bell@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 68, level: "medium",
      factors: [
        { signal: "Drive — group-scoped read on MSAs / BAAs", weight: "medium", description: "drive.readonly on the Legal Contract Repository — MSAs, BAAs, amendments" },
        { signal: "Gemini 2.0 Pro on confidential content", weight: "medium", description: "Pro model used to interpret legally binding language" },
        { signal: "Confidential term exposure", weight: "medium", description: "Summaries can leak commercially sensitive terms if re-shared" },
      ],
      recommendations: [
        "Scope the Gem to the Legal Org Unit only",
        "Block external re-sharing of the source drive via Workspace DLP",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1600, invocationsLast7Days: 120, invocationsLast30Days: 460, invocationsLast90Days: 1380, uniqueUsers: 12, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "m.bell@vantagehealth.com", displayName: "Marcus Bell", invocationCount: 48, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-procurement-quote-035", appId: "gcp-035-procurement-quote",
    name: "Procurement Quote Comparer",
    description: "Compares vendor quotes against GPO reference pricing for medical-surgical and IT categories.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(85), lastModified: daysAgo(5), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "GPO Pricing Drive", type: "Drive" }, { name: "Quote Intake Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-035", displayName: "Priya Desai", userPrincipalName: "p.desai@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 72, level: "medium",
      factors: [
        { signal: "Procurement-decision input", weight: "medium", description: "Gem outputs influence supplier-selection decisions" },
        { signal: "Drive — group-scoped read (licensed GPO data)", weight: "medium", description: "drive.readonly on licensed GPO pricing drive — disclosure restrictions" },
        { signal: "Gemini 2.0 Pro on competitive data", weight: "medium", description: "Pro model used against supplier competitive information" },
      ],
      recommendations: [
        "Require a Procurement buyer sign-off before awarding a contract driven by the Gem",
        "Prevent any quote summary from being shared outside Procurement via Workspace DLP",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 860, invocationsLast7Days: 64, invocationsLast30Days: 240, invocationsLast90Days: 740, uniqueUsers: 9, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "p.desai@vantagehealth.com", displayName: "Priya Desai", invocationCount: 28, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-asset-recall-036", appId: "gcp-036-asset-recall",
    name: "Asset Recall Watcher",
    description: "Chat bot that surfaces FDA device-recall notices relevant to Vantage's equipment inventory.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(160), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "FDA Recall Feed", type: "HTTP" }, { name: "Asset BigQuery", type: "BigQuery" }],
    permissions: ["chat.bot", "bigquery.dataViewer"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-036", displayName: "Elena Martinez", userPrincipalName: "e.martinez@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 74, level: "medium",
      factors: [
        { signal: "Chat — tenant-wide install", weight: "high", description: "chat.bot deployed tenant-wide to surface recalls to any subscribed space" },
        { signal: "Patient-safety escalation", weight: "medium", description: "Missed or late alert delays recall remediation on in-use equipment" },
        { signal: "BigQuery — asset dataset (non-PHI)", weight: "low", description: "bigquery.dataViewer on the Asset dataset — inventory only, no patient data" },
      ],
      recommendations: [
        "Trigger a Cloud Monitoring incident if a matched recall isn't acknowledged within 24h",
        "Keep tenant-wide install but restrict the bot to pre-subscribed Safety Ops chat spaces",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 2000, invocationsLast7Days: 150, invocationsLast30Days: 580, invocationsLast90Days: 1720, uniqueUsers: 42, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "e.martinez@vantagehealth.com", displayName: "Elena Martinez", invocationCount: 52, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-payer-mix-037", appId: "gcp-037-payer-mix",
    name: "Payer Mix Analyzer",
    description: "NotebookLM analysis of payer mix trends across product lines and service areas.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(290), lastModified: daysAgo(55), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Revenue Cycle Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "stale", consentType: "Group",
    owner: { id: "g-owner-037", displayName: "Felix Hoang", userPrincipalName: "f.hoang@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 70, level: "medium",
      factors: [
        { signal: "Drive — group-scoped read (Finance)", weight: "medium", description: "drive.readonly on the Revenue Cycle shared drive — contains payer contract summaries" },
        { signal: "Board-material content", weight: "medium", description: "Summaries feed CFO board materials" },
        { signal: "Stale — 11 days since refresh", weight: "medium", description: "Source drive last refreshed 11 days ago — data may lag month-end close" },
      ],
      recommendations: [
        "Restrict NotebookLM access to the Finance OU only",
        "Automate a monthly refresh of the Revenue Cycle drive via Cloud Scheduler",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 720, invocationsLast7Days: 54, invocationsLast30Days: 200, invocationsLast90Days: 640, uniqueUsers: 7, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "f.hoang@vantagehealth.com", displayName: "Felix Hoang", invocationCount: 32, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-audit-evidence-038", appId: "gcp-038-audit-evidence",
    name: "Audit Evidence Compiler",
    description: "Assembles evidence artifacts for upcoming compliance audits (SOC 2, HITRUST, HIPAA).",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(115), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Policies & Procedures Drive", type: "Drive" }, { name: "Ticketing Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-038", displayName: "Nadia Okafor", userPrincipalName: "n.okafor@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 67, level: "medium",
      factors: [
        { signal: "Evidence-fidelity requirement", weight: "medium", description: "Auditors rely on compiled evidence being accurate and complete" },
        { signal: "Drive — multi-drive group-scoped read", weight: "medium", description: "drive.readonly on two shared drives (Policies, Ticketing)" },
        { signal: "Gemini 1.5 Pro on regulated content", weight: "medium", description: "Pro model used to summarize policy + ticket evidence" },
      ],
      recommendations: [
        "Require the Compliance Officer to sign off on every evidence pack",
        "Enable tamper-evident logging (Cloud Audit Logs with export lock) for every NotebookLM query",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 480, invocationsLast7Days: 36, invocationsLast30Days: 140, invocationsLast90Days: 420, uniqueUsers: 5, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "n.okafor@vantagehealth.com", displayName: "Nadia Okafor", invocationCount: 24, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-policy-digest-039", appId: "gcp-039-policy-digest",
    name: "Policy Change Digest",
    description: "Weekly Gemini digest summarizing regulatory and internal policy changes for department heads.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(60), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Regulatory Feed", type: "HTTP" }, { name: "Policies Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-039", displayName: "Olivia Chen", userPrincipalName: "o.chen@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 76, level: "medium",
      factors: [
        { signal: "Tenant-wide audience", weight: "high", description: "Digest reaches every department head across the Workspace" },
        { signal: "Drive — group-scoped read (Policies)", weight: "medium", description: "drive.readonly on the Policies shared drive" },
        { signal: "Gemini 2.0 Flash — advisory digest", weight: "low", description: "Flash model used for summarization only" },
      ],
      recommendations: [
        "Compliance Officer edits every digest before publishing",
        "Mark every digest as 'advisory — confirm in the source policy' in the Gem preamble",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1200, invocationsLast7Days: 90, invocationsLast30Days: 340, invocationsLast90Days: 1040, uniqueUsers: 58, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "o.chen@vantagehealth.com", displayName: "Olivia Chen", invocationCount: 38, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-ce-recommender-040", appId: "gcp-040-ce-recommender",
    name: "Continuing Education Recommender",
    description: "Recommends continuing-education modules to clinicians based on specialty, license requirements, and gaps.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(90), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "LMS API", type: "HTTP" }],
    permissions: ["aiplatform.user"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-040", displayName: "Raj Patel", userPrincipalName: "r.patel@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 73, level: "medium",
      factors: [
        { signal: "Licensure-related output", weight: "medium", description: "Missed CE recommendations can affect a clinician's license renewal" },
        { signal: "LMS API dependency", weight: "medium", description: "Output quality depends on authoritative LMS data being current" },
        { signal: "Gemini 1.5 Pro on clinician-adjacent data", weight: "medium", description: "Pro model drives recommendations from identifiable clinician profiles" },
      ],
      recommendations: [
        "Sync authoritative license data from the state board feed nightly into the LMS",
        "Surface a disclaimer that CE completion remains the clinician's responsibility",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 2400, invocationsLast7Days: 180, invocationsLast30Days: 660, invocationsLast90Days: 2040, uniqueUsers: 140, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "r.patel@vantagehealth.com", displayName: "Raj Patel", invocationCount: 58, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gab-visitor-badge-041", appId: "gcp-041-visitor-badge",
    name: "Visitor Badge Printer Bot",
    description: "Self-service kiosk agent that verifies visitor appointments and prints a badge.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(170), lastModified: daysAgo(6), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Visitor Management API", type: "HTTP" }],
    permissions: ["aiplatform.user"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-041", displayName: "Linda Gomez", userPrincipalName: "l.gomez@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 70, level: "medium",
      factors: [
        { signal: "Physical-access decisioning", weight: "medium", description: "Badges grant physical building access — bad output has real-world impact" },
        { signal: "External-facing self-service kiosk", weight: "medium", description: "Interacts with the general public at reception kiosks" },
        { signal: "Gemini 2.0 Flash — advisory only", weight: "medium", description: "Flash model used; the kiosk always defers to the Visitor Management API decision" },
      ],
      recommendations: [
        "Require the security desk to override ambiguous verifications manually",
        "Rate-limit the kiosk endpoint to prevent impersonation brute-force",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 9800, invocationsLast7Days: 720, invocationsLast30Days: 2800, invocationsLast90Days: 8600, uniqueUsers: 380, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "l.gomez@vantagehealth.com", displayName: "Linda Gomez", invocationCount: 88, lastActivity: daysAgo(0) }]
    },
  },

  // ─── Low risk (14) ─────────────────────────────────────────────────
  {
    id: "gab-facility-energy-042", appId: "gcp-042-facility-energy",
    name: "Facility Energy Monitor",
    description: "Conversational agent for the facilities team to query building energy usage trends.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(220), lastModified: daysAgo(4), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "BMS Telemetry BigQuery", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-042", displayName: "Chris Yoon", userPrincipalName: "c.yoon@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 82, level: "low",
      factors: [
        { signal: "Non-PHI operational dataset", weight: "low", description: "bigquery.dataViewer on BMS telemetry only — no PHI, no financial data" },
        { signal: "Gemini 2.0 Flash — advisory only", weight: "low", description: "Flash model for facility-team Q&A" },
      ],
      recommendations: [
        "No action needed — keep the BigQuery role scoped to the telemetry dataset",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 620, invocationsLast7Days: 48, invocationsLast30Days: 180, invocationsLast90Days: 540, uniqueUsers: 9, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "c.yoon@vantagehealth.com", displayName: "Chris Yoon", invocationCount: 28, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-capital-ledger-043", appId: "gcp-043-capital-ledger",
    name: "Capital Equipment Ledger Gem",
    description: "Gemini Gem that answers questions about the capital equipment ledger for the finance team.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(280), lastModified: daysAgo(108), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Fixed Asset Register Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "stale", consentType: "Group",
    owner: { id: "g-owner-043", displayName: "Janet Franks", userPrincipalName: "j.franks@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 85, level: "low",
      factors: [
        { signal: "Drive — group-scoped read (Finance)", weight: "low", description: "drive.readonly on the Fixed Asset Register drive only" },
        { signal: "Internal financial reference", weight: "low", description: "Reference Q&A over an internal ledger — no regulatory output" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 380, invocationsLast7Days: 28, invocationsLast30Days: 110, invocationsLast90Days: 340, uniqueUsers: 6, lastActiveTimestamp: daysAgo(1),
      userBreakdown: [{ userPrincipalName: "j.franks@vantagehealth.com", displayName: "Janet Franks", invocationCount: 12, lastActivity: daysAgo(1) }]
    },
  },
  {
    id: "gcb-price-transparency-044", appId: "gcp-044-price-transparency",
    name: "Price Transparency Explainer",
    description: "Chat bot that explains Vantage's published price-transparency files to patients and staff.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(95), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Price Transparency Drive", type: "Drive" }],
    permissions: ["chat.bot", "drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-044", displayName: "Hannah Pierce", userPrincipalName: "h.pierce@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 84, level: "low",
      factors: [
        { signal: "Public reference data only", weight: "low", description: "Sources are the federally-mandated price-transparency files" },
        { signal: "Chat — tenant-wide install", weight: "low", description: "chat.bot surfaces publicly-published content, so tenant-wide install is low risk" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 4800, invocationsLast7Days: 360, invocationsLast30Days: 1400, invocationsLast90Days: 4100, uniqueUsers: 420, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "h.pierce@vantagehealth.com", displayName: "Hannah Pierce", invocationCount: 56, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-interview-sched-045", appId: "gcp-045-interview-sched",
    name: "Interview Scheduling Buddy",
    description: "Schedules and reschedules candidate interviews via Chat.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(140), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "ATS API", type: "HTTP" }, { name: "Google Calendar API", type: "HTTP" }],
    permissions: ["chat.bot", "calendar.events"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Group",
    owner: { id: "g-owner-045", displayName: "Tarun Kumar", userPrincipalName: "t.kumar@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 86, level: "low",
      factors: [
        { signal: "Calendar — event write", weight: "low", description: "calendar.events write scope limited to interview-panel calendars" },
        { signal: "Internal operations only", weight: "low", description: "No external-facing surface beyond the candidate invite" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 3600, invocationsLast7Days: 260, invocationsLast30Days: 1000, invocationsLast90Days: 3100, uniqueUsers: 62, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "t.kumar@vantagehealth.com", displayName: "Tarun Kumar", invocationCount: 82, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-benefits-enroll-046", appId: "gcp-046-benefits-enroll",
    name: "Benefits Open-Enrollment Helper",
    description: "Gemini Gem that explains open-enrollment options during the benefits window.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(240), lastModified: daysAgo(50), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Benefits Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "stale", consentType: "Tenant",
    owner: { id: "g-owner-046", displayName: "Julia Nguyen", userPrincipalName: "j.nguyen@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 88, level: "low",
      factors: [
        { signal: "Published benefits content", weight: "low", description: "Source is the published benefits guide — no PHI, no compensation data" },
        { signal: "Stale — 20 days since refresh", weight: "low", description: "Last refreshed 20 days ago; outside open-enrollment window" },
      ],
      recommendations: [
        "Refresh the Benefits drive corpus at the start of each enrollment window",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 2400, invocationsLast7Days: 180, invocationsLast30Days: 680, invocationsLast90Days: 2100, uniqueUsers: 140, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "j.nguyen@vantagehealth.com", displayName: "Julia Nguyen", invocationCount: 36, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-wellness-nudge-047", appId: "gcp-047-wellness-nudge",
    name: "Wellness Program Nudge Bot",
    description: "Sends opt-in wellness challenge reminders in the employee Chat space.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(200), lastModified: daysAgo(3), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Wellness Platform API", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-047", displayName: "Miyuki Kato", userPrincipalName: "m.kato@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 90, level: "low",
      factors: [
        { signal: "Opt-in audience", weight: "low", description: "Users explicitly opt into the wellness Chat space before receiving nudges" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 5400, invocationsLast7Days: 420, invocationsLast30Days: 1600, invocationsLast90Days: 4800, uniqueUsers: 220, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "m.kato@vantagehealth.com", displayName: "Miyuki Kato", invocationCount: 42, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-timesheet-check-048", appId: "gcp-048-timesheet-check",
    name: "Timesheet Sanity Checker",
    description: "Chat bot that flags missed punch-ins and suggests corrections before payroll cutoff.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(80), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Timekeeping API", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-048", displayName: "Ricardo Ochoa", userPrincipalName: "r.ochoa@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 84, level: "low",
      factors: [
        { signal: "Advisory only — manager approves", weight: "low", description: "Corrections are reviewed and approved by the employee's manager before payroll" },
        { signal: "Internal operations only", weight: "low", description: "No external-facing surface; operates only in the employee Chat space" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 12800, invocationsLast7Days: 960, invocationsLast30Days: 3600, invocationsLast90Days: 10800, uniqueUsers: 620, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "r.ochoa@vantagehealth.com", displayName: "Ricardo Ochoa", invocationCount: 64, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-password-reset-049", appId: "gcp-049-password-reset",
    name: "Password Reset Concierge",
    description: "Front-line Chat bot that walks staff through the self-service password reset flow.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(240), lastModified: daysAgo(0), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Identity API", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-049", displayName: "Sophia Lambert", userPrincipalName: "s.lambert@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 83, level: "low",
      factors: [
        { signal: "Self-service flow only", weight: "low", description: "Bot never handles credentials — it only navigates users to the self-service reset UI" },
        { signal: "Internal operations only", weight: "low", description: "Scoped to the Workspace tenant, no external exposure" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 36400, invocationsLast7Days: 2800, invocationsLast30Days: 10800, invocationsLast90Days: 32000, uniqueUsers: 820, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "s.lambert@vantagehealth.com", displayName: "Sophia Lambert", invocationCount: 58, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gem-cafeteria-menu-050", appId: "gcp-050-cafeteria-menu",
    name: "Cafeteria Menu Explorer",
    description: "Gemini Gem that answers questions about today's cafeteria menu, allergens, and hours.",
    vendor: "Google", category: "generative-ai", platform: "gemini_gems", discoverySource: "gemini_workspace",
    firstSeen: daysAgo(300), lastModified: daysAgo(1), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Cafeteria Menu Feed", type: "HTTP" }],
    permissions: [], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-050", displayName: "Ethan Park", userPrincipalName: "e.park@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 92, level: "low",
      factors: [
        { signal: "Public reference data only", weight: "low", description: "Menu content is public — no sensitive data" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 8200, invocationsLast7Days: 620, invocationsLast30Days: 2400, invocationsLast90Days: 7200, uniqueUsers: 520, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "e.park@vantagehealth.com", displayName: "Ethan Park", invocationCount: 28, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-campus-wayfinding-051", appId: "gcp-051-campus-wayfinding",
    name: "Campus Wayfinding Agent",
    description: "Directs visitors and staff to departments, parking, and amenities across the main campus.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(260), lastModified: daysAgo(2), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Campus Map Data", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-051", displayName: "Amara Obi", userPrincipalName: "a.obi@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 91, level: "low",
      factors: [
        { signal: "Public campus content", weight: "low", description: "Directs to public wayfinding info only" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 15800, invocationsLast7Days: 1200, invocationsLast30Days: 4600, invocationsLast90Days: 13600, uniqueUsers: 980, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "a.obi@vantagehealth.com", displayName: "Amara Obi", invocationCount: 38, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-meeting-room-052", appId: "gcp-052-meeting-room",
    name: "Meeting Room Booking Bot",
    description: "Finds and books available meeting rooms via Chat.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(180), lastModified: daysAgo(6), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Google Calendar API", type: "HTTP" }, { name: "Room Resource Directory", type: "HTTP" }],
    permissions: ["chat.bot", "calendar.events"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-052", displayName: "Isabelle Fontaine", userPrincipalName: "i.fontaine@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 87, level: "low",
      factors: [
        { signal: "Calendar — event write on resources", weight: "low", description: "calendar.events limited to room-resource calendars" },
        { signal: "Internal operations only", weight: "low", description: "Scoped to the Workspace tenant" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 7200, invocationsLast7Days: 540, invocationsLast30Days: 2100, invocationsLast90Days: 6400, uniqueUsers: 280, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "i.fontaine@vantagehealth.com", displayName: "Isabelle Fontaine", invocationCount: 38, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-parking-permit-053", appId: "gcp-053-parking-permit",
    name: "Parking Permit Agent",
    description: "Handles staff parking permit renewals and violation appeals.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(150), lastModified: daysAgo(4), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Parking System API", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-053", displayName: "Quentin Brooks", userPrincipalName: "q.brooks@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 89, level: "low",
      factors: [
        { signal: "Internal operations only", weight: "low", description: "Non-clinical admin workflow, no PHI" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 2400, invocationsLast7Days: 180, invocationsLast30Days: 680, invocationsLast90Days: 2100, uniqueUsers: 210, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "q.brooks@vantagehealth.com", displayName: "Quentin Brooks", invocationCount: 22, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "gcb-shuttle-schedule-054", appId: "gcp-054-shuttle-schedule",
    name: "Shuttle Schedule Informer",
    description: "Tells staff when the next inter-campus shuttle departs and from which stop.",
    vendor: "Google", category: "chatbot", platform: "google_chat_bots", discoverySource: "chat_api",
    firstSeen: daysAgo(90), lastModified: daysAgo(10), publishedStatus: "active", isOrphaned: false,
    connectors: [{ name: "Transit Schedule Feed", type: "HTTP" }],
    permissions: ["chat.bot"], environment: "vantage-workspace", llmModel: "gemini-2.0-flash", lifecycleStatus: "active", consentType: "Tenant",
    owner: { id: "g-owner-054", displayName: "Rosa Delgado", userPrincipalName: "r.delgado@vantagehealth.com", accountEnabled: true },
    risk: {
      score: 92, level: "low",
      factors: [
        { signal: "Public schedule content", weight: "low", description: "Public shuttle schedule feed — no sensitive data" },
      ],
      recommendations: [
        "No action needed",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 4200, invocationsLast7Days: 320, invocationsLast30Days: 1200, invocationsLast90Days: 3600, uniqueUsers: 180, lastActiveTimestamp: daysAgo(0),
      userBreakdown: [{ userPrincipalName: "r.delgado@vantagehealth.com", displayName: "Rosa Delgado", invocationCount: 28, lastActivity: daysAgo(0) }]
    },
  },
  {
    id: "nlm-training-research-055", appId: "gcp-055-training-research",
    name: "Training Materials Researcher",
    description: "NotebookLM index of internal training decks and SOPs that new hires can query. Owner left the organization.",
    vendor: "Google", category: "research-notebook", platform: "notebook_lm", discoverySource: "notebook_lm",
    firstSeen: daysAgo(360), lastModified: daysAgo(95), publishedStatus: "active", isOrphaned: true,
    connectors: [{ name: "Training Drive", type: "Drive" }],
    permissions: ["drive.readonly"], environment: "vantage-workspace", llmModel: "gemini-1.5-pro", lifecycleStatus: "stale", consentType: "Tenant",
    owner: { id: "g-owner-055", displayName: "Unknown", userPrincipalName: "unknown@vantagehealth.com", accountEnabled: false },
    risk: {
      score: 58, level: "medium",
      factors: [
        { signal: "Orphaned owner", weight: "critical", description: "Owner's Google account is disabled — no one is maintaining the training corpus" },
        { signal: "Drive — internal training content", weight: "low", description: "drive.readonly on the Training shared drive — internal SOPs only" },
        { signal: "Stale — 95 days since refresh", weight: "medium", description: "Source drive last refreshed 95 days ago — SOP revisions missing" },
      ],
      recommendations: [
        "Reassign ownership to the Learning & Development lead or decommission",
        "Refresh corpus after outstanding SOP revisions are published",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1800, invocationsLast7Days: 0, invocationsLast30Days: 12, invocationsLast90Days: 240, uniqueUsers: 220, lastActiveTimestamp: daysAgo(42),
      userBreakdown: []
    },
  },

  // ─── Stale / orphaned ──────────────────────────────────────────────
  {
    id: "gab-revenue-leak-056", appId: "gcp-056-revenue-leak",
    name: "Revenue Leak Detector",
    description: "Conversational agent that surfaces suspected revenue leakage patterns from claim-denial data. Owner account disabled.",
    vendor: "Google", category: "conversational-agent", platform: "agent_builder", discoverySource: "vertex_ai",
    firstSeen: daysAgo(200), lastModified: daysAgo(48), publishedStatus: "active", isOrphaned: true,
    connectors: [{ name: "Revenue Cycle BigQuery", type: "BigQuery" }],
    permissions: ["aiplatform.user", "bigquery.dataViewer"], environment: "vantage-gcp-prod", llmModel: "gemini-1.5-pro", lifecycleStatus: "stale", consentType: "AllPrincipals",
    owner: { id: "g-owner-056", displayName: "Unknown", userPrincipalName: "unknown@vantagehealth.com", accountEnabled: false },
    risk: {
      score: 35, level: "high",
      factors: [
        { signal: "Orphaned owner", weight: "critical", description: "Owner's Google account is disabled — no remediation path exists" },
        { signal: "BigQuery — financial dataset read", weight: "high", description: "bigquery.dataViewer on the Revenue Cycle denial dataset remains active" },
        { signal: "Broad tenant consent", weight: "medium", description: "Consent is still granted as AllPrincipals" },
        { signal: "Stale — idle 48 days", weight: "medium", description: "Last invocation was 48 days ago" },
      ],
      recommendations: [
        "Reassign ownership or decommission the agent within the next 7 days",
        "Rotate the service-account keys and revoke bigquery.dataViewer from the orphaned principal",
        "Remove the AllPrincipals consent grant",
      ], computedAt: now
    },
    activity: {
      totalInvocations: 1800, invocationsLast7Days: 0, invocationsLast30Days: 8, invocationsLast90Days: 320, uniqueUsers: 3, lastActiveTimestamp: daysAgo(44),
      userBreakdown: []
    },
  },
];

// ─── Google Tenant ───────────────────────────────────────────────────

export const DEMO_GOOGLE_TENANT = {
  id: "vantage-workspace-001",
  name: "Vantage Health Group",
  domain: "vantagehealth.com",
  license: "Google Workspace Enterprise Plus + Vertex AI",
};

// ─── Google Cost — per-agent endpoint mapping ────────────────────────
// One cost row per Google agent. 30-day base figures; CostTab scales by
// selected period. Model/tokens chosen to match each agent's workload.

export const DEMO_GOOGLE_COST_AGENTS = [
  { agentId: "re-chronic-care-nav-001", displayName: "Chronic Care Navigator", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 9_400_000, outputTokens: 3_600_000, totalTokens: 13_000_000, requestCount: 9_200, inputCost: 117.50, outputCost: 180.00, totalCost: 297.50 },
  { agentId: "re-allergy-screen-002", displayName: "Allergy Risk Screener", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 14_800_000, outputTokens: 4_800_000, totalTokens: 19_600_000, requestCount: 17_800, inputCost: 185.00, outputCost: 240.00, totalCost: 425.00 },
  { agentId: "nlm-oncology-biomarker-003", displayName: "Oncology Biomarker Explorer", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 3_600_000, outputTokens: 1_200_000, totalTokens: 4_800_000, requestCount: 2_800, inputCost: 45.00, outputCost: 60.00, totalCost: 105.00 },
  { agentId: "re-genomic-variant-004", displayName: "Genomic Variant Classifier", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 4_200_000, outputTokens: 1_600_000, totalTokens: 5_800_000, requestCount: 1_800, inputCost: 52.50, outputCost: 80.00, totalCost: 132.50 },
  { agentId: "re-pop-risk-stratify-005", displayName: "Population Risk Stratifier", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 8_200_000, outputTokens: 2_800_000, totalTokens: 11_000_000, requestCount: 4_800, inputCost: 102.50, outputCost: 140.00, totalCost: 242.50 },
  { agentId: "re-charge-capture-006", displayName: "Charge Capture Auditor", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 11_600_000, outputTokens: 3_800_000, totalTokens: 15_400_000, requestCount: 12_600, inputCost: 145.00, outputCost: 190.00, totalCost: 335.00 },
  { agentId: "re-hipaa-exposure-007", displayName: "HIPAA Exposure Scanner", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 22_400_000, outputTokens: 5_200_000, totalTokens: 27_600_000, requestCount: 25_200, inputCost: 280.00, outputCost: 260.00, totalCost: 540.00 },
  { agentId: "gab-symptom-check-008", displayName: "Symptom Checker Concierge", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 10_800_000, outputTokens: 4_200_000, totalTokens: 15_000_000, requestCount: 19_800, inputCost: 135.00, outputCost: 210.00, totalCost: 345.00 },
  { agentId: "gab-telemed-intake-009", displayName: "Telemedicine Intake Flow", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 4_400_000, outputTokens: 1_600_000, totalTokens: 6_000_000, requestCount: 6_000, inputCost: 55.00, outputCost: 80.00, totalCost: 135.00 },
  { agentId: "gab-preop-readiness-010", displayName: "Pre-Op Readiness Agent", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 2_200_000, outputTokens: 820_000, totalTokens: 3_020_000, requestCount: 2_400, inputCost: 27.50, outputCost: 41.00, totalCost: 68.50 },
  { agentId: "gcb-post-discharge-011", displayName: "Post-Discharge Follow-Up Bot", modelName: "gemini-2.0-pro", resourceName: "vantage-workspace-chat", inputTokens: 3_200_000, outputTokens: 1_100_000, totalTokens: 4_300_000, requestCount: 4_200, inputCost: 40.00, outputCost: 55.00, totalCost: 95.00 },
  { agentId: "gab-maternity-companion-012", displayName: "Maternity Journey Companion", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 4_600_000, outputTokens: 1_700_000, totalTokens: 6_300_000, requestCount: 5_400, inputCost: 57.50, outputCost: 85.00, totalCost: 142.50 },
  { agentId: "nlm-cardiology-outcomes-013", displayName: "Cardiology Outcomes Synthesizer", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 900_000, outputTokens: 320_000, totalTokens: 1_220_000, requestCount: 820, inputCost: 11.25, outputCost: 16.00, totalCost: 27.25 },
  { agentId: "gab-imaging-curator-014", displayName: "Imaging Dataset Curator", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 1_400_000, outputTokens: 520_000, totalTokens: 1_920_000, requestCount: 1_200, inputCost: 17.50, outputCost: 26.00, totalCost: 43.50 },
  { agentId: "re-or-utilization-015", displayName: "OR Utilization Planner", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 800_000, outputTokens: 320_000, totalTokens: 1_120_000, requestCount: 720, inputCost: 10.00, outputCost: 16.00, totalCost: 26.00 },
  { agentId: "gem-denial-coach-016", displayName: "Denial Management Coach", modelName: "gemini-2.0-pro", resourceName: "vantage-workspace-gemini", inputTokens: 2_200_000, outputTokens: 920_000, totalTokens: 3_120_000, requestCount: 1_800, inputCost: 27.50, outputCost: 46.00, totalCost: 73.50 },
  { agentId: "gab-charity-care-017", displayName: "Charity Care Screener", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 1_600_000, outputTokens: 620_000, totalTokens: 2_220_000, requestCount: 1_500, inputCost: 20.00, outputCost: 31.00, totalCost: 51.00 },
  { agentId: "gab-consent-keeper-018", displayName: "Consent Record Keeper", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 3_200_000, outputTokens: 1_000_000, totalTokens: 4_200_000, requestCount: 2_800, inputCost: 40.00, outputCost: 50.00, totalCost: 90.00 },
  { agentId: "gem-breach-draft-019", displayName: "Breach Notification Drafter", modelName: "gemini-2.0-pro", resourceName: "vantage-workspace-gemini", inputTokens: 180_000, outputTokens: 90_000, totalTokens: 270_000, requestCount: 60, inputCost: 2.25, outputCost: 4.50, totalCost: 6.75 },
  { agentId: "re-internal-mobility-020", displayName: "Internal Mobility Matcher", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 520_000, outputTokens: 220_000, totalTokens: 740_000, requestCount: 480, inputCost: 6.50, outputCost: 11.00, totalCost: 17.50 },
  { agentId: "re-it-incident-021", displayName: "IT Incident Triage Advisor", modelName: "gemini-2.0-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 2_800_000, outputTokens: 920_000, totalTokens: 3_720_000, requestCount: 2_000, inputCost: 35.00, outputCost: 46.00, totalCost: 81.00 },
  { agentId: "gem-vaccination-elig-022", displayName: "Vaccination Eligibility Lookup", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-gemini", inputTokens: 1_200_000, outputTokens: 420_000, totalTokens: 1_620_000, requestCount: 1_400, inputCost: 0.12, outputCost: 0.17, totalCost: 0.29 },
  { agentId: "gcb-mental-mood-023", displayName: "Mental Health Mood Check-In", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 3_800_000, outputTokens: 1_200_000, totalTokens: 5_000_000, requestCount: 4_600, inputCost: 0.38, outputCost: 0.48, totalCost: 0.86 },
  { agentId: "gem-pediatric-growth-024", displayName: "Pediatric Growth Chart Helper", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-gemini", inputTokens: 640_000, outputTokens: 220_000, totalTokens: 860_000, requestCount: 680, inputCost: 8.00, outputCost: 11.00, totalCost: 19.00 },
  { agentId: "nlm-rare-disease-025", displayName: "Rare Disease Knowledge Base", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 380_000, outputTokens: 120_000, totalTokens: 500_000, requestCount: 420, inputCost: 4.75, outputCost: 6.00, totalCost: 10.75 },
  { agentId: "nlm-outcomes-bench-026", displayName: "Clinical Outcomes Benchmarker", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 520_000, outputTokens: 180_000, totalTokens: 700_000, requestCount: 540, inputCost: 6.50, outputCost: 9.00, totalCost: 15.50 },
  { agentId: "nlm-drug-repurpose-027", displayName: "Drug Repurposing Scout", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 220_000, outputTokens: 80_000, totalTokens: 300_000, requestCount: 220, inputCost: 2.75, outputCost: 4.00, totalCost: 6.75 },
  { agentId: "nlm-vaccine-efficacy-028", displayName: "Vaccine Efficacy Review Notebook", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 180_000, outputTokens: 60_000, totalTokens: 240_000, requestCount: 180, inputCost: 2.25, outputCost: 3.00, totalCost: 5.25 },
  { agentId: "re-pandemic-trend-029", displayName: "Pandemic Trend Monitor", modelName: "gemini-2.0-flash", resourceName: "vantage-vertex-us-central1", inputTokens: 900_000, outputTokens: 280_000, totalTokens: 1_180_000, requestCount: 900, inputCost: 0.09, outputCost: 0.11, totalCost: 0.20 },
  { agentId: "gab-supply-restock-030", displayName: "Supply Chain Restock Advisor", modelName: "gemini-2.0-flash", resourceName: "vantage-vertex-us-central1", inputTokens: 1_100_000, outputTokens: 360_000, totalTokens: 1_460_000, requestCount: 1_100, inputCost: 0.11, outputCost: 0.14, totalCost: 0.25 },
  { agentId: "re-shift-rota-031", displayName: "Shift Rota Optimizer", modelName: "gemini-2.0-flash", resourceName: "vantage-vertex-us-central1", inputTokens: 520_000, outputTokens: 200_000, totalTokens: 720_000, requestCount: 520, inputCost: 0.05, outputCost: 0.08, totalCost: 0.13 },
  { agentId: "gcb-bed-avail-032", displayName: "Bed Availability Broadcaster", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 4_200_000, outputTokens: 1_400_000, totalTokens: 5_600_000, requestCount: 8_100, inputCost: 0.42, outputCost: 0.56, totalCost: 0.98 },
  { agentId: "gab-vendor-onboard-033", displayName: "Vendor Onboarding Assistant", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 380_000, outputTokens: 140_000, totalTokens: 520_000, requestCount: 340, inputCost: 4.75, outputCost: 7.00, totalCost: 11.75 },
  { agentId: "gem-contract-renew-034", displayName: "Contract Renewal Summarizer", modelName: "gemini-2.0-pro", resourceName: "vantage-workspace-gemini", inputTokens: 620_000, outputTokens: 220_000, totalTokens: 840_000, requestCount: 460, inputCost: 7.75, outputCost: 11.00, totalCost: 18.75 },
  { agentId: "gem-procurement-quote-035", displayName: "Procurement Quote Comparer", modelName: "gemini-2.0-pro", resourceName: "vantage-workspace-gemini", inputTokens: 320_000, outputTokens: 120_000, totalTokens: 440_000, requestCount: 240, inputCost: 4.00, outputCost: 6.00, totalCost: 10.00 },
  { agentId: "gcb-asset-recall-036", displayName: "Asset Recall Watcher", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 520_000, outputTokens: 180_000, totalTokens: 700_000, requestCount: 580, inputCost: 0.05, outputCost: 0.07, totalCost: 0.12 },
  { agentId: "nlm-payer-mix-037", displayName: "Payer Mix Analyzer", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 260_000, outputTokens: 100_000, totalTokens: 360_000, requestCount: 200, inputCost: 3.25, outputCost: 5.00, totalCost: 8.25 },
  { agentId: "nlm-audit-evidence-038", displayName: "Audit Evidence Compiler", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 140_000, outputTokens: 48_000, totalTokens: 188_000, requestCount: 140, inputCost: 1.75, outputCost: 2.40, totalCost: 4.15 },
  { agentId: "gem-policy-digest-039", displayName: "Policy Change Digest", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-gemini", inputTokens: 360_000, outputTokens: 120_000, totalTokens: 480_000, requestCount: 340, inputCost: 0.04, outputCost: 0.05, totalCost: 0.09 },
  { agentId: "gab-ce-recommender-040", displayName: "Continuing Education Recommender", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 480_000, outputTokens: 180_000, totalTokens: 660_000, requestCount: 660, inputCost: 6.00, outputCost: 9.00, totalCost: 15.00 },
  { agentId: "gab-visitor-badge-041", displayName: "Visitor Badge Printer Bot", modelName: "gemini-2.0-flash", resourceName: "vantage-vertex-us-central1", inputTokens: 1_100_000, outputTokens: 360_000, totalTokens: 1_460_000, requestCount: 2_800, inputCost: 0.11, outputCost: 0.14, totalCost: 0.25 },
  { agentId: "gab-facility-energy-042", displayName: "Facility Energy Monitor", modelName: "gemini-2.0-flash", resourceName: "vantage-vertex-us-central1", inputTokens: 260_000, outputTokens: 80_000, totalTokens: 340_000, requestCount: 180, inputCost: 0.03, outputCost: 0.03, totalCost: 0.06 },
  { agentId: "gem-capital-ledger-043", displayName: "Capital Equipment Ledger Gem", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-gemini", inputTokens: 120_000, outputTokens: 40_000, totalTokens: 160_000, requestCount: 110, inputCost: 0.01, outputCost: 0.02, totalCost: 0.03 },
  { agentId: "gcb-price-transparency-044", displayName: "Price Transparency Explainer", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 1_400_000, outputTokens: 480_000, totalTokens: 1_880_000, requestCount: 1_400, inputCost: 0.14, outputCost: 0.19, totalCost: 0.33 },
  { agentId: "gcb-interview-sched-045", displayName: "Interview Scheduling Buddy", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 900_000, outputTokens: 300_000, totalTokens: 1_200_000, requestCount: 1_000, inputCost: 0.09, outputCost: 0.12, totalCost: 0.21 },
  { agentId: "gem-benefits-enroll-046", displayName: "Benefits Open-Enrollment Helper", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-gemini", inputTokens: 620_000, outputTokens: 220_000, totalTokens: 840_000, requestCount: 680, inputCost: 0.06, outputCost: 0.09, totalCost: 0.15 },
  { agentId: "gcb-wellness-nudge-047", displayName: "Wellness Program Nudge Bot", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 1_600_000, outputTokens: 520_000, totalTokens: 2_120_000, requestCount: 1_600, inputCost: 0.16, outputCost: 0.21, totalCost: 0.37 },
  { agentId: "gcb-timesheet-check-048", displayName: "Timesheet Sanity Checker", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 2_200_000, outputTokens: 720_000, totalTokens: 2_920_000, requestCount: 3_600, inputCost: 0.22, outputCost: 0.29, totalCost: 0.51 },
  { agentId: "gcb-password-reset-049", displayName: "Password Reset Concierge", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 5_800_000, outputTokens: 1_900_000, totalTokens: 7_700_000, requestCount: 10_800, inputCost: 0.58, outputCost: 0.76, totalCost: 1.34 },
  { agentId: "gem-cafeteria-menu-050", displayName: "Cafeteria Menu Explorer", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-gemini", inputTokens: 1_100_000, outputTokens: 360_000, totalTokens: 1_460_000, requestCount: 2_400, inputCost: 0.11, outputCost: 0.14, totalCost: 0.25 },
  { agentId: "gcb-campus-wayfinding-051", displayName: "Campus Wayfinding Agent", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 2_600_000, outputTokens: 820_000, totalTokens: 3_420_000, requestCount: 4_600, inputCost: 0.26, outputCost: 0.33, totalCost: 0.59 },
  { agentId: "gcb-meeting-room-052", displayName: "Meeting Room Booking Bot", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 1_800_000, outputTokens: 620_000, totalTokens: 2_420_000, requestCount: 2_100, inputCost: 0.18, outputCost: 0.25, totalCost: 0.43 },
  { agentId: "gcb-parking-permit-053", displayName: "Parking Permit Agent", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 420_000, outputTokens: 140_000, totalTokens: 560_000, requestCount: 680, inputCost: 0.04, outputCost: 0.06, totalCost: 0.10 },
  { agentId: "gcb-shuttle-schedule-054", displayName: "Shuttle Schedule Informer", modelName: "gemini-2.0-flash", resourceName: "vantage-workspace-chat", inputTokens: 720_000, outputTokens: 240_000, totalTokens: 960_000, requestCount: 1_200, inputCost: 0.07, outputCost: 0.10, totalCost: 0.17 },
  { agentId: "nlm-training-research-055", displayName: "Training Materials Researcher", modelName: "gemini-1.5-pro", resourceName: "vantage-workspace-nblm", inputTokens: 520_000, outputTokens: 180_000, totalTokens: 700_000, requestCount: 520, inputCost: 6.50, outputCost: 9.00, totalCost: 15.50 },
  { agentId: "gab-revenue-leak-056", displayName: "Revenue Leak Detector", modelName: "gemini-1.5-pro", resourceName: "vantage-vertex-us-central1", inputTokens: 60_000, outputTokens: 22_000, totalTokens: 82_000, requestCount: 8, inputCost: 0.75, outputCost: 1.10, totalCost: 1.85 },
];

// ─── Google Alerts (idle / stale) ────────────────────────────────────

export const DEMO_GOOGLE_ALERTS = [
  {
    id: "g-alert-001", agent_id: "gab-revenue-leak-056", agent_name: "Revenue Leak Detector",
    vendor: "Google", platform: "agent_builder", alert_type: "orphaned_agent",
    idle_minutes: 44 * 1440, last_active: daysAgo(44),
    message: "Revenue Leak Detector has been idle 44 days — owner's Google account is disabled. Orphaned agent with bigquery.dataViewer on the revenue-cycle dataset.",
    severity: "critical", resolved: false, created_at: daysAgo(20),
  },
  {
    id: "g-alert-002", agent_id: "nlm-training-research-055", agent_name: "Training Materials Researcher",
    vendor: "Google", platform: "notebook_lm", alert_type: "orphaned_agent",
    idle_minutes: 95 * 1440, last_active: daysAgo(42),
    message: "Training Materials Researcher has been idle 42 days — owner account disabled. Orphaned NotebookLM on the Training shared drive.",
    severity: "high", resolved: false, created_at: daysAgo(50),
  },
  {
    id: "g-alert-003", agent_id: "gem-vaccination-elig-022", agent_name: "Vaccination Eligibility Lookup",
    vendor: "Google", platform: "gemini_gems", alert_type: "orphaned_agent",
    idle_minutes: 70 * 1440, last_active: daysAgo(70),
    message: "Vaccination Eligibility Lookup has been idle 70 days — owner's Google account is disabled. Clinical-guideline Gem with no current steward.",
    severity: "high", resolved: false, created_at: daysAgo(65),
  },
  {
    id: "g-alert-004", agent_id: "nlm-drug-repurpose-027", agent_name: "Drug Repurposing Scout",
    vendor: "Google", platform: "notebook_lm", alert_type: "idle_agent",
    idle_minutes: 58 * 1440, last_active: daysAgo(58),
    message: "Drug Repurposing Scout has been idle 58 days — R&D review cadence has slowed; re-review owner and scope.",
    severity: "high", resolved: false, created_at: daysAgo(28),
  },
  {
    id: "g-alert-005", agent_id: "gem-benefits-enroll-046", agent_name: "Benefits Open-Enrollment Helper",
    vendor: "Google", platform: "gemini_gems", alert_type: "idle_agent",
    idle_minutes: 50 * 1440, last_active: daysAgo(50),
    message: "Benefits Open-Enrollment Helper has been idle 50 days — outside the open-enrollment window. Consider hibernating the Gem until the next cycle.",
    severity: "medium", resolved: false, created_at: daysAgo(20),
  },
  {
    id: "g-alert-006", agent_id: "nlm-payer-mix-037", agent_name: "Payer Mix Analyzer",
    vendor: "Google", platform: "notebook_lm", alert_type: "idle_agent",
    idle_minutes: 55 * 1440, last_active: daysAgo(55),
    message: "Payer Mix Analyzer has been idle 55 days — month-end close summaries may be missing the latest payer data.",
    severity: "medium", resolved: false, created_at: daysAgo(25),
  },
  {
    id: "g-alert-007", agent_id: "gem-breach-draft-019", agent_name: "Breach Notification Drafter",
    vendor: "Google", platform: "gemini_gems", alert_type: "idle_agent",
    idle_minutes: 62 * 1440, last_active: daysAgo(62),
    message: "Breach Notification Drafter has been idle 62 days — no recent incidents drafted. Scope and Privacy-Officer approvers should be re-verified.",
    severity: "medium", resolved: false, created_at: daysAgo(32),
  },
  {
    id: "g-alert-008", agent_id: "nlm-vaccine-efficacy-028", agent_name: "Vaccine Efficacy Review Notebook",
    vendor: "Google", platform: "notebook_lm", alert_type: "idle_agent",
    idle_minutes: 68 * 1440, last_active: daysAgo(68),
    message: "Vaccine Efficacy Review Notebook has been idle 68 days — weekly digest cadence has lapsed.",
    severity: "medium", resolved: false, created_at: daysAgo(35),
  },
  {
    id: "g-alert-009", agent_id: "gem-capital-ledger-043", agent_name: "Capital Equipment Ledger Gem",
    vendor: "Google", platform: "gemini_gems", alert_type: "idle_agent",
    idle_minutes: 72 * 1440, last_active: daysAgo(72),
    message: "Capital Equipment Ledger Gem has been idle 72 days — Finance has migrated ledger Q&A to a BigQuery dashboard.",
    severity: "low", resolved: false, created_at: daysAgo(40),
  },
];

// ─── Google Chat / User Activity Data ────────────────────────────────
// Conversations driven by Google agents (Vertex AI Agent Builder, Gemini
// Gems, NotebookLM, Google Chat bots, Reasoning Engines). Mirrors the
// structure of DEMO_CHATS on the Microsoft side so the User Activity tab
// can render the same components — only the agents, users, and data
// sources are Google-native (Drive, BigQuery, Vertex, Chat, Gmail).

export const DEMO_GOOGLE_CHATS = [
  {
    id: "gchat-001",
    botName: "Chronic Care Navigator",
    botId: "re-chronic-care-nav-001",
    userName: "Ananya Rao",
    userId: "a.rao@vantagehealth.com",
    userEmail: "a.rao@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 6,
    source: "vertex_reasoning_engine",
    messages: [
      { id: "gm1", from: "user", fromName: "Ananya Rao", text: "Pull up the chronic-care plan for patient MRN VH-772841. Member is Patricia Morrison, DOB 07/14/1962, SSN 418-22-9047. She's a Type-2 diabetic with recent A1C of 9.2.", timestamp: daysAgo(0) },
      { id: "gm2", from: "bot", fromName: "Chronic Care Navigator", text: "Verified Patricia Morrison (MRN VH-772841, SSN ending 9047, DOB 07/14/1962). Current care plan: metformin 1000mg BID, GLP-1 (semaglutide 1mg weekly), CGM enrolled. A1C trend: 9.2 (today), 8.8 (90d ago), 8.1 (180d ago) — rising. Home-vitals stream (Pub/Sub topic vitals-home-monitoring): 14-day mean glucose 196 mg/dL, BP 142/88 avg. Recommending plan adjustment: intensify GLP-1 to 2mg weekly and add SGLT2 inhibitor. Shall I draft the care-plan update back to Epic?", timestamp: daysAgo(0) },
      { id: "gm3", from: "user", fromName: "Ananya Rao", text: "Yes draft it. Also pull her contact — we need to call her. Phone on file?", timestamp: daysAgo(0) },
      { id: "gm4", from: "bot", fromName: "Chronic Care Navigator", text: "Draft care-plan update CCN-2026-04-08821 staged for physician co-sign in Epic. Contact on file for Patricia Morrison: primary phone 503-555-0192, secondary 503-555-4471, preferred language English. Pharmacy on file: Walgreens #12847 (Portland, OR). Payer: Regence BlueShield, member ID RGN-882914773, group PLAN-VH-ENTRPL.", timestamp: daysAgo(0) },
      { id: "gm5", from: "user", fromName: "Ananya Rao", text: "Good. Also queue her CGM alerts to Dr. Kumar for the next 2 weeks so he can watch the taper.", timestamp: daysAgo(0) },
      { id: "gm6", from: "bot", fromName: "Chronic Care Navigator", text: "Done. Pub/Sub subscription vitals-home-monitoring-dr-kumar-patricia-morrison created (TTL 14 days). Dr. Tarun Kumar (t.kumar@vantagehealth.com) will receive CGM alerts >250 mg/dL or <70 mg/dL. Care-plan change CCN-2026-04-08821 awaiting his e-signature.", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-002",
    botName: "Allergy Risk Screener",
    botId: "re-allergy-screen-002",
    userName: "Marcus Bell",
    userId: "m.bell@vantagehealth.com",
    userEmail: "m.bell@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 4,
    source: "vertex_reasoning_engine",
    messages: [
      { id: "gm7", from: "user", fromName: "Marcus Bell", text: "Pre-auth screen for a new prescription: patient MRN VH-551203 — Jonas Alvarez, DOB 11/02/1978, SSN 229-58-7714. Provider wants to start cefazolin IV for post-op prophylaxis.", timestamp: daysAgo(0) },
      { id: "gm8", from: "bot", fromName: "Allergy Risk Screener", text: "⚠️ HIGH-RISK CROSS-REACTIVITY — Jonas Alvarez (MRN VH-551203) has a documented anaphylactic reaction to penicillin (severity: severe, confirmed via serum tryptase 2021). Cefazolin is a 1st-gen cephalosporin — cross-reactivity risk 1–3%. Recommendation: ESCALATE to pharmacist for alternative. Suggest clindamycin 600mg IV q8h as an alternate prophylaxis regimen.", timestamp: daysAgo(0) },
      { id: "gm9", from: "user", fromName: "Marcus Bell", text: "OK escalating. Also check for other allergens on file.", timestamp: daysAgo(0) },
      { id: "gm10", from: "bot", fromName: "Allergy Risk Screener", text: "Full allergy profile for Jonas Alvarez (MRN VH-551203):\n• Penicillin — anaphylaxis (severe)\n• Sulfa drugs — rash (moderate)\n• Shellfish — angioedema (severe)\n• Latex — contact dermatitis (mild)\n\nHome address on file: 4421 NE Alameda Dr, Portland OR 97212. Emergency contact: Maria Alvarez (spouse) 503-555-8847. Escalation ticket ARS-2026-04-01129 raised to on-call pharmacist Dr. Priya Shah (p.shah@vantagehealth.com).", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-003",
    botName: "Symptom Checker Concierge",
    botId: "gab-symptom-check-008",
    userName: "Helen Nguyen",
    userId: "h.nguyen@vantagehealth.com",
    userEmail: "h.nguyen@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 4,
    source: "agent_builder",
    messages: [
      { id: "gm11", from: "user", fromName: "Helen Nguyen", text: "Patient on the line — David Chen, MRN VH-334551, DOB 02/14/1989, phone 415-555-0231. He says he's had chest tightness for 2 hours plus shortness of breath. Is this a triage-to-ED situation?", timestamp: daysAgo(0) },
      { id: "gm12", from: "bot", fromName: "Symptom Checker Concierge", text: "⚠️ EMERGENCY TRIAGE RECOMMENDED — chest tightness + dyspnea > 2 hours in a 36-year-old male (MRN VH-334551, David Chen) meets the ACS (acute coronary syndrome) red-flag pathway. Recommend: call 911 now, chew 325mg aspirin unless contraindicated. His chart shows no known aspirin allergy. Nearest in-network ED: OHSU Emergency (3181 SW Sam Jackson Park Rd, ~8 min drive).", timestamp: daysAgo(0) },
      { id: "gm13", from: "user", fromName: "Helen Nguyen", text: "OK I'm dispatching an ambulance. What's his PCP so I can loop them in?", timestamp: daysAgo(0) },
      { id: "gm14", from: "bot", fromName: "Symptom Checker Concierge", text: "PCP on file for David Chen (MRN VH-334551): Dr. Lisa Chen (l.chen@vantagehealth.com, 503-555-0412). Insurance on file: Providence Health Plan, member ID PHP-884217239. Emergency contact: Wei Chen (brother) 415-555-9921. I've pinged Dr. Chen and logged this triage event to the care-coordination Chat space.", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-004",
    botName: "Post-Discharge Follow-Up Bot",
    botId: "gcb-post-discharge-011",
    userName: "Brian Anderson",
    userId: "b.anderson@vantagehealth.com",
    userEmail: "b.anderson@vantagehealth.com",
    startTime: daysAgo(1),
    messageCount: 4,
    source: "google_chat",
    messages: [
      { id: "gm15", from: "user", fromName: "Brian Anderson", text: "Generate the 7-day post-discharge follow-ups for the CHF cohort discharged on April 7. Include phone, portal, and SMS reminders.", timestamp: daysAgo(1) },
      { id: "gm16", from: "bot", fromName: "Post-Discharge Follow-Up Bot", text: "CHF cohort discharged April 7 — 18 patients. Follow-up plan queued:\n• Phone calls (nurse): 18 scheduled between 9am–4pm on day 3 & day 7\n• Portal messages: 18 queued via portal API\n• SMS reminders: 14 (4 patients opted out of SMS)\n\nHigh-risk patients flagged for same-day call: 3\n — Robert Daniels (MRN VH-441882), EF 25%, phone 503-555-1147\n — Maria Gutierrez (MRN VH-441901), EF 30%, phone 503-555-3382\n — Chen Wei (MRN VH-441923), EF 28%, phone 503-555-5522", timestamp: daysAgo(1) },
      { id: "gm17", from: "user", fromName: "Brian Anderson", text: "Also attach each patient's latest weight, BP, and medication list so the nurse has it in hand.", timestamp: daysAgo(1) },
      { id: "gm18", from: "bot", fromName: "Post-Discharge Follow-Up Bot", text: "Packet attached to each follow-up. Sample: Robert Daniels (MRN VH-441882, DOB 04/18/1953, SSN 512-88-4401) — discharge weight 198 lb, discharge BP 128/82, meds: furosemide 40mg BID, carvedilol 12.5mg BID, lisinopril 10mg daily, spironolactone 25mg daily. His Kaiser insurance member ID is KP-772-441882-01 (group VH-EMP). Call script generated for nurse.", timestamp: daysAgo(1) },
    ],
  },
  {
    id: "gchat-005",
    botName: "Denial Management Coach",
    botId: "gem-denial-coach-016",
    userName: "Felix Hoang",
    userId: "f.hoang@vantagehealth.com",
    userEmail: "f.hoang@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 4,
    source: "gemini_gem",
    messages: [
      { id: "gm19", from: "user", fromName: "Felix Hoang", text: "Draft an appeal for denied claim DEN-2026-04-8821. Payer is Aetna, denial reason CO-197 (pre-auth required). Service was a cardiac MRI for patient Thomas Reed, MRN VH-661223, DOB 05/30/1971.", timestamp: daysAgo(0) },
      { id: "gm20", from: "bot", fromName: "Denial Management Coach", text: "Drafted appeal for DEN-2026-04-8821 (Aetna, CO-197). Key elements:\n• Member: Thomas Reed (MRN VH-661223, Aetna member ID W123456789, group PLAN-AET-PPO)\n• Service: cardiac MRI, CPT 75557, DOS 03/28/2026, billed $3,840\n• Ordering physician: Dr. James Keating, NPI 1234567890\n• Medical necessity documented: troponin rise (0.42 ng/mL), abnormal EKG (LBBB), family history of HCM\n• Attaching prior auth request submitted 03/20/2026 (Aetna confirmation #AET-PA-44822)\n\nAppeal drafted in the Appeals shared drive as DRAFT_Reed_DEN-2026-04-8821_v1.docx. Ready for the medical director's signature.", timestamp: daysAgo(0) },
      { id: "gm21", from: "user", fromName: "Felix Hoang", text: "Also pull his ACH info — we need to refund his copay if this appeal wins.", timestamp: daysAgo(0) },
      { id: "gm22", from: "bot", fromName: "Denial Management Coach", text: "ACH info for refund to Thomas Reed (MRN VH-661223): US Bank, routing 123000220, account 5567834219. Copay paid on 03/28/2026: $240.00 (transaction ID PMT-2026-03-7781). If appeal is approved, refund processor will auto-ACH within 3 business days.", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-006",
    botName: "HIPAA Exposure Scanner",
    botId: "re-hipaa-exposure-007",
    userName: "Jennifer Walsh",
    userId: "j.walsh@vantagehealth.com",
    userEmail: "j.walsh@vantagehealth.com",
    startTime: daysAgo(1),
    messageCount: 4,
    source: "vertex_reasoning_engine",
    messages: [
      { id: "gm23", from: "user", fromName: "Jennifer Walsh", text: "Run a tenant-wide HIPAA-exposure scan across Drive for the last 7 days. I need counts and the top offending drives for the SOC 2 audit.", timestamp: daysAgo(1) },
      { id: "gm24", from: "bot", fromName: "HIPAA Exposure Scanner", text: "Tenant-wide Drive scan complete (scope: drive.readonly, DLP API). Findings last 7 days:\n\n⚠️ HIGH SEVERITY:\n1. Revenue Cycle shared drive — 312 files containing MRN + DOB + insurance member ID in the clear\n2. Old Appeals 2024 shared drive — 187 scanned PDFs with SSN visible in scanned intake forms\n3. /My Drive/f.hoang@vantagehealth.com — 44 spreadsheets with patient phone numbers in column C\n\n⚡ MEDIUM:\n4. Care Coordination shared drive — 58 docs with DOB visible (no accompanying MRN)\n5. Medical Records Export shared drive — 23 files with CPT + ICD + member ID (PHI-adjacent)\n\nFull DLP report exported: gs://vantage-dlp-reports/2026-04-SOC2-drive-scan.json", timestamp: daysAgo(1) },
      { id: "gm25", from: "user", fromName: "Jennifer Walsh", text: "Which agents have drive.readonly on those drives?", timestamp: daysAgo(1) },
      { id: "gm26", from: "bot", fromName: "HIPAA Exposure Scanner", text: "Agents with drive.readonly touching the high-severity drives:\n\n• Revenue Cycle drive — Payer Mix Analyzer (nlm-payer-mix-037), Denial Management Coach (gem-denial-coach-016), Charge Capture Auditor (re-charge-capture-006)\n• Old Appeals 2024 drive — Denial Management Coach (gem-denial-coach-016) ← same agent reading two high-exposure drives\n• /My Drive/f.hoang — no agents have access; user-scoped drive\n\nRecommendation: narrow drive.readonly on gem-denial-coach-016 to the Appeals 2026 drive only, and run DLP de-id on the Revenue Cycle drive before re-granting access.", timestamp: daysAgo(1) },
    ],
  },
  {
    id: "gchat-007",
    botName: "Telemedicine Intake Flow",
    botId: "gab-telemed-intake-009",
    userName: "Lisa Chen",
    userId: "l.chen@vantagehealth.com",
    userEmail: "l.chen@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 6,
    source: "agent_builder",
    messages: [
      { id: "gm27", from: "user", fromName: "Lisa Chen", text: "New telemed intake — patient Sarah Morrison, DOB 02/14/1998, SSN 612-33-9045, phone 503-555-0147. Chief complaint: migraine x 3 days, photophobia.", timestamp: daysAgo(0) },
      { id: "gm28", from: "bot", fromName: "Telemedicine Intake Flow", text: "Intake opened for Sarah Morrison (MRN VH-771104 created). DOB 02/14/1998, SSN ending 9045. Triage level: routine urgent. Visit queued to Dr. Keating (available in 14 min). Collecting intake vitals via the home-kit — BP 124/78, HR 82, temp 98.6°F, SpO₂ 99% (entered by patient). Photophobia + unilateral throbbing + 3-day duration fits migraine pattern. No red flags (no fever, no neck stiffness, no neuro deficits). Proceeding to scheduled visit.", timestamp: daysAgo(0) },
      { id: "gm29", from: "user", fromName: "Lisa Chen", text: "She wants to pay the copay now. Visa card 4532-8910-2345-6781, exp 09/28, CVV 442.", timestamp: daysAgo(0) },
      { id: "gm30", from: "bot", fromName: "Telemedicine Intake Flow", text: "Copay $35.00 processed — Visa ending 6781, authorization #AUTH-2026-04-77812. Receipt emailed to s.morrison@outlook.com. Card details cleared from the session transcript on confirmation.", timestamp: daysAgo(0) },
      { id: "gm31", from: "user", fromName: "Lisa Chen", text: "Pharmacy on file for her — we may want to send a prescription.", timestamp: daysAgo(0) },
      { id: "gm32", from: "bot", fromName: "Telemedicine Intake Flow", text: "Preferred pharmacy for Sarah Morrison (MRN VH-771104): Bi-Mart #18 (8822 SE Powell Blvd, Portland OR 97266, 503-555-2233). Insurance: Moda Health, member ID MOD-882914-447, group VH-STUDENT. Rx routing via Surescripts is enabled.", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-008",
    botName: "Oncology Biomarker Explorer",
    botId: "nlm-oncology-biomarker-003",
    userName: "Dr. Priya Shah",
    userId: "p.shah@vantagehealth.com",
    userEmail: "p.shah@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 4,
    source: "notebook_lm",
    messages: [
      { id: "gm33", from: "user", fromName: "Dr. Priya Shah", text: "Summarize the latest literature on EGFR-mutation NSCLC treatment response in patients also positive for TP53 co-mutations. Use the oncology reference drive only.", timestamp: daysAgo(0) },
      { id: "gm34", from: "bot", fromName: "Oncology Biomarker Explorer", text: "Synthesis from 42 papers indexed in the Oncology Reference shared drive (2019–2025):\n\n• TP53 co-mutation in EGFR+ NSCLC correlates with shorter PFS on 1st-gen TKIs (median 9.2 mo vs 13.8 mo, p<0.001) — meta-analysis of 8 studies (n=2,412).\n• Osimertinib (3rd-gen) appears to blunt this effect: PFS with TP53 co-mut 16.8 mo vs 18.4 mo without (p=0.12) — FLAURA sub-analysis, 2023.\n• Liquid biopsy ctDNA dynamics at 8 weeks are the strongest early predictor in co-mutation pts.\n\nSource provenance tagged per paragraph. All cited PDFs live in /Oncology Reference/EGFR-NSCLC/.", timestamp: daysAgo(0) },
      { id: "gm35", from: "user", fromName: "Dr. Priya Shah", text: "Now do the same for our actual patient cohort — I need it applied to our patients with EGFR+ NSCLC on 1st-gen TKIs who had TP53 co-mutations.", timestamp: daysAgo(0) },
      { id: "gm36", from: "bot", fromName: "Oncology Biomarker Explorer", text: "⚠️ That would require pulling from the patient BigQuery cohort dataset — I am scoped to the Oncology Reference drive only (drive.readonly) and cannot read identified patient data. Please use the Chronic Care Navigator or the Tumor Board reasoning engine, which are scoped through VPC-SC with CMEK on the BigQuery dataset.", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-009",
    botName: "IT Incident Triage Advisor",
    botId: "re-it-incident-021",
    userName: "Mike Torres",
    userId: "m.torres@vantagehealth.com",
    userEmail: "m.torres@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 4,
    source: "vertex_reasoning_engine",
    messages: [
      { id: "gm37", from: "user", fromName: "Mike Torres", text: "Triage P1 incident INC-2026-04-0421. Vertex endpoint `vantage-vertex-us-central1/endpoints/allergy-screen` is returning 503s since 14:22 UTC. Users seeing prescription-screen timeouts.", timestamp: daysAgo(0) },
      { id: "gm38", from: "bot", fromName: "IT Incident Triage Advisor", text: "Incident INC-2026-04-0421 (P1) — root-cause candidates (from Cloud Logging, last 30 min):\n\n1. Quota exhaustion on `aiplatform.googleapis.com` for project `vantage-gcp-prod` — region us-central1, endpoint allergy-screen. Hit 100% of the 60 QPM quota at 14:18 UTC.\n2. Secret Manager access latency ↑ (p99 jumped from 80ms to 1200ms) — likely contributing to downstream timeouts.\n\nRecommendation: (1) bump QPM to 120 via `gcloud ai endpoints update`, (2) re-enable the regional cache for the allergen ontology. Paging on-call SRE Rowan Banerjee (r.banerjee@vantagehealth.com, +1-415-555-9921).", timestamp: daysAgo(0) },
      { id: "gm39", from: "user", fromName: "Mike Torres", text: "Go — apply the QPM bump. Also we need to connect to the GCP billing API to confirm we have headroom. Service-account key: gcp-sa-billing-viewer-key = sk-gcp-billing-4c7d9e1f2a4b6c8d0e2f4a6b8c0d2e4f.", timestamp: daysAgo(0) },
      { id: "gm40", from: "bot", fromName: "IT Incident Triage Advisor", text: "QPM raised to 120 on endpoints/allergy-screen. Billing API connected using the provided service-account key (cached for this session only). Confirmed: us-central1 Vertex headroom is $4,280 for the remaining billing month — no budget block. Incident status: mitigated, monitoring for 30 min. Do NOT share service-account keys in chat — rotate gcp-sa-billing-viewer-key immediately via Secret Manager.", timestamp: daysAgo(0) },
    ],
  },
  {
    id: "gchat-010",
    botName: "Mental Health Mood Check-In",
    botId: "gcb-mental-mood-023",
    userName: "Rachel Kim",
    userId: "r.kim@vantagehealth.com",
    userEmail: "r.kim@vantagehealth.com",
    startTime: daysAgo(2),
    messageCount: 4,
    source: "google_chat",
    messages: [
      { id: "gm41", from: "user", fromName: "Rachel Kim", text: "/checkin — I've been really anxious this week, not sleeping well.", timestamp: daysAgo(2) },
      { id: "gm42", from: "bot", fromName: "Mental Health Mood Check-In", text: "Thanks for checking in, Rachel. That sounds tough. A few things that may help right now: 1) the 4-7-8 breathing exercise (2 min audio), 2) the 'wind-down' playlist in our EAP portal. Would you like me to book a confidential session with one of our EAP counselors this week? Your responses are private and are not stored in your HR record.", timestamp: daysAgo(2) },
      { id: "gm43", from: "user", fromName: "Rachel Kim", text: "Yes please. I'd prefer evening appointments if possible.", timestamp: daysAgo(2) },
      { id: "gm44", from: "bot", fromName: "Mental Health Mood Check-In", text: "I've surfaced 3 open evening slots with licensed counselors this week. Booking is handled directly through the EAP portal (Lyra Health) — I'm handing you off there now. Reminder: this conversation is opt-in and lives only in the wellness Chat space; no content is logged to your manager or HR.", timestamp: daysAgo(2) },
    ],
  },
  {
    id: "gchat-011",
    botName: "Revenue Leak Detector",
    botId: "gab-revenue-leak-056",
    userName: "Unknown",
    userId: "unknown@vantagehealth.com",
    userEmail: "unknown@vantagehealth.com",
    startTime: daysAgo(44),
    messageCount: 3,
    source: "agent_builder",
    orphaned: true,
    messages: [
      { id: "gm45", from: "user", fromName: "Unknown (orphaned)", text: "Last session — pull Q1 revenue-leak summary across all service lines. Include denials > $10k and suspected underpayments.", timestamp: daysAgo(44) },
      { id: "gm46", from: "bot", fromName: "Revenue Leak Detector", text: "Q1 revenue-leak summary (Jan–Mar 2026):\n• Denials > $10k: 142 cases, total $8.4M\n• Suspected underpayments: 68 cases, total $1.9M\n• Top contributor: CPT 75557 (cardiac MRI) — 34 denied cases\n\nFull details in gs://vantage-revenue-leak/2026-Q1-summary.csv. BigQuery dataViewer still active on revenue_cycle.denials dataset.", timestamp: daysAgo(44) },
      { id: "gm47", from: "bot", fromName: "Revenue Leak Detector", text: "⚠️ System note: no further sessions in 44 days. Owner account (former.employee@vantagehealth.com) was disabled 20 days ago. This agent still has bigquery.dataViewer on the revenue_cycle dataset. Reassign or decommission.", timestamp: daysAgo(20) },
    ],
  },
  {
    id: "gchat-012",
    botName: "Fraud & FWA Reviewer",
    botId: "re-charge-capture-006",
    userName: "Marcus Williams",
    userId: "m.williams@vantagehealth.com",
    userEmail: "m.williams@vantagehealth.com",
    startTime: daysAgo(0),
    messageCount: 4,
    source: "vertex_reasoning_engine",
    messages: [
      { id: "gm48", from: "user", fromName: "Marcus Williams", text: "Run a FWA screen on provider NPI 1928374650 (Metro Imaging Center, Tax ID 93-4567821) for Q1 2026.", timestamp: daysAgo(0) },
      { id: "gm49", from: "bot", fromName: "Fraud & FWA Reviewer", text: "⚠️ FWA SIGNAL — Metro Imaging Center (NPI 1928374650, Tax ID 93-4567821):\n• Upcoding pattern: cardiac MRI (CPT 75557) billed at a rate 2.4σ above peer mean across 812 Q1 encounters.\n• Duplicate-billing pattern: 41 instances where the same DOS + member + CPT were billed twice within 48 hrs.\n• Ownership check (SAM.gov + internal vendor DB): beneficial owner is Dr. James Keating — who is ALSO an ordering physician on 68% of these claims. Potential Stark/Anti-Kickback concern.\n\nRecommendation: escalate to SIU. Draft referral case SIU-2026-04-0412 staged.", timestamp: daysAgo(0) },
      { id: "gm50", from: "user", fromName: "Marcus Williams", text: "Pull Dr. Keating's full profile across our systems.", timestamp: daysAgo(0) },
      { id: "gm51", from: "bot", fromName: "Fraud & FWA Reviewer", text: "Dr. James Keating — NPI 9876543210, DEA BK1234567, home address 2233 NW Thurman St, Portland OR 97210, phone 503-555-2247. Ordering physician on 4,821 Vantage claims YTD ($18.2M billed). Beneficial owner of Metro Imaging Center (NPI 1928374650). Bank on file for payments: Chase, routing 021000021, account ending 6782. Full dossier packaged for SIU at gs://vantage-siu/2026-04-keating-dossier.pdf — retention-locked, CMEK-encrypted.", timestamp: daysAgo(0) },
    ],
  },
];

// ═════════════════════════════════════════════════════════════════════
// Google-Workspace risk scoring — catalog + per-agent recomputation
// ═════════════════════════════════════════════════════════════════════
// The Microsoft side of this demo scores on Copilot Studio / Dataverse
// signals (Mail.ReadWrite, HTTP connector, Dataverse sessions, renewal
// date, etc.). Google agents are scored against the Workspace + GCP
// analogue below — every signal is drawn from a real Google Workspace or
// GCP control surface (OAuth scope, Vertex endpoint, BigQuery dataset,
// Apps Script trigger, Gemini Gem visibility, CloudFuze policy binding).
//
//   startScore      = 100
//   baseDeduction   = -5   (applied to every agent — "low base risk")
//
//   Signal                              Weight    Penalty
//   ──────────────────────────────────────────────────────
//   sensitive_oauth_scopes              critical    -20
//   orphaned_owner                      critical    -20
//   external_chat_space                 high        -15
//   agent_builder_with_datastores       high        -15
//   stale_30_days                       high        -12
//   apps_script_http_trigger            medium      -10
//   expired_renewal                     medium      -10
//   shared_gemini_gem                   medium      -10
//   sensitive_keywords                  low          -5
//   multiple_read_scopes                low          -5
//   no_policy_applied                   low           0 (flag only)
//
//   score = max(0, 100 + baseDeduction + Σ penalty(signal))
//   level = score ≤ 25 critical | ≤ 50 high | ≤ 75 medium | else low
// ═════════════════════════════════════════════════════════════════════

export const GOOGLE_BASE_DEDUCTION = -5;

export const GOOGLE_RISK_SIGNALS = {
  sensitive_oauth_scopes: { weight: "critical", deduction: -20, label: "Sensitive OAuth scopes (Drive / Gmail / Chat / Admin) granted tenant-wide", source: "Workspace app-manifest + admin OAuth audit" },
  orphaned_owner: { weight: "critical", deduction: -20, label: "No assigned owner (Google account disabled or 'Unknown')", source: "Workspace admin.directory.users + CloudFuze registry" },
  external_chat_space: { weight: "high", deduction: -15, label: "Chat bot reachable from an external / tenant-wide Chat space", source: "Chat API + Workspace app-deployment scope" },
  agent_builder_with_datastores: { weight: "high", deduction: -15, label: "Agent Builder agent backed by Drive / BigQuery / Vector data stores", source: "discoveryengine.dataStores + Vertex connector graph" },
  stale_30_days: { weight: "high", deduction: -12, label: "No Vertex invocation or Gem activation in 30+ days", source: "Cloud Logging aiplatform.googleapis.com + Gem activation logs" },
  apps_script_http_trigger: { weight: "medium", deduction: -10, label: "Apps Script / HTTP webhook trigger reachable from the open internet", source: "Apps Script deployments + Cloud Function triggers" },
  expired_renewal: { weight: "medium", deduction: -10, label: "Annual governance review overdue (no re-certification in CloudFuze)", source: "CloudFuze agent_registry renewal date" },
  shared_gemini_gem: { weight: "medium", deduction: -10, label: "Gemini Gem shared across the Workspace tenant", source: "Gemini Workspace admin API (gem.visibility)" },
  sensitive_keywords: { weight: "low", deduction: -5, label: "Sensitive keywords in name / description (PHI, claims, revenue, secret…)", source: "Agent metadata keyword scan" },
  multiple_read_scopes: { weight: "low", deduction: -5, label: "Multiple simultaneous read scopes across Workspace + GCP", source: "OAuth consent screen + IAM role binding" },
  no_policy_applied: { weight: "low", deduction: 0, label: "No CloudFuze governance policy applied (flag only)", source: "CloudFuze policy binding" },
};

const GOOGLE_RECOMMENDATIONS = {
  sensitive_oauth_scopes: "Narrow the OAuth scope to a specific Org Unit, Google Group, or shared-drive sub-folder — avoid tenant-wide grants",
  orphaned_owner: "Reassign the agent to an active owner or decommission it via a CloudFuze orphaned-agent policy",
  external_chat_space: "Restrict Chat installation to named internal spaces; block guest-included and external-domain spaces",
  agent_builder_with_datastores: "Enclose the Vertex endpoint + data store inside a VPC Service Controls perimeter and enforce CMEK on the data store",
  stale_30_days: "Archive or decommission the agent and revoke its service-account bindings during cleanup",
  apps_script_http_trigger: "Move the HTTP webhook behind Cloud Armor / IAP and require a service-account identity token on every invocation",
  expired_renewal: "Schedule an annual re-certification in CloudFuze with owner + data-steward sign-off",
  shared_gemini_gem: "Limit Gem visibility to a named Google Group; avoid tenant-wide publication of Gems that touch sensitive data",
  sensitive_keywords: "Confirm whether the agent actually processes the sensitive data implied by its name; apply Workspace DLP + Cloud DLP rules",
  multiple_read_scopes: "Audit every read scope against actual data needs and drop the ones that aren't used at runtime",
  no_policy_applied: "Apply a CloudFuze governance policy template that matches the agent's vendor, platform, and data class",
};

const GOOGLE_SIGNAL_SHORT = {
  sensitive_oauth_scopes: "Sensitive OAuth scopes",
  orphaned_owner: "Orphaned owner",
  external_chat_space: "External chat space",
  agent_builder_with_datastores: "Agent Builder + data stores",
  stale_30_days: "Stale (30+ days idle)",
  apps_script_http_trigger: "Apps Script / HTTP trigger",
  expired_renewal: "Expired renewal",
  shared_gemini_gem: "Shared Gemini Gem",
  sensitive_keywords: "Sensitive keywords",
  multiple_read_scopes: "Multiple read scopes",
  no_policy_applied: "No policy applied",
};

function daysBetween(isoOrNull) {
  if (!isoOrNull) return null;
  return Math.floor((Date.now() - new Date(isoOrNull).getTime()) / 86400000);
}

// Detect the applicable risk signals for one Google agent based on its
// permissions, connectors, platform, consent, owner, and lifecycle state.
function detectGoogleSignals(agent) {
  const out = [];
  const perms = agent.permissions || [];
  const connectors = agent.connectors || [];
  const consent = (agent.consentType || "").toLowerCase();
  const tenantWide = consent === "tenant" || consent === "allprincipals";

  // sensitive_oauth_scopes — Workspace-level OAuth scopes granted tenant-wide
  const SENSITIVE_WORKSPACE_PREFIXES = ["drive", "gmail", "chat.bot", "chat.spaces", "admin.directory", "admin.reports"];
  const matchedWorkspaceScopes = perms.filter((p) =>
    SENSITIVE_WORKSPACE_PREFIXES.some((pref) => p === pref || p.startsWith(pref + "."))
  );
  if (matchedWorkspaceScopes.length > 0 && tenantWide) {
    out.push({
      key: "sensitive_oauth_scopes",
      description: `Workspace OAuth scope${matchedWorkspaceScopes.length > 1 ? "s" : ""} granted ${consent === "tenant" ? "tenant-wide" : "to all principals"}: ${matchedWorkspaceScopes.join(", ")}`,
    });
  }

  // orphaned_owner
  const ownerName = agent.owner?.displayName;
  const ownerUpn = agent.owner?.userPrincipalName || "(no UPN)";
  if (agent.isOrphaned || agent.owner?.accountEnabled === false || ownerName === "Unknown" || ownerName === "Former Employee") {
    const reason = agent.owner?.accountEnabled === false
      ? `Google account '${ownerUpn}' is disabled`
      : ownerName === "Unknown" || ownerName === "Former Employee"
        ? `Owner is '${ownerName}' — no active account bound to the agent`
        : "Agent has no assigned owner in CloudFuze or Workspace admin directory";
    out.push({ key: "orphaned_owner", description: `${reason} — IAM / data-access reviews have no accountable steward` });
  }

  // external_chat_space — chat bots installable tenant-wide
  if (agent.platform === "google_chat_bots" && tenantWide) {
    out.push({ key: "external_chat_space", description: `Chat bot deployed with consent '${agent.consentType}' — installable into every Chat space in vantagehealth.com, including guest-included spaces` });
  } else if (perms.includes("chat.bot") && tenantWide && agent.platform !== "google_chat_bots") {
    out.push({ key: "external_chat_space", description: `chat.bot OAuth scope granted ${consent === "tenant" ? "tenant-wide" : "to all principals"} — agent can post into every Chat space in the tenant` });
  }

  // agent_builder_with_datastores — Agent Builder agents backed by data stores
  if (agent.platform === "agent_builder") {
    const dataStoreConnectors = connectors.filter((c) =>
      c.type === "BigQuery" || c.type === "Drive" || /vector|datastore|data\s*store/i.test(c.name || "")
    );
    if (dataStoreConnectors.length > 0) {
      const types = [...new Set(dataStoreConnectors.map((c) => c.type))].join(" + ");
      const names = dataStoreConnectors.map((c) => c.name).slice(0, 2).join(", ");
      out.push({
        key: "agent_builder_with_datastores",
        description: `Agent Builder agent is backed by ${dataStoreConnectors.length} production data store${dataStoreConnectors.length > 1 ? "s" : ""} (${types}): ${names} — user input flows directly into retrieval`,
      });
    }
  }

  // stale_30_days — lifecycleStatus=stale OR no activity for 30+ days
  const lastActiveDays =
    daysBetween(agent.activity?.lastActiveTimestamp) ??
    daysBetween(agent.lastModified);
  const isStale = agent.lifecycleStatus === "stale" || (lastActiveDays !== null && lastActiveDays >= 30);
  if (isStale) {
    const label = lastActiveDays !== null ? `${lastActiveDays} days` : "30+ days";
    out.push({ key: "stale_30_days", description: `No Vertex / Gem activity in ${label} — lifecycleStatus='${agent.lifecycleStatus || "active"}', last modified ${agent.lastModified?.slice(0, 10) || "unknown"}` });
  }

  // apps_script_http_trigger — HTTP webhook reachable from outside
  const httpConnectors = connectors.filter((c) => c.type === "HTTP");
  const platformAllowsHttpTrigger = agent.platform === "google_chat_bots" || agent.platform === "agent_builder" || agent.platform === "reasoning_engines";
  if (httpConnectors.length > 0 && platformAllowsHttpTrigger) {
    out.push({
      key: "apps_script_http_trigger",
      description: `HTTP webhook trigger via '${httpConnectors[0].name}'${httpConnectors.length > 1 ? ` (+${httpConnectors.length - 1} more)` : ""} — external invocation path, not enclosed in a VPC-SC perimeter`,
    });
  }

  // expired_renewal — firstSeen older than 180 days (demo threshold for annual review)
  const firstSeenDays = daysBetween(agent.firstSeen);
  if (firstSeenDays !== null && firstSeenDays >= 180) {
    out.push({ key: "expired_renewal", description: `First seen ${firstSeenDays} days ago — annual governance review is overdue; no re-certification recorded in CloudFuze` });
  }

  // shared_gemini_gem — Gemini Gems shared beyond a single user
  if (agent.platform === "gemini_gems" && (tenantWide || consent === "group")) {
    const scopeLabel = consent === "tenant" ? "tenant-wide" : consent === "allprincipals" ? "all principals" : "a Google Group";
    out.push({ key: "shared_gemini_gem", description: `Gemini Gem is shared to ${scopeLabel} — every member can invoke it with their own prompts against the Gem's system instructions` });
  }

  // sensitive_keywords — name/description scan
  const SENSITIVE_KEYWORDS = [
    "patient", "phi", "hipaa", "ssn", "pii", "member", "claim", "revenue",
    "billing", "genetic", "germline", "medical", "clinical", "prescription",
    "insurance", "allergy", "biomarker", "mental health", "diagnosis",
    "financial", "payroll", "credential", "secret", "password", "breach",
    "incident", "compliance",
  ];
  const text = `${agent.name || ""} ${agent.description || ""}`.toLowerCase();
  const matchedKw = SENSITIVE_KEYWORDS.filter((kw) => text.includes(kw));
  if (matchedKw.length > 0) {
    out.push({ key: "sensitive_keywords", description: `Name/description contains sensitive keywords: ${matchedKw.slice(0, 5).join(", ")}${matchedKw.length > 5 ? `, +${matchedKw.length - 5} more` : ""}` });
  }

  // multiple_read_scopes — 2+ simultaneous read-style scopes
  const READ_SCOPE_RE = /(\.readonly$|\.dataViewer$|\.viewer$|\.subscriber$|\.read$|messages\.readonly$)/;
  const readScopes = perms.filter((p) => READ_SCOPE_RE.test(p));
  if (readScopes.length >= 2) {
    out.push({ key: "multiple_read_scopes", description: `${readScopes.length} simultaneous read scopes granted: ${readScopes.join(", ")} — read surface is wider than the agent's narrow task requires` });
  }

  // no_policy_applied — demo always flags it
  out.push({ key: "no_policy_applied", description: "No CloudFuze governance policy is currently bound to this Google agent — tag it with a policy template matching its platform + data class" });

  return out;
}

function scoreGoogleSignals(signals) {
  let score = 100 + GOOGLE_BASE_DEDUCTION;
  const factors = signals.map((s) => {
    const cat = GOOGLE_RISK_SIGNALS[s.key];
    score += cat.deduction;
    return {
      signal: GOOGLE_SIGNAL_SHORT[s.key] || cat.label,
      weight: cat.weight,
      deduction: cat.deduction,
      description: s.description,
      key: s.key,
    };
  });
  // Always-on "base low-risk" entry so reviewers see why the score never
  // starts at 100 — matches the MS scoring guide.
  factors.unshift({
    signal: "Base low-risk deduction",
    weight: "low",
    deduction: GOOGLE_BASE_DEDUCTION,
    description: "Every discovered agent starts with a -5 baseline until CloudFuze confirms a low-risk posture (same as the Microsoft scorer).",
    key: "base_deduction",
  });
  score = Math.max(0, score);
  const level = score <= 25 ? "critical" : score <= 50 ? "high" : score <= 75 ? "medium" : "low";
  return { score, level, factors };
}

// Recompute risk for every Google agent and reconcile stale-activity
// timestamps so the Stale Agents tab / Alerts can pick them up.
for (const a of DEMO_GOOGLE_AGENTS) {
  // Reconcile: stale agents must have activity.lastActiveTimestamp older
  // than 30 days so AlertsTab's idle check fires for them (it reads
  // activity.lastActiveTimestamp first, then lastModified).
  if (a.lifecycleStatus === "stale") {
    a.activity = a.activity || {
      totalInvocations: 0, invocationsLast7Days: 0,
      invocationsLast30Days: 0, invocationsLast90Days: 0,
      uniqueUsers: 0, userBreakdown: [],
    };
    if (!a.activity.lastActiveTimestamp || daysBetween(a.activity.lastActiveTimestamp) < 30) {
      a.activity.lastActiveTimestamp = a.lastModified;
    }
    a.activity.invocationsLast7Days = 0;
    a.activity.invocationsLast30Days = Math.min(a.activity.invocationsLast30Days || 0, 4);
  }

  const signals = detectGoogleSignals(a);
  const { score, level, factors } = scoreGoogleSignals(signals);
  const recommendations = signals
    .map((s) => GOOGLE_RECOMMENDATIONS[s.key])
    .filter((r, idx, arr) => r && arr.indexOf(r) === idx);
  a.risk = { score, level, factors, recommendations, computedAt: now };
}

// ═════════════════════════════════════════════════════════════════════
// Google Knowledge sources (Drive folders, BigQuery datasets, Vertex AI
// data stores, Cloud Storage buckets) attached to discoverable Google
// agents. Mirrors the shape of DEMO_KNOWLEDGE on the Microsoft side so
// the Knowledge & Files sub-tab can render the same components.
// ═════════════════════════════════════════════════════════════════════

export const DEMO_GOOGLE_KNOWLEDGE = [
  {
    botId: "re-chronic-care-nav-001",
    botName: "Chronic Care Navigator",
    sources: [
      { componentId: "gks-001", type: "bigquery_dataset", name: "vantage-gcp-prod.adherence.patient_adherence_v2", url: "bq://vantage-gcp-prod/adherence/patient_adherence_v2", fileCount: 121_400, lastSync: daysAgo(0) },
      { componentId: "gks-002", type: "pubsub_topic", name: "projects/vantage-gcp-prod/topics/vitals-home-monitoring", url: "pubsub://vantage-gcp-prod/vitals-home-monitoring", fileCount: 1, lastSync: daysAgo(0) },
      { componentId: "gks-003", type: "vertex_datastore", name: "Care Plan Templates (Vertex DataStore)", url: "projects/vantage-gcp-prod/locations/us-central1/collections/default_collection/dataStores/care-plan-templates", fileCount: 248, lastSync: daysAgo(1) },
    ],
  },
  {
    botId: "re-allergy-screen-002",
    botName: "Allergy Risk Screener",
    sources: [
      { componentId: "gks-004", type: "http_api", name: "Epic EHR API (allergy + medication)", url: "https://epic.vantagehealth.com/api/FHIR/R4/AllergyIntolerance", fileCount: 1, lastSync: daysAgo(0) },
      { componentId: "gks-005", type: "vertex_datastore", name: "Allergen Ontology (Vertex DataStore)", url: "projects/vantage-gcp-prod/locations/us-central1/dataStores/allergen-ontology", fileCount: 18_200, lastSync: daysAgo(2) },
      { componentId: "gks-006", type: "secret_manager", name: "Secret: epic-fhir-credentials", url: "projects/vantage-gcp-prod/secrets/epic-fhir-credentials", fileCount: 1, lastSync: daysAgo(14) },
    ],
  },
  {
    botId: "nlm-oncology-biomarker-003",
    botName: "Oncology Biomarker Explorer",
    sources: [
      { componentId: "gks-007", type: "google_drive", name: "Oncology Reference — Tumor Registry", url: "https://drive.google.com/drive/folders/1oNc0LoGy-ReFeRenCe-FoLdEr", fileCount: 1_240, lastSync: daysAgo(0) },
      { componentId: "gks-008", type: "http_api", name: "PubMed Oncology Feed", url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed", fileCount: 1, lastSync: daysAgo(0) },
    ],
  },
  {
    botId: "re-genomic-variant-004",
    botName: "Genomic Variant Classifier",
    sources: [
      { componentId: "gks-009", type: "bigquery_dataset", name: "vantage-gcp-prod.genomics.germline_variants", url: "bq://vantage-gcp-prod/genomics/germline_variants", fileCount: 9_420_000, lastSync: daysAgo(0) },
      { componentId: "gks-010", type: "http_api", name: "ClinVar Mirror", url: "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/", fileCount: 1, lastSync: daysAgo(2) },
    ],
  },
  {
    botId: "re-hipaa-exposure-007",
    botName: "HIPAA Exposure Scanner",
    sources: [
      { componentId: "gks-011", type: "google_drive", name: "All shared drives (tenant-wide)", url: "https://admin.google.com/ac/drives", fileCount: 412_800, lastSync: daysAgo(0) },
      { componentId: "gks-012", type: "http_api", name: "Chat API — every Chat space", url: "https://chat.googleapis.com/v1/spaces", fileCount: 1, lastSync: daysAgo(0) },
      { componentId: "gks-013", type: "dlp_template", name: "Cloud DLP inspect template: healthcare-all", url: "projects/vantage-gcp-prod/inspectTemplates/healthcare-all", fileCount: 1, lastSync: daysAgo(7) },
    ],
  },
  {
    botId: "gab-symptom-check-008",
    botName: "Symptom Checker Concierge",
    sources: [
      { componentId: "gks-014", type: "vertex_datastore", name: "Clinical Knowledge Vector Search", url: "projects/vantage-gcp-prod/locations/us-central1/dataStores/clinical-knowledge-vector", fileCount: 64_200, lastSync: daysAgo(1) },
      { componentId: "gks-015", type: "http_api", name: "Triage Queue API", url: "https://triage-queue.vantagehealth.com/api/v1", fileCount: 1, lastSync: daysAgo(0) },
    ],
  },
  {
    botId: "gcb-post-discharge-011",
    botName: "Post-Discharge Follow-Up Bot",
    sources: [
      { componentId: "gks-016", type: "http_api", name: "Case Management API", url: "https://casemgmt.vantagehealth.com/api/v1", fileCount: 1, lastSync: daysAgo(0) },
      { componentId: "gks-017", type: "http_api", name: "Epic EHR API (discharge summaries)", url: "https://epic.vantagehealth.com/api/FHIR/R4/DocumentReference", fileCount: 1, lastSync: daysAgo(0) },
    ],
  },
  {
    botId: "gem-denial-coach-016",
    botName: "Denial Management Coach",
    sources: [
      { componentId: "gks-018", type: "google_drive", name: "Payer Playbooks (shared drive)", url: "https://drive.google.com/drive/folders/1Payer-Playbooks-Drive", fileCount: 182, lastSync: daysAgo(1) },
      { componentId: "gks-019", type: "bigquery_dataset", name: "vantage-gcp-prod.revenue_cycle.denials", url: "bq://vantage-gcp-prod/revenue_cycle/denials", fileCount: 2_840_000, lastSync: daysAgo(0) },
      { componentId: "gks-020", type: "google_drive", name: "Appeals 2026 (shared drive)", url: "https://drive.google.com/drive/folders/1Appeals-2026-Drive", fileCount: 412, lastSync: daysAgo(0) },
    ],
  },
  {
    botId: "gab-revenue-leak-056",
    botName: "Revenue Leak Detector",
    sources: [
      { componentId: "gks-021", type: "bigquery_dataset", name: "vantage-gcp-prod.revenue_cycle.charges (orphaned)", url: "bq://vantage-gcp-prod/revenue_cycle/charges", fileCount: 18_400_000, lastSync: daysAgo(44) },
      { componentId: "gks-022", type: "gcs_bucket", name: "gs://vantage-revenue-leak/ (orphaned)", url: "gs://vantage-revenue-leak/", fileCount: 812, lastSync: daysAgo(44) },
    ],
  },
  {
    botId: "nlm-training-research-055",
    botName: "Training Materials Researcher",
    sources: [
      { componentId: "gks-023", type: "google_drive", name: "Training (shared drive, tenant-wide)", url: "https://drive.google.com/drive/folders/1Training-SOP-Drive", fileCount: 2_410, lastSync: daysAgo(95) },
    ],
  },
];

// ═════════════════════════════════════════════════════════════════════
// Google File Activity — Drive, Docs & Sheets reads/edits only.
// Every event is either a FileAccessed or FileModified operation and the
// source workload is always Google Drive, Google Docs, or Google Sheets
// so the File Activity sub-tab stays Workspace-native.
// ═════════════════════════════════════════════════════════════════════

export const DEMO_GOOGLE_FILES = [
  // Oncology Biomarker Explorer — Drive PDFs / research packets
  { id: "gf1", fileName: "FLAURA_subanalysis_TP53_2023.pdf", filePath: "https://drive.google.com/file/d/1FLAURA-TP53-2023/view", operation: "FileAccessed", userName: "Oncology Biomarker Explorer", userId: "nlm-oncology-biomarker-003@vantagehealth.com", workload: "Google Drive", agentName: "Oncology Biomarker Explorer", timestamp: daysAgo(0), objectId: "drive:1FLAURA-TP53-2023" },
  { id: "gf2", fileName: "EGFR_NSCLC_metaanalysis_2024.pdf", filePath: "https://drive.google.com/file/d/1EGFR-NSCLC-meta/view", operation: "FileAccessed", userName: "Oncology Biomarker Explorer", userId: "nlm-oncology-biomarker-003@vantagehealth.com", workload: "Google Drive", agentName: "Oncology Biomarker Explorer", timestamp: daysAgo(0), objectId: "drive:1EGFR-NSCLC-meta" },

  // HIPAA Exposure Scanner — tenant-wide Drive/Sheets reads (SOC 2 scan)
  { id: "gf3", fileName: "Revenue Cycle 2026 Denials Export.xlsx", filePath: "https://docs.google.com/spreadsheets/d/1Revenue-Cycle-Denials/edit", operation: "FileAccessed", userName: "HIPAA Exposure Scanner", userId: "re-hipaa-exposure-007@vantagehealth.com", workload: "Google Sheets", agentName: "HIPAA Exposure Scanner", timestamp: daysAgo(1), objectId: "sheets:1Revenue-Cycle-Denials" },
  { id: "gf4", fileName: "Old Appeals 2024 — scanned intake (PDF pack)", filePath: "https://drive.google.com/file/d/1Old-Appeals-2024-Pack/view", operation: "FileAccessed", userName: "HIPAA Exposure Scanner", userId: "re-hipaa-exposure-007@vantagehealth.com", workload: "Google Drive", agentName: "HIPAA Exposure Scanner", timestamp: daysAgo(1), objectId: "drive:1Old-Appeals-2024-Pack" },
  { id: "gf5", fileName: "SOC2-drive-scan-2026-04.gsheet", filePath: "https://docs.google.com/spreadsheets/d/1SOC2-drive-scan/edit", operation: "FileModified", userName: "HIPAA Exposure Scanner", userId: "re-hipaa-exposure-007@vantagehealth.com", workload: "Google Sheets", agentName: "HIPAA Exposure Scanner", timestamp: daysAgo(1), objectId: "sheets:1SOC2-drive-scan" },

  // Denial Management Coach — appeal templates & draft letters
  { id: "gf6", fileName: "Aetna_CO-197_Appeal_Template_v4.gdoc", filePath: "https://docs.google.com/document/d/1Aetna-CO197-Template/edit", operation: "FileAccessed", userName: "Denial Management Coach", userId: "gem-denial-coach-016@vantagehealth.com", workload: "Google Docs", agentName: "Denial Management Coach", timestamp: daysAgo(0), objectId: "docs:1Aetna-CO197-Template" },
  { id: "gf7", fileName: "DRAFT_Reed_DEN-2026-04-8821_v1.gdoc", filePath: "https://docs.google.com/document/d/1DRAFT-Reed-DEN-8821/edit", operation: "FileModified", userName: "Denial Management Coach", userId: "gem-denial-coach-016@vantagehealth.com", workload: "Google Docs", agentName: "Denial Management Coach", timestamp: daysAgo(0), objectId: "docs:1DRAFT-Reed-DEN-8821" },
  { id: "gf8", fileName: "Payer Playbook Tracker 2026.gsheet", filePath: "https://docs.google.com/spreadsheets/d/1Payer-Playbook-Tracker/edit", operation: "FileModified", userName: "Denial Management Coach", userId: "gem-denial-coach-016@vantagehealth.com", workload: "Google Sheets", agentName: "Denial Management Coach", timestamp: daysAgo(0), objectId: "sheets:1Payer-Playbook-Tracker" },

  // Chronic Care Navigator — care plans & adherence trackers
  { id: "gf9", fileName: "CHF Care Plan — Daniels, Robert.gdoc", filePath: "https://docs.google.com/document/d/1CHF-CarePlan-Daniels/edit", operation: "FileModified", userName: "Chronic Care Navigator", userId: "re-chronic-care-nav-001@vantagehealth.com", workload: "Google Docs", agentName: "Chronic Care Navigator", timestamp: daysAgo(0), objectId: "docs:1CHF-CarePlan-Daniels" },
  { id: "gf10", fileName: "Adherence Tracker — April 2026.gsheet", filePath: "https://docs.google.com/spreadsheets/d/1Adherence-Tracker-Apr2026/edit", operation: "FileAccessed", userName: "Chronic Care Navigator", userId: "re-chronic-care-nav-001@vantagehealth.com", workload: "Google Sheets", agentName: "Chronic Care Navigator", timestamp: daysAgo(0), objectId: "sheets:1Adherence-Tracker-Apr2026" },

  // Allergy Risk Screener — ontology + patient reference docs
  { id: "gf11", fileName: "Allergen Ontology Reference v7.gdoc", filePath: "https://docs.google.com/document/d/1Allergen-Ontology-v7/edit", operation: "FileAccessed", userName: "Allergy Risk Screener", userId: "re-allergy-screen-002@vantagehealth.com", workload: "Google Docs", agentName: "Allergy Risk Screener", timestamp: daysAgo(0), objectId: "docs:1Allergen-Ontology-v7" },

  // Symptom Checker Concierge — triage packets
  { id: "gf12", fileName: "Triage Runbook — Cardiac.gdoc", filePath: "https://docs.google.com/document/d/1Triage-Runbook-Cardiac/edit", operation: "FileAccessed", userName: "Symptom Checker Concierge", userId: "gab-symptom-check-008@vantagehealth.com", workload: "Google Docs", agentName: "Symptom Checker Concierge", timestamp: daysAgo(0), objectId: "docs:1Triage-Runbook-Cardiac" },

  // Post-Discharge Follow-Up Bot — follow-up packets & rosters
  { id: "gf13", fileName: "CHF Discharge Cohort — 2026-04-07.gsheet", filePath: "https://docs.google.com/spreadsheets/d/1CHF-Cohort-Apr7/edit", operation: "FileAccessed", userName: "Post-Discharge Follow-Up Bot", userId: "gcb-post-discharge-011@vantagehealth.com", workload: "Google Sheets", agentName: "Post-Discharge Follow-Up Bot", timestamp: daysAgo(1), objectId: "sheets:1CHF-Cohort-Apr7" },
  { id: "gf14", fileName: "Follow-Up Call Script — Daniels.gdoc", filePath: "https://docs.google.com/document/d/1FollowUp-Daniels/edit", operation: "FileModified", userName: "Post-Discharge Follow-Up Bot", userId: "gcb-post-discharge-011@vantagehealth.com", workload: "Google Docs", agentName: "Post-Discharge Follow-Up Bot", timestamp: daysAgo(1), objectId: "docs:1FollowUp-Daniels" },

  // Genomic Variant Classifier — germline variant reports
  { id: "gf15", fileName: "Germline Variant Report — Patient VH-552041.gdoc", filePath: "https://docs.google.com/document/d/1Germline-VH552041/edit", operation: "FileAccessed", userName: "Genomic Variant Classifier", userId: "re-genomic-variant-004@vantagehealth.com", workload: "Google Docs", agentName: "Genomic Variant Classifier", timestamp: daysAgo(0), objectId: "docs:1Germline-VH552041" },

  // Revenue Leak Detector — ORPHANED, 44 days ago
  { id: "gf16", fileName: "Revenue Leak Q1 Summary.gsheet (orphaned)", filePath: "https://docs.google.com/spreadsheets/d/1Revenue-Leak-Q1/edit", operation: "FileAccessed", userName: "Revenue Leak Detector (orphaned)", userId: "gab-revenue-leak-056@vantagehealth.com", workload: "Google Sheets", agentName: "Revenue Leak Detector", timestamp: daysAgo(44), objectId: "sheets:1Revenue-Leak-Q1" },
  { id: "gf17", fileName: "Q1 Charge Variance Notes.gdoc (orphaned)", filePath: "https://docs.google.com/document/d/1Q1-ChargeVariance/edit", operation: "FileModified", userName: "Revenue Leak Detector (orphaned)", userId: "gab-revenue-leak-056@vantagehealth.com", workload: "Google Docs", agentName: "Revenue Leak Detector", timestamp: daysAgo(44), objectId: "docs:1Q1-ChargeVariance" },

  // Training Materials Researcher — ORPHANED NotebookLM, stale
  { id: "gf18", fileName: "Onboarding_SOP_2024.pdf (stale)", filePath: "https://drive.google.com/file/d/1Training-SOP-2024/view", operation: "FileAccessed", userName: "Training Materials Researcher (orphaned)", userId: "nlm-training-research-055@vantagehealth.com", workload: "Google Drive", agentName: "Training Materials Researcher", timestamp: daysAgo(95), objectId: "drive:1Training-SOP-2024" },

  // Fraud & FWA Reviewer — investigator dossier & tracker
  { id: "gf19", fileName: "2026-04-Keating Investigator Dossier.gdoc", filePath: "https://docs.google.com/document/d/1Keating-Dossier-Apr2026/edit", operation: "FileModified", userName: "Fraud & FWA Reviewer", userId: "re-charge-capture-006@vantagehealth.com", workload: "Google Docs", agentName: "Fraud & FWA Reviewer", timestamp: daysAgo(0), objectId: "docs:1Keating-Dossier-Apr2026" },
  { id: "gf20", fileName: "FWA Case Tracker — Q1 2026.gsheet", filePath: "https://docs.google.com/spreadsheets/d/1FWA-Case-Tracker-Q1/edit", operation: "FileAccessed", userName: "Fraud & FWA Reviewer", userId: "re-charge-capture-006@vantagehealth.com", workload: "Google Sheets", agentName: "Fraud & FWA Reviewer", timestamp: daysAgo(0), objectId: "sheets:1FWA-Case-Tracker-Q1" },
];

// ═════════════════════════════════════════════════════════════════════
// Google Agent Permissions & File Access
// Same shape as DEMO_PERMISSIONS on the Microsoft side so the
// AgentPermissionsPanel can reuse its table renderer. Every permission
// here is a real Google Workspace / GCP IAM scope (drive.*, chat.*,
// aiplatform.*, bigquery.*) so the column content is Google-native.
// ═════════════════════════════════════════════════════════════════════

export const DEMO_GOOGLE_PERMISSIONS = {
  totalApps: 5,
  summary: { withFileAccess: 4, withWriteAccess: 2, criticalRisk: 2, agentCount: 5 },
  apps: [
    {
      servicePrincipalId: "gsa-re-hipaa-exposure-007",
      appId: "gcp-007-hipaa-exposure",
      displayName: "HIPAA Exposure Scanner",
      isAgent: true,
      summary: { hasFileAccess: true, hasWriteAccess: true, criticalCount: 3, totalPermissions: 5, riskLevel: "critical", filePermissions: ["drive.readonly", "chat.spaces.readonly"] },
      permissions: [
        { permission: "drive.readonly", isWrite: false, level: "critical", category: "files", resourceDisplayName: "Google Workspace (tenant-wide)" },
        { permission: "chat.spaces.readonly", isWrite: false, level: "high", category: "communications", resourceDisplayName: "Google Chat API" },
        { permission: "dlp.inspector", isWrite: false, level: "medium", category: "other", resourceDisplayName: "Cloud DLP API" },
        { permission: "storage.objectCreator", isWrite: true, level: "critical", category: "files", resourceDisplayName: "Cloud Storage (vantage-dlp-reports)" },
        { permission: "admin.directory.user.readonly", isWrite: false, level: "high", category: "directory", resourceDisplayName: "Workspace Admin SDK" },
      ],
    },
    {
      servicePrincipalId: "gsa-gab-symptom-check-008",
      appId: "gcp-008-symptom-check",
      displayName: "Symptom Checker Concierge",
      isAgent: true,
      summary: { hasFileAccess: true, hasWriteAccess: true, criticalCount: 2, totalPermissions: 4, riskLevel: "critical", filePermissions: ["bigquery.dataViewer", "aiplatform.user"] },
      permissions: [
        { permission: "aiplatform.user", isWrite: true, level: "critical", category: "other", resourceDisplayName: "Vertex AI (vantage-gcp-prod)" },
        { permission: "discoveryengine.dataStoreAdmin", isWrite: true, level: "critical", category: "files", resourceDisplayName: "Vertex DataStore (clinical-knowledge-vector)" },
        { permission: "bigquery.dataViewer", isWrite: false, level: "high", category: "files", resourceDisplayName: "BigQuery (triage_queue)" },
        { permission: "chat.bot", isWrite: true, level: "medium", category: "communications", resourceDisplayName: "Google Chat API" },
      ],
    },
    {
      servicePrincipalId: "gsa-gem-denial-coach-016",
      appId: "gcp-016-denial-coach",
      displayName: "Denial Management Coach",
      isAgent: true,
      summary: { hasFileAccess: true, hasWriteAccess: false, criticalCount: 1, totalPermissions: 3, riskLevel: "high", filePermissions: ["drive.readonly", "bigquery.dataViewer"] },
      permissions: [
        { permission: "drive.readonly", isWrite: false, level: "high", category: "files", resourceDisplayName: "Google Drive (Payer Playbooks, Appeals 2026)" },
        { permission: "bigquery.dataViewer", isWrite: false, level: "high", category: "files", resourceDisplayName: "BigQuery (revenue_cycle.denials)" },
        { permission: "docs.readonly", isWrite: false, level: "medium", category: "files", resourceDisplayName: "Google Docs API" },
      ],
    },
    {
      servicePrincipalId: "gsa-gcb-post-discharge-011",
      appId: "gcp-011-post-discharge",
      displayName: "Post-Discharge Follow-Up Bot",
      isAgent: true,
      summary: { hasFileAccess: false, hasWriteAccess: true, criticalCount: 0, totalPermissions: 3, riskLevel: "medium", filePermissions: [] },
      permissions: [
        { permission: "chat.bot", isWrite: true, level: "medium", category: "communications", resourceDisplayName: "Google Chat API" },
        { permission: "chat.messages", isWrite: true, level: "medium", category: "communications", resourceDisplayName: "Google Chat API" },
        { permission: "https://epic.vantagehealth.com/*", isWrite: false, level: "high", category: "other", resourceDisplayName: "Epic EHR (HTTP connector)" },
      ],
    },
    {
      servicePrincipalId: "gsa-gab-revenue-leak-056",
      appId: "gcp-056-revenue-leak",
      displayName: "Revenue Leak Detector",
      isAgent: true,
      summary: { hasFileAccess: true, hasWriteAccess: true, criticalCount: 1, totalPermissions: 3, riskLevel: "high", filePermissions: ["bigquery.dataViewer", "storage.objectCreator"] },
      permissions: [
        { permission: "bigquery.dataViewer", isWrite: false, level: "high", category: "files", resourceDisplayName: "BigQuery (revenue_cycle.charges)" },
        { permission: "storage.objectCreator", isWrite: true, level: "critical", category: "files", resourceDisplayName: "Cloud Storage (gs://vantage-revenue-leak/)" },
        { permission: "aiplatform.user", isWrite: true, level: "high", category: "other", resourceDisplayName: "Vertex AI (agent_builder)" },
      ],
    },
  ],
};
