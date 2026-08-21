// Parity tests for model-router-config.js's extraction of complexity.js's
// lexicon and content.js's tier-detection rules.
//
// The lexicon itself is EXTRACTED (bracket-sliced + eval'd) straight out of
// complexity.js's source, not hand-copied — see model-router-config.js's own
// header for why. These tests exist to catch the day that extraction
// silently breaks (a category renamed, a declaration reshaped) or the day
// the hand-ported TIER_KEYWORD_RULES/TIER_UI_NAMES tables drift from the
// real detectModelInfo()/TIER_UI_NAME they mirror.
//
// Everything here runs the SHIPPED browser-extension source via the same
// loaders browser-extension/tests already uses, per this repo's established
// "test the real code, not a reimplementation" convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { buildModelRouterConfig, detectModelInfoFromConfig } from '../src/os_monitor/model-router-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_TESTS_DIR = join(__dirname, '..', '..', 'browser-extension', 'tests');

const { loadDetectModelInfo, tierUiNameFor } = await import(pathToFileURL(join(EXT_TESTS_DIR, 'load-model-router.mjs')));
const { loadComplexity } = await import(pathToFileURL(join(EXT_TESTS_DIR, 'load-complexity.mjs')));

const POSITIVE_NAMES = [
  'REASONING_DEPTH', 'TASK_COMPLEXITY', 'DOMAIN_EXPERTISE', 'PLANNING',
  'CODING', 'DEBUGGING', 'ANALYSIS', 'OUTPUT_COMPLEXITY', 'SHALLOW_TASK',
];
const NEGATIVE_NAMES = ['TRIVIAL_INTENT', 'SIMPLE_TASK', 'SIMPLICITY_REQUEST'];

test('buildModelRouterConfig extracts every lexicon category with plausible content', () => {
  const cfg = buildModelRouterConfig();
  const positiveByName = Object.fromEntries(cfg.positiveCategories.map((c) => [c.name, c]));
  const negativeByName = Object.fromEntries(cfg.negativeCategories.map((c) => [c.name, c]));

  for (const name of POSITIVE_NAMES) {
    assert.ok(positiveByName[name], `missing positive category: ${name}`);
    assert.ok(positiveByName[name].terms.length > 0, `${name} extracted with zero terms`);
    for (const { term, weight } of positiveByName[name].terms) {
      assert.equal(typeof term, 'string');
      assert.ok(term.length > 0);
      assert.equal(typeof weight, 'number');
    }
  }
  for (const name of NEGATIVE_NAMES) {
    assert.ok(negativeByName[name], `missing negative category: ${name}`);
    assert.ok(negativeByName[name].terms.length > 0, `${name} extracted with zero terms`);
  }

  // Known, stable landmarks — catches an extraction that silently returns
  // the wrong array (e.g. an off-by-one in the bracket slicer).
  const taskComplexity = positiveByName.TASK_COMPLEXITY.terms;
  const architect = taskComplexity.find((t) => t.term === 'architect*');
  assert.ok(architect, 'TASK_COMPLEXITY must contain the architect* stem');
  // Pinned in complexity.js as a deliberate, documented tradeoff — see that
  // file's comment on this exact entry. If this ever changes there, it must
  // change here too, on purpose, not by silent drift.
  assert.equal(architect.weight, 6);
});

test('buildModelRouterConfig extracts structural signals with real regex sources', () => {
  const cfg = buildModelRouterConfig();
  const coding = cfg.positiveCategories.find((c) => c.name === 'CODING');
  const debugging = cfg.positiveCategories.find((c) => c.name === 'DEBUGGING');
  assert.ok(coding.structural.length > 0, 'CODING must carry CODE_STRUCTURE signals');
  assert.ok(debugging.structural.length > 0, 'DEBUGGING must carry STACK_STRUCTURE signals');
  for (const sig of [...coding.structural, ...debugging.structural]) {
    assert.equal(typeof sig.key, 'string');
    assert.equal(typeof sig.weight, 'number');
    assert.equal(typeof sig.source, 'string');
    // Must compile as a real regex on the C# side too — sanity-check here
    // that it at least compiles under JS's own regex engine.
    assert.doesNotThrow(() => new RegExp(sig.source, sig.flags));
  }
});

test('buildModelRouterConfig thresholds match the shipped classifier constants', () => {
  const cfg = buildModelRouterConfig();
  // These are the exact tuned values complexity.js documents; a silent
  // extraction bug (wrong regex, wrong capture group) would likely produce
  // NaN or a plainly wrong number rather than a plausible-looking wrong one,
  // but pin the known-correct values anyway since they're cheap to check.
  assert.equal(cfg.thresholds.COMPLEX_AT, 6);
  assert.equal(cfg.thresholds.SIMPLE_AT, -3);
  assert.equal(cfg.thresholds.STRONG_WEIGHT, 4);
  assert.equal(cfg.thresholds.CAP_PER_CATEGORY, 2);
});

test('detectModelInfoFromConfig agrees with the shipped detectModelInfo() across every provider tier', () => {
  const realDetect = loadDetectModelInfo();
  const samples = [
    'Fable', 'Opus 4.6', 'Opus 3', 'Sonnet 5 Medium', 'Sonnet 4.6', 'Haiku 4.5',
    'GPT-4o mini', 'ChatGPT-3.5', 'gpt-nano', 'GPT-4o', 'GPT-4.1', 'GPT-4', 'gpt4', 'o1-preview', 'o3', 'ChatGPT',
    'Gemini Flash', 'Gemini Lite', 'Gemini Thinking', 'Gemini Pro', 'Gemini Ultra',
    'Model: Sonnet 5 Medium', 'Model: Opus 3',  // the exact live button text seen against Claude Desktop
  ];
  for (const sample of samples) {
    const real = realDetect(sample);
    const ported = detectModelInfoFromConfig(sample);
    assert.deepEqual(ported, real, `mismatch for "${sample}": ported=${JSON.stringify(ported)} real=${JSON.stringify(real)}`);
  }
});

test('detectModelInfoFromConfig returns null for text matching no provider, same as the real function', () => {
  const realDetect = loadDetectModelInfo();
  for (const sample of ['', 'Write your prompt to Claude', 'random button text']) {
    assert.deepEqual(detectModelInfoFromConfig(sample), realDetect(sample));
  }
});

test('TIER_UI_NAMES matches the shipped TIER_UI_NAME table for every provider', () => {
  const cfg = buildModelRouterConfig();
  for (const provider of ['anthropic', 'openai', 'google']) {
    const real = tierUiNameFor(provider);
    const ported = cfg.tierUiNames[provider];
    assert.deepEqual(
      Object.fromEntries(Object.entries(ported).map(([k, v]) => [Number(k), v])),
      real,
      `TIER_UI_NAMES.${provider} drifted from content.js's TIER_UI_NAME`,
    );
  }
});

test('buildModelRouterConfig output is JSON-serializable and within a sane env-var size budget', () => {
  const cfg = buildModelRouterConfig();
  const json = JSON.stringify(cfg);
  assert.doesNotThrow(() => JSON.parse(json));
  // Windows env vars have practical limits well north of this; this is a
  // sanity ceiling to catch accidental inclusion of something huge, not a
  // real platform constraint.
  assert.ok(json.length < 100_000, `config unexpectedly large: ${json.length} bytes`);
});

test('classify() sanity: the ported lexicon data, scored by hand for one known case, agrees with the shipped classifier direction', () => {
  // This does not exercise the C# scoring port (that lives in enforcer-win.ps1
  // and is tested there via source-level invariants — see
  // agent/tests/os-monitor-safety.test.mjs). It only confirms the DATA this
  // module ships is the same data the shipped classifier scores against, by
  // checking that the architect* stem — the term whose weight this repo has
  // explicitly pinned — is present with the same weight the real classifier
  // uses to push "what's our architecture for the billing service?" complex.
  const { classify } = loadComplexity();
  assert.equal(classify("what's our architecture for the billing service?"), 'complex');
  const cfg = buildModelRouterConfig();
  const architect = cfg.positiveCategories.find((c) => c.name === 'TASK_COMPLEXITY').terms.find((t) => t.term === 'architect*');
  assert.equal(architect.weight, 6, 'ported weight must match what made the real classifier call this complex');
});
