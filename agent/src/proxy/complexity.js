// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Source of truth:  browser-extension/content/complexity.js
// Regenerate with:  node scripts/gen-proxy-complexity.mjs
// Pinned by:        agent/tests/complexity-parity.test.mjs
//
// This is the SAME classifier the browser extension runs, mechanically
// translated from its content-script IIFE into an ES module so the HTTPS proxy
// can import it. One definition of simple / moderate / complex now governs both
// routing paths; see the generator's header for why the proxy's own regex-plus-
// length classifier was removed.
//
// Edit content/complexity.js and re-run the generator. Editing this file
// directly will be overwritten and the parity test will fail.

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
// What replaces it: a weighted lexicon of fourteen categories (eleven positive
// signals, three negative) plus a few structural signals (code fences, stack
// traces, enumerated multi-part questions, whole-product build requests).
// Score maps to one of exactly three
// tiers.
//
// PRIVACY: this file reads prompt text and returns a single enum. It never
// stores it, never logs it, and deliberately returns no matched terms — those
// are literal substrings of the user's prompt and the caller emits telemetry to
// the governance server. Keep it that way.
//
// This file is plain (non-module) JS so manifest content_scripts can load it,
// same as content/patterns.js. It publishes window.__cfaiComplexity.


  // Injected twice on hosts present in BOTH manifest.json's content_scripts and
  // the service worker's injectDlpStack(). Everything here is pure, so a second
  // evaluation is harmless — but it re-compiles ~200 regexes for nothing.
  // (browser double-injection guard removed — ES modules evaluate once.)

  // 1.2.0 — added the pure-arithmetic shape test (step 3b). Bumped because this
  // changes verdicts: a bare sum was 'moderate' via the no-opinion fallback.
  // 1.3.0 — added the researchDepth category (lexicon + one structural signal):
  // multi-step reasoning, research, source comparison/evaluation, proofs. Routing
  // now goes BOTH ways by how demanding a prompt is, so a research-style ask must
  // reach 'complex' (premium) instead of sitting on the no-opinion 'moderate'.
  // 1.4.0 — added the small-talk shape test (step 3c): a message that is nothing
  // but greetings / pleasantries ("good morning", "hello there", "how are you",
  // "thanks so much") is 'simple'. Before it, anything with one non-greeting word
  // ("good", "morning", "there") scored 0 and fell to the no-opinion 'moderate',
  // so a "good morning" on a premium model was routed DOWN only to standard.
  // Also moved the arithmetic regexes into ARITHMETIC_SHAPE (same patterns) so
  // the desktop enforcer receives them as data, and added classifyDetailed().
  // 1.5.0 — added the productBuild category (lexicon + PRODUCT_BUILD_STRUCTURE):
  // a request to build a WHOLE product ("create a replica of whatsapp", "build a
  // clone of instagram", "build a full e-commerce website with payments") is
  // 'complex'. Every one of those scored 0 and fell to the no-opinion
  // 'moderate', so a whole-app build was routed to a mid/economy model. A
  // single component ("create a login page", "write a todo app in react")
  // still matches none of it and stays 'moderate'.
  const VERSION = '1.5.0';

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

  // Research / reasoning depth (1.3.0). The ask is to INVESTIGATE, not just to
  // answer: multi-step reasoning, research, comparing or weighing sources and
  // evidence, proofs. These are the prompts that genuinely need the premium tier,
  // and before this category most of them ("research the regulatory history of
  // X and cite sources") matched nothing and fell to 'moderate'.
  //
  // Weight 6 is reserved for phrases that name a research DELIVERABLE outright
  // ("literature review", "meta-analysis", "deep research") — like architect*,
  // each is enough on its own to clear COMPLEX_AT. Everything else is 2–4, so
  // reaching complex takes two distinct signals.
  //
  // `proof*` is NOT a stem on purpose: it would eat "proofread", which is the
  // opposite of a demanding ask. `proof`/`proofs` are spelled out.
  const RESEARCH_DEPTH = [
    ['deep research', 6],
    ['literature review*', 6],
    ['systematic review*', 6],
    ['meta-analys*', 6], ['meta analys*', 6],
    ['research*', 4],
    ['investigat*', 3],
    ['cite sources', 4], ['cite your sources', 4], ['with citations', 4],
    ['citations', 3],
    ['primary sources', 3], ['credible sources', 3],
    ['evaluate the evidence', 4], ['weigh the evidence', 4],
    ['evidence', 2],
    ['counterargument*', 4], ['counter-argument*', 4],
    ['multi-step', 3], ['multi step', 3], ['multistep', 3],
    ['reason through', 4], ['chain of reasoning', 4],
    ['reason about', 3],
    ['hypothes*', 3],
    ['proof', 4], ['proofs', 4],
    ['prove that', 3],
    ['theorem*', 4],
    ['lemma', 3],
    ['synthesi*', 3],
    ['state of the art', 3], ['state-of-the-art', 3],
    ['methodolog*', 3],
    ['critically', 3],
    ['forecast*', 3],
    ['nuanced', 2],
  ];

  // Whole-product builds (1.5.0). The real signal is structural — see
  // PRODUCT_BUILD_STRUCTURE, which needs a build verb and reaches COMPLEX_AT on
  // its own. These few words are only weak corroboration: "full stack" or
  // "clone of" alone ("what is a full stack developer") stays well below it.
  const PRODUCT_BUILD = [
    ['full-stack', 2], ['full stack', 2], ['fullstack', 2],
    ['clone of', 2], ['replica of', 2],
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

  // A question broken into three or more numbered parts ("1. … 2. … 3. …") is
  // the shape of a research brief. This is SHAPE, not length: a 30-character
  // three-part list fires it and a 3000-character paragraph does not.
  //
  // Deliberately NOT "three or more question marks". That reads as structure but
  // is really a repetition count — pasting one question twenty times would add
  // the signal, breaking the invariant that repeating the same content never
  // moves a verdict (tests/complexity.test.mjs pins it).
  //
  // Kept to constructs .NET's Regex accepts unchanged: the desktop enforcer
  // compiles these sources from CFAI_MODEL_ROUTER_CONFIG
  // (agent/src/os_monitor/model-router-config.js).
  const RESEARCH_STRUCTURE = [
    { key: '#enumerated-parts', weight: 3, re: /(^|\n)[ \t]*3[.)][ \t]+\S/ },
  ];

  // ── Whole-product builds (1.5.0) ───────────────────────────────────────────
  //
  // "create a replica of whatsapp" is a request for an entire product: auth,
  // messaging, storage, real-time delivery, several clients. It matched no term
  // at all, scored 0 and was routed to the standard (or, after a downgrade
  // rule, economy) tier. These are the asks that most need the premium model.
  //
  // The signal is a PHRASE SHAPE, not a word list. Each pattern requires a
  // build verb (build / create / make / develop / implement / design / code /
  // write / clone, or want / need) followed IN THE SAME SENTENCE by one of:
  //   #product-clone      clone|replica|copy|version of <known product>
  //   #product-suffix     a <known product> clone, an <known product>-like app
  //   #product-like       an app|website|platform like <known product>
  //   #product-clone-name clone of <Proper Noun> (case-sensitive: "clone of Acme")
  //   #whole-app          a full|complete|entire|end-to-end|production-ready|
  //                       scalable|full-stack|fully functional <app|website|
  //                       platform|system|SaaS|marketplace|e-commerce…>
  //   #full-stack-scope   frontend AND backend
  //   #feature-scope      <app|website|platform…> with <feature> … <feature>
  //                       (two of auth, payments, real-time, database, chat, …)
  // Each signal weighs COMPLEX_AT, so any ONE is enough. Without the build verb
  // nothing fires: "what is whatsapp", "how does instagram make money" stay
  // where the rest of the lexicon puts them. A single component ("create a
  // login page", "write a todo app in react") has no product, no whole-app
  // modifier and no second feature, so it is untouched.
  //
  // The patterns are assembled from plain string lists by
  // buildProductStructure(), inside the <cfai:product-build> sentinels. The
  // desktop enforcer receives the compiled {source, flags} (model-router-
  // config.js evaluates the region in isolation), so the region must stay
  // self-contained: no reference to anything outside it, and every construct
  // must be one .NET's Regex accepts once \b \w \d \s are given their JS
  // meanings (lookahead, lazy {m,n}, classes — no lookbehind, no named groups,
  // no inline flags). Each gap is bounded ({0,40}, at most 3 words) so the
  // scan stays linear on the 4 KB window.
  // <cfai:product-build>
  function buildProductStructure() {
    const alt = (list) => list.join('|');
    // Build intent. `want`/`need` cover "I want a clone of uber".
    const VERBS = [
      'build(?:s|ing)?', 'built', 'creat(?:e|es|ing|ed)', 'mak(?:e|es|ing)', 'made',
      'develop(?:s|ing|ed)?', 'implement(?:s|ing|ed)?', 'design(?:s|ing|ed)?',
      'cod(?:e|ing)', 'writ(?:e|es|ing)', 'program(?:s|ming)?', 'recreat(?:e|es|ing)',
      'replicat(?:e|es|ing)', 'clon(?:e|es|ing)', 'wants?', 'needs?',
    ];
    // Well-known products whose names carry a whole feature set. Lower-case;
    // the patterns using this list are case-insensitive. Deliberately absent:
    // words that are also ordinary English in this position ("medium",
    // "signal", "threads", "line", bare "x") — "a version of medium
    // difficulty" is not a build. Unlisted products still reach
    // #product-clone-name when capitalised ("clone of Acme").
    const PRODUCTS = [
      'whatsapp', 'instagram', 'uber', 'airbnb', 'netflix', 'youtube', 'twitter', 'x\\.com',
      'facebook', 'messenger', 'slack', 'spotify', 'amazon', 'tiktok', 'zoom', 'discord', 'notion',
      'gmail', 'linkedin', 'swiggy', 'zomato', 'snapchat', 'pinterest', 'reddit', 'telegram',
      'wechat', 'tinder', 'quora', 'ebay', 'flipkart', 'myntra', 'paytm', 'phonepe', 'paypal',
      'venmo', 'stripe', 'shopify', 'etsy', 'doordash', 'lyft', 'ola', 'rapido', 'trello', 'jira',
      'asana', 'figma', 'canva', 'dropbox', 'google\\s+drive', 'google\\s+docs', 'google\\s+maps',
      'google\\s+meet', 'microsoft\\s+teams', 'ms\\s+teams', 'outlook', 'github',
      'stack\\s*overflow', 'wikipedia', 'duolingo', 'coursera', 'udemy', 'hotstar',
      'prime\\s+video', 'twitch', 'booking\\.com', 'expedia', 'tripadvisor', 'yelp', 'zillow',
      'robinhood', 'coinbase', 'calendly', 'clickup', 'miro', 'evernote', 'chatgpt', 'imessage',
    ];
    // A product name followed by one of these is a PART of that product ("a
    // copy of zoom level", "a copy of gmail signature"), not the product.
    // Not "in"/"out": "a replica of uber in flutter" is the whole product.
    const PART_OF = [
      'level', 'levels', 'function', 'method', 'class', 'api', 'sdk', 'button', 'icon',
      'logo', 'link', 'account', 'file', 'feature', 'bot', 'integration', 'plugin', 'page', 'repo',
      'repository', 'template', 'signature', 'email', 'inbox', 'message', 'draft', 'invoice',
      'webhook', 'key', 'keys', 'difficulty', 'size', 'post', 'video', 'playlist', 'story', 'profile',
    ];
    // Whole-product scope. `full` is fenced off from "full screen" & co.
    const WHOLE = [
      'full(?![\\s-]*(?:screen|width|height|page|name|size|text|list|stop|time|day)\\b)',
      'complete', 'entire', 'end[\\s-]to[\\s-]end', 'production[\\s-](?:ready|grade)',
      'enterprise[\\s-]grade', 'scalable', 'full[\\s-]?stack', 'fully[\\s-]functional',
      'fully[\\s-]featured', 'feature[\\s-]complete',
    ];
    // What a whole product is called. `system prompt` is not a system.
    const PRODUCT_NOUNS = [
      'apps?', 'applications?', 'web\\s*apps?', 'web\\s*sites?', 'websites?', 'platforms?',
      'systems?(?![\\s-]*prompts?\\b)', 'saas', 'marketplaces?', 'e-?commerce', 'online\\s+stores?',
      'social\\s+(?:network|media)', 'mvp',
    ];
    // Components that, two at a time, make an app a multi-part system.
    const FEATURES = [
      'auth(?:entication|orization)?', 'log[\\s-]?ins?', 'sign[\\s-]?(?:ups?|ins?)',
      'user\\s+accounts?', 'payments?', 'payment\\s+gateway', 'checkout', 'subscriptions?',
      'real[\\s-]?time', 'live\\s+chat', 'chat', 'messaging', 'notifications?', 'databases?', 'db',
      'admin\\s+(?:panel|dashboard)', 'dashboards?', 'search', 'video\\s+call(?:s|ing)?',
      'file\\s+uploads?', 'shopping\\s+cart', 'cart', 'reviews', 'ratings', 'geolocation', 'maps?',
      'web\\s*sockets?', 'apis?', 'backend', 'back-end',
    ];

    const VERB = '\\b(?:' + alt(VERBS) + ')\\b';
    // Same sentence, bounded: never across . ? ! or a line break.
    const GAP = '[^.?!\\n]{0,40}?';
    const PRODUCT_NAME = '(?:' + alt(PRODUCTS) + ')';
    const PRODUCT = PRODUCT_NAME + '\\b(?![\\s-]+(?:' + alt(PART_OF) + ')\\b)';
    // Up to three words between a modifier and its noun ("full-stack MERN
    // social media app"), none of them a preposition — so "a full list of
    // apps" does not read as a full app.
    const WORDS = '(?:[\\s-]+(?!(?:of|for|about|on|in|to|with|from|and|or|into)\\b)[^\\s.?!,;:]+){0,3}?[\\s-]+';
    // Case-SENSITIVE verbs for the proper-noun pattern, which cannot use /i
    // (with /i, [A-Z] would match any letter). JS and .NET both lack portable
    // inline flags, so the case folding is spelled out.
    const VERB_CASED = '\\b(?:[Bb]uild(?:s|ing)?|[Bb]uilt|[Cc]reat(?:e|es|ing)|[Mm]ak(?:e|es|ing)|'
      + '[Dd]evelop(?:s|ing)?|[Ii]mplement(?:s|ing)?|[Dd]esign(?:s|ing)?|[Cc]od(?:e|ing)|[Pp]rogram)\\b';

    return [
      { key: '#product-clone', weight: 6, re: new RegExp(
        VERB + GAP + '\\b(?:clone|replica|copy|version)\\s+of\\s+(?:the\\s+)?' + PRODUCT, 'i') },
      { key: '#product-suffix', weight: 6, re: new RegExp(
        VERB + GAP + '\\b' + PRODUCT_NAME + '(?:(?:[\\s-]+(?:like|style|inspired))?[\\s-]+(?:clone|replica)'
        + '|[\\s-]+(?:like|style|inspired)[\\s-]+(?:apps?|application|web\\s*app|websites?|platform|site|service|marketplace))\\b', 'i') },
      { key: '#product-like', weight: 6, re: new RegExp(
        VERB + GAP + '\\b(?:apps?|application|web\\s*app|websites?|platform|site|service|marketplace|clone)\\s+'
        + '(?:(?:just|exactly)\\s+)?(?:like|similar\\s+to)\\s+' + PRODUCT, 'i') },
      { key: '#product-clone-name', weight: 6, re: new RegExp(
        VERB_CASED + GAP + '\\b[Cc]lone\\s+of\\s+[A-Z][A-Za-z0-9]', '') },
      { key: '#whole-app', weight: 6, re: new RegExp(
        VERB + GAP + '\\b(?:' + alt(WHOLE) + ')' + WORDS + '(?:' + alt(PRODUCT_NOUNS) + ')\\b', 'i') },
      { key: '#full-stack-scope', weight: 6, re: new RegExp(
        VERB + '[^.?!\\n]{0,80}?\\b(?:front[\\s-]?end\\b[^.?!\\n]{0,60}?\\bback[\\s-]?end'
        + '|back[\\s-]?end\\b[^.?!\\n]{0,60}?\\bfront[\\s-]?end)\\b', 'i') },
      { key: '#feature-scope', weight: 6, re: new RegExp(
        VERB + GAP + '\\b(?:' + alt(PRODUCT_NOUNS) + ')\\b[^.?!\\n]{0,40}?\\b(?:with|including|featuring|that\\s+(?:has|have|supports?))\\b'
        // Two DIFFERENT features: the one capture group in these patterns holds
        // the first, and (?!\1\b) refuses it as the second — otherwise "a todo
        // app with a database" pasted twice reads as two features.
        + '[^.?!\\n]{0,60}?\\b(' + alt(FEATURES) + ')\\b[^.?!\\n]{0,60}?\\b(?!\\1\\b)(?:' + alt(FEATURES) + ')\\b', 'i') },
    ];
  }
  const PRODUCT_BUILD_STRUCTURE = buildProductStructure();
  // </cfai:product-build>

  // ── Pure arithmetic ────────────────────────────────────────────────────────
  //
  // "what is 2+2" used to come out 'moderate', and not because anything judged
  // it: the lexicon has no arithmetic signal, so it matched NOTHING, scored 0,
  // and landed on the no-opinion fallback. Every trivial sum was therefore sent
  // to the standard tier. (`zxqv wobble frimble` scores 0 the same way — that is
  // what the fallback is for, and why it must stay 'moderate' in general.)
  //
  // This is a STRUCTURAL signal, not a length rule: it asks whether, once the
  // interrogative wrapper is removed, there is any WORD left. Nothing about how
  // short the prompt is matters, which keeps faith with this file's premise that
  // length is not difficulty.
  //
  // "explain why 2+2=4 in Peano arithmetic" is deliberately NOT caught: 'explain
  // why in peano arithmetic' survives the strip, so real words remain and the
  // prompt goes on to be scored normally.

  // One object literal of regex LITERALS so the desktop enforcer receives the
  // exact patterns as data (model-router-config.js slices this declaration out
  // and ships {source, flags}); nothing here is re-typed in C#. Keep every
  // pattern to constructs .NET's Regex accepts once \b \w \d \s are translated
  // to their JS (ASCII / JS-whitespace) meanings — see MrJsRegexToNet there.
  const ARITHMETIC_SHAPE = {
    // The interrogative scaffolding around a sum, and the words for operators.
    wrapper: /\b(?:what(?:\s+is|\s*'s|s)?|how\s+much\s+is|calculate|compute|plus|minus|times|multiplied\s+by|divided\s+by|equals?|percent|of|is|the|answer|to)\b/gi,
    // Digits and the symbols of arithmetic. `x` and `X` are included because
    // people write "12 x 7"; a bare letter is not otherwise allowed through.
    residue: /^[\s\d+\-*/^%().,=:?xX×÷]*$/,
    // At least one digit AND one operator, so a bare number ("42") — which is an
    // answer or an id, not a question — is not swept up.
    hasOperator: /[+\-*/^%×÷]|\bx\b/i,
    digit: /\d/,
  };

  function isPureArithmetic(sample) {
    const s = String(sample || '');
    if (!ARITHMETIC_SHAPE.digit.test(s)) return false;
    if (!ARITHMETIC_SHAPE.hasOperator.test(s)) return false;
    const residue = s.replace(ARITHMETIC_SHAPE.wrapper, ' ');
    return ARITHMETIC_SHAPE.residue.test(residue);
  }

  // ── Small talk ─────────────────────────────────────────────────────────────
  //
  // "good morning", "hello there", "how are you", "thanks so much" all came out
  // 'moderate' (1.3.0): "good"/"morning"/"there" are not greeting TOKENS, so the
  // step-3 fast path refused them, and nothing in the lexicon scored them, so
  // they landed on the no-opinion fallback.
  //
  // Same kind of rule as the arithmetic test above — a SHAPE test, not a length
  // test: remove every small-talk phrase, then every filler word that only ever
  // rides along with one ("there", "so much", "team", "claude"), and ask whether
  // any WORD (a letter or digit, any script) is left. If nothing is left and at
  // least one real small-talk phrase was present, the message is small talk.
  //
  // What this deliberately does NOT do: "hi, please do deep research on X" keeps
  // "please do deep research on x" — real words survive, so it is scored normally
  // (and the greeting does not earn the -8 either; see trivialDominates). Filler
  // alone ("there", "team") is not small talk: a core phrase must be present.
  //
  // Plain strings. A space matches any whitespace run (phraseSource), matching is
  // case-insensitive at word boundaries, and typographic apostrophes are folded
  // to ' first. Shipped to the desktop enforcer as data (model-router-config.js).
  // Strings containing an apostrophe use double quotes.
  const SMALL_TALK = [
    // greetings
    'hi', 'hello', 'hey', 'hiya', 'howdy', 'yo', 'greetings', 'hey there', 'hi there', 'hello there',
    'good morning', 'good afternoon', 'good evening', 'good day', 'morning', 'evening', 'gm',
    // how are you
    'how are you', 'how are u', 'how r u', "how're you", 'how are you doing', 'how are things',
    "how's it going", 'hows it going', 'how is it going', "how's your day", 'how is your day',
    'how have you been', "what's up", 'whats up', 'wassup', 'sup',
    'nice to meet you', 'pleased to meet you',
    "i'm good", 'im good', 'i am good', "i'm fine", 'i am fine', 'doing well', 'doing good', 'not bad',
    // thanks
    'thanks', 'thank you', 'thank u', 'thx', 'ty', 'tysm', 'cheers', 'much appreciated',
    'appreciate it', 'appreciated', "you're welcome", 'youre welcome',
    'good job', 'great job', 'nice work', 'well done',
    // acknowledgements
    'ok', 'okay', 'k', 'kk', 'cool', 'great', 'nice', 'awesome', 'perfect', 'got it', 'gotcha',
    'understood', 'sounds good', 'makes sense', 'np', 'no problem', 'no worries', 'alright', 'all right',
    'yes', 'yep', 'yeah', 'yup', 'sure', 'no', 'nope', 'nah', 'sorry', 'lol', 'haha',
    // goodbyes
    'bye', 'goodbye', 'good bye', 'bye bye', 'see you', 'see ya', 'see you later', 'cya', 'later',
    'take care', 'talk soon', 'ttyl', 'good night', 'goodnight',
    'have a nice day', 'have a good day', 'have a great day',
  ];

  // Words that carry no ask of their own and only ever ride along with small
  // talk. Never sufficient alone (see isSmallTalk).
  const SMALL_TALK_FILLER = [
    'there', 'again', 'all', 'everyone', 'everybody', 'guys', 'folks', 'team', 'friend', 'buddy',
    'mate', 'dear', 'so', 'much', 'very', 'a', 'lot', 'lots', 'the', 'for', 'your', 'my', 'help',
    'today', 'tonight', 'tomorrow', 'too', 'and', 'oh', 'ah', 'well', 'please', 'pls', 'plz',
    'claude', 'chatgpt', 'gemini', 'copilot', 'assistant', 'bot',
  ];

  function phraseAlternation(list) {
    // Longest first, for the same first-match-wins reason as compileCategory.
    return list.slice().sort((a, b) => b.length - a.length).map(phraseSource).join('|');
  }

  const SMALL_TALK_RE = new RegExp('\\b(?:' + phraseAlternation(SMALL_TALK) + ')\\b', 'gi');
  const SMALL_TALK_FILLER_RE = new RegExp('\\b(?:' + phraseAlternation(SMALL_TALK_FILLER) + ')\\b', 'gi');
  // A letter or a digit, in any script — "is there a WORD left?".
  const WORD_LEFT_RE = /[\p{L}\p{N}]/u;

  function isSmallTalk(sample) {
    const s = String(sample || '').replace(/[\u2018\u2019\u02bc]/g, "'");
    let phrases = 0;
    const residue = s
      .replace(SMALL_TALK_RE, () => { phrases++; return ' '; })
      .replace(SMALL_TALK_FILLER_RE, ' ');
    return phrases > 0 && !WORD_LEFT_RE.test(residue);
  }

  // ── Compilation ────────────────────────────────────────────────────────────
  // One alternation regex per category rather than one regex per term: one
  // matchAll pass per category over the window instead of ~250 independent scans.

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
    compileCategory('researchDepth', RESEARCH_DEPTH, RESEARCH_STRUCTURE),
    compileCategory('productBuild', PRODUCT_BUILD, PRODUCT_BUILD_STRUCTURE),
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
   * The decision procedure, plus WHICH rule decided and (for the scored steps)
   * the score. No prompt text and no matched terms ever leave this function —
   * only an enum, a rule name and an integer. The rule names are part of the
   * lockstep contract with the desktop enforcer's C# port
   * (agent/tests/complexity-lockstep.test.mjs compares all three fields).
   *
   * @param {string} text
   * @returns {{ verdict: 'simple'|'moderate'|'complex', rule: string, score: number|null }}
   */
  function decide(text) {
    if (typeof text !== 'string') text = '';
    const trimmed = text.trim();

    // 1. No typed text at all -> 'moderate', deliberately NOT 'simple'. The
    //    common shape here is an attachment with no question typed above it;
    //    silently routing that to the cheapest model is the worse failure.
    if (!trimmed) return { verdict: 'moderate', rule: 'empty', score: null };

    // 2. Bound the scan (see boundWindow — latency guard, not a signal).
    const sample = boundWindow(trimmed);

    // 3. Trivial fast path, dominance-gated (see isAllTrivialTokens).
    if (isAllTrivialTokens(sample)) return { verdict: 'simple', rule: 'greeting', score: null };

    // 3b. A bare sum is simple. Sits here, before scoring, because the lexicon
    //     has nothing to say about arithmetic and a score of 0 means 'moderate' —
    //     see isPureArithmetic for why this is a shape test, not a length test.
    if (isPureArithmetic(sample)) return { verdict: 'simple', rule: 'arithmetic', score: null };

    // 3c. Nothing but small talk ("good morning", "how are you", "thanks so
    //     much") is simple. Also a shape test — see isSmallTalk.
    if (isSmallTalk(sample)) return { verdict: 'simple', rule: 'small_talk', score: null };

    // 4. Weighted, per-category-capped score across every category.
    const { score, simplicityRequestHit, strongHit } = scoreAll(sample);

    // 5. Explicit-simplicity override: when the user has literally asked for a
    //    simple answer, honour it over the arithmetic — but only if nothing
    //    genuinely hard was mentioned. The strong-hit guard is what separates
    //    "explain cloud computing in simple words" (obey: simple) from
    //    "explain zero-trust architecture in simple terms" (a weight-4+ term is
    //    in there; asking nicely doesn't make the subject easy).
    if (simplicityRequestHit && !strongHit) return { verdict: 'simple', rule: 'simplicity_request', score };

    // 6. Score -> tier. Note there is no length term in this function at all.
    if (score >= COMPLEX_AT) return { verdict: 'complex', rule: 'score', score };
    if (score <= SIMPLE_AT) return { verdict: 'simple', rule: 'score', score };
    return { verdict: 'moderate', rule: 'score', score };
  }

  /**
   * @param {string} text
   * @returns {'simple'|'moderate'|'complex'} always one of these three; never throws.
   */
  function classify(text) {
    return decide(text).verdict;
  }

  export const __cfaiComplexity = {
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
    /**
     * classifyDetailed(text) -> { verdict, rule, score }. Same verdict as
     * classify(); `rule` names the deciding step and `score` is the integer
     * score for the scored steps (null otherwise). For tests and diagnostics —
     * carries no prompt text. Total function.
     */
    classifyDetailed(text) {
      try {
        return decide(text);
      } catch {
        return { verdict: 'moderate', rule: 'error', score: null };
      }
    },
  };

