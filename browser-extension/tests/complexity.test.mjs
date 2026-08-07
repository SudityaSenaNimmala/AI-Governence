// The prompt-complexity classifier behind the Smart Model Router.
//
// The router spends real money on the user's behalf: 'simple' sends the prompt
// to the cheapest model in the tier, 'complex' can upgrade it. So the thing that
// actually matters here is not any single verdict — it's that the verdict comes
// from what the prompt ASKS and never from how LONG it is. The classifier this
// replaced read length whenever its two keyword regexes both missed, which gave
// us both failure directions at once:
//
//   * "What's our architecture for the billing service?" -> 'simple'
//     (\barchitect\b can't match "architecture"; 47 chars < 300 -> simple)
//   * a long, padded "explain X in simple words" -> 'moderate'
//     (no keyword hit; >800 chars -> moderate)
//
// Both are pinned below as named regressions. The general guard is the repetition
// property test: restating the SAME content must never move a prompt's tier. Note
// what that does and does not claim — the classifier bounds its analysis to a
// ~4000-character window for latency, so it is emphatically NOT length-invariant
// without limit. A signal past the window is simply not read. See the two tests
// under "properties" for both halves of that.
//
// Everything runs the SHIPPED content/complexity.js (see load-complexity.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadComplexity, loadComplexityWindow } from './load-complexity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const { classify, VERSION } = loadComplexity();

const TIERS = ['simple', 'moderate', 'complex'];

// ── module contract ─────────────────────────────────────────────────────────

test('complexity.js publishes window.__cfaiComplexity with classify + VERSION', () => {
  const win = loadComplexityWindow();
  assert.ok(win.__cfaiComplexity, 'the module must publish onto window');
  assert.equal(typeof win.__cfaiComplexity.classify, 'function');
  assert.ok(
    typeof win.__cfaiComplexity.VERSION === 'string' || typeof win.__cfaiComplexity.VERSION === 'number',
    'VERSION must be published so stored verdicts can be traced to a lexicon revision',
  );
  assert.equal(win.__cfaiComplexityLoaded, true, 'the double-injection guard must be set');
});

test('content.js only ever asks the module for a verdict — no lexicon of its own', () => {
  const src = readFileSync(path.join(root, 'content', 'content.js'), 'utf8');
  assert.match(src, /window\.__cfaiComplexity/, 'classifyComplexity must read the module off window');
  // The old flat regexes had to GO, not linger as a dead second opinion.
  assert.doesNotMatch(src, /COMPLEX_RE|SIMPLE_RE/,
    'the superseded keyword regexes must not still be in content.js');
  // Length must not creep back into the routing decision.
  const at = src.indexOf('function classifyComplexity');
  assert.ok(at > 0, 'classifyComplexity is still the router\'s entry point');
  const body = src.slice(at, src.indexOf('\n  }', at));
  assert.doesNotMatch(body, /\.length/, 'the router must not reintroduce a length heuristic');
  assert.match(body, /'moderate'/, 'a missing module must fall back to moderate, not simple');
});

// ── the acceptance table ────────────────────────────────────────────────────
// Each row is its own test so a failure names the prompt that broke.

const VERDICTS = [
  // hard asks
  ['Design a zero-trust architecture for AWS', 'complex'],
  // PINS `architect*` AT WEIGHT 6. This row has exactly one lexicon hit, so it is
  // 'complex' only because that single term clears COMPLEX_AT on its own. Drop the
  // weight to 4 like its siblings and this silently becomes 'moderate'. See the
  // tradeoff comment on the entry in content/complexity.js before retuning it.
  ["What's our architecture for the billing service?", 'complex'],
  ['Optimize this algorithm', 'complex'],
  ['fix this SQL injection', 'complex'],
  ['Why does this deadlock under load?', 'complex'],
  ['Plan the migration from MySQL to Postgres', 'complex'],
  ['Compare Kafka and RabbitMQ trade-offs', 'complex'],
  // easy asks
  ['Explain cloud computing in simple words', 'simple'],
  ['hi', 'simple'],
  ['thanks', 'simple'],
  ['ok thanks!', 'simple'],
  ['define idempotent', 'simple'],
  ['translate this to French: Hello, how are you?', 'simple'],
  // real but unremarkable
  ['Summarize this email', 'moderate'],
  ['Write a haiku about autumn', 'moderate'],
  // no signal at all -> the default, which must not be a cost decision
  ['Untangle the knot in my deployment story', 'moderate'],
  ['', 'moderate'],
  ['   ', 'moderate'],
  // the trivial fast path must not fire on a real task wearing a greeting
  ['hi, can you design a distributed cache?', 'complex'],
];

for (const [prompt, expected] of VERDICTS) {
  test(`verdict: ${JSON.stringify(prompt)} -> ${expected}`, () => {
    assert.equal(classify(prompt), expected);
  });
}

// ── the two originally-broken cases, called out by name ─────────────────────

test('regression: a short architecture question is complex, not simple', () => {
  // \barchitect\b could not match "architecture", so this fell to the length
  // heuristic, which saw 47 characters and said 'simple' — a design question
  // routed to the cheapest model.
  //
  // ALSO PINS `architect*` AT WEIGHT 6, deliberately. Every prompt below has one
  // lexicon hit and nothing else, so each is 'complex' purely on that one term's
  // weight; at 4 they all fall to 'moderate' and this test's real purpose is lost.
  // The weight is a considered tradeoff (it also makes any architecture mention
  // veto the simplicity override) — read the comment on the entry in
  // content/complexity.js before "fixing" it downward.
  assert.equal(classify("What's our architecture for the billing service?"), 'complex');
  assert.equal(classify('Review the architecture'), 'complex');
  assert.equal(classify('architectural review please'), 'complex');
});

test('regression: a long, easy explanation stays simple — length is not difficulty', () => {
  const padded =
    'Explain cloud computing in simple words. ' +
    'I want to understand what it means and how people use it every day. '.repeat(15);
  assert.ok(padded.length > 800, 'the old >800-char rule needs >800 chars to reproduce');
  // Old behaviour: no keyword hit, len > 800 -> 'moderate'. The task did not get
  // harder; the user just asked for more words about an easy subject.
  assert.equal(classify(padded), 'simple');
});

test('an explicit "keep it simple" does not override a genuinely hard subject', () => {
  // simplicityRequest matched, but so did a weight-4+ term. Asking nicely does
  // not make zero-trust architecture a Haiku-tier question.
  assert.notEqual(classify('explain zero-trust architecture in simple terms'), 'simple');
});

// ── pasted stack traces ─────────────────────────────────────────────────────
// Structural signals exist so a bare paste with no prose still registers. The
// exact tier is whatever the weights produce; what is NOT negotiable is that a
// crash dump never routes to the cheapest model.

const JAVA_TRACE = [
  'Exception in thread "main" java.lang.NullPointerException',
  '\tat com.example.billing.Invoice.total(Invoice.java:42)',
  '\tat com.example.billing.Main.main(Main.java:12)',
].join('\n');

const PYTHON_TRACE = [
  'Traceback (most recent call last):',
  '  File "app.py", line 12, in <module>',
  '    main()',
  '  File "app.py", line 8, in main',
  '    return rows[0]["total"]',
  'IndexError: list index out of range',
].join('\n');

test('a bare Java stack trace with no prose is scored, and never simple', () => {
  assert.equal(classify(JAVA_TRACE), 'moderate');
});

test('a bare Python traceback with no prose is scored, and never simple', () => {
  // Higher than the Java one because "Traceback" hits both the structural probe
  // and the lexicon term.
  assert.equal(classify(PYTHON_TRACE), 'complex');
});

// ── properties ──────────────────────────────────────────────────────────────
// These matter more than any individual row above: they are what actually stop
// the length heuristic from coming back.

/**
 * 21 copies of `text`, separated so the copies stay copies.
 *
 * Deliberately NOT `text + text.repeat(20)`: gluing the copies edge-to-edge fuses
 * the last token of one copy onto the first token of the next and invents words
 * that were never in the prompt — 'hi' pads to "hi hihihihihi…", one greeting plus
 * one 40-character nonsense token, and 'ok thanks!' grows "thanks!ok" tokens. That
 * is not the same content repeated, so it cannot test what this property is about.
 */
function repeated(text, copies = 21) {
  return Array.from({ length: copies }, () => text).join(' ');
}

test('property: repeating the SAME content never changes its tier', () => {
  // The guarantee is about CONTENT, not length: saying the same thing twenty more
  // times adds no new signal, so the tier must not move. It is NOT a claim that
  // the classifier is length-invariant without limit — it reads a bounded window,
  // and the test below pins that boundary honestly.
  for (const [prompt] of VERDICTS) {
    const plain = classify(prompt);
    const padded = classify(repeated(prompt));
    assert.equal(padded, plain,
      `repetition changed the verdict for ${JSON.stringify(prompt)}: ${plain} -> ${padded}`);
  }
  for (const trace of [JAVA_TRACE, PYTHON_TRACE]) {
    assert.equal(classify(repeated(trace)), classify(trace));
  }
});

test('property: the analysis window is a latency bound, not a detection guarantee', () => {
  // The honest statement of the limit, so nobody reads the property above as
  // "length never matters at all". The classifier scans ~3000 leading + ~1000
  // trailing characters; a signal buried in the middle of something much larger is
  // not read, and is not required to be. This is a documented CPU tradeoff, not a
  // length heuristic: the unread text does not push the verdict in EITHER
  // direction, it simply contributes nothing.
  const filler = 'the quick brown fox jumps over the lazy dog. '.repeat(200); // ~9000 chars
  const buried = filler + ' zero-trust architecture ' + filler;
  assert.ok(buried.length > 4000 + 4000, 'the signal must actually sit outside the window');
  assert.equal(classify(buried), 'moderate', 'a signal past the window is not detected');

  // Same signal, same filler, but inside the window -> found. Length did not
  // change the answer; POSITION relative to the bound did.
  assert.equal(classify('zero-trust architecture ' + filler), 'complex');
});

test('property: repetition immunity — saying a word 50 times is not 50 signals', () => {
  assert.equal(classify('architecture '.repeat(50)), classify('architecture'));
  assert.equal(classify('why why why why why why why why'), classify('why'));
});

test('property: inflections of ONE lexicon entry are one signal, not one each', () => {
  // The cap counts distinct lexicon ENTRIES. Keying it on the matched substring
  // instead made `debug*` score twice for "debugging" + "debugger" — two spellings
  // of one idea beating the cap that exists precisely to stop that. Each of these
  // must score exactly what the single bare term scores.
  assert.equal(classify('optimize the optimization'), classify('optimize'));
  assert.equal(classify('debugging this debugger'), classify('debug'));
  assert.equal(classify('analyze the analysis'), classify('analyze'));
  assert.equal(classify('implement the implementation'), classify('implement'));
  // and concretely: one weight-3 term is a moderate ask, not a premium one
  for (const p of ['optimize the optimization', 'debugging this debugger',
                   'analyze the analysis', 'implement the implementation']) {
    assert.equal(classify(p), 'moderate', `${JSON.stringify(p)} double-counted one entry`);
  }
});

test('property: the per-category cap actually caps', () => {
  // Four distinct weight-2 planning terms. Capped at the two heaviest that is 4
  // (moderate); uncapped it would be 8 and this would masquerade as a premium ask.
  // A prompt that rattles off synonyms for one idea must not out-score a prompt
  // that is genuinely hard in several dimensions.
  assert.equal(classify('plan the phases'), 'moderate');
  assert.equal(classify('plan the phases, milestones and rollout'), 'moderate');
});

test('property: the cap keeps the top 2 BY WEIGHT, not the first 2 encountered', () => {
  // Reading order here is deliberately worst-case: the two weight-2 terms (vpc,
  // iam) come first and the two weight-4 terms (zero trust, algorithms) last, all
  // in domainExpertise. First-2-encountered scores 2+2=4 -> moderate. Top-2-by-
  // weight scores 4+4=8 -> complex. The two rules disagree on the TIER, so this
  // cannot pass by accident.
  const mixed = 'check the vpc and iam settings for zero trust and algorithms';
  assert.equal(classify('check the vpc and iam settings'), 'moderate',
    'the two terms that appear FIRST are only worth 4 on their own');
  assert.equal(classify(mixed), 'complex',
    'the cap kept the first two terms it saw instead of the two heaviest');
});

test('property: categories add up — two moderate signals make one complex ask', () => {
  // The cap is per category, so difficulty in several dimensions accumulates. Each
  // half below is moderate alone; together they must clear the complex threshold.
  // Tested directly rather than left to whichever acceptance rows happen to mix
  // categories, because this is the property that makes the cap safe to have.
  assert.equal(classify('design'), 'moderate');            // taskComplexity, 3
  assert.equal(classify('race condition'), 'moderate');    // debugging, 4
  assert.equal(classify('design around the race condition'), 'complex');
});

test('regression: a stray "no"/"ok"/"thanks" does not make a real question trivial', () => {
  // The -8 trivialIntent penalty used to apply whenever NO positive term matched
  // anywhere — and since the lexicon is ~200 terms, most ordinary English matches
  // nothing at all. So any everyday sentence containing one of these words was
  // scored as a greeting and routed to the cheapest model. The gate is now real
  // dominance: greetings must actually outnumber the content in the message.
  const realQuestions = [
    'no matter what I try the deploy hangs at the same place',
    'ok so where should I put the new module',
    'yes but what about the case where the user closes the tab',
    'hey what is the difference between these two approaches',
    'I got no output at all from the last run',
    'thanks for that, now how do I roll it back',
    'my build is broken and I have no clue where to start',
  ];
  for (const p of realQuestions) {
    assert.notEqual(classify(p), 'simple', `${JSON.stringify(p)} was read as a greeting`);
  }
  // ...while messages that really ARE just a greeting still are.
  for (const p of ['hi', 'thanks', 'ok thanks!', 'hey', 'ok thanks !', 'hi there thanks']) {
    assert.equal(classify(p), 'simple', `${JSON.stringify(p)} is a greeting`);
  }
});

test('regression: a multi-word term still matches when a line break splits it', () => {
  // Shift+Enter mid-phrase, or a paste that wrapped. The phrase is the signal; the
  // whitespace between its words is not.
  assert.equal(classify('why find the root\ncause'), classify('why find the root cause'));
  assert.equal(classify('compare the pros and\ncons'), classify('compare the pros and cons'));
  assert.equal(classify('why find the root\ncause'), 'complex');
  assert.equal(classify('compare the pros and\ncons'), 'complex');
});

test('regression: plural usage scores the same as the singular', () => {
  // Singular-only lexicon entries scored zero on the plural, so "why do we get
  // deadlocks" quietly lost a weight-4 signal that "why does this deadlock" kept.
  const pairs = [
    ['Why does this deadlock under load?', 'Why do we get deadlocks under load?'],
    ['why do we hit a race condition here', 'why do we hit race conditions here'],
    ['why do we have a memory leak here', 'why do we have memory leaks here'],
    ['why do we have a sql injection here', 'why do we have sql injections here'],
    ['why do we need a threat model here', 'why do we need threat models here'],
    ['why do we run a penetration test here', 'why do we run penetration tests here'],
  ];
  for (const [singular, plural] of pairs) {
    assert.equal(classify(plural), classify(singular),
      `plural lost the signal: ${JSON.stringify(plural)}`);
    assert.equal(classify(plural), 'complex');
  }
});

test('regression: a greeting in front of ANY script does not take the trivial fast path', () => {
  // The fast path used to consult an enumerated list of "non-Latin" script ranges.
  // Thai, Greek and friends were not on it, so their letters stripped away to an
  // empty token, hit the emoji carve-out, and "ok <a real question>" was read as
  // the lone word "ok". The rule is now script-blind: any Unicode letter that is
  // not a recognised greeting is content.
  const prefixed = [
    'ok สวัสดีครับช่วยออกแบบระบบ', // Thai
    'ok πως σχεδιάζω το σύστημα',                     // Greek
    'ok தமிழ் கேள்வி',                                                                             // Tamil
    'ok ქართული',                                                                                                       // Georgian
  ];
  for (const p of prefixed) {
    assert.notEqual(classify(p), 'simple', `${JSON.stringify(p)} took the greeting fast path`);
  }
  // Emoji and punctuation are still not letters, so the existing carve-out that
  // lets them ride along with a greeting is untouched.
  assert.equal(classify('ok 🙂'), 'simple');
  assert.equal(classify('thanks!!! 🙂🙂'), 'simple');
});

test('property: total function — never throws, always one of the three tiers', () => {
  const hostile = [
    null,
    undefined,
    '',
    '   ',
    '\t\n\r ',
    '🙂🙂🙂',
    0,
    {},
    [],
    'x'.repeat(100 * 1024),
    Array.from({ length: 20000 }, () => String.fromCharCode(32 + Math.floor(Math.random() * 95))).join(''),
    'lone surrogate: \uD800 and \uDFFF trailing',
    '```'.repeat(500),
  ];
  for (const input of hostile) {
    let out;
    assert.doesNotThrow(() => { out = classify(input); }, `threw on ${typeof input}`);
    assert.ok(TIERS.includes(out), `returned ${JSON.stringify(out)} for ${typeof input}`);
  }
});

test('property: non-Latin script is scored, not mistaken for a one-word greeting', () => {
  // Whitespace tokenisation is meaningless for CJK, so the trivial fast path is
  // skipped rather than allowed to read a whole sentence as one trivial token.
  for (const s of ['设计一个分布式缓存系统', 'привет как дела сегодня друг', 'こんにちは']) {
    assert.ok(TIERS.includes(classify(s)));
  }
  assert.notEqual(classify('设计一个分布式缓存系统'), 'simple');
});

test('property: 100KB of prompt classifies in well under a frame', () => {
  // The window bound is the only reason this is safe to run on every send, on
  // the keydown path, before the message goes out.
  const big = ('Design a distributed system. ' + 'filler words here. '.repeat(50)).repeat(200);
  assert.ok(big.length > 100 * 1024);
  const t0 = Date.now();
  classify(big);
  assert.ok(Date.now() - t0 < 50, 'classification must not stall the send path');
});

// ── contract with the router ────────────────────────────────────────────────

test('contract: every verdict is a key smartRoute\'s ROUTE_TABLE actually indexes', () => {
  const src = readFileSync(path.join(root, 'content', 'content.js'), 'utf8');
  const at = src.indexOf('const ROUTE_TABLE = {');
  assert.ok(at > 0, 'ROUTE_TABLE not found in content.js');
  const region = src.slice(at, src.indexOf('\n  };', at));
  const keys = new Set(
    [...region.matchAll(/^\s+(\w+):\s*(?:\{\s*uiName|null,)/gm)].map((m) => m[1]),
  );

  assert.deepEqual([...keys].sort(), [...TIERS].sort(),
    'ROUTE_TABLE\'s complexity keys and the classifier\'s tiers have drifted apart — ' +
    'an unrecognised tier makes smartRoute silently return null and stop routing');

  // And the classifier really only ever produces those keys.
  const corpus = [
    ...VERDICTS.map(([p]) => p),
    JAVA_TRACE, PYTHON_TRACE,
    'hello', 'audit our GDPR exposure end to end', '```js\nconst x = 1;\n```',
  ];
  for (const p of corpus) assert.ok(keys.has(classify(p)), `${JSON.stringify(p)} -> unroutable tier`);
});

test('VERSION is pinned so a lexicon change is a visible change', () => {
  assert.match(String(VERSION), /^\d+\.\d+\.\d+$/);
});
