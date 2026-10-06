// Seed the built-in model routing rules on server startup, so routing works the
// moment the extension is installed instead of only after an admin authors rules
// by hand — and migrate stored rules to schema v2 (lib/routing-schema.js).
//
// IDENTITY IS `builtin_key`, NOT THE NAME. The previous version treated the rule
// NAME as the identity, and that is what put six rules in the live database when
// there were three: the shipped names contained a "→", someone fixed its
// encoding, and on the next boot the seeder saw three names it had never stored
// and inserted a second copy of each. At equal priority, which copy of a pair
// won was arbitrary. A stable key cannot be edited by accident.
//
// INSERT-ONLY for anything an admin has touched. A built-in an admin has
// renamed, reprioritised or repointed keeps its decisions across a restart;
// only a built-in still byte-for-byte as we shipped it is rewritten to the
// current default. A DISABLED pristine built-in is still rewritten, but stays
// disabled — "disable this rule" is a durable decision.
//
// SCHEMA v2 MIGRATION (idempotent — a rule already at schema_version 2 is never
// touched again):
//   - pristine v1 built-in   → the shipped v2 rule (tier + effort, no hard-coded
//                              model), id and enabled preserved.
//   - admin-edited v1 rule   → translateV1Rule(): action.type set_tier with an
//                              inferred target_tier, the admin's picker label kept
//                              as action.ui_name AND recorded as a catalog override
//                              when it differs from what we shipped; a
//                              sensitivity-only rule is scoped to api_proxy. The
//                              original is kept under migrated_from_v1.

import crypto from 'node:crypto';
import {
  SCHEMA_VERSION, RULE_SURFACES, COMPLEXITY_TIER, COMPLEXITY_EFFORT,
  translateV1Rule, catalogOverrideFor,
} from './lib/routing-schema.js';

const PROVIDERS = [
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['google', 'Google'],
  ['mistral', 'Mistral'],
  ['perplexity', 'Perplexity'],
];
const COMPLEXITY_ROWS = [
  // complexity, priority, phrase
  ['simple',   20, 'Simple prompt'],
  ['moderate', 30, 'Standard prompt'],
  ['complex',  40, 'Demanding prompt'],
];
const TIER_LABEL = { economy: 'Economy', standard: 'Standard', premium: 'Premium' };

// Routing goes BOTH ways by demand: simple → economy (low effort), moderate →
// standard, demanding → premium (high effort). Priorities ascend with tier and
// leave room (20/30/40) for admin rules to sit above or between them.
export const DEFAULT_RULES = PROVIDERS.flatMap(([provider, providerName]) =>
  COMPLEXITY_ROWS.map(([complexity, priority, phrase]) => {
    const tier = COMPLEXITY_TIER[complexity];
    const effort = COMPLEXITY_EFFORT[complexity];
    return {
      builtin_key: `${provider}:${complexity}`,
      name: `${providerName}: ${phrase} → ${TIER_LABEL[tier]}${effort ? ` (${effort} effort)` : ''}`,
      enabled: true,
      priority,
      schema_version: SCHEMA_VERSION,
      scope: { surfaces: [...RULE_SURFACES] },
      conditions: { provider: [provider], complexity: [complexity] },
      action: { type: 'set_tier', target_tier: tier, ...(effort ? { effort } : {}) },
      mode: 'enforce',
    };
  }));

// Every v1 built-in we have ever shipped, exactly: name, priority, picker label,
// and each model id it has carried. A stored v1 built-in matching one of these
// has never been edited and is safe to rewrite onto the v2 default.
const SHIPPED_V1 = {
  'anthropic:simple':    { name: 'Simple prompt → Haiku (fastest & cheapest)', priority: 20, ui_name: 'Haiku', models: ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'] },
  'openai:simple':       { name: 'Simple prompt → GPT-4o mini', priority: 20, ui_name: 'GPT-4o mini', models: ['gpt-4o-mini'] },
  'google:simple':       { name: 'Simple prompt → Gemini Flash', priority: 20, ui_name: 'Flash', models: ['gemini-2.5-flash-lite', 'gemini-2.0-flash'] },
  'mistral:simple':      { name: 'Simple prompt → Mistral Small', priority: 20, ui_name: 'Small', models: ['mistral-small-latest'] },
  'perplexity:simple':   { name: 'Simple prompt → Sonar', priority: 20, ui_name: 'Sonar', models: ['sonar'] },
  'anthropic:moderate':  { name: 'Standard prompt → Sonnet (balanced)', priority: 30, ui_name: 'Sonnet', models: ['claude-sonnet-5', 'claude-sonnet-4-20250514'] },
  'openai:moderate':     { name: 'Standard prompt → GPT-4o', priority: 30, ui_name: 'GPT-4o', models: ['gpt-4o'] },
  'google:moderate':     { name: 'Standard prompt → Gemini Thinking', priority: 30, ui_name: 'Thinking', models: ['gemini-3.7-flash', 'gemini-2.5-flash-thinking'] },
  'mistral:moderate':    { name: 'Standard prompt → Mistral Medium', priority: 30, ui_name: 'Medium', models: ['mistral-medium-latest'] },
  'perplexity:moderate': { name: 'Standard prompt → Sonar Pro', priority: 30, ui_name: 'Sonar Pro', models: ['sonar-pro'] },
  'anthropic:complex':   { name: 'Complex prompt → Opus (premium)', priority: 40, ui_name: 'Opus', models: ['claude-opus-5', 'claude-opus-4-20250514'] },
  'openai:complex':      { name: 'Complex prompt → GPT-4 (premium)', priority: 40, ui_name: 'GPT-4', models: ['gpt-4'] },
  'google:complex':      { name: 'Complex prompt → Gemini Pro', priority: 40, ui_name: 'Pro', models: ['gemini-2.5-pro'] },
  'mistral:complex':     { name: 'Complex prompt → Mistral Large', priority: 40, ui_name: 'Large', models: ['mistral-large-latest'] },
  'perplexity:complex':  { name: 'Complex prompt → Research', priority: 40, ui_name: 'Research', models: ['sonar-deep-research'] },
};

// The rules the OLD name-keyed seeder shipped. They are superseded by the
// per-tier set above, and they carry no ui_name, so they are retired — but ONLY
// while still pristine: an admin who has touched one owns it, and it is left
// where it is (and translated to v2 like any other admin rule). Matched on the
// mojibake and the fixed spelling, since both spellings exist in live data.
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

const sameList = (a, b) => {
  const x = Array.isArray(a) ? [...a].map(String).sort() : [];
  const y = Array.isArray(b) ? [...b].map(String).sort() : [];
  return x.join(',') === y.join(',');
};

/** True only for an untouched legacy seeded rule — never for admin-edited data. */
function isPristineLegacy(rule) {
  if (rule.builtin_key) return false;
  if (rule.schema_version === SCHEMA_VERSION) return false;
  if (!RETIRED_NAMES.includes(rule.name)) return false;
  if (rule.priority !== RETIRED_SHAPE.priority) return false;
  if (rule.enabled !== true) return false;
  if (!sameList(rule.conditions?.complexity, RETIRED_SHAPE.complexity)) return false;
  const a = rule.action || {};
  if (a.ui_name) return false;
  return RETIRED_SHAPE.models.includes(a.model);
}

/** True for a v1 built-in still exactly as we shipped it (enabled state aside). */
export function isPristineV1Builtin(rule) {
  if (rule.schema_version === SCHEMA_VERSION) return false;
  const shipped = SHIPPED_V1[rule.builtin_key];
  if (!shipped) return false;
  if (rule.name !== shipped.name || rule.priority !== shipped.priority) return false;
  const [provider, complexity] = rule.builtin_key.split(':');
  const c = rule.conditions || {};
  if (Object.keys(c).some((k) => !['provider', 'complexity'].includes(k))) return false;
  if (!sameList(c.provider, [provider]) || !sameList(c.complexity, [complexity])) return false;
  const a = rule.action || {};
  if (Object.keys(a).some((k) => !['ui_name', 'model'].includes(k))) return false;
  return a.ui_name === shipped.ui_name && shipped.models.includes(a.model);
}

const shippedFields = (r) => ({
  name: r.name,
  priority: r.priority,
  schema_version: r.schema_version,
  scope: structuredClone(r.scope),
  conditions: structuredClone(r.conditions),
  action: { ...r.action },
  mode: r.mode,
});

async function upsertOverrideIfAbsent(db, ov) {
  const col = db.collection('routing_catalog_overrides');
  const existing = await col.findOne({ provider: ov.provider, host_or_app: ov.host_or_app, tier: ov.tier });
  if (existing) return false;
  await col.insertOne({ id: crypto.randomUUID(), ...ov, source: 'v1_migration', created_at: new Date(), updated_at: new Date() });
  return true;
}

export async function seedDefaultRoutingRules(db) {
  const col = db.collection('routing_rules');
  const all = await col.find({}).project({ _id: 0 }).toArray();

  // 1. Retire pristine legacy defaults so the tab does not show two generations
  //    of built-ins describing the same routing.
  const stale = all.filter(isPristineLegacy);
  for (const rule of stale) {
    await col.deleteOne({ id: rule.id });
    console.log(`[seed] retired superseded routing rule: ${rule.name}`);
  }
  const live = all.filter((r) => !stale.includes(r));

  // 2. Migrate everything still on v1.
  const byKey = new Map(DEFAULT_RULES.map((r) => [r.builtin_key, r]));
  let migrated = 0;
  let translated = 0;
  let overrides = 0;
  for (const rule of live) {
    if (rule.schema_version === SCHEMA_VERSION) continue;
    if (isPristineV1Builtin(rule) && byKey.has(rule.builtin_key)) {
      // Whole-field $set, not dotted paths: the shipped fields replace the old
      // ones outright (the action loses its hard-coded ui_name/model), and the
      // Mongo test double does not implement dotted-path $set.
      await col.updateOne(
        { id: rule.id },
        { $set: { ...shippedFields(byKey.get(rule.builtin_key)), updated_at: new Date() } },
      );
      migrated++;
      continue;
    }
    const v2 = translateV1Rule(rule);
    const { _id, ...fields } = v2;
    await col.updateOne({ id: rule.id }, { $set: { ...fields, updated_at: new Date() } });
    translated++;
    const ov = catalogOverrideFor(v2);
    if (ov && await upsertOverrideIfAbsent(db, ov)) overrides++;
    console.log(`[seed] routing rule "${rule.name}" translated to schema v2`);
  }

  // 3. Insert any built-in this database has never had.
  const have = new Set(live.map((r) => r.builtin_key).filter(Boolean));
  const missing = DEFAULT_RULES.filter((r) => !have.has(r.builtin_key));
  if (missing.length) {
    const now = new Date();
    await col.insertMany(missing.map((r) => ({
      id: crypto.randomUUID(),
      builtin_key: r.builtin_key,
      enabled: r.enabled,
      ...shippedFields(r),
      created_at: now,
      updated_at: now,
    })));
    console.log(`[seed] routing rules inserted: ${missing.length}`);
  }
  return { inserted: missing.length, retired: stale.length, migrated, translated, overrides };
}
