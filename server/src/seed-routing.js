// Seed the built-in model routing rules on server startup, so routing works the
// moment the extension is installed instead of only after an admin authors rules
// by hand.
//
// IDENTITY IS `builtin_key`, NOT THE NAME. The previous version treated the rule
// NAME as the identity, and that is what put six rules in the live database when
// there were three: the shipped names contained a "→", someone fixed its
// encoding, and on the next boot the seeder saw three names it had never stored
// and inserted a second copy of each. At equal priority, which copy of a pair
// won was arbitrary. A stable key cannot be edited by accident.
//
// INSERT-ONLY, on purpose. A built-in an admin has renamed, disabled or
// repointed must survive a restart, so an existing builtin_key is left entirely
// alone rather than reset to the shipped default. That makes "disable this rule"
// a durable decision instead of one the next deploy quietly undoes.

import crypto from 'node:crypto';

// `action.ui_name` is the label the browser extension CLICKS in that platform's
// own model picker. `action.model` is the API id for the fetch-blocker rewrite
// path. They are separate because a model id is not a picker label — clicking
// "claude-sonnet-4-20250514" finds nothing on claude.ai.
//
// Priorities ascend with tier so the cheapest match is considered first, and
// leave room (20/30/40) for admin rules to sit above or between them.
export const DEFAULT_RULES = [
  // ── Simple prompt → cheapest tier ──
  { builtin_key: 'anthropic:simple',    priority: 20, provider: 'anthropic',
    name: 'Simple prompt → Haiku (fastest & cheapest)',
    action: { ui_name: 'Haiku',        model: 'claude-haiku-4-5' } },
  { builtin_key: 'openai:simple',       priority: 20, provider: 'openai',
    name: 'Simple prompt → GPT-4o mini',
    action: { ui_name: 'GPT-4o mini',  model: 'gpt-4o-mini' } },
  // `gemini-2.0-flash` was retired and is no longer in Google's price list, so the
  // fetch-rewrite path was naming a model that no longer exists. `ui_name` stays
  // 'Flash' — that is the label clicked in Gemini's own picker, and it is still
  // what the picker shows.
  { builtin_key: 'google:simple',       priority: 20, provider: 'google',
    name: 'Simple prompt → Gemini Flash',
    action: { ui_name: 'Flash',        model: 'gemini-2.5-flash-lite' } },
  { builtin_key: 'mistral:simple',      priority: 20, provider: 'mistral',
    name: 'Simple prompt → Mistral Small',
    action: { ui_name: 'Small',        model: 'mistral-small-latest' } },
  { builtin_key: 'perplexity:simple',   priority: 20, provider: 'perplexity',
    name: 'Simple prompt → Sonar',
    action: { ui_name: 'Sonar',        model: 'sonar' } },

  // ── Moderate prompt → balanced tier ──
  { builtin_key: 'anthropic:moderate',  priority: 30, provider: 'anthropic',
    name: 'Standard prompt → Sonnet (balanced)',
    action: { ui_name: 'Sonnet',       model: 'claude-sonnet-5' } },
  { builtin_key: 'openai:moderate',     priority: 30, provider: 'openai',
    name: 'Standard prompt → GPT-4o',
    action: { ui_name: 'GPT-4o',       model: 'gpt-4o' } },
  // `gemini-2.5-flash-thinking` is not a model id Google publishes — thinking is a
  // mode on the Flash models, not a separate model. The rewrite path was sending
  // an id the API would reject.
  { builtin_key: 'google:moderate',     priority: 30, provider: 'google',
    name: 'Standard prompt → Gemini Thinking',
    action: { ui_name: 'Thinking',     model: 'gemini-3.7-flash' } },
  { builtin_key: 'mistral:moderate',    priority: 30, provider: 'mistral',
    name: 'Standard prompt → Mistral Medium',
    action: { ui_name: 'Medium',       model: 'mistral-medium-latest' } },
  { builtin_key: 'perplexity:moderate', priority: 30, provider: 'perplexity',
    name: 'Standard prompt → Sonar Pro',
    action: { ui_name: 'Sonar Pro',    model: 'sonar-pro' } },

  // ── Complex prompt → flagship tier ──
  { builtin_key: 'anthropic:complex',   priority: 40, provider: 'anthropic',
    name: 'Complex prompt → Opus (premium)',
    action: { ui_name: 'Opus',         model: 'claude-opus-5' } },
  { builtin_key: 'openai:complex',      priority: 40, provider: 'openai',
    name: 'Complex prompt → GPT-4 (premium)',
    action: { ui_name: 'GPT-4',        model: 'gpt-4' } },
  { builtin_key: 'google:complex',      priority: 40, provider: 'google',
    name: 'Complex prompt → Gemini Pro',
    action: { ui_name: 'Pro',          model: 'gemini-2.5-pro' } },
  { builtin_key: 'mistral:complex',     priority: 40, provider: 'mistral',
    name: 'Complex prompt → Mistral Large',
    action: { ui_name: 'Large',        model: 'mistral-large-latest' } },
  { builtin_key: 'perplexity:complex',  priority: 40, provider: 'perplexity',
    name: 'Complex prompt → Research',
    action: { ui_name: 'Research',     model: 'sonar-deep-research' } },
].map((r) => ({
  ...r,
  enabled: true,
  conditions: {
    provider: [r.provider],
    complexity: [r.builtin_key.split(':')[1]],
  },
}));

// The rules the OLD name-keyed seeder shipped. They are superseded by the
// per-tier set above, and they carry no ui_name, so they are retired — but ONLY
// while still pristine: an admin who has touched one owns it, and it is left
// where it is. Matched on the mojibake and the fixed spelling, since both
// spellings exist in live data.
const RETIRED_NAMES = [
  'Auto-optimize: Anthropic non-complex → Sonnet',
  'Auto-optimize: OpenAI non-complex → GPT-4o-mini',
  'Auto-optimize: Google non-complex → Gemini Flash',
  'Auto-optimize: Anthropic non-complex ? Sonnet',
  'Auto-optimize: OpenAI non-complex ? GPT-4o-mini',
  'Auto-optimize: Google non-complex ? Gemini Flash',
];
const RETIRED_SHAPE = {
  priority: 10,
  complexity: ['simple', 'moderate'],
  models: ['claude-sonnet-4-20250514', 'gpt-4o-mini', 'gemini-2.0-flash'],
};

// Model ids we have shipped for a built-in in the past, per builtin_key. A
// stored rule still carrying one of these — AND still carrying the name and
// priority we shipped with it — has never been edited by an admin, so it is
// safe to move it onto the current default model.
//
// This exists because seeding is insert-only. That rule is right: an admin who
// repoints a built-in must not have it reset on every deploy. But it also means
// a stale model id lives forever in every existing install, and "Complex prompt
// → Opus (premium)" was still pointing at claude-opus-4-20250514 long after
// that stopped being the flagship. Customers were paying premium-tier routing
// for a superseded model.
//
// The check is deliberately narrow: same builtin_key, same shipped name, same
// priority, and a model id from this list. Anything else is treated as the
// admin's own decision and left exactly where it is.
const SUPERSEDED_MODELS = {
  'anthropic:simple':   ['claude-haiku-4-5-20251001'],
  'anthropic:moderate': ['claude-sonnet-4-20250514'],
  'anthropic:complex':  ['claude-opus-4-20250514'],
  // Google shipped two ids that stopped working rather than merely aging:
  // gemini-2.0-flash was retired, and gemini-2.5-flash-thinking never existed
  // (thinking is a mode on Flash, not a model). Existing installs are still
  // sending both, so these need the same pristine-only refresh.
  'google:simple':      ['gemini-2.0-flash'],
  'google:moderate':    ['gemini-2.5-flash-thinking'],
};

/**
 * Move pristine built-ins off superseded model ids. Returns the number updated.
 * Never touches a rule whose name, priority, or model an admin has changed.
 */
async function refreshSupersededModels(col, all) {
  const byKey = new Map(DEFAULT_RULES.map((r) => [r.builtin_key, r]));
  let updated = 0;

  for (const rule of all) {
    const stale = SUPERSEDED_MODELS[rule.builtin_key];
    if (!stale) continue;

    const shipped = byKey.get(rule.builtin_key);
    if (!shipped) continue;

    const current = rule.action?.model;
    if (!stale.includes(current)) continue;              // admin repointed it, or already current
    if (rule.name !== shipped.name) continue;            // admin renamed it
    if (rule.priority !== shipped.priority) continue;    // admin reprioritised it

    // The whole `action` object, not a dotted 'action.model' path. Two reasons:
    // the pristine check above already established this rule still carries the
    // action we shipped, so replacing it wholesale is exactly equivalent; and
    // the test double for Mongo does not implement dotted-path $set — it writes
    // a literal "action.model" key instead, which would make this look like it
    // worked in tests while only really working in production.
    await col.updateOne(
      { id: rule.id },
      { $set: { action: { ...shipped.action }, updated_at: new Date() } },
    );
    updated++;
    console.log(`[seed] routing rule "${rule.name}": ${current} → ${shipped.action.model}`);
  }
  return updated;
}

/** True only for an untouched legacy seeded rule — never for admin-edited data. */
function isPristineLegacy(rule) {
  if (rule.builtin_key) return false;
  if (!RETIRED_NAMES.includes(rule.name)) return false;
  if (rule.priority !== RETIRED_SHAPE.priority) return false;
  if (rule.enabled !== true) return false;
  const c = rule.conditions || {};
  const complexity = Array.isArray(c.complexity) ? [...c.complexity].sort() : [];
  if (complexity.join(',') !== [...RETIRED_SHAPE.complexity].sort().join(',')) return false;
  const a = rule.action || {};
  if (a.ui_name) return false;
  return RETIRED_SHAPE.models.includes(a.model);
}

export async function seedDefaultRoutingRules(db) {
  const col = db.collection('routing_rules');
  const all = await col.find({}).project({ _id: 0 }).toArray();

  // Retire pristine legacy defaults so the tab does not show two generations of
  // built-ins describing the same routing.
  const stale = all.filter(isPristineLegacy);
  for (const rule of stale) {
    await col.deleteOne({ id: rule.id });
    console.log(`[seed] retired superseded routing rule: ${rule.name}`);
  }

  // Move untouched built-ins off superseded model ids (see SUPERSEDED_MODELS).
  const refreshed = await refreshSupersededModels(col, all.filter((r) => !stale.includes(r)));

  const have = new Set(all.map((r) => r.builtin_key).filter(Boolean));
  const missing = DEFAULT_RULES.filter((r) => !have.has(r.builtin_key));
  if (missing.length === 0) return { inserted: 0, retired: stale.length, refreshed };

  const now = new Date();
  await col.insertMany(missing.map((r) => ({
    id: crypto.randomUUID(),
    builtin_key: r.builtin_key,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    conditions: r.conditions,
    action: r.action,
    created_at: now,
    updated_at: now,
  })));
  console.log(`[seed] routing rules inserted: ${missing.length}`);
  return { inserted: missing.length, retired: stale.length, refreshed };
}
