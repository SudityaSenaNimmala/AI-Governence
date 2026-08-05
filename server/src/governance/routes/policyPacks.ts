// Pre-built compliance policy packs — deploy, tune, attest, and version-review.
//
// Deploying a pack materialises its `agent` rules as documents in the existing
// `policies` collection, tagged with pack_id / rule_key. Everything downstream —
// GET /api/policies, the evaluate endpoint, violations — keeps working unchanged,
// because a deployed pack rule IS an ordinary policy. Undeploy removes exactly
// those tagged documents and nothing else.
//
// Deployment state (which rules are on, tuned thresholds, attestation evidence)
// lives in `policy_pack_deployments`, one document per pack.

import { Router } from "express";
import crypto from "node:crypto";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { POLICY_PACKS, getPack, packSummary, validatePacks, DLP_PATTERNS } from "../services/policyPacks.js";
import type { PolicyPack, PackRule } from "../services/policyPacks.js";

const router = Router();

const DEPLOYMENTS = "policy_pack_deployments";

interface RuleState {
  enabled: boolean;
  tuned_value?: number;
  policy_id?: string | null;
}

interface Attestation {
  status: "attested" | "not_applicable";
  owner?: string;
  note?: string;
  attested_at: Date;
}

interface Deployment {
  pack_id: string;
  /** Definition version that was deployed — compared against the current one. */
  deployed_version: number;
  deployed_at: Date;
  updated_at: Date;
  rules: Record<string, RuleState>;
  attestations: Record<string, Attestation>;
}

async function getDeployment(packId: string): Promise<Deployment | null> {
  const doc = await getDb().collection(DEPLOYMENTS).findOne({ pack_id: packId });
  return (doc as unknown as Deployment) || null;
}

/**
 * Is the pack actually deployed?
 *
 * The presence of a deployment document is NOT the answer. Undeploy without
 * `purge` intentionally keeps the document so attestation evidence survives, and
 * marks it `deployed_version: 0`. Treating existence as deployment made an
 * undeployed pack render as "deployed at v0", which then looked like an available
 * upgrade and offered "Accept v1" instead of "Deploy".
 */
function isDeployed(d: Deployment | null): boolean {
  return !!d && Number(d.deployed_version) > 0;
}

/** Effective condition list for a rule, applying any tuned threshold. */
function conditionsFor(rule: PackRule, state?: RuleState) {
  const conditions = (rule.conditions || []).map((c) => ({ ...c }));
  if (rule.tunable && state?.tuned_value != null) {
    for (const c of conditions) {
      if (c.field === rule.tunable.field) c.value = state.tuned_value;
    }
  }
  return conditions;
}

/**
 * Write the policy document for one agent rule. Upserts on (pack_id, rule_key) so
 * re-deploying or accepting a new version updates in place rather than creating
 * duplicates — otherwise every deploy would multiply the rule set.
 */
async function materialiseRule(pack: PolicyPack, rule: PackRule, state: RuleState) {
  const db = getDb();
  const now = new Date();
  const existing = await db.collection("policies").findOne({ pack_id: pack.id, rule_key: rule.key });
  const id = existing?.id || uuidv4();

  await db.collection("policies").updateOne(
    { pack_id: pack.id, rule_key: rule.key },
    {
      $set: {
        id,
        name: `[${pack.framework}] ${rule.title}`,
        description: `${rule.description}\n\nFramework reference: ${rule.citation}`,
        type: rule.type || "compliance",
        severity: rule.severity,
        // A disabled rule stays as a document so its tuning survives, but the
        // engine skips anything not "active".
        status: state.enabled ? "active" : "disabled",
        template: null,
        conditions: conditionsFor(rule, state),
        actions: rule.actions || [{ type: "flag" }],
        scope: rule.scope || { type: "all" },
        pack_id: pack.id,
        pack_version: pack.version,
        rule_key: rule.key,
        citation: rule.citation,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );
  return id;
}

/**
 * GET /api/policy-packs — available packs with deployment state.
 */
router.get("/", async (_req, res) => {
  try {
    const db = getDb();
    const deployments = await db.collection(DEPLOYMENTS).find().toArray();
    const byPack = new Map(deployments.map((d: any) => [d.pack_id, d as unknown as Deployment]));

    const packs = POLICY_PACKS.map((p) => {
      const d = byPack.get(p.id) || null;
      const live = isDeployed(d);
      const summary = packSummary(p);
      const enabledCount = live
        ? p.rules.filter((r) => d!.rules?.[r.key]?.enabled !== false).length
        : 0;
      // Attestations are shown whether or not the pack is currently deployed —
      // that work was done by a person and is not undone by undeploying.
      const attestedCount = d
        ? p.rules.filter((r) => r.enforcement === "attestation" && d.attestations?.[r.key]).length
        : 0;
      return {
        id: p.id,
        framework: p.framework,
        name: p.name,
        description: p.description,
        version: p.version,
        ...summary,
        deployed: live,
        deployed_version: live ? d!.deployed_version : null,
        deployed_at: live ? d!.deployed_at : null,
        update_available: live && d!.deployed_version < p.version,
        enabled_rules: enabledCount,
        attested: attestedCount,
      };
    });

    res.json({ packs, definition_problems: validatePacks() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list policy packs";
    console.error("Policy pack list error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/policy-packs/extension-config — effective DLP pattern policy for the
 * browser extension and OS monitor.
 *
 * This is what makes a pack's `dlp` rules actually controllable rather than merely
 * documented: endpoints poll this and enable, disable or re-grade pattern classes
 * to match the deployed packs.
 *
 * Semantics, chosen so that installing this cannot silently weaken detection:
 *   - Baseline is EVERY pattern enabled at its built-in severity. An endpoint that
 *     has never heard of a pack behaves exactly as before.
 *   - A deployed pack's ENABLED dlp rule requires its patterns and can only raise
 *     severity (the strictest deployed requirement wins).
 *   - A pattern is disabled only when explicitly listed in `disabled_patterns` on
 *     the config document. Turning a pack rule off stops requiring a pattern; it
 *     does not switch off detection another framework may depend on.
 *
 * Declared before "/:id" — Express matches in order, so the parameterised route
 * would otherwise capture "extension-config" as a pack id.
 */
router.get("/extension-config", async (_req, res) => {
  try {
    const db = getDb();
    const deployments = await db.collection(DEPLOYMENTS).find().toArray();
    const override = await db.collection("extension_policy_config").findOne({ id: "default" });
    const disabled = new Set<string>((override?.disabled_patterns || []).map((p: string) => String(p)));

    const RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const required = new Map<string, { severity: string; by: string[] }>();

    for (const d of deployments as unknown as Deployment[]) {
      if (!d.deployed_version) continue;              // undeployed, retains history only
      const pack = getPack(d.pack_id);
      if (!pack) continue;
      for (const rule of pack.rules) {
        if (rule.enforcement !== "dlp") continue;
        if (d.rules?.[rule.key]?.enabled === false) continue;
        for (const p of rule.patterns || []) {
          const prev = required.get(p);
          const better = !prev || RANK[rule.severity] > RANK[prev.severity];
          required.set(p, {
            severity: better ? rule.severity : prev!.severity,
            by: [...(prev?.by || []), `${pack.framework}:${rule.key}`],
          });
        }
      }
    }

    const patterns: Record<string, { enabled: boolean; severity?: string; required_by?: string[] }> = {};
    for (const name of DLP_PATTERNS) {
      const req = required.get(name);
      patterns[name] = {
        enabled: !disabled.has(name),
        ...(req ? { severity: req.severity, required_by: req.by } : {}),
      };
    }

    // A cheap change-detector so endpoints can skip work when nothing moved.
    const version = crypto
      .createHash("sha256")
      .update(JSON.stringify(patterns))
      .digest("hex")
      .slice(0, 16);

    res.json({
      version,
      generated_at: new Date().toISOString(),
      patterns,
      disabled_patterns: [...disabled],
      required_patterns: [...required.keys()],
      deployed_packs: (deployments as unknown as Deployment[])
        .filter((d) => d.deployed_version)
        .map((d) => ({ pack_id: d.pack_id, version: d.deployed_version })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build extension config";
    console.error("Extension config error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/policy-packs/extension-config — admin override of pattern enablement.
 * Body: { disabled_patterns: string[] }
 */
router.put("/extension-config", async (req, res) => {
  try {
    const list = req.body?.disabled_patterns;
    if (!Array.isArray(list)) {
      res.status(400).json({ error: "disabled_patterns must be an array" });
      return;
    }
    const known = new Set<string>(DLP_PATTERNS);
    const unknown = list.filter((p: unknown) => typeof p !== "string" || !known.has(p as string));
    if (unknown.length) {
      // Silently accepting an unknown name would look like it worked while
      // disabling nothing.
      res.status(400).json({ error: `unknown pattern(s): ${unknown.join(", ")}` });
      return;
    }
    await getDb().collection("extension_policy_config").updateOne(
      { id: "default" },
      { $set: { id: "default", disabled_patterns: [...new Set(list)], updated_at: new Date() } },
      { upsert: true },
    );
    res.json({ success: true, disabled_patterns: [...new Set(list)] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save extension config";
    console.error("Extension config save error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/policy-packs/:id — pack detail, per-rule state, and DLP coverage.
 */
router.get("/:id", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const db = getDb();
    const deployment = await getDeployment(pack.id);

    // For dlp rules, report whether the required patterns have actually been seen.
    // A pack that claims monitoring coverage without any observed events is the
    // thing an auditor would challenge, so surface it rather than assume.
    const dlpPatterns = new Set<string>();
    for (const r of pack.rules) for (const p of r.patterns || []) dlpPatterns.add(p);
    let seenPatterns = new Set<string>();
    if (dlpPatterns.size) {
      const rows = await db.collection("dlp_events")
        .find({ pattern_matched: { $nin: [null, ""] } })
        .project({ _id: 0, pattern_matched: 1 })
        .toArray();
      for (const r of rows) {
        for (const p of String(r.pattern_matched || "").split(",")) {
          if (p) seenPatterns.add(p.trim());
        }
      }
    }

    const rules = pack.rules.map((r) => {
      const state = deployment?.rules?.[r.key];
      const base: Record<string, unknown> = {
        key: r.key,
        title: r.title,
        description: r.description,
        citation: r.citation,
        severity: r.severity,
        enforcement: r.enforcement,
        enabled: state ? state.enabled : true,
      };
      if (r.enforcement === "agent") {
        base.conditions = conditionsFor(r, state);
        base.actions = r.actions;
        base.tunable = r.tunable ?? null;
        base.tuned_value = state?.tuned_value ?? null;
        base.policy_id = state?.policy_id ?? null;
      }
      if (r.enforcement === "dlp") {
        base.patterns = r.patterns;
        base.patterns_observed = (r.patterns || []).filter((p) => seenPatterns.has(p));
        base.coverage_verified = (r.patterns || []).some((p) => seenPatterns.has(p));
      }
      if (r.enforcement === "attestation") {
        base.evidence = r.evidence;
        base.attestation = deployment?.attestations?.[r.key] ?? null;
      }
      return base;
    });

    res.json({
      id: pack.id,
      framework: pack.framework,
      name: pack.name,
      description: pack.description,
      version: pack.version,
      version_notes: pack.versionNotes,
      ...packSummary(pack),
      deployed: isDeployed(deployment),
      deployed_version: isDeployed(deployment) ? deployment!.deployed_version : null,
      deployed_at: isDeployed(deployment) ? deployment!.deployed_at : null,
      update_available: isDeployed(deployment) && deployment!.deployed_version < pack.version,
      rules,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch policy pack";
    console.error("Policy pack detail error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/policy-packs/:id/deploy — one-click deploy.
 * Body: { rules?: { [key]: boolean } } to deploy with some rules pre-disabled.
 */
router.post("/:id/deploy", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const overrides = (req.body?.rules || {}) as Record<string, boolean>;
    const db = getDb();
    const existing = await getDeployment(pack.id);
    const now = new Date();

    const ruleStates: Record<string, RuleState> = {};
    let materialised = 0;

    for (const rule of pack.rules) {
      const prior = existing?.rules?.[rule.key];
      const enabled = overrides[rule.key] ?? prior?.enabled ?? true;
      const state: RuleState = { enabled, tuned_value: prior?.tuned_value };

      if (rule.enforcement === "agent") {
        state.policy_id = await materialiseRule(pack, rule, state);
        materialised++;
      }
      ruleStates[rule.key] = state;
    }

    await db.collection(DEPLOYMENTS).updateOne(
      { pack_id: pack.id },
      {
        $set: {
          pack_id: pack.id,
          deployed_version: pack.version,
          updated_at: now,
          rules: ruleStates,
        },
        $setOnInsert: {
          deployed_at: now,
          attestations: existing?.attestations || {},
        },
      },
      { upsert: true },
    );

    const summary = packSummary(pack);
    res.json({
      success: true,
      pack_id: pack.id,
      framework: pack.framework,
      version: pack.version,
      policies_created: materialised,
      // Being explicit here matters: only the agent rules become live policies.
      // The rest are monitoring coverage and attestations the customer must own.
      monitored_rules: summary.monitored,
      attestation_rules: summary.attestations,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to deploy policy pack";
    console.error("Policy pack deploy error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/policy-packs/:id/undeploy — remove the pack's policies.
 * Attestation evidence is retained unless purge=true, since it is a record of
 * work someone did and is expensive to recreate.
 */
router.post("/:id/undeploy", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const db = getDb();
    const del = await db.collection("policies").deleteMany({ pack_id: pack.id });

    if (req.body?.purge) {
      await db.collection(DEPLOYMENTS).deleteOne({ pack_id: pack.id });
    } else {
      await db.collection(DEPLOYMENTS).updateOne(
        { pack_id: pack.id },
        { $set: { deployed_version: 0, rules: {}, updated_at: new Date() } },
      );
    }

    res.json({
      success: true,
      policies_removed: del.deletedCount,
      attestations_retained: !req.body?.purge,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to undeploy policy pack";
    console.error("Policy pack undeploy error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /api/policy-packs/:id/rules/:ruleKey — toggle a rule or tune its threshold.
 * Body: { enabled?: boolean, tuned_value?: number }
 */
router.patch("/:id/rules/:ruleKey", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const rule = pack.rules.find((r) => r.key === req.params.ruleKey);
    if (!rule) {
      res.status(404).json({ error: `Unknown rule: ${req.params.ruleKey}` });
      return;
    }
    const deployment = await getDeployment(pack.id);
    if (!isDeployed(deployment)) {
      res.status(409).json({ error: "Pack is not deployed — deploy it before tuning rules" });
      return;
    }

    const state: RuleState = { ...(deployment.rules?.[rule.key] || { enabled: true }) };
    if (typeof req.body?.enabled === "boolean") state.enabled = req.body.enabled;

    if (req.body?.tuned_value != null) {
      if (!rule.tunable) {
        res.status(400).json({ error: `Rule ${rule.key} has no tunable threshold` });
        return;
      }
      const v = Number(req.body.tuned_value);
      if (!Number.isFinite(v) || v < rule.tunable.min || v > rule.tunable.max) {
        res.status(400).json({
          error: `tuned_value must be between ${rule.tunable.min} and ${rule.tunable.max}`,
        });
        return;
      }
      state.tuned_value = v;
    }

    if (rule.enforcement === "agent") {
      state.policy_id = await materialiseRule(pack, rule, state);
    }

    await getDb().collection(DEPLOYMENTS).updateOne(
      { pack_id: pack.id },
      { $set: { [`rules.${rule.key}`]: state, updated_at: new Date() } },
    );

    res.json({ success: true, rule_key: rule.key, state });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update rule";
    console.error("Policy pack rule update error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/policy-packs/:id/attestations/:ruleKey — record or clear evidence.
 * Body: { status: "attested" | "not_applicable" | null, owner?, note? }
 */
router.put("/:id/attestations/:ruleKey", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const rule = pack.rules.find((r) => r.key === req.params.ruleKey);
    if (!rule || rule.enforcement !== "attestation") {
      res.status(400).json({ error: `Rule ${req.params.ruleKey} is not an attestation` });
      return;
    }
    const { status, owner, note } = req.body ?? {};

    if (status === null) {
      await getDb().collection(DEPLOYMENTS).updateOne(
        { pack_id: pack.id },
        { $unset: { [`attestations.${rule.key}`]: "" }, $set: { updated_at: new Date() } },
      );
      res.json({ success: true, cleared: true });
      return;
    }
    if (status !== "attested" && status !== "not_applicable") {
      res.status(400).json({ error: 'status must be "attested", "not_applicable" or null' });
      return;
    }
    if (status === "attested" && !owner) {
      // An attestation with nobody's name on it is not evidence.
      res.status(400).json({ error: "owner is required when attesting" });
      return;
    }

    const attestation: Attestation = { status, owner, note, attested_at: new Date() };
    await getDb().collection(DEPLOYMENTS).updateOne(
      { pack_id: pack.id },
      { $set: { [`attestations.${rule.key}`]: attestation, updated_at: new Date() } },
      { upsert: true },
    );
    res.json({ success: true, rule_key: rule.key, attestation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record attestation";
    console.error("Policy pack attestation error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/policy-packs/:id/diff — what changed since the deployed version.
 */
router.get("/:id/diff", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const deployment = await getDeployment(pack.id);
    if (!isDeployed(deployment)) {
      res.status(409).json({ error: "Pack is not deployed" });
      return;
    }

    // The deployed rule set is recoverable from the materialised policies, which
    // carry pack_version — enough to show which rules are new or changed without
    // storing a second copy of every definition.
    const live = await getDb().collection("policies")
      .find({ pack_id: pack.id })
      .project({ _id: 0, rule_key: 1, conditions: 1, severity: 1, pack_version: 1 })
      .toArray();
    const liveByKey = new Map(live.map((p: any) => [p.rule_key, p]));

    const added: string[] = [];
    const changed: Array<{ key: string; title: string }> = [];
    for (const rule of pack.rules) {
      if (rule.enforcement !== "agent") continue;
      const p = liveByKey.get(rule.key);
      if (!p) { added.push(rule.key); continue; }
      if (p.severity !== rule.severity) changed.push({ key: rule.key, title: rule.title });
    }
    const removed = live
      .filter((p: any) => !pack.rules.some((r) => r.key === p.rule_key))
      .map((p: any) => p.rule_key);

    res.json({
      pack_id: pack.id,
      deployed_version: deployment.deployed_version,
      current_version: pack.version,
      update_available: deployment.deployed_version < pack.version,
      version_notes: pack.versionNotes,
      added,
      changed,
      removed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to diff policy pack";
    console.error("Policy pack diff error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/policy-packs/:id/accept-version — adopt the current definition.
 * Re-materialises rules (preserving enabled/tuned state) and drops rules that no
 * longer exist in the definition.
 */
router.post("/:id/accept-version", async (req, res) => {
  try {
    const pack = getPack(req.params.id);
    if (!pack) {
      res.status(404).json({ error: `Unknown policy pack: ${req.params.id}` });
      return;
    }
    const db = getDb();
    const deployment = await getDeployment(pack.id);
    if (!isDeployed(deployment)) {
      res.status(409).json({ error: "Pack is not deployed" });
      return;
    }

    const keys = new Set(pack.rules.map((r) => r.key));
    const stale = await db.collection("policies")
      .deleteMany({ pack_id: pack.id, rule_key: { $nin: [...keys] } });

    const ruleStates: Record<string, RuleState> = {};
    for (const rule of pack.rules) {
      const prior = deployment.rules?.[rule.key];
      const state: RuleState = {
        enabled: prior?.enabled ?? true,
        tuned_value: prior?.tuned_value,
      };
      if (rule.enforcement === "agent") state.policy_id = await materialiseRule(pack, rule, state);
      ruleStates[rule.key] = state;
    }

    await db.collection(DEPLOYMENTS).updateOne(
      { pack_id: pack.id },
      { $set: { deployed_version: pack.version, rules: ruleStates, updated_at: new Date() } },
    );

    res.json({
      success: true,
      pack_id: pack.id,
      now_at_version: pack.version,
      stale_rules_removed: stale.deletedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to accept pack version";
    console.error("Policy pack accept-version error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
