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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { MODEL_CATALOG } from './model-catalog.generated.js';

/* global __CFAI_MODEL_ROUTER_CONFIG__ */
// BAKED AT BUILD TIME for the packaged binary.
//
// The lexicons below are parsed out of browser-extension/content/complexity.js —
// repo SOURCE, which exists on a developer's machine and on no deployed laptop.
// In the packaged agent the readFileSync threw ENOENT from inside the enforcer's
// spawn env, so the keystroke send-blocker never started: the one component that
// actually PREVENTS a sensitive send, defeated by a missing source file.
//
// build-claude-tracker.mjs now evaluates this at build time and injects the
// result, so the packaged binary carries the compiled lexicons and never touches
// the filesystem. A dev run finds the constant undefined and parses as before.
const BAKED = typeof __CFAI_MODEL_ROUTER_CONFIG__ !== 'undefined'
  ? __CFAI_MODEL_ROUTER_CONFIG__
  : null;

const __dirname = (() => {
  try { return dirname(fileURLToPath(import.meta.url)); } catch { return ''; }
})();
const REPO_ROOT = join(__dirname, '..', '..', '..');
const COMPLEXITY_JS_PATH = join(REPO_ROOT, 'browser-extension', 'content', 'complexity.js');
// The agent's OWN generated copy of the same classifier (node
// scripts/gen-proxy-complexity.mjs; agent/tests/complexity-parity.test.mjs pins
// it to the canonical file). It ships inside the agent, which the
// browser-extension/ tree does NOT: the packaged Electron agent lays out
// resources/agent/ with no resources/browser-extension/ beside it, so reading
// only COMPLEXITY_JS_PATH there threw ENOENT, the minimal config below went out
// with ZERO categories, and the enforcer scored every prompt 0 -> 'moderate'
// ("hi" on Sonnet: noop/already_on_target instead of a route to Haiku). The
// declarations this module slices are identical in both files.
const AGENT_COMPLEXITY_JS_PATH = join(__dirname, '..', 'proxy', 'complexity.js');
const COMPLEXITY_SOURCES = [COMPLEXITY_JS_PATH, AGENT_COMPLEXITY_JS_PATH];
const CONTENT_JS_PATH = join(REPO_ROOT, 'browser-extension', 'content', 'content.js');

// One entry per positive lexicon category compileCategory() feeds into
// POSITIVE, plus the three negative categories scored separately. Order
// matches complexity.js's own POSITIVE array (source-of-truth comment there).
const POSITIVE_CATEGORY_NAMES = [
  'REASONING_DEPTH', 'TASK_COMPLEXITY', 'DOMAIN_EXPERTISE', 'PLANNING',
  'CODING', 'DEBUGGING', 'ANALYSIS', 'OUTPUT_COMPLEXITY', 'RESEARCH_DEPTH', 'PRODUCT_BUILD',
  'SHALLOW_TASK',
];
const NEGATIVE_CATEGORY_NAMES = ['TRIVIAL_INTENT', 'SIMPLE_TASK', 'SIMPLICITY_REQUEST'];
// Structural-signal categories are attached to specific positive categories
// in complexity.js (CODE_STRUCTURE -> coding, STACK_STRUCTURE -> debugging,
// RESEARCH_STRUCTURE -> researchDepth). researchDepth arrived with classifier
// 1.3.0; the C# scorer is generic over categories and structural lists, so these
// two table entries are the entire desktop-side change for it.
// PRODUCT_BUILD (classifier 1.5.0) is the same kind of change: one lexicon
// category plus one structural list. Its structural list is BUILT by a function
// in complexity.js rather than written as literals (seven patterns share one
// product list), so it is extracted from its sentinel region instead of as an
// array literal — see extractStructuralRegion().
const STRUCTURAL_FOR_CATEGORY = {
  CODING: 'CODE_STRUCTURE', DEBUGGING: 'STACK_STRUCTURE', RESEARCH_DEPTH: 'RESEARCH_STRUCTURE',
  PRODUCT_BUILD: 'PRODUCT_BUILD_STRUCTURE',
};
// Structural lists that live inside a `// <cfai:NAME>` … `// </cfai:NAME>`
// region of complexity.js instead of a `const X = [ … ];` literal.
const STRUCTURAL_REGIONS = { PRODUCT_BUILD_STRUCTURE: 'product-build' };

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
  const entries = STRUCTURAL_REGIONS[constName]
    ? extractStructuralRegion(source, STRUCTURAL_REGIONS[constName], constName)
    : evalArrayLiteral(sliceBalancedArray(source, constName));
  return entries.map(({ key, weight, re }) => ({
    key, weight, source: re.source, flags: re.flags,
  }));
}

/**
 * Evaluate a sentinel-delimited region of complexity.js in ISOLATION and return
 * the structural list it declares. The region (`// <cfai:tag>` …
 * `// </cfai:tag>`) is required to be self-contained — plain string lists and
 * a builder function, no reference to anything outside it — so, like the array
 * slices above, it runs with no free variables and no globals. Anything else in
 * it (a window/document touch) would throw here, which is the point: the
 * extraction fails loudly rather than shipping the enforcer a partial lexicon.
 */
function extractStructuralRegion(source, tag, constName) {
  const open = `// <cfai:${tag}>`;
  const close = `// </cfai:${tag}>`;
  const a = source.indexOf(open);
  const b = source.indexOf(close);
  if (a < 0 || b < a) throw new Error(`model-router-config: region <cfai:${tag}> not found in source`);
  if (source.indexOf(open, a + 1) >= 0) throw new Error(`model-router-config: region <cfai:${tag}> appears twice`);
  const region = source.slice(a + open.length, b);
  // eslint-disable-next-line no-new-func
  const list = new Function(`'use strict';
${region}
return ${constName};`)();
  if (!Array.isArray(list) || !list.every((e) => e && typeof e.key === 'string' && e.re instanceof RegExp)) {
    throw new Error(`model-router-config: ${constName} is not a list of {key, weight, re}`);
  }
  return list;
}

/**
 * Slice a `const NAME = { ... };` object literal by brace-depth counting. Used
 * for ARITHMETIC_SHAPE, whose values are regex literals (no braces in them).
 */
function sliceBalancedObject(source, constName) {
  const declToken = `const ${constName} = {`;
  const start = source.indexOf(declToken);
  if (start < 0) throw new Error(`model-router-config: declaration not found in source: ${constName}`);
  const open = start + declToken.length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`model-router-config: ${constName} object literal never closes`);
}

/** ARITHMETIC_SHAPE -> { wrapper: {source, flags}, residue, hasOperator, digit }. */
function extractArithmeticShape(source) {
  const shape = evalArrayLiteral(sliceBalancedObject(source, 'ARITHMETIC_SHAPE'));
  const out = {};
  for (const key of ['wrapper', 'residue', 'hasOperator', 'digit']) {
    const re = shape[key];
    if (!(re instanceof RegExp)) throw new Error(`model-router-config: ARITHMETIC_SHAPE.${key} is not a regex`);
    out[key] = { source: re.source, flags: re.flags };
  }
  return out;
}

/** A plain string array (SMALL_TALK / SMALL_TALK_FILLER). */
function extractStringList(source, constName) {
  const list = evalArrayLiteral(sliceBalancedArray(source, constName));
  if (!Array.isArray(list) || !list.every((s) => typeof s === 'string')) {
    throw new Error(`model-router-config: ${constName} is not a string array`);
  }
  return list;
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
  // "mini" and "nano" are WORD-BOUNDED, matching content.js. A bare substring
  // test for "mini" matches "geMINI", so "Gemini Flash" resolved to
  // openai/economy here — and in the extension it caused routing to hunt for
  // OpenAI's labels on a Google page. The parity test below is what caught the
  // drift when only content.js was fixed.
  { provider: 'openai', tier: 'economy', any: ['3.5'], anyRegex: ['\\bmini\\b', '\\bnano\\b'] },
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

// ── The shared catalog + the routing policy ──────────────────────────────────
//
// WHICH TIER, AND WHAT TO CLICK, is decided by the C# port of
// shared/decide-route.js inside the enforcer, from two pieces of data shipped
// here:
//   * catalog — shared/model-catalog.json, via the GENERATED ES-module copy
//     model-catalog.generated.js (node scripts/gen-shared-routing.mjs). It used
//     to be a hand-ported TIER_UI_NAMES table here, which still carried Gemini's
//     retired 'Flash / Thinking / Pro' lineup; the catalog's measured
//     '3.5 Flash-Lite / 3.8 Flash / 3.1 Pro' is now the only source.
//   * policy  — GET /api/v1/routing/policy (or the legacy /routing/rules array),
//     cached on disk so a respawned helper starts with the last policy it had
//     even when the server is unreachable. A running helper is updated in place
//     over its stdin (Enforcer.updateRouterConfig) — no respawn.
//
// The keyword chain above (TIER_KEYWORD_RULES) stays only as the FALLBACK for a
// picker label the catalog cannot read.

/**
 * Desktop process name (lower-case, as the enforcer's _app carries it) -> the
 * catalog `apps` key. A process absent here has no catalog entry, so the
 * enforcer's decision for it is unsupported/unknown_surface and nothing is
 * routed.
 */
export const DESKTOP_APP_KEYS = {
  claude: 'claude_desktop',
  chatgpt: 'chatgpt_desktop',
};

export const ROUTING_POLICY_PATH = join(homedir(), '.cloudfuze-aigov', 'routing-policy.json');
// Written by agents that predate the policy endpoint. Read once as a fallback so
// an upgrade keeps the admin's rules until the first policy fetch lands.
const LEGACY_ROUTING_RULES_PATH = join(homedir(), '.cloudfuze-aigov', 'routing-rules.json');

/**
 * The cached routing policy: { policy, etag, version, at } or null.
 * `policy` is the v2 policy document, or a bare v1 rules array (legacy feed).
 */
export function loadCachedRoutingPolicy(path = ROUTING_POLICY_PATH) {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object' && 'policy' in parsed) return parsed;
    }
  } catch { /* corrupt cache -> fall through */ }
  if (path !== ROUTING_POLICY_PATH) return null;
  try {
    if (existsSync(LEGACY_ROUTING_RULES_PATH)) {
      const rules = JSON.parse(readFileSync(LEGACY_ROUTING_RULES_PATH, 'utf8'));
      if (Array.isArray(rules)) return { policy: rules, etag: null, version: null, at: null, legacy: true };
    }
  } catch { /* ignore */ }
  return null;
}

export function saveCachedRoutingPolicy(entry, path = ROUTING_POLICY_PATH) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

/**
 * Assemble the full CFAI_MODEL_ROUTER_CONFIG payload. The lexicon half is baked
 * into the packaged binary (BAKED) or parsed from complexity.js in a dev run;
 * the catalog and the cached policy are added at CALL time, never baked — a
 * baked policy would be the build machine's rules forever.
 */
export function buildModelRouterConfig() {
  const cached = loadCachedRoutingPolicy();
  const routing = {
    catalog: MODEL_CATALOG,
    policy: cached ? cached.policy : null,
    desktopApps: DESKTOP_APP_KEYS,
  };
  if (BAKED) {
    // Strip the retired fields an older baked build may still carry.
    const { serverRules: _s, tierUiNames: _t, ...lexicon } = BAKED;
    return { ...lexicon, ...routing };
  }
  return { ...buildLexiconConfig(), ...routing };
}

/** The lexicon half only — what the build bakes. */
export function buildLexiconConfig(sources = COMPLEXITY_SOURCES) {
  let complexitySrc = null;
  let lexiconSource = null;
  for (const p of sources) {
    try { complexitySrc = readFileSync(p, 'utf8'); lexiconSource = p === COMPLEXITY_JS_PATH ? 'canonical' : 'agent_copy'; break; } catch { /* next */ }
  }
  if (complexitySrc == null) {
    // Neither copy present — return a config with NO lexicon so the enforcer
    // starts instead of crashing the whole monitor. The C# side treats an
    // empty lexicon as "classifier unavailable" and returns 'unknown' (which
    // decideRoute never routes on), never a guessed 'moderate'.
    return {
      version: 2,
      lexiconSource: 'none',
      positiveCategories: [], negativeCategories: [],
      thresholds: { COMPLEX_AT: 6, SIMPLE_AT: -3, STRONG_WEIGHT: 4, CAP_PER_CATEGORY: 2, WINDOW_HEAD: 3000, WINDOW_TAIL: 1000, MAX_TRIVIAL_TOKENS: 4, MAX_FILLER_CONTENT_TOKENS: 2 },
      tierKeywordRules: TIER_KEYWORD_RULES,
    };
  }

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
    version: 2,
    lexiconSource,
    classifierVersion: (/const VERSION = '([^']+)';/.exec(complexitySrc) || [])[1] || null,
    positiveCategories,
    negativeCategories,
    thresholds,
    // Steps 3b and 3c of classify(), as data (classifier 1.4.0).
    arithmetic: extractArithmeticShape(complexitySrc),
    smallTalk: {
      phrases: extractStringList(complexitySrc, 'SMALL_TALK'),
      filler: extractStringList(complexitySrc, 'SMALL_TALK_FILLER'),
    },
    tierKeywordRules: TIER_KEYWORD_RULES,
  };
}

// Exposed for the parity test — reading complexity.js's source path directly
// keeps that test independent of this module's internal extraction helpers.
export const _paths = { COMPLEXITY_JS_PATH, AGENT_COMPLEXITY_JS_PATH, CONTENT_JS_PATH };
// Exposed so a test can prove the fallback copy alone yields the same lexicon.
export const _sources = COMPLEXITY_SOURCES;
