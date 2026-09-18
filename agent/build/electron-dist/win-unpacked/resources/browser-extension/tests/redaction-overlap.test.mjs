// Regression tests added by QA for defects found while reviewing the
// "Tokenize & Send" feature. These pin behaviour that the feature's core
// promise depends on: "every detected sensitive span is masked before send".
//
// STATUS AT TIME OF WRITING: these FAIL against the current redact()
// implementation. They are intentionally left failing so the defects cannot be
// shipped silently. See the comment on each test for the root cause.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPatterns, luhnValid } from './load-patterns.mjs';

const P = loadPatterns();

// What content.js actually calls: safeRedact(live, scan(live).map(m => m.pattern))
// (content.js:1182 for the modal preview, content.js:1385 for the real send).
const redactLikeContentJs = (text) => P.redact(text, P.scan(text).map((m) => m.pattern));

test('redact(): overlap resolution must not leave a detected value behind', async (t) => {
  // ── Fixture: a 16-digit Luhn-valid card formatted so that its first 11
  // characters are also a valid us-ssn span (the '-' after the 4th group gives
  // us-ssn its trailing \b). Both patterns therefore match, overlapping.
  const digits = (() => {
    for (let tail = 0; tail < 10_000_000; tail++) {
      const d = '123456789' + String(tail).padStart(7, '0');
      if (d.length === 16 && luhnValid(d)) return d;
    }
    throw new Error('no fixture found');
  })();
  const card = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 9)}-${digits.slice(9, 12)}-${digits.slice(12)}`;

  await t.test('scan() reports BOTH us-ssn and credit-card (precondition)', () => {
    const names = P.scan(`pay ${card} now`).map((m) => m.pattern).sort();
    assert.deepEqual(names, ['credit-card', 'us-ssn']);
  });

  await t.test('nested overlap: card digits must not survive the mask', () => {
    const out = redactLikeContentJs(`pay ${card} now`);
    // Was: "pay [SSN]-000-0007 now" — resolveRedactSpans() kept the critical
    // us-ssn span and DROPPED the overlapping high credit-card span, so the tail
    // of the card number went out verbatim. Overlapping spans are now merged
    // (mask the union; precedence only picks the label), so nothing survives.
    assert.equal(
      out.redacted.replace(/\[[A-Z-]+\]/g, '').replace(/\D/g, ''),
      '',
      `digits survived masking: ${JSON.stringify(out.redacted)}`
    );
  });

  await t.test('nested overlap: every scan()-reported pattern is reported as replaced', () => {
    const text = `pay ${card} now`;
    const detected = P.scan(text).map((m) => m.pattern).sort();
    const replaced = redactLikeContentJs(text).replacements.map((r) => r.pattern).sort();
    // The enforcement_redact event is built from `replacements`; if a detected
    // pattern is missing here the audit trail disagrees with the modal chips.
    assert.deepEqual(replaced, detected);
  });

  await t.test('nested overlap: an api key wrapping a cloud key is fully masked', () => {
    // The openai-api-key regex allows '-' in its body, so it swallows the
    // following AWS key into one long span. aws-access-key (critical) wins the
    // overlap, the openai span is dropped, and the sk-proj- secret survives.
    const text = `sk-proj-${'z'.repeat(24)}-AKIAABCDEFGHIJKLMNOP`;
    assert.ok(P.scan(text).some((m) => m.pattern === 'openai-api-key'), 'precondition: openai key detected');
    const out = redactLikeContentJs(text);
    assert.equal(
      P.scan(out.redacted).length,
      0,
      `masked output still contains a detectable secret: ${JSON.stringify(out.redacted)}`
    );
  });
});

test('redact(): output must never still match a pattern (fuzz invariant)', () => {
  // Deterministic PRNG so a failure is reproducible.
  let seed = 0x2f6e2b1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const FRAGS = [
    'hello ', '123-45-6789', ' ', '4111000000000008', 'AKIAABCDEFGHIJKLMNOP',
    'sk-proj-' + 'z'.repeat(24), '555-867-5309', 'CF-1234', 'CF-CUST-ABC123',
    'DE89370400440532013000', '-', '4111111111111112', 'ghp_' + 'q'.repeat(36), '\n', '0', '9',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijkl',
  ];
  const failures = [];
  for (let i = 0; i < 4000; i++) {
    let text = '';
    const n = 1 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) text += FRAGS[Math.floor(rnd() * FRAGS.length)];
    const before = P.scan(text);
    if (before.length === 0) continue;
    const out = redactLikeContentJs(text);
    const after = P.scan(out.redacted);
    if (after.length > 0) {
      failures.push({ text, redacted: out.redacted, still: after.map((m) => m.pattern) });
    }
  }
  assert.deepEqual(
    failures.slice(0, 3),
    [],
    `${failures.length}/4000 masked outputs still contain a detectable value`
  );
});

test('redact(): stays interactive on a large many-match prompt', () => {
  // A pasted employee spreadsheet is the bread-and-butter DLP case and sits
  // well under the 1 MB cap, so the cap does not protect the user here.
  // redact() is called synchronously on the main thread TWICE per block
  // (modal preview + actual send), so the wall time below is doubled in the tab.
  const csv = Array.from({ length: 15_000 }, (_, i) => `emp${i},123-45-6789,555-867-5309`).join('\n');
  assert.ok(csv.length < P.__redactInternals.REDACT_MAX_CHARS, 'fixture must be under the cap');

  const started = Date.now();
  const out = P.redact(csv, P.scan(csv).map((m) => m.pattern));
  const elapsed = Date.now() - started;

  assert.equal(out.replacements.reduce((a, r) => a + r.count, 0), 30_000);
  // Generous budget: an array-join splice + non-quadratic overlap check does
  // this in ~150 ms. The current right-to-left string splice takes ~12 s.
  assert.ok(elapsed < 5000, `redact() of ${csv.length} chars took ${elapsed} ms (quadratic splice)`);
});
