// Tests for the browser extension's tokenization logic.
// Simulates the fetch-blocker's decision making without a browser.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Simulate the fetch-blocker's pattern matching and classification
const SENSITIVE_PATTERNS = [
  { name: 'us-ssn',            regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: 'openai-api-key',    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: 'aws-access-key',    regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github-pat',        regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
];

function scanText(text) {
  if (!text || text.length < 5) return [];
  const found = [];
  for (const p of SENSITIVE_PATTERNS) {
    p.regex.lastIndex = 0;
    if (p.regex.test(text)) found.push(p.name);
  }
  return found;
}

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
    assert.deepEqual(tokenizable, ['us-ssn', 'aws-access-key']);
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
    const { blockable, tokenizable } = classifyMatches(matches, actions);
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
