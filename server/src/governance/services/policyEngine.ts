/**
 * Policy Engine — Per PRD Section 4.4
 * Evaluates governance policies against discovered agents.
 * Pre-built templates: 90-Day Renewal, Orphan Suspension, Stale Archive, Sensitive Connector Alert
 * Custom policies: IF [condition] THEN [action]
 */

import type { DiscoveredAgent, AgentActivity, RiskAssessment } from "../types/agent.js";

export interface PolicyDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
  severity: string;
  status: string;
  template?: string;
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  scope: PolicyScope;
}

export interface PolicyCondition {
  field: string;
  operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "is_empty" | "is_true" | "is_false";
  value: string | number | boolean;
}

export interface PolicyAction {
  type: "notify" | "suspend" | "escalate" | "flag" | "archive";
  target?: string;
}

export interface PolicyScope {
  type: "all" | "platform" | "connector_type" | "risk_level" | "specific";
  values?: string[];
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  agentId: string;
  agentName: string;
  conditionTriggered: string;
  actionRecommended: string;
  severity: string;
  details: Record<string, unknown>;
}

export const POLICY_TEMPLATES: Omit<PolicyDefinition, "id">[] = [
  {
    name: "Stale Agent Detection",
    description: "Flag agents with no recorded activity in 30+ days. Stale agents with live permissions are a security risk.",
    type: "stale",
    severity: "medium",
    status: "active",
    template: "stale_detection",
    conditions: [
      { field: "days_since_last_activity", operator: "greater_than", value: 30 },
    ],
    actions: [{ type: "flag" }, { type: "notify" }],
    scope: { type: "all" },
  },
  {
    name: "Orphan Agent Escalation",
    description: "Escalate agents whose owner is disabled or deleted in Entra ID. Per PRD: escalate within 24 hours of detection.",
    type: "orphan",
    severity: "high",
    status: "active",
    template: "orphan_escalation",
    conditions: [
      { field: "is_orphaned", operator: "is_true", value: true },
    ],
    actions: [{ type: "escalate" }, { type: "flag" }],
    scope: { type: "all" },
  },
  {
    name: "90-Day Renewal Policy",
    description: "Agents must be re-certified by their owner every 90 days. Expired agents are flagged for review.",
    type: "lifecycle",
    severity: "medium",
    status: "active",
    template: "90_day_renewal",
    conditions: [
      { field: "days_since_last_activity", operator: "greater_than", value: 90 },
    ],
    actions: [{ type: "notify" }, { type: "flag" }],
    scope: { type: "all" },
  },
  {
    name: "Sensitive Connector Alert",
    description: "Alert when an agent uses HTTP connectors (external data egress) or SQL connectors (database access).",
    type: "connector",
    severity: "high",
    status: "active",
    template: "sensitive_connector",
    conditions: [
      { field: "has_http_connector", operator: "is_true", value: true },
    ],
    actions: [{ type: "notify" }, { type: "escalate" }],
    scope: { type: "all" },
  },
  {
    name: "High-Risk Auto Suspension",
    description: "Automatically suspend agents with a risk score below 25 (critical risk). Requires manual review to reactivate.",
    type: "risk",
    severity: "critical",
    status: "draft",
    template: "high_risk_suspension",
    conditions: [
      { field: "risk_score", operator: "less_than", value: 25 },
    ],
    actions: [{ type: "suspend" }, { type: "notify" }],
    scope: { type: "all" },
  },
  {
    name: "Broad Permissions Review",
    description: "Flag agents with admin-consented (AllPrincipals) permissions for quarterly security review.",
    type: "risk",
    severity: "high",
    status: "active",
    template: "broad_permissions",
    conditions: [
      { field: "consent_type", operator: "equals", value: "AllPrincipals" },
    ],
    actions: [{ type: "flag" }, { type: "notify" }],
    scope: { type: "all" },
  },
];

/**
 * Evaluate a single policy against a single agent.
 * Returns a violation if the agent matches ALL conditions and is in scope.
 */
export function evaluatePolicy(policy: PolicyDefinition, agent: DiscoveredAgent): PolicyViolation | null {
  if (policy.status !== "active") return null;

  // Defensive defaults — agents from partial/external payloads may omit nested objects.
  if (!agent.activity) agent.activity = { totalInvocations: 0, uniqueUsers: 0 } as AgentActivity;
  if (!agent.risk) agent.risk = { score: 100, level: "low" } as RiskAssessment;
  if (!agent.connectors) agent.connectors = [];
  if (!agent.permissions) agent.permissions = [];

  if (!isAgentInScope(policy.scope, agent)) return null;

  const triggeredConditions: string[] = [];

  for (const condition of policy.conditions) {
    const fieldValue = resolveField(condition.field, agent);
    const matches = evaluateCondition(fieldValue, condition.operator, condition.value);

    if (!matches) return null;
    triggeredConditions.push(`${condition.field} ${condition.operator} ${condition.value} (actual: ${fieldValue})`);
  }

  const actionTypes = policy.actions.map((a) => a.type).join(", ");

  return {
    policyId: policy.id,
    policyName: policy.name,
    agentId: agent.id,
    agentName: agent.name,
    conditionTriggered: triggeredConditions.join(" AND "),
    actionRecommended: actionTypes,
    severity: policy.severity,
    details: {
      riskScore: agent.risk.score,
      riskLevel: agent.risk.level,
      platform: agent.platform,
      isOrphaned: agent.isOrphaned,
      lifecycleStatus: agent.lifecycleStatus,
      lastActive: agent.activity.lastActiveTimestamp || null,
    },
  };
}

/**
 * Evaluate all active policies against all agents.
 */
export function evaluateAllPolicies(policies: PolicyDefinition[], agents: DiscoveredAgent[]): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    for (const agent of agents) {
      const violation = evaluatePolicy(policy, agent);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  return violations;
}

function isAgentInScope(scope: PolicyScope, agent: DiscoveredAgent): boolean {
  if (scope.type === "all") return true;

  if (scope.type === "platform" && scope.values) {
    return scope.values.includes(agent.platform);
  }

  if (scope.type === "connector_type" && scope.values) {
    return agent.connectors.some((c) => scope.values!.includes(c.type));
  }

  if (scope.type === "risk_level" && scope.values) {
    return scope.values.includes(agent.risk.level);
  }

  if (scope.type === "specific" && scope.values) {
    return scope.values.includes(agent.id);
  }

  return true;
}

function resolveField(field: string, agent: DiscoveredAgent): unknown {
  switch (field) {
    case "risk_score":
      return agent.risk.score;
    case "risk_level":
      return agent.risk.level;
    case "is_orphaned":
      return agent.isOrphaned;
    case "has_owner":
      return !!agent.owner;
    case "lifecycle_status":
      return agent.lifecycleStatus;
    case "platform":
      return agent.platform;
    case "consent_type":
      return agent.consentType;
    case "days_since_last_activity": {
      if (!agent.activity.lastActiveTimestamp) return 999;
      const diff = Date.now() - new Date(agent.activity.lastActiveTimestamp).getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24));
    }
    case "total_invocations":
      return agent.activity.totalInvocations;
    case "unique_users":
      return agent.activity.uniqueUsers;
    case "connector_count":
      return agent.connectors.length;
    case "permission_count":
      return agent.permissions.length;
    case "has_http_connector":
      return agent.connectors.some(
        (c) => c.type.toLowerCase().includes("http") || c.type.toLowerCase().includes("external")
      );
    case "has_dangerous_permissions":
      return agent.permissions.some(
        (p) => p.includes("ReadWrite") || p.includes(".All")
      );
    case "published_status":
      return agent.publishedStatus;
    default:
      return undefined;
  }
}

function evaluateCondition(fieldValue: unknown, operator: PolicyCondition["operator"], targetValue: unknown): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === targetValue;
    case "not_equals":
      return fieldValue !== targetValue;
    case "greater_than":
      return typeof fieldValue === "number" && typeof targetValue === "number" && fieldValue > targetValue;
    case "less_than":
      return typeof fieldValue === "number" && typeof targetValue === "number" && fieldValue < targetValue;
    case "contains":
      return typeof fieldValue === "string" && typeof targetValue === "string" && fieldValue.includes(targetValue);
    case "is_empty":
      return fieldValue === undefined || fieldValue === null || fieldValue === "";
    case "is_true":
      return fieldValue === true;
    case "is_false":
      return fieldValue === false || fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}
