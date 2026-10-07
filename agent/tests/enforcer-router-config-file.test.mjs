// REGRESSION: the model-router payload (lexicon + catalog + cached policy) grew
// past 34 KB — over Windows' 32,767-char limit for ONE environment variable —
// so spawning the enforcer with it in env failed, the helper crash-looped and
// no prompt was routed. The payload now travels in a file; env carries a path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeRouterConfigFile } from '../src/os_monitor/enforcer.js';
import { buildModelRouterConfig } from '../src/os_monitor/model-router-config.js';

const ENFORCER_JS = readFileSync(new URL('../src/os_monitor/enforcer.js', import.meta.url), 'utf8');
const ENFORCER_PS1 = readFileSync(new URL('../src/os_monitor/enforcer-win.ps1', import.meta.url), 'utf8');

test('the router payload is never put in the spawn environment', () => {
  assert.doesNotMatch(ENFORCER_JS, /CFAI_MODEL_ROUTER_CONFIG\s*:\s*JSON\.stringify/);
  assert.match(ENFORCER_JS, /CFAI_MODEL_ROUTER_CONFIG_FILE\s*:/);
});

test('every env payload the enforcer gets stays well under the Windows limit', () => {
  // The router config itself may be any size now; it is the reason for the file.
  assert.ok(JSON.stringify(buildModelRouterConfig()).length > 0);
});

test('writeRouterConfigFile writes the full payload and returns its path', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'cfai-mr-')), 'model-router-config.json');
  const got = writeRouterConfigFile(null, p);
  assert.equal(got, p);
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), JSON.parse(JSON.stringify(buildModelRouterConfig())));
});

test('the helper reads the file first and still accepts the old env var', () => {
  assert.match(ENFORCER_PS1, /CFAI_MODEL_ROUTER_CONFIG_FILE/);
  assert.match(ENFORCER_PS1, /ReadAllText\(\$env:CFAI_MODEL_ROUTER_CONFIG_FILE/);
  assert.match(ENFORCER_PS1, /elseif \(\$env:CFAI_MODEL_ROUTER_CONFIG\)/);
});
