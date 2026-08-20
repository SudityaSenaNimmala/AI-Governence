// AI Risk Score Engine — computes a 0-100 risk score per employee.
//
// Score factors (weighted):
//   1. DLP violations (high/critical blocked events)     — weight 30
//   2. Enforcement overrides (Ctrl+Alt+Enter bypasses)   — weight 25
//   3. Shadow tool usage (unsanctioned AI tools)          — weight 20
//   4. Data sensitivity (PII/secrets in prompts)          — weight 15
//   5. Volume anomaly (sudden usage spikes)               — weight 10
//
// Score ranges:
//   0-30:  Low (green)     — model AI citizen
//   31-60: Medium (yellow) — some flags, worth monitoring
//   61-80: High (orange)   — active issues, needs attention
//   81-100: Critical (red) — immediate intervention required
//
// The score is computed over a configurable window (default: 30 days).
// Historical scores are stored for trending.

import crypto from 'node:crypto';
import { a } from '../util.js';
import { fireWebhooks } from './webhooks.js';
import { scoreToLevel } from '../lib/risk-scale.js';

const WINDOW_DAYS = 90;
const WEIGHTS = {
  dlp_violations: 30,
  enforcement_overrides: 25,
  shadow_tools: 20,
  data_sensitivity: 15,
  volume_anomaly: 10,
};

/**
 * Profiles the endpoint scanner created from a browser extension it could not yet
 * match to a named account. Defined once so the list and summary endpoints cannot
 * drift apart again — they previously each carried their own copy of this rule,
 * and only one of them applied it.
 *
 * Exported because it is not only a risk-score concern: it is the org-wide test
 * for "this display name is a placeholder, not a person", and routes/access-requests.js
 * needs it to keep such a name from outranking a real detected username.
 */
export const UNIDENTIFIED_NAME = /^Browser User/;

export function mountRiskScore(app, db) {
  const scores    = () => db.collection('risk_scores');
  const profiles  = () => db.collection('employee_profiles');
  const dlpEvents = () => db.collection('dlp_events');
  const findings  = () => db.collection('findings');
  const sanctions = () => db.collection('sanctions');

  // ── Compute scores for all employees ──

  app.post('/api/v1/risk-scores/compute', a(async (req, res) => {
    const allProfiles = await profiles().find({}).project({ _id: 0 }).toArray();
    const allSanctions = await sanctions().find({}).project({ _id: 0 }).toArray();
    const sanctionedKeys = new Set(allSanctions.filter(s => s.status === 'approved').map(s => s.tool_key));

    const results = [];
    for (const profile of allProfiles) {
      const score = await computeScore(db, profile, sanctionedKeys);
      results.push(score);

      // Store historical score
      await scores().insertOne({
        id: crypto.randomUUID(),
        profile_id: profile.id,
        display_name: profile.display_name,
        score: score.score,
        level: score.level,
        factors: score.factors,
        computed_at: new Date(),
      });

      // Update profile with latest score
      await profiles().updateOne({ id: profile.id }, {
        $set: {
          risk_score: score.score,
          risk_level: score.level,
          risk_factors: score.factors,
          risk_computed_at: new Date(),
        },
      });

      // Fire webhook if score is high or critical
      if (score.level === 'high' || score.level === 'critical') {
        fireWebhooks(db, 'risk_score_high', {
          title: 'Risk Score Alert: ' + (profile.display_name || 'Employee') + ' → ' + score.level.toUpperCase(),
          body: (profile.display_name || 'An employee') + ' has a risk score of ' + score.score + ' (' + score.level + '). Top factors: DLP violations (' + (score.factors?.dlp_violations?.raw || 0) + '), overrides (' + (score.factors?.enforcement_overrides?.raw || 0) + '), shadow tools (' + (score.factors?.shadow_tools?.raw || 0) + ').',
          severity: score.level,
          employee: profile.display_name || profile.email || 'Unknown',
          tool: 'Risk Score Engine',
          trigger: 'risk_score_high',
        });
      }
    }

    res.json({ computed: results.length, scores: results });
  }));

  // ── Get all current scores (from profiles) ──

  app.get('/api/v1/risk-scores', a(async (req, res) => {
    const allProfiles = await profiles().find({ risk_score: { $ne: null } })
      .sort({ risk_score: -1 })
      .project({ _id: 0, id: 1, display_name: 1, email: 1, hostname: 1, department: 1,
        risk_score: 1, risk_level: 1, risk_factors: 1, risk_computed_at: 1, sources: 1 })
      .toArray();

    // Tag each row as identified or not, using the SAME rule the summary applies.
    //
    // This endpoint returned every scored profile while /summary silently excluded
    // "Browser User (hash)" ones, so the same screen reported 18 people in the table
    // and 3 in the header. Both numbers were defensible in isolation and impossible
    // to reconcile on screen. The filter stays out of this endpoint — dropping rows
    // here would hide real people whose extension has not yet been matched to an
    // account — but the flag lets the caller group them and the two counts add up.
    res.json(allProfiles.map(p => ({ ...p, is_identified: !UNIDENTIFIED_NAME.test(p.display_name || '') })));
  }));

  // ── Summary stats (MUST be before /:profileId to avoid Express param conflict) ──

  app.get('/api/v1/risk-scores/summary', a(async (req, res) => {
    const allProfiles = await profiles().find({
      risk_score: { $ne: null },
      display_name: { $not: UNIDENTIFIED_NAME },
    }).project({ _id: 0, risk_score: 1, risk_level: 1 }).toArray();
    const total = allProfiles.length;

    // Scored, but not attributable to a named person. Counted separately rather
    // than dropped: excluding them from the average is right (an unnamed row cannot
    // be actioned), but omitting them entirely is what made the header disagree
    // with the table below it. GET /api/v1/risk-scores returns these with
    // is_identified: false, so total_employees + unidentified equals its row count.
    const unidentified = await profiles().countDocuments({
      risk_score: { $ne: null },
      display_name: UNIDENTIFIED_NAME,
    });
    const avgScore = total ? Math.round(allProfiles.reduce((s, p) => s + p.risk_score, 0) / total) : 0;
    const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const p of allProfiles) distribution[p.risk_level] = (distribution[p.risk_level] || 0) + 1;

    // Report the unmeasured population instead of quietly dropping it.
    //
    // The risk_score:{$ne:null} filter above correctly keeps unassessed people out
    // of the average — but on its own it makes them invisible, so an org where
    // most staff have no endpoint agent shows a small, healthy-looking cohort and
    // no hint that the coverage is thin. "We measured 4 of 40 people" is a
    // materially different statement from "we measured 4 people", and the second
    // one is what this endpoint used to imply.
    const notAssessed = await profiles().countDocuments({
      $or: [{ risk_score: null }, { risk_score: { $exists: false } }],
      display_name: { $not: /^Browser User/ },
    });

    res.json({
      total_employees: total,
      average_score: avgScore,
      distribution,
      unidentified,
      not_assessed: notAssessed,
      coverage_percent: (total + notAssessed) ? Math.round((total / (total + notAssessed)) * 100) : 0,
    });
  }));

  // ── Get single employee score with history ──

  app.get('/api/v1/risk-scores/:profileId', a(async (req, res) => {
    const profile = await profiles().findOne({ id: req.params.profileId }, { projection: { _id: 0 } });
    if (!profile) return res.status(404).json({ error: 'profile not found' });

    const history = await scores()
      .find({ profile_id: req.params.profileId })
      .sort({ computed_at: -1 })
      .limit(90)
      .project({ _id: 0, score: 1, level: 1, computed_at: 1 })
      .toArray();

    // Get recent DLP events for this employee
    const recentEvents = await dlpEvents()
      .find({ machine_id: { $in: profile.machine_ids || [] }, occurred_at: { $gte: windowStart() } })
      // occurred_at is stored as ISO string — string comparison works for sorting
      .sort({ occurred_at: -1 })
      .limit(20)
      .project({ _id: 0 })
      .toArray();

    res.json({ profile, history, recent_events: recentEvents });
  }));
}

function windowStart() {
  // Return as ISO string — DLP events store occurred_at as string, not Date
  return new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
}

// These bands moved to server/src/lib/risk-scale.js so the registry, the agent
// assessor and this file cannot drift apart. The values are unchanged — they were
// already the ones the dashboard's printed legend documents.
const scoreLevel = scoreToLevel;

async function computeScore(db, profile, sanctionedKeys) {
  const machineIds = profile.machine_ids || [];
  if (machineIds.length === 0) {
    // NOT score 0 / level 'low'.
    //
    // No enrolled machine means nothing was measured for this person, and this
    // file's own header describes level 'low' as a "model AI citizen". Someone
    // with no endpoint agent installed was therefore rendered as the safest
    // employee in the org — and folded into average_score, dragging the org
    // average toward "healthy" in proportion to how many people are UNMONITORED.
    // That is precisely backwards for a governance tool.
    //
    // score: null + level: 'not_assessed' so the UI can say so, and the caller
    // below excludes these from the average.
    return {
      profile_id: profile.id,
      display_name: profile.display_name,
      score: null,
      level: 'not_assessed',
      factors: {},
      not_assessed_reason: 'No enrolled machine — nothing has been measured for this person',
    };
  }

  const since = windowStart();
  const dlpCol = db.collection('dlp_events');
  const findingsCol = db.collection('findings');

  // Factor 1: DLP violations (high/critical severity events)
  const dlpViolations = await dlpCol.countDocuments({
    machine_id: { $in: machineIds },
    occurred_at: { $gte: since },
    event_kind: 'enforcement_block',
  });
  const dlpScore = Math.min(dlpViolations * 8, 100);  // each block = 8 points, max 100

  // Factor 2: Enforcement overrides (user bypassed the block)
  const overrides = await dlpCol.countDocuments({
    machine_id: { $in: machineIds },
    occurred_at: { $gte: since },
    event_kind: 'enforcement_override',
  });
  const overrideScore = Math.min(overrides * 20, 100);  // each override = 20 points (very risky)

  // Factor 3: Shadow tool usage (tools not in sanctioned list)
  const toolUsage = await findingsCol.find({
    machine_id: { $in: machineIds },
    detected_at: { $gte: since },
  }).project({ tool_key: 1 }).toArray();
  const uniqueTools = new Set(toolUsage.map(f => f.tool_key).filter(Boolean));
  let shadowCount = 0;
  for (const tk of uniqueTools) {
    if (!sanctionedKeys.has(tk)) shadowCount++;
  }
  const shadowScore = Math.min(shadowCount * 15, 100);  // each shadow tool = 15 points

  // Factor 4: Data sensitivity (severity of patterns found in prompts)
  const criticalEvents = await dlpCol.countDocuments({
    machine_id: { $in: machineIds },
    occurred_at: { $gte: since },
    secret_class: { $in: ['critical', 'high'] },
  });
  const sensitivityScore = Math.min(criticalEvents * 10, 100);  // each critical/high event = 10

  // Factor 5: Volume anomaly — compare last 7 days to previous period average
  const recent7dStart = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent7d = await dlpCol.countDocuments({
    machine_id: { $in: machineIds },
    occurred_at: { $gte: recent7dStart },
  });
  const prevPeriod = await dlpCol.countDocuments({
    machine_id: { $in: machineIds },
    occurred_at: { $gte: since, $lt: recent7dStart },
  });
  const prevDays = WINDOW_DAYS - 7;
  const dailyAvgPrev = prevPeriod / prevDays;
  const dailyAvgRecent = recent7d / 7;
  // Anomaly: recent daily rate is >3x the previous average
  const volumeRatio = dailyAvgPrev > 0 ? dailyAvgRecent / dailyAvgPrev : (recent7d > 10 ? 3 : 0);
  const volumeScore = volumeRatio > 5 ? 100 : volumeRatio > 3 ? 70 : volumeRatio > 2 ? 40 : 0;

  // Weighted composite score
  const rawScore =
    (dlpScore * WEIGHTS.dlp_violations +
     overrideScore * WEIGHTS.enforcement_overrides +
     shadowScore * WEIGHTS.shadow_tools +
     sensitivityScore * WEIGHTS.data_sensitivity +
     volumeScore * WEIGHTS.volume_anomaly) / 100;

  const finalScore = Math.min(Math.round(rawScore), 100);

  return {
    profile_id: profile.id,
    display_name: profile.display_name,
    email: profile.email,
    score: finalScore,
    level: scoreLevel(finalScore),
    factors: {
      dlp_violations:       { raw: dlpViolations, score: dlpScore, weight: WEIGHTS.dlp_violations },
      enforcement_overrides:{ raw: overrides, score: overrideScore, weight: WEIGHTS.enforcement_overrides },
      shadow_tools:         { raw: shadowCount, score: shadowScore, weight: WEIGHTS.shadow_tools },
      data_sensitivity:     { raw: criticalEvents, score: sensitivityScore, weight: WEIGHTS.data_sensitivity },
      volume_anomaly:       { raw: Math.round(volumeRatio * 10) / 10, score: volumeScore, weight: WEIGHTS.volume_anomaly },
    },
  };
}
