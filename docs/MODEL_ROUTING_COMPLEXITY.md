# Prompt complexity: the rules that decide simple / moderate / complex

**Component:** `browser-extension/content/complexity.js` (`window.__cfaiComplexity`) — the single source of truth
**Classifier version:** `1.2.0`
**Consumers:** all three routing paths (see §0), evaluating the same rules seeded by `server/src/seed-routing.js`.

This document is the specification of a customer-visible behaviour: it decides which
model tier a user's prompt is sent to, and therefore what the customer is billed.
Every number in it is pinned to the source by
`browser-extension/tests/complexity-spec.test.mjs`, which fails if the code and this
document disagree. **Do not edit one without the other.**

---

## 0. Where these rules run — one classifier, three paths

Routing happens on three surfaces. All three read the **same** rules from
`/api/v1/routing/rules`, so all three must mean the same thing by `simple`.

| Path | Covers | Gets the classifier via |
|---|---|---|
| Browser extension | AI sites in the browser | `content/complexity.js` loaded as a content script — **canonical** |
| HTTPS proxy (`agent/src/proxy/`) | Any client through the proxy: CLIs, IDEs, API calls | `import { __cfaiComplexity } from './complexity.js'` — generated ES module |
| Desktop injector (`agent/src/desktop_injector/`) | Claude Desktop and other Electron apps | `complexity.inline.js`, embedded as text by `hook-template.js` and evaluated in each renderer — generated verbatim copy |

Both generated artifacts come from the canonical file via
`node scripts/gen-proxy-complexity.mjs`, and `agent/tests/complexity-parity.test.mjs`
fails if any path disagrees with the canonical verdict on any prompt in its corpus.

### Why this is structured this way

The proxy and the injector each used to carry their **own** classifier — a pair of
flat regexes behind a length test:

```js
if (tokenEstimate < 100) return 'simple';    // ~400 characters
if (tokenEstimate > 3000) return 'complex';
```

That is the exact heuristic §1 exists to reject, and because all three paths
evaluate the same rules, one admin rule reading `complexity: simple` was matching
three incompatible definitions of the word:

| `what's our architecture for the billing service?` | Old verdict | Old model |
|---|---|---|
| Browser extension | complex | Opus |
| HTTPS proxy | **simple** — 48 chars, ~12 tokens, short-circuited before the regex ran | **Haiku** |
| Desktop injector | **simple** — same rule | **Haiku** |

Same prompt, opposite tier, decided by which surface the user happened to reach
the model through — visible to the customer on their invoice. Both copies are
gone; the table above is how each path gets the one remaining definition.

**One deliberate difference.** The proxy returns `unknown`, not `moderate`, when
there is no prompt text. In the browser an empty prompt means the user typed
nothing and sent an attachment; in the proxy it means prompt text could not be
extracted from the request body, which is not the same claim. No complexity
condition matches `unknown`, so an unreadable body is forwarded untouched rather
than routed on a guess. The desktop injector does the same when the classifier
failed to inject.

---

## 1. The one thing that is NOT a signal

**Prompt length plays no part in the difficulty verdict.** There is no character
count, word count, or size term anywhere in the scoring path.

This is deliberate. The classifier replaced a heuristic that fell back to string
length, and that heuristic was wrong in both directions:

| Prompt | Length | Old verdict | Correct verdict |
|---|---|---|---|
| "What's our architecture for the billing service?" | 48 chars | simple (too short) | **complex** |
| "Explain cloud computing in simple words…" ×40 | 2048 chars | moderate (too long) | **simple** |

Measured against the shipped classifier: a 2048-character easy prompt returns
`simple`, a 12-character prompt (`architecture`) returns `complex`, and repeating one
sentence from 22 to 2200 characters does not change its tier.

Two places do count tokens, and neither judges difficulty — both answer "is this
message essentially just a greeting?":

| Constant | Value | Purpose |
|---|---|---|
| `MAX_TRIVIAL_TOKENS` | 4 | Ceiling for the all-greeting fast path (step 3) |
| `MAX_FILLER_CONTENT_TOKENS` | 2 | Ceiling on real words riding along with a greeting |

The analysis window (`WINDOW_HEAD` 3000 + `WINDOW_TAIL` 1000 characters) is a CPU
latency bound, not a signal. Text outside it is not scanned, so a hard term buried
in the middle of a 100 KB paste can be missed — a deliberate performance trade, not
a difficulty judgement.

---

## 2. The decision procedure, in order

The first rule that fires wins. `classify()` always returns exactly one of
`simple` / `moderate` / `complex`, and never throws.

| # | Rule | Verdict |
|---|---|---|
| 1 | Prompt is empty or whitespace only | **moderate** |
| 2 | Trim to the analysis window | *(no verdict — bound only)* |
| 3 | Every meaningful token is a greeting (`hi`, `ok`, `thanks`, `yes`, `no`, `bye`, …) and there are ≤ 4 tokens | **simple** |
| 3b | Pure arithmetic: strip the question wrapper and only digits/operators remain | **simple** |
| 4 | Score the lexicon (section 3) | *(no verdict — produces a number)* |
| 5 | The user explicitly asked for a simple answer **and** no strong term (weight ≥ 4) is present | **simple** |
| 6 | `score ≥ 6` | **complex** |
| 6 | `score ≤ −3` | **simple** |
| 6 | otherwise | **moderate** |

### Why step 1 is `moderate` and not `simple`

An empty prompt usually means an attachment with no question typed above it.
Downgrading that to the cheapest model is the worse failure, so the classifier
declines to have an opinion.

### Step 3b: pure arithmetic

`what is 2+2` matched no lexicon term at all, scored 0, and fell through to
`moderate` — so every trivial sum was billed at the standard tier. Step 3b is a
**shape** test, not a length test: it removes the interrogative wrapper
(`what is`, `how much is`, `calculate`, `plus`, `percent of`, …) and asks whether any
*word* remains. It requires both a digit **and** an operator.

| Prompt | Verdict | Why |
|---|---|---|
| `2+2`, `12 x 7`, `what is 15% of 240`, `8÷2` | **simple** | Nothing but digits and operators survive |
| `explain why 2+2=4 in Peano arithmetic` | moderate | Real words survive the strip → scored normally |
| `42`, `3.14` | moderate | No operator: an id or an answer, not a question |

### Step 5: the explicit-simplicity override

"Explain cloud computing **in simple words**" → `simple`.
"Explain zero-trust architecture **in simple terms**" → `moderate`, because
`zero-trust` carries weight 4 and asking nicely does not make the subject easy.

---

## 3. The score

Twelve compiled categories. Nine contribute positively, three negatively.

> **Correction to a stale in-file comment:** `complexity.js`'s header says "eleven
> categories (eight positive, three negative)". There are twelve, because
> `shallowTask` is scored *positively* at +1. The behaviour below is what the code
> does.

### Per-category cap

| Constant | Value | Meaning |
|---|---|---|
| `CAP_PER_CATEGORY` | 2 | Only the **two heaviest distinct terms** in a category count |

So a prompt rattling off six synonyms for one idea cannot out-score a prompt that is
genuinely hard in three different dimensions. Inflections of one lexicon entry
(`debug`, `debugging`, `debugger`) are **one** signal, not three.

### Thresholds

| Constant | Value | Meaning |
|---|---|---|
| `COMPLEX_AT` | 6 | `score ≥ 6` → complex |
| `SIMPLE_AT` | −3 | `score ≤ −3` → simple |
| `STRONG_WEIGHT` | 4 | A term at ≥ 4 is "self-evidently hard"; vetoes step 5 |

### Positive categories

| Category | Weights | Representative terms |
|---|---|---|
| `reasoningDepth` | 3–4 | `why`, `trade-off(s)`, `compare`, `versus`, `pros and cons`, `justify`, `prove`, `derive`, `implications`, `root cause*`, `think through`, `first principles`, `edge case(s)`, `step by step` (3), `evaluate` (3) |
| `taskComplexity` | 2–6 | **`architect*` (6)**, `system design` (4), `scalab*`, `distributed`, `high availability`, `fault toleran*`, `concurren*` (4), `design`, `migration*`, `refactor*`, `optimi*`, `multi-tenant` (3), `end-to-end`, `framework` (2) |
| `domainExpertise` | 2–5 | `sql injection*`, `vulnerab*`, `xss`, `csrf`, `exploit*`, `cryptograph*`, `hipaa`, `pci dss`, `gdpr`, `authentication bypass*`, `penetration test*`, `threat model*` (5); `zero-trust`, `cap theorem`, `algorithm*`, `deadlock*` (4); `sharding`, `gradient descent`, `transformer*` (3); `kubernetes`, `terraform`, `aws`, `azure`, `gcp`, `iam`, `vpc`, `oauth`, `saml`, `kerberos`, `tls`, `kafka`, `postgres` (2) |
| `planning` | 2–3 | `roadmap*`, `strategy/strategies`, `estimate effort` (3); `plan(s)/planning`, `phases`, `milestones`, `rollout`, `break down into`, `outline the steps`, `prioriti*` (2) |
| `coding` | 1–3 | `implement*` (3); `write a function`, `endpoint(s)`, `unit test(s)` (2); `typescript`, `python`, `rust`, `golang`, `sql` (1). **Plus structural:** ``` ``` ``` fence (2), import/require/def/`=>` syntax (1) |
| `debugging` | 2–4 | `memory leak*`, `race condition*` (4); `debug*`, `stack trace*`, `traceback*`, `regression*` (3); `reproduce`, `not working`, `fails/failing` (2). **Plus structural:** `Traceback (most recent call last)`, JS frame, `Exception in thread`, `panic:`, `Error:` (4 each, case-sensitive) |
| `analysis` | 2–3 | `analy*`, `audit(s)/auditing`, `benchmark*` (3); `assess`, `critique`, `profile`, `correlate`, `interpret` (2) |
| `outputComplexity` | 2–3 | `production-ready`, `deep dive` (3); `comprehensive`, `thorough`, `detailed`, `in-depth`, `walkthrough`, `write a report`, `spec`, `proposal` (2) |
| `shallowTask` | +1 | `fix`, `error`, `exception`, `code`, `function`, `summar*`, `write a haiku/poem/story/email`. **Positive, not negative** — these indicate work, just not hard work |

### Negative categories

| Category | Weights | Terms | Applies |
|---|---|---|---|
| `simpleTask` | −3 | `define`, `spell`, `translate`, `convert`, `rename`, `format`, `lint`, `fix typo`, `commit message`, `changelog`, `joke` | Always |
| `simplicityRequest` | −5 | `in simple words/terms`, `in plain english`, `eli5`, `explain like i'm 5`, `for a beginner`, `for a non-technical`, `layman`, `briefly`, `one sentence`, `short answer`, `overview of`, `intro to` | Always; also triggers step 5 |
| `trivialIntent` | −8 | `hi`, `hello`, `hey`, `thanks`, `thank you`, `ok`, `okay`, `yes`, `no`, `bye` | **Only when greetings dominate** |

#### The `trivialIntent` gate

A −8 penalty applies only when greetings are a strict majority of the meaningful
tokens **and** at most 2 real content words ride along. Otherwise
"hi, can you design a distributed cache?" would collect −8 from `hi` and be
downgraded — it is a distributed-systems question with a greeting bolted on.

Final score = (sum of all nine positive categories, each capped at 2 terms)
\+ `simpleTask` + `simplicityRequest` + (`trivialIntent` if greetings dominate).

---

## 4. Worked examples

Verified against the shipped classifier.

| Prompt | Score path | Verdict |
|---|---|---|
| `hi` | All tokens trivial (step 3) | **simple** |
| `2+2` | Pure arithmetic (step 3b) | **simple** |
| `define idempotent` | `simpleTask` −3 → ≤ −3 | **simple** |
| `explain cloud computing in simple words` | `simplicityRequest` hit, no strong term (step 5) | **simple** |
| `what is 2+2` | Arithmetic (step 3b) | **simple** |
| `42` | No lexicon hit, no operator → score 0 | moderate |
| `summarize this email` | `shallowTask` +1 → between thresholds | moderate |
| `write a python function to reverse a string` | `coding` +2/+1 → below 6 | moderate |
| `explain zero-trust architecture in simple terms` | Strong term vetoes step 5 | moderate |
| `zxqv wobble frimble` | No hit → score 0 | moderate |
| `architecture` | `architect*` = 6 → ≥ 6 | **complex** |
| `why does this deadlock` | `why` 4 + `deadlock*` 4 = 8 | **complex** |
| `what's our architecture for the billing service?` | `architect*` 6 | **complex** |
| `design a multi-tenant migration plan with rollback` | `taskComplexity` capped 3+3, `planning` 2 | **complex** |

---

## 5. Known limitations — state these honestly to customers

1. **An unrecognised prompt is `moderate`, not `simple`.** Scoring 0 means "no
   opinion", and the classifier will not silently downgrade a model the user chose.
   The practical consequence: **cost savings only occur when a prompt hits one of the
   negative terms or the arithmetic rule.** These are all `moderate` today:
   `capital of France`, `what time is it in Tokyo`, `who wrote Hamlet`.
2. **No conversational context.** Only the current prompt is seen, never the thread.
   This is why a bare number is `moderate` — `42` may be answering "how many
   shards?" inside a hard architecture discussion.
3. **English lexicon only.** Non-Latin scripts are scored (never mistaken for a
   greeting) but match no terms, so they land on `moderate`.
4. **Window truncation.** A hard term beyond the first 3000 / last 1000 characters
   is not seen.
5. **Keyword matching, not comprehension.** `architecture` scores 6 in any context,
   including "what's the architecture of this Lego set".
6. **A user's manual choice is a ceiling.** `smartRoute()` will not upgrade above the
   tier the user selected themselves, except that a `complex` prompt always gets at
   least the standard tier.

---

## 6. Changing the rules safely

Tuning dials, in order of bluntness:

| Change | Effect |
|---|---|
| `SIMPLE_AT` (−3) toward 0 | More prompts downgrade → more savings, more risk |
| `COMPLEX_AT` (6) upward | Fewer upgrades → cheaper, lower quality on hard asks |
| Add a term to a negative category | Targeted saving on a known-easy phrasing |
| Add a term to a positive category | Targeted quality protection |

Every change **must**:

1. Edit `browser-extension/content/complexity.js` — never a generated copy.
2. Bump `VERSION` in it (the test suite pins the format, so a lexicon change is a
   visible change).
3. **Run `node scripts/gen-proxy-complexity.mjs`** to regenerate the proxy and
   desktop artifacts, and commit them. Skipping this leaves the browser on the new
   rules and the other two paths on the old ones — the divergence in §0, reintroduced.
4. Update this document.
5. Keep `browser-extension/tests/complexity.test.mjs` (the acceptance table where
   intended behaviour is defined) and `agent/tests/complexity-parity.test.mjs`
   (which proves all three paths agree) green.

Per-platform tier labels and admin overrides are separate concerns: see
`PLATFORM_TIERS` in `content/content.js` and the seeded rules in
`server/src/seed-routing.js`. An admin rule in the dashboard overrides the built-in
label without changing any of the rules above.
