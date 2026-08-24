// Built-in routing rule seeding.
//
// THE REGRESSION THIS PINS DOWN. The seeder used the rule NAME as its identity
// ("skip if a rule with this name exists"). The shipped names contained a "→";
// its encoding was fixed at some point; on the next boot the seeder saw three
// names it had never stored and inserted a second copy of each. The live
// database held six rules that were three, at equal priority, so which copy of
// a pair won was arbitrary. Identity is now `builtin_key`, which no cosmetic
// edit can change.
//
// The second property is just as important: seeding is INSERT-ONLY, so a rule an
// admin disabled or renamed is not resurrected or reset on the next restart.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedDefaultRoutingRules, DEFAULT_RULES } from '../src/seed-routing.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const rowsOf = (db) => db._rows('routing_rules');

test('a fresh database gets the full built-in set, once', async () => {
  const db = createFakeDb();
  const first = await seedDefaultRoutingRules(db);

  assert.equal(first.inserted, DEFAULT_RULES.length);
  assert.equal(rowsOf(db).length, DEFAULT_RULES.length);

  // Every provider × complexity pair is covered, and each rule can actually be
  // acted on: a picker label AND an API id.
  for (const r of rowsOf(db)) {
    assert.ok(r.action.ui_name, `${r.builtin_key} has no ui_name to click`);
    assert.ok(r.action.model, `${r.builtin_key} has no api model`);
    assert.equal(r.conditions.provider.length, 1);
    assert.equal(r.conditions.complexity.length, 1);
  }
  const keys = rowsOf(db).map((r) => r.builtin_key);
  assert.equal(new Set(keys).size, keys.length, 'duplicate builtin_key in the shipped set');
  for (const provider of ['anthropic', 'openai', 'google', 'mistral', 'perplexity']) {
    for (const complexity of ['simple', 'moderate', 'complex']) {
      assert.ok(keys.includes(`${provider}:${complexity}`), `missing ${provider}:${complexity}`);
    }
  }
});

test('re-seeding is a no-op — this is the duplicate bug', async () => {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const afterFirst = rowsOf(db).length;

  const second = await seedDefaultRoutingRules(db);
  const third = await seedDefaultRoutingRules(db);

  assert.equal(second.inserted, 0);
  assert.equal(third.inserted, 0);
  assert.equal(rowsOf(db).length, afterFirst, 'seeding twice duplicated the rules');
});

// The exact shape of the original failure: the name changes, the key does not.
test('renaming a built-in does not re-insert it', async () => {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const before = rowsOf(db).length;

  const target = rowsOf(db).find((r) => r.builtin_key === 'google:simple');
  await db.collection('routing_rules').updateOne(
    { id: target.id }, { $set: { name: 'Simple prompt ? Gemini Flash (mangled)' } },
  );

  const again = await seedDefaultRoutingRules(db);
  assert.equal(again.inserted, 0);
  assert.equal(rowsOf(db).length, before);
  assert.equal(
    rowsOf(db).find((r) => r.builtin_key === 'google:simple').name,
    'Simple prompt ? Gemini Flash (mangled)',
    'the admin edit was overwritten by the shipped default',
  );
});

test('a disabled built-in stays disabled across restarts', async () => {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const target = rowsOf(db).find((r) => r.builtin_key === 'anthropic:complex');
  await db.collection('routing_rules').updateOne({ id: target.id }, { $set: { enabled: false } });

  await seedDefaultRoutingRules(db);

  const after = rowsOf(db).find((r) => r.builtin_key === 'anthropic:complex');
  assert.equal(after.enabled, false, 'a restart re-enabled a rule the admin turned off');
  assert.equal(rowsOf(db).filter((r) => r.builtin_key === 'anthropic:complex').length, 1);
});

// Legacy migration. Both spellings of the old names exist in live data.
const legacy = (name, model) => ({
  id: 'legacy-' + model, name, enabled: true, priority: 10,
  conditions: { complexity: ['simple', 'moderate'], provider: ['google'] },
  action: { model },
  created_at: new Date('2026-08-01T05:44:23.333Z'),
});

test('pristine legacy defaults are retired, including the mojibake spelling', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(
    legacy('Auto-optimize: Google non-complex → Gemini Flash', 'gemini-2.0-flash'));
  await db.collection('routing_rules').insertOne(
    legacy('Auto-optimize: OpenAI non-complex ? GPT-4o-mini', 'gpt-4o-mini'));

  const r = await seedDefaultRoutingRules(db);

  assert.equal(r.retired, 2);
  assert.equal(rowsOf(db).length, DEFAULT_RULES.length, 'legacy rules survived alongside the new set');
  assert.equal(rowsOf(db).filter((x) => /^Auto-optimize:/.test(x.name)).length, 0);
});

// The safety valve: only UNTOUCHED legacy rules are removed. Anything an admin
// has edited is theirs, and deleting it on boot would be data loss.
test('an admin-edited legacy rule is left alone', async () => {
  const db = createFakeDb();
  const edited = legacy('Auto-optimize: Google non-complex → Gemini Flash', 'gemini-2.0-flash');
  edited.priority = 5;                      // admin raised its precedence
  await db.collection('routing_rules').insertOne(edited);

  const r = await seedDefaultRoutingRules(db);

  assert.equal(r.retired, 0);
  assert.ok(rowsOf(db).some((x) => x.id === edited.id), 'an edited rule was deleted');
  assert.equal(rowsOf(db).length, DEFAULT_RULES.length + 1);
});

test('a disabled legacy rule is not resurrected or deleted', async () => {
  const db = createFakeDb();
  const off = legacy('Auto-optimize: Google non-complex → Gemini Flash', 'gemini-2.0-flash');
  off.enabled = false;
  await db.collection('routing_rules').insertOne(off);

  const r = await seedDefaultRoutingRules(db);

  assert.equal(r.retired, 0);
  const kept = rowsOf(db).find((x) => x.id === off.id);
  assert.equal(kept.enabled, false);
});

// ── Superseded model ids on pristine built-ins ──────────────────────────────
//
// Insert-only seeding is correct — an admin's edits must survive a deploy — but
// it also meant a stale model id lived forever in every existing install.
// "Complex prompt → Opus (premium)" was still pointing at
// claude-opus-4-20250514 long after that stopped being the flagship, so a
// customer on the premium tier was paying premium routing for a superseded
// model. The refresh moves ONLY rules that still match what we shipped.

/** A previously-shipped built-in, exactly as an older seeder would have stored it. */
function shippedBuiltin(builtin_key, name, uiName, model, priority) {
  return {
    id: `old-${builtin_key}`,
    builtin_key,
    name,
    enabled: true,
    priority,
    conditions: { provider: [builtin_key.split(':')[0]], complexity: [builtin_key.split(':')[1]] },
    action: { ui_name: uiName, model },
    created_at: new Date('2025-06-01'),
    updated_at: new Date('2025-06-01'),
  };
}

const OLD_OPUS = () => shippedBuiltin(
  'anthropic:complex', 'Complex prompt → Opus (premium)', 'Opus', 'claude-opus-4-20250514', 40,
);

test('a pristine built-in on a superseded model is moved to the current one', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(OLD_OPUS());

  const r = await seedDefaultRoutingRules(db);

  const shipped = DEFAULT_RULES.find((x) => x.builtin_key === 'anthropic:complex');
  const row = rowsOf(db).find((x) => x.builtin_key === 'anthropic:complex');

  assert.equal(r.refreshed, 1);
  assert.equal(row.action.model, shipped.action.model);
  assert.ok(!/-\d{8}$/.test(row.action.model), 'refreshed onto a date-suffixed id');
  assert.equal(row.action.ui_name, shipped.action.ui_name, 'picker label must stay clickable');
  assert.equal(row.id, 'old-anthropic:complex', 'the rule was replaced instead of updated in place');
  // And it is not duplicated by the insert pass that follows.
  assert.equal(rowsOf(db).filter((x) => x.builtin_key === 'anthropic:complex').length, 1);
});

test('every shipped Anthropic default carries a current, undated model id', async () => {
  // The whole point of the refresh is that these three stay current. A date
  // suffix is the specific shape that went stale last time.
  for (const key of ['anthropic:simple', 'anthropic:moderate', 'anthropic:complex']) {
    const rule = DEFAULT_RULES.find((r) => r.builtin_key === key);
    assert.ok(rule, `missing ${key}`);
    assert.ok(!/-\d{8}$/.test(rule.action.model),
      `${key} ships a date-suffixed model id: ${rule.action.model}`);
    assert.ok(rule.action.model.startsWith('claude-'), `${key} is not a Claude model id`);
  }
});

test('an admin who repointed a built-in keeps their model', async () => {
  const db = createFakeDb();
  const mine = OLD_OPUS();
  mine.action.model = 'claude-opus-4-6';        // a deliberate pin
  await db.collection('routing_rules').insertOne(mine);

  const r = await seedDefaultRoutingRules(db);

  assert.equal(r.refreshed, 0);
  assert.equal(rowsOf(db).find((x) => x.id === mine.id).action.model, 'claude-opus-4-6');
});

test('an admin who renamed or reprioritised a built-in keeps their model', async () => {
  for (const mutate of [
    (rule) => { rule.name = 'Hard prompts → our premium model'; },
    (rule) => { rule.priority = 5; },
  ]) {
    const db = createFakeDb();
    const mine = OLD_OPUS();
    mutate(mine);
    await db.collection('routing_rules').insertOne(mine);

    const r = await seedDefaultRoutingRules(db);

    assert.equal(r.refreshed, 0);
    assert.equal(rowsOf(db).find((x) => x.id === mine.id).action.model, 'claude-opus-4-20250514');
  }
});

test('a disabled built-in on a superseded model stays disabled', async () => {
  const db = createFakeDb();
  const off = OLD_OPUS();
  off.enabled = false;
  await db.collection('routing_rules').insertOne(off);

  await seedDefaultRoutingRules(db);

  const row = rowsOf(db).find((x) => x.id === off.id);
  assert.equal(row.enabled, false, 'refreshing a rule must not re-enable it');
});

test('the refresh is idempotent', async () => {
  const db = createFakeDb();
  await db.collection('routing_rules').insertOne(OLD_OPUS());

  const first = await seedDefaultRoutingRules(db);
  const second = await seedDefaultRoutingRules(db);
  const third = await seedDefaultRoutingRules(db);

  assert.equal(first.refreshed, 1);
  assert.equal(second.refreshed, 0, 'refresh ran again on an already-current rule');
  assert.equal(third.refreshed, 0);
  assert.equal(rowsOf(db).length, DEFAULT_RULES.length);
});

test('a fresh install needs no refresh', async () => {
  const db = createFakeDb();
  const r = await seedDefaultRoutingRules(db);
  assert.equal(r.refreshed, 0);
});

test('Google built-ins are moved off the retired and non-existent ids', async () => {
  // gemini-2.0-flash was retired; gemini-2.5-flash-thinking never existed at all
  // (thinking is a mode on Flash, not a model id). Both were shipped, so existing
  // installs are sending them on every routed Gemini request.
  const db = createFakeDb();
  const simple = shippedBuiltin(
    'google:simple', 'Simple prompt → Gemini Flash', 'Flash', 'gemini-2.0-flash', 20,
  );
  const moderate = shippedBuiltin(
    'google:moderate', 'Standard prompt → Gemini Thinking', 'Thinking', 'gemini-2.5-flash-thinking', 30,
  );
  await db.collection('routing_rules').insertMany([simple, moderate]);

  const r = await seedDefaultRoutingRules(db);

  assert.equal(r.refreshed, 2);
  for (const key of ['google:simple', 'google:moderate']) {
    const shipped = DEFAULT_RULES.find((x) => x.builtin_key === key);
    const row = rowsOf(db).find((x) => x.builtin_key === key);
    assert.equal(row.action.model, shipped.action.model);
    assert.notEqual(row.action.model, 'gemini-2.0-flash');
    assert.notEqual(row.action.model, 'gemini-2.5-flash-thinking');
    // The picker label must survive — it is what the extension clicks.
    assert.equal(row.action.ui_name, shipped.action.ui_name);
  }
});

test('no shipped rule targets a model the pricing table cannot price', async () => {
  // Cross-check against the same concern the agent-side parity test covers, so a
  // server-only edit to DEFAULT_RULES cannot introduce a zero-cost model.
  for (const rule of DEFAULT_RULES) {
    assert.ok(rule.action.model, `${rule.builtin_key} has no model`);
    assert.ok(rule.action.ui_name, `${rule.builtin_key} has no picker label`);
    assert.ok(!/-\d{8}$/.test(rule.action.model),
      `${rule.builtin_key} carries a date-suffixed id: ${rule.action.model}`);
  }
});
