// EU AI Act Assessment & Reporting (SELECTED_FEATURES_AUG2026 #35).
//
// Three surfaces: the classification wizard, the FRIA, and the audit-ready report.
// Assessments live in `eu_ai_act_assessments`, one document per AI system.
//
// The classification the wizard produces is a PROPOSAL. It is stored alongside the
// answers that produced it, and a compliance officer confirms or overrides it with a
// written justification. That record — answers, proposal, decision, who decided,
// when — is the thing an auditor actually asks for; a bare tier label is not
// defensible on its own.

import { Router } from "express";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import {
  TIER_QUESTIONS, TIER_META, FRIA_QUESTIONS,
  classify, friaCompleteness,
} from "../services/euAiAct.js";
import type { RiskTier } from "../services/euAiAct.js";
import { POLICY_PACKS } from "../services/policyPacks.js";

const router = Router();
const COLL = "eu_ai_act_assessments";

/** GET /api/eu-ai-act/questionnaire — wizard + FRIA definitions and tier guidance. */
router.get("/questionnaire", (_req, res) => {
  res.json({
    tier_questions: TIER_QUESTIONS,
    fria_questions: FRIA_QUESTIONS,
    tiers: TIER_META,
    note: "Answers propose a tier; a compliance officer confirms or overrides it with justification.",
  });
});

/**
 * POST /api/eu-ai-act/classify — score answers without saving.
 * Lets the wizard show the outcome as the user answers, before committing.
 */
router.post("/classify", (req, res) => {
  const answers = (req.body?.answers || {}) as Record<string, boolean>;
  const result = classify(answers);
  res.json({
    ...result,
    tier_meta: TIER_META[result.tier],
    answered: Object.keys(answers).length,
    total_questions: TIER_QUESTIONS.length,
    saved: false,
  });
});

/**
 * PUT /api/eu-ai-act/assessments/:systemId — save or update an assessment.
 * Body: { system_name, answers, override_tier?, override_justification?,
 *         assessed_by, fria_answers? }
 */
router.put("/assessments/:systemId", async (req, res) => {
  try {
    const { systemId } = req.params;
    const {
      system_name, answers, override_tier, override_justification,
      assessed_by, fria_answers,
    } = req.body ?? {};

    if (!system_name) {
      res.status(400).json({ error: "system_name is required" });
      return;
    }
    if (!assessed_by) {
      // An assessment nobody is named on is not evidence.
      res.status(400).json({ error: "assessed_by is required — an assessment needs an accountable person" });
      return;
    }

    const valid: RiskTier[] = ["unacceptable", "high", "limited", "minimal"];
    if (override_tier && !valid.includes(override_tier)) {
      res.status(400).json({ error: `override_tier must be one of: ${valid.join(", ")}` });
      return;
    }
    if (override_tier && !String(override_justification || "").trim()) {
      // Overriding the questionnaire is legitimate; doing it silently is not.
      res.status(400).json({
        error: "override_justification is required when overriding the proposed tier",
      });
      return;
    }

    const proposed = classify((answers || {}) as Record<string, boolean>);
    const finalTier: RiskTier = override_tier || proposed.tier;
    const now = new Date();

    const doc: Record<string, unknown> = {
      system_id: systemId,
      system_name,
      answers: answers || {},
      proposed_tier: proposed.tier,
      proposed_reasons: proposed.reasons,
      final_tier: finalTier,
      overridden: !!override_tier && override_tier !== proposed.tier,
      override_justification: override_justification || null,
      fria_required: proposed.fria_required && finalTier === "high",
      assessed_by,
      assessed_at: now,
      updated_at: now,
    };
    if (fria_answers && typeof fria_answers === "object") doc.fria_answers = fria_answers;

    await getDb().collection(COLL).updateOne(
      { system_id: systemId },
      { $set: doc, $setOnInsert: { id: crypto.randomUUID(), created_at: now } },
      { upsert: true },
    );

    res.json({
      success: true,
      system_id: systemId,
      proposed_tier: proposed.tier,
      final_tier: finalTier,
      overridden: doc.overridden,
      fria_required: doc.fria_required,
      tier_meta: TIER_META[finalTier],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save assessment";
    console.error("EU AI Act save error:", message);
    res.status(500).json({ error: message });
  }
});

/** PUT /api/eu-ai-act/assessments/:systemId/fria — save FRIA answers. */
router.put("/assessments/:systemId/fria", async (req, res) => {
  try {
    const { systemId } = req.params;
    const { fria_answers, completed_by } = req.body ?? {};
    if (!fria_answers || typeof fria_answers !== "object") {
      res.status(400).json({ error: "fria_answers object is required" });
      return;
    }
    const existing = await getDb().collection(COLL).findOne({ system_id: systemId });
    if (!existing) {
      res.status(404).json({ error: "Classify the system before completing its FRIA" });
      return;
    }
    const completeness = friaCompleteness(fria_answers);
    await getDb().collection(COLL).updateOne(
      { system_id: systemId },
      {
        $set: {
          fria_answers,
          fria_completed_by: completed_by || null,
          fria_updated_at: new Date(),
          fria_percent: completeness.percent,
        },
      },
    );
    res.json({ success: true, system_id: systemId, completeness });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save FRIA";
    console.error("EU AI Act FRIA error:", message);
    res.status(500).json({ error: message });
  }
});

/** GET /api/eu-ai-act/assessments — all assessments with a portfolio summary. */
router.get("/assessments", async (_req, res) => {
  try {
    const rows = await getDb().collection(COLL)
      .find({}).project({ _id: 0 }).sort({ updated_at: -1 }).toArray();

    const byTier: Record<string, number> = { unacceptable: 0, high: 0, limited: 0, minimal: 0 };
    let friaRequired = 0;
    let friaComplete = 0;
    for (const r of rows as any[]) {
      byTier[r.final_tier] = (byTier[r.final_tier] || 0) + 1;
      if (r.fria_required) {
        friaRequired++;
        if (friaCompleteness(r.fria_answers || {}).complete) friaComplete++;
      }
    }

    res.json({
      assessments: rows.map((r: any) => ({
        ...r,
        fria_completeness: r.fria_required ? friaCompleteness(r.fria_answers || {}) : null,
      })),
      summary: {
        total_assessed: rows.length,
        by_tier: byTier,
        fria_required: friaRequired,
        fria_complete: friaComplete,
        prohibited_in_use: byTier.unacceptable,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list assessments";
    console.error("EU AI Act list error:", message);
    res.status(500).json({ error: message });
  }
});

/** GET /api/eu-ai-act/assessments/:systemId */
router.get("/assessments/:systemId", async (req, res) => {
  try {
    const row = await getDb().collection(COLL)
      .findOne({ system_id: req.params.systemId }, { projection: { _id: 0 } });
    if (!row) {
      res.status(404).json({ error: "No assessment for that system" });
      return;
    }
    res.json({
      ...row,
      tier_meta: TIER_META[(row as any).final_tier as RiskTier],
      fria_completeness: friaCompleteness((row as any).fria_answers || {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch assessment";
    res.status(500).json({ error: message });
  }
});

/** DELETE /api/eu-ai-act/assessments/:systemId */
router.delete("/assessments/:systemId", async (req, res) => {
  try {
    const r = await getDb().collection(COLL).deleteOne({ system_id: req.params.systemId });
    res.json({ success: true, deleted: r.deletedCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete assessment";
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/eu-ai-act/report — the audit-ready compliance report.
 *
 * Returns structured JSON (?format=html renders a printable page). Evidence is
 * pulled from live data rather than restated from the assessment, so the report
 * cannot claim controls that are not actually running.
 *
 * The compliance score counts only what is verifiable: classification recorded,
 * FRIA complete where required, and no prohibited system in use. It deliberately
 * excludes anything self-declared.
 */
router.get("/report", async (req, res) => {
  try {
    const db = getDb();
    const org = String(req.query.org || "Your organisation");
    const officer = String(req.query.officer || "—");
    const days = Number(req.query.days) > 0 ? Math.min(Number(req.query.days), 365) : 30;
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const assessments = await db.collection(COLL)
      .find({}).project({ _id: 0 }).sort({ final_tier: 1 }).toArray() as any[];

    // Evidence — measured, not asserted.
    const deployedPacks = await db.collection("policy_pack_deployments")
      .find({ deployed_version: { $gt: 0 } }).project({ _id: 0, pack_id: 1, deployed_version: 1 }).toArray();
    const packNames = deployedPacks.map((d: any) => {
      const p = POLICY_PACKS.find((x) => x.id === d.pack_id);
      return { pack_id: d.pack_id, framework: p?.framework || d.pack_id, version: d.deployed_version };
    });

    const activePolicies = await db.collection("policies").countDocuments({ status: "active" });
    const violations = await db.collection("policy_violations").countDocuments({});
    const guardrailEvents = await db.collection("dlp_events").countDocuments({
      occurred_at: { $gte: sinceIso },
      pattern_matched: { $regex: "injection-|jailbreak-|toxicity-|bias-" },
    });
    const dlpBlocks = await db.collection("dlp_events").countDocuments({
      occurred_at: { $gte: sinceIso },
      event_kind: { $in: ["enforcement_block", "enforcement_redact", "enforcement_tokenize"] },
    });
    const promptEvents = await db.collection("dlp_events").countDocuments({
      occurred_at: { $gte: sinceIso },
      event_kind: { $in: ["prompt_submit", "prompt_paste", "prompt_typed"] },
    });

    const byTier: Record<string, number> = { unacceptable: 0, high: 0, limited: 0, minimal: 0 };
    for (const a of assessments) byTier[a.final_tier] = (byTier[a.final_tier] || 0) + 1;

    const friaNeeded = assessments.filter((a) => a.fria_required);
    const friaDone = friaNeeded.filter((a) => friaCompleteness(a.fria_answers || {}).complete);

    // Remediation: concrete open gaps, each with the action that closes it.
    const remediation: Array<{ severity: string; item: string; action: string }> = [];
    for (const a of assessments.filter((x) => x.final_tier === "unacceptable")) {
      remediation.push({
        severity: "critical",
        item: `"${a.system_name}" is classified as a prohibited practice`,
        action: "Do not deploy in the EU. Decommission if in use and escalate to legal counsel.",
      });
    }
    for (const a of friaNeeded) {
      const c = friaCompleteness(a.fria_answers || {});
      if (!c.complete) {
        remediation.push({
          severity: "high",
          item: `"${a.system_name}" requires a FRIA — ${c.answered}/${c.total} sections complete`,
          action: `Complete: ${c.missing.slice(0, 3).map((m) => m.citation).join(", ")}${c.missing.length > 3 ? "…" : ""}`,
        });
      }
    }
    for (const a of assessments.filter((x) => x.final_tier === "high" && !x.fria_required)) {
      remediation.push({
        severity: "medium",
        item: `"${a.system_name}" is high-risk — confirm Art. 14 human oversight and Art. 12 logging`,
        action: "Record the named overseer and confirm logs are retained for at least six months.",
      });
    }
    if (!packNames.some((p) => p.pack_id === "eu-ai-act")) {
      remediation.push({
        severity: "medium",
        item: "The EU AI Act policy pack is not deployed",
        action: "Deploy it so the Act's enforcement rules run against discovered AI agents.",
      });
    }
    if (assessments.length === 0) {
      remediation.push({
        severity: "high",
        item: "No AI systems have been classified yet",
        action: "Run the classification wizard for each AI system in the registry.",
      });
    }

    // Score: only verifiable facts. Stated openly so nobody reads it as an
    // assurance opinion.
    const checks = [
      { name: "AI systems classified", pass: assessments.length > 0, weight: 30 },
      { name: "No prohibited systems in use", pass: byTier.unacceptable === 0, weight: 25 },
      { name: "FRIAs complete where required", pass: friaNeeded.length === 0 || friaDone.length === friaNeeded.length, weight: 25 },
      { name: "EU AI Act enforcement rules deployed", pass: packNames.some((p) => p.pack_id === "eu-ai-act"), weight: 20 },
    ];
    const score = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);

    const report = {
      generated_at: new Date().toISOString(),
      organisation: org,
      compliance_officer: officer,
      evidence_window_days: days,
      regulation: "Regulation (EU) 2024/1689 — Artificial Intelligence Act",

      executive_summary: {
        systems_assessed: assessments.length,
        by_tier: byTier,
        high_risk_systems: byTier.high,
        fria_required: friaNeeded.length,
        fria_complete: friaDone.length,
        compliance_score: score,
        score_basis: checks.map((c) => ({ check: c.name, passed: c.pass, weight: c.weight })),
      },

      systems: assessments.map((a) => ({
        system_id: a.system_id,
        system_name: a.system_name,
        final_tier: a.final_tier,
        tier_label: TIER_META[a.final_tier as RiskTier]?.label,
        proposed_tier: a.proposed_tier,
        overridden: a.overridden,
        override_justification: a.override_justification,
        classification_basis: a.proposed_reasons,
        obligations: TIER_META[a.final_tier as RiskTier]?.obligations || [],
        assessed_by: a.assessed_by,
        assessed_at: a.assessed_at,
        fria_required: a.fria_required,
        fria: a.fria_required
          ? { ...friaCompleteness(a.fria_answers || {}), completed_by: a.fria_completed_by || null }
          : null,
      })),

      evidence: {
        deployed_policy_packs: packNames,
        active_policies: activePolicies,
        recorded_policy_violations: violations,
        prompt_events_captured: promptEvents,
        dlp_enforcement_events: dlpBlocks,
        guardrail_detections: guardrailEvents,
        note: "Counts are read from live governance data for the stated window, not from the assessment answers.",
      },

      remediation,

      attestation: {
        statement:
          "This report states the classifications recorded in CloudFuze and evidence measured from "
          + "governance data for the stated window. It is a record of the organisation's own "
          + "assessment, not a conformity assessment or a legal opinion, and does not by itself "
          + "demonstrate compliance with Regulation (EU) 2024/1689.",
        signed_by: officer,
        generated_at: new Date().toISOString(),
      },
    };

    if (String(req.query.format || "") !== "html") {
      res.json(report);
      return;
    }
    res.set("content-type", "text/html; charset=utf-8").send(renderHtml(report));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate report";
    console.error("EU AI Act report error:", message);
    res.status(500).json({ error: message });
  }
});

const TIER_COLOR: Record<string, string> = {
  unacceptable: "#b91c1c", high: "#c2410c", limited: "#b45309", minimal: "#15803d",
};
const SEV_COLOR: Record<string, string> = { critical: "#b91c1c", high: "#c2410c", medium: "#b45309" };

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * Printable report. Browser "Print to PDF" produces the deliverable — no PDF
 * toolchain to install on the server, and the customer keeps control of where the
 * file lands.
 */
function renderHtml(r: any): string {
  const s = r.executive_summary;
  return `<!doctype html><html><head><meta charset="utf-8">
<title>EU AI Act Compliance Report — ${esc(r.organisation)}</title>
<style>
  @page { margin: 18mm; }
  body { font: 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:#1f2937; max-width:900px; margin:0 auto; padding:24px; }
  h1 { font-size:26px; color:#003399; margin:0 0 4px; }
  h2 { font-size:17px; color:#003399; margin:28px 0 8px; border-bottom:2px solid #e5e7eb; padding-bottom:4px; }
  h3 { font-size:14px; margin:18px 0 4px; }
  .sub { color:#6b7280; margin:0 0 18px; }
  .meta { background:#f8fafc; border:1px solid #e5e7eb; border-radius:6px; padding:12px 14px; margin-bottom:18px; font-size:12px; }
  .meta div { margin:2px 0; }
  table { width:100%; border-collapse:collapse; margin:10px 0 4px; font-size:12px; }
  th { background:#003399; color:#fff; text-align:left; padding:7px 9px; font-weight:600; }
  td { border:1px solid #e5e7eb; padding:7px 9px; vertical-align:top; }
  .kpis { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0 4px; }
  .kpi { border:1px solid #e5e7eb; border-radius:6px; padding:10px 14px; min-width:120px; }
  .kpi b { display:block; font-size:22px; color:#003399; }
  .kpi span { font-size:11px; color:#6b7280; }
  .pill { display:inline-block; padding:2px 8px; border-radius:99px; color:#fff; font-size:11px; font-weight:600; }
  ul { margin:4px 0 4px 18px; padding:0; }
  li { margin:2px 0; }
  .note { font-size:11px; color:#6b7280; font-style:italic; }
  .attest { background:#f8fafc; border-left:3px solid #003399; padding:12px 14px; margin-top:14px; font-size:12px; }
  .sys { border:1px solid #e5e7eb; border-radius:6px; padding:12px 14px; margin:10px 0; page-break-inside:avoid; }
</style></head><body>

<h1>EU AI Act Compliance Report</h1>
<p class="sub">${esc(r.regulation)}</p>

<div class="meta">
  <div><b>Organisation:</b> ${esc(r.organisation)}</div>
  <div><b>Compliance officer:</b> ${esc(r.compliance_officer)}</div>
  <div><b>Report generated:</b> ${esc(r.generated_at)}</div>
  <div><b>Evidence window:</b> last ${esc(r.evidence_window_days)} days</div>
</div>

<h2>Executive summary</h2>
<div class="kpis">
  <div class="kpi"><b>${s.systems_assessed}</b><span>Systems classified</span></div>
  <div class="kpi"><b>${s.high_risk_systems}</b><span>High-risk</span></div>
  <div class="kpi"><b>${s.fria_complete}/${s.fria_required}</b><span>FRIAs complete</span></div>
  <div class="kpi"><b>${s.compliance_score}%</b><span>Verifiable checks passed</span></div>
</div>
<table>
  <tr><th>Check</th><th>Result</th><th>Weight</th></tr>
  ${s.score_basis.map((c: any) => `<tr><td>${esc(c.check)}</td><td>${c.passed ? "Pass" : "Not met"}</td><td>${c.weight}%</td></tr>`).join("")}
</table>
<p class="note">The score reflects only verifiable checks. It is not an assurance opinion.</p>

<h2>Systems by risk tier</h2>
<table>
  <tr><th>Tier</th><th>Systems</th></tr>
  ${Object.entries(s.by_tier).map(([t, n]) =>
    `<tr><td><span class="pill" style="background:${TIER_COLOR[t] || "#6b7280"}">${esc(t)}</span></td><td>${n}</td></tr>`).join("")}
</table>

<h2>Per-system detail</h2>
${r.systems.length === 0 ? "<p>No systems have been classified yet.</p>" : r.systems.map((sys: any) => `
  <div class="sys">
    <h3>${esc(sys.system_name)}
      <span class="pill" style="background:${TIER_COLOR[sys.final_tier] || "#6b7280"}">${esc(sys.tier_label || sys.final_tier)}</span>
    </h3>
    <div style="font-size:12px;color:#6b7280">Assessed by ${esc(sys.assessed_by)} on ${esc(sys.assessed_at)}</div>
    ${sys.overridden ? `<p style="font-size:12px"><b>Tier overridden</b> from “${esc(sys.proposed_tier)}”. Justification: ${esc(sys.override_justification)}</p>` : ""}
    ${sys.classification_basis?.length ? `<p style="font-size:12px;margin:6px 0 2px"><b>Classification basis</b></p><ul>${
      sys.classification_basis.map((b: any) => `<li>${esc(b.citation)} — ${esc(b.question)}</li>`).join("")}</ul>` : ""}
    <p style="font-size:12px;margin:8px 0 2px"><b>Obligations</b></p>
    <ul>${sys.obligations.map((o: string) => `<li>${esc(o)}</li>`).join("")}</ul>
    ${sys.fria ? `<p style="font-size:12px;margin:8px 0 2px"><b>FRIA (Art. 27)</b> — ${sys.fria.answered}/${sys.fria.total} sections (${sys.fria.percent}%)${
      sys.fria.completed_by ? `, completed by ${esc(sys.fria.completed_by)}` : ""}</p>${
      sys.fria.missing.length ? `<ul>${sys.fria.missing.map((m: any) => `<li>Outstanding: ${esc(m.citation)} — ${esc(m.prompt)}</li>`).join("")}</ul>` : ""}` : ""}
  </div>`).join("")}

<h2>Evidence appendix</h2>
<table>
  <tr><th>Measure</th><th>Value</th></tr>
  <tr><td>Deployed compliance policy packs</td><td>${r.evidence.deployed_policy_packs.length
    ? esc(r.evidence.deployed_policy_packs.map((p: any) => `${p.framework} v${p.version}`).join(", ")) : "none"}</td></tr>
  <tr><td>Active governance policies</td><td>${r.evidence.active_policies}</td></tr>
  <tr><td>Recorded policy violations</td><td>${r.evidence.recorded_policy_violations}</td></tr>
  <tr><td>Prompt events captured (window)</td><td>${r.evidence.prompt_events_captured}</td></tr>
  <tr><td>DLP enforcement events (window)</td><td>${r.evidence.dlp_enforcement_events}</td></tr>
  <tr><td>Guardrail detections (window)</td><td>${r.evidence.guardrail_detections}</td></tr>
</table>
<p class="note">${esc(r.evidence.note)}</p>

<h2>Remediation checklist</h2>
${r.remediation.length === 0 ? "<p>No open gaps identified by the checks in this report.</p>" : `<table>
  <tr><th>Priority</th><th>Open gap</th><th>Recommended action</th></tr>
  ${r.remediation.map((x: any) => `<tr>
    <td><span class="pill" style="background:${SEV_COLOR[x.severity] || "#6b7280"}">${esc(x.severity)}</span></td>
    <td>${esc(x.item)}</td><td>${esc(x.action)}</td></tr>`).join("")}
</table>`}

<h2>Attestation</h2>
<div class="attest">
  <p>${esc(r.attestation.statement)}</p>
  <p style="margin-bottom:0"><b>Signed:</b> ${esc(r.attestation.signed_by)} &nbsp;·&nbsp; <b>Generated:</b> ${esc(r.attestation.generated_at)}</p>
</div>

</body></html>`;
}

export default router;
