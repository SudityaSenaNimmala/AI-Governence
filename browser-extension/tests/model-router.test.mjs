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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadDetectModelInfo, contentSource } from './load-model-router.mjs';

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

// ── the router's other half: which label to CLICK for a tier ──────────────
//
// This used to be content.js's TIER_UI_NAME table, round-tripped through
// detectModelInfo here. It went stale anyway (ChatGPT GPT-4/4o/4o mini, Gemini
// Flash/Thinking/Pro) while the live pickers moved on, and the keyword chain
// cannot even tell Gemini's 3.8 Flash from 3.5 Flash-Lite. Click labels and read
// patterns now live in shared/model-catalog.json and are round-tripped with the
// shared boundary matcher in tests/shared-routing.test.mjs.

test('content.js no longer carries its own tier/label tables', () => {
  const src = contentSource();
  for (const gone of ['const TIER_UI_NAME', 'const ROUTE_TABLE', 'const PLATFORM_TIERS', 'function smartRoute',
    'function serverRuleFor', 'cfai-route-model', 'cfai.user_ceiling']) {
    assert.ok(!src.includes(gone), `content.js still contains ${gone}`);
  }
  assert.ok(src.includes('window.__cfaiRouting'),'routing must come from the shared bundle');
  assert.ok(src.includes('ROUTING.decideRoute(ctx, routingPolicy())'), 'the send path must call the shared decideRoute');
});

test('the shared catalog carries the live-measured Gemini lineup, not the retired one', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const catalog = JSON.parse(readFileSync(path.join(here, '..', '..', 'shared', 'model-catalog.json'), 'utf8'));
  const g = catalog.hosts['gemini.google.com'].tiers;
  assert.deepEqual(
    [g.premium.click_labels[0], g.standard.click_labels[0], g.economy.click_labels[0]],
    ['3.1 Pro', '3.6 Flash', '3.5 Flash-Lite'],
    'if this fails because the lineup changed AGAIN, update the catalog and this pin together',
  );
});

// ── "mini" must not match inside "Gemini" ────────────────────────────────────
//
// Reported live: on Gmail with the Gemini panel open, pressing any button popped a
// "Model Routed — AskGeminiViewAnswer → GPT-4o" toast and the button stopped
// working. A bare substring test for "mini" matches "geMINI", so every Gemini
// surface was classified openai/economy; routing then "upgraded" it to GPT-4o,
// paused the event with preventDefault(), and clicked around Gmail hunting for an
// OpenAI label that was never there.
//
// The boundary has to hold in both directions: Gemini is not OpenAI, and the
// spellings OpenAI actually ships must still resolve.

test('regression: "Gemini" is never read as OpenAI', () => {
  for (const text of ['Gemini', 'gemini', 'AskGeminiViewAnswer', 'Gemini Alpha', '2.5 Gemini']) {
    const info = detectModelInfo(text);
    if (info) {
      assert.notEqual(info.provider, 'openai',
        `${JSON.stringify(text)} was classified as OpenAI because it contains "mini"`);
    }
  }
});

test('the OpenAI economy spellings that ship still resolve', () => {
  for (const text of ['GPT-4o mini', 'gpt-4o-mini', 'o4-mini', 'GPT-3.5', 'GPT-4.1 nano']) {
    const info = detectModelInfo(text);
    assert.ok(info, `${JSON.stringify(text)} no longer detected at all`);
    assert.equal(info.provider, 'openai', `${JSON.stringify(text)} -> ${info.provider}`);
    assert.equal(info.tier, 'economy', `${JSON.stringify(text)} -> ${info.tier}`);
  }
});

test('a Gemini tier label still resolves to google', () => {
  // The words that carry the tier are Flash / Thinking / Pro, and those are what
  // the picker shows — so nothing about the fix costs Gemini its detection.
  assert.deepEqual(detectModelInfo('2.5 Flash'), { provider: 'google', tier: 'economy' });
  assert.deepEqual(detectModelInfo('Gemini 2.5 Pro'), { provider: 'google', tier: 'premium' });
});
