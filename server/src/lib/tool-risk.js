// Risk scoring for AI TOOLS governed by the browser extension and desktop agent.
//
// These are services reached through a browser or a desktop app — ChatGPT, Claude,
// the OpenAI and Anthropic APIs, Slack AI, Gemini in Gmail. There is no admin API to
// interrogate: no permission list, no connector graph, no owner. assessRisk() in the
// governance layer needs all of those, so it cannot score them, and registry.js was
// publishing `risk_score: null` for the whole class.
//
// Null was defensible while nothing measured them. It is not defensible now: the
// endpoint capture path records every prompt, every enforcement block and the
// sensitivity class of what was being sent, per service per machine. That IS the
// governance signal for these tools — it is how they are governed in the first place.
// On a live tenant the two "unassessed" API rows turned out to have a 100% block rate
// on critical/high content, which is about as far from "unknown" as a signal gets.
//
// Scored on the product-wide forward scale (0 safe, 100 risky) and stamped
// basis:"endpoint_telemetry", so a consumer can tell this apart from an agent scored
// on permissions and connectors. Different evidence, same scale.

import { scoreToLevel, RISK_SCALE_MARKER } from './risk-scale.js';

/**
 * @param {object} s
 * @param {number} s.events      total captured interactions
 * @param {number} s.blocks      enforcement blocks (DLP stopped the prompt)
 * @param {number} s.overrides   user bypassed a block (Ctrl+Alt+Enter)
 * @param {number} s.sensitive   events whose secret_class was critical or high
 * @param {number} s.machines    distinct machines that used the tool
 * @param {string} [s.status]    'approved' | 'restricted' | 'blocked' | 'unknown'
 * @param {string} [s.lastActive] ISO timestamp of the most recent event
 */
export function assessToolRisk(s) {
  const events = Number(s.events) || 0;

  // No captured traffic means nothing was measured. Returning 0/low here would rank
  // an unseen tool as the safest thing in the estate, which is the precise mistake
  // this module exists to avoid.
  if (events <= 0) {
    return {
      score: null, level: 'not_assessed', basis: 'endpoint_telemetry',
      scale: RISK_SCALE_MARKER, factors: [],
      recommendations: ['No captured usage — install the browser extension or endpoint agent on machines that reach this service.'],
      computedAt: new Date().toISOString(),
    };
  }

  const blocks = Number(s.blocks) || 0;
  const overrides = Number(s.overrides) || 0;
  const sensitive = Number(s.sensitive) || 0;
  const machines = Number(s.machines) || 0;

  const blockRate = blocks / events;
  const sensitiveRate = sensitive / events;

  let score = 0;
  const factors = [];
  const recommendations = [];

  // Sensitive content is the heaviest signal: it is what was actually sent, not a
  // property of the tool. Rate rather than count, so a low-volume service that leaks
  // every time is not out-ranked by a chatty one that never does.
  if (sensitiveRate > 0) {
    const pts = Math.round(45 * sensitiveRate);
    score += pts;
    factors.push({
      signal: 'Sensitive content in prompts', weight: 'high',
      description: `${sensitive} of ${events} interactions carried critical or high-severity content (${Math.round(sensitiveRate * 100)}%)`,
    });
    recommendations.push('Review what is being sent to this service and tighten the DLP policy that matched.');
  }

  // A high block rate means people keep trying to send things they should not.
  if (blockRate > 0) {
    score += Math.round(25 * blockRate);
    factors.push({
      signal: 'Enforcement blocks', weight: 'high',
      description: `${blocks} of ${events} interactions were blocked (${Math.round(blockRate * 100)}%)`,
    });
  }

  // Overrides are worse than blocks: the user was warned and proceeded anyway, so
  // each one is a deliberate bypass rather than a policy catch.
  if (overrides > 0) {
    score += Math.min(20, overrides * 10);
    factors.push({
      signal: 'Blocks overridden by users', weight: 'high',
      description: `${overrides} block(s) were bypassed after warning`,
    });
    recommendations.push('Investigate the overrides — a warned bypass is a deliberate policy violation.');
  }

  // Blast radius. One machine experimenting is a different problem from twenty.
  if (machines > 1) {
    score += Math.min(10, machines);
    factors.push({
      signal: 'Spread across endpoints', weight: 'medium',
      description: `Used on ${machines} machines`,
    });
  }

  // Sanction state. An explicitly blocked tool still seeing traffic is a containment
  // failure; an unreviewed one is shadow AI.
  if (s.status === 'blocked') {
    score += 15;
    factors.push({
      signal: 'Blocked but still in use', weight: 'high',
      description: 'This tool is blocked, yet interactions are still being captured',
    });
    recommendations.push('Enforcement is not holding — check extension coverage on the machines still reaching it.');
  } else if (s.status !== 'approved' && s.status !== 'restricted') {
    score += 10;
    factors.push({
      signal: 'Not reviewed', weight: 'medium',
      description: 'No sanction decision has been recorded for this tool',
    });
    recommendations.push('Approve, restrict or block this tool so its usage is a decision rather than a default.');
  }

  // Volume, as a small tie-breaker only. Usage is not itself a risk — a sanctioned
  // tool used heavily and cleanly should not outrank one leaking secrets twice.
  if (events >= 100) {
    score += 5;
    factors.push({ signal: 'High volume', weight: 'low', description: `${events} captured interactions` });
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    level: scoreToLevel(score),
    basis: 'endpoint_telemetry',
    scale: RISK_SCALE_MARKER,
    factors,
    recommendations,
    computedAt: new Date().toISOString(),
  };
}
