// Policy Impact Simulator — "what if" mode (SELECTED_FEATURES_AUG2026 #25).
//
// Runs a PROPOSED blocking policy against real historical events and reports what
// would have happened, so a compliance team can see the workflow cost before
// deploying. Nothing is written, nothing is enforced: this endpoint is read-only
// by design, and a simulation must never be mistakable for a deployment.
//
// What it simulates: a DLP-style rule that blocks a prompt when its detected
// patterns / severity / target service match. That is the shape the feature spec
// describes ("would have blocked N events, M users affected, by AI tool"), and it
// maps onto data we actually hold in dlp_events.
//
// It deliberately does NOT simulate the agent-policy engine. Those rules evaluate
// discovered agents rather than prompt events, so "events blocked" and "users
// impacted" have no meaning there — reporting a number would be inventing one.

import { Router } from "express";
import { getDb } from "../db.js";
import { getPack } from "../services/policyPacks.js";
import { maskSensitive } from "../../lib/mask-sensitive.js";

const router = Router();

// Prompt-ish events are the only ones a send-blocking policy could have stopped.
// Enforcement records (already blocked/tokenized) and telemetry rows are excluded,
// otherwise the simulation would count its own past enforcement as new impact.
const CANDIDATE_KINDS = ["prompt_submit", "prompt_paste", "prompt_typed", "file_upload"];

const SEVERITY_RANK: Record<string, number> = { low: 1, moderate: 2, medium: 2, high: 3, critical: 4 };

// Data categories, grouped the way a compliance officer thinks about them rather
// than the way patterns are named.
const CATEGORY_OF: Record<string, string> = {
  "us-ssn": "Personal data", "credit-card": "Financial data", iban: "Financial data",
  "us-phone": "Personal data",
  "openai-api-key": "Credentials", "anthropic-api-key": "Credentials",
  "google-api-key": "Credentials", "huggingface-token": "Credentials",
  "github-pat": "Credentials", "gitlab-pat": "Credentials",
  "aws-access-key": "Cloud keys", "gcp-service-key": "Cloud keys",
  "slack-token": "Credentials", jwt: "Credentials",
  "cloudfuze-customer-id": "Internal identifiers", "internal-jira-key": "Internal identifiers",
};
function categoryFor(pattern: string): string {
  if (CATEGORY_OF[pattern]) return CATEGORY_OF[pattern];
  if (pattern.startsWith("injection-") || pattern.startsWith("jailbreak-")) return "Prompt attacks";
  if (pattern.startsWith("toxicity-")) return "Harmful content";
  if (pattern.startsWith("bias-")) return "Bias and fairness";
  return "Other";
}

/**
 * Mask values that look sensitive before returning an excerpt.
 *
 * The spec asks to show the prompts that would have been blocked, which is genuinely
 * useful context. But re-displaying a live SSN or API key inside a compliance screen
 * would leak the very thing the policy exists to stop, to a wider audience than the
 * original prompt had. So excerpts keep the shape of the request and mask anything
 * that looks like a secret or an identifier.
 */
// Delegates to the shared masker in lib/mask-sensitive.js.
//
// The list that used to live here missed several classes the DETECTOR flags —
// so the event was in scope for a simulation and its excerpt then printed the raw
// value on the compliance screen. Confirmed gaps: a card written
// "4111 - 1111 - 1111 - 1111" (the detector allows any run of separators, this
// allowed exactly one), GCP/RSA private-key blocks, undashed SSNs, AWS secret
// keys, Azure connection strings and non-JWT bearer tokens.
//
// Keeping two maskers in two files is how that drift happened, so there is now
// one, and prompts.ts uses it too.
function maskExcerpt(text: string, limit = 220): string {
  return maskSensitive(text, limit);
}

interface SimRule {
  patterns?: string[];
  severities?: string[];
  services?: string[];          // only these services are in scope (empty = all)
  exclude_services?: string[];  // e.g. allow an internal Azure OpenAI deployment
}

/** Would this proposed rule have blocked the event? */
function wouldBlock(rule: SimRule, ev: any, patterns: string[]): boolean {
  const svc = String(ev.ai_service || "");
  if (rule.services?.length && !rule.services.includes(svc)) return false;
  if (rule.exclude_services?.length && rule.exclude_services.includes(svc)) return false;

  const patternHit = rule.patterns?.length
    ? patterns.some((p) => rule.patterns!.includes(p))
    : false;

  const sevHit = rule.severities?.length
    ? rule.severities.includes(String(ev.secret_class || ""))
    : false;

  // With neither criterion specified the rule would match everything in scope,
  // which is never what someone means — treat it as "no match" rather than
  // reporting a terrifying and meaningless block count.
  if (!rule.patterns?.length && !rule.severities?.length) return false;

  return patternHit || sevHit;
}

/**
 * POST /api/policy-simulator/simulate
 *
 * Body: {
 *   days?: number,                  // default 30
 *   rule?: { patterns, severities, services, exclude_services },
 *   pack_id?: string,               // simulate a pack's dlp rules instead
 *   include_samples?: boolean       // masked excerpts, off by default
 * }
 */
router.post("/simulate", async (req, res) => {
  try {
    const db = getDb();
    const days = Number(req.body?.days) > 0 ? Math.min(Number(req.body.days), 365) : 30;
    const since = new Date(Date.now() - days * 86400_000);
    const sinceIso = since.toISOString();

    // A pack id is a shortcut for "every pattern this framework requires".
    let rule: SimRule = req.body?.rule || {};
    let ruleLabel = "Custom rule";
    if (req.body?.pack_id) {
      const pack = getPack(String(req.body.pack_id));
      if (!pack) {
        res.status(404).json({ error: `Unknown policy pack: ${req.body.pack_id}` });
        return;
      }
      const patterns = new Set<string>();
      for (const r of pack.rules) for (const p of r.patterns || []) patterns.add(p);
      rule = { ...rule, patterns: [...patterns] };
      ruleLabel = `${pack.framework} detection patterns`;
    }

    if (!rule.patterns?.length && !rule.severities?.length) {
      res.status(400).json({
        error: "Specify at least one pattern or severity to simulate, or pass a pack_id",
      });
      return;
    }

    const events = await db.collection("dlp_events")
      .find({ occurred_at: { $gte: sinceIso }, event_kind: { $in: CANDIDATE_KINDS } })
      .project({
        _id: 0, id: 1, ai_service: 1, event_kind: 1, secret_class: 1,
        pattern_matched: 1, machine_id: 1, user: 1, occurred_at: 1, content_length: 1,
      })
      .toArray();

    // Resolve a person for each event. Many rows carry no user field, so fall back
    // to the enrolled machine's identity — otherwise "users impacted" would count
    // opaque machine ids and badly understate overlap.
    const machines = await db.collection("machines")
      .find({}).project({ _id: 0, id: 1, hostname: 1, user: 1 }).toArray();
    const machineMap = new Map(machines.map((m: any) => [m.id, m]));
    // A value like "Mozilla-browser-extension" is the extension naming itself, not a
    // person. Treated as generic wherever it appears — on the event or the machine —
    // so impact counts describe people, matching how Claude Usage attributes.
    const GENERIC = /-browser-extension$/i;
    const real = (v: unknown) => {
      const s = String(v || "").trim();
      return s && !GENERIC.test(s) ? s : null;
    };
    const actorFor = (ev: any) => {
      const m = machineMap.get(ev.machine_id) || {};
      return real(ev.user)
        || real(m.user)
        || String(ev.user || m.user || m.hostname || ev.machine_id || "unknown");
    };
    // Whether that label is a confirmed person or just an install name. A
    // compliance screen should not present "Mozilla-browser-extension" as a
    // verified employee who needs consulting about a policy change.
    const attributedFor = (ev: any) => {
      const m = machineMap.get(ev.machine_id) || {};
      return !!(real(ev.user) || real(m.user));
    };
    const attributed = new Map<string, boolean>();

    const byService = new Map<string, number>();
    const byCategory = new Map<string, number>();
    const byPattern = new Map<string, number>();
    const byUser = new Map<string, number>();
    const blockedIds: string[] = [];
    let wouldBlockTotal = 0;
    let inScopeTotal = 0;

    for (const ev of events) {
      const patterns = String(ev.pattern_matched || "").split(",").map((p) => p.trim()).filter(Boolean);
      const svc = String(ev.ai_service || "unknown");
      const inScope = !(rule.services?.length && !rule.services.includes(svc))
        && !(rule.exclude_services?.length && rule.exclude_services.includes(svc));
      if (inScope) inScopeTotal++;

      if (!wouldBlock(rule, ev, patterns)) continue;

      wouldBlockTotal++;
      byService.set(svc, (byService.get(svc) || 0) + 1);
      const actor = actorFor(ev);
      byUser.set(actor, (byUser.get(actor) || 0) + 1);
      if (!attributed.has(actor)) attributed.set(actor, attributedFor(ev));
      for (const p of patterns) {
        if (rule.patterns?.length && !rule.patterns.includes(p)) continue;
        byPattern.set(p, (byPattern.get(p) || 0) + 1);
        const cat = categoryFor(p);
        byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
      }
      // If the rule matched purely on severity, there may be no in-scope pattern.
      if (!patterns.length && ev.secret_class) {
        const cat = `Severity: ${ev.secret_class}`;
        byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
      }
      if (blockedIds.length < 50) blockedIds.push(ev.id);
    }

    // Baseline: what enforcement actually happened over the same window, so the
    // answer is "this is the change", not just an absolute number.
    const baselineBlocks = await db.collection("dlp_events").countDocuments({
      occurred_at: { $gte: sinceIso },
      event_kind: { $in: ["enforcement_block", "enforcement_redact", "enforcement_tokenize"] },
    });

    const uniqueUsers = byUser.size;
    const perUserPerDay = uniqueUsers > 0 ? wouldBlockTotal / uniqueUsers / days : 0;
    // Thresholds are a judgement call, stated openly rather than hidden in a score.
    const impact = perUserPerDay >= 3 ? "high" : perUserPerDay >= 1 ? "medium" : "low";

    const sortDesc = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]);

    let samples: Array<Record<string, unknown>> = [];
    if (req.body?.include_samples && blockedIds.length) {
      const contents = await db.collection("dlp_content")
        .find({ event_id: { $in: blockedIds.slice(0, 10) }, content_text: { $nin: [null, ""] } })
        .project({ _id: 0, event_id: 1, content_text: 1 })
        .toArray();
      const byId = new Map(contents.map((c: any) => [c.event_id, c.content_text]));
      samples = blockedIds.slice(0, 10).map((id) => {
        const ev = events.find((e: any) => e.id === id);
        const text = byId.get(id);
        return {
          occurred_at: ev?.occurred_at ?? null,
          ai_service: ev?.ai_service ?? null,
          patterns: String(ev?.pattern_matched || "").split(",").filter(Boolean),
          excerpt: text ? maskExcerpt(text) : null,
          excerpt_available: !!text,
        };
      });
    }

    res.json({
      simulated_at: new Date().toISOString(),
      window_days: days,
      rule_label: ruleLabel,
      rule,
      // Read-only guarantee, stated in the payload so no caller can mistake this
      // for having changed anything.
      applied: false,

      events_examined: events.length,
      events_in_scope: inScopeTotal,
      would_block_total: wouldBlockTotal,
      unique_users_impacted: uniqueUsers,

      by_service: sortDesc(byService).map(([service, blocks]) => ({ service, blocks })),
      by_category: sortDesc(byCategory).map(([category, blocks]) => ({ category, blocks })),
      by_pattern: sortDesc(byPattern).map(([pattern, blocks]) => ({ pattern, blocks })),
      top_users: sortDesc(byUser).slice(0, 10).map(([user, blocks]) => ({
        user, blocks, per_day: Number((blocks / days).toFixed(2)),
        attributed: attributed.get(user) ?? false,
      })),

      productivity: {
        blocks_per_user_per_day: Number(perUserPerDay.toFixed(2)),
        impact_level: impact,
        summary: uniqueUsers === 0
          ? "No user would have been interrupted in this window."
          : `Would interrupt roughly ${perUserPerDay.toFixed(1)} time(s) per affected user per day (${impact} impact).`,
      },

      comparison: {
        current_enforcement_events: baselineBlocks,
        simulated_blocks: wouldBlockTotal,
        delta: wouldBlockTotal - baselineBlocks,
        delta_percent: baselineBlocks > 0
          ? Number((((wouldBlockTotal - baselineBlocks) / baselineBlocks) * 100).toFixed(1))
          : null,
        note: "Current enforcement counts blocks, redactions and tokenizations already applied in this window.",
      },

      samples,
      caveats: [
        `Based on ${events.length} captured prompt events in the last ${days} days. Coverage equals endpoints with CloudFuze installed — activity on unmonitored machines is not represented.`,
        "Simulation only. Nothing was enabled and no event was blocked by running this.",
        ...(req.body?.include_samples
          ? ["Sample excerpts are masked: detected secrets and identifiers are replaced before display."]
          : []),
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Simulation failed";
    console.error("Policy simulator error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/policy-simulator/options — what a user can build a rule from, derived
 * from data actually present so the UI never offers a choice that yields nothing.
 */
router.get("/options", async (req, res) => {
  try {
    const db = getDb();
    const days = Number(req.query.days) > 0 ? Math.min(Number(req.query.days), 365) : 30;
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const rows = await db.collection("dlp_events")
      .find({ occurred_at: { $gte: sinceIso }, event_kind: { $in: CANDIDATE_KINDS } })
      .project({ _id: 0, ai_service: 1, secret_class: 1, pattern_matched: 1 })
      .toArray();

    const services = new Map<string, number>();
    const severities = new Map<string, number>();
    const patterns = new Map<string, number>();
    for (const r of rows) {
      services.set(String(r.ai_service || "unknown"), (services.get(String(r.ai_service || "unknown")) || 0) + 1);
      if (r.secret_class) severities.set(r.secret_class, (severities.get(r.secret_class) || 0) + 1);
      for (const p of String(r.pattern_matched || "").split(",")) {
        const k = p.trim();
        if (k) patterns.set(k, (patterns.get(k) || 0) + 1);
      }
    }
    const out = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, events]) => ({ value, events }));

    res.json({
      window_days: days,
      events_available: rows.length,
      services: out(services),
      severities: out(severities).sort((a, b) => (SEVERITY_RANK[b.value] || 0) - (SEVERITY_RANK[a.value] || 0)),
      patterns: out(patterns).map((p) => ({ ...p, category: categoryFor(p.value) })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load simulator options";
    console.error("Policy simulator options error:", message);
    res.status(500).json({ error: message });
  }
});

export default router;
