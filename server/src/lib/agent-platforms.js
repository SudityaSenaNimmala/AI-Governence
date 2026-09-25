// WHICH `blocked_agents.platform` values can actually be ENFORCED somewhere.
//
// A companion to agent-platform.js (singular), which answers "does this row have
// a platform at all". This file answers the next question, the one that was never
// asked: the row has a platform — is that platform one any surface can act on?
//
// THE GAP THIS EXISTS TO FIX. `blocked_agents.platform` is written from whatever
// value discovery put on the agent, and the AgentPlatform union in
// ../governance/types/agent.ts is far wider than the set the two enforcers
// understand. `power_automate`, `oauth_app`, `google_chat`, `apps_script`,
// `aws_bedrock`, `manual` and friends are legitimate discovery results, but the
// browser extension has no host pattern for them (browser-extension/lib/
// blocked-agents.js `PLATFORM_HOST_PATTERNS`) and the desktop enforcer has no
// process for them (agent/src/os_monitor/ai-processes.js `PLATFORM_PROCS`). A
// block on one of those rows is stored, shows as Blocked in AI Systems, and stops
// nothing — indistinguishable, until now, from a block that works.
//
// WHY A CURATED CONSTANT rather than deriving it from the two enforcers. Same
// rationale as MICROSOFT_WORKSPACE_COPILOT_HOSTS in ./ai-surfaces.js: the
// derivation is available and it is the wrong thing to do. The extension's host
// map and the agent's process map are shipped, versioned artifacts on the
// endpoint, not something this server can read at request time — and importing
// either across subproject boundaries would make a server response depend on a
// file the deployed extension may be several releases behind on. So this list is
// hand-maintained, and WIDENING what the server calls enforceable is a code review
// rather than a side effect of an endpoint update.
//
// It is also deliberately FORWARD-LOOKING: it names every platform that is
// enforceable on at least one surface today OR that the in-flight M365 per-agent
// blocking work makes enforceable. Erring that way is the safe direction here,
// because this set is used only to ANNOTATE and to REPORT (see
// ../governance/routes/lifecycle.ts). It never gates a write, never filters the
// blocked list, and never lifts a block — the worst a premature entry does is
// omit a "we cannot enforce this yet" hint on a row that is stored and shown
// either way. A missing entry, by contrast, would label a working block broken.
//
// KEEPING IT HONEST is a human job: when a platform is added to
// PLATFORM_HOST_PATTERNS or PLATFORM_PROCS, add it here.
//
// TWO SETS, NOT ONE, because "enforceable" turned out to mean two things.
// ENFORCEABLE_PLATFORMS is the union — anything any mechanism can act on.
// AGENT_MATCHABLE_PLATFORMS is the narrower set a per-agent, NAME-matched
// `blocked_agents` row can actually be resolved under, and it is the one the two
// annotating functions at the bottom consult, because that is the only kind of
// row they describe. PRODUCT_LEVEL_PLATFORMS is the difference.

import { normalizePlatform } from './agent-platform.js';

/**
 * The Microsoft 365 agent platforms — the values that mean "one named agent
 * inside a Microsoft app", as opposed to a whole product.
 *
 * Exported separately from ENFORCEABLE_PLATFORMS because callers need the M365
 * subset on its own (which rows the M365 agent-label reader on the browser side,
 * and the composer-name reader on the desktop side, are expected to resolve), not
 * just the union of everything enforceable anywhere.
 *
 * Spellings are the AgentPlatform union in ../governance/types/agent.ts, which is
 * what discovery writes.
 */
export const M365_AGENT_PLATFORMS = Object.freeze([
  'copilot_studio',
  'personal_agent',
  'teams_chat_agent',
  'sharepoint_embedded',
  'teams_app',
  'isv_store',
]);

/**
 * The two M365 PRODUCT-level ids: `m365_copilot` (the Microsoft 365 Copilot app
 * itself) and `teams_desktop` (the Teams client). Neither is in the AgentPlatform
 * union in types/agent.ts — they are not discovery results, they are enforcement
 * targets — which is why this file is keyed on the STORED STRING and not typed
 * against that union.
 *
 * ENFORCED, BUT NEVER BY AGENT NAME, and that distinction is the reason this
 * subset is named. Both are real enforcement targets, but only through the
 * whole-product `ai_platforms` host cascade (see ./ai-surfaces.js's
 * applyMicrosoftWorkspaceCopilotCascade) — neither is a key in the browser's
 * PLATFORM_HOST_PATTERNS nor in the desktop's PLATFORM_PROCS. So a per-agent
 * `blocked_agents` row stored under one of these values, which is matched BY
 * NAME, enforces nowhere by itself: the product-level block covers the product,
 * and this specific row adds nothing. Calling such a row plainly "enforceable"
 * is the same class of dishonesty this whole file exists to remove, which is
 * what `'product_level_platform'` below reports.
 */
export const PRODUCT_LEVEL_PLATFORMS = Object.freeze([
  'm365_copilot',
  'teams_desktop',
]);

/**
 * The platforms a `blocked_agents` row can actually be MATCHED BY NAME under.
 *
 * ENFORCEABLE_PLATFORMS minus PRODUCT_LEVEL_PLATFORMS, and the set the two
 * annotating functions below consult — because those functions describe one
 * per-agent row, and `m365_copilot`/`teams_desktop` are not values any per-agent
 * matcher keys on. See PRODUCT_LEVEL_PLATFORMS above for the full argument.
 */
export const AGENT_MATCHABLE_PLATFORMS = Object.freeze([
  ...M365_AGENT_PLATFORMS,

  // Non-Microsoft, enforceable today. `azure_foundry` and `gemini_enterprise` are
  // browser-only (host patterns, no desktop process); the rest are on both.
  'openai_assistant',
  'custom_gpt',
  'claude_ai_project',
  'gemini',
  'gemini_enterprise',
  'vertex_ai',
  'azure_foundry',
]);

/**
 * Every platform value a block can be enforced under on at least one surface, by
 * ANY mechanism — per-agent name matching or the whole-product host cascade.
 *
 * The broader of the two sets, and deliberately kept as the exported union for
 * any caller that wants "can anything act on this platform at all". The two
 * annotating functions below do NOT use it — they describe a single per-agent
 * row, so they consult AGENT_MATCHABLE_PLATFORMS instead.
 */
export const ENFORCEABLE_PLATFORMS = Object.freeze([
  ...AGENT_MATCHABLE_PLATFORMS,

  // M365 product-level enforcement targets (browser + desktop today) — see
  // PRODUCT_LEVEL_PLATFORMS.
  ...PRODUCT_LEVEL_PLATFORMS,
]);

/**
 * Trims and lower-cases the way both enforcers compare platform keys.
 *
 * "Is there a platform at all" is delegated to agent-platform.js's
 * normalizePlatform rather than re-tested here, so '' and '   ' are as absent in
 * this file as they are in the write paths and in isUnenforceableBlock. Only the
 * case-folding is added, because both enforcers compare case-insensitively
 * (PLATFORM_HOST_PATTERNS and PLATFORM_PROCS both lower-case the row's value
 * before looking it up).
 */
function normalizeKey(platform) {
  return (normalizePlatform(platform) ?? '').toLowerCase();
}

/**
 * True when a PER-AGENT block stored under this platform can be matched by name
 * on at least one surface.
 *
 * KEYED ON AGENT_MATCHABLE_PLATFORMS, not on ENFORCEABLE_PLATFORMS, and that is
 * the whole point: this function and unenforceableReason below annotate ONE
 * `blocked_agents` row, and such a row is only ever resolved by agent name. A
 * product-level value (see PRODUCT_LEVEL_PLATFORMS) is enforced — just not by
 * this row — so answering true for it would tell an admin their per-agent block
 * is working when nothing matches it.
 *
 * FALSE IS A REPORTING SIGNAL, NEVER A GATE. A false answer must never cause a
 * block to be refused, dropped from GET /blocked-agents, or lifted — it only
 * explains to an admin why a stored block is not doing anything. See the comments
 * on both call sites in ../governance/routes/lifecycle.ts.
 */
export function isEnforceablePlatform(platform) {
  const key = normalizeKey(platform);
  return key.length > 0 && AGENT_MATCHABLE_PLATFORMS.includes(key);
}

/**
 * Why a stored per-agent block matches nothing by name, or null when it is fine:
 *
 *   'no_platform'            — the row carries no platform at all. The
 *                              pre-existing case; the desktop enforcer drops such
 *                              a row at parse time and the extension cannot map
 *                              it to any host.
 *   'unknown_platform'       — a platform IS set, but no surface knows it.
 *   'product_level_platform' — the platform names a PRODUCT, not a per-agent
 *                              matchable value (see PRODUCT_LEVEL_PLATFORMS).
 *                              The product-level block covers that product, but
 *                              this specific row does not: nothing matches it by
 *                              name. Informational, exactly like the other two —
 *                              it is NOT a harder failure than they are, and no
 *                              caller may treat it as one.
 *
 * One definition, shared by POST /api/lifecycle/block (which returns it as
 * `reason`) and GET /api/lifecycle/blocked-agents (which returns it as
 * `unenforceable_reason`), so a caller cannot be told one thing when it writes a
 * row and a different thing when it reads the same row back.
 */
export function unenforceableReason(platform) {
  const key = normalizeKey(platform);
  if (key.length === 0) return 'no_platform';
  if (PRODUCT_LEVEL_PLATFORMS.includes(key)) return 'product_level_platform';
  return isEnforceablePlatform(key) ? null : 'unknown_platform';
}
