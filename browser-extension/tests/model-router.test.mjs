// Regression coverage for detectModelInfo() — the function that reads an AI
// site's model-selector button text and decides which provider/tier it is.
//
// WHY THIS FILE EXISTS. Google renamed Gemini's consumer lineup from
// Flash/Pro/Ultra to Flash/Thinking/Pro. detectModelInfo() had no case for
// "thinking" at all, so a Gemini account showing "3.6 Thinking" (the current
// default) was unrecognised — detectModelInfo returned null, and smartRoute's
// very first line (`if (!current) return null;`) meant the router silently
// did nothing for ANY prompt, simple or complex, with no error anywhere.
// Nothing in this suite caught it because nothing tested detectModelInfo
// against real, current button text — only against the OLD Flash/Pro/Ultra
// names. These tests pin the real strings Gemini's UI is showing today.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDetectModelInfo, tierUiNameFor } from './load-model-router.mjs';

const detectModelInfo = loadDetectModelInfo();

test('Gemini: "3.6 Thinking" (the current default) is recognised', () => {
  assert.deepEqual(detectModelInfo('3.6 Thinking'), { provider: 'google', tier: 'standard' });
});

test('Gemini: "3.6 Flash" is economy', () => {
  assert.deepEqual(detectModelInfo('3.6 Flash'), { provider: 'google', tier: 'economy' });
});

test('Gemini: "3.1 Pro" is premium, not standard — Pro moved up when Thinking was inserted', () => {
  assert.deepEqual(detectModelInfo('3.1 Pro'), { provider: 'google', tier: 'premium' });
});

test('Gemini: "Ultra" still resolves (legacy/back-compat), and lands on the same tier as Pro', () => {
  assert.deepEqual(detectModelInfo('Ultra'), { provider: 'google', tier: 'premium' });
});

test('an unrecognised label returns null rather than guessing', () => {
  assert.equal(detectModelInfo('Custom Model 42'), null);
});

test('other providers are untouched by the Gemini fix', () => {
  assert.deepEqual(detectModelInfo('Claude Opus'), { provider: 'anthropic', tier: 'premium' });
  assert.deepEqual(detectModelInfo('Claude Sonnet'), { provider: 'anthropic', tier: 'standard' });
  assert.deepEqual(detectModelInfo('Claude Haiku'), { provider: 'anthropic', tier: 'economy' });
  assert.deepEqual(detectModelInfo('GPT-4o mini'), { provider: 'openai', tier: 'economy' });
  assert.deepEqual(detectModelInfo('GPT-4o'), { provider: 'openai', tier: 'standard' });
  assert.deepEqual(detectModelInfo('GPT-4'), { provider: 'openai', tier: 'premium' });
});

// ── the router's other half: TIER_UI_NAME must agree with detectModelInfo ──
//
// smartRoute picks a TARGET tier number, then looks up TIER_UI_NAME[provider]
// [number] to know what to click. If that map disagrees with what
// detectModelInfo would call the SAME label, the router can point at a label
// whose own tier isn't what the router thinks it is. This is a genuine
// round-trip property, not just a snapshot of the current three names.

test('TIER_UI_NAME.google round-trips through detectModelInfo for every tier', () => {
  const uiName = tierUiNameFor('google');
  const TIER_NAME = { 1: 'economy', 2: 'standard', 3: 'premium' };

  for (const [num, name] of Object.entries(uiName)) {
    const info = detectModelInfo(name);
    assert.ok(info, `TIER_UI_NAME.google[${num}] = '${name}' is not recognised by detectModelInfo at all`);
    assert.equal(info.tier, TIER_NAME[num],
      `TIER_UI_NAME.google[${num}] = '${name}' but detectModelInfo calls '${name}' tier '${info.tier}' — `
      + 'the router would ask for one tier and land on another');
  }
});

test('TIER_UI_NAME.google is the current three-tier lineup, not the retired one', () => {
  const uiName = tierUiNameFor('google');
  assert.deepEqual(uiName, { 1: 'Flash', 2: 'Thinking', 3: 'Pro' },
    'Gemini\'s tier ladder changed (Flash/Pro/Ultra -> Flash/Thinking/Pro) — '
    + 'if this fails because the lineup changed AGAIN, update the map and this pin together');
});
