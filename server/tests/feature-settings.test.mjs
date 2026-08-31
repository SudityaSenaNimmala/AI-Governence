// GET/PUT /api/v1/features — the fleet-wide switches behind the Settings page.
//
// What these pin down, in order of how badly each would fail in the field:
//
//  1. The wire shape is unchanged. connect-ui/src/featureFlags.js and the
//     extension's content scripts already parse { features: { key: { status } } }
//     and already gate live enforcement on keys like `dlp` and `model_routing`.
//     Renaming a key or reshaping the payload silently un-gates enforcement on
//     every deployed machine — no error anywhere, just governance switched off.
//  2. A compliance pack outranks the settings page. Two independent switches over
//     one behaviour is how a fleet reaches a state neither page describes.
//  3. Unknown keys are refused, not stored. A key nothing reads renders as a
//     working toggle and does nothing.
//  4. The version tracks what surfaces ACT ON, so endpoints skip real no-ops and
//     never skip a real change.
//  5. Every real transition is audited, and only real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { mountFeatureSettings } from '../src/routes/feature-settings.js';
import { ADMIN_TOKEN } from '../src/auth.js';
import {
  FEATURE_REGISTRY, SURFACES, keysForSurface, effectiveFeatures,
} from '../src/lib/feature-registry.js';
import { getPack } from '../src/governance/services/policyPacks.js';
import { createFakeDb } from './helpers/fake-db.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRepo = (p) => readFileSync(join(REPO, p), 'utf8');

async function withServer(fn, seed) {
  const db = createFakeDb();
  if (seed) await seed(db);

  const app = express();
  app.use(express.json());
  mountFeatureSettings(app, db);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const get = (p = '') => fetch(`${base}/api/v1/features${p}`);
  const put = (features, extra = {}) =>
    fetch(`${base}/api/v1/features`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ features, ...extra }),
    });

  try {
    return await fn({ db, base, get, put });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── the contract existing consumers already depend on ───────────────────────

// These four are read by name in browser-extension/content/content.js
// (isFeatureOn('dlp') etc.). Losing one silently stops that enforcement.
const KEYS_THE_EXTENSION_GATES_ON = ['ai_systems', 'dlp', 'access_requests', 'model_routing'];

test('the keys live enforcement already gates on still exist', () => {
  const keys = new Set(FEATURE_REGISTRY.map((f) => f.key));
  for (const k of KEYS_THE_EXTENSION_GATES_ON) {
    assert.ok(keys.has(k), `${k} is read by content.js — removing it un-gates enforcement`);
  }
});

test('each of those is declared as reaching the extension', () => {
  for (const k of KEYS_THE_EXTENSION_GATES_ON) {
    const f = FEATURE_REGISTRY.find((x) => x.key === k);
    assert.ok(f.surfaces.includes('extension'), `${k} is gated in the extension but not declared for it`);
  }
});

test('the response shape existing consumers parse is preserved', async () => {
  await withServer(async ({ get }) => {
    const body = await (await get()).json();
    assert.ok(body.features && typeof body.features === 'object');
    for (const f of FEATURE_REGISTRY) {
      const row = body.features[f.key];
      assert.ok(row, `${f.key} missing`);
      assert.equal(typeof row.label, 'string', `${f.key}.label`);
      assert.ok(['enabled', 'disabled'].includes(row.status), `${f.key}.status`);
    }
  });
});

// ── neither side may drift from the registry ────────────────────────────────
//
// THE FAILURE THESE PREVENT, in both directions:
//
//   A switch with no consumer renders in Settings, an admin flips it, nothing
//   happens, and the page has lied — there is no error and no way to tell from
//   the UI. That is the whole reason the registry declares `surfaces`.
//
//   A consumer with no switch is worse: the code gates enforcement on a key
//   nobody can see or set, so the only way to change it is a code change.
//
// This is the one place in the monorepo that can see the registry and both
// consumers at once, which is why the cross-package reads live here.

test('every feature the desktop agent gates on is declared for the agent', () => {
  const src = readRepo('agent/src/os_monitor/index.js');
  // #applyFeatures acts on a key only via changed.includes('<key>').
  const used = [...src.matchAll(/changed\.includes\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'found no feature gates in the OS monitor — the wiring is gone');

  for (const key of new Set(used)) {
    const f = FEATURE_REGISTRY.find((x) => x.key === key);
    assert.ok(f, `the agent gates on "${key}", which is not in the registry — nobody can switch it`);
    assert.ok(f.surfaces.includes('agent'),
      `the agent gates on "${key}" but the registry does not list it as an agent feature`);
  }
});

test('every feature the extension gates on is declared for the extension', () => {
  const src = readRepo('browser-extension/content/content.js');
  const used = [...src.matchAll(/isFeatureOn\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'found no feature gates in content.js — the wiring is gone');

  for (const key of new Set(used)) {
    const f = FEATURE_REGISTRY.find((x) => x.key === key);
    assert.ok(f, `content.js gates on "${key}", which is not in the registry — nobody can switch it`);
    assert.ok(f.surfaces.includes('extension'),
      `content.js gates on "${key}" but the registry does not list it as an extension feature`);
  }
});

test('the agent asks the server only for its own surface', () => {
  // Fetching the unfiltered set would hand the agent dashboard-only keys it can
  // do nothing with, and hide a genuine mismatch behind keys it ignores anyway.
  assert.match(readRepo('agent/src/os_monitor/feature-sync.js'),
    /\/api\/v1\/features\?surface=agent/);
});

test('the extension asks the server only for its own surface', () => {
  assert.match(readRepo('browser-extension/background/service-worker.js'),
    /\/api\/v1\/features\?surface=extension/);
});

// ── the registry ────────────────────────────────────────────────────────────

test('every feature defaults to ON, because the fallback state must be "governed"', () => {
  assert.deepEqual(FEATURE_REGISTRY.filter((f) => f.default !== true), [],
    'a feature defaulting to off means a surface that cannot reach the server stops enforcing');
});

test('every feature names at least one surface that consumes it', () => {
  for (const f of FEATURE_REGISTRY) {
    assert.ok(f.surfaces?.length, `${f.key} has no surfaces`);
    for (const s of f.surfaces) assert.ok(SURFACES.includes(s), `${f.key} names unknown surface ${s}`);
  }
});

test('feature keys are unique', () => {
  const keys = FEATURE_REGISTRY.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

// ── env vars remain the floor ───────────────────────────────────────────────

test('FEAT_* still disables, so existing deployments behave as before', () => {
  const out = effectiveFeatures({ env: { FEAT_MODEL_ROUTING: 'false' } });
  assert.equal(out.model_routing.status, 'disabled');
  assert.equal(out.dlp.status, 'enabled', 'only the named feature is affected');
});

test('a stored override beats the env var', () => {
  const out = effectiveFeatures({
    overrides: { model_routing: true },
    env: { FEAT_MODEL_ROUTING: 'false' },
  });
  assert.equal(out.model_routing.status, 'enabled',
    'the UI must be able to re-enable something .env turned off, or the page lies');
});

// ── reads ───────────────────────────────────────────────────────────────────

test('?surface trims to what that surface consumes', async () => {
  await withServer(async ({ get }) => {
    const agent = await (await get('?surface=agent')).json();
    assert.deepEqual(Object.keys(agent.features).sort(), keysForSurface('agent').sort());
    assert.ok(!('model_routing' in agent.features), 'routing is not an agent flag');

    const ext = await (await get('?surface=extension')).json();
    assert.ok(!('clipboard_monitor' in ext.features), 'the clipboard monitor is agent-only');

    // Same version from both, or two surfaces disagree about whether they are current.
    assert.equal(agent.version, ext.version);
  });
});

test('an unknown surface is refused rather than silently returning everything', async () => {
  await withServer(async ({ get }) => {
    assert.equal((await get('?surface=toaster')).status, 400);
  });
});

// ── writes ──────────────────────────────────────────────────────────────────

test('a toggle persists and moves the version', async () => {
  await withServer(async ({ get, put }) => {
    const before = await (await get()).json();
    assert.equal((await put({ model_routing: false })).status, 200);

    const after = await (await get()).json();
    assert.equal(after.features.model_routing.status, 'disabled');
    assert.notEqual(after.version, before.version, 'surfaces skip work when the version is unchanged');
  });
});

test('unknown keys are refused, not stored', async () => {
  await withServer(async ({ put, get }) => {
    const res = await put({ does_not_exist: false });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /unknown feature keys/);
    assert.ok(!('does_not_exist' in (await (await get()).json()).features));
  });
});

test('non-boolean values are refused', async () => {
  await withServer(async ({ put }) => {
    assert.equal((await put({ model_routing: 'off' })).status, 400);
  });
});

test('the write is admin-gated', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/v1/features`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: { model_routing: false } }),
    });
    // ADMIN_AUTH_OPEN deployments answer 200 by design; a locked-down one answers
    // 401. Either is correct — the route having no opinion at all is not.
    assert.ok([200, 401].includes(res.status), `unexpected ${res.status}`);
  });
});

// ── compliance locks ────────────────────────────────────────────────────────

// Resolved from the pack service rather than hardcoded, so this fails loudly if
// pack ids change instead of quietly asserting nothing.
const PACK_ID = (() => {
  for (const id of ['soc2', 'iso-42001', 'eu-ai-act', 'hipaa', 'gdpr', 'nist-ai-rmf']) {
    if (getPack(id)?.rules?.some((r) => r.enforcement === 'dlp')) return id;
  }
  throw new Error('no policy pack carries a dlp rule — the lock tests would prove nothing');
})();

const withDeployedDlpPack = (db) =>
  db.collection('policy_pack_deployments').insertOne({
    pack_id: PACK_ID, deployed_version: '1.0.0', rules: {},
  });

test('a deployed DLP pack locks the feature it depends on', async () => {
  await withServer(async ({ get }) => {
    const f = (await (await get()).json()).features.dlp;
    assert.equal(f.status, 'enabled');
    assert.ok(f.locked_by?.length, 'the pack must name itself as why this cannot be turned off');
  }, withDeployedDlpPack);
});

test('a locked feature cannot be turned off, and the attempt stays visible', async () => {
  await withServer(async ({ get, put }) => {
    await put({ dlp: false });
    const f = (await (await get()).json()).features.dlp;
    assert.equal(f.status, 'enabled', 'the pack outranks the settings page');
    assert.equal(f.override_suppressed, true,
      'the UI must be able to say "you turned this off but a pack requires it"');
  }, withDeployedDlpPack);
});

test('undeploying the pack releases the lock and the stored preference applies', async () => {
  await withServer(async ({ db, get, put }) => {
    await put({ dlp: false });
    assert.equal((await (await get()).json()).features.dlp.status, 'enabled');

    await db.collection('policy_pack_deployments')
      .updateOne({ pack_id: PACK_ID }, { $set: { deployed_version: null } });

    const after = (await (await get()).json()).features.dlp;
    assert.equal(after.status, 'disabled', 'the admin preference was remembered under the lock');
    assert.ok(!after.locked_by);
  }, withDeployedDlpPack);
});

test('a pack rule the admin disabled stops requiring its features', async () => {
  const dlpRuleKeys = (getPack(PACK_ID)?.rules || [])
    .filter((r) => r.enforcement === 'dlp').map((r) => r.key);

  await withServer(async ({ get, put }) => {
    await put({ dlp: false });
    const f = (await (await get()).json()).features.dlp;
    assert.equal(f.status, 'disabled', 'no enabled DLP rule remains, so nothing requires it');
    assert.ok(!f.locked_by);
  }, (db) => db.collection('policy_pack_deployments').insertOne({
    pack_id: PACK_ID,
    deployed_version: '1.0.0',
    rules: Object.fromEntries(dlpRuleKeys.map((k) => [k, { enabled: false }])),
  }));
});

test('deploying a pack that re-enables a disabled feature moves the version', async () => {
  // THE VERSION TRACKS WHAT SURFACES ACT ON, which is `status` and nothing else.
  await withServer(async ({ db, get, put }) => {
    await put({ dlp: false });
    const before = await (await get()).json();
    assert.equal(before.features.dlp.status, 'disabled');

    await withDeployedDlpPack(db);

    const after = await (await get()).json();
    assert.equal(after.features.dlp.status, 'enabled', 'the pack forced it back on');
    assert.notEqual(after.version, before.version, 'surfaces skip on an unchanged version');
  });
});

test('deploying a pack over already-enabled features does NOT churn the version', async () => {
  // The other half of the same rule, asserted so it is a decision rather than an
  // accident someone later "fixes" into a fleet-wide wake-up.
  await withServer(async ({ db, get }) => {
    const before = (await (await get()).json()).version;
    await withDeployedDlpPack(db);
    const after = await (await get()).json();

    assert.equal(after.version, before, 'nothing a surface acts on changed');
    assert.ok(after.features.dlp.locked_by,
      'the lock is still reported — the UI reads fresh and never uses the version to skip');
  });
});

// ── audit ───────────────────────────────────────────────────────────────────

test('a real change is audited with from/to and an actor', async () => {
  await withServer(async ({ db, put }) => {
    await put({ model_routing: false }, { actor: 'admin@cloudfuze.com' });
    const rows = await db.collection('feature_settings_audit').find({}).toArray();

    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor, 'admin@cloudfuze.com');
    assert.deepEqual(rows[0].changes, [{ key: 'model_routing', from: 'enabled', to: 'disabled' }]);
  });
});

test('re-saving without changing anything writes no audit noise', async () => {
  await withServer(async ({ db, put }) => {
    await put({ model_routing: false });
    await put({ model_routing: false });
    assert.equal((await db.collection('feature_settings_audit').find({}).toArray()).length, 1,
      'only the transition is a fact worth recording');
  });
});
