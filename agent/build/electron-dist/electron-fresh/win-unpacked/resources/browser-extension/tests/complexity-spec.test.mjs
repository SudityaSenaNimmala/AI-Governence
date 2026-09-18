// Pins docs/MODEL_ROUTING_COMPLEXITY.md to the shipped classifier.
//
// WHY THIS EXISTS. That document specifies a customer-visible, billable behaviour:
// which model tier a prompt is routed to. A spec that drifts from the code is worse
// than no spec, because it is quoted with confidence. So every threshold it states
// is read back out of the markdown and compared against the real classifier, and
// every worked example in it is re-classified for real.
//
// If this test fails, ONE of the two is wrong — fix both together, never just the
// test. The failure message names which number disagreed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadComplexity } from './load-complexity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.join(here, '..', 'content', 'complexity.js');
const DOC_PATH = path.join(here, '..', '..', 'docs', 'MODEL_ROUTING_COMPLEXITY.md');

const src = readFileSync(SRC_PATH, 'utf8');
const doc = readFileSync(DOC_PATH, 'utf8');
const { classify, VERSION } = loadComplexity();

/** The value of a `const NAME = <number>;` in the classifier source. */
function constFromSource(name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(-?\\d+)\\s*;`).exec(src);
  assert.ok(m, `complexity.js no longer declares ${name} — the spec references it`);
  return Number(m[1]);
}

/** The value the doc states for a constant, from any `| \`NAME\` | value |` row. */
function constFromDoc(name) {
  const m = new RegExp(`\\|\\s*\`${name}\`\\s*\\|\\s*(−?-?\\d+)\\s*\\|`).exec(doc);
  assert.ok(m, `the spec no longer documents ${name}`);
  // The doc uses a typographic minus (U+2212) for readability.
  return Number(m[1].replace('−', '-'));
}

test('every threshold the spec states matches the classifier', () => {
  for (const name of [
    'COMPLEX_AT', 'SIMPLE_AT', 'STRONG_WEIGHT', 'CAP_PER_CATEGORY',
    'MAX_TRIVIAL_TOKENS', 'MAX_FILLER_CONTENT_TOKENS',
  ]) {
    assert.equal(constFromDoc(name), constFromSource(name),
      `${name}: spec says ${constFromDoc(name)}, code says ${constFromSource(name)}`);
  }
});

test('the spec quotes the shipped classifier version', () => {
  assert.ok(doc.includes(`\`${VERSION}\``),
    `spec does not mention classifier version ${VERSION} — bump it alongside the code`);
});

test('the spec states the analysis window the code uses', () => {
  const head = constFromSource('WINDOW_HEAD');
  const tail = constFromSource('WINDOW_TAIL');
  assert.ok(doc.includes(String(head)) && doc.includes(String(tail)),
    `spec must state the ${head}/${tail} character analysis window`);
});

// The category count the spec corrects. If someone adds or removes a category, the
// spec's "twelve compiled categories / nine positive" claim has to move with it.
test('the spec states the real category counts', () => {
  // Count only the entries INSIDE the POSITIVE array — the three negative
  // categories are compiled by the same helper just below it, so a whole-file
  // count of compileCategory( is 12 and says nothing about the split.
  const from = src.indexOf('const POSITIVE = [');
  assert.ok(from > 0, 'POSITIVE array not found');
  const positiveBlock = src.slice(from, src.indexOf('];', from));
  const positive = (positiveBlock.match(/compileCategory\('/g) || []).length;
  const negatives = ['CAT_SIMPLE_TASK', 'CAT_SIMPLICITY_REQUEST', 'CAT_TRIVIAL_INTENT']
    .filter((n) => src.includes(n)).length;
  assert.equal(positive, 9, 'positive category count changed — update the spec table');
  assert.equal(positive + negatives, 12, 'total category count changed — update the spec');
  assert.equal(negatives, 3, 'negative category count changed — update the spec table');
  assert.match(doc, /Twelve compiled categories/i);
  assert.match(doc, /Nine contribute positively, three negatively/i);
});

// `architect*` at weight 6 is the one term the spec calls out in bold, because it
// is the only single term that reaches COMPLEX_AT on its own. If it is retuned, the
// spec's worked example for "architecture" stops being true.
test('the single-term-to-complex claim still holds', () => {
  const m = /\['architect\*',\s*(\d+)\]/.exec(src);
  assert.ok(m, 'architect* is no longer in the lexicon');
  assert.equal(Number(m[1]), constFromSource('COMPLEX_AT'),
    'architect* no longer equals COMPLEX_AT — the spec says one word suffices');
  assert.equal(classify('architecture'), 'complex');
});

// Every worked example in section 4, re-run for real.
const WORKED_EXAMPLES = [
  ['hi', 'simple'],
  ['2+2', 'simple'],
  ['define idempotent', 'simple'],
  ['explain cloud computing in simple words', 'simple'],
  ['what is 2+2', 'simple'],
  ['42', 'moderate'],
  ['summarize this email', 'moderate'],
  ['write a python function to reverse a string', 'moderate'],
  ['explain zero-trust architecture in simple terms', 'moderate'],
  ['zxqv wobble frimble', 'moderate'],
  ['architecture', 'complex'],
  ['why does this deadlock', 'complex'],
  ["what's our architecture for the billing service?", 'complex'],
  ['design a multi-tenant migration plan with rollback', 'complex'],
];

test('every worked example in the spec is reproducible', () => {
  for (const [prompt, expected] of WORKED_EXAMPLES) {
    assert.equal(classify(prompt), expected,
      `spec says ${JSON.stringify(prompt)} -> ${expected}`);
    assert.ok(doc.includes(prompt.replace(/\|/g, '\\|')),
      `${JSON.stringify(prompt)} is asserted here but absent from the spec`);
  }
});

// The spec's headline claim. Worth pinning directly: it is the sentence a customer
// is most likely to be told.
test('the spec\'s "length is not a signal" claim is true of the code', () => {
  const longEasy = 'Please explain cloud computing in simple words. '
    + 'I would really appreciate a friendly walkthrough. '.repeat(40);
  assert.ok(longEasy.length > 2000);
  assert.equal(classify(longEasy), 'simple', 'a long easy prompt stopped being simple');
  assert.equal(classify('architecture'), 'complex', 'a 12-char prompt stopped being complex');

  // Bulk alone must not move a verdict.
  const base = 'summarize this email. ';
  const one = classify(base);
  assert.equal(classify(base.repeat(100)), one, 'repetition changed the tier');

  // And no length/size term exists in the scoring path.
  const scoring = src.slice(src.indexOf('function scoreAll'), src.indexOf('window.__cfaiComplexity'));
  assert.doesNotMatch(scoring, /\.length\s*[><]/,
    'a length comparison appeared in the scoring path — the spec says there is none');
});
