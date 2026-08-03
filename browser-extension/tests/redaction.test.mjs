// Tests for the extension's ONE-WAY redaction path — the mechanism behind the
// block modal's "Tokenize & Send" button.
//
// These drive the REAL catalog in content/patterns.js (loaded via
// tests/load-patterns.mjs), not a local reimplementation. redact() is pure,
// synchronous and stateless, so no DOM is needed.
//
// Contract under test:
//   redact(text, patternNames) -> { redacted, replacements, firstOffset }
//   * fixed labels, no vault, no mapping, nothing reversible, no TTL
//   * every pattern named by the caller is masked regardless of severity
//   * overlapping spans resolve deterministically (severity desc, longer span,
//     earlier start, pattern name) — never by catalog declaration order
//   * a validate()-rejected match never blinds the scan to a later valid one
//   * repeated matches of one pattern share ONE identical label (no numbering)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadPatterns, luhnValid } from './load-patterns.mjs';

const P = loadPatterns();

const VALID_CARD   = '4111111111111111';   // classic Luhn-valid test card
const INVALID_CARD = '4111111111111112';   // same digits, bad check digit

// Sanity-check the fixtures themselves so a failure below is never ambiguous.
assert.ok(luhnValid(VALID_CARD));
assert.ok(!luhnValid(INVALID_CARD));

/** Mask everything scan() found — this is exactly what the modal's button does. */
function redactAllDetected(text) {
  return P.redact(text, P.scan(text).map((m) => m.pattern));
}

function countOf(result, pattern) {
  return result.replacements.find((r) => r.pattern === pattern)?.count ?? 0;
}

describe('redact(): fixed-label, one-way masking', () => {
  test('masks each detected value with its fixed label', () => {
    const r = redactAllDetected(`My SSN is 123-45-6789 and card ${VALID_CARD}`);
    assert.equal(r.redacted, 'My SSN is [SSN] and card [CREDIT-CARD]');
    assert.equal(countOf(r, 'us-ssn'), 1);
    assert.equal(countOf(r, 'credit-card'), 1);
  });

  test('replacements carry pattern/class/severity/label/count and no matched value', () => {
    const r = redactAllDetected('ssn 123-45-6789');
    assert.equal(r.replacements.length, 1);
    assert.deepEqual(r.replacements[0], {
      pattern: 'us-ssn', class: 'pii', severity: 'critical',
      label: '[SSN]', count: 1,
    });
    assert.ok(!JSON.stringify(r.replacements).includes('123-45-6789'));
  });

  test('two matches of the same pattern get the SAME label — no positional numbering', () => {
    const r = redactAllDetected('SSN 123-45-6789 again 987-65-4321');
    assert.equal(r.redacted, 'SSN [SSN] again [SSN]');
    assert.equal(r.replacements.length, 1);
    assert.equal(countOf(r, 'us-ssn'), 2);
    assert.ok(!/\[SSN-\d/.test(r.redacted), 'no positional numbering like [SSN-1]/[SSN-2]');
  });

  test('firstOffset is the offset of the first replaced span in the ORIGINAL text', () => {
    const text = 'hello there ssn 123-45-6789 tail';
    const r = redactAllDetected(text);
    assert.equal(r.firstOffset, text.indexOf('123-45-6789'));
    assert.equal(text.slice(r.firstOffset, r.firstOffset + 11), '123-45-6789');
  });

  test('nothing detected → text untouched, empty replacements, firstOffset -1', () => {
    const r = redactAllDetected('just a normal harmless prompt');
    assert.equal(r.redacted, 'just a normal harmless prompt');
    assert.deepEqual(r.replacements, []);
    assert.equal(r.firstOffset, -1);
  });

  test('never emits reversible vault tokens (this path is one-way)', () => {
    const r = redactAllDetected(`ssn 123-45-6789 card ${VALID_CARD}`);
    assert.ok(!r.redacted.includes('[CFAI:'));
    // Nothing was vaulted, so restoreTokens() cannot bring anything back.
    assert.equal(P.restoreTokens(r.redacted), r.redacted);
  });
});

describe('redact(): overlap resolution is deterministic, not catalog order', () => {
  // A 15-digit Luhn-valid run whose first 9 digits are formatted as an SSN.
  // credit-card's loose 13-16 digit matcher spans the whole run; us-ssn matches
  // only the leading 11 characters. Overlapping spans are MERGED (mask the union)
  // and precedence — severity desc, so critical us-ssn over high credit-card —
  // only picks which label the merged region gets. Dropping the loser instead
  // would leave the tail of the card number in the prompt.
  const OVERLAP = 'ref 123-45-6789 000003 end';

  test('overlapping spans are masked as one region — no digits survive', () => {
    const r = redactAllDetected(OVERLAP);
    assert.equal(r.redacted, 'ref [SSN] end');
    assert.equal(/\d/.test(r.redacted), false, 'no part of the card number may survive');
  });

  test('the higher-precedence pattern supplies the label', () => {
    const r = redactAllDetected(OVERLAP);
    assert.ok(r.redacted.includes('[SSN]'));
  });

  test('every pattern that contributed is reported in replacements', () => {
    const detected = P.scan(OVERLAP).map((m) => m.pattern).sort();
    const replaced = redactAllDetected(OVERLAP).replacements.map((r) => r.pattern).sort();
    assert.deepEqual(replaced, detected);
    assert.deepEqual(detected, ['credit-card', 'us-ssn']);
  });

  test('masked output is never still detectable', () => {
    assert.deepEqual(P.scan(redactAllDetected(OVERLAP).redacted), []);
    assert.equal(redactAllDetected(OVERLAP).residual, undefined);
  });

  test('the same input always produces the same output', () => {
    const first = redactAllDetected(OVERLAP).redacted;
    for (let i = 0; i < 25; i++) {
      assert.equal(redactAllDetected(OVERLAP).redacted, first);
    }
  });

  test('span resolution ignores the order spans were collected in', () => {
    const { collectRedactSpans, resolveRedactSpans } = P.__redactInternals;
    const spans = collectRedactSpans(OVERLAP, null);
    assert.ok(spans.length >= 2, 'fixture must produce overlapping spans');

    const expected = resolveRedactSpans(spans);
    // Deterministic shuffles (seeded LCG) — no random flakiness.
    let seed = 1337;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 50; round++) {
      const shuffled = [...spans];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      assert.deepEqual(resolveRedactSpans(shuffled), expected);
    }
  });

  test('accepted spans never overlap and come back in offset order', () => {
    const { collectRedactSpans, resolveRedactSpans } = P.__redactInternals;
    const accepted = resolveRedactSpans(
      collectRedactSpans(`ssn 123-45-6789 card ${VALID_CARD} phone 555-867-5309`, null),
    );
    for (let i = 1; i < accepted.length; i++) {
      assert.ok(accepted[i - 1].start < accepted[i].start, 'sorted by start');
      assert.ok(accepted[i - 1].end <= accepted[i].start, 'no overlap');
    }
  });

  test('a single linear splice keeps every later replacement correct', () => {
    const r = redactAllDetected('a 111-22-3333 b 444-55-6666 c 777-88-9999 d');
    assert.equal(
      r.redacted,
      'a [SSN] b [SSN] c [SSN] d',
    );
    assert.equal(countOf(r, 'us-ssn'), 3);
  });
});

describe('redact(): validate()-rejected matches do not blind the scan', () => {
  test('a Luhn-rejected span does not hide a valid card starting inside it', () => {
    // credit-card first matches "1 4111 1111 1111" (13 digits, Luhn-invalid).
    // Resuming past its END would skip the valid 16-digit card that begins one
    // character later; resuming at start+1 finds it.
    const text = '1 4111 1111 1111 1111';
    const r = redactAllDetected(text);
    assert.equal(r.redacted, '1 [CREDIT-CARD]');
    assert.equal(countOf(r, 'credit-card'), 1);
  });

  test('same holds with dash separators', () => {
    const r = redactAllDetected('x 1 4111-1111-1111-1111 y');
    assert.equal(r.redacted, 'x 1 [CREDIT-CARD] y');
  });

  test('a Luhn-rejected card is left alone and a later valid one is masked', () => {
    const r = redactAllDetected(`card ${INVALID_CARD} then ${VALID_CARD} ok`);
    assert.equal(r.redacted, `card ${INVALID_CARD} then [CREDIT-CARD] ok`);
    assert.equal(countOf(r, 'credit-card'), 1);
  });

  test('scan() agrees that the valid card is there (same lastIndex handling)', () => {
    const matches = P.scan('1 4111 1111 1111 1111');
    assert.equal(matches.find((m) => m.pattern === 'credit-card')?.count, 1);
  });
});

describe('redact(): idempotence', () => {
  const cases = [
    `ssn 123-45-6789 card ${VALID_CARD} aws AKIAIOSFODNN7EXAMPLE`,
    'phone 555-867-5309 jira CF-1234 cust CF-CUST-ABC123',
    'ref 123-45-6789 000003 end',
    `key sk-proj-abcdefghijklmnopqrstuvwx and ${VALID_CARD}`,
  ];
  for (const text of cases) {
    test(`output is not re-matchable: ${text.slice(0, 28)}…`, () => {
      const once = redactAllDetected(text).redacted;
      const twice = redactAllDetected(once).redacted;
      assert.equal(twice, once);
      // No label collides with any pattern in the catalog.
      assert.deepEqual(P.scan(once), []);
    });
  }

  // Derived from the module, not hardcoded, so a future label can never quietly
  // introduce one that the catalog re-matches.
  test('every label in the catalog matches no pattern, alone or concatenated', () => {
    const { REDACT_LABELS, REDACT_FALLBACK_LABEL } = P.__redactInternals;
    const all = Array.from(new Set([...Object.values(REDACT_LABELS), REDACT_FALLBACK_LABEL]));
    assert.ok(all.length >= 10, 'sanity: labels were loaded');

    for (const label of all) {
      assert.deepEqual(P.scan(label), [], `label ${label} must not be re-matchable`);
      assert.ok(!/REDACTED/i.test(label), `label ${label} must not say "redacted"`);
    }
    const joined = all.join(' ');
    assert.deepEqual(P.scan(joined), []);
    assert.deepEqual(redactAllDetected(joined).replacements, []);
    // Also back-to-back with no separators, in case a seam creates a match.
    assert.deepEqual(P.scan(all.join('')), []);
  });
});

describe('redact(): pattern-name filter has no severity gate', () => {
  const TEXT = 'aws AKIAIOSFODNN7EXAMPLE openai sk-proj-abcdefghijklmnopqrstuvwx ' +
               'phone 555-867-5309 jira CF-1234';

  test('api_key and cloud_key classes are masked like everything else', () => {
    const r = redactAllDetected(TEXT);
    assert.deepEqual(
      r.replacements.map((x) => x.pattern).sort(),
      ['aws-access-key', 'internal-jira-key', 'openai-api-key', 'us-phone'],
    );
    assert.ok(r.replacements.some((x) => x.class === 'cloud_key'), 'cloud_key masked');
    assert.ok(r.replacements.some((x) => x.class === 'api_key'), 'api_key masked');
    assert.ok(!r.redacted.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(!r.redacted.includes('sk-proj-abcdefghijklmnopqrstuvwx'));
  });

  test('low-severity matches are masked too when named (no high/critical gate)', () => {
    const r = redactAllDetected(TEXT);
    assert.equal(countOf(r, 'us-phone'), 1);
    assert.equal(countOf(r, 'internal-jira-key'), 1);
    assert.ok(!r.redacted.includes('555-867-5309'));
  });

  test('only the named patterns are masked', () => {
    const r = P.redact(TEXT, ['us-phone']);
    assert.equal(countOf(r, 'us-phone'), 1);
    assert.equal(r.replacements.length, 1);
    assert.ok(r.redacted.includes('AKIAIOSFODNN7EXAMPLE'));
  });

  test('a Set of pattern names works as well as an array', () => {
    const fromSet = P.redact(TEXT, new Set(['us-phone'])).redacted;
    assert.equal(fromSet, P.redact(TEXT, ['us-phone']).redacted);
  });

  test('omitting the filter masks every catalog pattern that matches', () => {
    assert.equal(P.redact(TEXT).redacted, redactAllDetected(TEXT).redacted);
  });

  test('backward compatibility: a severity Set still filters by severity', () => {
    const r = P.redact(TEXT, new Set(['high', 'critical']));
    assert.ok(!r.redacted.includes('AKIAIOSFODNN7EXAMPLE'), 'critical masked');
    assert.ok(r.redacted.includes('555-867-5309'), 'low severity left alone');
    assert.ok(r.redacted.includes('CF-1234'), 'low severity left alone');
  });
});

describe('redact(): input edge cases', () => {
  test('empty string', () => {
    assert.deepEqual(P.redact(''), { redacted: '', replacements: [], firstOffset: -1 });
  });

  test('null / undefined / non-string', () => {
    assert.deepEqual(P.redact(null), { redacted: null, replacements: [], firstOffset: -1 });
    assert.deepEqual(P.redact(undefined), { redacted: undefined, replacements: [], firstOffset: -1 });
    assert.deepEqual(P.redact(42), { redacted: 42, replacements: [], firstOffset: -1 });
  });

  test('an empty filter list is treated as "mask everything detected"', () => {
    const r = P.redact('ssn 123-45-6789', []);
    assert.equal(countOf(r, 'us-ssn'), 1);
  });

  test('over the 1 MB cap: degrades gracefully, masks nothing, reports why', () => {
    const cap = P.__redactInternals.REDACT_MAX_CHARS;
    const big = 'x'.repeat(cap + 1) + ' ssn 123-45-6789';
    const r = P.redact(big);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'too_large');
    assert.deepEqual(r.replacements, []);
    assert.equal(r.firstOffset, -1);
    assert.equal(r.redacted, big, 'text is returned untouched, never partially masked');
  });

  test('just under the cap still masks', () => {
    const cap = P.__redactInternals.REDACT_MAX_CHARS;
    const tail = ' ssn 123-45-6789';
    const big = 'x'.repeat(cap - tail.length) + tail;
    assert.equal(big.length, cap);
    const r = P.redact(big);
    assert.ok(!r.skipped);
    assert.equal(countOf(r, 'us-ssn'), 1);
    assert.ok(r.redacted.endsWith(' ssn [SSN]'));
  });
});

// The pre-send gate. This is the rule that decides whether "Tokenize & Send" is
// allowed to trigger the site's send at all. It exists because Perplexity's
// Lexical composer accepted a DOM-only write while its own editor state still
// held — and sent — the ORIGINAL text.
describe('verifyRedaction(): pre-send safety gate', () => {
  const MASKED = 'My SSN is [SSN] and card [CREDIT-CARD]';
  const LABELS = ['[SSN]', '[CREDIT-CARD]'];
  const ORIGINAL = `My SSN is 123-45-6789 and card ${VALID_CARD}`;

  test('composer reads back exactly the masked text → safe to send', () => {
    const v = P.verifyRedaction(MASKED, MASKED, LABELS);
    assert.equal(v.ok, true);
    assert.equal(v.exact, true);
    assert.deepEqual(v.leftovers, []);
  });

  test('rich editor reflowed paragraphs and NBSP → still safe to send', () => {
    const reflowed = 'My SSN is [SSN]\n\nand card [CREDIT-CARD]   ';
    const expected = 'My SSN is [SSN]\nand card [CREDIT-CARD]';
    const v = P.verifyRedaction(reflowed, expected, LABELS);
    assert.equal(v.ok, true);
    assert.deepEqual(v.leftovers, []);
  });

  test('labels present but the text is otherwise restructured → safe to send', () => {
    const v = P.verifyRedaction('> [SSN] // [CREDIT-CARD]', MASKED, LABELS);
    assert.equal(v.exact, false);
    assert.equal(v.labelsPresent, true);
    assert.equal(v.ok, true);
  });

  test('THE PERPLEXITY BUG: composer still holds the original → REFUSE', () => {
    const v = P.verifyRedaction(ORIGINAL, MASKED, LABELS);
    assert.equal(v.ok, false, 'must never authorize a send while the original is in the box');
    assert.equal(v.labelsPresent, false);
    assert.deepEqual(v.leftovers.sort(), ['credit-card', 'us-ssn']);
  });

  test('fails closed on a PARTIAL write — one label landed, one value survived', () => {
    const partial = 'My SSN is [SSN] and card 4111111111111111';
    const v = P.verifyRedaction(partial, MASKED, LABELS);
    assert.equal(v.labelsPresent, false, 'labelsPresent is all-or-nothing');
    assert.deepEqual(v.leftovers, ['credit-card']);
    assert.equal(v.ok, false, 'any surviving sensitive value vetoes the send');
  });

  test('fails closed even when EVERY label is present but a value survived', () => {
    // The nastiest shape: the box looks masked, yet a value is still in there.
    const sneaky = `[SSN] [CREDIT-CARD] oh and ${VALID_CARD}`;
    const v = P.verifyRedaction(sneaky, MASKED, LABELS);
    assert.equal(v.labelsPresent, true);
    assert.deepEqual(v.leftovers, ['credit-card']);
    assert.equal(v.ok, false, 'leftovers must veto the send regardless of labels');
  });

  test('empty / cleared composer → REFUSE', () => {
    assert.equal(P.verifyRedaction('', MASKED, LABELS).ok, false);
    assert.equal(P.verifyRedaction('   ', MASKED, LABELS).ok, false);
  });

  test('null / non-string readback → REFUSE', () => {
    assert.equal(P.verifyRedaction(null, MASKED, LABELS).ok, false);
    assert.equal(P.verifyRedaction(undefined, MASKED, LABELS).ok, false);
    assert.equal(P.verifyRedaction(42, MASKED, LABELS).ok, false);
  });

  test('missing/empty label list still passes on an exact match', () => {
    assert.equal(P.verifyRedaction(MASKED, MASKED, []).ok, true);
    assert.equal(P.verifyRedaction(MASKED, MASKED, null).ok, true);
  });

  test('missing label list and a non-exact readback → REFUSE', () => {
    assert.equal(P.verifyRedaction('something else entirely', MASKED, []).ok, false);
  });

  test('readLength is reported for diagnostics', () => {
    assert.equal(P.verifyRedaction(MASKED, MASKED, LABELS).readLength, MASKED.length);
  });

  test('end-to-end: redact() output verifies against itself', () => {
    const r = redactAllDetected(ORIGINAL);
    const labels = r.replacements.map((x) => x.label);
    assert.equal(P.verifyRedaction(r.redacted, r.redacted, labels).ok, true);
    assert.equal(P.verifyRedaction(ORIGINAL, r.redacted, labels).ok, false);
  });
});

describe('redact(): does not disturb scan()', () => {
  test('scan() counts are stable across interleaved redact() calls', () => {
    const text = `ssn 123-45-6789 card ${VALID_CARD} aws AKIAIOSFODNN7EXAMPLE`;
    const before = P.scan(text);
    redactAllDetected(text);
    redactAllDetected('phone 555-867-5309');
    const after = P.scan(text);
    assert.deepEqual(after, before);
  });
});
