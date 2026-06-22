import { Router } from "express";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { POLICY_TEMPLATES, evaluateAllPolicies } from "../services/policyEngine.js";
import type { PolicyDefinition, PolicyViolation } from "../services/policyEngine.js";
import type { DiscoveredAgent } from "../types/agent.js";

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
    await getDb().collection("policies").deleteOne({ id: req.params.id });
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
    const existingTemplates = new Set(existing.map((r) => r.template));

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

    for (const v of violations.slice(0, 500)) {
      try {
        // Use upsert to avoid duplicates — use a compound key check
        await db.collection("policy_violations").updateOne(
          { id: uuidv4() },
          {
            $setOnInsert: {
              id: uuidv4(),
              policy_id: v.policyId,
              agent_id: v.agentId,
              agent_name: v.agentName,
              condition_triggered: v.conditionTriggered,
              action_taken: v.actionRecommended,
              details: v.details,
              created_at: new Date(),
            },
          },
          { upsert: true }
        );
      } catch { /* ignore duplicate insert errors */ }
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
