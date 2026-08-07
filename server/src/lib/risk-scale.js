/**
 * THE risk scale. One direction, one set of bands, one score→level function.
 *
 * Why this file exists
 * --------------------
 * Risk was being scored six different ways, in two opposite directions, and the
 * results were rendered in the same table column:
 *
 *   riskService.ts        started at 100 and deducted   → 87 meant SAFE
 *   registry.js  (scan)   started at 0 and added        → 87 meant DANGEROUS
 *   risk-score.js         started at 0 and added        → forward
 *   UserActivityTab.jsx   inverted, and different cut-points again
 *   AgentGovernance.jsx   forward, third set of cut-points
 *   AzureRiskPanel        inverted, fourth set
 *
 * Live /api/v1/registry therefore returned an agent scoring 42 labelled "high"
 * sitting below one scoring 87 labelled "low", with the bands overlapping
 * (low spanned 0-87, medium spanned 53-75). The list also sorted by raw score
 * descending under a comment saying "highest risk first", which — because the
 * governance rows were inverted — put the SAFEST agents at the top and buried the
 * genuinely risky ones. A compliance tool that hides the risky rows by default is
 * worse than one that shows nothing.
 *
 * The convention
 * --------------
 * FORWARD: 0 = safe, 100 = maximum risk. Higher is worse, everywhere, always.
 *
 * Chosen over the inverted "compliance score" because:
 *   - it is what the field is called (`risk_score`, not `compliance_score`);
 *   - `risk-score.js` (per-employee) and the endpoint scanner already use it;
 *   - the dashboard's own printed legend says "Low Risk / Score 0-30",
 *     "Medium Risk / Score 31-60", so the UI was already documenting this scale
 *     while half the data disagreed with it.
 *
 * The bands below are exactly that printed legend. Do not add a second copy of
 * them anywhere — import scoreToLevel().
 */

/** Inclusive upper bound of each band, ascending. Matches the UI's legend. */
export const RISK_BANDS = [
  { level: 'low', max: 30 },
  { level: 'medium', max: 60 },
  { level: 'high', max: 80 },
  { level: 'critical', max: 100 },
];

/**
 * Forward risk score → level.
 *
 * Returns null for null/undefined/NaN rather than defaulting to 'low'. An agent
 * nobody has assessed must not render as the safest agent in the fleet — that is
 * the one failure mode a governance product cannot afford. Callers should show
 * "not assessed" when this returns null.
 */
export function scoreToLevel(score) {
  if (score === null || score === undefined) return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(100, n));
  for (const band of RISK_BANDS) {
    if (clamped <= band.max) return band.level;
  }
  return 'critical';
}

/**
 * Convert a legacy "compliance score" (100 = fully compliant) to a forward risk
 * score. riskService.ts computes by deducting from 100, which is a reasonable way
 * to express "how many controls are satisfied" — it just is not a risk score, and
 * publishing it as one is what caused the contradiction above. Convert at the
 * boundary rather than rewriting the deduction logic, so the assessment rules keep
 * their existing, reviewed behaviour.
 */
export function complianceToRisk(complianceScore) {
  if (complianceScore === null || complianceScore === undefined) return null;
  const n = Number(complianceScore);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, 100 - n));
}

/** Display colour per level. Kept here so server and UI cannot drift apart. */
export const RISK_COLORS = {
  low: '#16a34a',
  medium: '#d97706',
  high: '#ea580c',
  critical: '#dc2626',
};

/**
 * Marker stamped on every risk object written under the forward scale.
 *
 * Stored `discovered_agents.risk` documents predate this convention and hold
 * COMPLIANCE scores (87 meant "safe"). Reinterpreting those as forward silently
 * inverts every historical row — the safest agent in the fleet renders as
 * "critical" and the riskiest as "medium" — which is worse than the original
 * inconsistency, because it is confidently wrong in both directions.
 *
 * So the scale is self-describing rather than assumed. Read every persisted risk
 * object through normalizeStoredRisk() below, which converts legacy documents on
 * the way out and leaves marked ones alone. No migration step is required, and a
 * backfill (if ever run) is idempotent because it would stamp the marker too.
 */
export const RISK_SCALE_MARKER = 'forward_v1';

/**
 * Normalise a persisted `risk` object to the forward scale.
 *
 * - marked forward_v1  → returned as-is (level recomputed for safety)
 * - unmarked (legacy)  → score converted 100−x, level recomputed
 * - missing/!numeric   → score null, level "not_assessed" (never "low")
 */
export function normalizeStoredRisk(risk) {
  if (!risk || typeof risk !== 'object') {
    return { score: null, level: 'not_assessed', factors: [], recommendations: [] };
  }
  const isForward = risk.scale === RISK_SCALE_MARKER;
  const raw = Number(risk.score);
  if (!Number.isFinite(raw)) {
    return { ...risk, score: null, level: 'not_assessed' };
  }
  const score = isForward ? Math.max(0, Math.min(100, raw)) : complianceToRisk(raw);
  return { ...risk, score, level: scoreToLevel(score), scale: RISK_SCALE_MARKER };
}
