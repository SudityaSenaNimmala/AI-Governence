// Builds the JSON payload shipped to the desktop enforcer as
// CFAI_MODEL_ROUTER_CONFIG — the data half of the model-routing feature. The
// C# side (enforcer-win.ps1) ports only the ~80-line SCORING ALGORITHM
// (compileCategory/scoreCategory/scoreAll/classify); the lexicon itself is
// extracted here, straight out of the shipped browser-extension source,
// rather than hand-retyped. This is the "algorithm in C#, lexicon as env
// data" split — see the model-routing design doc, section 9.
//
// WHY EXTRACTION, NOT DUPLICATION. Hand-copying ~200 lexicon terms into a
// second file is exactly the kind of drift this repo has already been burned
// by once (Gemini's Flash/Pro/Ultra -> Flash/Thinking/Pro rename broke a
// hardcoded tier map silently — see browser-extension/tests/model-router.test.mjs).
// Slicing the real arrays out of complexity.js's source means there is
// nothing to keep in sync by hand: a lexicon change there is picked up here
// automatically. agent/tests/model-router-config.test.mjs still cross-checks
// this extraction against the shipped classify()/detectModelInfo() functions,
// to catch the day the extraction itself silently breaks (e.g. complexity.js
// renames a category or changes its declaration shape).
//
// This file is plain ESM and touches no window/chrome globals, unlike the
// files it reads — it only ever evaluates an ISOLATED array-literal or
// object-literal SLICE of their source (via `new Function`), never the whole
// file, and never anything containing document/chrome/fetch calls.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const COMPLEXITY_JS_PATH = join(REPO_ROOT, 'browser-extension', 'content', 'complexity.js');
const CONTENT_JS_PATH = join(REPO_ROOT, 'browser-extension', 'content', 'content.js');

// One entry per positive lexicon category compileCategory() feeds into
// POSITIVE, plus the three negative categories scored separately. Order
// matches complexity.js's own POSITIVE array (source-of-truth comment there).
const POSITIVE_CATEGORY_NAMES = [
  'REASONING_DEPTH', 'TASK_COMPLEXITY', 'DOMAIN_EXPERTISE', 'PLANNING',
  'CODING', 'DEBUGGING', 'ANALYSIS', 'OUTPUT_COMPLEXITY', 'SHALLOW_TASK',
];
const NEGATIVE_CATEGORY_NAMES = ['TRIVIAL_INTENT', 'SIMPLE_TASK', 'SIMPLICITY_REQUEST'];
// Structural-signal categories are attached to specific positive categories
// in complexity.js (CODE_STRUCTURE -> coding, STACK_STRUCTURE -> debugging).
const STRUCTURAL_FOR_CATEGORY = { CODING: 'CODE_STRUCTURE', DEBUGGING: 'STACK_STRUCTURE' };

const THRESHOLD_NAMES = [
  'COMPLEX_AT', 'SIMPLE_AT', 'STRONG_WEIGHT', 'CAP_PER_CATEGORY',
  'WINDOW_HEAD', 'WINDOW_TAIL', 'MAX_TRIVIAL_TOKENS', 'MAX_FILLER_CONTENT_TOKENS',
];

/**
 * Slice a `const NAME = [ ... ];` array literal out of source text by
 * bracket-depth counting from the opening `[` (not just to the next `]` —
 * every one of these arrays nests `['term', weight]` pairs). Independent of
 * load-model-router.mjs's START/END sentinel technique because these arrays
 * sit outside that file's slice region, and of load-complexity.mjs's whole-
 * file eval because complexity.js never exposes these tables on `window` —
 * only VERSION and classify() are published.
 */
function sliceBalancedArray(source, constName) {
  const declToken = `const ${constName} = [`;
  const start = source.indexOf(declToken);
  if (start < 0) throw new Error(`model-router-config: declaration not found in source: ${constName}`);
  const openBracket = start + declToken.length - 1;
  let depth = 0;
  let end = -1;
  for (let i = openBracket; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error(`model-router-config: ${constName} array literal never closes`);
  return source.slice(openBracket, end);
}

/** Evaluate an isolated array-literal slice. No free variables, no globals. */
function evalArrayLiteral(literalSource) {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literalSource});`)();
}

function extractLexiconCategory(source, constName) {
  const terms = evalArrayLiteral(sliceBalancedArray(source, constName));
  // [[term, weight], ...] -> [{term, weight}, ...] — plain, JSON-stable shape.
  return terms.map(([term, weight]) => ({ term, weight }));
}

/**
 * Structural signals compile to real RegExp objects in complexity.js
 * ({key, weight, re}); JSON can't carry a RegExp, so re -> {source, flags}.
 * C# reconstructs it as `new Regex(source, flags-mapped-to-RegexOptions)`.
 */
function extractStructuralSignals(source, constName) {
  const entries = evalArrayLiteral(sliceBalancedArray(source, constName));
  return entries.map(({ key, weight, re }) => ({
    key, weight, source: re.source, flags: re.flags,
  }));
}

function extractThreshold(source, name) {
  const m = new RegExp(`const ${name} = (-?\\d+);`).exec(source);
  if (!m) throw new Error(`model-router-config: threshold not found in source: ${name}`);
  return Number(m[1]);
}

/**
 * Tier detection, hand-ported from content.js's detectModelInfo() — an
 * ordered if/else chain, not a data table, so it can't be sliced-and-evaled
 * the way the lexicon arrays are. This is the SMALL, STABLE half of the
 * model-tier-detection code (13 keyword checks vs. ~200 lexicon terms), so
 * hand-porting it here is the accepted tradeoff — parity is verified
 * behaviorally in agent/tests/model-router-config.test.mjs by running BOTH
 * this table and the real detectModelInfo() against the same set of sample
 * button labels and asserting they agree, rather than by re-deriving the
 * control flow programmatically.
 *
 * Each rule is tried in order; the first whose `any` keyword list matches
 * (case-insensitive substring) wins. `oneOf`/order mirrors detectModelInfo's
 * own if/else ordering exactly, INCLUDING order-sensitive cases (OpenAI's
 * "mini" must be checked before "4o"; Google's economy/standard/premium
 * checks are order-sensitive because "pro" and "flash" can co-occur in some
 * button text).
 */
const TIER_KEYWORD_RULES = [
  { provider: 'anthropic', tier: 'premium', any: ['fable'] },
  { provider: 'anthropic', tier: 'premium', any: ['opus'] },
  { provider: 'anthropic', tier: 'standard', any: ['sonnet'] },
  { provider: 'anthropic', tier: 'economy', any: ['haiku'] },
  { provider: 'openai', tier: 'economy', any: ['mini', '3.5', 'nano'] },
  { provider: 'openai', tier: 'standard', any: ['4o', '4.1'] },
  { provider: 'openai', tier: 'premium', any: ['gpt-4', 'gpt4'] },
  { provider: 'openai', tier: 'premium', anyRegex: ['\\bo[1-9]'] },
  { provider: 'openai', tier: 'standard', any: ['chatgpt'] },
  { provider: 'google', tier: 'economy', any: ['flash', 'lite'] },
  { provider: 'google', tier: 'standard', any: ['thinking'] },
  { provider: 'google', tier: 'premium', any: ['pro'] },
  { provider: 'google', tier: 'premium', any: ['ultra'] },
];

/** Reference JS implementation of TIER_KEYWORD_RULES, for the parity test. */
export function detectModelInfoFromConfig(text) {
  const t = (text || '').toLowerCase();
  for (const rule of TIER_KEYWORD_RULES) {
    if (rule.any && rule.any.some((kw) => t.includes(kw))) return { provider: rule.provider, tier: rule.tier };
    if (rule.anyRegex && rule.anyRegex.some((src) => new RegExp(src).test(t))) return { provider: rule.provider, tier: rule.tier };
  }
  return null;
}

// Provider + target tier number -> UI label to search the dropdown for. Kept
// as a small hand-ported table (same reasoning as TIER_KEYWORD_RULES) since
// content.js's TIER_UI_NAME sits alongside chrome.storage-touching code that
// can't be sliced out cleanly; parity checked against tierUiNameFor() in the
// browser-extension test suite from this repo's test file instead.
const TIER_UI_NAMES = {
  anthropic: { 3: 'Opus', 2: 'Sonnet', 1: 'Haiku' },
  openai: { 3: 'GPT-4', 2: 'GPT-4o', 1: 'GPT-4o mini' },
  google: { 3: 'Pro', 2: 'Thinking', 1: 'Flash' },
};

/**
 * Assemble the full CFAI_MODEL_ROUTER_CONFIG payload. Reads both source
 * files fresh on every call (cheap, and correctness — never staleness —
 * matters here); the enforcer only calls this once per helper spawn.
 */
export function buildModelRouterConfig() {
  const complexitySrc = readFileSync(COMPLEXITY_JS_PATH, 'utf8');

  const positiveCategories = POSITIVE_CATEGORY_NAMES.map((name) => {
    const structuralName = STRUCTURAL_FOR_CATEGORY[name];
    return {
      name,
      terms: extractLexiconCategory(complexitySrc, name),
      structural: structuralName ? extractStructuralSignals(complexitySrc, structuralName) : [],
    };
  });
  const negativeCategories = NEGATIVE_CATEGORY_NAMES.map((name) => ({
    name,
    terms: extractLexiconCategory(complexitySrc, name),
  }));

  const thresholds = {};
  for (const name of THRESHOLD_NAMES) thresholds[name] = extractThreshold(complexitySrc, name);

  return {
    version: 1,
    positiveCategories,
    negativeCategories,
    thresholds,
    tierKeywordRules: TIER_KEYWORD_RULES,
    tierUiNames: TIER_UI_NAMES,
  };
}

// Exposed for the parity test — reading complexity.js's source path directly
// keeps that test independent of this module's internal extraction helpers.
export const _paths = { COMPLEXITY_JS_PATH, CONTENT_JS_PATH };
