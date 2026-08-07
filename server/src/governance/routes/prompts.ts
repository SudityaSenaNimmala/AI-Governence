import { Router } from "express";
import { getDb } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { maskSensitive } from "../../lib/mask-sensitive.js";

const router = Router();

// PII patterns — applied to user messages across all platforms
const PII_PATTERNS: Array<{ name: string; pattern: RegExp; severity: "critical" | "high" | "medium" | "low" }> = [
  { name: "SSN Pattern",      pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                                     severity: "critical" },
  { name: "Credit Card",      pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,                               severity: "critical" },
  { name: "Email Address",    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,            severity: "medium" },
  { name: "Phone Number",     pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g,           severity: "medium" },
  { name: "IP Address",       pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                               severity: "low" },
];

// Prompt injection / jailbreak patterns — high severity
const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp; severity: "critical" | "high" }> = [
  { name: "Jailbreak Attempt",    pattern: /ignore (all )?(previous|prior) instructions|pretend you (are|have no|don't)|you are now (a |an )?(different|uncensored|unrestricted)/i, severity: "critical" },
  // The HTML-comment branch is split out and guarded — see PROMPT_INJECTION_COMMENT
  // below. Everything left here is a fixed-string alternation with no unbounded
  // quantifier, so it cannot backtrack.
  { name: "Prompt Injection",     pattern: /\[SYSTEM\]|###\s*System\s*:|<\/?s>|\[INST\]/i,                                                                                        severity: "high" },
  { name: "Safety Override",      pattern: /admin mode|override (safety|filters?|restrictions?)|disable (safety|filters?)|bypass (security|restrictions?|guardrails?)/i,           severity: "critical" },
  { name: "Role Play Bypass",     pattern: /act as (if you were|a|an) .{3,50} (without|that can|who can|with no) (restrictions?|filters?|limits?|safety)/i,                       severity: "high" },
];

/**
 * HTML-comment injection (`<!-- ignore the above -->`), split out of the
 * alternation above because it is the one branch that can be weaponised.
 *
 * `<!--[\s\S]*?-->` is O(n²) on text that OPENS comments and never closes them:
 * the engine restarts a scan-to-end-of-string from each of the n `<!--`
 * positions. Measured against the running server: 19KB 0.07s, 48KB 0.87s,
 * 97KB 3.8s — clean quadratic, so a few MB is minutes of blocked event loop, and
 * Node being single-threaded that takes the health check, DLP ingest and the whole
 * dashboard with it. One unauthenticated POST.
 *
 * Rewriting the quantifier does NOT fix it — `<!--(?:[^-]|-(?!->))*-->` measured
 * 16× SLOWER (9.3s at 78KB vs 0.56s), because the restart-at-every-position
 * behaviour is unchanged and the per-character cost went up.
 *
 * The cheap precondition is what works: the pathological input is by definition
 * one with no `-->` in it, and a substring check is ~1400× faster than the regex
 * (0.4ms vs 559ms at 78KB). If there is no closing marker the pattern cannot match
 * anyway, so skipping it costs no detections. The bounded {0,4000} is a second
 * ceiling in case a payload does include a closing marker far away.
 */
const PROMPT_INJECTION_COMMENT = /<!--(?:[^-]|-(?!->)){0,4000}?-->/;
function hasCommentInjection(text: string): boolean {
  // Guard first: no closing marker means no possible match.
  if (!text.includes("-->")) return false;
  return PROMPT_INJECTION_COMMENT.test(text);
}

// Sensitive data keywords — medium/high severity
const KEYWORD_GROUPS: Array<{ name: string; flagType: string; keywords: string[]; severity: "critical" | "high" | "medium" }> = [
  {
    name: "Credentials in Prompt", flagType: "sensitive_keyword",
    keywords: ["password:", "api_key:", "secret:", "api key:", "bearer ", "access_token=", "client_secret"],
    severity: "critical",
  },
  {
    name: "Confidential Reference", flagType: "sensitive_keyword",
    keywords: ["confidential", "top secret", "classified", "do not share", "internal only", "nda"],
    severity: "high",
  },
  {
    name: "PII Reference", flagType: "sensitive_keyword",
    keywords: ["social security", "date of birth", "home address", "passport number", "driver's license", "national id"],
    severity: "high",
  },
  {
    name: "Medical / HIPAA Data", flagType: "sensitive_keyword",
    keywords: ["diagnosis", "prescription", "medical record", "patient id", "hipaa", "health record"],
    severity: "high",
  },
  {
    name: "Financial Data", flagType: "sensitive_keyword",
    keywords: ["account number", "routing number", "wire transfer", "swift code", "iban", "sort code"],
    severity: "high",
  },
  {
    name: "Data Exfiltration Signal", flagType: "data_exfiltration",
    keywords: ["send this to", "email me at", "export all", "dump the database", "copy all records"],
    severity: "high",
  },
];

interface Message { text?: string; from?: string; timestamp?: string; content?: string; }

function analyzeMessages(
  messages: Message[],
  agentId: string,
  agentName: string,
  platform: string,
  conversationId: string
): Array<{
  id: string; agentId: string; agentName: string; platform: string;
  conversationId: string; flagType: string; severity: string; snippet: string; matchedPatterns: string[];
}> {
  const flags: ReturnType<typeof analyzeMessages> = [];

  // Bound the work per request. express.json() accepts 50MB and conversations is
  // only capped at 100 entries, so without these limits a single body could carry
  // hundreds of megabytes of text into a regex loop on a single-threaded server.
  // The linear rewrite of the injection pattern above removes the quadratic blowup;
  // these caps mean the NEXT pattern someone adds cannot reintroduce it.
  //
  // 64KB is far above any real prompt (the 99th percentile of captured prompts is
  // a few KB) and the truncation is scan-only — nothing stored or reported changes,
  // because the snippet taken below is the first 250 characters regardless.
  const MAX_SCAN_CHARS = 64 * 1024;
  const MAX_MESSAGES = 500;

  for (const msg of messages.slice(0, MAX_MESSAGES)) {
    const raw = msg.text || msg.content || "";
    if (!raw || raw.length < 5) continue;
    const full = typeof raw === "string" ? raw : JSON.stringify(raw);
    const text = full.length > MAX_SCAN_CHARS ? full.slice(0, MAX_SCAN_CHARS) : full;
    const isUserMsg = !msg.from || msg.from === "user";

    const matchedPatterns: string[] = [];
    let highestSeverity: "critical" | "high" | "medium" | "low" = "low";
    let flagType = "";

    const bump = (sev: "critical" | "high" | "medium" | "low") => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3 };
      if (rank[sev] < rank[highestSeverity]) highestSeverity = sev;
    };

    // PII checks (user messages only)
    if (isUserMsg) {
      for (const pii of PII_PATTERNS) {
        const r = new RegExp(pii.pattern.source, pii.pattern.flags);
        if (r.test(text)) {
          matchedPatterns.push(pii.name);
          bump(pii.severity);
          flagType = "pii_detected";
        }
      }
    }

    // Keyword checks (all messages)
    const textLower = text.toLowerCase();
    for (const kg of KEYWORD_GROUPS) {
      const hits = kg.keywords.filter((kw) => textLower.includes(kw));
      if (hits.length > 0) {
        matchedPatterns.push(`${kg.name}: ${hits.slice(0, 3).join(", ")}`);
        bump(kg.severity);
        flagType = flagType || kg.flagType;
      }
    }

    // Prompt injection / jailbreak (all messages)
    for (const ip of INJECTION_PATTERNS) {
      if (ip.pattern.test(text)) {
        matchedPatterns.push(ip.name);
        bump(ip.severity);
        flagType = ip.name.includes("Jailbreak") || ip.name.includes("Override")
          ? "jailbreak_attempt"
          : "prompt_injection";
      }
    }

    // HTML-comment injection, guarded — see hasCommentInjection().
    if (hasCommentInjection(text)) {
      if (!matchedPatterns.includes("Prompt Injection")) matchedPatterns.push("Prompt Injection");
      bump("high");
      if (!flagType) flagType = "prompt_injection";
    }

    if (matchedPatterns.length > 0) {
      // Masked, not raw. This record exists BECAUSE the text matched an SSN,
      // card, `password:` or `api_key:` — so a verbatim substring is the leaked
      // value by construction, and GET /api/prompts/flags serves it back
      // unauthenticated. policySimulator.ts already masked its excerpts; this
      // path did the same job with none of it.
      const snippet = maskSensitive(text, 250);
      flags.push({
        id: uuidv4(),
        agentId,
        agentName,
        platform,
        conversationId,
        flagType: flagType || "sensitive_content",
        severity: highestSeverity,
        snippet,
        matchedPatterns,
      });
    }
  }

  return flags;
}

router.post("/analyze", async (req, res) => {
  const { agent_id, agent_name, platform, conversations } = req.body;
  if (!agent_id || !Array.isArray(conversations)) {
    res.status(400).json({ error: "agent_id and conversations array are required" });
    return;
  }

  const allFlags: ReturnType<typeof analyzeMessages> = [];
  for (const convo of conversations.slice(0, 100)) {
    const msgs: Message[] = convo.messages || [];
    const convId = convo.id || convo.sessionId || convo.chatId || uuidv4();
    const flags = analyzeMessages(msgs, agent_id, agent_name || "", platform || "unknown", convId);
    allFlags.push(...flags);
  }

  const col = getDb().collection("prompt_flags");
  let stored = 0;
  for (const flag of allFlags.slice(0, 500)) {
    try {
      await col.updateOne(
        { id: flag.id },
        {
          $setOnInsert: {
            id: flag.id,
            agent_id: flag.agentId,
            agent_name: flag.agentName,
            platform: flag.platform,
            conversation_id: flag.conversationId,
            flag_type: flag.flagType,
            severity: flag.severity,
            snippet: flag.snippet,
            matched_patterns: flag.matchedPatterns,
            resolved: false,
            resolved_at: null,
            flagged_at: new Date(),
          },
        },
        { upsert: true }
      );
      stored++;
    } catch { /* ignore duplicates */ }
  }

  const bySeverity = {
    critical: allFlags.filter((f) => f.severity === "critical").length,
    high:     allFlags.filter((f) => f.severity === "high").length,
    medium:   allFlags.filter((f) => f.severity === "medium").length,
    low:      allFlags.filter((f) => f.severity === "low").length,
  };
  const byType: Record<string, number> = {};
  for (const f of allFlags) byType[f.flagType] = (byType[f.flagType] || 0) + 1;

  res.json({
    agentId: agent_id,
    totalConversationsAnalyzed: conversations.length,
    totalFlagsFound: allFlags.length,
    flagsStored: stored,
    summary: { ...bySeverity, byType },
    flags: allFlags.slice(0, 50),
  });
});

router.get("/flags", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const filter: Record<string, any> = {};
    if (req.query.severity)  filter.severity  = req.query.severity;
    if (req.query.platform)  filter.platform  = req.query.platform;
    if (req.query.agent_id)  filter.agent_id  = req.query.agent_id;
    if (req.query.flag_type) filter.flag_type = req.query.flag_type;
    if (req.query.resolved !== undefined) filter.resolved = req.query.resolved === "true";

    const flags = await getDb().collection("prompt_flags")
      .find(filter, { projection: { _id: 0 } })
      .sort({ flagged_at: -1 })
      .limit(limit)
      .toArray();
    res.json({ flags, totalCount: flags.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch flags" });
  }
});

router.patch("/flags/:id/resolve", async (req, res) => {
  try {
    await getDb().collection("prompt_flags").updateOne(
      { id: req.params.id },
      { $set: { resolved: true, resolved_at: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve flag" });
  }
});

router.post("/flags/resolve-all", async (req, res) => {
  try {
    const filter: Record<string, any> = { resolved: false };
    if (req.body.agent_id) filter.agent_id = req.body.agent_id;
    await getDb().collection("prompt_flags").updateMany(filter, { $set: { resolved: true, resolved_at: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to resolve flags" });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const col = getDb().collection("prompt_flags");
    const total_flags = await col.countDocuments();
    const critical_count = await col.countDocuments({ severity: "critical" });
    const high_count = await col.countDocuments({ severity: "high" });
    const medium_count = await col.countDocuments({ severity: "medium" });
    const unresolved_count = await col.countDocuments({ resolved: false });
    const affected_agents = (await col.distinct("agent_id")).length;
    const affected_platforms = (await col.distinct("platform")).length;

    const byTypePipeline = await col.aggregate([
      { $group: { _id: "$flag_type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $project: { _id: 0, flag_type: "$_id", count: 1 } },
    ]).toArray();

    res.json({
      total_flags, critical_count, high_count, medium_count,
      unresolved_count, affected_agents, affected_platforms,
      byType: byTypePipeline,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get summary" });
  }
});

export default router;
