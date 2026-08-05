# CloudFuze AI Governance — August 2026 Sprint Plan
## Full Month: Day-by-Day Development Roadmap
### Prepared: July 27, 2026 | Target: Aug 3–31, 2026 (21 working days)

---

## EXECUTIVE SUMMARY

**Goal:** Transform CloudFuze from a "discovery + basic DLP" tool into a **full AI governance platform** that competes head-to-head with Arthur AI, Credo AI, Fiddler, WitnessAI, and ContextGate — and wins on coverage breadth.

**Revenue thesis:** CloudFuze already has what no competitor has (endpoint scanning, desktop app interception, browser extension across 30+ services). What's missing is the **enterprise governance layer** that regulated buyers require to write a PO. This month fills that gap.

**End-of-month deliverable:** A demo-ready platform with:
- EU AI Act compliance module (deal-closer for regulated buyers)
- 6 pre-built compliance policy packs (GDPR, HIPAA, SOC 2, CCPA, EU AI Act, ISO 42001)
- Advanced guardrails (hallucination, toxicity, bias, jailbreak detection)
- Full agent execution tracing with timeline visualization
- Hard spend caps + per-person cost attribution
- Intelligent model routing engine
- Natural-language policy authoring
- Cryptographic audit trails
- Developer SDK (2-line integration)
- SIEM integration (Splunk, Sentinel, Datadog)

**Estimated ARR impact:** These features unlock Tier 2 (Business) and Tier 3 (Enterprise) pricing — compliance module alone justifies $15-25/seat/month premium over discovery-only.

---

## MONTH AT A GLANCE

| Week | Theme | Revenue Impact |
|------|-------|----------------|
| **Week 1** (Aug 3–7) | Production Readiness + EU AI Act Compliance | Unblocks ALL paid deployments + unlocks regulated buyers |
| **Week 2** (Aug 10–14) | Guardrails Engine + Compliance Policy Packs | Extends DLP value 10x — catches everything, not just secrets |
| **Week 3** (Aug 17–21) | Agent Execution Tracing + Spend Enforcement | Closes biggest competitive gap + unlocks Finance buyer |
| **Week 4** (Aug 24–28) | Model Routing + Policy Authoring + Audit Trails | Cost optimization ROI + non-engineer accessibility |
| **Day 21** (Aug 31) | SDK + SIEM + Integration Testing + Demo Polish | Developer adoption + SOC integration + sales-ready |

---

## WEEK 1: PRODUCTION READINESS + COMPLIANCE FOUNDATION
### Aug 3 – Aug 7 (Mon–Fri)
### Theme: "Nothing else matters if we can't ship"

> Fix the 4 P0 blockers and build the single highest-revenue feature: EU AI Act Compliance.

---

### DAY 1 — Monday, Aug 3
#### P0 Fix: JWT Secret Persistence + Server Hardening

**What to build:**
- Implement persistent `JWT_SECRET` via `.env` file with secure generation script
- Add startup warning banner if server detects a random (non-persisted) JWT_SECRET
- Add environment variable validation (fail-fast on missing required config)
- Build `/health` and `/ready` endpoints for deployment monitoring
- Add graceful shutdown handling (close DB connections, flush pending events)

**Why this is Day 1:** Every enrolled agent's token breaks on server restart. This is the single biggest production blocker. Nothing else ships until this works.

**Files to touch:**
- `server/src/auth.js` — read JWT_SECRET from env
- `server/src/index.js` — startup validation + health endpoints
- `server/.env.example` — document all required env vars
- `scripts/generate-jwt-secret.js` — one-time secret generation utility

**Definition of done:** Server survives 5 consecutive restarts with zero token invalidation.

---

### DAY 2 — Tuesday, Aug 4
#### P0 Fix: MSI Installer + Silent Deployment

**What to build:**
- Create Inno Setup or WiX MSI package for the agent
- Bundle: agent binary (Node SEA), CA cert auto-install, Windows Service registration
- Silent install mode (`/S` flag) for Intune/SCCM/GPO push deployment
- Auto-enrollment config: MSI drops `tenant-config.json` with server URL + enrollment secret
- Uninstall: clean removal of CA cert, service, proxy settings, config files

**Why Day 2:** Without an MSI, every customer deployment = "git clone + npm install." Impossible to sell to IT teams. This is the gatekeeper for every enterprise deal.

**Files to touch:**
- New: `installer/cloudfuze-agent.iss` (Inno Setup script)
- New: `installer/tenant-config.template.json`
- `agent/src/index.js` — read tenant config on first boot
- `agent/build/build-sea.js` — ensure binary is installer-ready

**Definition of done:** Clean install + uninstall on a fresh Windows 11 VM via `msiexec /i /qn`.

---

### DAY 3 — Wednesday, Aug 5
#### P0 Fix: Cert-Pinning Fallback + Dashboard Event Verification

**What to build (morning — cert pinning):**
- Create `known-pinning-hosts.json` config (ChatGPT Store, other pinned apps)
- Implement bridge mode: proxy passes through without interception for pinned hosts
- Add "report-only" mode: log the event even though body wasn't scanned
- Graceful degradation: no more mysterious network errors for pinned apps

**What to build (afternoon — dashboard events):**
- Verify dashboard renders `proxy_block` events with correct icon/label
- Distinguish `proxy_block` from `enforcement_block` (hook/extension) visually
- Add mechanism filter to event timeline (proxy / hook / extension / os_monitor)
- Fix any rendering bugs in the activity log for proxy events

**Files to touch:**
- `agent/src/proxy/` — bridge mode for pinned hosts
- `connect-ui/src/Components/Activity/` — event rendering fixes
- New: `agent/src/proxy/known-pinning-hosts.json`

**Definition of done:** All 4 P0 items closed. Production deployment is unblocked.

---

### DAY 4 — Thursday, Aug 6
#### EU AI Act Compliance Module — Part 1: Data Model + Risk Classification Engine

**What to build:**
- Design compliance database schema:
  - `compliance_frameworks` (EU AI Act, ISO 42001, NIST AI RMF, GDPR, HIPAA, SOC 2)
  - `ai_systems` (each registered AI tool/agent as a "system" under the Act)
  - `risk_assessments` (per-system risk tier + evidence + assessor)
  - `compliance_scores` (per-framework scoring with breakdown)
  - `evidence_artifacts` (collected evidence mapped to framework controls)
- Build risk tier classification engine:
  - **Unacceptable** — social scoring, real-time biometric, manipulative
  - **High** — employment, credit, law enforcement, critical infrastructure
  - **Limited** — chatbots, emotion recognition, deep fakes
  - **Minimal** — spam filters, AI in games, inventory management
- Interactive risk assessment questionnaire (10–15 questions per system)
- Auto-classification based on detected AI tool category + data flow analysis

**Revenue impact:** EU AI Act enforcement begins Feb 2025 (already in effect). Buyers in EU, or selling into EU, literally cannot purchase without this. This is a **deal-closer**, not a nice-to-have.

**Files to touch:**
- New: `server/src/routes/compliance.js` — compliance API endpoints
- New: `server/src/db/migrations/compliance-schema.sql`
- New: `server/src/compliance/risk-classifier.js`
- New: `server/src/compliance/assessment-engine.js`
- `server/src/db/` — schema updates

**Definition of done:** API can classify any AI system into EU AI Act risk tiers, store assessments, compute compliance scores.

---

### DAY 5 — Friday, Aug 7
#### EU AI Act Compliance Module — Part 2: Reports + Dashboard + Evidence Export

**What to build:**
- **FRIA report generator** (Fundamental Rights Impact Assessment):
  - Auto-populates from discovered AI tools + risk classifications
  - Generates structured report sections per Article 27 requirements
  - Export as PDF (branded, court-admissible format)
- **Compliance dashboard**:
  - Overall compliance score (percentage) per framework
  - Per-AI-system breakdown with risk tier badges
  - Traffic light view: Red (non-compliant) / Amber (partial) / Green (compliant)
  - Drill-down from score → missing controls → remediation guidance
- **One-click evidence export**:
  - Bundle all evidence for a framework into a single PDF/ZIP
  - Include: system inventory, risk assessments, DLP event logs, policy configs
  - Timestamped and hash-signed for integrity verification
- **Compliance timeline**: visual history of when assessments were done, scores changed

**Files to touch:**
- New: `server/src/compliance/fria-generator.js`
- New: `server/src/compliance/evidence-exporter.js`
- New: `connect-ui/src/Components/Compliance/` — dashboard views
- New: `connect-ui/src/Components/Compliance/ComplianceDashboard.jsx`
- New: `connect-ui/src/Components/Compliance/RiskClassification.jsx`
- New: `connect-ui/src/Components/Compliance/FRIAReport.jsx`

**Definition of done:** Full EU AI Act compliance workflow: classify → assess → score → export PDF. Demo-ready.

---

## WEEK 2: GUARDRAILS ENGINE + COMPLIANCE POLICY PACKS
### Aug 10 – Aug 14 (Mon–Fri)
### Theme: "Catch everything unsafe, not just secrets"

> Extend DLP from "catches API keys and SSNs" to "catches hallucinations, toxicity, prompt injection, bias, and jailbreaks." Then ship 6 one-click compliance policy packs.

---

### DAY 6 — Monday, Aug 10
#### Guardrails Engine — Core Architecture + Prompt Injection Defense

**What to build:**
- Design pluggable guardrails architecture:
  - `GuardrailPipeline` — chain of guardrail checks (runs sequentially or parallel)
  - `GuardrailProvider` interface — standardized input/output for each detector
  - `GuardrailResult` — severity score, confidence, category, evidence snippet
  - Configurable per-tool, per-team, per-guardrail thresholds
- **Prompt injection detection** (first guardrail):
  - Pattern-based detection: "ignore previous instructions", "system prompt:", role injection patterns
  - Structural analysis: detect prompts that try to override system context
  - ML-assisted scoring using lightweight classifier (distilled model, runs locally)
  - Confidence threshold: configurable (default: block at >0.85)
- **Jailbreak detection**:
  - Known jailbreak pattern library (DAN, STAN, Developer Mode, etc.)
  - Encoding bypass detection (base64, ROT13, unicode tricks)
  - Character substitution detection (l33tspeak variants)

**Why this matters:** CloudFuze currently catches data leaving. This catches data being WEAPONIZED. Competitors like Fiddler, Nyraxis, and ContextGate already have this. Without it, CloudFuze is "just DLP."

**Files to touch:**
- New: `server/src/guardrails/pipeline.js` — orchestrator
- New: `server/src/guardrails/providers/prompt-injection.js`
- New: `server/src/guardrails/providers/jailbreak.js`
- New: `server/src/guardrails/patterns/` — pattern libraries

**Definition of done:** Prompt injection + jailbreak detection fires correctly on 50+ test cases with <50ms p95 latency.

---

### DAY 7 — Tuesday, Aug 11
#### Guardrails: Hallucination Detection + Toxicity + Bias Scoring

**What to build:**
- **Hallucination detection**:
  - Factual grounding check: compare AI response claims against provided context
  - Confidence scoring (0–1): how likely the response contains fabricated facts
  - Source attribution verification: did the AI cite real sources?
  - URL validation: check if cited URLs actually exist
- **Toxicity detection**:
  - Multi-category scoring: hate speech, violence, sexual content, harassment, self-harm
  - Configurable per-category thresholds (enterprise can tune sensitivity)
  - Context-aware: "kill the process" is fine in code, not fine in a threat
- **Bias detection**:
  - Protected characteristic detection in outputs (gender, race, age, disability)
  - Sentiment analysis per demographic group mentioned
  - Stereotyping pattern detection
  - Bias score with explanation

**Files to touch:**
- New: `server/src/guardrails/providers/hallucination.js`
- New: `server/src/guardrails/providers/toxicity.js`
- New: `server/src/guardrails/providers/bias.js`
- New: `server/src/guardrails/scoring/` — scoring models

**Definition of done:** All 5 guardrail types (injection, jailbreak, hallucination, toxicity, bias) operational with test suites.

---

### DAY 8 — Wednesday, Aug 12
#### Guardrails: Full Integration + Dashboard + Real-Time Alerting

**What to build:**
- **Wire guardrails into all enforcement surfaces:**
  - HTTPS proxy: scan response bodies through guardrail pipeline
  - Desktop hook: intercept outgoing prompts through guardrails before send
  - Browser extension: guardrail check on paste/send
  - MCP guard: scan tool call results through guardrails
- **Guardrails dashboard**:
  - Violation heatmap by category (injection / jailbreak / hallucination / toxicity / bias)
  - Trend lines: are violations increasing or decreasing over time?
  - Top offenders: which AI tools / teams trigger the most guardrail violations?
  - Drill-down: click a violation → see full prompt/response + guardrail analysis
- **Real-time alerting:**
  - Configurable alert rules: "If jailbreak confidence > 0.9, email CISO immediately"
  - Webhook support for custom integrations (Slack, Teams, PagerDuty)
  - Alert aggregation: don't spam — batch alerts within a 5-minute window

**Files to touch:**
- `agent/src/proxy/` — integrate guardrail pipeline
- `agent/src/desktop_injector/` — integrate guardrails
- `agent/src/mcp_guard/` — integrate guardrails
- New: `connect-ui/src/Components/Guardrails/` — dashboard
- New: `server/src/routes/guardrails.js` — API endpoints
- New: `server/src/alerting/alert-engine.js`

**Definition of done:** Guardrails fire in all 4 enforcement surfaces. Dashboard shows violations in real-time.

---

### DAY 9 — Thursday, Aug 13
#### Pre-Built Compliance Policy Packs — Part 1 (GDPR, HIPAA, SOC 2)

**What to build:**
- **Policy Pack framework:**
  - `PolicyPack` data model: name, framework, version, rules[], auto-apply conditions
  - One-click deploy: select a pack → all rules activate instantly
  - Customizable: edit individual rules within a pack without breaking the pack
  - Pack versioning: when we update a pack, customers can review + accept changes
- **GDPR Policy Pack (20+ rules):**
  - Block PII transmission to non-EU AI providers (data residency)
  - Detect personal data categories (name, email, phone, address, national ID)
  - Right to erasure: flag conversations containing personal data for deletion tracking
  - Data minimization alerts: "This prompt contains more PII than necessary"
  - Consent verification: require attestation before sending personal data
- **HIPAA Policy Pack (15+ rules):**
  - Block PHI (Protected Health Information) in all AI prompts
  - Detect 18 HIPAA identifiers (medical record #, health plan beneficiary #, etc.)
  - BAA enforcement: only allow AI tools with signed BAA
  - Audit trail requirements: log all healthcare-context AI interactions
  - Minimum necessary standard enforcement
- **SOC 2 Policy Pack (12+ rules):**
  - Access control verification per AI tool
  - Monitoring evidence auto-collection (logs for SOC 2 Type II audit)
  - Change management: track policy changes with approval workflow
  - Incident response: auto-create incident records on critical violations

**Files to touch:**
- New: `server/src/compliance/policy-packs/` — pack definitions
- New: `server/src/compliance/policy-packs/gdpr.json`
- New: `server/src/compliance/policy-packs/hipaa.json`
- New: `server/src/compliance/policy-packs/soc2.json`
- New: `server/src/compliance/pack-engine.js` — pack deployment engine
- New: `server/src/routes/policy-packs.js`

**Definition of done:** 3 policy packs deployable in one click, with 47+ combined rules active.

---

### DAY 10 — Friday, Aug 14
#### Pre-Built Compliance Policy Packs — Part 2 (CCPA, EU AI Act, ISO 42001) + Pack Dashboard

**What to build:**
- **CCPA Policy Pack (10+ rules):**
  - California consumer personal information detection
  - "Do not sell" enforcement for AI vendor data sharing
  - Consumer rights tracking (deletion requests, opt-out records)
- **EU AI Act Policy Pack (15+ rules):**
  - Auto-applies risk tier controls from Day 4/5 classification
  - High-risk system requirements: human oversight, transparency, accuracy logging
  - Prohibited practice detection and blocking
  - Conformity assessment evidence auto-collection
  - Transparency obligations: disclose AI use to end-users
- **ISO 42001 Policy Pack (12+ rules):**
  - AI management system controls mapping
  - Risk assessment requirements
  - Data governance controls
  - Performance monitoring requirements
- **Policy Pack Management Dashboard:**
  - Visual pack browser: see all available packs with coverage summary
  - Active packs view: which packs are deployed, when, by whom
  - Pack health: "98% compliant with GDPR pack — 2 rules failing"
  - Rule-level toggle: disable specific rules within a pack
  - Pack comparison: "Which frameworks overlap? What's unique?"

**Files to touch:**
- New: `server/src/compliance/policy-packs/ccpa.json`
- New: `server/src/compliance/policy-packs/eu-ai-act.json`
- New: `server/src/compliance/policy-packs/iso-42001.json`
- New: `connect-ui/src/Components/Compliance/PolicyPacks.jsx`
- New: `connect-ui/src/Components/Compliance/PackBrowser.jsx`

**Definition of done:** 6 policy packs with 100+ combined rules. One-click deployment verified. Dashboard shows pack health.

---

## WEEK 3: AGENT EXECUTION TRACING + SPEND ENFORCEMENT
### Aug 17 – Aug 21 (Mon–Fri)
### Theme: "See what agents DO, control what they COST"

> Build the two features that close the biggest competitive gaps: full agent tracing (every serious competitor has this) and spend enforcement (Finance teams demand it).

---

### DAY 11 — Monday, Aug 17
#### Agent Execution Tracing — Data Model + Capture Engine

**What to build:**
- **Trace data model** (multi-level hierarchy):
  ```
  Application → Session → Agent → Trace → Span
  ```
  - `trace_applications`: top-level app registration
  - `trace_sessions`: user session grouping
  - `trace_agents`: individual agent instances
  - `traces`: single agent execution (start → end)
  - `trace_spans`: individual steps within a trace (LLM call, tool use, retrieval, etc.)
- **Span types:**
  - `llm_call` — prompt sent, response received, model, tokens, latency
  - `tool_invocation` — tool name, arguments, result, success/failure
  - `retrieval` — RAG source query, documents returned, relevance scores
  - `reasoning` — chain-of-thought steps (if exposed by framework)
  - `governance_check` — CloudFuze guardrail evaluation within the trace
- **Trace capture middleware:**
  - HTTP header-based trace correlation (`X-CloudFuze-Trace-ID`)
  - Auto-instrumentation for requests flowing through the proxy
  - Trace context propagation across agent-to-agent calls
  - Buffered ingestion: batch writes to DB (high-throughput friendly)

**Files to touch:**
- New: `server/src/tracing/trace-model.js` — data model
- New: `server/src/tracing/capture-engine.js` — capture + buffering
- New: `server/src/tracing/trace-correlator.js` — ID correlation
- New: `server/src/db/migrations/tracing-schema.sql`
- New: `server/src/routes/traces.js` — trace API endpoints

**Definition of done:** Traces + spans ingested from proxy traffic, stored in DB, queryable via API.

---

### DAY 12 — Tuesday, Aug 18
#### Agent Execution Tracing — Timeline Visualization + Live Streaming

**What to build:**
- **Gantt-style timeline visualization:**
  - Horizontal bar chart showing each span as a colored bar
  - Color coding by span type (blue = LLM, green = tool, yellow = retrieval, red = error)
  - Nested spans show parent-child relationships
  - Hover: full detail popup (prompt, response, latency, tokens, cost)
  - Click: expand to see raw request/response
- **Multi-level trace browser:**
  - Level 1: Application list with trace counts + health score
  - Level 2: Session list with timeline scrubber
  - Level 3: Agent view with trace history
  - Level 4: Individual trace with full span breakdown
- **Live WebSocket streaming:**
  - Real-time trace updates as agents execute
  - Auto-scrolling timeline that shows execution as it happens
  - Live span duration updates (open spans show running timer)
  - Target: <100ms display latency from span creation to dashboard render
- **Latency + outcome metrics per step:**
  - P50, P95, P99 latency per span type
  - Success/failure rate per tool
  - Token usage per LLM call
  - Cost estimation per span

**Files to touch:**
- New: `connect-ui/src/Components/Tracing/` — all tracing UI
- New: `connect-ui/src/Components/Tracing/TraceTimeline.jsx` — Gantt chart
- New: `connect-ui/src/Components/Tracing/TraceBrowser.jsx` — hierarchy browser
- New: `connect-ui/src/Components/Tracing/LiveStream.jsx` — WebSocket view
- New: `server/src/tracing/websocket-stream.js` — WS server for live traces

**Definition of done:** Trace timeline renders with live updates. Multi-level browser navigable. <100ms stream latency.

---

### DAY 13 — Wednesday, Aug 19
#### Agent Tracing: SDK Wrappers + Anomaly Detection

**What to build:**
- **Lightweight SDK wrappers** (auto-instrumentation):
  ```javascript
  // Node.js — 2 lines to instrument
  const cfai = require('@cloudfuze/trace-sdk');
  cfai.instrument({ serverUrl: 'https://your-server', apiKey: 'xxx' });
  // All OpenAI/Anthropic/LangChain calls are now traced automatically
  ```
  - OpenAI SDK wrapper (intercept `chat.completions.create`)
  - Anthropic SDK wrapper (intercept `messages.create`)
  - LangChain callback handler
  - Generic HTTP interceptor (catches any LLM API call)
- **Anomaly detection engine:**
  - Baseline learning: establish normal patterns per agent (avg latency, typical tool use, token ranges)
  - Drift detection: alert when agent behavior deviates from baseline
  - Loop detection: identify agents stuck in recursive loops (>N identical tool calls)
  - Cost anomaly: alert when a single trace costs >X standard deviations above average
  - Unauthorized tool use: flag tools called that aren't in the agent's approved toolset

**Files to touch:**
- New: `sdk/node/` — Node.js trace SDK package
- New: `sdk/node/src/instrument.js` — auto-instrumentation
- New: `sdk/node/src/wrappers/openai.js`
- New: `sdk/node/src/wrappers/anthropic.js`
- New: `sdk/node/src/wrappers/langchain.js`
- New: `server/src/tracing/anomaly-detector.js`

**Definition of done:** SDK wraps OpenAI + Anthropic in 2 lines. Anomaly detection flags loops and drift.

---

### DAY 14 — Thursday, Aug 20
#### Hard Spend Caps + Budget Enforcement

**What to build:**
- **Budget model:**
  - `budgets` table: entity (team/agent/workspace/user), limit_usd, period (monthly/weekly/daily), hard/soft cap
  - `budget_usage` table: running totals, updated per-request
  - `budget_alerts` table: threshold triggers and notification history
- **Hard cap enforcement:**
  - When budget hits limit → automatic request rejection with HTTP 429
  - Response includes: "Budget exceeded. Contact your admin. Current: $X / $Y limit."
  - Grace period option: allow N requests past limit before hard cutoff (configurable)
  - Override capability: admin can temporarily lift a cap with audit trail
- **Budget alerts:**
  - Configurable thresholds: 50%, 75%, 90%, 100% (default set)
  - Notification channels: email, webhook, in-dashboard alert
  - Projected overage warning: "At current rate, budget will be exhausted by Aug 22"
- **Finance-ready chargeback reports:**
  - Monthly PDF/CSV export: spend by team, by AI tool, by user
  - Cost center mapping: tie teams to finance cost centers
  - Trend comparison: this month vs. last month, with variance explanation
  - ROI indicators: "Engineering team spent $12K on AI → resolved 340 tickets"

**Files to touch:**
- New: `server/src/billing/budget-engine.js`
- New: `server/src/billing/cap-enforcer.js`
- New: `server/src/billing/chargeback-reporter.js`
- New: `server/src/db/migrations/budgets-schema.sql`
- New: `server/src/routes/budgets.js`
- New: `connect-ui/src/Components/Billing/` — budget UI

**Definition of done:** Hard caps block requests at limit. Alerts fire at thresholds. Chargeback PDF generates.

---

### DAY 15 — Friday, Aug 21
#### Per-Person Spend Attribution + Cost Analytics Dashboard

**What to build:**
- **Individual-level cost tracking:**
  - Every API call attributed to a specific user (via agent enrollment identity)
  - Token-level cost calculation per model (GPT-4: $X/1K input, $Y/1K output, etc.)
  - Real-time cost accumulator per user, per session, per tool
  - Historical cost data with 90-day retention (configurable)
- **Cost analytics dashboard:**
  - **Executive view:** Total AI spend this month, by department, trend line
  - **Team view:** Per-team breakdown with top users and top tools
  - **Individual view:** Employee's own AI usage (self-service, privacy-safe)
  - **Tool view:** Which AI services cost the most? Which deliver the best value?
  - **Forecast:** "At current trajectory, August spend will be $X" with confidence interval
- **Cost optimization recommendations:**
  - "Team X is using GPT-4 for tasks that GPT-3.5 handles at 1/10th the cost"
  - "Agent Y has 40% cache miss rate — adding system prompt caching saves $Z/month"
  - "User Z sent 15 duplicate prompts this week — potential $X waste"
- **Spend leaderboard (gamification):**
  - Most efficient teams (lowest cost per task completion)
  - Biggest savers this month (who reduced spend the most?)
  - Optional: visible to team leads for healthy competition

**Files to touch:**
- New: `server/src/billing/cost-calculator.js`
- New: `server/src/billing/attribution-engine.js`
- New: `server/src/billing/forecast-engine.js`
- New: `connect-ui/src/Components/Billing/CostDashboard.jsx`
- New: `connect-ui/src/Components/Billing/SpendLeaderboard.jsx`
- New: `connect-ui/src/Components/Billing/CostOptimizer.jsx`

**Definition of done:** Every API call has user-level cost attribution. Dashboard shows spend by team/user/tool with forecasting.

---

## WEEK 4: MODEL ROUTING + POLICY AUTHORING + AUDIT TRAILS
### Aug 24 – Aug 28 (Mon–Fri)
### Theme: "Optimize cost, empower non-engineers, prove compliance"

> Three powerful features that each unlock a different buyer persona: model routing (CTO/Finance), natural-language policies (Compliance/Legal), cryptographic audit trails (CISO/Auditor).

---

### DAY 16 — Monday, Aug 24
#### Intelligent Model Routing — Engine + Routing Rules

**What to build:**
- **Routing engine:**
  - Intercept AI API requests at the proxy layer
  - Evaluate routing rules against request context (user, team, data sensitivity, prompt content)
  - Redirect to optimal model based on rules
  - Transparent to the end user (same API response format)
- **Routing strategies:**
  - **Cost-based:** Route simple prompts to cheap models (GPT-4o-mini, Haiku), complex to expensive (GPT-4, Opus)
  - **Sensitivity-based:** Prompts with PII → private/on-prem model; clean prompts → public cloud
  - **Compliance-based:** EU data → EU-hosted model endpoint; US data → US endpoint
  - **Performance-based:** Latency-sensitive requests → fastest model; batch → cheapest
  - **Failover:** If primary model returns error/timeout → automatic retry on secondary
- **Rule definition format:**
  ```json
  {
    "name": "PII to private model",
    "condition": { "guardrail.pii_detected": true },
    "route_to": { "provider": "azure-openai", "endpoint": "eu-west", "model": "gpt-4" },
    "fallback": { "action": "block", "message": "PII detected, no private model available" }
  }
  ```
- **Weighted load balancing:**
  - Distribute traffic across multiple model endpoints
  - Health-check each endpoint, auto-remove unhealthy ones
  - Geo-aware: route to nearest endpoint by default

**Files to touch:**
- New: `server/src/routing/route-engine.js`
- New: `server/src/routing/strategies/` — strategy implementations
- New: `server/src/routing/health-checker.js`
- New: `server/src/routing/load-balancer.js`
- `agent/src/proxy/` — integrate routing at proxy layer

**Definition of done:** Proxy routes requests to different models based on rules. Failover tested. Cost savings measurable.

---

### DAY 17 — Tuesday, Aug 25
#### Model Routing Dashboard + Routing Analytics

**What to build:**
- **Routing rules management UI:**
  - Visual rule builder (drag-and-drop conditions → actions)
  - Rule priority ordering (drag to reorder)
  - Rule testing: "Paste a sample prompt → see which model it would route to"
  - Rule templates: pre-built rules for common scenarios
- **Routing analytics dashboard:**
  - Traffic distribution: pie chart of requests by model/provider
  - Cost savings tracker: "Routing saved $X this month vs. sending everything to GPT-4"
  - Latency comparison: average response time by model
  - Availability: uptime per model endpoint with incident markers
  - Failover events: when did failovers trigger? What was the impact?
- **Model performance comparison:**
  - Side-by-side: same prompts sent to different models, compare quality scores
  - Cost-per-quality metric: "GPT-4o achieves 92% quality at 30% of GPT-4 cost"
  - Model recommendation engine: "Based on your traffic patterns, switching X% to model Y saves $Z"

**Files to touch:**
- New: `connect-ui/src/Components/Routing/` — routing UI
- New: `connect-ui/src/Components/Routing/RuleBuilder.jsx`
- New: `connect-ui/src/Components/Routing/RoutingAnalytics.jsx`
- New: `connect-ui/src/Components/Routing/ModelComparison.jsx`
- New: `server/src/routes/routing.js` — routing API

**Definition of done:** Rules configurable via UI. Analytics show cost savings. Model comparison operational.

---

### DAY 18 — Wednesday, Aug 26
#### Natural-Language Policy Authoring

**What to build:**
- **Plain-English policy writer:**
  - Input: "Block any prompt containing customer financial data from going to public models"
  - Output: Structured policy rule (JSON) that the enforcement engine understands
  - Uses LLM to parse natural language → extract entity types, actions, conditions
  - Confirmation step: "Here's what I understood — is this correct?" with editable JSON preview
- **Policy-as-Code from documents:**
  - Upload a compliance policy PDF (e.g., company's AI usage policy)
  - Extract rules automatically: "Section 4.2 says employees must not share PHI with AI tools"
  - Generate enforceable rules for each extracted requirement
  - Map to existing policy packs where overlap exists
- **Policy management:**
  - Version control: every policy change is versioned with author + timestamp
  - Diff view: see what changed between policy versions
  - Rollback: one-click revert to any previous version
  - Approval workflow: policy changes require admin approval before activation
  - Simulation mode: "This policy would have triggered on 847 events in the last 30 days"

**Why this matters:** Compliance officers and legal teams can now create governance rules without engineering support. This removes the biggest adoption bottleneck in enterprises — the "I need to file a ticket with IT to add a new rule" problem.

**Files to touch:**
- New: `server/src/policies/nl-parser.js` — natural language → rule compiler
- New: `server/src/policies/pdf-extractor.js` — PDF → rules
- New: `server/src/policies/version-manager.js` — versioning + rollback
- New: `server/src/policies/simulator.js` — what-if analysis
- New: `connect-ui/src/Components/Policies/` — policy UI
- New: `connect-ui/src/Components/Policies/NLPolicyWriter.jsx`
- New: `connect-ui/src/Components/Policies/PolicySimulator.jsx`

**Definition of done:** Write a policy in English → it compiles to a working rule → simulation shows impact → deploy with one click.

---

### DAY 19 — Thursday, Aug 27
#### Cryptographic Audit Trails + Tamper-Proof Evidence

**What to build:**
- **Hash-chained audit log:**
  - Every governance event gets an HMAC-SHA256 hash
  - Each hash includes the previous event's hash (blockchain-style chain)
  - Chain integrity verifiable: if any event is tampered with, the chain breaks
  - Hash algorithm: `HMAC(event_data + previous_hash, server_secret)`
- **Audit receipt generation:**
  - Per-event receipt: JSON document with event details, hash, chain position, timestamp
  - Batch receipt: bundle of receipts for a time period, with Merkle root hash
  - PDF receipt: human-readable audit receipt with QR code linking to verification
- **Tamper detection + verification:**
  - API endpoint: `/verify-audit-chain?from=DATE&to=DATE` → validates chain integrity
  - Dashboard widget: "Audit chain integrity: VERIFIED" with last-check timestamp
  - Alert on tampering: if chain verification fails, alert CISO immediately
- **Long-term retention architecture:**
  - Configurable retention: 1 year, 3 years, 5 years (EU AI Act requires keeping records)
  - Archive strategy: hot (30 days, DB) → warm (1 year, compressed files) → cold (S3/Azure Blob)
  - Compliance-ready export: entire audit trail for a time period as signed archive

**Files to touch:**
- New: `server/src/audit/chain-logger.js` — hash-chained event logging
- New: `server/src/audit/receipt-generator.js` — receipt creation
- New: `server/src/audit/chain-verifier.js` — integrity verification
- New: `server/src/audit/archive-manager.js` — retention + archival
- New: `server/src/routes/audit.js` — audit API
- New: `connect-ui/src/Components/Audit/` — audit UI

**Definition of done:** All governance events are hash-chained. Chain verification API works. Tampering is detectable. PDF receipts generate.

---

### DAY 20 — Friday, Aug 28
#### Reversible PII Tokenization + Auto-Retry with Policy Feedback

**What to build (morning — PII tokenization):**
- **Reversible tokenization engine:**
  - Detect PII in outgoing prompts (name, email, phone, SSN, address, etc.)
  - Replace with format-preserving tokens: `John Smith` → `[PERSON_7f3a]`, `555-1234` → `[PHONE_b2c1]`
  - Token map stored securely on CloudFuze server (never sent to AI vendor)
  - De-tokenize AI response: replace tokens back with original values
  - Result: AI processes the prompt effectively, but never sees real PII
- **Tokenization scope controls:**
  - Per-field tokenization rules (always tokenize SSN, conditionally tokenize names)
  - Tokenization exemptions: "This tool has a BAA, don't tokenize for it"
  - Audit log: which tokens were created, for which request, de-tokenized when

**What to build (afternoon — auto-retry):**
- **Auto-retry with policy feedback:**
  - When a guardrail blocks a request, instead of just returning an error:
  - Inject the reason back into the prompt: "Your request was blocked because it contained [reason]. Please rephrase without [specific issue]."
  - Retry up to 3 times with the modified prompt
  - If all retries fail → block with full explanation
  - This turns governance from "wall" into "guide" — productivity preserved

**Files to touch:**
- New: `server/src/tokenization/tokenizer.js` — PII tokenization engine
- New: `server/src/tokenization/token-store.js` — secure token map storage
- New: `server/src/tokenization/detokenizer.js` — response de-tokenization
- New: `server/src/guardrails/auto-retry.js` — retry with feedback injection
- `agent/src/proxy/` — integrate tokenization + retry at proxy layer

**Definition of done:** PII is tokenized before reaching AI vendor, de-tokenized in response. Auto-retry resolves 60%+ of soft violations without user intervention.

---

## DAY 21: SDK + SIEM + INTEGRATION TESTING + DEMO POLISH
### Monday, Aug 31
### Theme: "Ship-ready"

---

### DAY 21 — Monday, Aug 31
#### Developer SDK + SIEM Integration + Full Integration Test + Demo Readiness

**What to build (morning — SDK + SIEM):**
- **Developer SDK (npm package):**
  - `@cloudfuze/governance-sdk` — drop-in middleware
  - 2-line integration for Express/Fastify/Koa
  - Auto-reports AI API usage, trace data, and governance events
  - TypeScript types included
  - README with quickstart + examples
- **SIEM integration:**
  - Event streaming endpoint: `/api/v1/events/stream` (Server-Sent Events)
  - Pre-built connectors:
    - **Splunk**: HEC (HTTP Event Collector) format
    - **Microsoft Sentinel**: CEF (Common Event Format)
    - **Datadog**: Datadog Events API format
  - Event format: CEF-compliant with governance-specific extensions
  - Configurable: which event types to stream (all, critical-only, guardrails-only)

**What to build (afternoon — testing + demo):**
- **Integration testing:**
  - End-to-end test: agent scans → server ingests → dashboard renders → compliance report exports
  - Guardrails integration test: prompt injection → detected → blocked → alert fired → dashboard updated
  - Spend cap test: simulate budget exhaustion → verify automatic cutoff
  - Trace test: instrumented app → traces appear in timeline → anomaly triggers alert
  - Routing test: PII prompt → routed to private model → response verified
- **Demo scenario scripting:**
  - Script 1: "The Compliance Officer" — deploy EU AI Act pack → classify tools → export FRIA report
  - Script 2: "The Security Incident" — jailbreak attempt → guardrail blocks → cryptographic audit → SIEM alert
  - Script 3: "The Cost Optimizer" — show spend dashboard → set budget cap → enable model routing → show savings
  - Script 4: "The Policy Writer" — write policy in English → simulate → deploy → see it work in real-time
- **Demo data seeding:**
  - Realistic sample data: 30 days of AI usage, 500 users, 20 teams, 10K+ events
  - Include violations, guardrail triggers, budget alerts, trace data
  - Make every dashboard look compelling in a live demo

**Files to touch:**
- New: `sdk/node/src/middleware.js` — Express middleware
- New: `server/src/integrations/siem/` — SIEM connectors
- New: `server/src/integrations/siem/splunk.js`
- New: `server/src/integrations/siem/sentinel.js`
- New: `server/src/integrations/siem/datadog.js`
- New: `scripts/integration-tests/` — E2E test suite
- New: `scripts/seed-demo-data.js` — demo data seeder

**Definition of done:** All features integrated + tested. Demo runs smoothly with 4 scripted scenarios. Sales team can demo independently.

---

## ADDITIONAL HIGH-VALUE FEATURES (Beyond Competitor Analysis)

These are features that NO competitor has but would give CloudFuze a unique edge:

### A. AI Risk Score per Employee (Unique to CloudFuze)
- Aggregate risk scoring based on: tools used, data sensitivity in prompts, guardrail violations, compliance posture
- Score 0–100: Low Risk (0–30) → Medium (31–60) → High (61–80) → Critical (81–100)
- Trending: is an employee's risk increasing or decreasing?
- **Use case:** CISO sees "5 employees moved from Medium to High risk this week" — proactive security, not just reactive blocking

### B. Policy Impact Simulator ("What-If" Mode)
- Before enabling a new policy: "This policy would have blocked 847 events and impacted 23 users in the last 30 days"
- Shows exactly which events would have been blocked, which users affected
- Prevents over-blocking fears that stop compliance teams from deploying policies
- **Use case:** Compliance officer enables HIPAA pack in simulation → reviews impact → deploys confidently

### C. Executive Summary Autopilot
- Weekly automated email to CISO/CEO:
  - "47 shadow AI tools discovered this week (3 new)"
  - "12 critical DLP events blocked"
  - "AI spend: $42K (+8% vs last week)"
  - "Compliance score: 87% (↑2% from last week)"
  - "Top risk: Marketing team using unapproved Claude Desktop"
- No dashboard login needed — governance insights come to you
- **Use case:** CEO opens email Monday morning → instant AI governance status without touching the dashboard

### D. Vendor Risk Assessment Cards
- Auto-assess each AI vendor (OpenAI, Anthropic, Google, etc.):
  - Data processing location, certifications (SOC 2, ISO 27001, HIPAA BAA)
  - Data retention policy, training opt-out availability
  - Security track record, breach history
  - CloudFuze risk rating: Low / Medium / High / Critical
- **Use case:** When an employee starts using a new AI tool, the security team instantly sees the vendor risk profile

### E. Incident Response Workflow
- When a critical violation occurs:
  1. Auto-create incident ticket (integrates with Jira/ServiceNow)
  2. Assign to appropriate security team member
  3. Escalation timer: if not acknowledged in 30 min → escalate to manager
  4. Investigation tools: one-click replay of the violating interaction
  5. Resolution tracking: root cause, remediation, preventive action
- **Use case:** AWS key detected in ChatGPT → Jira ticket created → assigned to John → resolved in 2 hours → auditable record

### F. Agent Dependency Graph Visualization
- Visual map of all discovered AI agents and their connections:
  - Which MCP servers does each agent connect to?
  - What API keys does each agent have access to?
  - Which data sources can each agent read/write?
  - Agent-to-agent communication paths
- Interactive: click an agent → see everything it can touch
- Risk visualization: highlight agents with over-provisioned access
- **Use case:** "Show me every agent that can access our customer database" → instant answer

---

## SUCCESS METRICS FOR AUGUST

| Metric | Target | How to Measure |
|--------|--------|---------------|
| P0 blockers closed | 4/4 | All P0 items in ROADMAP.md marked done |
| Compliance frameworks supported | 6 | Policy packs deployed and tested |
| Guardrail types active | 5 | Injection, jailbreak, hallucination, toxicity, bias |
| Combined policy rules | 100+ | Sum of all policy pack rules |
| Agent trace latency (p95) | <100ms | WebSocket stream measurement |
| Demo scenarios scripted | 4 | Runnable by sales team independently |
| SDK integration lines | 2 | npm install + require + instrument |
| SIEM connectors | 3 | Splunk, Sentinel, Datadog |
| New API endpoints | 25+ | Routes added across all modules |
| New UI pages/views | 15+ | Dashboard, compliance, tracing, billing, routing, policies, audit |

---

## RISK REGISTER

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Guardrail ML models too slow for inline use | Medium | High | Start with pattern-based detection; ML as async enrichment |
| Trace volume overwhelms SQLite | High | Medium | Implement buffered writes + archival early; plan PostgreSQL migration |
| Natural-language policy parsing unreliable | Medium | Medium | Always show "here's what I understood" confirmation; allow manual edit |
| PII tokenization breaks AI response quality | Low | High | Test with real prompts; offer bypass for low-sensitivity contexts |
| Too many features, not enough depth | Medium | High | Each feature has a "definition of done" — hit that bar, then move on |

---

## PRICING IMPACT

| Current Tier | New Capabilities Added | Suggested Price Adjustment |
|-------------|----------------------|--------------------------|
| **Starter** ($X/seat) | + Guardrails (basic) + 2 policy packs (GDPR, SOC 2) | No change — competitive entry point |
| **Business** ($Y/seat) | + All guardrails + All policy packs + Spend tracking + Tracing | +30-40% premium justified by guardrails + compliance |
| **Enterprise** ($Z/seat) | + Model routing + NL policies + Crypto audit + SDK + SIEM + Tokenization | +50-70% premium — full governance platform, not just DLP |

**Key selling motion change:** CloudFuze moves from "we catch secrets in AI prompts" to "we are your complete AI governance platform — compliance, security, cost control, and observability in one."

---

*Plan prepared July 27, 2026. Next review: Aug 3, 2026 (Day 1 kickoff).*
