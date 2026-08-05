/**
 * Policy Action Executor
 *
 * Turns the actions attached to a policy (notify / flag / escalate / suspend /
 * archive) into REAL effects, instead of only recording the recommended action
 * string. Called from the policy-evaluation path for each newly-detected
 * violation.
 *
 * Safety model: every effect here is REVERSIBLE and needs NO external
 * credentials, so it is safe to run automatically the moment an active policy
 * matches:
 *   - suspend  → soft-suspend in agent_registry + add to the runtime blocklist
 *                (polled by the browser extension / OS monitor). Hard platform
 *                suspension via Dataverse/Graph still requires an OAuth key +
 *                env URL and stays a manual dashboard action (lifecycle.ts).
 *   - archive  → mark lifecycle_status = archived (reversible).
 *   - flag     → mark the agent flagged for review.
 *   - notify   → create an alert record.
 *   - escalate → create a high-severity alert with a 24h SLA (PRD §4.4).
 *
 * Draft policies are never evaluated (the evaluate route filters status:active),
 * so destructive-looking actions like suspend only fire once an admin has
 * explicitly activated the policy.
 */

import crypto from "node:crypto";
import type { Db } from "mongodb";
import type { PolicyDefinition, PolicyViolation } from "./policyEngine.js";

export interface ExecutedAction {
  type: string;
  status: "done" | "skipped" | "error";
  detail: string;
}

interface AlertOpts {
  violation: PolicyViolation;
  policy: PolicyDefinition;
  alert_type: string;
  severity: string;
  vendor: string;
  platform: string | null;
  escalated?: boolean;
  due_at?: Date | null;
}

export async function executePolicyActions(
  db: Db,
  policy: PolicyDefinition,
  violation: PolicyViolation,
): Promise<ExecutedAction[]> {
  const results: ExecutedAction[] = [];
  const now = new Date();
  const platform = (violation.details?.platform as string) || null;
  const vendor = platformVendor(platform);

  for (const action of policy.actions || []) {
    try {
      switch (action.type) {
        case "notify":
          await createAlert(db, {
            violation, policy, alert_type: "policy_notify",
            severity: policy.severity, vendor, platform,
          });
          results.push({ type: "notify", status: "done", detail: "alert created" });
          break;

        case "flag":
          await db.collection("agent_registry").updateOne(
            { bot_id: violation.agentId },
            {
              $set: {
                flagged: true, flagged_reason: policy.name, flagged_at: now,
                name: violation.agentName, updated_at: now,
              },
              $setOnInsert: { bot_id: violation.agentId, created_at: now },
            },
            { upsert: true },
          );
          results.push({ type: "flag", status: "done", detail: "agent flagged for review" });
          break;

        case "escalate":
          await createAlert(db, {
            violation, policy, alert_type: "policy_escalation",
            severity: "high", vendor, platform,
            escalated: true,
            // PRD §4.4: orphan / high-risk agents escalate within 24h of detection.
            due_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          });
          results.push({ type: "escalate", status: "done", detail: "escalation raised (24h SLA)" });
          break;

        case "suspend":
          await db.collection("agent_registry").updateOne(
            { bot_id: violation.agentId },
            {
              $set: {
                lifecycle_status: "suspended",
                suspended_reason: policy.name,
                suspended_by: `policy:${policy.id}`,
                suspended_at: now,
                name: violation.agentName, updated_at: now,
              },
              $setOnInsert: { bot_id: violation.agentId, created_at: now },
            },
            { upsert: true },
          );
          await db.collection("blocked_agents").updateOne(
            { agent_id: violation.agentId },
            {
              $set: {
                agent_id: violation.agentId,
                agent_name: violation.agentName,
                platform,
                reason: `Auto-suspended by policy: ${policy.name}`,
                blocked: true, blocked_at: now, unblocked_at: null,
                source: "policy",
              },
            },
            { upsert: true },
          );
          results.push({ type: "suspend", status: "done", detail: "soft-suspended + added to runtime blocklist" });
          break;

        case "archive":
          await db.collection("agent_registry").updateOne(
            { bot_id: violation.agentId },
            {
              $set: {
                lifecycle_status: "archived",
                archived_reason: policy.name, archived_at: now,
                name: violation.agentName, updated_at: now,
              },
              $setOnInsert: { bot_id: violation.agentId, created_at: now },
            },
            { upsert: true },
          );
          results.push({ type: "archive", status: "done", detail: "agent archived" });
          break;

        default:
          results.push({ type: action.type, status: "skipped", detail: "unknown action type" });
      }
    } catch (err) {
      results.push({
        type: action.type,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function createAlert(db: Db, opts: AlertOpts): Promise<void> {
  await db.collection("alerts").insertOne({
    id: crypto.randomUUID(),
    agent_id: opts.violation.agentId,
    agent_name: opts.violation.agentName,
    vendor: opts.vendor,
    platform: opts.platform,
    alert_type: opts.alert_type,
    severity: opts.severity,
    escalated: !!opts.escalated,
    due_at: opts.due_at || null,
    policy_id: opts.policy.id,
    policy_name: opts.policy.name,
    message: `${opts.policy.name}: ${opts.violation.conditionTriggered}`,
    resolved: false,
    created_at: new Date(),
    updated_at: new Date(),
  });
}

function platformVendor(platform: string | null): string {
  if (!platform) return "Unknown";
  const p = platform.toLowerCase();
  if (/copilot|power|azure|teams|sharepoint|m365|microsoft|entra|dataverse/.test(p)) return "Microsoft";
  if (/google|gemini|vertex|dialogflow|notebooklm|reasoning_engine|agent_builder/.test(p)) return "Google";
  if (/openai|assistant/.test(p)) return "OpenAI";
  if (/anthropic|claude/.test(p)) return "Anthropic";
  return "Unknown";
}
