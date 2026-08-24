// Versioned LLM pricing table. Prices are USD per 1M tokens.
//
// Sources:
//   - OpenAI:    https://openai.com/api/pricing/   (verify before each release)
//   - Anthropic: https://www.anthropic.com/pricing
//   - Google:    https://ai.google.dev/pricing
//   - Azure OpenAI uses the underlying OpenAI model's price.
//   - AWS Bedrock provider prices vary by region; use the model owner's price
//     as a baseline.
//
// Lookup is fuzzy: API responses give the exact deployed model id (e.g.
// "gpt-4o-2024-08-06"), we match by the longest prefix in this table.
//
// To update: bump VERSION, add the new row, push. The daemon hot-reloads on
// SIGHUP (or just restart the systemd service).

export const VERSION = '2026-08-21';

// PROVENANCE — every row below was taken from the provider's own pricing page on
// the date in VERSION. Re-verify against these when bumping it; a wrong price
// here does not fail, it silently misreports spend, which is the whole product.
//
//   Anthropic   first-party API rates (Opus 5 $5/$25, Sonnet 5 $3/$15, Haiku 4.5 $1/$5)
//   OpenAI      https://developers.openai.com/api/docs/pricing
//   Google      https://ai.google.dev/gemini-api/docs/pricing
//   Mistral     https://mistral.ai/pricing/api
//   Perplexity  https://docs.perplexity.ai/getting-started/pricing
//
// ORDER IS SIGNIFICANT. priceFor() returns the FIRST matching row, so a specific
// family must precede the generic one that would also match it: `gpt-5-mini`
// before `gpt-5`, `gemini-2.5-flash-lite` before `gemini-2.5-flash`,
// `claude-opus-4-8` before `claude-opus-4`.
//
// RETIRED MODELS STAY. Cost is recalculated from model + tokens on every read,
// so removing a row would re-price historical records at zero. Rows marked
// "retired" exist only so old records keep costing what they cost.

// One row per model family. `input` and `output` are USD per 1M tokens.
// `cached_input` is for prompts hitting the provider's cache (OpenAI / Anthropic
// both bill cached tokens lower). Null = use input price.
export const MODELS = [
  // ---- Anthropic ----
  // The two tiers the built-in routing rules send traffic to. Without these rows
  // both fell through to UNKNOWN, which prices at input: 0 / output: 0 — so the
  // standard and premium tiers were being reported as free, and the spend data
  // you would use to prove the router saves money was silently zeroed for most
  // of the traffic it moves.
  { match: /^claude-fable-5/,                   provider: 'anthropic', family: 'claude-fable-5',   input: 10.00, output: 50.00, cached_input: 1.00 },
  { match: /^claude-mythos-5/,                  provider: 'anthropic', family: 'claude-mythos-5',  input: 10.00, output: 50.00, cached_input: 1.00 },
  { match: /^claude-opus-5/,                    provider: 'anthropic', family: 'claude-opus-5',    input: 5.00,  output: 25.00, cached_input: 0.50 },
  // Opus 4.6/4.7/4.8 are $5/$25, NOT the $15/$75 these rows used to carry. That
  // was Opus-4.1-era pricing left in place across three releases, and it inflated
  // reported spend for those families by 3x.
  { match: /^claude-opus-4-8/,                  provider: 'anthropic', family: 'claude-opus-4.8',  input: 5.00,  output: 25.00, cached_input: 0.50 },
  { match: /^claude-opus-4-7/,                  provider: 'anthropic', family: 'claude-opus-4.7',  input: 5.00,  output: 25.00, cached_input: 0.50 },
  { match: /^claude-opus-4-6/,                  provider: 'anthropic', family: 'claude-opus-4.6',  input: 5.00,  output: 25.00, cached_input: 0.50 },
  { match: /^claude-opus-4/,                    provider: 'anthropic', family: 'claude-opus-4',    input: 15.00, output: 75.00, cached_input: 1.50 },
  { match: /^claude-sonnet-5/,                  provider: 'anthropic', family: 'claude-sonnet-5',  input: 3.00,  output: 15.00, cached_input: 0.30 },
  { match: /^claude-sonnet-4-6/,                provider: 'anthropic', family: 'claude-sonnet-4.6', input: 3.00, output: 15.00, cached_input: 0.30 },
  { match: /^claude-sonnet-4/,                  provider: 'anthropic', family: 'claude-sonnet-4',  input: 3.00,  output: 15.00, cached_input: 0.30 },
  { match: /^claude-haiku-4-5/,                 provider: 'anthropic', family: 'claude-haiku-4.5', input: 1.00,  output: 5.00,  cached_input: 0.10 },
  { match: /^claude-3-5-sonnet/,                provider: 'anthropic', family: 'claude-3.5-sonnet', input: 3.00, output: 15.00, cached_input: 0.30 },
  { match: /^claude-3-5-haiku/,                 provider: 'anthropic', family: 'claude-3.5-haiku', input: 0.80,  output: 4.00,  cached_input: 0.08 },
  { match: /^claude-3-opus/,                    provider: 'anthropic', family: 'claude-3-opus',    input: 15.00, output: 75.00, cached_input: 1.50 },

  // ---- OpenAI ----
  { match: /^gpt-5\.6-sol/,                     provider: 'openai',    family: 'gpt-5.6-sol',      input: 5.00,  output: 30.00, cached_input: 0.50 },
  { match: /^gpt-5\.6-terra/,                   provider: 'openai',    family: 'gpt-5.6-terra',    input: 2.00,  output: 12.00, cached_input: 0.20 },
  { match: /^gpt-5\.6-luna/,                    provider: 'openai',    family: 'gpt-5.6-luna',     input: 0.20,  output: 1.20,  cached_input: 0.02 },
  { match: /^gpt-5\.5-pro/,                     provider: 'openai',    family: 'gpt-5.5-pro',      input: 30.00, output: 180.00, cached_input: null },
  { match: /^gpt-5\.5/,                         provider: 'openai',    family: 'gpt-5.5',          input: 5.00,  output: 30.00, cached_input: 0.50 },
  { match: /^gpt-5\.4-pro/,                     provider: 'openai',    family: 'gpt-5.4-pro',      input: 30.00, output: 180.00, cached_input: null },
  { match: /^gpt-5\.4-mini/,                    provider: 'openai',    family: 'gpt-5.4-mini',     input: 0.75,  output: 4.50,  cached_input: 0.075 },
  { match: /^gpt-5\.4-nano/,                    provider: 'openai',    family: 'gpt-5.4-nano',     input: 0.20,  output: 1.25,  cached_input: 0.02 },
  { match: /^gpt-5\.4/,                         provider: 'openai',    family: 'gpt-5.4',          input: 2.50,  output: 15.00, cached_input: 0.25 },
  { match: /^gpt-5\.3-codex/,                   provider: 'openai',    family: 'gpt-5.3-codex',    input: 1.75,  output: 14.00, cached_input: 0.175 },
  { match: /^gpt-5\.2-pro/,                     provider: 'openai',    family: 'gpt-5.2-pro',      input: 21.00, output: 168.00, cached_input: null },
  { match: /^gpt-5\.2/,                         provider: 'openai',    family: 'gpt-5.2',          input: 1.75,  output: 14.00, cached_input: 0.175 },
  { match: /^gpt-5\.1/,                         provider: 'openai',    family: 'gpt-5.1',          input: 1.25,  output: 10.00, cached_input: 0.125 },
  { match: /^gpt-5-pro/,                        provider: 'openai',    family: 'gpt-5-pro',        input: 15.00, output: 120.00, cached_input: null },
  { match: /^gpt-5-mini/,                       provider: 'openai',    family: 'gpt-5-mini',       input: 0.25,  output: 2.00,  cached_input: 0.025 },
  { match: /^gpt-5-nano/,                       provider: 'openai',    family: 'gpt-5-nano',       input: 0.05,  output: 0.40,  cached_input: 0.005 },
  { match: /^gpt-5-search-api/,                 provider: 'openai',    family: 'gpt-5-search-api', input: 1.25,  output: 10.00, cached_input: 0.125 },
  { match: /^gpt-5/,                            provider: 'openai',    family: 'gpt-5',            input: 1.25,  output: 10.00, cached_input: 0.125 },
  { match: /^chat-latest/,                      provider: 'openai',    family: 'chat-latest',      input: 5.00,  output: 30.00, cached_input: 0.50 },
  { match: /^gpt-4\.1-nano/,                    provider: 'openai',    family: 'gpt-4.1-nano',     input: 0.10,  output: 0.40,  cached_input: 0.025 },
  { match: /^gpt-4\.1-mini/,                    provider: 'openai',    family: 'gpt-4.1-mini',     input: 0.40,  output: 1.60,  cached_input: 0.10 },
  { match: /^gpt-4\.1/,                         provider: 'openai',    family: 'gpt-4.1',          input: 2.00,  output: 8.00,  cached_input: 0.50 },
  { match: /^gpt-4o-mini/,                      provider: 'openai',    family: 'gpt-4o-mini',      input: 0.15,  output: 0.60,  cached_input: 0.075 },
  { match: /^gpt-4o-2024-05-13/,                provider: 'openai',    family: 'gpt-4o-2024-05-13', input: 5.00, output: 15.00, cached_input: null },
  { match: /^gpt-4o/,                           provider: 'openai',    family: 'gpt-4o',           input: 2.50,  output: 10.00, cached_input: 1.25 },
  { match: /^gpt-4-turbo/,                      provider: 'openai',    family: 'gpt-4-turbo',      input: 10.00, output: 30.00, cached_input: null },
  { match: /^gpt-4(?![\.\do]|-turbo)/,          provider: 'openai',    family: 'gpt-4',            input: 30.00, output: 60.00, cached_input: null },
  { match: /^gpt-3\.5-turbo/,                   provider: 'openai',    family: 'gpt-3.5-turbo',    input: 0.50,  output: 1.50,  cached_input: null },
  { match: /^o4-mini/,                          provider: 'openai',    family: 'o4-mini',          input: 1.10,  output: 4.40,  cached_input: 0.275 },
  { match: /^o3-pro/,                           provider: 'openai',    family: 'o3-pro',           input: 20.00, output: 80.00, cached_input: null },
  { match: /^o3-mini/,                          provider: 'openai',    family: 'o3-mini',          input: 1.10,  output: 4.40,  cached_input: 0.55 },
  // o3 was price-cut from $10/$40 to $2/$8; the old figures overstated it 5x.
  { match: /^o3/,                               provider: 'openai',    family: 'o3',               input: 2.00,  output: 8.00,  cached_input: 0.50 },
  { match: /^o1-pro/,                           provider: 'openai',    family: 'o1-pro',           input: 150.00, output: 600.00, cached_input: null },
  { match: /^o1-mini/,                          provider: 'openai',    family: 'o1-mini',          input: 3.00,  output: 12.00, cached_input: 1.50 },
  { match: /^o1-preview/,                       provider: 'openai',    family: 'o1-preview',       input: 15.00, output: 60.00, cached_input: 7.50 },
  { match: /^o1/,                               provider: 'openai',    family: 'o1',               input: 15.00, output: 60.00, cached_input: 7.50 },
  { match: /^text-embedding-3-large/,           provider: 'openai',    family: 'embedding-3-large', input: 0.13, output: 0.00,  cached_input: null },
  { match: /^text-embedding-3-small/,           provider: 'openai',    family: 'embedding-3-small', input: 0.02, output: 0.00,  cached_input: null },

  // ---- Google ----
  // Gemini prices tier by context length (the >200k band costs more) and audio
  // input costs more than text. These rows carry the text, <=200k rate — the
  // common case — so a long-context or audio-heavy request is UNDER-reported.
  { match: /^gemini-3\.7-flash/,                provider: 'google',    family: 'gemini-3.7-flash', input: 0.75,  output: 3.75,  cached_input: 0.075 },
  { match: /^gemini-3\.6-flash/,                provider: 'google',    family: 'gemini-3.6-flash', input: 0.75,  output: 3.75,  cached_input: 0.075 },
  { match: /^gemini-3\.5-flash-lite/,           provider: 'google',    family: 'gemini-3.5-flash-lite', input: 0.30, output: 2.50, cached_input: 0.03 },
  { match: /^gemini-3\.5-flash/,                provider: 'google',    family: 'gemini-3.5-flash', input: 1.50,  output: 9.00,  cached_input: 0.15 },
  { match: /^gemini-3\.1-flash-lite/,           provider: 'google',    family: 'gemini-3.1-flash-lite', input: 0.25, output: 1.50, cached_input: 0.025 },
  { match: /^gemini-3\.1-pro/,                  provider: 'google',    family: 'gemini-3.1-pro',   input: 2.00,  output: 12.00, cached_input: 0.20 },
  { match: /^gemini-2\.5-pro/,                  provider: 'google',    family: 'gemini-2.5-pro',   input: 1.25,  output: 10.00, cached_input: 0.125 },
  { match: /^gemini-2\.5-flash-lite/,           provider: 'google',    family: 'gemini-2.5-flash-lite', input: 0.10, output: 0.40, cached_input: 0.01 },
  { match: /^gemini-2\.5-flash/,                provider: 'google',    family: 'gemini-2.5-flash', input: 0.30,  output: 2.50,  cached_input: 0.03 },
  // Retired — kept so historical records do not re-price to zero.
  { match: /^gemini-2\.0-flash/,                provider: 'google',    family: 'gemini-2.0-flash', input: 0.10,  output: 0.40,  cached_input: 0.025 },
  { match: /^gemini-1\.5-pro/,                  provider: 'google',    family: 'gemini-1.5-pro',   input: 1.25,  output: 5.00,  cached_input: 0.31 },
  { match: /^gemini-1\.5-flash/,                provider: 'google',    family: 'gemini-1.5-flash', input: 0.075, output: 0.30,  cached_input: 0.019 },

  // ---- Mistral ----
  // NOTE THE TIER INVERSION: Mistral Large 3 ($0.50/$1.50) is CHEAPER than
  // Mistral Medium 3.5 ($1.50/$7.50). The seeded routing rules send 'complex' to
  // Large and 'moderate' to Medium, so on Mistral the premium tier now costs less
  // than the standard one. Worth revisiting those two rules.
  { match: /^mistral-large/,                    provider: 'mistral',   family: 'mistral-large-3',  input: 0.50,  output: 1.50,  cached_input: null },
  { match: /^mistral-medium/,                   provider: 'mistral',   family: 'mistral-medium-3.5', input: 1.50, output: 7.50, cached_input: null },
  { match: /^mistral-small/,                    provider: 'mistral',   family: 'mistral-small-4',  input: 0.15,  output: 0.60,  cached_input: null },
  { match: /^ministral-3b/,                     provider: 'mistral',   family: 'ministral-3b',     input: 0.10,  output: 0.10,  cached_input: null },
  { match: /^ministral-8b/,                     provider: 'mistral',   family: 'ministral-8b',     input: 0.15,  output: 0.15,  cached_input: null },
  { match: /^ministral-14b/,                    provider: 'mistral',   family: 'ministral-14b',    input: 0.20,  output: 0.20,  cached_input: null },
  { match: /^codestral-embed/,                  provider: 'mistral',   family: 'codestral-embed',  input: 0.15,  output: 0.00,  cached_input: null },
  { match: /^codestral/,                        provider: 'mistral',   family: 'codestral',        input: 0.30,  output: 0.90,  cached_input: null },
  { match: /^mistral-embed/,                    provider: 'mistral',   family: 'mistral-embed',    input: 0.10,  output: 0.00,  cached_input: null },
  { match: /^zai-glm-5-2/,                      provider: 'mistral',   family: 'zai-glm-5.2',      input: 1.40,  output: 4.40,  cached_input: 0.14 },

  // ---- Perplexity ----
  // TOKENS ONLY. Every Sonar model except Deep Research also bills a per-REQUEST
  // search fee ($5-$14 per 1,000 requests depending on search context size), and
  // Deep Research bills citation, reasoning, and per-search fees on top. None of
  // that fits a per-token table, so Perplexity spend is UNDER-reported here.
  { match: /^sonar-reasoning-pro/,              provider: 'perplexity', family: 'sonar-reasoning-pro', input: 2.00, output: 8.00, cached_input: null },
  { match: /^sonar-deep-research/,              provider: 'perplexity', family: 'sonar-deep-research', input: 2.00, output: 8.00, cached_input: null },
  { match: /^sonar-pro/,                        provider: 'perplexity', family: 'sonar-pro',        input: 3.00,  output: 15.00, cached_input: null },
  { match: /^sonar/,                            provider: 'perplexity', family: 'sonar',            input: 1.00,  output: 1.00,  cached_input: null },
];

// `unpriced: true` is the important field. A model with no row costs 0, and a
// zero is indistinguishable from "this was free" once it reaches a total — which
// is how the standard and premium routing tiers came to be reported as costing
// nothing. Callers that show spend should surface unpriced traffic rather than
// silently adding zero to a total; the flag is what makes that possible.
const UNKNOWN = { provider: 'unknown', family: 'unknown', input: 0, output: 0, cached_input: null, unpriced: true };
const LOCAL = { provider: 'local', family: 'local', input: 0, output: 0, cached_input: null };

export function priceFor(modelId, providerHint = null) {
  if (providerHint && providerHint.startsWith('local-')) return { ...LOCAL, family: modelId || 'local' };
  if (!modelId) return UNKNOWN;
  for (const m of MODELS) {
    if (m.match.test(modelId)) return m;
  }
  return UNKNOWN;
}

// Compute USD cost from token counts. Tokens come back from provider APIs.
// providerHint='local-*' forces zero-cost pricing regardless of model id (the
// model name often won't be in our table for local installs).
export function computeCost({ modelId, promptTokens = 0, completionTokens = 0, cachedTokens = 0, providerHint = null }) {
  const p = priceFor(modelId, providerHint);
  const billedInput = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (billedInput * p.input) / 1_000_000;
  const cachedCost = ((p.cached_input ?? p.input) * cachedTokens) / 1_000_000;
  const outputCost = (completionTokens * p.output) / 1_000_000;
  return {
    pricing_version: VERSION,
    provider: p.provider,
    family: p.family,
    input_cost_usd: inputCost,
    cached_cost_usd: cachedCost,
    output_cost_usd: outputCost,
    total_cost_usd: inputCost + cachedCost + outputCost,
  };
}
