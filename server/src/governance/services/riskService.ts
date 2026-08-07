import type { RiskLevel, RiskAssessment } from "../types/agent.js";
import { complianceToRisk, scoreToLevel, RISK_SCALE_MARKER } from "../../lib/risk-scale.js";

// Per PRD Section 4.2: Risk signals and weights.
//
// NOTE ON DIRECTION: the deduction logic below still counts DOWN from 100 (a
// compliance score, per the PRD). The value this module RETURNS is converted to
// the product-wide forward risk scale — 0 = safe, 100 = maximum risk — by
// complianceToRisk() at the end of assessRisk(). See server/src/lib/risk-scale.js
// for why. Do not reintroduce local score→level bands here.

const dangerousScopes = new Set([
  "Mail.ReadWrite", "Mail.ReadWrite.All", "Mail.Send",
  "Files.ReadWrite.All", "Sites.ReadWrite.All",
  "Directory.ReadWrite.All", "User.ReadWrite.All",
  "Group.ReadWrite.All", "MailboxSettings.ReadWrite",
  "Calendars.ReadWrite",
]);

const moderateScopes = new Set([
  "Mail.Read", "Mail.Read.All", "Files.Read.All",
  "Sites.Read.All", "User.Read.All", "Directory.Read.All",
  "Calendars.Read",
]);

// Per PRD Section 4.2: Sensitive keyword detection (LOW weight, heuristic only)
const SENSITIVE_KEYWORDS = [
  "password", "secret", "credential", "api key", "apikey", "token",
  "ssn", "social security", "credit card", "bank", "financial",
  "hipaa", "pii", "gdpr", "confidential", "classified",
  "salary", "payroll", "hr data", "employee record",
  "admin", "root", "sudo", "privilege", "escalat",
];

export function assessRisk(params: {
  baseRiskLevel: RiskLevel;
  permissions: string[];
  consentType?: string;
  uniqueUsers: number;
  hasVerifiedPublisher: boolean;
  isMicrosoftFirstParty: boolean;
  hasHttpConnector: boolean;
  daysSinceLastActivity?: number;
  isOrphaned: boolean;
  hasNoOwner?: boolean;
  isExpiredRenewal?: boolean;
  agentName?: string;
  agentDescription?: string;
  hasNoPolicy?: boolean;
  conversationCount?: number;
  neverReviewed?: boolean;
  agentAgeDays?: number;
  hasGuestUsers?: boolean;
  guestUserCount?: number;
}): RiskAssessment {
  const {
    baseRiskLevel,
    permissions,
    consentType,
    hasVerifiedPublisher,
    isMicrosoftFirstParty,
    hasHttpConnector,
    daysSinceLastActivity,
    isOrphaned,
    hasNoOwner,
    isExpiredRenewal,
    agentName,
    agentDescription,
    hasNoPolicy,
    conversationCount,
    neverReviewed,
    agentAgeDays,
    hasGuestUsers,
    guestUserCount,
  } = params;

  // Start at 100 (fully compliant) and deduct points
  let score = 100;
  const factors: RiskAssessment["factors"] = [];
  const recommendations: string[] = [];

  // Base risk deduction
  const baseDeductions: Record<RiskLevel, number> = {
    critical: 40,
    high: 30,
    medium: 15,
    low: 5,
  };
  score -= baseDeductions[baseRiskLevel];

  // HIGH WEIGHT: Broad connector scopes
  const dangerousPerms = permissions.filter((p) => dangerousScopes.has(p));
  if (dangerousPerms.length > 0) {
    score -= 20;
    factors.push({
      signal: "Broad connector scopes",
      weight: "high",
      description: `Has ${dangerousPerms.length} high-privilege permission(s): ${dangerousPerms.join(", ")}`,
    });
    recommendations.push("Review and reduce permissions to minimum required");
  }

  // HIGH WEIGHT: Orphaned agent (no owner)
  if (isOrphaned || hasNoOwner) {
    score -= 20;
    factors.push({
      signal: "No assigned owner",
      weight: "high",
      description: "Agent creator is disabled/deleted in Entra ID with no backup owner",
    });
    recommendations.push("Assign a new owner immediately or suspend agent");
  }

  // MEDIUM WEIGHT: Stale agent (no activity 30+ days)
  if (daysSinceLastActivity !== undefined && daysSinceLastActivity > 30) {
    score -= 12;
    factors.push({
      signal: "Stale agent",
      weight: "medium",
      description: `No activity recorded in ${daysSinceLastActivity} days`,
    });
    recommendations.push("Review if agent is still needed; consider suspension");
  }

  // MEDIUM WEIGHT: No renewal date or expired
  if (isExpiredRenewal) {
    score -= 10;
    factors.push({
      signal: "Overdue for renewal",
      weight: "medium",
      description: "Renewal date has passed without re-certification",
    });
    recommendations.push("Complete renewal review or retire agent");
  }

  // MEDIUM WEIGHT: Deployed to all-user Teams scope
  if (consentType === "AllPrincipals") {
    score -= 10;
    factors.push({
      signal: "Organization-wide consent",
      weight: "medium",
      description: "Admin-consented for all users in the organization",
    });
    recommendations.push("Consider scoping consent to specific user groups");
  }

  // MEDIUM WEIGHT: HTTP connector (external data egress)
  if (hasHttpConnector) {
    score -= 10;
    factors.push({
      signal: "HTTP connector present",
      weight: "medium",
      description: "Agent can send data to external endpoints via HTTP connector",
    });
    recommendations.push("Verify HTTP connector destinations are approved");
  }

  // HIGH WEIGHT: Stale agent with broad permissions — dangerous combination
  const isStale = daysSinceLastActivity !== undefined && daysSinceLastActivity > 30;
  if (isStale && dangerousPerms.length > 0) {
    score -= 15;
    factors.push({
      signal: "Stale agent with high permissions",
      weight: "high",
      description: `Unused for ${daysSinceLastActivity} days but retains ${dangerousPerms.length} dangerous permission(s) — prime target for abuse`,
    });
    recommendations.push("Revoke permissions or suspend — stale agents with write access are high risk");
  }

  // HIGH WEIGHT: Guest/external users accessing the agent
  if (hasGuestUsers && guestUserCount && guestUserCount > 0) {
    score -= 15;
    factors.push({
      signal: "External/guest user access",
      weight: "high",
      description: `${guestUserCount} guest/external user(s) have interacted with this agent`,
    });
    recommendations.push("Review guest access — ensure external users are authorized");
  }

  // MEDIUM WEIGHT: Agent never reviewed (no renewal date set, older than 30 days)
  if (neverReviewed && agentAgeDays !== undefined && agentAgeDays > 30) {
    score -= 8;
    factors.push({
      signal: "Never reviewed",
      weight: "medium",
      description: `Agent is ${agentAgeDays} days old and has never been through a governance review`,
    });
    recommendations.push("Schedule a governance review — unreviewed agents may pose compliance risks");
  }

  // LOW WEIGHT: Moderate permissions
  const moderatePerms = permissions.filter((p) => moderateScopes.has(p));
  if (moderatePerms.length > 2) {
    score -= 5;
    factors.push({
      signal: "Multiple read permissions",
      weight: "low",
      description: `Has ${moderatePerms.length} moderate-access permissions`,
    });
  }

  // LOW WEIGHT: Sensitive keywords in name/description (PRD Section 4.2)
  const nameDesc = `${agentName || ""} ${agentDescription || ""}`.toLowerCase();
  const foundKeywords = SENSITIVE_KEYWORDS.filter(kw => nameDesc.includes(kw));
  if (foundKeywords.length > 0) {
    score -= 5;
    factors.push({
      signal: "Sensitive keywords detected",
      weight: "low",
      description: `Agent name/description contains: ${foundKeywords.join(", ")}. Flag for review.`,
    });
    recommendations.push("Review agent purpose — name/description contains sensitive keywords");
  }

  // LOW WEIGHT: No governance policy applied (in CloudFuze)
  if (hasNoPolicy !== false) {
    factors.push({
      signal: "No governance policy applied",
      weight: "low",
      description: "Agent does not have a CloudFuze governance policy assigned",
    });
  }

  // ACTIVITY CONTEXT: Show conversation/session data as informational signal
  if (conversationCount !== undefined) {
    factors.push({
      signal: conversationCount > 0 ? "Active usage detected" : "No recorded conversations",
      weight: "info",
      description: conversationCount > 0
        ? `${conversationCount} conversation session(s) recorded in Dataverse`
        : "No conversation transcripts found — may indicate unused agent or test-only usage",
    });
  }

  // BONUSES (increase score)
  if (hasVerifiedPublisher) {
    score += 8;
  }

  // Everything above computes a COMPLIANCE score: it starts at 100 and deducts a
  // penalty per failed control. That is a fine way to express "how many controls
  // are satisfied", but it is the opposite of a risk score, and it was being
  // published in a field called `risk_score` alongside forward-scaled rows from
  // the endpoint scanner. Result on screen: "87 — Low" in green directly above
  // "42 — High" in red, from the same column of the same table.
  //
  // Convert once, here at the boundary, instead of rewriting the deduction rules —
  // the rules and their weights keep their existing reviewed behaviour, and every
  // consumer downstream now sees one direction: higher = riskier.
  const complianceScore = Math.max(0, Math.min(100, score));
  const riskScore = complianceToRisk(complianceScore) as number;
  const level = scoreToLevel(riskScore) as RiskLevel;

  if (recommendations.length === 0) {
    recommendations.push("Continue monitoring — agent is within acceptable risk parameters");
  }

  return {
    score: riskScore,
    level,
    // Stamps the scale so a reader can tell a forward score from a legacy
    // compliance score. Without this marker, normalizeStoredRisk() assumes the
    // document is legacy and converts it — which is the safe default, since every
    // risk object written before this change genuinely was one.
    scale: RISK_SCALE_MARKER,
    factors,
    recommendations,
    computedAt: new Date().toISOString(),
  } as RiskAssessment;
}
