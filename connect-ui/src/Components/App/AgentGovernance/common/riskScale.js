/**
 * Client mirror of server/src/lib/risk-scale.js.
 *
 * The server is the source of truth — this exists only because connect-ui cannot
 * import from the server package. If the bands change, change them there first and
 * copy them here; there is no third place.
 *
 * FORWARD scale: 0 = safe, 100 = maximum risk. Higher is worse.
 *
 * Two client helpers were doing this locally, inverted, with cut-points that
 * matched neither each other nor the server:
 *
 *   computeDiscoveredAgentRisk  >=80 low, >=60 medium, >=40 high, else critical
 *   AzureRiskPanel              the same inverted bands, computed separately
 *
 * Because computeDiscoveredAgentRisk is used as a FALLBACK
 * (`a.risk || computeDiscoveredAgentRisk(a)`), the same agent could show "low"
 * client-side and "medium" server-side depending on which branch ran.
 */

/** Inclusive upper bound per band, ascending. Mirrors RISK_BANDS on the server. */
export const RISK_BANDS = [
  { level: "low", max: 30 },
  { level: "medium", max: 60 },
  { level: "high", max: 80 },
  { level: "critical", max: 100 },
];

/**
 * Forward risk score → level. Returns null (not "low") for a missing score, so an
 * unassessed subject cannot render as the safest one.
 */
export function scoreToLevel(score) {
  if (score === null || score === undefined) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(100, n));
  for (const band of RISK_BANDS) if (clamped <= band.max) return band.level;
  return "critical";
}

/**
 * Convert a legacy "compliance score" (100 = fully compliant, computed by
 * deducting penalties) into a forward risk score. Use this at the point where a
 * deduct-from-100 tally is turned into something displayed as risk.
 */
export function complianceToRisk(complianceScore) {
  if (complianceScore === null || complianceScore === undefined) return null;
  const n = Number(complianceScore);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, 100 - n));
}

/** Mid-point of each band, used as the representative score for a baseline. */
const BAND_MIDPOINT = { low: 15, medium: 45, high: 70, critical: 90 };

/**
 * A platform-level baseline, NOT a measurement.
 *
 * Several client scan paths (Gemini, Vertex, Chat, NotebookLM, Bedrock, SageMaker,
 * OpenAI, Claude) stamped a hardcoded two-digit score on every agent of a given
 * type — always the same number, e.g. every Bedrock agent got 55. Those rendered
 * as "Risk Score: 55/100" in a large coloured numeral and were sortable, so they
 * read as a per-agent measurement when they were a lookup on the platform name
 * (and, before this, on the inverted scale, so 80 meant "low").
 *
 * This keeps the author's intent — the LEVEL they were asserting — while being
 * explicit that no assessment ran. `basis: "platform_baseline"` lets the UI label
 * it, and the score is the band mid-point so it sorts sensibly without implying
 * two significant figures of precision.
 *
 * Replace a call to this with a real assessRisk() result as soon as the platform
 * supplies permissions/connectors/activity to assess.
 */
export function platformBaseline(level, note) {
  const lvl = BAND_MIDPOINT[level] === undefined ? "medium" : level;
  return {
    score: BAND_MIDPOINT[lvl],
    level: lvl,
    basis: "platform_baseline",
    factors: [{
      signal: "Platform baseline",
      weight: lvl,
      description: note || `Baseline for this platform type — no per-agent assessment has run`,
    }],
    recommendations: ["Connect discovery for this platform so the agent can be assessed individually"],
  };
}
