// Comprehensive test for the reversible PII tokenization feature.
// Tests the token vault, proxy tokenization, and MCP guard tokenization.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TokenVault } from '../src/proxy/token-vault.js';
import { inspectMessage, shouldBlock, shouldTokenize, tokenizeMessage, blockResponse } from '../src/mcp_guard/guard.js';

describe('TokenVault', () => {
  test('creates unique tokens for different values', () => {
    const vault = new TokenVault();
    const t1 = vault.create('123-45-6789', 'us-ssn');
    const t2 = vault.create('987-65-4321', 'us-ssn');
    assert.notEqual(t1, t2);
    assert.match(t1, /^\[CFAI:SSN:[a-f0-9]{8}\]$/);
    assert.match(t2, /^\[CFAI:SSN:[a-f0-9]{8}\]$/);
  });

  test('reuses tokens for the same value', () => {
    const vault = new TokenVault();
    const t1 = vault.create('123-45-6789', 'us-ssn');
    const t2 = vault.create('123-45-6789', 'us-ssn');
    assert.equal(t1, t2);
  });

  test('restores tokens in text', () => {
    const vault = new TokenVault();
    const token = vault.create('123-45-6789', 'us-ssn');
    const text = `My SSN is ${token} and that is all.`;
    const restored = vault.restore(text);
    assert.equal(restored, 'My SSN is 123-45-6789 and that is all.');
  });

  test('restores multiple tokens in text', () => {
    const vault = new TokenVault();
    const t1 = vault.create('123-45-6789', 'us-ssn');
    const t2 = vault.create('sk-proj-abc123456789xyz', 'openai-api-key');
    const text = `SSN: ${t1}, Key: ${t2}`;
    const restored = vault.restore(text);
    assert.equal(restored, 'SSN: 123-45-6789, Key: sk-proj-abc123456789xyz');
  });

  test('leaves unknown tokens untouched', () => {
    const vault = new TokenVault();
    const text = 'Some text [CFAI:SSN:deadbeef] here';
    const restored = vault.restore(text);
    assert.equal(restored, text); // no known token → unchanged
  });

  test('hasTokens detects known tokens', () => {
    const vault = new TokenVault();
    const token = vault.create('123-45-6789', 'us-ssn');
    assert.ok(vault.hasTokens(`text ${token} more`));
    assert.ok(!vault.hasTokens('no tokens here'));
  });

  test('gc removes expired tokens', () => {
    const vault = new TokenVault();
    const token = vault.create('123-45-6789', 'us-ssn');
    // Manually expire by backdating
    vault._map.get(token).createdAt = Date.now() - 31 * 60 * 1000;
    vault.gc();
    assert.equal(vault.size, 0);
  });

  test('creates tokens for all pattern types', () => {
    const vault = new TokenVault();
    const patterns = [
      ['sk-proj-test12345678901234', 'openai-api-key', 'APIKEY'],
      ['AKIAIOSFODNN7EXAMPLE', 'aws-access-key', 'AWSKEY'],
      ['ghp_1234567890abcdefghijklmnopqrstuvwx', 'github-pat', 'GHTOKEN'],
      ['123-45-6789', 'us-ssn', 'SSN'],
      ['DE89370400440532013000', 'iban', 'IBAN'],
    ];
    for (const [value, pattern, shortName] of patterns) {
      const token = vault.create(value, pattern);
      assert.match(token, new RegExp(`^\\[CFAI:${shortName}:[a-f0-9]{8}\\]$`));
      const restored = vault.restore(token);
      assert.equal(restored, value);
    }
  });
});

describe('MCP Guard Tokenization', () => {
  test('shouldTokenize returns true when all patterns are in tokenize set', () => {
    const inspection = {
      toolName: 'test',
      matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }],
      highestSeverity: 'critical',
      scannedLength: 20,
    };
    const tokenizeSet = new Set(['us-ssn']);
    assert.ok(shouldTokenize(inspection, tokenizeSet));
  });

  test('shouldTokenize returns false when some patterns are NOT in tokenize set', () => {
    const inspection = {
      toolName: 'test',
      matches: [
        { pattern: 'us-ssn', severity: 'critical', count: 1 },
        { pattern: 'aws-access-key', severity: 'critical', count: 1 },
      ],
      highestSeverity: 'critical',
      scannedLength: 50,
    };
    const tokenizeSet = new Set(['us-ssn']); // aws-access-key NOT in set
    assert.ok(!shouldTokenize(inspection, tokenizeSet));
  });

  test('shouldTokenize returns false with empty tokenize set', () => {
    const inspection = {
      toolName: 'test',
      matches: [{ pattern: 'us-ssn', severity: 'critical', count: 1 }],
      highestSeverity: 'critical',
      scannedLength: 20,
    };
    assert.ok(!shouldTokenize(inspection, new Set()));
    assert.ok(!shouldTokenize(inspection, null));
  });

  test('tokenizeMessage replaces sensitive values in tool call arguments', () => {
    const vault = new TokenVault();
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'Find records for SSN 123-45-6789' },
      },
    };
    const result = tokenizeMessage(msg, vault, new Set(['us-ssn']));
    assert.ok(result);
    assert.equal(result.tokenCount, 1);
    assert.ok(!result.message.params.arguments.query.includes('123-45-6789'));
    assert.match(result.message.params.arguments.query, /\[CFAI:SSN:[a-f0-9]{8}\]/);

    // Restore
    const restored = vault.restore(JSON.stringify(result.message));
    assert.ok(restored.includes('123-45-6789'));
  });

  test('tokenizeMessage handles nested arguments', () => {
    const vault = new TokenVault();
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'multi',
        arguments: {
          data: {
            ssn: '123-45-6789',
            nested: { key: 'AKIAIOSFODNN7EXAMPLE' },
          },
          list: ['has ssn 987-65-4321 inside'],
        },
      },
    };
    const result = tokenizeMessage(msg, vault, new Set(['us-ssn', 'aws-access-key']));
    assert.ok(result);
    assert.equal(result.tokenCount, 3); // 2 SSNs + 1 AWS key
    const str = JSON.stringify(result.message);
    assert.ok(!str.includes('123-45-6789'));
    assert.ok(!str.includes('987-65-4321'));
    assert.ok(!str.includes('AKIAIOSFODNN7EXAMPLE'));
    // All restored
    const restored = vault.restore(str);
    assert.ok(restored.includes('123-45-6789'));
    assert.ok(restored.includes('987-65-4321'));
    assert.ok(restored.includes('AKIAIOSFODNN7EXAMPLE'));
  });

  test('tokenizeMessage returns null for non-tools/call messages', () => {
    const vault = new TokenVault();
    assert.equal(tokenizeMessage({ method: 'initialize' }, vault, new Set(['us-ssn'])), null);
    assert.equal(tokenizeMessage(null, vault, new Set(['us-ssn'])), null);
  });

  test('original blocking still works when patterns are NOT in tokenize set', () => {
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'Has SSN 123-45-6789' },
      },
    };
    const inspection = inspectMessage(msg);
    assert.ok(inspection);
    assert.ok(shouldBlock(inspection)); // default threshold = high
    assert.ok(!shouldTokenize(inspection, new Set())); // empty tokenize set → don't tokenize
    assert.ok(!shouldTokenize(inspection, null));

    // blockResponse still works
    const resp = blockResponse(msg, inspection);
    assert.equal(resp.error.code, -32001);
    assert.ok(resp.error.message.includes('sensitive data'));
  });

  test('blocking still works for patterns NOT in the tokenize set while others tokenize', () => {
    // If some patterns are in the tokenize set but not all → shouldTokenize = false → block
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'transfer',
        arguments: { ssn: '123-45-6789', key: 'AKIAIOSFODNN7EXAMPLE' },
      },
    };
    const inspection = inspectMessage(msg);
    assert.ok(shouldBlock(inspection));
    // Only us-ssn in tokenize set, aws-access-key NOT
    assert.ok(!shouldTokenize(inspection, new Set(['us-ssn'])));
    // If both are in tokenize set → tokenize
    assert.ok(shouldTokenize(inspection, new Set(['us-ssn', 'aws-access-key'])));
  });
});

describe('Integration: Block vs Tokenize decision flow', () => {
  test('default behavior: all patterns block', () => {
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'test', arguments: { data: 'SSN 123-45-6789' } },
    };
    const inspection = inspectMessage(msg);
    assert.ok(shouldBlock(inspection));
    assert.ok(!shouldTokenize(inspection, new Set())); // empty → no tokenize
    // Result: BLOCK (existing behavior preserved)
  });

  test('tokenize mode: matching pattern in tokenize set', () => {
    const vault = new TokenVault();
    const tokenizePatterns = new Set(['us-ssn']);
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'test', arguments: { data: 'SSN 123-45-6789' } },
    };
    const inspection = inspectMessage(msg);
    assert.ok(shouldBlock(inspection));
    assert.ok(shouldTokenize(inspection, tokenizePatterns));
    // Result: TOKENIZE
    const result = tokenizeMessage(msg, vault, tokenizePatterns);
    assert.ok(result);
    assert.ok(!result.message.params.arguments.data.includes('123-45-6789'));
  });

  test('mixed patterns: one block, one tokenize → falls back to block', () => {
    const tokenizePatterns = new Set(['us-ssn']); // only SSN tokenizes
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'test', arguments: { data: 'SSN 123-45-6789 KEY AKIAIOSFODNN7EXAMPLE' } },
    };
    const inspection = inspectMessage(msg);
    assert.ok(shouldBlock(inspection));
    assert.ok(!shouldTokenize(inspection, tokenizePatterns)); // aws key NOT in set → block
    // Result: BLOCK (correct — we don't tokenize when some patterns must block)
  });

  test('response restoration round-trip', () => {
    const vault = new TokenVault();
    const tokenizePatterns = new Set(['us-ssn', 'aws-access-key']);
    const msg = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'lookup', arguments: { ssn: '123-45-6789', note: 'with key AKIAIOSFODNN7EXAMPLE' } },
    };
    // Step 1: Tokenize request
    const result = tokenizeMessage(msg, vault, tokenizePatterns);
    assert.ok(result);
    const tokenizedJson = JSON.stringify(result.message);
    assert.ok(!tokenizedJson.includes('123-45-6789'));
    assert.ok(!tokenizedJson.includes('AKIAIOSFODNN7EXAMPLE'));

    // Step 2: Simulate AI response containing the tokens
    const ssnToken = tokenizedJson.match(/\[CFAI:SSN:[a-f0-9]{8}\]/)[0];
    const awsToken = tokenizedJson.match(/\[CFAI:AWSKEY:[a-f0-9]{8}\]/)[0];
    const aiResponse = `Based on SSN ${ssnToken}, the AWS key ${awsToken} was used.`;

    // Step 3: Restore tokens in response
    const restored = vault.restore(aiResponse);
    assert.equal(restored, 'Based on SSN 123-45-6789, the AWS key AKIAIOSFODNN7EXAMPLE was used.');
  });
});
