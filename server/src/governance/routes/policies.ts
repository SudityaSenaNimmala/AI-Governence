import { Router } from "express";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { POLICY_TEMPLATES, evaluateAllPolicies } from "../services/policyEngine.js";
import type { PolicyDefinition, PolicyViolation } from "../services/policyEngine.js";
import type { DiscoveredAgent } from "../types/agent.js";
import { emitWebhook } from "../../routes/webhooks.js";
import { siemForward } from "../../lib/siem-forward.js";
import { executePolicyActions } from "../services/actionExecutor.js";
import type { ExecutedAction } from "../services/actionExecutor.js";

const router = Router();

/**
 * GET /api/policies — List all policies
 */
router.get("/", async (_req, res) => {
  try {
    const db = getDb();
    const rows = await db.collection("policies").find().sort({ created_at: -1 }).toArray();
    res.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch policies";
    console.error("Policy list error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/policies — Create a new policy
 */
router.post("/", async (req, res) => {
  try {
    const { name, description, type, severity, status, template, conditions, actions, scope } = req.body;

    if (!name || !type) {
      res.status(400).json({ error: "name and type are required" });
      return;
    }

    const id = uuidv4();
    const now = new Date();
    const doc = {
      id,
      name,
      description: description || "",
      type,
      severity: severity || "medium",
      status: status || "active",
      template: template || null,
      conditions: conditions || [],
      actions: actions || [],
      scope: scope || { type: "all" },
      created_at: now,
      updated_at: now,
    };
    await getDb().collection("policies").insertOne(doc);

    res.json({ id, name, type, status: status || "active" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create policy";
    console.error("Policy create error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/policies/:id — Update a policy
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, type, severity, status, conditions, actions, scope } = req.body;

    const updateFields: Record<string, any> = { updated_at: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (description !== undefined) updateFields.description = description;
    if (type !== undefined) updateFields.type = type;
    if (severity !== undefined) updateFields.severity = severity;
    if (status !== undefined) updateFields.status = status;
    if (conditions !== undefined) updateFields.conditions = conditions;
    if (actions !== undefined) updateFields.actions = actions;
    if (scope !== undefined) updateFields.scope = scope;

    await getDb().collection("policies").updateOne({ id }, { $set: updateFields });

    res.json({ success: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update policy";
    console.error("Policy update error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /api/policies/:id — Delete a policy
 */
router.delete("/:id", async (req, res) => {
  try {
    const db = getDb();
    const existing = await db.collection("policies").findOne({ id: req.params.id });
    if (!existing) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }

    // A pack-derived rule cannot be deleted from here.
    //
    // Deleting it would remove the enforcement rule while the pack continues to
    // report "deployed v1, N rules" — the pack claims coverage it no longer has,
    // which is precisely the kind of silent gap a compliance tool exists to
    // prevent. Worse, it is invisible: nothing on the Policy Packs screen would
    // show that one of its controls had been removed underneath it.
    //
    // The two legitimate ways to stop a pack rule both keep pack state truthful:
    //   disable one rule  PATCH /api/policy-packs/:id/rules/:ruleKey {enabled:false}
    //   remove them all   POST  /api/policy-packs/:id/undeploy
    if (existing.pack_id) {
      res.status(409).json({
        error: `"${existing.name}" comes from the ${existing.pack_id} policy pack and cannot be deleted here.`,
        reason: "pack_managed",
        pack_id: existing.pack_id,
        rule_key: existing.rule_key ?? null,
        remedy: "Disable this rule from its Policy Pack, or undeploy the pack to remove all of its rules.",
      });
      return;
    }

    await db.collection("policies").deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete policy";
    console.error("Policy delete error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/policies/seed-templates — Seed default policy templates
 */
router.post("/seed-templates", async (_req, res) => {
  try {
    const db = getDb();
    const existing = await db.collection("policies")
      .find({ template: { $ne: null } }, { projection: { template: 1 } })
      .toArray();
    const existingTemplates = new Set(existing.map((r: any) => r.template));

    let created = 0;
    for (const tpl of POLICY_TEMPLATES) {
      if (tpl.template && existingTemplates.has(tpl.template)) continue;

      const id = uuidv4();
      const now = new Date();
      await db.collection("policies").insertOne({
        id,
        name: tpl.name,
        description: tpl.description,
        type: tpl.type,
        severity: tpl.severity,
        status: tpl.status,
        template: tpl.template,
        conditions: tpl.conditions,
        actions: tpl.actions,
        scope: tpl.scope,
        created_at: now,
        updated_at: now,
      });
      created++;
    }

    res.json({ success: true, created, total: POLICY_TEMPLATES.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to seed templates";
    console.error("Policy seed error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/policies/evaluate — Evaluate all active policies against provided agents
 * Body: { agents: DiscoveredAgent[] }
 */
/**
 * POST /api/policies/simulate — DRY RUN. Evaluate policies and change nothing.
 *
 * Body: { policy_id?: string, limit?: number }
 *   policy_id  simulate just this one (any status, so a DISABLED policy can be
 *              tested before you turn it on — the main reason this exists)
 *   omitted    simulate every active policy
 *
 * Why this is a separate route and not a flag on /evaluate: /evaluate is not a
 * read. It upserts policy_violations, calls executePolicyActions() — which can
 * flag, escalate, archive and SUSPEND an agent — emits webhooks and forwards to
 * SIEM. Wiring a "Simulate" button to it would suspend production agents the
 * moment someone clicked to preview a rule. This route shares the same evaluation
 * engine and touches nothing else: no writes, no actions, no webhooks, no SIEM.
 *
 * Agents are read server-side from discovered_agents rather than taken from the
 * request body, so the answer reflects the real fleet and cannot be shaped by the
 * caller — /evaluate trusts a client-supplied array, which is fine for a scan the
 * client just ran but wrong for a preview someone will make a decision on.
 */
router.post("/simulate", async (req, res) => {
  try {
    const db = getDb();
    const policyId = req.body?.policy_id ? String(req.body.policy_id) : null;
    const limit = Math.min(Math.max(Number(req.body?.limit) || 100, 1), 500);

    // A specific policy is simulated whatever its status; without one, only the
    // rules that are actually live.
    const filter = policyId ? { id: policyId } : { status: "active" };
    const policyRows = await db.collection("policies").find(filter).sort({ created_at: 1 }).toArray();
    if (policyId && policyRows.length === 0) {
      res.status(404).json({ error: `Unknown policy: ${policyId}` });
      return;
    }

    const policies: PolicyDefinition[] = policyRows.map((r: any) => ({
      id: r.id, name: r.name, description: r.description, type: r.type,
      severity: r.severity, status: r.status, template: r.template,
      conditions: r.conditions, actions: r.actions, scope: r.scope,
    }));

    const agents = await db.collection("discovered_agents")
      .find({}).project({ _id: 0 }).toArray() as unknown as DiscoveredAgent[];

    const violations = evaluateAllPolicies(policies, agents);

    // Split new from already-known so the number reads honestly: "would flag 12"
    // is alarming if 9 of them are already open violations you have seen before.
    const openKeys = new Set(
      (await db.collection("policy_violations")
        .find({ resolved: { $ne: true } })
        .project({ _id: 0, dedupe_key: 1 })
        .toArray()).map((v: any) => v.dedupe_key),
    );

    const perPolicy = policies.map((p) => {
      const mine = violations.filter((v) => v.policyId === p.id);
      const fresh = mine.filter((v) => !openKeys.has(`${v.policyId}:${v.agentId}`));
      return {
        policy_id: p.id,
        policy_name: p.name,
        severity: p.severity,
        status: p.status,
        actions: (p.actions || []).map((a: any) => a.type || a),
        would_flag: mine.length,
        newly_flagged: fresh.length,
        already_open: mine.length - fresh.length,
        matches: mine.slice(0, limit).map((v) => ({
          agent_id: v.agentId,
          agent_name: v.agentName,
          condition_triggered: v.conditionTriggered,
          action_recommended: v.actionRecommended,
          details: v.details,
          already_open: openKeys.has(`${v.policyId}:${v.agentId}`),
        })),
      };
    });

    res.json({
      applied: false,              // contract: this endpoint never changes state
      agents_evaluated: agents.length,
      policies_evaluated: policies.length,
      total_would_flag: violations.length,
      policies: perPolicy,
      caveats: [
        "Simulation only — no violations were recorded and no policy actions ran.",
        `Evaluated against all ${agents.length} discovered agents as they are right now.`,
        "Agents discovered after this run are not included until you simulate again.",
      ],
    });
  } catch (err: any) {
    console.error("[policies/simulate]", err?.message || err);
    res.status(500).json({ error: "simulation failed" });
  }
});

router.post("/evaluate", async (req, res) => {
  try {
    const { agents } = req.body as { agents: DiscoveredAgent[] };

    if (!agents || !Array.isArray(agents)) {
      res.status(400).json({ error: "agents array is required in request body" });
      return;
    }

    const db = getDb();
    const policyRows = await db.collection("policies")
      .find({ status: "active" })
      .sort({ created_at: 1 })
      .toArray();

    const policies: PolicyDefinition[] = policyRows.map((r: any) => ({
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      type: r.type as string,
      severity: r.severity as string,
      status: r.status as string,
      template: r.template as string | undefined,
      conditions: r.conditions as PolicyDefinition["conditions"],
      actions: r.actions as PolicyDefinition["actions"],
      scope: r.scope as PolicyDefinition["scope"],
    }));

    const violations = evaluateAllPolicies(policies, agents);
    const policyById = new Map(policies.map((p) => [p.id, p]));

    for (const v of violations.slice(0, 500)) {
      try {
        // Dedupe on (policy, agent) while a violation is still open. The old
        // code keyed the upsert on a fresh uuid every run, so it never matched
        // and re-inserted a duplicate on every evaluate — and never fired the
        // side effects below. A stable dedupe_key fixes both.
        const dedupeKey = `${v.policyId}:${v.agentId}`;
        const now = new Date();
        const result = await db.collection("policy_violations").updateOne(
          { dedupe_key: dedupeKey, resolved: { $ne: true } },
          {
            $setOnInsert: {
              id: uuidv4(),
              dedupe_key: dedupeKey,
              policy_id: v.policyId,
              agent_id: v.agentId,
              agent_name: v.agentName,
              condition_triggered: v.conditionTriggered,
              action_taken: v.actionRecommended,
              details: v.details,
              resolved: false,
              created_at: now,
            },
            $set: { last_seen_at: now, condition_triggered: v.conditionTriggered },
          },
          { upsert: true }
        );

        // Fire side effects only for a NEWLY-recorded violation so re-running
        // evaluate doesn't spam webhook subscribers or re-trigger enforcement
        // actions for an already-open violation.
        if (result.upsertedCount === 1) {
          // Execute the policy's actions for real (notify/flag/escalate/
          // suspend/archive) and record what actually happened.
          let executed: ExecutedAction[] = [];
          const policy = policyById.get(v.policyId);
          if (policy) {
            executed = await executePolicyActions(db, policy, v);
            const done = executed.filter((e) => e.status === "done").map((e) => e.type);
            await db.collection("policy_violations").updateOne(
              { dedupe_key: dedupeKey, resolved: { $ne: true } },
              { $set: { actions_executed: executed, action_taken: done.join(", ") || v.actionRecommended } },
            );
          }

          await emitWebhook(db, "policy.violation", {
            policy_id: v.policyId,
            policy_name: v.policyName,
            agent_id: v.agentId,
            agent_name: v.agentName,
            severity: v.severity,
            condition_triggered: v.conditionTriggered,
            action_recommended: v.actionRecommended,
            actions_executed: executed,
            details: v.details,
          });

          // Real-time push to a configured SIEM syslog collector (no-op if unset).
          siemForward("violation", {
            policy_id: v.policyId,
            policy_name: v.policyName,
            agent_id: v.agentId,
            agent_name: v.agentName,
            severity: v.severity,
            condition_triggered: v.conditionTriggered,
            action_taken: v.actionRecommended,
            actions_executed: executed,
            details: v.details,
            created_at: now,
          });
        }
      } catch { /* ignore individual violation failures */ }
    }

    const summary = {
      totalPolicies: policies.length,
      totalAgents: agents.length,
      totalViolations: violations.length,
      bySeverity: {
        critical: violations.filter((v) => v.severity === "critical").length,
        high: violations.filter((v) => v.severity === "high").length,
        medium: violations.filter((v) => v.severity === "medium").length,
        low: violations.filter((v) => v.severity === "low").length,
      },
      violations,
    };

    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Policy evaluation failed";
    console.error("Policy evaluate error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/policies/violations — List recent violations
 */
router.get("/violations", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const db = getDb();

    // In MongoDB we use aggregation to join policy_violations with policies
    const rows = await db.collection("policy_violations")
      .aggregate([
        {
          $lookup: {
            from: "policies",
            localField: "policy_id",
            foreignField: "id",
            as: "policy",
          },
        },
        { $unwind: { path: "$policy", preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            policy_name: "$policy.name",
            policy_severity: "$policy.severity",
            policy_type: "$policy.type",
          },
        },
        { $project: { policy: 0 } },
        { $sort: { created_at: -1 } },
        { $limit: limit },
      ])
      .toArray();

    res.json(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch violations";
    console.error("Violations list error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
