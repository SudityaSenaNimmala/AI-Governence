// THE ROUTER CONFIG MUST FIT IN ONE WINDOWS ENVIRONMENT VARIABLE.
//
// enforcer.js passes JSON.stringify(buildModelRouterConfig()) to the desktop
// enforcer as the CFAI_MODEL_ROUTER_CONFIG environment variable. Windows caps
// ONE environment variable at 32,767 characters. On 2026-10-07 the Gemini
// "Extended thinking" catalog entry (e583b58) took the payload to 34,372 chars;
// the enforcer spawn failed, the helper crash-looped and nothing was routed or
// blocked until both that change and its follow-up were reverted (98632ab).
//
// This pins the SHIPPED part of the payload -- the lexicon, the shared catalog
// and the desktop app keys -- under 30,000 chars, leaving headroom below the
// hard limit. The admin's cached routing policy (~/.cloudfuze-aigov/
// routing-policy.json) is added at spawn time on top of this; it is machine
// data, so this test runs with an empty home directory to stay deterministic.
//
// If this fails: do NOT raise the budget. Shrink what you added (or move the
// payload out of the environment in its own reviewed change).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// os.homedir() reads USERPROFILE on Windows and HOME elsewhere. Set both
// BEFORE the module loads (it resolves the policy path at import time); each
// node --test file runs in its own process, so nothing else is affected.
const EMPTY_HOME = mkdtempSync(join(tmpdir(), 'cfai-router-size-'));
process.env.USERPROFILE = EMPTY_HOME;
process.env.HOME = EMPTY_HOME;

const HERE = dirname(fileURLToPath(import.meta.url));
const { buildModelRouterConfig, loadCachedRoutingPolicy } = await import(
  pathToFileURL(join(HERE, '..', 'src', 'os_monitor', 'model-router-config.js')).href);

const WINDOWS_ENV_VAR_MAX = 32_767;
const BUDGET = 30_000;

test('CFAI_MODEL_ROUTER_CONFIG (shipped part) stays under 30,000 chars -- Windows caps one env var at 32,767', (t) => {
  assert.equal(loadCachedRoutingPolicy(), null, 'the test must not see a real cached routing policy');
  const cfg = buildModelRouterConfig();
  assert.equal(cfg.policy, null);
  const size = JSON.stringify(cfg).length;
  t.diagnostic(`router config ${size} chars; budget ${BUDGET}; Windows env-var limit ${WINDOWS_ENV_VAR_MAX}; `
    + `left for the admin policy before the hard limit: ${WINDOWS_ENV_VAR_MAX - size}`);
  const parts = Object.entries(cfg).map(([k, v]) => `${k}=${JSON.stringify(v ?? null).length}`).join(', ');
  assert.ok(size < BUDGET,
    `JSON.stringify(buildModelRouterConfig()) is ${size} chars (budget ${BUDGET}). It is passed to the enforcer `
    + `as the CFAI_MODEL_ROUTER_CONFIG environment variable, which Windows caps at ${WINDOWS_ENV_VAR_MAX} chars `
    + `(plus the admin's routing policy on top). Exceeding it made the enforcer spawn fail and crash-loop on `
    + `2026-10-07 (34,372 chars after the Gemini Extended-thinking catalog entry) -- no routing, no blocking. `
    + `Shrink the change; do not raise this budget. Sizes by key: ${parts}`);
});
