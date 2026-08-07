// Prompt-complexity classifier for the Smart Model Router.
//
// Replaces the old two-regex + character-length heuristic in content.js, which
// had two structural faults:
//   * word-boundary-bound stems ("architect") missed the words people actually
//     type ("architecture"), and anything that missed BOTH regexes fell through
//     to raw string length;
//   * length then decided the tier — so a short hard question ("What's our
//     architecture for the billing service?") was called 'simple' and a long
//     easy one ("explain cloud computing in simple words…") was called
//     'moderate'. Length is not difficulty. There is no length input anywhere
//     in this file.
//
// What replaces it: a weighted lexicon of eleven categories (eight positive
// signals, three negative) plus a few structural signals (code fences, stack
// traces). Score maps to one of exactly three tiers.
//
// PRIVACY: this file reads prompt text and returns a single enum. It never
// stores it, never logs it, and deliberately returns no matched terms — those
// are literal substrings of the user's prompt and the caller emits telemetry to
// the governance server. Keep it that way.
//
// This file is plain (non-module) JS so manifest content_scripts can load it,
// same as content/patterns.js. It publishes window.__cfaiComplexity.

(function () {
  // Injected twice on hosts present in BOTH manifest.json's content_scripts and
  // the service worker's injectDlpStack(). Everything here is pure, so a second
  // evaluation is harmless — but it re-compiles ~200 regexes for nothing.
  if (window.__cfaiComplexityLoaded) return;
  window.__cfaiComplexityLoaded = true;

  const VERSION = '1.1.0';

  // Tier thresholds. Tuned against the acceptance table in tests/complexity.test.mjs.
  const COMPLEX_AT = 6;
  const SIMPLE_AT = -3;

  // A "strong" hit is a term the lexicon considers self-evidently hard. Used to
  // veto the explicit-simplicity override (step 5) — see classify().
  const STRONG_WEIGHT = 4;

  // Analysis window (step 2). CPU bound only, never a complexity signal.
  const WINDOW_HEAD = 3000;
  const WINDOW_TAIL = 1000;

  // Per-category contribution cap (step 4): only the two heaviest DISTINCT terms
  // in a category count. Stops a prompt that happens to rattle off six synonyms
  // for the same idea from out-scoring a prompt that is genuinely hard in three
  // different dimensions.
  const CAP_PER_CATEGORY = 2;

  // ── Lexicon ────────────────────────────────────────────────────────────────
  // [term, weight]. A term ending in `*` is a stem: it compiles to \bstem\w* and
  // so covers the inflections people actually type (architect → architecture,
  // architectural). Variants are spelled out explicitly wherever a stem would
  // over-match (`plan*` would eat "planet", so `plan`/`plans`/`planning`).
  //
  // Prefer a stem over a bare singular for any countable noun whose plural is a
  // plain suffix: a singular-only entry scores ZERO on "why do we get deadlocks",
  // which is the same question as "why does this deadlock". Irregular plurals
  // (`strategy`/`strategies`) can't use a stem and are spelled out instead.
  //
  // One IDEA is one entry. Spelling variants of a single idea (`analyz`/`analys`)
  // are folded into one stem rather than listed separately, because the per-
  // category cap counts DISTINCT ENTRIES: two entries for one idea would let
  // "analyze the analysis" out-score "analyze".
  // Multi-word terms match across any whitespace run, so a phrase split by a
  // Shift+Enter ("root\ncause") still counts — see phraseSource().

  const REASONING_DEPTH = [
    ['why', 4],
    ['trade-off', 4], ['trade-offs', 4], ['tradeoff', 4], ['tradeoffs', 4],
    ['trade off', 4], ['trade offs', 4],
    ['compare', 4], ['comparison', 4],
    ['versus', 4], ['vs', 4],
    ['pros and cons', 4],
    ['evaluate', 3],
    ['justify', 4],
    ['prove', 4],
    ['derive', 4],
    ['implications', 4],
    ['root cause*', 4],
    ['step by step', 3], ['step-by-step', 3],
    ['think through', 4],
    ['first principles', 4],
    ['edge cases', 4], ['edge case', 4],
  ];

  const TASK_COMPLEXITY = [
    // 6, not 4: "what is our architecture for X" must clear COMPLEX_AT on its
    // own. An architecture question is the canonical premium-model ask, and
    // under-scoring it is the exact bug this file was written to fix.
    //
    // KNOWN, ACCEPTED TRADEOFF — do not "tidy" this back down to 4 without
    // reading this paragraph. 6 is also >= STRONG_WEIGHT, so any mention of
    // architect/architecture permanently vetoes the explicit-simplicity override
    // in step 5 of classify(). "I am an architect, write me a haiku about
    // autumn" therefore scores complex. That is the deliberate choice: the two
    // failure directions are not symmetric — over-scoring costs a few cents of
    // premium model, under-scoring answers a real design question with the
    // cheapest model. Two tests pin this (see tests/complexity.test.mjs, the
    // 'billing service' acceptance row and the 'short architecture question'
    // regression); both drop to 'moderate' the moment this weight is 4.
    ['architect*', 6],
    ['design', 3], ['redesign', 3],
    ['system design', 4],
    ['end to end', 2], ['end-to-end', 2],
    ['scalab*', 4],
    ['distributed', 4],
    ['high availability', 4],
    ['fault toleran*', 4],
    ['concurren*', 4],
    ['multi-tenant', 3], ['multi tenant', 3],
    ['migration*', 3], ['migrate', 3],
    ['refactor*', 3],
    ['optimi*', 3],
    ['framework', 2],
  ];

  const DOMAIN_EXPERTISE = [
    ['kubernetes', 2], ['terraform', 2],
    ['aws', 2], ['azure', 2], ['gcp', 2],
    ['iam', 2], ['vpc', 2],
    ['zero-trust', 4], ['zero trust', 4],
    ['oauth', 2], ['saml', 2], ['kerberos', 2], ['tls', 2],
    ['sharding', 3],
    ['cap theorem', 4],
    ['kafka', 2], ['postgres', 2],
    ['gradient descent', 3], ['transformer*', 3],
    ['algorithm*', 4],
    ['deadlock*', 4],
    // High-stakes sub-block. Getting one of these wrong is a security incident,
    // so they outrank ordinary domain nouns.
    ['sql injection*', 5],
    ['vulnerab*', 5],
    ['xss', 5], ['csrf', 5],
    ['exploit*', 5],
    ['cryptograph*', 5],
    ['hipaa', 5], ['pci dss', 5], ['gdpr', 5],
    ['authentication bypass*', 5],
    // Stems, so "penetration testing" and "threat modelling" — the forms people
    // actually type — score the same as the bare singular noun.
    ['penetration test*', 5],
    ['threat model*', 5],
    // NOT listed, on purpose: cloud, computing, software, technology, data,
    // internet, computer. Generic umbrella nouns carry no difficulty signal, and
    // listing them is what would make "explain cloud computing" pick up phantom
    // expertise points and defeat the simplicity override.
  ];

  const PLANNING = [
    ['plan', 2], ['plans', 2], ['planning', 2],
    ['roadmap*', 3],
    // "strategies" is not a suffix away from "strategy", so no stem can reach it.
    ['strategy', 3], ['strategies', 3],
    ['phases', 2],
    ['milestones', 2],
    ['rollout', 2],
    ['break down into', 2],
    ['outline the steps', 2],
    ['prioriti*', 2],
    ['estimate effort', 3],
  ];

  const CODING = [
    ['implement*', 3],
    ['write a function', 2],
    ['endpoint', 2], ['endpoints', 2],
    ['unit test', 2], ['unit tests', 2],
    // Language names as nouns, not as tasks — weak on their own.
    ['typescript', 1], ['python', 1], ['rust', 1], ['golang', 1], ['sql', 1],
  ];

  const DEBUGGING = [
    ['debug*', 3],
    ['stack trace*', 3],
    ['traceback*', 3],
    ['memory leak*', 4],
    ['race condition*', 4],
    ['regression*', 3],
    ['reproduce', 2],
    ['not working', 2],
    ['fails', 2], ['failing', 2],
  ];

  const ANALYSIS = [
    // One entry, not `analyz*` + `analys*`: the US and UK spellings are the same
    // idea, and two entries let "analyze the analysis" bank the signal twice.
    ['analy*', 3],
    // `audit*` would also eat "auditory", so the inflections are spelled out —
    // same reasoning as `plan`/`plans`/`planning`.
    ['audit', 3], ['audits', 3], ['auditing', 3],
    ['assess', 2],
    ['critique', 2],
    ['benchmark*', 3],
    ['profile', 2],
    ['correlate', 2],
    ['interpret', 2],
  ];

  const OUTPUT_COMPLEXITY = [
    ['comprehensive', 2],
    ['thorough', 2],
    ['detailed', 2],
    ['in depth', 2], ['in-depth', 2],
    ['production-ready', 3], ['production ready', 3],
    ['deep dive', 3],
    ['walkthrough', 2],
    ['write a report', 2],
    ['spec', 2],
    ['proposal', 2],
  ];

  // Catch-all for real-but-easy asks, so they land above a bare 0 and are
  // distinguishable from "no signal at all". Overlap with the categories above
  // is deliberate and harmless: the per-category cap bounds what any single idea
  // can contribute.
  const SHALLOW_TASK = [
    ['fix', 1],
    ['error', 1], ['exception', 1],
    ['code', 1], ['function', 1],
    // One entry for one idea (see analy* above): summarize/summarise/summary.
    ['summar*', 1],
    ['write a haiku', 1], ['write a poem', 1], ['write a story', 1],
    ['write an email', 1],
  ];

  const TRIVIAL_INTENT = [
    ['hi', -8], ['hello', -8], ['hey', -8],
    ['thanks', -8], ['thank you', -8],
    ['ok', -8], ['okay', -8],
    ['yes', -8], ['no', -8],
    ['bye', -8],
  ];

  const SIMPLE_TASK = [
    ['define', -3], ['spell', -3],
    ['translate', -3], ['convert', -3],
    ['rename', -3], ['format', -3], ['lint', -3],
    ['fix typo', -3],
    ['commit message', -3], ['changelog', -3],
    ['joke', -3],
  ];

  const SIMPLICITY_REQUEST = [
    ['in simple words', -5], ['in simple terms', -5],
    ['in plain english', -5],
    ['eli5', -5],
    ["explain like i'm 5", -5], ['explain like im 5', -5],
    ['for a beginner', -5],
    ['for a non-technical', -5], ['for a non technical', -5],
    ['layman', -5],
    ['briefly', -5],
    ['one sentence', -5],
    ['short answer', -5],
    ['overview of', -5],
    ['intro to', -5],
  ];

  // ── Structural signals ─────────────────────────────────────────────────────
  // Not lexicon: shape, not vocabulary. Tested case-SENSITIVELY against the raw
  // window, because `Error:` is a stack frame and `error:` is usually prose.
  // A pasted stack trace with no surrounding words at all still has to register.

  const CODE_STRUCTURE = [
    { key: '#code-fence', weight: 2, re: /```/ },
    { key: '#code-syntax', weight: 1, re: /(^|\n)[ \t]*import\s|\brequire\(|(^|\n)[ \t]*def\s|=>/ },
  ];

  const STACK_STRUCTURE = [
    { key: '#stack-trace', weight: 4, re: /Traceback \(most recent call last\)/ },
    { key: '#js-frame', weight: 4, re: /at \S+ \(\S+:\d+:\d+\)/ },
    { key: '#jvm-thread', weight: 4, re: /Exception in thread/ },
    { key: '#go-panic', weight: 4, re: /panic:/ },
    { key: '#error-label', weight: 4, re: /\bError:/ },
  ];

  // ── Compilation ────────────────────────────────────────────────────────────
  // One alternation regex per category rather than one regex per term: eleven
  // matchAll passes over the window instead of ~200 independent scans.

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Regex source for one lexicon term. Every literal space becomes \s+ so a
   * multi-word term survives the whitespace people actually produce: a Shift+Enter
   * in the middle of the phrase, or a paste that wrapped. "root\ncause" is the
   * same ask as "root cause", and matching only the single-space form silently
   * dropped a weight-4 signal.
   */
  function phraseSource(term) {
    return escapeRe(term).replace(/ +/g, '\\s+');
  }

  function compileCategory(name, terms, structural) {
    const exact = new Map();
    const stems = [];
    const sources = [];
    // Longest term first: alternation is first-match-wins, so "trade-offs" must
    // be offered before "trade-off".
    const ordered = terms.slice().sort((a, b) => b[0].length - a[0].length);
    for (const [term, weight] of ordered) {
      if (term.endsWith('*')) {
        const stem = phraseSource(term.slice(0, -1));
        sources.push('\\b' + stem + '\\w*');
        // `term` is carried through as the hit IDENTITY (see termOf): every
        // inflection of one stem is one lexicon entry, not one per surface form.
        stems.push({ term, re: new RegExp('^' + stem + '\\w*$'), weight });
      } else {
        sources.push('\\b' + phraseSource(term) + '\\b');
        exact.set(term, weight);
      }
    }
    return {
      name,
      re: new RegExp(sources.join('|'), 'gi'),
      exact,
      stems,
      structural: structural || null,
    };
  }

  /**
   * Resolve a matched substring back to the LEXICON ENTRY that produced it —
   * `{ term, weight }`, not a bare weight.
   *
   * The identity is what the per-category cap counts. Keying on the matched text
   * instead made "debugging this debugger" two distinct hits of the single entry
   * `debug*`, so one idea stated twice out-scored the same idea stated once and
   * the documented "top 2 distinct TERMS" cap quietly became "top 2 distinct
   * spellings".
   *
   * @param {string} normalised match text, lower-cased with whitespace runs
   *   collapsed to one space so a line-broken phrase keys as its lexicon term.
   */
  function termOf(cat, normalised) {
    const exact = cat.exact.get(normalised);
    if (exact !== undefined) return { term: normalised, weight: exact };
    for (const s of cat.stems) if (s.re.test(normalised)) return { term: s.term, weight: s.weight };
    return null;
  }

  const POSITIVE = [
    compileCategory('reasoningDepth', REASONING_DEPTH),
    compileCategory('taskComplexity', TASK_COMPLEXITY),
    compileCategory('domainExpertise', DOMAIN_EXPERTISE),
    compileCategory('planning', PLANNING),
    compileCategory('coding', CODING, CODE_STRUCTURE),
    compileCategory('debugging', DEBUGGING, STACK_STRUCTURE),
    compileCategory('analysis', ANALYSIS),
    compileCategory('outputComplexity', OUTPUT_COMPLEXITY),
    compileCategory('shallowTask', SHALLOW_TASK),
  ];

  const CAT_TRIVIAL_INTENT = compileCategory('trivialIntent', TRIVIAL_INTENT);
  const CAT_SIMPLE_TASK = compileCategory('simpleTask', SIMPLE_TASK);
  const CAT_SIMPLICITY_REQUEST = compileCategory('simplicityRequest', SIMPLICITY_REQUEST);

  // Single words that can stand alone as a whole trivial message. Derived from
  // TRIVIAL_INTENT so the two can't drift.
  const TRIVIAL_TOKENS = new Set(
    TRIVIAL_INTENT.flatMap(([term]) => term.split(' ')),
  );

  // Any Unicode letter, in any script. This replaced an enumerated allowlist of
  // "non-Latin" script ranges (Cyrillic, Hebrew, Arabic, Devanagari, Kana, CJK,
  // Hangul). The allowlist was unfixably incomplete \u2014 Thai, Greek, Tamil, Bengali,
  // Telugu, Khmer, Lao, Georgian, Armenian, Ethiopic and more were all missing \u2014
  // and a token in a missing script stripped down to the empty string, which the
  // emoji/punctuation carve-out then skipped as "no evidence either way". So
  // "ok <question in Thai>" read as the lone trivial token "ok" and took the
  // greeting fast path. The question was never "which script is this"; it is
  // "does this token carry a real word we do not recognise as a greeting".
  const LETTER_RE = /\p{L}/u;

  const MAX_TRIVIAL_TOKENS = 4;

  // How much real content may ride along with a greeting before the message stops
  // being "basically just a greeting". See trivialDominates().
  const MAX_FILLER_CONTENT_TOKENS = 2;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Bound the text actually scanned. This is a CPU/latency guard, nothing else:
   * text outside the window is simply not scored. It is never read as "long,
   * therefore complex" — that inference is the bug this file removes.
   * Head + tail rather than head alone, because the ask is very often the last
   * line under a large pasted blob.
   */
  function boundWindow(text) {
    if (text.length <= WINDOW_HEAD + WINDOW_TAIL) return text;
    return text.slice(0, WINDOW_HEAD) + '\n' + text.slice(-WINDOW_TAIL);
  }

  /**
   * Split a message into greeting tokens vs content tokens.
   *
   * Three buckets, and the third one is the subtle one:
   *   trivial — strips to a word in TRIVIAL_TOKENS ("ok", "thanks").
   *   content — carries a Unicode letter (any script) or an alphanumeric word,
   *             and is not a recognised greeting. Real substance.
   *   neither — strips to nothing AND carries no letter: the "!" in "ok thanks !",
   *             a bare emoji. Not a greeting, not evidence of a real ask, so it is
   *             left out of both counts rather than tipping either way.
   */
  function tallyTokens(sample) {
    let tokens = 0;
    let trivial = 0;
    let content = 0;
    for (const token of sample.split(/\s+/)) {
      if (!token) continue;
      tokens++;
      const word = token.toLowerCase().replace(/[^a-z0-9']+/g, '');
      if (word && TRIVIAL_TOKENS.has(word)) trivial++;
      else if (word || LETTER_RE.test(token)) content++;
    }
    return { tokens, trivial, content };
  }

  /**
   * True only when the message is NOTHING BUT a greeting/acknowledgement.
   * The dominance gate (<= 4 tokens, no content token at all, at least one
   * greeting actually recognised) is the whole point: a bare "matches a greeting
   * anywhere" check would route "hi, can you design a distributed cache?" to the
   * cheapest model on the strength of the word "hi".
   */
  function isAllTrivialTokens(sample) {
    const { tokens, trivial, content } = tallyTokens(sample);
    if (tokens === 0 || tokens > MAX_TRIVIAL_TOKENS) return false;
    // content === 0 covers every script: see LETTER_RE.
    return content === 0 && trivial > 0;
  }

  /**
   * True when the message IS a greeting rather than merely CONTAINS one — the
   * gate on the -8 trivialIntent penalty.
   *
   * The gate used to be "no positive-category term matched anywhere", which is a
   * far weaker claim than it looks: the lexicon is ~200 terms, so the large
   * majority of ordinary English sentences match nothing, and any one of them
   * containing a stray "no"/"ok"/"yes"/"hey"/"thanks" collected -8 and was routed
   * to the cheapest model. "my build is broken and I have no clue where to start"
   * was classified 'simple' on the strength of the word "no".
   *
   * So this asks the same question the fast path asks, just more permissively
   * (the fast path has already failed by the time we get here): greetings must be
   * a strict majority of the tokens that carry meaning, AND there must be almost
   * no real content riding along. Both halves matter — the majority test alone
   * would accept a long filler-heavy rant, and a token-count ceiling alone would
   * be back to "short, therefore simple", which is the length heuristic this file
   * exists to delete.
   */
  function trivialDominates(sample) {
    const { trivial, content } = tallyTokens(sample);
    // trivial > content IS the strict-majority test: punctuation-only tokens are
    // in neither bucket, so trivial + content is the population being counted.
    return trivial > content && content <= MAX_FILLER_CONTENT_TOKENS;
  }

  /**
   * Capped score for one category. DISTINCT LEXICON ENTRIES only, so neither
   * repeating a word nor inflecting it ("debugging" then "debugger", both the
   * single entry `debug*`) buys more score, and only the CAP_PER_CATEGORY
   * heaviest of those count.
   */
  function scoreCategory(cat, sample) {
    const hits = new Map();
    cat.re.lastIndex = 0;
    for (const m of sample.matchAll(cat.re)) {
      // Collapse whitespace runs so a phrase broken over a line break resolves to
      // the same lexicon entry as the single-spaced form (see phraseSource).
      const matched = m[0].toLowerCase().replace(/\s+/g, ' ');
      const found = termOf(cat, matched);
      if (!found || !found.weight) continue;
      if (hits.has(found.term)) continue;
      hits.set(found.term, found.weight);
    }
    if (cat.structural) {
      for (const s of cat.structural) {
        if (!hits.has(s.key) && s.re.test(sample)) hits.set(s.key, s.weight);
      }
    }
    const weights = [...hits.values()].sort((a, b) => Math.abs(b) - Math.abs(a));
    let sum = 0;
    let strong = false;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] >= STRONG_WEIGHT) strong = true; // uncapped: see step 5
      if (i < CAP_PER_CATEGORY) sum += weights[i];
    }
    return { sum, strong, hit: hits.size > 0 };
  }

  function scoreAll(sample) {
    let positive = 0;
    let strongHit = false;
    for (const cat of POSITIVE) {
      const r = scoreCategory(cat, sample);
      positive += r.sum;
      if (r.strong) strongHit = true;
    }

    const simpleTask = scoreCategory(CAT_SIMPLE_TASK, sample);
    const simplicity = scoreCategory(CAT_SIMPLICITY_REQUEST, sample);
    const trivial = scoreCategory(CAT_TRIVIAL_INTENT, sample);

    // Greetings are evidence of triviality only when the message is essentially
    // nothing else. Same dominance reasoning as the fast path: "hi, can you
    // design a distributed cache?" is a distributed-systems question with a "hi"
    // bolted on the front, and a -8 there would drag a real task down a tier.
    // The other two negative categories describe the ASK itself ("define x",
    // "in simple words") and so always apply.
    const negative = simpleTask.sum + simplicity.sum + (trivialDominates(sample) ? trivial.sum : 0);

    return {
      score: positive + negative,
      simplicityRequestHit: simplicity.hit,
      strongHit,
    };
  }

  // ── Entry point ────────────────────────────────────────────────────────────

  /**
   * @param {string} text
   * @returns {'simple'|'moderate'|'complex'} always one of these three; never throws.
   */
  function classify(text) {
    if (typeof text !== 'string') text = '';
    const trimmed = text.trim();

    // 1. No typed text at all -> 'moderate', deliberately NOT 'simple'. The
    //    common shape here is an attachment with no question typed above it;
    //    silently routing that to the cheapest model is the worse failure.
    if (!trimmed) return 'moderate';

    // 2. Bound the scan (see boundWindow — latency guard, not a signal).
    const sample = boundWindow(trimmed);

    // 3. Trivial fast path, dominance-gated (see isAllTrivialTokens).
    if (isAllTrivialTokens(sample)) return 'simple';

    // 4. Weighted, per-category-capped score across all eleven categories.
    const { score, simplicityRequestHit, strongHit } = scoreAll(sample);

    // 5. Explicit-simplicity override: when the user has literally asked for a
    //    simple answer, honour it over the arithmetic — but only if nothing
    //    genuinely hard was mentioned. The strong-hit guard is what separates
    //    "explain cloud computing in simple words" (obey: simple) from
    //    "explain zero-trust architecture in simple terms" (a weight-4+ term is
    //    in there; asking nicely doesn't make the subject easy).
    if (simplicityRequestHit && !strongHit) return 'simple';

    // 6. Score -> tier. Note there is no length term in this function at all.
    if (score >= COMPLEX_AT) return 'complex';
    if (score <= SIMPLE_AT) return 'simple';
    return 'moderate';
  }

  window.__cfaiComplexity = {
    VERSION,
    /** classify(text) -> 'simple' | 'moderate' | 'complex'. Total function. */
    classify(text) {
      try {
        return classify(text);
      } catch {
        // A classifier fault must never break the send path, and must never
        // silently downgrade the user's model either.
        return 'moderate';
      }
    },
  };
})();
