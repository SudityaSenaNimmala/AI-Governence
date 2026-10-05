// Built-in routing rule seeding + the schema v2 migration.
//
// THE ORIGINAL REGRESSION THIS PINS DOWN. The seeder used the rule NAME as its
// identity; a cosmetic encoding fix to "→" made it insert a second copy of each
// built-in. Identity is `builtin_key`, which no cosmetic edit can change.
//
// THE MIGRATION (schema v2). A v1 rule named a concrete picker label + model id;
// a v2 rule names a tier (economy / standard / premium) and an effort level.
// Pristine v1 built-ins are rewritten to the shipped v2 rule; anything an admin
// touched is TRANSLATED, keeping their label as action.ui_name and recording it
// as a catalog override. Both must be idempotent: a v2 rule is never touched again.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedDefaultRoutingRules, DEFAULT_RULES, isPristineV1Builtin } from '../src/seed-routing.js';
import { inferTier, toLegacyView } from '../src/lib/routing-schema.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const rowsOf = (db) => db._rows('routing_rules');
const overridesOf = (db) => db._rows('routing_catalog_overrides');
const byKey = (db, key) => rowsOf(db).find((r) => r.builtin_key === key);

// ── fresh install ────────────────────────────────────────────────────────────

test('a fresh database gets the full v2 built-in set, once', async () => {
  const db = createFakeDb();
  const first = await seedDefaultRoutingRules(db);

  assert.equal(first.inserted, DEFAULT_RULES.length);
  assert.equal(rowsOf(db).length, 15);
  for (const r of rowsOf(db)) {
    assert.equal(r.schema_version, 2);
    assert.equal(r.mode, 'enforce');
    assert.equal(r.action.type, 'set_tier');
    assert.ok(['economy', 'standard', 'premium'].includes(r.action.target_tier));
    assert.equal(r.action.model, undefined, 'built-ins must not hard-code a model id any more');
    assert.equal(r.action.ui_name, undefined, 'built-ins must not hard-code a picker label any more');
    assert.deepEqual(r.scope.surfaces, ['browser', 'desktop_app', 'api_proxy']);
  }
  for (const provider of ['anthropic', 'openai', 'google', 'mistral', 'perplexity']) {
    assert.equal(byKey(db, `${provider}:simple`).action.target_tier, 'economy');
    assert.equal(byKey(db, `${provider}:simple`).action.effort, 'low');
    assert.equal(byKey(db, `${provider}:moderate`).action.target_tier, 'standard');
    assert.equal(byKey(db, `${provider}:moderate`).action.effort, undefined);
    assert.equal(byKey(db, `${provider}:complex`).action.target_tier, 'premium',
      'demanding prompts must route UP, not only down');
    assert.equal(byKey(db, `${provider}:complex`).action.effort, 'high');
  }
});

test('re-seeding is a no-op — this is the duplicate bug', async () => {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const snapshot = JSON.stringify(rowsOf(db));
  const second = await seedDefaultRoutingRules(db);
  assert.deepEqual(
    { inserted: second.inserted, migrated: second.migrated, translated: second.translated },
    { inserted: 0, migrated: 0, translated: 0 });
  assert.equal(JSON.stringify(rowsOf(db)), snapshot);
});

test('renaming or disabling a v2 built-in survives a restart', async () => {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const t = byKey(db, 'google:simple');
  await db.collection('routing_rules').updateOne({ id: t.id }, { $set: { name: 'mine', enabled: false } });
  await seedDefaultRoutingRules(db);
  assert.equal(byKey(db, 'google:simple').name, 'mine');
  assert.equal(byKey(db, 'google:simple').enabled, false);
  assert.equal(rowsOf(db).length, 15);
});

// ── v1 → v2: pristine built-ins ─────────────────────────────────────────────

function v1Builtin(builtin_key, name, ui_name, model, priority, extra = {}) {
  return {
    id: `old-${builtin_key}`, builtin_key, name, enabled: true, priority,
    conditions: { provider: [builtin_key.split(':')[0]], complexity: [builtin_key.split(':')[1]] },
    action: { ui_name, model },
    created_at: new Date('2025-06-01'), updated_at: new Date('2025-06-01'),
    ...extra,
  };
}
const OPUS_V1 = (extra) => v1Builtin('anthropic:complex', 'Complex prompt → Opus (premium)', 'Opus', 'claude-opus-5', 40, extra);

test('a pristine v1 built-in is rewritten to the shipped v2 rule in place', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(OPUS_V1());
  const r = await seedDefaultRoutingRules(db);

  assert.equal(r.migrated, 1);
  assert.equal(r.translated, 0);
  const row = byKey(db, 'anthropic:complex');
  assert.equal(row.id, 'old-anthropic:complex', 'rewritten in place, not replaced');
  const shipped = DEFAULT_RULES.find((x) => x.builtin_key === 'anthropic:complex');
  assert.equal(row.name, shipped.name);
  assert.deepEqual(row.action, { type: 'set_tier', target_tier: 'premium', effort: 'high' });
  assert.equal(row.schema_version, 2);
  assert.equal(overridesOf(db).length, 0, 'a shipped label is not a customisation');
  assert.equal(rowsOf(db).filter((x) => x.builtin_key === 'anthropic:complex').length, 1);
});

test('pristine includes every model id a built-in has ever shipped with', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertMany([
    OPUS_V1({ id: 'a', action: { ui_name: 'Opus', model: 'claude-opus-4-20250514' } }),
    v1Builtin('google:moderate', 'Standard prompt → Gemini Thinking', 'Thinking', 'gemini-2.5-flash-thinking', 30),
  ]);
  const r = await seedDefaultRoutingRules(db);
  assert.equal(r.migrated, 2);
});

test('a disabled pristine built-in is migrated but stays disabled', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(OPUS_V1({ enabled: false }));
  await seedDefaultRoutingRules(db);
  const row = byKey(db, 'anthropic:complex');
  assert.equal(row.schema_version, 2);
  assert.equal(row.enabled, false, 'a migration must not re-enable a rule the admin turned off');
});

// ── v1 → v2: admin-edited rules ─────────────────────────────────────────────

test('an admin-relabelled built-in is translated, label kept + recorded as catalog override', async () => {
  const db = createFakeDb();
  const mine = OPUS_V1({ action: { ui_name: 'Opus 4.6', model: 'claude-opus-4-6' } });
  assert.equal(isPristineV1Builtin(mine), false);
  await db.collection('routing_rules').insertOne(mine);

  const r = await seedDefaultRoutingRules(db);
  assert.equal(r.translated, 1);
  assert.equal(r.overrides, 1);
  const row = byKey(db, 'anthropic:complex');
  assert.equal(row.name, 'Complex prompt → Opus (premium)', 'admin name kept');
  assert.equal(row.action.type, 'set_tier');
  assert.equal(row.action.target_tier, 'premium');
  assert.equal(row.action.ui_name, 'Opus 4.6');
  assert.equal(row.action.model, 'claude-opus-4-6');
  assert.equal(row.mode, 'enforce');
  assert.deepEqual(row.migrated_from_v1.action, { ui_name: 'Opus 4.6', model: 'claude-opus-4-6' });
  assert.deepEqual(overridesOf(db).map(({ provider, host_or_app, tier, label }) => ({ provider, host_or_app, tier, label })),
    [{ provider: 'anthropic', host_or_app: '*', tier: 'premium', label: 'Opus 4.6' }]);
  assert.equal(rowsOf(db).filter((x) => x.builtin_key === 'anthropic:complex').length, 1,
    'the translated built-in must still block re-insertion of the shipped one');
});

test('an admin-reprioritised built-in keeps its priority and model', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(OPUS_V1({ priority: 5 }));
  const r = await seedDefaultRoutingRules(db);
  assert.equal(r.translated, 1);
  const row = byKey(db, 'anthropic:complex');
  assert.equal(row.priority, 5);
  assert.equal(row.action.model, 'claude-opus-5');
  assert.equal(overridesOf(db).length, 0, 'label equals the shipped default — no override');
});

test('an admin custom rule is translated with an inferred tier', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne({
    id: 'custom-1', name: 'Cheap for long chats', enabled: true, priority: 15,
    conditions: { provider: ['openai'], prompt_tokens_gt: 5000 },
    action: { model: 'gpt-4.1-mini' },
  });
  await seedDefaultRoutingRules(db);
  const row = rowsOf(db).find((x) => x.id === 'custom-1');
  assert.equal(row.schema_version, 2);
  assert.equal(row.action.target_tier, 'economy');
  assert.equal(row.conditions.prompt_tokens_gt, 5000, 'unknown conditions are preserved');
  assert.deepEqual(row.scope.surfaces, ['browser', 'desktop_app', 'api_proxy']);
});

test('a sensitivity-only rule is scoped to api_proxy', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne({
    id: 'sens-1', name: 'Critical → private endpoint', enabled: true, priority: 1,
    conditions: { sensitivity: ['critical', 'high'] },
    action: { model: 'gpt-4o', host: 'acme.openai.azure.com' },
  });
  await seedDefaultRoutingRules(db);
  const row = rowsOf(db).find((x) => x.id === 'sens-1');
  assert.deepEqual(row.scope.surfaces, ['api_proxy'],
    'forcing a model on every sensitive prompt in a browser picker is not what this rule meant');
  assert.equal(row.action.host, 'acme.openai.azure.com');
});

test('the migration is idempotent and never overwrites an existing catalog override', async () => {
  const db = createFakeDb();
  await db.collection('routing_catalog_overrides').insertOne({
    id: 'ov', provider: 'anthropic', host_or_app: '*', tier: 'premium', label: 'Admin set this',
  });
  await db.collection('routing_rules').insertOne(OPUS_V1({ action: { ui_name: 'Opus 4.6', model: 'claude-opus-4-6' } }));
  await seedDefaultRoutingRules(db);
  const after1 = JSON.stringify(rowsOf(db));
  const second = await seedDefaultRoutingRules(db);
  assert.equal(second.translated, 0);
  assert.equal(second.migrated, 0);
  assert.equal(JSON.stringify(rowsOf(db)), after1);
  assert.equal(overridesOf(db).length, 1);
  assert.equal(overridesOf(db)[0].label, 'Admin set this');
});

// ── pristine legacy (name-keyed) rules ──────────────────────────────────────

const legacy = (name, model) => ({
  id: 'legacy-' + model, name, enabled: true, priority: 10,
  conditions: { complexity: ['simple', 'moderate'], provider: ['google'] },
  action: { model },
});

test('pristine legacy defaults are retired, including the mojibake spelling', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(legacy('Auto-optimize: Google non-complex → Gemini Flash', 'gemini-2.0-flash'));
  await db.collection('routing_rules').insertOne(legacy('Auto-optimize: OpenAI non-complex ? GPT-4o-mini', 'gpt-4o-mini'));
  const r = await seedDefaultRoutingRules(db);
  assert.equal(r.retired, 2);
  assert.equal(rowsOf(db).length, DEFAULT_RULES.length);
});

test('an admin-edited legacy rule is kept and translated, not deleted', async () => {
  const db = createFakeDb();
  const edited = legacy('Auto-optimize: Google non-complex → Gemini Flash', 'gemini-2.0-flash');
  edited.priority = 5;
  await db.collection('routing_rules').insertOne(edited);
  const r = await seedDefaultRoutingRules(db);
  assert.equal(r.retired, 0);
  const row = rowsOf(db).find((x) => x.id === edited.id);
  assert.ok(row, 'an edited rule was deleted');
  assert.equal(row.schema_version, 2);
  assert.equal(row.action.target_tier, 'standard'); // gemini flash
});

// ── helpers ─────────────────────────────────────────────────────────────────

test('inferTier reads common lineup names', () => {
  const cases = {
    'claude-haiku-4-5': 'economy', 'gpt-4o-mini': 'economy', 'o3-mini': 'economy', Sonar: 'economy',
    'gemini-2.5-flash-lite': 'economy', 'claude-sonnet-5': 'standard', 'gpt-4o': 'standard',
    'Sonar Pro': 'standard', Thinking: 'standard', 'claude-opus-5': 'premium', 'gemini-2.5-pro': 'premium',
    'GPT-4': 'premium', 'mistral-large-latest': 'premium', 'sonar-deep-research': 'premium',
  };
  for (const [name, tier] of Object.entries(cases)) assert.equal(inferTier(name), tier, name);
  assert.equal(inferTier('something-unknown'), null);
});

test('the legacy /rules view gives a v2 built-in a clickable v1 label and model', async () => {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const legacyRow = toLegacyView(byKey(db, 'anthropic:simple'), []);
  assert.equal(legacyRow.action.ui_name, 'Haiku');
  assert.equal(legacyRow.action.model, 'claude-haiku-4-5');
  const withOverride = toLegacyView(byKey(db, 'anthropic:simple'),
    [{ provider: 'anthropic', host_or_app: '*', tier: 'economy', label: 'Haiku 5' }]);
  assert.equal(withOverride.action.ui_name, 'Haiku 5');
  const observe = toLegacyView({ ...byKey(db, 'anthropic:simple'), mode: 'observe' }, []);
  assert.equal(observe.enabled, false, 'a v1 client would ENFORCE an observe-only rule');
});
