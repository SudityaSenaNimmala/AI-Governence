# Prompt complexity: the rules that decide simple / moderate / complex

**Component:** `browser-extension/content/complexity.js` (`window.__cfaiComplexity`) — the single source of truth
**Classifier version:** `1.4.0`  ·  **decideRoute version:** `1.0.0` (§7)
**Consumers:** every routing engine (see §0). What a verdict then *does* — which tier, which label, which effort — is decided by the shared `decideRoute` (§7).

This document is the specification of a customer-visible behaviour: it decides which
model tier a user's prompt is sent to, and therefore what the customer is billed.
Every number in it is pinned to the source by
`browser-extension/tests/complexity-spec.test.mjs`, which fails if the code and this
document disagree. **Do not edit one without the other.**

---

## 0. Where these rules run — one classifier, four paths

Routing happens on four paths. All of them read the **same** policy
(`/api/v1/routing/policy`, or the legacy `/api/v1/routing/rules`), so all of them
must mean the same thing by `simple`.

| Path | Covers | Gets the classifier via |
|---|---|---|
| Browser extension | AI sites in the browser | `content/complexity.js` loaded as a content script — **canonical** |
| HTTPS proxy (`agent/src/proxy/`) | Any client through the proxy: CLIs, IDEs, API calls | `import { __cfaiComplexity } from './complexity.js'` — generated ES module |
| Desktop injector (`agent/src/desktop_injector/`) | Claude Desktop and other Electron apps | `complexity.inline.js`, embedded as text by `hook-template.js` and evaluated in each renderer — generated verbatim copy |
| Desktop enforcer (C#, `agent/src/os_monitor/enforcer-win.ps1`) — **a shipped engine** | Model pickers driven through Windows UI Automation (Claude Desktop, and web pickers in a browser window) | The scoring ALGORITHM is ported to C#; the lexicon, thresholds and structural signals are shipped to it as data (`CFAI_MODEL_ROUTER_CONFIG`), extracted from the canonical file by `agent/src/os_monitor/model-router-config.js` |

The C# enforcer is not a fourth classifier: it scores the extracted lexicon with a fixed port of `scoreCategory`/`decide`, so a lexicon or weight change reaches it with no C# edit (adding a *category* needs one line in `model-router-config.js`, see §6). The arithmetic patterns (`ARITHMETIC_SHAPE`) and the small-talk lists (`SMALL_TALK`, `SMALL_TALK_FILLER`) ship to it as data too. The C# side rewrites every JS regex so `\b`, `\w`, `\d` and `\s` keep their JS (ASCII / JS-whitespace) meaning (`MrJsRegexToNet`). The two generated JS artifacts come from the canonical file via
`node scripts/gen-proxy-complexity.mjs`, and `agent/tests/complexity-parity.test.mjs`
fails if any path disagrees with the canonical verdict on any prompt in its corpus.
`agent/tests/complexity-lockstep.test.mjs` does the same for the **compiled C# port**:
every prompt in `shared/complexity-corpus.json` (100+) must give an identical
`{ verdict, rule, score }` from `classifyDetailed()` and from `ClassifyComplexityDetailed`.

**Where the desktop lexicon comes from.** `model-router-config.js` reads the canonical
file first and falls back to the agent's own generated copy (`agent/src/proxy/complexity.js`).
The packaged agent ships `resources/agent/` with no `browser-extension/` beside it. Before
1.4.0 it read only the canonical path, so the enforcer got a config with **zero
categories** and scored every prompt 0 → `moderate`. That is the live "hi on Sonnet →
noop/standard" bug. If neither copy is readable, the C# classifier returns `unknown`
(rule `no_lexicon`) and emits `model_router_lexicon_missing` once. `unknown` is never routed.

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
failed to inject, and the desktop enforcer does the same when it has no lexicon.

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
| 3c | Small talk: strip every small-talk phrase and filler word and no letter or digit remains | **simple** |
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

### Step 3c: small talk *(1.4.0)*

In 1.3.0 `good morning`, `hello there` and `how are you` came out `moderate`. "good",
"morning" and "there" are not greeting *tokens*, so step 3 refused them, and the lexicon
scored them 0. On a premium model that meant a "good morning" was routed down only to
standard, not to economy.

Step 3c is a **shape** test, like 3b. It removes every `SMALL_TALK` phrase, then every
`SMALL_TALK_FILLER` word, and asks whether any letter or digit (in any script) remains.
At least one real small-talk phrase must be present.

- `SMALL_TALK` covers greetings (`hi`, `hello there`, `good morning/afternoon/evening`),
  "how are you" forms, thanks (`thank you`, `much appreciated`), acknowledgements (`ok`,
  `got it`, `sounds good`, `no worries`) and goodbyes (`see you later`, `good night`).
- `SMALL_TALK_FILLER` holds words that only ride along: `there`, `so`, `much`, `team`,
  `today`, `please`, `claude`, …

| Prompt | Verdict | Why |
|---|---|---|
| `good morning`, `how are you doing today?`, `thank you so much`, `hey team` | **simple** | Nothing survives the strip |
| `hi, please do deep research on EU AI regulation` | complex | "please do deep research on eu ai regulation" survives → scored (`deep research` 6) |
| `good morning, can you design a distributed cache?` | complex | Real words survive → scored normally |
| `there`, `team` | moderate | Filler alone is not small talk |

### Step 5: the explicit-simplicity override

"Explain cloud computing **in simple words**" → `simple`.
"Explain zero-trust architecture **in simple terms**" → `moderate`, because
`zero-trust` carries weight 4 and asking nicely does not make the subject easy.

---

## 3. The score

Thirteen compiled categories. Ten contribute positively, three negatively.

> `shallowTask` is scored *positively* at +1 — it is counted among the ten positive
> categories. `researchDepth` (added in 1.3.0) is the tenth.

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
| `researchDepth` *(1.3.0)* | 2–6 | **`deep research`, `literature review*`, `systematic review*`, `meta-analys*` (6)** — like `architect*`, each clears COMPLEX_AT alone; `research*`, `cite sources`, `with citations`, `evaluate/weigh the evidence`, `counterargument*`, `reason through`, `chain of reasoning`, `proof(s)`, `theorem*` (4); `investigat*`, `citations`, `primary/credible sources`, `multi-step`, `reason about`, `hypothes*`, `prove that`, `lemma`, `synthesi*`, `state of the art`, `methodolog*`, `critically`, `forecast*` (3); `evidence`, `nuanced` (2). **Plus structural:** a third numbered part at line start, `3.`/`3)` (3) — a multi-part brief |
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

Final score = (sum of all ten positive categories, each capped at 2 terms)
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
| `Write a literature review on transformer models` | `researchDepth` 6 (+ `transformer*` 3) | **complex** |
| `research the regulatory history of GDPR fines and cite sources` | `researchDepth` 4+4, `gdpr` 5 | **complex** |
| `Prove that the square root of 2 is irrational` | `prove` 4 (reasoning) + `prove that` 3 (research) | **complex** |
| `Research the history of the printing press` | `research*` 4 alone → below 6 | moderate |
| `proofread this paragraph` | `proof` is spelled out, never a stem → no hit | moderate |
| `good morning` | Small talk (step 3c) | **simple** |
| `how are you doing today?` | Small talk (step 3c) | **simple** |
| `hi, please do deep research on EU AI regulation` | Words survive 3c; `deep research` 6; greeting does not dominate → no −8 | **complex** |

---

## 5. Known limitations — state these honestly to customers

1. **An unrecognised prompt is `moderate`, not `simple`.** Scoring 0 means "no
   opinion", and the classifier will not silently downgrade a model the user chose.
   The practical consequence: **cost savings only occur when a prompt hits one of the
   negative terms, the arithmetic rule or the small-talk rule.** These are all `moderate` today:
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
6. **Routing goes both ways.** A demanding prompt is moved UP to premium even when
   the user picked a cheaper model (`allow_upgrade`, default on). An admin who turns
   `allow_upgrade` off caps every route at the tier the *user* last chose themselves
   (§7.4). If the user switches the model back after a route, that conversation is
   left alone (`respect_user_override`, default on).
7. **No question-count signal.** Three or more question marks look like research
   structure but are really a repetition count; only a numbered third part (`3.`) is
   read as a multi-part brief.

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
   A **new category** also needs its name (and any structural list) added to
   `POSITIVE_CATEGORY_NAMES` / `STRUCTURAL_FOR_CATEGORY` in
   `agent/src/os_monitor/model-router-config.js`, or the C# enforcer never sees it.
4. Update this document.
5. Keep `browser-extension/tests/complexity.test.mjs` (the acceptance table where
   intended behaviour is defined), `agent/tests/complexity-parity.test.mjs`
   (which proves the JS paths agree) and `agent/tests/complexity-lockstep.test.mjs`
   (which proves the compiled C# port agrees on verdict, rule and score over
   `shared/complexity-corpus.json`) green. A new **decision step** (like 3b/3c) is
   the one change that needs a C# edit: port it into `ClassifyComplexityDetailed`
   in `enforcer-win.ps1`, ship its data through `model-router-config.js`, and add
   corpus prompts for it. If you skip that, the lockstep test fails.

Per-platform tier labels and admin overrides are separate concerns: see §7 and
`shared/model-catalog.json`. An admin rule or catalog override changes which tier or
label a verdict maps to, without changing any of the rules above.

---

## 7. From verdict to route — the shared catalog and `decideRoute`

The classifier says how demanding a prompt is. **One pure function decides what to
do about it**, for every engine:

| Artifact | Role |
|---|---|
| `shared/model-catalog.json` | Per **provider** × tier: `api_ids`, `effort_supported`. Per **host** (claude.ai, chatgpt.com, gemini.google.com, aistudio.google.com, perplexity.ai, chat.mistral.ai) and per **desktop app** (`claude_desktop`, `chatgpt_desktop`) × tier: `click_labels` (what to click, most specific first) and `button_label_patterns` (how to read the current tier off the picker button), plus `effort` and `picker` metadata. `verified: true` only where a live pass is recorded in code (`evidence`). |
| `shared/decide-route.js` | `decideRoute(ctx, policy, catalog)` — pure, no I/O, no imports, JSON in/out. |
| `shared/routing-decision-vectors.json` | 74 decision cases + 24 label-reading cases. **The contract.** The extension bundle and the desktop enforcer's C# port must both pass all of them. |
| `browser-extension/content/model-routing.js` | **Generated** classic-script bundle of the two above (`node scripts/gen-shared-routing.mjs`), publishing `window.__cfaiRouting`. A test fails if it drifts. |

### 7.1 Label matching

A label or pattern matches text case-insensitively at a token boundary: the
character before it must not be a letter or digit, the character after it must not
be a letter, digit, `.` or `-`. The longest pattern across all tiers wins. This is
what keeps `Flash` (Gemini standard) from swallowing `Flash-Lite` (economy) and
`GPT-4` from matching `GPT-4o`.

### 7.2 Inputs

`ctx`: `surface` (`browser` | `desktop_app` — alias `desktop` — | `api_proxy`),
`host_or_app`, `provider` (null → from the catalog), `current_tier` (what the picker
shows), `user_tier` (what the user last chose themselves), `current_effort`,
`user_override`, `complexity` (`simple` | `moderate` | `complex` | `unknown`),
`sensitivity` (proxy only), `fleet_enabled`, `machine_enabled`.

`policy`: the `GET /api/v1/routing/policy` document `{ version, rules, catalog_overrides,
settings: { allow_upgrade, respect_user_override }, fleet_enabled }` — or the legacy
`GET /api/v1/routing/rules` array, or null (built-in table only). A rule is v2 when
`action.type` is set (`set_tier` | `cap_tier` | `suggest` | `none`), else v1.
`catalog_overrides` rows are `{ provider, host_or_app ('*' = all), tier, label }`; the
specific surface beats `'*'`, and an override for an unknown host creates an entry.

### 7.3 Output

`{ target_tier, effort, rule_id, rule_name, mode, result, reason, from_tier, to_label,
click_labels, model }`, where `result` is one of `routed` | `suggested` | `observed` |
`noop` | `unsupported` | `disabled` | `user_override` and `reason` is a short code
(`upgrade`, `downgrade`, `effort_only`, `already_on_target`, `upgrade_not_allowed`,
`unknown_complexity`, `rule_action_none`, `unknown_surface`, `provider_mismatch`,
`current_tier_unknown`, `no_label_for_tier`, `fleet_disabled`, `machine_disabled`,
`user_override`).

### 7.4 The order — fixed, pinned by the vectors

1. **Disabled** — `policy.fleet_enabled` or `ctx.fleet_enabled` false → `fleet_disabled`; `ctx.machine_enabled` false → `machine_disabled`.
2. **User override** — `ctx.user_override` and `respect_user_override` (default true) → `user_override`. Checked before anything is read from the page.
3. **Surface** — no catalog entry (after overrides) → `unsupported/unknown_surface`; ctx provider ≠ catalog provider → `provider_mismatch`; picker tier unreadable → `current_tier_unknown`.
4. **Rule** — enabled rules by ascending `priority` (default 50), ties in document order; the first whose scope (`surfaces`, `hosts` ∪ `apps`) and conditions (`provider`, `complexity`, `current_tier`) all match wins. **A rule with a `sensitivity` condition only ever matches on `api_proxy`** — on browser/desktop it is skipped, not applied with the condition ignored. `set_tier` → `target_tier` (else the tier of its `ui_name`/`model`, else built-in); `cap_tier` → min(built-in, cap); `suggest` → mode `suggest`; `none` → `noop/rule_action_none`. A v1 rule's target is the catalog tier of its `ui_name` (or its model id's tier), else the built-in. **No rule** → built-in: `simple → economy`, `moderate → standard`, `complex → premium`; `unknown` → `noop/unknown_complexity`.
5. **Cap** — only when `allow_upgrade` is **false**: the target is capped at `user_tier` (else `current_tier`). Default is true: upgrades above the user's model are intended.
6. **Effort** — built-in `simple → low`, `complex → high`, `moderate →` leave alone; a rule's `action.effort` overrides. Dropped to null unless the surface has an effort control (`catalog.hosts[h].effort.supported`) **and** the target tier's provider entry has `effort_supported` (on `api_proxy`, the provider flag alone). Today: claude.ai and Claude Desktop, Opus/Sonnet only.
7. **Noop** — target equals current tier and there is no effort change to make (an unknown current effort is not a change) → `noop/already_on_target` (or `upgrade_not_allowed` when step 5 capped it).
8. **Label** — the target tier's `click_labels` (with overrides). A v2 `action.ui_name` is clicked first; a v1 `ui_name` that the catalog recognises goes **after** the catalog's current labels (v1 seeds are stale), an unrecognised one first. No label for a tier change → `unsupported/no_label_for_tier`. Not needed on `api_proxy`.
9. **Mode** — `enforce` → `routed`, `suggest` → `suggested`, `observe` → `observed`; `reason` is `upgrade` / `downgrade` / `effort_only`.

### 7.5 The browser extension

* Policy: the service worker pulls `GET /api/v1/routing/policy` with the machine JWT
  and `If-None-Match`, caches `{ policy, etag, at }` in `chrome.storage.local`
  (`cfai.routing_policy`); on **404** it falls back to the legacy `/routing/rules` feed.
  Any other failure keeps the previous mirror.
* Current tier is read from the picker button through the catalog patterns. The
  user's own choice is tracked per **(host, provider)** (`cfai.routing_user_choice`)
  and is set **only** by a picker change the extension did not make — never by its
  own routes. A user change after a route suppresses routing for that tab's
  conversation and is reported once as `user_override`.
* An enforced route pauses the send, clicks the target label(s) until the picker
  reads back the target tier, sets effort through claude.ai's *Effort* submenu when
  the decision carries one (not yet live-verified; the effort actually showing
  afterwards is what is reported), then re-sends. **There is no fetch-level
  fallback** — the old `fetch-blocker.js` body rewrite was removed.
* Event `model_routed` — no prompt text, no raw page text: `mechanism: 'browser_extension'`,
  `surface: 'browser'`, `host_or_app`, `provider`, `from_tier`, `from_label` (catalog
  name), `to_tier`, `to_label`, `model`, `complexity`, `rule_id`, `result`
  (`applied` | `failed` | `suggested` | `observed` | `unsupported` | `user_override`),
  `reason`, `effort_from`, `effort_to`, `len`; plus legacy `routed_model`, `rule_name`,
  `current_tier`, `ui_changed`.
* Ownership heartbeat: when the desktop agent's identity beacon answers, the worker
  POSTs `{ browser, ext_version, routing_owner: true, nonce, instance_id, ts }` to
  `http://127.0.0.1:<beacon port>/cfai/routing-heartbeat` every 30 s so the agent can
  stand down in that browser (treat as owned for ~90 s after the last beat). The
  extension always routes in its own browser.

### 7.6 Changing routing safely

Edit `shared/model-catalog.json` or `shared/decide-route.js`, run
`node scripts/gen-shared-routing.mjs`, update the vectors if behaviour changed on
purpose, and keep `browser-extension/tests/shared-routing.test.mjs` green. A changed
vector is a behaviour change for the desktop enforcer too.
