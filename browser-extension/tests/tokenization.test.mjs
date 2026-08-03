// Tests for the fetch-blocker's block-vs-tokenize DECISION logic.
//
// Pattern matching now comes from the REAL catalog (content/patterns.js) via
// loadPatterns() instead of a local copy of the regexes. Only the action
// classification below is still mirrored locally — that logic lives in
// content/fetch-blocker.js, which runs in the page's JS world and is not
// importable from Node.
//
// The one-way redaction path used by the block modal's "Tokenize & Send"
// button is covered separately in redaction.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadPatterns } from './load-patterns.mjs';

const P = loadPatterns();

/** Pattern names present in `text`, per the shipped catalog. */
function scanText(text) {
  if (!text || text.length < 5) return [];
  return P.scan(text).map((m) => m.pattern);
}

// --- mirrors content/fetch-blocker.js ---
function getPatternAction(patternName, actions) {
  if (!actions || typeof actions !== 'object') return 'block';
  return actions[patternName] || 'block';
}

function classifyMatches(matchNames, actions) {
  const blockable = [];
  const tokenizable = [];
  for (const name of matchNames) {
    if (getPatternAction(name, actions) === 'tokenize') tokenizable.push(name);
    else blockable.push(name);
  }
  return { blockable, tokenizable };
}

const sorted = (a) => [...a].sort();

describe('Browser Extension: Block vs Tokenize Decision', () => {
  test('default: all patterns block (no actions configured)', () => {
    const matches = scanText('My SSN is 123-45-6789');
    const { blockable, tokenizable } = classifyMatches(matches, {});
    assert.deepEqual(blockable, ['us-ssn']);
    assert.deepEqual(tokenizable, []);
  });

  test('tokenize mode: SSN configured as tokenize', () => {
    const actions = { 'us-ssn': 'tokenize' };
    const matches = scanText('My SSN is 123-45-6789');
    const { blockable, tokenizable } = classifyMatches(matches, actions);
    assert.deepEqual(blockable, []);
    assert.deepEqual(tokenizable, ['us-ssn']);
  });

  test('mixed: SSN tokenize, API key block → blockable has API key', () => {
    const actions = { 'us-ssn': 'tokenize' };
    const matches = scanText('SSN 123-45-6789 key AKIAIOSFODNN7EXAMPLE');
    const { blockable, tokenizable } = classifyMatches(matches, actions);
    assert.deepEqual(blockable, ['aws-access-key']);
    assert.deepEqual(tokenizable, ['us-ssn']);
  });

  test('all tokenize: both patterns configured for tokenize', () => {
    const actions = { 'us-ssn': 'tokenize', 'aws-access-key': 'tokenize' };
    const matches = scanText('SSN 123-45-6789 key AKIAIOSFODNN7EXAMPLE');
    const { blockable, tokenizable } = classifyMatches(matches, actions);
    assert.deepEqual(blockable, []);
    assert.deepEqual(sorted(tokenizable), ['aws-access-key', 'us-ssn']);
  });

  test('no matches → no block, no tokenize', () => {
    const matches = scanText('Hello world, nothing sensitive');
    const { blockable, tokenizable } = classifyMatches(matches, {});
    assert.deepEqual(blockable, []);
    assert.deepEqual(tokenizable, []);
  });

  test('fetch decision: blockable.length > 0 → BLOCK (existing behavior)', () => {
    const actions = { 'us-ssn': 'tokenize' }; // SSN tokenize, others block
    const matches = scanText('SSN 123-45-6789 key AKIAIOSFODNN7EXAMPLE');
    const { blockable } = classifyMatches(matches, actions);
    // When ANY pattern is blockable, the ENTIRE request blocks
    const shouldBlock = blockable.length > 0;
    assert.ok(shouldBlock);
  });

  test('fetch decision: only tokenizable → TOKENIZE (new behavior)', () => {
    const actions = { 'us-ssn': 'tokenize' };
    const matches = scanText('My SSN is 123-45-6789');
    const { blockable, tokenizable } = classifyMatches(matches, actions);
    const shouldBlock = blockable.length > 0;
    const shouldTokenize = !shouldBlock && tokenizable.length > 0;
    assert.ok(!shouldBlock);
    assert.ok(shouldTokenize);
  });
});

describe('Browser Extension: Token Format', () => {
  test('token regex matches expected format', () => {
    const re = () => /\[CFAI:[A-Z0-9]+:[a-f0-9]{8}\]/;
    assert.ok(re().test('[CFAI:SSN:a7f3b2c1]'));
    assert.ok(re().test('[CFAI:APIKEY:deadbeef]'));
    assert.ok(re().test('[CFAI:AWSKEY:12345678]'));
    assert.ok(!re().test('[cfai:ssn:a7f3b2c1]')); // lowercase → no match
    assert.ok(!re().test('[CFAI:SSN:short]'));       // too short hex
  });
});
