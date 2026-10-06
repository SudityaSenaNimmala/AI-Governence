// The desktop enforcer's C# PORT of shared/decide-route.js, held in LOCKSTEP
// with the canonical ES module, plus the enforcer behaviour built on it.
//
//   1. LOCKSTEP. Every case in shared/routing-decision-vectors.json (decision
//      cases and label-reading cases) is run through the C# port
//      (DrDecideRouteJson / DrDetectTierJson, compiled out of enforcer-win.ps1
//      by tests/helpers/routing-decide-harness.ps1) AND through
//      shared/decide-route.js. The vector's own `expect` must hold for the C#
//      output, and all eleven output fields must equal the ES module's — so a
//      behaviour change on either side without the other fails here.
//   2. NO-OP. Already on the target tier arms nothing (no pin, so Enter passes
//      through and the picker is never opened) — including the old bug where a
//      server rule's label was returned before any tier arithmetic.
//   3. CONFIG RELOAD. {"cmd":"router_policy"} replaces the policy in place; the
//      next decision follows it; a malformed line keeps the old one.
//   4. FLEET FLAG. The agent's fleet switch and the policy's fleet_enabled both
//      disable routing, silently (no event).
//   5. USER CHOICE / OVERRIDE. Our own switch never moves the user's choice; a
//      user switch back after a route suppresses that conversation, once.
//   6. EXTENSION OWNERSHIP. A browser the extension owns disarms the web arm;
//      the desktop arm is untouched.
// Plus the generated agent catalog must not drift from shared/model-catalog.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..');
const REPO = join(AGENT_DIR, '..');
const ENFORCER = join(AGENT_DIR, 'src', 'os_monitor', 'enforcer-win.ps1');
const HARNESS = join(HERE, 'helpers', 'routing-decide-harness.ps1');
const CATALOG_PATH = join(REPO, 'shared', 'model-catalog.json');
const VECTORS = JSON.parse(readFileSync(join(REPO, 'shared', 'routing-decision-vectors.json'), 'utf8'));
const CATALOG = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const esm = await import(pathToFileURL(join(REPO, 'shared', 'decide-route.js')).href);

const win = process.platform === 'win32';
const SKIP = { skip: win ? false : 'windows only (compiles the embedded C#)' };
const policyOf = (p) => (typeof p === 'string' ? VECTORS.policies[p] : p);
const FIELDS = ['target_tier', 'effort', 'rule_id', 'rule_name', 'mode', 'result', 'reason',
  'from_tier', 'to_label', 'click_labels', 'model'];

let cached = null;
function runHarness() {
  if (cached) return cached;
  cached = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfai-decide-'));
    const casesPath = join(dir, 'cases.ndjson');
    const lines = [];
    for (const c of VECTORS.cases) {
      lines.push(JSON.stringify({
        kind: 'decide', id: c.id,
        ctx: JSON.stringify(c.ctx ?? null),
        policy: JSON.stringify(policyOf(c.policy) ?? null),
      }));
    }
    VECTORS.label_detection.forEach((v, i) => {
      lines.push(JSON.stringify({
        kind: 'label', id: `label-${i}`, surface: v.surface, host: v.host_or_app,
        policy: v.policy ? JSON.stringify(policyOf(v.policy)) : '', text: v.text,
      }));
    });
    await writeFile(casesPath, lines.join('\n'), 'utf8');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', HARNESS, '-Ps1', ENFORCER, '-Catalog', CATALOG_PATH, '-Cases', casesPath,
      ], { windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        const rows = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
        if (!rows.some((r) => r.t === 'done')) {
          reject(new Error(`harness did not complete (exit ${code})\n${err}\n${out.slice(-4000)}`));
          return;
        }
        resolve(rows);
      });
    });
  })();
  return cached;
}

function pick(rows, t, val) {
  const hit = rows.filter((r) => r.t === t && r.case === val);
  assert.equal(hit.length, 1, `expected one ${t} row for ${val}, got ${hit.length}`);
  return hit[0];
}

// ══ 1. LOCKSTEP ═══════════════════════════════════════════════════════════

test('LOCKSTEP: every decision vector passes through the C# port, field-for-field with shared/decide-route.js', SKIP, async () => {
  const rows = await runHarness();
  const byId = new Map(rows.filter((r) => r.t === 'decide').map((r) => [r.id, JSON.parse(r.json)]));
  assert.equal(byId.size, VECTORS.cases.length, 'every vector must reach the C# port');
  assert.ok(byId.size >= 74, `the contract is 74+ decision cases, saw ${byId.size}`);
  for (const c of VECTORS.cases) {
    const cs = byId.get(c.id);
    for (const [k, v] of Object.entries(c.expect)) {
      assert.deepEqual(cs[k], v, `[C#] ${c.id}: ${k} expected ${JSON.stringify(v)} got ${JSON.stringify(cs[k])}\n  full: ${JSON.stringify(cs)}`);
    }
    const js = esm.decideRoute(c.ctx, policyOf(c.policy), CATALOG);
    for (const k of FIELDS) {
      assert.deepEqual(cs[k], js[k], `[C# vs JS] ${c.id}: ${k} C#=${JSON.stringify(cs[k])} JS=${JSON.stringify(js[k])}`);
    }
  }
});

test('LOCKSTEP: every label-reading vector gives the same tier in C# and JS', SKIP, async () => {
  const rows = await runHarness();
  const got = rows.filter((r) => r.t === 'label');
  assert.equal(got.length, VECTORS.label_detection.length);
  assert.ok(got.length >= 24);
  VECTORS.label_detection.forEach((v, i) => {
    const row = got.find((r) => r.id === `label-${i}`);
    const cs = row.tier === '' ? null : row.tier;
    assert.notEqual(row.tier, '<no-surface>', `no surface for ${v.host_or_app}`);
    assert.equal(cs, v.tier, `[C#] ${JSON.stringify(v.text)} on ${v.host_or_app}`);
    const entry = esm.resolveSurface(CATALOG, v.surface, v.host_or_app, v.policy ? policyOf(v.policy) : null, null);
    assert.equal(cs, esm.detectTierFromLabel(entry, v.text), `[C# vs JS] ${JSON.stringify(v.text)}`);
  });
});

test('LOCKSTEP: the C# port also agrees with JS on garbage input (never throws, same answer)', SKIP, async () => {
  // Driven through the same harness entry point by a tiny second run.
  const dir = await mkdtemp(join(tmpdir(), 'cfai-decide-g-'));
  const casesPath = join(dir, 'cases.ndjson');
  const garbage = [
    [null, null], [{}, {}], [{ surface: 'browser' }, 'nonsense'],
    [{ surface: 'browser', host_or_app: 'claude.ai', current_tier: 'premium', complexity: 'simple' }, { rules: 'x' }],
    [{ surface: 'browser', host_or_app: 'claude.ai', current_tier: 7, complexity: 'simple' }, [null, 1, 'a']],
    [{ surface: 'browser', host_or_app: 'claude.ai', current_tier: 'premium', complexity: 'simple' }, { rules: [null, 1, 'a', { action: null }] }],
    [{ surface: 'desktop', host_or_app: 'CLAUDE_DESKTOP', current_tier: 3, complexity: 'SIMPLE', provider: 'Anthropic' }, null],
    [{ surface: 'browser', host_or_app: 'www.Gemini.Google.com', current_tier: 'standard', complexity: 'simple' }, { rules: [{ id: 5, priority: 1.5, conditions: {}, action: { type: 'set_tier', target_tier: 2 } }] }],
  ];
  await writeFile(casesPath, garbage.map(([ctx, policy], i) => JSON.stringify({
    kind: 'decide', id: `g${i}`, ctx: JSON.stringify(ctx), policy: JSON.stringify(policy),
  })).join('\n'), 'utf8');
  const rows = await new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', HARNESS, '-Ps1', ENFORCER, '-Catalog', CATALOG_PATH, '-Cases', casesPath], { windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', () => {
      const r = out.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
      if (!r.some((x) => x.t === 'done')) reject(new Error(err + out)); else resolve(r);
    });
  });
  garbage.forEach(([ctx, policy], i) => {
    const cs = JSON.parse(rows.find((r) => r.t === 'decide' && r.id === `g${i}`).json);
    const js = esm.decideRoute(ctx, policy, CATALOG);
    for (const k of FIELDS) assert.deepEqual(cs[k], js[k], `g${i}: ${k} C#=${JSON.stringify(cs[k])} JS=${JSON.stringify(js[k])}`);
  });
});

test('the generated agent catalog is exactly shared/model-catalog.json (no drift)', async () => {
  const { MODEL_CATALOG } = await import(pathToFileURL(join(AGENT_DIR, 'src', 'os_monitor', 'model-catalog.generated.js')).href);
  assert.deepEqual(MODEL_CATALOG, CATALOG,
    'agent/src/os_monitor/model-catalog.generated.js is stale — run `node scripts/gen-shared-routing.mjs`');
  const gen = await import(pathToFileURL(join(REPO, 'scripts', 'gen-shared-routing.mjs')).href);
  const onDisk = (await readFile(join(AGENT_DIR, 'src', 'os_monitor', 'model-catalog.generated.js'), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal(onDisk, gen.buildAgentCatalogModule().replace(/\r\n/g, '\n'));
});

test('the router config carries the shared catalog and no retired label table', async () => {
  const { buildModelRouterConfig, DESKTOP_APP_KEYS } = await import(pathToFileURL(join(AGENT_DIR, 'src', 'os_monitor', 'model-router-config.js')).href);
  const cfg = buildModelRouterConfig();
  assert.deepEqual(cfg.catalog, CATALOG);
  assert.equal('tierUiNames' in cfg, false, 'the hand-ported label table (with Gemini Flash/Thinking/Pro) is gone');
  assert.equal('serverRules' in cfg, false, 'rules now travel as cfg.policy');
  assert.ok('policy' in cfg);
  assert.equal(DESKTOP_APP_KEYS.claude, 'claude_desktop');
  // Gemini's labels are the catalog's measured lineup.
  const g = cfg.catalog.hosts['gemini.google.com'].tiers;
  assert.deepEqual([g.economy.click_labels[0], g.standard.click_labels[0], g.premium.click_labels[0]],
    ['3.5 Flash-Lite', '3.8 Flash', '3.1 Pro']);
});

// ══ 2. NO-OP ══════════════════════════════════════════════════════════════

test('NO-OP: already on the target tier arms nothing and leaves a noop note for the send', SKIP, async () => {
  const rows = await runHarness();
  assert.equal(pick(rows, 'tierof', 'desktop_sonnet').tier, 'standard');
  // Gemini: the catalog reads Flash as STANDARD (the keyword chain said economy).
  assert.equal(pick(rows, 'tierof', 'gemini_flash').tier, 'standard');
  assert.equal(pick(rows, 'tierof', 'gemini_flash_lite').tier, 'economy');
  assert.equal(pick(rows, 'tierof', 'desktop_app_key').key, 'claude_desktop');

  for (const c of ['desktop_noop_moderate_on_sonnet', 'desktop_noop_rule_label_same_tier']) {
    const r = pick(rows, 'pin', c);
    assert.equal(r.armedDecision, false, `${c}: nothing may be armed`);
    assert.equal(r.pinArmed, false, `${c}: an earlier pin must be cleared, so Enter is not swallowed`);
    const note = JSON.parse(r.note);
    assert.equal(note.result, 'noop');
    assert.equal(note.reason, 'already_on_target');
    assert.equal(note.from_tier, 'standard');
    assert.equal(note.surface, 'desktop_app');
    assert.equal(note.host_or_app, 'claude_desktop');
    assert.equal(note.len, 42);
  }
  assert.equal(pick(rows, 'reload', 'rule_label_policy_applied').applied, true);
  // The rule's id travels on the note.
  assert.equal(JSON.parse(pick(rows, 'pin', 'desktop_noop_rule_label_same_tier').note).rule_id, 'r-label');
});

test('NO-OP: a real change still arms, with catalog labels most-specific first', SKIP, async () => {
  const rows = await runHarness();
  const d = pick(rows, 'pin', 'desktop_routes_simple_to_haiku');
  assert.equal(d.armedDecision, true);
  assert.equal(d.toTier, 'economy');
  assert.deepEqual(d.clickLabels, ['Haiku 4.5', 'Haiku']);
  assert.equal(d.note, '', 'an armed route reports through its route thread, not a note');
  const g = pick(rows, 'pin', 'web_gemini_simple_from_flash');
  assert.equal(g.armedDecision, true);
  assert.deepEqual(g.clickLabels, ['3.5 Flash-Lite', 'Flash-Lite']);
  // Effort-only: no effort setter has a live pass, so it is a noop, not a route.
  const e = pick(rows, 'pin', 'desktop_effort_only_not_armed');
  assert.equal(e.armedDecision, false);
  assert.equal(JSON.parse(e.note).reason, 'effort_unverified');
});

test('NO-OP SOURCE: RunRoute refuses an already-on-target route before it ever expands the picker', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const start = src.indexOf('    static void RunRoute(string routeId');
  const body = src.slice(start, src.indexOf('    // ════ AI-216: THE WEB ROUTE', start));
  const guard = body.indexOf('"already_on_target"');
  const expand = body.indexOf('expandPattern.Expand()');
  assert.ok(guard > 0 && expand > 0 && guard < expand, 'the already-on-target refusal must precede Expand()');
  // The legacy shortcut that returned a rule label before any tier arithmetic is gone.
  const code = src.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  assert.equal(/ServerRuleUiName|ComputeRoute\(|ComputeWebRoute\(|UpdateCeiling\(/.test(code), false);
});

// ══ 3. CONFIG RELOAD ══════════════════════════════════════════════════════

test('CONFIG RELOAD: router_policy replaces the policy in place; malformed keeps the old one', SKIP, async () => {
  const rows = await runHarness();
  const v2 = pick(rows, 'reload', 'v2_applied');
  assert.equal(v2.applied, true);
  assert.equal(v2.dedupReset, true, 'decisions made under the old policy must be recomputed');
  const after = pick(rows, 'pin', 'reload_rule_now_applies');
  assert.equal(after.armedDecision, true);
  assert.equal(after.toTier, 'standard', 'the new rule (simple stays on Sonnet) must apply immediately');
  assert.equal(pick(rows, 'reload', 'malformed_refused').applied, false);
  assert.equal(pick(rows, 'reload', 'truncated_refused').applied, false);
  assert.equal(pick(rows, 'pin', 'reload_kept_after_malformed').toTier, 'standard', 'a bad line must not drop the policy');
  assert.equal(pick(rows, 'reload', 'legacy_array_applied').applied, true);
  const legacy = pick(rows, 'pin', 'legacy_array_routes');
  assert.equal(legacy.toTier, 'economy');
  // A v1 ui_name the catalog recognises goes AFTER the catalog's own labels.
  assert.deepEqual(legacy.clickLabels, ['Haiku 4.5', 'Haiku']);
});

test('CONFIG RELOAD SOURCE: the helper takes router_policy / router_fleet / routing_owner on stdin', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const loop = src.slice(src.indexOf('static void StdinLoop()'), src.indexOf('static void PumpLoop()'));
  assert.match(loop, /cmd == "router_policy"/);
  assert.match(loop, /ApplyRouterPolicyLine\(line\);/);
  assert.match(loop, /cmd == "router_fleet"/);
  assert.match(loop, /cmd == "routing_owner"/);
  assert.match(loop, /ApplyRoutingOwner\(ExtractJsonString\(line, "process"\), ExtractJsonNumber\(line, "ttl_ms", 0\)\);/);
});

// ══ 4. FLEET FLAG ═════════════════════════════════════════════════════════

test('FLEET: the agent fleet switch and policy.fleet_enabled both disable routing, with no event', SKIP, async () => {
  const rows = await runHarness();
  for (const c of ['fleet_off_agent_flag', 'fleet_off_policy']) {
    const r = pick(rows, 'pin', c);
    assert.equal(r.armedDecision, false, `${c}: nothing armed`);
    assert.equal(r.pinArmed, false, `${c}: an existing pin is cleared`);
    assert.equal(r.note, '', `${c}: disabled routing reports nothing at all`);
  }
  assert.equal(pick(rows, 'pin', 'fleet_back_on').armedDecision, true);
});

// ══ 5. USER CHOICE / OVERRIDE ═════════════════════════════════════════════

test('USER CHOICE: only user-initiated picker changes move it; switching back after a route is an override, once', SKIP, async () => {
  const rows = await runHarness();
  const t = (c) => pick(rows, 'track', c);
  assert.equal(t('seed_first_reading').userTier, 'premium', 'the first reading is the user\'s own choice');
  const ours = t('our_switch_not_user_choice');
  assert.equal(ours.overridden, false);
  assert.equal(ours.userTier, 'premium', 'OUR route must never move the user\'s choice (the old ratchet did)');
  const back = t('user_switches_back');
  assert.equal(back.overridden, true);
  assert.equal(back.routedTier, 'economy');
  assert.equal(back.userTier, 'premium');
  const o = pick(rows, 'override', 'conv_suppressed');
  assert.equal(o.overridden, true);
  assert.equal(o.other, false, 'only THAT conversation is suppressed');
  const sup = pick(rows, 'pin', 'override_suppresses_routing');
  assert.equal(sup.armedDecision, false);
  assert.equal(sup.note, '', 'the override is reported once, when it happens — not on every send');
  assert.equal(pick(rows, 'pin', 'other_conversation_still_routes').armedDecision, true);
});

// ══ 6. EXTENSION OWNERSHIP ════════════════════════════════════════════════

test('OWNERSHIP: a browser the extension owns disarms the web arm only', SKIP, async () => {
  const rows = await runHarness();
  const o = pick(rows, 'owner', 'chrome_owned');
  assert.equal(o.chrome, true);
  assert.equal(o.chromeExe, true);
  assert.equal(o.edge, false, 'ownership is per browser');
  assert.equal(o.claude, false, 'a desktop app is never extension-owned');
  const cap = pick(rows, 'owner', 'ttl_capped');
  assert.equal(cap.badRejected, true);
  assert.equal(cap.cappedOk, true, 'ttl is capped at 120s');
  assert.equal(pick(rows, 'owner', 'released').edge, false);

  const owned = pick(rows, 'webarm', 'owned_stands_down');
  assert.equal(owned.pinArmed, false, 'an owned browser clears any pin');
  assert.equal(owned.reachedWebArm, false, 'and never reaches the picker search');
  const free = pick(rows, 'webarm', 'not_owned_proceeds');
  assert.equal(free.reachedWebArm, true, 'without ownership the web arm runs as before');
});

test('OWNERSHIP SOURCE: the gate sits in the browser arm, after the surface gate, before the picker', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  const routing = src.slice(src.indexOf('static void UpdateModelRouting()'), src.indexOf('static void UpdateWebModelRouting('));
  const browserArm = routing.slice(routing.indexOf('if (ForegroundIsBrowser())'), routing.indexOf('Everything below is the DESKTOP'));
  assert.match(browserArm, /if \(RoutingOwnedByExtension\(_app\)\) \{ ClearPendingRoute\(\); return; \}/);
  assert.ok(browserArm.indexOf('RoutingOwnedByExtension') < browserArm.indexOf('UpdateWebModelRouting('));
  const desktopArm = routing.slice(routing.indexOf('Everything below is the DESKTOP'));
  assert.equal(/RoutingOwnedByExtension/.test(desktopArm), false, 'the desktop-app arm is never affected');
});

test('PRIVACY SOURCE: the decision note and the override event carry no prompt content', async () => {
  const src = await readFile(ENFORCER, 'utf8');
  for (const sig of ['static void SetRouteNote(', 'static void EmitUserOverride(', 'static string RouteMetaFields(']) {
    const start = src.indexOf(sig);
    assert.ok(start > 0, sig);
    const body = src.slice(start, src.indexOf('\n    }', start));
    const code = body.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    for (const forbidden of ['originalText', 'ReadText', '_browserUrl', 'Title', 'FocusedElement']) {
      assert.equal(new RegExp(`\\b${forbidden}\\b`).test(code), false, `${sig} must not carry ${forbidden}`);
    }
    assert.equal(/\btext\b/.test(code), false, `${sig} must not see prompt text`);
  }
});
