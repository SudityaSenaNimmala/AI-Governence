// One definition of simple / moderate / complex across all three routing paths.
//
// WHAT THIS TEST IS DEFENDING AGAINST — it is not hypothetical. The product
// shipped with THREE independent classifiers feeding ONE rule set:
//
//   browser-extension/content/complexity.js   weighted lexicon, no length input
//   agent/src/proxy/router.js                 tokens < 100 -> simple
//   agent/src/desktop_injector/hook-renderer  tokens < 100 -> simple
//
// Every routing rule in the database says things like `complexity: simple`, and
// the server hands the same rules to all three. So one admin rule was matching
// three different definitions of the word, and this came out of it:
//
//   "what's our architecture for the billing service?"
//      browser  -> complex  -> Opus     (architect* scores 6)
//      proxy    -> simple   -> Haiku    (48 chars, ~12 tokens)
//      desktop  -> simple   -> Haiku
//
// Same prompt, opposite tier, depending on how the user happened to reach the
// model — and the customer sees the difference on their invoice. The proxy and
// desktop classifiers are gone now; both consume artifacts generated from the
// canonical extension file. This test is what keeps that true: it loads the
// canonical classifier and BOTH generated artifacts and asserts they agree,
// prompt for prompt.
//
// If this test fails, do not edit the generated files. Run:
//   node scripts/gen-proxy-complexity.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..');

const CANONICAL_SRC = path.join(repo, 'browser-extension', 'content', 'complexity.js');
const INLINE_SRC = path.join(repo, 'agent', 'src', 'desktop_injector', 'complexity.inline.js');
const ESM_SRC = path.join(repo, 'agent', 'src', 'proxy', 'complexity.js');

/** Evaluate a classic-script classifier against a bare window stub. */
function loadWindowStyle(file) {
  const src = readFileSync(file, 'utf8');
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', src)(win);
  if (!win.__cfaiComplexity) throw new Error(`${path.basename(file)} did not publish window.__cfaiComplexity`);
  return win.__cfaiComplexity;
}

const canonical = loadWindowStyle(CANONICAL_SRC);
const inline = loadWindowStyle(INLINE_SRC);
const { __cfaiComplexity: esm } = await import(pathToFileUrl(ESM_SRC));
const { classifyComplexity: proxyClassify } = await import(pathToFileUrl(path.join(repo, 'agent', 'src', 'proxy', 'router.js')));

function pathToFileUrl(p) {
  // Windows paths need the file:// URL form for dynamic import, and this repo
  // checks out under a path with spaces and a comma.
  return new URL(`file:///${p.replace(/\\/g, '/')}`).href;
}

// The corpus deliberately mixes the documented acceptance rows with the exact
// prompts the old length-first classifiers got wrong.
const CORPUS = [
  // trivial / greeting fast path
  'hi', 'hello there', 'ok thanks', 'thank you', 'bye',
  // arithmetic shape test
  '2+2', 'what is 2+2', '12 x 7', 'what is 15% of 240', '8÷2', '42', '3.14',
  // negative terms
  'define idempotent', 'fix typo in the readme', 'write a commit message',
  'translate this to German', 'tell me a joke',
  // explicit simplicity
  'explain cloud computing in simple words',
  'explain zero-trust architecture in simple terms',
  'give me an overview of kubernetes',
  'eli5 how does dns work',
  // the regressions the old classifiers inverted — SHORT and hard
  "what's our architecture for the billing service?",
  'architecture',
  'why does this deadlock',
  'cap theorem',
  'is this a sql injection',
  // long and easy
  'Explain cloud computing in simple words. '.repeat(60),
  // no signal at all
  '42', 'zxqv wobble frimble', 'capital of France', 'who wrote Hamlet',
  // real work
  'summarize this email', 'write a python function to reverse a string',
  'design a multi-tenant migration plan with rollback',
  'debug this race condition in the scheduler',
  'Traceback (most recent call last)\n  File "x.py", line 2\nValueError: bad',
  '```js\nconst x = 1;\n```\nwhy is this failing',
  // greeting bolted onto a hard question — the dominance gate
  'hi, can you design a distributed cache?',
  // non-Latin script
  'こんにちは、システム設計について教えてください',
  // edge inputs
  '', '   ', '\n\n',
];

test('all three routing paths load the same classifier version', () => {
  assert.equal(typeof canonical.VERSION, 'string');
  assert.equal(inline.VERSION, canonical.VERSION,
    'desktop inline copy is stale — run: node scripts/gen-proxy-complexity.mjs');
  assert.equal(esm.VERSION, canonical.VERSION,
    'proxy ES module is stale — run: node scripts/gen-proxy-complexity.mjs');
});

test('the desktop inline copy is byte-identical to the canonical source', () => {
  const canon = readFileSync(CANONICAL_SRC, 'utf8');
  const generated = readFileSync(INLINE_SRC, 'utf8');
  assert.ok(
    generated.endsWith(canon),
    'complexity.inline.js is not the canonical source verbatim — run: node scripts/gen-proxy-complexity.mjs',
  );
});

test('proxy ES module agrees with the canonical classifier on every prompt', () => {
  const divergences = [];
  for (const prompt of CORPUS) {
    const want = canonical.classify(prompt);
    const got = esm.classify(prompt);
    if (want !== got) divergences.push({ prompt: prompt.slice(0, 60), want, got });
  }
  assert.deepEqual(divergences, [],
    'proxy classifier diverged from the canonical one — run: node scripts/gen-proxy-complexity.mjs');
});

test('desktop inline copy agrees with the canonical classifier on every prompt', () => {
  const divergences = [];
  for (const prompt of CORPUS) {
    const want = canonical.classify(prompt);
    const got = inline.classify(prompt);
    if (want !== got) divergences.push({ prompt: prompt.slice(0, 60), want, got });
  }
  assert.deepEqual(divergences, [],
    'desktop classifier diverged from the canonical one — run: node scripts/gen-proxy-complexity.mjs');
});

// ── the regressions that made this test necessary ───────────────────────────

test('a short architecture question is complex on every path', () => {
  const prompt = "what's our architecture for the billing service?";
  // The old proxy/desktop rule was `tokens < 100 -> simple`, and this prompt is
  // ~12 tokens. It must now reach the premium tier everywhere.
  assert.equal(canonical.classify(prompt), 'complex');
  assert.equal(esm.classify(prompt), 'complex');
  assert.equal(inline.classify(prompt), 'complex');
  assert.equal(proxyClassify(prompt), 'complex');
});

test('a long easy prompt is not complex on any path', () => {
  const prompt = 'Explain cloud computing in simple words. '.repeat(60);
  // The mirror-image bug: the old rule sent anything over ~3000 tokens to the
  // premium tier on length alone.
  for (const [name, c] of [['canonical', canonical], ['proxy', esm], ['desktop', inline]]) {
    assert.notEqual(c.classify(prompt), 'complex', `${name} upgraded a long easy prompt`);
  }
});

test('repeating the same content never changes the tier on any path', () => {
  for (const base of ['summarize this email', 'define idempotent', 'why does this deadlock']) {
    const short = base;
    const long = (base + ' ').repeat(40).trim();
    for (const [name, c] of [['canonical', canonical], ['proxy', esm], ['desktop', inline]]) {
      assert.equal(c.classify(short), c.classify(long),
        `${name} changed its verdict for repeated content: ${JSON.stringify(base)}`);
    }
  }
});

// ── the proxy's one deliberate difference ───────────────────────────────────

test("proxy returns 'unknown' for absent text, so no rule matches", () => {
  // In the browser an empty prompt means the user typed nothing and sent an
  // attachment, and 'moderate' is the safe answer. In the proxy it means we
  // could not extract prompt text from the request body — a different claim.
  // 'unknown' matches no complexity condition, so the request is forwarded
  // untouched rather than routed on a guess.
  assert.equal(proxyClassify(''), 'unknown');
  assert.equal(proxyClassify(null), 'unknown');
  assert.equal(proxyClassify(undefined), 'unknown');
  // With real text it defers entirely to the shared classifier.
  assert.equal(proxyClassify('architecture'), canonical.classify('architecture'));
  assert.equal(proxyClassify('hi'), canonical.classify('hi'));
});

test('classification never throws, on any path', () => {
  const hostile = [null, undefined, 42, {}, [], ' ', '💥'.repeat(500), 'x'.repeat(200_000)];
  for (const input of hostile) {
    for (const [name, c] of [['canonical', canonical], ['proxy', esm], ['desktop', inline]]) {
      assert.doesNotThrow(() => c.classify(input), `${name} threw on ${String(input).slice(0, 20)}`);
      assert.ok(['simple', 'moderate', 'complex'].includes(c.classify(input)),
        `${name} returned a non-tier for ${String(input).slice(0, 20)}`);
    }
  }
});

// ── The routed model must be actionable on every path ───────────────────────
//
// A verdict is worthless if the model it selects cannot actually be applied.
// Both of these broke the moment the seeded rules moved to current model ids,
// and neither had any test coverage:
//
//   * MODEL_DISPLAY in hook-renderer.js maps an API id to the labels Claude
//     Desktop shows in its picker. changeModel() falls back to [targetModelId]
//     and asks whether the picker text contains it — and no picker renders
//     "claude-opus-5", so a missing entry is a SILENT no-op.
//   * pricing.js falls through to UNKNOWN (input: 0, output: 0), so a routed
//     model with no row is reported as free.

import { DEFAULT_RULES } from '../../server/src/seed-routing.js';
import { MODELS as PRICING_MODELS, priceFor } from '../src/server-monitor/pricing.js';

const ANTHROPIC_TARGETS = DEFAULT_RULES
  .filter((r) => r.provider === 'anthropic')
  .map((r) => r.action.model);

// Every model any seeded rule can route to, across all five providers.
const ALL_TARGETS = DEFAULT_RULES.map((r) => ({
  provider: r.provider,
  model: r.action.model,
  ui_name: r.action.ui_name,
  key: r.builtin_key,
}));

test('every routed model on a desktop-capable provider has a picker label', () => {
  const src = readFileSync(path.join(repo, 'agent', 'src', 'desktop_injector', 'hook-renderer.js'), 'utf8');
  const block = src.slice(src.indexOf('const MODEL_DISPLAY'), src.indexOf('};', src.indexOf('const MODEL_DISPLAY')));
  // providerFromHost() in the injector resolves exactly these three; Mistral and
  // Perplexity have no desktop app it recognises, so they are out of scope here.
  const DESKTOP_PROVIDERS = new Set(['anthropic', 'openai', 'google']);
  const missing = [];
  for (const { provider, model, key } of ALL_TARGETS) {
    if (!DESKTOP_PROVIDERS.has(provider)) continue;
    if (!block.includes(`'${model}'`)) missing.push(`${key} -> ${model}`);
  }
  assert.deepEqual(missing, [],
    'MODEL_DISPLAY is missing these — changeModel() falls back to matching the raw '
    + 'API id against picker text, which never matches, so the switch silently does nothing');
});

test('EVERY model the rules target, on every provider, is priced above zero', () => {
  // Five providers ship in DEFAULT_RULES but the price table only covered three:
  // gemini-2.0-flash, all five Mistral models and all three Perplexity models had
  // no row at all, so every one of them was costed at $0 — and $0 is
  // indistinguishable from free once it lands in a total.
  const unpriced = [];
  for (const { provider, model, key } of ALL_TARGETS) {
    const row = PRICING_MODELS.find((m) => m.match.test(model));
    if (!row || !(row.input > 0) || !(row.output > 0)) {
      unpriced.push(`${key} -> ${model} (${provider})`);
    }
  }
  assert.deepEqual(unpriced, [],
    'these routed models are priced at zero, so their spend is invisible');
});

test('the price row matched for each routed model belongs to that provider', () => {
  // Guards regex ordering. `/^sonar/` placed before `/^sonar-pro/` would price
  // Sonar Pro as Sonar, and the totals would look plausible while being wrong.
  for (const { provider, model, key } of ALL_TARGETS) {
    const row = PRICING_MODELS.find((m) => m.match.test(model));
    assert.equal(row.provider, provider,
      `${key} -> ${model} matched a ${row.provider} row (${row.family}) — check row order`);
  }
});

test('an unknown model is flagged unpriced, not silently free', () => {
  const row = priceFor('some-model-nobody-added-yet');
  assert.equal(row.input, 0);
  assert.equal(row.unpriced, true,
    'priceFor() must mark unknown models unpriced so callers can surface them');
  // A real model must NOT carry the flag.
  assert.ok(!priceFor('claude-opus-5').unpriced);
});

test('the two price tables agree on every routed model', () => {
  // server/src/routes/server-agents.js keeps its own copy. Where they disagree,
  // the same request costs two different amounts depending on which code path
  // reported it.
  const src = readFileSync(path.join(repo, 'server', 'src', 'routes', 'server-agents.js'), 'utf8');
  const block = src.slice(src.indexOf('const PRICING = ['), src.indexOf('];', src.indexOf('const PRICING = [')));
  const rows = [...block.matchAll(/\{\s*m:\s*(\/[^/]+\/),\s*input:\s*([\d.]+),\s*output:\s*([\d.]+)/g)]
    .map(([, re, input, output]) => ({
      // eslint-disable-next-line no-eval
      re: new RegExp(re.slice(1, -1)),
      input: Number(input),
      output: Number(output),
    }));

  const mismatches = [];
  for (const { model, key } of ALL_TARGETS) {
    const mine = PRICING_MODELS.find((m) => m.match.test(model));
    const theirs = rows.find((r) => r.re.test(model));
    if (!theirs) { mismatches.push(`${key} -> ${model}: absent from server-agents.js`); continue; }
    if (theirs.input !== mine.input || theirs.output !== mine.output) {
      mismatches.push(
        `${key} -> ${model}: pricing.js ${mine.input}/${mine.output} vs server-agents.js ${theirs.input}/${theirs.output}`,
      );
    }
  }
  assert.deepEqual(mismatches, [], 'the two price tables disagree');
});

test('no routed Anthropic model uses a date-suffixed id', () => {
  for (const model of ANTHROPIC_TARGETS) {
    assert.ok(!/-\d{8}$/.test(model), `${model} carries a legacy date suffix`);
  }
});
