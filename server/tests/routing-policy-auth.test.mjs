// GET /api/v1/routing/policy (machine-authenticated, ETag) and the auth on
// routing WRITES.
//
// POLICY. The extension and desktop agent poll this every minute, so it must
// answer 304 when nothing changed, and its version must move when anything a
// client acts on moves (rules, catalog overrides, settings, the fleet switch).
//
// WRITES. Every rule / endpoint / catalog / settings write was unauthenticated.
// There is no admin sign-in yet, so they go through requireReviewAuth — open by
// default (the dashboard must keep working), closed by ADMIN_AUTH_OPEN=false,
// exactly like the access-request queue. The closed case runs in a child
// process because auth.js reads the flag once at module load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { mountRouting } from '../src/routes/routing.js';
import { mountFeatureSettings } from '../src/routes/feature-settings.js';
import { seedDefaultRoutingRules } from '../src/seed-routing.js';
import { signMachineToken } from '../src/auth.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { adminJsonHeaders } from './helpers/admin-auth.mjs';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = signMachineToken({ machineId: 'm-policy', hostname: 'policy-host' });
const MACHINE = { authorization: `Bearer ${TOKEN}` };
const JSON_H = { 'content-type': 'application/json' };

async function withServer(fn) {
  const db = createFakeDb();
  await seedDefaultRoutingRules(db);
  const app = express();
  app.use(express.json());
  mountRouting(app, db);
  mountFeatureSettings(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, headers = {}) => fetch(`${base}${path}`, {
    method, headers: { ...JSON_H, ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  try { return await fn({ db, call }); } finally { await new Promise((r) => server.close(r)); }
}

// ── policy ──────────────────────────────────────────────────────────────────

test('policy requires a machine token', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('GET', '/api/v1/routing/policy')).status, 401);
    assert.equal((await call('GET', '/api/v1/routing/policy', undefined, adminJsonHeaders())).status, 401,
      'the admin token is not a machine token');
  });
});

test('policy returns the documented shape', async () => {
  await withServer(async ({ call }) => {
    const res = await call('GET', '/api/v1/routing/policy', undefined, MACHINE);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(res.headers.get('etag'), `"${body.version}"`);
    assert.match(body.version, /^[0-9a-f]{16}$/);
    assert.equal(body.schema_version, 2);
    assert.equal(body.rules.length, 15);
    // respect_user_override is opt-in since 2026-10-07: a manual model switch
    // no longer stops routing for the conversation unless an admin turns it on.
    assert.deepEqual(body.settings, { allow_upgrade: true, respect_user_override: false });
    assert.deepEqual(body.catalog_overrides, []);
    assert.equal(body.fleet_enabled, true);
    assert.ok(body.generated_at);
    const r = body.rules[0];
    for (const k of ['id', 'name', 'enabled', 'priority', 'schema_version', 'builtin_key', 'scope', 'conditions', 'action', 'mode']) {
      assert.ok(k in r, `rule missing ${k}`);
    }
    for (const k of ['created_at', 'updated_at', 'migrated_from_v1', '_id']) assert.ok(!(k in r), `rule leaks ${k}`);
    const prios = body.rules.map((x) => x.priority);
    assert.deepEqual(prios, [...prios].sort((a, b) => a - b), 'sorted by priority');
  });
});

test('If-None-Match on the current version answers 304; any change moves it', async () => {
  await withServer(async ({ call }) => {
    const first = await call('GET', '/api/v1/routing/policy', undefined, MACHINE);
    const etag = first.headers.get('etag');
    const again = await call('GET', '/api/v1/routing/policy', undefined, { ...MACHINE, 'if-none-match': etag });
    assert.equal(again.status, 304);

    const changes = [
      () => call('PUT', '/api/v1/routing/settings', { allow_upgrade: false }),
      () => call('PUT', '/api/v1/routing/catalog-overrides', { provider: 'anthropic', tier: 'economy', label: 'Haiku 5' }),
      () => call('POST', '/api/v1/routing/rules', {
        name: 'Research → premium', priority: 5, conditions: { complexity: ['complex'] },
        action: { type: 'set_tier', target_tier: 'premium', effort: 'high' },
      }),
      () => call('PUT', '/api/v1/features', { features: { model_routing: false } }, adminJsonHeaders()),
    ];
    let prev = etag;
    for (const change of changes) {
      const w = await change();
      assert.ok(w.status < 300, `write failed: ${w.status} ${await w.text()}`);
      const res = await call('GET', '/api/v1/routing/policy', undefined, { ...MACHINE, 'if-none-match': prev });
      assert.equal(res.status, 200, 'a change must not 304');
      const next = res.headers.get('etag');
      assert.notEqual(next, prev);
      prev = next;
    }
    const last = await (await call('GET', '/api/v1/routing/policy', undefined, MACHINE)).json();
    assert.equal(last.fleet_enabled, false);
    assert.equal(last.settings.allow_upgrade, false);
    assert.equal(last.settings.respect_user_override, false, 'a PUT of another key must not persist the old default');
    assert.deepEqual(last.catalog_overrides, [{ provider: 'anthropic', host_or_app: '*', tier: 'economy', label: 'Haiku 5' }]);
  });
});

test('policy omits disabled rules and filters by ?surface', async () => {
  await withServer(async ({ call, db }) => {
    await call('POST', '/api/v1/routing/rules', {
      name: 'Sensitive → private', priority: 1, scope: { surfaces: ['api_proxy'] },
      conditions: { sensitivity: ['critical'] }, action: { type: 'set_tier', model: 'gpt-4o' },
    });
    const one = db._rows('routing_rules')[0];
    await call('PUT', `/api/v1/routing/rules/${one.id}`, { enabled: false });

    const all = await (await call('GET', '/api/v1/routing/policy', undefined, MACHINE)).json();
    assert.ok(!all.rules.some((r) => r.id === one.id), 'disabled rule served');
    const browser = await (await call('GET', '/api/v1/routing/policy?surface=browser', undefined, MACHINE)).json();
    assert.ok(!browser.rules.some((r) => r.name === 'Sensitive → private'));
    const proxy = await (await call('GET', '/api/v1/routing/policy?surface=api_proxy', undefined, MACHINE)).json();
    assert.ok(proxy.rules.some((r) => r.name === 'Sensitive → private'));
    assert.equal((await call('GET', '/api/v1/routing/policy?surface=toaster', undefined, MACHINE)).status, 400);
  });
});

// ── rules: validation + legacy read ─────────────────────────────────────────

test('rule writes are validated', async () => {
  await withServer(async ({ call }) => {
    const bad = [
      { name: 'x', action: { type: 'teleport' } },
      { name: 'x', action: { type: 'set_tier', target_tier: 'platinum' } },
      { name: 'x', action: { type: 'set_tier', target_tier: 'economy', effort: 'max' } },
      { name: 'x', action: { type: 'set_tier' } },
      { name: 'x', mode: 'yolo', action: { type: 'none' } },
      { name: 'x', scope: { surfaces: ['fax'] }, action: { type: 'none' } },
      { name: 'x', conditions: { complexity: ['hard'] }, action: { type: 'none' } },
      { action: { type: 'none' } },
    ];
    for (const body of bad) {
      assert.equal((await call('POST', '/api/v1/routing/rules', body)).status, 400, JSON.stringify(body));
    }
  });
});

test('a v1-shaped POST from an older dashboard is translated, not stored untyped', async () => {
  await withServer(async ({ call, db }) => {
    const res = await call('POST', '/api/v1/routing/rules', {
      name: 'Old form', priority: 50, enabled: true, conditions: { complexity: ['simple'] }, action: { model: 'gpt-4o-mini' },
    });
    assert.equal(res.status, 201);
    const row = db._rows('routing_rules').find((r) => r.name === 'Old form');
    assert.equal(row.action.type, 'set_tier');
    assert.equal(row.action.target_tier, 'economy');
    assert.equal(row.schema_version, 2);
  });
});

test('a partial PUT preserves fields it did not send, including unknown ones', async () => {
  await withServer(async ({ call, db }) => {
    const r = db._rows('routing_rules').find((x) => x.builtin_key === 'anthropic:simple');
    await db.collection('routing_rules').updateOne({ id: r.id }, { $set: { conditions: { ...r.conditions, prompt_tokens_gt: 10 } } });
    assert.equal((await call('PUT', `/api/v1/routing/rules/${r.id}`, { name: 'Renamed' })).status, 200);
    const after = db._rows('routing_rules').find((x) => x.id === r.id);
    assert.equal(after.name, 'Renamed');
    assert.equal(after.conditions.prompt_tokens_gt, 10);
    assert.deepEqual(after.action, r.action);
    assert.deepEqual(after.scope, r.scope);
    assert.equal((await call('PUT', '/api/v1/routing/rules/nope', { name: 'x' })).status, 404);
  });
});

test('GET /routing/rules (legacy) projects v1 labels; ?schema=2 returns stored docs', async () => {
  await withServer(async ({ call }) => {
    const legacy = await (await call('GET', '/api/v1/routing/rules')).json();
    const haiku = legacy.find((r) => r.builtin_key === 'anthropic:simple');
    assert.equal(haiku.action.ui_name, 'Haiku');
    assert.equal(haiku.action.model, 'claude-haiku-4-5');
    const raw = await (await call('GET', '/api/v1/routing/rules?schema=2')).json();
    const rawHaiku = raw.find((r) => r.builtin_key === 'anthropic:simple');
    assert.equal(rawHaiku.action.ui_name, undefined);
    assert.equal(rawHaiku.action.target_tier, 'economy');
  });
});

test('the removed endpoints are gone', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('POST', '/api/v1/routing/decide', { host: 'api.openai.com' })).status, 404);
    assert.equal((await call('POST', '/api/v1/routing/log', [{}])).status, 404);
  });
});

// ── write auth ──────────────────────────────────────────────────────────────

test('writes are open by default (review gate), so the dashboard works unconfigured', async () => {
  await withServer(async ({ call }) => {
    const res = await call('POST', '/api/v1/routing/rules', {
      name: 'Open default', action: { type: 'set_tier', target_tier: 'standard' },
    });
    assert.equal(res.status, 201);
  });
});

test('ADMIN_AUTH_OPEN=false closes every routing write and leaves policy/reads alone', () => {
  const script = `
    import express from 'express';
    const { mountRouting } = await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, 'src/routes/routing.js')).href)});
    const { createFakeDb } = await import(${JSON.stringify(pathToFileURL(join(SERVER_DIR, 'tests/helpers/fake-db.mjs')).href)});
    const db = createFakeDb();
    await db.collection('routing_rules').insertOne({ id: 'r1', name: 'x', enabled: true, priority: 1, schema_version: 2, action: { type: 'none' } });
    await db.collection('routing_endpoints').insertOne({ id: 'e1', name: 'x', provider: 'openai', enabled: true });
    const app = express(); app.use(express.json()); mountRouting(app, db);
    const server = app.listen(0); await new Promise((r) => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const H = { 'content-type': 'application/json' };
    const A = { ...H, authorization: 'Bearer dev-admin-token' };
    const writes = [
      ['POST', '/api/v1/routing/rules', { name: 'n', action: { type: 'none' } }],
      ['PUT', '/api/v1/routing/rules/r1', { enabled: false }],
      ['DELETE', '/api/v1/routing/rules/r1'],
      ['POST', '/api/v1/routing/endpoints', { name: 'n', provider: 'openai' }],
      ['PUT', '/api/v1/routing/endpoints/e1', { enabled: false }],
      ['DELETE', '/api/v1/routing/endpoints/e1'],
      ['PUT', '/api/v1/routing/catalog-overrides', { provider: 'openai', tier: 'economy', label: 'mini' }],
      ['DELETE', '/api/v1/routing/catalog-overrides/x'],
      ['PUT', '/api/v1/routing/settings', { allow_upgrade: false }],
    ];
    const out = { anon: [], admin: [], reads: [] };
    for (const [m, p, b] of writes) {
      const r = await fetch(base + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
      out.anon.push(r.status);
    }
    for (const [m, p, b] of writes) {
      const r = await fetch(base + p, { method: m, headers: A, body: b ? JSON.stringify(b) : undefined });
      out.admin.push(r.status);
    }
    for (const p of ['/api/v1/routing/rules', '/api/v1/routing/analytics', '/api/v1/routing/settings', '/api/v1/routing/catalog-overrides']) {
      out.reads.push((await fetch(base + p)).status);
    }
    server.close();
    console.log('RESULT' + JSON.stringify(out));
  `;
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: SERVER_DIR, env: { ...process.env, ADMIN_AUTH_OPEN: 'false' }, encoding: 'utf8', timeout: 60_000,
  });
  const line = (child.stdout || '').split('\n').find((l) => l.startsWith('RESULT'));
  assert.ok(line, `child failed: ${child.stderr}`);
  const out = JSON.parse(line.slice(6));
  assert.ok(out.anon.every((s) => s === 401), `anonymous writes must be refused: ${out.anon}`);
  assert.ok(out.admin.every((s) => s < 300), `the admin token must still write: ${out.admin}`);
  assert.ok(out.reads.every((s) => s === 200), `reads stay open: ${out.reads}`);
});
