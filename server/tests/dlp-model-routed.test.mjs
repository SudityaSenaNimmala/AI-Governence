// model_routed events (routing v2) through POST /api/v1/dlp.
//
// The browser extension and desktop agent report every routing decision here,
// and these events are the ONLY real record the Model Routing analytics read.
// What is asserted:
//   - the v2 fields are kept, each validated (enum / short id / short label /
//     number) and DROPPED — not truncated — when malformed;
//   - a routing event can never carry prompt content: there is no free-text
//     field in the allowlist, and content_text sent alongside is not stored;
//   - routing_result is a top-level column ('applied' counts as routed), with
//     legacy ui_changed:true mapped to 'applied'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountDlp, routingMetaFields } from '../src/routes/dlp.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';

const TOKEN = signMachineToken({ machineId: 'machine-route-1', hostname: 'route-host' });

async function withServer(fn) {
  const db = createFakeDb();
  const app = express();
  app.use(express.json());
  mountDlp(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (events) => fetch(`${base}/api/v1/dlp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ events }),
  });
  try { return await fn({ db, post }); } finally { await new Promise((r) => server.close(r)); }
}

const V2 = {
  kind: 'model_routed', service: 'Claude', occurredAt: '2026-10-01T10:00:00.000Z', tabHost: 'claude.ai',
  mechanism: 'browser_extension', surface: 'browser', host_or_app: 'claude.ai', provider: 'anthropic',
  from_tier: 'premium', from_label: 'Opus 5', to_tier: 'economy', to_label: 'Haiku 4.5',
  model: 'claude-haiku-4-5', complexity: 'simple', rule_id: 'anthropic:simple-rule-1',
  result: 'applied', reason: 'picker_switched', effort_from: 'high', effort_to: 'low', len: 42,
};

test('every v2 routing field is stored in metadata, and routing_result is a column', async () => {
  await withServer(async ({ db, post }) => {
    assert.equal((await post([V2])).status, 201);
    const row = db._rows('dlp_events')[0];
    const m = JSON.parse(row.metadata_json);
    for (const k of ['mechanism', 'surface', 'host_or_app', 'provider', 'from_tier', 'from_label',
      'to_tier', 'to_label', 'model', 'complexity', 'rule_id', 'result', 'reason', 'effort_from', 'effort_to', 'len']) {
      assert.deepEqual(m[k], V2[k], k);
    }
    assert.equal(row.routing_result, 'applied');
    assert.equal(row.event_kind, 'model_routed');
  });
});

test('malformed values are dropped, never truncated or coerced', () => {
  const out = routingMetaFields({
    mechanism: 'telepathy', surface: 'mainframe', from_tier: 'ultra', result: 'maybe',
    effort_to: 'max', complexity: 'hard', provider: 'Anthropic Inc!', model: 'claude haiku; drop',
    rule_id: 'x'.repeat(65), reason: 'The user typed: my SSN is 123-45-6789', from_label: 'x'.repeat(81),
    len: -1, to_label: { $ne: null }, host_or_app: ['claude.ai'],
  });
  assert.deepEqual(out, {});
  assert.equal(routingMetaFields({ len: 1e12 }).len, 10_000_000, 'len is clamped');
  assert.equal(routingMetaFields({ len: '42' }).len, undefined, 'len must be a number');
});

test('a routing event never stores prompt content, even if a client sends it', async () => {
  await withServer(async ({ db, post }) => {
    await post([{ ...V2, content_text: 'my secret prompt', prompt: 'my secret prompt', text: 'my secret prompt' }]);
    assert.equal(db._rows('dlp_content').length, 0, 'content stored for a routing event');
    assert.ok(!db._rows('dlp_events')[0].metadata_json.includes('my secret prompt'));
  });
});

test('legacy events still work: ui_changed true → applied, false → no result', async () => {
  await withServer(async ({ db, post }) => {
    const legacy = {
      kind: 'model_routed', service: 'ChatGPT', occurredAt: '2026-10-01T10:00:00.000Z', tabHost: 'chatgpt.com',
      routed_ui_name: 'GPT-4o mini', rule_name: 'Simple prompt → GPT-4o mini', complexity: 'simple',
      current_tier: 'premium', provider: 'openai',
    };
    await post([{ ...legacy, ui_changed: true }, { ...legacy, ui_changed: false }]);
    const [a, b] = db._rows('dlp_events');
    assert.equal(a.routing_result, 'applied');
    assert.equal('routing_result' in b, false);
    const m = JSON.parse(a.metadata_json);
    assert.equal(m.routed_model, 'GPT-4o mini');
    assert.equal(m.rule_name, 'Simple prompt → GPT-4o mini');
    assert.equal(m.ui_changed, true);
    assert.equal(m.tab_host, 'chatgpt.com');
  });
});

test('an explicit v2 result wins over legacy ui_changed', async () => {
  await withServer(async ({ db, post }) => {
    await post([{ ...V2, result: 'user_override', ui_changed: true }]);
    assert.equal(db._rows('dlp_events')[0].routing_result, 'user_override');
  });
});
